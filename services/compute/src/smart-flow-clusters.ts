import {
  type EvidenceQuality,
  type EvidenceQualityGrade,
  type FlowCandidate,
  type FlowEvidenceCluster,
  FlowEvidenceClusterSchema,
  type FlowEvidenceFact,
  type FlowFeatureBasis,
  type FlowFeatureValue,
  type FlowObservationRef,
  type FlowTraceableFeature,
  SMART_FLOW_CONTRACT_VERSION
} from "@islandflow/types";
import type { FlowEvidenceCandidateExtraction } from "./smart-flow-evidence";

export type FlowEvidenceClusterConfig = {
  windowMs?: number;
  includeRejectedCandidates?: boolean;
};

export type FlowEvidenceClusterBuildResult = {
  clusters: FlowEvidenceCluster[];
  rejected_candidate_ids: string[];
};

type ClusterInput = {
  candidate: FlowCandidate;
  evidenceFacts: FlowEvidenceFact[];
};

const DEFAULT_CLUSTER_CONFIG = {
  windowMs: 60_000,
  includeRejectedCandidates: false
} satisfies Required<FlowEvidenceClusterConfig>;

const COMPLEX_STRUCTURE_CONDITIONS = new Set(["COMPLEX", "SPREAD"]);

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

const uniqueSorted = (values: string[]): string[] => Array.from(new Set(values)).sort();

const numericFeatureValue = (value: FlowFeatureValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const sumFactValues = (facts: FlowEvidenceFact[]): number =>
  facts.reduce((total, fact) => total + (numericFeatureValue(fact.value) ?? 0), 0);

const average = (values: Array<number | null>): number | null => {
  const presentValues = values.filter((value): value is number => value !== null);
  if (presentValues.length === 0) {
    return null;
  }
  return presentValues.reduce((total, value) => total + value, 0) / presentValues.length;
};

const maxValue = (values: Array<number | null>): number | null => {
  const presentValues = values.filter((value): value is number => value !== null);
  if (presentValues.length === 0) {
    return null;
  }
  return Math.max(...presentValues);
};

const minValue = (values: Array<number | null>): number | null => {
  const presentValues = values.filter((value): value is number => value !== null);
  if (presentValues.length === 0) {
    return null;
  }
  return Math.min(...presentValues);
};

const collapsedStringValue = (facts: FlowEvidenceFact[]): string | null => {
  const values = uniqueSorted(
    facts.flatMap((fact) => (typeof fact.value === "string" ? [fact.value] : []))
  );
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    return values[0]!;
  }
  return "mixed";
};

const observationKey = (ref: FlowObservationRef): string =>
  [
    ref.kind,
    ref.role,
    ref.observation_id,
    ref.source_ts === undefined ? "" : String(ref.source_ts),
    ref.trace_id ?? ""
  ].join(":");

const uniqueObservationRefs = (refs: FlowObservationRef[]): FlowObservationRef[] => {
  const byKey = new Map<string, FlowObservationRef>();
  for (const ref of refs) {
    byKey.set(observationKey(ref), ref);
  }
  return [...byKey.values()].sort((a, b) => observationKey(a).localeCompare(observationKey(b)));
};

const factsBySlug = (facts: FlowEvidenceFact[], slug: string): FlowEvidenceFact[] =>
  facts.filter((fact) => fact.fact_id.endsWith(`:${slug}`));

const featureFromFacts = (
  label: string,
  value: FlowFeatureValue,
  basis: FlowFeatureBasis,
  facts: FlowEvidenceFact[]
): FlowTraceableFeature => ({
  label,
  value,
  basis,
  fact_ids: uniqueSorted(facts.map((fact) => fact.fact_id)),
  evidence_refs: uniqueSorted(
    facts.flatMap((fact) => fact.observation_refs.map((ref) => ref.observation_id))
  )
});

const addFeature = (
  features: Record<string, FlowTraceableFeature>,
  key: string,
  label: string,
  value: FlowFeatureValue,
  basis: FlowFeatureBasis,
  facts: FlowEvidenceFact[]
): void => {
  if (facts.length === 0) {
    return;
  }
  features[key] = featureFromFacts(label, value, basis, facts);
};

const qualityGradeFromScore = (score: number): EvidenceQualityGrade =>
  score >= 0.82 ? "strong" : score >= 0.55 ? "usable" : score > 0.2 ? "thin" : "poor";

const aggregateEvidenceQuality = (candidates: FlowCandidate[]): EvidenceQuality => {
  const qualityScore = clampUnit(
    average(candidates.map((candidate) => candidate.evidence_quality.quality_score)) ?? 0
  );
  const coverageRatio = average(
    candidates.map((candidate) => candidate.evidence_quality.coverage_ratio)
  );
  const staleRatio = average(candidates.map((candidate) => candidate.evidence_quality.stale_ratio));
  const completenessScore = average(
    candidates.map((candidate) => candidate.evidence_quality.completeness_score)
  );

  return {
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    grade: qualityGradeFromScore(qualityScore),
    quality_score: roundTo(qualityScore),
    coverage_ratio: coverageRatio === null ? null : roundTo(clampUnit(coverageRatio)),
    stale_ratio: staleRatio === null ? null : roundTo(clampUnit(staleRatio)),
    completeness_score: completenessScore === null ? null : roundTo(clampUnit(completenessScore)),
    caveats: uniqueSorted(candidates.flatMap((candidate) => candidate.evidence_quality.caveats))
  };
};

const clusterEligibilityStatus = (candidates: FlowCandidate[]): FlowFeatureValue => {
  if (candidates.some((candidate) => candidate.eligibility.status === "rejected")) {
    return "rejected";
  }
  if (candidates.some((candidate) => candidate.eligibility.status === "down_weighted")) {
    return "down_weighted";
  }
  return "accepted";
};

const splitConditions = (facts: FlowEvidenceFact[]): string[] =>
  facts
    .flatMap((fact) => (typeof fact.value === "string" ? fact.value.split(",") : []))
    .map((condition) => condition.trim().toUpperCase())
    .filter(Boolean);

const structureContextValue = (
  inputs: ClusterInput[],
  conditionFacts: FlowEvidenceFact[]
): string => {
  const conditions = splitConditions(conditionFacts);
  if (conditions.some((condition) => COMPLEX_STRUCTURE_CONDITIONS.has(condition))) {
    return "complex_or_spread_context";
  }
  if (inputs.length > 1) {
    return "multi_candidate_cluster";
  }
  return "single_candidate_cluster";
};

const buildFeatureDetails = (inputs: ClusterInput[]): Record<string, FlowTraceableFeature> => {
  const facts = inputs.flatMap((input) => input.evidenceFacts);
  const features: Record<string, FlowTraceableFeature> = {};
  const premiumFacts = facts.filter((fact) => fact.kind === "premium_size");
  const sizeFacts = factsBySlug(facts, "contract-size");
  const aggressionFacts = factsBySlug(facts, "aggression-ratio");
  const coverageFacts = factsBySlug(facts, "nbbo-coverage");
  const staleFacts = factsBySlug(facts, "stale-quote-ratio");
  const optionSpreadFacts = factsBySlug(facts, "option-spread-bps");
  const underlyingSpreadFacts = factsBySlug(facts, "underlying-spread-bps");
  const optionTypeFacts = factsBySlug(facts, "option-type");
  const aggressiveBuyFacts = factsBySlug(facts, "aggressive-buy-ratio");
  const aggressiveSellFacts = factsBySlug(facts, "aggressive-sell-ratio");
  const netDirectionalBiasFacts = factsBySlug(facts, "net-directional-bias");
  const executionIvFacts = factsBySlug(facts, "execution-iv");
  const underlyingMoveFacts = factsBySlug(facts, "underlying-move-bps");
  const daysToEventFacts = factsBySlug(facts, "days-to-event");
  const structureTypeFacts = factsBySlug(facts, "structure-type");
  const structureLegFacts = factsBySlug(facts, "structure-legs");
  const structureSymmetryFacts = factsBySlug(facts, "same-size-leg-symmetry");
  const eligibilityFacts = facts.filter((fact) => fact.kind === "eligibility_decision");
  const conditionFacts = factsBySlug(facts, "print-conditions");
  const traceAllFacts = facts.length > 0 ? facts : premiumFacts;

  addFeature(
    features,
    "total_premium",
    "Cluster total premium",
    roundTo(sumFactValues(premiumFacts), 2),
    "measured_fact",
    premiumFacts
  );
  addFeature(
    features,
    "total_size",
    "Cluster total contract size",
    roundTo(sumFactValues(sizeFacts), 2),
    "measured_fact",
    sizeFacts
  );
  addFeature(
    features,
    "candidate_count",
    "Candidate count in deterministic window",
    inputs.length,
    "derived_metric",
    traceAllFacts
  );
  addFeature(
    features,
    "packet_count",
    "Flow packet count in deterministic window",
    uniqueSorted(inputs.flatMap((input) => input.candidate.packet_ids)).length,
    "derived_metric",
    traceAllFacts
  );
  addFeature(
    features,
    "member_print_count",
    "Member print count in deterministic window",
    uniqueSorted(inputs.flatMap((input) => input.candidate.member_print_ids)).length,
    "derived_metric",
    traceAllFacts
  );
  addFeature(
    features,
    "nbbo_coverage_ratio_mean",
    "Mean NBBO coverage ratio",
    average(coverageFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    coverageFacts
  );
  addFeature(
    features,
    "nbbo_stale_ratio_mean",
    "Mean stale or missing NBBO ratio",
    average(staleFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    staleFacts
  );
  addFeature(
    features,
    "nbbo_aggression_ratio_max",
    "Maximum NBBO aggression ratio",
    maxValue(aggressionFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    aggressionFacts
  );
  addFeature(
    features,
    "nbbo_aggressive_buy_ratio_max",
    "Maximum NBBO aggressive buy ratio",
    maxValue(aggressiveBuyFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    aggressiveBuyFacts
  );
  addFeature(
    features,
    "nbbo_aggressive_sell_ratio_max",
    "Maximum NBBO aggressive sell ratio",
    maxValue(aggressiveSellFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    aggressiveSellFacts
  );
  addFeature(
    features,
    "option_spread_bps_max",
    "Maximum option NBBO spread",
    maxValue(optionSpreadFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    optionSpreadFacts
  );
  addFeature(
    features,
    "underlying_spread_bps_max",
    "Maximum underlying quote spread",
    maxValue(underlyingSpreadFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    underlyingSpreadFacts
  );
  addFeature(
    features,
    "option_type",
    "Observed option side",
    collapsedStringValue(optionTypeFacts),
    "measured_fact",
    optionTypeFacts
  );
  addFeature(
    features,
    "net_directional_bias",
    "Mean net directional bias",
    average(netDirectionalBiasFacts.map((fact) => numericFeatureValue(fact.value))),
    "derived_metric",
    netDirectionalBiasFacts
  );
  addFeature(
    features,
    "execution_iv",
    "Maximum execution implied volatility",
    maxValue(executionIvFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    executionIvFacts
  );
  addFeature(
    features,
    "underlying_move_bps",
    "Mean underlying movement",
    average(underlyingMoveFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    underlyingMoveFacts
  );
  addFeature(
    features,
    "days_to_event",
    "Closest known event timing",
    minValue(daysToEventFacts.map((fact) => numericFeatureValue(fact.value))),
    "derived_metric",
    daysToEventFacts
  );
  addFeature(
    features,
    "structure_type",
    "Observed structure type",
    collapsedStringValue(structureTypeFacts),
    "measured_fact",
    structureTypeFacts
  );
  addFeature(
    features,
    "structure_legs",
    "Maximum structure leg count",
    maxValue(structureLegFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    structureLegFacts
  );
  addFeature(
    features,
    "same_size_leg_symmetry",
    "Maximum same-size leg symmetry",
    maxValue(structureSymmetryFacts.map((fact) => numericFeatureValue(fact.value))),
    "measured_fact",
    structureSymmetryFacts
  );
  addFeature(
    features,
    "eligibility_status",
    "Cluster eligibility status",
    clusterEligibilityStatus(inputs.map((input) => input.candidate)),
    "derived_metric",
    eligibilityFacts.length > 0 ? eligibilityFacts : traceAllFacts
  );
  addFeature(
    features,
    "structure_context",
    "Inferred structure context",
    structureContextValue(inputs, conditionFacts),
    "inferred_structure",
    conditionFacts.length > 0 ? conditionFacts : traceAllFacts
  );

  return features;
};

const featureSummaryFromDetails = (
  details: Record<string, FlowTraceableFeature>
): Record<string, FlowFeatureValue> =>
  Object.fromEntries(Object.entries(details).map(([key, feature]) => [key, feature.value]));

const windowStartFor = (ts: number, windowMs: number): number =>
  Math.floor(ts / windowMs) * windowMs;

const sortInput = (a: ClusterInput, b: ClusterInput): number =>
  a.candidate.observed_at_ts - b.candidate.observed_at_ts ||
  a.candidate.candidate_id.localeCompare(b.candidate.candidate_id);

export const buildFlowEvidenceClusters = (
  extractions: FlowEvidenceCandidateExtraction[],
  config: FlowEvidenceClusterConfig = {}
): FlowEvidenceClusterBuildResult => {
  const resolvedConfig = { ...DEFAULT_CLUSTER_CONFIG, ...config };
  const windowMs = Math.max(1, Math.round(resolvedConfig.windowMs));
  const inputs = extractions
    .map((extraction) => ({
      candidate: extraction.candidate,
      evidenceFacts: extraction.evidence_facts
    }))
    .sort(sortInput);
  const rejectedInputs = inputs.filter((input) => !input.candidate.eligibility.eligible);
  const clusterInputs = resolvedConfig.includeRejectedCandidates
    ? inputs
    : inputs.filter((input) => input.candidate.eligibility.eligible);
  const byWindow = new Map<string, ClusterInput[]>();

  for (const input of clusterInputs) {
    const startTs = windowStartFor(input.candidate.observed_at_ts, windowMs);
    const endTs = startTs + windowMs;
    const key = `${input.candidate.underlying_id}:${startTs}:${endTs}`;
    const group = byWindow.get(key) ?? [];
    group.push(input);
    byWindow.set(key, group);
  }

  const clusters = [...byWindow.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const sortedGroup = [...group].sort(sortInput);
      const [underlyingId, startTsRaw, endTsRaw] = key.split(":");
      const startTs = Number(startTsRaw);
      const endTs = Number(endTsRaw);
      const candidates = sortedGroup.map((input) => input.candidate);
      const evidenceFacts = sortedGroup.flatMap((input) => input.evidenceFacts);
      const featureDetails = buildFeatureDetails(sortedGroup);

      return FlowEvidenceClusterSchema.parse({
        schema_version: SMART_FLOW_CONTRACT_VERSION,
        cluster_id: `cluster:${underlyingId}:${startTs}:${endTs}`,
        underlying_id: underlyingId,
        candidate_ids: candidates.map((candidate) => candidate.candidate_id),
        packet_ids: uniqueSorted(candidates.flatMap((candidate) => candidate.packet_ids)),
        member_print_ids: uniqueSorted(
          candidates.flatMap((candidate) => candidate.member_print_ids)
        ),
        observation_refs: uniqueObservationRefs(
          candidates.flatMap((candidate) => candidate.observation_refs)
        ),
        evidence_facts: evidenceFacts,
        evidence_quality: aggregateEvidenceQuality(candidates),
        baseline_snapshot:
          candidates.find((candidate) => candidate.baseline_snapshot !== null)?.baseline_snapshot ??
          null,
        feature_summary: featureSummaryFromDetails(featureDetails),
        feature_details: featureDetails,
        start_ts: startTs,
        end_ts: endTs,
        window_ms: windowMs
      });
    });

  return {
    clusters,
    rejected_candidate_ids: rejectedInputs.map((input) => input.candidate.candidate_id)
  };
};
