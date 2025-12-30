import { describe, expect, test } from "bun:test";
import { computeSnapshot, computeStats } from "../src/rolling-stats";

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
});
