"use client";

import type {
  EquityCandle,
  EquityPrint,
  InferredDarkEvent,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import { type ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildTimeframeToolbarModel,
  buildVolumeLowerSeries,
  createDefaultTimeframeFavorites,
  DEFAULT_MARKET_CHART_SETTINGS,
  formatIntervalLabel,
  MarketChart,
  MarketChartSection,
  type MarketChartCandle,
  type MarketChartDirection,
  type MarketChartMarker,
  type MarketChartOverlay,
  type MarketChartRange,
  type MarketChartStatus,
  type MarketChartTimeframeId,
  normalizeMarketChartCandles,
  readTimeframeFavorites,
  reduceTimeframeFavorites,
  type TimeframeFavoritesState,
  toChartTime,
  writeTimeframeFavorites
} from "../market-chart";
import { getChartFlowMarkerItems } from "./charts/markers";
import { SUPPORTED_CANDLE_INTERVAL_MS } from "./config";
import { smartFlowDirectionTone, statusLabel } from "./format";
import type { TerminalState } from "./state";
import { buildApiUrl, readErrorDetail } from "./transport";
import type { TapeMode, WsStatus } from "./types";
import { formatTime } from "./components/ui-helpers";

export type TerminalMarketChartMarkerPayload =
  | { kind: "smart-flow"; projection: SmartFlowExplainabilityProjection }
  | { kind: "smart-money"; event: SmartMoneyEvent }
  | { kind: "inferred-dark"; event: InferredDarkEvent };

type TerminalChartFetchState = {
  candles: EquityCandle[];
  status: WsStatus;
  lastUpdate: number | null;
  error: string | null;
};

const EMPTY_FETCH_STATE: TerminalChartFetchState = {
  candles: [],
  status: "connecting",
  lastUpdate: null,
  error: null
};

const MAX_DARK_MARKERS = 120;
const MAX_TOTAL_MARKERS = 320;
const OFF_EXCHANGE_OVERLAY_COLOR = "rgba(77, 163, 255, 0.58)";

const getTimeframeStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const sortByTsSeq = <T extends { ts?: number; source_ts?: number; seq: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const aTs = a.ts ?? a.source_ts ?? 0;
    const bTs = b.ts ?? b.source_ts ?? 0;
    const tsDelta = aTs - bTs;
    if (tsDelta !== 0) {
      return tsDelta;
    }
    return a.seq - b.seq;
  });

const normalizeTerminalDirection = (value: string | null | undefined): MarketChartDirection => {
  if (value === "bullish" || value === "bearish") {
    return value;
  }
  return "neutral";
};

export const normalizeTerminalChartCandles = (
  candles: readonly EquityCandle[]
): MarketChartCandle[] =>
  normalizeMarketChartCandles(
    sortByTsSeq([...candles]).map((candle) => ({
      ts: candle.ts,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      trade_count: candle.trade_count,
      seq: candle.seq,
      source: candle.underlying_id,
      payload: candle
    }))
  );

export const buildTerminalEquityOverlays = (
  prints: readonly EquityPrint[],
  visible = true
): MarketChartOverlay[] => {
  const points = sortByTsSeq([...prints])
    .filter((print) => print.offExchangeFlag)
    .map((print) => ({
      time: toChartTime(print.ts),
      timestampMs: print.ts,
      price: print.price,
      value: print.size,
      label: `${print.exchange} off-exchange`,
      color: OFF_EXCHANGE_OVERLAY_COLOR,
      payload: print
    }));

  if (points.length === 0) {
    return [];
  }

  return [
    {
      id: "equity-off-exchange",
      label: "Off-exchange prints",
      points,
      visible
    }
  ];
};

export const mapTerminalChartStatus = (
  status: WsStatus,
  mode: TapeMode,
  error: string | null
): MarketChartStatus => {
  if (error) {
    return "error";
  }
  if (mode === "replay") {
    return "replay";
  }
  if (status === "connected") {
    return "live";
  }
  if (status === "stale") {
    return "stale";
  }
  if (status === "disconnected") {
    return "offline";
  }
  return "loading";
};

export const getTerminalChartReplayEndTs = (
  mode: TapeMode,
  replayTime: number | null,
  intervalMs: number
): number | null => {
  if (mode !== "replay" || replayTime === null) {
    return null;
  }
  const replayBucket = Math.floor(replayTime / intervalMs);
  return (replayBucket + 1) * intervalMs - 1;
};

export const buildTerminalMarketChartMarkers = ({
  smartFlowProjections,
  smartMoneyEvents,
  inferredDark,
  visibleRangeMs
}: {
  smartFlowProjections: readonly SmartFlowExplainabilityProjection[];
  smartMoneyEvents: readonly SmartMoneyEvent[];
  inferredDark: readonly InferredDarkEvent[];
  visibleRangeMs: MarketChartRange | null;
}): MarketChartMarker<TerminalMarketChartMarkerPayload>[] => {
  if (!visibleRangeMs) {
    return [];
  }

  const markers: MarketChartMarker<TerminalMarketChartMarkerPayload>[] = [];
  const flowMarkerItems = getChartFlowMarkerItems(
    smartFlowProjections,
    smartMoneyEvents,
    visibleRangeMs
  );

  for (const item of flowMarkerItems) {
    if (item.kind === "smart-flow") {
      const { projection } = item;
      const direction = smartFlowDirectionTone(projection);
      markers.push({
        id: `smart-flow:${projection.refs.hypothesis_id}:${projection.seq}`,
        time: toChartTime(projection.source_ts),
        label: projection.abstention.abstained ? "ABS" : "HYP",
        title: "Smart-flow hypothesis",
        direction,
        position: direction === "bullish" ? "belowBar" : "aboveBar",
        color:
          direction === "bullish"
            ? "#25c17a"
            : direction === "bearish"
              ? "#ff6b5f"
              : "rgba(144, 160, 178, 0.9)",
        shape:
          direction === "bullish" ? "arrowUp" : direction === "bearish" ? "arrowDown" : "circle",
        payload: { kind: "smart-flow", projection }
      });
      continue;
    }

    const { event } = item;
    const direction = normalizeTerminalDirection(event.primary_direction);
    markers.push({
      id: `smart-money:${event.trace_id}:${event.seq}`,
      time: toChartTime(event.source_ts),
      label: event.abstained
        ? "ABS"
        : event.primary_profile_id
          ? event.primary_profile_id.slice(0, 3).toUpperCase()
          : "SM",
      title: "Legacy smart-money fallback",
      direction,
      position: direction === "bullish" ? "belowBar" : "aboveBar",
      color:
        direction === "bullish"
          ? "#2f6d4f"
          : direction === "bearish"
            ? "#c46f2a"
            : "rgba(111, 91, 57, 0.9)",
      shape:
        direction === "bullish" ? "arrowUp" : direction === "bearish" ? "arrowDown" : "circle",
      payload: { kind: "smart-money", event }
    });
  }

  const inRangeDark = sortByTsSeq(
    inferredDark.filter(
      (event) => event.source_ts >= visibleRangeMs.from && event.source_ts <= visibleRangeMs.to
    )
  );
  const cappedDark =
    inRangeDark.length > MAX_DARK_MARKERS
      ? inRangeDark.slice(inRangeDark.length - MAX_DARK_MARKERS)
      : inRangeDark;

  for (const event of cappedDark) {
    markers.push({
      id: `dark:${event.trace_id}:${event.seq}`,
      time: toChartTime(event.source_ts),
      label: "D",
      title: "Inferred dark evidence",
      direction: "neutral",
      position: "aboveBar",
      color: "rgba(31, 74, 123, 0.9)",
      shape: "square",
      payload: { kind: "inferred-dark", event }
    });
  }

  markers.sort((a, b) => {
    const delta = Number(a.time) - Number(b.time);
    if (delta !== 0) {
      return delta;
    }
    return a.id.localeCompare(b.id);
  });

  return markers.length > MAX_TOTAL_MARKERS
    ? markers.slice(markers.length - MAX_TOTAL_MARKERS)
    : markers;
};

type TerminalMarketChartSectionProps = {
  state: TerminalState;
  title?: string;
  className?: string;
};

export const TerminalMarketChartSection = memo(
  ({ state, title = "Chart Context", className }: TerminalMarketChartSectionProps) => {
    const [favoritesHydrated, setFavoritesHydrated] = useState(false);
    const [timeframeFavorites, setTimeframeFavorites] = useState<TimeframeFavoritesState>(() =>
      createDefaultTimeframeFavorites(SUPPORTED_CANDLE_INTERVAL_MS)
    );
    const [visibleRangeMs, setVisibleRangeMs] = useState<MarketChartRange | null>(null);
    const [overlayEnabled, setOverlayEnabled] = useState(true);
    const [overlayRangePrints, setOverlayRangePrints] = useState<EquityPrint[]>([]);
    const [fetchState, setFetchState] = useState<TerminalChartFetchState>({
      ...EMPTY_FETCH_STATE,
      status: state.mode === "live" ? "connecting" : "connected"
    });
    const overlayAbortRef = useRef<AbortController | null>(null);

    const timeframeModel = useMemo(
      () =>
        buildTimeframeToolbarModel({
          selectedIntervalMs: state.chartIntervalMs,
          favoriteIds: timeframeFavorites.favoriteIds,
          supportedIntervalMs: SUPPORTED_CANDLE_INTERVAL_MS
        }),
      [state.chartIntervalMs, timeframeFavorites.favoriteIds]
    );
    const selectedTimeframe = timeframeModel.selected;
    const normalizedChartIntervalMs = selectedTimeframe.ms;

    useEffect(() => {
      setTimeframeFavorites(
        readTimeframeFavorites(getTimeframeStorage(), SUPPORTED_CANDLE_INTERVAL_MS)
      );
      setFavoritesHydrated(true);
    }, []);

    useEffect(() => {
      if (!favoritesHydrated) {
        return;
      }
      writeTimeframeFavorites(
        getTimeframeStorage(),
        timeframeFavorites,
        SUPPORTED_CANDLE_INTERVAL_MS
      );
    }, [favoritesHydrated, timeframeFavorites]);

    useEffect(() => {
      if (state.chartIntervalMs !== normalizedChartIntervalMs) {
        state.setChartIntervalMs(normalizedChartIntervalMs);
      }
    }, [state, normalizedChartIntervalMs]);

    const updateFavorite = useCallback((action: { type: "toggle"; id: MarketChartTimeframeId }) => {
      setTimeframeFavorites((current) =>
        reduceTimeframeFavorites(current, action, SUPPORTED_CANDLE_INTERVAL_MS)
      );
    }, []);

    const handleIntervalSelect = useCallback(
      (event: ChangeEvent<HTMLSelectElement>) => {
        const intervalMs = Number(event.currentTarget.value);
        if (Number.isFinite(intervalMs)) {
          state.setChartIntervalMs(intervalMs);
        }
      },
      [state]
    );

    const replayEndTs = useMemo(
      () =>
        getTerminalChartReplayEndTs(
          state.mode,
          state.equities.replayTime,
          normalizedChartIntervalMs
        ),
      [state.equities.replayTime, state.mode, normalizedChartIntervalMs]
    );

    useEffect(() => {
      let active = true;
      const abort = new AbortController();
      setFetchState({
        candles: [],
        status: state.mode === "live" ? "connecting" : "connected",
        lastUpdate: null,
        error: null
      });
      setOverlayRangePrints([]);

      const fetchCandles = async () => {
        try {
          const url = new URL(buildApiUrl("/candles/equities"));
          url.searchParams.set("underlying_id", state.chartTicker);
          url.searchParams.set("interval_ms", normalizedChartIntervalMs.toString());
          url.searchParams.set("limit", "300");
          url.searchParams.set("cache", "1");
          if (state.mode === "replay" && replayEndTs !== null) {
            url.searchParams.set("end_ts", replayEndTs.toString());
          }
          const response = await fetch(url.toString(), { signal: abort.signal });
          if (!response.ok) {
            const detail = await readErrorDetail(response);
            throw new Error(
              `Candle fetch failed (${response.status})${detail ? `: ${detail}` : ""}`
            );
          }
          const payload = (await response.json()) as { data?: EquityCandle[] };
          if (!active) {
            return;
          }
          const candles = sortByTsSeq(payload.data ?? []);
          const last = candles.at(-1);
          setFetchState({
            candles,
            status: "connected",
            lastUpdate: last ? (last.ingest_ts ?? last.ts) : null,
            error: null
          });
        } catch (error) {
          if (!active || (error instanceof DOMException && error.name === "AbortError")) {
            return;
          }
          setFetchState({
            candles: [],
            status: "disconnected",
            lastUpdate: null,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };

      void fetchCandles();

      return () => {
        active = false;
        abort.abort();
      };
    }, [state.chartTicker, state.mode, normalizedChartIntervalMs, replayEndTs]);

    useEffect(() => {
      if (state.mode !== "live") {
        return;
      }
      const candles = sortByTsSeq(state.liveSession.chartCandles);
      if (candles.length === 0) {
        return;
      }
      const last = candles.at(-1);
      setFetchState({
        candles,
        status: state.liveSession.status,
        lastUpdate: last ? (last.ingest_ts ?? last.ts) : state.liveSession.lastUpdate,
        error: null
      });
    }, [
      state.liveSession.chartCandles,
      state.liveSession.lastUpdate,
      state.liveSession.status,
      state.mode
    ]);

    useEffect(() => {
      overlayAbortRef.current?.abort();
      if (!visibleRangeMs) {
        return;
      }

      const abort = new AbortController();
      overlayAbortRef.current = abort;
      const timer = window.setTimeout(() => {
        const url = new URL(buildApiUrl("/prints/equities/range"));
        url.searchParams.set("underlying_id", state.chartTicker);
        url.searchParams.set("start_ts", Math.floor(visibleRangeMs.from).toString());
        url.searchParams.set("end_ts", Math.floor(visibleRangeMs.to).toString());
        url.searchParams.set("limit", "1000");

        void fetch(url.toString(), { signal: abort.signal })
          .then(async (response) => {
            if (!response.ok) {
              const detail = await readErrorDetail(response);
              throw new Error(
                `Equity range fetch failed (${response.status})${detail ? `: ${detail}` : ""}`
              );
            }
            return (await response.json()) as { data?: EquityPrint[] };
          })
          .then((payload) => {
            if (!abort.signal.aborted) {
              setOverlayRangePrints(payload.data ?? []);
            }
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            console.warn("Overlay fetch failed", error);
          });
      }, 180);

      return () => {
        window.clearTimeout(timer);
        abort.abort();
      };
    }, [state.chartTicker, visibleRangeMs]);

    const normalizedCandles = useMemo(
      () => normalizeTerminalChartCandles(fetchState.candles),
      [fetchState.candles]
    );
    const overlays = useMemo(
      () =>
        buildTerminalEquityOverlays(
          state.mode === "live"
            ? [...overlayRangePrints, ...state.liveSession.chartOverlay]
            : overlayRangePrints,
          overlayEnabled
        ),
      [overlayEnabled, overlayRangePrints, state.liveSession.chartOverlay, state.mode]
    );
    const markers = useMemo(
      () =>
        buildTerminalMarketChartMarkers({
          smartFlowProjections: state.chartSmartFlowProjections,
          smartMoneyEvents: state.chartSmartMoneyEvents,
          inferredDark: state.chartInferredDark,
          visibleRangeMs
        }),
      [
        state.chartSmartFlowProjections,
        state.chartSmartMoneyEvents,
        state.chartInferredDark,
        visibleRangeMs
      ]
    );
    const settings = useMemo(
      () => ({
        ...DEFAULT_MARKET_CHART_SETTINGS,
        time: { intervalMs: normalizedChartIntervalMs },
        display: {
          ...DEFAULT_MARKET_CHART_SETTINGS.display,
          showOverlays: overlayEnabled,
          density: "dense" as const
        },
        lowerPane: {
          ...DEFAULT_MARKET_CHART_SETTINGS.lowerPane,
          visible: true,
          activeLayerId: "volume"
        }
      }),
      [normalizedChartIntervalMs, overlayEnabled]
    );
    const status = state.mode === "live" ? state.liveSession.status : fetchState.status;
    const marketChartStatus = mapTerminalChartStatus(status, state.mode, fetchState.error);
    const hasData = normalizedCandles.length > 0;
    const lastUpdate =
      state.mode === "live"
        ? fetchState.lastUpdate ?? state.liveSession.lastUpdate
        : fetchState.lastUpdate;
    const favoriteLabel = selectedTimeframe.favorite
      ? `Remove ${selectedTimeframe.label} from favorite intervals`
      : `Add ${selectedTimeframe.label} to favorite intervals`;
    const intervalLabel = formatIntervalLabel(normalizedChartIntervalMs);
    const emptyLabel =
      state.mode === "live" ? `No ${intervalLabel} candles yet.` : `No ${intervalLabel} replay candles.`;

    const handleMarkerClick = useCallback(
      (marker: MarketChartMarker) => {
        const payload = marker.payload as TerminalMarketChartMarkerPayload | undefined;
        if (!payload) {
          return;
        }
        if (payload.kind === "smart-flow") {
          state.handleSmartFlowMarkerClick(payload.projection);
        } else if (payload.kind === "smart-money") {
          state.handleSmartMoneyMarkerClick(payload.event);
        } else {
          state.handleDarkMarkerClick(payload.event);
        }
      },
      [state]
    );

    return (
      <MarketChartSection
        className={className}
        title={title}
        meta={
          <div className="chart-meta terminal-chart-meta">
            <div className={`chart-status chart-status-${status}`}>
              <span className="chart-dot" />
              <span>{statusLabel(status, false, state.mode)}</span>
            </div>
            <span className="chart-meta-time">
              {lastUpdate ? `Updated ${formatTime(lastUpdate)}` : "Waiting for data"}
            </span>
          </div>
        }
        actions={
          <div className="chart-controls terminal-chart-controls">
            <div className="chart-intervals" aria-label="Favorite chart intervals">
              {timeframeModel.toolbarItems.map((interval) => (
                <button
                  key={interval.ms}
                  className={`interval-button${interval.ms === normalizedChartIntervalMs ? " active" : ""}`}
                  type="button"
                  onClick={() => state.setChartIntervalMs(interval.ms)}
                  aria-pressed={interval.ms === normalizedChartIntervalMs}
                  title={`${interval.label} candles`}
                >
                  {interval.label}
                </button>
              ))}
            </div>
            <label className="timeframe-dropdown-label">
              <span className="sr-only">Chart interval</span>
              <select
                className="timeframe-dropdown"
                value={selectedTimeframe.ms}
                onChange={handleIntervalSelect}
                aria-label="Chart interval"
              >
                {timeframeModel.dropdownItems.map((interval) => (
                  <option key={interval.ms} value={interval.ms} disabled={interval.disabled}>
                    {interval.dropdownLabel}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`timeframe-favorite-toggle${selectedTimeframe.favorite ? " is-active" : ""}`}
              type="button"
              aria-label={favoriteLabel}
              aria-pressed={selectedTimeframe.favorite}
              title={favoriteLabel}
              onClick={() => updateFavorite({ type: "toggle", id: selectedTimeframe.id })}
            >
              <span aria-hidden="true">{selectedTimeframe.favorite ? "★" : "☆"}</span>
            </button>
            <button
              className={`overlay-toggle${overlayEnabled ? " overlay-toggle-on" : ""}`}
              type="button"
              aria-pressed={overlayEnabled}
              title="Toggle off-exchange print overlay"
              onClick={() => setOverlayEnabled((current) => !current)}
            >
              Off-Ex {overlayEnabled ? "On" : "Off"}
            </button>
            <span className="chart-hint">{state.chartTicker}</span>
          </div>
        }
      >
        <div className="chart-panel terminal-market-chart-panel">
          <MarketChart
            symbol={state.chartTicker}
            intervalMs={normalizedChartIntervalMs}
            candles={normalizedCandles}
            lowerSeries={buildVolumeLowerSeries(normalizedCandles)}
            markers={markers}
            overlays={overlays}
            settings={settings}
            status={marketChartStatus}
            replayTime={state.equities.replayTime}
            layoutPreset="dashboard"
            onVisibleRangeChange={setVisibleRangeMs}
            onMarkerClick={handleMarkerClick}
          />
          {fetchState.error ? (
            <div className="empty chart-empty">Chart error: {fetchState.error}</div>
          ) : !hasData ? (
            <div className="empty chart-empty">{emptyLabel}</div>
          ) : null}
        </div>
      </MarketChartSection>
    );
  }
);

TerminalMarketChartSection.displayName = "TerminalMarketChartSection";
