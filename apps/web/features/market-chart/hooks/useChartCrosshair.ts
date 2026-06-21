"use client";

import type { MouseEventParams, Time, UTCTimestamp } from "lightweight-charts";
import { useCallback, useRef } from "react";
import { buildHoverSnapshot } from "../transforms/hover";
import { chartTimeToMs } from "../transforms/time";
import type {
  MarketChartCandle,
  MarketChartHoverRowProvider,
  MarketChartHoverSnapshot,
  MarketChartLowerSeries,
  MarketChartMarker,
  MarketChartOverlay
} from "../types";

type UseChartCrosshairInput = {
  symbol: string;
  intervalMs: number;
  candles: MarketChartCandle[];
  lowerSeries?: MarketChartLowerSeries;
  overlays?: MarketChartOverlay[];
  markers?: MarketChartMarker[];
  hoverRows?: MarketChartHoverRowProvider[];
  onCrosshairChange?: (snapshot: MarketChartHoverSnapshot | null) => void;
};

type ChartCrosshairState = {
  symbol: string;
  intervalMs: number;
  candles: MarketChartCandle[];
  lowerSeries?: MarketChartLowerSeries;
  overlays?: MarketChartOverlay[];
  markers?: MarketChartMarker[];
  hoverRows: MarketChartHoverRowProvider[];
};

export const useChartCrosshair = ({
  symbol,
  intervalMs,
  candles,
  lowerSeries,
  overlays,
  markers,
  hoverRows,
  onCrosshairChange
}: UseChartCrosshairInput) => {
  const callbackRef = useRef(onCrosshairChange);
  const stateRef = useRef<ChartCrosshairState>({
    symbol,
    intervalMs,
    candles,
    lowerSeries,
    overlays,
    markers,
    hoverRows: hoverRows ?? []
  });
  callbackRef.current = onCrosshairChange;
  stateRef.current = {
    symbol,
    intervalMs,
    candles,
    lowerSeries,
    overlays,
    markers,
    hoverRows: hoverRows ?? []
  };

  return useCallback((param: MouseEventParams<Time>) => {
    if (!param.time) {
      callbackRef.current?.(null);
      return;
    }

    const timestampMs = chartTimeToMs(param.time);
    if (timestampMs === null) {
      callbackRef.current?.(null);
      return;
    }

    const time = Math.floor(timestampMs / 1000) as UTCTimestamp;
    const state = stateRef.current;
    const candle = state.candles.find((item) => item.time === time);
    const bucketStartMs = candle?.timestampMs ?? timestampMs;
    const bucketEndMs = bucketStartMs + state.intervalMs;
    const lowerPoints =
      state.lowerSeries?.layers.flatMap((layer) =>
        layer.points.filter((point) => point.time === time)
      ) ?? [];
    const overlayPoints =
      state.overlays?.flatMap((overlay) => overlay.points.filter((point) => point.time === time)) ??
      [];
    const marker = state.markers?.find((item) => item.time === time);
    const context = {
      symbol: state.symbol,
      intervalMs: state.intervalMs,
      time,
      timestampMs,
      bucketStartMs,
      bucketEndMs,
      candle,
      lowerPoints,
      overlayPoints,
      marker
    };
    const extensionRows = state.hoverRows.flatMap((provider) => provider(context));
    const lowerRows =
      state.lowerSeries?.layers.flatMap((layer) => layer.hoverRows?.(context) ?? []) ?? [];
    const overlayRows =
      state.overlays?.flatMap((overlay) => overlay.hoverRows?.(context) ?? []) ?? [];
    callbackRef.current?.(
      buildHoverSnapshot(context, {
        extensionRows,
        lowerRows,
        overlayRows,
        point: param.point ? { x: param.point.x, y: param.point.y } : undefined
      })
    );
  }, []);
};
