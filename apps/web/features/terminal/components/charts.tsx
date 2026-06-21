"use client";

import type {
  EquityCandle,
  EquityPrint,
  FlowPacket,
  InferredDarkEvent,
  NewsStory,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import { parseOptionContractId } from "@islandflow/types";
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
import Link from "next/link";
import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { getChartFlowMarkerItems } from "../charts/markers";
import { CANDLE_INTERVALS } from "../config";
import { getAlertFlowPacketRefs, getSmartFlowEvidenceRefs } from "../evidence";
import {
  decodeNewsText,
  deriveAlertDirection,
  formatCompactUsd,
  formatOptionContractLabel,
  normalizeAlertSeverity,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  smartMoneyProfileLabel,
  statusLabel
} from "../format";
import type { TerminalState } from "../state";
import { extractUnderlying, normalizeContractId } from "../state-helpers";
import { buildApiUrl, readErrorDetail } from "../transport";
import type { TapeMode, WsStatus } from "../types";
import { getNewsWireStatus, openNewsStory } from "./news";
import { Pane, TapeStatus } from "./primitives";
import {
  type CandlestickSeries,
  chartTimeToMs,
  clamp,
  type EquityOverlayPoint,
  formatConfidence,
  formatContractLabel,
  formatFlowMetric,
  formatIntervalLabel,
  formatPct,
  formatPrice,
  formatSize,
  formatTime,
  humanizeClassifierId,
  normalizeDirection,
  parseNumber,
  sampleToLimit,
  toChartCandle,
  toChartTime
} from "./ui-helpers";

type CandleChartProps = {
  ticker: string;
  intervalMs: number;
  mode: TapeMode;
  replayTime?: number | null;
  liveCandles?: EquityCandle[];
  liveOverlayPrints?: EquityPrint[];
  smartFlowProjections: SmartFlowExplainabilityProjection[];
  smartMoneyEvents: SmartMoneyEvent[];
  inferredDark: InferredDarkEvent[];
  onSmartFlowClick: (projection: SmartFlowExplainabilityProjection) => void;
  onSmartMoneyClick: (event: SmartMoneyEvent) => void;
  onInferredDarkClick: (event: InferredDarkEvent) => void;
};

type MarkerAction =
  | { kind: "smart-flow"; projection: SmartFlowExplainabilityProjection }
  | { kind: "smart-money"; event: SmartMoneyEvent }
  | { kind: "dark"; event: InferredDarkEvent };

export const CandleChart = ({
  ticker,
  intervalMs,
  mode,
  replayTime = null,
  liveCandles = [],
  liveOverlayPrints = [],
  smartFlowProjections,
  smartMoneyEvents,
  inferredDark,
  onSmartFlowClick,
  onSmartMoneyClick,
  onInferredDarkClick
}: CandleChartProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<CandlestickSeries | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const overlaySocketRef = useRef<WebSocket | null>(null);
  const overlayReconnectRef = useRef<number | null>(null);
  const lastCandleRef = useRef<{ time: UTCTimestamp; seq: number } | null>(null);

  const markerLookupRef = useRef<Map<string, MarkerAction>>(new Map());
  const [visibleRangeMs, setVisibleRangeMs] = useState<{ from: number; to: number } | null>(null);
  const onSmartFlowClickRef = useRef(onSmartFlowClick);
  const onSmartMoneyClickRef = useRef(onSmartMoneyClick);
  const onDarkClickRef = useRef(onInferredDarkClick);

  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayDataRef = useRef<EquityOverlayPoint[]>([]);
  const overlayLiveRef = useRef<EquityOverlayPoint[]>([]);
  const overlayLastFetchRef = useRef<{ startTs: number; endTs: number; ticker: string } | null>(
    null
  );
  const overlayFetchAbortRef = useRef<AbortController | null>(null);
  const overlayTimerRef = useRef<number | null>(null);

  const [overlayEnabled, setOverlayEnabled] = useState(true);

  const drawOverlay = useCallback(
    (points: EquityOverlayPoint[]) => {
      const canvas = overlayCanvasRef.current;
      const ctx = overlayCtxRef.current;
      const chart = chartRef.current;
      if (!canvas || !ctx || !chart) {
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!overlayEnabled || points.length === 0) {
        canvas.style.opacity = "0";
        return;
      }

      const timeScale = chart.timeScale();
      if (!seriesRef.current) {
        canvas.style.opacity = "0";
        return;
      }

      const filtered = points.filter((point) => point.offExchangeFlag);
      const sampled = sampleToLimit(filtered, 1400);

      const maxRadius = 10;
      const minRadius = 2;
      const maxSize = Math.max(1, ...sampled.map((point) => point.size));

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(31, 74, 123, 0.55)";
      ctx.strokeStyle = "rgba(31, 74, 123, 0.95)";

      for (const point of sampled) {
        const x = timeScale.timeToCoordinate(toChartTime(point.ts));
        const y = seriesRef.current.priceToCoordinate(point.price);
        if (x === null || y === null) {
          continue;
        }

        const radius = clamp(
          minRadius + (Math.sqrt(point.size) / Math.sqrt(maxSize)) * (maxRadius - minRadius),
          minRadius,
          maxRadius
        );

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      canvas.style.opacity = "1";
    },
    [overlayEnabled]
  );

  useEffect(() => {
    drawOverlay([...overlayDataRef.current, ...overlayLiveRef.current]);
  }, [drawOverlay, ticker, intervalMs, mode]);

  useEffect(() => {
    onSmartFlowClickRef.current = onSmartFlowClick;
  }, [onSmartFlowClick]);

  useEffect(() => {
    onSmartMoneyClickRef.current = onSmartMoneyClick;
  }, [onSmartMoneyClick]);

  useEffect(() => {
    onDarkClickRef.current = onInferredDarkClick;
  }, [onInferredDarkClick]);

  const markerBundle = useMemo(() => {
    const lookup = new Map<string, MarkerAction>();
    const markers: SeriesMarker<UTCTimestamp>[] = [];

    if (!visibleRangeMs) {
      return { markers, lookup };
    }

    const flowMarkerItems = getChartFlowMarkerItems(
      smartFlowProjections,
      smartMoneyEvents,
      visibleRangeMs
    );
    const { from, to } = visibleRangeMs;
    const inRangeDark = inferredDark
      .filter((event) => event.source_ts >= from && event.source_ts <= to)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });

    const MAX_DARK_MARKERS = 120;
    const MAX_TOTAL_MARKERS = 320;

    const cappedDark =
      inRangeDark.length > MAX_DARK_MARKERS
        ? inRangeDark.slice(inRangeDark.length - MAX_DARK_MARKERS)
        : inRangeDark;

    for (const item of flowMarkerItems) {
      if (item.kind === "smart-flow") {
        const { projection } = item;
        const direction = smartFlowDirectionTone(projection);
        const markerId = `smart-flow:${projection.refs.hypothesis_id}:${projection.seq}`;
        lookup.set(markerId, { kind: "smart-flow", projection });

        markers.push({
          id: markerId,
          time: toChartTime(projection.source_ts),
          position: direction === "bullish" ? "belowBar" : "aboveBar",
          color:
            direction === "bullish"
              ? "#25c17a"
              : direction === "bearish"
                ? "#ff6b5f"
                : "rgba(144, 160, 178, 0.9)",
          shape:
            direction === "bullish" ? "arrowUp" : direction === "bearish" ? "arrowDown" : "circle",
          text: projection.abstention.abstained ? "ABS" : "HYP"
        });
        continue;
      }

      const { event } = item;
      const direction = normalizeDirection(event.primary_direction);
      const markerId = `smart-money:${event.trace_id}:${event.seq}`;
      lookup.set(markerId, { kind: "smart-money", event });

      markers.push({
        id: markerId,
        time: toChartTime(event.source_ts),
        position: direction === "bullish" ? "belowBar" : "aboveBar",
        color:
          direction === "bullish"
            ? "#2f6d4f"
            : direction === "bearish"
              ? "#c46f2a"
              : "rgba(111, 91, 57, 0.9)",
        shape:
          direction === "bullish" ? "arrowUp" : direction === "bearish" ? "arrowDown" : "circle",
        text: event.abstained
          ? "ABS"
          : event.primary_profile_id
            ? event.primary_profile_id.slice(0, 3).toUpperCase()
            : "SM"
      });
    }

    for (const event of cappedDark) {
      const markerId = `dark:${event.trace_id}:${event.seq}`;
      lookup.set(markerId, { kind: "dark", event });
      markers.push({
        id: markerId,
        time: toChartTime(event.source_ts),
        position: "aboveBar",
        color: "rgba(31, 74, 123, 0.9)",
        shape: "square",
        text: "D"
      });
    }

    markers.sort((a, b) => {
      const delta = Number(a.time) - Number(b.time);
      if (delta !== 0) {
        return delta;
      }
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });

    const cappedMarkers =
      markers.length > MAX_TOTAL_MARKERS
        ? markers.slice(markers.length - MAX_TOTAL_MARKERS)
        : markers;

    if (cappedMarkers !== markers) {
      const nextLookup = new Map<string, MarkerAction>();
      for (const marker of cappedMarkers) {
        const id = marker.id;
        if (typeof id !== "string") {
          continue;
        }
        const action = lookup.get(id);
        if (action) {
          nextLookup.set(id, action);
        }
      }
      return { markers: cappedMarkers, lookup: nextLookup };
    }

    return { markers: cappedMarkers, lookup };
  }, [smartFlowProjections, smartMoneyEvents, inferredDark, visibleRangeMs]);

  useEffect(() => {
    if (!seriesRef.current) {
      return;
    }
    markerLookupRef.current = markerBundle.lookup;
    markerPluginRef.current?.setMarkers(markerBundle.markers);
  }, [markerBundle]);

  const replayBucket = useMemo(() => {
    if (mode !== "replay" || replayTime === null) {
      return null;
    }
    return Math.floor(replayTime / intervalMs);
  }, [mode, replayTime, intervalMs]);
  const replayEndTs = useMemo(() => {
    if (replayBucket === null) {
      return null;
    }
    return (replayBucket + 1) * intervalMs - 1;
  }, [replayBucket, intervalMs]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<WsStatus>(mode === "live" ? "connecting" : "connected");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [hasData, setHasData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 360;
    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: "#0d141b" },
        textColor: "#90a0b2"
      },
      grid: {
        vertLines: { color: "rgba(144, 160, 178, 0.12)" },
        horzLines: { color: "rgba(144, 160, 178, 0.12)" }
      },
      crosshair: {
        vertLine: { color: "rgba(245, 166, 35, 0.32)" },
        horzLine: { color: "rgba(245, 166, 35, 0.32)" }
      },
      timeScale: {
        borderColor: "rgba(144, 160, 178, 0.24)",
        timeVisible: true,
        secondsVisible: intervalMs < 60000
      },
      rightPriceScale: {
        borderColor: "rgba(144, 160, 178, 0.24)"
      }
    });

    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = Math.max(1, Math.floor(width));
    overlayCanvas.height = Math.max(1, Math.floor(height));
    overlayCanvas.style.position = "absolute";
    overlayCanvas.style.inset = "0";
    overlayCanvas.style.pointerEvents = "none";
    overlayCanvas.style.zIndex = "2";
    overlayCanvas.style.opacity = "0";
    container.style.position = "relative";
    container.appendChild(overlayCanvas);
    overlayCanvasRef.current = overlayCanvas;
    overlayCtxRef.current = overlayCanvas.getContext("2d");

    const series = chart.addSeries(LightweightCandlestickSeries, {
      upColor: "#25c17a",
      downColor: "#ff6b5f",
      borderVisible: false,
      wickUpColor: "#25c17a",
      wickDownColor: "#ff6b5f"
    });
    const markerPlugin = createSeriesMarkers(series, []);

    chartRef.current = chart;
    seriesRef.current = series;
    markerPluginRef.current = markerPlugin;
    setReady(true);

    const timeScale = chart.timeScale();
    const updateVisibleRange = () => {
      const range = timeScale.getVisibleRange();
      if (!range) {
        setVisibleRangeMs(null);
        return;
      }
      const from = chartTimeToMs(range.from);
      const to = chartTimeToMs(range.to);
      if (from === null || to === null) {
        setVisibleRangeMs(null);
        return;
      }

      setVisibleRangeMs({
        from: Math.min(from, to),
        to: Math.max(from, to)
      });
    };

    const clickHandler = (param: {
      hoveredInfo?: { objectId?: unknown };
      hoveredObjectId?: unknown;
    }) => {
      const hovered = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
      if (hovered === null || hovered === undefined) {
        return;
      }
      const key = typeof hovered === "string" ? hovered : String(hovered);
      const action = markerLookupRef.current.get(key);
      if (!action) {
        return;
      }
      if (action.kind === "smart-flow") {
        onSmartFlowClickRef.current(action.projection);
      } else if (action.kind === "smart-money") {
        onSmartMoneyClickRef.current(action.event);
      } else {
        onDarkClickRef.current(action.event);
      }
    };

    updateVisibleRange();
    timeScale.subscribeVisibleTimeRangeChange(updateVisibleRange);
    chart.subscribeClick(clickHandler);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width: nextWidth, height: nextHeight } = entry.contentRect;
      if (Number.isFinite(nextWidth) && Number.isFinite(nextHeight)) {
        const nextW = Math.max(1, Math.floor(nextWidth));
        const nextH = Math.max(1, Math.floor(nextHeight));
        chart.resize(nextW, nextH);

        const canvas = overlayCanvasRef.current;
        if (canvas) {
          canvas.width = nextW;
          canvas.height = nextH;
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      timeScale.unsubscribeVisibleTimeRangeChange(updateVisibleRange);
      chart.unsubscribeClick(clickHandler);
      markerPlugin.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markerPluginRef.current = null;
      overlayCtxRef.current = null;
      overlayCanvasRef.current?.remove();
      overlayCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !seriesRef.current) {
      return;
    }

    if (mode === "replay" && replayBucket === null) {
      setError(null);
      setHasData(false);
      setLastUpdate(null);
      lastCandleRef.current = null;
      seriesRef.current.setData([]);
      overlayDataRef.current = [];
      overlayLiveRef.current = [];
      overlayLastFetchRef.current = null;
      setStatus("connected");
      return;
    }

    let active = true;
    setError(null);
    setHasData(false);
    setLastUpdate(null);
    lastCandleRef.current = null;
    seriesRef.current.setData([]);
    overlayDataRef.current = [];
    overlayLiveRef.current = [];
    overlayLastFetchRef.current = null;
    setStatus(mode === "live" ? "connecting" : "connected");

    const fetchCandles = async () => {
      try {
        const url = new URL(buildApiUrl("/candles/equities"));
        url.searchParams.set("underlying_id", ticker);
        url.searchParams.set("interval_ms", intervalMs.toString());
        url.searchParams.set("limit", "300");
        url.searchParams.set("cache", "1");
        if (mode === "replay" && replayEndTs !== null) {
          url.searchParams.set("end_ts", replayEndTs.toString());
        }
        const response = await fetch(url.toString());
        if (!response.ok) {
          const detail = await readErrorDetail(response);
          throw new Error(`Candle fetch failed (${response.status})${detail ? `: ${detail}` : ""}`);
        }
        const payload = (await response.json()) as { data?: EquityCandle[] };
        if (!active || !seriesRef.current) {
          return;
        }
        const sorted = [...(payload.data ?? [])].sort((a, b) => {
          if (a.ts !== b.ts) {
            return a.ts - b.ts;
          }
          return a.seq - b.seq;
        });
        const chartData = sorted.map(toChartCandle);
        seriesRef.current.setData(chartData);
        chartRef.current?.timeScale().fitContent();
        drawOverlay([...overlayDataRef.current, ...overlayLiveRef.current]);

        if (sorted.length > 0) {
          const last = sorted[sorted.length - 1];
          lastCandleRef.current = { time: toChartTime(last.ts), seq: last.seq };
          setHasData(true);
          setLastUpdate(last.ingest_ts ?? last.ts);
        }
      } catch (error) {
        if (!active) {
          return;
        }
        setError(error instanceof Error ? error.message : String(error));
        setStatus("disconnected");
        setHasData(false);
      }
    };

    const ensureOverlayListener = () => {
      if (!chartRef.current) {
        return;
      }

      const handler = () => {
        const combined = [...overlayDataRef.current, ...overlayLiveRef.current];
        drawOverlay(combined);
        scheduleOverlayFetch();
      };

      chartRef.current.timeScale().subscribeVisibleTimeRangeChange(handler);
      return () => {
        chartRef.current?.timeScale().unsubscribeVisibleTimeRangeChange(handler);
      };
    };

    const cancelOverlayFetch = () => {
      if (overlayFetchAbortRef.current) {
        overlayFetchAbortRef.current.abort();
        overlayFetchAbortRef.current = null;
      }
    };

    const fetchOverlayRange = async (startTs: number, endTs: number) => {
      cancelOverlayFetch();
      const abort = new AbortController();
      overlayFetchAbortRef.current = abort;

      const url = new URL(buildApiUrl("/prints/equities/range"));
      url.searchParams.set("underlying_id", ticker);
      url.searchParams.set("start_ts", Math.floor(startTs).toString());
      url.searchParams.set("end_ts", Math.floor(endTs).toString());
      url.searchParams.set("limit", "1000");

      const response = await fetch(url.toString(), { signal: abort.signal });
      if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(
          `Equity range fetch failed (${response.status})${detail ? `: ${detail}` : ""}`
        );
      }

      const payload = (await response.json()) as { data?: EquityPrint[] };
      const prints = payload.data ?? [];
      overlayDataRef.current = prints.map((print) => ({
        ts: print.ts,
        price: print.price,
        size: print.size,
        offExchangeFlag: print.offExchangeFlag
      }));
      overlayLiveRef.current = [];
      overlayLastFetchRef.current = { startTs, endTs, ticker };
    };

    function scheduleOverlayFetch() {
      if (overlayTimerRef.current !== null) {
        window.clearTimeout(overlayTimerRef.current);
      }

      overlayTimerRef.current = window.setTimeout(() => {
        if (!active || !chartRef.current || !seriesRef.current) {
          return;
        }

        const timeScale = chartRef.current.timeScale();
        const range = timeScale.getVisibleRange();
        if (!range) {
          return;
        }

        const startTs = chartTimeToMs(range.from);
        const endTs = chartTimeToMs(range.to);
        if (startTs === null || endTs === null) {
          return;
        }
        const last = overlayLastFetchRef.current;

        const needsFetch =
          !last ||
          last.ticker !== ticker ||
          startTs < last.startTs ||
          endTs > last.endTs ||
          Math.abs(endTs - last.endTs) > intervalMs * 6;

        if (!needsFetch) {
          return;
        }

        void fetchOverlayRange(startTs, endTs)
          .then(() => {
            drawOverlay([...overlayDataRef.current, ...overlayLiveRef.current]);
          })
          .catch((error) => {
            if (!active) {
              return;
            }
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            console.warn("Overlay fetch failed", error);
          });
      }, 180);
    }

    const overlayUnsubscribe = ensureOverlayListener();
    scheduleOverlayFetch();

    void fetchCandles();

    return () => {
      active = false;
      cancelOverlayFetch();
      if (overlayTimerRef.current !== null) {
        window.clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      overlayUnsubscribe?.();
    };
  }, [ready, ticker, intervalMs, mode, replayBucket, replayEndTs]);

  useEffect(() => {
    if (!ready || mode !== "live" || !seriesRef.current) {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }

      if (overlaySocketRef.current) {
        overlaySocketRef.current.close();
      }
      if (overlayReconnectRef.current !== null) {
        window.clearTimeout(overlayReconnectRef.current);
        overlayReconnectRef.current = null;
      }

      return;
    }

    if (mode !== "live" || !seriesRef.current) {
      return;
    }

    const sortedCandles = [...liveCandles].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    if (sortedCandles.length > 0) {
      seriesRef.current.setData(sortedCandles.map(toChartCandle));
      const last = sortedCandles.at(-1);
      if (last) {
        lastCandleRef.current = { time: toChartTime(last.ts), seq: last.seq };
        setHasData(true);
        setLastUpdate(last.ingest_ts ?? last.ts);
        setStatus("connected");
      }
    }

    overlayLiveRef.current = liveOverlayPrints.map((print) => ({
      ts: print.ts,
      price: print.price,
      size: print.size,
      offExchangeFlag: print.offExchangeFlag
    }));
    drawOverlay([...overlayDataRef.current, ...overlayLiveRef.current]);
  }, [ready, mode, liveCandles, liveOverlayPrints, drawOverlay]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    chartRef.current.timeScale().applyOptions({
      timeVisible: true,
      secondsVisible: intervalMs < 60000
    });
  }, [intervalMs]);

  const statusText = statusLabel(status, false, mode);
  const intervalLabel = formatIntervalLabel(intervalMs);
  const emptyLabel =
    mode === "live"
      ? status === "connected"
        ? `No candles yet. First ${intervalLabel} candle appears after the window closes.`
        : "Chart offline. Start candles service."
      : "No candles for this replay window.";

  return (
    <div className="chart-panel">
      <div className="chart-meta">
        <div className={`chart-status chart-status-${status}`}>
          <span className="chart-dot" />
          <span>{statusText}</span>
        </div>
        <span className="chart-meta-time">
          {lastUpdate ? `Updated ${formatTime(lastUpdate)}` : "Waiting for data"}
        </span>
        <button
          className={`overlay-toggle${overlayEnabled ? " overlay-toggle-on" : ""}`}
          type="button"
          onClick={() => setOverlayEnabled((prev) => !prev)}
        >
          Off-Ex {overlayEnabled ? "On" : "Off"}
        </button>
        <span className="overlay-legend">Blue circles = off-exchange trades</span>
      </div>
      <div className="chart-surface" ref={containerRef} />
      {error ? (
        <div className="empty chart-empty">Chart error: {error}</div>
      ) : !hasData ? (
        <div className="empty chart-empty">{emptyLabel}</div>
      ) : null}
    </div>
  );
};

type ChartPaneProps = {
  state: TerminalState;
  title?: string;
};

export const ChartPane = memo(({ state, title = "Chart" }: ChartPaneProps) => {
  return (
    <Pane
      title={title}
      actions={
        <div className="chart-controls">
          <div className="chart-intervals">
            {CANDLE_INTERVALS.map((interval) => (
              <button
                key={interval.ms}
                className={`interval-button${interval.ms === state.chartIntervalMs ? " active" : ""}`}
                type="button"
                onClick={() => state.setChartIntervalMs(interval.ms)}
              >
                {interval.label}
              </button>
            ))}
          </div>
          <span className="chart-hint">{state.chartTicker}</span>
        </div>
      }
    >
      <CandleChart
        ticker={state.chartTicker}
        intervalMs={state.chartIntervalMs}
        mode={state.mode}
        replayTime={state.equities.replayTime}
        liveCandles={state.liveSession.chartCandles}
        liveOverlayPrints={state.liveSession.chartOverlay}
        smartFlowProjections={state.chartSmartFlowProjections}
        smartMoneyEvents={state.chartSmartMoneyEvents}
        inferredDark={state.chartInferredDark}
        onSmartFlowClick={state.handleSmartFlowMarkerClick}
        onSmartMoneyClick={state.handleSmartMoneyMarkerClick}
        onInferredDarkClick={state.handleDarkMarkerClick}
      />
    </Pane>
  );
});

type CommandDeckTicker = {
  symbol: string;
  price: number | null;
  move: number | null;
  options: number;
  alerts: number;
};

const buildCommandDeckTickers = (state: TerminalState): CommandDeckTicker[] => {
  const symbols = new Set<string>();
  for (const symbol of state.activeTickers) {
    symbols.add(symbol);
  }
  for (const print of state.filteredEquities.slice(0, 80)) {
    symbols.add(print.underlying_id.toUpperCase());
  }
  for (const print of state.filteredOptions.slice(0, 80)) {
    const parsed = parseOptionContractId(normalizeContractId(print.option_contract_id));
    const symbol = (
      print.underlying_id ??
      parsed?.root ??
      extractUnderlying(print.option_contract_id)
    )?.toUpperCase();
    if (symbol) {
      symbols.add(symbol);
    }
  }
  for (const projection of state.filteredSmartFlowProjections.slice(0, 30)) {
    symbols.add(projection.hypothesis.underlying_id.toUpperCase());
  }
  if (state.filteredSmartFlowProjections.length === 0) {
    for (const event of state.filteredSmartMoneyEvents.slice(0, 30)) {
      symbols.add(event.underlying_id.toUpperCase());
    }
  }
  for (const story of state.filteredNews.slice(0, 20)) {
    for (const symbol of story.resolved_symbols) {
      symbols.add(symbol.toUpperCase());
    }
  }
  if (symbols.size === 0) {
    symbols.add(state.chartTicker.toUpperCase());
  }

  return Array.from(symbols)
    .slice(0, 10)
    .map((symbol) => {
      const equityPrints = state.filteredEquities
        .filter((print) => print.underlying_id.toUpperCase() === symbol)
        .slice(0, 2);
      const price = equityPrints[0]?.price ?? null;
      const previous = equityPrints[1]?.price ?? null;
      const move =
        price !== null && previous !== null && previous !== 0
          ? (price - previous) / previous
          : null;
      const options = state.filteredOptions.slice(0, 120).filter((print) => {
        const parsed = parseOptionContractId(normalizeContractId(print.option_contract_id));
        const underlying = (
          print.underlying_id ??
          parsed?.root ??
          extractUnderlying(print.option_contract_id)
        )?.toUpperCase();
        return underlying === symbol;
      }).length;
      const alerts = state.filteredAlerts
        .slice(0, 80)
        .filter((alert) => alert.trace_id.toUpperCase().includes(symbol)).length;
      return { symbol, price, move, options, alerts };
    });
};

type CommandPriorityState = "confirm" | "watch" | "hold" | "reject" | "info";

type CommandPriorityRow = {
  key: string;
  ts: number;
  symbol: string;
  packet: string;
  read: string;
  score: number;
  invalidation: string;
  state: CommandPriorityState;
  onOpen: () => void;
};

const clampCommandScore = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
};

const commandStateFromDirection = (direction: string): CommandPriorityState => {
  const normalized = normalizeDirection(direction);
  if (normalized === "bullish") {
    return "confirm";
  }
  if (normalized === "bearish") {
    return "reject";
  }
  return "watch";
};

const inferCommandSymbolFromTrace = (traceId: string): string | null => {
  const token = traceId
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .find((part) => /^[A-Z]{1,6}$/.test(part) && !["ALERT", "FLOW", "SMART"].includes(part));
  return token ?? null;
};

const buildCommandPriorityRows = (state: TerminalState): CommandPriorityRow[] => {
  const rows: CommandPriorityRow[] = [];

  for (const projection of state.filteredSmartFlowProjections.slice(0, 8)) {
    const hypothesis = projection.hypothesis;
    const confidence = hypothesis.scores.confidence;
    const evidenceRefs = getSmartFlowEvidenceRefs(projection);
    rows.push({
      key: `smart-flow-${projection.refs.hypothesis_id}-${projection.seq}`,
      ts: projection.source_ts,
      symbol: hypothesis.underlying_id.toUpperCase(),
      packet: projection.refs.cluster_id,
      read: smartFlowHypothesisLabel(hypothesis.hypothesis_type),
      score: clampCommandScore(confidence.policy_confidence * 100),
      invalidation: projection.abstention.abstained
        ? smartFlowWhyNotLabel(projection)
        : `${evidenceRefs.length} refs / ${smartFlowEvidenceQualityLabel(projection.evidence.evidence_quality)}`,
      state: projection.abstention.abstained
        ? "hold"
        : commandStateFromDirection(hypothesis.direction),
      onOpen: () => state.openFromSmartFlowProjection(projection)
    });
  }

  if (state.filteredSmartFlowProjections.length === 0) {
    for (const event of state.filteredSmartMoneyEvents.slice(0, 8)) {
      const primaryScore =
        event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
        event.profile_scores[0];
      const read =
        primaryScore?.reasons[0] ??
        (event.primary_profile_id
          ? smartMoneyProfileLabel(event.primary_profile_id)
          : event.event_kind);
      rows.push({
        key: `smart-${event.event_id}-${event.seq}`,
        ts: event.source_ts,
        symbol: event.underlying_id.toUpperCase(),
        packet: event.packet_ids[0] ?? event.event_id,
        read,
        score: clampCommandScore((primaryScore?.probability ?? 0) * 100),
        invalidation:
          event.packet_ids.length > 0
            ? `${event.packet_ids.length} packet${event.packet_ids.length === 1 ? "" : "s"}`
            : `${formatFlowMetric(event.features.print_count)} prints`,
        state: event.abstained ? "hold" : commandStateFromDirection(event.primary_direction),
        onOpen: () => state.openFromSmartMoneyEvent(event)
      });
    }
  }

  for (const alert of state.filteredAlerts.slice(0, 8)) {
    const primary = alert.hits[0];
    const direction = deriveAlertDirection(alert);
    const severity = normalizeAlertSeverity(alert);
    rows.push({
      key: `alert-${alert.trace_id}-${alert.seq}`,
      ts: alert.source_ts,
      symbol: inferCommandSymbolFromTrace(alert.trace_id) ?? "ALERT",
      packet: getAlertFlowPacketRefs(alert)[0] ?? alert.trace_id,
      read: primary?.explanations?.[0] ?? primary?.classifier_id ?? "Classifier alert",
      score: clampCommandScore(alert.score),
      invalidation: `${alert.evidence_refs.length} refs`,
      state:
        severity === "high"
          ? commandStateFromDirection(direction)
          : severity === "medium"
            ? "watch"
            : "hold",
      onOpen: () => {
        state.setSelectedNewsStory(null);
        state.setSelectedDarkEvent(null);
        state.setSelectedClassifierHit(null);
        state.setSelectedSmartFlowProjection(null);
        state.setSelectedSmartMoneyEvent(null);
        state.setSelectedAlert(alert);
      }
    });
  }

  for (const packet of state.filteredFlow.slice(0, 6)) {
    const contract = String(packet.features.option_contract_id ?? packet.id);
    const symbol = extractUnderlying(contract);
    const notional = parseNumber(packet.features.total_notional, 0);
    rows.push({
      key: `flow-${packet.id}-${packet.seq}`,
      ts: packet.source_ts,
      symbol,
      packet: packet.id,
      read:
        typeof packet.features.structure_type === "string"
          ? packet.features.structure_type.replace(/_/g, " ")
          : "Flow packet",
      score: clampCommandScore(parseNumber(packet.join_quality.nbbo_coverage_ratio, 0) * 100),
      invalidation: notional > 0 ? `$${formatCompactUsd(notional)}` : "packet fit",
      state: "watch",
      onOpen: () => state.setFilterInput(symbol)
    });
  }

  for (const story of state.filteredNews.slice(0, 4)) {
    rows.push({
      key: `news-${story.trace_id}-${story.seq}`,
      ts: story.published_ts,
      symbol: story.resolved_symbols[0]?.toUpperCase() ?? "WIRE",
      packet: story.source,
      read: decodeNewsText(story.headline),
      score: story.resolved_symbols.length > 0 ? 55 : 25,
      invalidation: getNewsWireStatus(story),
      state: "info",
      onOpen: () => openNewsStory(state, story)
    });
  }

  return rows.sort((a, b) => b.ts - a.ts).slice(0, 8);
};

export const CommandMetricsStrip = ({ state }: { state: TerminalState }) => {
  const priorityCount =
    state.filteredSmartFlowProjections.length +
    state.filteredAlerts.length +
    state.filteredFlow.length;
  const focus = state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "All symbols";
  const decision =
    state.selectedInstrument?.kind === "option-contract"
      ? (state.selectedInstrumentLabel ?? "Contract focus")
      : `${state.chartTicker.toUpperCase()} / ${formatIntervalLabel(state.chartIntervalMs)}`;
  const risk =
    state.filteredAlerts[0]?.severity ??
    (state.filteredInferredDark.length > 0 ? "dark context" : "no active alert");
  const metrics = [
    {
      label: "Regime",
      value:
        state.mode === "live" ? statusLabel(state.liveSession.status, false, state.mode) : "Replay",
      detail: state.lastSeen ? `last ${formatTime(state.lastSeen)}` : "waiting"
    },
    {
      label: "Priority",
      value: `${formatFlowMetric(priorityCount)} events`,
      detail: focus
    },
    {
      label: "Decision",
      value: decision,
      detail: state.selectedInstrument ? "focused instrument" : "chart context"
    },
    {
      label: "Risk",
      value: risk,
      detail: `${state.filteredNews.length} wire / ${state.filteredInferredDark.length} dark`
    }
  ];

  return (
    <section className="command-metric-strip" aria-label="Session command metrics">
      {metrics.map((metric) => (
        <div className="command-metric-cell" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <em>{metric.detail}</em>
        </div>
      ))}
    </section>
  );
};

export const CommandPriorityBoard = ({ state }: { state: TerminalState }) => {
  const rows = useMemo(() => buildCommandPriorityRows(state), [state]);

  return (
    <Pane
      className="command-priority-pane"
      title="Priority Board"
      status={<span className="command-pane-meta">{rows.length} active rows</span>}
    >
      {rows.length === 0 ? (
        <div className="empty">No priority events are available for this scope yet.</div>
      ) : (
        <div className="command-priority-table" role="table" aria-label="Priority board">
          <div className="command-priority-row is-head" role="row">
            {["Time", "Sym", "Packet", "Read", "Score", "Decision", "State"].map((label) => (
              <span role="columnheader" key={label}>
                {label}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <button
              className={`command-priority-row is-${row.state}`}
              key={row.key}
              type="button"
              onClick={row.onOpen}
            >
              <time>{formatTime(row.ts)}</time>
              <strong>{row.symbol}</strong>
              <span>{row.packet}</span>
              <span>{row.read}</span>
              <span
                className="command-score-meter"
                style={{ "--score": `${row.score}%` } as CSSProperties}
              >
                <i />
                <em>{row.score}</em>
              </span>
              <span>{row.invalidation}</span>
              <span className={`command-state command-state-${row.state}`}>{row.state}</span>
            </button>
          ))}
        </div>
      )}
    </Pane>
  );
};

export const CommandDecisionLevels = ({ state }: { state: TerminalState }) => {
  const topOption = state.filteredOptions[0];
  const topOptionLabel = topOption
    ? (formatOptionContractLabel(normalizeContractId(topOption.option_contract_id))?.strike ??
      formatContractLabel(topOption.option_contract_id))
    : "--";
  const topAlert = state.filteredAlerts[0];
  const topDark = state.filteredInferredDark[0];
  const rows = [
    ["Focus", state.activeTickers.length > 0 ? state.activeTickers.join(", ") : state.chartTicker],
    ["Contract", state.selectedInstrumentLabel ?? topOptionLabel],
    ["Chart", `${state.chartTicker.toUpperCase()} ${formatIntervalLabel(state.chartIntervalMs)}`],
    [
      "Evidence",
      topAlert
        ? `${normalizeAlertSeverity(topAlert)} alert at ${formatTime(topAlert.source_ts)}`
        : topDark
          ? `${humanizeClassifierId(topDark.type)} ${formatConfidence(topDark.confidence)}`
          : "waiting"
    ]
  ];

  return (
    <Pane
      className="command-levels-pane"
      title="Decision Levels"
      status={<span className="command-pane-meta">current scope</span>}
    >
      <dl className="command-level-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Pane>
  );
};

export const CommandDeckHeader = ({ state }: { state: TerminalState }) => {
  const focus = state.activeTickers.length > 0 ? state.activeTickers.join(", ") : state.chartTicker;
  const activeTickerFilter = state.filterInput.trim();
  const activeContractFilter =
    state.selectedInstrument?.kind === "option-contract" ? state.selectedInstrumentLabel : null;
  const connectionLabel =
    state.mode === "live" ? statusLabel(state.liveSession.status, false, state.mode) : "Replay";

  return (
    <header className="command-deck-header compact-command-bar" aria-label="Command deck context">
      <div className="compact-command-topline">
        <div className="compact-command-title">
          <span>islandflow</span>
          <strong>Market Command</strong>
        </div>
        <div className="compact-command-controls" aria-label="Active command deck controls">
          <span className={`command-chip command-chip-${state.liveSession.status}`}>
            {state.mode === "live" ? "Live" : "Replay"}: {connectionLabel}
          </span>
          <span className="command-chip">
            Last {state.lastSeen ? formatTime(state.lastSeen) : "waiting"}
          </span>
          <button className="terminal-button" type="button" onClick={state.toggleMode}>
            {state.mode === "live" ? "Switch to Replay" : "Switch to Live"}
          </button>
        </div>
      </div>
      <div className="compact-command-context">
        <span>Evidence console</span>
        <strong>{focus}</strong>
        {activeContractFilter ? (
          <span className="command-filter-tooltip">
            <span>{activeContractFilter}</span>
            <button
              aria-label="Clear contract filter"
              type="button"
              onClick={() => state.setSelectedInstrument(null)}
            >
              X
            </button>
          </span>
        ) : activeTickerFilter.length > 0 ? (
          <span className="command-filter-tooltip">
            <span>Ticker: {activeTickerFilter}</span>
            <button
              aria-label="Clear ticker filter"
              type="button"
              onClick={() => state.setFilterInput("")}
            >
              X
            </button>
          </span>
        ) : (
          <span>No active filter</span>
        )}
      </div>
    </header>
  );
};

export const CommandSymbolRail = ({ state }: { state: TerminalState }) => {
  const tickers = useMemo(() => buildCommandDeckTickers(state), [state]);

  return (
    <div className="command-symbol-rail" aria-label="Live ticker focus rail">
      <div className="command-symbol-track">
        {tickers.map((ticker) => {
          const direction = ticker.move === null ? "flat" : ticker.move >= 0 ? "up" : "down";
          const equity = state.filteredEquities.find(
            (print) => print.underlying_id.toUpperCase() === ticker.symbol
          );
          return (
            <button
              className={`command-symbol-row is-${direction}`}
              key={ticker.symbol}
              type="button"
              onClick={() =>
                equity ? state.focusEquityTicker(equity) : state.setFilterInput(ticker.symbol)
              }
            >
              <span className="command-symbol-name">{ticker.symbol}</span>
              <span className="command-symbol-price">
                {ticker.price === null ? "--" : `$${formatPrice(ticker.price)}`}
              </span>
              <span className="command-symbol-move">
                {ticker.move === null
                  ? "Move n/a"
                  : `${direction === "up" ? "Up" : "Down"} ${formatPct(Math.abs(ticker.move))}`}
              </span>
              <span className="command-symbol-meta">
                {ticker.options} opt / {ticker.alerts} alerts
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const FeedHealthPane = ({ state }: { state: TerminalState }) => {
  const rows = [
    { label: "Options", tape: state.options, subscribed: state.routeFeatures.options },
    { label: "Equities", tape: state.equities, subscribed: state.routeFeatures.equities },
    { label: "Flow", tape: state.flow, subscribed: state.routeFeatures.flow },
    { label: "Alerts", tape: state.alerts, subscribed: state.routeFeatures.alerts },
    { label: "News", tape: state.news, subscribed: state.routeFeatures.news },
    { label: "Dark", tape: state.inferredDark, subscribed: state.routeFeatures.inferredDark }
  ];

  return (
    <Pane
      className="command-feed-pane"
      title="Feed Health"
      status={
        <span className="command-pane-meta">{state.liveSession.manifest.length} subscriptions</span>
      }
    >
      <div className="command-health-list">
        {rows.map(({ label, tape, subscribed }) => (
          <div className="command-health-row" key={label}>
            <span>{label}</span>
            <span className={`command-health-status command-health-${tape.status}`}>
              {subscribed ? statusLabel(tape.status, tape.paused, state.mode) : "Idle"}
            </span>
            <span>{tape.lastUpdate ? formatTime(tape.lastUpdate) : "No update"}</span>
            <span>{tape.dropped > 0 ? `${tape.dropped} dropped` : "Queue clear"}</span>
          </div>
        ))}
      </div>
    </Pane>
  );
};

export const EventContextPane = ({ state }: { state: TerminalState }) => {
  const events = [
    ...state.filteredAlerts.slice(0, 3).map((alert) => ({
      key: `alert-${alert.trace_id}-${alert.seq}`,
      ts: alert.source_ts,
      label: "Alert",
      title: alert.hits[0] ? humanizeClassifierId(alert.hits[0].classifier_id) : "Classifier alert",
      detail: alert.hits[0]?.explanations?.[0] ?? `${alert.hits.length} linked hits`,
      action: () => {
        state.setSelectedSmartFlowProjection(null);
        state.setSelectedAlert(alert);
      }
    })),
    ...state.filteredSmartFlowProjections.slice(0, 3).map((projection) => ({
      key: `smart-flow-${projection.refs.hypothesis_id}-${projection.seq}`,
      ts: projection.source_ts,
      label: "Hypothesis",
      title: smartFlowHypothesisLabel(projection.hypothesis.hypothesis_type),
      detail: `${projection.hypothesis.underlying_id} ${normalizeDirection(projection.hypothesis.direction)} / ${formatConfidence(projection.hypothesis.scores.confidence.policy_confidence)} confidence`,
      action: () => state.openFromSmartFlowProjection(projection)
    })),
    ...state.filteredInferredDark.slice(0, 3).map((event) => ({
      key: `dark-${event.trace_id}-${event.seq}`,
      ts: event.source_ts,
      label: "Dark",
      title: humanizeClassifierId(event.type),
      detail: `${event.evidence_refs.length} evidence refs / confidence ${formatConfidence(event.confidence)}`,
      action: () => {
        state.setSelectedSmartFlowProjection(null);
        state.setSelectedDarkEvent(event);
      }
    })),
    ...state.filteredNews.slice(0, 2).map((story) => ({
      key: `news-${story.trace_id}-${story.seq}`,
      ts: story.published_ts,
      label: "News",
      title: decodeNewsText(story.headline),
      detail: story.resolved_symbols.length > 0 ? story.resolved_symbols.join(", ") : story.source,
      action: () => openNewsStory(state, story)
    }))
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);

  return (
    <Pane
      className="command-context-pane"
      title="Event Context"
      status={<span className="command-pane-meta">Focus evidence</span>}
    >
      {events.length === 0 ? (
        <div className="empty">No linked evidence is available for this scope yet.</div>
      ) : (
        <div className="command-context-list" role="list">
          {events.map((event) => (
            <button
              className="command-context-row"
              key={event.key}
              type="button"
              onClick={event.action}
            >
              <time>{formatTime(event.ts)}</time>
              <span className="command-context-kind">{event.label}</span>
              <strong>{event.title}</strong>
              <span>{event.detail}</span>
            </button>
          ))}
        </div>
      )}
    </Pane>
  );
};

export const HomeReplayRail = ({ state }: { state: TerminalState }) => {
  const replayTime =
    state.options.replayTime ??
    state.equities.replayTime ??
    state.flow.replayTime ??
    state.alerts.replayTime ??
    state.inferredDark.replayTime;
  const replayComplete =
    state.options.replayComplete ||
    state.equities.replayComplete ||
    state.flow.replayComplete ||
    state.alerts.replayComplete ||
    state.inferredDark.replayComplete;
  const activeSource = state.replaySource
    ? state.replaySource.toUpperCase()
    : state.mode === "live"
      ? "LIVE HEAD"
      : "AUTO";

  return (
    <Pane
      className="command-replay-pane"
      title="Replay / Mode"
      status={
        <TapeStatus
          status={state.mode === "live" ? state.liveSession.status : state.options.status}
          lastUpdate={state.lastSeen}
          replayTime={replayTime}
          replayComplete={replayComplete}
          paused={false}
          dropped={
            state.options.dropped +
            state.equities.dropped +
            state.flow.dropped +
            state.alerts.dropped
          }
          mode={state.mode}
        />
      }
      actions={
        <button className="terminal-button" type="button" onClick={state.toggleMode}>
          {state.mode === "live" ? "Replay" : "Live"}
        </button>
      }
    >
      <div className="command-replay-strip">
        <div>
          <span>Source</span>
          <strong>{activeSource}</strong>
        </div>
        <div>
          <span>Cursor</span>
          <strong>
            {replayTime
              ? formatTime(replayTime)
              : state.lastSeen
                ? formatTime(state.lastSeen)
                : "waiting"}
          </strong>
        </div>
        <div>
          <span>Chart</span>
          <strong>
            {state.chartTicker} / {formatIntervalLabel(state.chartIntervalMs)}
          </strong>
        </div>
        <div>
          <span>Scope</span>
          <strong>
            {state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "All symbols"}
          </strong>
        </div>
      </div>
    </Pane>
  );
};
