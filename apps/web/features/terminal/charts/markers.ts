import type { SmartFlowExplainabilityProjection } from "@islandflow/types";

export type ChartFlowMarkerItem = {
  kind: "smart-flow";
  projection: SmartFlowExplainabilityProjection;
};

export const sortBySourceTime = <T extends { source_ts: number; seq: number }>(
  items: readonly T[]
): T[] =>
  [...items].sort((a, b) => {
    const delta = a.source_ts - b.source_ts;
    if (delta !== 0) {
      return delta;
    }
    return a.seq - b.seq;
  });

export const getChartFlowMarkerItems = (
  smartFlowProjections: readonly SmartFlowExplainabilityProjection[],
  visibleRangeMs: { from: number; to: number } | null,
  maxSmartFlowMarkers = 220
): ChartFlowMarkerItem[] => {
  if (!visibleRangeMs) {
    return [];
  }

  const inRangeSmartFlow = sortBySourceTime(
    smartFlowProjections.filter(
      (projection) =>
        projection.source_ts >= visibleRangeMs.from && projection.source_ts <= visibleRangeMs.to
    )
  );

  const cappedSmartFlow =
    inRangeSmartFlow.length > maxSmartFlowMarkers
      ? inRangeSmartFlow.slice(inRangeSmartFlow.length - maxSmartFlowMarkers)
      : inRangeSmartFlow;
  return cappedSmartFlow.map(
    (projection): ChartFlowMarkerItem => ({ kind: "smart-flow", projection })
  );
};
