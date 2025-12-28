import { describe, expect, it } from "bun:test";
import { normalizeOptionPrint, optionPrintsTableDDL, OPTION_PRINTS_TABLE } from "../src/option-prints";

const basePrint = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  option_contract_id: "SPY-2025-01-17-450-C",
  price: 1.25,
  size: 10,
  exchange: "TEST"
};

describe("option-prints storage helpers", () => {
  it("normalizes missing conditions to empty array", () => {
    const normalized = normalizeOptionPrint(basePrint);
    expect(normalized.conditions).toEqual([]);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = optionPrintsTableDDL();
    expect(ddl).toContain(OPTION_PRINTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
