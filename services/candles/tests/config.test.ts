import { describe, expect, test } from "bun:test";
import { DEFAULT_CANDLE_INTERVALS_ENV, DEFAULT_CANDLE_INTERVALS_MS } from "../src/config";

describe("candle service config", () => {
  test("defaults to 1m, 5m, and 15m candle intervals", () => {
    expect(DEFAULT_CANDLE_INTERVALS_MS).toEqual([60_000, 300_000, 900_000]);
    expect(DEFAULT_CANDLE_INTERVALS_ENV).toBe("60000,300000,900000");
  });
});
