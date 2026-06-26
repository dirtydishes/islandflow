import type { FlowHypothesisType, SmartMoneyDirection } from "@islandflow/types";
import type { CSSProperties } from "react";

import type { OptionsTapeDecor } from "./types";

export const OPTIONS_TAPE_SMART_FLOW_HYPOTHESIS_TYPES = [
  "directional_accumulation",
  "retail_attention_flow",
  "event_positioning",
  "volatility_supply",
  "structure_arbitrage",
  "hedge_rebalance",
  "unclear"
] as const satisfies readonly FlowHypothesisType[];

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
    hypothesis_type: FlowHypothesisType;
    direction: SmartMoneyDirection;
    scores: {
      confidence: {
        policy_confidence: number;
        evidence_quality: number;
      };
    };
  };
  evidence?: {
    evidence_quality?: number | null;
  };
  abstention: {
    abstained: boolean;
    reasons: readonly string[];
    source_reasons: readonly string[];
  };
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

const TONE_BY_DIRECTION: Record<OptionsTapeTintDirection, OptionsTapeTintTone> = {
  bullish: "green",
  bearish: "red",
  neutral: "blue",
  mixed: "amber",
  unknown: "neutral",
  abstained: "neutral"
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
  const evidenceQuality = roundUnit(
    projection.evidence?.evidence_quality ??
      projection.hypothesis.scores.confidence.evidence_quality
  );
  const confidenceBand = getOptionsTapePolicyConfidenceBand(policyConfidence);
  const evidenceQualityBand = getOptionsTapeEvidenceQualityBand(evidenceQuality);
  const tone = TONE_BY_DIRECTION[direction];
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

export const getOptionsTapeRowTintClassName = (
  tint: OptionsTapeRowTint | undefined
): string | undefined => tint?.className;

export const getOptionsTapeRowTintStyle = (
  tint: OptionsTapeRowTint | undefined
): CSSProperties | undefined => tint?.style;
