import { describe, expect, it } from "bun:test";
import type { SmartMoneyEvent } from "../src/events";
import {
  FlowCandidateSchema,
  FlowEvidenceClusterSchema,
  FlowHypothesisEventSchema,
  flowHypothesisEventFromLegacySmartMoneyEvent,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_MODEL_VERSION,
  SMART_FLOW_POLICY_VERSION,
  SmartFlowInsightSchema,
  SmartMoneyInsightSchema,
  smartFlowInsightFromLegacySmartMoneyEvent
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

const legacyEvent: SmartMoneyEvent = {
  source_ts: 10,
  ingest_ts: 20,
  seq: 1,
  trace_id: "smartmoney:flowpacket:1",
  event_id: "smartmoney:single_leg_event:flowpacket:1",
  packet_ids: ["flowpacket:1"],
  member_print_ids: ["print:1"],
  underlying_id: "SPY",
  event_kind: "single_leg_event",
  event_window_ms: 500,
  features: {
    contract_count: 1,
    print_count: 3,
    total_size: 900,
    total_premium: 75_000,
    total_notional: 7_500_000,
    start_ts: 10,
    end_ts: 10,
    window_ms: 500,
    option_contract_id: "SPY-2025-01-17-450-C",
    option_type: "C",
    dte_days: 1,
    moneyness: 1,
    atm_proximity: 0.01,
    aggressor_buy_ratio: 0.7,
    aggressor_sell_ratio: 0.1,
    aggressor_ratio: 0.8,
    nbbo_coverage_ratio: 0.9,
    nbbo_inside_ratio: 0.1,
    nbbo_stale_ratio: 0,
    quote_age_ms: 20,
    venue_count: 2,
    inter_fill_ms_mean: 100,
    strike_count: 1,
    strike_concentration: 1,
    structure_legs: 0,
    same_size_leg_symmetry: 0,
    net_directional_bias: 0.6,
    synthetic_iv_shock: null,
    spread_widening: null,
    underlying_move_bps: null,
    days_to_event: null,
    expiry_after_event: null,
    pre_event_concentration: null,
    special_print_ratio: 0
  },
  profile_scores: [
    {
      profile_id: "institutional_directional",
      probability: 0.74,
      confidence_band: "high",
      direction: "bullish",
      reasons: ["large_parent_event"]
    },
    {
      profile_id: "retail_whale",
      probability: 0.35,
      confidence_band: "low",
      direction: "bullish",
      reasons: ["burst_print_pattern"]
    }
  ],
  primary_profile_id: "institutional_directional",
  primary_direction: "bullish",
  abstained: false,
  suppressed_reasons: []
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
        reasons: ["large_enough_for_review"]
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
        evidence_strength: 0.8,
        fit_score: 0.7,
        penalty_score: 0.1,
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
    expect(parsed.abstention.abstained).toBe(false);
  });

  it("projects legacy smart-money events into compatibility-only smart-flow insights", () => {
    const hypothesis = flowHypothesisEventFromLegacySmartMoneyEvent(legacyEvent);
    const insight = smartFlowInsightFromLegacySmartMoneyEvent(legacyEvent);

    expect(hypothesis.hypothesis_type).toBe("directional_accumulation");
    expect(hypothesis.compatibility?.compatibility_only).toBe(true);
    expect(hypothesis.compatibility?.legacy_profile_id).toBe("institutional_directional");
    expect(insight.label).toBe("Directional accumulation hypothesis");
    expect(insight.confidence).toBe(0.74);
    expect(SmartFlowInsightSchema.parse(insight)).toEqual(insight);
    expect(SmartMoneyInsightSchema.parse(insight)).toEqual(insight);
  });
});
