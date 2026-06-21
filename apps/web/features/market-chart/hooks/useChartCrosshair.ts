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

export const useChartCrosshair = ({
  symbol,
  intervalMs,
  candles,
  lowerSeries,
  overlays,
  markers,
  hoverRows = [],
  onCrosshairChange
}: UseChartCrosshairInput) => {
  const callbackRef = useRef(onCrosshairChange);
  callbackRef.current = onCrosshairChange;

  return useCallback(
    (param: MouseEventParams<Time>) => {
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
      const candle = candles.find((item) => item.time === time);
      const lowerPoints =
        lowerSeries?.layers.flatMap((layer) =>
          layer.points.filter((point) => point.time === time)
        ) ?? [];
      const overlayPoints =
        overlays?.flatMap((overlay) => overlay.points.filter((point) => point.time === time)) ?? [];
      const marker = markers?.find((item) => item.time === time);
      const context = {
        symbol,
        intervalMs,
        time,
        timestampMs,
        candle,
        lowerPoints,
        overlayPoints,
        marker
      };
      const extensionRows = hoverRows.flatMap((provider) => provider(context));
      callbackRef.current?.(buildHoverSnapshot(context, extensionRows));
    },
    [candles, hoverRows, intervalMs, lowerSeries, markers, overlays, symbol]
  );
};
