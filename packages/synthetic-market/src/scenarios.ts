import type {
  FlowEvidenceFactKind,
  FlowHypothesisType,
  SmartMoneyConfidenceBand,
  SmartMoneyDirection,
  SmartMoneyProfileId,
  SyntheticScenarioFamilyId
} from "@islandflow/types";
import type {
  GeneratedEventBatch,
  GeneratedMarketEvent,
  GeneratedMarketEventKind,
  SeedBundle,
  SyntheticMarketProfile
} from "./index";

export const SYNTHETIC_SCENARIO_CATALOG_VERSION = "synthetic-scenario-catalog-v1";
export const SYNTHETIC_GROUND_TRUTH_LABEL_VERSION = "synthetic-ground-truth-label-v1";

export type GroundTruthExpectedClass = SmartMoneyProfileId | "no_alert";
export type GroundTruthConfidenceBand = SmartMoneyConfidenceBand | "abstain";
export type GroundTruthPenaltySeverity = "low" | "medium" | "high";

export type GroundTruthEvidenceRequirement = {
  kind: FlowEvidenceFactKind;
  feature_key?: string;
  description: string;
};

export type GroundTruthFalsePositivePenalty = {
  penalty_id: string;
  applies_to: GroundTruthExpectedClass | "any_alert";
  severity: GroundTruthPenaltySeverity;
  reason: string;
};

export type ScenarioLabelPolicy = {
  anchor_event_kinds: GeneratedMarketEventKind[];
  max_event_refs: number;
  required_evidence: GroundTruthEvidenceRequirement[];
  forbidden_evidence: GroundTruthEvidenceRequirement[];
  false_positive_penalties: GroundTruthFalsePositivePenalty[];
};

export type ScenarioInjection = {
  catalog_version: typeof SYNTHETIC_SCENARIO_CATALOG_VERSION;
  scenario_id: string;
  name: string;
  description: string;
  family_id: SyntheticScenarioFamilyId;
  expected_class: GroundTruthExpectedClass;
  expected_hypothesis_type: FlowHypothesisType | "unclear";
  expected_direction: SmartMoneyDirection;
  confidence_band: GroundTruthConfidenceBand;
  seed_bundle: SeedBundle;
  profile: SyntheticMarketProfile;
  label_policy: ScenarioLabelPolicy;
  tags: string[];
};

export type GroundTruthEventRef = {
  trace_id: string;
  event_kind: GeneratedMarketEventKind;
  role: "anchor" | "context";
  ts: number;
  seq: number;
  underlying_id: string;
  option_contract_id?: string;
};

export type GroundTruthLabel = {
  label_version: typeof SYNTHETIC_GROUND_TRUTH_LABEL_VERSION;
  label_id: string;
  run_id: string;
  scenario_id: string;
  family_id: SyntheticScenarioFamilyId;
  expected_class: GroundTruthExpectedClass;
  expected_hypothesis_type: FlowHypothesisType | "unclear";
  expected_direction: SmartMoneyDirection;
  confidence_band: GroundTruthConfidenceBand;
  event_refs: GroundTruthEventRef[];
  required_evidence: GroundTruthEvidenceRequirement[];
  forbidden_evidence: GroundTruthEvidenceRequirement[];
  false_positive_penalties: GroundTruthFalsePositivePenalty[];
  no_alert_expected: boolean;
};

const START_TS = Date.parse("2026-01-02T14:30:00Z");

const completeShortDatedChain: NonNullable<SyntheticMarketProfile["option_chain"]> = {
  expiries_days: [7, 14],
  strike_offsets_bps: [-250, 0, 250],
  option_types: ["call", "put"],
  strike_step: 5,
  sparse_contract_ratio: 0
};

const evidence = (
  kind: FlowEvidenceFactKind,
  description: string,
  featureKey?: string
): GroundTruthEvidenceRequirement => ({
  kind,
  feature_key: featureKey,
  description
});

const penalty = (
  penaltyId: string,
  appliesTo: GroundTruthFalsePositivePenalty["applies_to"],
  reason: string,
  severity: GroundTruthPenaltySeverity = "medium"
): GroundTruthFalsePositivePenalty => ({
  penalty_id: penaltyId,
  applies_to: appliesTo,
  severity,
  reason
});

const scenario = (
  input: Omit<ScenarioInjection, "catalog_version" | "profile"> & {
    profile: Omit<SyntheticMarketProfile, "scenario_id">;
  }
): ScenarioInjection => ({
  ...input,
  catalog_version: SYNTHETIC_SCENARIO_CATALOG_VERSION,
  profile: {
    ...input.profile,
    scenario_id: input.scenario_id
  }
});

export const SYNTHETIC_SCENARIO_CATALOG: ScenarioInjection[] = [
  scenario({
    scenario_id: "synthetic:institutional-directional:call-accumulation",
    name: "Institutional directional call accumulation",
    description:
      "Large, orderly call-side participation with aligned underlying drift and usable quote context.",
    family_id: "institutional_directional",
    expected_class: "institutional_directional",
    expected_hypothesis_type: "directional_accumulation",
    expected_direction: "bullish",
    confidence_band: "high",
    seed_bundle: {
      seed: 3101,
      namespace: "synthetic-phase-03a",
      partition: "institutional-directional"
    },
    profile: {
      start_ts: START_TS,
      steps: 4,
      symbols: [
        { id: "spy-directional", underlying_id: "SPY", base_price: 501.25, exchange: "ARCA" },
        { id: "nvda-directional", underlying_id: "NVDA", base_price: 124.5, exchange: "NASDAQ" }
      ],
      liquidity: {
        id: "institutional-directional-liquidity",
        equity_spread_bps: 5,
        equity_quote_size: 1_100,
        equity_trade_size: 280,
        option_spread_bps: 95,
        option_quote_size: 90,
        option_trade_size: 48,
        off_exchange_ratio: 0.28,
        arrival_interval_ms: 140
      },
      volatility: {
        id: "institutional-directional-drift",
        drift_bps_per_step: 8,
        price_noise_bps: 5,
        option_iv: 0.42
      },
      option_chain: {
        id: "institutional-directional-chain",
        ...completeShortDatedChain
      }
    },
    label_policy: {
      anchor_event_kinds: ["option_print", "equity_print"],
      max_event_refs: 10,
      required_evidence: [
        evidence(
          "premium_size",
          "Large option premium anchors the positive label.",
          "total_premium"
        ),
        evidence(
          "execution_aggression",
          "Option prints should resolve to aggressive or above-mid execution.",
          "aggression_ratio"
        ),
        evidence(
          "underlying_context",
          "Underlying prints should support the bullish directional move.",
          "underlying_drift_bps"
        )
      ],
      forbidden_evidence: [
        evidence("quote_quality", "Stale or missing NBBO context must not be needed for the label.")
      ],
      false_positive_penalties: [
        penalty(
          "directional-confused-with-retail",
          "retail_whale",
          "Do not classify orderly institutional flow as retail attention.",
          "medium"
        )
      ]
    },
    tags: ["positive", "directional", "call-flow"]
  }),
  scenario({
    scenario_id: "synthetic:retail-attention:meme-chase",
    name: "Retail attention chase",
    description:
      "Fast, noisy upside participation in attention-sensitive names where timing matters more than size.",
    family_id: "retail_whale",
    expected_class: "retail_whale",
    expected_hypothesis_type: "retail_attention_flow",
    expected_direction: "bullish",
    confidence_band: "medium",
    seed_bundle: {
      seed: 3102,
      namespace: "synthetic-phase-03a",
      partition: "retail-attention"
    },
    profile: {
      start_ts: START_TS + 12 * 60_000,
      steps: 5,
      symbols: [
        { id: "tsla-retail", underlying_id: "TSLA", base_price: 184.4, exchange: "NASDAQ" },
        { id: "amd-retail", underlying_id: "AMD", base_price: 173.2, exchange: "NASDAQ" }
      ],
      liquidity: {
        id: "retail-attention-liquidity",
        equity_spread_bps: 11,
        equity_quote_size: 700,
        equity_trade_size: 170,
        option_spread_bps: 180,
        option_quote_size: 55,
        option_trade_size: 24,
        off_exchange_ratio: 0.44,
        arrival_interval_ms: 90
      },
      volatility: {
        id: "retail-attention-volatility",
        drift_bps_per_step: 13,
        price_noise_bps: 22,
        option_iv: 0.72
      },
      option_chain: {
        id: "retail-attention-chain",
        ...completeShortDatedChain
      }
    },
    label_policy: {
      anchor_event_kinds: ["option_print", "equity_print"],
      max_event_refs: 12,
      required_evidence: [
        evidence("timing_context", "Clustered arrival timing should be visible in the replay."),
        evidence(
          "premium_size",
          "Premium can be moderate, but repeated prints should accumulate.",
          "packet_count"
        )
      ],
      forbidden_evidence: [
        evidence("structure_shape", "Complex or spread structures should not be required.")
      ],
      false_positive_penalties: [
        penalty(
          "retail-overfit-on-one-large-print",
          "institutional_directional",
          "One large print alone should not override the attention-flow label.",
          "high"
        )
      ]
    },
    tags: ["positive", "retail", "attention"]
  }),
  scenario({
    scenario_id: "synthetic:event-noise:post-catalyst-chop",
    name: "Event and noise positioning",
    description:
      "Post-catalyst option flow with a noisy underlying tape that should require event context.",
    family_id: "event_driven",
    expected_class: "event_driven",
    expected_hypothesis_type: "event_positioning",
    expected_direction: "mixed",
    confidence_band: "medium",
    seed_bundle: {
      seed: 3103,
      namespace: "synthetic-phase-03a",
      partition: "event-noise"
    },
    profile: {
      start_ts: START_TS + 25 * 60_000,
      steps: 4,
      symbols: [
        { id: "aapl-event", underlying_id: "AAPL", base_price: 214.8, exchange: "NASDAQ" },
        { id: "meta-event", underlying_id: "META", base_price: 686.4, exchange: "NASDAQ" }
      ],
      liquidity: {
        id: "event-noise-liquidity",
        equity_spread_bps: 14,
        equity_quote_size: 620,
        equity_trade_size: 220,
        option_spread_bps: 210,
        option_quote_size: 45,
        option_trade_size: 28,
        off_exchange_ratio: 0.34,
        arrival_interval_ms: 110
      },
      volatility: {
        id: "event-noise-volatility",
        drift_bps_per_step: 2,
        price_noise_bps: 42,
        option_iv: 0.86
      },
      option_chain: {
        id: "event-noise-chain",
        ...completeShortDatedChain
      }
    },
    label_policy: {
      anchor_event_kinds: ["option_print", "equity_print"],
      max_event_refs: 10,
      required_evidence: [
        evidence("event_context", "The label is positive only with explicit event context."),
        evidence(
          "quote_quality",
          "Noisy markets still need usable quote coverage.",
          "nbbo_coverage_ratio"
        )
      ],
      forbidden_evidence: [
        evidence("underlying_context", "A clean one-way underlying trend must not be assumed.")
      ],
      false_positive_penalties: [
        penalty(
          "event-without-context",
          "institutional_directional",
          "Directional classification should be penalized when catalyst context is missing.",
          "high"
        )
      ]
    },
    tags: ["positive", "event", "noise"]
  }),
  scenario({
    scenario_id: "synthetic:vol-seller:range-compression",
    name: "Volatility seller range compression",
    description:
      "Neutral-to-mixed option selling behavior in a clean, range-bound underlying environment.",
    family_id: "vol_seller",
    expected_class: "vol_seller",
    expected_hypothesis_type: "volatility_supply",
    expected_direction: "neutral",
    confidence_band: "medium",
    seed_bundle: {
      seed: 3104,
      namespace: "synthetic-phase-03a",
      partition: "vol-seller"
    },
    profile: {
      start_ts: START_TS + 45 * 60_000,
      steps: 4,
      symbols: [
        { id: "spy-vol-seller", underlying_id: "SPY", base_price: 502.1, exchange: "ARCA" }
      ],
      liquidity: {
        id: "vol-seller-liquidity",
        equity_spread_bps: 4,
        equity_quote_size: 1_400,
        equity_trade_size: 190,
        option_spread_bps: 70,
        option_quote_size: 130,
        option_trade_size: 36,
        off_exchange_ratio: 0.18,
        arrival_interval_ms: 180
      },
      volatility: {
        id: "vol-seller-range",
        drift_bps_per_step: 0,
        price_noise_bps: 4,
        option_iv: 0.24
      },
      option_chain: {
        id: "vol-seller-chain",
        expiries_days: [14, 30],
        strike_offsets_bps: [-500, 0, 500],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    label_policy: {
      anchor_event_kinds: ["option_print", "option_nbbo"],
      max_event_refs: 8,
      required_evidence: [
        evidence(
          "structure_shape",
          "Both call and put structures should support volatility supply."
        ),
        evidence(
          "quote_quality",
          "Tight option markets are part of the scenario.",
          "option_spread_bps"
        )
      ],
      forbidden_evidence: [
        evidence(
          "underlying_context",
          "A strong directional underlying move should suppress this label."
        )
      ],
      false_positive_penalties: [
        penalty(
          "vol-seller-called-directional",
          "institutional_directional",
          "Directional labels should be penalized when range compression is the intended setup.",
          "high"
        )
      ]
    },
    tags: ["positive", "volatility-supply", "range"]
  }),
  scenario({
    scenario_id: "synthetic:hedge-reactive:downside-rebalance",
    name: "Hedge-reactive downside rebalance",
    description:
      "Put-heavy participation after an underlying drift lower, intended to look like reactive hedging.",
    family_id: "hedge_reactive",
    expected_class: "hedge_reactive",
    expected_hypothesis_type: "hedge_rebalance",
    expected_direction: "bearish",
    confidence_band: "high",
    seed_bundle: {
      seed: 3105,
      namespace: "synthetic-phase-03a",
      partition: "hedge-reactive"
    },
    profile: {
      start_ts: START_TS + 70 * 60_000,
      steps: 5,
      symbols: [
        { id: "qqq-hedge", underlying_id: "QQQ", base_price: 531.35, exchange: "NASDAQ" },
        { id: "nvda-hedge", underlying_id: "NVDA", base_price: 123.7, exchange: "NASDAQ" }
      ],
      liquidity: {
        id: "hedge-reactive-liquidity",
        equity_spread_bps: 8,
        equity_quote_size: 950,
        equity_trade_size: 260,
        option_spread_bps: 135,
        option_quote_size: 85,
        option_trade_size: 44,
        off_exchange_ratio: 0.26,
        arrival_interval_ms: 130
      },
      volatility: {
        id: "hedge-reactive-downtrend",
        drift_bps_per_step: -10,
        price_noise_bps: 14,
        option_iv: 0.58
      },
      option_chain: {
        id: "hedge-reactive-chain",
        ...completeShortDatedChain
      }
    },
    label_policy: {
      anchor_event_kinds: ["option_print", "equity_print"],
      max_event_refs: 12,
      required_evidence: [
        evidence(
          "underlying_context",
          "Underlying context should show the lower drift.",
          "underlying_drift_bps"
        ),
        evidence("timing_context", "Hedge flow should arrive after the move, not before it.")
      ],
      forbidden_evidence: [
        evidence("event_context", "The label should not require a standalone news catalyst.")
      ],
      false_positive_penalties: [
        penalty(
          "hedge-reactive-called-event",
          "event_driven",
          "Event-driven labels should be penalized when the flow is reactive to price action.",
          "medium"
        )
      ]
    },
    tags: ["positive", "hedge", "bearish"]
  }),
  scenario({
    scenario_id: "synthetic:arbitrage:paired-structure",
    name: "Arbitrage-like paired structure",
    description:
      "Clean, paired option structures with low directional drift, meant to exercise structure-aware logic.",
    family_id: "arbitrage",
    expected_class: "arbitrage",
    expected_hypothesis_type: "structure_arbitrage",
    expected_direction: "mixed",
    confidence_band: "medium",
    seed_bundle: {
      seed: 3106,
      namespace: "synthetic-phase-03a",
      partition: "arbitrage"
    },
    profile: {
      start_ts: START_TS + 95 * 60_000,
      steps: 4,
      symbols: [
        { id: "spy-arb", underlying_id: "SPY", base_price: 501.8, exchange: "ARCA" },
        { id: "qqq-arb", underlying_id: "QQQ", base_price: 531.0, exchange: "NASDAQ" }
      ],
      liquidity: {
        id: "arbitrage-liquidity",
        equity_spread_bps: 3,
        equity_quote_size: 1_500,
        equity_trade_size: 160,
        option_spread_bps: 55,
        option_quote_size: 160,
        option_trade_size: 30,
        off_exchange_ratio: 0.16,
        arrival_interval_ms: 120
      },
      volatility: {
        id: "arbitrage-calm",
        drift_bps_per_step: 0,
        price_noise_bps: 3,
        option_iv: 0.3
      },
      option_chain: {
        id: "arbitrage-chain",
        expiries_days: [7, 14, 30],
        strike_offsets_bps: [-500, 0, 500],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    label_policy: {
      anchor_event_kinds: ["option_print", "option_nbbo"],
      max_event_refs: 12,
      required_evidence: [
        evidence("structure_shape", "The scenario requires paired structure recognition."),
        evidence(
          "quote_quality",
          "Tight, current quotes should support the structure.",
          "nbbo_coverage_ratio"
        )
      ],
      forbidden_evidence: [
        evidence("premium_size", "Large isolated premium should not be the primary basis.")
      ],
      false_positive_penalties: [
        penalty(
          "arb-called-retail",
          "retail_whale",
          "Retail attention labels should be penalized when the tape is calm and structured.",
          "high"
        )
      ]
    },
    tags: ["positive", "arbitrage", "structure"]
  }),
  scenario({
    scenario_id: "synthetic:no-alert:quiet-clean-background",
    name: "No-alert clean background",
    description:
      "Quiet, well-quoted background activity that should produce labels for abstention and false-positive checks.",
    family_id: "neutral_noise",
    expected_class: "no_alert",
    expected_hypothesis_type: "unclear",
    expected_direction: "unknown",
    confidence_band: "abstain",
    seed_bundle: {
      seed: 3107,
      namespace: "synthetic-phase-03a",
      partition: "no-alert"
    },
    profile: {
      start_ts: START_TS + 120 * 60_000,
      steps: 3,
      symbols: [{ id: "spy-neutral", underlying_id: "SPY", base_price: 501.5, exchange: "ARCA" }],
      liquidity: {
        id: "no-alert-liquidity",
        equity_spread_bps: 3,
        equity_quote_size: 1_600,
        equity_trade_size: 80,
        option_spread_bps: 45,
        option_quote_size: 120,
        option_trade_size: 6,
        off_exchange_ratio: 0.12,
        arrival_interval_ms: 240
      },
      volatility: {
        id: "no-alert-calm",
        drift_bps_per_step: 0,
        price_noise_bps: 2,
        option_iv: 0.22
      },
      option_chain: {
        id: "no-alert-chain",
        expiries_days: [14],
        strike_offsets_bps: [0],
        option_types: ["call", "put"],
        strike_step: 5,
        sparse_contract_ratio: 0
      }
    },
    label_policy: {
      anchor_event_kinds: ["equity_quote", "option_nbbo", "option_print"],
      max_event_refs: 8,
      required_evidence: [
        evidence("quote_quality", "Clean quotes establish this as an intentional negative case.")
      ],
      forbidden_evidence: [
        evidence("premium_size", "Large premium should be absent in the no-alert control."),
        evidence(
          "execution_aggression",
          "Aggressive execution should be absent in the no-alert control."
        ),
        evidence("event_context", "No event catalyst should be required or implied.")
      ],
      false_positive_penalties: [
        penalty(
          "quiet-background-alerted",
          "any_alert",
          "Any positive smart-flow alert on this scenario is a false positive.",
          "high"
        )
      ]
    },
    tags: ["negative", "no-alert", "abstention"]
  })
];

export const listScenarioInjections = (): ScenarioInjection[] => {
  return SYNTHETIC_SCENARIO_CATALOG.map((entry) => cloneScenario(entry));
};

export const getScenarioInjection = (scenarioId: string): ScenarioInjection => {
  const scenarioEntry = SYNTHETIC_SCENARIO_CATALOG.find(
    (entry) => entry.scenario_id === scenarioId
  );
  if (!scenarioEntry) {
    throw new Error(`Unknown synthetic scenario injection: ${scenarioId}`);
  }
  return cloneScenario(scenarioEntry);
};

export const buildGroundTruthLabels = (
  batch: GeneratedEventBatch,
  scenarioInput: ScenarioInjection | string = batch.parameter_snapshot.profile.scenario_id ?? ""
): GroundTruthLabel[] => {
  const scenarioEntry =
    typeof scenarioInput === "string" ? getScenarioInjection(scenarioInput) : scenarioInput;
  const batchScenarioId = batch.parameter_snapshot.profile.scenario_id;

  if (batchScenarioId !== scenarioEntry.scenario_id) {
    throw new Error(
      `Batch scenario_id ${String(batchScenarioId ?? "(missing)")} does not match label scenario ${scenarioEntry.scenario_id}.`
    );
  }

  const anchorKinds = new Set(scenarioEntry.label_policy.anchor_event_kinds);
  const eventRefs = batch.events
    .map((generated) => eventRefFromGenerated(batch, generated))
    .filter((ref): ref is GroundTruthEventRef => ref !== null && anchorKinds.has(ref.event_kind))
    .slice(0, scenarioEntry.label_policy.max_event_refs);

  if (eventRefs.length === 0) {
    throw new Error(
      `Synthetic scenario ${scenarioEntry.scenario_id} produced no label event refs.`
    );
  }

  const labelId = [
    "label",
    batch.run.run_id,
    scenarioEntry.scenario_id,
    eventRefs[0]?.trace_id ?? "no-event",
    String(eventRefs.length)
  ].join(":");

  return [
    {
      label_version: SYNTHETIC_GROUND_TRUTH_LABEL_VERSION,
      label_id: labelId,
      run_id: batch.run.run_id,
      scenario_id: scenarioEntry.scenario_id,
      family_id: scenarioEntry.family_id,
      expected_class: scenarioEntry.expected_class,
      expected_hypothesis_type: scenarioEntry.expected_hypothesis_type,
      expected_direction: scenarioEntry.expected_direction,
      confidence_band: scenarioEntry.confidence_band,
      event_refs: eventRefs,
      required_evidence: scenarioEntry.label_policy.required_evidence,
      forbidden_evidence: scenarioEntry.label_policy.forbidden_evidence,
      false_positive_penalties: scenarioEntry.label_policy.false_positive_penalties,
      no_alert_expected: scenarioEntry.expected_class === "no_alert"
    }
  ];
};

const eventRefFromGenerated = (
  batch: GeneratedEventBatch,
  generated: GeneratedMarketEvent
): GroundTruthEventRef | null => {
  const event = generated.event;
  const provenance = batch.provenance_by_trace_id[event.trace_id];

  if (!provenance) {
    return null;
  }

  return {
    trace_id: event.trace_id,
    event_kind: generated.kind,
    role:
      generated.kind === "option_print" || generated.kind === "equity_print" ? "anchor" : "context",
    ts: event.ts,
    seq: event.seq,
    underlying_id: provenance.underlying_id,
    option_contract_id:
      "option_contract_id" in event && typeof event.option_contract_id === "string"
        ? event.option_contract_id
        : undefined
  };
};

const cloneScenario = (entry: ScenarioInjection): ScenarioInjection => {
  return structuredClone(entry);
};
