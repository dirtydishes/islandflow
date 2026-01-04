import { describe, expect, it } from "bun:test";
import {
  equityQuotesTableDDL,
  EQUITY_QUOTES_TABLE,
  normalizeEquityQuote
} from "../src/equity-quotes";

const baseQuote = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  underlying_id: "SPY",
  bid: 450.1,
  ask: 450.2
};

describe("equity-quotes storage helpers", () => {
  it("keeps required fields intact", () => {
    const normalized = normalizeEquityQuote(baseQuote);
    expect(normalized).toEqual(baseQuote);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = equityQuotesTableDDL();
    expect(ddl).toContain(EQUITY_QUOTES_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
