import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import { LiveStateManager } from "../src/live";

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
  it("hydrates snapshots from redis generic windows", async () => {
    const redis = makeRedis();
    await redis.lPush(
      "live:flow",
      JSON.stringify({
        source_ts: 100,
        ingest_ts: 101,
        seq: 1,
        trace_id: "flow-1",
        id: "flow-1",
        members: ["a"],
        features: {},
        join_quality: {}
      })
    );
    await redis.hSet("live:cursors", "flow", JSON.stringify({ ts: 100, seq: 1 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "flow" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: 100, seq: 1 });
    expect(snapshot.next_before).toEqual({ ts: 100, seq: 1 });
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
});
