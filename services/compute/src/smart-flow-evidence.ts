import {
  type EvidenceQuality,
  type EvidenceQualityGrade,
  type FlowCandidate,
  FlowCandidateSchema,
  type FlowEligibility,
  type FlowEligibilityDecision,
  type FlowEligibilityStatus,
  type FlowEvidenceFact,
  FlowEvidenceFactSchema,
  type FlowFeatureValue,
  type FlowObservationRef,
  type FlowPacket,
  SMART_FLOW_CONTRACT_VERSION
} from "@islandflow/types";
import { parseContractId } from "./contracts";

export type FlowEvidenceExtractionConfig = {
  minPremium?: number;
  minSize?: number;
  minNbboCoverageRatio?: number;
  maxNbboStaleRatio?: number;
  maxOptionSpreadBps?: number;
  maxUnderlyingSpreadBps?: number;
  maxSpecialPrintRatio?: number;
  maxInsideRatioWithoutAggression?: number;
  minAggressorRatioForInsideContext?: number;
};

export type FlowEvidenceCandidateExtraction = {
  candidate: FlowCandidate;
  evidence_facts: FlowEvidenceFact[];
};

const DEFAULT_CONFIG = {
  minPremium: 10_000,
  minSize: 1,
  minNbboCoverageRatio: 0.35,
  maxNbboStaleRatio: 0.5,
  maxOptionSpreadBps: 800,
  maxUnderlyingSpreadBps: 150,
  maxSpecialPrintRatio: 0.34,
  maxInsideRatioWithoutAggression: 0.7,
  minAggressorRatioForInsideContext: 0.35
} satisfies Required<FlowEvidenceExtractionConfig>;

const SPECIAL_PRINT_CONDITIONS = new Set([
  "AUCTION",
  "CROSS",
  "OPENING",
  "CLOSING",
  "COMPLEX",
  "SPREAD"
]);

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

const numberFeature = (packet: FlowPacket, key: string): number | null => {
  const value = packet.features[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const stringFeature = (packet: FlowPacket, key: string): string => {
  const value = packet.features[key];
  return typeof value === "string" ? value : "";
};

const numericJoinQuality = (packet: FlowPacket, key: string): number | null => {
  const value = packet.join_quality[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const splitConditions = (value: string): string[] =>
  value
    .split(",")
    .map((condition) => condition.trim().toUpperCase())
    .filter(Boolean);

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const asFeatureValue = (value: number | string | boolean | null | undefined): FlowFeatureValue => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" || typeof value === "boolean" || value === null) {
    return value;
  }
  return null;
};

const buildPacketRef = (packet: FlowPacket): FlowObservationRef => ({
  observation_id: packet.id,
  kind: "flow_packet",
  role: "anchor",
  source_ts: packet.source_ts,
  trace_id: packet.trace_id
});

const buildMemberRefs = (packet: FlowPacket, sourceTs: number): FlowObservationRef[] =>
  packet.members.map((memberId) => ({
    observation_id: memberId,
    kind: "option_print",
    role: "member",
    source_ts: sourceTs,
    trace_id: memberId
  }));

const optionalQuoteRef = (
  packet: FlowPacket,
  contractId: string,
  sourceTs: number
): FlowObservationRef | null => {
  const quoteTs = numberFeature(packet, "nbbo_ts") ?? sourceTs;
  const hasQuoteContext =
    numberFeature(packet, "nbbo_bid") !== null ||
    numberFeature(packet, "nbbo_ask") !== null ||
    numberFeature(packet, "nbbo_mid") !== null ||
    numberFeature(packet, "nbbo_spread") !== null ||
    numericJoinQuality(packet, "nbbo_age_ms") !== null;

  if (!hasQuoteContext && numericJoinQuality(packet, "nbbo_missing") !== null) {
    return null;
  }
  if (!hasQuoteContext) {
    return null;
  }

  return {
    observation_id: `option-nbbo:${contractId}:${quoteTs}`,
    kind: "option_nbbo",
    role: "context",
    source_ts: quoteTs
  };
};

const optionalUnderlyingQuoteRef = (
  packet: FlowPacket,
  underlyingId: string,
  sourceTs: number
): FlowObservationRef | null => {
  const quoteTs = numberFeature(packet, "underlying_quote_ts") ?? sourceTs;
  const hasQuoteContext =
    numberFeature(packet, "underlying_bid") !== null ||
    numberFeature(packet, "underlying_ask") !== null ||
    numberFeature(packet, "underlying_mid") !== null ||
    numberFeature(packet, "underlying_spread") !== null ||
    numericJoinQuality(packet, "underlying_quote_age_ms") !== null;

  if (!hasQuoteContext) {
    return null;
  }

  return {
    observation_id: `equity-quote:${underlyingId}:${quoteTs}`,
    kind: "equity_quote",
    role: "context",
    source_ts: quoteTs
  };
};

const spreadBps = (mid: number | null, spread: number | null): number | null => {
  if (mid === null || spread === null || mid <= 0) {
    return null;
  }
  return roundTo((Math.max(0, spread) / mid) * 10_000, 2);
};

const optionSpreadBps = (packet: FlowPacket): number | null => {
  const mid =
    numberFeature(packet, "nbbo_mid") ??
    (() => {
      const bid = numberFeature(packet, "nbbo_bid");
      const ask = numberFeature(packet, "nbbo_ask");
      return bid !== null && ask !== null ? (bid + ask) / 2 : null;
    })();
  const spread =
    numberFeature(packet, "nbbo_spread") ??
    (() => {
      const bid = numberFeature(packet, "nbbo_bid");
      const ask = numberFeature(packet, "nbbo_ask");
      return bid !== null && ask !== null ? ask - bid : null;
    })();
  return spreadBps(mid, spread);
};

const underlyingSpreadBps = (packet: FlowPacket): number | null => {
  const mid =
    numberFeature(packet, "underlying_mid") ??
    (() => {
      const bid = numberFeature(packet, "underlying_bid");
      const ask = numberFeature(packet, "underlying_ask");
      return bid !== null && ask !== null ? (bid + ask) / 2 : null;
    })();
  const spread =
    numberFeature(packet, "underlying_spread") ??
    (() => {
      const bid = numberFeature(packet, "underlying_bid");
      const ask = numberFeature(packet, "underlying_ask");
      return bid !== null && ask !== null ? ask - bid : null;
    })();
  return spreadBps(mid, spread);
};

const buildEvidenceQuality = (
  coverageRatio: number,
  staleRatio: number,
  completenessScore: number,
  caveats: string[]
): EvidenceQuality => {
  const qualityScore = clampUnit(
    coverageRatio * 0.55 + (1 - staleRatio) * 0.3 + completenessScore * 0.15
  );
  const grade: EvidenceQualityGrade =
    qualityScore >= 0.82
      ? "strong"
      : qualityScore >= 0.55
        ? "usable"
        : qualityScore > 0.2
          ? "thin"
          : "poor";

  return {
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    grade,
    quality_score: roundTo(qualityScore),
    coverage_ratio: roundTo(coverageRatio),
    stale_ratio: roundTo(staleRatio),
    completeness_score: roundTo(completenessScore),
    caveats
  };
};

const buildEligibility = (
  decisions: FlowEligibilityDecision[],
  evidenceRefs: string[]
): FlowEligibility => {
  const hasReject = decisions.some((decision) => decision.status === "rejected");
  const hasDownWeight = decisions.some((decision) => decision.status === "down_weighted");
  const status: FlowEligibilityStatus = hasReject
    ? "rejected"
    : hasDownWeight
      ? "down_weighted"
      : "accepted";

  const finalDecisions =
    decisions.length > 0
      ? decisions
      : [
          {
            status,
            reason_code: "evidence_context_usable",
            reason: "Quote coverage, size, and context are usable for downstream evidence work.",
            evidence_refs: evidenceRefs
          }
        ];

  return {
    eligible: status !== "rejected",
    status,
    reasons: unique(finalDecisions.map((decision) => decision.reason_code)),
    decisions: finalDecisions
  };
};

const buildFact = (
  packet: FlowPacket,
  slug: string,
  kind: FlowEvidenceFact["kind"],
  label: string,
  value: FlowFeatureValue | undefined,
  unit: string | undefined,
  observationRefs: FlowObservationRef[]
): FlowEvidenceFact =>
  FlowEvidenceFactSchema.parse({
    fact_id: `fact:${packet.id}:${slug}`,
    kind,
    label,
    ...(value !== undefined ? { value } : {}),
    ...(unit ? { unit } : {}),
    observation_refs: observationRefs
  });

export const buildFlowEvidenceCandidateFromPacket = (
  packet: FlowPacket,
  config: FlowEvidenceExtractionConfig = {}
): FlowEvidenceCandidateExtraction => {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const contractId = stringFeature(packet, "option_contract_id");
  const parsedContract = parseContractId(contractId);
  const underlyingId = stringFeature(packet, "underlying_id") || parsedContract?.root || "UNKNOWN";
  const sourceTs = numberFeature(packet, "end_ts") ?? packet.source_ts;
  const packetRef = buildPacketRef(packet);
  const memberRefs = buildMemberRefs(packet, sourceTs);
  const quoteRef = optionalQuoteRef(packet, contractId || packet.id, sourceTs);
  const underlyingQuoteRef = optionalUnderlyingQuoteRef(packet, underlyingId, sourceTs);
  const observationRefs = [packetRef, ...memberRefs, quoteRef, underlyingQuoteRef].filter(
    (ref): ref is FlowObservationRef => Boolean(ref)
  );
  const evidenceRefs = [packet.id, ...packet.members];

  const printCount = Math.max(
    0,
    Math.round(numberFeature(packet, "count") ?? packet.members.length)
  );
  const totalPremium = numberFeature(packet, "total_premium") ?? 0;
  const totalSize = numberFeature(packet, "total_size") ?? 0;
  const nbboCoverageRatio = clampUnit(numberFeature(packet, "nbbo_coverage_ratio") ?? 0);
  const staleCount = Math.max(0, numberFeature(packet, "nbbo_stale_count") ?? 0);
  const missingCount = Math.max(0, numberFeature(packet, "nbbo_missing_count") ?? 0);
  const staleRatio = printCount > 0 ? clampUnit((staleCount + missingCount) / printCount) : 1;
  const insideRatio = clampUnit(numberFeature(packet, "nbbo_inside_ratio") ?? 0);
  const aggressiveRatio = clampUnit(numberFeature(packet, "nbbo_aggressive_ratio") ?? 0);
  const specialPrintCount = Math.max(0, numberFeature(packet, "special_print_count") ?? 0);
  const specialPrintRatio = printCount > 0 ? clampUnit(specialPrintCount / printCount) : 0;
  const conditions = splitConditions(stringFeature(packet, "conditions"));
  const hasNoisyCondition = conditions.some((condition) => SPECIAL_PRINT_CONDITIONS.has(condition));
  const nbboAgeMs = numericJoinQuality(packet, "nbbo_age_ms");
  const optionSpread = optionSpreadBps(packet);
  const underlyingSpread = underlyingSpreadBps(packet);

  const decisions: FlowEligibilityDecision[] = [];
  const addDecision = (
    status: FlowEligibilityDecision["status"],
    reasonCode: string,
    reason: string
  ): void => {
    decisions.push({
      status,
      reason_code: reasonCode,
      reason,
      evidence_refs: evidenceRefs
    });
  };

  if (printCount <= 0 || totalSize < resolvedConfig.minSize) {
    addDecision(
      "rejected",
      "insufficient_observation_size",
      "The packet does not contain enough observed option size for evidence extraction."
    );
  }
  if (totalPremium < resolvedConfig.minPremium) {
    addDecision(
      "rejected",
      "insufficient_premium",
      "Observed premium is below the minimum evidence extraction threshold."
    );
  }
  if (nbboCoverageRatio < resolvedConfig.minNbboCoverageRatio) {
    addDecision(
      "rejected",
      missingCount >= staleCount ? "missing_quote_context" : "stale_quote_context",
      "NBBO coverage is too thin to treat the packet as usable quote-backed evidence."
    );
  } else if (staleRatio >= resolvedConfig.maxNbboStaleRatio) {
    addDecision(
      "rejected",
      "stale_quote_context",
      "Too much of the packet depends on stale or missing quote context."
    );
  } else if (staleRatio > 0) {
    addDecision(
      "down_weighted",
      "stale_quote_context",
      "Some prints have stale or missing quote context, so downstream evidence should be discounted."
    );
  }
  if (optionSpread !== null && optionSpread > resolvedConfig.maxOptionSpreadBps) {
    addDecision(
      "down_weighted",
      "wide_quote_context",
      "The option NBBO spread is wide enough to weaken execution-side evidence."
    );
  }
  if (underlyingSpread !== null && underlyingSpread > resolvedConfig.maxUnderlyingSpreadBps) {
    addDecision(
      "down_weighted",
      "wide_underlying_quote_context",
      "The underlying quote spread is wide enough to weaken related context evidence."
    );
  }
  if (specialPrintRatio >= resolvedConfig.maxSpecialPrintRatio || hasNoisyCondition) {
    addDecision(
      "down_weighted",
      "noisy_print_context",
      "Special, complex, cross, auction, opening, or closing print context is present."
    );
  }
  if (
    insideRatio >= resolvedConfig.maxInsideRatioWithoutAggression &&
    aggressiveRatio < resolvedConfig.minAggressorRatioForInsideContext
  ) {
    addDecision(
      "down_weighted",
      "inside_market_context",
      "Most prints occurred near the inside market without enough aggression evidence."
    );
  }
  if (underlyingId === "UNKNOWN") {
    addDecision(
      "down_weighted",
      "missing_underlying_context",
      "No underlying identifier was available for joining related context."
    );
  }

  const eligibility = buildEligibility(decisions, evidenceRefs);
  const completenessInputs = [
    totalPremium > 0,
    totalSize > 0,
    nbboCoverageRatio > 0,
    Boolean(contractId),
    underlyingId !== "UNKNOWN"
  ];
  const completenessScore = completenessInputs.filter(Boolean).length / completenessInputs.length;
  const evidenceQuality = buildEvidenceQuality(
    nbboCoverageRatio,
    staleRatio,
    completenessScore,
    eligibility.status === "accepted" ? [] : eligibility.reasons
  );

  const facts: FlowEvidenceFact[] = [
    buildFact(
      packet,
      "premium-size",
      "premium_size",
      "Observed packet premium",
      roundTo(totalPremium, 2),
      "usd",
      [packetRef, ...memberRefs]
    ),
    buildFact(
      packet,
      "contract-size",
      "execution_context",
      "Observed contract size",
      roundTo(totalSize, 2),
      "contracts",
      [packetRef, ...memberRefs]
    ),
    buildFact(
      packet,
      "aggression-ratio",
      "execution_aggression",
      "NBBO aggression ratio",
      roundTo(aggressiveRatio),
      "ratio",
      quoteRef ? [packetRef, quoteRef, ...memberRefs] : [packetRef, ...memberRefs]
    ),
    buildFact(
      packet,
      "nbbo-coverage",
      "quote_quality",
      "NBBO coverage ratio",
      roundTo(nbboCoverageRatio),
      "ratio",
      quoteRef ? [packetRef, quoteRef] : [packetRef]
    ),
    buildFact(
      packet,
      "stale-quote-ratio",
      "quote_quality",
      "Stale or missing NBBO ratio",
      roundTo(staleRatio),
      "ratio",
      quoteRef ? [packetRef, quoteRef] : [packetRef]
    )
  ];

  if (nbboAgeMs !== null) {
    facts.push(
      buildFact(packet, "nbbo-age", "quote_quality", "NBBO quote age", nbboAgeMs, "ms", [
        packetRef,
        ...(quoteRef ? [quoteRef] : [])
      ])
    );
  }
  if (optionSpread !== null) {
    facts.push(
      buildFact(
        packet,
        "option-spread-bps",
        "quote_quality",
        "Option NBBO spread",
        optionSpread,
        "bps",
        [packetRef, ...(quoteRef ? [quoteRef] : [])]
      )
    );
  }
  if (underlyingQuoteRef) {
    facts.push(
      buildFact(
        packet,
        "underlying-quote-context",
        "underlying_context",
        "Underlying quote context",
        asFeatureValue(numberFeature(packet, "underlying_mid")),
        "price",
        [packetRef, underlyingQuoteRef]
      )
    );
  }
  if (underlyingSpread !== null) {
    facts.push(
      buildFact(
        packet,
        "underlying-spread-bps",
        "underlying_context",
        "Underlying quote spread",
        underlyingSpread,
        "bps",
        underlyingQuoteRef ? [packetRef, underlyingQuoteRef] : [packetRef]
      )
    );
  }
  if (conditions.length > 0) {
    facts.push(
      buildFact(
        packet,
        "print-conditions",
        "execution_context",
        "Observed print conditions",
        conditions.join(","),
        undefined,
        [packetRef, ...memberRefs]
      )
    );
  }
  const corporateEventTs = numberFeature(packet, "corporate_event_ts");
  if (corporateEventTs !== null) {
    facts.push(
      buildFact(
        packet,
        "event-context",
        "event_context",
        "Known event timestamp",
        corporateEventTs,
        "ms",
        [packetRef]
      )
    );
  }
  for (const decision of eligibility.decisions) {
    facts.push(
      buildFact(
        packet,
        `eligibility-${decision.reason_code}`,
        "eligibility_decision",
        decision.reason,
        decision.status,
        undefined,
        [packetRef, ...memberRefs]
      )
    );
  }

  const featureVector: Record<string, FlowFeatureValue> = {
    total_premium: roundTo(totalPremium, 2),
    total_size: roundTo(totalSize, 2),
    print_count: printCount,
    nbbo_coverage_ratio: roundTo(nbboCoverageRatio),
    nbbo_stale_ratio: roundTo(staleRatio),
    nbbo_aggressive_ratio: roundTo(aggressiveRatio),
    nbbo_inside_ratio: roundTo(insideRatio),
    option_spread_bps: optionSpread,
    underlying_spread_bps: underlyingSpread,
    special_print_ratio: roundTo(specialPrintRatio),
    eligibility_status: eligibility.status,
    conditions: conditions.length > 0 ? conditions.join(",") : null
  };

  const candidate = FlowCandidateSchema.parse({
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    candidate_id: `candidate:${packet.id}`,
    underlying_id: underlyingId,
    observed_at_ts: sourceTs,
    packet_ids: [packet.id],
    member_print_ids: packet.members,
    observation_refs: observationRefs,
    feature_vector: featureVector,
    baseline_snapshot: null,
    evidence_quality: evidenceQuality,
    eligibility
  });

  return {
    candidate,
    evidence_facts: facts.map((fact) => FlowEvidenceFactSchema.parse(fact))
  };
};
