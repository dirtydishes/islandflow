import { describe, expect, it } from "bun:test";
import {
  type GeneratedEventBatch,
  type GeneratedMarketEvent,
  stableHash
} from "@islandflow/synthetic-market";
import { createSyntheticFixtureArtifacts } from "@islandflow/synthetic-market/fixtures";
import { buildExpectedOutputManifest } from "@islandflow/synthetic-market/manifest";
import {
  type ExpectedConfidenceRange,
  type ExpectedDerivedEvent,
  type ScenarioAlertExpectation,
  type SmartFlowExpectedOutputManifest,
  SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
  SYNTHETIC_SCENARIO_CATALOG_VERSION,
  SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION,
  type SyntheticEvidenceRequirement
} from "@islandflow/synthetic-market/scenarios";
import type {
  FlowAbstentionReason,
  FlowEvidenceFactKind,
  FlowHypothesisType,
  SmartMoneyDirection
} from "@islandflow/types";
import {
  compareSmartFlowReplayToExpectedManifest,
  evaluateSyntheticSmartFlowReplay,
  type SmartFlowReplayFixture
} from "../src/smart-flow-replay-evaluation";

const PRESENT_DERIVED_EVENTS: ExpectedDerivedEvent[] = [
  {
    event_kind: "flow_evidence_candidate",
    expectation: "present",
    required_fields: ["candidate_id"],
    notes: "Replay should recompute evidence candidates from raw option prints."
  },
  {
    event_kind: "flow_evidence_cluster",
    expectation: "present",
    required_fields: ["cluster_id"],
    notes: "Replay should aggregate candidates into deterministic evidence clusters."
  },
  {
    event_kind: "flow_hypothesis_event",
    expectation: "present",
    required_fields: ["hypothesis_type", "direction", "scores"],
    notes: "Positive golden fixtures should emit a non-abstained hypothesis."
  },
  {
    event_kind: "smart_flow_insight",
    expectation: "present",
    required_fields: ["insight_id"],
    notes: "Positive golden fixtures should project an emitted smart-flow insight."
  }
];

const NO_ALERT_DERIVED_EVENTS: ExpectedDerivedEvent[] = [
  {
    event_kind: "flow_evidence_candidate",
    expectation: "present",
    required_fields: ["candidate_id"],
    notes: "No-alert fixtures still recompute evidence before abstaining."
  },
  {
    event_kind: "flow_evidence_cluster",
    expectation: "present",
    required_fields: ["cluster_id"],
    notes: "No-alert fixtures still produce reviewable evidence clusters."
  },
  {
    event_kind: "flow_hypothesis_event",
    expectation: "absent",
    required_fields: [],
    notes: "No non-abstained hypothesis should be emitted."
  },
  {
    event_kind: "smart_flow_insight",
    expectation: "absent",
    required_fields: [],
    notes: "No user-facing insight should be projected for no-alert cases."
  }
];

const directionalFixture = (): SmartFlowReplayFixture => {
  const artifacts = createSyntheticFixtureArtifacts({
    run_name: "phase 04 golden directional alert",
    seed_bundle: {
      seed: 5,
      namespace: "smart-flow-phase-04",
      partition: "directional"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T14:30:00Z"),
      steps: 6,
      symbols: [{ underlying_id: "SPY", base_price: 500, exchange: "ARCA" }],
      liquidity: {
        equity_spread_bps: 3,
        equity_quote_size: 1_800,
        equity_trade_size: 320,
        option_spread_bps: 40,
        option_quote_size: 220,
        option_trade_size: 250,
        off_exchange_ratio: 0.05,
        arrival_interval_ms: 80
      },
      volatility: {
        drift_bps_per_step: 6,
        price_noise_bps: 2,
        option_iv: 0.5
      },
      option_chain: {
        expiries_days: [14],
        strike_offsets_bps: [-100, 0],
        option_types: ["call"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    }
  });

  return {
    manifest: artifacts.manifest,
    batch: artifacts.batch
  };
};

const bearishPutFixture = (): SmartFlowReplayFixture => {
  const artifacts = createSyntheticFixtureArtifacts({
    run_name: "phase 04 golden bearish put alert",
    seed_bundle: {
      seed: 6,
      namespace: "smart-flow-phase-04",
      partition: "put"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T14:30:00Z"),
      steps: 6,
      symbols: [{ underlying_id: "QQQ", base_price: 400, exchange: "ARCA" }],
      liquidity: {
        equity_spread_bps: 3,
        equity_quote_size: 1_800,
        equity_trade_size: 320,
        option_spread_bps: 40,
        option_quote_size: 220,
        option_trade_size: 250,
        off_exchange_ratio: 0.05,
        arrival_interval_ms: 80
      },
      volatility: {
        drift_bps_per_step: 6,
        price_noise_bps: 2,
        option_iv: 0.5
      },
      option_chain: {
        expiries_days: [14],
        strike_offsets_bps: [-100, 0],
        option_types: ["put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    }
  });

  return {
    manifest: artifacts.manifest,
    batch: artifacts.batch
  };
};

const fixtureWithUnexpectedBearishAlert = (): SmartFlowReplayFixture => {
  const bullish = directionalFixture();
  const bearish = bearishPutFixture();

  return {
    manifest: bullish.manifest,
    batch: {
      ...bullish.batch,
      events: [...bullish.batch.events, ...bearish.batch.events]
    }
  };
};

const abstentionFixture = (): SmartFlowReplayFixture => {
  const artifacts = createSyntheticFixtureArtifacts({
    run_name: "phase 04 golden wide-quote abstention",
    seed_bundle: {
      seed: 41,
      namespace: "smart-flow-phase-04",
      partition: "abstain"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T20:10:00Z"),
      steps: 3,
      symbols: [{ underlying_id: "SPY", base_price: 499, exchange: "ARCA" }],
      liquidity: {
        equity_spread_bps: 42,
        equity_quote_size: 250,
        equity_trade_size: 80,
        option_spread_bps: 1_100,
        option_quote_size: 18,
        option_trade_size: 5,
        off_exchange_ratio: 0.48,
        arrival_interval_ms: 250
      },
      volatility: {
        drift_bps_per_step: 0,
        price_noise_bps: 34,
        option_iv: 0.72
      },
      option_chain: {
        expiries_days: [1, 3],
        strike_offsets_bps: [-900, 900],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    }
  });

  return {
    manifest: artifacts.manifest,
    batch: artifacts.batch
  };
};

const noisyEventFixture = (): SmartFlowReplayFixture => {
  const artifacts = createSyntheticFixtureArtifacts({
    run_name: "phase 04 golden noisy event context",
    seed_bundle: {
      seed: 1,
      namespace: "smart-flow-phase-04",
      partition: "noisy-event"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T18:45:00Z"),
      steps: 5,
      symbols: [{ underlying_id: "TSLA", base_price: 318, exchange: "NASDAQ" }],
      liquidity: {
        equity_spread_bps: 6,
        equity_quote_size: 900,
        equity_trade_size: 190,
        option_spread_bps: 80,
        option_quote_size: 70,
        option_trade_size: 180,
        off_exchange_ratio: 0.18,
        arrival_interval_ms: 100
      },
      volatility: {
        drift_bps_per_step: 0,
        price_noise_bps: 8,
        option_iv: 0.82
      },
      option_chain: {
        expiries_days: [1, 2],
        strike_offsets_bps: [-100, 0, 100],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    }
  });
  const patchedBatch: GeneratedEventBatch = {
    ...artifacts.batch,
    events: artifacts.batch.events.map(addEventNoiseCondition)
  };
  const expected = expectedManifest(patchedBatch, {
    scenario_id: "golden-noisy-event-context",
    alert_expectation: "abstain",
    expected_class: "unclear",
    expected_direction: "unknown",
    confidence_range: { min: 0, max: 0.35 },
    abstention_reasons: ["below_policy_threshold"],
    required_evidence: [
      req(
        "event-context",
        "event_context",
        "days_to_event",
        "lte",
        2,
        "The noisy golden fixture includes explicit event timing context."
      )
    ],
    forbidden_evidence: [],
    expected_derived_events: NO_ALERT_DERIVED_EVENTS
  });

  return {
    manifest: buildExpectedOutputManifest({
      batch: patchedBatch,
      run_name: "phase 04 golden noisy event context",
      profile_source_path: "test:golden-noisy-event-context",
      expected_output_contract: {
        smart_flow_outputs_path: "smart-flow-golden.json",
        smart_flow_outputs_hash: stableHash(expected),
        expected_output_count: expected.expectations.length
      }
    }),
    batch: patchedBatch
  };
};

describe("smart-flow replay evaluation and golden signatures", () => {
  it("recomputes a positive smart-flow signature from raw synthetic events", () => {
    const fixture = directionalFixture();
    const expected = expectedManifest(fixture.batch, {
      scenario_id: "golden-directional-alert",
      alert_expectation: "alert",
      expected_class: "directional_accumulation",
      expected_direction: "bullish",
      confidence_range: { min: 0.8, max: 0.84 },
      abstention_reasons: ["not_abstained"],
      required_evidence: [
        req(
          "large-premium",
          "premium_size",
          "total_premium",
          "gte",
          50_000,
          "Directional replay should preserve the large-premium evidence."
        ),
        req(
          "aggressive-execution",
          "execution_aggression",
          "nbbo_aggression_ratio_max",
          "gte",
          0.9,
          "Directional replay should preserve ask-side aggression."
        ),
        req(
          "quote-backed",
          "quote_quality",
          "nbbo_coverage_ratio_mean",
          "gte",
          0.9,
          "Positive replay should remain quote-backed."
        )
      ],
      forbidden_evidence: [
        req(
          "stale-quote-suppression",
          "quote_quality",
          "nbbo_stale_ratio_mean",
          "gte",
          0.5,
          "The clean positive fixture should not depend on stale quote context."
        )
      ],
      expected_derived_events: PRESENT_DERIVED_EVENTS
    });

    const report = compareSmartFlowReplayToExpectedManifest(fixture, expected);

    expect(report.matches).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.signature.emitted_hypothesis_count).toBe(1);
    expect(report.signature.hypotheses[0]).toMatchObject({
      hypothesis_type: "directional_accumulation",
      direction: "bullish",
      abstained: false,
      confidence_band: "high"
    });
  });

  it("flags unexpected emitted alerts when the expected alert is also present", () => {
    const fixture = fixtureWithUnexpectedBearishAlert();
    const expected = expectedManifest(fixture.batch, {
      scenario_id: "golden-unexpected-direction-guard",
      alert_expectation: "alert",
      expected_class: "directional_accumulation",
      expected_direction: "bullish",
      confidence_range: { min: 0.8, max: 0.84 },
      abstention_reasons: ["not_abstained"],
      required_evidence: [],
      forbidden_evidence: [],
      expected_derived_events: PRESENT_DERIVED_EVENTS
    });

    const report = compareSmartFlowReplayToExpectedManifest(fixture, expected);

    expect(report.matches).toBe(false);
    expect(report.signature.emitted_hypothesis_count).toBe(2);
    expect(report.mismatches).toContainEqual(
      expect.objectContaining({
        kind: "unexpected_direction",
        actual: expect.objectContaining({
          hypothesis_type: "directional_accumulation",
          direction: "bearish"
        })
      })
    );
  });

  it("keeps no-alert abstention signatures infra-free and reviewable", () => {
    const fixture = abstentionFixture();
    const expected = expectedManifest(fixture.batch, {
      scenario_id: "golden-wide-quote-abstention",
      alert_expectation: "no_alert",
      expected_class: "unclear",
      expected_direction: "unknown",
      confidence_range: { min: 0, max: 0.35 },
      abstention_reasons: ["below_policy_threshold"],
      required_evidence: [
        req(
          "wide-option-quote",
          "quote_quality",
          "option_spread_bps_max",
          "gte",
          800,
          "The abstention fixture should preserve wide option quote evidence."
        )
      ],
      forbidden_evidence: [
        req(
          "no-high-confidence",
          "other",
          "confidence_band",
          "eq",
          "high",
          "No-alert replay should never emit a high-confidence hypothesis."
        )
      ],
      expected_derived_events: NO_ALERT_DERIVED_EVENTS
    });

    const report = compareSmartFlowReplayToExpectedManifest(fixture, expected);

    expect(report.matches).toBe(true);
    expect(report.signature.emitted_hypothesis_count).toBe(0);
    expect(report.signature.insight_count).toBe(0);
    expect(report.signature.hypotheses[0]?.abstention_reasons).toContain("below_policy_threshold");
  });

  it("reports a concise false-positive mismatch when a no-alert manifest emits", () => {
    const fixture = directionalFixture();
    const expected = expectedManifest(fixture.batch, {
      scenario_id: "golden-false-positive-guard",
      alert_expectation: "no_alert",
      expected_class: "unclear",
      expected_direction: "unknown",
      confidence_range: { min: 0, max: 0.35 },
      abstention_reasons: [],
      required_evidence: [],
      forbidden_evidence: [],
      expected_derived_events: NO_ALERT_DERIVED_EVENTS
    });

    const report = compareSmartFlowReplayToExpectedManifest(fixture, expected);

    expect(report.matches).toBe(false);
    expect(report.mismatches.map((mismatch) => mismatch.kind)).toContain("false_positive");
    expect(report.mismatches.map((mismatch) => mismatch.kind)).toContain(
      "derived_event_presence_mismatch"
    );
  });

  it("covers noisy event-context replay without requiring Docker or services", () => {
    const fixture = noisyEventFixture();
    const expected = expectedManifest(fixture.batch, {
      scenario_id: "golden-noisy-event-context",
      alert_expectation: "abstain",
      expected_class: "unclear",
      expected_direction: "unknown",
      confidence_range: { min: 0, max: 0.35 },
      abstention_reasons: ["below_policy_threshold"],
      required_evidence: [
        req(
          "event-context",
          "event_context",
          "days_to_event",
          "lte",
          2,
          "Noisy replay should preserve explicit event context from raw conditions."
        )
      ],
      forbidden_evidence: [],
      expected_derived_events: NO_ALERT_DERIVED_EVENTS
    });

    const report = compareSmartFlowReplayToExpectedManifest(fixture, expected);
    const directEvaluation = evaluateSyntheticSmartFlowReplay(fixture);

    expect(report.matches).toBe(true);
    expect(report.signature_hash).toBe(stableHash(report.signature));
    expect(report.signature_hash).toBe(directEvaluation.signature_hash);
    expect(report.signature.clusters[0]?.features.days_to_event).toBe(1);
  });
});

const expectedManifest = (
  batch: GeneratedEventBatch,
  input: {
    scenario_id: string;
    alert_expectation: ScenarioAlertExpectation;
    expected_class: FlowHypothesisType;
    expected_direction: SmartMoneyDirection;
    confidence_range: ExpectedConfidenceRange;
    abstention_reasons: FlowAbstentionReason[];
    required_evidence: SyntheticEvidenceRequirement[];
    forbidden_evidence: SyntheticEvidenceRequirement[];
    expected_derived_events: ExpectedDerivedEvent[];
  }
): SmartFlowExpectedOutputManifest => ({
  schema_version: SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION,
  catalog_version: SYNTHETIC_SCENARIO_CATALOG_VERSION,
  label_schema_version: SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
  run_id: batch.run.run_id,
  scenario_id: input.scenario_id,
  source_label_hash: stableHash({
    run_id: batch.run.run_id,
    scenario_id: input.scenario_id,
    test_label: true
  }),
  expectations: [
    {
      expected_output_id: `expected:${batch.run.run_id}:${input.scenario_id}`,
      label_id: `label:${batch.run.run_id}:${input.scenario_id}`,
      alert_expectation: input.alert_expectation,
      expected_class: input.expected_class,
      expected_direction: input.expected_direction,
      confidence_band:
        input.confidence_range.min >= 0.72
          ? "high"
          : input.confidence_range.max >= 0.52
            ? "medium"
            : "low",
      confidence_range: input.confidence_range,
      expected_derived_events: input.expected_derived_events,
      required_evidence: input.required_evidence,
      forbidden_evidence: input.forbidden_evidence,
      abstention_reasons: input.abstention_reasons,
      false_positive_penalty: {
        score: input.alert_expectation === "alert" ? 0.1 : 0.9,
        severity: input.alert_expectation === "alert" ? "low" : "high",
        reason: "Phase 04 replay golden test fixture."
      }
    }
  ]
});

const req = (
  requirement_id: string,
  fact_kind: FlowEvidenceFactKind,
  feature_key: string | undefined,
  operator: SyntheticEvidenceRequirement["operator"],
  value: SyntheticEvidenceRequirement["value"],
  rationale: string
): SyntheticEvidenceRequirement => ({
  requirement_id,
  fact_kind,
  feature_key,
  operator,
  value,
  rationale
});

const addEventNoiseCondition = (generated: GeneratedMarketEvent): GeneratedMarketEvent => {
  if (generated.kind !== "option_print") {
    return generated;
  }

  return {
    kind: "option_print",
    event: {
      ...generated.event,
      conditions: [...(generated.event.conditions ?? []), "EVENT_IN_1D"]
    }
  };
};
