import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_FLOW_PACKETS,
  SUBJECT_OPTION_PRINTS,
  STREAM_FLOW_PACKETS,
  STREAM_OPTION_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson,
  subscribeJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureFlowPacketsTable,
  insertFlowPacket
} from "@islandflow/storage";
import { FlowPacketSchema, OptionPrintSchema, type FlowPacket, type OptionPrint } from "@islandflow/types";
import { z } from "zod";

const service = "compute";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  CLUSTER_WINDOW_MS: z.coerce.number().int().positive().default(500)
});

const env = readEnv(envSchema);

const retry = async <T>(
  label: string,
  attempts: number,
  delayMs: number,
  task: () => Promise<T>
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      logger.warn(`${label} attempt failed`, {
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after retries`);
};

type ClusterState = {
  contractId: string;
  startTs: number;
  endTs: number;
  startSourceTs: number;
  endIngestTs: number;
  endSeq: number;
  members: string[];
  totalSize: number;
  totalPremium: number;
  firstPrice: number;
  lastPrice: number;
};

const clusters = new Map<string, ClusterState>();

const buildCluster = (print: OptionPrint): ClusterState => {
  return {
    contractId: print.option_contract_id,
    startTs: print.ts,
    endTs: print.ts,
    startSourceTs: print.source_ts,
    endIngestTs: print.ingest_ts,
    endSeq: print.seq,
    members: [print.trace_id],
    totalSize: print.size,
    totalPremium: print.price * print.size,
    firstPrice: print.price,
    lastPrice: print.price
  };
};

const updateCluster = (cluster: ClusterState, print: OptionPrint): ClusterState => {
  cluster.endTs = Math.max(cluster.endTs, print.ts);
  cluster.endIngestTs = Math.max(cluster.endIngestTs, print.ingest_ts);
  cluster.endSeq = Math.max(cluster.endSeq, print.seq);
  cluster.members.push(print.trace_id);
  cluster.totalSize += print.size;
  cluster.totalPremium += print.price * print.size;
  cluster.lastPrice = print.price;
  return cluster;
};

const flushCluster = async (
  clickhouse: ReturnType<typeof createClickHouseClient>,
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  cluster: ClusterState
): Promise<void> => {
  const features = {
    option_contract_id: cluster.contractId,
    count: cluster.members.length,
    total_size: cluster.totalSize,
    total_premium: Number(cluster.totalPremium.toFixed(4)),
    first_price: cluster.firstPrice,
    last_price: cluster.lastPrice,
    start_ts: cluster.startTs,
    end_ts: cluster.endTs,
    window_ms: env.CLUSTER_WINDOW_MS
  };

  const packet: FlowPacket = {
    source_ts: cluster.startSourceTs,
    ingest_ts: cluster.endIngestTs,
    seq: cluster.endSeq,
    trace_id: `flowpacket:${cluster.contractId}:${cluster.startTs}:${cluster.endTs}`,
    id: `flowpacket:${cluster.contractId}:${cluster.startTs}:${cluster.endTs}`,
    members: cluster.members,
    features,
    join_quality: {}
  };

  const validated = FlowPacketSchema.parse(packet);

  await insertFlowPacket(clickhouse, validated);
  await publishJson(js, SUBJECT_FLOW_PACKETS, validated);

  logger.info("emitted flow packet", {
    id: validated.id,
    contract: cluster.contractId,
    count: cluster.members.length
  });
};

const flushEligibleClusters = async (
  clickhouse: ReturnType<typeof createClickHouseClient>,
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  currentTs: number,
  skipContractId: string
): Promise<void> => {
  for (const [contractId, cluster] of clusters) {
    if (contractId === skipContractId) {
      continue;
    }

    if (currentTs - cluster.endTs > env.CLUSTER_WINDOW_MS) {
      clusters.delete(contractId);
      await flushCluster(clickhouse, js, cluster);
    }
  }
};

const run = async () => {
  logger.info("service starting");

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 20, delayMs: 500 }
  );

  await ensureStream(jsm, {
    name: STREAM_OPTION_PRINTS,
    subjects: [SUBJECT_OPTION_PRINTS],
    retention: "limits",
    storage: "file",
    discard: "old",
    max_msgs_per_subject: -1,
    max_msgs: -1,
    max_bytes: -1,
    max_age: 0,
    num_replicas: 1
  });

  await ensureStream(jsm, {
    name: STREAM_FLOW_PACKETS,
    subjects: [SUBJECT_FLOW_PACKETS],
    retention: "limits",
    storage: "file",
    discard: "old",
    max_msgs_per_subject: -1,
    max_msgs: -1,
    max_bytes: -1,
    max_age: 0,
    num_replicas: 1
  });

  const clickhouse = createClickHouseClient({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE
  });

  await retry("clickhouse table init", 20, 500, async () => {
    await ensureFlowPacketsTable(clickhouse);
  });

  const subscription = await subscribeJson(
    js,
    SUBJECT_OPTION_PRINTS,
    buildDurableConsumer("compute-option-prints")
  );

  const shutdown = async (signal: string) => {
    logger.info("service stopping", { signal });

    for (const cluster of clusters.values()) {
      await flushCluster(clickhouse, js, cluster);
    }
    clusters.clear();

    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  for await (const msg of subscription.messages) {
    try {
      const print = OptionPrintSchema.parse(subscription.decode(msg));
      await flushEligibleClusters(clickhouse, js, print.ts, print.option_contract_id);

      const existing = clusters.get(print.option_contract_id);
      if (!existing) {
        clusters.set(print.option_contract_id, buildCluster(print));
      } else if (print.ts - existing.startTs <= env.CLUSTER_WINDOW_MS) {
        updateCluster(existing, print);
      } else {
        clusters.delete(print.option_contract_id);
        await flushCluster(clickhouse, js, existing);
        clusters.set(print.option_contract_id, buildCluster(print));
      }

      msg.ack();
    } catch (error) {
      logger.error("failed to process option print", {
        error: error instanceof Error ? error.message : String(error)
      });
      msg.term();
    }
  }
};

await run();
