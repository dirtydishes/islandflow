import type { FlowPacket, SmartFlowExplainabilityProjection } from "@islandflow/types";
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
  OptionsTapeSmartFlowRefSource
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

export type OptionsTapeSmartFlowContextMapInput = {
  projections?: readonly SmartFlowExplainabilityProjection[];
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  flowPacketByTraceId?: ReadonlyMap<string, FlowPacket>;
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

export const getOptionsTapePolicyConfidenceBand = getSmartFlowPolicyConfidenceBand;
export const getOptionsTapeEvidenceQualityBand = getSmartFlowEvidenceQualityBand;

export const getOptionsTapeSmartFlowRowTint = (
  projection: OptionsTapeSmartFlowTintInput
): OptionsTapeRowTint => {
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
  if (context.smartFlow) {
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
