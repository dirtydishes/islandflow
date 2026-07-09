import { createMetrics } from "@islandflow/observability";
import type { EquityPrintQueryFilters, OptionPrintQueryFilters } from "@islandflow/storage";
import {
  type ClickHouseClient,
  fetchRecentEquityCandles,
  fetchRecentEquityPrintJoins,
  fetchRecentEquityPrints,
  fetchRecentEquityQuotes,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentNews,
  fetchRecentOptionNBBO,
  fetchRecentOptionPrints
} from "@islandflow/storage";
import {
  type Cursor,
  CursorSchema,
  type EquityCandle,
  EquityCandleSchema,
  type EquityPrint,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  FeedSnapshot,
  FlowPacketSchema,
  InferredDarkEventSchema,
  type LiveChannel,
  LiveChannelHealth,
  LiveGenericChannel,
  LiveHotChannel,
  LiveHotChannelHealthMap,
  LiveSubscription,
  matchesFlowPacketFilters,
  matchesOptionPrintFilters,
  type NewsStory,
  NewsStorySchema,
  OptionNBBOSchema,
  type OptionPrint,
  OptionPrintSchema,
  SmartFlowAlertEventSchema,
  SmartFlowExplainabilityProjectionSchema
} from "@islandflow/types";
import type { RedisClientType } from "redis";
import {
  composeDurableRowSnapshot,
  composeDurableRowsForEvent,
  type DurableRowCompositionContext,
  type DurableRowsSubscription,
  selectDurableOptionSnapshotPrints,
  wantsDurableOptionRows
} from "./durable-rows";
import { fetchRecentSmartFlowExplainability, smartFlowCursor } from "./smart-flow";
import {
  fetchRecentSmartFlowAlertEvents,
  shouldSurfaceSmartFlowAlert,
  smartFlowAlertCursor
} from "./smart-flow-alerts";
import {
  createSmartFlowSupportResolver,
  SMART_FLOW_SUPPORT_MAX_TRACE_IDS,
  type SmartFlowSupportResolver
} from "./smart-flow-support-resolver";

const CURSOR_HASH_KEY = "live:cursors";
export const LIVE_FEED_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const metrics = createMetrics({ service: "api" });

const DEFAULT_GENERIC_LIMIT = 1000;
const MAX_GENERIC_LIMIT = 100000;
const MIN_GENERIC_LIMIT = 1;
const GENERIC_LIMIT_ENV_KEYS: Record<LiveGenericChannel, string> = {
  options: "LIVE_LIMIT_OPTIONS",
  nbbo: "LIVE_LIMIT_NBBO",
  equities: "LIVE_LIMIT_EQUITIES",
  "equity-quotes": "LIVE_LIMIT_EQUITY_QUOTES",
  "equity-joins": "LIVE_LIMIT_EQUITY_JOINS",
  flow: "LIVE_LIMIT_FLOW",
  "smart-flow": "LIVE_LIMIT_SMART_FLOW",
  "smart-flow-alerts": "LIVE_LIMIT_SMART_FLOW_ALERTS",
  "inferred-dark": "LIVE_LIMIT_INFERRED_DARK",
  news: "LIVE_LIMIT_NEWS"
};

const CHART_LIMITS = {
  candles: 500,
  overlay: 1500
} as const;

const DEFAULT_LIVE_LIMITS: GenericLiveLimits = {
  options: 100,
  nbbo: 1000,
  equities: 1000,
  "equity-quotes": 500,
  "equity-joins": 500,
  flow: 500,
  "smart-flow": 300,
  "smart-flow-alerts": 300,
  "inferred-dark": 300,
  news: 100
};

const DEFAULT_SCOPED_CACHE_MAX_KEYS = 32;
const DEFAULT_REDIS_FLUSH_INTERVAL_MS = 250;
const DEFAULT_REDIS_FLUSH_MAX_ITEMS = 100;

type GenericFeedConfig = {
  redisKey: string;
  cursorField: string;
  limit: number;
  parse: (value: unknown) => any;
  include?: (item: any) => boolean;
  cursor: (item: any) => Cursor;
  identity?: (item: any) => string;
  fetchRecent: (clickhouse: ClickHouseClient, limit: number) => Promise<any[]>;
};

export const LIVE_FRESHNESS_THRESHOLDS: Partial<Record<LiveGenericChannel, number>> = {
  options: 15_000,
  nbbo: 15_000,
  equities: 15_000,
  "equity-quotes": 15_000,
  flow: 30_000
};

export const HOT_LIVE_REDIS_KEYS = {
  options: "live:options",
  equities: "live:equities",
  flow: "live:flow",
  nbbo: "live:nbbo"
} as const satisfies Record<LiveHotChannel, string>;

export type GenericLiveLimits = Record<LiveGenericChannel, number>;

type LiveStateConfig = {
  limits: GenericLiveLimits;
  scopedCacheMaxKeys: number;
  redisFlushIntervalMs: number;
  redisFlushMaxItems: number;
};

const parseGenericLimit = (
  env: NodeJS.ProcessEnv,
  channel: LiveGenericChannel,
  fallback: number
): number => {
  const key = GENERIC_LIMIT_ENV_KEYS[channel];
  const raw = env[key];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`Invalid ${key}="${raw}", using ${fallback}`);
    return fallback;
  }

  const bounded = Math.max(MIN_GENERIC_LIMIT, Math.min(MAX_GENERIC_LIMIT, Math.floor(parsed)));
  if (bounded !== parsed) {
    console.warn(`Clamped ${key} from ${parsed} to ${bounded}`);
  }
  return bounded;
};

const parseGenericLimitFallback = (env: NodeJS.ProcessEnv, fallback: number): number => {
  const raw = env.LIVE_LIMIT_DEFAULT;
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`Invalid LIVE_LIMIT_DEFAULT="${raw}", using ${fallback}`);
    return fallback;
  }

  return Math.max(MIN_GENERIC_LIMIT, Math.min(MAX_GENERIC_LIMIT, Math.floor(parsed)));
};

export const resolveGenericLiveLimits = (
  env: NodeJS.ProcessEnv = process.env
): GenericLiveLimits => {
  const liveLimitDefault = parseGenericLimitFallback(env, DEFAULT_GENERIC_LIMIT);
  return {
    options: parseGenericLimit(
      env,
      "options",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS.options
    ),
    nbbo: parseGenericLimit(
      env,
      "nbbo",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS.nbbo
    ),
    equities: parseGenericLimit(
      env,
      "equities",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS.equities
    ),
    "equity-quotes": parseGenericLimit(
      env,
      "equity-quotes",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["equity-quotes"]
    ),
    "equity-joins": parseGenericLimit(
      env,
      "equity-joins",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["equity-joins"]
    ),
    flow: parseGenericLimit(
      env,
      "flow",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS.flow
    ),
    "smart-flow": parseGenericLimit(
      env,
      "smart-flow",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["smart-flow"]
    ),
    "smart-flow-alerts": parseGenericLimit(
      env,
      "smart-flow-alerts",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["smart-flow-alerts"]
    ),
    "inferred-dark": parseGenericLimit(
      env,
      "inferred-dark",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["inferred-dark"]
    ),
    news: parseGenericLimit(
      env,
      "news",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS.news
    )
  };
};

const extractFreshnessTs = (channel: LiveGenericChannel, item: any): number | null => {
  switch (channel) {
    case "options":
    case "nbbo":
    case "equities":
    case "equity-quotes":
      return typeof item.ts === "number" ? item.ts : null;
    case "flow":
    case "smart-flow":
    case "smart-flow-alerts":
    case "inferred-dark":
      return typeof item.source_ts === "number" ? item.source_ts : null;
    case "news":
      return typeof item.published_ts === "number" ? item.published_ts : null;
    default:
      return null;
  }
};

export const resolveLiveStateConfig = (env: NodeJS.ProcessEnv = process.env): LiveStateConfig => ({
  limits: resolveGenericLiveLimits(env),
  scopedCacheMaxKeys: parsePositiveInt(
    env.LIVE_SCOPED_CACHE_MAX_KEYS,
    DEFAULT_SCOPED_CACHE_MAX_KEYS
  ),
  redisFlushIntervalMs: parsePositiveInt(
    env.LIVE_REDIS_FLUSH_INTERVAL_MS,
    DEFAULT_REDIS_FLUSH_INTERVAL_MS
  ),
  redisFlushMaxItems: parsePositiveInt(
    env.LIVE_REDIS_FLUSH_MAX_ITEMS,
    DEFAULT_REDIS_FLUSH_MAX_ITEMS
  )
});
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
};

type RedisLike = Pick<RedisClientType, "isOpen" | "lRange" | "lPush" | "lTrim" | "hGet" | "hSet">;

const parseCursor = (value: string | null): Cursor | null => {
  if (!value) {
    return null;
  }

  try {
    return CursorSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
};

const parseNativeSmartFlowProjection = (value: unknown) => {
  const projection = SmartFlowExplainabilityProjectionSchema.parse(value);
  if (projection.source_channel !== "smart-flow") {
    throw new Error("cached smart-flow projection is not native");
  }
  return projection;
};

const getGenericConfig = (
  limits: GenericLiveLimits
): {
  [K in LiveGenericChannel]: GenericFeedConfig;
} => ({
  options: {
    redisKey: "live:options",
    cursorField: "options",
    limit: limits.options,
    parse: (value) => OptionPrintSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: (clickhouse, limit) =>
      fetchRecentOptionPrints(clickhouse, limit, undefined, { view: "signal" })
  },
  nbbo: {
    redisKey: "live:nbbo",
    cursorField: "nbbo",
    limit: limits.nbbo,
    parse: (value) => OptionNBBOSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: fetchRecentOptionNBBO
  },
  equities: {
    redisKey: "live:equities",
    cursorField: "equities",
    limit: limits.equities,
    parse: (value) => EquityPrintSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: fetchRecentEquityPrints
  },
  "equity-quotes": {
    redisKey: "live:equity-quotes",
    cursorField: "equity-quotes",
    limit: limits["equity-quotes"],
    parse: (value) => EquityQuoteSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: fetchRecentEquityQuotes
  },
  "equity-joins": {
    redisKey: "live:equity-joins",
    cursorField: "equity-joins",
    limit: limits["equity-joins"],
    parse: (value) => EquityPrintJoinSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentEquityPrintJoins
  },
  flow: {
    redisKey: "live:flow",
    cursorField: "flow",
    limit: limits.flow,
    parse: (value) => FlowPacketSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentFlowPackets
  },
  "smart-flow": {
    redisKey: "live:smart-flow",
    cursorField: "smart-flow",
    limit: limits["smart-flow"],
    parse: parseNativeSmartFlowProjection,
    cursor: smartFlowCursor,
    fetchRecent: fetchRecentSmartFlowExplainability
  },
  "smart-flow-alerts": {
    redisKey: "live:smart-flow-alerts",
    cursorField: "smart-flow-alerts",
    limit: limits["smart-flow-alerts"],
    parse: (value) => SmartFlowAlertEventSchema.parse(value),
    include: shouldSurfaceSmartFlowAlert,
    cursor: smartFlowAlertCursor,
    identity: (item) => item.alert_id,
    fetchRecent: fetchRecentSmartFlowAlertEvents
  },
  "inferred-dark": {
    redisKey: "live:inferred-dark",
    cursorField: "inferred-dark",
    limit: limits["inferred-dark"],
    parse: (value) => InferredDarkEventSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentInferredDark
  },
  news: {
    redisKey: "live:news",
    cursorField: "news",
    limit: limits.news,
    parse: (value) => NewsStorySchema.parse(value),
    cursor: (item) => ({ ts: item.published_ts, seq: item.seq }),
    fetchRecent: fetchRecentNews
  }
});

const parseJsonList = <T>(payloads: string[], parse: (value: unknown) => T): T[] => {
  const items: T[] = [];
  for (const payload of payloads) {
    try {
      items.push(parse(JSON.parse(payload)));
    } catch {
      // ignore bad cache entries
    }
  }
  return items;
};

const isRedisClientClosedError = (error: unknown): boolean =>
  error instanceof Error && /client is closed/i.test(error.message);

const compareCursors = (a: Cursor, b: Cursor): number => b.ts - a.ts || b.seq - a.seq;

const sortGenericItems = <T>(items: T[], cursorOf: (item: T) => Cursor): T[] =>
  [...items].sort((a, b) => compareCursors(cursorOf(a), cursorOf(b)));

const cursorIdentity = <T>(item: T, cursorOf: (item: T) => Cursor): string => {
  const cursor = cursorOf(item);
  return `${cursor.ts}:${cursor.seq}`;
};

const keepNewestNbboByContract = <T extends { option_contract_id: string }>(
  items: T[],
  cursorOf: (item: T) => Cursor,
  limit: number
): T[] => {
  const latestByContract = new Map<string, T>();

  for (const item of items) {
    const existing = latestByContract.get(item.option_contract_id);
    if (!existing || compareCursors(cursorOf(item), cursorOf(existing)) < 0) {
      latestByContract.set(item.option_contract_id, item);
    }
  }

  return sortGenericItems(Array.from(latestByContract.values()), cursorOf).slice(0, limit);
};

const dedupeGenericItems = <T>(
  items: T[],
  cursorOf: (item: T) => Cursor,
  identityOf?: (item: T) => string
): T[] => {
  const deduped = new Map<string, T>();

  for (const item of items) {
    deduped.set(identityOf?.(item) ?? cursorIdentity(item, cursorOf), item);
  }

  return Array.from(deduped.values());
};

const normalizeGenericItems = <T>(
  channel: LiveGenericChannel,
  items: T[],
  config: GenericFeedConfig
): T[] => {
  if (channel === "nbbo") {
    return keepNewestNbboByContract(
      items as Array<T & { option_contract_id: string }>,
      config.cursor,
      config.limit
    );
  }

  return sortGenericItems(
    dedupeGenericItems(items, config.cursor, config.identity),
    config.cursor
  ).slice(0, config.limit);
};

const isWithinLiveFeedLookback = (
  channel: LiveGenericChannel,
  item: unknown,
  now = Date.now()
): boolean => {
  const ts = extractFreshnessTs(channel, item);
  return ts !== null && now - ts <= LIVE_FEED_LOOKBACK_MS;
};

export const isLiveItemFresh = (
  channel: LiveGenericChannel,
  item: unknown,
  now = Date.now()
): boolean => {
  const thresholdMs = LIVE_FRESHNESS_THRESHOLDS[channel];
  if (!thresholdMs) {
    return true;
  }
  const ts = extractFreshnessTs(channel, item);
  if (ts === null) {
    return false;
  }
  return now - ts <= thresholdMs;
};

export const shouldFanoutLiveEvent = (channel: LiveChannel, item: unknown): boolean => {
  if (channel === "equity-candles" || channel === "equity-overlay") {
    return true;
  }
  if (channel === "durable-rows") {
    return true;
  }
  return isWithinLiveFeedLookback(channel, item);
};

const nextBeforeForItems = <T>(items: T[], cursorOf: (item: T) => Cursor): Cursor | null => {
  const last = items.at(-1);
  return last ? cursorOf(last) : null;
};

const snapshotLimitFor = (subscription: LiveSubscription, configuredLimit: number): number => {
  const requested = "snapshot_limit" in subscription ? subscription.snapshot_limit : undefined;
  if (!requested) {
    return configuredLimit;
  }
  return Math.max(1, Math.min(configuredLimit, Math.floor(requested)));
};

export const buildOptionSnapshotFilters = (
  subscription: Extract<LiveSubscription, { channel: "options" }>
): OptionPrintQueryFilters => {
  if (subscription.option_contract_id) {
    return {
      view: "raw",
      optionContractId: subscription.option_contract_id
    };
  }

  return {
    view: subscription.filters?.view ?? "signal",
    security:
      subscription.filters?.securityTypes?.length === 1
        ? subscription.filters.securityTypes[0]
        : "all",
    nbboSides: subscription.filters?.nbboSides,
    optionTypes: subscription.filters?.optionTypes,
    minNotional: subscription.filters?.minNotional,
    underlyingIds: subscription.underlying_ids,
    optionContractId: subscription.option_contract_id
  };
};

const matchesScopedOptionSnapshot = (
  item: OptionPrint,
  subscription: Extract<LiveSubscription, { channel: "options" }>
): boolean => {
  if (!matchesOptionPrintFilters(item, subscription.filters)) {
    return false;
  }

  if (
    subscription.option_contract_id &&
    item.option_contract_id !== subscription.option_contract_id
  ) {
    return false;
  }

  if (!subscription.underlying_ids?.length) {
    return true;
  }

  const allowed = new Set(subscription.underlying_ids.map((value) => value.toUpperCase()));
  return item.underlying_id ? allowed.has(item.underlying_id.toUpperCase()) : false;
};

const matchesScopedEquitySnapshot = (
  item: EquityPrint,
  subscription: Extract<LiveSubscription, { channel: "equities" }>
): boolean => {
  if (!subscription.underlying_ids?.length) {
    return true;
  }

  const allowed = new Set(subscription.underlying_ids.map((value) => value.toUpperCase()));
  return allowed.has(item.underlying_id.toUpperCase());
};

const mergeSnapshotBackfill = <T>(
  cached: T[],
  backfill: T[],
  limit: number,
  cursorOf: (item: T) => Cursor
): T[] => {
  const deduped = new Map<string, T>();

  for (const item of [...cached, ...backfill]) {
    const cursor = cursorOf(item);
    deduped.set(`${cursor.ts}:${cursor.seq}`, item);
  }

  return sortGenericItems(Array.from(deduped.values()), cursorOf).slice(0, limit);
};

const candleRedisKey = (underlyingId: string, intervalMs: number): string =>
  `live:equity-candles:${underlyingId}:${intervalMs}`;

const candleCursorField = (underlyingId: string, intervalMs: number): string =>
  `equity-candles:${underlyingId}:${intervalMs}`;

const overlayRedisKey = (underlyingId: string): string => `live:equity-overlay:${underlyingId}`;
const overlayCursorField = (underlyingId: string): string => `equities:${underlyingId}`;

const insertNewestFirst = <T>(
  items: T[],
  item: T,
  cursorOf: (item: T) => Cursor,
  limit: number,
  identityOf?: (item: T) => string
): { items: T[]; outOfOrder: boolean } => {
  const cursor = cursorOf(item);
  const identity = identityOf?.(item) ?? cursorIdentity(item, cursorOf);
  const deduped = items.filter(
    (entry) => (identityOf?.(entry) ?? cursorIdentity(entry, cursorOf)) !== identity
  );
  const head = deduped[0];
  const outOfOrder = head ? compareCursors(cursor, cursorOf(head)) > 0 : false;

  if (!outOfOrder) {
    return {
      items: [item, ...deduped].slice(0, limit),
      outOfOrder: false
    };
  }

  return {
    items: sortGenericItems([...deduped, item], cursorOf).slice(0, limit),
    outOfOrder: true
  };
};

type BufferedRedisWrite = {
  listKey: string;
  cursorField: string;
  items: unknown[];
  limit: number;
  cursor: Cursor | null;
  updates: number;
};

const isLiveStateConfig = (value: GenericLiveLimits | LiveStateConfig): value is LiveStateConfig =>
  "limits" in value;

export class LiveStateManager {
  private readonly config: LiveStateConfig;
  private readonly generic: {
    [K in LiveGenericChannel]: GenericFeedConfig;
  };
  private readonly genericItems = new Map<LiveGenericChannel, any[]>();
  private readonly genericCursors = new Map<string, Cursor | null>();
  private readonly candleItems = new Map<string, EquityCandle[]>();
  private readonly candleCursors = new Map<string, Cursor | null>();
  private readonly candleAccess = new Map<string, number>();
  private readonly overlayItems = new Map<string, EquityPrint[]>();
  private readonly overlayCursors = new Map<string, Cursor | null>();
  private readonly overlayAccess = new Map<string, number>();
  private readonly pendingRedisWrites = new Map<string, BufferedRedisWrite>();
  private redisFlushAgain = false;
  private redisFlushPromise: Promise<void> | null = null;
  private readonly smartFlowSupportResolver: SmartFlowSupportResolver;
  private readonly redisFlushTimer: ReturnType<typeof setInterval> | null;
  private readonly stats = {
    genericHydrateFromRedis: 0,
    genericHydrateFromClickHouse: 0,
    genericCacheSnapshots: 0,
    scopedClickHouseSnapshots: 0,
    trimOperations: 0,
    redisFlushCount: 0,
    redisFlushItems: 0,
    cacheEvictions: 0,
    outOfOrderEvents: 0,
    cacheDepthByKey: new Map<string, number>(),
    freshnessAgeMsByKey: new Map<string, number>()
  };

  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly redis: RedisLike | null,
    config: GenericLiveLimits | LiveStateConfig = resolveLiveStateConfig()
  ) {
    this.config = isLiveStateConfig(config)
      ? config
      : {
          limits: config,
          scopedCacheMaxKeys: DEFAULT_SCOPED_CACHE_MAX_KEYS,
          redisFlushIntervalMs: DEFAULT_REDIS_FLUSH_INTERVAL_MS,
          redisFlushMaxItems: DEFAULT_REDIS_FLUSH_MAX_ITEMS
        };
    this.generic = getGenericConfig(this.config.limits);
    this.smartFlowSupportResolver = createSmartFlowSupportResolver();
    this.redisFlushTimer =
      this.redis && this.redis.isOpen
        ? setInterval(() => {
            void this.flushRedisWrites();
          }, this.config.redisFlushIntervalMs)
        : null;
    this.redisFlushTimer?.unref?.();
  }

  async close(): Promise<void> {
    if (this.redisFlushTimer) {
      clearInterval(this.redisFlushTimer);
    }
    await this.flushRedisWrites();
  }

  getStatsSnapshot(): {
    genericHydrateFromRedis: number;
    genericHydrateFromClickHouse: number;
    genericCacheSnapshots: number;
    scopedClickHouseSnapshots: number;
    trimOperations: number;
    redisFlushCount: number;
    redisFlushItems: number;
    cacheEvictions: number;
    outOfOrderEvents: number;
    cacheDepthByKey: Record<string, number>;
    freshnessAgeMsByKey: Record<string, number>;
  } {
    return {
      genericHydrateFromRedis: this.stats.genericHydrateFromRedis,
      genericHydrateFromClickHouse: this.stats.genericHydrateFromClickHouse,
      genericCacheSnapshots: this.stats.genericCacheSnapshots,
      scopedClickHouseSnapshots: this.stats.scopedClickHouseSnapshots,
      trimOperations: this.stats.trimOperations,
      redisFlushCount: this.stats.redisFlushCount,
      redisFlushItems: this.stats.redisFlushItems,
      cacheEvictions: this.stats.cacheEvictions,
      outOfOrderEvents: this.stats.outOfOrderEvents,
      cacheDepthByKey: Object.fromEntries(this.stats.cacheDepthByKey),
      freshnessAgeMsByKey: Object.fromEntries(this.stats.freshnessAgeMsByKey)
    };
  }

  getHotChannelHealth(): LiveHotChannelHealthMap {
    return {
      options: this.getChannelHealth("options"),
      nbbo: this.getChannelHealth("nbbo"),
      equities: this.getChannelHealth("equities"),
      flow: this.getChannelHealth("flow")
    };
  }

  getCachedGenericItems(
    channel: LiveGenericChannel,
    limit = this.config.limits[channel]
  ): unknown[] {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), this.config.limits[channel]));
    return (this.genericItems.get(channel) ?? []).slice(0, safeLimit);
  }

  private getDurableRowCompositionContext(): DurableRowCompositionContext {
    return {
      alerts: (this.genericItems.get("smart-flow-alerts") ??
        []) as DurableRowCompositionContext["alerts"],
      flowPackets: (this.genericItems.get("flow") ??
        []) as DurableRowCompositionContext["flowPackets"],
      optionPrints: (this.genericItems.get("options") ??
        []) as DurableRowCompositionContext["optionPrints"],
      nbbo: (this.genericItems.get("nbbo") ?? []) as DurableRowCompositionContext["nbbo"],
      smartFlowProjections: (this.genericItems.get("smart-flow") ??
        []) as DurableRowCompositionContext["smartFlowProjections"]
    };
  }

  private durableRowsConfiguredLimit(): number {
    return Math.max(this.config.limits.options, this.config.limits["smart-flow-alerts"]);
  }

  private async getDurableRowSnapshot(
    subscription: DurableRowsSubscription
  ): Promise<FeedSnapshot<unknown>> {
    const context = this.getDurableRowCompositionContext();
    if (!wantsDurableOptionRows(subscription)) {
      return composeDurableRowSnapshot(subscription, context, this.durableRowsConfiguredLimit());
    }

    const optionPrints = selectDurableOptionSnapshotPrints(
      subscription,
      context,
      this.durableRowsConfiguredLimit(),
      SMART_FLOW_SUPPORT_MAX_TRACE_IDS
    );
    const smartFlowSupport = await this.smartFlowSupportResolver.resolve(this.clickhouse, {
      optionTraceIds: optionPrints.map((print) => print.trace_id),
      hotPackets: context.flowPackets,
      hotSmartFlowProjections: context.smartFlowProjections,
      allowStorageFallback: true
    });
    return composeDurableRowSnapshot(
      subscription,
      {
        ...context,
        optionPrints,
        smartFlowSupportByTraceId: smartFlowSupport.supportByTraceId
      },
      this.durableRowsConfiguredLimit()
    );
  }

  composeDurableRowsForEvent(
    subscription: DurableRowsSubscription,
    channel: LiveChannel,
    item: unknown
  ) {
    return composeDurableRowsForEvent(
      subscription,
      channel,
      item,
      this.getDurableRowCompositionContext(),
      this.durableRowsConfiguredLimit()
    );
  }

  async flushRedisWrites(): Promise<void> {
    if (!this.redis?.isOpen) {
      return;
    }
    if (this.redisFlushPromise) {
      this.redisFlushAgain = true;
      return this.redisFlushPromise;
    }

    this.redisFlushPromise = this.drainRedisWrites();
    try {
      return await this.redisFlushPromise;
    } finally {
      this.redisFlushPromise = null;
    }
  }

  private async drainRedisWrites(): Promise<void> {
    do {
      this.redisFlushAgain = false;
      const writes = Array.from(this.pendingRedisWrites.values());
      this.pendingRedisWrites.clear();

      for (const write of writes) {
        await this.persistList(
          write.listKey,
          write.cursorField,
          write.items,
          write.limit,
          write.cursor
        );
        this.stats.redisFlushCount += 1;
        this.stats.redisFlushItems += write.items.length;
        metrics.count("api.live.redis_flush_count", 1);
        metrics.count("api.live.redis_flush_items", write.items.length);
      }
    } while (this.redisFlushAgain || this.pendingRedisWrites.size > 0);
  }

  private getChannelHealth(channel: LiveHotChannel): LiveChannelHealth {
    const listKey = HOT_LIVE_REDIS_KEYS[channel];
    const thresholdMs = LIVE_FRESHNESS_THRESHOLDS[channel];
    const freshnessAgeMs = this.stats.freshnessAgeMsByKey.get(listKey) ?? null;
    return {
      freshness_age_ms: freshnessAgeMs,
      healthy:
        freshnessAgeMs !== null &&
        typeof thresholdMs === "number" &&
        Number.isFinite(freshnessAgeMs) &&
        freshnessAgeMs <= thresholdMs
    };
  }

  private touchAccess(accessMap: Map<string, number>, key: string): void {
    accessMap.set(key, Date.now());
  }

  private evictScopedCachesIfNeeded(
    itemsMap: Map<string, unknown[]>,
    cursorsMap: Map<string, Cursor | null>,
    accessMap: Map<string, number>
  ): void {
    while (itemsMap.size > this.config.scopedCacheMaxKeys) {
      const oldest = [...accessMap.entries()].sort((a, b) => a[1] - b[1])[0];
      if (!oldest) {
        break;
      }
      const [key] = oldest;
      itemsMap.delete(key);
      cursorsMap.delete(
        key.startsWith("live:equity-candles:")
          ? key.replace("live:", "")
          : key.replace("live:equity-overlay:", "equities:")
      );
      accessMap.delete(key);
      this.stats.cacheDepthByKey.delete(key);
      this.stats.cacheEvictions += 1;
      metrics.count("api.live.cache_evictions", 1);
    }
  }

  private updateFreshnessMetric(
    listKey: string,
    channel: LiveChannel,
    item: unknown,
    now = Date.now()
  ): void {
    const ts =
      channel === "equity-candles" || channel === "equity-overlay" || channel === "durable-rows"
        ? typeof (item as { ts?: unknown })?.ts === "number"
          ? ((item as { ts: number }).ts as number)
          : null
        : extractFreshnessTs(channel, item);

    if (typeof ts === "number" && Number.isFinite(ts)) {
      this.stats.freshnessAgeMsByKey.set(listKey, Math.max(0, now - ts));
    }
  }

  private queueRedisWrite(
    listKey: string,
    cursorField: string,
    items: unknown[],
    limit: number,
    cursor: Cursor | null
  ): void {
    if (!this.redis?.isOpen) {
      return;
    }

    const existing = this.pendingRedisWrites.get(listKey);
    const write: BufferedRedisWrite = {
      listKey,
      cursorField,
      items: [...items],
      limit,
      cursor,
      updates: (existing?.updates ?? 0) + 1
    };
    this.pendingRedisWrites.set(listKey, write);
    if (write.updates >= this.config.redisFlushMaxItems) {
      void this.flushRedisWrites();
    }
  }

  async hydrate(): Promise<void> {
    const channels = Object.keys(this.generic) as LiveGenericChannel[];
    await Promise.all(channels.map((channel) => this.hydrateGeneric(channel)));
  }

  private async hydrateGeneric(channel: LiveGenericChannel): Promise<void> {
    const config = this.generic[channel];
    if (this.redis?.isOpen) {
      const payloads = await this.redis.lRange(config.redisKey, 0, config.limit - 1);
      const cached = normalizeGenericItems(
        channel,
        parseJsonList(payloads, config.parse).filter((item) => config.include?.(item) ?? true),
        config
      );
      if (cached.length > 0) {
        this.genericItems.set(channel, cached);
        this.stats.genericHydrateFromRedis += 1;
        this.stats.cacheDepthByKey.set(config.redisKey, cached.length);
        this.updateFreshnessMetric(config.redisKey, channel, cached[0]);
        this.genericCursors.set(
          config.cursorField,
          parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, config.cursorField))
        );
        await this.persistList(
          config.redisKey,
          config.cursorField,
          cached,
          config.limit,
          this.genericCursors.get(config.cursorField) ?? null
        );
        return;
      }
    }

    const fresh = normalizeGenericItems(
      channel,
      (await config.fetchRecent(this.clickhouse, config.limit)).filter(
        (item) => config.include?.(item) ?? true
      ),
      config
    );
    this.stats.genericHydrateFromClickHouse += 1;
    this.stats.cacheDepthByKey.set(config.redisKey, fresh.length);
    this.genericItems.set(channel, fresh);
    if (fresh.length > 0) {
      this.updateFreshnessMetric(config.redisKey, channel, fresh[0]);
    }
    const watermark = fresh[0] ? config.cursor(fresh[0]) : null;
    this.genericCursors.set(config.cursorField, watermark);
    await this.persistList(config.redisKey, config.cursorField, fresh, config.limit, watermark);
  }

  async getSnapshot(subscription: LiveSubscription): Promise<FeedSnapshot<unknown>> {
    switch (subscription.channel) {
      case "options": {
        const config = this.generic.options;
        const limit = snapshotLimitFor(subscription, config.limit);
        const scoped =
          Boolean(subscription.underlying_ids?.length) || Boolean(subscription.option_contract_id);
        if (subscription.filters?.view === "raw" || scoped) {
          const cached = (this.genericItems.get("options") ?? [])
            .filter((entry) => matchesScopedOptionSnapshot(entry, subscription))
            .slice(0, limit);
          let items = cached;
          if (cached.length < limit) {
            this.stats.scopedClickHouseSnapshots += 1;
            const storageFilters = buildOptionSnapshotFilters(subscription);
            const backfill = await fetchRecentOptionPrints(
              this.clickhouse,
              limit,
              undefined,
              storageFilters
            );
            items = mergeSnapshotBackfill(cached, backfill, limit, (entry) => ({
              ts: entry.ts,
              seq: entry.seq
            }));
          }
          return {
            subscription,
            items,
            watermark: items[0] ? { ts: items[0].ts, seq: items[0].seq } : null,
            next_before: nextBeforeForItems(items, (entry) => ({ ts: entry.ts, seq: entry.seq }))
          };
        }

        this.stats.genericCacheSnapshots += 1;
        const items = (this.genericItems.get("options") ?? [])
          .filter((entry) => matchesOptionPrintFilters(entry, subscription.filters))
          .slice(0, limit);
        return {
          subscription,
          items,
          watermark: this.genericCursors.get(config.cursorField) ?? null,
          next_before: nextBeforeForItems(items, config.cursor)
        };
      }
      case "flow": {
        const config = this.generic.flow;
        this.stats.genericCacheSnapshots += 1;
        const limit = snapshotLimitFor(subscription, config.limit);
        const items = (this.genericItems.get("flow") ?? [])
          .filter((entry) => matchesFlowPacketFilters(entry, subscription.filters))
          .slice(0, limit);
        return {
          subscription,
          items,
          watermark: this.genericCursors.get(config.cursorField) ?? null,
          next_before: nextBeforeForItems(items, config.cursor)
        };
      }
      case "equities": {
        const config = this.generic.equities;
        const limit = snapshotLimitFor(subscription, config.limit);
        if (subscription.underlying_ids?.length) {
          const cached = (this.genericItems.get("equities") ?? [])
            .filter((entry) => matchesScopedEquitySnapshot(entry, subscription))
            .slice(0, limit);
          let items = cached;
          if (cached.length < limit) {
            this.stats.scopedClickHouseSnapshots += 1;
            const filters: EquityPrintQueryFilters = { underlyingIds: subscription.underlying_ids };
            const backfill = await fetchRecentEquityPrints(this.clickhouse, limit, filters);
            items = mergeSnapshotBackfill(cached, backfill, limit, config.cursor);
          }
          return {
            subscription,
            items,
            watermark: items[0] ? { ts: items[0].ts, seq: items[0].seq } : null,
            next_before: nextBeforeForItems(items, config.cursor)
          };
        }
        this.stats.genericCacheSnapshots += 1;
        const items = (this.genericItems.get("equities") ?? []).slice(0, limit);
        return {
          subscription,
          items,
          watermark: this.genericCursors.get(config.cursorField) ?? null,
          next_before: nextBeforeForItems(items, config.cursor)
        };
      }
      case "equity-candles": {
        const key = candleRedisKey(subscription.underlying_id, subscription.interval_ms);
        const cursorField = candleCursorField(subscription.underlying_id, subscription.interval_ms);
        if (!this.candleItems.has(key)) {
          await this.hydrateCandles(subscription.underlying_id, subscription.interval_ms);
        }
        this.touchAccess(this.candleAccess, key);
        const items = this.candleItems.get(key) ?? [];
        return {
          subscription,
          items,
          watermark: this.candleCursors.get(cursorField) ?? null,
          next_before: nextBeforeForItems(items, (entry) => ({ ts: entry.ts, seq: entry.seq }))
        };
      }
      case "equity-overlay": {
        const key = overlayRedisKey(subscription.underlying_id);
        const cursorField = overlayCursorField(subscription.underlying_id);
        if (!this.overlayItems.has(key)) {
          await this.hydrateOverlay(subscription.underlying_id);
        }
        this.touchAccess(this.overlayAccess, key);
        const items = this.overlayItems.get(key) ?? [];
        return {
          subscription,
          items,
          watermark: this.overlayCursors.get(cursorField) ?? null,
          next_before: nextBeforeForItems(items, (entry) => ({ ts: entry.ts, seq: entry.seq }))
        };
      }
      case "durable-rows": {
        return await this.getDurableRowSnapshot(subscription);
      }
      default: {
        const config = this.generic[subscription.channel];
        this.stats.genericCacheSnapshots += 1;
        const limit = snapshotLimitFor(subscription, config.limit);
        const items = (this.genericItems.get(subscription.channel) ?? []).slice(0, limit);
        return {
          subscription,
          items,
          watermark: this.genericCursors.get(config.cursorField) ?? null,
          next_before: nextBeforeForItems(items, config.cursor)
        };
      }
    }
  }

  async ingest(channel: LiveChannel, item: unknown): Promise<Cursor | null> {
    switch (channel) {
      case "equity-candles": {
        const candle = EquityCandleSchema.parse(item);
        const key = candleRedisKey(candle.underlying_id, candle.interval_ms);
        const cursorField = candleCursorField(candle.underlying_id, candle.interval_ms);
        const nextState = insertNewestFirst(
          this.candleItems.get(key) ?? [],
          candle,
          (entry) => ({ ts: entry.ts, seq: entry.seq }),
          CHART_LIMITS.candles
        );
        const cursor = { ts: candle.ts, seq: candle.seq };
        this.candleItems.set(key, nextState.items);
        this.candleCursors.set(cursorField, cursor);
        this.touchAccess(this.candleAccess, key);
        this.evictScopedCachesIfNeeded(
          this.candleItems as Map<string, unknown[]>,
          this.candleCursors,
          this.candleAccess
        );
        if (nextState.outOfOrder) {
          this.stats.outOfOrderEvents += 1;
          metrics.count("api.live.out_of_order_events", 1);
        }
        this.stats.cacheDepthByKey.set(key, nextState.items.length);
        if (nextState.items.length > 0) {
          this.updateFreshnessMetric(key, "equity-candles", nextState.items[0]);
        }
        this.queueRedisWrite(key, cursorField, nextState.items, CHART_LIMITS.candles, cursor);
        return cursor;
      }
      case "equity-overlay": {
        const print = EquityPrintSchema.parse(item);
        const key = overlayRedisKey(print.underlying_id);
        const cursorField = overlayCursorField(print.underlying_id);
        const nextState = insertNewestFirst(
          this.overlayItems.get(key) ?? [],
          print,
          (entry) => ({ ts: entry.ts, seq: entry.seq }),
          CHART_LIMITS.overlay
        );
        const cursor = { ts: print.ts, seq: print.seq };
        this.overlayItems.set(key, nextState.items);
        this.overlayCursors.set(cursorField, cursor);
        this.touchAccess(this.overlayAccess, key);
        this.evictScopedCachesIfNeeded(
          this.overlayItems as Map<string, unknown[]>,
          this.overlayCursors,
          this.overlayAccess
        );
        if (nextState.outOfOrder) {
          this.stats.outOfOrderEvents += 1;
          metrics.count("api.live.out_of_order_events", 1);
        }
        this.stats.cacheDepthByKey.set(key, nextState.items.length);
        if (nextState.items.length > 0) {
          this.updateFreshnessMetric(key, "equity-overlay", nextState.items[0]);
        }
        this.queueRedisWrite(key, cursorField, nextState.items, CHART_LIMITS.overlay, cursor);
        return cursor;
      }
      case "durable-rows":
        return null;
      default: {
        const config = this.generic[channel];
        const parsed = config.parse(item);
        if (!(config.include?.(parsed) ?? true)) {
          return null;
        }
        if (!isWithinLiveFeedLookback(channel, parsed)) {
          return null;
        }

        const cursor = config.cursor(parsed);
        const nextState =
          channel === "nbbo"
            ? {
                items: normalizeGenericItems(
                  channel,
                  [parsed, ...(this.genericItems.get(channel) ?? [])],
                  config
                ),
                outOfOrder: false
              }
            : insertNewestFirst(
                this.genericItems.get(channel) ?? [],
                parsed,
                config.cursor,
                config.limit,
                config.identity
              );

        if (nextState.outOfOrder) {
          this.stats.outOfOrderEvents += 1;
          metrics.count("api.live.out_of_order_events", 1);
        }

        this.genericItems.set(channel, nextState.items);
        this.genericCursors.set(config.cursorField, cursor);
        this.stats.cacheDepthByKey.set(config.redisKey, nextState.items.length);
        if (nextState.items.length > 0) {
          this.updateFreshnessMetric(config.redisKey, channel, nextState.items[0]);
        }
        this.queueRedisWrite(
          config.redisKey,
          config.cursorField,
          nextState.items,
          config.limit,
          cursor
        );
        return cursor;
      }
    }
  }

  private async hydrateCandles(underlyingId: string, intervalMs: number): Promise<void> {
    const key = candleRedisKey(underlyingId, intervalMs);
    const cursorField = candleCursorField(underlyingId, intervalMs);
    if (this.redis?.isOpen) {
      const payloads = await this.redis.lRange(key, 0, CHART_LIMITS.candles - 1);
      const cached = parseJsonList(payloads, (value) => EquityCandleSchema.parse(value));
      if (cached.length > 0) {
        this.candleItems.set(key, cached);
        this.touchAccess(this.candleAccess, key);
        this.evictScopedCachesIfNeeded(
          this.candleItems as Map<string, unknown[]>,
          this.candleCursors,
          this.candleAccess
        );
        this.stats.cacheDepthByKey.set(key, cached.length);
        this.updateFreshnessMetric(key, "equity-candles", cached[0]);
        this.candleCursors.set(
          cursorField,
          parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, cursorField))
        );
        return;
      }
    }

    const fresh = await fetchRecentEquityCandles(
      this.clickhouse,
      underlyingId,
      intervalMs,
      CHART_LIMITS.candles
    );
    this.candleItems.set(key, fresh);
    this.touchAccess(this.candleAccess, key);
    this.evictScopedCachesIfNeeded(
      this.candleItems as Map<string, unknown[]>,
      this.candleCursors,
      this.candleAccess
    );
    this.stats.cacheDepthByKey.set(key, fresh.length);
    if (fresh.length > 0) {
      this.updateFreshnessMetric(key, "equity-candles", fresh[0]);
    }
    const watermark = fresh[0] ? { ts: fresh[0].ts, seq: fresh[0].seq } : null;
    this.candleCursors.set(cursorField, watermark);
    await this.persistList(key, cursorField, fresh, CHART_LIMITS.candles, watermark);
  }

  private async hydrateOverlay(underlyingId: string): Promise<void> {
    const key = overlayRedisKey(underlyingId);
    const cursorField = overlayCursorField(underlyingId);
    if (this.redis?.isOpen) {
      const payloads = await this.redis.lRange(key, 0, CHART_LIMITS.overlay - 1);
      const cached = parseJsonList(payloads, (value) => EquityPrintSchema.parse(value));
      if (cached.length > 0) {
        this.overlayItems.set(key, cached);
        this.touchAccess(this.overlayAccess, key);
        this.evictScopedCachesIfNeeded(
          this.overlayItems as Map<string, unknown[]>,
          this.overlayCursors,
          this.overlayAccess
        );
        this.stats.cacheDepthByKey.set(key, cached.length);
        this.updateFreshnessMetric(key, "equity-overlay", cached[0]);
        this.overlayCursors.set(
          cursorField,
          parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, cursorField))
        );
        return;
      }
    }

    const fresh = (await fetchRecentEquityPrints(this.clickhouse, CHART_LIMITS.overlay)).filter(
      (entry) => entry.underlying_id === underlyingId
    );
    this.overlayItems.set(key, fresh);
    this.touchAccess(this.overlayAccess, key);
    this.evictScopedCachesIfNeeded(
      this.overlayItems as Map<string, unknown[]>,
      this.overlayCursors,
      this.overlayAccess
    );
    this.stats.cacheDepthByKey.set(key, fresh.length);
    if (fresh.length > 0) {
      this.updateFreshnessMetric(key, "equity-overlay", fresh[0]);
    }
    const watermark = fresh[0] ? { ts: fresh[0].ts, seq: fresh[0].seq } : null;
    this.overlayCursors.set(cursorField, watermark);
    await this.persistList(key, cursorField, fresh, CHART_LIMITS.overlay, watermark);
  }

  private async persistList<T>(
    listKey: string,
    cursorField: string,
    items: T[],
    limit: number,
    cursor: Cursor | null
  ): Promise<void> {
    if (!this.redis?.isOpen) {
      return;
    }

    try {
      const payloads = items.map((entry) => JSON.stringify(entry));
      await this.redis.lTrim(listKey, 1, 0);
      this.stats.trimOperations += 1;
      if (payloads.length > 0) {
        for (let idx = payloads.length - 1; idx >= 0; idx -= 1) {
          const payload = payloads[idx];
          if (payload) {
            if (!this.redis.isOpen) {
              return;
            }
            await this.redis.lPush(listKey, payload);
          }
        }
        if (!this.redis.isOpen) {
          return;
        }
        await this.redis.lTrim(listKey, 0, limit - 1);
        this.stats.trimOperations += 1;
      }
      this.stats.cacheDepthByKey.set(listKey, Math.min(items.length, limit));
      if (this.redis.isOpen) {
        await this.redis.hSet(CURSOR_HASH_KEY, cursorField, JSON.stringify(cursor));
      }
    } catch (error) {
      if (!this.redis?.isOpen || isRedisClientClosedError(error)) {
        return;
      }
      throw error;
    }
  }
}
