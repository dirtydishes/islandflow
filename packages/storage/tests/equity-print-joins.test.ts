import { describe, expect, it } from "bun:test";
import {
  equityPrintJoinsTableDDL,
  EQUITY_PRINT_JOINS_TABLE,
  fromEquityPrintJoinRecord,
  toEquityPrintJoinRecord
} from "../src/equity-print-joins";

const join = {
  source_ts: 100,
  ingest_ts: 120,
  seq: 1,
  trace_id: "equityjoin:trace-1",
  id: "equityjoin:trace-1",
  print_trace_id: "trace-1",
  quote_trace_id: "quote-1",
  features: {
    underlying_id: "SPY",
    price: 450.12,
    size: 200,
    off_exchange_flag: true,
    quote_placement: "A"
  },
  join_quality: {
    quote_age_ms: 15
  }
};

describe("equity-print-joins storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = equityPrintJoinsTableDDL();
    expect(ddl).toContain(EQUITY_PRINT_JOINS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("round-trips equity print join records", () => {
    const record = toEquityPrintJoinRecord(join);
    const restored = fromEquityPrintJoinRecord(record);
    expect(restored.features).toEqual(join.features);
    expect(restored.join_quality).toEqual(join.join_quality);
  });
});
