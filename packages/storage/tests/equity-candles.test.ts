import { describe, expect, it } from "bun:test";
import {
  equityCandlesTableDDL,
  EQUITY_CANDLES_TABLE,
  normalizeEquityCandle
} from "../src/equity-candles";

const baseCandle = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 3,
  trace_id: "candle:SPY:1000:0",
  ts: 0,
  interval_ms: 1000,
  underlying_id: "SPY",
  open: 450,
  high: 451.5,
  low: 449.25,
  close: 450.75,
  volume: 1200,
  trade_count: 15
};

describe("equity-candles storage helpers", () => {
  it("keeps required fields intact", () => {
    const normalized = normalizeEquityCandle(baseCandle);
    expect(normalized).toEqual(baseCandle);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = equityCandlesTableDDL();
    expect(ddl).toContain(EQUITY_CANDLES_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
