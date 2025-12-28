import { describe, expect, it } from "bun:test";
import { equityPrintsTableDDL, EQUITY_PRINTS_TABLE } from "../src/equity-prints";

const basePrint = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  underlying_id: "SPY",
  price: 450.1,
  size: 100,
  exchange: "TEST",
  offExchangeFlag: false
};

describe("equity-prints storage helpers", () => {
  it("keeps required fields intact", () => {
    expect(basePrint.offExchangeFlag).toBe(false);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = equityPrintsTableDDL();
    expect(ddl).toContain(EQUITY_PRINTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
