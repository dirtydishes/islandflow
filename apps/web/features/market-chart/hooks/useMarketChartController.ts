"use client";

import {
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  CandlestickSeries as LightweightCandlestickSeries,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import {
  createMarketCandlestickSeriesOptions,
  createMarketChartOptions,
  DEFAULT_MARKET_CHART_THEME,
  getMarketChartLayoutPreset,
  MARKET_CHART_LAYOUT_PRESETS
} from "../defaults";
import { toCandlestickSeriesData } from "../transforms/candles";
import { toLowerPaneHistogramData } from "../transforms/lower-pane";
import { chartTimeToMs } from "../transforms/time";
import type {
  MarketChartApiRefs,
  MarketChartCandle,
  MarketChartExtensionRegistry,
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
  const visibleRangeRef = useRef(onVisibleRangeChange);
  const markerClickRef = useRef(onMarkerClick);
  const fittedScopeRef = useRef<string | null>(null);
  visibleRangeRef.current = onVisibleRangeChange;
  markerClickRef.current = onMarkerClick;

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
  const crosshairHandler = useChartCrosshair({
    symbol,
    intervalMs,
    candles,
    lowerSeries,
    overlays,
    markers,
    hoverRows: registry?.hoverRows,
    onCrosshairChange
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
      createMarketCandlestickSeriesOptions(theme),
      0
    );
    const markerPlugin = createSeriesMarkers(priceSeries, []);
    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    markerPluginRef.current = markerPlugin;

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
      lowerSeriesRef.current.clear();
    };
  }, [crosshairHandler]);

  useEffect(() => {
    priceSeriesRef.current?.setData(toCandlestickSeriesData(candles));
    const scopeKey = `${symbol}:${intervalMs}`;
    if (candles.length === 0) {
      fittedScopeRef.current = null;
      return;
    }
    if (fittedScopeRef.current === scopeKey) {
      return;
    }
    chartRef.current?.timeScale().fitContent();
    fittedScopeRef.current = scopeKey;
  }, [candles, intervalMs, symbol]);

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
    priceSeriesRef.current?.applyOptions(createMarketCandlestickSeriesOptions(theme));
  }, [intervalMs, settings.display.showGrid, theme]);

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

    const visibleLayers = lowerSeries.layers.filter((layer) => layer.visible !== false);
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
        series = chart.addSeries(
          HistogramSeries,
          {
            priceFormat: { type: layer.priceFormat === "volume" ? "volume" : "price" },
            priceScaleId: ""
          },
          1
        );
        lowerSeriesRef.current.set(layer.id, series);
      }
      series.setData(toLowerPaneHistogramData(layer, theme));
    }

    const panes = chart.panes();
    panes[0]?.setStretchFactor(Math.max(1, 1 - preset.lowerPaneRatio));
    panes[1]?.setStretchFactor(Math.max(0.05, preset.lowerPaneRatio));
  }, [lowerSeries, preset.lowerPaneRatio, settings.lowerPane.visible, theme]);

  const refs: MarketChartApiRefs = {
    chart: chartRef.current,
    priceSeries: priceSeriesRef.current,
    lowerSeries: lowerSeriesRef.current,
    markerPlugin: markerPluginRef.current
  };

  return {
    containerRef,
    refs,
    preset
  };
};
