import type { SmartFlowExplainabilityProjection, SmartMoneyEvent } from "@islandflow/types";

export type ChartFlowMarkerItem =
  | { kind: "smart-flow"; projection: SmartFlowExplainabilityProjection }
  | { kind: "smart-money-fallback"; event: SmartMoneyEvent };

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
  legacySmartMoneyEvents: readonly SmartMoneyEvent[],
  visibleRangeMs: { from: number; to: number } | null,
  maxSmartFlowMarkers = 220,
  maxLegacySmartMoneyMarkers = 220
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

  if (inRangeSmartFlow.length > 0) {
    const cappedSmartFlow =
      inRangeSmartFlow.length > maxSmartFlowMarkers
        ? inRangeSmartFlow.slice(inRangeSmartFlow.length - maxSmartFlowMarkers)
        : inRangeSmartFlow;
    return cappedSmartFlow.map(
      (projection): ChartFlowMarkerItem => ({ kind: "smart-flow", projection })
    );
  }

  const inRangeLegacy = sortBySourceTime(
    legacySmartMoneyEvents.filter(
      (event) => event.source_ts >= visibleRangeMs.from && event.source_ts <= visibleRangeMs.to
    )
  );
  const cappedLegacy =
    inRangeLegacy.length > maxLegacySmartMoneyMarkers
      ? inRangeLegacy.slice(inRangeLegacy.length - maxLegacySmartMoneyMarkers)
      : inRangeLegacy;
  return cappedLegacy.map(
    (event): ChartFlowMarkerItem => ({ kind: "smart-money-fallback", event })
  );
};
