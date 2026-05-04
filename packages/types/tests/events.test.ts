import { describe, expect, it } from "bun:test";
import { OptionPrintSchema } from "../src/events";

describe("event schemas", () => {
  it("accepts option print execution context fields", () => {
    const parsed = OptionPrintSchema.parse({
      source_ts: 100,
      ingest_ts: 101,
      seq: 1,
      trace_id: "trace-1",
      ts: 100,
      option_contract_id: "SPY-2025-01-17-450-C",
      price: 1.25,
      size: 10,
      exchange: "TEST",
      execution_nbbo_bid: 1.2,
      execution_nbbo_ask: 1.3,
      execution_nbbo_mid: 1.25,
      execution_nbbo_spread: 0.1,
      execution_nbbo_bid_size: 20,
      execution_nbbo_ask_size: 30,
      execution_nbbo_ts: 99,
      execution_nbbo_age_ms: 1,
      execution_nbbo_side: "MID",
      execution_underlying_spot: 450.05,
      execution_underlying_bid: 450,
      execution_underlying_ask: 450.1,
      execution_underlying_mid: 450.05,
      execution_underlying_spread: 0.1,
      execution_underlying_ts: 98,
      execution_underlying_age_ms: 2,
      execution_underlying_source: "equity_quote_mid",
      execution_iv: 0.42,
      execution_iv_source: "synthetic_pressure_model"
    });

    expect(parsed.execution_nbbo_side).toBe("MID");
    expect(parsed.execution_underlying_spot).toBe(450.05);
    expect(parsed.execution_iv_source).toBe("synthetic_pressure_model");
  });
});
