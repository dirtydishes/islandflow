import { describe, expect, it } from "bun:test";
import {
  fromInferredDarkRecord,
  inferredDarkTableDDL,
  INFERRED_DARK_TABLE,
  toInferredDarkRecord
} from "../src/inferred-dark";

const event = {
  source_ts: 100,
  ingest_ts: 120,
  seq: 1,
  trace_id: "dark:absorbed:join-1",
  type: "absorbed_block",
  confidence: 0.62,
  evidence_refs: ["equityjoin:print-1"]
};

describe("inferred-dark storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = inferredDarkTableDDL();
    expect(ddl).toContain(INFERRED_DARK_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("round-trips inferred dark records", () => {
    const record = toInferredDarkRecord(event);
    const restored = fromInferredDarkRecord(record);
    expect(restored.evidence_refs).toEqual(event.evidence_refs);
    expect(restored.type).toBe(event.type);
    expect(restored.confidence).toBeCloseTo(event.confidence, 4);
  });
});
