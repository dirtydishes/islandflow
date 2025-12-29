import { describe, expect, it } from "bun:test";
import { alertsTableDDL, ALERTS_TABLE, fromAlertRecord, toAlertRecord } from "../src/alerts";

const alert = {
  source_ts: 10,
  ingest_ts: 20,
  seq: 1,
  trace_id: "alert:fp-1",
  score: 78,
  severity: "medium",
  hits: [
    {
      classifier_id: "large_bullish_call_sweep",
      confidence: 0.72,
      direction: "bullish",
      explanations: ["Likely call sweep.", "Premium $50000."]
    }
  ],
  evidence_refs: ["flowpacket:1", "print:1"]
};

describe("alerts storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = alertsTableDDL();
    expect(ddl).toContain(ALERTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("round-trips alert records", () => {
    const record = toAlertRecord(alert);
    const restored = fromAlertRecord(record);
    expect(restored.hits).toEqual(alert.hits);
    expect(restored.evidence_refs).toEqual(alert.evidence_refs);
    expect(restored.severity).toBe(alert.severity);
  });
});
