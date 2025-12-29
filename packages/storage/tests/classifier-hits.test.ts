import { describe, expect, it } from "bun:test";
import {
  classifierHitsTableDDL,
  CLASSIFIER_HITS_TABLE,
  fromClassifierHitRecord,
  toClassifierHitRecord
} from "../src/classifier-hits";

const hit = {
  source_ts: 10,
  ingest_ts: 20,
  seq: 1,
  trace_id: "classifier:large_bullish_call_sweep:fp-1",
  classifier_id: "large_bullish_call_sweep",
  confidence: 0.72,
  direction: "bullish",
  explanations: ["Likely call sweep.", "Premium $50000."]
};

describe("classifier hits storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = classifierHitsTableDDL();
    expect(ddl).toContain(CLASSIFIER_HITS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("round-trips classifier hit records", () => {
    const record = toClassifierHitRecord(hit);
    const restored = fromClassifierHitRecord(record);
    expect(restored.explanations).toEqual(hit.explanations);
    expect(restored.classifier_id).toBe(hit.classifier_id);
    expect(restored.direction).toBe(hit.direction);
  });
});
