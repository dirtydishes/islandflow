import {
  type FlowAbstentionReason,
  type FlowAlternativeHypothesis,
  type FlowEvidenceCluster,
  type FlowHypothesisEvent,
  FlowHypothesisEventSchema,
  type FlowHypothesisScoreVector,
  FlowHypothesisScoreVectorSchema,
  type FlowHypothesisType,
  type FlowScorePenalty,
  type FlowScorePenaltyKind,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type SmartFlowInsight,
  type SmartFlowDirection,
  smartFlowInsightFromHypothesisEvent
} from "@islandflow/types";

export type FlowHypothesisScoringConfig = {
  policyVersion?: string;
  modelVersion?: string;
  calibrationVersion?: string | null;
  maxVectors?: number;
};

export type FlowHypothesisProjectionConfig = FlowHypothesisScoringConfig & {
  minFitScore?: number;
  minPolicyConfidence?: number;
  minEvidenceStrength?: number;
  minHypothesisMargin?: number;
  maxPenaltyScore?: number;
  maxAlternatives?: number;
};

export type FlowHypothesisProjection = {
  hypothesis: FlowHypothesisEvent;
  insight: SmartFlowInsight;
};

type ScoreDraft = {
  hypothesisType: FlowHypothesisType;
  direction: SmartFlowDirection;
  evidenceStrength: number;
  fitScore: number;
  penaltyScore: number;
  penalties: FlowScorePenalty[];
  policyConfidence: number;
  conviction: number;
};

type ScoreContext = {
  cluster: FlowEvidenceCluster;
  totalPremium: number;
  totalSize: number;
  memberPrintCount: number;
  candidateCount: number;
  optionType: string;
  structureContext: string;
  structureType: string;
  structureLegs: number;
  sameSizeLegSymmetry: number;
  coverageRatio: number;
  staleRatio: number;
  aggressiveRatio: number;
  aggressiveBuyRatio: number;
  aggressiveSellRatio: number;
  netDirectionalBias: number;
  optionSpreadBps: number | null;
  underlyingSpreadBps: number | null;
  executionIv: number | null;
  underlyingMoveBps: number | null;
  daysToEvent: number | null;
  eligibilityStatus: string;
  evidenceQuality: number;
  generalPenalties: FlowScorePenalty[];
  fallbackEvidenceRefs: string[];
};

const DEFAULT_CONFIG = {
  policyVersion: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  modelVersion: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  calibrationVersion: null,
  maxVectors: 7
} satisfies Required<FlowHypothesisScoringConfig>;

const DEFAULT_PROJECTION_CONFIG = {
  minFitScore: 0.42,
  minPolicyConfidence: 0.42,
  minEvidenceStrength: 0.35,
  minHypothesisMargin: 0.08,
  maxPenaltyScore: 0.5,
  maxAlternatives: 3
} satisfies Required<
  Pick<
    FlowHypothesisProjectionConfig,
    | "minFitScore"
    | "minPolicyConfidence"
    | "minEvidenceStrength"
    | "minHypothesisMargin"
    | "maxPenaltyScore"
    | "maxAlternatives"
  >
>;

const HYPOTHESIS_ORDER: FlowHypothesisType[] = [
  "directional_accumulation",
  "retail_attention_flow",
  "event_positioning",
  "volatility_supply",
  "structure_arbitrage",
  "hedge_rebalance",
  "unclear"
];

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

const clampSignedUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
};

const numberFeature = (
  cluster: FlowEvidenceCluster,
  key: string,
  fallback: number | null = 0
): number | null => {
  const value = cluster.feature_summary[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const stringFeature = (cluster: FlowEvidenceCluster, key: string): string => {
  const value = cluster.feature_summary[key];
  return typeof value === "string" ? value : "";
};

const uniqueSorted = <T extends string>(values: T[]): T[] => Array.from(new Set(values)).sort();

const evidenceRefsFor = (cluster: FlowEvidenceCluster, featureKey?: string): string[] => {
  if (featureKey) {
    const refs = cluster.feature_details[featureKey]?.evidence_refs;
    if (refs && refs.length > 0) {
      return uniqueSorted(refs);
    }
  }

  const refs = cluster.evidence_facts.flatMap((fact) =>
    fact.observation_refs.map((ref) => ref.observation_id)
  );

  return uniqueSorted([...refs, ...cluster.packet_ids, ...cluster.member_print_ids]);
};

const makePenalty = (
  context: Pick<ScoreContext, "cluster" | "fallbackEvidenceRefs">,
  hypothesisType: FlowHypothesisType,
  kind: FlowScorePenaltyKind,
  score: number,
  reason: string,
  featureKey?: string
): FlowScorePenalty => ({
  penalty_id: `penalty:${context.cluster.cluster_id}:${hypothesisType}:${kind}:${featureKey ?? "general"}`,
  kind,
  score: roundTo(clampUnit(score)),
  reason,
  evidence_refs: featureKey
    ? evidenceRefsFor(context.cluster, featureKey)
    : context.fallbackEvidenceRefs,
  ...(featureKey ? { feature_key: featureKey } : {})
});

const dedupePenalties = (penalties: FlowScorePenalty[]): FlowScorePenalty[] => {
  const byId = new Map<string, FlowScorePenalty>();
  for (const penalty of penalties) {
    byId.set(penalty.penalty_id, penalty);
  }
  return [...byId.values()].sort((a, b) => a.penalty_id.localeCompare(b.penalty_id));
};

const aggregatePenaltyScore = (penalties: FlowScorePenalty[]): number =>
  roundTo(clampUnit(Math.max(0, ...penalties.map((penalty) => penalty.score))));

const isPenalty = (penalty: FlowScorePenalty | null): penalty is FlowScorePenalty =>
  penalty !== null;

const hasCaveat = (context: ScoreContext, caveat: string): boolean =>
  context.cluster.evidence_quality.caveats.includes(caveat);

const buildGeneralPenalties = (
  context: Omit<ScoreContext, "generalPenalties">
): FlowScorePenalty[] => {
  const penaltyContext = {
    cluster: context.cluster,
    fallbackEvidenceRefs: context.fallbackEvidenceRefs
  };
  const penalties: FlowScorePenalty[] = [];

  if (context.staleRatio >= 0.5 || hasCaveat(context as ScoreContext, "stale_quote_context")) {
    penalties.push(
      makePenalty(
        penaltyContext,
        "unclear",
        "stale_quote_context",
        0.72,
        "Stale or missing NBBO context weakens all flow hypotheses.",
        "nbbo_stale_ratio_mean"
      )
    );
  }
  if (context.optionSpreadBps !== null && context.optionSpreadBps >= 800) {
    penalties.push(
      makePenalty(
        penaltyContext,
        "unclear",
        "wide_quote_context",
        0.48,
        "The option quote was wide enough to reduce execution-side confidence.",
        "option_spread_bps_max"
      )
    );
  }
  if (context.underlyingSpreadBps !== null && context.underlyingSpreadBps >= 150) {
    penalties.push(
      makePenalty(
        penaltyContext,
        "unclear",
        "wide_underlying_quote_context",
        0.32,
        "The underlying quote was wide enough to weaken context evidence.",
        "underlying_spread_bps_max"
      )
    );
  }
  if (hasCaveat(context as ScoreContext, "inside_market_context")) {
    penalties.push(
      makePenalty(
        penaltyContext,
        "unclear",
        "inside_market_context",
        0.44,
        "Most prints were inside-market without enough aggressor evidence.",
        "eligibility_status"
      )
    );
  }
  if (
    hasCaveat(context as ScoreContext, "noisy_print_context") ||
    context.structureContext === "complex_or_spread_context"
  ) {
    penalties.push(
      makePenalty(
        penaltyContext,
        "unclear",
        "complex_or_special_print_context",
        0.38,
        "Special, complex, or spread-like print context is negative evidence for simple flow reads.",
        "structure_context"
      )
    );
  }
  if (context.totalPremium < 10_000) {
    penalties.push(
      makePenalty(
        penaltyContext,
        "unclear",
        "low_premium",
        0.4,
        "Observed premium is too small for a confident hypothesis under this policy.",
        "total_premium"
      )
    );
  }

  return dedupePenalties(penalties);
};

const buildContext = (cluster: FlowEvidenceCluster): ScoreContext => {
  const fallbackEvidenceRefs = evidenceRefsFor(cluster);
  const baseContext = {
    cluster,
    totalPremium: numberFeature(cluster, "total_premium") ?? 0,
    totalSize: numberFeature(cluster, "total_size") ?? 0,
    memberPrintCount: numberFeature(cluster, "member_print_count") ?? 0,
    candidateCount: numberFeature(cluster, "candidate_count") ?? 0,
    optionType: stringFeature(cluster, "option_type"),
    structureContext: stringFeature(cluster, "structure_context"),
    structureType: stringFeature(cluster, "structure_type"),
    structureLegs: numberFeature(cluster, "structure_legs") ?? 0,
    sameSizeLegSymmetry: clampUnit(numberFeature(cluster, "same_size_leg_symmetry") ?? 0),
    coverageRatio: clampUnit(numberFeature(cluster, "nbbo_coverage_ratio_mean") ?? 0),
    staleRatio: clampUnit(numberFeature(cluster, "nbbo_stale_ratio_mean") ?? 1),
    aggressiveRatio: clampUnit(numberFeature(cluster, "nbbo_aggression_ratio_max") ?? 0),
    aggressiveBuyRatio: clampUnit(numberFeature(cluster, "nbbo_aggressive_buy_ratio_max") ?? 0),
    aggressiveSellRatio: clampUnit(numberFeature(cluster, "nbbo_aggressive_sell_ratio_max") ?? 0),
    netDirectionalBias: clampSignedUnit(numberFeature(cluster, "net_directional_bias") ?? 0),
    optionSpreadBps: numberFeature(cluster, "option_spread_bps_max", null),
    underlyingSpreadBps: numberFeature(cluster, "underlying_spread_bps_max", null),
    executionIv: numberFeature(cluster, "execution_iv", null),
    underlyingMoveBps: numberFeature(cluster, "underlying_move_bps", null),
    daysToEvent: numberFeature(cluster, "days_to_event", null),
    eligibilityStatus: stringFeature(cluster, "eligibility_status"),
    evidenceQuality: clampUnit(cluster.evidence_quality.quality_score),
    fallbackEvidenceRefs
  };

  return {
    ...baseContext,
    generalPenalties: buildGeneralPenalties(baseContext)
  };
};

const inferDirectionalFlow = (context: ScoreContext): SmartFlowDirection => {
  const sellDominant = context.aggressiveSellRatio >= context.aggressiveBuyRatio + 0.12;
  const buyDominant = context.aggressiveBuyRatio >= context.aggressiveSellRatio + 0.12;

  if (context.optionType === "call") {
    return sellDominant ? "bearish" : "bullish";
  }
  if (context.optionType === "put") {
    return sellDominant ? "bullish" : "bearish";
  }
  if (context.optionType === "mixed") {
    return "mixed";
  }
  if (buyDominant || sellDominant) {
    return context.netDirectionalBias >= 0 ? "bullish" : "bearish";
  }
  return "unknown";
};

const flatDirectionPenalty = (
  context: ScoreContext,
  hypothesisType: FlowHypothesisType
): FlowScorePenalty | null => {
  if (Math.abs(context.netDirectionalBias) > 0.12 || context.aggressiveRatio >= 0.45) {
    return null;
  }

  return makePenalty(
    context,
    hypothesisType,
    "weak_aggression",
    0.28,
    "Direction is weak because aggressor evidence is thin or balanced.",
    "net_directional_bias"
  );
};

const buildDraft = (
  context: ScoreContext,
  hypothesisType: FlowHypothesisType,
  direction: SmartFlowDirection,
  fitScore: number,
  contextStrength: number,
  extraPenalties: Array<FlowScorePenalty | null> = []
): ScoreDraft => {
  const evidenceStrength = roundTo(
    clampUnit(
      context.evidenceQuality * 0.42 +
        clampUnit(context.totalPremium / 120_000) * 0.18 +
        context.aggressiveRatio * 0.18 +
        clampUnit(contextStrength) * 0.22
    )
  );
  const penalties = dedupePenalties(
    [...context.generalPenalties, ...extraPenalties].filter(isPenalty)
  );
  const penaltyScore = aggregatePenaltyScore(penalties);
  const fit = roundTo(clampUnit(fitScore));
  const policyConfidence = roundTo(
    clampUnit(fit * (0.55 + evidenceStrength * 0.45) * (1 - penaltyScore * 0.65))
  );
  const conviction = roundTo(clampUnit(fit - penaltyScore * 0.5));

  return {
    hypothesisType,
    direction,
    evidenceStrength,
    fitScore: fit,
    penaltyScore,
    penalties,
    policyConfidence,
    conviction
  };
};

const contextPenalty = (
  context: ScoreContext,
  hypothesisType: FlowHypothesisType,
  kind: FlowScorePenaltyKind,
  score: number,
  reason: string,
  featureKey?: string
): FlowScorePenalty => makePenalty(context, hypothesisType, kind, score, reason, featureKey);

const scoreHypotheses = (context: ScoreContext): ScoreDraft[] => {
  const premiumFactor = clampUnit(context.totalPremium / 120_000);
  const sizeFactor = clampUnit(context.totalSize / 1_800);
  const burstFactor = clampUnit(context.memberPrintCount / 8 + context.candidateCount / 8);
  const directionStrength = clampUnit(
    Math.max(context.aggressiveRatio, Math.abs(context.netDirectionalBias))
  );
  const eventFactor =
    context.daysToEvent === null ? 0 : clampUnit(1 - Math.max(0, context.daysToEvent) / 21);
  const executionIvFactor =
    context.executionIv === null ? 0 : clampUnit((context.executionIv - 0.35) / 0.55);
  const containedUnderlyingFactor =
    context.underlyingMoveBps === null
      ? 0.5
      : clampUnit(1 - Math.abs(context.underlyingMoveBps) / 80);
  const underlyingMoveFactor =
    context.underlyingMoveBps === null ? 0 : clampUnit(Math.abs(context.underlyingMoveBps) / 80);
  const structureFactor = clampUnit(
    (context.structureContext === "complex_or_spread_context" ? 0.42 : 0) +
      (context.structureLegs >= 2 ? 0.24 : 0) +
      context.sameSizeLegSymmetry * 0.34
  );
  const flatBiasFactor = clampUnit(1 - Math.abs(context.netDirectionalBias) / 0.45);
  const directionalDirection = inferDirectionalFlow(context);
  const eventDirection =
    Math.abs(context.netDirectionalBias) <= 0.35 || context.optionType === "mixed"
      ? "mixed"
      : directionalDirection;
  const hedgeDirection =
    context.underlyingMoveBps !== null && context.underlyingMoveBps < -10
      ? "bearish"
      : context.underlyingMoveBps !== null && context.underlyingMoveBps > 10
        ? "bullish"
        : directionalDirection;
  const structurePenalty =
    context.structureContext === "complex_or_spread_context"
      ? contextPenalty(
          context,
          "directional_accumulation",
          "structure_context",
          0.34,
          "Complex or spread-like structure is an alternative explanation to directional accumulation.",
          "structure_context"
        )
      : null;

  const directional = buildDraft(
    context,
    "directional_accumulation",
    directionalDirection,
    0.14 + premiumFactor * 0.28 + directionStrength * 0.26 + context.coverageRatio * 0.14,
    directionStrength,
    [structurePenalty, flatDirectionPenalty(context, "directional_accumulation")]
  );

  const retail = buildDraft(
    context,
    "retail_attention_flow",
    directionalDirection === "unknown" ? "mixed" : directionalDirection,
    0.12 +
      burstFactor * 0.24 +
      context.aggressiveRatio * 0.2 +
      clampUnit(context.totalPremium / 60_000) * 0.12 +
      (context.totalPremium <= 100_000 ? 0.08 : 0),
    burstFactor,
    [
      context.structureContext === "complex_or_spread_context"
        ? contextPenalty(
            context,
            "retail_attention_flow",
            "structure_context",
            0.42,
            "Complex structure context is negative evidence for retail attention flow.",
            "structure_context"
          )
        : null
    ]
  );

  const event = buildDraft(
    context,
    "event_positioning",
    eventDirection,
    0.1 + eventFactor * 0.36 + premiumFactor * 0.14 + context.coverageRatio * 0.1,
    eventFactor,
    [
      eventFactor === 0
        ? contextPenalty(
            context,
            "event_positioning",
            "missing_context",
            0.34,
            "No event timing context was present for the event-positioning hypothesis.",
            "days_to_event"
          )
        : null
    ]
  );

  const volatilitySupply = buildDraft(
    context,
    "volatility_supply",
    "neutral",
    0.1 +
      executionIvFactor * 0.34 +
      context.aggressiveSellRatio * 0.16 +
      premiumFactor * 0.12 +
      containedUnderlyingFactor * 0.12,
    Math.max(executionIvFactor, containedUnderlyingFactor),
    [
      executionIvFactor === 0
        ? contextPenalty(
            context,
            "volatility_supply",
            "missing_context",
            0.26,
            "No elevated execution-IV context was present for volatility supply.",
            "execution_iv"
          )
        : null,
      containedUnderlyingFactor < 0.45
        ? contextPenalty(
            context,
            "volatility_supply",
            "conflicting_direction",
            0.3,
            "Large underlying movement makes volatility supply less plausible.",
            "underlying_move_bps"
          )
        : null
    ]
  );

  const structure = buildDraft(
    context,
    "structure_arbitrage",
    "neutral",
    0.08 + structureFactor * 0.36 + flatBiasFactor * 0.18 + context.coverageRatio * 0.1,
    Math.max(structureFactor, flatBiasFactor),
    [
      eventFactor > 0.75
        ? contextPenalty(
            context,
            "structure_arbitrage",
            "missing_context",
            0.18,
            "Nearby event context competes with a calm structure-arbitrage explanation.",
            "days_to_event"
          )
        : null
    ]
  );

  const hedge = buildDraft(
    context,
    "hedge_rebalance",
    hedgeDirection,
    0.1 +
      underlyingMoveFactor * 0.28 +
      (context.optionType === "put" ? 0.12 : 0) +
      sizeFactor * 0.12 +
      premiumFactor * 0.08,
    Math.max(underlyingMoveFactor, sizeFactor),
    [
      underlyingMoveFactor === 0
        ? contextPenalty(
            context,
            "hedge_rebalance",
            "missing_context",
            0.34,
            "No underlying movement context was present for hedge rebalancing.",
            "underlying_move_bps"
          )
        : null
    ]
  );

  const strongestFit = Math.max(
    directional.fitScore,
    retail.fitScore,
    event.fitScore,
    volatilitySupply.fitScore,
    structure.fitScore,
    hedge.fitScore
  );
  const strongestPenalty = Math.max(
    directional.penaltyScore,
    retail.penaltyScore,
    event.penaltyScore,
    volatilitySupply.penaltyScore,
    structure.penaltyScore,
    hedge.penaltyScore
  );

  const unclear = buildDraft(
    context,
    "unclear",
    "unknown",
    0.12 +
      (1 - strongestFit) * 0.22 +
      strongestPenalty * 0.42 +
      (1 - context.evidenceQuality) * 0.14,
    Math.max(strongestPenalty, 1 - context.evidenceQuality),
    []
  );

  return [directional, retail, event, volatilitySupply, structure, hedge, unclear];
};

const toScoreVector = (
  draft: ScoreDraft,
  config: Required<FlowHypothesisScoringConfig>,
  hypothesisMargin: number
): FlowHypothesisScoreVector =>
  FlowHypothesisScoreVectorSchema.parse({
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: config.policyVersion,
    model_version: config.modelVersion,
    hypothesis_type: draft.hypothesisType,
    direction: draft.direction,
    evidence_strength: draft.evidenceStrength,
    fit_score: draft.fitScore,
    penalty_score: draft.penaltyScore,
    penalties: draft.penalties.map((penalty) => ({
      ...penalty,
      evidence_refs: uniqueSorted(penalty.evidence_refs)
    })),
    confidence: {
      policy_confidence: draft.policyConfidence,
      evidence_quality: draft.evidenceStrength,
      hypothesis_margin: roundTo(clampUnit(hypothesisMargin)),
      conviction: draft.conviction,
      calibration_version: config.calibrationVersion
    }
  });

const sortDrafts = (drafts: ScoreDraft[]): ScoreDraft[] =>
  [...drafts].sort((a, b) => {
    const confidenceDelta = b.policyConfidence - a.policyConfidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return HYPOTHESIS_ORDER.indexOf(a.hypothesisType) - HYPOTHESIS_ORDER.indexOf(b.hypothesisType);
  });

export const scoreFlowEvidenceCluster = (
  cluster: FlowEvidenceCluster,
  config: FlowHypothesisScoringConfig = {}
): FlowHypothesisScoreVector[] => {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const sortedDrafts = sortDrafts(scoreHypotheses(buildContext(cluster)));
  const maxVectors = Math.max(1, Math.round(resolvedConfig.maxVectors));

  return sortedDrafts.slice(0, maxVectors).map((draft, index, drafts) => {
    const nextConfidence = drafts[index + 1]?.policyConfidence ?? 0;
    return toScoreVector(draft, resolvedConfig, draft.policyConfidence - nextConfidence);
  });
};

export const scoreFlowEvidenceClusters = (
  clusters: FlowEvidenceCluster[],
  config: FlowHypothesisScoringConfig = {}
): FlowHypothesisScoreVector[] =>
  clusters.flatMap((cluster) => scoreFlowEvidenceCluster(cluster, config));

const penaltyKindToAbstentionReason = (kind: FlowScorePenaltyKind): FlowAbstentionReason | null => {
  if (kind === "stale_quote_context") {
    return "stale_quote_context";
  }
  if (kind === "inside_market_context") {
    return "inside_market_context";
  }
  if (kind === "complex_or_special_print_context") {
    return "complex_or_special_print_context";
  }
  if (kind === "conflicting_direction" || kind === "structure_context") {
    return "conflicting_evidence";
  }
  if (
    kind === "wide_quote_context" ||
    kind === "wide_underlying_quote_context" ||
    kind === "low_premium" ||
    kind === "weak_aggression" ||
    kind === "missing_context"
  ) {
    return "below_policy_threshold";
  }
  return null;
};

const abstentionSourceReasons = (
  vector: FlowHypothesisScoreVector,
  reasons: FlowAbstentionReason[]
): string[] =>
  uniqueSorted([
    ...vector.penalties.map((penalty) => `${penalty.kind}:${penalty.reason}`),
    ...(reasons.includes("insufficient_evidence")
      ? [`evidence_strength:${vector.evidence_strength}`]
      : []),
    ...(reasons.includes("conflicting_evidence")
      ? [`hypothesis_margin:${vector.confidence.hypothesis_margin}`]
      : []),
    ...(reasons.includes("below_policy_threshold")
      ? [
          `fit_score:${vector.fit_score}`,
          `policy_confidence:${vector.confidence.policy_confidence}`,
          `penalty_score:${vector.penalty_score}`
        ]
      : [])
  ]);

const buildAbstention = (
  vector: FlowHypothesisScoreVector | null,
  config: Required<
    Pick<
      FlowHypothesisProjectionConfig,
      | "minFitScore"
      | "minPolicyConfidence"
      | "minEvidenceStrength"
      | "minHypothesisMargin"
      | "maxPenaltyScore"
      | "maxAlternatives"
    >
  >
) => {
  if (!vector) {
    return {
      abstained: true,
      reasons: ["insufficient_evidence"] as FlowAbstentionReason[],
      source_reasons: ["no_score_vectors"]
    };
  }

  const reasons: FlowAbstentionReason[] = [];

  for (const penalty of vector.penalties) {
    const reason = penaltyKindToAbstentionReason(penalty.kind);
    if (reason) {
      reasons.push(reason);
    }
  }
  if (vector.hypothesis_type === "unclear") {
    reasons.push("below_policy_threshold");
  }
  if (vector.evidence_strength < config.minEvidenceStrength) {
    reasons.push("insufficient_evidence");
  }
  if (vector.confidence.hypothesis_margin < config.minHypothesisMargin) {
    reasons.push("conflicting_evidence");
  }
  if (
    vector.fit_score < config.minFitScore ||
    vector.confidence.policy_confidence < config.minPolicyConfidence ||
    vector.penalty_score >= config.maxPenaltyScore
  ) {
    reasons.push("below_policy_threshold");
  }

  const uniqueReasons = uniqueSorted(reasons);
  const abstained = uniqueReasons.length > 0;

  return {
    abstained,
    reasons: abstained ? uniqueReasons : (["not_abstained"] as FlowAbstentionReason[]),
    source_reasons: abstained ? abstentionSourceReasons(vector, uniqueReasons) : []
  };
};

const zeroAbstainedConfidence = (vector: FlowHypothesisScoreVector): FlowHypothesisScoreVector => ({
  ...vector,
  confidence: {
    ...vector.confidence,
    policy_confidence: 0,
    conviction: 0
  }
});

const alternativeReasons = (vector: FlowHypothesisScoreVector): string[] =>
  uniqueSorted([
    `fit_score:${vector.fit_score}`,
    `policy_confidence:${vector.confidence.policy_confidence}`,
    ...vector.penalties.slice(0, 3).map((penalty) => penalty.reason)
  ]);

const alternativesFromVectors = (
  vectors: FlowHypothesisScoreVector[],
  selected: FlowHypothesisScoreVector | null,
  maxAlternatives: number
): FlowAlternativeHypothesis[] =>
  vectors
    .filter((vector) => vector.hypothesis_type !== "unclear")
    .filter((vector) => !selected || vector.hypothesis_type !== selected.hypothesis_type)
    .slice(0, Math.max(0, Math.round(maxAlternatives)))
    .map((vector) => ({
      hypothesis_type: vector.hypothesis_type,
      direction: vector.direction,
      score: vector.confidence.policy_confidence,
      reasons: alternativeReasons(vector)
    }));

export const buildFlowHypothesisEventFromCluster = (
  cluster: FlowEvidenceCluster,
  config: FlowHypothesisProjectionConfig = {}
): FlowHypothesisEvent => {
  const resolvedProjectionConfig = { ...DEFAULT_PROJECTION_CONFIG, ...config };
  const vectors = scoreFlowEvidenceCluster(cluster, config);
  const topVector = vectors[0] ?? null;
  const initialAbstention = buildAbstention(topVector, resolvedProjectionConfig);
  const selectedVector = initialAbstention.abstained
    ? (vectors.find((vector) => vector.hypothesis_type === "unclear") ?? topVector)
    : topVector;
  const selectedAbstention = buildAbstention(selectedVector, resolvedProjectionConfig);
  const eventScoreVector =
    selectedAbstention.abstained && selectedVector
      ? zeroAbstainedConfidence(selectedVector)
      : selectedVector;

  if (!eventScoreVector) {
    throw new Error(
      `Cannot build smart-flow hypothesis without score vectors: ${cluster.cluster_id}`
    );
  }

  return FlowHypothesisEventSchema.parse({
    source_ts: cluster.end_ts,
    ingest_ts: cluster.end_ts,
    seq: cluster.end_ts,
    trace_id: `smartflow:hypothesis:${cluster.cluster_id}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: eventScoreVector.policy_version,
    model_version: eventScoreVector.model_version,
    event_id: `smartflow:hypothesis:${cluster.cluster_id}`,
    hypothesis_id: `hypothesis:${cluster.cluster_id}`,
    cluster_id: cluster.cluster_id,
    candidate_ids: cluster.candidate_ids,
    underlying_id: cluster.underlying_id,
    hypothesis_type: selectedAbstention.abstained ? "unclear" : eventScoreVector.hypothesis_type,
    direction: selectedAbstention.abstained ? "unknown" : eventScoreVector.direction,
    scores: selectedAbstention.abstained
      ? {
          ...eventScoreVector,
          hypothesis_type: "unclear",
          direction: "unknown"
        }
      : eventScoreVector,
    alternatives: alternativesFromVectors(
      vectors,
      selectedAbstention.abstained ? null : eventScoreVector,
      resolvedProjectionConfig.maxAlternatives
    ),
    abstention: selectedAbstention,
    evidence_refs: evidenceRefsFor(cluster),
    generated_from: "flow_evidence_cluster"
  });
};

export const buildSmartFlowProjectionFromCluster = (
  cluster: FlowEvidenceCluster,
  config: FlowHypothesisProjectionConfig = {}
): FlowHypothesisProjection => {
  const hypothesis = buildFlowHypothesisEventFromCluster(cluster, config);

  return {
    hypothesis,
    insight: smartFlowInsightFromHypothesisEvent(hypothesis)
  };
};
