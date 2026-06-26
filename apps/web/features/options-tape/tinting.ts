import type {
  FlowPacket,
  FlowHypothesisType,
  SmartFlowExplainabilityProjection,
  SmartMoneyDirection
} from "@islandflow/types";
import type { CSSProperties } from "react";

import type {
  OptionsTapeDecor,
  OptionsTapeRowContext,
  OptionsTapeSmartFlowContext,
  OptionsTapeSmartFlowRefSource
} from "./types";

export type OptionsTapeTintDirection = SmartMoneyDirection | "abstained";
export type OptionsTapeTintTone =
  | "green"
  | "red"
  | "amber"
  | "copper"
  | "blue"
  | "teal"
  | "yellowgreen"
  | "violet"
  | "cyan"
  | "magenta"
  | "neutral";
export type OptionsTapePolicyConfidenceBand = "low" | "medium" | "high";
export type OptionsTapeEvidenceQualityBand = "poor" | "thin" | "usable" | "strong";

export type OptionsTapeSmartFlowTintInput = {
  hypothesis: {
    hypothesis_type: SmartFlowExplainabilityProjection["hypothesis"]["hypothesis_type"];
    direction: SmartFlowExplainabilityProjection["hypothesis"]["direction"];
    scores: {
      confidence: Pick<
        SmartFlowExplainabilityProjection["hypothesis"]["scores"]["confidence"],
        "policy_confidence" | "evidence_quality"
      >;
    };
  };
  evidence: Pick<SmartFlowExplainabilityProjection["evidence"], "evidence_quality">;
  abstention: SmartFlowExplainabilityProjection["abstention"];
};

export type OptionsTapeRowTintMetadata = {
  source: "decor" | "smart-flow";
  family: string;
  tone: OptionsTapeTintTone;
  intensity: number;
  direction: OptionsTapeTintDirection;
  abstained: boolean;
  abstentionReasons: string[];
  sourceReasons: string[];
  hypothesisType?: FlowHypothesisType;
  policyConfidence?: number;
  confidenceBand?: OptionsTapePolicyConfidenceBand;
  evidenceQuality?: number;
  evidenceQualityBand?: OptionsTapeEvidenceQualityBand;
};

export type OptionsTapeRowTint = {
  className: string;
  style: CSSProperties;
  metadata: OptionsTapeRowTintMetadata;
};

export type OptionsTapeSmartFlowSummary = {
  hypothesis: string;
  direction: string;
  confidence: string;
  evidenceQuality: string;
  abstention: string;
};

export type OptionsTapeSmartFlowContextMapInput = {
  projections?: readonly SmartFlowExplainabilityProjection[];
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  flowPacketByTraceId?: ReadonlyMap<string, FlowPacket>;
};

const OPTIONS_TAPE_TINT_TONES = new Set<OptionsTapeTintTone>([
  "green",
  "red",
  "amber",
  "copper",
  "blue",
  "teal",
  "yellowgreen",
  "violet",
  "cyan",
  "magenta",
  "neutral"
]);

const TONE_BY_HYPOTHESIS: Record<FlowHypothesisType, OptionsTapeTintTone> = {
  directional_accumulation: "green",
  retail_attention_flow: "teal",
  event_positioning: "blue",
  volatility_supply: "copper",
  structure_arbitrage: "violet",
  hedge_rebalance: "cyan",
  unclear: "neutral"
};

const normalizeClassToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

const roundUnit = (value: number): number => Number(clampUnit(value).toFixed(3));

const tintStyle = (intensity: number): CSSProperties =>
  ({
    "--classifier-intensity": roundUnit(intensity).toFixed(3)
  }) as CSSProperties;

const normalizeTintTone = (value: string | undefined): OptionsTapeTintTone => {
  const token = normalizeClassToken(value ?? "");
  return OPTIONS_TAPE_TINT_TONES.has(token as OptionsTapeTintTone)
    ? (token as OptionsTapeTintTone)
    : "neutral";
};

const normalizeTintDirection = (value: string | null | undefined): OptionsTapeTintDirection => {
  if (
    value === "bullish" ||
    value === "bearish" ||
    value === "neutral" ||
    value === "mixed" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
};

const humanizeToken = (value: string): string => {
  const normalized = value.trim().replace(/[_-]+/g, " ");
  if (!normalized) {
    return "--";
  }
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
};

const SMART_FLOW_HYPOTHESIS_LABELS: Record<FlowHypothesisType, string> = {
  directional_accumulation: "Directional accumulation",
  retail_attention_flow: "Retail attention flow",
  event_positioning: "Event positioning",
  volatility_supply: "Volatility supply",
  structure_arbitrage: "Structure arbitrage",
  hedge_rebalance: "Hedge rebalance",
  unclear: "No clear flow hypothesis"
};

const uniqueNonEmpty = (items: readonly string[]): string[] =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

export const getOptionsTapeSmartFlowEvidenceRefs = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis">
): string[] =>
  uniqueNonEmpty([
    ...projection.refs.evidence_refs,
    ...projection.evidence.evidence_refs,
    ...projection.hypothesis.evidence_refs
  ]);

export const isOptionsTapeSmartFlowPacketRef = (ref: string): boolean =>
  ref.startsWith("flowpacket:");

export const getOptionsTapeSmartFlowOptionPrintRefs = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis">
): string[] =>
  getOptionsTapeSmartFlowEvidenceRefs(projection).filter(
    (ref) => !isOptionsTapeSmartFlowPacketRef(ref)
  );

export const getOptionsTapeSmartFlowPacketRefs = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis">
): string[] =>
  getOptionsTapeSmartFlowEvidenceRefs(projection).filter(isOptionsTapeSmartFlowPacketRef);

const resolveSmartFlowPacketRef = (
  ref: string,
  flowPacketById?: ReadonlyMap<string, FlowPacket>,
  flowPacketByTraceId?: ReadonlyMap<string, FlowPacket>
): FlowPacket | undefined => flowPacketById?.get(ref) ?? flowPacketByTraceId?.get(ref);

const compareProjectionRecency = (
  left: SmartFlowExplainabilityProjection,
  right: SmartFlowExplainabilityProjection
): number => {
  const sourceDelta = (left.source_ts ?? 0) - (right.source_ts ?? 0);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }
  return (left.seq ?? 0) - (right.seq ?? 0);
};

const SMART_FLOW_REF_SOURCE_RANK: Record<OptionsTapeSmartFlowRefSource, number> = {
  "packet-member": 1,
  "direct-print": 2
};

const shouldReplaceSmartFlowContext = (
  current: OptionsTapeSmartFlowContext | undefined,
  nextProjection: SmartFlowExplainabilityProjection,
  nextSource: OptionsTapeSmartFlowRefSource
): boolean => {
  if (!current) {
    return true;
  }
  const recency = compareProjectionRecency(nextProjection, current.projection);
  if (recency !== 0) {
    return recency > 0;
  }
  return SMART_FLOW_REF_SOURCE_RANK[nextSource] > SMART_FLOW_REF_SOURCE_RANK[current.source];
};

export const buildOptionsTapeSmartFlowContextByTraceId = ({
  projections = [],
  flowPacketById,
  flowPacketByTraceId
}: OptionsTapeSmartFlowContextMapInput): Map<string, OptionsTapeSmartFlowContext> => {
  const map = new Map<string, OptionsTapeSmartFlowContext>();

  for (const projection of projections) {
    const evidenceRefs = getOptionsTapeSmartFlowEvidenceRefs(projection);
    const directPrintRefs = getOptionsTapeSmartFlowOptionPrintRefs(projection);
    const packetRefs = getOptionsTapeSmartFlowPacketRefs(projection);
    const expandedPacketRefs = uniqueNonEmpty(
      packetRefs.flatMap(
        (ref) => resolveSmartFlowPacketRef(ref, flowPacketById, flowPacketByTraceId)?.members ?? []
      )
    );

    const assign = (traceId: string, source: OptionsTapeSmartFlowRefSource) => {
      if (!shouldReplaceSmartFlowContext(map.get(traceId), projection, source)) {
        return;
      }
      map.set(traceId, {
        projection,
        source,
        evidenceRefs,
        directPrintRefs,
        packetRefs,
        expandedPacketRefs
      });
    };

    for (const traceId of expandedPacketRefs) {
      assign(traceId, "packet-member");
    }
    for (const traceId of directPrintRefs) {
      assign(traceId, "direct-print");
    }
  }

  return map;
};

export const getOptionsTapePolicyConfidenceBand = (
  confidence: number
): OptionsTapePolicyConfidenceBand => {
  if (confidence >= 0.72) {
    return "high";
  }
  if (confidence >= 0.52) {
    return "medium";
  }
  return "low";
};

export const getOptionsTapeEvidenceQualityBand = (
  evidenceQuality: number
): OptionsTapeEvidenceQualityBand => {
  if (evidenceQuality >= 0.82) {
    return "strong";
  }
  if (evidenceQuality >= 0.55) {
    return "usable";
  }
  if (evidenceQuality > 0) {
    return "thin";
  }
  return "poor";
};

const getSmartFlowTintIntensity = ({
  abstained,
  evidenceQuality,
  policyConfidence
}: {
  abstained: boolean;
  evidenceQuality: number;
  policyConfidence: number;
}): number => {
  const weightedSignal = policyConfidence * 0.7 + evidenceQuality * 0.3;
  if (abstained) {
    return roundUnit(Math.min(0.36, 0.1 + weightedSignal * 0.3));
  }
  return roundUnit(Math.max(0.18, weightedSignal));
};

const getAbstentionReasons = (event: OptionsTapeSmartFlowTintInput["abstention"]): string[] =>
  event.reasons.filter((reason) => reason !== "not_abstained");

export const getOptionsTapeSmartFlowRowTint = (
  projection: OptionsTapeSmartFlowTintInput
): OptionsTapeRowTint => {
  const hypothesisType = projection.hypothesis.hypothesis_type;
  const abstained = projection.abstention.abstained;
  const direction = abstained
    ? "abstained"
    : normalizeTintDirection(projection.hypothesis.direction);
  const policyConfidence = roundUnit(projection.hypothesis.scores.confidence.policy_confidence);
  const evidenceQuality = roundUnit(projection.evidence.evidence_quality);
  const confidenceBand = getOptionsTapePolicyConfidenceBand(policyConfidence);
  const evidenceQualityBand = getOptionsTapeEvidenceQualityBand(evidenceQuality);
  const tone = abstained ? "neutral" : TONE_BY_HYPOTHESIS[hypothesisType];
  const intensity = getSmartFlowTintIntensity({
    abstained,
    evidenceQuality,
    policyConfidence
  });
  const hypothesisClass = normalizeClassToken(hypothesisType);

  return {
    className: [
      "options-tape-row-tinted",
      "options-tape-smart-flow-row",
      `options-tape-row-hypothesis-${hypothesisClass}`,
      `options-tape-row-direction-${direction}`,
      `options-tape-row-confidence-${confidenceBand}`,
      `options-tape-row-evidence-${evidenceQualityBand}`,
      abstained ? "options-tape-row-abstained" : "",
      `classifier-${tone}`
    ]
      .filter(Boolean)
      .join(" "),
    style: tintStyle(intensity),
    metadata: {
      source: "smart-flow",
      family: hypothesisType,
      hypothesisType,
      tone,
      intensity,
      direction,
      policyConfidence,
      confidenceBand,
      evidenceQuality,
      evidenceQualityBand,
      abstained,
      abstentionReasons: getAbstentionReasons(projection.abstention),
      sourceReasons: [...projection.abstention.source_reasons]
    }
  };
};

const getDecorDirection = (decor: OptionsTapeDecor): OptionsTapeTintDirection => {
  if (decor.smartMoney?.abstained) {
    return "abstained";
  }
  return normalizeTintDirection(decor.smartMoney?.primary_direction ?? decor.hit?.direction);
};

export const getOptionsTapeDecorRowTint = (
  decor: OptionsTapeDecor | undefined
): OptionsTapeRowTint | undefined => {
  if (!decor) {
    return undefined;
  }
  const direction = getDecorDirection(decor);
  const abstained = direction === "abstained";
  const tone = normalizeTintTone(decor.tone);
  const intensity = roundUnit(abstained ? Math.min(0.28, decor.intensity) : decor.intensity);
  return {
    className: [
      "options-tape-row-tinted",
      "options-tape-decor-row",
      `options-tape-row-direction-${direction}`,
      abstained ? "options-tape-row-abstained" : "",
      `classifier-${tone}`
    ]
      .filter(Boolean)
      .join(" "),
    style: tintStyle(intensity),
    metadata: {
      source: "decor",
      family: decor.family,
      tone,
      intensity,
      direction,
      abstained,
      abstentionReasons: decor.smartMoney?.suppressed_reasons ?? [],
      sourceReasons: []
    }
  };
};

export const getOptionsTapeSmartFlowSummary = (
  projection: Pick<SmartFlowExplainabilityProjection, "hypothesis" | "evidence" | "abstention">
): OptionsTapeSmartFlowSummary => {
  const policyConfidence = roundUnit(projection.hypothesis.scores.confidence.policy_confidence);
  const evidenceQuality = roundUnit(projection.evidence.evidence_quality);
  const confidenceBand = getOptionsTapePolicyConfidenceBand(policyConfidence);
  const evidenceQualityBand = getOptionsTapeEvidenceQualityBand(evidenceQuality);
  const abstentionReason =
    projection.abstention.source_reasons[0] ??
    projection.abstention.reasons.find((reason) => reason !== "not_abstained");

  return {
    hypothesis:
      SMART_FLOW_HYPOTHESIS_LABELS[projection.hypothesis.hypothesis_type] ??
      humanizeToken(projection.hypothesis.hypothesis_type),
    direction: projection.abstention.abstained
      ? "abstained"
      : normalizeTintDirection(projection.hypothesis.direction),
    confidence: `${Math.round(policyConfidence * 100)}% ${confidenceBand}`,
    evidenceQuality: `${Math.round(evidenceQuality * 100)}% ${evidenceQualityBand}`,
    abstention: projection.abstention.abstained
      ? `abstained: ${humanizeToken(abstentionReason ?? "policy")}`
      : "not abstained"
  };
};

export const getOptionsTapeRowTintFromContext = (
  context: Pick<OptionsTapeRowContext, "smartFlow" | "decor">
): OptionsTapeRowTint | undefined => {
  if (context.smartFlow) {
    return getOptionsTapeSmartFlowRowTint(context.smartFlow.projection);
  }
  return getOptionsTapeDecorRowTint(context.decor);
};

export const getOptionsTapeRowTintClassName = (
  tint: OptionsTapeRowTint | undefined
): string | undefined => tint?.className;

export const getOptionsTapeRowTintStyle = (
  tint: OptionsTapeRowTint | undefined
): CSSProperties | undefined => tint?.style;
