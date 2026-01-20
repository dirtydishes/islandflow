import { describe, expect, test } from "bun:test";
import { inferOffExchangeFlag } from "../src/adapters/alpaca";

describe("alpaca equities adapter helpers", () => {
  test("inferOffExchangeFlag tags FINRA/TRF venues as off-exchange", () => {
    const map = new Map<string, string>([
      ["D", "FINRA / Nasdaq TRF"],
      ["N", "FINRA / NYSE TRF"],
      ["Q", "NASDAQ"],
      ["P", "NYSE ARCA"],
      ["O", "OTC Markets"]
    ]);

    expect(inferOffExchangeFlag("D", map)).toBe(true);
    expect(inferOffExchangeFlag("N", map)).toBe(true);
    expect(inferOffExchangeFlag("O", map)).toBe(true);
    expect(inferOffExchangeFlag("Q", map)).toBe(false);
    expect(inferOffExchangeFlag("P", map)).toBe(false);
  });

  test("inferOffExchangeFlag falls back conservatively when no mapping", () => {
    const empty = new Map<string, string>();

    expect(inferOffExchangeFlag(undefined, empty)).toBe(false);
    expect(inferOffExchangeFlag("", empty)).toBe(false);
    expect(inferOffExchangeFlag("D", empty)).toBe(true);
    expect(inferOffExchangeFlag("N", empty)).toBe(false);
  });
});
