"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  AlertEvent,
  ClassifierHitEvent,
  Cursor,
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  EquityQuote,
  FlowPacket,
  InferredDarkEvent,
  LiveServerMessage,
  LiveHotChannelHealthMap,
  LiveSubscription,
  NewsStory,
  OptionFlowFilters,
  OptionFlowView,
  OptionNbboSide,
  OptionSecurityType,
  OptionType,
  OptionNBBO,
  OptionPrint,
  SmartMoneyEvent,
  SmartMoneyProfileId,
  SyntheticControlState,
  SyntheticCoverageWindowMinutes,
  SyntheticDerivedStatus,
  SyntheticProfileWeightValue
} from "@islandflow/types";
import {
  getSubscriptionKey as getLiveSubscriptionKey,
  parseOptionContractId,
  matchesFlowPacketFilters,
  matchesOptionPrintFilters
} from "@islandflow/types";
import { createChart, type IChartApi, type SeriesMarker, type UTCTimestamp } from "lightweight-charts";

const parseBoundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const LIVE_HOT_WINDOW = parseBoundedInt(process.env.NEXT_PUBLIC_LIVE_HOT_WINDOW, 600, 1, 100000);
const LIVE_HOT_WINDOW_OPTIONS = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HOT_WINDOW_OPTIONS,
  1200,
  1,
  100000
);
const LIVE_OPTIONS_HEAD_LIMIT = 100;
const LIVE_HISTORY_SOFT_CAP = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HISTORY_SOFT_CAP,
  5000,
  100,
  50000
);
const LIVE_HISTORY_BATCH = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HISTORY_BATCH,
  500,
  1,
  1000
);
const LIVE_OPTIONS_STALE_MS = 15_000;
const LIVE_NBBO_STALE_MS = 15_000;
const LIVE_EQUITIES_STALE_MS = 15_000;
const LIVE_FEED_BEHIND_DELAY_MS = 15_000;
const LIVE_EQUITIES_SILENT_WARNING_MS = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_EQUITIES_SILENT_WARNING_MS,
  25_000,
  5_000,
  5 * 60 * 1000
);
const LIVE_FLOW_STALE_MS = 30_000;
const PINNED_EVIDENCE_TTL_MS = parseBoundedInt(
  process.env.NEXT_PUBLIC_PINNED_EVIDENCE_TTL_MS,
  20 * 60 * 1000,
  60 * 1000,
  2 * 60 * 60 * 1000
);
const PINNED_EVIDENCE_MAX_ITEMS = parseBoundedInt(
  process.env.NEXT_PUBLIC_PINNED_EVIDENCE_MAX_ITEMS,
  4000,
  100,
  50000
);
const NBBO_MAX_AGE_MS = Number(process.env.NEXT_PUBLIC_NBBO_MAX_AGE_MS);
const NBBO_MAX_AGE_MS_SAFE =
  Number.isFinite(NBBO_MAX_AGE_MS) && NBBO_MAX_AGE_MS > 0 ? NBBO_MAX_AGE_MS : 1000;
const FLOW_FILTER_PRESET = process.env.NEXT_PUBLIC_FLOW_FILTER_PRESET ?? "smart-money";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const CANDLE_INTERVALS = [
  { label: "1m", ms: 60000 },
  { label: "5m", ms: 300000 }
];
const LIVE_SESSION_IDLE_RECONNECT_MS = 12_000;
const LIVE_SESSION_IDLE_CHECK_MS = 3_000;
const LIVE_SESSION_HOT_CHANNELS = new Set<LiveSubscription["channel"]>([
  "options",
  "nbbo",
  "equities",
  "flow",
  "equity-overlay"
]);

type TapeVirtualPane = "options" | "equities" | "flow" | "alerts" | "classifier" | "dark";

type TapeVirtualListConfig = {
  rowHeight: number;
  overscan: number;
  debugLabel: TapeVirtualPane;
};

const TAPE_VIRTUAL_CONFIG: Record<TapeVirtualPane, TapeVirtualListConfig> = {
  options: { rowHeight: 36, overscan: 44, debugLabel: "options" },
  equities: { rowHeight: 36, overscan: 36, debugLabel: "equities" },
  flow: { rowHeight: 44, overscan: 24, debugLabel: "flow" },
  alerts: { rowHeight: 44, overscan: 24, debugLabel: "alerts" },
  classifier: { rowHeight: 44, overscan: 24, debugLabel: "classifier" },
  dark: { rowHeight: 44, overscan: 24, debugLabel: "dark" }
};

export const getTapeVirtualConfig = (pane: TapeVirtualPane): TapeVirtualListConfig =>
  TAPE_VIRTUAL_CONFIG[pane];

type RouteFeatures = {
  options: boolean;
  nbbo: boolean;
  equities: boolean;
  flow: boolean;
  news: boolean;
  alerts: boolean;
  smartMoney: boolean;
  classifierHits: boolean;
  inferredDark: boolean;
  equityJoins: boolean;
  equityCandles: boolean;
  equityOverlay: boolean;
  showOptionsPane: boolean;
  showEquitiesPane: boolean;
  showFlowPane: boolean;
  showNewsPane: boolean;
  showAlertsPane: boolean;
  showClassifierPane: boolean;
  showDarkPane: boolean;
  showChartPane: boolean;
  showFocusPane: boolean;
  showReplayConsole: boolean;
  needsClassifierDecor: boolean;
  needsAlertEvidencePrefetch: boolean;
  needsDarkUnderlying: boolean;
};

export const shouldIncludeEquitiesForDarkUnderlyingFallback = (): boolean => {
  return false;
};

export const getRouteFeatures = (pathname: string): RouteFeatures => {
  const includeEquitiesFallback = shouldIncludeEquitiesForDarkUnderlyingFallback();
  const normalizedPath =
    pathname === "/tape" ||
    pathname === "/news" ||
    pathname === "/signals" ||
    pathname === "/charts" ||
    pathname === "/replay"
      ? pathname
      : "/";

  switch (normalizedPath) {
    case "/tape":
      return {
        options: true,
        nbbo: true,
        equities: true,
        flow: true,
        news: false,
        alerts: false,
        smartMoney: false,
        classifierHits: false,
        inferredDark: false,
        equityJoins: false,
        equityCandles: false,
        equityOverlay: false,
        showOptionsPane: true,
        showEquitiesPane: true,
        showFlowPane: true,
        showNewsPane: false,
        showAlertsPane: false,
        showClassifierPane: false,
        showDarkPane: false,
        showChartPane: false,
        showFocusPane: false,
        showReplayConsole: false,
        needsClassifierDecor: true,
        needsAlertEvidencePrefetch: false,
        needsDarkUnderlying: false
      };
    case "/news":
      return {
        options: false,
        nbbo: false,
        equities: false,
        flow: false,
        news: true,
        alerts: false,
        smartMoney: false,
        classifierHits: false,
        inferredDark: false,
        equityJoins: false,
        equityCandles: false,
        equityOverlay: false,
        showOptionsPane: false,
        showEquitiesPane: false,
        showFlowPane: false,
        showNewsPane: true,
        showAlertsPane: false,
        showClassifierPane: false,
        showDarkPane: false,
        showChartPane: false,
        showFocusPane: false,
        showReplayConsole: false,
        needsClassifierDecor: false,
        needsAlertEvidencePrefetch: false,
        needsDarkUnderlying: false
      };
    case "/signals":
      return {
        options: false,
        nbbo: false,
        equities: includeEquitiesFallback,
        flow: false,
        news: false,
        alerts: true,
        smartMoney: true,
        classifierHits: true,
        inferredDark: true,
        equityJoins: true,
        equityCandles: false,
        equityOverlay: false,
        showOptionsPane: false,
        showEquitiesPane: false,
        showFlowPane: false,
        showNewsPane: false,
        showAlertsPane: true,
        showClassifierPane: true,
        showDarkPane: true,
        showChartPane: false,
        showFocusPane: false,
        showReplayConsole: false,
        needsClassifierDecor: false,
        needsAlertEvidencePrefetch: true,
        needsDarkUnderlying: true
      };
    case "/charts":
      return {
        options: false,
        nbbo: false,
        equities: includeEquitiesFallback,
        flow: false,
        news: false,
        alerts: false,
        smartMoney: true,
        classifierHits: false,
        inferredDark: true,
        equityJoins: true,
        equityCandles: true,
        equityOverlay: true,
        showOptionsPane: false,
        showEquitiesPane: false,
        showFlowPane: false,
        showNewsPane: false,
        showAlertsPane: false,
        showClassifierPane: false,
        showDarkPane: false,
        showChartPane: true,
        showFocusPane: true,
        showReplayConsole: false,
        needsClassifierDecor: false,
        needsAlertEvidencePrefetch: false,
        needsDarkUnderlying: true
      };
    case "/replay":
      return {
        options: false,
        nbbo: false,
        equities: false,
        flow: false,
        news: false,
        alerts: false,
        smartMoney: false,
        classifierHits: false,
        inferredDark: false,
        equityJoins: false,
        equityCandles: false,
        equityOverlay: false,
        showOptionsPane: true,
        showEquitiesPane: false,
        showFlowPane: true,
        showNewsPane: false,
        showAlertsPane: true,
        showClassifierPane: false,
        showDarkPane: false,
        showChartPane: false,
        showFocusPane: false,
        showReplayConsole: true,
        needsClassifierDecor: true,
        needsAlertEvidencePrefetch: true,
        needsDarkUnderlying: false
      };
    case "/":
    default:
      return {
        options: false,
        nbbo: false,
        equities: true,
        flow: false,
        news: true,
        alerts: true,
        smartMoney: true,
        classifierHits: false,
        inferredDark: true,
        equityJoins: true,
        equityCandles: true,
        equityOverlay: true,
        showOptionsPane: false,
        showEquitiesPane: true,
        showFlowPane: false,
        showNewsPane: true,
        showAlertsPane: true,
        showClassifierPane: false,
        showDarkPane: false,
        showChartPane: true,
        showFocusPane: false,
        showReplayConsole: false,
        needsClassifierDecor: false,
        needsAlertEvidencePrefetch: true,
        needsDarkUnderlying: true
      };
  }
};

const EMPTY_ALERT_EVENTS: AlertEvent[] = [];
const EMPTY_CLASSIFIER_HIT_EVENTS: ClassifierHitEvent[] = [];
const EMPTY_SMART_MONEY_EVENTS: SmartMoneyEvent[] = [];
const EMPTY_INFERRED_DARK_EVENTS: InferredDarkEvent[] = [];
const EMPTY_NEWS_STORIES: NewsStory[] = [];

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

type SelectedInstrument =
  | null
  | { kind: "equity"; underlyingId: string }
  | { kind: "option-contract"; contractId: string; underlyingId: string };

type TapeFocusSeed<T> = {
  scopeKey: string;
  subscriptionKey?: string;
  items: T[];
};

type OptionScope = Pick<
  Extract<LiveSubscription, { channel: "options" }>,
  "underlying_ids" | "option_contract_id"
>;

type EquityScope = Pick<Extract<LiveSubscription, { channel: "equities" }>, "underlying_ids">;

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

const readErrorDetail = async (response: Response): Promise<string> => {
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const text = await response.text();
  if (!text) {
    return statusLabel;
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const trimmed = text.trimStart();
  const truncated = text.length > 600 ? `${text.slice(0, 600)}...` : text;

  if (!contentType.includes("application/json")) {
    if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      return `${statusLabel}: received HTML response instead of JSON`;
    }
    return `${statusLabel}: ${truncated}`;
  }

  try {
    const payload = JSON.parse(text) as {
      detail?: string;
      error?: string;
      message?: string;
    };
    return payload.detail ?? payload.error ?? payload.message ?? `${statusLabel}: ${truncated}`;
  } catch {
    return `${statusLabel}: ${truncated}`;
  }
};

type WsStatus = "connecting" | "connected" | "disconnected" | "stale";

type TapeMode = "live" | "replay";

type MessageType =
  | "option-print"
  | "option-nbbo"
  | "equity-print"
  | "equity-candle"
  | "equity-join"
  | "flow-packet"
  | "smart-money"
  | "inferred-dark"
  | "classifier-hit"
  | "alert";

type StreamMessage<T> = {
  type: MessageType;
  payload: T;
};

type ReplayCursor = {
  ts: number;
  seq: number;
};

type ReplayResponse<T> = {
  data: T[];
  next: ReplayCursor | null;
};

const inferTracePrefix = (traceId: string): string => {
  const match = traceId.match(/^(.*)-\d+$/);
  return match ? match[1] : traceId;
};

const extractTracePrefix = <T,>(item: T): string | null => {
  const traceId = (item as { trace_id?: string }).trace_id;
  if (!traceId) {
    return null;
  }
  return inferTracePrefix(traceId);
};

const extractReplaySource = <T,>(item: T): string | null => {
  const prefix = extractTracePrefix(item);
  if (!prefix) {
    return null;
  }

  const normalized = prefix.toLowerCase();
  if (normalized.startsWith("synthetic")) {
    return "synthetic";
  }
  if (normalized.startsWith("databento")) {
    return "databento";
  }
  if (normalized.startsWith("alpaca")) {
    return "alpaca";
  }
  if (normalized.startsWith("ibkr")) {
    return "ibkr";
  }

  return prefix;
};

type SortableItem = {
  ts?: number;
  source_ts?: number;
  ingest_ts?: number;
  seq?: number;
  trace_id?: string;
  id?: string;
};

type PinnedEntry<T> = {
  value: T;
  updatedAt: number;
};

type OptionContractDisplay = {
  ticker: string;
  strike: string;
  expiration: string;
};

type RetentionMetricKey =
  | "hotWindowEvictions"
  | "pinnedFetchMisses"
  | "pinnedFetchFailures"
  | "pinnedStoreSize";

const frontendRetentionMetrics: Record<RetentionMetricKey, number> = {
  hotWindowEvictions: 0,
  pinnedFetchMisses: 0,
  pinnedFetchFailures: 0,
  pinnedStoreSize: 0
};

const DEV_TAPE_DEBUG = process.env.NODE_ENV !== "production";

type TapeDebugMetricKey =
  | "anchorRestoreCount"
  | "anchorRestoreFallbackCount"
  | "virtualRowMeasurementCount"
  | "focusSeedRowCount"
  | "scopedQuietTransitions";

const frontendTapeDebugMetrics: Record<TapeDebugMetricKey, number> = {
  anchorRestoreCount: 0,
  anchorRestoreFallbackCount: 0,
  virtualRowMeasurementCount: 0,
  focusSeedRowCount: 0,
  scopedQuietTransitions: 0
};

const bumpTapeDebugMetric = (key: TapeDebugMetricKey, count = 1): void => {
  frontendTapeDebugMetrics[key] += count;
  if (DEV_TAPE_DEBUG && typeof window !== "undefined") {
    (window as typeof window & { __IF_TAPE_DEBUG__?: Record<TapeDebugMetricKey, number> }).__IF_TAPE_DEBUG__ =
      frontendTapeDebugMetrics;
  }
};

const logTapeDebug = (message: string, payload?: Record<string, unknown>): void => {
  if (!DEV_TAPE_DEBUG) {
    return;
  }
  if (payload) {
    console.debug(`[tape] ${message}`, payload);
    return;
  }
  console.debug(`[tape] ${message}`);
};

const incrementRetentionMetric = (key: RetentionMetricKey, count = 1): void => {
  frontendRetentionMetrics[key] += count;
};

const setRetentionMetric = (key: RetentionMetricKey, value: number): void => {
  frontendRetentionMetrics[key] = value;
};

const extractSortTs = (item: SortableItem): number =>
  item.ts ?? item.source_ts ?? item.ingest_ts ?? 0;

const extractSortSeq = (item: SortableItem): number => item.seq ?? 0;

const buildItemKey = (item: SortableItem): string | null => {
  if (item.trace_id) {
    return `${item.trace_id}:${item.seq ?? ""}`;
  }

  if (item.id) {
    return `id:${item.id}`;
  }

  return null;
};

export const mergeNewestWithOverflow = <T extends SortableItem>(
  incoming: T[],
  existing: T[],
  limit = LIVE_HOT_WINDOW,
  onTrim?: (evicted: number) => void
): { kept: T[]; evicted: T[] } => {
  const combined = [...incoming, ...existing];
  if (combined.length === 0) {
    return { kept: combined, evicted: [] };
  }

  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of combined) {
    const key = buildItemKey(item);
    if (key) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const delta = extractSortTs(b) - extractSortTs(a);
    if (delta !== 0) {
      return delta;
    }
    return extractSortSeq(b) - extractSortSeq(a);
  });

  const safeLimit = Math.max(1, Math.floor(limit));
  const evicted = deduped.slice(safeLimit);
  if (evicted.length > 0) {
    onTrim?.(evicted.length);
  }

  return {
    kept: deduped.slice(0, safeLimit),
    evicted
  };
};

const mergeNewest = <T extends SortableItem>(
  incoming: T[],
  existing: T[],
  limit = LIVE_HOT_WINDOW,
  onTrim?: (evicted: number) => void
): T[] => {
  return mergeNewestWithOverflow(incoming, existing, limit, onTrim).kept;
};

const getTapeItemKey = (item: SortableItem): string => {
  return buildItemKey(item) ?? `${extractSortTs(item)}:${extractSortSeq(item)}`;
};

export const composeTapeItems = <T extends SortableItem>(
  seedItems: T[],
  liveItems: T[],
  historyItems: T[]
): T[] => {
  const deduped = new Map<string, T>();
  for (const item of [...seedItems, ...liveItems, ...historyItems]) {
    deduped.set(getTapeItemKey(item), item);
  }
  return Array.from(deduped.values()).sort((a, b) => {
    const delta = extractSortTs(b) - extractSortTs(a);
    if (delta !== 0) {
      return delta;
    }
    return extractSortSeq(b) - extractSortSeq(a);
  });
};

type PausableTapeData<T> = {
  visible: T[];
  queued: T[];
  seenKeys: Set<string>;
  dropped: number;
};

type LiveHistoryBuffer<T> = {
  liveHead: T[];
  queuedLive: T[];
  historyTail: T[];
  nextBefore: Cursor | null;
  historyLoading: boolean;
  historyExhausted: boolean;
  autoHydrating: boolean;
};

export const reducePausableTapeData = <T extends SortableItem>(
  current: PausableTapeData<T>,
  incoming: T[],
  paused: boolean,
  retentionLimit = LIVE_HOT_WINDOW
): PausableTapeData<T> => {
  if (incoming.length === 0) {
    return current;
  }

  const seenKeys = current.seenKeys;
  let nextSeenKeys: Set<string> | null = null;
  const unseen: T[] = [];

  // Incoming items are maintained newest-first by mergeNewest.
  // Once we hit a previously seen key, the remainder is older history.
  for (const item of incoming) {
    const key = getTapeItemKey(item);
    if (seenKeys.has(key)) {
      break;
    }
    if (!nextSeenKeys) {
      nextSeenKeys = new Set(seenKeys);
    }
    nextSeenKeys.add(key);
    unseen.push(item);
  }

  if (unseen.length === 0) {
    return current;
  }

  if (paused) {
    return {
      visible: current.visible,
      queued: mergeNewest(unseen, current.queued, retentionLimit, (evicted) =>
        incrementRetentionMetric("hotWindowEvictions", evicted)
      ),
      seenKeys: nextSeenKeys ?? seenKeys,
      dropped: current.dropped + unseen.length
    };
  }

  const nextBatch = current.queued.length > 0 ? [...current.queued, ...unseen] : unseen;
  return {
    visible: mergeNewest(nextBatch, current.visible, retentionLimit, (evicted) =>
      incrementRetentionMetric("hotWindowEvictions", evicted)
    ),
    queued: [],
    seenKeys: nextSeenKeys ?? seenKeys,
    dropped: 0
  };
};

export const flushPausableTapeData = <T extends SortableItem>(
  current: PausableTapeData<T>,
  retentionLimit = LIVE_HOT_WINDOW
): PausableTapeData<T> => {
  if (current.queued.length === 0) {
    return current.dropped === 0 ? current : { ...current, dropped: 0 };
  }

  return {
    visible: mergeNewest(current.queued, current.visible, retentionLimit, (evicted) =>
      incrementRetentionMetric("hotWindowEvictions", evicted)
    ),
    queued: [],
    seenKeys: current.seenKeys,
    dropped: 0
  };
};

const EMPTY_PAUSABLE_TAPE = {
  visible: [],
  queued: [],
  seenKeys: new Set<string>(),
  dropped: 0
};

export const appendHistoryTail = <T extends SortableItem>(
  current: T[],
  incoming: T[],
  liveHead: T[],
  cap = LIVE_HISTORY_SOFT_CAP
): T[] => {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set<string>(liveHead.map((item) => getTapeItemKey(item)));
  const combined: T[] = [];

  for (const item of [...current, ...incoming]) {
    const key = getTapeItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(item);
  }

  combined.sort((a, b) => {
    const delta = extractSortTs(b) - extractSortTs(a);
    if (delta !== 0) {
      return delta;
    }
    return extractSortSeq(b) - extractSortSeq(a);
  });

  return cap > 0 ? combined.slice(0, cap) : combined;
};

export const mergeHeldTapeHistory = <T extends SortableItem>(
  displayedHistory: T[],
  incomingHistory: T[],
  frozenLiveHead: T[]
): T[] => {
  if (displayedHistory.length === 0) {
    return appendHistoryTail([], incomingHistory, frozenLiveHead, 0);
  }

  const sortedDisplayed = appendHistoryTail([], displayedHistory, frozenLiveHead, 0);
  const tail = sortedDisplayed.at(-1);
  const tailTs = tail ? extractSortTs(tail) : Number.POSITIVE_INFINITY;
  const tailSeq = tail ? extractSortSeq(tail) : Number.POSITIVE_INFINITY;
  const olderIncoming = incomingHistory.filter((item) => {
    const itemTs = extractSortTs(item);
    if (itemTs < tailTs) {
      return true;
    }
    return itemTs === tailTs && extractSortSeq(item) < tailSeq;
  });

  return appendHistoryTail(sortedDisplayed, olderIncoming, frozenLiveHead, 0);
};

export const getLiveHistoryRetentionCap = (subscription: LiveSubscription): number => {
  switch (subscription.channel) {
    case "options":
    case "equities":
      return 0;
    default:
      return LIVE_HISTORY_SOFT_CAP;
  }
};

export const getLiveFeedStatus = (
  sourceStatus: WsStatus,
  freshestTs: number | null,
  thresholdMs: number,
  now = Date.now(),
  behindDelayMs = 0
): WsStatus => {
  if (sourceStatus !== "connected") {
    return sourceStatus;
  }
  if (freshestTs === null) {
    return "connected";
  }

  const ageMs = now - freshestTs;
  if (ageMs <= thresholdMs) {
    return "connected";
  }

  const behindMs = ageMs - thresholdMs;
  return behindMs > behindDelayMs ? "stale" : "connected";
};

export const getHotChannelFeedStatus = (
  sourceStatus: WsStatus,
  health: { healthy: boolean } | null | undefined
): WsStatus => {
  if (sourceStatus !== "connected") {
    return sourceStatus;
  }
  if (!health) {
    return "connected";
  }
  return health.healthy ? "connected" : "stale";
};

export const findAnchorRestoreIndex = (
  keys: string[],
  anchorKey: string,
  fallbackKeys: string[]
): number => {
  const directIndex = keys.indexOf(anchorKey);
  if (directIndex >= 0) {
    return directIndex;
  }

  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  for (const key of fallbackKeys) {
    const index = indexByKey.get(key);
    if (typeof index === "number") {
      return index;
    }
  }

  return -1;
};

type TapeState<T> = {
  status: WsStatus;
  items: T[];
  liveItems?: T[];
  historyItems?: T[];
  lastUpdate: number | null;
  replayTime: number | null;
  replayComplete: boolean;
  paused: boolean;
  dropped: number;
  togglePause: () => void;
};

const buildWsUrl = (path: string): string => {
  const envBase = process.env.NEXT_PUBLIC_API_URL;

  if (envBase) {
    const url = new URL(envBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  const isLocal = LOCAL_HOSTS.has(hostname);
  const host = isLocal ? `${hostname}:4000` : window.location.host;

  return `${wsProtocol}://${host}${path}`;
};

const buildApiUrl = (path: string): string => {
  const envBase = process.env.NEXT_PUBLIC_API_URL;

  if (envBase) {
    const url = new URL(envBase);
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    url.protocol = secure ? "https:" : "http:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const { protocol, hostname } = window.location;
  const httpProtocol = protocol === "https:" ? "https" : "http";
  const isLocal = LOCAL_HOSTS.has(hostname);
  const host = isLocal ? `${hostname}:4000` : window.location.host;

  return `${httpProtocol}://${host}${path}`;
};

export const isSyntheticAdminVisible = (
  value = process.env.NEXT_PUBLIC_SYNTHETIC_ADMIN
): boolean => value === "1";

type SyntheticAdminStatusResponse = {
  enabled: boolean;
  backend_mode: "synthetic" | "mixed" | "live";
  adapters: {
    options: string;
    equities: string;
  };
  control: SyntheticControlState | null;
  derived: SyntheticDerivedStatus | null;
  disabled_reason?: string;
};

type SyntheticAdminControlResponse = {
  control: SyntheticControlState;
  derived?: SyntheticDerivedStatus | null;
};

const SYNTHETIC_ADMIN_PROXY_PATHS = {
  status: "/api/admin/synthetic/status",
  control: "/api/admin/synthetic/control"
} as const;

const SYNTHETIC_PROFILE_ORDER: Array<keyof SyntheticControlState["profile_weights"]> = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive"
];

const SYNTHETIC_PROFILE_LABELS: Record<
  keyof SyntheticControlState["profile_weights"],
  string
> = {
  institutional_directional: "Institutional Directional",
  retail_whale: "Retail Whale",
  event_driven: "Event Driven",
  vol_seller: "Vol Seller",
  arbitrage: "Arbitrage",
  hedge_reactive: "Hedge Reactive"
};

const SYNTHETIC_PRESET_LABELS: Record<SyntheticControlState["preset_id"], string> = {
  balanced_demo: "Balanced Demo",
  event_day: "Event Day",
  dealer_day: "Dealer Day",
  retail_chase: "Retail Chase",
  quiet_range: "Quiet Range"
};

const buildDefaultSyntheticControl = (): SyntheticControlState => ({
  preset_id: "balanced_demo",
  coverage_assist: true,
  coverage_window_minutes: 20,
  shared_seed: 11,
  profile_weights: {
    institutional_directional: 1.0,
    retail_whale: 1.0,
    event_driven: 1.0,
    vol_seller: 1.0,
    arbitrage: 1.0,
    hedge_reactive: 1.0
  },
  updated_at: 0,
  updated_by: "internal-ui"
});

type SyntheticControlPatch = Omit<Partial<SyntheticControlState>, "profile_weights"> & {
  profile_weights?: Partial<SyntheticControlState["profile_weights"]>;
};

const createSyntheticControlDraft = (
  current: SyntheticControlState,
  patch: SyntheticControlPatch
): SyntheticControlState => ({
  ...current,
  ...patch,
  profile_weights: {
    ...current.profile_weights,
    ...(patch.profile_weights ?? {})
  },
  updated_at: Date.now(),
  updated_by: "internal-ui"
});

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

export const formatCompactUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0.00";
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs < 1_000) {
    return formatUsd(value);
  }
  if (abs < 1_000_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  if (abs < 1_000_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
};

const normalizeContractId = (value: string): string => value.trim();

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

export const formatOptionContractLabel = (value: string): OptionContractDisplay | null => {
  const normalized = normalizeContractId(value);
  if (!normalized) {
    return null;
  }

  const parsed = parseOptionContractId(normalized);
  if (!parsed) {
    return null;
  }

  const expiration = formatExpiryShort(parsed.expiry);
  if (!expiration) {
    return null;
  }

  return {
    ticker: parsed.root.toUpperCase(),
    strike: `${formatStrike(parsed.strike)}${parsed.right}`,
    expiration
  };
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

const isSameLocalDay = (left: number, right: number): boolean => {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

export const formatNewsTimestamp = (ts: number, now = Date.now()): string => {
  const date = new Date(ts);
  return isSameLocalDay(ts, now)
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const sanitizeNewsHtml = (value: string): { html: string; fallbackText: string; sanitized: boolean } => {
  const fallbackText = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    const sanitized = value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\shref=(["'])javascript:[\s\S]*?\1/gi, ' href="#"')
      .replace(/<(?!\/?(p|div|section|article|span|strong|em|b|i|ul|ol|li|br|a|h1|h2|h3|h4|blockquote)\b)[^>]*>/gi, "");
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

const normalizeAlertSeverityValue = (value: string): "high" | "medium" | "low" | null => {
  const normalized = value.trim().toLowerCase();
  if (["high", "critical", "severe", "sev1", "p0", "p1"].includes(normalized)) {
    return "high";
  }
  if (["medium", "med", "moderate", "sev2", "p2"].includes(normalized)) {
    return "medium";
  }
  if (["low", "minor", "info", "informational", "sev3", "p3", "p4"].includes(normalized)) {
    return "low";
  }
  return null;
};

export const normalizeAlertSeverity = (alert: AlertEvent): "high" | "medium" | "low" => {
  const normalized = normalizeAlertSeverityValue(alert.severity);
  if (normalized) {
    return normalized;
  }
  if (alert.score >= 80) {
    return "high";
  }
  if (alert.score >= 45) {
    return "medium";
  }
  return "low";
};

export const deriveAlertDirection = (alert: AlertEvent): "bullish" | "bearish" | "neutral" => {
  const totals = {
    bullish: { count: 0, confidence: 0 },
    bearish: { count: 0, confidence: 0 },
    neutral: { count: 0, confidence: 0 }
  };

  for (const hit of alert.hits) {
    const direction = normalizeDirection(hit.direction);
    totals[direction].count += 1;
    totals[direction].confidence += Number.isFinite(hit.confidence) ? hit.confidence : 0;
  }

  const ranked = (Object.entries(totals) as Array<
    ["bullish" | "bearish" | "neutral", { count: number; confidence: number }]
  >).sort((a, b) => {
    if (b[1].count !== a[1].count) {
      return b[1].count - a[1].count;
    }
    return b[1].confidence - a[1].confidence;
  });

  return ranked[0] && ranked[0][1].count > 0 ? ranked[0][0] : "neutral";
};

export const getAlertWindowAnchorTs = (alerts: AlertEvent[], fallbackNow = Date.now()): number => {
  if (alerts.length === 0) {
    return fallbackNow;
  }
  return alerts.reduce((max, alert) => Math.max(max, alert.source_ts), alerts[0]?.source_ts ?? fallbackNow);
};

const extractUnderlying = (contractId: string): string => {
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  return contractId.split("-")[0]?.toUpperCase() ?? contractId.toUpperCase();
};

const normalizeJoinRefCandidates = (value: string): string[] => {
  const ref = value.trim();
  if (!ref) {
    return [];
  }

  if (ref.startsWith("equityjoin:")) {
    const rawTrace = ref.slice("equityjoin:".length);
    return rawTrace ? [ref, rawTrace] : [ref];
  }

  return [ref, `equityjoin:${ref}`];
};

const resolveJoinFromRef = (
  ref: string,
  joins: Map<string, EquityPrintJoin>
): EquityPrintJoin | null => {
  const candidates = normalizeJoinRefCandidates(ref);
  for (const key of candidates) {
    const match = joins.get(key);
    if (match) {
      return match;
    }
  }
  return null;
};

const formatDarkTrace = (traceId: string): string => {
  const normalized = traceId.trim();
  if (!normalized) {
    return "unknown";
  }

  if (normalized.startsWith("equityjoin:")) {
    return normalized.slice("equityjoin:".length);
  }

  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 2) {
    return normalized;
  }

  const kind = parts[1]?.replace(/_/g, " ") ?? "event";
  const remainder = parts.slice(2).join(" -> ");
  if (!remainder) {
    return kind;
  }
  return `${kind}: ${remainder}`;
};

const inferDarkUnderlying = (
  event: InferredDarkEvent,
  equityJoins: Map<string, EquityPrintJoin>
): string | null => {
  for (const ref of event.evidence_refs) {
    const join = resolveJoinFromRef(ref, equityJoins);
    if (!join) {
      continue;
    }
    const underlying = join.features.underlying_id;
    if (typeof underlying === "string" && underlying.length > 0) {
      return underlying.toUpperCase();
    }
  }

  const match = event.trace_id.match(/^dark:(?:stealth_accumulation|distribution):([^:]+):/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }

  return null;
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

const DEFAULT_FLOW_SIDES: OptionNbboSide[] = ["AA", "A", "MID"];
const DEFAULT_FLOW_OPTION_TYPES: OptionType[] = ["call", "put"];
const DEFAULT_FLOW_SECURITY_TYPES: OptionSecurityType[] = ["stock"];

export const buildDefaultFlowFilters = (): OptionFlowFilters => ({
  view: "signal",
  securityTypes: DEFAULT_FLOW_SECURITY_TYPES,
  nbboSides: DEFAULT_FLOW_SIDES,
  optionTypes: DEFAULT_FLOW_OPTION_TYPES,
  minNotional:
    FLOW_FILTER_PRESET === "all"
      ? undefined
      : FLOW_FILTER_PRESET === "balanced"
      ? 5_000
      : undefined
});

const sameFilterValues = <T extends string>(left: T[] | undefined, right: T[] | undefined): boolean => {
  const leftValues = [...(left ?? [])].sort();
  const rightValues = [...(right ?? [])].sort();
  if (leftValues.length !== rightValues.length) {
    return false;
  }
  return leftValues.every((value, index) => value === rightValues[index]);
};

export const countActiveFlowFilterGroups = (filters: OptionFlowFilters): number => {
  const defaults = buildDefaultFlowFilters();
  let count = 0;

  if (!sameFilterValues(filters.securityTypes, defaults.securityTypes)) {
    count += 1;
  }
  if (!sameFilterValues(filters.nbboSides, defaults.nbboSides)) {
    count += 1;
  }
  if (!sameFilterValues(filters.optionTypes, defaults.optionTypes)) {
    count += 1;
  }
  if ((filters.minNotional ?? undefined) !== (defaults.minNotional ?? undefined)) {
    count += 1;
  }
  if ((filters.view ?? defaults.view) !== defaults.view) {
    count += 1;
  }

  return count;
};

export const toggleFilterValue = <T extends string>(
  values: T[] | undefined,
  value: T,
  enabled: boolean
): T[] => {
  const current = new Set(values ?? []);
  if (enabled) {
    current.add(value);
  } else {
    current.delete(value);
  }
  return [...current].sort();
};

export const nextFlowFilterPopoverState = (
  current: boolean,
  action: "toggle" | "dismiss"
): boolean => {
  return action === "toggle" ? !current : false;
};

export const projectPausableTapeState = <T extends SortableItem>(
  visible: T[],
  status: WsStatus,
  lastUpdate: number | null
): { items: T[]; lastUpdate: number | null } => ({
  items: visible,
  lastUpdate: status === "stale" ? null : lastUpdate
});

type EquitiesSilentFeedWarningInput = {
  wsStatus: WsStatus;
  equitiesSubscribed: boolean;
  connectedAt: number | null;
  lastEquitiesEventAt: number | null;
  now?: number;
  thresholdMs?: number;
};

export const shouldShowEquitiesSilentFeedWarning = ({
  wsStatus,
  equitiesSubscribed,
  connectedAt,
  lastEquitiesEventAt,
  now = Date.now(),
  thresholdMs = LIVE_EQUITIES_SILENT_WARNING_MS
}: EquitiesSilentFeedWarningInput): boolean => {
  if (wsStatus !== "connected" || !equitiesSubscribed) {
    return false;
  }
  const baselineTs = lastEquitiesEventAt ?? connectedAt;
  if (baselineTs === null) {
    return false;
  }
  return now - baselineTs >= thresholdMs;
};

const LIVE_SNAPSHOT_HISTORY_CHANNELS = new Set<LiveSubscription["channel"]>([
  "options",
  "nbbo",
  "equities",
  "flow",
  "smart-money",
  "classifier-hits"
]);

export const shouldRetainLiveSnapshotHistory = (
  channel: LiveSubscription["channel"],
  isSnapshot: boolean,
  snapshotItemCount: number,
  currentItemCount: number
): boolean =>
  isSnapshot &&
  snapshotItemCount === 0 &&
  currentItemCount > 0 &&
  LIVE_SNAPSHOT_HISTORY_CHANNELS.has(channel);

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

type ClassifierDecor = {
  hit?: ClassifierHitEvent;
  smartMoney?: SmartMoneyEvent;
  family: string;
  tone: string;
  intensity: number;
};

const EMPTY_CLASSIFIER_HITS_BY_PACKET_ID = new Map<string, ClassifierHitEvent[]>();
const EMPTY_PACKET_ID_BY_OPTION_TRACE_ID = new Map<string, string>();
const EMPTY_CLASSIFIER_DECOR_BY_OPTION_TRACE_ID = new Map<string, ClassifierDecor>();

const SMART_MONEY_PROFILE_TONES: Record<SmartMoneyProfileId, string> = {
  institutional_directional: "green",
  retail_whale: "amber",
  event_driven: "blue",
  vol_seller: "copper",
  arbitrage: "teal",
  hedge_reactive: "magenta"
};

const CLASSIFIER_FAMILY_TONES: Record<string, string> = {
  large_bullish_call_sweep: "green",
  large_bearish_put_sweep: "red",
  unusual_contract_spike: "amber",
  large_call_sell_overwrite: "copper",
  large_put_sell_write: "copper",
  straddle: "blue",
  strangle: "blue",
  vertical_spread: "teal",
  ladder_accumulation: "yellowgreen",
  roll_up_down_out: "violet",
  far_dated_conviction: "cyan",
  zero_dte_gamma_punch: "magenta"
};

export const selectPrimaryClassifierHit = (
  hits: readonly ClassifierHitEvent[]
): ClassifierHitEvent | null => {
  if (hits.length === 0) {
    return null;
  }
  return [...hits].sort((a, b) => {
    const confidenceDelta = b.confidence - a.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    const tsDelta = b.source_ts - a.source_ts;
    if (tsDelta !== 0) {
      return tsDelta;
    }
    return b.seq - a.seq;
  })[0];
};

export const classifierToneForFamily = (classifierId: string): string =>
  CLASSIFIER_FAMILY_TONES[classifierId] ?? "neutral";

export const smartMoneyToneForProfile = (profileId: SmartMoneyProfileId | null): string =>
  profileId ? SMART_MONEY_PROFILE_TONES[profileId] ?? "neutral" : "neutral";

export const smartMoneyProfileLabel = (profileId: SmartMoneyProfileId | null): string =>
  profileId ? humanizeClassifierId(profileId) : "Abstained";

const buildClassifierDecor = (hit: ClassifierHitEvent): ClassifierDecor => ({
  hit,
  family: hit.classifier_id,
  tone: classifierToneForFamily(hit.classifier_id),
  intensity: clamp(hit.confidence, 0.25, 1)
});

const buildSmartMoneyDecor = (event: SmartMoneyEvent): ClassifierDecor => {
  const primaryScore =
    event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
    event.profile_scores[0];
  return {
    smartMoney: event,
    family: event.primary_profile_id ?? primaryScore?.profile_id ?? "abstained",
    tone: event.abstained ? "neutral" : smartMoneyToneForProfile(event.primary_profile_id),
    intensity: clamp(primaryScore?.probability ?? 0.25, 0.25, 1)
  };
};

export const getOptionTableSnapshot = (
  print: Pick<
    OptionPrint,
    | "price"
    | "size"
    | "notional"
    | "nbbo_side"
    | "execution_nbbo_side"
    | "execution_underlying_spot"
    | "execution_iv"
  >,
  fallbackSide: OptionNbboSide | null = null
): { spot: string; iv: string; side: string; details: string; value: string } => {
  const side = print.execution_nbbo_side ?? print.nbbo_side ?? fallbackSide ?? "--";
  return {
    spot: typeof print.execution_underlying_spot === "number" ? formatPrice(print.execution_underlying_spot) : "--",
    iv: typeof print.execution_iv === "number" ? formatPct(print.execution_iv) : "--",
    side,
    details: `${formatSize(print.size)}@${formatPrice(print.price)}_${side}`,
    value: formatCompactUsd(print.notional ?? print.price * print.size * 100)
  };
};

type ListScrollState = {
  listRef: React.RefObject<HTMLDivElement>;
  listNode: HTMLDivElement | null;
  setListRef: (node: HTMLDivElement | null) => void;
  isAtTop: boolean;
  isAtTopRef: React.MutableRefObject<boolean>;
  missed: number;
  resumeTick: number;
  onNewItems: (count: number) => void;
  jumpToTop: () => void;
};

const useListScroll = (): ListScrollState => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listNode, setListNode] = useState<HTMLDivElement | null>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  const [missed, setMissed] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const isAtTopRef = useRef(true);
  const prevAtTopRef = useRef(true);

  const setListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    setListNode(node);
  }, []);

  useEffect(() => {
    isAtTopRef.current = isAtTop;
  }, [isAtTop]);

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }

    const atTop = el.scrollTop <= 2;

    if (atTop && !prevAtTopRef.current) {
      setResumeTick((prev) => prev + 1);
    }

    prevAtTopRef.current = atTop;
    isAtTopRef.current = atTop;
    setIsAtTop(atTop);

    if (atTop) {
      setMissed(0);
    }
  }, [isAtTopRef]);

  useEffect(() => {
    if (!listNode) {
      return;
    }

    const onScroll = () => {
      updateScrollState();
    };

    updateScrollState();
    listNode.addEventListener("scroll", onScroll);

    return () => {
      listNode.removeEventListener("scroll", onScroll);
    };
  }, [listNode, updateScrollState]);

  const onNewItems = useCallback((count: number) => {
    if (count <= 0) {
      return;
    }

    if (isAtTopRef.current) {
      setMissed(0);
      return;
    }

    setMissed((prev) => prev + count);
  }, []);

  const jumpToTop = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }

    isAtTopRef.current = true;
    el.scrollTop = 0;
    updateScrollState();
  }, [isAtTopRef, listRef, updateScrollState]);

  return {
    listRef,
    listNode,
    setListRef,
    isAtTop,
    isAtTopRef,
    missed,
    resumeTick,
    onNewItems,
    jumpToTop
  };
};

const useScrollAnchor = (
  listRef: React.RefObject<HTMLDivElement>,
  isAtTopRef: React.MutableRefObject<boolean>
) => {
  const pendingRef = useRef<{
    key: string;
    offset: number;
    fallbackKeys: string[];
  } | null>(null);

  const readRenderedRows = useCallback((element: HTMLDivElement) => {
    return Array.from(element.querySelectorAll<HTMLElement>("[data-tape-key][data-row-start][data-row-size]"))
      .map((node) => {
        const key = node.dataset.tapeKey;
        const start = Number(node.dataset.rowStart);
        const size = Number(node.dataset.rowSize);
        if (!key || !Number.isFinite(start) || !Number.isFinite(size)) {
          return null;
        }
        return { key, start, size };
      })
      .filter((row): row is { key: string; start: number; size: number } => row !== null)
      .sort((a, b) => a.start - b.start);
  }, []);

  const capture = useCallback(() => {
    if (isAtTopRef.current) {
      pendingRef.current = null;
      return;
    }

    const el = listRef.current;
    if (!el) {
      return;
    }

    const rows = readRenderedRows(el);
    if (rows.length === 0) {
      pendingRef.current = null;
      return;
    }

    const scrollTop = el.scrollTop;
    const anchorIndex = rows.findIndex((row) => row.start + row.size > scrollTop);
    const resolvedIndex = anchorIndex >= 0 ? anchorIndex : 0;
    const anchorRow = rows[resolvedIndex];
    if (!anchorRow) {
      pendingRef.current = null;
      return;
    }

    pendingRef.current = {
      key: anchorRow.key,
      offset: Math.max(0, scrollTop - anchorRow.start),
      fallbackKeys: rows.slice(resolvedIndex).map((row) => row.key)
    };
  }, [isAtTopRef, listRef, readRenderedRows]);

  const apply = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }

    const el = listRef.current;
    if (!el) {
      return;
    }

    if (isAtTopRef.current) {
      pendingRef.current = null;
      return;
    }

    const rows = readRenderedRows(el);
    if (rows.length === 0) {
      return;
    }

    const keys = rows.map((row) => row.key);
    const restoreIndex = findAnchorRestoreIndex(keys, pending.key, pending.fallbackKeys);
    if (restoreIndex < 0) {
      return;
    }

    const row = rows[restoreIndex];
    if (!row) {
      return;
    }

    el.scrollTop = Math.max(0, row.start + pending.offset);
    bumpTapeDebugMetric("anchorRestoreCount", 1);
    if (row.key !== pending.key) {
      bumpTapeDebugMetric("anchorRestoreFallbackCount", 1);
      logTapeDebug("anchor restore fallback", {
        requested_key: pending.key,
        restored_key: row.key
      });
    }
    pendingRef.current = null;
  }, [isAtTopRef, listRef, readRenderedRows]);

  return { capture, apply };
};

const useVirtualHistoryGate = (
  enabled: boolean,
  itemCount: number,
  lastVirtualIndex: number,
  onLoadOlder: () => void
): void => {
  const loadRef = useRef(onLoadOlder);
  useEffect(() => {
    loadRef.current = onLoadOlder;
  }, [onLoadOlder]);

  useEffect(() => {
    if (!enabled || itemCount === 0) {
      return;
    }
    if (lastVirtualIndex < itemCount - 1) {
      return;
    }
    loadRef.current();
  }, [enabled, itemCount, lastVirtualIndex]);
};

type TapeVirtualListResult<T> = {
  totalSize: number;
  virtualItems: TapeVirtualRow<T>[];
};

type TapeVirtualRow<T> = {
  item: T;
  key: string;
  index: number;
  start: number;
  size: number;
  end: number;
};

const useTapeVirtualList = <T extends SortableItem>(
  items: T[],
  listRef: React.RefObject<HTMLDivElement>,
  config: TapeVirtualListConfig
): TapeVirtualListResult<T> => {
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => config.rowHeight,
    overscan: config.overscan,
    getItemKey: (index) => getTapeItemKey(items[index] as SortableItem)
  });

  const virtualItems: TapeVirtualRow<T>[] = virtualizer
    .getVirtualItems()
    .map((virtualItem) => {
      const item = items[virtualItem.index] as T | undefined;
      if (!item) {
        return null;
      }
      return {
        item,
        key: getTapeItemKey(item),
        index: virtualItem.index,
        start: virtualItem.start,
        size: virtualItem.size,
        end: virtualItem.end
      };
    })
    .filter((virtualItem): virtualItem is TapeVirtualRow<T> => virtualItem !== null);

  useEffect(() => {
    if (!DEV_TAPE_DEBUG || items.length === 0) {
      return;
    }
    const element = listRef.current;
    if (!element) {
      return;
    }
    const first = virtualItems[0];
    const last = virtualItems.at(-1);
    if (!first || !last) {
      return;
    }
    const visibleTopGap = Math.max(0, first.start - element.scrollTop);
    const visibleBottomGap = Math.max(0, element.scrollTop + element.clientHeight - last.end);
    if (visibleTopGap > element.clientHeight || visibleBottomGap > element.clientHeight) {
      console.warn("[tape] false-gap watchdog", {
        pane: config.debugLabel,
        item_count: items.length,
        visible_top_gap: visibleTopGap,
        visible_bottom_gap: visibleBottomGap,
        viewport_height: element.clientHeight
      });
    }
  }, [config.debugLabel, items.length, listRef, virtualItems]);

  return {
    totalSize: virtualizer.getTotalSize(),
    virtualItems
  };
};

const upsertPinnedEntries = <T,>(
  current: Map<string, PinnedEntry<T>>,
  incoming: Map<string, T>,
  now: number
): Map<string, PinnedEntry<T>> => {
  const next = new Map(current);
  for (const [key, value] of incoming) {
    next.set(key, { value, updatedAt: now });
  }
  return next;
};

export const prunePinnedEntries = <T,>(
  current: Map<string, PinnedEntry<T>>,
  activeKeys: Set<string>,
  now: number
): Map<string, PinnedEntry<T>> => {
  const surviving: Array<[string, PinnedEntry<T>]> = [];

  for (const [key, entry] of current) {
    if (activeKeys.has(key) || now - entry.updatedAt <= PINNED_EVIDENCE_TTL_MS) {
      surviving.push([key, entry]);
    }
  }

  surviving.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const trimmed = surviving.slice(0, PINNED_EVIDENCE_MAX_ITEMS);

  if (trimmed.length === current.size) {
    let unchanged = true;
    let index = 0;
    for (const entry of current) {
      const next = trimmed[index];
      if (!next || next[0] !== entry[0] || next[1] !== entry[1]) {
        unchanged = false;
        break;
      }
      index += 1;
    }

    if (unchanged) {
      return current;
    }
  }

  return new Map(trimmed);
};

export const statusLabel = (status: WsStatus, paused: boolean, mode: TapeMode): string => {
  if (paused) {
    if (mode === "replay") {
      return "Paused";
    }
    return status === "connected" ? "Held" : statusLabel(status, false, mode);
  }

  if (mode === "replay") {
    return status === "disconnected" ? "Replay Down" : "Replay";
  }

  switch (status) {
    case "connected":
      return "Connected";
    case "stale":
      return "Feed behind";
    case "connecting":
      return "Connecting";
    case "disconnected":
    default:
      return "Disconnected";
  }
};

type TapeConfig<T> = {
  mode: TapeMode;
  wsPath: string;
  replayPath: string;
  latestPath?: string;
  liveEnabled?: boolean;
  expectedType: MessageType;
  batchSize?: number;
  pollMs?: number;
  captureScroll?: () => void;
  onNewItems?: (count: number) => void;
  getItemTs?: (item: T) => number;
  getReplayKey?: (item: T) => string | null;
  replaySourceKey?: string | null;
  onReplaySourceKey?: (key: string | null) => void;
  queryParams?: Record<string, string | null | undefined>;
  hotWindowLimit?: number;
};

const useTape = <T extends SortableItem & { seq: number }>(
  config: TapeConfig<T>
): TapeState<T> => {
  const { mode, wsPath, replayPath, expectedType, latestPath, onNewItems, captureScroll } = config;
  const batchSize = config.batchSize ?? 40;
  const pollMs = config.pollMs ?? 1000;
  const getItemTs = config.getItemTs ?? extractSortTs;
  const getReplayKey = config.getReplayKey ?? extractTracePrefix;
  const replaySourceKey = config.replaySourceKey ?? null;
  const onReplaySourceKey = config.onReplaySourceKey;
  const queryParams = config.queryParams;
  const queryKey = useMemo(
    () =>
      JSON.stringify(
        Object.entries(queryParams ?? {}).sort(([left], [right]) => left.localeCompare(right))
      ),
    [queryParams]
  );
  const hotWindowLimit = config.hotWindowLimit ?? LIVE_HOT_WINDOW;
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [items, setItems] = useState<T[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [replayTime, setReplayTime] = useState<number | null>(null);
  const [replayComplete, setReplayComplete] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [dropped, setDropped] = useState<number>(0);
  const reconnectRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const cursorRef = useRef<ReplayCursor>({ ts: 0, seq: 0 });
  const replayEndRef = useRef<number | null>(null);
  const replayCompleteRef = useRef<boolean>(false);
  const replaySourceRef = useRef<string | null>(null);
  const replaySourceNotifiedRef = useRef<string | null>(null);
  const emptyPollsRef = useRef<number>(0);
  const pausedRef = useRef(paused);
  const pendingRef = useRef<T[]>([]);
  const pendingCountRef = useRef(0);
  const flushHandleRef = useRef<number | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const cancelFlush = useCallback(() => {
    if (flushHandleRef.current !== null) {
      cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushHandleRef.current !== null) {
      return;
    }

    flushHandleRef.current = requestAnimationFrame(() => {
      flushHandleRef.current = null;
      const buffered = pendingRef.current;
      if (buffered.length === 0) {
        return;
      }
      pendingRef.current = [];

      const pendingCount = pendingCountRef.current;
      pendingCountRef.current = 0;

      if (onNewItems && pendingCount > 0) {
        onNewItems(pendingCount);
      }

      if (captureScroll) {
        captureScroll();
      }

      setItems((prev) =>
        mergeNewest(buffered, prev, hotWindowLimit, (evicted) =>
          incrementRetentionMetric("hotWindowEvictions", evicted)
        )
      );
      setLastUpdate(Date.now());
    });
  }, [captureScroll, hotWindowLimit, onNewItems]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      if (!next) {
        setDropped(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setItems([]);
    setLastUpdate(null);
    setReplayTime(null);
    setReplayComplete(false);
    replayCompleteRef.current = false;
    replaySourceRef.current = null;
    replaySourceNotifiedRef.current = null;
    emptyPollsRef.current = 0;
    setDropped(0);
    setStatus("connecting");
    cursorRef.current = { ts: 0, seq: 0 };
    pendingRef.current = [];
    pendingCountRef.current = 0;
    cancelFlush();
  }, [mode, replaySourceKey, queryKey, cancelFlush]);

  useEffect(() => {
    if (mode !== "replay" || !latestPath) {
      replayEndRef.current = null;
      return;
    }

    let active = true;
    replayEndRef.current = null;
    setReplayComplete(false);
    replayCompleteRef.current = false;

    const fetchReplayEnd = async () => {
      try {
        const url = new URL(buildApiUrl(latestPath));
        url.searchParams.set("limit", "1");
        for (const [key, value] of Object.entries(queryParams ?? {})) {
          if (value) {
            url.searchParams.set(key, value);
          }
        }
        if (replaySourceKey) {
          url.searchParams.set("source", replaySourceKey);
        }
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Replay baseline failed with ${response.status}`);
        }

        const payload = (await response.json()) as { data?: T[] };
        const latest = payload.data?.[0];
        if (active && latest) {
          replayEndRef.current = getItemTs(latest);
        }
      } catch (error) {
        console.warn("Failed to load replay end cursor", error);
      }
    };

    void fetchReplayEnd();

    return () => {
      active = false;
    };
  }, [mode, latestPath, getItemTs, replaySourceKey, queryKey, queryParams]);

  useEffect(() => {
    if (mode !== "live" || config.liveEnabled === false) {
      return;
    }

    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      setStatus("connecting");

      const socket = new WebSocket(buildWsUrl(wsPath));
      socketRef.current = socket;

      socket.onopen = () => {
        if (!active) {
          return;
        }
        setStatus("connected");
      };

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as StreamMessage<T>;
          if (!message || message.type !== expectedType) {
            return;
          }

          if (pausedRef.current) {
            setDropped((prev) => prev + 1);
            setLastUpdate(Date.now());
            return;
          }

          pendingRef.current.push(message.payload);
          pendingCountRef.current += 1;
          scheduleFlush();
        } catch (error) {
          console.warn("Failed to parse websocket payload", error);
        }
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        setStatus("disconnected");
        reconnectRef.current = window.setTimeout(() => {
          connect();
        }, 1000);
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }

        setStatus("disconnected");
        socket.close();
      };
    };

    connect();

    return () => {
      active = false;
      cancelFlush();
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [mode, wsPath, expectedType, scheduleFlush, cancelFlush]);

  useEffect(() => {
    if (mode !== "replay") {
      return;
    }

    let active = true;

    const poll = async () => {
      if (!active || pausedRef.current) {
        return;
      }

      if (replayCompleteRef.current) {
        return;
      }

      try {
        let keepPolling = true;

        while (keepPolling && active && !pausedRef.current) {
          const replayEnd = replayEndRef.current;
          const cursor = cursorRef.current;

          if (replayEnd !== null && cursor.ts >= replayEnd) {
            replayCompleteRef.current = true;
            setReplayComplete(true);
            setStatus("disconnected");
            return;
          }

          const url = new URL(buildApiUrl(replayPath));
          url.searchParams.set("after_ts", cursor.ts.toString());
          url.searchParams.set("after_seq", cursor.seq.toString());
          url.searchParams.set("limit", batchSize.toString());
          for (const [key, value] of Object.entries(queryParams ?? {})) {
            if (value) {
              url.searchParams.set(key, value);
            }
          }
          const desiredSource = replaySourceKey ?? replaySourceRef.current;
          if (desiredSource) {
            url.searchParams.set("source", desiredSource);
          }

          const response = await fetch(url.toString());
          if (!response.ok) {
            throw new Error(`Replay request failed with ${response.status}`);
          }

          const payload = (await response.json()) as ReplayResponse<T>;

          let sourcePrefix = replaySourceRef.current;
          if (replaySourceKey) {
            if (sourcePrefix !== replaySourceKey) {
              sourcePrefix = replaySourceKey;
              replaySourceRef.current = replaySourceKey;
            }
          } else if (!sourcePrefix) {
            const firstWithTrace = payload.data.find((item) => getReplayKey(item));
            if (firstWithTrace) {
              sourcePrefix = getReplayKey(firstWithTrace);
              replaySourceRef.current = sourcePrefix ?? null;
            }
          }

          if (onReplaySourceKey) {
            if (sourcePrefix && replaySourceNotifiedRef.current !== sourcePrefix) {
              replaySourceNotifiedRef.current = sourcePrefix;
              onReplaySourceKey(sourcePrefix);
            } else if (!sourcePrefix && replaySourceNotifiedRef.current !== null) {
              replaySourceNotifiedRef.current = null;
              onReplaySourceKey(null);
            }
          }

          const filtered = sourcePrefix
            ? payload.data.filter((item) => getReplayKey(item) === sourcePrefix)
            : payload.data;

          const hasForeign =
            sourcePrefix &&
            payload.data.some((item) => {
              const prefix = getReplayKey(item);
              return prefix !== null && prefix !== sourcePrefix;
            });

          if (filtered.length > 0) {
            const nextItems = [...filtered].reverse();
            pendingRef.current.push(...nextItems);
            pendingCountRef.current += nextItems.length;
            scheduleFlush();
            const last = filtered.at(-1);
            if (last) {
              const lastTs = getItemTs(last);
              setReplayTime(lastTs);
              if (replayEnd !== null && lastTs >= replayEnd) {
                cursorRef.current = { ts: lastTs, seq: last.seq };
                replayCompleteRef.current = true;
                setReplayComplete(true);
                setStatus("disconnected");
                return;
              }
            }
            emptyPollsRef.current = 0;
          } else if (sourcePrefix) {
            emptyPollsRef.current += 1;
          }

          if (payload.next) {
            cursorRef.current = payload.next;
          }

          setStatus("connected");
          keepPolling = filtered.length === batchSize;

          if (keepPolling) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          if (!replaySourceKey && hasForeign) {
            replayCompleteRef.current = true;
            setReplayComplete(true);
            setStatus("disconnected");
            return;
          }

          if (sourcePrefix && emptyPollsRef.current >= 3) {
            replayCompleteRef.current = true;
            setReplayComplete(true);
            setStatus("disconnected");
            return;
          }
        }
      } catch (error) {
        console.warn("Replay poll failed", error);
        setStatus("disconnected");
      }
    };

    void poll();
    const interval = window.setInterval(poll, pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
      cancelFlush();
    };
  }, [
    mode,
    replayPath,
    batchSize,
    pollMs,
    scheduleFlush,
    cancelFlush,
    getItemTs,
    getReplayKey,
    replaySourceKey,
    onReplaySourceKey,
    queryKey,
    queryParams
  ]);

  return {
    status,
    items,
    lastUpdate,
    replayTime,
    replayComplete,
    paused,
    dropped,
    togglePause
  };
};

const toStaticTapeState = <T,>(
  status: WsStatus,
  items: T[],
  lastUpdate: number | null
): TapeState<T> => ({
  status,
  items,
  liveItems: items,
  historyItems: [],
  lastUpdate,
  replayTime: null,
  replayComplete: false,
  paused: false,
  dropped: 0,
  togglePause: () => {}
});

type PausableTapeViewConfig<T extends SortableItem & { seq: number }> = {
  enabled: boolean;
  sourceStatus: WsStatus;
  sourceItems: T[];
  historyTail?: T[];
  lastUpdate: number | null;
  onNewItems?: (count: number) => void;
  captureScroll?: () => void;
  retentionLimit?: number;
  shouldHold?: () => boolean;
  resumeSignal?: number;
};

const usePausableTapeView = <T extends SortableItem & { seq: number }>(
  config: PausableTapeViewConfig<T>
): TapeState<T> => {
  const [data, setData] = useState<PausableTapeData<T>>(EMPTY_PAUSABLE_TAPE);
  const displayedHistoryRef = useRef<T[]>([]);
  const holdForScroll = config.enabled ? (config.shouldHold ? config.shouldHold() : false) : false;

  useEffect(() => {
    if (!config.enabled) {
      setData(EMPTY_PAUSABLE_TAPE);
      return;
    }

    setData((current) => {
      const next = reducePausableTapeData(
        current,
        config.sourceItems,
        holdForScroll,
        config.retentionLimit ?? LIVE_HOT_WINDOW
      );
      if (next === current) {
        return current;
      }

      const unseenCount = next.seenKeys.size - current.seenKeys.size;
      if (unseenCount > 0) {
        config.onNewItems?.(unseenCount);
        config.captureScroll?.();
      }

      return next;
    });
  }, [
    config.enabled,
    config.sourceItems,
    config.onNewItems,
    config.captureScroll,
    config.retentionLimit,
    holdForScroll
  ]);

  useEffect(() => {
    if (!config.enabled || holdForScroll) {
      return;
    }

    setData((current) => {
      const next = flushPausableTapeData(current, config.retentionLimit ?? LIVE_HOT_WINDOW);
      if (next === current) {
        return current;
      }

      if (current.queued.length > 0) {
        config.onNewItems?.(current.queued.length);
        config.captureScroll?.();
      }

      return next;
    });
  }, [
    config.captureScroll,
    config.enabled,
    config.onNewItems,
    config.retentionLimit,
    config.resumeSignal,
    holdForScroll
  ]);

  const status = config.enabled ? config.sourceStatus : "disconnected";
  const projected = projectPausableTapeState(data.visible, status, config.lastUpdate);
  const historyItems = config.historyTail ?? [];
  const displayedHistoryItems = useMemo(() => {
    if (!config.enabled) {
      displayedHistoryRef.current = [];
      return [];
    }

    if (!holdForScroll) {
      displayedHistoryRef.current = historyItems;
      return historyItems;
    }

    const next = mergeHeldTapeHistory(displayedHistoryRef.current, historyItems, projected.items);
    displayedHistoryRef.current = next;
    return next;
  }, [config.enabled, historyItems, holdForScroll, projected.items]);
  const items = useMemo(
    () => composeTapeItems([], projected.items, displayedHistoryItems),
    [projected.items, displayedHistoryItems]
  );

  return {
    status,
    items,
    liveItems: projected.items,
    historyItems: displayedHistoryItems,
    lastUpdate: projected.lastUpdate,
    replayTime: null,
    replayComplete: false,
    paused: holdForScroll,
    dropped: data.dropped,
    togglePause: () => {}
  };
};

const useLiveStream = <T extends SortableItem>(
  config: {
    enabled: boolean;
    wsPath: string;
    expectedType: MessageType;
    onNewItems?: (count: number) => void;
    captureScroll?: () => void;
    shouldHold?: () => boolean;
    resumeSignal?: number;
  }
): TapeState<T> => {
  const [status, setStatus] = useState<WsStatus>(
    config.enabled ? "connecting" : "disconnected"
  );
  const [items, setItems] = useState<T[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [replayTime] = useState<number | null>(null);
  const [replayComplete] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [dropped, setDropped] = useState<number>(0);
  const reconnectRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(paused);
  const pendingRef = useRef<T[]>([]);
  const pendingCountRef = useRef(0);
  const flushHandleRef = useRef<number | null>(null);
  const holdRef = useRef<T[]>([]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const cancelFlush = useCallback(() => {
    if (flushHandleRef.current !== null) {
      cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushHandleRef.current !== null) {
      return;
    }

    flushHandleRef.current = requestAnimationFrame(() => {
      flushHandleRef.current = null;
      const buffered = pendingRef.current;
      if (buffered.length === 0) {
        return;
      }
      pendingRef.current = [];

      const pendingCount = pendingCountRef.current;
      pendingCountRef.current = 0;

      if (config.onNewItems && pendingCount > 0) {
        config.onNewItems(pendingCount);
      }

      const shouldHold = config.shouldHold ? config.shouldHold() : false;
      if (!shouldHold && config.captureScroll) {
        config.captureScroll();
      }

      if (shouldHold) {
        holdRef.current = mergeNewest(buffered, holdRef.current, LIVE_HOT_WINDOW, (evicted) =>
          incrementRetentionMetric("hotWindowEvictions", evicted)
        );
        setLastUpdate(Date.now());
        return;
      }

      const nextBatch =
        holdRef.current.length > 0 ? [...holdRef.current, ...buffered] : buffered;
      holdRef.current = [];

      setItems((prev) =>
        mergeNewest(nextBatch, prev, LIVE_HOT_WINDOW, (evicted) =>
          incrementRetentionMetric("hotWindowEvictions", evicted)
        )
      );
      setLastUpdate(Date.now());
    });
  }, [config.captureScroll, config.onNewItems, config.shouldHold]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      if (!next) {
        setDropped(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!config.enabled) {
      setStatus("disconnected");
      setItems([]);
      setLastUpdate(null);
      pendingRef.current = [];
      pendingCountRef.current = 0;
      holdRef.current = [];
      cancelFlush();
      return;
    }

    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      setStatus("connecting");

      const socket = new WebSocket(buildWsUrl(config.wsPath));
      socketRef.current = socket;

      socket.onopen = () => {
        if (!active) {
          return;
        }
        setStatus("connected");
      };

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as StreamMessage<T>;
          if (!message || message.type !== config.expectedType) {
            return;
          }

          if (pausedRef.current) {
            setDropped((prev) => prev + 1);
            setLastUpdate(Date.now());
            return;
          }

          pendingRef.current.push(message.payload);
          pendingCountRef.current += 1;
          scheduleFlush();
        } catch (error) {
          console.warn("Failed to parse live stream payload", error);
        }
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        setStatus("disconnected");
        reconnectRef.current = window.setTimeout(() => {
          connect();
        }, 1000);
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }

        setStatus("disconnected");
        socket.close();
      };
    };

    connect();

    return () => {
      active = false;
      cancelFlush();
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [config.enabled, config.expectedType, config.wsPath, scheduleFlush, cancelFlush]);

  useEffect(() => {
    if (config.resumeSignal === undefined) {
      return;
    }
    if (config.shouldHold && config.shouldHold()) {
      return;
    }
    if (holdRef.current.length === 0) {
      return;
    }
    setItems((prev) =>
      mergeNewest(holdRef.current, prev, LIVE_HOT_WINDOW, (evicted) =>
        incrementRetentionMetric("hotWindowEvictions", evicted)
      )
    );
    holdRef.current = [];
    setLastUpdate(Date.now());
  }, [config.resumeSignal, config.shouldHold]);

  return {
    status,
    items,
    lastUpdate,
    replayTime,
    replayComplete,
    paused,
    dropped,
    togglePause
  };
};

const useFlowStream = (
  enabled: boolean,
  onNewItems?: (count: number) => void,
  captureScroll?: () => void,
  shouldHold?: () => boolean,
  resumeSignal?: number
): TapeState<FlowPacket> => {
  return useLiveStream<FlowPacket>({
    enabled,
    wsPath: "/ws/flow",
    expectedType: "flow-packet",
    onNewItems,
    captureScroll,
    shouldHold,
    resumeSignal
  });
};

type LiveSessionState = {
  status: WsStatus;
  connectedAt: number | null;
  lastUpdate: number | null;
  channelHealth: LiveHotChannelHealthMap;
  lastEventByChannel: Partial<Record<LiveSubscription["channel"], number>>;
  manifest: LiveSubscription[];
  historyCursors: Partial<Record<string, Cursor | null>>;
  historyLoading: Partial<Record<string, boolean>>;
  historyErrors: Partial<Record<string, string | null>>;
  loadOlder: (channel: LiveSubscription["channel"]) => Promise<void>;
  optionsHistory: OptionPrint[];
  nbboHistory: OptionNBBO[];
  equitiesHistory: EquityPrint[];
  equityJoinsHistory: EquityPrintJoin[];
  flowHistory: FlowPacket[];
  smartMoneyHistory: SmartMoneyEvent[];
  classifierHitsHistory: ClassifierHitEvent[];
  alertsHistory: AlertEvent[];
  newsHistory: NewsStory[];
  inferredDarkHistory: InferredDarkEvent[];
  options: OptionPrint[];
  nbbo: OptionNBBO[];
  equities: EquityPrint[];
  equityQuotes: EquityQuote[];
  equityJoins: EquityPrintJoin[];
  flow: FlowPacket[];
  smartMoney: SmartMoneyEvent[];
  classifierHits: ClassifierHitEvent[];
  alerts: AlertEvent[];
  news: NewsStory[];
  inferredDark: InferredDarkEvent[];
  chartCandles: EquityCandle[];
  chartOverlay: EquityPrint[];
};

type LiveHistoryResponse<T> = {
  data: T[];
  next_before: Cursor | null;
};

const LIVE_HISTORY_ENDPOINTS: Partial<Record<LiveSubscription["channel"], string>> = {
  options: "/history/options",
  nbbo: "/history/nbbo",
  equities: "/history/equities",
  "equity-quotes": "/history/equity-quotes",
  "equity-joins": "/history/equity-joins",
  flow: "/history/flow",
  "smart-money": "/history/smart-money",
  "classifier-hits": "/history/classifier-hits",
  alerts: "/history/alerts",
  news: "/history/news",
  "inferred-dark": "/history/inferred-dark"
};

const appendOptionFlowFilters = (params: URLSearchParams, filters: OptionFlowFilters | undefined): void => {
  if (!filters) {
    return;
  }
  if (filters.view) {
    params.set("view", filters.view);
  }
  if (filters.securityTypes?.length === 1) {
    params.set("security", filters.securityTypes[0]);
  } else if (filters.securityTypes && filters.securityTypes.length > 1) {
    params.set("security", "all");
  }
  if (filters.nbboSides?.length) {
    params.set("side", filters.nbboSides.join(","));
  }
  if (filters.optionTypes?.length) {
    params.set("type", filters.optionTypes.join(","));
  }
  if (typeof filters.minNotional === "number") {
    params.set("min_notional", String(filters.minNotional));
  }
};

const appendOptionScopeParams = (
  params: URLSearchParams,
  optionScope: OptionScope | undefined
): void => {
  if (optionScope?.underlying_ids?.length) {
    params.set("underlying_ids", optionScope.underlying_ids.join(","));
  }
  if (optionScope?.option_contract_id) {
    params.set("option_contract_id", optionScope.option_contract_id);
  }
};

export const getEffectiveOptionPrintFilters = (
  flowFilters: OptionFlowFilters,
  isOptionContractFocused: boolean
): OptionFlowFilters | undefined => {
  return isOptionContractFocused ? undefined : flowFilters;
};

export const getOptionScope = (
  activeTickers: string[],
  instrumentUnderlying: string | null,
  selectedInstrument: SelectedInstrument
): OptionScope => ({
  underlying_ids:
    selectedInstrument?.kind === "option-contract"
      ? instrumentUnderlying
        ? [instrumentUnderlying]
        : undefined
      : activeTickers.length > 0
        ? activeTickers
        : instrumentUnderlying
          ? [instrumentUnderlying]
          : undefined,
  option_contract_id:
    selectedInstrument?.kind === "option-contract" ? selectedInstrument.contractId : undefined
});

export const buildOptionTapeQueryParams = (
  filters: OptionFlowFilters | undefined,
  optionScope: OptionScope | undefined
): Record<string, string | undefined> => {
  const params = new URLSearchParams();
  appendOptionFlowFilters(params, filters);
  appendOptionScopeParams(params, optionScope);
  return Object.fromEntries(params.entries());
};

export const filterOptionTapeItems = (
  items: OptionPrint[],
  filters: OptionFlowFilters | undefined,
  selectedInstrument: SelectedInstrument,
  tickerSet: Set<string>,
  instrumentUnderlying: string | null
): OptionPrint[] => {
  return items.filter((print) => {
    const contractId = normalizeContractId(print.option_contract_id);
    if (selectedInstrument?.kind === "option-contract") {
      return contractId === selectedInstrument.contractId;
    }
    if (!matchesOptionPrintFilters(print, filters)) {
      return false;
    }
    const underlying = extractUnderlying(contractId);
    if (tickerSet.size === 0) {
      return !instrumentUnderlying || underlying === instrumentUnderlying;
    }
    return Boolean(underlying) && tickerSet.has(underlying.toUpperCase());
  });
};

export const shouldClearOptionFocusSeed = (
  seed: TapeFocusSeed<OptionPrint> | null,
  optionFocusScopeKey: string | null,
  currentOptionSubscriptionKey: string | null,
  liveItems: OptionPrint[],
  historyItems: OptionPrint[]
): boolean => {
  if (!seed) {
    return false;
  }
  if (seed.scopeKey !== optionFocusScopeKey) {
    return true;
  }
  if (seed.subscriptionKey && seed.subscriptionKey !== currentOptionSubscriptionKey) {
    return false;
  }
  const liveKeys = new Set(
    composeTapeItems([], liveItems, historyItems).map((item) => getTapeItemKey(item))
  );
  return seed.items.every((item) => liveKeys.has(getTapeItemKey(item)));
};

const appendLiveScopeParams = (params: URLSearchParams, subscription: LiveSubscription): void => {
  if ((subscription.channel === "options" || subscription.channel === "equities") && subscription.underlying_ids?.length) {
    params.set("underlying_ids", subscription.underlying_ids.join(","));
  }
  if (subscription.channel === "options" && subscription.option_contract_id) {
    params.set("option_contract_id", subscription.option_contract_id);
  }
};

const dedupeLiveSubscriptions = (subscriptions: LiveSubscription[]): LiveSubscription[] => {
  const seen = new Set<string>();
  return subscriptions.filter((subscription) => {
    const key = getLiveSubscriptionKey(subscription);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const getLiveManifest = (
  pathname: string,
  chartTicker: string,
  chartIntervalMs: number,
  flowFilters: OptionFlowFilters,
  optionScope?: OptionScope,
  equityScope?: EquityScope,
  optionPrintFilters?: OptionFlowFilters
): LiveSubscription[] => {
  const features = getRouteFeatures(pathname);
  const subscriptions: LiveSubscription[] = [];

  if (features.options) {
    subscriptions.push({
      channel: "options",
      filters:
        optionScope?.option_contract_id && optionPrintFilters === undefined
          ? undefined
          : optionPrintFilters ?? flowFilters,
      ...optionScope,
      snapshot_limit: LIVE_OPTIONS_HEAD_LIMIT
    });
  }
  if (features.nbbo) {
    subscriptions.push({ channel: "nbbo", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.equities) {
    subscriptions.push({ channel: "equities", ...equityScope, snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.flow) {
    subscriptions.push({ channel: "flow", filters: flowFilters, snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.news) {
    subscriptions.push({ channel: "news", snapshot_limit: LIVE_OPTIONS_HEAD_LIMIT });
  }
  if (features.alerts) {
    subscriptions.push({ channel: "alerts", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.smartMoney) {
    subscriptions.push({ channel: "smart-money", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.classifierHits) {
    subscriptions.push({ channel: "classifier-hits", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.inferredDark) {
    subscriptions.push({ channel: "inferred-dark", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.equityJoins) {
    subscriptions.push({ channel: "equity-joins", snapshot_limit: LIVE_HOT_WINDOW });
  }
  if (features.equityCandles) {
    subscriptions.push({
      channel: "equity-candles",
      underlying_id: chartTicker,
      interval_ms: chartIntervalMs
    });
  }
  if (features.equityOverlay) {
    subscriptions.push({
      channel: "equity-overlay",
      underlying_id: chartTicker
    });
  }

  return dedupeLiveSubscriptions(subscriptions);
};

const useLiveSession = (
  enabled: boolean,
  pathname: string,
  manifest: LiveSubscription[]
): LiveSessionState => {
  const [status, setStatus] = useState<WsStatus>(enabled ? "connecting" : "disconnected");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [channelHealth, setChannelHealth] = useState<LiveHotChannelHealthMap>({
    options: { freshness_age_ms: null, healthy: false },
    nbbo: { freshness_age_ms: null, healthy: false },
    equities: { freshness_age_ms: null, healthy: false },
    flow: { freshness_age_ms: null, healthy: false }
  });
  const [lastEventByChannel, setLastEventByChannel] = useState<
    Partial<Record<LiveSubscription["channel"], number>>
  >({});
  const [historyCursors, setHistoryCursors] = useState<Partial<Record<string, Cursor | null>>>({});
  const [historyLoading, setHistoryLoading] = useState<Partial<Record<string, boolean>>>({});
  const [historyErrors, setHistoryErrors] = useState<Partial<Record<string, string | null>>>({});
  const [options, setOptions] = useState<OptionPrint[]>([]);
  const [nbbo, setNbbo] = useState<OptionNBBO[]>([]);
  const [equities, setEquities] = useState<EquityPrint[]>([]);
  const [equityQuotes, setEquityQuotes] = useState<EquityQuote[]>([]);
  const [equityJoins, setEquityJoins] = useState<EquityPrintJoin[]>([]);
  const [flow, setFlow] = useState<FlowPacket[]>([]);
  const [smartMoney, setSmartMoney] = useState<SmartMoneyEvent[]>([]);
  const [classifierHits, setClassifierHits] = useState<ClassifierHitEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [news, setNews] = useState<NewsStory[]>([]);
  const [inferredDark, setInferredDark] = useState<InferredDarkEvent[]>([]);
  const [optionsHistory, setOptionsHistory] = useState<OptionPrint[]>([]);
  const [nbboHistory, setNbboHistory] = useState<OptionNBBO[]>([]);
  const [equitiesHistory, setEquitiesHistory] = useState<EquityPrint[]>([]);
  const [equityJoinsHistory, setEquityJoinsHistory] = useState<EquityPrintJoin[]>([]);
  const [flowHistory, setFlowHistory] = useState<FlowPacket[]>([]);
  const [smartMoneyHistory, setSmartMoneyHistory] = useState<SmartMoneyEvent[]>([]);
  const [classifierHitsHistory, setClassifierHitsHistory] = useState<ClassifierHitEvent[]>([]);
  const [alertsHistory, setAlertsHistory] = useState<AlertEvent[]>([]);
  const [newsHistory, setNewsHistory] = useState<NewsStory[]>([]);
  const [inferredDarkHistory, setInferredDarkHistory] = useState<InferredDarkEvent[]>([]);
  const [chartCandles, setChartCandles] = useState<EquityCandle[]>([]);
  const [chartOverlay, setChartOverlay] = useState<EquityPrint[]>([]);
  const optionsRef = useRef<OptionPrint[]>([]);
  const nbboRef = useRef<OptionNBBO[]>([]);
  const equitiesRef = useRef<EquityPrint[]>([]);
  const equityQuotesRef = useRef<EquityQuote[]>([]);
  const equityJoinsRef = useRef<EquityPrintJoin[]>([]);
  const flowRef = useRef<FlowPacket[]>([]);
  const smartMoneyRef = useRef<SmartMoneyEvent[]>([]);
  const classifierHitsRef = useRef<ClassifierHitEvent[]>([]);
  const alertsRef = useRef<AlertEvent[]>([]);
  const newsRef = useRef<NewsStory[]>([]);
  const inferredDarkRef = useRef<InferredDarkEvent[]>([]);
  const chartCandlesRef = useRef<EquityCandle[]>([]);
  const chartOverlayRef = useRef<EquityPrint[]>([]);
  const optionsHistoryRef = useRef<OptionPrint[]>([]);
  const nbboHistoryRef = useRef<OptionNBBO[]>([]);
  const equitiesHistoryRef = useRef<EquityPrint[]>([]);
  const equityJoinsHistoryRef = useRef<EquityPrintJoin[]>([]);
  const flowHistoryRef = useRef<FlowPacket[]>([]);
  const smartMoneyHistoryRef = useRef<SmartMoneyEvent[]>([]);
  const classifierHitsHistoryRef = useRef<ClassifierHitEvent[]>([]);
  const alertsHistoryRef = useRef<AlertEvent[]>([]);
  const newsHistoryRef = useRef<NewsStory[]>([]);
  const inferredDarkHistoryRef = useRef<InferredDarkEvent[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const idleWatchdogRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const lastEventAtRef = useRef<number | null>(null);
  const subscribedKeysRef = useRef<Set<string>>(new Set());
  const subscribedMapRef = useRef<Map<string, LiveSubscription>>(new Map());
  const replaceArrayState = <T,>(
    setter: Dispatch<SetStateAction<T[]>>,
    ref: { current: T[] },
    next: T[]
  ): void => {
    ref.current = next;
    setter(next);
  };

  const mergeHistoryState = <T extends SortableItem>(
    setter: Dispatch<SetStateAction<T[]>>,
    ref: { current: T[] },
    incoming: T[],
    liveHead: T[],
    cap = LIVE_HISTORY_SOFT_CAP
  ): void => {
    const next = appendHistoryTail(ref.current, incoming, liveHead, cap);
    ref.current = next;
    setter(next);
  };

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      setConnectedAt(null);
      setLastUpdate(null);
      setChannelHealth({
        options: { freshness_age_ms: null, healthy: false },
        nbbo: { freshness_age_ms: null, healthy: false },
        equities: { freshness_age_ms: null, healthy: false },
        flow: { freshness_age_ms: null, healthy: false }
      });
      setLastEventByChannel({});
      setHistoryCursors({});
      setHistoryLoading({});
      setHistoryErrors({});
      setOptions([]);
      setNbbo([]);
      setEquities([]);
      setEquityQuotes([]);
      setEquityJoins([]);
      setFlow([]);
      setSmartMoney([]);
      setClassifierHits([]);
      setAlerts([]);
      setNews([]);
      setInferredDark([]);
      setOptionsHistory([]);
      setNbboHistory([]);
      setEquitiesHistory([]);
      setEquityJoinsHistory([]);
      setFlowHistory([]);
      setSmartMoneyHistory([]);
      setClassifierHitsHistory([]);
      setAlertsHistory([]);
      setNewsHistory([]);
      setInferredDarkHistory([]);
      setChartCandles([]);
      setChartOverlay([]);
      optionsRef.current = [];
      nbboRef.current = [];
      equitiesRef.current = [];
      equityQuotesRef.current = [];
      equityJoinsRef.current = [];
      flowRef.current = [];
      smartMoneyRef.current = [];
      classifierHitsRef.current = [];
      alertsRef.current = [];
      newsRef.current = [];
      inferredDarkRef.current = [];
      chartCandlesRef.current = [];
      chartOverlayRef.current = [];
      optionsHistoryRef.current = [];
      nbboHistoryRef.current = [];
      equitiesHistoryRef.current = [];
      equityJoinsHistoryRef.current = [];
      flowHistoryRef.current = [];
      smartMoneyHistoryRef.current = [];
      classifierHitsHistoryRef.current = [];
      alertsHistoryRef.current = [];
      newsHistoryRef.current = [];
      inferredDarkHistoryRef.current = [];
      subscribedKeysRef.current = new Set();
      subscribedMapRef.current = new Map();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (idleWatchdogRef.current !== null) {
        window.clearInterval(idleWatchdogRef.current);
        idleWatchdogRef.current = null;
      }
      connectedAtRef.current = null;
      lastEventAtRef.current = null;
      return;
    }

    let active = true;

    const syncSubscriptions = (socket: WebSocket) => {
      const nextKeys = new Set(manifest.map(getLiveSubscriptionKey));
      const nextMap = new Map(manifest.map((sub) => [getLiveSubscriptionKey(sub), sub]));
      const currentKeys = subscribedKeysRef.current;
      const toSubscribe = manifest.filter((sub) => !currentKeys.has(getLiveSubscriptionKey(sub)));
      const toUnsubscribe = Array.from(currentKeys)
        .filter((key) => !nextKeys.has(key))
        .map((key) => subscribedMapRef.current.get(key) ?? null)
        .filter((sub): sub is LiveSubscription => sub !== null);

      if (toUnsubscribe.length > 0) {
        socket.send(JSON.stringify({ op: "unsubscribe", subscriptions: toUnsubscribe }));
      }
      if (toSubscribe.length > 0) {
        socket.send(JSON.stringify({ op: "subscribe", subscriptions: toSubscribe }));
      }
      subscribedKeysRef.current = nextKeys;
      subscribedMapRef.current = nextMap;
    };

    const handleMessage = (message: LiveServerMessage) => {
      if (message.op === "ready" || message.op === "heartbeat") {
        setChannelHealth(message.channel_health);
        return;
      }
      if (message.op === "error") {
        console.warn("Live socket error", message.message);
        return;
      }

      const subscription = message.op === "snapshot" ? message.snapshot.subscription : message.subscription;
      const items = message.op === "snapshot" ? message.snapshot.items : [message.item];
      const subscriptionKey = getLiveSubscriptionKey(subscription);
      const updateAt = Date.now();

      const mergeItems = <T extends SortableItem>(
        setter: Dispatch<SetStateAction<T[]>>,
        ref: { current: T[] },
        nextItems: T[],
        retentionLimit = LIVE_HOT_WINDOW,
        history?: {
          setter: Dispatch<SetStateAction<T[]>>;
          ref: { current: T[] };
          cap?: number;
        }
      ) => {
        if (message.op === "snapshot") {
          const next = shouldRetainLiveSnapshotHistory(
            subscription.channel,
            true,
            nextItems.length,
            ref.current.length
          )
            ? ref.current
            : nextItems;
          replaceArrayState(setter, ref, next);
          return;
        }

        const { kept, evicted } = mergeNewestWithOverflow(
          nextItems,
          ref.current,
          retentionLimit,
          (evictedCount) => incrementRetentionMetric("hotWindowEvictions", evictedCount)
        );
        replaceArrayState(setter, ref, kept);
        if (history && evicted.length > 0) {
          mergeHistoryState(history.setter, history.ref, evicted, kept, history.cap);
        }
      };

      switch (subscription.channel) {
        case "options":
          mergeItems(setOptions, optionsRef, items as OptionPrint[], LIVE_OPTIONS_HEAD_LIMIT, {
            setter: setOptionsHistory,
            ref: optionsHistoryRef,
            cap: getLiveHistoryRetentionCap(subscription)
          });
          break;
        case "nbbo":
          mergeItems(setNbbo, nbboRef, items as OptionNBBO[], LIVE_HOT_WINDOW, {
            setter: setNbboHistory,
            ref: nbboHistoryRef
          });
          break;
        case "equities":
          mergeItems(setEquities, equitiesRef, items as EquityPrint[], LIVE_HOT_WINDOW, {
            setter: setEquitiesHistory,
            ref: equitiesHistoryRef,
            cap: getLiveHistoryRetentionCap(subscription)
          });
          break;
        case "equity-quotes":
          mergeItems(setEquityQuotes, equityQuotesRef, items as EquityQuote[]);
          break;
        case "equity-joins":
          mergeItems(setEquityJoins, equityJoinsRef, items as EquityPrintJoin[], LIVE_HOT_WINDOW, {
            setter: setEquityJoinsHistory,
            ref: equityJoinsHistoryRef
          });
          break;
        case "flow":
          mergeItems(setFlow, flowRef, items as FlowPacket[], LIVE_HOT_WINDOW, {
            setter: setFlowHistory,
            ref: flowHistoryRef
          });
          break;
        case "smart-money":
          mergeItems(setSmartMoney, smartMoneyRef, items as SmartMoneyEvent[], LIVE_HOT_WINDOW, {
            setter: setSmartMoneyHistory,
            ref: smartMoneyHistoryRef
          });
          break;
        case "classifier-hits":
          mergeItems(
            setClassifierHits,
            classifierHitsRef,
            items as ClassifierHitEvent[],
            LIVE_HOT_WINDOW,
            {
              setter: setClassifierHitsHistory,
              ref: classifierHitsHistoryRef
            }
          );
          break;
        case "alerts":
          mergeItems(setAlerts, alertsRef, items as AlertEvent[], LIVE_HOT_WINDOW, {
            setter: setAlertsHistory,
            ref: alertsHistoryRef
          });
          break;
        case "news":
          mergeItems(setNews, newsRef, items as NewsStory[], LIVE_OPTIONS_HEAD_LIMIT, {
            setter: setNewsHistory,
            ref: newsHistoryRef
          });
          break;
        case "inferred-dark":
          mergeItems(setInferredDark, inferredDarkRef, items as InferredDarkEvent[], LIVE_HOT_WINDOW, {
            setter: setInferredDarkHistory,
            ref: inferredDarkHistoryRef
          });
          break;
        case "equity-candles":
          mergeItems(setChartCandles, chartCandlesRef, items as EquityCandle[]);
          break;
        case "equity-overlay":
          mergeItems(setChartOverlay, chartOverlayRef, items as EquityPrint[]);
          break;
      }

      if (message.op === "snapshot") {
        setHistoryCursors((current) => ({
          ...current,
          [subscriptionKey]: message.snapshot.next_before
        }));
        setHistoryErrors((current) => ({
          ...current,
          [subscriptionKey]: null
        }));
      }

      if (items.length > 0) {
        lastEventAtRef.current = updateAt;
        setLastEventByChannel((current) => ({
          ...current,
          [subscription.channel]: updateAt
        }));
      }

      setLastUpdate(updateAt);
    };

    const connect = () => {
      if (!active) {
        return;
      }
      setStatus("connecting");
      const socket = new WebSocket(buildWsUrl("/ws/live"));
      socketRef.current = socket;

      socket.onopen = () => {
        if (!active) {
          return;
        }
        setStatus("connected");
        const now = Date.now();
        setConnectedAt(now);
        connectedAtRef.current = now;
        lastEventAtRef.current = null;
        syncSubscriptions(socket);
      };

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }
        try {
          const parsed = JSON.parse(event.data) as LiveServerMessage;
          handleMessage(parsed);
        } catch (error) {
          console.warn("Failed to parse live session payload", error);
        }
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }
        setStatus("disconnected");
        setConnectedAt(null);
        connectedAtRef.current = null;
        lastEventAtRef.current = null;
        subscribedKeysRef.current = new Set();
        subscribedMapRef.current = new Map();
        reconnectRef.current = window.setTimeout(connect, 1000);
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }
        setStatus("disconnected");
        setConnectedAt(null);
        connectedAtRef.current = null;
        lastEventAtRef.current = null;
        socket.close();
      };
    };

    connect();
    idleWatchdogRef.current = window.setInterval(() => {
      if (!active) {
        return;
      }
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const hasHotSubscription = Array.from(subscribedMapRef.current.values()).some((sub) =>
        LIVE_SESSION_HOT_CHANNELS.has(sub.channel)
      );
      if (!hasHotSubscription) {
        return;
      }
      const baseline = lastEventAtRef.current ?? connectedAtRef.current;
      if (baseline === null) {
        return;
      }
      if (Date.now() - baseline >= LIVE_SESSION_IDLE_RECONNECT_MS) {
        console.warn("Live socket idle; reconnecting");
        socket.close();
      }
    }, LIVE_SESSION_IDLE_CHECK_MS);

    return () => {
      active = false;
      if (idleWatchdogRef.current !== null) {
        window.clearInterval(idleWatchdogRef.current);
        idleWatchdogRef.current = null;
      }
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [enabled]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!enabled || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const nextKeys = new Set(manifest.map(getLiveSubscriptionKey));
    const nextMap = new Map(manifest.map((sub) => [getLiveSubscriptionKey(sub), sub]));
    const currentKeys = subscribedKeysRef.current;
    const toSubscribe = manifest.filter((sub) => !currentKeys.has(getLiveSubscriptionKey(sub)));
    const removedKeys = Array.from(currentKeys).filter((key) => !nextKeys.has(key));
    const resetScopedChannels = new Set(
      [...removedKeys, ...toSubscribe.map(getLiveSubscriptionKey)]
        .map((key) => subscribedMapRef.current.get(key) ?? nextMap.get(key) ?? null)
        .filter((sub): sub is LiveSubscription => sub !== null)
        .map((sub) => sub.channel)
        .filter((channel) => channel === "options" || channel === "equities")
    );
    if (resetScopedChannels.has("options")) {
      optionsRef.current = [];
      optionsHistoryRef.current = [];
      setOptions([]);
      setOptionsHistory([]);
    }
    if (resetScopedChannels.has("equities")) {
      equitiesRef.current = [];
      equitiesHistoryRef.current = [];
      setEquities([]);
      setEquitiesHistory([]);
    }
    if (resetScopedChannels.size > 0) {
      setHistoryCursors((current) => {
        const next = { ...current };
        for (const key of [...removedKeys, ...toSubscribe.map(getLiveSubscriptionKey)]) {
          delete next[key];
        }
        return next;
      });
      setHistoryLoading((current) => {
        const next = { ...current };
        for (const key of [...removedKeys, ...toSubscribe.map(getLiveSubscriptionKey)]) {
          delete next[key];
        }
        return next;
      });
      setHistoryErrors((current) => {
        const next = { ...current };
        for (const key of [...removedKeys, ...toSubscribe.map(getLiveSubscriptionKey)]) {
          delete next[key];
        }
        return next;
      });
    }

    if (removedKeys.length > 0) {
      const removedSubs = removedKeys
        .map((key) => subscribedMapRef.current.get(key) ?? null)
        .filter((sub): sub is LiveSubscription => sub !== null);
      if (removedSubs.length > 0) {
        socket.send(JSON.stringify({ op: "unsubscribe", subscriptions: removedSubs }));
      }
    }
    if (toSubscribe.length > 0) {
      socket.send(JSON.stringify({ op: "subscribe", subscriptions: toSubscribe }));
    }
    subscribedKeysRef.current = nextKeys;
    subscribedMapRef.current = nextMap;
  }, [enabled, manifest]);

  const loadOlder = useCallback(
    async (channel: LiveSubscription["channel"]) => {
      const subscription = manifest.find((candidate) => candidate.channel === channel);
      if (!enabled || !subscription) {
        return;
      }
      const endpoint = LIVE_HISTORY_ENDPOINTS[subscription.channel];
      if (!endpoint) {
        return;
      }
      const key = getLiveSubscriptionKey(subscription);
      const cursor = historyCursors[key];
      if (!cursor || historyLoading[key]) {
        return;
      }

      setHistoryLoading((current) => ({ ...current, [key]: true }));
      setHistoryErrors((current) => ({ ...current, [key]: null }));

      try {
        const params = new URLSearchParams({
          before_ts: String(cursor.ts),
          before_seq: String(cursor.seq),
          limit: String(subscription.channel === "options" ? LIVE_HISTORY_BATCH : 200)
        });
        if (subscription.channel === "options" || subscription.channel === "flow") {
          appendOptionFlowFilters(params, subscription.filters);
        }
        appendLiveScopeParams(params, subscription);
        const url = new URL(buildApiUrl(endpoint));
        url.search = params.toString();
        const response = await fetch(url.toString());
        if (!response.ok) {
          const detail = await readErrorDetail(response);
          throw new Error(detail || `HTTP ${response.status}`);
        }
        const payload = (await response.json()) as LiveHistoryResponse<SortableItem>;
        const older = payload.data ?? [];

        const mergeOlder = <T extends SortableItem>(
          setter: Dispatch<SetStateAction<T[]>>,
          ref: { current: T[] },
          liveHead: T[],
          cap = LIVE_HISTORY_SOFT_CAP
        ) => {
          mergeHistoryState(setter, ref, older as T[], liveHead, cap);
        };

        switch (subscription.channel) {
          case "options":
            mergeOlder(
              setOptionsHistory,
              optionsHistoryRef,
              optionsRef.current,
              getLiveHistoryRetentionCap(subscription)
            );
            break;
          case "nbbo":
            mergeOlder(setNbboHistory, nbboHistoryRef, nbboRef.current);
            break;
          case "equities":
            mergeOlder(
              setEquitiesHistory,
              equitiesHistoryRef,
              equitiesRef.current,
              getLiveHistoryRetentionCap(subscription)
            );
            break;
          case "equity-quotes":
            break;
          case "equity-joins":
            mergeOlder(setEquityJoinsHistory, equityJoinsHistoryRef, equityJoinsRef.current);
            break;
          case "flow":
            mergeOlder(setFlowHistory, flowHistoryRef, flowRef.current);
            break;
          case "smart-money":
            mergeOlder(setSmartMoneyHistory, smartMoneyHistoryRef, smartMoneyRef.current);
            break;
          case "classifier-hits":
            mergeOlder(
              setClassifierHitsHistory,
              classifierHitsHistoryRef,
              classifierHitsRef.current
            );
            break;
          case "alerts":
            mergeOlder(setAlertsHistory, alertsHistoryRef, alertsRef.current);
            break;
          case "news":
            mergeOlder(setNewsHistory, newsHistoryRef, newsRef.current);
            break;
          case "inferred-dark":
            mergeOlder(setInferredDarkHistory, inferredDarkHistoryRef, inferredDarkRef.current);
            break;
        }

        setHistoryCursors((current) => ({
          ...current,
          [key]: older.length > 0 ? payload.next_before : null
        }));
        setLastUpdate(Date.now());
      } catch (error) {
        setHistoryErrors((current) => ({
          ...current,
          [key]: error instanceof Error ? error.message : String(error)
        }));
      } finally {
        setHistoryLoading((current) => ({ ...current, [key]: false }));
      }
    },
    [enabled, manifest, historyCursors, historyLoading]
  );

  return {
    status,
    connectedAt,
    lastUpdate,
    channelHealth,
    lastEventByChannel,
    manifest,
    historyCursors,
    historyLoading,
    historyErrors,
    loadOlder,
    optionsHistory,
    nbboHistory,
    equitiesHistory,
    equityJoinsHistory,
    flowHistory,
    smartMoneyHistory,
    classifierHitsHistory,
    alertsHistory,
    newsHistory,
    inferredDarkHistory,
    options,
    nbbo,
    equities,
    equityQuotes,
    equityJoins,
    flow,
    smartMoney,
    classifierHits,
    alerts,
    news,
    inferredDark,
    chartCandles,
    chartOverlay
  };
};

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
    <div className={`status-inline status-${status} ${mode === "replay" ? "status-replay" : ""}`.trim()}>
      <span className="status-dot" />
      <span className="status-inline-label">{label}</span>
      {mode === "replay" ? (
        <span className="status-inline-meta">
          Replay time {replayTime ? formatTime(replayTime) : "—"}
        </span>
      ) : null}
      <span className={`status-inline-counter${pausedLabel ? " status-inline-counter-visible" : ""}`}>
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

const TapeControls = ({ mode, paused, onTogglePause, isAtTop, missed, onJump }: TapeControlsProps) => {
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
      <span className={`missed-count${active ? " missed-count-visible" : ""}`} aria-hidden={!active}>
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
  smartMoneyEvents: SmartMoneyEvent[];
  inferredDark: InferredDarkEvent[];
  onSmartMoneyClick: (event: SmartMoneyEvent) => void;
  onInferredDarkClick: (event: InferredDarkEvent) => void;
};

type MarkerAction =
  | { kind: "smart-money"; event: SmartMoneyEvent }
  | { kind: "dark"; event: InferredDarkEvent };

const CandleChart = ({
  ticker,
  intervalMs,
  mode,
  replayTime = null,
  liveCandles = [],
  liveOverlayPrints = [],
  smartMoneyEvents,
  inferredDark,
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

    const { from, to } = visibleRangeMs;
    const inRangeSmartMoney = smartMoneyEvents
      .filter((event) => event.source_ts >= from && event.source_ts <= to)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
    const inRangeDark = inferredDark
      .filter((event) => event.source_ts >= from && event.source_ts <= to)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });

    const MAX_SMART_MONEY_MARKERS = 220;
    const MAX_DARK_MARKERS = 120;
    const MAX_TOTAL_MARKERS = 320;

    const cappedSmartMoney =
      inRangeSmartMoney.length > MAX_SMART_MONEY_MARKERS
        ? inRangeSmartMoney.slice(inRangeSmartMoney.length - MAX_SMART_MONEY_MARKERS)
        : inRangeSmartMoney;
    const cappedDark =
      inRangeDark.length > MAX_DARK_MARKERS
        ? inRangeDark.slice(inRangeDark.length - MAX_DARK_MARKERS)
        : inRangeDark;

    for (const event of cappedSmartMoney) {
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
          direction === "bullish"
            ? "arrowUp"
            : direction === "bearish"
              ? "arrowDown"
              : "circle",
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
  }, [smartMoneyEvents, inferredDark, visibleRangeMs]);

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
        background: { color: "#fffdf7" },
        textColor: "#4e3e25"
      },
      grid: {
        vertLines: { color: "rgba(82, 64, 36, 0.12)" },
        horzLines: { color: "rgba(82, 64, 36, 0.12)" }
      },
      crosshair: {
        vertLine: { color: "rgba(47, 109, 79, 0.35)" },
        horzLine: { color: "rgba(47, 109, 79, 0.35)" }
      },
      timeScale: {
        borderColor: "rgba(111, 91, 57, 0.35)",
        timeVisible: true,
        secondsVisible: intervalMs < 60000
      },
      rightPriceScale: {
        borderColor: "rgba(111, 91, 57, 0.35)"
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
      upColor: "#2f6d4f",
      downColor: "#c46f2a",
      borderVisible: false,
      wickUpColor: "#2f6d4f",
      wickDownColor: "#c46f2a"
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
      if (action.kind === "smart-money") {
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
          throw new Error(
            `Candle fetch failed (${response.status})${detail ? `: ${detail}` : ""}`
          );
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
      url.searchParams.set("limit", "2500");

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

    const sortedCandles = [...liveCandles].sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));
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

type EvidenceItem =
  | { kind: "flow"; id: string; packet: FlowPacket }
  | { kind: "print"; id: string; print: OptionPrint }
  | { kind: "unknown"; id: string };

type AlertContextBundle = {
  alert: AlertEvent | null;
  flow_packets: FlowPacket[];
  option_prints: OptionPrint[];
  missing_refs: string[];
};

type AlertContextStatus = {
  traceId: string | null;
  loading: boolean;
  missingRefs: string[];
  error: string | null;
};

export const buildAlertContextPath = (traceId: string): string =>
  `/flow/alerts/${encodeURIComponent(traceId)}/context`;

export const collectAlertContextEvidence = (
  bundle: AlertContextBundle
): {
  packets: Map<string, FlowPacket>;
  prints: Map<string, OptionPrint>;
} => {
  const packets = new Map<string, FlowPacket>();
  const prints = new Map<string, OptionPrint>();

  for (const packet of bundle.flow_packets) {
    if (packet.id) {
      packets.set(packet.id, packet);
    }
    if (packet.trace_id) {
      packets.set(packet.trace_id, packet);
    }
  }
  for (const print of bundle.option_prints) {
    if (print.trace_id) {
      prints.set(print.trace_id, print);
    }
  }

  return { packets, prints };
};

type DarkEvidenceItem =
  | { kind: "join"; id: string; join: EquityPrintJoin }
  | { kind: "unknown"; id: string };

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
        <div className="drawer-section drawer-context-loading" aria-label="Loading persisted evidence">
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
              <span>{formatFlowMetric(parseNumber(flowPacket.features.count, flowPacket.members.length))} prints</span>
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
          <p className="drawer-empty">Persisted evidence prints are not available for this alert.</p>
        ) : (
          <div className="drawer-list">
            {evidencePrints.slice(0, 6).map((item) => (
              <div className="drawer-row" key={item.id}>
                <div className="drawer-row-title">{item.print.option_contract_id}</div>
                <div className="drawer-row-meta">
                  <span>${formatPrice(item.print.price)}</span>
                  <span>{formatSize(item.print.size)}x</span>
                  <span>{item.print.exchange}</span>
                  {item.print.execution_nbbo_side ? <span>Side {item.print.execution_nbbo_side}</span> : null}
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
          <p className="drawer-empty">+{unknownCount} evidence refs unresolved in persisted context.</p>
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

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <p className="drawer-eyebrow">News wire</p>
          <h3>{story.headline}</h3>
          <p className="drawer-subtitle">
            {story.source} · Published {formatDateTime(story.published_ts)}
            {story.updated_ts !== story.published_ts ? ` · Updated ${formatDateTime(story.updated_ts)}` : ""}
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

      {story.summary ? (
        <div className="drawer-section">
          <h4>Summary</h4>
          <p className="drawer-note">{story.summary}</p>
        </div>
      ) : null}

      <div className="drawer-section">
        <h4>Story</h4>
        {body.sanitized && body.html ? (
          <div className="drawer-note news-drawer-body" dangerouslySetInnerHTML={{ __html: body.html }} />
        ) : body.fallbackText ? (
          <p className="drawer-note">{body.fallbackText}</p>
        ) : (
          <p className="drawer-empty">Story body unavailable.</p>
        )}
      </div>

      {story.url ? (
        <div className="drawer-section">
          <h4>Source link</h4>
          <a className="terminal-button terminal-link-button" href={story.url} rel="noreferrer" target="_blank">
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
          <p className="drawer-empty">+{hit.explanations.length - 6} more explanations not shown.</p>
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
                {formatFlowMetric(parseNumber(flowPacket.features.count, flowPacket.members.length))} prints
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
          <p className="drawer-eyebrow">Smart money profile</p>
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
          Probability {primaryScore ? formatConfidence(primaryScore.probability) : "--"}
        </span>
        {event.abstained ? <span className="drawer-chip">Abstained</span> : null}
      </div>

      <div className="drawer-section">
        <h4>Profile ladder</h4>
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
        {flowPacket ? (
          <p className="drawer-note">Flow packet {flowPacket.id}</p>
        ) : null}
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

const TICKER_FILTER_INPUT_MAX_LENGTH = 120;

export const normalizeTickerFilterInput = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/，/g, ",")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, TICKER_FILTER_INPUT_MAX_LENGTH);

export const parseTickerFilterInput = (value: string): string[] => {
  const parts = normalizeTickerFilterInput(value)
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
};

const useTerminalState = () => {
  const pathname = usePathname();
  const routeFeatures = useMemo(() => getRouteFeatures(pathname), [pathname]);
  const [mode, setMode] = useState<TapeMode>("live");
  const [replaySource, setReplaySource] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertEvent | null>(null);
  const [selectedNewsStory, setSelectedNewsStory] = useState<NewsStory | null>(null);
  const [selectedDarkEvent, setSelectedDarkEvent] = useState<InferredDarkEvent | null>(null);
  const [selectedClassifierHit, setSelectedClassifierHit] = useState<ClassifierHitEvent | null>(null);
  const [selectedSmartMoneyEvent, setSelectedSmartMoneyEvent] = useState<SmartMoneyEvent | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<SelectedInstrument>(null);
  const [optionFocusSeed, setOptionFocusSeed] = useState<TapeFocusSeed<OptionPrint> | null>(null);
  const [equityFocusSeed, setEquityFocusSeed] = useState<TapeFocusSeed<EquityPrint> | null>(null);
  const [filterInput, setFilterInput] = useState<string>("");
  const [flowFilters, setFlowFilters] = useState<OptionFlowFilters>(() => buildDefaultFlowFilters());
  const [chartIntervalMs, setChartIntervalMs] = useState<number>(CANDLE_INTERVALS[0].ms);
  const activeTickers = useMemo(() => parseTickerFilterInput(filterInput), [filterInput]);
  const tickerSet = useMemo(() => new Set(activeTickers), [activeTickers]);
  const instrumentUnderlying = selectedInstrument?.underlyingId.toUpperCase() ?? null;
  const isOptionContractFocused = selectedInstrument?.kind === "option-contract";
  const focusedOptionContractId =
    selectedInstrument?.kind === "option-contract" ? selectedInstrument.contractId : null;
  const optionFocusScopeKey =
    focusedOptionContractId ? `option-contract:${focusedOptionContractId}` : null;
  const equityFocusScopeKey =
    selectedInstrument?.kind === "equity"
      ? `equity:${selectedInstrument.underlyingId.toUpperCase()}`
      : null;
  const effectiveOptionPrintFilters = useMemo(
    () => getEffectiveOptionPrintFilters(flowFilters, isOptionContractFocused),
    [flowFilters, isOptionContractFocused]
  );
  const optionScope = useMemo(
    () => getOptionScope(activeTickers, instrumentUnderlying, selectedInstrument),
    [activeTickers, instrumentUnderlying, selectedInstrument]
  );
  const equityScope = useMemo(
    () => ({
      underlying_ids: activeTickers.length > 0 ? activeTickers : instrumentUnderlying ? [instrumentUnderlying] : undefined
    }),
    [activeTickers, instrumentUnderlying]
  );
  const chartTicker = useMemo(
    () => instrumentUnderlying ?? activeTickers[0] ?? "SPY",
    [activeTickers, instrumentUnderlying]
  );
  const selectedInstrumentLabel = useMemo(() => {
    if (!selectedInstrument) {
      return null;
    }
    if (selectedInstrument.kind === "equity") {
      return `Equity: ${selectedInstrument.underlyingId}`;
    }
    const display = formatOptionContractLabel(selectedInstrument.contractId);
    return display
      ? `Contract: ${display.ticker} ${display.expiration} ${display.strike}`
      : `Contract: ${selectedInstrument.contractId}`;
  }, [selectedInstrument]);
  const liveManifest = useMemo(
    () =>
      getLiveManifest(
        pathname,
        chartTicker.toUpperCase(),
        chartIntervalMs,
        flowFilters,
        optionScope,
        equityScope,
        effectiveOptionPrintFilters
      ),
    [
      pathname,
      chartTicker,
      chartIntervalMs,
      flowFilters,
      optionScope,
      equityScope,
      effectiveOptionPrintFilters
    ]
  );
  const liveSession = useLiveSession(mode === "live", pathname, liveManifest);
  const currentOptionSubscription = useMemo(
    () =>
      liveManifest.find(
        (subscription): subscription is Extract<LiveSubscription, { channel: "options" }> =>
          subscription.channel === "options"
      ) ?? null,
    [liveManifest]
  );
  const currentOptionSubscriptionKey = useMemo(
    () => (currentOptionSubscription ? getLiveSubscriptionKey(currentOptionSubscription) : null),
    [currentOptionSubscription]
  );
  const equitiesLiveSubscriptionActive = routeFeatures.equities;

  const handleReplaySource = useCallback((value: string | null) => {
    setReplaySource(value);
  }, []);

  useEffect(() => {
    setReplaySource(null);
  }, [mode]);

  useEffect(() => {
    if (!selectedAlert && !selectedNewsStory && !selectedClassifierHit && !selectedDarkEvent && !selectedSmartMoneyEvent) {
      return;
    }

    const dismissDrawers = () => {
      setSelectedAlert(null);
      setSelectedNewsStory(null);
      setSelectedClassifierHit(null);
      setSelectedSmartMoneyEvent(null);
      setSelectedDarkEvent(null);
    };

    const handlePointerDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(".drawer")) {
        return;
      }
      dismissDrawers();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissDrawers();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedAlert, selectedNewsStory, selectedClassifierHit, selectedDarkEvent, selectedSmartMoneyEvent]);

  const optionsScroll = useListScroll();
  const equitiesScroll = useListScroll();
  const flowScroll = useListScroll();
  const darkScroll = useListScroll();
  const alertsScroll = useListScroll();
  const classifierScroll = useListScroll();

  const optionsAnchor = useScrollAnchor(optionsScroll.listRef, optionsScroll.isAtTopRef);
  const equitiesAnchor = useScrollAnchor(equitiesScroll.listRef, equitiesScroll.isAtTopRef);
  const flowAnchor = useScrollAnchor(flowScroll.listRef, flowScroll.isAtTopRef);
  const darkAnchor = useScrollAnchor(darkScroll.listRef, darkScroll.isAtTopRef);
  const alertsAnchor = useScrollAnchor(alertsScroll.listRef, alertsScroll.isAtTopRef);
  const classifierAnchor = useScrollAnchor(
    classifierScroll.listRef,
    classifierScroll.isAtTopRef
  );
  const disableReplayGrouping = useCallback(() => null, []);
  const optionQueryParams = useMemo<Record<string, string | undefined>>(
    () => buildOptionTapeQueryParams(effectiveOptionPrintFilters, optionScope),
    [effectiveOptionPrintFilters, optionScope]
  );

  const options = useTape<OptionPrint>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/options",
    replayPath: "/replay/options",
    latestPath: "/prints/options",
    expectedType: "option-print",
    hotWindowLimit: LIVE_HOT_WINDOW_OPTIONS,
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: optionsAnchor.capture,
    onNewItems: optionsScroll.onNewItems,
    getReplayKey: isOptionContractFocused ? disableReplayGrouping : extractReplaySource,
    onReplaySourceKey: isOptionContractFocused ? undefined : handleReplaySource,
    queryParams: optionQueryParams,
    replaySourceKey: isOptionContractFocused ? null : replaySource
  });

  const equities = useTape<EquityPrint>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/equities",
    replayPath: "/replay/equities",
    latestPath: "/prints/equities",
    expectedType: "equity-print",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: equitiesAnchor.capture,
    onNewItems: equitiesScroll.onNewItems
  });

  useEffect(() => {
    if (isOptionContractFocused && replaySource !== null) {
      setReplaySource(null);
    }
  }, [isOptionContractFocused, replaySource]);

  const equityJoins = useTape<EquityPrintJoin>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/equity-joins",
    replayPath: "/replay/equity-joins",
    latestPath: "/joins/equities",
    expectedType: "equity-join",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    getReplayKey: disableReplayGrouping
  });

  const nbbo = useTape<OptionNBBO>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/options-nbbo",
    replayPath: "/replay/nbbo",
    latestPath: "/nbbo/options",
    expectedType: "option-nbbo",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    getReplayKey: extractReplaySource,
    replaySourceKey: replaySource
  });

  const inferredDark = useTape<InferredDarkEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/inferred-dark",
    replayPath: "/replay/inferred-dark",
    latestPath: "/dark/inferred",
    expectedType: "inferred-dark",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: darkAnchor.capture,
    onNewItems: darkScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });

  const flow = useTape<FlowPacket>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/flow",
    replayPath: "/replay/flow",
    latestPath: "/flow/packets",
    expectedType: "flow-packet",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: flowAnchor.capture,
    onNewItems: flowScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const alerts = useTape<AlertEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/alerts",
    replayPath: "/replay/alerts",
    latestPath: "/flow/alerts",
    expectedType: "alert",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: alertsAnchor.capture,
    onNewItems: alertsScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const classifierHits = useTape<ClassifierHitEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/classifier-hits",
    replayPath: "/replay/classifier-hits",
    latestPath: "/flow/classifier-hits",
    expectedType: "classifier-hit",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: classifierAnchor.capture,
    onNewItems: classifierScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const smartMoney = useTape<SmartMoneyEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/smart-money",
    replayPath: "/replay/smart-money",
    latestPath: "/flow/smart-money",
    expectedType: "smart-money",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: classifierAnchor.capture,
    onNewItems: classifierScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });

  const optionsChannelStatus = getHotChannelFeedStatus(liveSession.status, liveSession.channelHealth.options);
  const equitiesChannelStatus = getHotChannelFeedStatus(
    liveSession.status,
    liveSession.channelHealth.equities
  );
  const flowChannelStatus = getHotChannelFeedStatus(liveSession.status, liveSession.channelHealth.flow);

  const liveOptions = usePausableTapeView<OptionPrint>({
    enabled: mode === "live",
    sourceStatus: optionsChannelStatus,
    sourceItems: liveSession.options,
    historyTail: liveSession.optionsHistory,
    lastUpdate: liveSession.lastUpdate,
    retentionLimit: LIVE_OPTIONS_HEAD_LIMIT,
    captureScroll: optionsAnchor.capture,
    onNewItems: optionsScroll.onNewItems,
    shouldHold: () => !optionsScroll.isAtTopRef.current,
    resumeSignal: optionsScroll.resumeTick
  });
  const liveEquities = usePausableTapeView<EquityPrint>({
    enabled: mode === "live",
    sourceStatus: equitiesChannelStatus,
    sourceItems: liveSession.equities,
    historyTail: liveSession.equitiesHistory,
    lastUpdate: liveSession.lastUpdate,
    captureScroll: equitiesAnchor.capture,
    onNewItems: equitiesScroll.onNewItems,
    shouldHold: () => !equitiesScroll.isAtTopRef.current,
    resumeSignal: equitiesScroll.resumeTick
  });
  const liveFlow = usePausableTapeView<FlowPacket>({
    enabled: mode === "live",
    sourceStatus: flowChannelStatus,
    sourceItems: liveSession.flow,
    historyTail: liveSession.flowHistory,
    lastUpdate: liveSession.lastUpdate,
    captureScroll: flowAnchor.capture,
    onNewItems: flowScroll.onNewItems,
    shouldHold: () => !flowScroll.isAtTopRef.current,
    resumeSignal: flowScroll.resumeTick
  });

  const seededLiveOptionsItems = useMemo(
    () =>
      composeTapeItems(
        optionFocusSeed?.scopeKey === optionFocusScopeKey ? optionFocusSeed.items : [],
        liveOptions.liveItems ?? [],
        liveOptions.historyItems ?? []
      ),
    [liveOptions.historyItems, liveOptions.liveItems, optionFocusScopeKey, optionFocusSeed]
  );
  const seededLiveEquitiesItems = useMemo(
    () =>
      composeTapeItems(
        equityFocusSeed?.scopeKey === equityFocusScopeKey ? equityFocusSeed.items : [],
        liveEquities.liveItems ?? [],
        liveEquities.historyItems ?? []
      ),
    [equityFocusScopeKey, equityFocusSeed, liveEquities.historyItems, liveEquities.liveItems]
  );

  const optionsFeed =
    mode === "live" ? { ...liveOptions, items: seededLiveOptionsItems } : options;
  const nbboFeed =
    mode === "live"
      ? toStaticTapeState(
          getHotChannelFeedStatus(liveSession.status, liveSession.channelHealth.nbbo),
          composeTapeItems([], liveSession.nbbo, liveSession.nbboHistory),
          liveSession.lastUpdate
        )
      : nbbo;
  const equitiesFeed =
    mode === "live" ? { ...liveEquities, items: seededLiveEquitiesItems } : equities;
  const equityJoinsFeed =
    mode === "live"
      ? toStaticTapeState(
          liveSession.status,
          composeTapeItems([], liveSession.equityJoins, liveSession.equityJoinsHistory),
          liveSession.lastUpdate
        )
      : equityJoins;
  const flowFeed = mode === "live" ? liveFlow : flow;
  const newsFeed =
    mode === "live"
      ? toStaticTapeState(
          liveSession.status,
          composeTapeItems([], liveSession.news, liveSession.newsHistory),
          liveSession.lastUpdate
        )
      : toStaticTapeState("disconnected", [], null);
  const alertsFeed =
    mode === "live"
      ? toStaticTapeState(
          liveSession.status,
          composeTapeItems([], liveSession.alerts, liveSession.alertsHistory),
          liveSession.lastUpdate
        )
      : alerts;
  const classifierHitsFeed =
    mode === "live"
      ? toStaticTapeState(
          liveSession.status,
          composeTapeItems([], liveSession.classifierHits, liveSession.classifierHitsHistory),
          liveSession.lastUpdate
        )
      : classifierHits;
  const smartMoneyFeed =
    mode === "live"
      ? toStaticTapeState(
          liveSession.status,
          composeTapeItems([], liveSession.smartMoney, liveSession.smartMoneyHistory),
          liveSession.lastUpdate
        )
      : smartMoney;
  const inferredDarkFeed =
    mode === "live"
      ? toStaticTapeState(
          liveSession.status,
          composeTapeItems([], liveSession.inferredDark, liveSession.inferredDarkHistory),
          liveSession.lastUpdate
        )
      : inferredDark;

  useLayoutEffect(() => {
    optionsAnchor.apply();
  }, [optionsFeed.items, optionsAnchor.apply]);

  useLayoutEffect(() => {
    equitiesAnchor.apply();
  }, [equitiesFeed.items, equitiesAnchor.apply]);

  useLayoutEffect(() => {
    flowAnchor.apply();
  }, [flowFeed.items, flowAnchor.apply]);

  useLayoutEffect(() => {
    darkAnchor.apply();
  }, [inferredDarkFeed.items, darkAnchor.apply]);

  useLayoutEffect(() => {
    alertsAnchor.apply();
  }, [alertsFeed.items, alertsAnchor.apply]);

  useLayoutEffect(() => {
    classifierAnchor.apply();
  }, [smartMoneyFeed.items, classifierHitsFeed.items, classifierAnchor.apply]);

  const nbboMap = useMemo(() => {
    const map = new Map<string, OptionNBBO>();
    for (const quote of nbboFeed.items) {
      const contractId = normalizeContractId(quote.option_contract_id);
      const existing = map.get(contractId);
      if (
        !existing ||
        quote.ts > existing.ts ||
        (quote.ts === existing.ts && quote.seq >= existing.seq)
      ) {
        map.set(contractId, quote);
      }
    }
    return map;
  }, [nbboFeed.items]);

  const optionPrintMap = useMemo(() => {
    const map = new Map<string, OptionPrint>();
    for (const print of optionsFeed.items) {
      if (print.trace_id) {
        map.set(print.trace_id, print);
      }
    }
    return map;
  }, [optionsFeed.items]);

  const equityJoinMap = useMemo(() => {
    const map = new Map<string, EquityPrintJoin>();
    for (const join of equityJoinsFeed.items) {
      map.set(join.id, join);
    }
    return map;
  }, [equityJoinsFeed.items]);

  const flowPacketMap = useMemo(() => {
    const map = new Map<string, FlowPacket>();
    for (const packet of flowFeed.items) {
      map.set(packet.id, packet);
    }
    return map;
  }, [flowFeed.items]);
  const [pinnedOptionPrintMap, setPinnedOptionPrintMap] = useState<
    Map<string, PinnedEntry<OptionPrint>>
  >(() => new Map());
  const [pinnedFlowPacketMap, setPinnedFlowPacketMap] = useState<
    Map<string, PinnedEntry<FlowPacket>>
  >(() => new Map());
  const [pinnedEquityJoinMap, setPinnedEquityJoinMap] = useState<
    Map<string, PinnedEntry<EquityPrintJoin>>
  >(() => new Map());
  const [selectedAlertContextStatus, setSelectedAlertContextStatus] = useState<AlertContextStatus>({
    traceId: null,
    loading: false,
    missingRefs: [],
    error: null
  });
  const [optionSupportSmartMoney, setOptionSupportSmartMoney] = useState<SmartMoneyEvent[]>([]);
  const [optionSupportClassifierHits, setOptionSupportClassifierHits] = useState<ClassifierHitEvent[]>([]);
  const [historicalNbboByTraceId, setHistoricalNbboByTraceId] = useState<Map<string, OptionNBBO | null>>(
    () => new Map()
  );

  const resolvedOptionPrintMap = useMemo(() => {
    const merged = new Map<string, OptionPrint>();
    for (const [key, entry] of pinnedOptionPrintMap) {
      merged.set(key, entry.value);
    }
    for (const [key, value] of optionPrintMap) {
      merged.set(key, value);
    }
    return merged;
  }, [optionPrintMap, pinnedOptionPrintMap]);
  const resolvedFlowPacketMap = useMemo(() => {
    const merged = new Map<string, FlowPacket>();
    for (const [key, entry] of pinnedFlowPacketMap) {
      merged.set(key, entry.value);
    }
    for (const [key, value] of flowPacketMap) {
      merged.set(key, value);
    }
    return merged;
  }, [flowPacketMap, pinnedFlowPacketMap]);
  const resolvedEquityJoinMap = useMemo(() => {
    const merged = new Map<string, EquityPrintJoin>();
    for (const [key, entry] of pinnedEquityJoinMap) {
      merged.set(key, entry.value);
    }
    for (const [key, value] of equityJoinMap) {
      merged.set(key, value);
    }
    return merged;
  }, [equityJoinMap, pinnedEquityJoinMap]);

  useEffect(() => {
    setRetentionMetric(
      "pinnedStoreSize",
      pinnedOptionPrintMap.size + pinnedFlowPacketMap.size + pinnedEquityJoinMap.size
    );
  }, [pinnedOptionPrintMap.size, pinnedFlowPacketMap.size, pinnedEquityJoinMap.size]);

  useEffect(() => {
    if (!selectedAlert) {
      setSelectedAlertContextStatus({
        traceId: null,
        loading: false,
        missingRefs: [],
        error: null
      });
      return;
    }

    const abort = new AbortController();
    setSelectedAlertContextStatus({
      traceId: selectedAlert.trace_id,
      loading: true,
      missingRefs: [],
      error: null
    });
    incrementRetentionMetric("pinnedFetchMisses", selectedAlert.evidence_refs.length);

    void fetch(buildApiUrl(buildAlertContextPath(selectedAlert.trace_id)), { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorDetail(response));
        }
        return response.json();
      })
      .then((payload: AlertContextBundle) => {
        if (abort.signal.aborted) {
          return;
        }
        const { packets, prints } = collectAlertContextEvidence(payload);
        const now = Date.now();
        if (packets.size > 0) {
          setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, packets, now));
        }
        if (prints.size > 0) {
          setPinnedOptionPrintMap((prev) => upsertPinnedEntries(prev, prints, now));
        }
        setSelectedAlertContextStatus({
          traceId: selectedAlert.trace_id,
          loading: false,
          missingRefs: payload.missing_refs ?? [],
          error: null
        });
      })
      .catch((error) => {
        if (abort.signal.aborted) {
          return;
        }
        incrementRetentionMetric("pinnedFetchFailures", 1);
        console.warn("Failed to fetch persisted alert context", error);
        setSelectedAlertContextStatus({
          traceId: selectedAlert.trace_id,
          loading: false,
          missingRefs: [],
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => abort.abort();
  }, [selectedAlert]);

  useEffect(() => {
    if (!selectedDarkEvent || mode !== "live") {
      return;
    }

    const missingIds = selectedDarkEvent.evidence_refs.filter(
      (id) => resolveJoinFromRef(id, resolvedEquityJoinMap) === null
    );
    if (missingIds.length === 0) {
      return;
    }

    incrementRetentionMetric("pinnedFetchMisses", missingIds.length);
    const url = new URL(buildApiUrl("/equity-joins/by-id"));
    const requested = new Set<string>();
    for (const id of missingIds) {
      for (const candidate of normalizeJoinRefCandidates(id)) {
        if (!requested.has(candidate)) {
          requested.add(candidate);
          url.searchParams.append("id", candidate);
        }
      }
    }
    void fetch(url.toString())
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorDetail(response));
        }
        return response.json();
      })
      .then((payload: { data?: EquityPrintJoin[] }) => {
        const next = new Map<string, EquityPrintJoin>();
        for (const item of payload.data ?? []) {
          if (!item || !item.id || !item.trace_id) {
            continue;
          }
          next.set(item.id, item);
          next.set(item.trace_id, item);
          if (item.print_trace_id) {
            next.set(item.print_trace_id, item);
          }
        }
        if (next.size > 0) {
          const now = Date.now();
          setPinnedEquityJoinMap((prev) => upsertPinnedEntries(prev, next, now));
        }
      })
      .catch((error) => {
        incrementRetentionMetric("pinnedFetchFailures", 1);
        console.warn("Failed to fetch dark evidence joins", error);
      });
  }, [selectedDarkEvent, mode, resolvedEquityJoinMap]);

  const selectedEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedAlert) {
      return [];
    }

    return selectedAlert.evidence_refs.map((id) => {
      const packet = resolvedFlowPacketMap.get(id);
      if (packet) {
        return { kind: "flow", id, packet };
      }
      const print = resolvedOptionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [selectedAlert, resolvedFlowPacketMap, resolvedOptionPrintMap]);

  const selectedFlowPacket = useMemo(() => {
    if (!selectedAlert) {
      return null;
    }
    const packetId = selectedAlert.evidence_refs[0];
    return packetId ? resolvedFlowPacketMap.get(packetId) ?? null : null;
  }, [selectedAlert, resolvedFlowPacketMap]);

  const selectedDarkEvidence = useMemo((): DarkEvidenceItem[] => {
    if (!selectedDarkEvent) {
      return [];
    }

    return selectedDarkEvent.evidence_refs.map((id) => {
      const join = resolveJoinFromRef(id, resolvedEquityJoinMap);
      if (join) {
        return { kind: "join", id, join };
      }
      return { kind: "unknown", id };
    });
  }, [selectedDarkEvent, resolvedEquityJoinMap]);

  const selectedDarkUnderlying = useMemo(() => {
    if (!routeFeatures.needsDarkUnderlying || !selectedDarkEvent) {
      return null;
    }
    return inferDarkUnderlying(selectedDarkEvent, resolvedEquityJoinMap);
  }, [routeFeatures.needsDarkUnderlying, selectedDarkEvent, resolvedEquityJoinMap]);

  useEffect(() => {
    if (mode !== "live") {
      setSelectedAlert(null);
    }
    setSelectedDarkEvent(null);
    setSelectedClassifierHit(null);
    setSelectedSmartMoneyEvent(null);
  }, [mode]);

  const extractPacketContract = useCallback((packet: FlowPacket): string => {
    const contract = packet.features.option_contract_id;
    if (typeof contract === "string") {
      return contract;
    }
    const match = packet.id.match(/^flowpacket:([^:]+):/);
    return match?.[1] ?? packet.id;
  }, []);

  const extractUnderlyingFromTrace = useCallback((traceId: string): string | null => {
    const match = traceId.match(/flowpacket:([^:]+):/);
    if (!match?.[1]) {
      return null;
    }
    return extractUnderlying(match[1]);
  }, []);

  const extractPacketIdFromClassifierHitTrace = useCallback((traceId: string): string | null => {
    const idx = traceId.indexOf("flowpacket:");
    if (idx < 0) {
      return null;
    }
    return traceId.slice(idx);
  }, []);

  const classifierHitsByPacketId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return EMPTY_CLASSIFIER_HITS_BY_PACKET_ID;
    }
    const map = new Map<string, ClassifierHitEvent[]>();
    for (const hit of [...classifierHitsFeed.items, ...optionSupportClassifierHits]) {
      const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
      if (!packetId) {
        continue;
      }
      map.set(packetId, [...(map.get(packetId) ?? []), hit]);
    }
    return map;
  }, [
    classifierHitsFeed.items,
    optionSupportClassifierHits,
    extractPacketIdFromClassifierHitTrace,
    routeFeatures.needsClassifierDecor
  ]);

  const smartMoneyByPacketId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return new Map<string, SmartMoneyEvent>();
    }
    const map = new Map<string, SmartMoneyEvent>();
    for (const event of [...smartMoneyFeed.items, ...optionSupportSmartMoney]) {
      for (const packetId of event.packet_ids) {
        const existing = map.get(packetId);
        if (!existing || event.source_ts > existing.source_ts || event.seq > existing.seq) {
          map.set(packetId, event);
        }
      }
    }
    return map;
  }, [smartMoneyFeed.items, optionSupportSmartMoney, routeFeatures.needsClassifierDecor]);

  const packetIdByOptionTraceId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return EMPTY_PACKET_ID_BY_OPTION_TRACE_ID;
    }
    const map = new Map<string, string>();
    for (const packet of resolvedFlowPacketMap.values()) {
      for (const member of packet.members) {
        map.set(member, packet.id);
      }
    }
    return map;
  }, [resolvedFlowPacketMap, routeFeatures.needsClassifierDecor]);

  const classifierDecorByOptionTraceId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return EMPTY_CLASSIFIER_DECOR_BY_OPTION_TRACE_ID;
    }
    const map = new Map<string, ClassifierDecor>();
    for (const [traceId, packetId] of packetIdByOptionTraceId) {
      const smartMoneyEvent = smartMoneyByPacketId.get(packetId);
      if (smartMoneyEvent) {
        map.set(traceId, buildSmartMoneyDecor(smartMoneyEvent));
        continue;
      }
      const primary = selectPrimaryClassifierHit(classifierHitsByPacketId.get(packetId) ?? []);
      if (primary) {
        map.set(traceId, buildClassifierDecor(primary));
      }
    }
    return map;
  }, [
    classifierHitsByPacketId,
    packetIdByOptionTraceId,
    smartMoneyByPacketId,
    routeFeatures.needsClassifierDecor
  ]);

  useEffect(() => {
    if (!routeFeatures.needsClassifierDecor || mode !== "live" || optionsFeed.items.length === 0) {
      return;
    }

    const traceIds: string[] = [];
    const nbboContext: Array<{ trace_id: string; option_contract_id: string; ts: number }> = [];
    for (const print of optionsFeed.items.slice(0, 1000)) {
      if (!print.trace_id || classifierDecorByOptionTraceId.has(print.trace_id)) {
        continue;
      }
      if (!packetIdByOptionTraceId.has(print.trace_id)) {
        traceIds.push(print.trace_id);
      }
      const missingPreservedNbbo =
        typeof print.execution_nbbo_side !== "string" &&
        typeof print.nbbo_side !== "string" &&
        !historicalNbboByTraceId.has(print.trace_id);
      if (missingPreservedNbbo) {
        nbboContext.push({
          trace_id: print.trace_id,
          option_contract_id: print.option_contract_id,
          ts: print.ts
        });
      }
      if (traceIds.length >= 250 && nbboContext.length >= 250) {
        break;
      }
    }

    const uniqueTraceIds = Array.from(new Set(traceIds)).slice(0, 250);
    const uniqueNbboContext = Array.from(
      new Map(nbboContext.map((item) => [item.trace_id, item])).values()
    ).slice(0, 250);
    if (uniqueTraceIds.length === 0 && uniqueNbboContext.length === 0) {
      return;
    }

    let cancelled = false;
    void fetch(buildApiUrl("/lookup/options-support"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trace_ids: uniqueTraceIds,
        nbbo_context: uniqueNbboContext
      })
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorDetail(response));
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
          throw new Error(
            `Unexpected content type from /lookup/options-support: ${contentType || "unknown"}`
          );
        }
        return response.json() as Promise<{
          packets?: FlowPacket[];
          smart_money?: SmartMoneyEvent[];
          classifier_hits?: ClassifierHitEvent[];
          nbbo_by_trace_id?: Record<string, OptionNBBO | null>;
        }>;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const now = Date.now();
        const packetMap = new Map<string, FlowPacket>();
        for (const packet of payload.packets ?? []) {
          if (!packet || !packet.id) {
            continue;
          }
          packetMap.set(packet.id, packet);
        }
        if (packetMap.size > 0) {
          setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, packetMap, now));
        }
        if (payload.smart_money?.length) {
          const filtered = payload.smart_money.filter((item): item is SmartMoneyEvent =>
            Boolean(item && item.trace_id)
          );
          setOptionSupportSmartMoney((prev) =>
            mergeNewest(filtered, prev, PINNED_EVIDENCE_MAX_ITEMS)
          );
        }
        if (payload.classifier_hits?.length) {
          const filtered = payload.classifier_hits.filter((item): item is ClassifierHitEvent =>
            Boolean(item && item.trace_id)
          );
          setOptionSupportClassifierHits((prev) =>
            mergeNewest(filtered, prev, PINNED_EVIDENCE_MAX_ITEMS)
          );
        }
        if (payload.nbbo_by_trace_id) {
          setHistoricalNbboByTraceId((prev) => {
            const next = new Map(prev);
            for (const [traceId, quote] of Object.entries(payload.nbbo_by_trace_id ?? {})) {
              next.set(traceId, quote);
            }
            return next;
          });
        }
      })
      .catch((error) => {
        console.warn("Failed to hydrate option row support", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    optionsFeed.items,
    classifierDecorByOptionTraceId,
    packetIdByOptionTraceId,
    historicalNbboByTraceId,
    routeFeatures.needsClassifierDecor
  ]);

  const selectedClassifierPacketId = useMemo(() => {
    if (!selectedClassifierHit) {
      return null;
    }
    return extractPacketIdFromClassifierHitTrace(selectedClassifierHit.trace_id);
  }, [extractPacketIdFromClassifierHitTrace, selectedClassifierHit]);

  useEffect(() => {
    if (!selectedClassifierPacketId || mode !== "live") {
      return;
    }

    if (!resolvedFlowPacketMap.has(selectedClassifierPacketId)) {
      incrementRetentionMetric("pinnedFetchMisses", 1);
      void fetch(buildApiUrl(`/flow/packets/${encodeURIComponent(selectedClassifierPacketId)}`))
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await readErrorDetail(response));
          }
          return response.json();
        })
        .then((payload: { data?: FlowPacket | null }) => {
          if (!payload.data) {
            return;
          }
          const now = Date.now();
          const next = new Map<string, FlowPacket>([[payload.data.id, payload.data]]);
          setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, now));
        })
        .catch((error) => {
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to fetch classifier flow packet", error);
        });
    }
  }, [selectedClassifierPacketId, mode, resolvedFlowPacketMap]);

  const selectedClassifierFlowPacket = useMemo(() => {
    if (!selectedClassifierPacketId) {
      return null;
    }
    return resolvedFlowPacketMap.get(selectedClassifierPacketId) ?? null;
  }, [resolvedFlowPacketMap, selectedClassifierPacketId]);

  const selectedClassifierEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedClassifierHit) {
      return [];
    }

    if (!selectedClassifierPacketId) {
      return [];
    }

    const packet = resolvedFlowPacketMap.get(selectedClassifierPacketId);
    if (!packet) {
      return [];
    }

    return packet.members.map((id) => {
      const print = resolvedOptionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [resolvedFlowPacketMap, resolvedOptionPrintMap, selectedClassifierHit, selectedClassifierPacketId]);

  const selectedSmartMoneyFlowPacket = useMemo(() => {
    const packetId = selectedSmartMoneyEvent?.packet_ids[0];
    return packetId ? resolvedFlowPacketMap.get(packetId) ?? null : null;
  }, [resolvedFlowPacketMap, selectedSmartMoneyEvent]);

  const selectedSmartMoneyEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedSmartMoneyEvent) {
      return [];
    }
    return selectedSmartMoneyEvent.member_print_ids.map((id) => {
      const print = resolvedOptionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [resolvedOptionPrintMap, selectedSmartMoneyEvent]);

  useEffect(() => {
    if (!selectedSmartMoneyEvent || mode !== "live") {
      return;
    }

    const missingPacketIds = selectedSmartMoneyEvent.packet_ids.filter((id) => !resolvedFlowPacketMap.has(id));
    if (missingPacketIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", missingPacketIds.length);
      void Promise.all(
        missingPacketIds.map(async (packetId) => {
          const response = await fetch(buildApiUrl(`/flow/packets/${encodeURIComponent(packetId)}`));
          if (!response.ok) {
            throw new Error(await readErrorDetail(response));
          }
          const payload = (await response.json()) as { data?: FlowPacket | null };
          return payload.data ?? null;
        })
      )
        .then((packets) => {
          const next = new Map<string, FlowPacket>();
          for (const packet of packets) {
            if (packet) {
              next.set(packet.id, packet);
            }
          }
          if (next.size > 0) {
            setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
          }
        })
        .catch((error) => {
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to fetch smart-money flow packets", error);
        });
    }

    const missingPrintIds = selectedSmartMoneyEvent.member_print_ids.filter((id) => !resolvedOptionPrintMap.has(id));
    if (missingPrintIds.length === 0) {
      return;
    }
    incrementRetentionMetric("pinnedFetchMisses", missingPrintIds.length);
    const url = new URL(buildApiUrl("/option-prints/by-trace"));
    for (const traceId of missingPrintIds) {
      url.searchParams.append("trace_id", traceId);
    }
    void fetch(url.toString())
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorDetail(response));
        }
        return response.json();
      })
      .then((payload: { data?: OptionPrint[] }) => {
        const next = new Map<string, OptionPrint>();
        for (const item of payload.data ?? []) {
          if (!item || !item.trace_id) {
            continue;
          }
          next.set(item.trace_id, item);
        }
        if (next.size > 0) {
          setPinnedOptionPrintMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
        }
      })
      .catch((error) => {
        incrementRetentionMetric("pinnedFetchFailures", 1);
        console.warn("Failed to fetch smart-money option prints", error);
      });
  }, [mode, resolvedFlowPacketMap, resolvedOptionPrintMap, selectedSmartMoneyEvent]);

  const inferAlertUnderlying = useCallback(
    (alert: AlertEvent): string | null => {
      const fromTrace = extractUnderlyingFromTrace(alert.trace_id);
      if (fromTrace) {
        return fromTrace;
      }

      const packetId = alert.evidence_refs[0];
      if (packetId) {
        const packet = resolvedFlowPacketMap.get(packetId);
        if (packet) {
          return extractUnderlying(extractPacketContract(packet));
        }
      }

      for (const ref of alert.evidence_refs) {
        const print = resolvedOptionPrintMap.get(ref);
        if (print) {
          return extractUnderlying(print.option_contract_id);
        }
      }

      return null;
    },
    [extractPacketContract, extractUnderlyingFromTrace, resolvedFlowPacketMap, resolvedOptionPrintMap]
  );

  const matchesTicker = useCallback(
    (value: string | null) => {
      if (tickerSet.size === 0) {
        return true;
      }
      if (!value) {
        return false;
      }
      return tickerSet.has(value.toUpperCase());
    },
    [tickerSet]
  );

  const filteredOptions = useMemo(() => {
    return filterOptionTapeItems(
      optionsFeed.items,
      effectiveOptionPrintFilters,
      selectedInstrument,
      tickerSet,
      instrumentUnderlying
    );
  }, [
    effectiveOptionPrintFilters,
    instrumentUnderlying,
    optionsFeed.items,
    selectedInstrument,
    tickerSet
  ]);

  const filteredEquities = useMemo(() => {
    if (tickerSet.size === 0) {
      if (instrumentUnderlying) {
        return equitiesFeed.items.filter((print) => print.underlying_id.toUpperCase() === instrumentUnderlying);
      }
      return equitiesFeed.items;
    }
    return equitiesFeed.items.filter((print) => matchesTicker(print.underlying_id));
  }, [equitiesFeed.items, matchesTicker, tickerSet, instrumentUnderlying]);

  useEffect(() => {
    if (!optionFocusSeed) {
      return;
    }
    if (
      shouldClearOptionFocusSeed(
        optionFocusSeed,
        optionFocusScopeKey,
        currentOptionSubscriptionKey,
        liveOptions.liveItems ?? [],
        liveOptions.historyItems ?? []
      )
    ) {
      setOptionFocusSeed(null);
    }
  }, [
    currentOptionSubscriptionKey,
    liveOptions.historyItems,
    liveOptions.liveItems,
    optionFocusScopeKey,
    optionFocusSeed
  ]);

  useEffect(() => {
    if (!equityFocusSeed) {
      return;
    }
    if (equityFocusSeed.scopeKey !== equityFocusScopeKey) {
      setEquityFocusSeed(null);
      return;
    }
    const composedBaseItems = composeTapeItems([], liveEquities.liveItems ?? [], liveEquities.historyItems ?? []);
    const liveKeys = new Set(composedBaseItems.map((item) => getTapeItemKey(item)));
    if (equityFocusSeed.items.every((item) => liveKeys.has(getTapeItemKey(item)))) {
      setEquityFocusSeed(null);
    }
  }, [equityFocusScopeKey, equityFocusSeed, liveEquities.historyItems, liveEquities.liveItems]);

  const focusOptionContract = useCallback(
    (print: OptionPrint) => {
      const contractId = normalizeContractId(print.option_contract_id);
      const parsed = parseOptionContractId(contractId);
      const underlyingId = (print.underlying_id ?? parsed?.root ?? extractUnderlying(contractId)).toUpperCase();
      const scopeKey = `option-contract:${contractId}`;
      const subscriptionKey = getLiveSubscriptionKey({
        channel: "options",
        underlying_ids: [underlyingId],
        option_contract_id: contractId
      });
      const seedItems = composeTapeItems(
        [print],
        filteredOptions.filter((candidate) => normalizeContractId(candidate.option_contract_id) === contractId),
        []
      );
      setOptionFocusSeed({ scopeKey, subscriptionKey, items: seedItems });
      bumpTapeDebugMetric("focusSeedRowCount", seedItems.length);
      logTapeDebug("option focus seed captured", {
        contract_id: contractId,
        subscription_key: subscriptionKey,
        row_count: seedItems.length
      });
      setSelectedInstrument({
        kind: "option-contract",
        contractId,
        underlyingId
      });
    },
    [filteredOptions]
  );

  const focusEquityTicker = useCallback(
    (print: EquityPrint) => {
      const underlyingId = print.underlying_id.toUpperCase();
      const scopeKey = `equity:${underlyingId}`;
      const seedItems = composeTapeItems(
        [print],
        filteredEquities.filter((candidate) => candidate.underlying_id.toUpperCase() === underlyingId),
        []
      );
      setEquityFocusSeed({ scopeKey, items: seedItems });
      bumpTapeDebugMetric("focusSeedRowCount", seedItems.length);
      logTapeDebug("equity focus seed captured", {
        underlying_id: underlyingId,
        row_count: seedItems.length
      });
      setSelectedInstrument({
        kind: "equity",
        underlyingId
      });
    },
    [filteredEquities]
  );

  const equitiesSilentWarning = shouldShowEquitiesSilentFeedWarning({
    wsStatus: liveSession.status,
    equitiesSubscribed: mode === "live" && equitiesLiveSubscriptionActive,
    connectedAt: liveSession.connectedAt,
    lastEquitiesEventAt: liveSession.lastEventByChannel.equities ?? null
  });
  const optionsScopeActive = Boolean(
    optionScope.option_contract_id || optionScope.underlying_ids?.length
  );
  const equitiesScopeActive = Boolean(equityScope.underlying_ids?.length);
  const optionsScopedQuiet =
    mode === "live" &&
    optionsScopeActive &&
    optionsChannelStatus === "connected" &&
    filteredOptions.length === 0;
  const equitiesScopedQuiet =
    mode === "live" &&
    equitiesScopeActive &&
    equitiesChannelStatus === "connected" &&
    filteredEquities.length === 0;

  const previousScopedQuietRef = useRef({
    options: optionsScopedQuiet,
    equities: equitiesScopedQuiet
  });

  useEffect(() => {
    const previous = previousScopedQuietRef.current;
    if (previous.options !== optionsScopedQuiet) {
      bumpTapeDebugMetric("scopedQuietTransitions", 1);
      logTapeDebug("options scoped quiet transition", { active: optionsScopedQuiet });
    }
    if (previous.equities !== equitiesScopedQuiet) {
      bumpTapeDebugMetric("scopedQuietTransitions", 1);
      logTapeDebug("equities scoped quiet transition", { active: equitiesScopedQuiet });
    }
    previousScopedQuietRef.current = {
      options: optionsScopedQuiet,
      equities: equitiesScopedQuiet
    };
  }, [equitiesScopedQuiet, optionsScopedQuiet]);

  const filteredInferredDark = useMemo(() => {
    if (!routeFeatures.inferredDark) {
      return EMPTY_INFERRED_DARK_EVENTS;
    }
    if (tickerSet.size === 0) {
      return inferredDarkFeed.items;
    }
    return inferredDarkFeed.items.filter((event) => {
      const underlying = inferDarkUnderlying(event, resolvedEquityJoinMap);
      return matchesTicker(underlying);
    });
  }, [
    resolvedEquityJoinMap,
    inferredDarkFeed.items,
    matchesTicker,
    tickerSet,
    routeFeatures.inferredDark
  ]);

  const filteredFlow = useMemo(() => {
    return flowFeed.items.filter((packet) => {
      if (!matchesFlowPacketFilters(packet, flowFilters)) {
        return false;
      }
      if (tickerSet.size === 0) {
        return true;
      }
      return matchesTicker(extractUnderlying(extractPacketContract(packet)));
    });
  }, [flowFeed.items, flowFilters, extractPacketContract, matchesTicker, tickerSet]);

  const filteredAlerts = useMemo(() => {
    if (!routeFeatures.showAlertsPane && !routeFeatures.needsAlertEvidencePrefetch) {
      return EMPTY_ALERT_EVENTS;
    }
    if (tickerSet.size === 0) {
      return alertsFeed.items;
    }
    return alertsFeed.items.filter((alert) => matchesTicker(inferAlertUnderlying(alert)));
  }, [
    alertsFeed.items,
    inferAlertUnderlying,
    matchesTicker,
    tickerSet,
    routeFeatures.showAlertsPane,
    routeFeatures.needsAlertEvidencePrefetch
  ]);

  const filteredNews = useMemo(() => {
    if (!routeFeatures.news && !routeFeatures.showNewsPane) {
      return EMPTY_NEWS_STORIES;
    }
    if (tickerSet.size === 0) {
      return newsFeed.items;
    }
    return newsFeed.items.filter((story) => story.resolved_symbols.some((symbol) => matchesTicker(symbol)));
  }, [matchesTicker, newsFeed.items, routeFeatures.news, routeFeatures.showNewsPane, tickerSet]);

  const visibleAlerts = useMemo(() => {
    if (routeFeatures.needsAlertEvidencePrefetch) {
      return filteredAlerts.slice(0, 12);
    }
    if (routeFeatures.showAlertsPane) {
      return filteredAlerts.slice(0, 12);
    }
    return EMPTY_ALERT_EVENTS;
  }, [filteredAlerts, routeFeatures.needsAlertEvidencePrefetch, routeFeatures.showAlertsPane]);

  const visibleAlertEvidenceRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const alert of visibleAlerts) {
      for (const id of alert.evidence_refs.slice(0, 8)) {
        refs.add(id);
      }
    }
    return refs;
  }, [visibleAlerts]);

  useEffect(() => {
    if (!routeFeatures.needsAlertEvidencePrefetch || mode !== "live" || visibleAlerts.length === 0) {
      return;
    }

    const visiblePacketIds = visibleAlerts
      .map((alert) => alert.evidence_refs[0] ?? null)
      .filter((id): id is string => Boolean(id) && id.startsWith("flowpacket:"));
    const missingPacketIds = Array.from(new Set(visiblePacketIds)).filter(
      (id) => !resolvedFlowPacketMap.has(id)
    );

    if (missingPacketIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", missingPacketIds.length);
      void Promise.all(
        missingPacketIds.map(async (packetId) => {
          const response = await fetch(buildApiUrl(`/flow/packets/${encodeURIComponent(packetId)}`));
          if (!response.ok) {
            throw new Error(await readErrorDetail(response));
          }
          const payload = (await response.json()) as { data?: FlowPacket | null };
          return payload.data ?? null;
        })
      )
        .then((packets) => {
          const next = new Map<string, FlowPacket>();
          for (const packet of packets) {
            if (packet) {
              next.set(packet.id, packet);
            }
          }
          if (next.size > 0) {
            const now = Date.now();
            setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, now));
          }
        })
        .catch((error) => {
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to prefetch visible alert packets", error);
        });
    }

    const missingPrintIds = Array.from(visibleAlertEvidenceRefs).filter(
      (id) => !resolvedFlowPacketMap.has(id) && !resolvedOptionPrintMap.has(id)
    );
    if (missingPrintIds.length === 0) {
      return;
    }

    incrementRetentionMetric("pinnedFetchMisses", missingPrintIds.length);
    const url = new URL(buildApiUrl("/option-prints/by-trace"));
    for (const traceId of missingPrintIds) {
      url.searchParams.append("trace_id", traceId);
    }
    void fetch(url.toString())
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorDetail(response));
        }
        return response.json();
      })
      .then((payload: { data?: OptionPrint[] }) => {
        const next = new Map<string, OptionPrint>();
        for (const item of payload.data ?? []) {
          if (!item || !item.trace_id) {
            continue;
          }
          next.set(item.trace_id, item);
        }
        if (next.size > 0) {
          const now = Date.now();
          setPinnedOptionPrintMap((prev) => upsertPinnedEntries(prev, next, now));
        }
      })
      .catch((error) => {
        incrementRetentionMetric("pinnedFetchFailures", 1);
        console.warn("Failed to prefetch visible alert evidence", error);
      });
  }, [
    mode,
    visibleAlerts,
    visibleAlertEvidenceRefs,
    resolvedFlowPacketMap,
    resolvedOptionPrintMap,
    routeFeatures.needsAlertEvidencePrefetch
  ]);

  const activePinnedFlowKeys = useMemo(() => {
    const keys = new Set<string>();
    const selectedAlertPacketId = selectedAlert?.evidence_refs[0];
    if (selectedAlertPacketId) {
      keys.add(selectedAlertPacketId);
    }
    if (selectedClassifierPacketId) {
      keys.add(selectedClassifierPacketId);
    }
    for (const packetId of selectedSmartMoneyEvent?.packet_ids ?? []) {
      keys.add(packetId);
    }
    for (const alert of visibleAlerts) {
      const packetId = alert.evidence_refs[0];
      if (packetId) {
        keys.add(packetId);
      }
    }
    return keys;
  }, [selectedAlert, selectedClassifierPacketId, selectedSmartMoneyEvent, visibleAlerts]);

  const activePinnedOptionKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedAlert) {
      for (const id of selectedAlert.evidence_refs) {
        keys.add(id);
      }
    }
    if (selectedClassifierFlowPacket) {
      for (const id of selectedClassifierFlowPacket.members) {
        keys.add(id);
      }
    }
    for (const id of selectedSmartMoneyEvent?.member_print_ids ?? []) {
      keys.add(id);
    }
    for (const id of visibleAlertEvidenceRefs) {
      keys.add(id);
    }
    return keys;
  }, [selectedAlert, selectedClassifierFlowPacket, selectedSmartMoneyEvent, visibleAlertEvidenceRefs]);

  const activePinnedJoinKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedDarkEvent) {
      for (const id of selectedDarkEvent.evidence_refs) {
        for (const candidate of normalizeJoinRefCandidates(id)) {
          keys.add(candidate);
        }
      }
    }
    return keys;
  }, [selectedDarkEvent]);

  useEffect(() => {
    if (mode !== "live") {
      return;
    }

    const prune = () => {
      const now = Date.now();
      setPinnedOptionPrintMap((prev) => prunePinnedEntries(prev, activePinnedOptionKeys, now));
      setPinnedFlowPacketMap((prev) => prunePinnedEntries(prev, activePinnedFlowKeys, now));
      setPinnedEquityJoinMap((prev) => prunePinnedEntries(prev, activePinnedJoinKeys, now));
    };

    prune();
    const interval = window.setInterval(prune, 60000);
    return () => {
      window.clearInterval(interval);
    };
  }, [mode, activePinnedOptionKeys, activePinnedFlowKeys, activePinnedJoinKeys]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      console.info("frontend live retention metrics", frontendRetentionMetrics);
    }, 60000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const filteredClassifierHits = useMemo(() => {
    if (!routeFeatures.classifierHits) {
      return EMPTY_CLASSIFIER_HIT_EVENTS;
    }
    if (tickerSet.size === 0) {
      return classifierHitsFeed.items;
    }
    return classifierHitsFeed.items.filter((hit) => {
      const underlying = extractUnderlyingFromTrace(hit.trace_id);
      return matchesTicker(underlying);
    });
  }, [
    classifierHitsFeed.items,
    extractUnderlyingFromTrace,
    matchesTicker,
    tickerSet,
    routeFeatures.classifierHits
  ]);

  const filteredSmartMoneyEvents = useMemo(() => {
    if (!routeFeatures.smartMoney) {
      return EMPTY_SMART_MONEY_EVENTS;
    }
    if (tickerSet.size === 0) {
      return smartMoneyFeed.items;
    }
    return smartMoneyFeed.items.filter((event) => matchesTicker(event.underlying_id));
  }, [matchesTicker, smartMoneyFeed.items, tickerSet, routeFeatures.smartMoney]);

  const chartSmartMoneyEvents = useMemo(() => {
    if (!routeFeatures.showChartPane && !routeFeatures.showFocusPane) {
      return EMPTY_SMART_MONEY_EVENTS;
    }
    const desired = chartTicker.toUpperCase();
    return smartMoneyFeed.items
      .filter((event) => event.underlying_id.toUpperCase() === desired)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
  }, [chartTicker, smartMoneyFeed.items, routeFeatures.showChartPane, routeFeatures.showFocusPane]);

  const chartInferredDark = useMemo(() => {
    if (!routeFeatures.showChartPane && !routeFeatures.showFocusPane) {
      return EMPTY_INFERRED_DARK_EVENTS;
    }
    const desired = chartTicker.toUpperCase();
    return inferredDarkFeed.items
      .filter((event) => inferDarkUnderlying(event, resolvedEquityJoinMap) === desired)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
  }, [
    chartTicker,
    inferredDarkFeed.items,
    resolvedEquityJoinMap,
    routeFeatures.showChartPane,
    routeFeatures.showFocusPane
  ]);

  const findAlertForClassifierHit = useCallback(
    (hit: ClassifierHitEvent): AlertEvent | null => {
      const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
      if (!packetId) {
        return null;
      }

      const desiredTrace = `alert:${packetId}`;
      return (
        alertsFeed.items.find(
          (item) => item.trace_id === desiredTrace || item.evidence_refs[0] === packetId
        ) ?? null
      );
    },
    [alertsFeed.items, extractPacketIdFromClassifierHitTrace]
  );

  const openFromClassifierHit = useCallback(
    (hit: ClassifierHitEvent) => {
      const alert = findAlertForClassifierHit(hit);
      if (alert) {
        setSelectedNewsStory(null);
        setSelectedClassifierHit(null);
        setSelectedDarkEvent(null);
        setSelectedSmartMoneyEvent(null);
        setSelectedAlert(alert);
        return;
      }

      setSelectedNewsStory(null);
      setSelectedAlert(null);
      setSelectedDarkEvent(null);
      setSelectedSmartMoneyEvent(null);
      setSelectedClassifierHit(hit);
    },
    [findAlertForClassifierHit]
  );

  const openFromSmartMoneyEvent = useCallback((event: SmartMoneyEvent) => {
    setSelectedNewsStory(null);
    setSelectedAlert(null);
    setSelectedClassifierHit(null);
    setSelectedDarkEvent(null);
    setSelectedSmartMoneyEvent(event);
  }, []);

  const handleSmartMoneyMarkerClick = useCallback(
    (event: SmartMoneyEvent) => {
      openFromSmartMoneyEvent(event);
    },
    [openFromSmartMoneyEvent]
  );

  const handleDarkMarkerClick = useCallback((event: InferredDarkEvent) => {
    setSelectedNewsStory(null);
    setSelectedAlert(null);
    setSelectedClassifierHit(null);
    setSelectedSmartMoneyEvent(null);
    setSelectedDarkEvent(event);
  }, []);

  const lastSeen = useMemo(() => {
    const updates: Array<number | null> = [];
    if (routeFeatures.options || routeFeatures.showOptionsPane) {
      updates.push(optionsFeed.lastUpdate);
    }
    if (routeFeatures.equities || routeFeatures.showEquitiesPane) {
      updates.push(equitiesFeed.lastUpdate);
    }
    if (routeFeatures.inferredDark || routeFeatures.showDarkPane || routeFeatures.showFocusPane) {
      updates.push(inferredDarkFeed.lastUpdate);
    }
    if (routeFeatures.flow || routeFeatures.showFlowPane) {
      updates.push(flowFeed.lastUpdate);
    }
    if (routeFeatures.news || routeFeatures.showNewsPane) {
      updates.push(newsFeed.lastUpdate);
    }
    if (routeFeatures.alerts || routeFeatures.showAlertsPane) {
      updates.push(alertsFeed.lastUpdate);
    }
    if (routeFeatures.smartMoney || routeFeatures.showClassifierPane || routeFeatures.showChartPane || routeFeatures.showFocusPane) {
      updates.push(smartMoneyFeed.lastUpdate);
    }
    if (routeFeatures.classifierHits || routeFeatures.showClassifierPane) {
      updates.push(classifierHitsFeed.lastUpdate);
    }
    return updates
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [
    routeFeatures.options,
    routeFeatures.showOptionsPane,
    routeFeatures.equities,
    routeFeatures.showEquitiesPane,
    routeFeatures.inferredDark,
    routeFeatures.showDarkPane,
    routeFeatures.showFocusPane,
    routeFeatures.flow,
    routeFeatures.showFlowPane,
    routeFeatures.news,
    routeFeatures.showNewsPane,
    routeFeatures.alerts,
    routeFeatures.showAlertsPane,
    routeFeatures.smartMoney,
    routeFeatures.showClassifierPane,
    routeFeatures.showChartPane,
    routeFeatures.classifierHits,
    optionsFeed.lastUpdate,
    equitiesFeed.lastUpdate,
    inferredDarkFeed.lastUpdate,
    flowFeed.lastUpdate,
    newsFeed.lastUpdate,
    alertsFeed.lastUpdate,
    smartMoneyFeed.lastUpdate,
    classifierHitsFeed.lastUpdate
  ]);

  return {
    mode,
    setMode,
    replaySource,
    setReplaySource,
    selectedAlert,
    setSelectedAlert,
    selectedNewsStory,
    setSelectedNewsStory,
    selectedDarkEvent,
    setSelectedDarkEvent,
    selectedClassifierHit,
    setSelectedClassifierHit,
    selectedSmartMoneyEvent,
    setSelectedSmartMoneyEvent,
    selectedInstrument,
    setSelectedInstrument,
    selectedInstrumentLabel,
    filterInput,
    setFilterInput,
    flowFilters,
    setFlowFilters,
    chartIntervalMs,
    setChartIntervalMs,
    optionsScroll,
    equitiesScroll,
    flowScroll,
    darkScroll,
    alertsScroll,
    classifierScroll,
    options: optionsFeed,
    equities: equitiesFeed,
    equityJoins: equityJoinsFeed,
    nbbo: nbboFeed,
    inferredDark: inferredDarkFeed,
    news: newsFeed,
    flow: flowFeed,
    alerts: alertsFeed,
    smartMoney: smartMoneyFeed,
    classifierHits: classifierHitsFeed,
    liveSession,
    routeFeatures,
    activeTickers,
    tickerSet,
    chartTicker,
    nbboMap,
    historicalNbboByTraceId,
    optionPrintMap: resolvedOptionPrintMap,
    equityJoinMap: resolvedEquityJoinMap,
    flowPacketMap: resolvedFlowPacketMap,
    classifierHitsByPacketId,
    packetIdByOptionTraceId,
    classifierDecorByOptionTraceId,
    selectedEvidence,
    selectedAlertContextStatus,
    selectedFlowPacket,
    selectedDarkEvidence,
    selectedDarkUnderlying,
    selectedClassifierPacketId,
    selectedClassifierFlowPacket,
    selectedClassifierEvidence,
    selectedSmartMoneyFlowPacket,
    selectedSmartMoneyEvidence,
    filteredOptions,
    filteredEquities,
    optionsScopedQuiet,
    equitiesScopedQuiet,
    equitiesSilentWarning,
    filteredInferredDark,
    filteredNews,
    filteredFlow,
    filteredAlerts,
    filteredSmartMoneyEvents,
    filteredClassifierHits,
    chartSmartMoneyEvents,
    chartInferredDark,
    focusOptionContract,
    focusEquityTicker,
    openFromSmartMoneyEvent,
    openFromClassifierHit,
    handleSmartMoneyMarkerClick,
    handleDarkMarkerClick,
    lastSeen,
    toggleMode: () => {
      setMode((prev) => (prev === "live" ? "replay" : "live"));
    }
  };
};

type TerminalState = ReturnType<typeof useTerminalState>;

const TerminalContext = createContext<TerminalState | null>(null);

const useTerminal = (): TerminalState => {
  const value = useContext(TerminalContext);
  if (!value) {
    throw new Error("Terminal context missing");
  }
  return value;
};

export const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/tape", label: "Tape" },
  { href: "/news", label: "News" }
] as const;

type PageFrameProps = {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
};

const PageFrame = ({ title, actions, children }: PageFrameProps) => {
  return (
    <div className="page-shell">
      <header className="page-header">
        <h1 className="page-title">{title}</h1>
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

const FlowFilterSection = ({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) => {
  return (
    <section className="flow-filter-section">
      <div className="flow-filter-section-title">{title}</div>
      {children}
    </section>
  );
};

export const FlowFilterPopover = ({ filters, onChange }: FlowFilterPopoverProps) => {
  const pathname = usePathname();
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
      securityTypes: view === "raw" ? undefined : prev.securityTypes ?? DEFAULT_FLOW_SECURITY_TYPES,
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
        <div
          aria-label="Flow filters"
          className="flow-filter-popover-panel"
          role="dialog"
        >
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

const ShellMetricStrip = () => {
  const state = useTerminal();
  const focus = state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "ALL";
  const replay = state.replaySource ? state.replaySource.toUpperCase() : "AUTO";

  return (
    <div className="shell-metrics">
      <div className="shell-metric">
        <span className="shell-metric-label">Mode</span>
        <span className="shell-metric-value">{state.mode === "live" ? "LIVE" : "REPLAY"}</span>
      </div>
      <div className="shell-metric">
        <span className="shell-metric-label">Focus</span>
        <span className="shell-metric-value">{focus}</span>
      </div>
      <div className="shell-metric">
        <span className="shell-metric-label">Source</span>
        <span className="shell-metric-value">{replay}</span>
      </div>
      <div className="shell-metric">
        <span className="shell-metric-label">Last</span>
        <span className="shell-metric-value">
          {state.lastSeen ? formatTime(state.lastSeen) : "WAITING"}
        </span>
      </div>
    </div>
  );
};

type OptionsPaneProps = {
  state: TerminalState;
  limit?: number;
};

const OptionsPane = memo(({ state, limit }: OptionsPaneProps) => {
  const items = limit ? state.filteredOptions.slice(0, limit) : state.filteredOptions;
  const virtual = useTapeVirtualList(items, state.optionsScroll.listRef, getTapeVirtualConfig("options"));
  const optionHistorySubscription = state.liveSession.manifest.find(
    (subscription) => subscription.channel === "options"
  );
  const optionHistoryKey = optionHistorySubscription ? getLiveSubscriptionKey(optionHistorySubscription) : null;
  const optionHistoryError = optionHistoryKey
    ? state.liveSession.historyErrors[optionHistoryKey]
    : null;
  useVirtualHistoryGate(state.mode === "live" && !limit, items.length, virtual.virtualItems.at(-1)?.index ?? -1, () =>
    void state.liveSession.loadOlder("options")
  );

  return (
    <Pane
      title="Options"
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
                    const quote = state.historicalNbboByTraceId.get(print.trace_id) ?? state.nbboMap.get(contractId);
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
                        <span className="data-table-cell data-table-cell-number">{formatTime(print.ts)}</span>
                        <span className="data-table-cell">
                          <button className="instrument-cell-button" type="button" onClick={focusContract}>
                            {contractDisplay?.ticker ?? parsed?.root ?? formatContractLabel(contractId)}
                          </button>
                        </span>
                        <span className="data-table-cell">
                          <button className="instrument-cell-button" type="button" onClick={focusContract}>
                            {contractDisplay?.expiration ?? parsed?.expiry ?? "--"}
                          </button>
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          <button className="instrument-cell-button" type="button" onClick={focusContract}>
                            {contractDisplay?.strike.replace(/[CP]$/, "") ?? "--"}
                          </button>
                        </span>
                        <span className="data-table-cell">
                          <button className="instrument-cell-button" type="button" onClick={focusContract}>
                            {parsed?.right ?? contractDisplay?.strike.slice(-1) ?? "--"}
                          </button>
                        </span>
                        <span className="data-table-cell data-table-cell-number">{typeof spot === "number" ? formatPrice(spot) : "--"}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatSize(print.size)}@{formatPrice(print.price)}_{nbboSide ?? "--"}
                        </span>
                        <span className="data-table-cell">{print.option_type ?? "--"}</span>
                        <span className="data-table-cell data-table-cell-number notional-emphasis">${formatCompactUsd(notional)}</span>
                        <span className="data-table-cell">
                          {nbboSide ? (
                            <span className={`nbbo-tag nbbo-tag-${nbboSide.toLowerCase()}`}>{nbboSide}</span>
                          ) : (
                            "--"
                          )}
                        </span>
                        <span className="data-table-cell data-table-cell-number">{typeof iv === "number" ? formatPct(iv) : "--"}</span>
                        <span className="data-table-cell">{decor ? humanizeClassifierId(decor.family) : "--"}</span>
                      </>
                    );

                    return decor ? (
                      <button
                        type="button"
                        {...commonProps}
                        key={key}
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
                      </button>
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
  const virtual = useTapeVirtualList(items, state.equitiesScroll.listRef, getTapeVirtualConfig("equities"));
  useVirtualHistoryGate(state.mode === "live" && !limit, items.length, virtual.virtualItems.at(-1)?.index ?? -1, () =>
    void state.liveSession.loadOlder("equities")
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
                      <span className="data-table-cell data-table-cell-number">{formatTime(print.ts)}</span>
                      <span className="data-table-cell">
                        <button
                          className="instrument-cell-button"
                          type="button"
                          onClick={() => state.focusEquityTicker(print)}
                        >
                          {print.underlying_id}
                        </button>
                      </span>
                      <span className="data-table-cell data-table-cell-number">${formatPrice(print.price)}</span>
                      <span className="data-table-cell data-table-cell-number">{formatSize(print.size)}x</span>
                      <span className="data-table-cell">{print.exchange}</span>
                      <span className="data-table-cell">{print.offExchangeFlag ? "Off-Ex" : "Lit"}</span>
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
};

const FlowPane = memo(({ state, limit, title = "Flow" }: FlowPaneProps) => {
  const items = limit ? state.filteredFlow.slice(0, limit) : state.filteredFlow;
  const virtual = useTapeVirtualList(items, state.flowScroll.listRef, getTapeVirtualConfig("flow"));
  useVirtualHistoryGate(state.mode === "live" && !limit, items.length, virtual.virtualItems.at(-1)?.index ?? -1, () =>
    void state.liveSession.loadOlder("flow")
  );

  return (
    <Pane
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
                      typeof features.structure_rights === "string" ? features.structure_rights : "";
                    const structureStrikes = parseNumber(features.structure_strikes, 0);
                    const nbboBid = parseNumber(features.nbbo_bid, Number.NaN);
                    const nbboAsk = parseNumber(features.nbbo_ask, Number.NaN);
                    const nbboMid = parseNumber(features.nbbo_mid, Number.NaN);
                    const nbboSpread = parseNumber(features.nbbo_spread, Number.NaN);
                    const aggressiveBuyRatio = parseNumber(features.nbbo_aggressive_buy_ratio, Number.NaN);
                    const aggressiveSellRatio = parseNumber(
                      features.nbbo_aggressive_sell_ratio,
                      Number.NaN
                    );
                    const aggressiveCoverage = parseNumber(features.nbbo_coverage_ratio, Number.NaN);
                    const insideRatio = parseNumber(features.nbbo_inside_ratio, Number.NaN);
                    const nbboAge = parseNumber(packet.join_quality.nbbo_age_ms, Number.NaN);
                    const nbboStale = parseNumber(packet.join_quality.nbbo_stale, 0) > 0;
                    const nbboMissing = parseNumber(packet.join_quality.nbbo_missing, 0) > 0;
                    const structureLabel = structureType
                      ? `${structureType.replace(/_/g, " ")}${structureRights ? ` ${structureRights}` : ""}${structureLegs > 0 ? ` ${structureLegs}L` : ""}${structureStrikes > 0 ? ` ${structureStrikes}K` : ""}`
                      : "--";
                    const nbboLabel = Number.isFinite(nbboBid) && Number.isFinite(nbboAsk)
                      ? `${formatPrice(nbboBid)} x ${formatPrice(nbboAsk)}`
                      : Number.isFinite(nbboMid)
                        ? `Mid ${formatPrice(nbboMid)}`
                        : "--";
                    const qualityLabel = [
                      Number.isFinite(aggressiveCoverage) && aggressiveCoverage > 0
                        ? `Agg ${formatPct(aggressiveBuyRatio)}/${formatPct(aggressiveSellRatio)} ${formatPct(aggressiveCoverage)} cov`
                        : null,
                      Number.isFinite(insideRatio) && insideRatio > 0 ? `In ${formatPct(insideRatio)}` : null,
                      Number.isFinite(nbboSpread) ? `Spr ${formatPrice(nbboSpread)}` : null,
                      Number.isFinite(nbboAge) ? `${Math.round(nbboAge)}ms` : null,
                      nbboStale ? "Stale" : null,
                      nbboMissing ? "Missing" : null
                    ].filter(Boolean).join(" | ");

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
                        <span className="data-table-cell data-table-cell-number">{formatTime(startTs)} → {formatTime(endTs)}</span>
                        <span className="data-table-cell">{contract}</span>
                        <span className="data-table-cell data-table-cell-number">{formatFlowMetric(count)}</span>
                        <span className="data-table-cell data-table-cell-number">{formatFlowMetric(totalSize)}</span>
                        <span className="data-table-cell data-table-cell-number">${formatUsd(notional)}</span>
                        <span className="data-table-cell data-table-cell-number">{windowMs > 0 ? formatFlowMetric(windowMs, "ms") : "--"}</span>
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
  const virtual = useTapeVirtualList(items, state.alertsScroll.listRef, getTapeVirtualConfig("alerts"));
  useVirtualHistoryGate(state.mode === "live" && !limit, items.length, virtual.virtualItems.at(-1)?.index ?? -1, () =>
    void state.liveSession.loadOlder("alerts")
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
                          state.setSelectedSmartMoneyEvent(null);
                          state.setSelectedAlert(alert);
                        }}
                      >
                        <span className="data-table-cell data-table-cell-number">{formatTime(alert.source_ts)}</span>
                        <span className="data-table-cell">{primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}</span>
                        <span className="data-table-cell">{severity}</span>
                        <span className="data-table-cell data-table-cell-number">{Math.round(alert.score)}</span>
                        <span className="data-table-cell data-table-cell-number">{alert.hits.length}</span>
                        <span className="data-table-cell">{direction}</span>
                        <span className="data-table-cell">{primary?.explanations?.[0] ?? "--"}</span>
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

const NewsPane = memo(({ state, limit, className }: NewsPaneProps) => {
  const items = limit ? state.filteredNews.slice(0, limit) : state.filteredNews;
  const canLoadOlder = state.mode === "live" && !limit && items.length > 0;

  return (
    <Pane
      className={className}
      title="News Wire"
      status={
        limit ? (
          <Link className="terminal-button terminal-link-button" href="/news">
            View all
          </Link>
        ) : (
          <div className="status-inline status-connected">
            <span className="status-dot" />
            <span>{state.mode === "live" ? "Live wire" : "Live-only in v1"}</span>
          </div>
        )
      }
      actions={
        canLoadOlder ? (
          <button className="terminal-button" type="button" onClick={() => void state.liveSession.loadOlder("news")}>
            Older
          </button>
        ) : null
      }
    >
      {state.mode === "replay" ? (
        <div className="empty">News is live-only in v1.</div>
      ) : items.length === 0 ? (
        <div className="empty">
          {state.tickerSet.size > 0 ? "No news stories match the current filter." : "Waiting for live news stories."}
        </div>
      ) : (
        <div className="news-list" role="list" aria-label="News stories">
          {items.map((story) => (
            <button
              className="news-row"
              key={`${story.trace_id}:${story.updated_ts}:${story.seq}`}
              type="button"
              onClick={() => {
                state.setSelectedNewsStory(null);
                state.setSelectedAlert(null);
                state.setSelectedClassifierHit(null);
                state.setSelectedSmartMoneyEvent(null);
                state.setSelectedDarkEvent(null);
                state.setSelectedNewsStory(story);
              }}
            >
              <div className="news-row-head">
                <h3>{story.headline}</h3>
                <span className="news-row-time">{formatNewsTimestamp(story.published_ts)}</span>
              </div>
              <div className="news-row-meta">
                <span>{story.source}</span>
                {story.resolved_symbols.map((symbol) => (
                  <span className="drawer-chip" key={`${story.trace_id}-${symbol}`}>
                    {symbol}
                  </span>
                ))}
              </div>
              {!limit && story.summary ? <p className="drawer-note">{story.summary}</p> : null}
            </button>
          ))}
        </div>
      )}
    </Pane>
  );
});

type ClassifierPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

const ClassifierPane = memo(({ state, limit, className }: ClassifierPaneProps) => {
  const smartMoneyItems = limit ? state.filteredSmartMoneyEvents.slice(0, limit) : state.filteredSmartMoneyEvents;
  const legacyItems =
    smartMoneyItems.length === 0
      ? limit
        ? state.filteredClassifierHits.slice(0, limit)
        : state.filteredClassifierHits
      : [];
  const items: Array<SmartMoneyEvent | ClassifierHitEvent> =
    smartMoneyItems.length > 0 ? smartMoneyItems : legacyItems;
  const virtual = useTapeVirtualList(items, state.classifierScroll.listRef, getTapeVirtualConfig("classifier"));
  useVirtualHistoryGate(state.mode === "live" && !limit, items.length, virtual.virtualItems.at(-1)?.index ?? -1, () => {
    void state.liveSession.loadOlder("smart-money");
    void state.liveSession.loadOlder("classifier-hits");
  });
  const showingSmartMoney = smartMoneyItems.length > 0;

  return (
    <Pane
      className={className}
      title="Rules"
      status={
        <TapeStatus
          status={state.smartMoney.status}
          lastUpdate={state.smartMoney.lastUpdate ?? state.classifierHits.lastUpdate}
          replayTime={state.smartMoney.replayTime ?? state.classifierHits.replayTime}
          replayComplete={state.smartMoney.replayComplete || state.classifierHits.replayComplete}
          paused={state.smartMoney.paused}
          dropped={state.smartMoney.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.smartMoney.paused}
          onTogglePause={state.smartMoney.togglePause}
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
              ? "No classifier hits match the current filter."
              : state.mode === "live"
                ? "No smart-money profiles yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-classifier" role="table" aria-label="Smart money profiles">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">PROFILE</span>
                <span className="data-table-cell">DIR</span>
                <span className="data-table-cell">PROB</span>
                <span className="data-table-cell">NOTE</span>
              </div>
              <div className="data-table-scroll" ref={state.classifierScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {showingSmartMoney ? virtual.virtualItems.map(({ item, key, index, start, size }) => {
                    const event = item as SmartMoneyEvent;
                    const primaryScore =
                      event.profile_scores.find((score) => score.profile_id === event.primary_profile_id) ??
                      event.profile_scores[0];
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
                        <span className="data-table-cell data-table-cell-number">{formatTime(event.source_ts)}</span>
                        <span className="data-table-cell">{smartMoneyProfileLabel(event.primary_profile_id)}</span>
                        <span className="data-table-cell">{direction}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {primaryScore ? formatConfidence(primaryScore.probability) : "--"}
                        </span>
                        <span className="data-table-cell">
                          {event.abstained
                            ? event.suppressed_reasons[0] ?? "abstained"
                            : primaryScore?.reasons[0] ?? primaryScore?.confidence_band ?? "--"}
                        </span>
                      </button>
                    );
                  }) : virtual.virtualItems.map(({ item, key, index, start, size }) => {
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
                        <span className="data-table-cell data-table-cell-number">{formatTime(hit.source_ts)}</span>
                        <span className="data-table-cell">{humanizeClassifierId(hit.classifier_id)}</span>
                        <span className="data-table-cell">{direction}</span>
                        <span className="data-table-cell data-table-cell-number">{formatConfidence(hit.confidence)}</span>
                        <span className="data-table-cell">{hit.explanations?.[0] ?? "--"}</span>
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
  useVirtualHistoryGate(state.mode === "live" && !limit, items.length, virtual.virtualItems.at(-1)?.index ?? -1, () =>
    void state.liveSession.loadOlder("inferred-dark")
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
                          state.setSelectedSmartMoneyEvent(null);
                          state.setSelectedDarkEvent(event);
                        }}
                      >
                        <span className="data-table-cell data-table-cell-number">{formatTime(event.source_ts)}</span>
                        <span className="data-table-cell">{humanizeClassifierId(event.type)}</span>
                        <span className="data-table-cell">{underlying ?? "Unknown"}</span>
                        <span className="data-table-cell data-table-cell-number">{formatConfidence(event.confidence)}</span>
                        <span className="data-table-cell data-table-cell-number">{evidenceCount}</span>
                        <span className="data-table-cell">{underlying ? "--" : "Underlying not in current join cache."}</span>
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
        smartMoneyEvents={state.chartSmartMoneyEvents}
        inferredDark={state.chartInferredDark}
        onSmartMoneyClick={state.handleSmartMoneyMarkerClick}
        onInferredDarkClick={state.handleDarkMarkerClick}
      />
    </Pane>
  );
});

const FocusPane = memo(({ state }: { state: TerminalState }) => {
  const hits = state.chartSmartMoneyEvents.slice(-10).reverse();
  const dark = state.chartInferredDark.slice(-10).reverse();

  return (
    <Pane title="Focus">
      <div className="focus-stack">
        <div className="focus-block">
          <div className="focus-label">Ticker</div>
          <div className="focus-value">{state.chartTicker}</div>
        </div>
        <div className="focus-block">
          <div className="focus-label">Rules</div>
          {hits.length === 0 ? (
            <div className="empty">No rule hits for {state.chartTicker}.</div>
          ) : (
            <div className="list terminal-list terminal-list-compact">
              {hits.map((hit) => (
                <button
                  className="row row-button"
                  key={`${hit.trace_id}-${hit.seq}`}
                  type="button"
                  onClick={() => state.openFromSmartMoneyEvent(hit)}
                >
                  <div>
                    <div className="contract">{smartMoneyProfileLabel(hit.primary_profile_id)}</div>
                    <div className="meta">
                      <span className={`pill direction-${normalizeDirection(hit.primary_direction)}`}>
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
        <button className="terminal-button terminal-button-primary" type="button" onClick={state.toggleMode}>
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

function SyntheticControlDock() {
  const visible = isSyntheticAdminVisible();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SyntheticAdminStatusResponse | null>(null);
  const [draft, setDraft] = useState<SyntheticControlState | null>(null);
  const [saved, setSaved] = useState<SyntheticControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const savedRef = useRef<SyntheticControlState | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(SYNTHETIC_ADMIN_PROXY_PATHS.status, {
          cache: "no-store"
        });
        if (cancelled) {
          return;
        }
        if (response.status === 404) {
          setStatus({
            enabled: false,
            backend_mode: "live",
            adapters: { options: "unknown", equities: "unknown" },
            control: null,
            derived: null,
            disabled_reason: "Synthetic admin backend is disabled."
          });
          setLoading(false);
          return;
        }
        const nextStatus = (await response.json()) as SyntheticAdminStatusResponse;
        setStatus(nextStatus);
        if (!dirtyRef.current) {
          const nextControl = nextStatus.control ?? buildDefaultSyntheticControl();
          setDraft(nextControl);
          setSaved(nextControl);
          savedRef.current = nextControl;
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !status?.enabled || !draft || !dirtyRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      const nextDraft = draft;
      setSaving(true);
      setError(null);
      void fetch(SYNTHETIC_ADMIN_PROXY_PATHS.control, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(nextDraft)
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail ?? body?.error ?? "Synthetic control update failed");
          }
          return (await response.json()) as SyntheticAdminControlResponse;
        })
        .then((payload) => {
          dirtyRef.current = false;
          savedRef.current = payload.control;
          setSaved(payload.control);
          setDraft(payload.control);
          setStatus((current) =>
            current
              ? {
                  ...current,
                  control: payload.control,
                  derived: payload.derived ?? current.derived
                }
              : current
          );
        })
        .catch((updateError) => {
          dirtyRef.current = false;
          setError(updateError instanceof Error ? updateError.message : String(updateError));
          setDraft(savedRef.current);
        })
        .finally(() => {
          setSaving(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeout);
    };
  }, [draft, status?.enabled, visible]);

  if (!visible) {
    return null;
  }

  const currentControl = draft ?? saved ?? buildDefaultSyntheticControl();
  const disabled = !status?.enabled;
  const derived = status?.derived;

  const updateControl = (
    patch: SyntheticControlPatch
  ) => {
    dirtyRef.current = true;
    setDraft((current) =>
      createSyntheticControlDraft(current ?? buildDefaultSyntheticControl(), patch)
    );
  };

  const updateProfileWeight = (
    profileId: keyof SyntheticControlState["profile_weights"],
    value: SyntheticProfileWeightValue
  ) => {
    updateControl({
      profile_weights: {
        [profileId]: value
      } as Partial<SyntheticControlState["profile_weights"]>
    });
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Synthetic control"
        className={`synthetic-control-gear${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="synthetic-control-gear-mark">+</span>
      </button>

      {open ? (
        <aside className="synthetic-control-drawer" aria-label="Synthetic control drawer">
          <div className="synthetic-control-header">
            <div>
              <p className="synthetic-control-kicker">Synthetic Control</p>
              <h3>Hosted tape operator rail</h3>
            </div>
            <button className="drawer-close" onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </div>

          {loading ? (
            <p className="drawer-note">Loading hosted synthetic status…</p>
          ) : disabled ? (
            <div className="synthetic-control-disabled">
              <p className="synthetic-control-disabled-label">Unavailable</p>
              <p>{status?.disabled_reason ?? "Synthetic control is currently unavailable."}</p>
              <span>
                Backend: {status?.backend_mode ?? "unknown"} · Options:{" "}
                {status?.adapters.options ?? "unknown"} · Equities:{" "}
                {status?.adapters.equities ?? "unknown"}
              </span>
            </div>
          ) : (
            <>
              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Preset</span>
                  <span>{saving ? "Saving…" : "Live"}</span>
                </div>
                <label className="synthetic-control-select">
                  <select
                    onChange={(event) =>
                      updateControl({
                        preset_id: event.target.value as SyntheticControlState["preset_id"]
                      })
                    }
                    value={currentControl.preset_id}
                  >
                    {Object.entries(SYNTHETIC_PRESET_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Coverage</span>
                  <span>{currentControl.coverage_window_minutes}m window</span>
                </div>
                <label className="synthetic-control-toggle">
                  <input
                    checked={currentControl.coverage_assist}
                    onChange={(event) =>
                      updateControl({ coverage_assist: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span>Coverage assist</span>
                </label>
                <div className="synthetic-segment-row">
                  {[10, 20, 30].map((minutes) => (
                    <button
                      className={`synthetic-segment${currentControl.coverage_window_minutes === minutes ? " is-active" : ""}`}
                      key={minutes}
                      onClick={() =>
                        updateControl({
                          coverage_window_minutes:
                            minutes as SyntheticCoverageWindowMinutes
                        })
                      }
                      type="button"
                    >
                      {minutes}m
                    </button>
                  ))}
                </div>
              </section>

              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Profile Bias</span>
                  <span>Low · Normal · High</span>
                </div>
                <div className="synthetic-profile-grid">
                  {SYNTHETIC_PROFILE_ORDER.map((profileId) => (
                    <div className="synthetic-profile-row" key={profileId}>
                      <span>{SYNTHETIC_PROFILE_LABELS[profileId]}</span>
                      <div className="synthetic-segment-row">
                        {[
                          { label: "Low", value: 0.6 },
                          { label: "Normal", value: 1.0 },
                          { label: "High", value: 1.6 }
                        ].map((option) => (
                          <button
                            className={`synthetic-segment${currentControl.profile_weights[profileId] === option.value ? " is-active" : ""}`}
                            key={option.label}
                            onClick={() =>
                              updateProfileWeight(
                                profileId,
                                option.value as SyntheticProfileWeightValue
                              )
                            }
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Live Status</span>
                  <span>{status?.backend_mode ?? "unknown"}</span>
                </div>
                <div className="synthetic-status-grid">
                  <div>
                    <span>Regime</span>
                    <strong>{derived?.regime ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Session</span>
                    <strong>{derived?.session_phase ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Focus</span>
                    <strong>
                      {derived?.focus_symbols?.length
                        ? derived.focus_symbols.join(", ")
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Backend</span>
                    <strong>{status?.enabled ? "Enabled" : "Disabled"}</strong>
                  </div>
                </div>
                <div className="synthetic-hit-list">
                  {SYNTHETIC_PROFILE_ORDER.map((profileId) => (
                    <div className="synthetic-hit-row" key={profileId}>
                      <span>{SYNTHETIC_PROFILE_LABELS[profileId]}</span>
                      <strong>{derived?.profile_hit_counts?.[profileId] ?? 0}</strong>
                    </div>
                  ))}
                </div>
              </section>

              {error ? <p className="drawer-note synthetic-control-error">{error}</p> : null}
            </>
          )}
        </aside>
      ) : null}
    </>
  );
}

export function TerminalAppShell({ children }: { children: ReactNode }) {
  const state = useTerminalState();
  const pathname = usePathname();
  const tickerFieldId = useId();
  const tickerHintId = useId();

  return (
    <TerminalContext.Provider value={state}>
      <div className="terminal-shell">
        <a className="skip-link" href="#terminal-content">
          Skip to terminal content
        </a>
        <aside className="terminal-rail">
          <div className="terminal-brand">
            <span className="terminal-brand-kicker">IF</span>
            <span className="terminal-brand-name">Islandflow</span>
          </div>
          <nav aria-label="Primary" className="terminal-nav">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`terminal-nav-link${active ? " terminal-nav-link-active" : ""}`}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <ShellMetricStrip />
        </aside>

        <div className="terminal-frame">
          <header className="terminal-topbar">
            <div className="terminal-topbar-actions">
              <div className="terminal-topbar-controls">
                {state.selectedInstrumentLabel && state.selectedInstrument?.kind !== "option-contract" ? (
                  <span className="instrument-focus-chip">
                    <span>{state.selectedInstrumentLabel}</span>
                    <button type="button" onClick={() => state.setSelectedInstrument(null)}>
                      Clear
                    </button>
                  </span>
                ) : null}
                <label className="terminal-filter">
                  <span className="terminal-filter-label" id={tickerHintId}>
                    Ticker
                  </span>
                  <span className="terminal-filter-field">
                    <input
                      id={tickerFieldId}
                      aria-describedby={tickerHintId}
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      className="terminal-input"
                      value={state.filterInput}
                      inputMode="text"
                      maxLength={TICKER_FILTER_INPUT_MAX_LENGTH}
                      name="ticker-filter"
                      onChange={(event) => state.setFilterInput(normalizeTickerFilterInput(event.target.value))}
                      placeholder="SPY, NVDA, AAPL"
                      spellCheck={false}
                    />
                  </span>
                </label>
                <button
                  aria-label="Clear ticker filter"
                  className="terminal-button"
                  type="button"
                  onClick={() => state.setFilterInput("")}
                  disabled={state.filterInput.trim().length === 0}
                  title="Clear ticker filter"
                >
                  Clear
                </button>
              </div>
              <div className="terminal-topbar-mode">
                <button
                  aria-label={state.mode === "live" ? "Switch to replay mode" : "Switch to live mode"}
                  aria-pressed={state.mode !== "live"}
                  className="terminal-button terminal-button-primary"
                  type="button"
                  onClick={state.toggleMode}
                  title={state.mode === "live" ? "Switch to replay mode" : "Switch to live mode"}
                >
                  {state.mode === "live" ? "Replay" : "Live"}
                </button>
              </div>
            </div>
          </header>

          <main className="terminal-content" id="terminal-content">
            {children}
          </main>
        </div>

        <SyntheticControlDock />

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
          <NewsDrawer story={state.selectedNewsStory} onClose={() => state.setSelectedNewsStory(null)} />
        ) : null}

        {state.selectedClassifierHit ? (
          <ClassifierHitDrawer
            hit={state.selectedClassifierHit}
            flowPacket={state.selectedClassifierFlowPacket}
            evidence={state.selectedClassifierEvidence}
            onClose={() => state.setSelectedClassifierHit(null)}
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
      </div>
    </TerminalContext.Provider>
  );
}

export function OverviewRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Home">
      <div className="page-grid page-grid-home">
        <ChartPane state={state} />
        <EquitiesPane state={state} />
        <NewsPane state={state} limit={6} />
        <AlertsPane state={state} withStrip />
      </div>
    </PageFrame>
  );
}

export function NewsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="News">
      <div className="page-grid page-grid-news">
        <NewsPane state={state} className="news-pane-full" />
      </div>
    </PageFrame>
  );
}

export function TapeRoute() {
  const state = useTerminal();
  return (
    <PageFrame
      title="Tape"
      actions={
        <>
          <button
            className={`terminal-button contract-filter-button${state.selectedInstrument?.kind === "option-contract" ? " is-active" : ""}`}
            type="button"
            disabled={state.selectedInstrument?.kind !== "option-contract"}
            onClick={() => state.setSelectedInstrument(null)}
            title={
              state.selectedInstrument?.kind === "option-contract"
                ? "Clear active contract filter"
                : "Contract filter activates when you focus a contract in the Options tape"
            }
          >
            <span className="contract-filter-button-label">
              {state.selectedInstrument?.kind === "option-contract"
                ? state.selectedInstrumentLabel
                : "Contract Filter"}
            </span>
          </button>
          <FlowFilterPopover filters={state.flowFilters} onChange={state.setFlowFilters} />
        </>
      }
    >
      <div className="page-grid page-grid-tape">
        <OptionsPane state={state} />
        <EquitiesPane state={state} />
        <FlowPane state={state} title="Packets" />
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
