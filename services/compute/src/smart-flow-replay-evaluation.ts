import {
  type GeneratedEventBatch,
  type GeneratedMarketEvent,
  stableHash
} from "@islandflow/synthetic-market";
import type { ExpectedOutputManifest } from "@islandflow/synthetic-market/manifest";
import type {
  SmartFlowExpectedOutput,
  SmartFlowExpectedOutputManifest,
  SyntheticEvidenceRequirement
} from "@islandflow/synthetic-market/scenarios";
import {
  type FlowAbstentionReason,
  type FlowEvidenceCluster,
  type FlowEvidenceFact,
  type FlowFeatureValue,
  type FlowHypothesisEvent,
  type FlowPacket,
  FlowPacketSchema,
  type OptionNBBO,
  type OptionPrint,
  type SmartFlowInsight
} from "@islandflow/types";
import { buildFlowEvidenceClusters } from "./smart-flow-clusters";
import { buildFlowEvidenceCandidateFromPacket } from "./smart-flow-evidence";
import {
  buildFlowHypothesisEventFromCluster,
  type FlowHypothesisProjectionConfig
} from "./smart-flow-scoring";

export const SMART_FLOW_REPLAY_SIGNATURE_VERSION = "smart-flow-replay-signature.v1";

export type SmartFlowReplayFixture = {
  manifest: ExpectedOutputManifest;
  batch: GeneratedEventBatch;
};

export type SmartFlowReplayCandidateSignature = {
  candidate_id: string;
  underlying_id: string;
  eligibility_status: string;
  eligibility_reasons: string[];
  evidence_grade: string;
};

export type SmartFlowReplayClusterSignature = {
  cluster_id: string;
  underlying_id: string;
  candidate_count: number;
  member_print_count: number;
  evidence_grade: string;
  evidence_caveats: string[];
  features: Record<string, FlowFeatureValue>;
};

export type SmartFlowReplayHypothesisSignature = {
  event_id: string;
  cluster_id: string;
  hypothesis_type: FlowHypothesisEvent["hypothesis_type"];
  direction: FlowHypothesisEvent["direction"];
  abstained: boolean;
  abstention_reasons: FlowAbstentionReason[];
  confidence_band: "low" | "medium" | "high";
  policy_confidence: number;
  fit_score: number;
  evidence_strength: number;
  penalty_score: number;
  penalty_kinds: string[];
};

export type SmartFlowReplaySignature = {
  schema_version: typeof SMART_FLOW_REPLAY_SIGNATURE_VERSION;
  run_id: string;
  scenario_id?: string;
  raw_event_count: number;
  flow_packet_count: number;
  candidate_count: number;
  cluster_count: number;
  emitted_hypothesis_count: number;
  insight_count: number;
  candidates: SmartFlowReplayCandidateSignature[];
  clusters: SmartFlowReplayClusterSignature[];
  hypotheses: SmartFlowReplayHypothesisSignature[];
};

export type SmartFlowReplayEvaluation = {
  fixture_manifest: ExpectedOutputManifest;
  flow_packets: FlowPacket[];
  evidence_clusters: FlowEvidenceCluster[];
  hypotheses: FlowHypothesisEvent[];
  insights: SmartFlowInsight[];
  signature: SmartFlowReplaySignature;
  signature_hash: string;
};

export type SmartFlowGoldenMismatchKind =
  | "manifest_run_mismatch"
  | "missing_expected_alert"
  | "unexpected_class"
  | "unexpected_direction"
  | "confidence_out_of_range"
  | "missing_required_evidence"
  | "forbidden_evidence_present"
  | "derived_event_presence_mismatch"
  | "missing_abstention_reason"
  | "false_positive";

export type SmartFlowGoldenMismatch = {
  expectation_id: string;
  kind: SmartFlowGoldenMismatchKind;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type SmartFlowReplayGoldenReport = {
  run_id: string;
  scenario_id: string;
  signature: SmartFlowReplaySignature;
  signature_hash: string;
  expected_manifest_hash: string;
  mismatches: SmartFlowGoldenMismatch[];
  matches: boolean;
};

type ReplayState = {
  optionNbboByContract: Map<string, OptionNBBO>;
  firstUnderlyingMidBySymbol: Map<string, number>;
};

type FeatureSource = {
  flow_packets: FlowPacket[];
  clusters: FlowEvidenceCluster[];
  hypotheses: FlowHypothesisEvent[];
};

const SIGNATURE_FEATURE_KEYS = [
  "total_premium",
  "total_size",
  "candidate_count",
  "member_print_count",
  "nbbo_coverage_ratio_mean",
  "nbbo_stale_ratio_mean",
  "nbbo_aggression_ratio_max",
  "nbbo_aggressive_buy_ratio_max",
  "nbbo_aggressive_sell_ratio_max",
  "nbbo_inside_ratio_mean",
  "option_spread_bps_max",
  "underlying_spread_bps_max",
  "option_type",
  "net_directional_bias",
  "execution_iv",
  "underlying_move_bps",
  "days_to_event",
  "structure_context",
  "eligibility_status"
] as const;

const MS_PER_DAY = 86_400_000;

export const evaluateSyntheticSmartFlowReplay = (
  fixture: SmartFlowReplayFixture,
  config: FlowHypothesisProjectionConfig = {}
): SmartFlowReplayEvaluation => {
  const flowPackets = buildFlowPacketsFromRawSyntheticEvents(fixture.batch.events);
  const extractions = flowPackets.map((packet) => buildFlowEvidenceCandidateFromPacket(packet));
  const clusterResult = buildFlowEvidenceClusters(extractions, {
    windowMs: 60_000,
    includeRejectedCandidates: true
  });
  const hypotheses = clusterResult.clusters.map((cluster) =>
    buildFlowHypothesisEventFromCluster(cluster, config)
  );
  const insights = hypotheses
    .filter((hypothesis) => !hypothesis.abstention.abstained)
    .map((hypothesis) => ({
      schema_version: hypothesis.schema_version,
      policy_version: hypothesis.policy_version,
      insight_id: `smartflow:insight:${hypothesis.hypothesis_id}`,
      hypothesis_id: hypothesis.hypothesis_id,
      underlying_id: hypothesis.underlying_id,
      label: `${hypothesis.hypothesis_type}:${hypothesis.direction}`,
      summary: `${hypothesis.hypothesis_type} replay signature`,
      direction: hypothesis.direction,
      confidence_band: confidenceBand(hypothesis.scores.confidence.policy_confidence),
      confidence: hypothesis.scores.confidence.policy_confidence,
      evidence_refs: hypothesis.evidence_refs,
      abstention: hypothesis.abstention,
      alternatives: hypothesis.alternatives
    }));
  const signature = buildSmartFlowReplaySignature(
    fixture,
    flowPackets,
    extractions.map((extraction) => extraction.candidate),
    clusterResult.clusters,
    hypotheses,
    insights
  );

  return {
    fixture_manifest: fixture.manifest,
    flow_packets: flowPackets,
    evidence_clusters: clusterResult.clusters,
    hypotheses,
    insights,
    signature,
    signature_hash: stableHash(signature)
  };
};

export const compareSmartFlowReplayToExpectedManifest = (
  fixture: SmartFlowReplayFixture,
  expectedManifest: SmartFlowExpectedOutputManifest,
  config: FlowHypothesisProjectionConfig = {}
): SmartFlowReplayGoldenReport => {
  const evaluation = evaluateSyntheticSmartFlowReplay(fixture, config);
  const mismatches: SmartFlowGoldenMismatch[] = [];

  if (expectedManifest.run_id !== fixture.manifest.run.run_id) {
    mismatches.push({
      expectation_id: expectedManifest.run_id,
      kind: "manifest_run_mismatch",
      message: "Expected smart-flow manifest run_id does not match the replay fixture run_id.",
      expected: expectedManifest.run_id,
      actual: fixture.manifest.run.run_id
    });
  }

  for (const expectation of expectedManifest.expectations) {
    mismatches.push(
      ...compareExpectation(expectation, evaluation, {
        flow_packets: evaluation.flow_packets,
        clusters: evaluation.evidence_clusters,
        hypotheses: evaluation.hypotheses
      })
    );
  }
  mismatches.push(
    ...compareUnexpectedEmittedAlerts(expectedManifest.expectations, evaluation.hypotheses)
  );

  return {
    run_id: fixture.manifest.run.run_id,
    scenario_id: expectedManifest.scenario_id,
    signature: evaluation.signature,
    signature_hash: evaluation.signature_hash,
    expected_manifest_hash: stableHash(expectedManifest),
    mismatches,
    matches: mismatches.length === 0
  };
};

const compareUnexpectedEmittedAlerts = (
  expectations: SmartFlowExpectedOutput[],
  hypotheses: FlowHypothesisEvent[]
): SmartFlowGoldenMismatch[] => {
  const expectedAlerts = expectations.filter(
    (expectation) => expectation.alert_expectation === "alert"
  );
  if (expectedAlerts.length === 0) {
    return [];
  }

  const remainingBySignature = new Map<string, number>();
  const expectedSignatures = new Set<string>();
  const expectedClasses = new Set<FlowHypothesisEvent["hypothesis_type"]>();
  for (const expectation of expectedAlerts) {
    const key = alertSignatureKey(expectation.expected_class, expectation.expected_direction);
    remainingBySignature.set(key, (remainingBySignature.get(key) ?? 0) + 1);
    expectedSignatures.add(key);
    expectedClasses.add(expectation.expected_class);
  }

  return hypotheses
    .filter((hypothesis) => !hypothesis.abstention.abstained)
    .flatMap((hypothesis) => {
      const key = alertSignatureKey(hypothesis.hypothesis_type, hypothesis.direction);
      const remainingExpectedCount = remainingBySignature.get(key) ?? 0;
      if (remainingExpectedCount > 0) {
        remainingBySignature.set(key, remainingExpectedCount - 1);
        return [];
      }

      const matchingSignatureExpected = expectedSignatures.has(key);
      const matchingClassExpected = expectedClasses.has(hypothesis.hypothesis_type);
      return [
        {
          expectation_id: expectedAlerts
            .map((expectation) => expectation.expected_output_id)
            .join(","),
          kind: matchingSignatureExpected
            ? "false_positive"
            : matchingClassExpected
              ? "unexpected_direction"
              : "unexpected_class",
          message: matchingSignatureExpected
            ? "Replay emitted more smart-flow alerts than the golden expectation allowed."
            : matchingClassExpected
              ? "Replay emitted a smart-flow alert with an unexpected direction."
              : "Replay emitted a smart-flow alert with an unexpected class.",
          expected: expectedAlerts.map((expectation) => ({
            hypothesis_type: expectation.expected_class,
            direction: expectation.expected_direction
          })),
          actual: hypothesisSignature(hypothesis)
        } satisfies SmartFlowGoldenMismatch
      ];
    });
};

const alertSignatureKey = (hypothesisType: string, direction: string): string =>
  `${hypothesisType}:${direction}`;

export const buildFlowPacketsFromRawSyntheticEvents = (
  events: readonly GeneratedMarketEvent[]
): FlowPacket[] => {
  const state: ReplayState = {
    optionNbboByContract: new Map(),
    firstUnderlyingMidBySymbol: new Map()
  };
  const packets: FlowPacket[] = [];

  for (const generated of orderRawEvents(events)) {
    if (generated.kind === "option_nbbo") {
      state.optionNbboByContract.set(generated.event.option_contract_id, generated.event);
      continue;
    }
    if (generated.kind === "equity_quote") {
      const mid = midpoint(generated.event.bid, generated.event.ask);
      if (!state.firstUnderlyingMidBySymbol.has(generated.event.underlying_id)) {
        state.firstUnderlyingMidBySymbol.set(generated.event.underlying_id, mid);
      }
      continue;
    }
    if (generated.kind === "option_print") {
      packets.push(buildFlowPacketFromOptionPrint(generated.event, state));
    }
  }

  return packets;
};

const buildFlowPacketFromOptionPrint = (print: OptionPrint, state: ReplayState): FlowPacket => {
  const quote = state.optionNbboByContract.get(print.option_contract_id) ?? null;
  const side =
    print.execution_nbbo_side ?? print.nbbo_side ?? classifyOptionPlacement(print, quote);
  const sideRatios = ratiosForOptionSide(side);
  const underlyingId = print.underlying_id ?? print.option_contract_id.split("-")[0] ?? "UNKNOWN";
  const underlyingMid = print.execution_underlying_mid ?? print.execution_underlying_spot ?? null;
  const firstUnderlyingMid = state.firstUnderlyingMidBySymbol.get(underlyingId) ?? underlyingMid;
  const conditions = print.conditions ?? [];
  const notional = roundTo(print.notional ?? print.price * print.size * 100, 2);
  const features: Record<string, string | number | boolean> = {
    option_contract_id: print.option_contract_id,
    underlying_id: underlyingId,
    count: 1,
    total_size: print.size,
    total_premium: notional,
    total_notional: notional,
    first_price: print.price,
    last_price: print.price,
    start_ts: print.ts,
    end_ts: print.ts,
    window_ms: 1,
    nbbo_coverage_ratio: side === "MISSING" || side === "STALE" ? 0 : 1,
    nbbo_aggressive_buy_ratio: sideRatios.buy,
    nbbo_aggressive_sell_ratio: sideRatios.sell,
    nbbo_aggressive_ratio: sideRatios.aggressive,
    nbbo_inside_ratio: sideRatios.inside,
    nbbo_missing_count: side === "MISSING" ? 1 : 0,
    nbbo_stale_count: side === "STALE" ? 1 : 0,
    net_directional_bias: sideRatios.buy - sideRatios.sell
  };

  setFeature(features, "option_type", print.option_type);
  setFeature(features, "nbbo_bid", print.execution_nbbo_bid ?? quote?.bid);
  setFeature(features, "nbbo_ask", print.execution_nbbo_ask ?? quote?.ask);
  setFeature(features, "nbbo_mid", print.execution_nbbo_mid ?? quoteMid(quote));
  setFeature(features, "nbbo_spread", print.execution_nbbo_spread ?? quoteSpread(quote));
  setFeature(features, "nbbo_bid_size", print.execution_nbbo_bid_size ?? quote?.bidSize);
  setFeature(features, "nbbo_ask_size", print.execution_nbbo_ask_size ?? quote?.askSize);
  setFeature(features, "nbbo_ts", print.execution_nbbo_ts ?? quote?.ts);
  setFeature(features, "underlying_mid", underlyingMid);
  setFeature(features, "underlying_bid", print.execution_underlying_bid);
  setFeature(features, "underlying_ask", print.execution_underlying_ask);
  setFeature(features, "underlying_spread", print.execution_underlying_spread);
  setFeature(features, "execution_iv", print.execution_iv);

  if (conditions.length > 0) {
    features.conditions = conditions
      .map((condition) => condition.toUpperCase())
      .sort()
      .join(",");
  }
  if (conditions.some(isSpecialCondition)) {
    features.special_print_count = 1;
  }
  if (firstUnderlyingMid && underlyingMid && firstUnderlyingMid > 0) {
    features.underlying_move_bps = roundTo(
      ((underlyingMid - firstUnderlyingMid) / firstUnderlyingMid) * 10_000
    );
  }

  const eventOffsetDays = eventOffsetDaysFromConditions(conditions);
  if (eventOffsetDays !== null) {
    features.corporate_event_ts = print.ts + eventOffsetDays * MS_PER_DAY;
  }

  return FlowPacketSchema.parse({
    source_ts: print.source_ts,
    ingest_ts: print.ingest_ts,
    seq: print.seq,
    trace_id: `smartflow:replay:packet:${print.trace_id}`,
    id: `flowpacket:${print.trace_id}`,
    members: [print.trace_id],
    features,
    join_quality: {
      nbbo_age_ms: print.execution_nbbo_age_ms ?? Math.abs(print.ts - (quote?.ts ?? print.ts)),
      nbbo_coverage_ratio: features.nbbo_coverage_ratio
    }
  });
};

const compareExpectation = (
  expectation: SmartFlowExpectedOutput,
  evaluation: SmartFlowReplayEvaluation,
  sources: FeatureSource
): SmartFlowGoldenMismatch[] => {
  const mismatches: SmartFlowGoldenMismatch[] = [];
  const emitted = evaluation.hypotheses.filter((hypothesis) => !hypothesis.abstention.abstained);
  const matchingAlert = emitted.find(
    (hypothesis) =>
      hypothesis.hypothesis_type === expectation.expected_class &&
      hypothesis.direction === expectation.expected_direction
  );

  if (expectation.alert_expectation === "alert") {
    if (!matchingAlert) {
      mismatches.push({
        expectation_id: expectation.expected_output_id,
        kind: "missing_expected_alert",
        message: "Replay did not emit the expected smart-flow alert signature.",
        expected: {
          hypothesis_type: expectation.expected_class,
          direction: expectation.expected_direction
        },
        actual: emitted.map(hypothesisSignature)
      });
    } else {
      const confidence = matchingAlert.scores.confidence.policy_confidence;
      if (
        confidence < expectation.confidence_range.min ||
        confidence > expectation.confidence_range.max
      ) {
        mismatches.push({
          expectation_id: expectation.expected_output_id,
          kind: "confidence_out_of_range",
          message: "Replay alert confidence fell outside the expected golden range.",
          expected: expectation.confidence_range,
          actual: confidence
        });
      }
    }
  } else if (emitted.length > 0) {
    mismatches.push({
      expectation_id: expectation.expected_output_id,
      kind: "false_positive",
      message: "Replay emitted a smart-flow alert for a no-alert or abstention expectation.",
      expected: expectation.alert_expectation,
      actual: emitted.map(hypothesisSignature)
    });
  }

  if (expectation.alert_expectation !== "alert") {
    mismatches.push(...compareAbstentionReasons(expectation, evaluation.hypotheses));
  }

  for (const requirement of expectation.required_evidence) {
    if (!requirementSatisfied(requirement, sources)) {
      mismatches.push({
        expectation_id: expectation.expected_output_id,
        kind: "missing_required_evidence",
        message: `Required evidence was not present in replay signature: ${requirement.requirement_id}.`,
        expected: requirement
      });
    }
  }

  for (const requirement of expectation.forbidden_evidence) {
    if (requirementSatisfied(requirement, sources)) {
      mismatches.push({
        expectation_id: expectation.expected_output_id,
        kind: "forbidden_evidence_present",
        message: `Forbidden evidence was present in replay signature: ${requirement.requirement_id}.`,
        expected: requirement
      });
    }
  }

  for (const derived of expectation.expected_derived_events) {
    const present = derivedEventPresent(derived.event_kind, evaluation);
    if ((derived.expectation === "present") !== present) {
      mismatches.push({
        expectation_id: expectation.expected_output_id,
        kind: "derived_event_presence_mismatch",
        message: `Derived event ${derived.event_kind} presence did not match the golden expectation.`,
        expected: derived.expectation,
        actual: present ? "present" : "absent"
      });
    }
  }

  return mismatches;
};

const compareAbstentionReasons = (
  expectation: SmartFlowExpectedOutput,
  hypotheses: FlowHypothesisEvent[]
): SmartFlowGoldenMismatch[] => {
  const expectedReasons = expectation.abstention_reasons.filter(
    (reason) => reason !== "not_abstained"
  );
  if (expectedReasons.length === 0) {
    return [];
  }

  const actualReasons = new Set(hypotheses.flatMap((hypothesis) => hypothesis.abstention.reasons));
  return expectedReasons
    .filter((reason) => !actualReasons.has(reason))
    .map((reason) => ({
      expectation_id: expectation.expected_output_id,
      kind: "missing_abstention_reason" as const,
      message: `Expected abstention reason ${reason} was absent from replay hypotheses.`,
      expected: reason,
      actual: [...actualReasons].sort()
    }));
};

const requirementSatisfied = (
  requirement: SyntheticEvidenceRequirement,
  sources: FeatureSource
): boolean => {
  const values = valuesForRequirement(requirement, sources);

  if (requirement.operator === "present") {
    if (requirement.value === undefined || requirement.value === true) {
      return values.length > 0;
    }
    return values.some((value) => compareValues(value, requirement.value, "eq"));
  }
  if (requirement.operator === "absent") {
    return values.length === 0;
  }

  return values.some((value) => compareValues(value, requirement.value, requirement.operator));
};

const valuesForRequirement = (
  requirement: SyntheticEvidenceRequirement,
  sources: FeatureSource
): FlowFeatureValue[] => {
  const values: FlowFeatureValue[] = [];

  if (requirement.feature_key) {
    for (const cluster of sources.clusters) {
      const featureValue = cluster.feature_summary[requirement.feature_key];
      if (featureValue !== undefined) {
        values.push(featureValue);
      }
      for (const fact of factsMatchingKind(cluster.evidence_facts, requirement.fact_kind)) {
        if (fact.fact_id.endsWith(`:${requirement.feature_key}`) && fact.value !== undefined) {
          values.push(fact.value);
        }
      }
    }
  }

  if (values.length === 0) {
    for (const cluster of sources.clusters) {
      for (const fact of factsMatchingKind(cluster.evidence_facts, requirement.fact_kind)) {
        if (fact.value !== undefined) {
          values.push(fact.value);
        }
      }
    }
  }

  return values;
};

const factsMatchingKind = (
  facts: FlowEvidenceFact[],
  kind: SyntheticEvidenceRequirement["fact_kind"]
): FlowEvidenceFact[] => facts.filter((fact) => fact.kind === kind);

const compareValues = (
  actual: FlowFeatureValue,
  expected: SyntheticEvidenceRequirement["value"],
  operator: SyntheticEvidenceRequirement["operator"]
): boolean => {
  if (operator === "eq") {
    return actual === expected;
  }
  if (typeof actual !== "number" || typeof expected !== "number") {
    return false;
  }
  if (operator === "gte") {
    return actual >= expected;
  }
  if (operator === "lte") {
    return actual <= expected;
  }
  return false;
};

const derivedEventPresent = (
  eventKind: SmartFlowExpectedOutput["expected_derived_events"][number]["event_kind"],
  evaluation: SmartFlowReplayEvaluation
): boolean => {
  if (eventKind === "flow_evidence_candidate") {
    return evaluation.flow_packets.length > 0;
  }
  if (eventKind === "flow_evidence_cluster") {
    return evaluation.evidence_clusters.length > 0;
  }
  if (eventKind === "flow_hypothesis_event") {
    return evaluation.hypotheses.some((hypothesis) => !hypothesis.abstention.abstained);
  }
  if (eventKind === "smart_flow_insight") {
    return evaluation.insights.length > 0;
  }
  return false;
};

const buildSmartFlowReplaySignature = (
  fixture: SmartFlowReplayFixture,
  flowPackets: FlowPacket[],
  candidates: ReturnType<typeof buildFlowEvidenceCandidateFromPacket>["candidate"][],
  clusters: FlowEvidenceCluster[],
  hypotheses: FlowHypothesisEvent[],
  insights: SmartFlowInsight[]
): SmartFlowReplaySignature => ({
  schema_version: SMART_FLOW_REPLAY_SIGNATURE_VERSION,
  run_id: fixture.manifest.run.run_id,
  scenario_id: fixture.manifest.run.scenario_id,
  raw_event_count: fixture.batch.events.length,
  flow_packet_count: flowPackets.length,
  candidate_count: candidates.length,
  cluster_count: clusters.length,
  emitted_hypothesis_count: hypotheses.filter((hypothesis) => !hypothesis.abstention.abstained)
    .length,
  insight_count: insights.length,
  candidates: candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    underlying_id: candidate.underlying_id,
    eligibility_status: candidate.eligibility.status,
    eligibility_reasons: [...candidate.eligibility.reasons].sort(),
    evidence_grade: candidate.evidence_quality.grade
  })),
  clusters: clusters.map(clusterSignature),
  hypotheses: hypotheses.map(hypothesisSignature)
});

const clusterSignature = (cluster: FlowEvidenceCluster): SmartFlowReplayClusterSignature => ({
  cluster_id: cluster.cluster_id,
  underlying_id: cluster.underlying_id,
  candidate_count: cluster.candidate_ids.length,
  member_print_count: cluster.member_print_ids.length,
  evidence_grade: cluster.evidence_quality.grade,
  evidence_caveats: [...cluster.evidence_quality.caveats].sort(),
  features: Object.fromEntries(
    SIGNATURE_FEATURE_KEYS.flatMap((key) => {
      const value = cluster.feature_summary[key];
      return value === undefined ? [] : [[key, value]];
    })
  )
});

const hypothesisSignature = (
  hypothesis: FlowHypothesisEvent
): SmartFlowReplayHypothesisSignature => ({
  event_id: hypothesis.event_id,
  cluster_id: hypothesis.cluster_id,
  hypothesis_type: hypothesis.hypothesis_type,
  direction: hypothesis.direction,
  abstained: hypothesis.abstention.abstained,
  abstention_reasons: [...hypothesis.abstention.reasons].sort(),
  confidence_band: confidenceBand(hypothesis.scores.confidence.policy_confidence),
  policy_confidence: hypothesis.scores.confidence.policy_confidence,
  fit_score: hypothesis.scores.fit_score,
  evidence_strength: hypothesis.scores.evidence_strength,
  penalty_score: hypothesis.scores.penalty_score,
  penalty_kinds: [...new Set(hypothesis.scores.penalties.map((penalty) => penalty.kind))].sort()
});

const orderRawEvents = (events: readonly GeneratedMarketEvent[]): GeneratedMarketEvent[] =>
  [...events].sort((a, b) => {
    return (
      a.event.ts - b.event.ts ||
      a.event.ingest_ts - b.event.ingest_ts ||
      a.event.seq - b.event.seq ||
      a.event.trace_id.localeCompare(b.event.trace_id)
    );
  });

const setFeature = (
  features: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean | null | undefined
) => {
  if (value !== null && value !== undefined) {
    features[key] = value;
  }
};

const confidenceBand = (confidence: number): "low" | "medium" | "high" => {
  if (confidence >= 0.72) {
    return "high";
  }
  if (confidence >= 0.52) {
    return "medium";
  }
  return "low";
};

const midpoint = (bid: number, ask: number): number => roundTo((bid + ask) / 2);

const quoteMid = (quote: OptionNBBO | null): number | null =>
  quote ? midpoint(quote.bid, quote.ask) : null;

const quoteSpread = (quote: OptionNBBO | null): number | null =>
  quote ? roundTo(quote.ask - quote.bid) : null;

const roundTo = (value: number, digits = 4): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
};

const ratiosForOptionSide = (
  side: string | null | undefined
): { buy: number; sell: number; inside: number; aggressive: number } => {
  if (side === "A" || side === "AA") {
    return { buy: 1, sell: 0, inside: 0, aggressive: 1 };
  }
  if (side === "B" || side === "BB") {
    return { buy: 0, sell: 1, inside: 0, aggressive: 1 };
  }
  if (side === "MID") {
    return { buy: 0, sell: 0, inside: 1, aggressive: 0 };
  }
  return { buy: 0, sell: 0, inside: 0, aggressive: 0 };
};

const classifyOptionPlacement = (
  print: OptionPrint,
  quote: OptionNBBO | null
): "A" | "B" | "MID" | "MISSING" => {
  if (!quote) {
    return "MISSING";
  }

  const spread = Math.max(0, quote.ask - quote.bid);
  const epsilon = Math.max(0.01, spread * 0.05);
  if (print.price >= quote.ask - epsilon) {
    return "A";
  }
  if (print.price <= quote.bid + epsilon) {
    return "B";
  }
  return "MID";
};

const isSpecialCondition = (condition: string): boolean =>
  ["AUCTION", "CROSS", "OPENING", "CLOSING", "COMPLEX", "SPREAD"].includes(condition.toUpperCase());

const eventOffsetDaysFromConditions = (conditions: readonly string[]): number | null => {
  for (const condition of conditions) {
    const match = condition.toUpperCase().match(/^EVENT_IN_(\d+)D$/);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }
  return null;
};
