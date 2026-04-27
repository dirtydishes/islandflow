import {
  fetchRecentAlerts,
  fetchRecentClassifierHits,
  fetchRecentEquityCandles,
  fetchRecentEquityPrintJoins,
  fetchRecentEquityPrints,
  fetchRecentFlowPackets,
  fetchRecentInferredDark,
  fetchRecentOptionNBBO,
  fetchRecentOptionPrints,
  type ClickHouseClient
} from "@islandflow/storage";
import {
  AlertEventSchema,
  ClassifierHitEventSchema,
  CursorSchema,
  EquityCandleSchema,
  EquityPrintJoinSchema,
  EquityPrintSchema,
  FeedSnapshot,
  FlowPacketSchema,
  InferredDarkEventSchema,
  LiveGenericChannel,
  LiveSubscription,
  OptionNBBOSchema,
  OptionPrintSchema,
  type Cursor,
  type EquityCandle,
  type EquityPrint,
  type LiveChannel
} from "@islandflow/types";
import type { RedisClientType } from "redis";

const CURSOR_HASH_KEY = "live:cursors";

const GENERIC_LIMITS = {
  options: 500,
  nbbo: 500,
  equities: 500,
  "equity-joins": 500,
  flow: 500,
  "classifier-hits": 500,
  alerts: 500,
  "inferred-dark": 500
} as const;

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

const getGenericConfig = (): {
  [K in LiveGenericChannel]: GenericFeedConfig;
} => ({
  options: {
    redisKey: "live:options",
    cursorField: "options",
    limit: GENERIC_LIMITS.options,
    parse: (value) => OptionPrintSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: fetchRecentOptionPrints
  },
  nbbo: {
    redisKey: "live:nbbo",
    cursorField: "nbbo",
    limit: GENERIC_LIMITS.nbbo,
    parse: (value) => OptionNBBOSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: fetchRecentOptionNBBO
  },
  equities: {
    redisKey: "live:equities",
    cursorField: "equities",
    limit: GENERIC_LIMITS.equities,
    parse: (value) => EquityPrintSchema.parse(value),
    cursor: (item) => ({ ts: item.ts, seq: item.seq }),
    fetchRecent: fetchRecentEquityPrints
  },
  "equity-joins": {
    redisKey: "live:equity-joins",
    cursorField: "equity-joins",
    limit: GENERIC_LIMITS["equity-joins"],
    parse: (value) => EquityPrintJoinSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentEquityPrintJoins
  },
  flow: {
    redisKey: "live:flow",
    cursorField: "flow",
    limit: GENERIC_LIMITS.flow,
    parse: (value) => FlowPacketSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentFlowPackets
  },
  "classifier-hits": {
    redisKey: "live:classifier-hits",
    cursorField: "classifier-hits",
    limit: GENERIC_LIMITS["classifier-hits"],
    parse: (value) => ClassifierHitEventSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentClassifierHits
  },
  alerts: {
    redisKey: "live:alerts",
    cursorField: "alerts",
    limit: GENERIC_LIMITS.alerts,
    parse: (value) => AlertEventSchema.parse(value),
    cursor: (item) => ({ ts: item.source_ts, seq: item.seq }),
    fetchRecent: fetchRecentAlerts
  },
  "inferred-dark": {
    redisKey: "live:inferred-dark",
    cursorField: "inferred-dark",
    limit: GENERIC_LIMITS["inferred-dark"],
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
  private readonly generic = getGenericConfig();
  private readonly genericItems = new Map<LiveGenericChannel, any[]>();
  private readonly genericCursors = new Map<string, Cursor | null>();
  private readonly candleItems = new Map<string, EquityCandle[]>();
  private readonly candleCursors = new Map<string, Cursor | null>();
  private readonly overlayItems = new Map<string, EquityPrint[]>();
  private readonly overlayCursors = new Map<string, Cursor | null>();

  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly redis: RedisLike | null
  ) {}

  async hydrate(): Promise<void> {
    const channels = Object.keys(this.generic) as LiveGenericChannel[];
    await Promise.all(channels.map((channel) => this.hydrateGeneric(channel)));
  }

  private async hydrateGeneric(channel: LiveGenericChannel): Promise<void> {
    const config = this.generic[channel];
    if (this.redis?.isOpen) {
      const payloads = await this.redis.lRange(config.redisKey, 0, config.limit - 1);
      const cached = parseJsonList(payloads, config.parse);
      if (cached.length > 0) {
        this.genericItems.set(channel, cached);
        this.genericCursors.set(config.cursorField, parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, config.cursorField)));
        return;
      }
    }

    const fresh = await config.fetchRecent(this.clickhouse, config.limit);
    this.genericItems.set(channel, fresh);
    const watermark = fresh[0] ? config.cursor(fresh[0]) : null;
    this.genericCursors.set(config.cursorField, watermark);
    await this.persistList(config.redisKey, config.cursorField, fresh, config.limit, watermark);
  }

  async getSnapshot(subscription: LiveSubscription): Promise<FeedSnapshot<unknown>> {
    switch (subscription.channel) {
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
        const items = this.genericItems.get(subscription.channel) ?? [];
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
        const items = this.candleItems.get(key) ?? [];
        const next = [candle, ...items]
          .sort((a, b) => (b.ts - a.ts) || (b.seq - a.seq))
          .slice(0, CHART_LIMITS.candles);
        this.candleItems.set(key, next);
        const cursor = { ts: candle.ts, seq: candle.seq };
        this.candleCursors.set(cursorField, cursor);
        await this.persistList(key, cursorField, next, CHART_LIMITS.candles, cursor);
        return cursor;
      }
      case "equity-overlay": {
        const print = EquityPrintSchema.parse(item);
        const key = overlayRedisKey(print.underlying_id);
        const cursorField = overlayCursorField(print.underlying_id);
        const items = this.overlayItems.get(key) ?? [];
        const next = [print, ...items]
          .sort((a, b) => (b.ts - a.ts) || (b.seq - a.seq))
          .slice(0, CHART_LIMITS.overlay);
        this.overlayItems.set(key, next);
        const cursor = { ts: print.ts, seq: print.seq };
        this.overlayCursors.set(cursorField, cursor);
        await this.persistList(key, cursorField, next, CHART_LIMITS.overlay, cursor);
        return cursor;
      }
      default: {
        const config = this.generic[channel];
        const parsed = config.parse(item);
        const items = this.genericItems.get(channel) ?? [];
        const next = [parsed, ...items]
          .sort((a, b) => {
            const aCursor = config.cursor(a);
            const bCursor = config.cursor(b);
            return (bCursor.ts - aCursor.ts) || (bCursor.seq - aCursor.seq);
          })
          .slice(0, config.limit);
        this.genericItems.set(channel, next);
        const cursor = config.cursor(parsed);
        this.genericCursors.set(config.cursorField, cursor);
        await this.persistList(config.redisKey, config.cursorField, next, config.limit, cursor);
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
        this.candleCursors.set(cursorField, parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, cursorField)));
        return;
      }
    }

    const fresh = await fetchRecentEquityCandles(this.clickhouse, underlyingId, intervalMs, CHART_LIMITS.candles);
    this.candleItems.set(key, fresh);
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
        this.overlayCursors.set(cursorField, parseCursor(await this.redis.hGet(CURSOR_HASH_KEY, cursorField)));
        return;
      }
    }

    const fresh = (await fetchRecentEquityPrints(this.clickhouse, CHART_LIMITS.overlay)).filter(
      (item) => item.underlying_id === underlyingId
    );
    this.overlayItems.set(key, fresh);
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

    const payloads = items.map((item) => JSON.stringify(item));
    await this.redis.lTrim(listKey, 1, 0);
    if (payloads.length > 0) {
      for (let idx = payloads.length - 1; idx >= 0; idx -= 1) {
        const payload = payloads[idx];
        if (payload) {
          await this.redis.lPush(listKey, payload);
        }
      }
      await this.redis.lTrim(listKey, 0, limit - 1);
    }
    await this.redis.hSet(CURSOR_HASH_KEY, cursorField, JSON.stringify(cursor));
  }
}
