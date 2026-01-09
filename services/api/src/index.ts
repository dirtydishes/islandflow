import { readEnv } from "@islandflow/config";
import { createLogger } from "@islandflow/observability";
import {
  SUBJECT_ALERTS,
  SUBJECT_CLASSIFIER_HITS,
  SUBJECT_EQUITY_CANDLES,
  SUBJECT_EQUITY_JOINS,
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  SUBJECT_INFERRED_DARK,
  SUBJECT_FLOW_PACKETS,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  STREAM_ALERTS,
  STREAM_CLASSIFIER_HITS,
  STREAM_EQUITY_CANDLES,
  STREAM_EQUITY_JOINS,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  STREAM_INFERRED_DARK,
  STREAM_FLOW_PACKETS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureStream,
  subscribeJson
} from "@islandflow/bus";
import {
  createClickHouseClient,
  ensureAlertsTable,
  ensureClassifierHitsTable,
  ensureEquityCandlesTable,
  ensureEquityPrintJoinsTable,
  ensureEquityPrintsTable,
  ensureEquityQuotesTable,
  ensureInferredDarkTable,
  ensureFlowPacketsTable,
  ensureOptionNBBOTable,
  ensureOptionPrintsTable,
  fetchRecentAlerts,
  fetchRecentClassifierHits,
  fetchRecentEquityPrintJoins,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentEquityQuotes,
  fetchEquityCandlesAfter,
  fetchEquityCandlesRange,
  fetchRecentOptionNBBO,
  fetchEquityPrintsAfter,
  fetchEquityPrintJoinsAfter,
  fetchEquityQuotesAfter,
  fetchInferredDarkAfter,
  fetchRecentEquityPrints,
  fetchOptionNBBOAfter,
  fetchOptionPrintsAfter,
  fetchRecentOptionPrints
} from "@islandflow/storage";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  EquityCandleSchema,
  EquityPrintSchema,
  EquityPrintJoinSchema,
  EquityQuoteSchema,
  InferredDarkEventSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema
} from "@islandflow/types";
import { createClient } from "redis";
import { z } from "zod";

const service = "api";
const logger = createLogger({ service });

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  REST_DEFAULT_LIMIT: z.coerce.number().int().positive().default(200)
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

const limitSchema = z.coerce.number().int().positive().max(1000);
const candleLimitSchema = z.coerce.number().int().positive().max(5000);
const replayParamsSchema = z.object({
  after_ts: z.coerce.number().int().nonnegative().default(0),
  after_seq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(1000).default(200)
});
const candleQuerySchema = z.object({
  underlying_id: z.string().min(1),
  interval_ms: z.coerce.number().int().positive(),
  start_ts: z.coerce.number().int().nonnegative().optional(),
  end_ts: z.coerce.number().int().nonnegative().optional(),
  limit: candleLimitSchema.optional(),
  cache: z.string().optional()
});
const candleReplaySchema = replayParamsSchema.extend({
  underlying_id: z.string().min(1),
  interval_ms: z.coerce.number().int().positive()
});

type Channel =
  | "options"
  | "options-nbbo"
  | "equities"
  | "equity-candles"
  | "equity-quotes"
  | "equity-joins"
  | "inferred-dark"
  | "flow"
  | "classifier-hits"
  | "alerts";

type WsData = {
  channel: Channel;
};

const optionSockets = new Set<WebSocket<WsData>>();
const optionNbboSockets = new Set<WebSocket<WsData>>();
const equitySockets = new Set<WebSocket<WsData>>();
const equityCandleSockets = new Set<WebSocket<WsData>>();
const equityQuoteSockets = new Set<WebSocket<WsData>>();
const equityJoinSockets = new Set<WebSocket<WsData>>();
const inferredDarkSockets = new Set<WebSocket<WsData>>();
const flowSockets = new Set<WebSocket<WsData>>();
const classifierHitSockets = new Set<WebSocket<WsData>>();
const alertSockets = new Set<WebSocket<WsData>>();

const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
};

const parseLimit = (value: string | null): number => {
  if (value === null) {
    return env.REST_DEFAULT_LIMIT;
  }

  return limitSchema.parse(value);
};

const parseReplayParams = (url: URL): { afterTs: number; afterSeq: number; limit: number } => {
  const params = replayParamsSchema.parse({
    after_ts: url.searchParams.get("after_ts") ?? undefined,
    after_seq: url.searchParams.get("after_seq") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });

  return {
    afterTs: params.after_ts,
    afterSeq: params.after_seq,
    limit: params.limit
  };
};

const parseBooleanParam = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const parseCandleParams = (
  url: URL
): {
  underlyingId: string;
  intervalMs: number;
  startTs: number;
  endTs: number;
  limit: number;
  useCache: boolean;
} => {
  const params = candleQuerySchema.parse({
    underlying_id: url.searchParams.get("underlying_id") ?? undefined,
    interval_ms: url.searchParams.get("interval_ms") ?? undefined,
    start_ts: url.searchParams.get("start_ts") ?? undefined,
    end_ts: url.searchParams.get("end_ts") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cache: url.searchParams.get("cache") ?? undefined
  });

  const endTs = params.end_ts ?? Date.now();
  const limit = params.limit ?? env.REST_DEFAULT_LIMIT;
  const startTs =
    params.start_ts ?? Math.max(0, Math.floor(endTs - params.interval_ms * limit));
  const rangeStart = Math.min(startTs, endTs);
  const rangeEnd = Math.max(startTs, endTs);

  return {
    underlyingId: params.underlying_id,
    intervalMs: params.interval_ms,
    startTs: rangeStart,
    endTs: rangeEnd,
    limit,
    useCache: parseBooleanParam(params.cache)
  };
};

const parseCandleReplayParams = (
  url: URL
): { underlyingId: string; intervalMs: number; afterTs: number; afterSeq: number; limit: number } => {
  const params = candleReplaySchema.parse({
    underlying_id: url.searchParams.get("underlying_id") ?? undefined,
    interval_ms: url.searchParams.get("interval_ms") ?? undefined,
    after_ts: url.searchParams.get("after_ts") ?? undefined,
    after_seq: url.searchParams.get("after_seq") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });

  return {
    underlyingId: params.underlying_id,
    intervalMs: params.interval_ms,
    afterTs: params.after_ts,
    afterSeq: params.after_seq,
    limit: params.limit
  };
};

const broadcast = (sockets: Set<WebSocket<WsData>>, payload: unknown): void => {
  const message = JSON.stringify(payload);

  for (const socket of sockets) {
    try {
      socket.send(message);
    } catch (error) {
      logger.warn("failed to send websocket message", {
        error: error instanceof Error ? error.message : String(error)
      });
      sockets.delete(socket);
    }
  }
};

const buildCandleCacheKey = (underlyingId: string, intervalMs: number): string => {
  return `candles:equity:${intervalMs}:${underlyingId}`;
};

const fetchEquityCandlesFromCache = async (
  client: ReturnType<typeof createClient>,
  underlyingId: string,
  intervalMs: number,
  startTs: number,
  endTs: number
): Promise<unknown[]> => {
  const key = buildCandleCacheKey(underlyingId, intervalMs);
  const payloads = await client.zRangeByScore(key, startTs, endTs);
  const parsed = payloads
    .map((payload) => {
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value): value is unknown => value !== null);

  const validated: unknown[] = [];
  for (const entry of parsed) {
    const result = EquityCandleSchema.safeParse(entry);
    if (result.success) {
      validated.push(result.data);
    }
  }

  return validated;
};

const run = async () => {
  logger.info("service starting");

  const { nc, js, jsm } = await connectJetStreamWithRetry(
    {
      servers: env.NATS_URL,
      name: service
    },
    { attempts: 120, delayMs: 500 }
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
    name: STREAM_EQUITY_QUOTES,
    subjects: [SUBJECT_EQUITY_QUOTES],
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

  await ensureStream(jsm, {
    name: STREAM_EQUITY_JOINS,
    subjects: [SUBJECT_EQUITY_JOINS],
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
    name: STREAM_INFERRED_DARK,
    subjects: [SUBJECT_INFERRED_DARK],
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

  await retry("clickhouse table init", 20, 500, async () => {
    await ensureOptionPrintsTable(clickhouse);
    await ensureOptionNBBOTable(clickhouse);
    await ensureEquityPrintsTable(clickhouse);
    await ensureEquityQuotesTable(clickhouse);
    await ensureEquityCandlesTable(clickhouse);
    await ensureEquityPrintJoinsTable(clickhouse);
    await ensureInferredDarkTable(clickhouse);
    await ensureFlowPacketsTable(clickhouse);
    await ensureClassifierHitsTable(clickhouse);
    await ensureAlertsTable(clickhouse);
  });

  let redis: ReturnType<typeof createClient> | null = null;
  try {
    redis = createClient({ url: env.REDIS_URL });
    redis.on("error", (error) => {
      logger.warn("redis client error", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
    await retry("redis connect", 5, 500, async () => {
      if (!redis) {
        return;
      }
      await redis.connect();
    });
  } catch (error) {
    logger.warn("redis unavailable, skipping candle cache", {
      error: error instanceof Error ? error.message : String(error)
    });
    redis = null;
  }

  const subscribeWithReset = async <T>(
    subject: string,
    stream: string,
    durableName: string
  ) => {
    const opts = buildDurableConsumer(durableName);
    try {
      return await subscribeJson<T>(js, subject, opts);
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
        await jsm.consumers.delete(stream, durableName);
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
      return await subscribeJson<T>(js, subject, resetOpts);
    }
  };

  const optionSubscription = await subscribeWithReset(
    SUBJECT_OPTION_PRINTS,
    STREAM_OPTION_PRINTS,
    "api-option-prints"
  );

  const optionNbboSubscription = await subscribeWithReset(
    SUBJECT_OPTION_NBBO,
    STREAM_OPTION_NBBO,
    "api-option-nbbo"
  );

  const equitySubscription = await subscribeWithReset(
    SUBJECT_EQUITY_PRINTS,
    STREAM_EQUITY_PRINTS,
    "api-equity-prints"
  );

  const equityQuoteSubscription = await subscribeWithReset(
    SUBJECT_EQUITY_QUOTES,
    STREAM_EQUITY_QUOTES,
    "api-equity-quotes"
  );

  const equityCandleSubscription = await subscribeWithReset(
    SUBJECT_EQUITY_CANDLES,
    STREAM_EQUITY_CANDLES,
    "api-equity-candles"
  );

  const equityJoinSubscription = await subscribeWithReset(
    SUBJECT_EQUITY_JOINS,
    STREAM_EQUITY_JOINS,
    "api-equity-joins"
  );

  const inferredDarkSubscription = await subscribeWithReset(
    SUBJECT_INFERRED_DARK,
    STREAM_INFERRED_DARK,
    "api-inferred-dark"
  );

  const flowSubscription = await subscribeWithReset(
    SUBJECT_FLOW_PACKETS,
    STREAM_FLOW_PACKETS,
    "api-flow-packets"
  );

  const classifierHitSubscription = await subscribeWithReset(
    SUBJECT_CLASSIFIER_HITS,
    STREAM_CLASSIFIER_HITS,
    "api-classifier-hits"
  );

  const alertSubscription = await subscribeWithReset(
    SUBJECT_ALERTS,
    STREAM_ALERTS,
    "api-alerts"
  );

  const pumpOptions = async () => {
    for await (const msg of optionSubscription.messages) {
      try {
        const payload = OptionPrintSchema.parse(optionSubscription.decode(msg));
        broadcast(optionSockets, { type: "option-print", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process option print", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpOptionNbbo = async () => {
    for await (const msg of optionNbboSubscription.messages) {
      try {
        const payload = OptionNBBOSchema.parse(optionNbboSubscription.decode(msg));
        broadcast(optionNbboSockets, { type: "option-nbbo", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process option nbbo", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpEquities = async () => {
    for await (const msg of equitySubscription.messages) {
      try {
        const payload = EquityPrintSchema.parse(equitySubscription.decode(msg));
        broadcast(equitySockets, { type: "equity-print", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity print", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpEquityQuotes = async () => {
    for await (const msg of equityQuoteSubscription.messages) {
      try {
        const payload = EquityQuoteSchema.parse(equityQuoteSubscription.decode(msg));
        broadcast(equityQuoteSockets, { type: "equity-quote", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity quote", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpEquityCandles = async () => {
    for await (const msg of equityCandleSubscription.messages) {
      try {
        const payload = EquityCandleSchema.parse(equityCandleSubscription.decode(msg));
        broadcast(equityCandleSockets, { type: "equity-candle", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity candle", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpEquityJoins = async () => {
    for await (const msg of equityJoinSubscription.messages) {
      try {
        const payload = EquityPrintJoinSchema.parse(equityJoinSubscription.decode(msg));
        broadcast(equityJoinSockets, { type: "equity-join", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process equity join", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpInferredDark = async () => {
    for await (const msg of inferredDarkSubscription.messages) {
      try {
        const payload = InferredDarkEventSchema.parse(inferredDarkSubscription.decode(msg));
        broadcast(inferredDarkSockets, { type: "inferred-dark", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process inferred dark event", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpFlow = async () => {
    for await (const msg of flowSubscription.messages) {
      try {
        const payload = FlowPacketSchema.parse(flowSubscription.decode(msg));
        broadcast(flowSockets, { type: "flow-packet", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process flow packet", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpClassifierHits = async () => {
    for await (const msg of classifierHitSubscription.messages) {
      try {
        const payload = ClassifierHitEventSchema.parse(classifierHitSubscription.decode(msg));
        broadcast(classifierHitSockets, { type: "classifier-hit", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process classifier hit", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpAlerts = async () => {
    for await (const msg of alertSubscription.messages) {
      try {
        const payload = AlertEventSchema.parse(alertSubscription.decode(msg));
        broadcast(alertSockets, { type: "alert", payload });
        msg.ack();
      } catch (error) {
        logger.error("failed to process alert", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  void pumpOptions();
  void pumpOptionNbbo();
  void pumpEquities();
  void pumpEquityQuotes();
  void pumpEquityCandles();
  void pumpEquityJoins();
  void pumpInferredDark();
  void pumpFlow();
  void pumpClassifierHits();
  void pumpAlerts();

  const server = Bun.serve<WsData>({
    port: env.API_PORT,
    fetch: async (req, serverRef) => {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }

      if (req.method === "GET" && url.pathname === "/prints/options") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentOptionPrints(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/nbbo/options") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentOptionNBBO(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/prints/equities") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentEquityPrints(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/quotes/equities") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentEquityQuotes(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/candles/equities") {
        try {
          const { underlyingId, intervalMs, startTs, endTs, limit, useCache } =
            parseCandleParams(url);
          if (useCache && redis && redis.isOpen) {
            const cached = await fetchEquityCandlesFromCache(
              redis,
              underlyingId,
              intervalMs,
              startTs,
              endTs
            );
            if (cached.length > 0) {
              return jsonResponse({ data: cached });
            }
          }

          const data = await fetchEquityCandlesRange(
            clickhouse,
            underlyingId,
            intervalMs,
            startTs,
            endTs,
            limit
          );
          return jsonResponse({ data });
        } catch (error) {
          return jsonResponse(
            {
              error: "invalid candle query",
              detail: error instanceof Error ? error.message : String(error)
            },
            400
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/joins/equities") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentEquityPrintJoins(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/dark/inferred") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentInferredDark(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/flow/packets") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentFlowPackets(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/flow/classifier-hits") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentClassifierHits(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/flow/alerts") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentAlerts(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/replay/options") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchOptionPrintsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/nbbo") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchOptionNBBOAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/equities") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchEquityPrintsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/equity-quotes") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchEquityQuotesAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/equity-candles") {
        try {
          const { underlyingId, intervalMs, afterTs, afterSeq, limit } =
            parseCandleReplayParams(url);
          const data = await fetchEquityCandlesAfter(
            clickhouse,
            underlyingId,
            intervalMs,
            afterTs,
            afterSeq,
            limit
          );
          const last = data.at(-1);
          const next = last ? { ts: last.ts, seq: last.seq } : null;
          return jsonResponse({ data, next });
        } catch (error) {
          return jsonResponse(
            {
              error: "invalid candle replay query",
              detail: error instanceof Error ? error.message : String(error)
            },
            400
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/replay/equity-joins") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchEquityPrintJoinsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.source_ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/inferred-dark") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchInferredDarkAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.source_ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/ws/options") {
        if (serverRef.upgrade(req, { data: { channel: "options" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/options-nbbo") {
        if (serverRef.upgrade(req, { data: { channel: "options-nbbo" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/equities") {
        if (serverRef.upgrade(req, { data: { channel: "equities" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/equity-candles") {
        if (serverRef.upgrade(req, { data: { channel: "equity-candles" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/equity-quotes") {
        if (serverRef.upgrade(req, { data: { channel: "equity-quotes" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/equity-joins") {
        if (serverRef.upgrade(req, { data: { channel: "equity-joins" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/inferred-dark") {
        if (serverRef.upgrade(req, { data: { channel: "inferred-dark" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/flow") {
        if (serverRef.upgrade(req, { data: { channel: "flow" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/classifier-hits") {
        if (serverRef.upgrade(req, { data: { channel: "classifier-hits" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      if (req.method === "GET" && url.pathname === "/ws/alerts") {
        if (serverRef.upgrade(req, { data: { channel: "alerts" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      return jsonResponse({ error: "not found" }, 404);
    },
    websocket: {
      open: (socket) => {
        if (socket.data.channel === "options") {
          optionSockets.add(socket);
        } else if (socket.data.channel === "options-nbbo") {
          optionNbboSockets.add(socket);
        } else if (socket.data.channel === "equities") {
          equitySockets.add(socket);
        } else if (socket.data.channel === "equity-candles") {
          equityCandleSockets.add(socket);
        } else if (socket.data.channel === "equity-quotes") {
          equityQuoteSockets.add(socket);
        } else if (socket.data.channel === "equity-joins") {
          equityJoinSockets.add(socket);
        } else if (socket.data.channel === "inferred-dark") {
          inferredDarkSockets.add(socket);
        } else if (socket.data.channel === "flow") {
          flowSockets.add(socket);
        } else if (socket.data.channel === "classifier-hits") {
          classifierHitSockets.add(socket);
        } else {
          alertSockets.add(socket);
        }

        logger.info("websocket connected", { channel: socket.data.channel });
      },
      close: (socket) => {
        if (socket.data.channel === "options") {
          optionSockets.delete(socket);
        } else if (socket.data.channel === "options-nbbo") {
          optionNbboSockets.delete(socket);
        } else if (socket.data.channel === "equities") {
          equitySockets.delete(socket);
        } else if (socket.data.channel === "equity-candles") {
          equityCandleSockets.delete(socket);
        } else if (socket.data.channel === "equity-quotes") {
          equityQuoteSockets.delete(socket);
        } else if (socket.data.channel === "equity-joins") {
          equityJoinSockets.delete(socket);
        } else if (socket.data.channel === "inferred-dark") {
          inferredDarkSockets.delete(socket);
        } else if (socket.data.channel === "flow") {
          flowSockets.delete(socket);
        } else if (socket.data.channel === "classifier-hits") {
          classifierHitSockets.delete(socket);
        } else {
          alertSockets.delete(socket);
        }

        logger.info("websocket disconnected", { channel: socket.data.channel });
      }
    }
  });

  logger.info("api listening", { port: server.port });

  const shutdown = async (signal: string) => {
    logger.info("service stopping", { signal });
    server.stop();
    if (redis && redis.isOpen) {
      await redis.quit();
    }
    await nc.drain();
    await clickhouse.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
