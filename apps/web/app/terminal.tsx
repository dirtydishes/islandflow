"use client";

import type {
  AlertEvent,
  ClassifierHitEvent,
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  FlowPacket,
  InferredDarkEvent,
  LiveSubscription,
  NewsStory,
  OptionFlowFilters,
  OptionFlowView,
  OptionNBBO,
  OptionNbboSide,
  OptionPrint,
  OptionSecurityType,
  OptionType,
  SmartFlowExplainabilityProjection,
  FlowHypothesisType,
  SmartMoneyEvent,
  SmartMoneyProfileId,
  SyntheticControlState,
  SyntheticDemoProfileId,
  SyntheticDerivedStatus,
  SyntheticLoadProfileId
} from "@islandflow/types";
import {
  getSubscriptionKey as getLiveSubscriptionKey,
  matchesFlowPacketFilters,
  parseOptionContractId
} from "@islandflow/types";
import {
  createChart,
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp
} from "lightweight-charts";
import Link from "next/link";
import * as nextNavigation from "next/navigation";
import {
  type CSSProperties,
  createContext,
  type Dispatch,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  getChartFlowMarkerItems,
  sortBySourceTime,
  type ChartFlowMarkerItem
} from "../features/terminal/charts/markers";
import {
  CANDLE_INTERVALS,
  LIVE_HOT_WINDOW_OPTIONS,
  LIVE_OPTIONS_HEAD_LIMIT,
  NBBO_MAX_AGE_MS_SAFE,
  PINNED_EVIDENCE_MAX_ITEMS,
  getTapeVirtualConfig,
  isSyntheticAdminVisible,
  shouldIncludeEquitiesForDarkUnderlyingFallback
} from "../features/terminal/config";
import {
  buildAlertContextPath,
  collectAlertContextEvidence,
  getAlertFlowPacketRefs,
  getSmartFlowEvidenceRefs,
  getSmartFlowOptionPrintRefs,
  getSmartFlowPacketRefs,
  getSmartFlowPinnedFlowKeys,
  getSmartFlowPinnedOptionKeys,
  isSmartFlowPacketRef,
  prunePinnedEntries,
  resolveAlertFlowPacket
} from "../features/terminal/evidence";
import {
  DEFAULT_FLOW_SECURITY_TYPES,
  TICKER_FILTER_INPUT_MAX_LENGTH,
  buildDefaultFlowFilters,
  buildOptionTapeQueryParams,
  countActiveFlowFilterGroups,
  filterOptionTapeItems,
  getEffectiveOptionPrintFilters,
  getOptionScope,
  nextFlowFilterPopoverState,
  normalizeTickerFilterInput,
  parseTickerFilterInput,
  shouldClearOptionFocusSeed,
  shouldRetainLiveSnapshotHistory,
  shouldShowEquitiesSilentFeedWarning,
  toggleFilterValue
} from "../features/terminal/filters";
import {
  classifierToneForFamily,
  decodeNewsText,
  deriveAlertDirection,
  formatCompactUsd,
  formatNewsTimestamp,
  formatOptionContractLabel,
  getAlertWindowAnchorTs,
  getOptionTableSnapshot,
  normalizeAlertSeverity,
  selectPrimaryClassifierHit,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  smartMoneyProfileLabel,
  smartMoneyToneForProfile,
  statusLabel
} from "../features/terminal/format";
import { bumpTapeDebugMetric, logTapeDebug } from "../features/terminal/debug";
import { buildApiUrl, extractReplaySource, readErrorDetail } from "../features/terminal/transport";
import {
  toStaticTapeState,
  useLiveSession,
  usePausableTapeView,
  useTape
} from "../features/terminal/live";
import {
  useListScroll,
  useScrollAnchor,
  useTapeVirtualList,
  useVirtualHistoryGate
} from "../features/terminal/scroll";
import {
  appendHistoryTail,
  composeTapeItems,
  findAnchorRestoreIndex,
  flushPausableTapeData,
  frontendRetentionMetrics,
  getHotChannelFeedStatus,
  getLiveFeedStatus,
  getLiveHistoryRetentionCap,
  getTapeItemKey,
  incrementRetentionMetric,
  mergeHeldTapeHistory,
  mergeNewest,
  mergeNewestWithOverflow,
  projectPausableTapeState,
  reducePausableTapeData,
  setRetentionMetric
} from "../features/terminal/tape";
import {
  NAV_ITEMS,
  getLiveManifest,
  getRouteFeatures,
  getTerminalNavCurrentHref,
  normalizeTerminalPathname
} from "../features/terminal/routes";
import {
  TerminalAppShell as TerminalFeatureAppShell,
  type TerminalDrawersRenderer
} from "../features/terminal/shell";
import { type TerminalState, useTerminal } from "../features/terminal/state";
import {
  extractUnderlying,
  formatDarkTrace,
  inferDarkUnderlying,
  normalizeContractId,
  type AlertContextStatus,
  type DarkEvidenceItem,
  type EvidenceItem
} from "../features/terminal/state-helpers";
import type {
  EquityScope,
  OptionContractDisplay,
  OptionScope,
  PinnedEntry,
  SelectedInstrument,
  TapeFocusSeed,
  TapeMode,
  WsStatus
} from "../features/terminal/types";

export {
  NAV_ITEMS,
  appendHistoryTail,
  buildAlertContextPath,
  buildDefaultFlowFilters,
  buildOptionTapeQueryParams,
  classifierToneForFamily,
  collectAlertContextEvidence,
  composeTapeItems,
  countActiveFlowFilterGroups,
  decodeNewsText,
  deriveAlertDirection,
  filterOptionTapeItems,
  findAnchorRestoreIndex,
  flushPausableTapeData,
  formatCompactUsd,
  formatNewsTimestamp,
  formatOptionContractLabel,
  getAlertFlowPacketRefs,
  getAlertWindowAnchorTs,
  getChartFlowMarkerItems,
  getEffectiveOptionPrintFilters,
  getHotChannelFeedStatus,
  getLiveFeedStatus,
  getLiveHistoryRetentionCap,
  getLiveManifest,
  getOptionScope,
  getOptionTableSnapshot,
  getRouteFeatures,
  getSmartFlowEvidenceRefs,
  getSmartFlowOptionPrintRefs,
  getSmartFlowPacketRefs,
  getSmartFlowPinnedFlowKeys,
  getSmartFlowPinnedOptionKeys,
  getTapeVirtualConfig,
  getTerminalNavCurrentHref,
  isSyntheticAdminVisible,
  mergeHeldTapeHistory,
  mergeNewestWithOverflow,
  nextFlowFilterPopoverState,
  normalizeAlertSeverity,
  normalizeTerminalPathname,
  normalizeTickerFilterInput,
  parseTickerFilterInput,
  projectPausableTapeState,
  prunePinnedEntries,
  reducePausableTapeData,
  resolveAlertFlowPacket,
  selectPrimaryClassifierHit,
  shouldClearOptionFocusSeed,
  shouldIncludeEquitiesForDarkUnderlyingFallback,
  shouldRetainLiveSnapshotHistory,
  shouldShowEquitiesSilentFeedWarning,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  smartMoneyProfileLabel,
  smartMoneyToneForProfile,
  statusLabel,
  toggleFilterValue
};
export type { ChartFlowMarkerItem };

type CandlestickSeries = ReturnType<IChartApi["addCandlestickSeries"]>;

type EquityOverlayPoint = {
  ts: number;
  price: number;
  size: number;
  offExchangeFlag: boolean;
};

type ChartCandle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

const formatIntervalLabel = (intervalMs: number): string => {
  const match = CANDLE_INTERVALS.find((interval) => interval.ms === intervalMs);
  if (match) {
    return match.label;
  }
  if (intervalMs >= 60000) {
    return `${Math.round(intervalMs / 60000)}m`;
  }
  if (intervalMs >= 1000) {
    return `${Math.round(intervalMs / 1000)}s`;
  }
  return `${intervalMs}ms`;
};

const toChartTime = (ts: number): UTCTimestamp => {
  return Math.floor(ts / 1000) as UTCTimestamp;
};

type ChartTimeLike = number | string | { year: number; month: number; day: number };

const chartTimeToMs = (value: ChartTimeLike): number | null => {
  if (typeof value === "number") {
    return Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object") {
    const { year, month, day } = value;
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      year >= 1970 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return Date.UTC(year, month - 1, day);
    }
  }

  return null;
};

const toChartCandle = (candle: EquityCandle): ChartCandle => {
  return {
    time: toChartTime(candle.ts),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close
  };
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const sampleToLimit = <T,>(items: T[], limit: number): T[] => {
  if (items.length <= limit) {
    return items;
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  const step = Math.ceil(items.length / safeLimit);
  const sampled: T[] = [];
  for (let idx = 0; idx < items.length; idx += step) {
    sampled.push(items[idx]);
  }

  return sampled;
};

const formatPrice = (price: number): string => {
  if (!Number.isFinite(price)) {
    return "0.00";
  }
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatSize = (size: number): string => {
  return size.toLocaleString();
};

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString();
};

const formatConfidence = (value: number): string => `${Math.round(value * 100)}%`;

const formatPct = (value: number): string => `${Math.round(value * 100)}%`;

const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatStrike = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
};

const formatExpiryShort = (value: string): string | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return `${month}-${day}-${year.slice(2)}`;
};

const formatContractLabel = (value: string): string => {
  const parsed = formatOptionContractLabel(value);
  if (parsed) {
    return `${parsed.ticker} ${parsed.strike} ${parsed.expiration}`;
  }
  const normalized = normalizeContractId(value);
  if (!normalized) {
    return "Unknown contract";
  }
  if (/^\d+$/.test(normalized)) {
    return `Instrument ${normalized}`;
  }
  return normalized;
};

const formatDateTime = (ts: number): string => {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const sanitizeNewsHtml = (
  value: string
): { html: string; fallbackText: string; sanitized: boolean } => {
  const fallbackText = decodeNewsText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  try {
    const sanitized = value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\shref=(["'])javascript:[\s\S]*?\1/gi, ' href="#"')
      .replace(
        /<(?!\/?(p|div|section|article|span|strong|em|b|i|ul|ol|li|br|a|h1|h2|h3|h4|blockquote)\b)[^>]*>/gi,
        ""
      );
    return { html: sanitized, fallbackText, sanitized: true };
  } catch {
    return { html: "", fallbackText, sanitized: false };
  }
};

const humanizeClassifierId = (value: string): string => {
  if (!value) {
    return "Classifier";
  }

  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
};

const normalizeDirection = (value: string): "bullish" | "bearish" | "neutral" => {
  const normalized = value.toLowerCase();
  if (normalized === "bullish" || normalized === "bearish" || normalized === "neutral") {
    return normalized;
  }
  return "neutral";
};

const parseNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const getJoinString = (join: EquityPrintJoin, key: string): string | null => {
  const value = join.features[key];
  return typeof value === "string" ? value : null;
};

const getJoinNumber = (join: EquityPrintJoin, key: string, fallback = Number.NaN): number => {
  return parseNumber(join.features[key], fallback);
};

const getJoinBoolean = (join: EquityPrintJoin, key: string): boolean => {
  return parseBoolean(join.features[key], false);
};

type NbboSide = "AA" | "A" | "B" | "BB";

const classifyNbboSide = (price: number, quote: OptionNBBO | null | undefined): NbboSide | null => {
  if (!quote || !Number.isFinite(price)) {
    return null;
  }

  const bid = quote.bid;
  const ask = quote.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= 0) {
    return null;
  }

  const spread = Math.max(0, ask - bid);
  const epsilon = Math.max(0.01, spread * 0.05);

  if (price > ask + epsilon) {
    return "AA";
  }
  if (price >= ask - epsilon) {
    return "A";
  }
  if (price < bid - epsilon) {
    return "BB";
  }
  if (price <= bid + epsilon) {
    return "B";
  }

  const mid = (bid + ask) / 2;
  return price >= mid ? "A" : "B";
};

const smartFlowReasonLabel = (value: string): string => humanizeClassifierId(value);

type TapeStatusProps = {
  status: WsStatus;
  lastUpdate: number | null;
  replayTime: number | null;
  replayComplete: boolean;
  paused: boolean;
  dropped: number;
  mode: TapeMode;
};

const TapeStatus = ({
  status,
  lastUpdate: _lastUpdate,
  replayTime,
  replayComplete,
  paused,
  dropped,
  mode
}: TapeStatusProps) => {
  const label = replayComplete ? "Replay Complete" : statusLabel(status, paused, mode);
  const pausedLabel = paused && dropped > 0 ? `+${dropped} queued` : "";

  return (
    <div
      className={`status-inline status-${status} ${mode === "replay" ? "status-replay" : ""}`.trim()}
    >
      <span className="status-dot" />
      <span className="status-inline-label">{label}</span>
      {mode === "replay" ? (
        <span className="status-inline-meta">
          Replay time {replayTime ? formatTime(replayTime) : "—"}
        </span>
      ) : null}
      <span
        className={`status-inline-counter${pausedLabel ? " status-inline-counter-visible" : ""}`}
      >
        {pausedLabel || "+000 queued"}
      </span>
    </div>
  );
};

type TapeControlsProps = {
  mode: TapeMode;
  paused: boolean;
  onTogglePause: () => void;
  isAtTop: boolean;
  missed: number;
  onJump: () => void;
};

const TapeControls = ({
  mode,
  paused,
  onTogglePause,
  isAtTop,
  missed,
  onJump
}: TapeControlsProps) => {
  const active = !isAtTop && missed > 0;
  return (
    <div className={`tape-controls${active ? " tape-controls-active" : ""}`}>
      {mode === "replay" ? (
        <button className="pause-button" type="button" onClick={onTogglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
      ) : null}
      <button className="jump-button" type="button" onClick={onJump} disabled={isAtTop}>
        Jump to top
      </button>
      <span
        className={`missed-count${active ? " missed-count-visible" : ""}`}
        aria-hidden={!active}
      >
        +{missed} new
      </span>
    </div>
  );
};

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

const CandleChart = ({
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
    seriesRef.current.setMarkers(markerBundle.markers);
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

    const series = chart.addCandlestickSeries({
      upColor: "#25c17a",
      downColor: "#ff6b5f",
      borderVisible: false,
      wickUpColor: "#25c17a",
      wickDownColor: "#ff6b5f"
    });

    chartRef.current = chart;
    seriesRef.current = series;
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

    const clickHandler = (param: { hoveredObjectId?: unknown }) => {
      const hovered = param.hoveredObjectId;
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
        chart.applyOptions({
          width: nextW,
          height: nextH
        });

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
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
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

type AlertSeverityStripProps = {
  alerts: AlertEvent[];
};

const AlertSeverityStrip = ({ alerts }: AlertSeverityStripProps) => {
  const windowMs = 30 * 60 * 1000;
  const windowAnchor = getAlertWindowAnchorTs(alerts);
  const severityCounts = alerts.reduce(
    (acc, alert) => {
      if (windowAnchor - alert.source_ts > windowMs) {
        return acc;
      }
      const severity = normalizeAlertSeverity(alert);
      if (severity === "high") {
        acc.high += 1;
      } else if (severity === "medium") {
        acc.medium += 1;
      } else {
        acc.low += 1;
      }
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );

  const directionCounts = alerts.reduce(
    (acc, alert) => {
      if (windowAnchor - alert.source_ts > windowMs) {
        return acc;
      }
      const direction = deriveAlertDirection(alert);
      acc[direction] += 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );

  const severityTotal = severityCounts.high + severityCounts.medium + severityCounts.low;
  const highPct = severityTotal > 0 ? (severityCounts.high / severityTotal) * 100 : 0;
  const mediumPct = severityTotal > 0 ? (severityCounts.medium / severityTotal) * 100 : 0;
  const lowPct = severityTotal > 0 ? (severityCounts.low / severityTotal) * 100 : 0;

  const directionTotal =
    directionCounts.bullish + directionCounts.bearish + directionCounts.neutral;
  const bullishPct = directionTotal > 0 ? (directionCounts.bullish / directionTotal) * 100 : 0;
  const bearishPct = directionTotal > 0 ? (directionCounts.bearish / directionTotal) * 100 : 0;
  const neutralPct = directionTotal > 0 ? (directionCounts.neutral / directionTotal) * 100 : 0;

  return (
    <div className="alert-strips">
      <div className="alert-strip-section">
        <div className="alert-strip-header">
          <span>Severity (last 30m)</span>
          <span>{severityTotal} alerts</span>
        </div>
        <div className="alert-strip-bar">
          <div className="strip-segment severity-high" style={{ width: `${highPct}%` }}>
            {severityCounts.high > 0 ? `High ${severityCounts.high}` : ""}
          </div>
          <div className="strip-segment severity-medium" style={{ width: `${mediumPct}%` }}>
            {severityCounts.medium > 0 ? `Med ${severityCounts.medium}` : ""}
          </div>
          <div className="strip-segment severity-low" style={{ width: `${lowPct}%` }}>
            {severityCounts.low > 0 ? `Low ${severityCounts.low}` : ""}
          </div>
        </div>
      </div>
      <div className="alert-strip-section">
        <div className="alert-strip-header">
          <span>Direction (last 30m)</span>
          <span>{directionTotal} alerts</span>
        </div>
        <div className="alert-strip-bar">
          <div className="strip-segment direction-bullish" style={{ width: `${bullishPct}%` }}>
            {directionCounts.bullish > 0 ? `Bull ${directionCounts.bullish}` : ""}
          </div>
          <div className="strip-segment direction-bearish" style={{ width: `${bearishPct}%` }}>
            {directionCounts.bearish > 0 ? `Bear ${directionCounts.bearish}` : ""}
          </div>
          <div className="strip-segment direction-neutral" style={{ width: `${neutralPct}%` }}>
            {directionCounts.neutral > 0 ? `Neut ${directionCounts.neutral}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

type AlertDrawerProps = {
  alert: AlertEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  contextStatus: AlertContextStatus;
  onClose: () => void;
};

const formatOptionalMoney = (value: unknown): string | null => {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? `$${formatPrice(parsed)}` : null;
};

const formatOptionalMs = (value: unknown): string | null => {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? `${Math.round(parsed)}ms` : null;
};

const AlertDrawer = ({ alert, flowPacket, evidence, contextStatus, onClose }: AlertDrawerProps) => {
  const primary = alert.hits[0];
  const direction = deriveAlertDirection(alert);
  const severity = normalizeAlertSeverity(alert);
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;
  const isContextLoading = contextStatus.traceId === alert.trace_id && contextStatus.loading;
  const missingRefs = contextStatus.traceId === alert.trace_id ? contextStatus.missingRefs : [];

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Alert details</p>
          <h3>{primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}</h3>
          <p className="drawer-subtitle">{formatDateTime(alert.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill severity-${severity}`}>{severity}</span>
        <span className="drawer-chip">Score {Math.round(alert.score)}</span>
        <span className={`pill direction-${direction}`}>{direction}</span>
        {isContextLoading ? <span className="drawer-chip">Loading context</span> : null}
      </div>
      {isContextLoading ? (
        <div
          className="drawer-section drawer-context-loading"
          aria-label="Loading persisted evidence"
        >
          <div className="drawer-skeleton drawer-skeleton-wide" />
          <div className="drawer-skeleton" />
        </div>
      ) : null}
      {contextStatus.traceId === alert.trace_id && contextStatus.error ? (
        <p className="drawer-empty">Persisted context could not be loaded: {contextStatus.error}</p>
      ) : null}

      <div className="drawer-section">
        <h4>Classifier hits</h4>
        {alert.hits.length === 0 ? (
          <p className="drawer-empty">No classifier hits captured.</p>
        ) : (
          <div className="drawer-list">
            {alert.hits.map((hit, index) => (
              <div className="drawer-row" key={`${alert.trace_id}-${hit.classifier_id}-${index}`}>
                <div className="drawer-row-title">{humanizeClassifierId(hit.classifier_id)}</div>
                <div className="drawer-row-meta">
                  <span className={`pill direction-${normalizeDirection(hit.direction)}`}>
                    {normalizeDirection(hit.direction)}
                  </span>
                  <span>Confidence {formatConfidence(hit.confidence)}</span>
                </div>
                {hit.explanations?.[0] ? (
                  <p className="drawer-note">{hit.explanations[0]}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="drawer-section">
        <h4>Flow packet</h4>
        {flowPacket ? (
          <div className="drawer-row">
            <div className="drawer-row-title">
              {String(flowPacket.features.option_contract_id ?? flowPacket.id ?? "Flow packet")}
            </div>
            <div className="drawer-row-meta">
              <span>
                {formatFlowMetric(
                  parseNumber(flowPacket.features.count, flowPacket.members.length)
                )}{" "}
                prints
              </span>
              <span>{formatFlowMetric(parseNumber(flowPacket.features.total_size, 0))} size</span>
              <span>
                Notional $
                {formatUsd(
                  parseNumber(
                    flowPacket.features.total_notional,
                    parseNumber(flowPacket.features.total_premium, 0) * 100
                  )
                )}
              </span>
            </div>
            <p className="drawer-note">
              Window {formatFlowMetric(parseNumber(flowPacket.features.window_ms, 0), "ms")} ·{" "}
              {formatTime(parseNumber(flowPacket.features.start_ts, flowPacket.source_ts))} →{" "}
              {formatTime(parseNumber(flowPacket.features.end_ts, flowPacket.source_ts))}
            </p>
          </div>
        ) : (
          <p className="drawer-empty">Persisted flow packet is not available for this alert.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">
            Persisted evidence prints are not available for this alert.
          </p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                  {item.print.execution_nbbo_side ? (
                    <span>Side {item.print.execution_nbbo_side}</span>
                  ) : null}
                  {formatOptionalMs(item.print.execution_nbbo_age_ms) ? (
                    <span>Quote {formatOptionalMs(item.print.execution_nbbo_age_ms)}</span>
                  ) : null}
                </div>
                <div className="drawer-row-meta drawer-evidence-context">
                  {formatOptionalMoney(item.print.execution_nbbo_bid) ? (
                    <span>Bid {formatOptionalMoney(item.print.execution_nbbo_bid)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_nbbo_ask) ? (
                    <span>Ask {formatOptionalMoney(item.print.execution_nbbo_ask)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_nbbo_mid) ? (
                    <span>Mid {formatOptionalMoney(item.print.execution_nbbo_mid)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_nbbo_spread) ? (
                    <span>Spr {formatOptionalMoney(item.print.execution_nbbo_spread)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_spot) ? (
                    <span>Spot {formatOptionalMoney(item.print.execution_underlying_spot)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_bid) ? (
                    <span>U Bid {formatOptionalMoney(item.print.execution_underlying_bid)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_ask) ? (
                    <span>U Ask {formatOptionalMoney(item.print.execution_underlying_ask)}</span>
                  ) : null}
                  {formatOptionalMoney(item.print.execution_underlying_mid) ? (
                    <span>U Mid {formatOptionalMoney(item.print.execution_underlying_mid)}</span>
                  ) : null}
                </div>
                <p className="drawer-note">{formatTime(item.print.ts)}</p>
              </div>
            ))}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">
            +{unknownCount} evidence refs unresolved in persisted context.
          </p>
        ) : null}
        {missingRefs.length > 0 ? (
          <p className="drawer-empty">Missing refs: {missingRefs.slice(0, 4).join(", ")}</p>
        ) : null}
      </div>
    </aside>
  );
};

type NewsDrawerProps = {
  story: NewsStory;
  onClose: () => void;
};

const NewsDrawer = ({ story, onClose }: NewsDrawerProps) => {
  const body = sanitizeNewsHtml(story.content_html);
  const headline = decodeNewsText(story.headline);
  const summary = decodeNewsText(story.summary);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">News wire</p>
          <h3>{headline}</h3>
          <p className="drawer-subtitle">
            {story.source} · Published {formatDateTime(story.published_ts)}
            {story.updated_ts !== story.published_ts
              ? ` · Updated ${formatDateTime(story.updated_ts)}`
              : ""}
          </p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        {story.resolved_symbols.map((symbol) => (
          <span className="drawer-chip" key={`${story.trace_id}-${symbol}`}>
            {symbol}
          </span>
        ))}
        <span className="drawer-chip">{story.symbol_resolution}</span>
      </div>

      {summary ? (
        <div className="drawer-section">
          <h4>Summary</h4>
          <p className="drawer-note">{summary}</p>
        </div>
      ) : null}

      <div className="drawer-section">
        <h4>Story</h4>
        {body.sanitized && body.html ? (
          <div
            className="drawer-note news-drawer-body"
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        ) : body.fallbackText ? (
          <p className="drawer-note">{body.fallbackText}</p>
        ) : (
          <p className="drawer-empty">Story body unavailable.</p>
        )}
      </div>

      {story.url ? (
        <div className="drawer-section">
          <h4>Source link</h4>
          <a
            className="terminal-button terminal-link-button"
            href={story.url}
            rel="noreferrer"
            target="_blank"
          >
            Open original article
          </a>
        </div>
      ) : null}
    </aside>
  );
};

type ClassifierHitDrawerProps = {
  hit: ClassifierHitEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  onClose: () => void;
};

const ClassifierHitDrawer = ({ hit, flowPacket, evidence, onClose }: ClassifierHitDrawerProps) => {
  const direction = normalizeDirection(hit.direction);
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Classifier hit</p>
          <h3>{humanizeClassifierId(hit.classifier_id)}</h3>
          <p className="drawer-subtitle">{formatDateTime(hit.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill direction-${direction}`}>{direction}</span>
        <span className="drawer-chip">Confidence {formatConfidence(hit.confidence)}</span>
      </div>

      <div className="drawer-section">
        <h4>Explanation</h4>
        {hit.explanations.length === 0 ? (
          <p className="drawer-empty">No explanation strings captured for this hit.</p>
        ) : (
          <div className="drawer-list">
            {hit.explanations.slice(0, 6).map((text, idx) => (
              <div className="drawer-row" key={`${hit.trace_id}-${hit.seq}-ex-${idx}`}>
                <p className="drawer-note">{text}</p>
              </div>
            ))}
          </div>
        )}
        {hit.explanations.length > 6 ? (
          <p className="drawer-empty">
            +{hit.explanations.length - 6} more explanations not shown.
          </p>
        ) : null}
      </div>

      <div className="drawer-section">
        <h4>Flow packet</h4>
        {flowPacket ? (
          <div className="drawer-row">
            <div className="drawer-row-title">
              {String(flowPacket.features.option_contract_id ?? flowPacket.id ?? "Flow packet")}
            </div>
            <div className="drawer-row-meta">
              <span>
                {formatFlowMetric(
                  parseNumber(flowPacket.features.count, flowPacket.members.length)
                )}{" "}
                prints
              </span>
              <span>{formatFlowMetric(parseNumber(flowPacket.features.total_size, 0))} size</span>
              <span>
                Notional $
                {formatUsd(
                  parseNumber(
                    flowPacket.features.total_notional,
                    parseNumber(flowPacket.features.total_premium, 0) * 100
                  )
                )}
              </span>
            </div>
            <p className="drawer-note">
              Window {formatFlowMetric(parseNumber(flowPacket.features.window_ms, 0), "ms")} ·{" "}
              {formatTime(parseNumber(flowPacket.features.start_ts, flowPacket.source_ts))} →{" "}
              {formatTime(parseNumber(flowPacket.features.end_ts, flowPacket.source_ts))}
            </p>
          </div>
        ) : (
          <p className="drawer-empty">Flow packet not in the current live cache.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">No linked option prints in the live cache yet.</p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                </div>
                <p className="drawer-note">{formatTime(item.print.ts)}</p>
              </div>
            ))}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">+{unknownCount} evidence prints not in cache.</p>
        ) : null}
      </div>
    </aside>
  );
};

type SmartMoneyDrawerProps = {
  event: SmartMoneyEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  onClose: () => void;
};

type SmartFlowDrawerProps = {
  projection: SmartFlowExplainabilityProjection;
  evidence: EvidenceItem[];
  onClose: () => void;
};

const SmartFlowDrawer = ({ projection, evidence, onClose }: SmartFlowDrawerProps) => {
  const hypothesis = projection.hypothesis;
  const confidence = hypothesis.scores.confidence;
  const directionLabel = smartFlowDirectionLabel(projection);
  const directionTone = smartFlowDirectionTone(projection);
  const evidenceQuality = smartFlowEvidenceQualityLabel(projection.evidence.evidence_quality);
  const evidenceRefs = getSmartFlowEvidenceRefs(projection);
  const visibleEvidence = evidence.slice(0, 12);
  const hiddenEvidenceCount = Math.max(0, evidence.length - visibleEvidence.length);
  const sourceReasons =
    projection.abstention.source_reasons.length > 0
      ? projection.abstention.source_reasons
      : projection.abstention.reasons
          .filter((reason) => reason !== "not_abstained")
          .map(smartFlowReasonLabel);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Smart-flow hypothesis</p>
          <h3>{smartFlowHypothesisLabel(hypothesis.hypothesis_type)}</h3>
          <p className="drawer-subtitle">
            {hypothesis.underlying_id} / {formatDateTime(projection.source_ts)}
          </p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill direction-${directionTone}`}>{directionLabel}</span>
        <span className="drawer-chip">
          Confidence {formatConfidence(confidence.policy_confidence)}
        </span>
        <span className="drawer-chip">Conviction {formatConfidence(confidence.conviction)}</span>
        <span className="drawer-chip">
          Evidence {evidenceQuality} {formatConfidence(projection.evidence.evidence_quality)}
        </span>
        {projection.abstention.abstained ? <span className="drawer-chip">Abstained</span> : null}
      </div>

      <div className="drawer-section">
        <h4>Hypothesis read</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">{projection.insight.label}</div>
          <p className="drawer-note">{projection.insight.summary}</p>
          {projection.compatibility?.compatibility_only ? (
            <p className="drawer-note">Compatibility projection from the legacy feed.</p>
          ) : null}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Confidence versus conviction</h4>
        <div className="drawer-list">
          <div className="drawer-row">
            <div className="drawer-row-title">Policy confidence</div>
            <div className="drawer-row-meta">
              <span>{formatConfidence(confidence.policy_confidence)}</span>
              <span>{projection.insight.confidence_band}</span>
            </div>
            <p className="drawer-note">How strongly the current policy supports this hypothesis.</p>
          </div>
          <div className="drawer-row">
            <div className="drawer-row-title">Conviction</div>
            <div className="drawer-row-meta">
              <span>{formatConfidence(confidence.conviction)}</span>
              <span>margin {formatConfidence(confidence.hypothesis_margin)}</span>
            </div>
            <p className="drawer-note">Separated from confidence so weak margin stays visible.</p>
          </div>
          <div className="drawer-row">
            <div className="drawer-row-title">Evidence quality</div>
            <div className="drawer-row-meta">
              <span>{evidenceQuality}</span>
              <span>{formatConfidence(confidence.evidence_quality)}</span>
              <span>{confidence.calibration_version ?? "calibration unavailable"}</span>
            </div>
            <p className="drawer-note">
              Evidence quality is an input, not a participant identity claim.
            </p>
          </div>
        </div>
      </div>

      <div className="drawer-section">
        <h4>Why-not context</h4>
        {sourceReasons.length > 0 ? (
          <div className="drawer-list">
            {sourceReasons.map((reason) => (
              <div className="drawer-row" key={`reason-${reason}`}>
                <div className="drawer-row-title">
                  {projection.abstention.abstained ? "Abstention reason" : "Policy check"}
                </div>
                <p className="drawer-note">{smartFlowReasonLabel(reason)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="drawer-empty">No abstention reason was reported.</p>
        )}
        {projection.evidence.penalties.length > 0 ? (
          <div className="drawer-list">
            {projection.evidence.penalties.map((penalty) => (
              <div className="drawer-row" key={penalty.penalty_id}>
                <div className="drawer-row-title">{smartFlowReasonLabel(penalty.kind)}</div>
                <div className="drawer-row-meta">
                  <span>Penalty {formatConfidence(penalty.score)}</span>
                  <span>{penalty.evidence_refs.length} refs</span>
                </div>
                <p className="drawer-note">{penalty.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="drawer-empty">No active score penalties.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Alternatives considered</h4>
        {projection.alternatives.length === 0 ? (
          <p className="drawer-empty">No close alternative was reported by this projection.</p>
        ) : (
          <div className="drawer-list">
            {projection.alternatives.map((alternative) => (
              <div
                className="drawer-row"
                key={`${projection.refs.hypothesis_id}-${alternative.hypothesis_type}`}
              >
                <div className="drawer-row-title">
                  {smartFlowHypothesisLabel(alternative.hypothesis_type)}
                </div>
                <div className="drawer-row-meta">
                  <span className={`pill direction-${normalizeDirection(alternative.direction)}`}>
                    {normalizeDirection(alternative.direction)}
                  </span>
                  <span>{formatConfidence(alternative.score)}</span>
                </div>
                {alternative.reasons[0] ? (
                  <p className="drawer-note">{alternative.reasons[0]}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence refs</h4>
        {visibleEvidence.length === 0 ? (
          <p className="drawer-empty">No evidence refs attached.</p>
        ) : (
          <div className="drawer-list">
            {visibleEvidence.map((item) => {
              if (item.kind === "flow") {
                return (
                  <div className="drawer-row" key={item.id}>
                    <div className="drawer-row-title">{item.id}</div>
                    <div className="drawer-row-meta">
                      <span>Flow packet</span>
                      <span>{item.packet.members.length} prints</span>
                    </div>
                    <p className="drawer-note">
                      {String(item.packet.features.option_contract_id ?? item.packet.id)}
                    </p>
                  </div>
                );
              }
              if (item.kind === "print") {
                return (
                  <div className="drawer-row" key={item.id}>
                    <div className="drawer-row-title">{item.id}</div>
                    <div className="drawer-row-meta">
                      <span>Option print</span>
                      <span>${formatPrice(item.print.price)}</span>
                      <span>{formatSize(item.print.size)}x</span>
                    </div>
                    <p className="drawer-note">{item.print.option_contract_id}</p>
                  </div>
                );
              }
              return (
                <div className="drawer-row" key={item.id}>
                  <div className="drawer-row-title">{item.id}</div>
                  <p className="drawer-note">Not in the current evidence cache.</p>
                </div>
              );
            })}
          </div>
        )}
        {hiddenEvidenceCount > 0 ? (
          <p className="drawer-empty">+{hiddenEvidenceCount} more evidence refs.</p>
        ) : null}
      </div>

      <div className="drawer-section">
        <h4>Version trace</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">{projection.refs.trace_id}</div>
          <div className="drawer-row-meta">
            <span>{projection.projection_version}</span>
            <span>{projection.versions.policy}</span>
            <span>{projection.versions.model}</span>
          </div>
          <p className="drawer-note">
            Cluster {projection.refs.cluster_id} / {projection.refs.candidate_ids.length} candidates
            / {evidenceRefs.length} refs
          </p>
        </div>
      </div>
    </aside>
  );
};

const SmartMoneyDrawer = ({ event, flowPacket, evidence, onClose }: SmartMoneyDrawerProps) => {
  const primaryScore =
    event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
    event.profile_scores[0];
  const direction = normalizeDirection(event.primary_direction);
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Compatibility flow profile</p>
          <h3>{smartMoneyProfileLabel(event.primary_profile_id)}</h3>
          <p className="drawer-subtitle">{formatDateTime(event.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className={`pill direction-${direction}`}>{direction}</span>
        <span className="drawer-chip">
          Legacy probability {primaryScore ? formatConfidence(primaryScore.probability) : "--"}
        </span>
        {event.abstained ? <span className="drawer-chip">Abstained</span> : null}
      </div>

      <div className="drawer-section">
        <h4>Compatibility ladder</h4>
        <div className="drawer-list">
          {event.profile_scores.slice(0, 6).map((score) => (
            <div className="drawer-row" key={`${event.event_id}-${score.profile_id}`}>
              <div className="drawer-row-title">{smartMoneyProfileLabel(score.profile_id)}</div>
              <div className="drawer-row-meta">
                <span className={`pill direction-${normalizeDirection(score.direction)}`}>
                  {normalizeDirection(score.direction)}
                </span>
                <span>{formatConfidence(score.probability)}</span>
                <span>{score.confidence_band}</span>
              </div>
              {score.reasons[0] ? <p className="drawer-note">{score.reasons[0]}</p> : null}
            </div>
          ))}
        </div>
        {event.suppressed_reasons.length > 0 ? (
          <p className="drawer-empty">Suppressed: {event.suppressed_reasons.join(", ")}</p>
        ) : null}
      </div>

      <div className="drawer-section">
        <h4>Parent event</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">{event.underlying_id}</div>
          <div className="drawer-row-meta">
            <span>{formatFlowMetric(event.features.print_count)} prints</span>
            <span>{formatFlowMetric(event.features.total_size)} size</span>
            <span>${formatCompactUsd(event.features.total_premium)}</span>
          </div>
          <p className="drawer-note">
            Window {formatFlowMetric(event.event_window_ms, "ms")} · {event.event_kind}
          </p>
        </div>
        {flowPacket ? <p className="drawer-note">Flow packet {flowPacket.id}</p> : null}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">No linked option prints in the live cache yet.</p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                </div>
                <p className="drawer-note">{formatTime(item.print.ts)}</p>
              </div>
            ))}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">+{unknownCount} evidence prints not in cache.</p>
        ) : null}
      </div>
    </aside>
  );
};

type DarkDrawerProps = {
  event: InferredDarkEvent;
  evidence: DarkEvidenceItem[];
  underlying: string | null;
  onClose: () => void;
};

const DarkDrawer = ({ event, evidence, underlying, onClose }: DarkDrawerProps) => {
  const joinEvidence = evidence.filter(
    (item): item is { kind: "join"; id: string; join: EquityPrintJoin } => item.kind === "join"
  );
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;
  const traceRefs = event.evidence_refs.slice(0, 6);
  const extraRefs = Math.max(0, event.evidence_refs.length - traceRefs.length);

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">Inferred dark</p>
          <h3>{humanizeClassifierId(event.type)}</h3>
          <p className="drawer-subtitle">{formatDateTime(event.source_ts)}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="drawer-meta">
        <span className="drawer-chip">Confidence {formatConfidence(event.confidence)}</span>
        {underlying ? <span className="drawer-chip">{underlying}</span> : null}
        <span className="drawer-chip">Evidence {event.evidence_refs.length}</span>
      </div>

      <div className="drawer-section">
        <h4>Trace path</h4>
        <div className="drawer-row">
          <div className="drawer-row-title">Event trace</div>
          <p className="drawer-note">{formatDarkTrace(event.trace_id)}</p>
        </div>
        {traceRefs.length === 0 ? (
          <p className="drawer-empty">No evidence references attached.</p>
        ) : (
          <div className="drawer-list">
            {traceRefs.map((ref) => (
              <div className="drawer-row" key={ref}>
                <div className="drawer-row-title">Evidence ref</div>
                <p className="drawer-note">{formatDarkTrace(ref)}</p>
              </div>
            ))}
          </div>
        )}
        {extraRefs > 0 ? <p className="drawer-empty">+{extraRefs} more evidence refs.</p> : null}
      </div>

      <div className="drawer-section">
        <h4>Evidence joins</h4>
        {joinEvidence.length === 0 ? (
          <p className="drawer-empty">No evidence joins in the current cache.</p>
        ) : (
          <div className="drawer-list">
            {joinEvidence.slice(0, 6).map((item) => {
              const joinUnderlying = getJoinString(item.join, "underlying_id") ?? "Unknown";
              const price = getJoinNumber(item.join, "price");
              const size = getJoinNumber(item.join, "size");
              const placement = getJoinString(item.join, "quote_placement") ?? "MISSING";
              const offExchange = getJoinBoolean(item.join, "off_exchange_flag");
              const bid = getJoinNumber(item.join, "quote_bid");
              const ask = getJoinNumber(item.join, "quote_ask");
              const mid = getJoinNumber(item.join, "quote_mid");
              const spread = getJoinNumber(item.join, "quote_spread");
              const quoteAge = parseNumber(item.join.join_quality.quote_age_ms, Number.NaN);
              const quoteStale = parseNumber(item.join.join_quality.quote_stale, 0) > 0;
              const quoteMissing = parseNumber(item.join.join_quality.quote_missing, 0) > 0;

              return (
                <div className="drawer-row" key={item.id}>
                  <div className="drawer-row-title">{joinUnderlying}</div>
                  <div className="drawer-row-meta">
                    {Number.isFinite(price) ? <span>${formatPrice(price)}</span> : null}
                    {Number.isFinite(size) ? <span>{formatSize(size)}x</span> : null}
                    <span className="pill">{placement}</span>
                    {offExchange ? (
                      <span className="flag">Off-Ex</span>
                    ) : (
                      <span className="flag flag-muted">Lit</span>
                    )}
                    {Number.isFinite(quoteAge) ? <span>{Math.round(quoteAge)}ms</span> : null}
                    {quoteStale ? <span className="pill nbbo-stale">Quote stale</span> : null}
                    {quoteMissing ? <span className="pill nbbo-missing">Quote missing</span> : null}
                  </div>
                  <p className="drawer-note">{item.join.trace_id}</p>
                  {Number.isFinite(bid) && Number.isFinite(ask) ? (
                    <p className="drawer-note">
                      Quote ${formatPrice(bid)} x ${formatPrice(ask)}
                      {Number.isFinite(mid) ? ` · Mid ${formatPrice(mid)}` : ""}
                      {Number.isFinite(spread) ? ` · Spr ${formatPrice(spread)}` : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {unknownCount > 0 ? (
          <p className="drawer-empty">+{unknownCount} evidence refs not in cache.</p>
        ) : null}
      </div>
    </aside>
  );
};

const formatFlowMetric = (value: number, suffix?: string): string => {
  if (suffix) {
    return `${value}${suffix}`;
  }

  return value.toLocaleString();
};

type PageFrameVariant = "default" | "dashboard" | "options" | "news";

type PageFrameProps = {
  title: string;
  eyebrow?: string;
  variant?: PageFrameVariant;
  actions?: ReactNode;
  children: ReactNode;
};

const PageFrame = ({ title, eyebrow, variant = "default", actions, children }: PageFrameProps) => {
  const classes = ["page-shell", `page-shell-${variant}`].join(" ");
  return (
    <div className={classes} data-route-variant={variant}>
      <header className="page-header">
        <div className="page-heading">
          {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
          <h1 className="page-title">{title}</h1>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
};

type FlowFilterPopoverProps = {
  filters: OptionFlowFilters;
  onChange: Dispatch<SetStateAction<OptionFlowFilters>>;
};

const FlowFilterSection = ({ title, children }: { title: string; children: ReactNode }) => {
  return (
    <section className="flow-filter-section">
      <div className="flow-filter-section-title">{title}</div>
      {children}
    </section>
  );
};

export const FlowFilterPopover = ({ filters, onChange }: FlowFilterPopoverProps) => {
  const pathname = nextNavigation.usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeCount = countActiveFlowFilterGroups(filters);

  const toggleSecurity = (value: OptionSecurityType, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      securityTypes: toggleFilterValue(prev.securityTypes, value, enabled)
    }));
  };

  const toggleSide = (value: OptionNbboSide, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      nbboSides: toggleFilterValue(prev.nbboSides, value, enabled)
    }));
  };

  const toggleOptionType = (value: OptionType, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      optionTypes: toggleFilterValue(prev.optionTypes, value, enabled)
    }));
  };

  const applyMinNotional = (value: number | undefined) => {
    onChange((prev) => ({
      ...prev,
      minNotional: value
    }));
  };

  const applyView = (view: OptionFlowView) => {
    onChange((prev) => ({
      ...prev,
      view,
      securityTypes:
        view === "raw" ? undefined : (prev.securityTypes ?? DEFAULT_FLOW_SECURITY_TYPES),
      nbboSides: view === "raw" ? undefined : prev.nbboSides,
      optionTypes: view === "raw" ? undefined : prev.optionTypes,
      minNotional: view === "raw" ? undefined : prev.minNotional
    }));
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen((current) => nextFlowFilterPopoverState(current, "dismiss"));
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen((current) => nextFlowFilterPopoverState(current, "dismiss"));
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className={`flow-filter-popover${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`terminal-button flow-filter-trigger${activeCount > 0 ? " is-active" : ""}`}
        type="button"
        onClick={() => setOpen((current) => nextFlowFilterPopoverState(current, "toggle"))}
      >
        <span>Filter</span>
        {activeCount > 0 ? <span className="flow-filter-badge">{activeCount}</span> : null}
      </button>

      {open ? (
        <div aria-label="Flow filters" className="flow-filter-popover-panel" role="dialog">
          <div className="flow-filter-popover-head">
            <div>
              <div className="flow-filter-popover-title">Flow Filters</div>
              <div className="flow-filter-popover-copy">Changes apply immediately.</div>
            </div>
            <button
              className="terminal-button"
              type="button"
              onClick={() => onChange(buildDefaultFlowFilters())}
            >
              Reset
            </button>
          </div>

          <div className="flow-filter-popover-body">
            <FlowFilterSection title="Options View">
              <div className="flow-filter-chip-grid flow-filter-chip-grid-two">
                {[
                  { label: "Signal", value: "signal" as const },
                  { label: "All prints", value: "raw" as const }
                ].map((preset) => (
                  <button
                    className={`filter-chip ${filters.view === preset.value ? "is-active" : ""}`}
                    key={preset.value}
                    type="button"
                    onClick={() => applyView(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="flow-filter-section-copy">
                Signal keeps classifier-ready prints. All prints includes raw option tape rows.
              </p>
            </FlowFilterSection>

            <FlowFilterSection title="Security">
              <div className="flow-filter-checkbox-grid">
                {(["stock", "etf"] as OptionSecurityType[]).map((value) => (
                  <label className="flow-filter-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(filters.securityTypes ?? []).includes(value)}
                      onChange={(event) => toggleSecurity(value, event.target.checked)}
                    />
                    <span>{value.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </FlowFilterSection>

            <FlowFilterSection title="Side">
              <div className="flow-filter-checkbox-grid flow-filter-checkbox-grid-wide">
                {(["AA", "A", "MID", "B", "BB"] as OptionNbboSide[]).map((value) => (
                  <label className="flow-filter-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(filters.nbboSides ?? []).includes(value)}
                      onChange={(event) => toggleSide(value, event.target.checked)}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </FlowFilterSection>

            <FlowFilterSection title="Type">
              <div className="flow-filter-checkbox-grid">
                {(["call", "put"] as OptionType[]).map((value) => (
                  <label className="flow-filter-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(filters.optionTypes ?? []).includes(value)}
                      onChange={(event) => toggleOptionType(value, event.target.checked)}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </FlowFilterSection>

            <FlowFilterSection title="Min Notional">
              <div className="flow-filter-chip-grid">
                {[
                  { label: "All signal", value: undefined },
                  { label: ">= 25k", value: 25_000 },
                  { label: ">= 50k", value: 50_000 },
                  { label: ">= 100k", value: 100_000 }
                ].map((preset) => (
                  <button
                    className={`filter-chip ${filters.minNotional === preset.value ? "is-active" : ""}`}
                    key={preset.label}
                    type="button"
                    onClick={() => applyMinNotional(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </FlowFilterSection>
          </div>
        </div>
      ) : null}
    </div>
  );
};

type PaneProps = {
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

const Pane = ({ title, status, actions, className = "", children }: PaneProps) => {
  const classes = ["terminal-pane", className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      <div className="terminal-pane-head">
        <div className="terminal-pane-title-row">
          <h2 className="terminal-pane-title">{title}</h2>
          {status ? <div className="terminal-pane-status">{status}</div> : null}
        </div>
        {actions ? <div className="terminal-pane-actions">{actions}</div> : null}
      </div>
      <div className="terminal-pane-body">{children}</div>
    </section>
  );
};

type OptionsPaneProps = {
  state: TerminalState;
  limit?: number;
  title?: string;
  className?: string;
};

const OptionsPane = memo(({ state, limit, title = "Options", className }: OptionsPaneProps) => {
  const items = limit ? state.filteredOptions.slice(0, limit) : state.filteredOptions;
  const virtual = useTapeVirtualList(
    items,
    state.optionsScroll.listRef,
    getTapeVirtualConfig("options")
  );
  const optionHistorySubscription = state.liveSession.manifest.find(
    (subscription) => subscription.channel === "options"
  );
  const optionHistoryKey = optionHistorySubscription
    ? getLiveSubscriptionKey(optionHistorySubscription)
    : null;
  const optionHistoryError = optionHistoryKey
    ? state.liveSession.historyErrors[optionHistoryKey]
    : null;
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("options")
  );

  return (
    <Pane
      className={className}
      title={title}
      status={
        <TapeStatus
          status={state.options.status}
          lastUpdate={state.options.lastUpdate}
          replayTime={state.options.replayTime}
          replayComplete={state.options.replayComplete}
          paused={state.options.paused}
          dropped={state.options.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.options.paused}
          onTogglePause={state.options.togglePause}
          isAtTop={state.optionsScroll.isAtTop}
          missed={state.optionsScroll.missed}
          onJump={state.optionsScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {state.mode === "live" && optionHistoryError ? (
          <div className="history-load-warning" role="status">
            Older option history failed to load: {optionHistoryError}
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="empty">
            {state.mode === "live"
              ? state.options.status === "stale"
                ? "Feed behind. Waiting for fresh option prints."
                : state.optionsScopedQuiet
                  ? "No recent option prints for this scope yet."
                  : state.tickerSet.size > 0
                    ? "No option prints match the current filter."
                    : "No option prints yet. Start ingest-options."
              : state.tickerSet.size > 0
                ? "No option prints match the current filter."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-options" role="table" aria-label="Options tape">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">SYM</span>
                <span className="data-table-cell">EXP</span>
                <span className="data-table-cell">STRIKE</span>
                <span className="data-table-cell">C/P</span>
                <span className="data-table-cell">SPOT</span>
                <span className="data-table-cell">DETAILS</span>
                <span className="data-table-cell">TYPE</span>
                <span className="data-table-cell">VALUE</span>
                <span className="data-table-cell">SIDE</span>
                <span className="data-table-cell">IV</span>
                <span className="data-table-cell">CLASSIFIER</span>
              </div>
              <div className="data-table-scroll" ref={state.optionsScroll.setListRef}>
                <div
                  className="data-table-body"
                  style={{ height: `${virtual.totalSize}px` }}
                  aria-hidden={virtual.virtualItems.length === 0}
                >
                  {virtual.virtualItems.map(({ item: print, key, index, start, size }) => {
                    const contractId = normalizeContractId(print.option_contract_id);
                    const parsed = parseOptionContractId(contractId);
                    const contractDisplay = formatOptionContractLabel(contractId);
                    const quote =
                      state.historicalNbboByTraceId.get(print.trace_id) ??
                      state.nbboMap.get(contractId);
                    const hasPreservedNbbo = typeof print.execution_nbbo_side === "string";
                    const nbboSide =
                      print.execution_nbbo_side ??
                      print.nbbo_side ??
                      (!hasPreservedNbbo ? classifyNbboSide(print.price, quote) : null);
                    const notional = print.notional ?? print.price * print.size * 100;
                    const spot = print.execution_underlying_spot;
                    const iv = print.execution_iv;
                    const decor = state.classifierDecorByOptionTraceId.get(print.trace_id);
                    const focusContract = (event: ReactMouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      state.focusOptionContract(print);
                    };
                    const rowStyle = {
                      ...(decor
                        ? ({ "--classifier-intensity": decor.intensity } as CSSProperties)
                        : undefined),
                      transform: `translateY(${start}px)`
                    } as CSSProperties;
                    const commonProps = {
                      className: `data-table-row data-table-row-button data-table-row-classified data-table-row-options data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}${decor ? ` is-classified classifier-${decor.tone}` : ""}`,
                      style: rowStyle,
                      "data-index": index,
                      "data-row-start": String(start),
                      "data-row-size": String(size),
                      "data-tape-key": key
                    };
                    const cells = (
                      <>
                        <span className="data-table-cell data-table-cell-number">
                          {formatTime(print.ts)}
                        </span>
                        <span className="data-table-cell">
                          <button
                            className="instrument-cell-button"
                            type="button"
                            onClick={focusContract}
                          >
                            {contractDisplay?.ticker ??
                              parsed?.root ??
                              formatContractLabel(contractId)}
                          </button>
                        </span>
                        <span className="data-table-cell">
                          <button
                            className="instrument-cell-button"
                            type="button"
                            onClick={focusContract}
                          >
                            {contractDisplay?.expiration ?? parsed?.expiry ?? "--"}
                          </button>
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          <button
                            className="instrument-cell-button"
                            type="button"
                            onClick={focusContract}
                          >
                            {contractDisplay?.strike.replace(/[CP]$/, "") ?? "--"}
                          </button>
                        </span>
                        <span className="data-table-cell">
                          <button
                            className="instrument-cell-button"
                            type="button"
                            onClick={focusContract}
                          >
                            {parsed?.right ?? contractDisplay?.strike.slice(-1) ?? "--"}
                          </button>
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {typeof spot === "number" ? formatPrice(spot) : "--"}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatSize(print.size)}@{formatPrice(print.price)}_{nbboSide ?? "--"}
                        </span>
                        <span className="data-table-cell">{print.option_type ?? "--"}</span>
                        <span className="data-table-cell data-table-cell-number notional-emphasis">
                          ${formatCompactUsd(notional)}
                        </span>
                        <span className="data-table-cell">
                          {nbboSide ? (
                            <span className={`nbbo-tag nbbo-tag-${nbboSide.toLowerCase()}`}>
                              {nbboSide}
                            </span>
                          ) : (
                            "--"
                          )}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {typeof iv === "number" ? formatPct(iv) : "--"}
                        </span>
                        <span className="data-table-cell">
                          {decor ? humanizeClassifierId(decor.family) : "--"}
                        </span>
                      </>
                    );

                    return decor ? (
                      <div
                        {...commonProps}
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          decor.smartMoney
                            ? state.openFromSmartMoneyEvent(decor.smartMoney)
                            : decor.hit
                              ? state.openFromClassifierHit(decor.hit)
                              : undefined
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            if (decor.smartMoney) {
                              state.openFromSmartMoneyEvent(decor.smartMoney);
                            } else if (decor.hit) {
                              state.openFromClassifierHit(decor.hit);
                            }
                          }
                        }}
                      >
                        {cells}
                      </div>
                    ) : (
                      <div {...commonProps} key={key}>
                        {cells}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type EquitiesPaneProps = {
  state: TerminalState;
  limit?: number;
};

const EquitiesPane = memo(({ state, limit }: EquitiesPaneProps) => {
  const items = limit ? state.filteredEquities.slice(0, limit) : state.filteredEquities;
  const virtual = useTapeVirtualList(
    items,
    state.equitiesScroll.listRef,
    getTapeVirtualConfig("equities")
  );
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("equities")
  );

  return (
    <Pane
      title="Equities"
      status={
        <TapeStatus
          status={state.equities.status}
          lastUpdate={state.equities.lastUpdate}
          replayTime={state.equities.replayTime}
          replayComplete={state.equities.replayComplete}
          paused={state.equities.paused}
          dropped={state.equities.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.equities.paused}
          onTogglePause={state.equities.togglePause}
          isAtTop={state.equitiesScroll.isAtTop}
          missed={state.equitiesScroll.missed}
          onJump={state.equitiesScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.mode === "live"
              ? state.equities.status === "stale"
                ? "Feed behind. Waiting for fresh equity prints."
                : state.equitiesScopedQuiet
                  ? "No recent equity prints for this scope yet."
                  : state.tickerSet.size > 0
                    ? "No equity prints match the current filter."
                    : state.equitiesSilentWarning
                      ? "Connected but no equity prints received. Check ingest-equities."
                      : "No equity prints yet. Start ingest-equities."
              : state.tickerSet.size > 0
                ? "No equity prints match the current filter."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-equities" role="table" aria-label="Equity prints">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">SYM</span>
                <span className="data-table-cell">PRICE</span>
                <span className="data-table-cell">SIZE</span>
                <span className="data-table-cell">VENUE</span>
                <span className="data-table-cell">TAPE</span>
              </div>
              <div className="data-table-scroll" ref={state.equitiesScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {virtual.virtualItems.map(({ item: print, key, index, start, size }) => (
                    <div
                      className={`data-table-row data-table-row-equities data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}`}
                      key={key}
                      data-index={index}
                      data-row-start={String(start)}
                      data-row-size={String(size)}
                      data-tape-key={key}
                      style={{ transform: `translateY(${start}px)` }}
                    >
                      <span className="data-table-cell data-table-cell-number">
                        {formatTime(print.ts)}
                      </span>
                      <span className="data-table-cell">
                        <button
                          className="instrument-cell-button"
                          type="button"
                          onClick={() => state.focusEquityTicker(print)}
                        >
                          {print.underlying_id}
                        </button>
                      </span>
                      <span className="data-table-cell data-table-cell-number">
                        ${formatPrice(print.price)}
                      </span>
                      <span className="data-table-cell data-table-cell-number">
                        {formatSize(print.size)}x
                      </span>
                      <span className="data-table-cell">{print.exchange}</span>
                      <span className="data-table-cell">
                        {print.offExchangeFlag ? "Off-Ex" : "Lit"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type FlowPaneProps = {
  state: TerminalState;
  limit?: number;
  title?: string;
  className?: string;
};

const FlowPane = memo(({ state, limit, title = "Flow", className }: FlowPaneProps) => {
  const items = limit ? state.filteredFlow.slice(0, limit) : state.filteredFlow;
  const virtual = useTapeVirtualList(items, state.flowScroll.listRef, getTapeVirtualConfig("flow"));
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("flow")
  );

  return (
    <Pane
      className={className}
      title={title}
      status={
        <TapeStatus
          status={state.flow.status}
          lastUpdate={state.flow.lastUpdate}
          replayTime={state.flow.replayTime}
          replayComplete={state.flow.replayComplete}
          paused={state.flow.paused}
          dropped={state.flow.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.flow.paused}
          onTogglePause={state.flow.togglePause}
          isAtTop={state.flowScroll.isAtTop}
          missed={state.flowScroll.missed}
          onJump={state.flowScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No flow packets match the current filter."
              : state.mode === "live"
                ? state.flow.status === "stale"
                  ? "Feed behind. Waiting for fresh flow packets."
                  : "No flow packets yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-flow" role="table" aria-label="Flow packets">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">CONTRACT</span>
                <span className="data-table-cell">PRINTS</span>
                <span className="data-table-cell">SIZE</span>
                <span className="data-table-cell">NOTIONAL</span>
                <span className="data-table-cell">WINDOW</span>
                <span className="data-table-cell">STRUCTURE</span>
                <span className="data-table-cell">NBBO</span>
                <span className="data-table-cell">QUALITY</span>
              </div>
              <div className="data-table-scroll" ref={state.flowScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {virtual.virtualItems.map(({ item: packet, key, index, start, size }) => {
                    const features = packet.features ?? {};
                    const contract = String(features.option_contract_id ?? packet.id ?? "unknown");
                    const count = parseNumber(features.count, packet.members.length);
                    const totalSize = parseNumber(features.total_size, 0);
                    const totalNotional = parseNumber(features.total_notional, Number.NaN);
                    const notional = Number.isFinite(totalNotional)
                      ? totalNotional
                      : parseNumber(features.total_premium, 0) * 100;
                    const startTs = parseNumber(features.start_ts, packet.source_ts);
                    const endTs = parseNumber(features.end_ts, startTs);
                    const windowMs = parseNumber(features.window_ms, 0);
                    const structureType =
                      typeof features.structure_type === "string" ? features.structure_type : "";
                    const structureLegs = parseNumber(features.structure_legs, 0);
                    const structureRights =
                      typeof features.structure_rights === "string"
                        ? features.structure_rights
                        : "";
                    const structureStrikes = parseNumber(features.structure_strikes, 0);
                    const nbboBid = parseNumber(features.nbbo_bid, Number.NaN);
                    const nbboAsk = parseNumber(features.nbbo_ask, Number.NaN);
                    const nbboMid = parseNumber(features.nbbo_mid, Number.NaN);
                    const nbboSpread = parseNumber(features.nbbo_spread, Number.NaN);
                    const aggressiveBuyRatio = parseNumber(
                      features.nbbo_aggressive_buy_ratio,
                      Number.NaN
                    );
                    const aggressiveSellRatio = parseNumber(
                      features.nbbo_aggressive_sell_ratio,
                      Number.NaN
                    );
                    const aggressiveCoverage = parseNumber(
                      features.nbbo_coverage_ratio,
                      Number.NaN
                    );
                    const insideRatio = parseNumber(features.nbbo_inside_ratio, Number.NaN);
                    const nbboAge = parseNumber(packet.join_quality.nbbo_age_ms, Number.NaN);
                    const nbboStale = parseNumber(packet.join_quality.nbbo_stale, 0) > 0;
                    const nbboMissing = parseNumber(packet.join_quality.nbbo_missing, 0) > 0;
                    const structureLabel = structureType
                      ? `${structureType.replace(/_/g, " ")}${structureRights ? ` ${structureRights}` : ""}${structureLegs > 0 ? ` ${structureLegs}L` : ""}${structureStrikes > 0 ? ` ${structureStrikes}K` : ""}`
                      : "--";
                    const nbboLabel =
                      Number.isFinite(nbboBid) && Number.isFinite(nbboAsk)
                        ? `${formatPrice(nbboBid)} x ${formatPrice(nbboAsk)}`
                        : Number.isFinite(nbboMid)
                          ? `Mid ${formatPrice(nbboMid)}`
                          : "--";
                    const qualityLabel = [
                      Number.isFinite(aggressiveCoverage) && aggressiveCoverage > 0
                        ? `Agg ${formatPct(aggressiveBuyRatio)}/${formatPct(aggressiveSellRatio)} ${formatPct(aggressiveCoverage)} cov`
                        : null,
                      Number.isFinite(insideRatio) && insideRatio > 0
                        ? `In ${formatPct(insideRatio)}`
                        : null,
                      Number.isFinite(nbboSpread) ? `Spr ${formatPrice(nbboSpread)}` : null,
                      Number.isFinite(nbboAge) ? `${Math.round(nbboAge)}ms` : null,
                      nbboStale ? "Stale" : null,
                      nbboMissing ? "Missing" : null
                    ]
                      .filter(Boolean)
                      .join(" | ");

                    return (
                      <div
                        className={`data-table-row data-table-row-flow data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}${nbboStale || nbboMissing ? " data-table-row-warn" : ""}`}
                        key={key}
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatTime(startTs)} → {formatTime(endTs)}
                        </span>
                        <span className="data-table-cell">{contract}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatFlowMetric(count)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatFlowMetric(totalSize)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          ${formatUsd(notional)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {windowMs > 0 ? formatFlowMetric(windowMs, "ms") : "--"}
                        </span>
                        <span className="data-table-cell">{structureLabel}</span>
                        <span className="data-table-cell data-table-cell-number">{nbboLabel}</span>
                        <span className="data-table-cell">{qualityLabel || "--"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type AlertsPaneProps = {
  state: TerminalState;
  limit?: number;
  withStrip?: boolean;
  className?: string;
};

const AlertsPane = memo(({ state, limit, withStrip = false, className }: AlertsPaneProps) => {
  const items = limit ? state.filteredAlerts.slice(0, limit) : state.filteredAlerts;
  const virtual = useTapeVirtualList(
    items,
    state.alertsScroll.listRef,
    getTapeVirtualConfig("alerts")
  );
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("alerts")
  );

  return (
    <Pane
      className={className}
      title="Alerts"
      status={
        <TapeStatus
          status={state.alerts.status}
          lastUpdate={state.alerts.lastUpdate}
          replayTime={state.alerts.replayTime}
          replayComplete={state.alerts.replayComplete}
          paused={state.alerts.paused}
          dropped={state.alerts.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.alerts.paused}
          onTogglePause={state.alerts.togglePause}
          isAtTop={state.alertsScroll.isAtTop}
          missed={state.alertsScroll.missed}
          onJump={state.alertsScroll.jumpToTop}
        />
      }
    >
      {withStrip ? <AlertSeverityStrip alerts={state.filteredAlerts} /> : null}
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No alerts match the current filter."
              : state.mode === "live"
                ? "No alerts yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-alerts" role="table" aria-label="Alerts">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">ALERT</span>
                <span className="data-table-cell">SEV</span>
                <span className="data-table-cell">SCORE</span>
                <span className="data-table-cell">HITS</span>
                <span className="data-table-cell">DIR</span>
                <span className="data-table-cell">NOTE</span>
              </div>
              <div className="data-table-scroll" ref={state.alertsScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {virtual.virtualItems.map(({ item: alert, key, index, start, size }) => {
                    const primary = alert.hits[0];
                    const direction = deriveAlertDirection(alert);
                    const severity = normalizeAlertSeverity(alert);

                    return (
                      <button
                        className={`data-table-row data-table-row-button data-table-row-alerts data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-severity-${severity}`}
                        key={key}
                        type="button"
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                        onClick={() => {
                          state.setSelectedNewsStory(null);
                          state.setSelectedDarkEvent(null);
                          state.setSelectedClassifierHit(null);
                          state.setSelectedSmartFlowProjection(null);
                          state.setSelectedSmartMoneyEvent(null);
                          state.setSelectedAlert(alert);
                        }}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatTime(alert.source_ts)}
                        </span>
                        <span className="data-table-cell">
                          {primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}
                        </span>
                        <span className="data-table-cell">{severity}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {Math.round(alert.score)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {alert.hits.length}
                        </span>
                        <span className="data-table-cell">{direction}</span>
                        <span className="data-table-cell">
                          {primary?.explanations?.[0] ?? "--"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type NewsPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

const formatNewsSymbolsLabel = (story: NewsStory): string => {
  if (story.resolved_symbols.length === 0) {
    return story.symbol_resolution === "none" ? "unmapped" : "market";
  }
  const visible = story.resolved_symbols.slice(0, 4);
  const extra = story.resolved_symbols.length - visible.length;
  return extra > 0 ? `${visible.join(", ")} +${extra}` : visible.join(", ");
};

const getNewsWireStatus = (story: NewsStory): "updated" | "mapped" | "unmapped" => {
  if (story.updated_ts > story.published_ts) {
    return "updated";
  }
  return story.resolved_symbols.length > 0 ? "mapped" : "unmapped";
};

const openNewsStory = (state: TerminalState, story: NewsStory): void => {
  state.setSelectedNewsStory(null);
  state.setSelectedAlert(null);
  state.setSelectedClassifierHit(null);
  state.setSelectedSmartFlowProjection(null);
  state.setSelectedSmartMoneyEvent(null);
  state.setSelectedDarkEvent(null);
  state.setSelectedNewsStory(story);
};

const NewsPane = memo(({ state, limit, className }: NewsPaneProps) => {
  const items = limit ? state.filteredNews.slice(0, limit) : state.filteredNews;
  const virtual = useTapeVirtualList(items, state.newsScroll.listRef, getTapeVirtualConfig("news"));
  const newsHistorySubscription = state.liveSession.manifest.find(
    (subscription) => subscription.channel === "news"
  );
  const newsHistoryKey = newsHistorySubscription
    ? getLiveSubscriptionKey(newsHistorySubscription)
    : null;
  const newsHistoryLoading = newsHistoryKey
    ? Boolean(state.liveSession.historyLoading[newsHistoryKey])
    : false;
  const newsHistoryError = newsHistoryKey ? state.liveSession.historyErrors[newsHistoryKey] : null;
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("news")
  );

  return (
    <Pane
      className={className}
      title="News Wire"
      status={
        <TapeStatus
          status={state.news.status}
          lastUpdate={state.news.lastUpdate}
          replayTime={state.news.replayTime}
          replayComplete={state.news.replayComplete}
          paused={state.news.paused}
          dropped={state.news.dropped}
          mode={state.mode}
        />
      }
      actions={
        limit ? (
          <Link className="terminal-button terminal-link-button" href="/news">
            View all
          </Link>
        ) : (
          <TapeControls
            mode={state.mode}
            paused={state.news.paused}
            onTogglePause={state.news.togglePause}
            isAtTop={state.newsScroll.isAtTop}
            missed={state.newsScroll.missed}
            onJump={state.newsScroll.jumpToTop}
          />
        )
      }
    >
      <div className="data-table-shell news-wire-shell">
        {state.mode === "live" && newsHistoryError ? (
          <div className="history-load-warning" role="status">
            Older news history failed to load: {newsHistoryError}
          </div>
        ) : null}
        {state.mode === "live" && newsHistoryLoading ? (
          <div className="history-load-warning history-load-muted" role="status">
            Loading older wire history.
          </div>
        ) : null}
        {state.mode === "replay" ? (
          <div className="empty">News is live only in v1.</div>
        ) : items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No news stories match the current filter."
              : "Waiting for live news stories."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-news" role="table" aria-label="News wire">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">SOURCE</span>
                <span className="data-table-cell">SYMBOLS</span>
                <span className="data-table-cell">STATE</span>
                <span className="data-table-cell">HEADLINE</span>
                <span className="data-table-cell">SUMMARY</span>
              </div>
              <div className="data-table-scroll" ref={state.newsScroll.setListRef}>
                <div
                  className="data-table-body"
                  style={{ height: `${virtual.totalSize}px` }}
                  aria-hidden={virtual.virtualItems.length === 0}
                >
                  {virtual.virtualItems.map(({ item: story, key, index, start, size }) => {
                    const wireStatus = getNewsWireStatus(story);
                    const headline = decodeNewsText(story.headline);
                    const summary = decodeNewsText(story.summary || story.provider);
                    return (
                      <button
                        className={`data-table-row data-table-row-button data-table-row-news data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} news-wire-row-${wireStatus}`}
                        key={key}
                        type="button"
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                        onClick={() => openNewsStory(state, story)}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatNewsTimestamp(story.published_ts)}
                        </span>
                        <span className="data-table-cell">{story.source}</span>
                        <span className="data-table-cell">{formatNewsSymbolsLabel(story)}</span>
                        <span className="data-table-cell">
                          <span className={`news-state news-state-${wireStatus}`}>
                            {wireStatus}
                          </span>
                        </span>
                        <span className="data-table-cell news-headline-cell">{headline}</span>
                        <span className="data-table-cell news-summary-cell">{summary}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type ClassifierPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

const ClassifierPane = memo(({ state, limit, className }: ClassifierPaneProps) => {
  const smartFlowItems = limit
    ? state.filteredSmartFlowProjections.slice(0, limit)
    : state.filteredSmartFlowProjections;
  const legacySmartMoneyItems =
    smartFlowItems.length === 0
      ? limit
        ? state.filteredSmartMoneyEvents.slice(0, limit)
        : state.filteredSmartMoneyEvents
      : [];
  const legacyItems =
    smartFlowItems.length === 0 && legacySmartMoneyItems.length === 0
      ? limit
        ? state.filteredClassifierHits.slice(0, limit)
        : state.filteredClassifierHits
      : [];
  const items: Array<SmartFlowExplainabilityProjection | SmartMoneyEvent | ClassifierHitEvent> =
    smartFlowItems.length > 0
      ? smartFlowItems
      : legacySmartMoneyItems.length > 0
        ? legacySmartMoneyItems
        : legacyItems;
  const virtual = useTapeVirtualList(
    items,
    state.classifierScroll.listRef,
    getTapeVirtualConfig("classifier")
  );
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => {
      void state.liveSession.loadOlder("smart-flow");
      void state.liveSession.loadOlder("smart-money");
      void state.liveSession.loadOlder("classifier-hits");
    }
  );
  const showingSmartFlow = smartFlowItems.length > 0;
  const showingSmartMoney = !showingSmartFlow && legacySmartMoneyItems.length > 0;

  return (
    <Pane
      className={className}
      title="Flow Hypotheses"
      status={
        <TapeStatus
          status={state.smartFlow.status}
          lastUpdate={
            state.smartFlow.lastUpdate ??
            state.smartMoney.lastUpdate ??
            state.classifierHits.lastUpdate
          }
          replayTime={
            state.smartFlow.replayTime ??
            state.smartMoney.replayTime ??
            state.classifierHits.replayTime
          }
          replayComplete={
            state.smartFlow.replayComplete ||
            state.smartMoney.replayComplete ||
            state.classifierHits.replayComplete
          }
          paused={state.smartFlow.paused}
          dropped={state.smartFlow.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.smartFlow.paused}
          onTogglePause={state.smartFlow.togglePause}
          isAtTop={state.classifierScroll.isAtTop}
          missed={state.classifierScroll.missed}
          onJump={state.classifierScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No smart-flow hypotheses match the current filter."
              : state.mode === "live"
                ? "No smart-flow hypotheses yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div
              className={`data-table ${
                showingSmartFlow ? "data-table-smart-flow" : "data-table-classifier"
              }`}
              role="table"
              aria-label={showingSmartFlow ? "Smart-flow hypotheses" : "Compatibility classifiers"}
            >
              {showingSmartFlow ? (
                <div className="data-table-head" role="row">
                  <span className="data-table-cell">TIME</span>
                  <span className="data-table-cell">HYPOTHESIS</span>
                  <span className="data-table-cell">DIR</span>
                  <span className="data-table-cell">CONF</span>
                  <span className="data-table-cell">CONV</span>
                  <span className="data-table-cell">EVIDENCE</span>
                  <span className="data-table-cell">WHY-NOT</span>
                </div>
              ) : (
                <div className="data-table-head" role="row">
                  <span className="data-table-cell">TIME</span>
                  <span className="data-table-cell">PROFILE</span>
                  <span className="data-table-cell">DIR</span>
                  <span className="data-table-cell">PROB</span>
                  <span className="data-table-cell">NOTE</span>
                </div>
              )}
              <div className="data-table-scroll" ref={state.classifierScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {showingSmartFlow
                    ? virtual.virtualItems.map(({ item, key, index, start, size }) => {
                        const projection = item as SmartFlowExplainabilityProjection;
                        const hypothesis = projection.hypothesis;
                        const scores = hypothesis.scores.confidence;
                        const direction = smartFlowDirectionLabel(projection);
                        const rowDirection = smartFlowDirectionTone(projection);
                        const evidenceQuality = smartFlowEvidenceQualityLabel(
                          projection.evidence.evidence_quality
                        );
                        return (
                          <button
                            className={`data-table-row data-table-row-button data-table-row-classifier data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-direction-${rowDirection}`}
                            key={key}
                            type="button"
                            data-index={index}
                            data-row-start={String(start)}
                            data-row-size={String(size)}
                            data-tape-key={key}
                            style={{ transform: `translateY(${start}px)` }}
                            onClick={() => state.openFromSmartFlowProjection(projection)}
                          >
                            <span className="data-table-cell data-table-cell-number">
                              {formatTime(projection.source_ts)}
                            </span>
                            <span className="data-table-cell">
                              {smartFlowHypothesisLabel(hypothesis.hypothesis_type)}
                            </span>
                            <span className="data-table-cell">{direction}</span>
                            <span className="data-table-cell data-table-cell-number">
                              {formatConfidence(scores.policy_confidence)}
                            </span>
                            <span className="data-table-cell data-table-cell-number">
                              {formatConfidence(scores.conviction)}
                            </span>
                            <span className="data-table-cell">
                              {evidenceQuality} /{" "}
                              {formatConfidence(projection.evidence.evidence_quality)}
                            </span>
                            <span className="data-table-cell">
                              {smartFlowWhyNotLabel(projection)}
                            </span>
                          </button>
                        );
                      })
                    : showingSmartMoney
                      ? virtual.virtualItems.map(({ item, key, index, start, size }) => {
                          const event = item as SmartMoneyEvent;
                          const primaryScore =
                            event.profile_scores.find(
                              (score) => score.profile_id === event.primary_profile_id
                            ) ?? event.profile_scores[0];
                          const direction = normalizeDirection(event.primary_direction);
                          return (
                            <button
                              className={`data-table-row data-table-row-button data-table-row-classifier data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-direction-${direction}`}
                              key={key}
                              type="button"
                              data-index={index}
                              data-row-start={String(start)}
                              data-row-size={String(size)}
                              data-tape-key={key}
                              style={{ transform: `translateY(${start}px)` }}
                              onClick={() => state.openFromSmartMoneyEvent(event)}
                            >
                              <span className="data-table-cell data-table-cell-number">
                                {formatTime(event.source_ts)}
                              </span>
                              <span className="data-table-cell">
                                {smartMoneyProfileLabel(event.primary_profile_id)}
                              </span>
                              <span className="data-table-cell">{direction}</span>
                              <span className="data-table-cell data-table-cell-number">
                                {primaryScore ? formatConfidence(primaryScore.probability) : "--"}
                              </span>
                              <span className="data-table-cell">
                                {event.abstained
                                  ? (event.suppressed_reasons[0] ?? "abstained")
                                  : (primaryScore?.reasons[0] ??
                                    primaryScore?.confidence_band ??
                                    "--")}
                              </span>
                            </button>
                          );
                        })
                      : virtual.virtualItems.map(({ item, key, index, start, size }) => {
                          const hit = item as ClassifierHitEvent;
                          const direction = normalizeDirection(hit.direction);
                          return (
                            <button
                              className={`data-table-row data-table-row-button data-table-row-classifier data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-direction-${direction}`}
                              key={key}
                              type="button"
                              data-index={index}
                              data-row-start={String(start)}
                              data-row-size={String(size)}
                              data-tape-key={key}
                              style={{ transform: `translateY(${start}px)` }}
                              onClick={() => state.openFromClassifierHit(hit)}
                            >
                              <span className="data-table-cell data-table-cell-number">
                                {formatTime(hit.source_ts)}
                              </span>
                              <span className="data-table-cell">
                                {humanizeClassifierId(hit.classifier_id)}
                              </span>
                              <span className="data-table-cell">{direction}</span>
                              <span className="data-table-cell data-table-cell-number">
                                {formatConfidence(hit.confidence)}
                              </span>
                              <span className="data-table-cell">
                                {hit.explanations?.[0] ?? "--"}
                              </span>
                            </button>
                          );
                        })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type DarkPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

const DarkPane = memo(({ state, limit, className }: DarkPaneProps) => {
  const items = limit ? state.filteredInferredDark.slice(0, limit) : state.filteredInferredDark;
  const virtual = useTapeVirtualList(items, state.darkScroll.listRef, getTapeVirtualConfig("dark"));
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("inferred-dark")
  );

  return (
    <Pane
      className={className}
      title="Dark"
      status={
        <TapeStatus
          status={state.inferredDark.status}
          lastUpdate={state.inferredDark.lastUpdate}
          replayTime={state.inferredDark.replayTime}
          replayComplete={state.inferredDark.replayComplete}
          paused={state.inferredDark.paused}
          dropped={state.inferredDark.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.inferredDark.paused}
          onTogglePause={state.inferredDark.togglePause}
          isAtTop={state.darkScroll.isAtTop}
          missed={state.darkScroll.missed}
          onJump={state.darkScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No inferred dark events match the current filter."
              : state.mode === "live"
                ? "No inferred dark events yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-dark" role="table" aria-label="Dark events">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">TYPE</span>
                <span className="data-table-cell">SYM</span>
                <span className="data-table-cell">CONF</span>
                <span className="data-table-cell">EVIDENCE</span>
                <span className="data-table-cell">NOTE</span>
              </div>
              <div className="data-table-scroll" ref={state.darkScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {virtual.virtualItems.map(({ item: event, key, index, start, size }) => {
                    const underlying = inferDarkUnderlying(event, state.equityJoinMap);
                    const evidenceCount = event.evidence_refs.length;

                    return (
                      <button
                        className={`data-table-row data-table-row-button data-table-row-dark data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}`}
                        key={key}
                        type="button"
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                        onClick={() => {
                          state.setSelectedNewsStory(null);
                          state.setSelectedAlert(null);
                          state.setSelectedClassifierHit(null);
                          state.setSelectedSmartFlowProjection(null);
                          state.setSelectedSmartMoneyEvent(null);
                          state.setSelectedDarkEvent(event);
                        }}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatTime(event.source_ts)}
                        </span>
                        <span className="data-table-cell">{humanizeClassifierId(event.type)}</span>
                        <span className="data-table-cell">{underlying ?? "Unknown"}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatConfidence(event.confidence)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {evidenceCount}
                        </span>
                        <span className="data-table-cell">
                          {underlying ? "--" : "Underlying not in current join cache."}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

type ChartPaneProps = {
  state: TerminalState;
  title?: string;
};

const ChartPane = memo(({ state, title = "Chart" }: ChartPaneProps) => {
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

const CommandMetricsStrip = ({ state }: { state: TerminalState }) => {
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

const CommandPriorityBoard = ({ state }: { state: TerminalState }) => {
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

const CommandDecisionLevels = ({ state }: { state: TerminalState }) => {
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

const CommandDeckHeader = ({ state }: { state: TerminalState }) => {
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

const CommandSymbolRail = ({ state }: { state: TerminalState }) => {
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

const FeedHealthPane = ({ state }: { state: TerminalState }) => {
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

const EventContextPane = ({ state }: { state: TerminalState }) => {
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

const HomeReplayRail = ({ state }: { state: TerminalState }) => {
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

const FocusPane = memo(({ state }: { state: TerminalState }) => {
  const smartFlowHits = state.chartSmartFlowProjections.slice(-10).reverse();
  const legacyHits =
    smartFlowHits.length === 0 ? state.chartSmartMoneyEvents.slice(-10).reverse() : [];
  const dark = state.chartInferredDark.slice(-10).reverse();

  return (
    <Pane title="Focus">
      <div className="focus-stack">
        <div className="focus-block">
          <div className="focus-label">Ticker</div>
          <div className="focus-value">{state.chartTicker}</div>
        </div>
        <div className="focus-block">
          <div className="focus-label">
            {smartFlowHits.length > 0 ? "Flow hypotheses" : "Flow markers"}
          </div>
          {smartFlowHits.length === 0 && legacyHits.length === 0 ? (
            <div className="empty">No smart-flow hypotheses for {state.chartTicker}.</div>
          ) : smartFlowHits.length > 0 ? (
            <div className="list terminal-list terminal-list-compact">
              {smartFlowHits.map((projection) => {
                const tone = smartFlowDirectionTone(projection);
                return (
                  <button
                    className="row row-button"
                    key={`${projection.refs.hypothesis_id}-${projection.seq}`}
                    type="button"
                    onClick={() => state.openFromSmartFlowProjection(projection)}
                  >
                    <div>
                      <div className="contract">
                        {smartFlowHypothesisLabel(projection.hypothesis.hypothesis_type)}
                      </div>
                      <div className="meta">
                        <span className={`pill direction-${tone}`}>
                          {smartFlowDirectionLabel(projection)}
                        </span>
                        <span>
                          {smartFlowEvidenceQualityLabel(projection.evidence.evidence_quality)}{" "}
                          evidence
                        </span>
                        {projection.source_channel === "smart-money" ? (
                          <span>Compat projection</span>
                        ) : null}
                        <span>{formatTime(projection.source_ts)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="list terminal-list terminal-list-compact">
              {legacyHits.map((hit) => (
                <button
                  className="row row-button"
                  key={`${hit.trace_id}-${hit.seq}`}
                  type="button"
                  onClick={() => state.openFromSmartMoneyEvent(hit)}
                >
                  <div>
                    <div className="contract">
                      Compatibility: {smartMoneyProfileLabel(hit.primary_profile_id)}
                    </div>
                    <div className="meta">
                      <span
                        className={`pill direction-${normalizeDirection(hit.primary_direction)}`}
                      >
                        {normalizeDirection(hit.primary_direction)}
                      </span>
                      <span>{formatTime(hit.source_ts)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="focus-block">
          <div className="focus-label">Dark</div>
          {dark.length === 0 ? (
            <div className="empty">No inferred dark events for {state.chartTicker}.</div>
          ) : (
            <div className="list terminal-list terminal-list-compact">
              {dark.map((event) => (
                <button
                  className="row row-button"
                  key={`${event.trace_id}-${event.seq}`}
                  type="button"
                  onClick={() => state.handleDarkMarkerClick(event)}
                >
                  <div>
                    <div className="contract">{humanizeClassifierId(event.type)}</div>
                    <div className="meta">
                      <span>Confidence {formatConfidence(event.confidence)}</span>
                      <span>{formatTime(event.source_ts)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Pane>
  );
});

const ReplayConsole = memo(({ state }: { state: TerminalState }) => {
  const replayActive = state.mode === "replay";

  return (
    <Pane
      title="Console"
      actions={
        <button
          className="terminal-button terminal-button-primary"
          type="button"
          onClick={state.toggleMode}
        >
          {replayActive ? "Switch Live" : "Switch Replay"}
        </button>
      }
    >
      <div className="replay-matrix">
        <div className="overview-cell">
          <span className="overview-label">Mode</span>
          <strong>{replayActive ? "Replay" : "Live"}</strong>
        </div>
        <div className="overview-cell">
          <span className="overview-label">Source</span>
          <strong>{state.replaySource ? state.replaySource.toUpperCase() : "Auto"}</strong>
        </div>
        <div className="overview-cell">
          <span className="overview-label">Replay Clock</span>
          <strong>{state.options.replayTime ? formatTime(state.options.replayTime) : "—"}</strong>
        </div>
        <div className="overview-cell">
          <span className="overview-label">Packets</span>
          <strong>{formatFlowMetric(state.filteredFlow.length)}</strong>
        </div>
      </div>
    </Pane>
  );
});

const OpraIntakeRail = ({ state }: { state: TerminalState }) => {
  const contractActive = state.selectedInstrument?.kind === "option-contract";
  const contractLabel = contractActive
    ? (state.selectedInstrumentLabel ?? "Contract focus")
    : "No contract focus";
  const filterCount = countActiveFlowFilterGroups(state.flowFilters);

  return (
    <section className="opra-command-rail" aria-label="OPRA intake controls">
      <div className="opra-command-cell">
        <span>Mode</span>
        <strong>{state.mode === "live" ? "OPRA Live" : "Replay"}</strong>
        <em>{state.options.lastUpdate ? formatTime(state.options.lastUpdate) : "waiting"}</em>
      </div>
      <div className="opra-command-cell">
        <span>Scope</span>
        <strong>
          {state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "All symbols"}
        </strong>
        <em>{state.filteredOptions.length} prints visible</em>
      </div>
      <div className="opra-command-cell">
        <span>Contract</span>
        <strong>{contractLabel}</strong>
        <em>{contractActive ? "click clear to release" : "select any option row"}</em>
      </div>
      <div className="opra-command-cell">
        <span>Flow Filters</span>
        <strong>{filterCount > 0 ? `${filterCount} active` : "baseline"}</strong>
        <em>{state.flowFilters.view === "raw" ? "all prints" : "signal view"}</em>
      </div>
      <div className="opra-command-actions">
        <button
          className={`terminal-button contract-filter-button${contractActive ? " is-active" : ""}`}
          type="button"
          disabled={!contractActive}
          onClick={() => state.setSelectedInstrument(null)}
          title={
            contractActive ? "Clear active contract filter" : "Focus a contract in the OPRA tape"
          }
        >
          <span className="contract-filter-button-label">
            {contractActive ? "Clear Contract" : "Contract Focus"}
          </span>
        </button>
        <FlowFilterPopover filters={state.flowFilters} onChange={state.setFlowFilters} />
      </div>
    </section>
  );
};

const NewsControlRails = ({ state }: { state: TerminalState }) => {
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of state.filteredNews) {
      counts.set(story.source, (counts.get(story.source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [state.filteredNews]);
  const symbols = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of state.filteredNews) {
      for (const symbol of story.resolved_symbols) {
        const normalized = symbol.toUpperCase();
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [state.filteredNews]);
  const statusRows = [
    {
      label: "Wire",
      value:
        state.mode === "live"
          ? statusLabel(state.news.status, state.news.paused, state.mode)
          : "Live only",
      detail: state.news.lastUpdate ? formatTime(state.news.lastUpdate) : "waiting"
    },
    {
      label: "Stories",
      value: formatFlowMetric(state.filteredNews.length),
      detail: state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "all symbols"
    },
    {
      label: "History",
      value: state.mode === "live" ? "scroll gate" : "disabled",
      detail: state.newsScroll.isAtTop ? "at live head" : `${state.newsScroll.missed} queued`
    }
  ];

  return (
    <section className="wire-control-rails" aria-label="Wire control rails">
      <div className="wire-status-rail">
        {statusRows.map((row) => (
          <div className="wire-rail-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <em>{row.detail}</em>
          </div>
        ))}
      </div>
      <div className="wire-source-rail" aria-label="News sources">
        <span className="wire-rail-label">Sources</span>
        {sources.length === 0 ? (
          <span className="wire-empty-label">waiting</span>
        ) : (
          sources.map(([source, count]) => (
            <span className="wire-source-pill" key={source}>
              <strong>{source}</strong>
              <em>{count}</em>
            </span>
          ))
        )}
      </div>
      <div className="wire-symbol-rail" aria-label="News symbols">
        <span className="wire-rail-label">Symbols</span>
        {symbols.length === 0 ? (
          <span className="wire-empty-label">unmapped</span>
        ) : (
          symbols.map(([symbol, count]) => (
            <button key={symbol} type="button" onClick={() => state.setFilterInput(symbol)}>
              <strong>{symbol}</strong>
              <em>{count}</em>
            </button>
          ))
        )}
      </div>
    </section>
  );
};

const renderTerminalDrawers: TerminalDrawersRenderer = (state) => (
  <>
    {state.selectedAlert ? (
      <AlertDrawer
        alert={state.selectedAlert}
        flowPacket={state.selectedFlowPacket}
        evidence={state.selectedEvidence}
        contextStatus={state.selectedAlertContextStatus}
        onClose={() => state.setSelectedAlert(null)}
      />
    ) : null}

    {state.selectedNewsStory ? (
      <NewsDrawer
        story={state.selectedNewsStory}
        onClose={() => state.setSelectedNewsStory(null)}
      />
    ) : null}

    {state.selectedClassifierHit ? (
      <ClassifierHitDrawer
        hit={state.selectedClassifierHit}
        flowPacket={state.selectedClassifierFlowPacket}
        evidence={state.selectedClassifierEvidence}
        onClose={() => state.setSelectedClassifierHit(null)}
      />
    ) : null}

    {state.selectedSmartFlowProjection ? (
      <SmartFlowDrawer
        projection={state.selectedSmartFlowProjection}
        evidence={state.selectedSmartFlowEvidence}
        onClose={() => state.setSelectedSmartFlowProjection(null)}
      />
    ) : null}

    {state.selectedSmartMoneyEvent ? (
      <SmartMoneyDrawer
        event={state.selectedSmartMoneyEvent}
        flowPacket={state.selectedSmartMoneyFlowPacket}
        evidence={state.selectedSmartMoneyEvidence}
        onClose={() => state.setSelectedSmartMoneyEvent(null)}
      />
    ) : null}

    {state.selectedDarkEvent ? (
      <DarkDrawer
        event={state.selectedDarkEvent}
        evidence={state.selectedDarkEvidence}
        underlying={state.selectedDarkUnderlying}
        onClose={() => state.setSelectedDarkEvent(null)}
      />
    ) : null}
  </>
);

export function TerminalAppShell({ children }: { children: ReactNode }) {
  return (
    <TerminalFeatureAppShell renderDrawers={renderTerminalDrawers}>
      {children}
    </TerminalFeatureAppShell>
  );
}

export function OverviewRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Market Command" eyebrow="Dashboard" variant="dashboard">
      <div className="market-command-shell">
        <CommandDeckHeader state={state} />
        <CommandMetricsStrip state={state} />
        <CommandSymbolRail state={state} />
        <div className="market-command-grid">
          <CommandPriorityBoard state={state} />
          <ChartPane state={state} title="Chart Context" />
          <CommandDecisionLevels state={state} />
          <OptionsPane
            state={state}
            limit={12}
            title="Recent Contracts"
            className="command-contracts-pane"
          />
          <FeedHealthPane state={state} />
          <EventContextPane state={state} />
          <HomeReplayRail state={state} />
        </div>
      </div>
    </PageFrame>
  );
}

export function NewsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Newswire" eyebrow="News" variant="news">
      <div className="wire-control-shell">
        <NewsControlRails state={state} />
        <NewsPane state={state} className="news-pane-full" />
      </div>
    </PageFrame>
  );
}

export function OptionsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="OPRA Intake" eyebrow="Options" variant="options">
      <div className="opra-intake-shell">
        <OpraIntakeRail state={state} />
        <div className="opra-intake-grid">
          <OptionsPane state={state} title="OPRA Tape" className="opra-options-pane" />
          <FlowPane state={state} title="Packet Fit" className="opra-flow-pane" />
        </div>
      </div>
    </PageFrame>
  );
}

export function SignalsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Signals">
      <div className="page-grid page-grid-signals">
        <AlertsPane state={state} withStrip className="signals-pane-alerts" />
        <ClassifierPane state={state} className="signals-pane-rules" />
        <DarkPane state={state} className="signals-pane-dark" />
      </div>
    </PageFrame>
  );
}

export function ChartsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Charts">
      <div className="page-grid page-grid-charts">
        <ChartPane state={state} title="Price" />
        <FocusPane state={state} />
      </div>
    </PageFrame>
  );
}

export function ReplayRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Replay">
      <div className="page-grid page-grid-replay">
        <ReplayConsole state={state} />
        <AlertsPane state={state} limit={10} withStrip />
        <FlowPane state={state} limit={12} />
        <OptionsPane state={state} limit={12} />
      </div>
    </PageFrame>
  );
}
