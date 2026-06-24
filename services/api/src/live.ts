import { createMetrics } from "@islandflow/observability";
import type { EquityPrintQueryFilters, OptionPrintQueryFilters } from "@islandflow/storage";
import {
  type ClickHouseClient,
  fetchRecentAlerts,
  fetchRecentClassifierHits,
  fetchRecentEquityCandles,
  fetchRecentEquityPrintJoins,
  fetchRecentEquityPrints,
  fetchRecentEquityQuotes,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentNews,
  fetchRecentOptionNBBO,
  fetchRecentOptionPrints,
  fetchRecentSmartMoneyEvents
} from "@islandflow/storage";
import {
  type AlertEvent,
  AlertEventSchema,
  ClassifierHitEventSchema,
  type ClassifierHitEvent,
  type Cursor,
  CursorSchema,
  type DurableTapeAlertRowViewModel,
  type DurableTapeComposedLane,
  DurableTapeRowViewModelSchema,
  type DurableTapeOptionRowViewModel,
  type DurableTapeRowViewModel,
  type EquityCandle,
  EquityCandleSchema,
  type EquityPrint,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  FeedSnapshot,
  type FlowPacket,
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
  type OptionNBBO,
  type OptionFlowFilters,
  OptionNBBOSchema,
  type OptionPrint,
  OptionPrintSchema,
  type SmartMoneyEvent,
  SmartFlowExplainabilityProjectionSchema,
  SmartMoneyEventSchema
} from "@islandflow/types";
import type { RedisClientType } from "redis";
import { fetchRecentSmartFlowExplainability, smartFlowCursor } from "./smart-flow";

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
  "smart-money": "LIVE_LIMIT_SMART_MONEY",
  "classifier-hits": "LIVE_LIMIT_CLASSIFIER_HITS",
  alerts: "LIVE_LIMIT_ALERTS",
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
  "smart-money": 300,
  "classifier-hits": 300,
  alerts: 300,
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
  cursor: (item: any) => Cursor;
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
    "smart-money": parseGenericLimit(
      env,
      "smart-money",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["smart-money"]
    ),
    "classifier-hits": parseGenericLimit(
      env,
      "classifier-hits",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS["classifier-hits"]
    ),
    alerts: parseGenericLimit(
      env,
      "alerts",
      env.LIVE_LIMIT_DEFAULT ? liveLimitDefault : DEFAULT_LIVE_LIMITS.alerts
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
    case "smart-money":
    case "classifier-hits":
    case "alerts":
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
  "smart-money": {
    redisKey: "live:smart-money",
    cursorField: "smart-money",
    limit: limits["smart-money"],
    parse: (value) => SmartMoneyEventSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentSmartMoneyEvents
  },
  "smart-flow": {
    redisKey: "live:smart-flow",
    cursorField: "smart-flow",
    limit: limits["smart-flow"],
    parse: (value) => SmartFlowExplainabilityProjectionSchema.parse(value),
    cursor: smartFlowCursor,
    fetchRecent: fetchRecentSmartFlowExplainability
  },
  "classifier-hits": {
    redisKey: "live:classifier-hits",
    cursorField: "classifier-hits",
    limit: limits["classifier-hits"],
    parse: (value) => ClassifierHitEventSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentClassifierHits
  },
  alerts: {
    redisKey: "live:alerts",
    cursorField: "alerts",
    limit: limits.alerts,
    parse: (value) => AlertEventSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentAlerts
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

const compareCursors = (a: Cursor, b: Cursor): number => b.ts - a.ts || b.seq - a.seq;

const sortGenericItems = <T>(items: T[], cursorOf: (item: T) => Cursor): T[] =>
  [...items].sort((a, b) => compareCursors(cursorOf(a), cursorOf(b)));

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

  return sortGenericItems(items, config.cursor).slice(0, config.limit);
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

const DURABLE_ROW_DEFAULT_LANES: DurableTapeComposedLane[] = ["options", "alerts"];
const DURABLE_ROW_MAX_REFS = 32;
const DURABLE_ROW_MAX_PACKET_MEMBERS = 100;
const DURABLE_ROW_MAX_ALERT_PREVIEW_PRINTS = 3;

type DurableRowsSubscription = Extract<LiveSubscription, { channel: "durable-rows" }>;

type DurableRowCompositionContext = {
  flowPackets: FlowPacket[];
  optionPrints: OptionPrint[];
  nbbo: OptionNBBO[];
  classifierHits: ClassifierHitEvent[];
  smartMoney: SmartMoneyEvent[];
};

type DurableRowLookups = {
  flowPacketByMemberTraceId: Map<string, FlowPacket>;
  flowPacketById: Map<string, FlowPacket>;
  optionPrintByTraceId: Map<string, OptionPrint>;
  nbboByContractId: Map<string, OptionNBBO>;
  classifierHitsByPacketId: Map<string, ClassifierHitEvent[]>;
  smartMoneyByPacketId: Map<string, SmartMoneyEvent>;
};

const durableRowLanesFor = (subscription: DurableRowsSubscription): Set<DurableTapeComposedLane> =>
  new Set(subscription.lanes?.length ? subscription.lanes : DURABLE_ROW_DEFAULT_LANES);

const getOptionPremium = (print: OptionPrint): number =>
  print.notional ?? print.price * print.size * 100;

const formatCompactMoney = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}m`;
  }
  if (abs >= 1_000) {
    return `$${Math.round(value / 1_000).toLocaleString()}k`;
  }
  return `$${Math.round(value).toLocaleString()}`;
};

const formatPrice = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : "--";

const formatTimeCell = (ts: number): string => new Date(ts).toISOString().slice(11, 19);

const humanizeToken = (value: string | null | undefined): string => {
  if (!value) {
    return "Unknown";
  }
  return value
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

const extractUnderlyingFromContract = (contractId: string): string | null => {
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  const fallback = contractId.split("-")[0]?.trim();
  return fallback ? fallback.toUpperCase() : null;
};

const getPacketContractId = (packet: FlowPacket | null | undefined): string | undefined => {
  const value = packet?.features.option_contract_id;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const match = packet?.id.match(/^flowpacket:([^:]+):/);
  return match?.[1];
};

const extractPacketIdFromClassifierHitTrace = (traceId: string): string | null => {
  const index = traceId.indexOf("flowpacket:");
  return index >= 0 ? traceId.slice(index) : null;
};

const buildFlowPacketByMemberTraceId = (packets: FlowPacket[]): Map<string, FlowPacket> => {
  const map = new Map<string, FlowPacket>();
  for (const packet of packets) {
    for (const member of packet.members) {
      map.set(member, packet);
    }
  }
  return map;
};

const buildFlowPacketById = (packets: FlowPacket[]): Map<string, FlowPacket> => {
  const map = new Map<string, FlowPacket>();
  for (const packet of packets) {
    map.set(packet.id, packet);
    if (packet.trace_id) {
      map.set(packet.trace_id, packet);
    }
  }
  return map;
};

const buildOptionPrintByTraceId = (prints: OptionPrint[]): Map<string, OptionPrint> => {
  const map = new Map<string, OptionPrint>();
  for (const print of prints) {
    map.set(print.trace_id, print);
  }
  return map;
};

const buildNbboByContractId = (items: OptionNBBO[]): Map<string, OptionNBBO> => {
  const map = new Map<string, OptionNBBO>();
  for (const quote of items) {
    const existing = map.get(quote.option_contract_id);
    if (!existing || quote.ts > existing.ts || (quote.ts === existing.ts && quote.seq > existing.seq)) {
      map.set(quote.option_contract_id, quote);
    }
  }
  return map;
};

const buildClassifierHitsByPacketId = (
  hits: ClassifierHitEvent[]
): Map<string, ClassifierHitEvent[]> => {
  const map = new Map<string, ClassifierHitEvent[]>();
  for (const hit of hits) {
    const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
    if (!packetId) {
      continue;
    }
    map.set(packetId, [...(map.get(packetId) ?? []), hit]);
  }
  return map;
};

const buildSmartMoneyByPacketId = (events: SmartMoneyEvent[]): Map<string, SmartMoneyEvent> => {
  const map = new Map<string, SmartMoneyEvent>();
  for (const event of events) {
    for (const packetId of event.packet_ids) {
      const existing = map.get(packetId);
      if (
        !existing ||
        event.source_ts > existing.source_ts ||
        (event.source_ts === existing.source_ts && event.seq > existing.seq)
      ) {
        map.set(packetId, event);
      }
    }
  }
  return map;
};

const buildDurableRowLookups = (context: DurableRowCompositionContext): DurableRowLookups => ({
  flowPacketByMemberTraceId: buildFlowPacketByMemberTraceId(context.flowPackets),
  flowPacketById: buildFlowPacketById(context.flowPackets),
  optionPrintByTraceId: buildOptionPrintByTraceId(context.optionPrints),
  nbboByContractId: buildNbboByContractId(context.nbbo),
  classifierHitsByPacketId: buildClassifierHitsByPacketId(context.classifierHits),
  smartMoneyByPacketId: buildSmartMoneyByPacketId(context.smartMoney)
});

const selectPrimaryClassifierHit = (
  hits: readonly ClassifierHitEvent[]
): ClassifierHitEvent | null =>
  [...hits].sort((left, right) => {
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return right.source_ts - left.source_ts || right.seq - left.seq;
  })[0] ?? null;

const selectPrimaryAlertHit = (
  hits: readonly AlertEvent["hits"][number][]
): AlertEvent["hits"][number] | null =>
  [...hits].sort((left, right) => right.confidence - left.confidence)[0] ?? null;

const normalizeAlertSeverity = (alert: AlertEvent): "high" | "medium" | "low" => {
  const severity = alert.severity.trim().toLowerCase();
  if (["high", "critical", "severe", "sev1", "p0", "p1"].includes(severity)) {
    return "high";
  }
  if (["medium", "med", "moderate", "sev2", "p2"].includes(severity)) {
    return "medium";
  }
  if (["low", "minor", "info", "informational", "sev3", "p3", "p4"].includes(severity)) {
    return "low";
  }
  if (alert.score >= 80) {
    return "high";
  }
  if (alert.score >= 45) {
    return "medium";
  }
  return "low";
};

const normalizeDirection = (value: string | null | undefined): "bullish" | "bearish" | "neutral" => {
  const normalized = value?.toLowerCase();
  return normalized === "bullish" || normalized === "bearish" || normalized === "neutral"
    ? normalized
    : "neutral";
};

const deriveAlertDirection = (alert: AlertEvent): "bullish" | "bearish" | "neutral" => {
  const totals = {
    bullish: { count: 0, confidence: 0 },
    bearish: { count: 0, confidence: 0 },
    neutral: { count: 0, confidence: 0 }
  };
  for (const hit of alert.hits) {
    const direction = normalizeDirection(hit.direction);
    totals[direction].count += 1;
    totals[direction].confidence += Number.isFinite(hit.confidence) ? hit.confidence : 0;
  }
  const [direction, value] = Object.entries(totals).sort((left, right) => {
    if (right[1].count !== left[1].count) {
      return right[1].count - left[1].count;
    }
    return right[1].confidence - left[1].confidence;
  })[0] as ["bullish" | "bearish" | "neutral", { count: number; confidence: number }];
  return value.count > 0 ? direction : "neutral";
};

const matchesDurableOptionSubscription = (
  print: OptionPrint,
  subscription: DurableRowsSubscription
): boolean => {
  if (!matchesOptionPrintFilters(print, subscription.filters)) {
    return false;
  }
  if (
    subscription.option_contract_id &&
    subscription.option_contract_id !== print.option_contract_id
  ) {
    return false;
  }
  if (!subscription.underlying_ids?.length) {
    return true;
  }
  const underlying = (print.underlying_id ?? extractUnderlyingFromContract(print.option_contract_id) ?? "")
    .toUpperCase();
  return subscription.underlying_ids.map((value) => value.toUpperCase()).includes(underlying);
};

const matchesDurableAlertSubscription = (
  row: DurableTapeAlertRowViewModel,
  subscription: DurableRowsSubscription
): boolean => {
  if (!subscription.underlying_ids?.length) {
    return true;
  }
  const symbol = row.symbol?.toUpperCase();
  return Boolean(symbol && subscription.underlying_ids.map((value) => value.toUpperCase()).includes(symbol));
};

const packetSummary = (packet: FlowPacket | null) => {
  if (!packet) {
    return null;
  }
  const members = packet.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS);
  return {
    id: packet.id,
    trace_id: packet.trace_id,
    option_contract_id: getPacketContractId(packet),
    member_trace_ids: members,
    member_count: packet.members.length,
    ...(members.length < packet.members.length ? { truncated: true } : {})
  };
};

const resolveOptionNbbo = (
  print: OptionPrint,
  nbboByContractId: ReadonlyMap<string, OptionNBBO>
): DurableTapeOptionRowViewModel["option"]["nbbo"] => {
  if (
    typeof print.execution_nbbo_bid === "number" &&
    typeof print.execution_nbbo_ask === "number"
  ) {
    return {
      bid: print.execution_nbbo_bid,
      ask: print.execution_nbbo_ask,
      mid:
        typeof print.execution_nbbo_mid === "number"
          ? print.execution_nbbo_mid
          : (print.execution_nbbo_bid + print.execution_nbbo_ask) / 2,
      spread:
        typeof print.execution_nbbo_spread === "number"
          ? print.execution_nbbo_spread
          : Math.max(0, print.execution_nbbo_ask - print.execution_nbbo_bid),
      source: "print",
      age_ms: typeof print.execution_nbbo_age_ms === "number" ? print.execution_nbbo_age_ms : null
    };
  }

  const quote = nbboByContractId.get(print.option_contract_id);
  if (!quote) {
    return null;
  }
  return {
    bid: quote.bid,
    ask: quote.ask,
    mid: (quote.bid + quote.ask) / 2,
    spread: Math.max(0, quote.ask - quote.bid),
    source: "latest",
    age_ms: Math.max(0, print.ts - quote.ts)
  };
};

const buildDurableOptionRow = (
  print: OptionPrint,
  lookups: DurableRowLookups
): DurableTapeOptionRowViewModel => {
  const packet = lookups.flowPacketByMemberTraceId.get(print.trace_id) ?? null;
  const classifier = packet
    ? selectPrimaryClassifierHit(lookups.classifierHitsByPacketId.get(packet.id) ?? [])
    : null;
  const smartMoney = packet ? (lookups.smartMoneyByPacketId.get(packet.id) ?? null) : null;
  const premium = getOptionPremium(print);
  const side = print.execution_nbbo_side ?? print.nbbo_side ?? null;
  const nbbo = resolveOptionNbbo(print, lookups.nbboByContractId);
  const underlying = print.underlying_id ?? extractUnderlyingFromContract(print.option_contract_id) ?? undefined;
  const primarySmartMoneyScore =
    smartMoney?.profile_scores.find((score) => score.profile_id === smartMoney.primary_profile_id) ??
    smartMoney?.profile_scores[0] ??
    null;
  const badges = [
    side ? { kind: "side", label: side, tone: side.startsWith("A") ? "bullish" : side.startsWith("B") ? "bearish" : "neutral" } : null,
    print.signal_pass ? { kind: "signal", label: print.signal_profile ?? "signal", tone: "info" } : null,
    packet ? { kind: "packet", label: `${packet.members.length} prints`, tone: "neutral" } : null,
    smartMoney
      ? {
          kind: "smart-money",
          label: humanizeToken(smartMoney.primary_profile_id),
          tone: smartMoney.abstained ? "neutral" : smartMoney.primary_direction
        }
      : classifier
        ? {
            kind: "classifier",
            label: humanizeToken(classifier.classifier_id),
            tone: normalizeDirection(classifier.direction)
          }
        : null
  ].filter((badge): badge is NonNullable<typeof badge> => badge !== null);

  return DurableTapeRowViewModelSchema.parse({
    id: `options:${print.trace_id}:${print.seq}`,
    lane: "options",
    source: "server",
    ts: print.ts,
    seq: print.seq,
    source_ts: print.source_ts,
    ingest_ts: print.ingest_ts,
    symbol: underlying,
    cells: {
      time: formatTimeCell(print.ts),
      contract: print.option_contract_id,
      price: formatPrice(print.price),
      size: print.size,
      premium: formatCompactMoney(premium),
      side: side ?? "--",
      nbbo: nbbo ? `${formatPrice(nbbo.bid)} x ${formatPrice(nbbo.ask)}` : "--",
      exchange: print.exchange,
      support: smartMoney
        ? humanizeToken(smartMoney.primary_profile_id)
        : classifier
          ? humanizeToken(classifier.classifier_id)
          : packet
            ? "packet"
            : "--"
    },
    option: {
      trace_id: print.trace_id,
      option_contract_id: print.option_contract_id,
      underlying_id: underlying,
      option_type: print.option_type,
      price: print.price,
      size: print.size,
      premium,
      side,
      exchange: print.exchange,
      conditions: print.conditions,
      signal: {
        pass: print.signal_pass,
        profile: print.signal_profile,
        reasons: print.signal_reasons
      },
      execution: {
        iv: typeof print.execution_iv === "number" ? print.execution_iv : null,
        underlying_spot:
          typeof print.execution_underlying_spot === "number"
            ? print.execution_underlying_spot
            : null,
        quote_age_ms:
          typeof print.execution_nbbo_age_ms === "number" ? print.execution_nbbo_age_ms : null
      },
      nbbo
    },
    support: {
      packet: packetSummary(packet),
      classifier: classifier
        ? {
            trace_id: classifier.trace_id,
            classifier_id: classifier.classifier_id,
            label: humanizeToken(classifier.classifier_id),
            direction: classifier.direction ?? null,
            confidence: Number.isFinite(classifier.confidence) ? classifier.confidence : null,
            explanation: classifier.explanations?.[0] ?? null
          }
        : null,
      smart_money: smartMoney
        ? {
            trace_id: smartMoney.trace_id,
            event_id: smartMoney.event_id,
            profile_id: smartMoney.primary_profile_id ?? null,
            label: humanizeToken(smartMoney.primary_profile_id),
            direction: smartMoney.primary_direction ?? null,
            confidence_band: primarySmartMoneyScore?.confidence_band ?? null,
            probability: primarySmartMoneyScore?.probability ?? null,
            abstained: smartMoney.abstained,
            reasons: primarySmartMoneyScore?.reasons ?? smartMoney.suppressed_reasons ?? []
          }
        : null
    },
    badges,
    evidence_summary: {
      label: packet ? `${packet.members.length} packet members` : "No packet context",
      refs: [print.trace_id, ...(packet ? [packet.id] : [])].slice(0, DURABLE_ROW_MAX_REFS),
      available_refs: [print.trace_id, ...(packet ? [packet.id] : [])],
      missing_refs: packet ? [] : [print.trace_id],
      counts: {
        total: packet ? packet.members.length + 1 : 1,
        flow_packets: packet ? 1 : 0,
        option_prints: 1,
        unresolved: packet ? 0 : 1
      }
    },
    drilldown_refs: [print.trace_id, ...(packet ? [packet.id] : [])].slice(0, DURABLE_ROW_MAX_REFS)
  }) as DurableTapeOptionRowViewModel;
};

const buildDurableAlertRow = (
  alert: AlertEvent,
  lookups: DurableRowLookups
): DurableTapeAlertRowViewModel => {
  const flowPacketRefs = alert.evidence_refs.filter((ref) => ref.startsWith("flowpacket:"));
  const optionPrintRefs = alert.evidence_refs.filter((ref) => !ref.startsWith("flowpacket:"));
  const primaryPacket =
    flowPacketRefs.map((ref) => lookups.flowPacketById.get(ref)).find(Boolean) ?? null;
  const previewPrints = optionPrintRefs
    .map((ref) => lookups.optionPrintByTraceId.get(ref))
    .filter((print): print is OptionPrint => Boolean(print))
    .slice(0, DURABLE_ROW_MAX_ALERT_PREVIEW_PRINTS);
  const availableRefs = [
    ...flowPacketRefs.filter((ref) => lookups.flowPacketById.has(ref)),
    ...optionPrintRefs.filter((ref) => lookups.optionPrintByTraceId.has(ref))
  ];
  const missingRefs = alert.evidence_refs.filter((ref) => !availableRefs.includes(ref));
  const packetContract = getPacketContractId(primaryPacket);
  const firstPreviewPrint = previewPrints[0];
  const underlying =
    (packetContract ? extractUnderlyingFromContract(packetContract) : null) ??
    firstPreviewPrint?.underlying_id ??
    (firstPreviewPrint
      ? extractUnderlyingFromContract(firstPreviewPrint.option_contract_id)
      : null);
  const severity = normalizeAlertSeverity(alert);
  const direction = deriveAlertDirection(alert);
  const topHit = selectPrimaryAlertHit(alert.hits);
  const primaryLabel = humanizeToken(topHit?.classifier_id ?? alert.primary_profile_id);
  const badges = [
    { kind: "severity", label: severity, tone: severity },
    { kind: "direction", label: direction, tone: direction },
    { kind: "evidence", label: `${alert.evidence_refs.length} refs`, tone: missingRefs.length > 0 ? "warning" : "neutral" }
  ];

  return DurableTapeRowViewModelSchema.parse({
    id: `alerts:${alert.trace_id}:${alert.seq}`,
    lane: "alerts",
    source: "server",
    ts: alert.source_ts,
    seq: alert.seq,
    source_ts: alert.source_ts,
    ingest_ts: alert.ingest_ts,
    symbol: underlying ?? undefined,
    cells: {
      time: formatTimeCell(alert.source_ts),
      symbol: underlying ?? "ALERT",
      kind: primaryLabel,
      score: Math.round(alert.score),
      state: `${severity} / ${direction}`,
      evidence: `${availableRefs.length}/${alert.evidence_refs.length} refs`
    },
    alert: {
      trace_id: alert.trace_id,
      primary_label: primaryLabel,
      primary_profile_id: alert.primary_profile_id ?? null,
      score: alert.score,
      severity,
      direction,
      hit_count: alert.hits.length,
      top_hit: topHit
        ? {
            classifier_id: topHit.classifier_id,
            label: humanizeToken(topHit.classifier_id),
            direction: topHit.direction ?? null,
            confidence: Number.isFinite(topHit.confidence) ? topHit.confidence : null,
            explanation: topHit.explanations?.[0] ?? null
          }
        : null
    },
    evidence: {
      total_refs: alert.evidence_refs.length,
      flow_packet_refs: flowPacketRefs.slice(0, DURABLE_ROW_MAX_REFS),
      option_print_refs: optionPrintRefs.slice(0, DURABLE_ROW_MAX_REFS),
      unresolved_refs: missingRefs.slice(0, DURABLE_ROW_MAX_REFS),
      underlying_id: underlying,
      primary_packet: primaryPacket
        ? {
            id: primaryPacket.id,
            option_contract_id: getPacketContractId(primaryPacket),
            member_trace_ids: primaryPacket.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS),
            member_count: primaryPacket.members.length,
            ...(primaryPacket.members.length > DURABLE_ROW_MAX_PACKET_MEMBERS
              ? { truncated: true }
              : {})
          }
        : null,
      preview_prints: previewPrints.map((print) => ({
        trace_id: print.trace_id,
        option_contract_id: print.option_contract_id,
        ts: print.ts,
        price: print.price,
        size: print.size,
        premium: getOptionPremium(print),
        exchange: print.exchange
      }))
    },
    badges,
    evidence_summary: {
      label: `${availableRefs.length}/${alert.evidence_refs.length} refs available`,
      refs: alert.evidence_refs.slice(0, DURABLE_ROW_MAX_REFS),
      available_refs: availableRefs.slice(0, DURABLE_ROW_MAX_REFS),
      missing_refs: missingRefs.slice(0, DURABLE_ROW_MAX_REFS),
      counts: {
        total: alert.evidence_refs.length,
        flow_packets: flowPacketRefs.length,
        option_prints: optionPrintRefs.length,
        unresolved: missingRefs.length
      }
    },
    drilldown_refs: alert.evidence_refs.slice(0, DURABLE_ROW_MAX_REFS)
  }) as DurableTapeAlertRowViewModel;
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

const dropMatchingCursor = <T>(items: T[], target: Cursor, cursorOf: (item: T) => Cursor): T[] =>
  items.filter((item) => compareCursors(cursorOf(item), target) !== 0);

const insertNewestFirst = <T>(
  items: T[],
  item: T,
  cursorOf: (item: T) => Cursor,
  limit: number
): { items: T[]; outOfOrder: boolean } => {
  const cursor = cursorOf(item);
  const deduped = dropMatchingCursor(items, cursor, cursorOf);
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

  private getDurableRowCompositionContext(): DurableRowCompositionContext {
    return {
      flowPackets: (this.genericItems.get("flow") ?? []) as FlowPacket[],
      optionPrints: (this.genericItems.get("options") ?? []) as OptionPrint[],
      nbbo: (this.genericItems.get("nbbo") ?? []) as OptionNBBO[],
      classifierHits: (this.genericItems.get("classifier-hits") ?? []) as ClassifierHitEvent[],
      smartMoney: (this.genericItems.get("smart-money") ?? []) as SmartMoneyEvent[]
    };
  }

  private getDurableRowSnapshot(subscription: DurableRowsSubscription): FeedSnapshot<unknown> {
    const context = this.getDurableRowCompositionContext();
    const lookups = buildDurableRowLookups(context);
    const lanes = durableRowLanesFor(subscription);
    const limit = snapshotLimitFor(
      subscription,
      Math.max(this.config.limits.options, this.config.limits.alerts)
    );
    const rows: DurableTapeRowViewModel[] = [];

    if (lanes.has("options")) {
      for (const print of context.optionPrints) {
        if (matchesDurableOptionSubscription(print, subscription)) {
          rows.push(buildDurableOptionRow(print, lookups));
        }
      }
    }

    if (lanes.has("alerts")) {
      for (const alert of (this.genericItems.get("alerts") ?? []) as AlertEvent[]) {
        const row = buildDurableAlertRow(alert, lookups);
        if (matchesDurableAlertSubscription(row, subscription)) {
          rows.push(row);
        }
      }
    }

    const items = sortGenericItems(rows, (row) => ({ ts: row.ts, seq: row.seq })).slice(0, limit);
    return {
      subscription,
      items,
      watermark: items[0] ? { ts: items[0].ts, seq: items[0].seq } : null,
      next_before: nextBeforeForItems(items, (row) => ({ ts: row.ts, seq: row.seq }))
    };
  }

  composeDurableRowsForEvent(
    subscription: DurableRowsSubscription,
    channel: LiveChannel,
    item: unknown
  ): DurableTapeRowViewModel[] {
    const context = this.getDurableRowCompositionContext();
    const lookups = buildDurableRowLookups(context);
    const lanes = durableRowLanesFor(subscription);
    const limit = snapshotLimitFor(
      subscription,
      Math.max(this.config.limits.options, this.config.limits.alerts)
    );
    const rows: DurableTapeRowViewModel[] = [];
    const seen = new Set<string>();
    const push = (row: DurableTapeRowViewModel) => {
      if (seen.has(row.id)) {
        return;
      }
      seen.add(row.id);
      rows.push(row);
    };
    const pushOptionPrint = (print: OptionPrint | null | undefined) => {
      if (!print || !matchesDurableOptionSubscription(print, subscription)) {
        return;
      }
      push(buildDurableOptionRow(print, lookups));
    };
    const pushAlert = (alert: AlertEvent | null | undefined) => {
      if (!alert) {
        return;
      }
      const row = buildDurableAlertRow(alert, lookups);
      if (matchesDurableAlertSubscription(row, subscription)) {
        push(row);
      }
    };

    if (lanes.has("options")) {
      if (channel === "options") {
        pushOptionPrint(item as OptionPrint);
      } else if (channel === "flow") {
        const packet = item as FlowPacket;
        for (const traceId of packet.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS)) {
          pushOptionPrint(lookups.optionPrintByTraceId.get(traceId));
        }
      } else if (channel === "classifier-hits") {
        const hit = item as ClassifierHitEvent;
        const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
        const packet = packetId ? lookups.flowPacketById.get(packetId) : null;
        for (const traceId of packet?.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS) ?? []) {
          pushOptionPrint(lookups.optionPrintByTraceId.get(traceId));
        }
      } else if (channel === "smart-money") {
        const event = item as SmartMoneyEvent;
        for (const packetId of event.packet_ids.slice(0, DURABLE_ROW_MAX_REFS)) {
          const packet = lookups.flowPacketById.get(packetId);
          for (const traceId of packet?.members.slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS) ?? []) {
            pushOptionPrint(lookups.optionPrintByTraceId.get(traceId));
          }
        }
      } else if (channel === "nbbo") {
        const quote = item as OptionNBBO;
        for (const print of context.optionPrints
          .filter((candidate) => candidate.option_contract_id === quote.option_contract_id)
          .slice(0, DURABLE_ROW_MAX_PACKET_MEMBERS)) {
          pushOptionPrint(print);
        }
      }
    }

    if (lanes.has("alerts")) {
      if (channel === "alerts") {
        pushAlert(item as AlertEvent);
      } else if (channel === "flow") {
        const packet = item as FlowPacket;
        for (const alert of (this.genericItems.get("alerts") ?? []) as AlertEvent[]) {
          if (alert.evidence_refs.includes(packet.id)) {
            pushAlert(alert);
          }
        }
      } else if (channel === "options") {
        const print = item as OptionPrint;
        for (const alert of (this.genericItems.get("alerts") ?? []) as AlertEvent[]) {
          if (alert.evidence_refs.includes(print.trace_id)) {
            pushAlert(alert);
          }
        }
      }
    }

    return sortGenericItems(rows, (row) => ({ ts: row.ts, seq: row.seq })).slice(0, limit);
  }

  async flushRedisWrites(): Promise<void> {
    if (!this.redis?.isOpen) {
      return;
    }

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
      channel === "equity-candles" || channel === "equity-overlay"
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
      const cached = normalizeGenericItems(channel, parseJsonList(payloads, config.parse), config);
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
      await config.fetchRecent(this.clickhouse, config.limit),
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
        return this.getDurableRowSnapshot(subscription);
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
                config.limit
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

    const payloads = items.map((entry) => JSON.stringify(entry));
    await this.redis.lTrim(listKey, 1, 0);
    this.stats.trimOperations += 1;
    if (payloads.length > 0) {
      for (let idx = payloads.length - 1; idx >= 0; idx -= 1) {
        const payload = payloads[idx];
        if (payload) {
          await this.redis.lPush(listKey, payload);
        }
      }
      await this.redis.lTrim(listKey, 0, limit - 1);
      this.stats.trimOperations += 1;
    }
    this.stats.cacheDepthByKey.set(listKey, Math.min(items.length, limit));
    await this.redis.hSet(CURSOR_HASH_KEY, cursorField, JSON.stringify(cursor));
  }
}
