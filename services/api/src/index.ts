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
  SUBJECT_OPTION_SIGNAL_PRINTS,
  STREAM_ALERTS,
  STREAM_CLASSIFIER_HITS,
  STREAM_EQUITY_CANDLES,
  STREAM_EQUITY_JOINS,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  STREAM_INFERRED_DARK,
  STREAM_FLOW_PACKETS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_SIGNAL_PRINTS,
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
  fetchAlertsAfter,
  fetchAlertsBefore,
  fetchClassifierHitsAfter,
  fetchClassifierHitsBefore,
  fetchFlowPacketsAfter,
  fetchFlowPacketById,
  fetchFlowPacketsBefore,
  fetchRecentAlerts,
  fetchRecentClassifierHits,
  fetchRecentEquityPrintJoins,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentEquityQuotes,
  fetchEquityCandlesAfter,
  fetchEquityCandlesRange,
  fetchEquityPrintJoinsByIds,
  fetchEquityPrintJoinsBefore,
  fetchRecentOptionNBBO,
  fetchEquityPrintsAfter,
  fetchEquityPrintsBefore,
  fetchEquityPrintsRange,
  fetchEquityPrintJoinsAfter,
  fetchEquityQuotesBefore,
  fetchEquityQuotesAfter,
  fetchInferredDarkBefore,
  fetchInferredDarkAfter,
  fetchRecentEquityPrints,
  fetchOptionNBBOBefore,
  fetchOptionNBBOAfter,
  fetchOptionPrintsBefore,
  fetchOptionPrintsAfter,
  fetchOptionPrintsByTraceIds,
  fetchRecentOptionPrints
} from "@islandflow/storage";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  Cursor,
  EquityCandleSchema,
  EquityPrintSchema,
  EquityPrintJoinSchema,
  EquityQuoteSchema,
  FeedSnapshot,
  InferredDarkEventSchema,
  LiveClientMessageSchema,
  LiveServerMessage,
  LiveSubscription,
  LiveSubscriptionSchema,
  matchesFlowPacketFilters,
  matchesOptionPrintFilters,
  OptionFlowFilters,
  OptionFlowViewSchema,
  OptionNbboSideSchema,
  OptionSecurityTypeSchema,
  OptionTypeSchema,
  FlowPacketSchema,
  OptionNBBOSchema,
  OptionPrintSchema,
  getSubscriptionKey
} from "@islandflow/types";
import { createClient } from "redis";
import { z } from "zod";
import { LiveStateManager, shouldFanoutLiveEvent } from "./live";

const service = "api";
const logger = createLogger({ service });

const DeliverPolicySchema = z.enum(["new", "all", "last", "last_per_subject"]);

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  REST_DEFAULT_LIMIT: z.coerce.number().int().positive().default(200),
  API_DELIVER_POLICY: DeliverPolicySchema.default("new"),
  API_CONSUMER_RESET: z.coerce.boolean().default(false)
});

const env = readEnv(envSchema);

const state = {
  shuttingDown: false,
  shutdownPromise: null as Promise<void> | null
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isExpectedShutdownError = (error: unknown): boolean => {
  if (!state.shuttingDown) {
    return false;
  }

  const message = getErrorMessage(error).toUpperCase();
  return [
    "SOCKET CONNECTION WAS CLOSED UNEXPECTEDLY",
    "SOCKET CLOSED UNEXPECTEDLY",
    "ECONNREFUSED",
    "CONNECTION_CLOSED",
    "CONNECTION_DRAINING",
    "TIMEOUT"
  ].some((token) => message.includes(token));
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

const limitSchema = z.coerce.number().int().positive().max(1000);
const candleLimitSchema = z.coerce.number().int().positive().max(5000);
const replayParamsSchema = z.object({
  after_ts: z.coerce.number().int().nonnegative().default(0),
  after_seq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(1000).default(200)
});
const beforeParamsSchema = z.object({
  before_ts: z.coerce.number().int().nonnegative(),
  before_seq: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive().max(1000).default(200)
});

const replaySourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  .transform((value) => value.toLowerCase());
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

const equityPrintRangeSchema = z.object({
  underlying_id: z.string().min(1),
  start_ts: z.coerce.number().int().nonnegative(),
  end_ts: z.coerce.number().int().nonnegative(),
  limit: limitSchema.optional()
});
const optionSideListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  .pipe(z.array(OptionNbboSideSchema));
const optionTypeListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  .pipe(z.array(OptionTypeSchema));
const optionSecuritySchema = z.enum(["stock", "etf", "all"]);
const optionFilterQuerySchema = z.object({
  view: OptionFlowViewSchema.optional(),
  security: optionSecuritySchema.optional(),
  side: optionSideListSchema.optional(),
  type: optionTypeListSchema.optional(),
  min_notional: z.coerce.number().nonnegative().optional()
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

type LiveWsData = {
  channel: "live";
};

type LegacySocket = any;
type LiveSocket = any;

const optionSockets = new Set<LegacySocket>();
const optionNbboSockets = new Set<LegacySocket>();
const equitySockets = new Set<LegacySocket>();
const equityCandleSockets = new Set<LegacySocket>();
const equityQuoteSockets = new Set<LegacySocket>();
const equityJoinSockets = new Set<LegacySocket>();
const inferredDarkSockets = new Set<LegacySocket>();
const flowSockets = new Set<LegacySocket>();
const classifierHitSockets = new Set<LegacySocket>();
const alertSockets = new Set<LegacySocket>();
const liveSocketSubscriptions = new Map<LiveSocket, Set<string>>();
const subscriptionSockets = new Map<string, Set<LiveSocket>>();
const subscriptionDefinitions = new Map<string, LiveSubscription>();
const liveHeartbeats = new Map<LiveSocket, ReturnType<typeof setInterval>>();

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

const applyDeliverPolicy = (
  opts: ReturnType<typeof buildDurableConsumer>,
  policy: z.infer<typeof DeliverPolicySchema>
): void => {
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

const parseOptionPrintFilters = (
  url: URL
): {
  view: z.infer<typeof OptionFlowViewSchema>;
  storageFilters: Parameters<typeof fetchRecentOptionPrints>[3];
  liveFilters: OptionFlowFilters;
} => {
  const parsed = optionFilterQuerySchema.parse({
    view: url.searchParams.get("view") ?? undefined,
    security: url.searchParams.get("security") ?? undefined,
    side: url.searchParams.get("side") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    min_notional: url.searchParams.get("min_notional") ?? undefined
  });
  const view = parsed.view ?? "signal";
  const security = parsed.security ?? (view === "raw" ? "all" : "stock");
  const storageFilters = {
    view,
    security,
    minNotional: parsed.min_notional,
    nbboSides: parsed.side,
    optionTypes: parsed.type
  } as const;
  const liveFilters: OptionFlowFilters = {
    view,
    securityTypes:
      security === "all"
        ? undefined
        : ([security] as Array<z.infer<typeof OptionSecurityTypeSchema>>),
    nbboSides: parsed.side,
    optionTypes: parsed.type,
    minNotional: parsed.min_notional
  };

  return { view, storageFilters, liveFilters };
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

const parseBeforeParams = (url: URL): { beforeTs: number; beforeSeq: number; limit: number } => {
  const params = beforeParamsSchema.parse({
    before_ts: url.searchParams.get("before_ts") ?? undefined,
    before_seq: url.searchParams.get("before_seq") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });

  return {
    beforeTs: params.before_ts,
    beforeSeq: params.before_seq,
    limit: params.limit
  };
};

const parseReplaySource = (url: URL): string | null => {
  const raw = url.searchParams.get("source");
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  return replaySourceSchema.parse(trimmed);
};

const parseBooleanParam = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const parseEquityPrintRangeParams = (
  url: URL
): { underlyingId: string; startTs: number; endTs: number; limit: number } => {
  const params = equityPrintRangeSchema.parse({
    underlying_id: url.searchParams.get("underlying_id") ?? undefined,
    start_ts: url.searchParams.get("start_ts") ?? undefined,
    end_ts: url.searchParams.get("end_ts") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });

  return {
    underlyingId: params.underlying_id,
    startTs: params.start_ts,
    endTs: params.end_ts,
    limit: params.limit ?? env.REST_DEFAULT_LIMIT
  };
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

const broadcast = (sockets: Set<LegacySocket>, payload: unknown): void => {
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

const sendLiveMessage = (socket: LiveSocket, payload: LiveServerMessage): void => {
  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    logger.warn("failed to send live websocket message", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

const subscribeSocket = (socket: LiveSocket, subscription: LiveSubscription): void => {
  const key = getSubscriptionKey(subscription);
  const keys = liveSocketSubscriptions.get(socket) ?? new Set<string>();
  keys.add(key);
  liveSocketSubscriptions.set(socket, keys);

  const sockets = subscriptionSockets.get(key) ?? new Set<LiveSocket>();
  sockets.add(socket);
  subscriptionSockets.set(key, sockets);
  subscriptionDefinitions.set(key, subscription);
};

const unsubscribeSocket = (socket: LiveSocket, subscription: LiveSubscription): void => {
  const key = getSubscriptionKey(subscription);
  liveSocketSubscriptions.get(socket)?.delete(key);

  const sockets = subscriptionSockets.get(key);
  if (!sockets) {
    return;
  }
  sockets.delete(socket);
  if (sockets.size === 0) {
    subscriptionSockets.delete(key);
    subscriptionDefinitions.delete(key);
  }
};

const cleanupLiveSocket = (socket: LiveSocket): void => {
  const keys = liveSocketSubscriptions.get(socket);
  if (keys) {
    for (const key of keys) {
      const sockets = subscriptionSockets.get(key);
      sockets?.delete(socket);
      if (sockets && sockets.size === 0) {
        subscriptionSockets.delete(key);
        subscriptionDefinitions.delete(key);
      }
    }
  }
  liveSocketSubscriptions.delete(socket);
  const heartbeat = liveHeartbeats.get(socket);
  if (heartbeat) {
    clearInterval(heartbeat);
    liveHeartbeats.delete(socket);
  }
};

const buildHistoryResponse = <T extends { seq: number }>(
  items: T[],
  cursorOf: (item: T) => Cursor
): { data: T[]; next_before: Cursor | null } => {
  const last = items.at(-1);
  return {
    data: items,
    next_before: last ? cursorOf(last) : null
  };
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
    name: STREAM_OPTION_SIGNAL_PRINTS,
    subjects: [SUBJECT_OPTION_SIGNAL_PRINTS],
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

  await retry("clickhouse table init", 120, 500, async () => {
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
      if (isExpectedShutdownError(error)) {
        return;
      }

      logger.warn("redis client error", {
        error: getErrorMessage(error)
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

  const liveState = new LiveStateManager(clickhouse, redis);
  await liveState.hydrate();
  const liveStateMetricsTimer = setInterval(() => {
    const snapshot = liveState.getStatsSnapshot();
    logger.info("live cache metrics", snapshot);
  }, 60000);

  const consumerBindings = [
    {
      subject: SUBJECT_OPTION_SIGNAL_PRINTS,
      stream: STREAM_OPTION_SIGNAL_PRINTS,
      durableName: "api-option-prints"
    },
    {
      subject: SUBJECT_OPTION_NBBO,
      stream: STREAM_OPTION_NBBO,
      durableName: "api-option-nbbo"
    },
    {
      subject: SUBJECT_EQUITY_PRINTS,
      stream: STREAM_EQUITY_PRINTS,
      durableName: "api-equity-prints"
    },
    {
      subject: SUBJECT_EQUITY_QUOTES,
      stream: STREAM_EQUITY_QUOTES,
      durableName: "api-equity-quotes"
    },
    {
      subject: SUBJECT_EQUITY_CANDLES,
      stream: STREAM_EQUITY_CANDLES,
      durableName: "api-equity-candles"
    },
    {
      subject: SUBJECT_EQUITY_JOINS,
      stream: STREAM_EQUITY_JOINS,
      durableName: "api-equity-joins"
    },
    {
      subject: SUBJECT_INFERRED_DARK,
      stream: STREAM_INFERRED_DARK,
      durableName: "api-inferred-dark"
    },
    {
      subject: SUBJECT_FLOW_PACKETS,
      stream: STREAM_FLOW_PACKETS,
      durableName: "api-flow-packets"
    },
    {
      subject: SUBJECT_CLASSIFIER_HITS,
      stream: STREAM_CLASSIFIER_HITS,
      durableName: "api-classifier-hits"
    },
    {
      subject: SUBJECT_ALERTS,
      stream: STREAM_ALERTS,
      durableName: "api-alerts"
    }
  ] as const;

  if (env.API_CONSUMER_RESET) {
    for (const binding of consumerBindings) {
      try {
        await jsm.consumers.delete(binding.stream, binding.durableName);
        logger.warn("reset jetstream consumer", { durable: binding.durableName });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("not found")) {
          logger.warn("failed to reset jetstream consumer", {
            durable: binding.durableName,
            error: message
          });
        }
      }
    }
  } else {
    for (const binding of consumerBindings) {
      try {
        const info = await jsm.consumers.info(binding.stream, binding.durableName);
        if (info?.config?.deliver_policy && info.config.deliver_policy !== env.API_DELIVER_POLICY) {
          logger.warn("resetting consumer due to deliver policy change", {
            durable: binding.durableName,
            current: info.config.deliver_policy,
            desired: env.API_DELIVER_POLICY
          });
          await jsm.consumers.delete(binding.stream, binding.durableName);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("not found")) {
          logger.warn("failed to inspect jetstream consumer", {
            durable: binding.durableName,
            error: message
          });
        }
      }
    }
  }

  const subscribeWithReset = async <T>(
    subject: string,
    stream: string,
    durableName: string
  ) => {
    const opts = buildDurableConsumer(durableName);
    applyDeliverPolicy(opts, env.API_DELIVER_POLICY);
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
      applyDeliverPolicy(resetOpts, env.API_DELIVER_POLICY);
      return await subscribeJson<T>(js, subject, resetOpts);
    }
  };

  const optionSubscription = await subscribeWithReset(
    consumerBindings[0].subject,
    consumerBindings[0].stream,
    consumerBindings[0].durableName
  );

  const optionNbboSubscription = await subscribeWithReset(
    consumerBindings[1].subject,
    consumerBindings[1].stream,
    consumerBindings[1].durableName
  );

  const equitySubscription = await subscribeWithReset(
    consumerBindings[2].subject,
    consumerBindings[2].stream,
    consumerBindings[2].durableName
  );

  const equityQuoteSubscription = await subscribeWithReset(
    consumerBindings[3].subject,
    consumerBindings[3].stream,
    consumerBindings[3].durableName
  );

  const equityCandleSubscription = await subscribeWithReset(
    consumerBindings[4].subject,
    consumerBindings[4].stream,
    consumerBindings[4].durableName
  );

  const equityJoinSubscription = await subscribeWithReset(
    consumerBindings[5].subject,
    consumerBindings[5].stream,
    consumerBindings[5].durableName
  );

  const inferredDarkSubscription = await subscribeWithReset(
    consumerBindings[6].subject,
    consumerBindings[6].stream,
    consumerBindings[6].durableName
  );

  const flowSubscription = await subscribeWithReset(
    consumerBindings[7].subject,
    consumerBindings[7].stream,
    consumerBindings[7].durableName
  );

  const classifierHitSubscription = await subscribeWithReset(
    consumerBindings[8].subject,
    consumerBindings[8].stream,
    consumerBindings[8].durableName
  );

  const alertSubscription = await subscribeWithReset(
    consumerBindings[9].subject,
    consumerBindings[9].stream,
    consumerBindings[9].durableName
  );

  const fanoutLive = async (
    subscription: LiveSubscription,
    item: unknown,
    ingestChannel: "options" | "nbbo" | "equities" | "equity-quotes" | "equity-candles" | "equity-overlay" | "equity-joins" | "flow" | "classifier-hits" | "alerts" | "inferred-dark"
  ) => {
    const watermark = await liveState.ingest(ingestChannel, item);

    if (!shouldFanoutLiveEvent(ingestChannel, item)) {
      return;
    }

    const matchingSubscriptions =
      subscription.channel === "options" || subscription.channel === "flow"
        ? [...subscriptionDefinitions.entries()].filter(([, candidate]) => candidate.channel === subscription.channel)
        : [[getSubscriptionKey(subscription), subscription] as const];

    if (matchingSubscriptions.length === 0) {
      return;
    }

    for (const [key, candidate] of matchingSubscriptions) {
      const sockets = subscriptionSockets.get(key);
      if (!sockets || sockets.size === 0) {
        continue;
      }

      if (
        candidate.channel === "options" &&
        !matchesOptionPrintFilters(OptionPrintSchema.parse(item), candidate.filters)
      ) {
        continue;
      }

      if (
        candidate.channel === "flow" &&
        !matchesFlowPacketFilters(FlowPacketSchema.parse(item), candidate.filters)
      ) {
        continue;
      }

      for (const socket of sockets) {
        sendLiveMessage(socket, {
          op: "event",
          subscription: candidate,
          item,
          watermark
        });
      }
    }
  };

  const pumpOptions = async () => {
    for await (const msg of optionSubscription.messages) {
      try {
        const payload = OptionPrintSchema.parse(optionSubscription.decode(msg));
        broadcast(optionSockets, { type: "option-print", payload });
        await fanoutLive({ channel: "options" }, payload, "options");
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
        await fanoutLive({ channel: "nbbo" }, payload, "nbbo");
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
        await fanoutLive({ channel: "equities" }, payload, "equities");
        await fanoutLive(
          { channel: "equity-overlay", underlying_id: payload.underlying_id },
          payload,
          "equity-overlay"
        );
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
        await fanoutLive({ channel: "equity-quotes" }, payload, "equity-quotes");
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
        await fanoutLive(
          {
            channel: "equity-candles",
            underlying_id: payload.underlying_id,
            interval_ms: payload.interval_ms
          },
          payload,
          "equity-candles"
        );
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
        await fanoutLive({ channel: "equity-joins" }, payload, "equity-joins");
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
        await fanoutLive({ channel: "inferred-dark" }, payload, "inferred-dark");
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
        await fanoutLive({ channel: "flow" }, payload, "flow");
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
        await fanoutLive({ channel: "classifier-hits" }, payload, "classifier-hits");
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
        await fanoutLive({ channel: "alerts" }, payload, "alerts");
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

  const server = Bun.serve<WsData | LiveWsData>({
    port: env.API_PORT,
    fetch: async (req: Request, serverRef: any) => {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }

      if (req.method === "GET" && url.pathname === "/prints/options") {
        try {
          const limit = parseLimit(url.searchParams.get("limit"));
          const source = parseReplaySource(url) ?? undefined;
          const { storageFilters } = parseOptionPrintFilters(url);
          const data = await fetchRecentOptionPrints(clickhouse, limit, source, storageFilters);
          return jsonResponse({ data });
        } catch (error) {
          return jsonResponse(
            {
              error: "invalid options query",
              detail: error instanceof Error ? error.message : String(error)
            },
            400
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/nbbo/options") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const source = parseReplaySource(url) ?? undefined;
        const data = await fetchRecentOptionNBBO(clickhouse, limit, source);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/prints/equities") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const data = await fetchRecentEquityPrints(clickhouse, limit);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/prints/equities/range") {
        try {
          const { underlyingId, startTs, endTs, limit } = parseEquityPrintRangeParams(url);
          const data = await fetchEquityPrintsRange(clickhouse, underlyingId, startTs, endTs, limit);
          return jsonResponse({ data });
        } catch (error) {
          return jsonResponse(
            {
              error: "invalid equity range query",
              detail: error instanceof Error ? error.message : String(error)
            },
            400
          );
        }
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

      if (req.method === "GET" && url.pathname === "/history/options") {
        try {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const source = parseReplaySource(url) ?? undefined;
          const { storageFilters } = parseOptionPrintFilters(url);
          const data = await fetchOptionPrintsBefore(
            clickhouse,
            beforeTs,
            beforeSeq,
            limit,
            source,
            storageFilters
          );
          return jsonResponse(buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq })));
        } catch (error) {
          return jsonResponse(
            {
              error: "invalid options history query",
              detail: error instanceof Error ? error.message : String(error)
            },
            400
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/history/nbbo") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const source = parseReplaySource(url) ?? undefined;
        const data = await fetchOptionNBBOBefore(clickhouse, beforeTs, beforeSeq, limit, source);
        return jsonResponse(buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq })));
      }

      if (req.method === "GET" && url.pathname === "/history/equities") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchEquityPrintsBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq })));
      }

      if (req.method === "GET" && url.pathname === "/history/equity-quotes") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchEquityQuotesBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq })));
      }

      if (req.method === "GET" && url.pathname === "/history/equity-joins") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchEquityPrintJoinsBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(
          buildHistoryResponse(data, (item) => ({ ts: item.source_ts, seq: item.seq }))
        );
      }

      if (req.method === "GET" && url.pathname === "/history/flow") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchFlowPacketsBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(
          buildHistoryResponse(data, (item) => ({ ts: item.source_ts, seq: item.seq }))
        );
      }

      if (req.method === "GET" && url.pathname === "/history/classifier-hits") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchClassifierHitsBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(
          buildHistoryResponse(data, (item) => ({ ts: item.source_ts, seq: item.seq }))
        );
      }

      if (req.method === "GET" && url.pathname === "/history/alerts") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchAlertsBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(
          buildHistoryResponse(data, (item) => ({ ts: item.source_ts, seq: item.seq }))
        );
      }

      if (req.method === "GET" && url.pathname === "/history/inferred-dark") {
        const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
        const data = await fetchInferredDarkBefore(clickhouse, beforeTs, beforeSeq, limit);
        return jsonResponse(
          buildHistoryResponse(data, (item) => ({ ts: item.source_ts, seq: item.seq }))
        );
      }

      if (req.method === "GET" && /^\/flow\/packets\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.slice("/flow/packets/".length));
        const data = await fetchFlowPacketById(clickhouse, id);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/option-prints/by-trace") {
        const traceIds = url.searchParams.getAll("trace_id");
        const data = await fetchOptionPrintsByTraceIds(clickhouse, traceIds);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/equity-joins/by-id") {
        const ids = url.searchParams.getAll("id");
        const data = await fetchEquityPrintJoinsByIds(clickhouse, ids);
        return jsonResponse({ data });
      }

      if (req.method === "GET" && url.pathname === "/replay/options") {
        try {
          const { afterTs, afterSeq, limit } = parseReplayParams(url);
          const source = parseReplaySource(url) ?? undefined;
          const { storageFilters } = parseOptionPrintFilters(url);
          const data = await fetchOptionPrintsAfter(
            clickhouse,
            afterTs,
            afterSeq,
            limit,
            source,
            storageFilters
          );
          const last = data.at(-1);
          const next = last ? { ts: last.ts, seq: last.seq } : null;
          return jsonResponse({ data, next });
        } catch (error) {
          return jsonResponse(
            {
              error: "invalid options replay query",
              detail: error instanceof Error ? error.message : String(error)
            },
            400
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/replay/nbbo") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const source = parseReplaySource(url) ?? undefined;
        const data = await fetchOptionNBBOAfter(clickhouse, afterTs, afterSeq, limit, source);
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

      if (req.method === "GET" && url.pathname === "/replay/flow") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchFlowPacketsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.source_ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/classifier-hits") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchClassifierHitsAfter(clickhouse, afterTs, afterSeq, limit);
        const last = data.at(-1);
        const next = last ? { ts: last.source_ts, seq: last.seq } : null;
        return jsonResponse({ data, next });
      }

      if (req.method === "GET" && url.pathname === "/replay/alerts") {
        const { afterTs, afterSeq, limit } = parseReplayParams(url);
        const data = await fetchAlertsAfter(clickhouse, afterTs, afterSeq, limit);
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

      if (req.method === "GET" && url.pathname === "/ws/live") {
        if (serverRef.upgrade(req, { data: { channel: "live" } })) {
          return new Response(null, { status: 101 });
        }

        return jsonResponse({ error: "websocket upgrade failed" }, 400);
      }

      return jsonResponse({ error: "not found" }, 404);
    },
    websocket: {
      open: (socket: any) => {
        if (socket.data.channel === "live") {
          sendLiveMessage(socket, { op: "ready" });
          const heartbeat = setInterval(() => {
            sendLiveMessage(socket, { op: "heartbeat", ts: Date.now() });
          }, 15000);
          liveHeartbeats.set(socket, heartbeat);
        } else if (socket.data.channel === "options") {
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
      message: async (socket: any, message: string | ArrayBuffer | Uint8Array) => {
        if (socket.data.channel !== "live") {
          return;
        }

        try {
          const payload =
            typeof message === "string"
              ? message
              : new TextDecoder().decode(message instanceof Uint8Array ? message : new Uint8Array(message));
          const parsed = LiveClientMessageSchema.parse(JSON.parse(payload));
          if (parsed.op === "ping") {
            sendLiveMessage(socket, { op: "heartbeat", ts: Date.now() });
            return;
          }

          for (const subscription of parsed.subscriptions) {
            LiveSubscriptionSchema.parse(subscription);
            if (parsed.op === "unsubscribe") {
              unsubscribeSocket(socket, subscription);
              continue;
            }

            subscribeSocket(socket, subscription);
            const snapshot = await liveState.getSnapshot(subscription);
            sendLiveMessage(socket, { op: "snapshot", snapshot });
          }
        } catch (error) {
          sendLiveMessage(socket, {
            op: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      },
      close: (socket: any) => {
        if (socket.data.channel === "live") {
          cleanupLiveSocket(socket);
        } else if (socket.data.channel === "options") {
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
    if (state.shutdownPromise) {
      return state.shutdownPromise;
    }

    state.shuttingDown = true;
    state.shutdownPromise = (async () => {
      logger.info("service stopping", { signal });
      server.stop();
      clearInterval(liveStateMetricsTimer);

      if (redis && redis.isOpen) {
        try {
          await redis.quit();
        } catch (error) {
          if (!isExpectedShutdownError(error)) {
            throw error;
          }
        }
      }

      try {
        await nc.drain();
      } catch (error) {
        if (!isExpectedShutdownError(error)) {
          throw error;
        }
      }

      try {
        await clickhouse.close();
      } catch (error) {
        if (!isExpectedShutdownError(error)) {
          throw error;
        }
      }

      process.exit(0);
    })();

    return state.shutdownPromise;
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

await run();
