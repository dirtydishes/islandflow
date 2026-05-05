import {
  fetchRecentOptionPrints,
  fetchRecentAlerts,
  fetchRecentClassifierHits,
  fetchRecentEquityCandles,
  fetchRecentEquityPrintJoins,
  fetchRecentEquityPrints,
  fetchRecentEquityQuotes,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentOptionNBBO,
  fetchRecentSmartMoneyEvents,
  type ClickHouseClient
} from "@islandflow/storage";
import type { OptionPrintQueryFilters } from "@islandflow/storage";
import type { EquityPrintQueryFilters } from "@islandflow/storage";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  CursorSchema,
  EquityCandleSchema,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  EquityQuoteSchema,
  FeedSnapshot,
  FlowPacketSchema,
  InferredDarkEventSchema,
  LiveGenericChannel,
  LiveSubscription,
  matchesFlowPacketFilters,
  matchesOptionPrintFilters,
  OptionNBBOSchema,
  OptionPrintSchema,
  SmartMoneyEventSchema,
  type OptionFlowFilters,
  type Cursor,
  type EquityCandle,
  type EquityPrint,
  type LiveChannel
} from "@islandflow/types";
import type { RedisClientType } from "redis";

const CURSOR_HASH_KEY = "live:cursors";
export const LIVE_FEED_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const DEFAULT_GENERIC_LIMIT = 10000;
const MAX_GENERIC_LIMIT = 100000;
const MIN_GENERIC_LIMIT = 1;
const GENERIC_LIMIT_ENV_KEYS: Record<LiveGenericChannel, string> = {
  options: "LIVE_LIMIT_OPTIONS",
  nbbo: "LIVE_LIMIT_NBBO",
  equities: "LIVE_LIMIT_EQUITIES",
  "equity-quotes": "LIVE_LIMIT_EQUITY_QUOTES",
  "equity-joins": "LIVE_LIMIT_EQUITY_JOINS",
  flow: "LIVE_LIMIT_FLOW",
  "smart-money": "LIVE_LIMIT_SMART_MONEY",
  "classifier-hits": "LIVE_LIMIT_CLASSIFIER_HITS",
  alerts: "LIVE_LIMIT_ALERTS",
  "inferred-dark": "LIVE_LIMIT_INFERRED_DARK"
};

const CHART_LIMITS = {
  candles: 500,
  overlay: 1500
} as const;

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

export type GenericLiveLimits = Record<LiveGenericChannel, number>;

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

export const resolveGenericLiveLimits = (env: NodeJS.ProcessEnv = process.env): GenericLiveLimits => ({
  options: parseGenericLimit(env, "options", DEFAULT_GENERIC_LIMIT),
  nbbo: parseGenericLimit(env, "nbbo", DEFAULT_GENERIC_LIMIT),
  equities: parseGenericLimit(env, "equities", DEFAULT_GENERIC_LIMIT),
  "equity-quotes": parseGenericLimit(env, "equity-quotes", DEFAULT_GENERIC_LIMIT),
  "equity-joins": parseGenericLimit(env, "equity-joins", DEFAULT_GENERIC_LIMIT),
  flow: parseGenericLimit(env, "flow", DEFAULT_GENERIC_LIMIT),
  "smart-money": parseGenericLimit(env, "smart-money", DEFAULT_GENERIC_LIMIT),
  "classifier-hits": parseGenericLimit(env, "classifier-hits", DEFAULT_GENERIC_LIMIT),
  alerts: parseGenericLimit(env, "alerts", DEFAULT_GENERIC_LIMIT),
  "inferred-dark": parseGenericLimit(env, "inferred-dark", DEFAULT_GENERIC_LIMIT)
});

type RedisLike = Pick<
  RedisClientType,
  "isOpen" | "lRange" | "lPush" | "lTrim" | "hGet" | "hSet"
>;

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

const getGenericConfig = (limits: GenericLiveLimits): {
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

const compareCursors = (a: Cursor, b: Cursor): number => (b.ts - a.ts) || (b.seq - a.seq);

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

const extractFreshnessTs = (channel: LiveGenericChannel, item: any): number | null => {
  switch (channel) {
    case "options":
    case "nbbo":
    case "equities":
    case "equity-quotes":
      return typeof item.ts === "number" ? item.ts : null;
    case "flow":
    case "classifier-hits":
    case "alerts":
    case "inferred-dark":
      return typeof item.source_ts === "number" ? item.source_ts : null;
    default:
      return null;
  }
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
  return isWithinLiveFeedLookback(channel, item);
};

const nextBeforeForItems = <T>(items: T[], cursorOf: (item: T) => Cursor): Cursor | null => {
  const last = items.at(-1);
  return last ? cursorOf(last) : null;
};

const candleRedisKey = (underlyingId: string, intervalMs: number): string =>
  `live:equity-candles:${underlyingId}:${intervalMs}`;

const candleCursorField = (underlyingId: string, intervalMs: number): string =>
  `equity-candles:${underlyingId}:${intervalMs}`;

const overlayRedisKey = (underlyingId: string): string => `live:equity-overlay:${underlyingId}`;
const overlayCursorField = (underlyingId: string): string => `equities:${underlyingId}`;

export class LiveStateManager {
  private readonly generic: {
    [K in LiveGenericChannel]: GenericFeedConfig;
  };
  private readonly genericItems = new Map<LiveGenericChannel, any[]>();
  private readonly genericCursors = new Map<string, Cursor | null>();
  private readonly candleItems = new Map<string, EquityCandle[]>();
  private readonly candleCursors = new Map<string, Cursor | null>();
  private readonly overlayItems = new Map<string, EquityPrint[]>();
  private readonly overlayCursors = new Map<string, Cursor | null>();
  private readonly stats = {
    genericHydrateFromRedis: 0,
    genericHydrateFromClickHouse: 0,
    trimOperations: 0,
    cacheDepthByKey: new Map<string, number>(),
    freshnessAgeMsByKey: new Map<string, number>()
  };

  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly redis: RedisLike | null,
    limits: GenericLiveLimits = resolveGenericLiveLimits()
  ) {
    this.generic = getGenericConfig(limits);
  }

  getStatsSnapshot(): {
    genericHydrateFromRedis: number;
    genericHydrateFromClickHouse: number;
    trimOperations: number;
    cacheDepthByKey: Record<string, number>;
    freshnessAgeMsByKey: Record<string, number>;
  } {
    return {
      genericHydrateFromRedis: this.stats.genericHydrateFromRedis,
      genericHydrateFromClickHouse: this.stats.genericHydrateFromClickHouse,
      trimOperations: this.stats.trimOperations,
      cacheDepthByKey: Object.fromEntries(this.stats.cacheDepthByKey),
      freshnessAgeMsByKey: Object.fromEntries(this.stats.freshnessAgeMsByKey)
    };
  }

  private updateFreshnessMetric(listKey: string, channel: LiveChannel, item: unknown, now = Date.now()): void {
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
        parseJsonList(payloads, config.parse).filter((item) =>
          isWithinLiveFeedLookback(channel, item)
        ),
        config
      );
      if (cached.length > 0) {
        this.genericItems.set(channel, cached);
        this.stats.genericHydrateFromRedis += 1;
        this.stats.cacheDepthByKey.set(config.redisKey, cached.length);
        this.updateFreshnessMetric(config.redisKey, channel, cached[0]);
        this.genericCursors.set(config.cursorField, parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, config.cursorField)));
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
      (await config.fetchRecent(this.clickhouse, config.limit)).filter((item) =>
        isWithinLiveFeedLookback(channel, item)
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
        const scoped =
          Boolean(subscription.underlying_ids?.length) || Boolean(subscription.option_contract_id);
        if (subscription.filters?.view === "raw" || scoped) {
          const storageFilters: OptionPrintQueryFilters = {
            view: subscription.filters?.view ?? "signal",
            security:
              subscription.filters?.securityTypes?.length === 1
                ? subscription.filters.securityTypes[0]
                : "all",
            nbboSides: subscription.filters?.nbboSides,
            optionTypes: subscription.filters?.optionTypes,
            minNotional: subscription.filters?.minNotional,
            underlyingIds: subscription.underlying_ids,
            optionContractId: subscription.option_contract_id,
            sinceTs: Date.now() - LIVE_FEED_LOOKBACK_MS
          };
          const items = await fetchRecentOptionPrints(
            this.clickhouse,
            this.generic.options.limit,
            undefined,
            storageFilters
          );
          return {
            subscription,
            items,
            watermark: items[0] ? { ts: items[0].ts, seq: items[0].seq } : null,
            next_before: nextBeforeForItems(items, (item) => ({ ts: item.ts, seq: item.seq }))
          };
        }

        const config = this.generic.options;
        const items = (this.genericItems.get("options") ?? []).filter((item) =>
          isWithinLiveFeedLookback("options", item) &&
          matchesOptionPrintFilters(item, subscription.filters)
        );
        return {
          subscription,
          items,
          watermark: this.genericCursors.get(config.cursorField) ?? null,
          next_before: nextBeforeForItems(items, config.cursor)
        };
      }
      case "flow": {
        const config = this.generic.flow;
        const items = (this.genericItems.get("flow") ?? []).filter((item) =>
          isWithinLiveFeedLookback("flow", item) &&
          matchesFlowPacketFilters(item, subscription.filters)
        );
        return {
          subscription,
          items,
          watermark: this.genericCursors.get(config.cursorField) ?? null,
          next_before: nextBeforeForItems(items, config.cursor)
        };
      }
      case "equities": {
        const config = this.generic.equities;
        if (subscription.underlying_ids?.length) {
          const filters: EquityPrintQueryFilters = {
            underlyingIds: subscription.underlying_ids,
            sinceTs: Date.now() - LIVE_FEED_LOOKBACK_MS
          };
          const items = await fetchRecentEquityPrints(this.clickhouse, config.limit, filters);
          return {
            subscription,
            items,
            watermark: items[0] ? { ts: items[0].ts, seq: items[0].seq } : null,
            next_before: nextBeforeForItems(items, config.cursor)
          };
        }
        const items = (this.genericItems.get("equities") ?? []).filter((item) =>
          isWithinLiveFeedLookback("equities", item)
        );
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
        const items = this.candleItems.get(key) ?? [];
        return {
          subscription,
          items,
          watermark: this.candleCursors.get(cursorField) ?? null,
          next_before: nextBeforeForItems(items, (item) => ({ ts: item.ts, seq: item.seq }))
        };
      }
      case "equity-overlay": {
        const key = overlayRedisKey(subscription.underlying_id);
        const cursorField = overlayCursorField(subscription.underlying_id);
        if (!this.overlayItems.has(key)) {
          await this.hydrateOverlay(subscription.underlying_id);
        }
        const items = this.overlayItems.get(key) ?? [];
        return {
          subscription,
          items,
          watermark: this.overlayCursors.get(cursorField) ?? null,
          next_before: nextBeforeForItems(items, (item) => ({ ts: item.ts, seq: item.seq }))
        };
      }
      default: {
        const config = this.generic[subscription.channel];
        const items = (this.genericItems.get(subscription.channel) ?? []).filter((item) =>
          isWithinLiveFeedLookback(subscription.channel, item)
        );
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
        const previousCursor = this.candleCursors.get(cursorField) ?? null;
        const items = this.candleItems.get(key) ?? [];
        const next = [candle, ...items]
          .sort((a, b) => (b.ts - a.ts) || (b.seq - a.seq))
          .slice(0, CHART_LIMITS.candles);
        this.candleItems.set(key, next);
        this.stats.cacheDepthByKey.set(key, next.length);
        const cursor = { ts: candle.ts, seq: candle.seq };
        this.candleCursors.set(cursorField, cursor);
        if (next.length > 0) {
          this.updateFreshnessMetric(key, "equity-candles", next[0]);
        }
        const outOfOrder = previousCursor ? compareCursors(cursor, previousCursor) > 0 : false;
        if (outOfOrder) {
          await this.persistList(key, cursorField, next, CHART_LIMITS.candles, cursor);
        } else {
          await this.persistItem(key, cursorField, candle, CHART_LIMITS.candles, cursor, next.length);
        }
        return cursor;
      }
      case "equity-overlay": {
        const print = EquityPrintSchema.parse(item);
        const key = overlayRedisKey(print.underlying_id);
        const cursorField = overlayCursorField(print.underlying_id);
        const previousCursor = this.overlayCursors.get(cursorField) ?? null;
        const items = this.overlayItems.get(key) ?? [];
        const next = [print, ...items]
          .sort((a, b) => (b.ts - a.ts) || (b.seq - a.seq))
          .slice(0, CHART_LIMITS.overlay);
        this.overlayItems.set(key, next);
        this.stats.cacheDepthByKey.set(key, next.length);
        const cursor = { ts: print.ts, seq: print.seq };
        this.overlayCursors.set(cursorField, cursor);
        if (next.length > 0) {
          this.updateFreshnessMetric(key, "equity-overlay", next[0]);
        }
        const outOfOrder = previousCursor ? compareCursors(cursor, previousCursor) > 0 : false;
        if (outOfOrder) {
          await this.persistList(key, cursorField, next, CHART_LIMITS.overlay, cursor);
        } else {
          await this.persistItem(key, cursorField, print, CHART_LIMITS.overlay, cursor, next.length);
        }
        return cursor;
      }
      default: {
        const config = this.generic[channel];
        const parsed = config.parse(item);
        if (!isWithinLiveFeedLookback(channel, parsed)) {
          return null;
        }
        const previousCursor = this.genericCursors.get(config.cursorField) ?? null;
        const items = this.genericItems.get(channel) ?? [];
        const next = normalizeGenericItems(channel, [parsed, ...items], config);
        this.genericItems.set(channel, next);
        this.stats.cacheDepthByKey.set(config.redisKey, next.length);
        const cursor = config.cursor(parsed);
        this.genericCursors.set(config.cursorField, cursor);
        if (next.length > 0) {
          this.updateFreshnessMetric(config.redisKey, channel, next[0]);
        }
        const outOfOrder = previousCursor ? compareCursors(cursor, previousCursor) > 0 : false;
        if (channel === "nbbo" || outOfOrder) {
          await this.persistList(config.redisKey, config.cursorField, next, config.limit, cursor);
        } else {
          await this.persistItem(config.redisKey, config.cursorField, parsed, config.limit, cursor, next.length);
        }
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
        this.stats.cacheDepthByKey.set(key, cached.length);
        this.updateFreshnessMetric(key, "equity-candles", cached[0]);
        this.candleCursors.set(cursorField, parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, cursorField)));
        return;
      }
    }

    const fresh = await fetchRecentEquityCandles(this.clickhouse, underlyingId, intervalMs, CHART_LIMITS.candles);
    this.candleItems.set(key, fresh);
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
        this.stats.cacheDepthByKey.set(key, cached.length);
        this.updateFreshnessMetric(key, "equity-overlay", cached[0]);
        this.overlayCursors.set(cursorField, parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, cursorField)));
        return;
      }
    }

    const fresh = (await fetchRecentEquityPrints(this.clickhouse, CHART_LIMITS.overlay)).filter(
      (item) => item.underlying_id === underlyingId
    );
    this.overlayItems.set(key, fresh);
    this.stats.cacheDepthByKey.set(key, fresh.length);
    if (fresh.length > 0) {
      this.updateFreshnessMetric(key, "equity-overlay", fresh[0]);
    }
    const watermark = fresh[0] ? { ts: fresh[0].ts, seq: fresh[0].seq } : null;
    this.overlayCursors.set(cursorField, watermark);
    await this.persistList(key, cursorField, fresh, CHART_LIMITS.overlay, watermark);
  }

  private async persistItem<T>(
    listKey: string,
    cursorField: string,
    item: T,
    limit: number,
    cursor: Cursor | null,
    depth: number
  ): Promise<void> {
    if (!this.redis?.isOpen) {
      return;
    }

    await this.redis.lPush(listKey, JSON.stringify(item));
    await this.redis.lTrim(listKey, 0, limit - 1);
    this.stats.trimOperations += 1;
    this.stats.cacheDepthByKey.set(listKey, Math.min(depth, limit));
    await this.redis.hSet(CURSOR_HASH_KEY, cursorField, JSON.stringify(cursor));
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

    const payloads = items.map((item) => JSON.stringify(item));
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
