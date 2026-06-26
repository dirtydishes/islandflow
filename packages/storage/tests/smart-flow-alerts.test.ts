import { describe, expect, it } from "bun:test";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import {
  fromSmartFlowAlertRecord,
  SMART_FLOW_ALERTS_TABLE,
  smartFlowAlertsTableDDL,
  toSmartFlowAlertRecord
} from "../src/smart-flow-alerts";

const makeAlert = () => {
  const projection = smartFlowExplainabilityFromHypothesisEvent({
    source_ts: 1_000,
    ingest_ts: 1_010,
    seq: 12,
    trace_id: "smartflow:hypothesis:cluster:SPY:0:60000",
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: "smartflow:hypothesis:cluster:SPY:0:60000",
    hypothesis_id: "hypothesis:cluster:SPY:0:60000",
    cluster_id: "cluster:SPY:0:60000",
    candidate_ids: ["candidate:flowpacket:1"],
    underlying_id: "SPY",
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: "directional_accumulation",
      direction: "bullish",
      evidence_strength: 0.8,
      fit_score: 0.72,
      penalty_score: 0,
      penalties: [],
      confidence: {
        policy_confidence: 0.76,
        evidence_quality: 0.84,
        hypothesis_margin: 0.28,
        conviction: 0.72,
        calibration_version: null
      }
    },
    alternatives: [],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: ["flowpacket:1", "print:1"],
    generated_from: "flow_evidence_cluster"
  });
  const alert = smartFlowAlertFromProjection(projection);
  if (!alert) {
    throw new Error("expected non-abstained projection to derive an alert");
  }
  return alert;
};

describe("smart-flow alert storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = smartFlowAlertsTableDDL();

    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
    expect(ddl).toContain(SMART_FLOW_ALERTS_TABLE);
    expect(ddl).toContain("alert_json String");
    expect(ddl).toContain("ORDER BY (source_ts, seq, alert_id)");
  });

  it("round-trips canonical alerts while exposing query columns", () => {
    const alert = makeAlert();
    const record = toSmartFlowAlertRecord(alert);

    expect(record.alert_id).toBe(alert.alert_id);
    expect(record.hypothesis_id).toBe(alert.hypothesis_id);
    expect(record.insight_id).toBe(alert.insight_id);
    expect(record.underlying_id).toBe("SPY");
    expect(record.policy_confidence).toBe(0.76);
    expect(record.evidence_quality).toBe(0.84);
    expect(record.trigger_kind).toBe("non_abstained_hypothesis");
    expect(record.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
    expect(fromSmartFlowAlertRecord(record)).toEqual(alert);
  });
});
