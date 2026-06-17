import { z } from "zod";
import {
  EventMetaSchema,
  SmartMoneyConfidenceBandSchema,
  SmartMoneyDirectionSchema,
  type SmartMoneyEvent,
  type SmartMoneyProfileId,
  SmartMoneyProfileIdSchema
} from "./events";

export const SMART_FLOW_CONTRACT_VERSION = "smart-flow.contracts.v1";
export const SMART_FLOW_POLICY_VERSION = "smart-flow.policy.compat.v1";
export const SMART_FLOW_MODEL_VERSION = "smart-flow.model.unscored.v1";

export const SmartFlowContractVersionSchema = z.literal(SMART_FLOW_CONTRACT_VERSION);
export const SmartFlowPolicyVersionSchema = z.string().min(1);
export const SmartFlowModelVersionSchema = z.string().min(1);

export const FlowObservationKindSchema = z.enum([
  "option_print",
  "option_nbbo",
  "equity_print",
  "equity_quote",
  "flow_packet",
  "news_story",
  "event_calendar",
  "synthetic_label",
  "external_context"
]);

export type FlowObservationKind = z.infer<typeof FlowObservationKindSchema>;

export const FlowObservationRoleSchema = z.enum(["anchor", "member", "context", "label"]);

export type FlowObservationRole = z.infer<typeof FlowObservationRoleSchema>;

export const FlowObservationRefSchema = z.object({
  observation_id: z.string().min(1),
  kind: FlowObservationKindSchema,
  role: FlowObservationRoleSchema,
  source_ts: z.number().int().nonnegative().optional(),
  trace_id: z.string().min(1).optional()
});

export type FlowObservationRef = z.infer<typeof FlowObservationRefSchema>;

export const FlowEvidenceFactKindSchema = z.enum([
  "execution_aggression",
  "execution_context",
  "premium_size",
  "structure_shape",
  "quote_quality",
  "timing_context",
  "underlying_context",
  "event_context",
  "eligibility_decision",
  "synthetic_ground_truth",
  "other"
]);

export type FlowEvidenceFactKind = z.infer<typeof FlowEvidenceFactKindSchema>;

export const FlowFeatureValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type FlowFeatureValue = z.infer<typeof FlowFeatureValueSchema>;

export const FlowEvidenceFactSchema = z.object({
  fact_id: z.string().min(1),
  kind: FlowEvidenceFactKindSchema,
  label: z.string().min(1),
  value: FlowFeatureValueSchema.optional(),
  unit: z.string().min(1).optional(),
  observation_refs: z.array(FlowObservationRefSchema).min(1)
});

export type FlowEvidenceFact = z.infer<typeof FlowEvidenceFactSchema>;

export const EvidenceQualityGradeSchema = z.enum(["poor", "thin", "usable", "strong"]);

export type EvidenceQualityGrade = z.infer<typeof EvidenceQualityGradeSchema>;

export const EvidenceQualitySchema = z.object({
  schema_version: SmartFlowContractVersionSchema,
  grade: EvidenceQualityGradeSchema,
  quality_score: z.number().min(0).max(1),
  coverage_ratio: z.number().min(0).max(1).nullable(),
  stale_ratio: z.number().min(0).max(1).nullable(),
  completeness_score: z.number().min(0).max(1).nullable(),
  caveats: z.array(z.string().min(1))
});

export type EvidenceQuality = z.infer<typeof EvidenceQualitySchema>;

export const BaselineMetricSchema = z.object({
  value: z.number(),
  unit: z.string().min(1).optional()
});

export type BaselineMetric = z.infer<typeof BaselineMetricSchema>;

export const BaselineSnapshotSourceSchema = z.enum([
  "rolling_live",
  "fixture",
  "historical",
  "synthetic",
  "unknown"
]);

export type BaselineSnapshotSource = z.infer<typeof BaselineSnapshotSourceSchema>;

export const BaselineSnapshotSchema = z.object({
  schema_version: SmartFlowContractVersionSchema,
  baseline_id: z.string().min(1),
  source: BaselineSnapshotSourceSchema,
  underlying_id: z.string().min(1),
  as_of_ts: z.number().int().nonnegative(),
  lookback_ms: z.number().int().positive(),
  sample_count: z.number().int().nonnegative(),
  metrics: z.record(BaselineMetricSchema)
});

export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>;

export const FlowEligibilityStatusSchema = z.enum(["accepted", "rejected", "down_weighted"]);

export type FlowEligibilityStatus = z.infer<typeof FlowEligibilityStatusSchema>;

export const FlowEligibilityDecisionSchema = z.object({
  status: FlowEligibilityStatusSchema,
  reason_code: z.string().min(1),
  reason: z.string().min(1),
  evidence_refs: z.array(z.string().min(1))
});

export type FlowEligibilityDecision = z.infer<typeof FlowEligibilityDecisionSchema>;

export const FlowEligibilitySchema = z.object({
  eligible: z.boolean(),
  status: FlowEligibilityStatusSchema,
  reasons: z.array(z.string().min(1)),
  decisions: z.array(FlowEligibilityDecisionSchema).min(1)
});

export type FlowEligibility = z.infer<typeof FlowEligibilitySchema>;

export const FlowCandidateSchema = z.object({
  schema_version: SmartFlowContractVersionSchema,
  candidate_id: z.string().min(1),
  underlying_id: z.string().min(1),
  observed_at_ts: z.number().int().nonnegative(),
  packet_ids: z.array(z.string().min(1)),
  member_print_ids: z.array(z.string().min(1)),
  observation_refs: z.array(FlowObservationRefSchema).min(1),
  feature_vector: z.record(FlowFeatureValueSchema),
  baseline_snapshot: BaselineSnapshotSchema.nullable(),
  evidence_quality: EvidenceQualitySchema,
  eligibility: FlowEligibilitySchema
});

export type FlowCandidate = z.infer<typeof FlowCandidateSchema>;

export const FlowEvidenceClusterSchema = z.object({
  schema_version: SmartFlowContractVersionSchema,
  cluster_id: z.string().min(1),
  underlying_id: z.string().min(1),
  candidate_ids: z.array(z.string().min(1)).min(1),
  packet_ids: z.array(z.string().min(1)),
  member_print_ids: z.array(z.string().min(1)),
  observation_refs: z.array(FlowObservationRefSchema).min(1),
  evidence_facts: z.array(FlowEvidenceFactSchema),
  evidence_quality: EvidenceQualitySchema,
  baseline_snapshot: BaselineSnapshotSchema.nullable(),
  feature_summary: z.record(FlowFeatureValueSchema),
  start_ts: z.number().int().nonnegative(),
  end_ts: z.number().int().nonnegative(),
  window_ms: z.number().int().nonnegative()
});

export type FlowEvidenceCluster = z.infer<typeof FlowEvidenceClusterSchema>;

export const FlowHypothesisTypeSchema = z.enum([
  "directional_accumulation",
  "retail_attention_flow",
  "event_positioning",
  "volatility_supply",
  "structure_arbitrage",
  "hedge_rebalance",
  "unclear"
]);

export type FlowHypothesisType = z.infer<typeof FlowHypothesisTypeSchema>;

export const FlowAbstentionReasonSchema = z.enum([
  "insufficient_evidence",
  "stale_quote_context",
  "conflicting_evidence",
  "inside_market_context",
  "complex_or_special_print_context",
  "below_policy_threshold",
  "calibration_unavailable",
  "not_abstained",
  "other"
]);

export type FlowAbstentionReason = z.infer<typeof FlowAbstentionReasonSchema>;

export const FlowAbstentionSchema = z.object({
  abstained: z.boolean(),
  reasons: z.array(FlowAbstentionReasonSchema),
  source_reasons: z.array(z.string().min(1))
});

export type FlowAbstention = z.infer<typeof FlowAbstentionSchema>;

export const FlowConfidenceVectorSchema = z.object({
  policy_confidence: z.number().min(0).max(1),
  evidence_quality: z.number().min(0).max(1),
  hypothesis_margin: z.number().min(0).max(1),
  conviction: z.number().min(0).max(1),
  calibration_version: z.string().min(1).nullable()
});

export type FlowConfidenceVector = z.infer<typeof FlowConfidenceVectorSchema>;

export const FlowHypothesisScoreVectorSchema = z.object({
  evidence_strength: z.number().min(0).max(1),
  fit_score: z.number().min(0).max(1),
  penalty_score: z.number().min(0).max(1),
  confidence: FlowConfidenceVectorSchema
});

export type FlowHypothesisScoreVector = z.infer<typeof FlowHypothesisScoreVectorSchema>;

export const FlowAlternativeHypothesisSchema = z.object({
  hypothesis_type: FlowHypothesisTypeSchema,
  direction: SmartMoneyDirectionSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1))
});

export type FlowAlternativeHypothesis = z.infer<typeof FlowAlternativeHypothesisSchema>;

export const SmartFlowLegacyCompatibilitySchema = z.object({
  compatibility_only: z.literal(true),
  legacy_event_id: z.string().min(1).optional(),
  legacy_profile_id: SmartMoneyProfileIdSchema.nullable().optional(),
  legacy_channel: z.literal("smart-money").optional()
});

export type SmartFlowLegacyCompatibility = z.infer<typeof SmartFlowLegacyCompatibilitySchema>;

export const FlowHypothesisEventSchema = EventMetaSchema.merge(
  z.object({
    schema_version: SmartFlowContractVersionSchema,
    policy_version: SmartFlowPolicyVersionSchema,
    model_version: SmartFlowModelVersionSchema,
    event_id: z.string().min(1),
    hypothesis_id: z.string().min(1),
    cluster_id: z.string().min(1),
    candidate_ids: z.array(z.string().min(1)),
    underlying_id: z.string().min(1),
    hypothesis_type: FlowHypothesisTypeSchema,
    direction: SmartMoneyDirectionSchema,
    scores: FlowHypothesisScoreVectorSchema,
    alternatives: z.array(FlowAlternativeHypothesisSchema),
    abstention: FlowAbstentionSchema,
    evidence_refs: z.array(z.string().min(1)),
    generated_from: z.enum([
      "flow_evidence_cluster",
      "legacy_smart_money_event",
      "synthetic_fixture"
    ]),
    compatibility: SmartFlowLegacyCompatibilitySchema.optional()
  })
);

export type FlowHypothesisEvent = z.infer<typeof FlowHypothesisEventSchema>;

export const SmartFlowInsightSchema = z.object({
  schema_version: SmartFlowContractVersionSchema,
  policy_version: SmartFlowPolicyVersionSchema,
  insight_id: z.string().min(1),
  hypothesis_id: z.string().min(1),
  underlying_id: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  direction: SmartMoneyDirectionSchema,
  confidence_band: SmartMoneyConfidenceBandSchema,
  confidence: z.number().min(0).max(1),
  evidence_refs: z.array(z.string().min(1)),
  abstention: FlowAbstentionSchema,
  alternatives: z.array(FlowAlternativeHypothesisSchema),
  compatibility: SmartFlowLegacyCompatibilitySchema.optional()
});

export type SmartFlowInsight = z.infer<typeof SmartFlowInsightSchema>;

export const SmartFlowInsightProjectionSchema = SmartFlowInsightSchema;
export type SmartFlowInsightProjection = SmartFlowInsight;

/**
 * @deprecated Use SmartFlowInsightSchema. Smart money is compatibility language,
 * not a canonical hidden-participant claim.
 */
export const SmartMoneyInsightSchema = SmartFlowInsightSchema;

/**
 * @deprecated Use SmartFlowInsight. Smart money is compatibility language,
 * not a canonical hidden-participant claim.
 */
export type SmartMoneyInsight = SmartFlowInsight;

const profileToHypothesisType: Record<SmartMoneyProfileId, FlowHypothesisType> = {
  institutional_directional: "directional_accumulation",
  retail_whale: "retail_attention_flow",
  event_driven: "event_positioning",
  vol_seller: "volatility_supply",
  arbitrage: "structure_arbitrage",
  hedge_reactive: "hedge_rebalance"
};

const hypothesisLabels: Record<FlowHypothesisType, string> = {
  directional_accumulation: "Directional accumulation hypothesis",
  retail_attention_flow: "Retail attention-flow hypothesis",
  event_positioning: "Event-positioning hypothesis",
  volatility_supply: "Volatility-supply hypothesis",
  structure_arbitrage: "Structure-arbitrage hypothesis",
  hedge_rebalance: "Hedge-rebalance hypothesis",
  unclear: "No clear flow hypothesis"
};

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

const evidenceQualityFromLegacyEvent = (event: SmartMoneyEvent): EvidenceQuality => {
  const coverage = clampUnit(event.features.nbbo_coverage_ratio);
  const stale = clampUnit(event.features.nbbo_stale_ratio);
  const qualityScore = clampUnit(coverage - stale);
  const grade: EvidenceQualityGrade =
    qualityScore >= 0.82
      ? "strong"
      : qualityScore >= 0.55
        ? "usable"
        : qualityScore > 0
          ? "thin"
          : "poor";

  return EvidenceQualitySchema.parse({
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    grade,
    quality_score: qualityScore,
    coverage_ratio: coverage,
    stale_ratio: stale,
    completeness_score: coverage,
    caveats: event.suppressed_reasons
  });
};

const mapLegacyAbstentionReason = (reason: string): FlowAbstentionReason => {
  if (reason === "stale_or_missing_quote_context") {
    return "stale_quote_context";
  }
  if (reason === "inside_market_or_cross_like_execution") {
    return "inside_market_context";
  }
  if (reason === "special_print_or_complex_context") {
    return "complex_or_special_print_context";
  }
  return "other";
};

const abstentionFromLegacyEvent = (event: SmartMoneyEvent): FlowAbstention => {
  const reasons = event.abstained
    ? event.suppressed_reasons.map(mapLegacyAbstentionReason)
    : ["not_abstained"];

  return FlowAbstentionSchema.parse({
    abstained: event.abstained,
    reasons: reasons.length > 0 ? reasons : ["below_policy_threshold"],
    source_reasons: event.suppressed_reasons
  });
};

const hypothesisTypeFromLegacyProfile = (
  profileId: SmartMoneyProfileId | null
): FlowHypothesisType => {
  return profileId ? profileToHypothesisType[profileId] : "unclear";
};

export const flowHypothesisEventFromLegacySmartMoneyEvent = (
  event: SmartMoneyEvent
): FlowHypothesisEvent => {
  const primaryScore =
    event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
    event.profile_scores[0] ??
    null;
  const evidenceQuality = evidenceQualityFromLegacyEvent(event);
  const policyConfidence = event.abstained ? 0 : clampUnit(primaryScore?.probability ?? 0);
  const hypothesisType = hypothesisTypeFromLegacyProfile(event.primary_profile_id);

  return FlowHypothesisEventSchema.parse({
    source_ts: event.source_ts,
    ingest_ts: event.ingest_ts,
    seq: event.seq,
    trace_id: event.trace_id,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_POLICY_VERSION,
    model_version: SMART_FLOW_MODEL_VERSION,
    event_id: `smartflow:hypothesis:${event.event_id}`,
    hypothesis_id: `hypothesis:${event.event_id}`,
    cluster_id: `cluster:${event.event_id}`,
    candidate_ids: event.packet_ids.map((packetId) => `candidate:${packetId}`),
    underlying_id: event.underlying_id,
    hypothesis_type: hypothesisType,
    direction: event.primary_direction,
    scores: {
      evidence_strength: evidenceQuality.quality_score,
      fit_score: clampUnit(primaryScore?.probability ?? 0),
      penalty_score: event.suppressed_reasons.length > 0 ? 1 : 0,
      confidence: {
        policy_confidence: policyConfidence,
        evidence_quality: evidenceQuality.quality_score,
        hypothesis_margin: 0,
        conviction: policyConfidence,
        calibration_version: null
      }
    },
    alternatives: event.profile_scores
      .filter((score) => score.profile_id !== event.primary_profile_id)
      .slice(0, 3)
      .map((score) => ({
        hypothesis_type: profileToHypothesisType[score.profile_id],
        direction: score.direction,
        score: score.probability,
        reasons: score.reasons
      })),
    abstention: abstentionFromLegacyEvent(event),
    evidence_refs: [...event.packet_ids, ...event.member_print_ids],
    generated_from: "legacy_smart_money_event",
    compatibility: {
      compatibility_only: true,
      legacy_event_id: event.event_id,
      legacy_profile_id: event.primary_profile_id,
      legacy_channel: "smart-money"
    }
  });
};

export const smartFlowInsightFromLegacySmartMoneyEvent = (
  event: SmartMoneyEvent
): SmartFlowInsight => {
  const hypothesis = flowHypothesisEventFromLegacySmartMoneyEvent(event);
  const primaryScore =
    event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
    event.profile_scores[0] ??
    null;
  const label = hypothesisLabels[hypothesis.hypothesis_type];
  const confidence = hypothesis.scores.confidence.policy_confidence;

  return SmartFlowInsightSchema.parse({
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: hypothesis.policy_version,
    insight_id: `smartflow:insight:${event.event_id}`,
    hypothesis_id: hypothesis.hypothesis_id,
    underlying_id: event.underlying_id,
    label,
    summary: event.abstained
      ? "The current evidence is not strong enough for a flow hypothesis."
      : `${label} from evidence-backed ${event.primary_direction} flow.`,
    direction: event.primary_direction,
    confidence_band: primaryScore?.confidence_band ?? "low",
    confidence,
    evidence_refs: hypothesis.evidence_refs,
    abstention: hypothesis.abstention,
    alternatives: hypothesis.alternatives,
    compatibility: hypothesis.compatibility
  });
};
