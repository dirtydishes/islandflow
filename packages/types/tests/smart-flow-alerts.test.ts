import { describe, expect, it } from "bun:test";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  SmartFlowAlertEventSchema,
  type SmartFlowExplainabilityProjection,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "../src";

const makeProjection = (
  overrides: Partial<SmartFlowExplainabilityProjection["hypothesis"]> = {}
): SmartFlowExplainabilityProjection =>
  smartFlowExplainabilityFromHypothesisEvent({
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
    generated_from: "flow_evidence_cluster",
    ...overrides
  });

describe("smart-flow alert contracts", () => {
  it("derives canonical alerts from non-abstained smart-flow projections", () => {
    const projection = makeProjection();
    const alert = smartFlowAlertFromProjection(projection);

    expect(alert).not.toBeNull();
    expect(alert?.schema_version).toBe(SMART_FLOW_CONTRACT_VERSION);
    expect(alert?.alert_id).toBe(`smartflow:alert:${projection.refs.hypothesis_id}`);
    expect(alert?.hypothesis_id).toBe(projection.refs.hypothesis_id);
    expect(alert?.insight_id).toBe(projection.refs.insight_id);
    expect(alert?.underlying_id).toBe("SPY");
    expect(alert?.hypothesis_type).toBe("directional_accumulation");
    expect(alert?.direction).toBe("bullish");
    expect(alert?.policy_confidence).toBe(0.76);
    expect(alert?.evidence_quality).toBe(0.84);
    expect(alert?.trigger.kind).toBe("non_abstained_hypothesis");
    expect(alert?.projection).toEqual(projection);
    expect(alert?.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
    expect(SmartFlowAlertEventSchema.parse(alert)).toEqual(alert);
    expect(alert).not.toHaveProperty("score");
    expect(alert).not.toHaveProperty("severity");
    expect(alert).not.toHaveProperty("hits");
  });

  it("does not derive alerts from abstained smart-flow projections", () => {
    const projection = makeProjection({
      hypothesis_type: "unclear",
      direction: "unknown",
      abstention: {
        abstained: true,
        reasons: ["below_policy_threshold"],
        source_reasons: ["policy confidence below threshold"]
      }
    });

    expect(smartFlowAlertFromProjection(projection)).toBeNull();
  });

  it("does not derive alerts from nested-abstained or compatibility projections", () => {
    const projection = makeProjection();

    expect(
      smartFlowAlertFromProjection({
        ...projection,
        hypothesis: {
          ...projection.hypothesis,
          abstention: {
            abstained: true,
            reasons: ["below_policy_threshold"],
            source_reasons: ["nested hypothesis abstained"]
          }
        }
      })
    ).toBeNull();

    expect(
      smartFlowAlertFromProjection({
        ...projection,
        insight: {
          ...projection.insight,
          compatibility: {
            compatibility_only: true,
            legacy_event_id: "legacy:event:1",
            legacy_channel: "smart-money"
          }
        }
      })
    ).toBeNull();

    expect(
      smartFlowAlertFromProjection({
        ...projection,
        hypothesis: {
          ...projection.hypothesis,
          generated_from: "legacy_smart_money_event",
          compatibility: {
            compatibility_only: true,
            legacy_event_id: "legacy:event:1",
            legacy_channel: "smart-money"
          }
        }
      })
    ).toBeNull();
  });

  it("rejects alerts whose denormalized fields drift from the source projection", () => {
    const projection = makeProjection();
    const alert = smartFlowAlertFromProjection(projection);
    if (!alert) {
      throw new Error("expected non-abstained projection to derive an alert");
    }

    expect(
      SmartFlowAlertEventSchema.safeParse({
        ...alert,
        hypothesis_id: "hypothesis:other"
      }).success
    ).toBe(false);
    expect(
      SmartFlowAlertEventSchema.safeParse({
        ...alert,
        evidence_refs: ["flowpacket:other"]
      }).success
    ).toBe(false);
    expect(
      SmartFlowAlertEventSchema.safeParse({
        ...alert,
        trigger: {
          ...alert.trigger,
          projection_trace_id: "smartflow:hypothesis:other"
        }
      }).success
    ).toBe(false);
  });

  it("rejects malformed legacy alert payloads and legacy keys on canonical alerts", () => {
    const projection = makeProjection();
    const alert = smartFlowAlertFromProjection(projection);
    if (!alert) {
      throw new Error("expected non-abstained projection to derive an alert");
    }

    expect(
      SmartFlowAlertEventSchema.safeParse({
        source_ts: 1,
        ingest_ts: 2,
        seq: 3,
        trace_id: "alert:legacy",
        score: 91,
        severity: "high",
        hits: [],
        evidence_refs: ["flowpacket:1"]
      }).success
    ).toBe(false);
    expect(
      SmartFlowAlertEventSchema.safeParse({
        ...alert,
        score: 91,
        severity: "high",
        hits: []
      }).success
    ).toBe(false);
  });
});
