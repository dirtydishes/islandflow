import type { DurableTapeSmartFlowSupport } from "@islandflow/types";
import type { CSSProperties } from "react";

import {
  getSmartFlowEvidenceQualityBand,
  getSmartFlowPolicyConfidenceBand,
  getSmartFlowSummary,
  getSmartFlowTint,
  normalizeSmartFlowClassToken as normalizeClassToken,
  type SmartFlowEvidenceQualityBand,
  type SmartFlowPolicyConfidenceBand,
  type SmartFlowSummary,
  type SmartFlowTintDirection,
  type SmartFlowTintInput,
  type SmartFlowTintMetadata,
  type SmartFlowTintTone
} from "../smart-flow";
import type {
  OptionsTapeRowContext,
  OptionsTapeSmartFlowContext,
  OptionsTapeSmartFlowProjection,
  OptionsTapeSmartFlowRefSource,
  OptionsTapeSmartFlowSupportResolution
} from "./types";

export type OptionsTapeTintDirection = SmartFlowTintDirection;
export type OptionsTapeTintTone = SmartFlowTintTone;
export type OptionsTapePolicyConfidenceBand = SmartFlowPolicyConfidenceBand;
export type OptionsTapeEvidenceQualityBand = SmartFlowEvidenceQualityBand;
export type OptionsTapeSmartFlowTintInput = SmartFlowTintInput;

export type OptionsTapeRowTintMetadata = { source: "smart-flow" } & SmartFlowTintMetadata;

export type OptionsTapeRowTint = {
  className: string;
  style: CSSProperties;
  metadata: OptionsTapeRowTintMetadata;
};

export type OptionsTapeSmartFlowSummary = SmartFlowSummary;

const uniqueNonEmpty = (items: readonly string[]): string[] =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

export const isOptionsTapeSmartFlowPacketRef = (ref: string): boolean =>
  ref.startsWith("flowpacket:");

export const getOptionsTapeSmartFlowSupportEvidenceRefs = (
  support: DurableTapeSmartFlowSupport
): string[] => uniqueNonEmpty(support.refs.evidence_refs);

export const getOptionsTapeSmartFlowSupportOptionPrintRefs = (
  support: DurableTapeSmartFlowSupport
): string[] =>
  uniqueNonEmpty(
    support.refs.option_print_refs.length > 0
      ? support.refs.option_print_refs
      : support.refs.evidence_refs.filter((ref) => !isOptionsTapeSmartFlowPacketRef(ref))
  );

export const getOptionsTapeSmartFlowSupportPacketRefs = (
  support: DurableTapeSmartFlowSupport
): string[] =>
  uniqueNonEmpty(
    support.refs.packet_refs.length > 0
      ? support.refs.packet_refs
      : support.refs.evidence_refs.filter(isOptionsTapeSmartFlowPacketRef)
  );

export const getOptionsTapePolicyConfidenceBand = getSmartFlowPolicyConfidenceBand;
export const getOptionsTapeEvidenceQualityBand = getSmartFlowEvidenceQualityBand;

const SUPPORT_SOURCE_TO_CONTEXT_SOURCE: Record<
  DurableTapeSmartFlowSupport["match_source"],
  OptionsTapeSmartFlowRefSource
> = {
  direct_print: "direct-print",
  packet_member: "packet-member"
};

export const isOptionsTapeSmartFlowProjectionTintEligible = (
  projection: OptionsTapeSmartFlowTintInput
): boolean =>
  !projection.abstention.abstained && projection.hypothesis.hypothesis_type !== "unclear";

export const isOptionsTapeSmartFlowSupportTintEligible = (
  support: DurableTapeSmartFlowSupport | null | undefined
): support is DurableTapeSmartFlowSupport =>
  Boolean(
    support && support.tint_eligible && !support.abstained && support.hypothesis_type !== "unclear"
  );

export const smartFlowSupportToOptionsTapeProjection = (
  support: DurableTapeSmartFlowSupport
): OptionsTapeSmartFlowProjection => {
  const abstentionReasons: OptionsTapeSmartFlowProjection["abstention"]["reasons"] =
    support.abstained ? ["other"] : ["not_abstained"];
  return {
    trace_id: support.projection_trace_id,
    refs: {
      evidence_refs: support.refs.evidence_refs
    },
    evidence: {
      evidence_refs: support.refs.evidence_refs,
      evidence_quality: support.evidence_quality
    },
    hypothesis: {
      evidence_refs: support.refs.evidence_refs,
      hypothesis_type: support.hypothesis_type,
      direction: support.direction,
      scores: {
        confidence: {
          policy_confidence: support.confidence,
          evidence_quality: support.evidence_quality
        }
      }
    },
    abstention: {
      abstained: support.abstained,
      reasons: abstentionReasons,
      source_reasons: []
    }
  };
};

export const getOptionsTapeSmartFlowContextFromSupport = ({
  optionTraceId,
  supportResolution,
  smartFlow,
  packetMemberTraceIds = []
}: {
  optionTraceId: string;
  supportResolution?: OptionsTapeSmartFlowSupportResolution | null;
  smartFlow?: DurableTapeSmartFlowSupport | null;
  packetMemberTraceIds?: readonly string[];
}): OptionsTapeSmartFlowContext | undefined => {
  const support = smartFlow ?? supportResolution?.smart_flow;
  if (!support) {
    return undefined;
  }

  const evidenceRefs = getOptionsTapeSmartFlowSupportEvidenceRefs(support);
  const directPrintRefs = uniqueNonEmpty([
    ...getOptionsTapeSmartFlowSupportOptionPrintRefs(support),
    ...(support.match_source === "direct_print" ? [optionTraceId] : [])
  ]);
  const packetRefs = uniqueNonEmpty([
    ...getOptionsTapeSmartFlowSupportPacketRefs(support),
    ...(support.packet_id ? [support.packet_id] : []),
    ...(supportResolution?.packet?.id ? [supportResolution.packet.id] : [])
  ]);
  const expandedPacketRefs = uniqueNonEmpty([
    ...packetMemberTraceIds,
    ...(supportResolution?.packet?.members ?? [])
  ]);

  return {
    support,
    tintEligible: isOptionsTapeSmartFlowSupportTintEligible(support),
    projection: smartFlowSupportToOptionsTapeProjection(support),
    source: SUPPORT_SOURCE_TO_CONTEXT_SOURCE[support.match_source],
    evidenceRefs,
    directPrintRefs,
    packetRefs,
    expandedPacketRefs
  };
};

export const getOptionsTapeSmartFlowRowTint = (
  projection: OptionsTapeSmartFlowTintInput
): OptionsTapeRowTint | undefined => {
  if (!isOptionsTapeSmartFlowProjectionTintEligible(projection)) {
    return undefined;
  }
  const smartFlowTint = getSmartFlowTint(projection);
  const { metadata } = smartFlowTint;
  const hypothesisClass = normalizeClassToken(metadata.hypothesisType);

  return {
    className: [
      "options-tape-row-tinted",
      "options-tape-smart-flow-row",
      `options-tape-row-hypothesis-${hypothesisClass}`,
      `options-tape-row-direction-${metadata.direction}`,
      `options-tape-row-confidence-${metadata.confidenceBand}`,
      `options-tape-row-evidence-${metadata.evidenceQualityBand}`,
      metadata.abstained ? "options-tape-row-abstained" : "",
      `smart-flow-tone-${metadata.tone}`
    ]
      .filter(Boolean)
      .join(" "),
    style: smartFlowTint.style,
    metadata: {
      source: "smart-flow",
      ...metadata
    }
  };
};

export const getOptionsTapeSmartFlowSummary = getSmartFlowSummary;

export const getOptionsTapeRowTintFromContext = (
  context: Pick<OptionsTapeRowContext, "smartFlow">
): OptionsTapeRowTint | undefined => {
  if (context.smartFlow?.tintEligible) {
    return getOptionsTapeSmartFlowRowTint(context.smartFlow.projection);
  }
  return undefined;
};

export const getOptionsTapeRowTintClassName = (
  tint: OptionsTapeRowTint | undefined
): string | undefined => tint?.className;

export const getOptionsTapeRowTintStyle = (
  tint: OptionsTapeRowTint | undefined
): CSSProperties | undefined => tint?.style;
