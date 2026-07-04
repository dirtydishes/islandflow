import { describe, expect, it } from "bun:test";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  SMART_FLOW_ALERT_EVIDENCE_LOOKUP_PATH,
  SmartFlowAlertEvidenceBundleSchema,
  SmartFlowAlertEvidenceLookupRequestSchema,
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

  it("does not derive alerts from nested-abstained or non-cluster projections", () => {
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
          abstention: {
            abstained: true,
            reasons: ["below_policy_threshold"],
            source_reasons: ["nested insight abstained"]
          }
        }
      })
    ).toBeNull();

    expect(
      smartFlowAlertFromProjection({
        ...projection,
        hypothesis: {
          ...projection.hypothesis,
          generated_from: "synthetic_fixture"
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

  it("parses typed evidence lookup requests and every evidence item variant", () => {
    expect(SMART_FLOW_ALERT_EVIDENCE_LOOKUP_PATH).toBe("/lookup/smart-flow-alert-evidence");
    expect(
      SmartFlowAlertEvidenceLookupRequestSchema.parse({
        alert_id: " alert:1 ",
        refs: [" flowpacket:1 ", "print:1"]
      })
    ).toEqual({
      alert_id: "alert:1",
      refs: ["flowpacket:1", "print:1"]
    });

    const packet = {
      source_ts: 1,
      ingest_ts: 2,
      seq: 3,
      trace_id: "flowpacket:1",
      id: "flowpacket:1",
      members: ["print:1"],
      features: {},
      join_quality: {}
    };
    const optionPrint = {
      source_ts: 1,
      ingest_ts: 2,
      seq: 4,
      trace_id: "print:1",
      ts: 1,
      option_contract_id: "SPY-2026-06-22-555-C",
      price: 1.25,
      size: 10,
      exchange: "TEST"
    };
    const optionNbbo = {
      source_ts: 1,
      ingest_ts: 2,
      seq: 5,
      trace_id: "nbbo:1",
      ts: 1,
      option_contract_id: "SPY-2026-06-22-555-C",
      bid: 1.2,
      ask: 1.3,
      bidSize: 10,
      askSize: 12
    };
    const equityQuote = {
      source_ts: 1,
      ingest_ts: 2,
      seq: 6,
      trace_id: "quote:1",
      ts: 1,
      underlying_id: "SPY",
      bid: 450.1,
      ask: 450.2
    };
    const equityPrint = {
      source_ts: 1,
      ingest_ts: 2,
      seq: 7,
      trace_id: "equity:1",
      ts: 1,
      underlying_id: "SPY",
      price: 450.15,
      size: 100,
      exchange: "TEST",
      offExchangeFlag: false
    };

    const bundle = SmartFlowAlertEvidenceBundleSchema.parse({
      alert_id: "alert:1",
      items: [
        { kind: "flow_packet", ref: "flowpacket:1", packet },
        { kind: "option_print", ref: "print:1", print: optionPrint },
        { kind: "option_nbbo", ref: "option-nbbo:SPY-2026-06-22-555-C:1", nbbo: optionNbbo },
        { kind: "equity_quote", ref: "equity-quote:SPY:1", quote: equityQuote },
        { kind: "equity_print", ref: "equity-print:equity:1", print: equityPrint },
        {
          kind: "synthetic_label",
          ref: "synthetic-label:scenario:large-call",
          label: {
            label_type: "scenario",
            label_id: "large-call",
            context: ["large-call"]
          }
        },
        {
          kind: "external_context",
          ref: "news-story:42",
          context: { source: "news-story", id: "42" }
        },
        {
          kind: "unresolved",
          ref: "option-nbbo:missing:not-a-ts",
          inferred_kind: "option_nbbo",
          reason: "malformed_ref"
        },
        {
          kind: "unresolved",
          ref: "print:missing",
          inferred_kind: "option_print",
          reason: "not_found"
        },
        {
          kind: "unresolved",
          ref: "legacy-alert:1",
          inferred_kind: "unknown",
          reason: "unsupported_ref"
        }
      ]
    });

    expect(bundle.items.map((item) => item.kind)).toEqual([
      "flow_packet",
      "option_print",
      "option_nbbo",
      "equity_quote",
      "equity_print",
      "synthetic_label",
      "external_context",
      "unresolved",
      "unresolved",
      "unresolved"
    ]);
  });
});
