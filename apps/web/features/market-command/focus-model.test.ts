import { describe, expect, it } from "bun:test";
import { createBoardTickerFocus, normalizeBoardTickerSymbol } from "./focus-model";

describe("market-command focus model", () => {
  it("normalizes board ticker focus symbols", () => {
    expect(normalizeBoardTickerSymbol(" nvda ")).toBe("NVDA");
    expect(normalizeBoardTickerSymbol("brk.b")).toBe("BRK.B");
    expect(normalizeBoardTickerSymbol("aapl/us")).toBe("AAPLUS");
    expect(normalizeBoardTickerSymbol("   ")).toBeNull();
  });

  it("keeps the source attached to a normalized focus request", () => {
    expect(createBoardTickerFocus("tsla", "ticker-rail")).toEqual({
      symbol: "TSLA",
      source: "ticker-rail"
    });
  });
});
