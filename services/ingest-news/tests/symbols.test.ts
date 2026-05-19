import { describe, expect, it } from "bun:test";
import { resolveNewsSymbols } from "../src/symbols";

describe("resolveNewsSymbols", () => {
  it("prefers provider symbols when present", () => {
    const result = resolveNewsSymbols(["tsla", "aapl"], "<p>No extra tickers here.</p>");
    expect(result.provider_symbols).toEqual(["TSLA", "AAPL"]);
    expect(result.resolved_symbols).toEqual(["TSLA", "AAPL"]);
    expect(result.symbol_resolution).toBe("provider");
  });

  it("falls back to ticker anchors", () => {
    const result = resolveNewsSymbols([], '<a href="/quote/TSLA">TSLA</a>');
    expect(result.resolved_symbols).toEqual(["TSLA"]);
    expect(result.symbol_resolution).toBe("derived");
  });

  it("falls back to exchange and dollar patterns", () => {
    const result = resolveNewsSymbols([], "<p>NASDAQ:TSLA met with $IBM executives.</p>");
    expect(result.resolved_symbols).toEqual(["TSLA", "IBM"]);
    expect(result.symbol_resolution).toBe("derived");
  });

  it("dedupes and uppercases merged symbols", () => {
    const result = resolveNewsSymbols(["tsla"], "<p>$TSLA and NASDAQ:TSLA</p>");
    expect(result.provider_symbols).toEqual(["TSLA"]);
    expect(result.resolved_symbols).toEqual(["TSLA"]);
    expect(result.symbol_resolution).toBe("mixed");
  });
});
