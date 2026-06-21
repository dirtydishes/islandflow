"use client";

import {
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  CandlestickSeries as LightweightCandlestickSeries,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createMarketCandlestickSeriesOptions,
  createMarketChartOptions,
  DEFAULT_MARKET_CHART_THEME,
  getMarketChartLayoutPreset,
  MARKET_CHART_LAYOUT_PRESETS
} from "../defaults";
import { createRoundedBarSeriesPaneView, toRoundedBarSeriesData } from "../renderers/rounded-bars";
import { resolvePriceMode, toCandlestickSeriesData } from "../transforms/candles";
import { getMarketChartHoverSnapshotSignature } from "../transforms/hover";
import { chartTimeToMs } from "../transforms/time";
import type {
  MarketChartApiRefs,
  MarketChartCandle,
  MarketChartExtensionRegistry,
  MarketChartHoverSnapshot,
  MarketChartLowerPaneSeries,
  MarketChartLowerSeries,
  MarketChartMarker,
  MarketChartOverlay,
  MarketChartPriceSeries,
  MarketChartRange,
  MarketChartSettingsState,
  MarketChartThemeOptions
} from "../types";
import { useChartCrosshair } from "./useChartCrosshair";

type UseMarketChartControllerInput = {
  symbol: string;
  intervalMs: number;
  candles: MarketChartCandle[];
  lowerSeries?: MarketChartLowerSeries;
  markers?: MarketChartMarker[];
  overlays?: MarketChartOverlay[];
  settings: MarketChartSettingsState;
  theme?: MarketChartThemeOptions;
  layoutPreset?: string;
  registry?: Partial<MarketChartExtensionRegistry>;
  onVisibleRangeChange?: (range: MarketChartRange | null) => void;
  onMarkerClick?: (marker: MarketChartMarker) => void;
  onCrosshairChange?: Parameters<typeof useChartCrosshair>[0]["onCrosshairChange"];
};

const toSeriesMarker = (marker: MarketChartMarker): SeriesMarker<Time> => ({
  id: marker.id,
  time: marker.time,
  position: marker.position,
  color: marker.color,
  shape: marker.shape,
  text: marker.label
});

const clampRadius = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const useMarketChartController = ({
  symbol,
  intervalMs,
  candles,
  lowerSeries,
  markers = [],
  overlays = [],
  settings,
  theme = DEFAULT_MARKET_CHART_THEME,
  layoutPreset,
  registry,
  onVisibleRangeChange,
  onMarkerClick,
  onCrosshairChange
}: UseMarketChartControllerInput) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<MarketChartPriceSeries | null>(null);
  const lowerSeriesRef = useRef<Map<string, MarketChartLowerPaneSeries>>(new Map());
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markerLookupRef = useRef<Map<string, MarketChartMarker>>(new Map());
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayStateRef = useRef({
    overlays,
    showOverlays: settings.display.showOverlays,
    theme
  });
  const drawOverlaysRef = useRef<() => void>(() => {});
  const visibleRangeRef = useRef(onVisibleRangeChange);
  const markerClickRef = useRef(onMarkerClick);
  const crosshairChangeRef = useRef(onCrosshairChange);
  const fittedScopeRef = useRef<string | null>(null);
  const hoverSnapshotSignatureRef = useRef(getMarketChartHoverSnapshotSignature(null));
  const [hoverSnapshot, setHoverSnapshot] = useState<MarketChartHoverSnapshot | null>(null);
  overlayStateRef.current = {
    overlays,
    showOverlays: settings.display.showOverlays,
    theme
  };
  visibleRangeRef.current = onVisibleRangeChange;
  markerClickRef.current = onMarkerClick;
  crosshairChangeRef.current = onCrosshairChange;

  const layoutPresets = useMemo(() => {
    if (!registry?.layoutPresets?.length) {
      return MARKET_CHART_LAYOUT_PRESETS;
    }
    return [...registry.layoutPresets, ...MARKET_CHART_LAYOUT_PRESETS];
  }, [registry?.layoutPresets]);
  const preset = useMemo(
    () => getMarketChartLayoutPreset(layoutPreset, layoutPresets),
    [layoutPreset, layoutPresets]
  );
  const priceMode = useMemo(
    () => resolvePriceMode(settings.price.rendererId),
    [settings.price.rendererId]
  );
  const priceCandles = useMemo(() => priceMode.transform(candles), [candles, priceMode]);
  const handleCrosshairChange = useCallback((snapshot: MarketChartHoverSnapshot | null) => {
    const nextSignature = getMarketChartHoverSnapshotSignature(snapshot);
    if (nextSignature === hoverSnapshotSignatureRef.current) {
      return;
    }
    hoverSnapshotSignatureRef.current = nextSignature;
    setHoverSnapshot(snapshot);
    crosshairChangeRef.current?.(snapshot);
  }, []);
  const crosshairHandler = useChartCrosshair({
    symbol,
    intervalMs,
    candles: priceCandles,
    lowerSeries,
    overlays,
    markers,
    hoverRows: registry?.hoverRows,
    onCrosshairChange: handleCrosshairChange
  });

  // Chart construction is mount-only. Prop changes flow through the data and option effects below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const width = Math.max(1, Math.floor(container.clientWidth || 600));
    const height = Math.max(1, Math.floor(container.clientHeight || preset.minHeight));
    const chart = createChart(container, {
      ...createMarketChartOptions(theme, settings.display.showGrid),
      width,
      height,
      timeScale: {
        ...createMarketChartOptions(theme, settings.display.showGrid).timeScale,
        secondsVisible: intervalMs < 60_000
      }
    });

    const priceSeries = chart.addSeries(
      LightweightCandlestickSeries,
      createMarketCandlestickSeriesOptions(theme, settings.price.showWicks),
      0
    );
    const markerPlugin = createSeriesMarkers(priceSeries, []);
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCanvas.style.position = "absolute";
    overlayCanvas.style.inset = "0";
    overlayCanvas.style.pointerEvents = "none";
    overlayCanvas.style.zIndex = "2";
    overlayCanvas.style.opacity = "0";
    container.style.position = "relative";
    container.appendChild(overlayCanvas);
    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    markerPluginRef.current = markerPlugin;
    overlayCanvasRef.current = overlayCanvas;
    overlayCtxRef.current = overlayCanvas.getContext("2d");

    drawOverlaysRef.current = () => {
      const canvas = overlayCanvasRef.current;
      const ctx = overlayCtxRef.current;
      const activeChart = chartRef.current;
      const activePriceSeries = priceSeriesRef.current;
      if (!canvas || !ctx || !activeChart || !activePriceSeries) {
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const {
        overlays: activeOverlays,
        showOverlays,
        theme: activeTheme
      } = overlayStateRef.current;
      if (!showOverlays || !activeOverlays?.length) {
        canvas.style.opacity = "0";
        return;
      }

      const points = activeOverlays
        .filter((overlay) => overlay.visible !== false)
        .flatMap((overlay) => overlay.points)
        .filter((point) => typeof point.price === "number" && Number.isFinite(point.price));
      if (points.length === 0) {
        canvas.style.opacity = "0";
        return;
      }

      const sampled = points.length > 1400 ? points.slice(points.length - 1400) : points;
      const maxValue = Math.max(1, ...sampled.map((point) => Math.abs(point.value ?? 1)));
      let drawn = false;

      for (const point of sampled) {
        const x = activeChart.timeScale().timeToCoordinate(point.time);
        const y = activePriceSeries.priceToCoordinate(point.price ?? 0);
        if (x === null || y === null) {
          continue;
        }

        const radius = clampRadius(
          2 + (Math.sqrt(Math.abs(point.value ?? 1)) / Math.sqrt(maxValue)) * 8,
          2,
          10
        );
        const color = point.color ?? activeTheme.tokens.active;
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        drawn = true;
      }

      ctx.globalAlpha = 1;
      canvas.style.opacity = drawn ? "1" : "0";
    };

    const updateVisibleRange = () => {
      const range = chart.timeScale().getVisibleRange();
      if (!range) {
        visibleRangeRef.current?.(null);
        return;
      }
      const from = chartTimeToMs(range.from);
      const to = chartTimeToMs(range.to);
      if (from === null || to === null) {
        visibleRangeRef.current?.(null);
        return;
      }
      visibleRangeRef.current?.({ from: Math.min(from, to), to: Math.max(from, to) });
      drawOverlaysRef.current();
    };

    const clickHandler = (param: {
      hoveredInfo?: { objectId?: unknown };
      hoveredObjectId?: unknown;
    }) => {
      const hovered = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
      if (hovered === null || hovered === undefined) {
        return;
      }
      const marker = markerLookupRef.current.get(String(hovered));
      if (marker) {
        markerClickRef.current?.(marker);
      }
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(updateVisibleRange);
    chart.subscribeCrosshairMove(crosshairHandler);
    chart.subscribeClick(clickHandler);
    updateVisibleRange();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const nextWidth = Math.max(1, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(1, Math.floor(entry.contentRect.height));
      chart.resize(nextWidth, nextHeight);
      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.width = nextWidth;
        overlayCanvasRef.current.height = nextHeight;
      }
      drawOverlaysRef.current();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateVisibleRange);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.unsubscribeClick(clickHandler);
      markerPlugin.detach();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      markerPluginRef.current = null;
      overlayCanvasRef.current?.remove();
      overlayCanvasRef.current = null;
      overlayCtxRef.current = null;
      drawOverlaysRef.current = () => {};
      lowerSeriesRef.current.clear();
    };
  }, [crosshairHandler]);

  useEffect(() => {
    priceSeriesRef.current?.setData(toCandlestickSeriesData(priceCandles));
    const scopeKey = `${symbol}:${intervalMs}`;
    if (priceCandles.length === 0) {
      fittedScopeRef.current = null;
      return;
    }
    if (fittedScopeRef.current === scopeKey) {
      drawOverlaysRef.current();
      return;
    }
    chartRef.current?.timeScale().fitContent();
    fittedScopeRef.current = scopeKey;
    drawOverlaysRef.current();
  }, [intervalMs, priceCandles, symbol]);

  useEffect(() => {
    markerLookupRef.current = new Map(markers.map((marker) => [marker.id, marker]));
    markerPluginRef.current?.setMarkers(
      settings.display.showMarkers ? markers.map(toSeriesMarker) : []
    );
  }, [markers, settings.display.showMarkers]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      ...createMarketChartOptions(theme, settings.display.showGrid),
      timeScale: {
        borderColor: theme.tokens.border,
        timeVisible: true,
        secondsVisible: intervalMs < 60_000
      }
    });
    priceSeriesRef.current?.applyOptions(
      createMarketCandlestickSeriesOptions(theme, settings.price.showWicks)
    );
    drawOverlaysRef.current();
  }, [intervalMs, settings.display.showGrid, settings.price.showWicks, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    if (!settings.lowerPane.visible || !lowerSeries) {
      for (const [, series] of lowerSeriesRef.current.entries()) {
        chart.removeSeries(series);
      }
      lowerSeriesRef.current.clear();
      return;
    }

    const visibleLayers = lowerSeries.layers.filter(
      (layer) =>
        layer.visible !== false &&
        (!settings.lowerPane.activeLayerId || layer.id === settings.lowerPane.activeLayerId)
    );
    const activeLayerIds = new Set(visibleLayers.map((layer) => layer.id));
    for (const [id, series] of lowerSeriesRef.current.entries()) {
      if (!activeLayerIds.has(id)) {
        chart.removeSeries(series);
        lowerSeriesRef.current.delete(id);
      }
    }

    if (visibleLayers.length === 0) {
      return;
    }

    for (const layer of visibleLayers) {
      let series = lowerSeriesRef.current.get(layer.id);
      if (!series) {
        series = chart.addCustomSeries(
          createRoundedBarSeriesPaneView(),
          {
            priceFormat: { type: layer.priceFormat === "volume" ? "volume" : "price" },
            priceScaleId: "",
            color: theme.tokens.lowerNeutral,
            lastValueVisible: false,
            priceLineVisible: false
          },
          1
        );
        lowerSeriesRef.current.set(layer.id, series);
      }
      series.applyOptions({
        priceFormat: { type: layer.priceFormat === "volume" ? "volume" : "price" },
        color: theme.tokens.lowerNeutral,
        lastValueVisible: false,
        priceLineVisible: false
      });
      series.setData(toRoundedBarSeriesData(layer, theme));
    }

    const panes = chart.panes();
    panes[0]?.setStretchFactor(Math.max(1, 1 - preset.lowerPaneRatio));
    panes[1]?.setStretchFactor(Math.max(0.05, preset.lowerPaneRatio));
    drawOverlaysRef.current();
  }, [
    lowerSeries,
    preset.lowerPaneRatio,
    settings.lowerPane.activeLayerId,
    settings.lowerPane.visible,
    theme
  ]);

  useEffect(() => {
    drawOverlaysRef.current();
  }, [overlays, settings.display.showOverlays, theme]);

  const refs: MarketChartApiRefs = {
    chart: chartRef.current,
    priceSeries: priceSeriesRef.current,
    lowerSeries: lowerSeriesRef.current,
    markerPlugin: markerPluginRef.current
  };

  return {
    containerRef,
    refs,
    preset,
    hoverSnapshot
  };
};
