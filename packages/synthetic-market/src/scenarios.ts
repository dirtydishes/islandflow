import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FlowAbstentionReason,
  FlowEvidenceFactKind,
  FlowHypothesisType,
  SmartFlowConfidenceBand,
  SmartFlowDirection
} from "@islandflow/types";
import { toDeterministicJson } from "./fixtures";
import {
  type GeneratedEventBatch,
  type GeneratedMarketEventKind,
  generateSyntheticMarketBatch,
  type SeedBundle,
  type SyntheticMarketProfile,
  stableHash
} from "./index";
import {
  assertGeneratedMarketEventsDoNotContainHiddenLabels,
  buildExpectedOutputManifest,
  DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT,
  type ExpectedOutputManifest,
  type SyntheticFixtureArtifactLayout
} from "./manifest";

export const SYNTHETIC_SCENARIO_CATALOG_VERSION = "synthetic-market-scenarios-v1";
export const SYNTHETIC_GROUND_TRUTH_LABELS_VERSION = "synthetic-market-labels-v1";
export const SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION =
  "synthetic-smart-flow-expected-outputs-v1";

export type SyntheticScenarioFamily =
  | "institutional_directional_flow"
  | "retail_attention_flow"
  | "event_noise_flow"
  | "volatility_seller_behavior"
  | "hedge_reactive_flow"
  | "structure_arbitrage_flow"
  | "no_alert_negative";

export type ScenarioAlertExpectation = "alert" | "no_alert" | "abstain" | "suppress";

export type ScenarioPipelineEventKind =
  | "flow_evidence_candidate"
  | "flow_evidence_cluster"
  | "flow_hypothesis_event"
  | "smart_flow_insight";

export type ScenarioEventRole = "anchor" | "supporting" | "context";

export type EvidenceRequirementOperator = "present" | "absent" | "gte" | "lte" | "eq";

export type SyntheticEvidenceRequirement = {
  requirement_id: string;
  fact_kind: FlowEvidenceFactKind;
  feature_key?: string;
  operator: EvidenceRequirementOperator;
  value?: string | number | boolean | null;
  rationale: string;
};

export type FalsePositivePenalty = {
  score: number;
  severity: "none" | "low" | "medium" | "high";
  reason: string;
};

export type ScenarioEventSelector = {
  role: ScenarioEventRole;
  kind: GeneratedMarketEventKind;
  ordinal?: number;
  description: string;
};

export type ScenarioEventRef = {
  role: ScenarioEventRole;
  event_kind: GeneratedMarketEventKind;
  event_id: string;
  trace_id: string;
  source_ts: number;
  seq: number;
  description: string;
};

export type ExpectedConfidenceRange = {
  min: number;
  max: number;
};

export type ExpectedPipelineEvent = {
  event_kind: ScenarioPipelineEventKind;
  expectation: "present" | "absent";
  required_fields: string[];
  notes: string;
};

export type ScenarioExpectedOutputTemplate = {
  alert_expectation: ScenarioAlertExpectation;
  expected_class: FlowHypothesisType;
  expected_direction: SmartFlowDirection;
  confidence_band: SmartFlowConfidenceBand;
  confidence_range: ExpectedConfidenceRange;
  required_evidence: SyntheticEvidenceRequirement[];
  forbidden_evidence: SyntheticEvidenceRequirement[];
  expected_pipeline_events: ExpectedPipelineEvent[];
  abstention_reasons: FlowAbstentionReason[];
  false_positive_penalty: FalsePositivePenalty;
};

export type ScenarioInjection = {
  catalog_version: typeof SYNTHETIC_SCENARIO_CATALOG_VERSION;
  scenario_id: string;
  family: SyntheticScenarioFamily;
  title: string;
  description: string;
  run_id: string;
  run_name: string;
  seed_bundle: SeedBundle;
  profile: SyntheticMarketProfile;
  event_selectors: ScenarioEventSelector[];
  expected_output: ScenarioExpectedOutputTemplate;
};

export type GroundTruthLabel = {
  schema_version: typeof SYNTHETIC_GROUND_TRUTH_LABELS_VERSION;
  label_id: string;
  run_id: string;
  scenario_id: string;
  family: SyntheticScenarioFamily;
  event_refs: ScenarioEventRef[];
  expected_class: FlowHypothesisType;
  expected_direction: SmartFlowDirection;
  confidence_band: SmartFlowConfidenceBand;
  required_evidence: SyntheticEvidenceRequirement[];
  forbidden_evidence: SyntheticEvidenceRequirement[];
  false_positive_penalty: FalsePositivePenalty;
  notes: string;
};

export type GroundTruthLabelSet = {
  schema_version: typeof SYNTHETIC_GROUND_TRUTH_LABELS_VERSION;
  catalog_version: typeof SYNTHETIC_SCENARIO_CATALOG_VERSION;
  run_id: string;
  scenario_id: string;
  labels: GroundTruthLabel[];
};

export type SmartFlowExpectedOutput = {
  expected_output_id: string;
  label_id: string;
  alert_expectation: ScenarioAlertExpectation;
  expected_class: FlowHypothesisType;
  expected_direction: SmartFlowDirection;
  confidence_band: SmartFlowConfidenceBand;
  confidence_range: ExpectedConfidenceRange;
  expected_pipeline_events: ExpectedPipelineEvent[];
  required_evidence: SyntheticEvidenceRequirement[];
  forbidden_evidence: SyntheticEvidenceRequirement[];
  abstention_reasons: FlowAbstentionReason[];
  false_positive_penalty: FalsePositivePenalty;
};

export type SmartFlowExpectedOutputManifest = {
  schema_version: typeof SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION;
  catalog_version: typeof SYNTHETIC_SCENARIO_CATALOG_VERSION;
  label_schema_version: typeof SYNTHETIC_GROUND_TRUTH_LABELS_VERSION;
  run_id: string;
  scenario_id: string;
  source_label_hash: string;
  expectations: SmartFlowExpectedOutput[];
};

export type SyntheticScenarioFixtureArtifactLayout = SyntheticFixtureArtifactLayout & {
  labels_path: string;
  smart_flow_outputs_path: string;
};

export type CreateSyntheticScenarioFixtureInput = {
  scenario_id: string;
  run_id?: string;
  seed_bundle?: SeedBundle;
  artifact_layout?: Partial<SyntheticScenarioFixtureArtifactLayout>;
};

export type WriteSyntheticScenarioFixtureInput = CreateSyntheticScenarioFixtureInput & {
  output_dir: string;
};

export type SyntheticScenarioFixtureFileMap = {
  manifest: string;
  market_events: string;
  provenance: string;
  parameter_snapshot: string;
  labels: string;
  smart_flow_outputs: string;
};

export type SyntheticScenarioFixtureArtifacts = {
  scenario: ScenarioInjection;
  manifest: ExpectedOutputManifest;
  labels: GroundTruthLabelSet;
  smart_flow_expected_outputs: SmartFlowExpectedOutputManifest;
  batch: GeneratedEventBatch;
  files: SyntheticScenarioFixtureFileMap;
};

export type WrittenSyntheticScenarioFixture = SyntheticScenarioFixtureArtifacts & {
  paths: SyntheticScenarioFixtureFileMap;
};

export const DEFAULT_SYNTHETIC_SCENARIO_FIXTURE_ARTIFACT_LAYOUT: SyntheticScenarioFixtureArtifactLayout =
  {
    ...DEFAULT_SYNTHETIC_FIXTURE_ARTIFACT_LAYOUT,
    labels_path: "labels.json",
    smart_flow_outputs_path: "smart-flow-expected-outputs.json"
  };

const requiredPipelineEvents: ExpectedPipelineEvent[] = [
  {
    event_kind: "flow_evidence_candidate",
    expectation: "present",
    required_fields: ["candidate_id", "observation_refs", "feature_vector", "evidence_quality"],
    notes: "The scenario should first resolve into traceable candidate evidence."
  },
  {
    event_kind: "flow_evidence_cluster",
    expectation: "present",
    required_fields: ["cluster_id", "candidate_ids", "feature_summary", "evidence_facts"],
    notes: "Evidence should remain explainable before hypothesis scoring."
  },
  {
    event_kind: "flow_hypothesis_event",
    expectation: "present",
    required_fields: ["hypothesis_type", "direction", "scores", "abstention", "evidence_refs"],
    notes: "The expected class is a future smart-flow hypothesis, not a label on raw events."
  }
];

const noAlertPipelineEvents: ExpectedPipelineEvent[] = [
  {
    event_kind: "flow_evidence_candidate",
    expectation: "present",
    required_fields: ["candidate_id", "eligibility", "evidence_quality"],
    notes: "The negative fixture may still produce evidence candidates."
  },
  {
    event_kind: "flow_hypothesis_event",
    expectation: "absent",
    required_fields: [],
    notes: "No alerting smart-flow hypothesis should be emitted for this negative case."
  },
  {
    event_kind: "smart_flow_insight",
    expectation: "absent",
    required_fields: [],
    notes: "No user-facing insight should be projected from the negative case."
  }
];

const defaultSelectors: ScenarioEventSelector[] = [
  {
    role: "anchor",
    kind: "option_print",
    ordinal: 0,
    description: "First deterministic option print anchors the labeled scenario."
  },
  {
    role: "context",
    kind: "option_nbbo",
    ordinal: 0,
    description: "Nearest deterministic option NBBO context."
  },
  {
    role: "context",
    kind: "equity_quote",
    ordinal: 0,
    description: "Underlying quote context for the first option print."
  }
];

const scenario = (input: Omit<ScenarioInjection, "catalog_version">): ScenarioInjection => ({
  catalog_version: SYNTHETIC_SCENARIO_CATALOG_VERSION,
  ...input,
  profile: {
    ...input.profile,
    scenario_id: input.scenario_id
  }
});

const req = (
  requirement_id: string,
  fact_kind: FlowEvidenceFactKind,
  feature_key: string | undefined,
  operator: EvidenceRequirementOperator,
  value: string | number | boolean | null | undefined,
  rationale: string
): SyntheticEvidenceRequirement => ({
  requirement_id,
  fact_kind,
  feature_key,
  operator,
  value,
  rationale
});

export const SYNTHETIC_SCENARIO_CATALOG: readonly ScenarioInjection[] = [
  scenario({
    scenario_id: "institutional-directional-flow",
    family: "institutional_directional_flow",
    title: "Institutional Directional Flow",
    description: "Large, aggressive call flow against clean quote context.",
    run_id: "phase03-a",
    run_name: "phase 03 institutional directional flow",
    seed_bundle: {
      seed: 301,
      namespace: "synthetic-phase-03",
      partition: "institutional"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T14:30:00Z"),
      steps: 4,
      symbols: [{ id: "spy-directional", underlying_id: "SPY", base_price: 502, exchange: "ARCA" }],
      liquidity: {
        id: "large-clean-liquidity",
        equity_spread_bps: 3,
        equity_quote_size: 1_800,
        equity_trade_size: 320,
        option_spread_bps: 70,
        option_quote_size: 220,
        option_trade_size: 90,
        off_exchange_ratio: 0.08,
        arrival_interval_ms: 80
      },
      volatility: {
        id: "upward-institutional-drift",
        drift_bps_per_step: 5,
        price_noise_bps: 3,
        option_iv: 0.28
      },
      option_chain: {
        id: "clean-call-chain",
        expiries_days: [14, 21],
        strike_offsets_bps: [-100, 0, 100],
        option_types: ["call"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: defaultSelectors,
    expected_output: {
      alert_expectation: "alert",
      expected_class: "directional_accumulation",
      expected_direction: "bullish",
      confidence_band: "high",
      confidence_range: { min: 0.72, max: 0.92 },
      required_evidence: [
        req(
          "large-premium",
          "premium_size",
          "total_premium",
          "gte",
          50_000,
          "Premium is intentionally large enough to validate institutional-sized flow."
        ),
        req(
          "aggressive-execution",
          "execution_aggression",
          "nbbo_aggression_ratio_max",
          "gte",
          0.6,
          "Directional cases should require execution-side evidence."
        ),
        req(
          "clean-quotes",
          "quote_quality",
          "nbbo_coverage_ratio_mean",
          "gte",
          0.8,
          "The positive case should not depend on stale or missing quotes."
        )
      ],
      forbidden_evidence: [
        req(
          "no-stale-quote-suppression",
          "quote_quality",
          "nbbo_stale_ratio_mean",
          "gte",
          0.5,
          "A stale-quote explanation would contradict this clean directional case."
        )
      ],
      expected_pipeline_events: requiredPipelineEvents,
      abstention_reasons: ["not_abstained"],
      false_positive_penalty: {
        score: 0.15,
        severity: "low",
        reason:
          "Missing this case is worse than alerting on it, but evidence still must be traceable."
      }
    }
  }),
  scenario({
    scenario_id: "retail-attention-call-chase",
    family: "retail_attention_flow",
    title: "Retail Attention Call Chase",
    description: "Smaller repeated call prints with bursty timing and moderate premium.",
    run_id: "phase03-b",
    run_name: "phase 03 retail attention call chase",
    seed_bundle: {
      seed: 302,
      namespace: "synthetic-phase-03",
      partition: "retail"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T15:10:00Z"),
      steps: 5,
      symbols: [{ id: "nvda-retail", underlying_id: "NVDA", base_price: 142, exchange: "NASDAQ" }],
      liquidity: {
        id: "bursty-retail-liquidity",
        equity_spread_bps: 5,
        equity_quote_size: 1_100,
        equity_trade_size: 140,
        option_spread_bps: 120,
        option_quote_size: 90,
        option_trade_size: 28,
        off_exchange_ratio: 0.18,
        arrival_interval_ms: 45
      },
      volatility: {
        id: "retail-chase-drift",
        drift_bps_per_step: 7,
        price_noise_bps: 10,
        option_iv: 0.54
      },
      option_chain: {
        id: "retail-call-chain",
        expiries_days: [3, 7],
        strike_offsets_bps: [0, 250, 500],
        option_types: ["call"],
        strike_step: 2.5,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: defaultSelectors,
    expected_output: {
      alert_expectation: "alert",
      expected_class: "retail_attention_flow",
      expected_direction: "bullish",
      confidence_band: "medium",
      confidence_range: { min: 0.52, max: 0.76 },
      required_evidence: [
        req(
          "bursty-timing",
          "timing_context",
          "candidate_count",
          "gte",
          1,
          "Retail attention should be recognized through repeated, close-together observations."
        ),
        req(
          "moderate-premium",
          "premium_size",
          "total_premium",
          "gte",
          10_000,
          "Retail attention flow still needs material premium."
        ),
        req(
          "visible-aggression",
          "execution_aggression",
          "nbbo_aggression_ratio_max",
          "gte",
          0.45,
          "Call chasing should not be inferred from passive prints alone."
        )
      ],
      forbidden_evidence: [
        req(
          "no-complex-structure",
          "structure_shape",
          "structure_context",
          "eq",
          "complex_or_spread_context",
          "Complex spread context should suppress retail-attention interpretation."
        )
      ],
      expected_pipeline_events: requiredPipelineEvents,
      abstention_reasons: ["not_abstained"],
      false_positive_penalty: {
        score: 0.35,
        severity: "medium",
        reason:
          "Retail attention is noisy, so unsupported alerts should carry a noticeable penalty."
      }
    }
  }),
  scenario({
    scenario_id: "event-noise-positioning",
    family: "event_noise_flow",
    title: "Event Noise Positioning",
    description:
      "Pre-event option activity with noisy timing that should be classified as event positioning.",
    run_id: "phase03-c",
    run_name: "phase 03 event noise positioning",
    seed_bundle: {
      seed: 303,
      namespace: "synthetic-phase-03",
      partition: "event"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T18:45:00Z"),
      steps: 4,
      symbols: [{ id: "tsla-event", underlying_id: "TSLA", base_price: 318, exchange: "NASDAQ" }],
      liquidity: {
        id: "event-liquidity",
        equity_spread_bps: 9,
        equity_quote_size: 900,
        equity_trade_size: 190,
        option_spread_bps: 220,
        option_quote_size: 70,
        option_trade_size: 36,
        off_exchange_ratio: 0.24,
        arrival_interval_ms: 110
      },
      volatility: {
        id: "event-volatility",
        drift_bps_per_step: 1,
        price_noise_bps: 28,
        option_iv: 0.82
      },
      option_chain: {
        id: "event-mixed-chain",
        expiries_days: [1, 2, 7],
        strike_offsets_bps: [-300, 0, 300],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: defaultSelectors,
    expected_output: {
      alert_expectation: "alert",
      expected_class: "event_positioning",
      expected_direction: "mixed",
      confidence_band: "medium",
      confidence_range: { min: 0.48, max: 0.72 },
      required_evidence: [
        req(
          "event-context",
          "event_context",
          "days_to_event",
          "lte",
          2,
          "Event/noise scenarios should require explicit event context."
        ),
        req(
          "mixed-direction",
          "underlying_context",
          "net_directional_bias",
          "lte",
          0.35,
          "The expected output should avoid overstating a single direction."
        ),
        req(
          "quote-aware",
          "quote_quality",
          "nbbo_coverage_ratio_mean",
          "gte",
          0.5,
          "Even noisy event cases need enough quote context to evaluate."
        )
      ],
      forbidden_evidence: [
        req(
          "no-certainty-language",
          "other",
          "legacy_certainty_language",
          "present",
          true,
          "Expected outputs should not revive old certainty language."
        )
      ],
      expected_pipeline_events: requiredPipelineEvents,
      abstention_reasons: ["not_abstained"],
      false_positive_penalty: {
        score: 0.45,
        severity: "medium",
        reason: "Event days invite false positives, so the expected output requires event context."
      }
    }
  }),
  scenario({
    scenario_id: "volatility-seller-supply",
    family: "volatility_seller_behavior",
    title: "Volatility Seller Supply",
    description: "Orderly premium supply in high-IV puts where direction should stay neutral.",
    run_id: "phase03-d",
    run_name: "phase 03 volatility seller supply",
    seed_bundle: {
      seed: 304,
      namespace: "synthetic-phase-03",
      partition: "vol-seller"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T16:05:00Z"),
      steps: 4,
      symbols: [{ id: "spy-vol-supply", underlying_id: "SPY", base_price: 501, exchange: "CBOE" }],
      liquidity: {
        id: "vol-supply-liquidity",
        equity_spread_bps: 4,
        equity_quote_size: 1_600,
        equity_trade_size: 260,
        option_spread_bps: 95,
        option_quote_size: 180,
        option_trade_size: 70,
        off_exchange_ratio: 0.1,
        arrival_interval_ms: 95
      },
      volatility: {
        id: "high-iv-contained-underlying",
        drift_bps_per_step: 0,
        price_noise_bps: 5,
        option_iv: 0.9
      },
      option_chain: {
        id: "put-supply-chain",
        expiries_days: [21, 35],
        strike_offsets_bps: [-700, -400, -100],
        option_types: ["put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: defaultSelectors,
    expected_output: {
      alert_expectation: "alert",
      expected_class: "volatility_supply",
      expected_direction: "neutral",
      confidence_band: "medium",
      confidence_range: { min: 0.5, max: 0.74 },
      required_evidence: [
        req(
          "high-iv",
          "execution_context",
          "execution_iv",
          "gte",
          0.65,
          "Volatility-seller behavior should require elevated implied-volatility context."
        ),
        req(
          "contained-underlying",
          "underlying_context",
          "underlying_move_bps",
          "lte",
          15,
          "The scenario is about premium supply, not a directional chase."
        ),
        req(
          "usable-quotes",
          "quote_quality",
          "nbbo_coverage_ratio_mean",
          "gte",
          0.75,
          "Quote quality should be usable before identifying supply."
        )
      ],
      forbidden_evidence: [
        req(
          "no-bullish-certainty",
          "underlying_context",
          "expected_direction",
          "eq",
          "bullish",
          "The output should not call this a bullish directional accumulation case."
        )
      ],
      expected_pipeline_events: requiredPipelineEvents,
      abstention_reasons: ["not_abstained"],
      false_positive_penalty: {
        score: 0.4,
        severity: "medium",
        reason:
          "Misclassifying volatility supply as directional flow is costly for downstream demos."
      }
    }
  }),
  scenario({
    scenario_id: "hedge-reactive-put-flow",
    family: "hedge_reactive_flow",
    title: "Hedge Reactive Put Flow",
    description:
      "Put flow after bearish underlying movement where hedge rebalancing is the expected explanation.",
    run_id: "phase03-e",
    run_name: "phase 03 hedge reactive put flow",
    seed_bundle: {
      seed: 305,
      namespace: "synthetic-phase-03",
      partition: "hedge"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T19:05:00Z"),
      steps: 4,
      symbols: [{ id: "qqq-hedge", underlying_id: "QQQ", base_price: 428, exchange: "NASDAQ" }],
      liquidity: {
        id: "hedge-liquidity",
        equity_spread_bps: 6,
        equity_quote_size: 1_300,
        equity_trade_size: 420,
        option_spread_bps: 140,
        option_quote_size: 120,
        option_trade_size: 58,
        off_exchange_ratio: 0.16,
        arrival_interval_ms: 75
      },
      volatility: {
        id: "bearish-hedge-drift",
        drift_bps_per_step: -8,
        price_noise_bps: 12,
        option_iv: 0.48
      },
      option_chain: {
        id: "hedge-put-chain",
        expiries_days: [7, 14],
        strike_offsets_bps: [-300, 0, 200],
        option_types: ["put"],
        strike_step: 1,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: defaultSelectors,
    expected_output: {
      alert_expectation: "alert",
      expected_class: "hedge_rebalance",
      expected_direction: "bearish",
      confidence_band: "medium",
      confidence_range: { min: 0.5, max: 0.78 },
      required_evidence: [
        req(
          "underlying-move",
          "underlying_context",
          "underlying_move_bps",
          "lte",
          -10,
          "Hedge-reactive flow should depend on underlying movement context."
        ),
        req(
          "put-flow",
          "structure_shape",
          "option_type",
          "eq",
          "put",
          "The hedge case should stay tied to put-side flow."
        ),
        req(
          "sufficient-premium",
          "premium_size",
          "total_premium",
          "gte",
          20_000,
          "A hedge rebalance should still be materially sized."
        )
      ],
      forbidden_evidence: [
        req(
          "no-retail-chase",
          "timing_context",
          "retail_burst",
          "present",
          true,
          "Retail burst evidence would change the expected class."
        )
      ],
      expected_pipeline_events: requiredPipelineEvents,
      abstention_reasons: ["not_abstained"],
      false_positive_penalty: {
        score: 0.35,
        severity: "medium",
        reason: "The scorer should not promote hedge context without the bearish underlying move."
      }
    }
  }),
  scenario({
    scenario_id: "structure-arbitrage-calm",
    family: "structure_arbitrage_flow",
    title: "Structure Arbitrage Calm",
    description:
      "Balanced multi-strike flow where structure, not direction, is the expected explanation.",
    run_id: "phase03-f",
    run_name: "phase 03 structure arbitrage calm",
    seed_bundle: {
      seed: 306,
      namespace: "synthetic-phase-03",
      partition: "arbitrage"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T17:25:00Z"),
      steps: 5,
      symbols: [{ id: "iwm-arb", underlying_id: "IWM", base_price: 211, exchange: "ARCA" }],
      liquidity: {
        id: "arb-calm-liquidity",
        equity_spread_bps: 4,
        equity_quote_size: 1_000,
        equity_trade_size: 210,
        option_spread_bps: 105,
        option_quote_size: 130,
        option_trade_size: 44,
        off_exchange_ratio: 0.12,
        arrival_interval_ms: 60
      },
      volatility: {
        id: "calm-arb-volatility",
        drift_bps_per_step: 0,
        price_noise_bps: 4,
        option_iv: 0.31
      },
      option_chain: {
        id: "balanced-arb-chain",
        expiries_days: [14, 28],
        strike_offsets_bps: [-300, 0, 300],
        option_types: ["call", "put"],
        strike_step: 1,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: defaultSelectors,
    expected_output: {
      alert_expectation: "alert",
      expected_class: "structure_arbitrage",
      expected_direction: "neutral",
      confidence_band: "medium",
      confidence_range: { min: 0.5, max: 0.76 },
      required_evidence: [
        req(
          "multi-structure",
          "structure_shape",
          "structure_context",
          "present",
          true,
          "Arbitrage-like cases should be structure-led."
        ),
        req(
          "low-directional-bias",
          "underlying_context",
          "net_directional_bias",
          "lte",
          0.25,
          "The expected output should remain neutral unless direction is evident."
        ),
        req(
          "quote-quality",
          "quote_quality",
          "nbbo_coverage_ratio_mean",
          "gte",
          0.7,
          "Structure comparisons need usable quote context."
        )
      ],
      forbidden_evidence: [
        req(
          "no-event-reason",
          "event_context",
          "days_to_event",
          "lte",
          2,
          "Event positioning should not explain this calm structure case."
        )
      ],
      expected_pipeline_events: requiredPipelineEvents,
      abstention_reasons: ["not_abstained"],
      false_positive_penalty: {
        score: 0.3,
        severity: "medium",
        reason: "Wrongly assigning direction to structural flow should be penalized."
      }
    }
  }),
  scenario({
    scenario_id: "no-alert-wide-quote-chop",
    family: "no_alert_negative",
    title: "No Alert Wide Quote Chop",
    description: "Small noisy prints with wide quote context that should suppress or abstain.",
    run_id: "phase03-g",
    run_name: "phase 03 no alert wide quote chop",
    seed_bundle: {
      seed: 307,
      namespace: "synthetic-phase-03",
      partition: "negative"
    },
    profile: {
      start_ts: Date.parse("2026-01-02T20:10:00Z"),
      steps: 3,
      symbols: [{ id: "spy-no-alert", underlying_id: "SPY", base_price: 499, exchange: "ARCA" }],
      liquidity: {
        id: "wide-noisy-liquidity",
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
        id: "choppy-negative-volatility",
        drift_bps_per_step: 0,
        price_noise_bps: 34,
        option_iv: 0.72
      },
      option_chain: {
        id: "negative-noisy-chain",
        expiries_days: [1, 3],
        strike_offsets_bps: [-900, 900],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    event_selectors: [
      {
        role: "anchor",
        kind: "option_print",
        ordinal: 0,
        description: "Noisy option print that should not become an alert by itself."
      },
      {
        role: "context",
        kind: "option_nbbo",
        ordinal: 0,
        description: "Wide option NBBO context that should suppress confidence."
      },
      {
        role: "context",
        kind: "equity_quote",
        ordinal: 0,
        description: "Wide underlying quote context."
      }
    ],
    expected_output: {
      alert_expectation: "no_alert",
      expected_class: "unclear",
      expected_direction: "unknown",
      confidence_band: "low",
      confidence_range: { min: 0, max: 0.35 },
      required_evidence: [
        req(
          "wide-option-quote",
          "quote_quality",
          "option_spread_bps_max",
          "gte",
          800,
          "The negative case should document why quote context is weak."
        ),
        req(
          "thin-premium",
          "premium_size",
          "total_premium",
          "lte",
          10_000,
          "No-alert fixtures should include low-premium examples."
        ),
        req(
          "suppression-reason",
          "eligibility_decision",
          "reason_code",
          "present",
          true,
          "Expected output should explain suppression or abstention."
        )
      ],
      forbidden_evidence: [
        req(
          "no-alert-hypothesis",
          "synthetic_ground_truth",
          "alert_expectation",
          "eq",
          "alert",
          "This negative scenario exists to penalize false positives."
        ),
        req(
          "no-high-confidence",
          "other",
          "confidence_band",
          "eq",
          "high",
          "Wide noisy context must not produce a high-confidence alert."
        )
      ],
      expected_pipeline_events: noAlertPipelineEvents,
      abstention_reasons: ["inside_market_context", "below_policy_threshold"],
      false_positive_penalty: {
        score: 0.9,
        severity: "high",
        reason: "Any alert on this fixture should count as a strong false positive."
      }
    }
  })
];

export const listSyntheticScenarioInjections = (): ScenarioInjection[] =>
  SYNTHETIC_SCENARIO_CATALOG.map(clone);

export const getSyntheticScenarioInjection = (scenarioId: string): ScenarioInjection => {
  const scenarioMatch = SYNTHETIC_SCENARIO_CATALOG.find(
    (entry) => entry.scenario_id === scenarioId
  );
  if (!scenarioMatch) {
    throw new Error(`Unknown synthetic scenario_id: ${scenarioId}`);
  }
  return clone(scenarioMatch);
};

export const buildGroundTruthLabelSet = (
  scenarioInjection: ScenarioInjection,
  batch: GeneratedEventBatch
): GroundTruthLabelSet => {
  assertGeneratedMarketEventsDoNotContainHiddenLabels(batch.events);
  const eventRefs = resolveScenarioEventRefs(batch, scenarioInjection.event_selectors);
  const label: GroundTruthLabel = {
    schema_version: SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
    label_id: `label:${batch.run.run_id}:${scenarioInjection.scenario_id}`,
    run_id: batch.run.run_id,
    scenario_id: scenarioInjection.scenario_id,
    family: scenarioInjection.family,
    event_refs: eventRefs,
    expected_class: scenarioInjection.expected_output.expected_class,
    expected_direction: scenarioInjection.expected_output.expected_direction,
    confidence_band: scenarioInjection.expected_output.confidence_band,
    required_evidence: scenarioInjection.expected_output.required_evidence,
    forbidden_evidence: scenarioInjection.expected_output.forbidden_evidence,
    false_positive_penalty: scenarioInjection.expected_output.false_positive_penalty,
    notes: scenarioInjection.description
  };
  const labelSet: GroundTruthLabelSet = {
    schema_version: SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
    catalog_version: SYNTHETIC_SCENARIO_CATALOG_VERSION,
    run_id: batch.run.run_id,
    scenario_id: scenarioInjection.scenario_id,
    labels: [label]
  };

  assertLabelRefsBelongToBatch(labelSet, batch);
  return labelSet;
};

export const buildSmartFlowExpectedOutputManifest = (
  scenarioInjection: ScenarioInjection,
  labelSet: GroundTruthLabelSet
): SmartFlowExpectedOutputManifest => {
  const [label] = labelSet.labels;
  if (!label) {
    throw new Error("Synthetic scenario expected outputs require at least one ground-truth label.");
  }

  return {
    schema_version: SYNTHETIC_SMART_FLOW_EXPECTED_OUTPUTS_VERSION,
    catalog_version: SYNTHETIC_SCENARIO_CATALOG_VERSION,
    label_schema_version: SYNTHETIC_GROUND_TRUTH_LABELS_VERSION,
    run_id: labelSet.run_id,
    scenario_id: scenarioInjection.scenario_id,
    source_label_hash: stableHash(labelSet),
    expectations: [
      {
        expected_output_id: `expected:${labelSet.run_id}:${scenarioInjection.scenario_id}`,
        label_id: label.label_id,
        alert_expectation: scenarioInjection.expected_output.alert_expectation,
        expected_class: scenarioInjection.expected_output.expected_class,
        expected_direction: scenarioInjection.expected_output.expected_direction,
        confidence_band: scenarioInjection.expected_output.confidence_band,
        confidence_range: scenarioInjection.expected_output.confidence_range,
        expected_pipeline_events: scenarioInjection.expected_output.expected_pipeline_events,
        required_evidence: scenarioInjection.expected_output.required_evidence,
        forbidden_evidence: scenarioInjection.expected_output.forbidden_evidence,
        abstention_reasons: scenarioInjection.expected_output.abstention_reasons,
        false_positive_penalty: scenarioInjection.expected_output.false_positive_penalty
      }
    ]
  };
};

export const createSyntheticScenarioFixtureArtifacts = (
  input: CreateSyntheticScenarioFixtureInput
): SyntheticScenarioFixtureArtifacts => {
  const scenarioInjection = getSyntheticScenarioInjection(input.scenario_id);
  const artifactLayout: SyntheticScenarioFixtureArtifactLayout = {
    ...DEFAULT_SYNTHETIC_SCENARIO_FIXTURE_ARTIFACT_LAYOUT,
    ...input.artifact_layout
  };
  const batch = generateSyntheticMarketBatch({
    seed_bundle: input.seed_bundle ?? scenarioInjection.seed_bundle,
    profile: scenarioInjection.profile,
    run_id: input.run_id ?? scenarioInjection.run_id
  });
  const labels = buildGroundTruthLabelSet(scenarioInjection, batch);
  const smartFlowExpectedOutputs = buildSmartFlowExpectedOutputManifest(scenarioInjection, labels);
  const labelsHash = stableHash(labels);
  const smartFlowOutputsHash = stableHash(smartFlowExpectedOutputs);
  const manifest = buildExpectedOutputManifest({
    batch,
    run_name: scenarioInjection.run_name,
    profile_source_path: `catalog:${scenarioInjection.scenario_id}`,
    artifact_layout: artifactLayout,
    expected_output_contract: {
      labels_path: artifactLayout.labels_path,
      smart_flow_outputs_path: artifactLayout.smart_flow_outputs_path,
      labels_hash: labelsHash,
      smart_flow_outputs_hash: smartFlowOutputsHash,
      label_count: labels.labels.length,
      expected_output_count: smartFlowExpectedOutputs.expectations.length
    }
  });

  return {
    scenario: scenarioInjection,
    manifest,
    labels,
    smart_flow_expected_outputs: smartFlowExpectedOutputs,
    batch,
    files: {
      manifest: toDeterministicJson(manifest),
      market_events: toDeterministicJson(batch.events),
      provenance: toDeterministicJson(batch.provenance_by_trace_id),
      parameter_snapshot: toDeterministicJson(batch.parameter_snapshot),
      labels: toDeterministicJson(labels),
      smart_flow_outputs: toDeterministicJson(smartFlowExpectedOutputs)
    }
  };
};

export const writeSyntheticScenarioFixture = async (
  input: WriteSyntheticScenarioFixtureInput
): Promise<WrittenSyntheticScenarioFixture> => {
  const artifacts = createSyntheticScenarioFixtureArtifacts(input);
  const outputDir = path.resolve(input.output_dir);
  await mkdir(outputDir, { recursive: true });

  const paths = {
    manifest: path.join(outputDir, artifacts.manifest.artifacts.manifest_path),
    market_events: path.join(outputDir, artifacts.manifest.artifacts.market_events_path),
    provenance: path.join(outputDir, artifacts.manifest.artifacts.provenance_path),
    parameter_snapshot: path.join(outputDir, artifacts.manifest.artifacts.parameter_snapshot_path),
    labels: path.join(
      outputDir,
      requireScenarioContractPath(
        artifacts.manifest.expected_output_contract.labels_path,
        "labels_path"
      )
    ),
    smart_flow_outputs: path.join(
      outputDir,
      requireScenarioContractPath(
        artifacts.manifest.expected_output_contract.smart_flow_outputs_path,
        "smart_flow_outputs_path"
      )
    )
  };

  await Promise.all([
    writeFile(paths.manifest, artifacts.files.manifest, "utf8"),
    writeFile(paths.market_events, artifacts.files.market_events, "utf8"),
    writeFile(paths.provenance, artifacts.files.provenance, "utf8"),
    writeFile(paths.parameter_snapshot, artifacts.files.parameter_snapshot, "utf8"),
    writeFile(paths.labels, artifacts.files.labels, "utf8"),
    writeFile(paths.smart_flow_outputs, artifacts.files.smart_flow_outputs, "utf8")
  ]);

  return {
    ...artifacts,
    paths
  };
};

const resolveScenarioEventRefs = (
  batch: GeneratedEventBatch,
  selectors: ScenarioEventSelector[]
): ScenarioEventRef[] => {
  return selectors.map((selector) => {
    const matches = batch.events.filter((generated) => generated.kind === selector.kind);
    const ordinal = selector.ordinal ?? 0;
    const match = matches[ordinal];

    if (!match) {
      throw new Error(
        `Synthetic scenario could not resolve ${selector.kind} event at ordinal ${ordinal}.`
      );
    }

    return {
      role: selector.role,
      event_kind: match.kind,
      event_id: match.event.trace_id,
      trace_id: match.event.trace_id,
      source_ts: match.event.source_ts,
      seq: match.event.seq,
      description: selector.description
    };
  });
};

const assertLabelRefsBelongToBatch = (
  labelSet: GroundTruthLabelSet,
  batch: GeneratedEventBatch
): void => {
  const traceIds = new Set(batch.events.map((generated) => generated.event.trace_id));

  for (const label of labelSet.labels) {
    for (const ref of label.event_refs) {
      if (!traceIds.has(ref.trace_id)) {
        throw new Error(
          `Ground-truth label ${label.label_id} references unknown trace_id ${ref.trace_id}.`
        );
      }
    }
  }
};

const requireScenarioContractPath = (value: string | null, fieldName: string): string => {
  if (!value) {
    throw new Error(`Synthetic scenario fixture manifest is missing ${fieldName}.`);
  }
  return value;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
