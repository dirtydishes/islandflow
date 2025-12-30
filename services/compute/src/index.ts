import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_ALERTS,
  SUBJECT_CLASSIFIER_HITS,
  SUBJECT_FLOW_PACKETS,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  STREAM_ALERTS,
  STREAM_CLASSIFIER_HITS,
  STREAM_FLOW_PACKETS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson,
  subscribeJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureAlertsTable,
  ensureClassifierHitsTable,
  ensureFlowPacketsTable,
  insertAlert,
  insertClassifierHit,
  insertFlowPacket
} from "@islandflow/storage";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema,
  type AlertEvent,
  type ClassifierHitEvent,
  type FlowPacket,
  type OptionNBBO,
  type OptionPrint
} from "@islandflow/types";
import { z } from "zod";
import { evaluateClassifiers, type ClassifierConfig } from "./classifiers";
import { parseContractId } from "./contracts";
import { createRedisClient, updateRollingStats, type RollingStatsConfig } from "./rolling-stats";
import { summarizeStructure, type ContractLeg } from "./structures";

const service = "compute";
const logger = createLogger({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CLUSTER_WINDOW_MS: z.coerce.number().int().positive().default(500),
  ROLLING_WINDOW_SIZE: z.coerce.number().int().positive().default(50),
  ROLLING_TTL_SEC: z.coerce.number().int().nonnegative().default(86400),
  COMPUTE_DELIVER_POLICY: z.enum(["new", "all", "last", "last_per_subject"]).default("new"),
  COMPUTE_CONSUMER_RESET: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) {
          return true;
        }
        if (["0", "false", "no", "off"].includes(normalized)) {
          return false;
        }
      }
      return value;
    }, z.boolean())
    .default(false),
  NBBO_MAX_AGE_MS: z.coerce.number().int().positive().default(1000),
  CLASSIFIER_SWEEP_MIN_PREMIUM: z.coerce.number().positive().default(40_000),
  CLASSIFIER_SWEEP_MIN_COUNT: z.coerce.number().int().positive().default(3),
  CLASSIFIER_SWEEP_MIN_PREMIUM_Z: z.coerce.number().nonnegative().default(2),
  CLASSIFIER_SPIKE_MIN_PREMIUM: z.coerce.number().positive().default(20_000),
  CLASSIFIER_SPIKE_MIN_SIZE: z.coerce.number().int().positive().default(400),
  CLASSIFIER_SPIKE_MIN_PREMIUM_Z: z.coerce.number().nonnegative().default(2.5),
  CLASSIFIER_SPIKE_MIN_SIZE_Z: z.coerce.number().nonnegative().default(2),
  CLASSIFIER_Z_MIN_SAMPLES: z.coerce.number().int().nonnegative().default(12)
});

const env = readEnv(envSchema);

const classifierConfig: ClassifierConfig = {
  sweepMinPremium: env.CLASSIFIER_SWEEP_MIN_PREMIUM,
  sweepMinCount: env.CLASSIFIER_SWEEP_MIN_COUNT,
  sweepMinPremiumZ: env.CLASSIFIER_SWEEP_MIN_PREMIUM_Z,
  spikeMinPremium: env.CLASSIFIER_SPIKE_MIN_PREMIUM,
  spikeMinSize: env.CLASSIFIER_SPIKE_MIN_SIZE,
  spikeMinPremiumZ: env.CLASSIFIER_SPIKE_MIN_PREMIUM_Z,
  spikeMinSizeZ: env.CLASSIFIER_SPIKE_MIN_SIZE_Z,
  zMinSamples: env.CLASSIFIER_Z_MIN_SAMPLES
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

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
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
const nbboCache = new Map<string, OptionNBBO>();
const recentLegsByKey = new Map<string, ContractLeg[]>();

const MAX_RECENT_LEGS = 20;

const rollingKey = (metric: string, contractId: string): string => {
  return `rolling:${metric}:${contractId}`;
};

const buildLegFromCluster = (cluster: ClusterState): ContractLeg | null => {
  const parsed = parseContractId(cluster.contractId);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    contractId: cluster.contractId,
    startTs: cluster.startTs,
    endTs: cluster.endTs
  };
};

const buildLegKey = (leg: ContractLeg): string => {
  return `${leg.root}:${leg.expiry}`;
};

const isWithinStructureWindow = (anchorTs: number, candidateTs: number): boolean => {
  return Math.abs(anchorTs - candidateTs) <= env.CLUSTER_WINDOW_MS;
};

const collectRecentLegs = (key: string, anchorTs: number, excludeId: string): ContractLeg[] => {
  const recent = recentLegsByKey.get(key) ?? [];
  const filtered = recent.filter(
    (leg) => leg.contractId !== excludeId && isWithinStructureWindow(anchorTs, leg.endTs)
  );
  recentLegsByKey.set(key, filtered);
  return filtered;
};

const storeRecentLeg = (leg: ContractLeg, anchorTs: number): void => {
  const key = buildLegKey(leg);
  const recent = collectRecentLegs(key, anchorTs, "");
  const next = [leg, ...recent].slice(0, MAX_RECENT_LEGS);
  recentLegsByKey.set(key, next);
};

const collectActiveLegs = (
  key: string,
  anchorTs: number,
  excludeId: string
): ContractLeg[] => {
  const legs: ContractLeg[] = [];
  for (const [contractId, cluster] of clusters) {
    if (contractId === excludeId) {
      continue;
    }
    const leg = buildLegFromCluster(cluster);
    if (!leg) {
      continue;
    }
    if (buildLegKey(leg) !== key) {
      continue;
    }
    if (!isWithinStructureWindow(anchorTs, leg.endTs)) {
      continue;
    }
    legs.push(leg);
  }
  return legs;
};

const applyDeliverPolicy = (
  opts: ReturnType<typeof buildDurableConsumer>,
  policy: typeof env.COMPUTE_DELIVER_POLICY
) => {
  switch (policy) {
    case "all":
      opts.deliverAll();
      break;
    case "last":
      opts.deliverLast();
      break;
    case "last_per_subject":
      opts.deliverLastPerSubject();
      break;
    case "new":
    default:
      opts.deliverNew();
      break;
  }
};

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

type NbboJoin = {
  nbbo: OptionNBBO | null;
  ageMs: number;
  stale: boolean;
};

const updateNbboCache = (nbbo: OptionNBBO): void => {
  const existing = nbboCache.get(nbbo.option_contract_id);
  if (
    !existing ||
    nbbo.ts > existing.ts ||
    (nbbo.ts === existing.ts && nbbo.seq >= existing.seq)
  ) {
    nbboCache.set(nbbo.option_contract_id, nbbo);
  }
};

const selectNbbo = (contractId: string, ts: number): NbboJoin => {
  const nbbo = nbboCache.get(contractId) ?? null;
  if (!nbbo) {
    return { nbbo: null, ageMs: env.NBBO_MAX_AGE_MS + 1, stale: true };
  }

  const ageMs = Math.abs(ts - nbbo.ts);
  const stale = ageMs > env.NBBO_MAX_AGE_MS;
  return { nbbo, ageMs, stale };
};

const flushCluster = async (
  clickhouse: ReturnType<typeof createClickHouseClient>,
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  redis: ReturnType<typeof createRedisClient>,
  rollingConfig: RollingStatsConfig,
  cluster: ClusterState
): Promise<void> => {
  const joinQuality: Record<string, number> = {};
  const nbboJoin = selectNbbo(cluster.contractId, cluster.endTs);

  const totalPremium = roundTo(cluster.totalPremium);

  const features: Record<string, string | number | boolean> = {
    option_contract_id: cluster.contractId,
    count: cluster.members.length,
    total_size: cluster.totalSize,
    total_premium: totalPremium,
    first_price: cluster.firstPrice,
    last_price: cluster.lastPrice,
    start_ts: cluster.startTs,
    end_ts: cluster.endTs,
    window_ms: env.CLUSTER_WINDOW_MS
  };

  const addRollingSnapshot = async (
    metric: string,
    value: number,
    prefix: string
  ): Promise<void> => {
    try {
      const snapshot = await updateRollingStats(
        redis,
        rollingKey(metric, cluster.contractId),
        value,
        rollingConfig
      );
      features[`${prefix}_mean`] = roundTo(snapshot.mean);
      features[`${prefix}_std`] = roundTo(snapshot.stddev);
      features[`${prefix}_z`] = roundTo(snapshot.zscore);
      features[`${prefix}_baseline_n`] = snapshot.baselineCount;
    } catch (error) {
      logger.warn("rolling stats update failed", {
        metric,
        contract: cluster.contractId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  await addRollingSnapshot("premium", totalPremium, "total_premium");
  await addRollingSnapshot("size", cluster.totalSize, "total_size");

  const currentLeg = buildLegFromCluster(cluster);
  if (currentLeg) {
    const key = buildLegKey(currentLeg);
    const anchorTs = cluster.endTs;
    const candidates = [
      ...collectRecentLegs(key, anchorTs, currentLeg.contractId),
      ...collectActiveLegs(key, anchorTs, currentLeg.contractId)
    ];
    const summary = summarizeStructure([currentLeg, ...candidates]);
    if (summary) {
      features.structure_type = summary.type;
      features.structure_legs = summary.legs;
      features.structure_strikes = summary.strikes;
      features.structure_strike_span = roundTo(summary.strikeSpan);
      features.structure_rights = summary.rights;
    }
    storeRecentLeg(currentLeg, anchorTs);
  }

  if (!nbboJoin.nbbo) {
    joinQuality.nbbo_missing = 1;
  } else {
    joinQuality.nbbo_age_ms = nbboJoin.ageMs;
    if (nbboJoin.stale) {
      joinQuality.nbbo_stale = 1;
    } else {
      const mid = (nbboJoin.nbbo.bid + nbboJoin.nbbo.ask) / 2;
      const spread = nbboJoin.nbbo.ask - nbboJoin.nbbo.bid;
      features.nbbo_bid = nbboJoin.nbbo.bid;
      features.nbbo_ask = nbboJoin.nbbo.ask;
      features.nbbo_mid = roundTo(mid);
      features.nbbo_spread = roundTo(spread);
      features.nbbo_bid_size = nbboJoin.nbbo.bidSize;
      features.nbbo_ask_size = nbboJoin.nbbo.askSize;
      await addRollingSnapshot("spread", roundTo(spread), "nbbo_spread");
    }
  }

  const packet: FlowPacket = {
    source_ts: cluster.startSourceTs,
    ingest_ts: cluster.endIngestTs,
    seq: cluster.endSeq,
    trace_id: `flowpacket:${cluster.contractId}:${cluster.startTs}:${cluster.endTs}`,
    id: `flowpacket:${cluster.contractId}:${cluster.startTs}:${cluster.endTs}`,
    members: cluster.members,
    features,
    join_quality: joinQuality
  };

  const validated = FlowPacketSchema.parse(packet);

  await insertFlowPacket(clickhouse, validated);
  await publishJson(js, SUBJECT_FLOW_PACKETS, validated);

  await emitClassifiers(clickhouse, js, validated);

  logger.info("emitted flow packet", {
    id: validated.id,
    contract: cluster.contractId,
    count: cluster.members.length
  });
};

const scoreAlert = (packet: FlowPacket, hits: ClassifierHitEvent[]): { score: number; severity: string } => {
  const premium =
    typeof packet.features.total_premium === "number" ? packet.features.total_premium : 0;
  const premiumScore = Math.min(70, Math.round(premium / 1000));
  const maxConfidence = hits.reduce((max, hit) => Math.max(max, hit.confidence), 0);
  const confidenceScore = Math.round(maxConfidence * 20);
  const hitScore = Math.min(20, hits.length * 5);
  const score = Math.max(0, Math.min(100, premiumScore + confidenceScore + hitScore));
  const severity = score >= 80 ? "high" : score >= 45 ? "medium" : "low";
  return { score, severity };
};

const emitClassifiers = async (
  clickhouse: ReturnType<typeof createClickHouseClient>,
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  packet: FlowPacket
): Promise<void> => {
  const hits = evaluateClassifiers(packet, classifierConfig);
  if (hits.length === 0) {
    return;
  }

  const hitEvents: ClassifierHitEvent[] = hits.map((hit) =>
    ClassifierHitEventSchema.parse({
      source_ts: packet.source_ts,
      ingest_ts: packet.ingest_ts,
      seq: packet.seq,
      trace_id: `classifier:${hit.classifier_id}:${packet.id}`,
      ...hit
    })
  );

  for (const hit of hitEvents) {
    try {
      await insertClassifierHit(clickhouse, hit);
      await publishJson(js, SUBJECT_CLASSIFIER_HITS, hit);
    } catch (error) {
      logger.error("failed to emit classifier hit", {
        error: error instanceof Error ? error.message : String(error),
        classifier_id: hit.classifier_id,
        packet_id: packet.id
      });
    }
  }

  const { score, severity } = scoreAlert(packet, hitEvents);
  const alert: AlertEvent = AlertEventSchema.parse({
    source_ts: packet.source_ts,
    ingest_ts: packet.ingest_ts,
    seq: packet.seq,
    trace_id: `alert:${packet.id}`,
    score,
    severity,
    hits: hitEvents.map((hit) => ({
      classifier_id: hit.classifier_id,
      confidence: hit.confidence,
      direction: hit.direction,
      explanations: hit.explanations
    })),
    evidence_refs: [packet.id, ...packet.members]
  });

  try {
    await insertAlert(clickhouse, alert);
    await publishJson(js, SUBJECT_ALERTS, alert);
  } catch (error) {
    logger.error("failed to emit alert", {
      error: error instanceof Error ? error.message : String(error),
      packet_id: packet.id
    });
  }
};

const flushEligibleClusters = async (
  clickhouse: ReturnType<typeof createClickHouseClient>,
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  redis: ReturnType<typeof createRedisClient>,
  rollingConfig: RollingStatsConfig,
  currentTs: number,
  skipContractId: string
): Promise<void> => {
  for (const [contractId, cluster] of clusters) {
    if (contractId === skipContractId) {
      continue;
    }

    if (currentTs - cluster.endTs > env.CLUSTER_WINDOW_MS) {
      clusters.delete(contractId);
      await flushCluster(clickhouse, js, redis, rollingConfig, cluster);
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
    name: STREAM_OPTION_NBBO,
    subjects: [SUBJECT_OPTION_NBBO],
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

  await ensureStream(jsm, {
    name: STREAM_CLASSIFIER_HITS,
    subjects: [SUBJECT_CLASSIFIER_HITS],
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
    name: STREAM_ALERTS,
    subjects: [SUBJECT_ALERTS],
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

  const redis = createRedisClient(env.REDIS_URL);
  redis.on("error", (error) => {
    logger.warn("redis client error", { error: error instanceof Error ? error.message : String(error) });
  });

  await retry("redis connect", 20, 500, async () => {
    await redis.connect();
  });

  const rollingConfig: RollingStatsConfig = {
    windowSize: env.ROLLING_WINDOW_SIZE,
    ttlSeconds: env.ROLLING_TTL_SEC
  };

  await retry("clickhouse table init", 20, 500, async () => {
    await ensureFlowPacketsTable(clickhouse);
    await ensureClassifierHitsTable(clickhouse);
    await ensureAlertsTable(clickhouse);
  });

  const durableName = "compute-option-prints";
  const nbboDurableName = "compute-option-nbbo";

  if (env.COMPUTE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_OPTION_PRINTS, durableName);
      logger.warn("reset jetstream consumer", { durable: durableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", { durable: durableName, error: message });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_OPTION_PRINTS, durableName);
      if (info?.config?.deliver_policy && info.config.deliver_policy !== env.COMPUTE_DELIVER_POLICY) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: durableName,
          current: info.config.deliver_policy,
          desired: env.COMPUTE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_OPTION_PRINTS, durableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", { durable: durableName, error: message });
      }
    }
  }

  if (env.COMPUTE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_OPTION_NBBO, nbboDurableName);
      logger.warn("reset jetstream consumer", { durable: nbboDurableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", { durable: nbboDurableName, error: message });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_OPTION_NBBO, nbboDurableName);
      if (info?.config?.deliver_policy && info.config.deliver_policy !== env.COMPUTE_DELIVER_POLICY) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: nbboDurableName,
          current: info.config.deliver_policy,
          desired: env.COMPUTE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_OPTION_NBBO, nbboDurableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", { durable: nbboDurableName, error: message });
      }
    }
  }

  const subscription = await (async () => {
    const opts = buildDurableConsumer(durableName);
    applyDeliverPolicy(opts, env.COMPUTE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_OPTION_PRINTS, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldReset =
        message.includes("duplicate subscription") ||
        message.includes("durable requires") ||
        message.includes("subject does not match consumer");

      if (!shouldReset) {
        throw error;
      }

      logger.warn("resetting jetstream consumer", { durable: durableName, error: message });

      try {
        await jsm.consumers.delete(STREAM_OPTION_PRINTS, durableName);
      } catch (deleteError) {
        const deleteMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!deleteMessage.includes("not found")) {
          logger.warn("failed to delete jetstream consumer", {
            durable: durableName,
            error: deleteMessage
          });
        }
      }

      const resetOpts = buildDurableConsumer(durableName);
      applyDeliverPolicy(resetOpts, env.COMPUTE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_OPTION_PRINTS, resetOpts);
    }
  })();

  const nbboSubscription = await (async () => {
    const opts = buildDurableConsumer(nbboDurableName);
    applyDeliverPolicy(opts, env.COMPUTE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_OPTION_NBBO, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldReset =
        message.includes("duplicate subscription") ||
        message.includes("durable requires") ||
        message.includes("subject does not match consumer");

      if (!shouldReset) {
        throw error;
      }

      logger.warn("resetting jetstream consumer", { durable: nbboDurableName, error: message });

      try {
        await jsm.consumers.delete(STREAM_OPTION_NBBO, nbboDurableName);
      } catch (deleteError) {
        const deleteMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!deleteMessage.includes("not found")) {
          logger.warn("failed to delete jetstream consumer", {
            durable: nbboDurableName,
            error: deleteMessage
          });
        }
      }

      const resetOpts = buildDurableConsumer(nbboDurableName);
      applyDeliverPolicy(resetOpts, env.COMPUTE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_OPTION_NBBO, resetOpts);
    }
  })();

  const nbboLoop = async () => {
    for await (const msg of nbboSubscription.messages) {
      try {
        const nbbo = OptionNBBOSchema.parse(nbboSubscription.decode(msg));
        updateNbboCache(nbbo);
        msg.ack();
      } catch (error) {
        logger.error("failed to process option nbbo", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  void nbboLoop();

  const shutdown = async (signal: string) => {
    logger.info("service stopping", { signal });

    for (const cluster of clusters.values()) {
      await flushCluster(clickhouse, js, redis, rollingConfig, cluster);
    }
    clusters.clear();

    await nc.drain();
    await clickhouse.close();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  for await (const msg of subscription.messages) {
    try {
      const print = OptionPrintSchema.parse(subscription.decode(msg));
      await flushEligibleClusters(
        clickhouse,
        js,
        redis,
        rollingConfig,
        print.ts,
        print.option_contract_id
      );

      const existing = clusters.get(print.option_contract_id);
      if (!existing) {
        clusters.set(print.option_contract_id, buildCluster(print));
      } else if (print.ts - existing.startTs <= env.CLUSTER_WINDOW_MS) {
        updateCluster(existing, print);
      } else {
        clusters.delete(print.option_contract_id);
        await flushCluster(clickhouse, js, redis, rollingConfig, existing);
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
