import { describe, expect, it } from "bun:test";
import {
  FlowCandidateSchema,
  FlowEvidenceClusterSchema,
  FlowHypothesisEventSchema,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  SMART_FLOW_MODEL_VERSION,
  SMART_FLOW_POLICY_VERSION,
  SmartFlowExplainabilityProjectionSchema,
  SmartFlowInsightSchema,
  smartFlowExplainabilityFromHypothesisEvent,
  smartFlowInsightFromHypothesisEvent
} from "../src/smart-flow";

const observationRef = {
  observation_id: "packet:1",
  kind: "flow_packet" as const,
  role: "anchor" as const,
  source_ts: 10,
  trace_id: "flowpacket:1"
};

const evidenceQuality = {
  schema_version: SMART_FLOW_CONTRACT_VERSION,
  grade: "strong" as const,
  quality_score: 0.9,
  coverage_ratio: 0.95,
  stale_ratio: 0.02,
  completeness_score: 0.95,
  caveats: []
};

describe("smart-flow contracts", () => {
  it("parses candidates and evidence clusters with explicit versions", () => {
    const candidate = FlowCandidateSchema.parse({
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      candidate_id: "candidate:flowpacket:1",
      underlying_id: "SPY",
      observed_at_ts: 10,
      packet_ids: ["flowpacket:1"],
      member_print_ids: ["print:1"],
      observation_refs: [observationRef],
      feature_vector: {
        total_premium: 75_000,
        directional: true,
        note: "observed fact"
      },
      baseline_snapshot: {
        schema_version: SMART_FLOW_CONTRACT_VERSION,
        baseline_id: "baseline:SPY:live",
        source: "rolling_live",
        underlying_id: "SPY",
        as_of_ts: 10,
        lookback_ms: 3_600_000,
        sample_count: 42,
        metrics: {
          median_premium: {
            value: 25_000,
            unit: "usd"
          }
        }
      },
      evidence_quality: evidenceQuality,
      eligibility: {
        eligible: true,
        status: "accepted",
        reasons: ["large_enough_for_review"],
        decisions: [
          {
            status: "accepted",
            reason_code: "large_enough_for_review",
            reason: "The candidate is large enough for review.",
            evidence_refs: ["flowpacket:1", "print:1"]
          }
        ]
      }
    });

    const cluster = FlowEvidenceClusterSchema.parse({
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      cluster_id: "cluster:1",
      underlying_id: candidate.underlying_id,
      candidate_ids: [candidate.candidate_id],
      packet_ids: candidate.packet_ids,
      member_print_ids: candidate.member_print_ids,
      observation_refs: candidate.observation_refs,
      evidence_facts: [
        {
          fact_id: "fact:premium",
          kind: "premium_size",
          label: "Observed premium",
          value: 75_000,
          unit: "usd",
          observation_refs: [observationRef]
        }
      ],
      evidence_quality: candidate.evidence_quality,
      baseline_snapshot: candidate.baseline_snapshot,
      feature_summary: {
        total_premium: 75_000
      },
      feature_details: {
        total_premium: {
          label: "Observed premium",
          value: 75_000,
          basis: "measured_fact",
          fact_ids: ["fact:premium"],
          evidence_refs: ["packet:1"]
        }
      },
      start_ts: 10,
      end_ts: 510,
      window_ms: 500
    });

    expect(cluster.evidence_facts[0]?.kind).toBe("premium_size");
    expect(cluster.baseline_snapshot?.schema_version).toBe(SMART_FLOW_CONTRACT_VERSION);
  });

  it("requires versioned hypothesis events and separates abstention from confidence", () => {
    const missingVersion = FlowHypothesisEventSchema.safeParse({
      source_ts: 10,
      ingest_ts: 20,
      seq: 1,
      trace_id: "trace:1"
    });

    expect(missingVersion.success).toBe(false);

    const parsed = FlowHypothesisEventSchema.parse({
      source_ts: 10,
      ingest_ts: 20,
      seq: 1,
      trace_id: "trace:1",
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_POLICY_VERSION,
      model_version: SMART_FLOW_MODEL_VERSION,
      event_id: "smartflow:hypothesis:1",
      hypothesis_id: "hypothesis:1",
      cluster_id: "cluster:1",
      candidate_ids: ["candidate:1"],
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
        fit_score: 0.7,
        penalty_score: 0.1,
        penalties: [
          {
            penalty_id: "penalty:cluster:1:wide-quote",
            kind: "wide_quote_context",
            score: 0.1,
            reason: "The option quote was wide enough to discount confidence.",
            evidence_refs: ["flowpacket:1"],
            feature_key: "option_spread_bps_max"
          }
        ],
        confidence: {
          policy_confidence: 0.64,
          evidence_quality: 0.8,
          hypothesis_margin: 0.12,
          conviction: 0.58,
          calibration_version: null
        }
      },
      alternatives: [
        {
          hypothesis_type: "hedge_rebalance",
          direction: "neutral",
          score: 0.32,
          reasons: ["near_atm_short_dated_context"]
        }
      ],
      abstention: {
        abstained: false,
        reasons: ["not_abstained"],
        source_reasons: []
      },
      evidence_refs: ["flowpacket:1", "print:1"],
      generated_from: "flow_evidence_cluster"
    });

    expect(parsed.scores.confidence.policy_confidence).toBe(0.64);
    expect(parsed.scores.policy_version).toBe(SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION);
    expect(parsed.scores.penalties[0]?.kind).toBe("wide_quote_context");
    expect(parsed.abstention.abstained).toBe(false);

    const insight = smartFlowInsightFromHypothesisEvent(parsed);
    expect(insight.hypothesis_id).toBe(parsed.hypothesis_id);
    expect(insight.summary).toContain("Alternative explanations considered");

    const explainability = smartFlowExplainabilityFromHypothesisEvent(parsed);
    expect(explainability.projection_version).toBe(SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION);
    expect(explainability.versions.contract).toBe(SMART_FLOW_CONTRACT_VERSION);
    expect(explainability.source_channel).toBe("smart-flow");
    expect(explainability.refs.evidence_refs).toEqual(parsed.evidence_refs);
    expect(explainability.evidence.penalties[0]?.kind).toBe("wide_quote_context");
    expect(explainability.alternatives[0]?.hypothesis_type).toBe("hedge_rebalance");
    expect(explainability.abstention.abstained).toBe(false);
    expect(SmartFlowExplainabilityProjectionSchema.parse(explainability)).toEqual(explainability);
  });
});
