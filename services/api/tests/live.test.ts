import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import { LiveStateManager, isLiveItemFresh, resolveGenericLiveLimits } from "../src/live";

const makeClickHouse = (): ClickHouseClient =>
  ({
    exec: async () => {},
    insert: async () => {},
    ping: async () => ({ success: true }),
    close: async () => {},
    query: async () => ({
      async json<T>() {
        return [] as T;
      }
    })
  }) as ClickHouseClient;

const makeRedis = () => {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();

  return {
    isOpen: true,
    async lRange(key: string, start: number, stop: number) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
    async lPush(key: string, value: string) {
      const next = lists.get(key) ?? [];
      next.unshift(value);
      lists.set(key, next);
      return next.length;
    },
    async lTrim(key: string, start: number, stop: number) {
      const next = lists.get(key) ?? [];
      lists.set(key, start > stop ? [] : next.slice(start, stop + 1));
      return "OK";
    },
    async hGet(key: string, field: string) {
      return hashes.get(key)?.get(field) ?? null;
    },
    async hSet(key: string, field: string, value: string) {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    }
  };
};

describe("LiveStateManager", () => {
  it("resolves live limits from env with clamping", () => {
    const limits = resolveGenericLiveLimits({
      LIVE_LIMIT_OPTIONS: "777",
      LIVE_LIMIT_NBBO: "200000",
      LIVE_LIMIT_FLOW: "bad"
    } as NodeJS.ProcessEnv);

    expect(limits.options).toBe(777);
    expect(limits.nbbo).toBe(100000);
    expect(limits.flow).toBe(10000);
    expect(limits["equity-quotes"]).toBe(10000);
    expect(limits.alerts).toBe(10000);
  });

  it("hydrates snapshots from redis generic windows", async () => {
    const redis = makeRedis();
    const now = Date.now();
    await redis.lPush(
      "live:flow",
      JSON.stringify({
        source_ts: now,
        ingest_ts: now + 1,
        seq: 1,
        trace_id: "flow-1",
        id: "flow-1",
        members: ["a"],
        features: {},
        join_quality: {}
      })
    );
    await redis.hSet("live:cursors", "flow", JSON.stringify({ ts: now, seq: 1 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "flow" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 1 });
    expect(snapshot.next_before).toEqual({ ts: now, seq: 1 });
  });

  it("persists parameterized candle and overlay caches on ingest", async () => {
    const redis = makeRedis();
    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.ingest("equity-candles", {
      source_ts: 100,
      ingest_ts: 101,
      seq: 1,
      trace_id: "candle:SPY:60000:100",
      ts: 100,
      interval_ms: 60000,
      underlying_id: "SPY",
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      volume: 10,
      trade_count: 1
    });
    await manager.ingest("equity-overlay", {
      source_ts: 110,
      ingest_ts: 111,
      seq: 2,
      trace_id: "eq-1",
      ts: 110,
      underlying_id: "SPY",
      price: 10,
      size: 5,
      exchange: "X",
      offExchangeFlag: true
    });

    const candleSnapshot = await manager.getSnapshot({
      channel: "equity-candles",
      underlying_id: "SPY",
      interval_ms: 60000
    });
    const overlaySnapshot = await manager.getSnapshot({
      channel: "equity-overlay",
      underlying_id: "SPY"
    });

    expect(candleSnapshot.items).toHaveLength(1);
    expect(overlaySnapshot.items).toHaveLength(1);
    expect(candleSnapshot.watermark).toEqual({ ts: 100, seq: 1 });
    expect(overlaySnapshot.watermark).toEqual({ ts: 110, seq: 2 });
  });

  it("trims generic windows to configured per-channel limits", async () => {
    const redis = makeRedis();
    const now = Date.now();
    const manager = new LiveStateManager(
      makeClickHouse(),
      redis as never,
      {
        options: 10000,
        nbbo: 10000,
        equities: 10000,
        "equity-quotes": 10000,
        "equity-joins": 10000,
        flow: 2,
        "classifier-hits": 10000,
        alerts: 10000,
        "inferred-dark": 10000
      }
    );

    await manager.ingest("flow", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "flow-1",
      id: "flow-1",
      members: ["a"],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now + 10,
      ingest_ts: now + 11,
      seq: 2,
      trace_id: "flow-2",
      id: "flow-2",
      members: ["b"],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now + 20,
      ingest_ts: now + 21,
      seq: 3,
      trace_id: "flow-3",
      id: "flow-3",
      members: ["c"],
      features: {},
      join_quality: {}
    });

    const snapshot = await manager.getSnapshot({ channel: "flow" });
    expect(snapshot.items).toHaveLength(2);
    expect((snapshot.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "flow-3",
      "flow-2"
    ]);

    const persisted = await redis.lRange("live:flow", 0, 99);
    expect(persisted).toHaveLength(2);

    const stats = manager.getStatsSnapshot();
    expect(stats.trimOperations).toBeGreaterThan(0);
    expect(stats.cacheDepthByKey["live:flow"]).toBe(2);
  });

  it("filters option and flow snapshots using subscription filters", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "opt-1",
      ts: now,
      option_contract_id: "AAPL-2025-01-17-200-C",
      price: 1,
      size: 100,
      exchange: "X",
      underlying_id: "AAPL",
      option_type: "call",
      notional: 10000,
      nbbo_side: "A",
      is_etf: false,
      signal_pass: true,
      signal_reasons: ["keep:ask-side"],
      signal_profile: "smart-money"
    });
    await manager.ingest("options", {
      source_ts: now + 10,
      ingest_ts: now + 11,
      seq: 2,
      trace_id: "opt-2",
      ts: now + 10,
      option_contract_id: "SPY-2025-01-17-500-P",
      price: 1,
      size: 100,
      exchange: "X",
      underlying_id: "SPY",
      option_type: "put",
      notional: 10000,
      nbbo_side: "B",
      is_etf: true,
      signal_pass: true,
      signal_reasons: ["keep:ask-side"],
      signal_profile: "smart-money"
    });
    await manager.ingest("flow", {
      source_ts: now + 20,
      ingest_ts: now + 21,
      seq: 3,
      trace_id: "flow-1",
      id: "flow-1",
      members: ["opt-1"],
      features: {
        option_contract_id: "AAPL-2025-01-17-200-C",
        total_notional: 10000,
        is_etf: false,
        option_type: "call",
        nbbo_a_count: 1,
        nbbo_aa_count: 0,
        nbbo_mid_count: 0,
        nbbo_b_count: 0,
        nbbo_bb_count: 0,
        nbbo_missing_count: 0,
        nbbo_stale_count: 0
      },
      join_quality: {}
    });

    const optionSnapshot = await manager.getSnapshot({
      channel: "options",
      filters: { securityTypes: ["stock"], nbboSides: ["A"], optionTypes: ["call"] }
    });
    const flowSnapshot = await manager.getSnapshot({
      channel: "flow",
      filters: { securityTypes: ["stock"], nbboSides: ["A"], optionTypes: ["call"] }
    });

    expect(optionSnapshot.items).toHaveLength(1);
    expect(flowSnapshot.items).toHaveLength(1);
  });

  it("keeps stale persisted items in live snapshots", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now - 20_000,
      ingest_ts: now - 19_999,
      seq: 1,
      trace_id: "opt-stale",
      ts: now - 20_000,
      option_contract_id: "AAPL-2025-01-17-200-C",
      price: 1,
      size: 10,
      exchange: "X"
    });
    await manager.ingest("options", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "opt-fresh",
      ts: now - 5_000,
      option_contract_id: "AAPL-2025-01-17-205-C",
      price: 1,
      size: 10,
      exchange: "X"
    });

    await manager.ingest("nbbo", {
      source_ts: now - 20_000,
      ingest_ts: now - 19_999,
      seq: 1,
      trace_id: "nbbo-stale",
      ts: now - 20_000,
      option_contract_id: "AAPL-2025-01-17-200-C",
      bid: 1,
      ask: 1.1,
      bidSize: 10,
      askSize: 10
    });
    await manager.ingest("nbbo", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "nbbo-fresh",
      ts: now - 5_000,
      option_contract_id: "AAPL-2025-01-17-205-C",
      bid: 1,
      ask: 1.1,
      bidSize: 10,
      askSize: 10
    });

    await manager.ingest("equities", {
      source_ts: now - 20_000,
      ingest_ts: now - 19_999,
      seq: 1,
      trace_id: "eq-stale",
      ts: now - 20_000,
      underlying_id: "AAPL",
      price: 100,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });
    await manager.ingest("equities", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "eq-fresh",
      ts: now - 5_000,
      underlying_id: "AAPL",
      price: 101,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });

    await manager.ingest("flow", {
      source_ts: now - 40_000,
      ingest_ts: now - 39_999,
      seq: 1,
      trace_id: "flow-stale",
      id: "flow-stale",
      members: ["opt-stale"],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "flow-fresh",
      id: "flow-fresh",
      members: ["opt-fresh"],
      features: {},
      join_quality: {}
    });

    const [optionsSnapshot, nbboSnapshot, equitiesSnapshot, flowSnapshot] = await Promise.all([
      manager.getSnapshot({ channel: "options" }),
      manager.getSnapshot({ channel: "nbbo" }),
      manager.getSnapshot({ channel: "equities" }),
      manager.getSnapshot({ channel: "flow" })
    ]);

    expect((optionsSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)).toEqual([
      "opt-fresh",
      "opt-stale"
    ]);
    expect((nbboSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)).toEqual([
      "nbbo-fresh",
      "nbbo-stale"
    ]);
    expect((equitiesSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)).toEqual([
      "eq-fresh",
      "eq-stale"
    ]);
    expect((flowSnapshot.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "flow-fresh",
      "flow-stale"
    ]);
  });

  it("keeps only the newest NBBO quote per contract across hydrate and ingest", async () => {
    const redis = makeRedis();
    const now = Date.now();

    await redis.lPush(
      "live:nbbo",
      JSON.stringify({
        source_ts: now - 2_000,
        ingest_ts: now - 1_999,
        seq: 1,
        trace_id: "nbbo-old",
        ts: now - 2_000,
        option_contract_id: "AAPL-2025-01-17-200-C",
        bid: 1,
        ask: 1.1,
        bidSize: 10,
        askSize: 10
      })
    );
    await redis.lPush(
      "live:nbbo",
      JSON.stringify({
        source_ts: now - 1_000,
        ingest_ts: now - 999,
        seq: 2,
        trace_id: "nbbo-new",
        ts: now - 1_000,
        option_contract_id: "AAPL-2025-01-17-200-C",
        bid: 1.2,
        ask: 1.3,
        bidSize: 12,
        askSize: 12
      })
    );
    await redis.lPush(
      "live:nbbo",
      JSON.stringify({
        source_ts: now - 500,
        ingest_ts: now - 499,
        seq: 3,
        trace_id: "nbbo-other",
        ts: now - 500,
        option_contract_id: "MSFT-2025-01-17-300-C",
        bid: 2,
        ask: 2.1,
        bidSize: 15,
        askSize: 15
      })
    );
    await redis.hSet("live:cursors", "nbbo", JSON.stringify({ ts: now - 500, seq: 3 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();

    await manager.ingest("nbbo", {
      source_ts: now - 250,
      ingest_ts: now - 249,
      seq: 4,
      trace_id: "nbbo-latest",
      ts: now - 250,
      option_contract_id: "AAPL-2025-01-17-200-C",
      bid: 1.4,
      ask: 1.5,
      bidSize: 14,
      askSize: 14
    });

    const snapshot = await manager.getSnapshot({ channel: "nbbo" });
    expect(snapshot.items).toHaveLength(2);
    expect(
      (snapshot.items as Array<{ option_contract_id: string; trace_id: string }>).map((item) => [
        item.option_contract_id,
        item.trace_id
      ])
    ).toEqual([
      ["AAPL-2025-01-17-200-C", "nbbo-latest"],
      ["MSFT-2025-01-17-300-C", "nbbo-other"]
    ]);
  });

  it("stores older valid ingest for freshness-gated channels", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("equities", {
      source_ts: now - 60_000,
      ingest_ts: now - 59_999,
      seq: 1,
      trace_id: "eq-stale",
      ts: now - 60_000,
      underlying_id: "AAPL",
      price: 100,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });

    const snapshot = await manager.getSnapshot({ channel: "equities" });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.next_before).toEqual({ ts: now - 60_000, seq: 1 });
  });

  it("hydrates equity quotes from redis", async () => {
    const redis = makeRedis();
    const now = Date.now();
    await redis.lPush(
      "live:equity-quotes",
      JSON.stringify({
        source_ts: now,
        ingest_ts: now + 1,
        seq: 1,
        trace_id: "quote-1",
        ts: now,
        underlying_id: "SPY",
        bid: 450,
        ask: 450.01
      })
    );
    await redis.hSet("live:cursors", "equity-quotes", JSON.stringify({ ts: now, seq: 1 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "equity-quotes" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 1 });
    expect(snapshot.next_before).toEqual({ ts: now, seq: 1 });
  });

  it("hydrates equity quotes from clickhouse when redis is empty and persists hot cache", async () => {
    const redis = makeRedis();
    const now = Date.now();
    const clickhouse = {
      ...makeClickHouse(),
      query: async ({ query }: { query: string }) => ({
        async json<T>() {
          if (query.includes("equity_quotes")) {
            return [
              {
                source_ts: now,
                ingest_ts: now + 1,
                seq: 2,
                trace_id: "quote-2",
                ts: now,
                underlying_id: "SPY",
                bid: 451,
                ask: 451.01
              }
            ] as T;
          }
          return [] as T;
        }
      })
    } as ClickHouseClient;

    const manager = new LiveStateManager(clickhouse, redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "equity-quotes" });
    const persisted = await redis.lRange("live:equity-quotes", 0, 10);

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 2 });
    expect(persisted).toHaveLength(1);
  });

  it("exposes freshness helper for event fanout gating", () => {
    expect(isLiveItemFresh("options", { ts: 1000 }, 1010)).toBe(true);
    expect(isLiveItemFresh("options", { ts: 1000 }, 20_001)).toBe(false);
    expect(isLiveItemFresh("equity-joins", { source_ts: 1 }, 1_000_000)).toBe(true);
  });
});
