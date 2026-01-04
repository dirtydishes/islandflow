import { describe, expect, it } from "bun:test";
import { buildEquityPrintJoin, classifyQuotePlacement } from "../src/equity-joins";

const basePrint = {
  source_ts: 100,
  ingest_ts: 110,
  seq: 1,
  trace_id: "print-1",
  ts: 100,
  underlying_id: "SPY",
  price: 100,
  size: 50,
  exchange: "TEST",
  offExchangeFlag: false
};

const baseQuote = {
  source_ts: 95,
  ingest_ts: 105,
  seq: 2,
  trace_id: "quote-1",
  ts: 98,
  underlying_id: "SPY",
  bid: 99.9,
  ask: 100.1
};

describe("equity join helpers", () => {
  it("classifies placements with stale and missing quotes", () => {
    const missing = classifyQuotePlacement(basePrint.price, {
      quote: null,
      ageMs: 1500,
      stale: true
    });
    const stale = classifyQuotePlacement(basePrint.price, {
      quote: baseQuote,
      ageMs: 1500,
      stale: true
    });

    expect(missing).toBe("MISSING");
    expect(stale).toBe("STALE");
  });

  it("builds join payloads with quote features when fresh", () => {
    const join = buildEquityPrintJoin(basePrint, {
      quote: baseQuote,
      ageMs: 5,
      stale: false
    });

    expect(join.id).toBe("equityjoin:print-1");
    expect(join.quote_trace_id).toBe("quote-1");
    expect(join.join_quality.quote_age_ms).toBe(5);
    expect(join.features.quote_bid).toBe(99.9);
    expect(join.features.quote_ask).toBe(100.1);
    expect(join.features.quote_mid).toBeCloseTo(100, 2);
    expect(join.features.quote_spread).toBeCloseTo(0.2, 2);
  });

  it("marks missing quotes in join quality", () => {
    const join = buildEquityPrintJoin(basePrint, {
      quote: null,
      ageMs: 2000,
      stale: true
    });

    expect(join.quote_trace_id).toBe("");
    expect(join.join_quality.quote_missing).toBe(1);
    expect(join.features.quote_placement).toBe("MISSING");
  });
});
