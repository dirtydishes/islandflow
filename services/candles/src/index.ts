import { readEnv } from "@islandflow/config";
import { createLogger, createMetrics } from "@islandflow/observability";
import {
  SUBJECT_EQUITY_CANDLES,
  SUBJECT_EQUITY_PRINTS,
  STREAM_EQUITY_CANDLES,
  STREAM_EQUITY_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  publishJson,
  subscribeJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureEquityCandlesTable,
  insertEquityCandle
} from "@islandflow/storage";
import { EquityCandleSchema, EquityPrintSchema, type EquityCandle } from "@islandflow/types";
import { createClient } from "redis";
import { z } from "zod";
import { CandleAggregator, parseIntervals } from "./aggregator";

const service = "candles";
const logger = createLogger({ service });
const metrics = createMetrics({ service });

const envSchema = z.object({
  NATS_URL: z.string().default("nats://localhost:4222"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CANDLE_INTERVALS_MS: z.string().default("1000,5000,60000"),
  CANDLE_MAX_LATE_MS: z.coerce.number().int().nonnegative().default(0),
  CANDLE_CACHE_LIMIT: z.coerce.number().int().nonnegative().default(2000),
  CANDLE_DELIVER_POLICY: z
    .enum(["new", "all", "last", "last_per_subject"])
    .default("new"),
  CANDLE_CONSUMER_RESET: z
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
    .default(false)
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

const applyDeliverPolicy = (
  opts: ReturnType<typeof buildDurableConsumer>,
  policy: typeof env.CANDLE_DELIVER_POLICY
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

const createRedisClient = (url: string) => {
  return createClient({ url });
};

const buildCacheKey = (underlyingId: string, intervalMs: number): string => {
  return `candles:equity:${intervalMs}:${underlyingId}`;
};

const cacheCandle = async (
  client: ReturnType<typeof createClient>,
  candle: EquityCandle,
  cacheLimit: number
): Promise<void> => {
  if (cacheLimit <= 0) {
    return;
  }

  const key = buildCacheKey(candle.underlying_id, candle.interval_ms);
  const payload = JSON.stringify(candle);
  const maxAgeMs = candle.interval_ms * cacheLimit;
  const trimBefore = Math.max(0, candle.ts - maxAgeMs);
  const multi = client.multi();
  multi.zAdd(key, { score: candle.ts, value: payload });
  if (trimBefore > 0) {
    multi.zRemRangeByScore(key, 0, trimBefore);
  }
  await multi.exec();
};

const emitCandle = async (
  clickhouse: ReturnType<typeof createClickHouseClient>,
  js: Awaited<ReturnType<typeof connectJetStreamWithRetry>>["js"],
  redis: ReturnType<typeof createClient> | null,
  candle: EquityCandle,
  cacheLimit: number
): Promise<void> => {
  try {
    await insertEquityCandle(clickhouse, candle);
  } catch (error) {
    metrics.count("candles.persist_failed", 1);
    logger.error("failed to persist candle", {
      error: error instanceof Error ? error.message : String(error),
      trace_id: candle.trace_id,
      underlying_id: candle.underlying_id,
      interval_ms: candle.interval_ms
    });
    return;
  }

  metrics.count("candles.emitted", 1, {
    interval_ms: String(candle.interval_ms)
  });

  try {
    await publishJson(js, SUBJECT_EQUITY_CANDLES, candle);
  } catch (error) {
    metrics.count("candles.publish_failed", 1);
    logger.error("failed to publish candle", {
      error: error instanceof Error ? error.message : String(error),
      trace_id: candle.trace_id,
      underlying_id: candle.underlying_id,
      interval_ms: candle.interval_ms
    });
  }

  if (redis && redis.isOpen) {
    try {
      await cacheCandle(redis, candle, cacheLimit);
    } catch (error) {
      metrics.count("candles.cache_failed", 1);
      logger.warn("failed to cache candle", {
        error: error instanceof Error ? error.message : String(error),
        trace_id: candle.trace_id,
        underlying_id: candle.underlying_id,
        interval_ms: candle.interval_ms
      });
    }
  }
};

const run = async () => {
  logger.info("service starting");

  const intervalsMs = parseIntervals(env.CANDLE_INTERVALS_MS, [1000, 5000, 60000]);
  if (intervalsMs.length === 0) {
    throw new Error("CANDLE_INTERVALS_MS produced no valid intervals");
  }

  const aggregator = new CandleAggregator({
    intervalsMs,
    maxLateMs: env.CANDLE_MAX_LATE_MS
  });

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

  await ensureStream(jsm, {
    name: STREAM_EQUITY_CANDLES,
    subjects: [SUBJECT_EQUITY_CANDLES],
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
    await ensureEquityCandlesTable(clickhouse);
  });

  let redis: ReturnType<typeof createClient> | null = null;
  try {
    redis = createRedisClient(env.REDIS_URL);
    redis.on("error", (error) => {
      logger.warn("redis client error", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
    await retry("redis connect", 20, 500, async () => {
      if (!redis) {
        return;
      }
      await redis.connect();
    });
  } catch (error) {
    logger.warn("redis unavailable, skipping hot cache", {
      error: error instanceof Error ? error.message : String(error)
    });
    redis = null;
  }

  const durableName = "candles-equity-prints";
  if (env.CANDLE_CONSUMER_RESET) {
    try {
      await jsm.consumers.delete(STREAM_EQUITY_PRINTS, durableName);
      logger.warn("reset jetstream consumer", { durable: durableName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to reset jetstream consumer", { durable: durableName, error: message });
      }
    }
  } else {
    try {
      const info = await jsm.consumers.info(STREAM_EQUITY_PRINTS, durableName);
      if (info?.config?.deliver_policy && info.config.deliver_policy !== env.CANDLE_DELIVER_POLICY) {
        logger.warn("resetting consumer due to deliver policy change", {
          durable: durableName,
          current: info.config.deliver_policy,
          desired: env.CANDLE_DELIVER_POLICY
        });
        await jsm.consumers.delete(STREAM_EQUITY_PRINTS, durableName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("not found")) {
        logger.warn("failed to inspect jetstream consumer", { durable: durableName, error: message });
      }
    }
  }

  const subscribeWithReset = async () => {
    const opts = buildDurableConsumer(durableName);
    applyDeliverPolicy(opts, env.CANDLE_DELIVER_POLICY);
    try {
      return await subscribeJson(js, SUBJECT_EQUITY_PRINTS, opts);
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
        await jsm.consumers.delete(STREAM_EQUITY_PRINTS, durableName);
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
      applyDeliverPolicy(resetOpts, env.CANDLE_DELIVER_POLICY);
      return await subscribeJson(js, SUBJECT_EQUITY_PRINTS, resetOpts);
    }
  };

  const subscription = await subscribeWithReset();
  let droppedLate = 0;
  let lastLateLog = Date.now();

  const loop = async () => {
    for await (const msg of subscription.messages) {
      try {
        const print = EquityPrintSchema.parse(subscription.decode(msg));
        metrics.count("candles.prints", 1);

        const result = aggregator.ingest(print);
        if (result.droppedLate > 0) {
          droppedLate += result.droppedLate;
          metrics.count("candles.prints_late", result.droppedLate);
          const now = Date.now();
          if (now - lastLateLog > 5000) {
            logger.warn("late equity prints dropped", { dropped: droppedLate });
            droppedLate = 0;
            lastLateLog = now;
          }
        }

        for (const candle of result.emitted) {
          const validated = EquityCandleSchema.parse(candle);
          await emitCandle(clickhouse, js, redis, validated, env.CANDLE_CACHE_LIMIT);
        }

        msg.ack();
      } catch (error) {
        metrics.count("candles.prints_failed", 1);
        logger.error("failed to process equity print", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const shutdown = async (signal: string) => {
    logger.info("service stopping", { signal });
    const remaining = aggregator.drain();
    for (const candle of remaining) {
      const validated = EquityCandleSchema.parse(candle);
      await emitCandle(clickhouse, js, redis, validated, env.CANDLE_CACHE_LIMIT);
    }
    if (redis && redis.isOpen) {
      await redis.quit();
    }
    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  void loop();
};

await run();
