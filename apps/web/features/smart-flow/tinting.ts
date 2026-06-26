import type {
  FlowHypothesisType,
  SmartFlowExplainabilityProjection,
  SmartMoneyDirection
} from "@islandflow/types";
import type { CSSProperties } from "react";

export type SmartFlowTintDirection = SmartMoneyDirection | "abstained";

export type SmartFlowTintTone =
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

export type SmartFlowPolicyConfidenceBand = "low" | "medium" | "high";
export type SmartFlowEvidenceQualityBand = "poor" | "thin" | "usable" | "strong";

export type SmartFlowTintInput = {
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

export type SmartFlowTintMetadata = {
  family: FlowHypothesisType;
  hypothesisType: FlowHypothesisType;
  tone: SmartFlowTintTone;
  intensity: number;
  direction: SmartFlowTintDirection;
  abstained: boolean;
  abstentionReasons: string[];
  sourceReasons: string[];
  policyConfidence: number;
  confidenceBand: SmartFlowPolicyConfidenceBand;
  evidenceQuality: number;
  evidenceQualityBand: SmartFlowEvidenceQualityBand;
};

export type SmartFlowTint = {
  style: CSSProperties;
  metadata: SmartFlowTintMetadata;
};

export type SmartFlowSummary = {
  hypothesis: string;
  direction: string;
  confidence: string;
  evidenceQuality: string;
  abstention: string;
};

const SMART_FLOW_TINT_TONES = new Set<SmartFlowTintTone>([
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

const TONE_BY_HYPOTHESIS: Record<FlowHypothesisType, SmartFlowTintTone> = {
  directional_accumulation: "green",
  retail_attention_flow: "teal",
  event_positioning: "blue",
  volatility_supply: "copper",
  structure_arbitrage: "violet",
  hedge_rebalance: "cyan",
  unclear: "neutral"
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

export const normalizeSmartFlowClassToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const clampSmartFlowUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

export const roundSmartFlowUnit = (value: number): number =>
  Number(clampSmartFlowUnit(value).toFixed(3));

export const getSmartFlowTintStyle = (intensity: number): CSSProperties =>
  ({
    "--classifier-intensity": roundSmartFlowUnit(intensity).toFixed(3)
  }) as CSSProperties;

export const normalizeSmartFlowTintTone = (value: string | undefined): SmartFlowTintTone => {
  const token = normalizeSmartFlowClassToken(value ?? "");
  return SMART_FLOW_TINT_TONES.has(token as SmartFlowTintTone)
    ? (token as SmartFlowTintTone)
    : "neutral";
};

export const normalizeSmartFlowDirection = (
  value: string | null | undefined
): SmartFlowTintDirection => {
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

export const humanizeSmartFlowToken = (value: string): string => {
  const normalized = value.trim().replace(/[_-]+/g, " ");
  if (!normalized) {
    return "--";
  }
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
};

export const getSmartFlowHypothesisTone = (
  hypothesisType: FlowHypothesisType
): SmartFlowTintTone => TONE_BY_HYPOTHESIS[hypothesisType];

export const getSmartFlowHypothesisLabel = (hypothesisType: FlowHypothesisType): string =>
  SMART_FLOW_HYPOTHESIS_LABELS[hypothesisType];

export const getSmartFlowPolicyConfidenceBand = (
  confidence: number
): SmartFlowPolicyConfidenceBand => {
  if (confidence >= 0.72) {
    return "high";
  }
  if (confidence >= 0.52) {
    return "medium";
  }
  return "low";
};

export const getSmartFlowEvidenceQualityBand = (
  evidenceQuality: number
): SmartFlowEvidenceQualityBand => {
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

export const getSmartFlowTintIntensity = ({
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
    return roundSmartFlowUnit(Math.min(0.36, 0.1 + weightedSignal * 0.3));
  }
  return roundSmartFlowUnit(Math.max(0.18, weightedSignal));
};

const getAbstentionReasons = (event: SmartFlowTintInput["abstention"]): string[] =>
  event.reasons.filter((reason) => reason !== "not_abstained");

export const getSmartFlowTint = (projection: SmartFlowTintInput): SmartFlowTint => {
  const hypothesisType = projection.hypothesis.hypothesis_type;
  const abstained = projection.abstention.abstained;
  const direction = abstained
    ? "abstained"
    : normalizeSmartFlowDirection(projection.hypothesis.direction);
  const policyConfidence = roundSmartFlowUnit(
    projection.hypothesis.scores.confidence.policy_confidence
  );
  const evidenceQuality = roundSmartFlowUnit(projection.evidence.evidence_quality);
  const confidenceBand = getSmartFlowPolicyConfidenceBand(policyConfidence);
  const evidenceQualityBand = getSmartFlowEvidenceQualityBand(evidenceQuality);
  const tone = abstained ? "neutral" : getSmartFlowHypothesisTone(hypothesisType);
  const intensity = getSmartFlowTintIntensity({
    abstained,
    evidenceQuality,
    policyConfidence
  });

  return {
    style: getSmartFlowTintStyle(intensity),
    metadata: {
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

export const getSmartFlowSummary = (projection: SmartFlowTintInput): SmartFlowSummary => {
  const policyConfidence = roundSmartFlowUnit(
    projection.hypothesis.scores.confidence.policy_confidence
  );
  const evidenceQuality = roundSmartFlowUnit(projection.evidence.evidence_quality);
  const confidenceBand = getSmartFlowPolicyConfidenceBand(policyConfidence);
  const evidenceQualityBand = getSmartFlowEvidenceQualityBand(evidenceQuality);
  const abstentionReason =
    projection.abstention.source_reasons[0] ??
    projection.abstention.reasons.find((reason) => reason !== "not_abstained");

  return {
    hypothesis: getSmartFlowHypothesisLabel(projection.hypothesis.hypothesis_type),
    direction: projection.abstention.abstained
      ? "abstained"
      : normalizeSmartFlowDirection(projection.hypothesis.direction),
    confidence: `${Math.round(policyConfidence * 100)}% ${confidenceBand}`,
    evidenceQuality: `${Math.round(evidenceQuality * 100)}% ${evidenceQualityBand}`,
    abstention: projection.abstention.abstained
      ? `abstained: ${humanizeSmartFlowToken(abstentionReason ?? "policy")}`
      : "not abstained"
  };
};
