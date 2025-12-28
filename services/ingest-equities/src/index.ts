import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_EQUITY_PRINTS,
  STREAM_EQUITY_PRINTS,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureEquityPrintsTable,
  insertEquityPrint
} from "@islandflow/storage";
import { EquityPrintSchema, type EquityPrint } from "@islandflow/types";
import { createSyntheticEquitiesAdapter } from "./adapters/synthetic";
import type { EquityIngestAdapter, StopHandler } from "./adapters/types";
import { z } from "zod";

const service = "ingest-equities";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  EMIT_INTERVAL_MS: z.coerce.number().int().positive().default(1000)
});

const env = readEnv(envSchema);

const state = {
  shuttingDown: false
};

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

const selectAdapter = (name: string): EquityIngestAdapter => {
  if (name === "synthetic") {
    return createSyntheticEquitiesAdapter({ emitIntervalMs: env.EMIT_INTERVAL_MS });
  }

  throw new Error(`Unknown ingest adapter: ${name}`);
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
    name: STREAM_EQUITY_PRINTS,
    subjects: [SUBJECT_EQUITY_PRINTS],
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
    await ensureEquityPrintsTable(clickhouse);
  });

  const adapter = selectAdapter(env.INGEST_ADAPTER);
  logger.info("ingest adapter selected", { adapter: adapter.name });

  const stopAdapter: StopHandler = await adapter.start({
    onTrade: async (candidate: EquityPrint) => {
      if (state.shuttingDown) {
        return;
      }

      const print = EquityPrintSchema.parse(candidate);

      try {
        await insertEquityPrint(clickhouse, print);
        await publishJson(js, SUBJECT_EQUITY_PRINTS, print);
        logger.info("published equity print", {
          trace_id: print.trace_id,
          seq: print.seq,
          underlying_id: print.underlying_id
        });
      } catch (error) {
        logger.error("failed to publish equity print", {
          error: error instanceof Error ? error.message : String(error),
          trace_id: print.trace_id
        });
      }
    }
  });

  const shutdown = async (signal: string) => {
    if (state.shuttingDown) {
      return;
    }

    state.shuttingDown = true;
    await stopAdapter();

    logger.info("service stopping", { signal });

    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
