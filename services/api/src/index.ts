import {
  buildDurableConsumer,
  connectJetStreamWithRetry,
  ensureKnownStreams,
  ensureSyntheticControlState,
  openSyntheticControlKv,
  STREAM_EQUITY_CANDLES,
  STREAM_EQUITY_JOINS,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  STREAM_FLOW_PACKETS,
  STREAM_INFERRED_DARK,
  STREAM_NEWS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_SIGNAL_PRINTS,
  STREAM_SMART_FLOW,
  STREAM_SMART_FLOW_ALERTS,
  SUBJECT_EQUITY_CANDLES,
  SUBJECT_EQUITY_JOINS,
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  SUBJECT_FLOW_PACKETS,
  SUBJECT_INFERRED_DARK,
  SUBJECT_NEWS,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_SIGNAL_PRINTS,
  SUBJECT_SMART_FLOW,
  SUBJECT_SMART_FLOW_ALERTS,
  subscribeJson,
  watchSyntheticControlState,
  writeSyntheticControlState
} from "@islandflow/bus";
import { readEnv } from "@islandflow/config";
import { createLogger, createMetrics } from "@islandflow/observability";
import type { EquityPrintQueryFilters } from "@islandflow/storage";
import {
  createClickHouseClient,
  ensureEquityCandlesTable,
  ensureEquityPrintJoinsTable,
  ensureEquityPrintsTable,
  ensureEquityQuotesTable,
  ensureFlowPacketsTable,
  ensureInferredDarkTable,
  ensureNewsTable,
  ensureOptionNBBOTable,
  ensureOptionPrintsTable,
  ensureSmartFlowAlertsTable,
  ensureSmartFlowProjectionsTable,
  fetchEquityCandlesAfter,
  fetchEquityCandlesRange,
  fetchEquityPrintJoinsAfter,
  fetchEquityPrintJoinsBefore,
  fetchEquityPrintJoinsByIds,
  fetchEquityPrintsAfter,
  fetchEquityPrintsBefore,
  fetchEquityPrintsRange,
  fetchEquityQuotesAfter,
  fetchEquityQuotesBefore,
  fetchFlowPacketById,
  fetchFlowPacketsAfter,
  fetchFlowPacketsBefore,
  fetchInferredDarkAfter,
  fetchInferredDarkBefore,
  fetchNewsAfter,
  fetchNewsBefore,
  fetchOptionNBBOAfter,
  fetchOptionNBBOBefore,
  fetchOptionPrintsAfter,
  fetchOptionPrintsBefore,
  fetchOptionPrintsByTraceIds,
  fetchRecentEquityPrintJoins,
  fetchRecentEquityPrints,
  fetchRecentEquityQuotes,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentNews,
  fetchRecentOptionNBBO,
  fetchRecentOptionPrints,
  insertNewsStory
} from "@islandflow/storage";
import {
  listDemoProfileSummaries,
  listLoadProfileSummaries,
  resolveSyntheticProfileControlState
} from "@islandflow/synthetic-market/profiles";
import {
  Cursor,
  EquityCandleSchema,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  FeedSnapshot,
  FlowPacketSchema,
  getSubscriptionKey,
  InferredDarkEventSchema,
  type LiveChannel,
  LiveClientMessageSchema,
  LiveServerMessage,
  LiveSubscription,
  LiveSubscriptionSchema,
  matchesFlowPacketFilters,
  matchesOptionPrintFilters,
  NewsStorySchema,
  normalizeSyntheticControlState,
  OptionNBBOSchema,
  type OptionPrint,
  OptionPrintSchema,
  SmartFlowAlertEventSchema,
  SmartFlowExplainabilityProjectionSchema,
  type SyntheticControlState,
  SyntheticControlStateSchema
} from "@islandflow/types";
import { createClient } from "redis";
import { z } from "zod";
import {
  createCorsPreflightResponse,
  DEFAULT_API_CORS_ORIGINS,
  parseCorsAllowedOrigins,
  withCorsHeaders
} from "./cors";
import {
  HOT_LIVE_REDIS_KEYS,
  LiveStateManager,
  resolveLiveStateConfig,
  shouldFanoutLiveEvent
} from "./live";
import {
  getOptionPrintTraceLookupErrorStatus,
  parseOptionPrintTraceLookupParams
} from "./option-print-lookup";
import { getOptionPrintQueryErrorStatus, parseOptionPrintQuery } from "./option-queries";
import { lookupOptionsSupport } from "./options-support";
import { ApiRateLimiter, buildRateLimitResponse, recordRateLimitRejection } from "./rate-limit";
import {
  fetchRecentSmartFlowExplainability,
  fetchSmartFlowExplainabilityAfter,
  fetchSmartFlowExplainabilityBefore,
  smartFlowCursor
} from "./smart-flow";
import {
  fetchRecentSmartFlowAlertEvents,
  fetchSmartFlowAlertEventsAfter,
  fetchSmartFlowAlertEventsBefore,
  smartFlowAlertCursor
} from "./smart-flow-alerts";
import { SMART_FLOW_SUPPORT_MAX_TRACE_IDS } from "./smart-flow-support-resolver";
import {
  buildSyntheticDerivedStatus,
  createRollingSyntheticProfileHits,
  getSyntheticBackendDisabledReason,
  recordSyntheticProfileHit,
  resolveSyntheticBackendMode
} from "./synthetic-control";

const service = "api";
const logger = createLogger({ service });
const metrics = createMetrics({ service });

const DeliverPolicySchema = z.enum(["new", "all", "last", "last_per_subject"]);

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  NATS_URL: z.string().default("nats://127.0.0.1:4222"),
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DATABASE: z.string().default("default"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  OPTIONS_INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  EQUITIES_INGEST_ADAPTER: z.string().min(1).default("synthetic"),
  REST_DEFAULT_LIMIT: z.coerce.number().int().positive().default(200),
  API_DELIVER_POLICY: DeliverPolicySchema.default("new"),
  API_CONSUMER_RESET: z.coerce.boolean().default(false),
  LIVE_LAG_WARN_MS: z.coerce.number().int().positive().default(120_000),
  API_RATE_LIMIT_ENABLED: z
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
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  API_RATE_LIMIT_REST_MAX: z.coerce.number().int().positive().default(1200),
  API_RATE_LIMIT_LOOKUP_MAX: z.coerce.number().int().positive().default(120),
  API_RATE_LIMIT_WS_MAX: z.coerce.number().int().positive().default(120),
  SYNTHETIC_CONTROL_ENABLED: z
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
  SYNTHETIC_ADMIN_TOKEN: z.string().default(""),
  API_CORS_ORIGINS: z.string().default(DEFAULT_API_CORS_ORIGINS)
});

const env = readEnv(envSchema);
const corsAllowedOrigins = parseCorsAllowedOrigins(env.API_CORS_ORIGINS);
const rateLimiter = new ApiRateLimiter();
const rateLimitConfig = {
  enabled: env.API_RATE_LIMIT_ENABLED,
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  restMax: env.API_RATE_LIMIT_REST_MAX,
  lookupMax: env.API_RATE_LIMIT_LOOKUP_MAX,
  wsMax: env.API_RATE_LIMIT_WS_MAX
};

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
type Channel =
  | "options"
  | "options-nbbo"
  | "equities"
  | "equity-candles"
  | "equity-quotes"
  | "equity-joins"
  | "inferred-dark"
  | "flow"
  | "smart-flow"
  | "smart-flow-alerts";

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
const smartFlowSockets = new Set<LegacySocket>();
const smartFlowAlertSockets = new Set<LegacySocket>();
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

const readJsonBody = async (req: Request): Promise<unknown> => {
  const text = await req.text();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
};

const getBearerToken = (req: Request): string => {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return req.headers.get("x-synthetic-admin-token")?.trim() ?? "";
};

const optionsSupportLookupSchema = z.object({
  trace_ids: z.array(z.string().min(1)).max(SMART_FLOW_SUPPORT_MAX_TRACE_IDS).default([]),
  nbbo_context: z
    .array(
      z.object({
        trace_id: z.string().min(1),
        option_contract_id: z.string().min(1),
        ts: z.number().int().nonnegative()
      })
    )
    .max(SMART_FLOW_SUPPORT_MAX_TRACE_IDS)
    .optional()
    .default([])
});

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
  const startTs = params.start_ts ?? Math.max(0, Math.floor(endTs - params.interval_ms * limit));
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
): {
  underlyingId: string;
  intervalMs: number;
  afterTs: number;
  afterSeq: number;
  limit: number;
} => {
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

const parseScopeList = (url: URL, ...keys: string[]): string[] | undefined => {
  const values = keys
    .flatMap((key) => url.searchParams.getAll(key))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const unique = Array.from(new Set(values));
  return unique.length > 0 ? unique : undefined;
};

const parseLiveEquityPrintFilters = (url: URL): EquityPrintQueryFilters => ({
  underlyingIds: parseScopeList(url, "underlying_id", "underlying_ids")
});

const matchesScopedOptionSubscription = (
  print: { underlying_id?: string; option_contract_id: string },
  subscription: Extract<LiveSubscription, { channel: "options" }>
): boolean => {
  if (
    subscription.option_contract_id &&
    subscription.option_contract_id !== print.option_contract_id
  ) {
    return false;
  }
  if (subscription.underlying_ids?.length) {
    const underlying = (print.underlying_id ?? "").toUpperCase();
    return subscription.underlying_ids.map((value) => value.toUpperCase()).includes(underlying);
  }
  return true;
};

const matchesScopedEquitySubscription = (
  print: { underlying_id: string },
  subscription: LiveSubscription
): boolean => {
  if (subscription.channel !== "equities") {
    return false;
  }
  if (!subscription.underlying_ids?.length) {
    return true;
  }
  const underlying = print.underlying_id.toUpperCase();
  return subscription.underlying_ids.map((value) => value.toUpperCase()).includes(underlying);
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

  await ensureKnownStreams(
    jsm,
    [
      STREAM_OPTION_SIGNAL_PRINTS,
      STREAM_OPTION_NBBO,
      STREAM_EQUITY_PRINTS,
      STREAM_EQUITY_QUOTES,
      STREAM_EQUITY_CANDLES,
      STREAM_EQUITY_JOINS,
      STREAM_INFERRED_DARK,
      STREAM_FLOW_PACKETS,
      STREAM_SMART_FLOW,
      STREAM_SMART_FLOW_ALERTS,
      STREAM_NEWS
    ],
    { logger }
  );

  const syntheticBackendMode = resolveSyntheticBackendMode(
    env.OPTIONS_INGEST_ADAPTER,
    env.EQUITIES_INGEST_ADAPTER
  );
  const syntheticBackendDisabledReason = getSyntheticBackendDisabledReason(syntheticBackendMode);
  let syntheticControl = resolveSyntheticProfileControlState(null);
  let syntheticControlKv: Awaited<ReturnType<typeof openSyntheticControlKv>> | null = null;
  let stopSyntheticControlWatch = async () => {};
  if (syntheticBackendMode === "synthetic") {
    syntheticControlKv = await openSyntheticControlKv(js);
    syntheticControl = resolveSyntheticProfileControlState(
      await ensureSyntheticControlState(syntheticControlKv)
    );
    stopSyntheticControlWatch = await watchSyntheticControlState(
      syntheticControlKv,
      (nextControl) => {
        syntheticControl = resolveSyntheticProfileControlState(nextControl);
      },
      (error) => {
        logger.warn("synthetic control watch failed", {
          error: getErrorMessage(error)
        });
      }
    );
  }
  const syntheticProfileCatalog = {
    demo_profiles: listDemoProfileSummaries(),
    load_profiles: listLoadProfileSummaries()
  };
  const syntheticProfileHits = createRollingSyntheticProfileHits();

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
    await ensureSmartFlowProjectionsTable(clickhouse);
    await ensureSmartFlowAlertsTable(clickhouse);
    await ensureNewsTable(clickhouse);
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

  const liveState = new LiveStateManager(clickhouse, redis, resolveLiveStateConfig());
  await liveState.hydrate();
  const warnLiveLag = (
    channel: keyof typeof HOT_LIVE_REDIS_KEYS,
    ageMs: number | null | undefined
  ) => {
    if (typeof ageMs !== "number" || !Number.isFinite(ageMs)) {
      return;
    }
    if (ageMs < env.LIVE_LAG_WARN_MS) {
      return;
    }
    logger.warn("live feed lag exceeded threshold", {
      channel,
      age_ms: ageMs,
      threshold_ms: env.LIVE_LAG_WARN_MS
    });
  };
  const liveStateMetricsTimer = setInterval(() => {
    const snapshot = liveState.getStatsSnapshot();
    const hotFeedHealth = liveState.getHotChannelHealth();
    const hotFeedLagMs = {
      options: snapshot.freshnessAgeMsByKey[HOT_LIVE_REDIS_KEYS.options] ?? null,
      equities: snapshot.freshnessAgeMsByKey[HOT_LIVE_REDIS_KEYS.equities] ?? null,
      flow: snapshot.freshnessAgeMsByKey[HOT_LIVE_REDIS_KEYS.flow] ?? null,
      nbbo: snapshot.freshnessAgeMsByKey[HOT_LIVE_REDIS_KEYS.nbbo] ?? null
    };
    logger.info("live cache metrics", {
      ...snapshot,
      hotFeedLagMs,
      hotFeedHealth,
      snapshotSourceCounts: {
        generic_cache_snapshot: snapshot.genericCacheSnapshots,
        scoped_clickhouse_snapshot: snapshot.scopedClickHouseSnapshots
      }
    });
    warnLiveLag("options", hotFeedLagMs.options);
    warnLiveLag("equities", hotFeedLagMs.equities);
    warnLiveLag("flow", hotFeedLagMs.flow);
    warnLiveLag("nbbo", hotFeedLagMs.nbbo);
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
      subject: SUBJECT_SMART_FLOW,
      stream: STREAM_SMART_FLOW,
      durableName: "api-smart-flow"
    },
    {
      subject: SUBJECT_SMART_FLOW_ALERTS,
      stream: STREAM_SMART_FLOW_ALERTS,
      durableName: "api-smart-flow-alerts"
    },
    {
      subject: SUBJECT_NEWS,
      stream: STREAM_NEWS,
      durableName: "api-news"
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

  const subscribeWithReset = async <T>(subject: string, stream: string, durableName: string) => {
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
        const deleteMessage =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
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

  const subscribeConsumerBinding = (
    durableName: (typeof consumerBindings)[number]["durableName"]
  ) => {
    const binding = consumerBindings.find((entry) => entry.durableName === durableName);
    if (!binding) {
      throw new Error(`Missing API consumer binding: ${durableName}`);
    }
    return subscribeWithReset(binding.subject, binding.stream, binding.durableName);
  };

  const optionSubscription = await subscribeConsumerBinding("api-option-prints");
  const optionNbboSubscription = await subscribeConsumerBinding("api-option-nbbo");
  const equitySubscription = await subscribeConsumerBinding("api-equity-prints");
  const equityQuoteSubscription = await subscribeConsumerBinding("api-equity-quotes");
  const equityCandleSubscription = await subscribeConsumerBinding("api-equity-candles");
  const equityJoinSubscription = await subscribeConsumerBinding("api-equity-joins");
  const inferredDarkSubscription = await subscribeConsumerBinding("api-inferred-dark");
  const flowSubscription = await subscribeConsumerBinding("api-flow-packets");
  const smartFlowSubscription = await subscribeConsumerBinding("api-smart-flow");
  const smartFlowAlertSubscription = await subscribeConsumerBinding("api-smart-flow-alerts");
  const newsSubscription = await subscribeConsumerBinding("api-news");

  const fanoutLive = async (
    subscription: LiveSubscription,
    item: unknown,
    ingestChannel: LiveChannel
  ) => {
    const watermark = await liveState.ingest(ingestChannel, item);

    if (!shouldFanoutLiveEvent(ingestChannel, item)) {
      return;
    }

    let matchedDurableRowSubscriptions = 0;
    const durableRowSubscriptions = [...subscriptionDefinitions.entries()].filter(
      (entry): entry is [string, Extract<LiveSubscription, { channel: "durable-rows" }>] =>
        entry[1].channel === "durable-rows"
    );
    for (const [key, candidate] of durableRowSubscriptions) {
      const sockets = subscriptionSockets.get(key);
      if (!sockets || sockets.size === 0) {
        continue;
      }
      const rows = liveState.composeDurableRowsForEvent(candidate, ingestChannel, item);
      if (rows.length === 0) {
        continue;
      }
      matchedDurableRowSubscriptions += 1;
      for (const row of rows) {
        for (const socket of sockets) {
          sendLiveMessage(socket, {
            op: "event",
            subscription: candidate,
            item: row,
            watermark: { ts: row.ts, seq: row.seq }
          });
        }
      }
    }

    const matchingSubscriptions =
      subscription.channel === "options" ||
      subscription.channel === "flow" ||
      subscription.channel === "equities"
        ? [...subscriptionDefinitions.entries()].filter(
            ([, candidate]) => candidate.channel === subscription.channel
          )
        : [[getSubscriptionKey(subscription), subscription] as const];

    if (matchingSubscriptions.length === 0) {
      if (matchedDurableRowSubscriptions > 0) {
        metrics.count(
          "api.live.durable_row_subscription_match_count",
          matchedDurableRowSubscriptions
        );
      }
      return;
    }

    const optionItem = ingestChannel === "options" ? (item as OptionPrint) : null;
    const equityItem =
      ingestChannel === "equities"
        ? (item as Parameters<typeof matchesScopedEquitySubscription>[0])
        : null;
    const flowItem =
      ingestChannel === "flow" ? (item as Parameters<typeof matchesFlowPacketFilters>[0]) : null;
    let matchedSubscriptions = 0;

    for (const [key, candidate] of matchingSubscriptions) {
      const sockets = subscriptionSockets.get(key);
      if (!sockets || sockets.size === 0) {
        continue;
      }

      if (
        candidate.channel === "options" &&
        (!optionItem ||
          !matchesOptionPrintFilters(optionItem, candidate.filters) ||
          !matchesScopedOptionSubscription(optionItem, candidate))
      ) {
        continue;
      }

      if (
        candidate.channel === "equities" &&
        (!equityItem || !matchesScopedEquitySubscription(equityItem, candidate))
      ) {
        continue;
      }

      if (
        candidate.channel === "flow" &&
        (!flowItem || !matchesFlowPacketFilters(flowItem, candidate.filters))
      ) {
        continue;
      }

      matchedSubscriptions += 1;

      for (const socket of sockets) {
        sendLiveMessage(socket, {
          op: "event",
          subscription: candidate,
          item,
          watermark
        });
      }
    }

    if (matchedSubscriptions > 0) {
      metrics.count("api.live.subscription_match_count", matchedSubscriptions);
    }
    if (matchedDurableRowSubscriptions > 0) {
      metrics.count(
        "api.live.durable_row_subscription_match_count",
        matchedDurableRowSubscriptions
      );
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

  const pumpSmartFlow = async () => {
    for await (const msg of smartFlowSubscription.messages) {
      try {
        const payload = SmartFlowExplainabilityProjectionSchema.parse(
          smartFlowSubscription.decode(msg)
        );
        recordSyntheticProfileHit(syntheticProfileHits, payload);
        broadcast(smartFlowSockets, { type: "smart-flow", payload });
        await fanoutLive({ channel: "smart-flow" }, payload, "smart-flow");
        msg.ack();
      } catch (error) {
        logger.error("failed to process smart-flow projection", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpSmartFlowAlerts = async () => {
    for await (const msg of smartFlowAlertSubscription.messages) {
      try {
        const payload = SmartFlowAlertEventSchema.parse(smartFlowAlertSubscription.decode(msg));
        broadcast(smartFlowAlertSockets, { type: "smart-flow-alert", payload });
        await fanoutLive({ channel: "smart-flow-alerts" }, payload, "smart-flow-alerts");
        msg.ack();
      } catch (error) {
        logger.error("failed to process smart-flow alert", {
          error: error instanceof Error ? error.message : String(error)
        });
        msg.term();
      }
    }
  };

  const pumpNews = async () => {
    for await (const msg of newsSubscription.messages) {
      try {
        const payload = NewsStorySchema.parse(newsSubscription.decode(msg));
        await insertNewsStory(clickhouse, payload);
        await fanoutLive({ channel: "news" }, payload, "news");
        msg.ack();
      } catch (error) {
        logger.error("failed to process news story", {
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
  void pumpSmartFlow();
  void pumpSmartFlowAlerts();
  void pumpNews();

  const buildSyntheticStatusBody = () => {
    const derived =
      syntheticBackendMode === "synthetic"
        ? buildSyntheticDerivedStatus(Date.now(), syntheticControl, syntheticProfileHits)
        : null;
    return {
      enabled: env.SYNTHETIC_CONTROL_ENABLED && syntheticBackendMode === "synthetic",
      backend_mode: syntheticBackendMode,
      adapters: {
        options: env.OPTIONS_INGEST_ADAPTER,
        equities: env.EQUITIES_INGEST_ADAPTER
      },
      control: syntheticBackendMode === "synthetic" ? syntheticControl : null,
      profiles: syntheticProfileCatalog,
      derived,
      ...(syntheticBackendDisabledReason ? { disabled_reason: syntheticBackendDisabledReason } : {})
    };
  };

  const authenticateSyntheticAdminRequest = (req: Request): Response | null => {
    if (!env.SYNTHETIC_CONTROL_ENABLED) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (!env.SYNTHETIC_ADMIN_TOKEN) {
      return jsonResponse(
        {
          error: "synthetic admin misconfigured",
          detail: "SYNTHETIC_ADMIN_TOKEN is required when synthetic control is enabled."
        },
        500
      );
    }
    if (getBearerToken(req) !== env.SYNTHETIC_ADMIN_TOKEN) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    if (syntheticBackendMode !== "synthetic") {
      return jsonResponse(
        {
          error: "synthetic backend unavailable",
          ...buildSyntheticStatusBody()
        },
        409
      );
    }
    return null;
  };

  const server = Bun.serve<WsData | LiveWsData>({
    hostname: env.API_HOST,
    port: env.API_PORT,
    fetch: async (req: Request, serverRef: any) => {
      const handleApiRequest = async (): Promise<Response> => {
        const url = new URL(req.url);

        if (req.method === "OPTIONS") {
          return createCorsPreflightResponse(req, corsAllowedOrigins);
        }

        if (req.method === "GET" && url.pathname === "/health") {
          return jsonResponse({ status: "ok" });
        }

        const socketAddress =
          typeof serverRef.requestIP === "function" ? serverRef.requestIP(req)?.address : null;
        const rateLimitDecision = rateLimiter.check(req, rateLimitConfig, socketAddress);
        if (!rateLimitDecision.allowed) {
          recordRateLimitRejection(rateLimitDecision, { logger, metrics });
          return buildRateLimitResponse(rateLimitDecision);
        }

        if (req.method === "GET" && url.pathname === "/admin/synthetic/status") {
          const authError = authenticateSyntheticAdminRequest(req);
          if (authError) {
            return authError;
          }
          return jsonResponse(buildSyntheticStatusBody());
        }

        if (req.method === "GET" && url.pathname === "/admin/synthetic/control") {
          const authError = authenticateSyntheticAdminRequest(req);
          if (authError) {
            return authError;
          }
          return jsonResponse({ control: syntheticControl });
        }

        if (req.method === "PUT" && url.pathname === "/admin/synthetic/control") {
          const authError = authenticateSyntheticAdminRequest(req);
          if (authError) {
            return authError;
          }
          if (!syntheticControlKv) {
            return jsonResponse({ error: "synthetic control unavailable" }, 500);
          }
          try {
            const rawControl = (await readJsonBody(req)) as Partial<SyntheticControlState>;
            const payload = SyntheticControlStateSchema.parse(
              resolveSyntheticProfileControlState(normalizeSyntheticControlState(rawControl))
            );
            syntheticControl = await writeSyntheticControlState(syntheticControlKv, payload);
            return jsonResponse({
              control: syntheticControl,
              derived: buildSyntheticDerivedStatus(
                Date.now(),
                syntheticControl,
                syntheticProfileHits
              )
            });
          } catch (error) {
            return jsonResponse(
              {
                error: "invalid synthetic control payload",
                detail: getErrorMessage(error)
              },
              400
            );
          }
        }

        if (req.method === "GET" && url.pathname === "/prints/options") {
          try {
            const limit = parseLimit(url.searchParams.get("limit"));
            const source = parseReplaySource(url) ?? undefined;
            const { storageFilters } = parseOptionPrintQuery(url);
            const data = await fetchRecentOptionPrints(clickhouse, limit, source, storageFilters);
            return jsonResponse({ data });
          } catch (error) {
            const status = getOptionPrintQueryErrorStatus(error);
            return jsonResponse(
              {
                error: status === 400 ? "invalid options query" : "options query failed",
                detail: error instanceof Error ? error.message : String(error)
              },
              status
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
            const data = await fetchEquityPrintsRange(
              clickhouse,
              underlyingId,
              startTs,
              endTs,
              limit
            );
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

        if (req.method === "GET" && url.pathname === "/flow/smart-flow") {
          const limit = parseLimit(url.searchParams.get("limit"));
          const data = await fetchRecentSmartFlowExplainability(clickhouse, limit);
          return jsonResponse({ data });
        }

        if (req.method === "GET" && url.pathname === "/flow/smart-flow-alerts") {
          const limit = parseLimit(url.searchParams.get("limit"));
          const data = await fetchRecentSmartFlowAlertEvents(clickhouse, limit);
          return jsonResponse({ data });
        }

        if (req.method === "GET" && url.pathname === "/news") {
          const limit = parseLimit(url.searchParams.get("limit") ?? "100");
          const data = await fetchRecentNews(clickhouse, limit);
          return jsonResponse({ data });
        }

        if (req.method === "GET" && url.pathname === "/history/options") {
          try {
            const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
            const source = parseReplaySource(url) ?? undefined;
            const { storageFilters } = parseOptionPrintQuery(url);
            const data = await fetchOptionPrintsBefore(
              clickhouse,
              beforeTs,
              beforeSeq,
              limit,
              source,
              storageFilters
            );
            return jsonResponse(
              buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq }))
            );
          } catch (error) {
            const status = getOptionPrintQueryErrorStatus(error);
            return jsonResponse(
              {
                error:
                  status === 400 ? "invalid options history query" : "options history query failed",
                detail: error instanceof Error ? error.message : String(error)
              },
              status
            );
          }
        }

        if (req.method === "GET" && url.pathname === "/history/nbbo") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const source = parseReplaySource(url) ?? undefined;
          const data = await fetchOptionNBBOBefore(clickhouse, beforeTs, beforeSeq, limit, source);
          return jsonResponse(
            buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq }))
          );
        }

        if (req.method === "GET" && url.pathname === "/history/equities") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const data = await fetchEquityPrintsBefore(
            clickhouse,
            beforeTs,
            beforeSeq,
            limit,
            parseLiveEquityPrintFilters(url)
          );
          return jsonResponse(
            buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq }))
          );
        }

        if (req.method === "GET" && url.pathname === "/history/equity-quotes") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const data = await fetchEquityQuotesBefore(clickhouse, beforeTs, beforeSeq, limit);
          return jsonResponse(
            buildHistoryResponse(data, (item) => ({ ts: item.ts, seq: item.seq }))
          );
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

        if (req.method === "GET" && url.pathname === "/history/smart-flow") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const data = await fetchSmartFlowExplainabilityBefore(
            clickhouse,
            beforeTs,
            beforeSeq,
            limit
          );
          return jsonResponse(buildHistoryResponse(data, smartFlowCursor));
        }

        if (req.method === "GET" && url.pathname === "/history/smart-flow-alerts") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const data = await fetchSmartFlowAlertEventsBefore(
            clickhouse,
            beforeTs,
            beforeSeq,
            limit
          );
          return jsonResponse(buildHistoryResponse(data, smartFlowAlertCursor));
        }

        if (req.method === "GET" && url.pathname === "/history/inferred-dark") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const data = await fetchInferredDarkBefore(clickhouse, beforeTs, beforeSeq, limit);
          return jsonResponse(
            buildHistoryResponse(data, (item) => ({ ts: item.source_ts, seq: item.seq }))
          );
        }

        if (req.method === "GET" && url.pathname === "/history/news") {
          const { beforeTs, beforeSeq, limit } = parseBeforeParams(url);
          const data = await fetchNewsBefore(clickhouse, beforeTs, beforeSeq, limit);
          return jsonResponse(
            buildHistoryResponse(data, (item) => ({ ts: item.published_ts, seq: item.seq }))
          );
        }

        if (req.method === "GET" && /^\/flow\/packets\/[^/]+$/.test(url.pathname)) {
          const id = decodeURIComponent(url.pathname.slice("/flow/packets/".length));
          const data = await fetchFlowPacketById(clickhouse, id);
          return jsonResponse({ data });
        }

        if (req.method === "GET" && url.pathname === "/option-prints/by-trace") {
          const startedAt = Date.now();
          try {
            const traceIds = parseOptionPrintTraceLookupParams(url);
            const data = await fetchOptionPrintsByTraceIds(clickhouse, traceIds);
            metrics.timing("api.option_prints.by_trace_ms", Date.now() - startedAt, {
              status: "ok",
              result: data.length > 0 ? "hit" : "miss"
            });
            return jsonResponse({ data });
          } catch (error) {
            const status = getOptionPrintTraceLookupErrorStatus(error);
            metrics.timing("api.option_prints.by_trace_ms", Date.now() - startedAt, {
              status: status === 400 ? "invalid" : "error"
            });
            return jsonResponse(
              {
                error:
                  status === 400
                    ? "invalid option print trace lookup"
                    : "option print trace lookup failed",
                detail: getErrorMessage(error)
              },
              status
            );
          }
        }

        if (req.method === "POST" && url.pathname === "/lookup/options-support") {
          const startedAt = Date.now();
          try {
            const body = optionsSupportLookupSchema.parse(await readJsonBody(req));
            const payload = await lookupOptionsSupport(clickhouse, body);
            metrics.timing("api.lookup.options_support_ms", Date.now() - startedAt, {
              status: "ok",
              trace_id_count: String(body.trace_ids.length),
              nbbo_context_count: String(body.nbbo_context.length)
            });
            return jsonResponse(payload);
          } catch (error) {
            metrics.timing("api.lookup.options_support_ms", Date.now() - startedAt, {
              status: error instanceof z.ZodError ? "invalid" : "error"
            });
            return jsonResponse(
              {
                error: "invalid options support lookup",
                detail: error instanceof Error ? error.message : String(error)
              },
              400
            );
          }
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
            const { storageFilters } = parseOptionPrintQuery(url);
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
            const status = getOptionPrintQueryErrorStatus(error);
            return jsonResponse(
              {
                error:
                  status === 400 ? "invalid options replay query" : "options replay query failed",
                detail: error instanceof Error ? error.message : String(error)
              },
              status
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

        if (req.method === "GET" && url.pathname === "/replay/smart-flow") {
          const { afterTs, afterSeq, limit } = parseReplayParams(url);
          const data = await fetchSmartFlowExplainabilityAfter(
            clickhouse,
            afterTs,
            afterSeq,
            limit
          );
          const last = data.at(-1);
          const next = last ? smartFlowCursor(last) : null;
          return jsonResponse({ data, next });
        }

        if (req.method === "GET" && url.pathname === "/replay/smart-flow-alerts") {
          const { afterTs, afterSeq, limit } = parseReplayParams(url);
          const data = await fetchSmartFlowAlertEventsAfter(clickhouse, afterTs, afterSeq, limit);
          const last = data.at(-1);
          const next = last ? smartFlowAlertCursor(last) : null;
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

        if (req.method === "GET" && url.pathname === "/ws/smart-flow") {
          if (serverRef.upgrade(req, { data: { channel: "smart-flow" } })) {
            return new Response(null, { status: 101 });
          }

          return jsonResponse({ error: "websocket upgrade failed" }, 400);
        }

        if (req.method === "GET" && url.pathname === "/ws/smart-flow-alerts") {
          if (serverRef.upgrade(req, { data: { channel: "smart-flow-alerts" } })) {
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
      };

      const response = await handleApiRequest();
      return withCorsHeaders(req, response, corsAllowedOrigins);
    },
    websocket: {
      open: (socket: any) => {
        if (socket.data.channel === "live") {
          sendLiveMessage(socket, { op: "ready", channel_health: liveState.getHotChannelHealth() });
          const heartbeat = setInterval(() => {
            sendLiveMessage(socket, {
              op: "heartbeat",
              ts: Date.now(),
              channel_health: liveState.getHotChannelHealth()
            });
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
        } else if (socket.data.channel === "smart-flow") {
          smartFlowSockets.add(socket);
        } else if (socket.data.channel === "smart-flow-alerts") {
          smartFlowAlertSockets.add(socket);
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
              : new TextDecoder().decode(
                  message instanceof Uint8Array ? message : new Uint8Array(message)
                );
          const parsed = LiveClientMessageSchema.parse(JSON.parse(payload));
          if (parsed.op === "ping") {
            sendLiveMessage(socket, {
              op: "heartbeat",
              ts: Date.now(),
              channel_health: liveState.getHotChannelHealth()
            });
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
        } else if (socket.data.channel === "smart-flow") {
          smartFlowSockets.delete(socket);
        } else if (socket.data.channel === "smart-flow-alerts") {
          smartFlowAlertSockets.delete(socket);
        }

        logger.info("websocket disconnected", { channel: socket.data.channel });
      }
    }
  });

  logger.info("api listening", { host: env.API_HOST, port: server.port });

  const shutdown = async (signal: string) => {
    if (state.shutdownPromise) {
      return state.shutdownPromise;
    }

    state.shuttingDown = true;
    state.shutdownPromise = (async () => {
      logger.info("service stopping", { signal });
      server.stop();
      clearInterval(liveStateMetricsTimer);
      await stopSyntheticControlWatch();
      await liveState.close();

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
