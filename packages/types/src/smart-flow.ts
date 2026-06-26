import { z } from "zod";
import { EventMetaSchema, SmartFlowConfidenceBandSchema, SmartFlowDirectionSchema } from "./events";

export const SMART_FLOW_CONTRACT_VERSION = "smart-flow.contracts.v1";
export const SMART_FLOW_POLICY_VERSION = "smart-flow.policy.v1";
export const SMART_FLOW_MODEL_VERSION = "smart-flow.model.rules.v1";
export const SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION = "smart-flow.hypothesis-score.policy.v1";
export const SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION = "smart-flow.hypothesis-score.rules.v1";
export const SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION =
  "smart-flow.explainability-projection.v1";

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

export const FlowFeatureBasisSchema = z.enum([
  "measured_fact",
  "derived_metric",
  "inferred_structure"
]);

export type FlowFeatureBasis = z.infer<typeof FlowFeatureBasisSchema>;

export const FlowEvidenceFactSchema = z.object({
  fact_id: z.string().min(1),
  kind: FlowEvidenceFactKindSchema,
  label: z.string().min(1),
  value: FlowFeatureValueSchema.optional(),
  unit: z.string().min(1).optional(),
  observation_refs: z.array(FlowObservationRefSchema).min(1)
});

export type FlowEvidenceFact = z.infer<typeof FlowEvidenceFactSchema>;

export const FlowTraceableFeatureSchema = z.object({
  label: z.string().min(1),
  value: FlowFeatureValueSchema,
  basis: FlowFeatureBasisSchema,
  fact_ids: z.array(z.string().min(1)).min(1),
  evidence_refs: z.array(z.string().min(1)).min(1)
});

export type FlowTraceableFeature = z.infer<typeof FlowTraceableFeatureSchema>;

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
  feature_details: z.record(FlowTraceableFeatureSchema),
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

export const FlowScorePenaltyKindSchema = z.enum([
  "stale_quote_context",
  "wide_quote_context",
  "wide_underlying_quote_context",
  "inside_market_context",
  "complex_or_special_print_context",
  "low_premium",
  "weak_aggression",
  "missing_context",
  "conflicting_direction",
  "structure_context",
  "other"
]);

export type FlowScorePenaltyKind = z.infer<typeof FlowScorePenaltyKindSchema>;

export const FlowScorePenaltySchema = z.object({
  penalty_id: z.string().min(1),
  kind: FlowScorePenaltyKindSchema,
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)),
  feature_key: z.string().min(1).optional()
});

export type FlowScorePenalty = z.infer<typeof FlowScorePenaltySchema>;

export const FlowHypothesisScoreVectorSchema = z.object({
  schema_version: SmartFlowContractVersionSchema,
  policy_version: SmartFlowPolicyVersionSchema,
  model_version: SmartFlowModelVersionSchema,
  hypothesis_type: FlowHypothesisTypeSchema,
  direction: SmartFlowDirectionSchema,
  evidence_strength: z.number().min(0).max(1),
  fit_score: z.number().min(0).max(1),
  penalty_score: z.number().min(0).max(1),
  penalties: z.array(FlowScorePenaltySchema),
  confidence: FlowConfidenceVectorSchema
});

export type FlowHypothesisScoreVector = z.infer<typeof FlowHypothesisScoreVectorSchema>;

export const FlowAlternativeHypothesisSchema = z.object({
  hypothesis_type: FlowHypothesisTypeSchema,
  direction: SmartFlowDirectionSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1))
});

export type FlowAlternativeHypothesis = z.infer<typeof FlowAlternativeHypothesisSchema>;

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
    direction: SmartFlowDirectionSchema,
    scores: FlowHypothesisScoreVectorSchema,
    alternatives: z.array(FlowAlternativeHypothesisSchema),
    abstention: FlowAbstentionSchema,
    evidence_refs: z.array(z.string().min(1)),
    generated_from: z.enum(["flow_evidence_cluster", "synthetic_fixture"])
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
  direction: SmartFlowDirectionSchema,
  confidence_band: SmartFlowConfidenceBandSchema,
  confidence: z.number().min(0).max(1),
  evidence_refs: z.array(z.string().min(1)),
  abstention: FlowAbstentionSchema,
  alternatives: z.array(FlowAlternativeHypothesisSchema)
});

export type SmartFlowInsight = z.infer<typeof SmartFlowInsightSchema>;

export const SmartFlowInsightProjectionSchema = SmartFlowInsightSchema;
export type SmartFlowInsightProjection = SmartFlowInsight;

export const SmartFlowExplainabilityRefsSchema = z.object({
  trace_id: z.string().min(1),
  event_id: z.string().min(1),
  hypothesis_id: z.string().min(1),
  insight_id: z.string().min(1),
  cluster_id: z.string().min(1),
  candidate_ids: z.array(z.string().min(1)),
  evidence_refs: z.array(z.string().min(1))
});

export type SmartFlowExplainabilityRefs = z.infer<typeof SmartFlowExplainabilityRefsSchema>;

export const SmartFlowExplainabilityEvidenceSchema = z.object({
  evidence_refs: z.array(z.string().min(1)),
  evidence_quality: z.number().min(0).max(1),
  penalties: z.array(FlowScorePenaltySchema)
});

export type SmartFlowExplainabilityEvidence = z.infer<typeof SmartFlowExplainabilityEvidenceSchema>;

export const SmartFlowExplainabilityProjectionSchema = EventMetaSchema.merge(
  z.object({
    schema_version: SmartFlowContractVersionSchema,
    projection_version: z.literal(SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION),
    policy_version: SmartFlowPolicyVersionSchema,
    model_version: SmartFlowModelVersionSchema,
    source_channel: z.literal("smart-flow"),
    versions: z.object({
      contract: SmartFlowContractVersionSchema,
      projection: z.literal(SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION),
      policy: SmartFlowPolicyVersionSchema,
      model: SmartFlowModelVersionSchema
    }),
    refs: SmartFlowExplainabilityRefsSchema,
    evidence: SmartFlowExplainabilityEvidenceSchema,
    hypothesis: FlowHypothesisEventSchema,
    insight: SmartFlowInsightSchema,
    abstention: FlowAbstentionSchema,
    alternatives: z.array(FlowAlternativeHypothesisSchema)
  })
);

export type SmartFlowExplainabilityProjection = z.infer<
  typeof SmartFlowExplainabilityProjectionSchema
>;

const hypothesisLabels: Record<FlowHypothesisType, string> = {
  directional_accumulation: "Directional accumulation hypothesis",
  retail_attention_flow: "Retail attention-flow hypothesis",
  event_positioning: "Event-positioning hypothesis",
  volatility_supply: "Volatility-supply hypothesis",
  structure_arbitrage: "Structure-arbitrage hypothesis",
  hedge_rebalance: "Hedge-rebalance hypothesis",
  unclear: "No clear flow hypothesis"
};

const confidenceBandFromConfidence = (
  confidence: number
): z.infer<typeof SmartFlowConfidenceBandSchema> => {
  if (confidence >= 0.72) {
    return "high";
  }
  if (confidence >= 0.52) {
    return "medium";
  }
  return "low";
};

export const smartFlowInsightFromHypothesisEvent = (
  hypothesis: FlowHypothesisEvent,
  options: { insight_id?: string } = {}
): SmartFlowInsight => {
  const label = hypothesisLabels[hypothesis.hypothesis_type];
  const confidence = hypothesis.abstention.abstained
    ? 0
    : hypothesis.scores.confidence.policy_confidence;
  const competingAlternatives = hypothesis.alternatives
    .slice(0, 2)
    .map((alternative) => hypothesisLabels[alternative.hypothesis_type].toLowerCase());
  const alternativeSummary =
    competingAlternatives.length > 0
      ? ` Alternative explanations considered: ${competingAlternatives.join(", ")}.`
      : "";

  return SmartFlowInsightSchema.parse({
    schema_version: hypothesis.schema_version,
    policy_version: hypothesis.policy_version,
    insight_id: options.insight_id ?? `smartflow:insight:${hypothesis.hypothesis_id}`,
    hypothesis_id: hypothesis.hypothesis_id,
    underlying_id: hypothesis.underlying_id,
    label,
    summary: hypothesis.abstention.abstained
      ? `The current evidence abstains from a canonical flow hypothesis: ${hypothesis.abstention.source_reasons.join("; ") || "policy confidence is too low"}.${alternativeSummary}`
      : `${label} from evidence-backed ${hypothesis.direction} flow.${alternativeSummary}`,
    direction: hypothesis.direction,
    confidence_band: confidenceBandFromConfidence(confidence),
    confidence,
    evidence_refs: hypothesis.evidence_refs,
    abstention: hypothesis.abstention,
    alternatives: hypothesis.alternatives
  });
};

export const smartFlowExplainabilityFromHypothesisEvent = (
  hypothesis: FlowHypothesisEvent,
  options: { insight_id?: string } = {}
): SmartFlowExplainabilityProjection => {
  const insight = smartFlowInsightFromHypothesisEvent(hypothesis, {
    insight_id: options.insight_id
  });

  return SmartFlowExplainabilityProjectionSchema.parse({
    source_ts: hypothesis.source_ts,
    ingest_ts: hypothesis.ingest_ts,
    seq: hypothesis.seq,
    trace_id: hypothesis.trace_id,
    schema_version: hypothesis.schema_version,
    projection_version: SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION,
    policy_version: hypothesis.policy_version,
    model_version: hypothesis.model_version,
    source_channel: "smart-flow",
    versions: {
      contract: hypothesis.schema_version,
      projection: SMART_FLOW_EXPLAINABILITY_PROJECTION_VERSION,
      policy: hypothesis.policy_version,
      model: hypothesis.model_version
    },
    refs: {
      trace_id: hypothesis.trace_id,
      event_id: hypothesis.event_id,
      hypothesis_id: hypothesis.hypothesis_id,
      insight_id: insight.insight_id,
      cluster_id: hypothesis.cluster_id,
      candidate_ids: hypothesis.candidate_ids,
      evidence_refs: hypothesis.evidence_refs
    },
    evidence: {
      evidence_refs: hypothesis.evidence_refs,
      evidence_quality: hypothesis.scores.confidence.evidence_quality,
      penalties: hypothesis.scores.penalties
    },
    hypothesis,
    insight,
    abstention: hypothesis.abstention,
    alternatives: hypothesis.alternatives
  });
};
