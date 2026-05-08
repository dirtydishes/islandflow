import { describe, expect, test } from "bun:test";
import { computeSnapshot, computeStats, RollingWindowStore } from "../src/rolling-stats";

describe("rolling stats helpers", () => {
  test("computeStats handles empty baseline", () => {
    const stats = computeStats([]);
    expect(stats.count).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.stddev).toBe(0);
  });

  test("computeStats calculates mean and stddev", () => {
    const stats = computeStats([10, 12, 14]);
    expect(stats.count).toBe(3);
    expect(stats.mean).toBe(12);
    expect(stats.stddev).toBeCloseTo(1.633, 3);
  });

  test("computeSnapshot calculates z-score against baseline", () => {
    const snapshot = computeSnapshot([10, 12, 14], 15);
    expect(snapshot.baselineCount).toBe(3);
    expect(snapshot.zscore).toBeCloseTo(1.84, 2);
  });

  test("RollingWindowStore prunes stale keys by ttl", () => {
    const store = new RollingWindowStore({
      windowSize: 3,
      ttlSeconds: 1,
      flushIntervalMs: 30_000,
      maxKeys: 10
    });

    store.update("rolling:premium:ABC", 10, 0);
    expect(store.size).toBe(1);
    expect(store.prune(1_500)).toBe(1);
    expect(store.size).toBe(0);
  });
});
