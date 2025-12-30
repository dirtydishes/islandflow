import { describe, expect, it } from "bun:test";
import { normalizeOptionNBBO, optionNBBOTableDDL, OPTION_NBBO_TABLE } from "../src/option-nbbo";

const baseNbbo = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  option_contract_id: "SPY-2025-01-17-450-C",
  bid: 1.2,
  ask: 1.3,
  bidSize: 10,
  askSize: 12
};

describe("option-nbbo storage helpers", () => {
  it("keeps required fields intact", () => {
    const normalized = normalizeOptionNBBO(baseNbbo);
    expect(normalized).toEqual(baseNbbo);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = optionNBBOTableDDL();
    expect(ddl).toContain(OPTION_NBBO_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
