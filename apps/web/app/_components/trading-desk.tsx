"use client";

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  AlertEvent,
  ClassifierHitEvent,
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  FlowPacket,
  InferredDarkEvent,
  OptionNBBO,
  OptionPrint
} from "@islandflow/types";
import { createChart, type IChartApi, type SeriesMarker, type UTCTimestamp } from "lightweight-charts";

const MAX_ITEMS = 500;
const NBBO_MAX_AGE_MS = Number(process.env.NEXT_PUBLIC_NBBO_MAX_AGE_MS);
const NBBO_MAX_AGE_MS_SAFE =
  Number.isFinite(NBBO_MAX_AGE_MS) && NBBO_MAX_AGE_MS > 0 ? NBBO_MAX_AGE_MS : 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const CANDLE_INTERVALS = [
  { label: "1m", ms: 60000 },
  { label: "5m", ms: 300000 }
];

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

const readErrorDetail = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return "";
  }
  try {
    const payload = JSON.parse(text) as {
      detail?: string;
      error?: string;
      message?: string;
    };
    return payload.detail ?? payload.error ?? payload.message ?? text;
  } catch {
    return text;
  }
};

type WsStatus = "connecting" | "connected" | "disconnected";

type TapeMode = "live" | "replay";

type MessageType =
  | "option-print"
  | "option-nbbo"
  | "equity-print"
  | "equity-candle"
  | "equity-join"
  | "flow-packet"
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

const mergeNewest = <T extends SortableItem>(incoming: T[], existing: T[]): T[] => {
  const combined = [...incoming, ...existing];
  if (combined.length === 0) {
    return combined;
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

  return deduped.slice(0, MAX_ITEMS);
};

type TapeState<T> = {
  status: WsStatus;
  items: T[];
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

const normalizeContractId = (value: string): string => value.trim();

const formatContractLabel = (value: string): string => {
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

const extractUnderlying = (contractId: string): string => {
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  return contractId.split("-")[0]?.toUpperCase() ?? contractId.toUpperCase();
};

const extractEquityTraceFromJoin = (joinId: string): string | null => {
  const match = joinId.match(/^equityjoin:(.+)$/);
  return match?.[1] ?? null;
};

const inferDarkUnderlying = (
  event: InferredDarkEvent,
  equityPrints: Map<string, EquityPrint>,
  equityJoins: Map<string, EquityPrintJoin>
): string | null => {
  for (const ref of event.evidence_refs) {
    const join = equityJoins.get(ref);
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

  for (const ref of event.evidence_refs) {
    const traceId = extractEquityTraceFromJoin(ref);
    if (!traceId) {
      continue;
    }
    const print = equityPrints.get(traceId);
    if (print) {
      return print.underlying_id.toUpperCase();
    }
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

type ListScrollState = {
  listRef: React.RefObject<HTMLDivElement>;
  isAtTop: boolean;
  isAtTopRef: React.MutableRefObject<boolean>;
  missed: number;
  resumeTick: number;
  onNewItems: (count: number) => void;
  jumpToTop: () => void;
};

const useListScroll = (): ListScrollState => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  const [missed, setMissed] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const isAtTopRef = useRef(true);
  const prevAtTopRef = useRef(true);

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
    const el = listRef.current;
    if (!el) {
      return;
    }

    const onScroll = () => {
      updateScrollState();
    };

    updateScrollState();
    el.addEventListener("scroll", onScroll);

    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [updateScrollState]);

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
  const pendingRef = useRef<{ height: number } | null>(null);

  const capture = useCallback(() => {
    if (isAtTopRef.current) {
      pendingRef.current = null;
      return;
    }

    const el = listRef.current;
    if (!el) {
      return;
    }

    pendingRef.current = {
      height: el.scrollHeight
    };
  }, [isAtTopRef, listRef]);

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

    const delta = el.scrollHeight - pending.height;
    if (delta !== 0) {
      el.scrollTop = Math.max(0, el.scrollTop + delta);
    }
    pendingRef.current = null;
  }, [isAtTopRef, listRef]);

  return { capture, apply };
};

const statusLabel = (status: WsStatus, paused: boolean, mode: TapeMode): string => {
  if (paused) {
    return "Paused";
  }

  if (mode === "replay") {
    return status === "disconnected" ? "Replay Down" : "Replay";
  }

  switch (status) {
    case "connected":
      return "Live";
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
  expectedType: MessageType;
  batchSize?: number;
  pollMs?: number;
  captureScroll?: () => void;
  onNewItems?: (count: number) => void;
  getItemTs?: (item: T) => number;
  getReplayKey?: (item: T) => string | null;
  replaySourceKey?: string | null;
  onReplaySourceKey?: (key: string | null) => void;
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

      setItems((prev) => mergeNewest(buffered, prev));
      setLastUpdate(Date.now());
    });
  }, [captureScroll, onNewItems]);

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
  }, [mode, replaySourceKey, cancelFlush]);

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
  }, [mode, latestPath, getItemTs, replaySourceKey]);

  useEffect(() => {
    if (mode !== "live") {
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

          if (onReplaySourceKey && sourcePrefix && replaySourceNotifiedRef.current !== sourcePrefix) {
            replaySourceNotifiedRef.current = sourcePrefix;
            onReplaySourceKey(sourcePrefix);
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
    onReplaySourceKey
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
        holdRef.current = mergeNewest(buffered, holdRef.current);
        setLastUpdate(Date.now());
        return;
      }

      const nextBatch =
        holdRef.current.length > 0 ? [...holdRef.current, ...buffered] : buffered;
      holdRef.current = [];

      setItems((prev) => mergeNewest(nextBatch, prev));
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
    setItems((prev) => mergeNewest(holdRef.current, prev));
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

type TapeStatusProps = {
  status: WsStatus;
  lastUpdate: number | null;
  replayTime: number | null;
  replayComplete: boolean;
  paused: boolean;
  dropped: number;
  mode: TapeMode;
  onTogglePause: () => void;
};

const TapeStatus = ({
  status,
  lastUpdate,
  replayTime,
  replayComplete,
  paused,
  dropped,
  mode,
  onTogglePause
}: TapeStatusProps) => {
  const replayClass = mode === "replay" ? "status-replay" : "";
  const pausedClass = paused ? "status-paused" : "";
  const label = replayComplete ? "Replay Complete" : statusLabel(status, paused, mode);

  return (
    <div className={`status status-${status} status-compact ${replayClass} ${pausedClass}`.trim()}>
      <span className="status-dot" />
      <span>{label}</span>
      {lastUpdate ? (
        <span className="timestamp">Updated {formatTime(lastUpdate)}</span>
      ) : (
        <span className="timestamp">Waiting for data</span>
      )}
      {paused && dropped > 0 ? (
        <span className="timestamp">{dropped} new while paused</span>
      ) : null}
      {mode === "replay" ? (
        <span className="timestamp">
          Replay time {replayTime ? formatTime(replayTime) : "—"}
        </span>
      ) : null}
      <button className="pause-button" type="button" onClick={onTogglePause}>
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
};

type TapeControlsProps = {
  isAtTop: boolean;
  missed: number;
  onJump: () => void;
};

const TapeControls = ({ isAtTop, missed, onJump }: TapeControlsProps) => {
  const active = !isAtTop && missed > 0;
  return (
    <div className={`tape-controls${active ? " tape-controls-active" : ""}`}>
      <button className="jump-button" type="button" onClick={onJump} disabled={isAtTop}>
        Jump to top
      </button>
      <span className="missed-count">{active ? `+${missed} new` : ""}</span>
    </div>
  );
};

type CandleChartProps = {
  ticker: string;
  intervalMs: number;
  mode: TapeMode;
  replayTime?: number | null;
  classifierHits: ClassifierHitEvent[];
  inferredDark: InferredDarkEvent[];
  onClassifierHitClick: (hit: ClassifierHitEvent) => void;
  onInferredDarkClick: (event: InferredDarkEvent) => void;
};

type MarkerAction =
  | { kind: "hit"; hit: ClassifierHitEvent }
  | { kind: "dark"; event: InferredDarkEvent };

const CandleChart = ({
  ticker,
  intervalMs,
  mode,
  replayTime = null,
  classifierHits,
  inferredDark,
  onClassifierHitClick,
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
  const onHitClickRef = useRef(onClassifierHitClick);
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
      ctx.fillStyle = "rgba(103, 185, 255, 0.4)";
      ctx.strokeStyle = "rgba(103, 185, 255, 0.9)";

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
    onHitClickRef.current = onClassifierHitClick;
  }, [onClassifierHitClick]);

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
    const inRangeHits = classifierHits
      .filter((hit) => hit.source_ts >= from && hit.source_ts <= to)
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

    const MAX_HIT_MARKERS = 220;
    const MAX_DARK_MARKERS = 120;
    const MAX_TOTAL_MARKERS = 320;

    const cappedHits =
      inRangeHits.length > MAX_HIT_MARKERS
        ? inRangeHits.slice(inRangeHits.length - MAX_HIT_MARKERS)
        : inRangeHits;
    const cappedDark =
      inRangeDark.length > MAX_DARK_MARKERS
        ? inRangeDark.slice(inRangeDark.length - MAX_DARK_MARKERS)
        : inRangeDark;

    for (const hit of cappedHits) {
      const direction = normalizeDirection(hit.direction);
      const markerId = `hit:${hit.trace_id}:${hit.seq}`;
      lookup.set(markerId, { kind: "hit", hit });

      markers.push({
        id: markerId,
        time: toChartTime(hit.source_ts),
        position: direction === "bullish" ? "belowBar" : "aboveBar",
        color:
          direction === "bullish"
            ? "#59d98e"
            : direction === "bearish"
              ? "#ff8e63"
              : "rgba(197, 209, 223, 0.85)",
        shape:
          direction === "bullish"
            ? "arrowUp"
            : direction === "bearish"
              ? "arrowDown"
              : "circle",
        text: hit.classifier_id ? hit.classifier_id.slice(0, 3).toUpperCase() : "H"
      });
    }

    for (const event of cappedDark) {
      const markerId = `dark:${event.trace_id}:${event.seq}`;
      lookup.set(markerId, { kind: "dark", event });
      markers.push({
        id: markerId,
        time: toChartTime(event.source_ts),
        position: "aboveBar",
        color: "rgba(103, 185, 255, 0.95)",
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
  }, [classifierHits, inferredDark, visibleRangeMs]);

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
        background: { color: "#0c1721" },
        textColor: "#d9e7f3"
      },
      grid: {
        vertLines: { color: "rgba(133, 157, 184, 0.12)" },
        horzLines: { color: "rgba(133, 157, 184, 0.12)" }
      },
      crosshair: {
        vertLine: { color: "rgba(89, 217, 142, 0.35)" },
        horzLine: { color: "rgba(89, 217, 142, 0.35)" }
      },
      timeScale: {
        borderColor: "rgba(133, 157, 184, 0.25)",
        timeVisible: true,
        secondsVisible: intervalMs < 60000
      },
      rightPriceScale: {
        borderColor: "rgba(133, 157, 184, 0.25)"
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
      upColor: "#59d98e",
      downColor: "#ff8e63",
      borderVisible: false,
      wickUpColor: "#59d98e",
      wickDownColor: "#ff8e63"
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
      if (action.kind === "hit") {
        onHitClickRef.current(action.hit);
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

    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      setStatus("connecting");
      const socket = new WebSocket(buildWsUrl("/ws/equity-candles"));
      socketRef.current = socket;

      socket.onopen = () => {
        if (!active) {
          return;
        }
        setStatus("connected");
      };

      socket.onmessage = (event) => {
        if (!active || !seriesRef.current) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as StreamMessage<EquityCandle>;
          if (!message || message.type !== "equity-candle") {
            return;
          }

          const candle = message.payload;
          if (candle.underlying_id !== ticker || candle.interval_ms !== intervalMs) {
            return;
          }

          const chartCandle = toChartCandle(candle);
          const last = lastCandleRef.current;
          if (last) {
            if (chartCandle.time < last.time) {
              return;
            }
            if (chartCandle.time === last.time && candle.seq <= last.seq) {
              return;
            }
          }

          seriesRef.current.update(chartCandle);
          lastCandleRef.current = { time: chartCandle.time, seq: candle.seq };
          setHasData(true);
          setLastUpdate(candle.ingest_ts ?? candle.ts);
          drawOverlay([...overlayDataRef.current, ...overlayLiveRef.current]);
        } catch (error) {
          console.warn("Failed to parse candle payload", error);
        }
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }
        setStatus("disconnected");
        reconnectRef.current = window.setTimeout(connect, 1000);
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }
        setStatus("disconnected");
        socket.close();
      };
    };

    const connectOverlay = () => {
      if (!active) {
        return;
      }

      const socket = new WebSocket(buildWsUrl("/ws/equities"));
      overlaySocketRef.current = socket;

      socket.onmessage = (event) => {
        if (!active) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as StreamMessage<EquityPrint>;
          if (!message || message.type !== "equity-print") {
            return;
          }

          const print = message.payload;
          if (print.underlying_id !== ticker) {
            return;
          }

          overlayLiveRef.current.push({
            ts: print.ts,
            price: print.price,
            size: print.size,
            offExchangeFlag: print.offExchangeFlag
          });

          if (overlayLiveRef.current.length > 1500) {
            overlayLiveRef.current = overlayLiveRef.current.slice(-1500);
          }

          drawOverlay([...overlayDataRef.current, ...overlayLiveRef.current]);
        } catch (error) {
          console.warn("Failed to parse equity print payload", error);
        }
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }
        overlayReconnectRef.current = window.setTimeout(connectOverlay, 1500);
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }
        socket.close();
      };
    };

    connect();
    connectOverlay();

    return () => {
      active = false;
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
      }

      if (overlayReconnectRef.current !== null) {
        window.clearTimeout(overlayReconnectRef.current);
        overlayReconnectRef.current = null;
      }
      if (overlaySocketRef.current) {
        overlaySocketRef.current.close();
      }
    };
  }, [ready, mode, ticker, intervalMs, drawOverlay]);

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
  referenceTimeMs?: number;
};

const AlertSeverityStrip = ({ alerts, referenceTimeMs }: AlertSeverityStripProps) => {
  const windowMs = 30 * 60 * 1000;
  const now = referenceTimeMs ?? Date.now();
  const severityCounts = alerts.reduce(
    (acc, alert) => {
      if (now - alert.source_ts > windowMs) {
        return acc;
      }
      if (alert.severity === "high") {
        acc.high += 1;
      } else if (alert.severity === "medium") {
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
      if (now - alert.source_ts > windowMs) {
        return acc;
      }
      const direction = normalizeDirection(alert.hits[0]?.direction ?? "neutral");
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

type DarkEvidenceItem =
  | { kind: "join"; id: string; join: EquityPrintJoin }
  | { kind: "unknown"; id: string };

type AlertDrawerProps = {
  alert: AlertEvent;
  flowPacket: FlowPacket | null;
  evidence: EvidenceItem[];
  onClose: () => void;
};

const AlertDrawer = ({ alert, flowPacket, evidence, onClose }: AlertDrawerProps) => {
  const primary = alert.hits[0];
  const direction = primary ? normalizeDirection(primary.direction) : "neutral";
  const evidencePrints = evidence.filter((item) => item.kind === "print");
  const unknownCount = evidence.filter((item) => item.kind === "unknown").length;

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
        <span className={`pill severity-${alert.severity}`}>{alert.severity}</span>
        <span className="drawer-chip">Score {Math.round(alert.score)}</span>
        {primary ? <span className={`pill direction-${direction}`}>{direction}</span> : null}
      </div>

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
          <p className="drawer-empty">Flow packet not in the current live cache.</p>
        )}
      </div>

      <div className="drawer-section">
        <h4>Evidence prints</h4>
        {evidencePrints.length === 0 ? (
          <p className="drawer-empty">No evidence prints in the live cache yet.</p>
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
          <p className="drawer-note">{event.trace_id}</p>
        </div>
        {traceRefs.length === 0 ? (
          <p className="drawer-empty">No evidence references attached.</p>
        ) : (
          <div className="drawer-list">
            {traceRefs.map((ref) => (
              <div className="drawer-row" key={ref}>
                <div className="drawer-row-title">Evidence ref</div>
                <p className="drawer-note">{ref}</p>
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

const formatCompactUsd = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return "$0";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
};

const formatCompactValue = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
};

const classNames = (...values: Array<string | false | null | undefined>): string => {
  return values.filter(Boolean).join(" ");
};

const describeBias = (bullish: number, bearish: number, neutral: number): string => {
  if (bullish === 0 && bearish === 0 && neutral === 0) {
    return "Waiting";
  }
  if (bullish === bearish) {
    return neutral > 0 ? "Balanced" : "Two-way";
  }
  return bullish > bearish ? "Bullish skew" : "Bearish skew";
};

type DashboardView = "overview" | "options-flow" | "signals" | "off-exchange";

type TradingDeskProps = {
  view: DashboardView;
};

type ViewDefinition = {
  label: string;
  title: string;
  description: string;
  href: string;
  kicker: string;
};

const VIEW_DEFINITIONS: Record<DashboardView, ViewDefinition> = {
  overview: {
    label: "Overview",
    title: "Desk Overview",
    description:
      "Triage the tape fast: active names, alert pressure, flow concentration, and off-exchange context in one pass.",
    href: "/",
    kicker: "Command view"
  },
  "options-flow": {
    label: "Options Flow",
    title: "Options Flow",
    description:
      "Stay inside the contracts: raw prints, clustering quality, classifier evidence, and chart context arranged for drill-down.",
    href: "/options-flow",
    kicker: "Contract view"
  },
  signals: {
    label: "Signals",
    title: "Signals & Evidence",
    description:
      "Run alert triage with explanations first, then step down into classifier hits and packet evidence without losing context.",
    href: "/signals",
    kicker: "Alert view"
  },
  "off-exchange": {
    label: "Off-Exchange",
    title: "Off-Exchange & Dark",
    description:
      "Watch the equity tape, inferred dark events, and quote-join quality side by side to judge whether hidden liquidity is real.",
    href: "/off-exchange",
    kicker: "Liquidity view"
  }
};

type TickerPulse = {
  ticker: string;
  score: number;
  alerts: number;
  flow: number;
  dark: number;
  prints: number;
  directionScore: number;
  lastTs: number;
};

type MetricCardProps = {
  label: string;
  value: string;
  foot: string;
  tone?: "neutral" | "bullish" | "bearish" | "signal";
};

const MetricCard = ({ label, value, foot, tone = "neutral" }: MetricCardProps) => {
  return (
    <div className={classNames("metric-card", `metric-card-${tone}`)}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-foot">{foot}</span>
    </div>
  );
};

type DeskPanelProps = {
  label: string;
  title: string;
  subtitle: string;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
};

const DeskPanel = ({ label, title, subtitle, className, actions, children }: DeskPanelProps) => {
  return (
    <section className={classNames("panel", className)}>
      <div className="panel-header">
        <div className="panel-header-copy">
          <span className="panel-eyebrow">{label}</span>
          <h2 className="panel-title">{title}</h2>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
};

export function TradingDesk({ view }: TradingDeskProps) {
  const [mode, setMode] = useState<TapeMode>("live");
  const [replaySource, setReplaySource] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertEvent | null>(null);
  const [selectedDarkEvent, setSelectedDarkEvent] = useState<InferredDarkEvent | null>(null);
  const [selectedClassifierHit, setSelectedClassifierHit] = useState<ClassifierHitEvent | null>(null);
  const [filterInput, setFilterInput] = useState<string>("");
  const [chartIntervalMs, setChartIntervalMs] = useState<number>(CANDLE_INTERVALS[0].ms);
  const settingsReadyRef = useRef(false);
  const deferredFilterInput = useDeferredValue(filterInput);

  useEffect(() => {
    try {
      const savedFilter = window.localStorage.getItem("islandflow:focus-filter");
      const savedMode = window.localStorage.getItem("islandflow:view-mode");
      const savedInterval = window.localStorage.getItem("islandflow:chart-interval");

      if (savedFilter) {
        setFilterInput(savedFilter);
      }
      if (savedMode === "live" || savedMode === "replay") {
        setMode(savedMode);
      }
      if (savedInterval) {
        const parsed = Number(savedInterval);
        if (CANDLE_INTERVALS.some((interval) => interval.ms === parsed)) {
          setChartIntervalMs(parsed);
        }
      }
    } catch {
      // Ignore persisted UI state failures.
    }

    settingsReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!settingsReadyRef.current) {
      return;
    }

    try {
      window.localStorage.setItem("islandflow:focus-filter", filterInput);
      window.localStorage.setItem("islandflow:view-mode", mode);
      window.localStorage.setItem("islandflow:chart-interval", String(chartIntervalMs));
    } catch {
      // Ignore persisted UI state failures.
    }
  }, [chartIntervalMs, filterInput, mode]);

  const handleReplaySource = useCallback((value: string | null) => {
    setReplaySource(value);
  }, []);

  useEffect(() => {
    setReplaySource(null);
  }, [mode]);
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

  const options = useTape<OptionPrint>({
    mode,
    wsPath: "/ws/options",
    replayPath: "/replay/options",
    latestPath: "/prints/options",
    expectedType: "option-print",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: optionsAnchor.capture,
    onNewItems: optionsScroll.onNewItems,
    getReplayKey: extractReplaySource,
    onReplaySourceKey: handleReplaySource
  });

  const equities = useTape<EquityPrint>({
    mode,
    wsPath: "/ws/equities",
    replayPath: "/replay/equities",
    latestPath: "/prints/equities",
    expectedType: "equity-print",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: equitiesAnchor.capture,
    onNewItems: equitiesScroll.onNewItems
  });

  const equityJoins = useTape<EquityPrintJoin>({
    mode,
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

  useLayoutEffect(() => {
    optionsAnchor.apply();
  }, [options.items, optionsAnchor.apply]);

  useLayoutEffect(() => {
    equitiesAnchor.apply();
  }, [equities.items, equitiesAnchor.apply]);

  useLayoutEffect(() => {
    flowAnchor.apply();
  }, [flow.items, flowAnchor.apply]);

  useLayoutEffect(() => {
    darkAnchor.apply();
  }, [inferredDark.items, darkAnchor.apply]);

  useLayoutEffect(() => {
    alertsAnchor.apply();
  }, [alerts.items, alertsAnchor.apply]);

  useLayoutEffect(() => {
    classifierAnchor.apply();
  }, [classifierHits.items, classifierAnchor.apply]);

  const activeTickers = useMemo(() => {
    const parts = deferredFilterInput
      .split(/[,\s]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    return Array.from(new Set(parts));
  }, [deferredFilterInput]);

  const tickerSet = useMemo(() => new Set(activeTickers), [activeTickers]);

  const nbboMap = useMemo(() => {
    const map = new Map<string, OptionNBBO>();
    for (const quote of nbbo.items) {
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
  }, [nbbo.items]);

  const optionPrintMap = useMemo(() => {
    const map = new Map<string, OptionPrint>();
    for (const print of options.items) {
      if (print.trace_id) {
        map.set(print.trace_id, print);
      }
    }
    return map;
  }, [options.items]);

  const equityPrintMap = useMemo(() => {
    const map = new Map<string, EquityPrint>();
    for (const print of equities.items) {
      if (print.trace_id) {
        map.set(print.trace_id, print);
      }
    }
    return map;
  }, [equities.items]);

  const equityJoinMap = useMemo(() => {
    const map = new Map<string, EquityPrintJoin>();
    for (const join of equityJoins.items) {
      map.set(join.id, join);
    }
    return map;
  }, [equityJoins.items]);

  const flowPacketMap = useMemo(() => {
    const map = new Map<string, FlowPacket>();
    for (const packet of flow.items) {
      map.set(packet.id, packet);
    }
    return map;
  }, [flow.items]);

  const selectedEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedAlert) {
      return [];
    }

    return selectedAlert.evidence_refs.map((id) => {
      const packet = flowPacketMap.get(id);
      if (packet) {
        return { kind: "flow", id, packet };
      }
      const print = optionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [selectedAlert, flowPacketMap, optionPrintMap]);

  const selectedFlowPacket = useMemo(() => {
    if (!selectedAlert) {
      return null;
    }
    const packetId = selectedAlert.evidence_refs[0];
    return packetId ? flowPacketMap.get(packetId) ?? null : null;
  }, [selectedAlert, flowPacketMap]);

  const selectedDarkEvidence = useMemo((): DarkEvidenceItem[] => {
    if (!selectedDarkEvent) {
      return [];
    }

    return selectedDarkEvent.evidence_refs.map((id) => {
      const join = equityJoinMap.get(id);
      if (join) {
        return { kind: "join", id, join };
      }
      return { kind: "unknown", id };
    });
  }, [selectedDarkEvent, equityJoinMap]);

  const selectedDarkUnderlying = useMemo(() => {
    if (!selectedDarkEvent) {
      return null;
    }
    return inferDarkUnderlying(selectedDarkEvent, equityPrintMap, equityJoinMap);
  }, [selectedDarkEvent, equityJoinMap, equityPrintMap]);

  useEffect(() => {
    if (mode !== "live") {
      setSelectedAlert(null);
    }
    setSelectedDarkEvent(null);
    setSelectedClassifierHit(null);
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

  const selectedClassifierPacketId = useMemo(() => {
    if (!selectedClassifierHit) {
      return null;
    }
    return extractPacketIdFromClassifierHitTrace(selectedClassifierHit.trace_id);
  }, [extractPacketIdFromClassifierHitTrace, selectedClassifierHit]);

  const selectedClassifierFlowPacket = useMemo(() => {
    if (!selectedClassifierPacketId) {
      return null;
    }
    return flowPacketMap.get(selectedClassifierPacketId) ?? null;
  }, [flowPacketMap, selectedClassifierPacketId]);

  const selectedClassifierEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedClassifierHit) {
      return [];
    }

    if (!selectedClassifierPacketId) {
      return [];
    }

    const packet = flowPacketMap.get(selectedClassifierPacketId);
    if (!packet) {
      return [];
    }

    return packet.members.map((id) => {
      const print = optionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [flowPacketMap, optionPrintMap, selectedClassifierHit, selectedClassifierPacketId]);

  const inferAlertUnderlying = useCallback(
    (alert: AlertEvent): string | null => {
      const fromTrace = extractUnderlyingFromTrace(alert.trace_id);
      if (fromTrace) {
        return fromTrace;
      }

      const packetId = alert.evidence_refs[0];
      if (packetId) {
        const packet = flowPacketMap.get(packetId);
        if (packet) {
          return extractUnderlying(extractPacketContract(packet));
        }
      }

      for (const ref of alert.evidence_refs) {
        const print = optionPrintMap.get(ref);
        if (print) {
          return extractUnderlying(print.option_contract_id);
        }
      }

      return null;
    },
    [extractPacketContract, extractUnderlyingFromTrace, flowPacketMap, optionPrintMap]
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
    if (tickerSet.size === 0) {
      return options.items;
    }
    return options.items.filter((print) =>
      matchesTicker(extractUnderlying(normalizeContractId(print.option_contract_id)))
    );
  }, [options.items, matchesTicker, tickerSet]);

  const filteredEquities = useMemo(() => {
    if (tickerSet.size === 0) {
      return equities.items;
    }
    return equities.items.filter((print) => matchesTicker(print.underlying_id));
  }, [equities.items, matchesTicker, tickerSet]);

  const filteredEquityJoins = useMemo(() => {
    if (tickerSet.size === 0) {
      return equityJoins.items;
    }
    return equityJoins.items.filter((join) => matchesTicker(getJoinString(join, "underlying_id")));
  }, [equityJoins.items, matchesTicker, tickerSet]);

  const filteredInferredDark = useMemo(() => {
    if (tickerSet.size === 0) {
      return inferredDark.items;
    }
    return inferredDark.items.filter((event) => {
      const underlying = inferDarkUnderlying(event, equityPrintMap, equityJoinMap);
      return matchesTicker(underlying);
    });
  }, [equityJoinMap, equityPrintMap, inferredDark.items, matchesTicker, tickerSet]);

  const filteredFlow = useMemo(() => {
    if (tickerSet.size === 0) {
      return flow.items;
    }
    return flow.items.filter((packet) =>
      matchesTicker(extractUnderlying(extractPacketContract(packet)))
    );
  }, [flow.items, extractPacketContract, matchesTicker, tickerSet]);

  const filteredAlerts = useMemo(() => {
    if (tickerSet.size === 0) {
      return alerts.items;
    }
    return alerts.items.filter((alert) => matchesTicker(inferAlertUnderlying(alert)));
  }, [alerts.items, inferAlertUnderlying, matchesTicker, tickerSet]);

  const filteredClassifierHits = useMemo(() => {
    if (tickerSet.size === 0) {
      return classifierHits.items;
    }
    return classifierHits.items.filter((hit) => {
      const underlying = extractUnderlyingFromTrace(hit.trace_id);
      return matchesTicker(underlying);
    });
  }, [classifierHits.items, extractUnderlyingFromTrace, matchesTicker, tickerSet]);

  const tickerPulse = useMemo(() => {
    const map = new Map<string, TickerPulse>();

    const touch = (ticker: string | null, delta: Partial<TickerPulse> & { score: number; lastTs: number }) => {
      if (!ticker) {
        return;
      }

      const symbol = ticker.toUpperCase();
      const current = map.get(symbol) ?? {
        ticker: symbol,
        score: 0,
        alerts: 0,
        flow: 0,
        dark: 0,
        prints: 0,
        directionScore: 0,
        lastTs: 0
      };

      current.score += delta.score;
      current.alerts += delta.alerts ?? 0;
      current.flow += delta.flow ?? 0;
      current.dark += delta.dark ?? 0;
      current.prints += delta.prints ?? 0;
      current.directionScore += delta.directionScore ?? 0;
      current.lastTs = Math.max(current.lastTs, delta.lastTs);
      map.set(symbol, current);
    };

    for (const alert of alerts.items) {
      const direction = normalizeDirection(alert.hits[0]?.direction ?? "neutral");
      touch(inferAlertUnderlying(alert), {
        score: alert.severity === "high" ? 7 : alert.severity === "medium" ? 5 : 3,
        alerts: 1,
        directionScore: direction === "bullish" ? 1 : direction === "bearish" ? -1 : 0,
        lastTs: alert.source_ts
      });
    }

    for (const packet of flow.items) {
      touch(extractUnderlying(extractPacketContract(packet)), {
        score: 3,
        flow: 1,
        lastTs: packet.source_ts
      });
    }

    for (const event of inferredDark.items) {
      touch(inferDarkUnderlying(event, equityPrintMap, equityJoinMap), {
        score: 4,
        dark: 1,
        lastTs: event.source_ts
      });
    }

    for (const print of options.items.slice(0, 240)) {
      touch(extractUnderlying(normalizeContractId(print.option_contract_id)), {
        score: 1,
        prints: 1,
        lastTs: print.ts
      });
    }

    for (const print of equities.items.slice(0, 240)) {
      touch(print.underlying_id, {
        score: print.offExchangeFlag ? 2 : 1,
        prints: 1,
        lastTs: print.ts
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.alerts !== a.alerts) {
        return b.alerts - a.alerts;
      }
      return b.lastTs - a.lastTs;
    });
  }, [
    alerts.items,
    equities.items,
    equityJoinMap,
    equityPrintMap,
    extractPacketContract,
    flow.items,
    inferAlertUnderlying,
    inferredDark.items,
    optionPrintMap,
    options.items
  ]);

  const chartTicker = useMemo(() => {
    return activeTickers[0] ?? tickerPulse[0]?.ticker ?? "SPY";
  }, [activeTickers, tickerPulse]);

  const chartClassifierHits = useMemo(() => {
    const desired = chartTicker.toUpperCase();
    return classifierHits.items
      .filter((hit) => extractUnderlyingFromTrace(hit.trace_id) === desired)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
  }, [chartTicker, classifierHits.items, extractUnderlyingFromTrace]);

  const chartInferredDark = useMemo(() => {
    const desired = chartTicker.toUpperCase();
    return inferredDark.items
      .filter((event) => inferDarkUnderlying(event, equityPrintMap, equityJoinMap) === desired)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
  }, [chartTicker, inferredDark.items, equityJoinMap, equityPrintMap]);

  const findAlertForClassifierHit = useCallback(
    (hit: ClassifierHitEvent): AlertEvent | null => {
      const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
      if (!packetId) {
        return null;
      }

      const desiredTrace = `alert:${packetId}`;
      return (
        alerts.items.find(
          (item) => item.trace_id === desiredTrace || item.evidence_refs[0] === packetId
        ) ?? null
      );
    },
    [alerts.items, extractPacketIdFromClassifierHitTrace]
  );

  const openFromClassifierHit = useCallback(
    (hit: ClassifierHitEvent) => {
      const alert = findAlertForClassifierHit(hit);
      if (alert) {
        setSelectedClassifierHit(null);
        setSelectedDarkEvent(null);
        setSelectedAlert(alert);
        return;
      }

      setSelectedAlert(null);
      setSelectedDarkEvent(null);
      setSelectedClassifierHit(hit);
    },
    [findAlertForClassifierHit]
  );

  const handleClassifierMarkerClick = useCallback(
    (hit: ClassifierHitEvent) => {
      openFromClassifierHit(hit);
    },
    [openFromClassifierHit]
  );

  const handleDarkMarkerClick = useCallback((event: InferredDarkEvent) => {
    setSelectedAlert(null);
    setSelectedClassifierHit(null);
    setSelectedDarkEvent(event);
  }, []);

  const lastSeen = useMemo(() => {
    return [
      options.lastUpdate,
      equities.lastUpdate,
      inferredDark.lastUpdate,
      flow.lastUpdate,
      alerts.lastUpdate,
      classifierHits.lastUpdate
    ]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [
    options.lastUpdate,
    equities.lastUpdate,
    inferredDark.lastUpdate,
    flow.lastUpdate,
    alerts.lastUpdate,
    classifierHits.lastUpdate
  ]);

  const replayClock = useMemo(() => {
    return [
      options.replayTime,
      equities.replayTime,
      inferredDark.replayTime,
      flow.replayTime,
      alerts.replayTime,
      classifierHits.replayTime
    ]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [
    alerts.replayTime,
    classifierHits.replayTime,
    equities.replayTime,
    flow.replayTime,
    inferredDark.replayTime,
    options.replayTime
  ]);

  const newestSourceTs = useMemo(() => {
    return [
      options.items[0]?.source_ts ?? options.items[0]?.ts,
      equities.items[0]?.source_ts ?? equities.items[0]?.ts,
      inferredDark.items[0]?.source_ts,
      flow.items[0]?.source_ts,
      alerts.items[0]?.source_ts,
      classifierHits.items[0]?.source_ts
    ]
      .filter((value): value is number => Number.isFinite(value))
      .sort((a, b) => b - a)[0] ?? null;
  }, [
    alerts.items,
    classifierHits.items,
    equities.items,
    flow.items,
    inferredDark.items,
    options.items
  ]);

  const referenceTime = mode === "replay" ? replayClock ?? newestSourceTs ?? Date.now() : Date.now();

  const signalWindowMs = 15 * 60 * 1000;
  const tapeWindowMs = 5 * 60 * 1000;

  const recentAlerts = useMemo(() => {
    return filteredAlerts.filter((alert) => referenceTime - alert.source_ts <= signalWindowMs);
  }, [filteredAlerts, referenceTime]);

  const recentClassifierHits = useMemo(() => {
    return filteredClassifierHits.filter((hit) => referenceTime - hit.source_ts <= signalWindowMs);
  }, [filteredClassifierHits, referenceTime]);

  const recentFlow = useMemo(() => {
    return filteredFlow.filter((packet) => referenceTime - packet.source_ts <= signalWindowMs);
  }, [filteredFlow, referenceTime]);

  const recentDark = useMemo(() => {
    return filteredInferredDark.filter((event) => referenceTime - event.source_ts <= signalWindowMs);
  }, [filteredInferredDark, referenceTime]);

  const recentOptions = useMemo(() => {
    return filteredOptions.filter((print) => referenceTime - print.ts <= tapeWindowMs);
  }, [filteredOptions, referenceTime]);

  const recentEquities = useMemo(() => {
    return filteredEquities.filter((print) => referenceTime - print.ts <= tapeWindowMs);
  }, [filteredEquities, referenceTime]);

  const recentJoins = useMemo(() => {
    return filteredEquityJoins.filter((join) => referenceTime - join.source_ts <= signalWindowMs);
  }, [filteredEquityJoins, referenceTime]);

  const alertDirectionMix = useMemo(() => {
    return recentAlerts.reduce(
      (acc, alert) => {
        const direction = normalizeDirection(alert.hits[0]?.direction ?? "neutral");
        acc[direction] += 1;
        if (alert.severity === "high") {
          acc.high += 1;
        }
        return acc;
      },
      { bullish: 0, bearish: 0, neutral: 0, high: 0 }
    );
  }, [recentAlerts]);

  const recentOptionsNotional = useMemo(() => {
    return recentOptions.reduce((sum, print) => sum + print.price * print.size * 100, 0);
  }, [recentOptions]);

  const recentOffExchange = useMemo(() => {
    return recentEquities.filter((print) => print.offExchangeFlag);
  }, [recentEquities]);

  const offExchangeShares = useMemo(() => {
    return recentOffExchange.reduce((sum, print) => sum + print.size, 0);
  }, [recentOffExchange]);

  const nbboHealth = useMemo(() => {
    const inspected = recentOptions.slice(0, 120);
    let covered = 0;
    let stale = 0;
    let missing = 0;

    for (const print of inspected) {
      const contractId = normalizeContractId(print.option_contract_id);
      const quote = nbboMap.get(contractId);
      if (!quote) {
        missing += 1;
        continue;
      }

      const age = Math.abs(print.ts - quote.ts);
      if (age > NBBO_MAX_AGE_MS_SAFE) {
        stale += 1;
      } else {
        covered += 1;
      }
    }

    return { inspected: inspected.length, covered, stale, missing };
  }, [nbboMap, recentOptions]);

  const quoteJoinHealth = useMemo(() => {
    return recentJoins.reduce(
      (acc, join) => {
        acc.total += 1;
        if (parseNumber(join.join_quality.quote_stale, 0) > 0) {
          acc.stale += 1;
        }
        if (parseNumber(join.join_quality.quote_missing, 0) > 0) {
          acc.missing += 1;
        }
        const age = parseNumber(join.join_quality.quote_age_ms, Number.NaN);
        if (Number.isFinite(age)) {
          acc.aged += age;
          acc.withAge += 1;
        }
        return acc;
      },
      { total: 0, stale: 0, missing: 0, aged: 0, withAge: 0 }
    );
  }, [recentJoins]);

  const headlineAlert = recentAlerts.find((alert) => alert.severity === "high") ?? filteredAlerts[0] ?? null;
  const headlineDark = recentDark[0] ?? filteredInferredDark[0] ?? null;
  const headlineHit = recentClassifierHits[0] ?? filteredClassifierHits[0] ?? null;

  const focusNames = useMemo(() => {
    if (activeTickers.length > 0) {
      const selected = activeTickers
        .map((ticker) => tickerPulse.find((entry) => entry.ticker === ticker))
        .filter((entry): entry is TickerPulse => Boolean(entry));
      if (selected.length > 0) {
        return selected;
      }
    }

    return tickerPulse.slice(0, 8);
  }, [activeTickers, tickerPulse]);

  const dominantBias = describeBias(
    alertDirectionMix.bullish,
    alertDirectionMix.bearish,
    alertDirectionMix.neutral
  );
  const dominantBiasTone =
    alertDirectionMix.bullish > alertDirectionMix.bearish
      ? "bullish"
      : alertDirectionMix.bearish > alertDirectionMix.bullish
        ? "bearish"
        : "neutral";

  const viewMetrics = useMemo<MetricCardProps[]>(() => {
    const overviewMetrics: MetricCardProps[] = [
      {
        label: "High priority",
        value: String(alertDirectionMix.high),
        foot: "High-severity alerts in the last 15m",
        tone: alertDirectionMix.high > 0 ? "signal" : "neutral"
      },
      {
        label: "Bias",
        value: dominantBias,
        foot: `${alertDirectionMix.bullish} bull / ${alertDirectionMix.bearish} bear / ${alertDirectionMix.neutral} neutral`,
        tone: dominantBiasTone
      },
      {
        label: "Options notional",
        value: formatCompactUsd(recentOptionsNotional),
        foot: "Five-minute options premium flowing through the tape",
        tone: "neutral"
      },
      {
        label: "Off-ex blocks",
        value: formatCompactValue(recentOffExchange.length),
        foot: `${formatCompactValue(offExchangeShares)} shares off-ex in the last 5m`,
        tone: "neutral"
      }
    ];

    switch (view) {
      case "options-flow":
        return [
          {
            label: "Recent prints",
            value: formatCompactValue(recentOptions.length),
            foot: "Options prints in the last 5m for the current view"
          },
          {
            label: "Flow packets",
            value: formatCompactValue(recentFlow.length),
            foot: "Deterministic flow clusters in the last 15m",
            tone: "signal"
          },
          {
            label: "Premium",
            value: formatCompactUsd(recentOptionsNotional),
            foot: "Five-minute notional from visible prints"
          },
          {
            label: "NBBO quality",
            value:
              nbboHealth.inspected > 0
                ? `${Math.round((nbboHealth.covered / nbboHealth.inspected) * 100)}%`
                : "N/A",
            foot: `${nbboHealth.stale} stale / ${nbboHealth.missing} missing in sampled prints`
          }
        ];
      case "signals":
        return [
          {
            label: "Alerts",
            value: formatCompactValue(recentAlerts.length),
            foot: "Signals scored in the last 15m",
            tone: recentAlerts.length > 0 ? "signal" : "neutral"
          },
          {
            label: "Bias",
            value: dominantBias,
            foot: `${alertDirectionMix.bullish} bull / ${alertDirectionMix.bearish} bear`,
            tone: dominantBiasTone
          },
          {
            label: "Classifier hits",
            value: formatCompactValue(recentClassifierHits.length),
            foot: "Raw rule triggers before alert scoring"
          },
          {
            label: "Top severity",
            value: headlineAlert ? headlineAlert.severity.toUpperCase() : "NONE",
            foot: headlineAlert ? humanizeClassifierId(headlineAlert.hits[0]?.classifier_id ?? "alert") : "No alert in focus",
            tone: headlineAlert?.severity === "high" ? "signal" : "neutral"
          }
        ];
      case "off-exchange":
        return [
          {
            label: "Off-ex prints",
            value: formatCompactValue(recentOffExchange.length),
            foot: `${formatCompactValue(offExchangeShares)} shares marked off-ex in the last 5m`
          },
          {
            label: "Dark events",
            value: formatCompactValue(recentDark.length),
            foot: "Inferred hidden-liquidity events in the last 15m",
            tone: recentDark.length > 0 ? "signal" : "neutral"
          },
          {
            label: "Quote age",
            value:
              quoteJoinHealth.withAge > 0
                ? `${Math.round(quoteJoinHealth.aged / quoteJoinHealth.withAge)}ms`
                : "N/A",
            foot: `${quoteJoinHealth.stale} stale / ${quoteJoinHealth.missing} missing joined quotes`
          },
          {
            label: "Active name",
            value: focusNames[0]?.ticker ?? "None",
            foot: "Most active symbol in the current liquidity context",
            tone: "neutral"
          }
        ];
      case "overview":
      default:
        return overviewMetrics;
    }
  }, [
    alertDirectionMix,
    dominantBias,
    dominantBiasTone,
    focusNames,
    headlineAlert,
    nbboHealth,
    offExchangeShares,
    quoteJoinHealth,
    recentAlerts,
    recentClassifierHits,
    recentDark,
    recentFlow,
    recentOffExchange.length,
    recentOptions.length,
    recentOptionsNotional,
    view
  ]);

  const pipelineHealth = [
    {
      label: "Options",
      status: options.status,
      paused: options.paused,
      dropped: options.dropped,
      count: filteredOptions.length,
      lastUpdate: options.lastUpdate
    },
    {
      label: "Flow",
      status: flow.status,
      paused: flow.paused,
      dropped: flow.dropped,
      count: filteredFlow.length,
      lastUpdate: flow.lastUpdate
    },
    {
      label: "Alerts",
      status: alerts.status,
      paused: alerts.paused,
      dropped: alerts.dropped,
      count: filteredAlerts.length,
      lastUpdate: alerts.lastUpdate
    },
    {
      label: "Off-Ex",
      status: equities.status,
      paused: equities.paused,
      dropped: equities.dropped,
      count: filteredEquities.length,
      lastUpdate: equities.lastUpdate
    }
  ] as const;

  const toggleMode = () => {
    setMode((prev) => (prev === "live" ? "replay" : "live"));
  };

  const focusTicker = useCallback((ticker: string) => {
    startTransition(() => {
      setFilterInput(ticker);
    });
  }, []);

  const clearTickerFilter = useCallback(() => {
    startTransition(() => {
      setFilterInput("");
    });
  }, []);

  const currentView = VIEW_DEFINITIONS[view];

  const emptyState = useCallback(
    (filteredCopy: string, liveCopy: string, replayCopy: string) => {
      return (
        <div className="empty">
          {tickerSet.size > 0 ? filteredCopy : mode === "live" ? liveCopy : replayCopy}
        </div>
      );
    },
    [mode, tickerSet.size]
  );

  const renderChartPanel = (className?: string) => {
    return (
      <DeskPanel
        className={classNames("panel-chart", className)}
        label="Context"
        title={`${chartTicker} structure`}
        subtitle={`Server-built ${formatIntervalLabel(chartIntervalMs)} candles with classifier and off-exchange overlays.`}
        actions={
          <div className="chart-intervals">
            {CANDLE_INTERVALS.map((interval) => (
              <button
                key={interval.ms}
                className={`interval-button${interval.ms === chartIntervalMs ? " active" : ""}`}
                type="button"
                onClick={() => setChartIntervalMs(interval.ms)}
              >
                {interval.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="panel-stack">
          <div className="chart-controls">
            <span className="chart-hint">
              {activeTickers.length > 1
                ? `Chart locked to ${chartTicker}, first of ${activeTickers.length} filtered names`
                : `Chart locked to ${chartTicker}`}
            </span>
            <span className="chart-hint">
              {mode === "replay" && replaySource ? `Replay source ${replaySource}` : "Click markers to open evidence"}
            </span>
          </div>
          <CandleChart
            ticker={chartTicker}
            intervalMs={chartIntervalMs}
            mode={mode}
            replayTime={equities.replayTime}
            classifierHits={chartClassifierHits}
            inferredDark={chartInferredDark}
            onClassifierHitClick={handleClassifierMarkerClick}
            onInferredDarkClick={handleDarkMarkerClick}
          />
        </div>
      </DeskPanel>
    );
  };

  const renderOptionsPanel = (className?: string, limit?: number) => {
    const items = limit ? filteredOptions.slice(0, limit) : filteredOptions;

    return (
      <DeskPanel
        className={classNames("panel-tape", className)}
        label="Options"
        title="Options prints"
        subtitle="Raw contract prints with NBBO context and notional front and center."
      >
        <div className="panel-stack">
          <div className="card-controls">
            <TapeStatus
              status={options.status}
              lastUpdate={options.lastUpdate}
              replayTime={options.replayTime}
              replayComplete={options.replayComplete}
              paused={options.paused}
              dropped={options.dropped}
              mode={mode}
              onTogglePause={options.togglePause}
            />
            <TapeControls
              isAtTop={optionsScroll.isAtTop}
              missed={optionsScroll.missed}
              onJump={optionsScroll.jumpToTop}
            />
          </div>
          <div className="list" ref={optionsScroll.listRef}>
            {items.length === 0
              ? emptyState(
                  "No option prints match the current focus filter.",
                  "No option prints yet. Start ingest-options.",
                  "Replay queue empty. Ensure ClickHouse has data."
                )
              : items.map((print) => {
                  const contractId = normalizeContractId(print.option_contract_id);
                  const quote = nbboMap.get(contractId);
                  const nbboAge = quote ? Math.abs(print.ts - quote.ts) : null;
                  const nbboStale = nbboAge !== null && nbboAge > NBBO_MAX_AGE_MS_SAFE;
                  const nbboMid = quote ? (quote.bid + quote.ask) / 2 : null;
                  const nbboSide = classifyNbboSide(print.price, quote);
                  const notional = print.price * print.size * 100;

                  return (
                    <div className="row" key={`${print.trace_id}-${print.seq}`}>
                      <div>
                        <div className="contract">{formatContractLabel(contractId)}</div>
                        <div className="meta">
                          <span>${formatPrice(print.price)}</span>
                          <span>{formatSize(print.size)}x</span>
                          <span>{print.exchange}</span>
                          <span>Notional {formatCompactUsd(notional)}</span>
                          {print.conditions?.length ? <span>{print.conditions.join(", ")}</span> : null}
                        </div>
                        {quote ? (
                          <div className="meta nbbo-meta">
                            <span>Bid ${formatPrice(quote.bid)}</span>
                            <span>Ask ${formatPrice(quote.ask)}</span>
                            <span>Mid ${formatPrice(nbboMid ?? 0)}</span>
                            <span>{Math.round(nbboAge ?? 0)}ms</span>
                            {nbboSide ? (
                              <span className="nbbo-side" tabIndex={0} aria-label="NBBO side legend">
                                <span className={`nbbo-tag nbbo-tag-${nbboSide.toLowerCase()}`}>{nbboSide}</span>
                                <span className="nbbo-tooltip" role="tooltip">
                                  <span className="nbbo-tooltip-row">
                                    <span className="nbbo-tag nbbo-tag-a">A</span>
                                    <span>Ask</span>
                                  </span>
                                  <span className="nbbo-tooltip-row">
                                    <span className="nbbo-tag nbbo-tag-aa">AA</span>
                                    <span>Above Ask</span>
                                  </span>
                                  <span className="nbbo-tooltip-row">
                                    <span className="nbbo-tag nbbo-tag-b">B</span>
                                    <span>Bid</span>
                                  </span>
                                  <span className="nbbo-tooltip-row">
                                    <span className="nbbo-tag nbbo-tag-bb">BB</span>
                                    <span>Below Bid</span>
                                  </span>
                                </span>
                              </span>
                            ) : null}
                            {nbboStale ? <span className="pill nbbo-stale">Stale</span> : null}
                          </div>
                        ) : (
                          <div className="meta nbbo-meta">
                            <span className="pill nbbo-missing">NBBO missing</span>
                          </div>
                        )}
                      </div>
                      <div className="time">{formatTime(print.ts)}</div>
                    </div>
                  );
                })}
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderEquitiesPanel = (className?: string, limit?: number) => {
    const items = limit ? filteredEquities.slice(0, limit) : filteredEquities;

    return (
      <DeskPanel
        className={classNames("panel-tape", className)}
        label="Equities"
        title="Equity tape"
        subtitle="Lit versus off-exchange routing is visible on every print."
      >
        <div className="panel-stack">
          <div className="card-controls">
            <TapeStatus
              status={equities.status}
              lastUpdate={equities.lastUpdate}
              replayTime={equities.replayTime}
              replayComplete={equities.replayComplete}
              paused={equities.paused}
              dropped={equities.dropped}
              mode={mode}
              onTogglePause={equities.togglePause}
            />
            <TapeControls
              isAtTop={equitiesScroll.isAtTop}
              missed={equitiesScroll.missed}
              onJump={equitiesScroll.jumpToTop}
            />
          </div>
          <div className="list" ref={equitiesScroll.listRef}>
            {items.length === 0
              ? emptyState(
                  "No equity prints match the current focus filter.",
                  "No equity prints yet. Start ingest-equities.",
                  "Replay queue empty. Ensure ClickHouse has data."
                )
              : items.map((print) => (
                  <div className="row" key={`${print.trace_id}-${print.seq}`}>
                    <div>
                      <div className="contract">{print.underlying_id}</div>
                      <div className="meta">
                        <span>${formatPrice(print.price)}</span>
                        <span>{formatSize(print.size)}x</span>
                        <span>{print.exchange}</span>
                        {print.offExchangeFlag ? (
                          <span className="flag">Off-Ex</span>
                        ) : (
                          <span className="flag flag-muted">Lit</span>
                        )}
                      </div>
                    </div>
                    <div className="time">{formatTime(print.ts)}</div>
                  </div>
                ))}
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderFlowPanel = (className?: string, limit?: number) => {
    const items = limit ? filteredFlow.slice(0, limit) : filteredFlow;

    return (
      <DeskPanel
        className={classNames("panel-flow", className)}
        label="Flow"
        title="Flow packets"
        subtitle="Deterministic clusters built from persisted option events."
      >
        <div className="panel-stack">
          <div className="card-controls">
            <TapeStatus
              status={flow.status}
              lastUpdate={flow.lastUpdate}
              replayTime={flow.replayTime}
              replayComplete={flow.replayComplete}
              paused={flow.paused}
              dropped={flow.dropped}
              mode={mode}
              onTogglePause={flow.togglePause}
            />
            <TapeControls isAtTop={flowScroll.isAtTop} missed={flowScroll.missed} onJump={flowScroll.jumpToTop} />
          </div>
          <div className="list" ref={flowScroll.listRef}>
            {items.length === 0
              ? emptyState(
                  "No flow packets match the current focus filter.",
                  "No flow packets yet. Start compute.",
                  "Replay queue empty. Ensure ClickHouse has data."
                )
              : items.map((packet) => {
                  const features = packet.features ?? {};
                  const contract = String(features.option_contract_id ?? packet.id ?? "unknown");
                  const count = parseNumber(features.count, packet.members.length);
                  const totalSize = parseNumber(features.total_size, 0);
                  const totalNotional = parseNumber(features.total_notional, Number.NaN);
                  const notional =
                    Number.isFinite(totalNotional) ? totalNotional : parseNumber(features.total_premium, 0) * 100;
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
                  const aggressiveSellRatio = parseNumber(features.nbbo_aggressive_sell_ratio, Number.NaN);
                  const aggressiveCoverage = parseNumber(features.nbbo_coverage_ratio, Number.NaN);
                  const insideRatio = parseNumber(features.nbbo_inside_ratio, Number.NaN);
                  const nbboAge = parseNumber(packet.join_quality.nbbo_age_ms, Number.NaN);
                  const nbboStale = parseNumber(packet.join_quality.nbbo_stale, 0) > 0;
                  const nbboMissing = parseNumber(packet.join_quality.nbbo_missing, 0) > 0;

                  return (
                    <div className="row" key={packet.id}>
                      <div>
                        <div className="contract">{contract}</div>
                        <div className="meta flow-meta">
                          <span>{formatFlowMetric(count)} prints</span>
                          <span>{formatFlowMetric(totalSize)} size</span>
                          <span>Notional {formatCompactUsd(notional)}</span>
                          {windowMs > 0 ? <span>{formatFlowMetric(windowMs, "ms")}</span> : null}
                          {structureType ? (
                            <span className="pill structure-tag">
                              {structureType.replace(/_/g, " ")}
                              {structureRights ? ` ${structureRights}` : ""}
                              {structureLegs > 0 ? ` ${structureLegs}L` : ""}
                              {structureStrikes > 0 ? ` ${structureStrikes}K` : ""}
                            </span>
                          ) : null}
                          {Number.isFinite(aggressiveCoverage) && aggressiveCoverage > 0 ? (
                            <span className="pill aggressor-tag">
                              Agg {formatPct(aggressiveBuyRatio)} / {formatPct(aggressiveSellRatio)}
                              {Number.isFinite(insideRatio) && insideRatio > 0 ? ` · In ${formatPct(insideRatio)}` : ""}
                              {` · ${formatPct(aggressiveCoverage)} cov`}
                            </span>
                          ) : null}
                          {Number.isFinite(nbboBid) && Number.isFinite(nbboAsk) ? (
                            <span>
                              NBBO ${formatPrice(nbboBid)} x ${formatPrice(nbboAsk)}
                            </span>
                          ) : null}
                          {Number.isFinite(nbboMid) ? <span>Mid ${formatPrice(nbboMid)}</span> : null}
                          {Number.isFinite(nbboSpread) ? <span>Spread ${formatPrice(nbboSpread)}</span> : null}
                          {Number.isFinite(nbboAge) ? <span>{Math.round(nbboAge)}ms</span> : null}
                          {nbboStale ? <span className="pill nbbo-stale">NBBO stale</span> : null}
                          {nbboMissing ? <span className="pill nbbo-missing">NBBO missing</span> : null}
                        </div>
                      </div>
                      <div className="time">
                        {formatTime(startTs)} → {formatTime(endTs)}
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderAlertsPanel = (className?: string, limit?: number, showStrip = true) => {
    const items = limit ? filteredAlerts.slice(0, limit) : filteredAlerts;

    return (
      <DeskPanel
        className={classNames("panel-signals", className)}
        label="Alerts"
        title="Scored alerts"
        subtitle="Explanations stay visible so the trader can judge the alert before reacting."
      >
        <div className="panel-stack">
          <div className="card-controls">
            <TapeStatus
              status={alerts.status}
              lastUpdate={alerts.lastUpdate}
              replayTime={alerts.replayTime}
              replayComplete={alerts.replayComplete}
              paused={alerts.paused}
              dropped={alerts.dropped}
              mode={mode}
              onTogglePause={alerts.togglePause}
            />
            <TapeControls isAtTop={alertsScroll.isAtTop} missed={alertsScroll.missed} onJump={alertsScroll.jumpToTop} />
          </div>
          {showStrip ? <AlertSeverityStrip alerts={filteredAlerts} referenceTimeMs={referenceTime} /> : null}
          <div className="list" ref={alertsScroll.listRef}>
            {items.length === 0
              ? emptyState(
                  "No alerts match the current focus filter.",
                  "No alerts yet. Start compute.",
                  "Replay queue empty. Ensure ClickHouse has data."
                )
              : items.map((alert) => {
                  const primary = alert.hits[0];
                  const direction = primary ? normalizeDirection(primary.direction) : "neutral";

                  return (
                    <button
                      className="row row-button"
                      key={`${alert.trace_id}-${alert.seq}`}
                      type="button"
                      onClick={() => {
                        setSelectedDarkEvent(null);
                        setSelectedClassifierHit(null);
                        setSelectedAlert(alert);
                      }}
                    >
                      <div>
                        <div className="contract">
                          {primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}
                        </div>
                        <div className="meta">
                          <span className={`pill severity-${alert.severity}`}>{alert.severity}</span>
                          <span>Score {Math.round(alert.score)}</span>
                          <span>{alert.hits.length} hits</span>
                          {primary ? <span className={`pill direction-${direction}`}>{direction}</span> : null}
                        </div>
                        {primary?.explanations?.[0] ? <div className="note">{primary.explanations[0]}</div> : null}
                      </div>
                      <div className="time">{formatTime(alert.source_ts)}</div>
                    </button>
                  );
                })}
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderClassifierPanel = (className?: string, limit?: number) => {
    const items = limit ? filteredClassifierHits.slice(0, limit) : filteredClassifierHits;

    return (
      <DeskPanel
        className={classNames("panel-signals", className)}
        label="Classifiers"
        title="Classifier hits"
        subtitle="Raw rule firings stay visible before alert scoring smooths them over."
      >
        <div className="panel-stack">
          <div className="card-controls">
            <TapeStatus
              status={classifierHits.status}
              lastUpdate={classifierHits.lastUpdate}
              replayTime={classifierHits.replayTime}
              replayComplete={classifierHits.replayComplete}
              paused={classifierHits.paused}
              dropped={classifierHits.dropped}
              mode={mode}
              onTogglePause={classifierHits.togglePause}
            />
            <TapeControls
              isAtTop={classifierScroll.isAtTop}
              missed={classifierScroll.missed}
              onJump={classifierScroll.jumpToTop}
            />
          </div>
          <div className="list" ref={classifierScroll.listRef}>
            {items.length === 0
              ? emptyState(
                  "No classifier hits match the current focus filter.",
                  "No classifier hits yet. Start compute.",
                  "Replay queue empty. Ensure ClickHouse has data."
                )
              : items.map((hit) => {
                  const direction = normalizeDirection(hit.direction);
                  return (
                    <button
                      className="row row-button"
                      key={`${hit.trace_id}-${hit.seq}`}
                      type="button"
                      onClick={() => openFromClassifierHit(hit)}
                    >
                      <div>
                        <div className="contract">{humanizeClassifierId(hit.classifier_id)}</div>
                        <div className="meta">
                          <span className={`pill direction-${direction}`}>{direction}</span>
                          <span>Confidence {formatConfidence(hit.confidence)}</span>
                        </div>
                        {hit.explanations?.[0] ? <div className="note">{hit.explanations[0]}</div> : null}
                      </div>
                      <div className="time">{formatTime(hit.source_ts)}</div>
                    </button>
                  );
                })}
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderDarkPanel = (className?: string, limit?: number) => {
    const items = limit ? filteredInferredDark.slice(0, limit) : filteredInferredDark;

    return (
      <DeskPanel
        className={classNames("panel-signals", className)}
        label="Dark"
        title="Inferred dark activity"
        subtitle="Derived liquidity events stay separate from facts, with evidence one click away."
      >
        <div className="panel-stack">
          <div className="card-controls">
            <TapeStatus
              status={inferredDark.status}
              lastUpdate={inferredDark.lastUpdate}
              replayTime={inferredDark.replayTime}
              replayComplete={inferredDark.replayComplete}
              paused={inferredDark.paused}
              dropped={inferredDark.dropped}
              mode={mode}
              onTogglePause={inferredDark.togglePause}
            />
            <TapeControls isAtTop={darkScroll.isAtTop} missed={darkScroll.missed} onJump={darkScroll.jumpToTop} />
          </div>
          <div className="list" ref={darkScroll.listRef}>
            {items.length === 0
              ? emptyState(
                  "No inferred dark events match the current focus filter.",
                  "No inferred dark events yet. Start compute.",
                  "Replay queue empty. Ensure ClickHouse has data."
                )
              : items.map((event) => {
                  const underlying = inferDarkUnderlying(event, equityPrintMap, equityJoinMap);
                  return (
                    <button
                      className="row row-button"
                      key={`${event.trace_id}-${event.seq}`}
                      type="button"
                      onClick={() => {
                        setSelectedAlert(null);
                        setSelectedClassifierHit(null);
                        setSelectedDarkEvent(event);
                      }}
                    >
                      <div>
                        <div className="contract">{humanizeClassifierId(event.type)}</div>
                        <div className="meta">
                          {underlying ? <span>{underlying}</span> : <span className="pill">Unknown</span>}
                          <span>Confidence {formatConfidence(event.confidence)}</span>
                          <span>Evidence {event.evidence_refs.length}</span>
                        </div>
                        {underlying ? null : <div className="note">Underlying not in the current equity cache.</div>}
                      </div>
                      <div className="time">{formatTime(event.source_ts)}</div>
                    </button>
                  );
                })}
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderPulsePanel = (className?: string) => {
    return (
      <DeskPanel
        className={classNames("panel-pulse", className)}
        label="Pulse"
        title="What matters now"
        subtitle="Front-loaded context for a trader deciding where to spend attention first."
      >
        <div className="panel-stack">
          <div className="metric-grid">
            {viewMetrics.map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </div>
          <div className="spotlight-stack">
            <div className="spotlight-card">
              <div className="spotlight-header">
                <span className="spotlight-label">Top alert</span>
                {headlineAlert ? <span className={`pill severity-${headlineAlert.severity}`}>{headlineAlert.severity}</span> : null}
              </div>
              {headlineAlert ? (
                <button
                  className="spotlight-button"
                  type="button"
                  onClick={() => {
                    setSelectedDarkEvent(null);
                    setSelectedClassifierHit(null);
                    setSelectedAlert(headlineAlert);
                  }}
                >
                  <strong>{humanizeClassifierId(headlineAlert.hits[0]?.classifier_id ?? "alert")}</strong>
                  <span>{headlineAlert.hits[0]?.explanations?.[0] ?? "Open the evidence stack."}</span>
                </button>
              ) : (
                <div className="spotlight-empty">No alert is in the queue yet for this view.</div>
              )}
            </div>
            <div className="spotlight-card">
              <div className="spotlight-header">
                <span className="spotlight-label">Secondary cue</span>
                {headlineDark ? <span className="drawer-chip">Dark</span> : headlineHit ? <span className="drawer-chip">Rule hit</span> : null}
              </div>
              {headlineDark ? (
                <button
                  className="spotlight-button"
                  type="button"
                  onClick={() => {
                    setSelectedAlert(null);
                    setSelectedClassifierHit(null);
                    setSelectedDarkEvent(headlineDark);
                  }}
                >
                  <strong>{humanizeClassifierId(headlineDark.type)}</strong>
                  <span>
                    {inferDarkUnderlying(headlineDark, equityPrintMap, equityJoinMap) ?? "Unknown"} · Confidence{" "}
                    {formatConfidence(headlineDark.confidence)}
                  </span>
                </button>
              ) : headlineHit ? (
                <button className="spotlight-button" type="button" onClick={() => openFromClassifierHit(headlineHit)}>
                  <strong>{humanizeClassifierId(headlineHit.classifier_id)}</strong>
                  <span>{headlineHit.explanations?.[0] ?? "Open the supporting evidence."}</span>
                </button>
              ) : (
                <div className="spotlight-empty">No secondary cue is available yet.</div>
              )}
            </div>
          </div>
        </div>
      </DeskPanel>
    );
  };

  const renderFocusPanel = (className?: string) => {
    return (
      <DeskPanel
        className={classNames("panel-focus", className)}
        label="Focus"
        title="Names in play"
        subtitle="Weighted by alert pressure, flow concentration, off-exchange activity, and tape recency."
      >
        <div className="focus-grid">
          {focusNames.length === 0 ? (
            <div className="spotlight-empty">No active names yet. Start ingest and compute services.</div>
          ) : (
            focusNames.map((entry) => (
              <button
                className={classNames(
                  "focus-chip",
                  tickerSet.has(entry.ticker) && "focus-chip-active",
                  entry.directionScore > 0 && "focus-chip-bullish",
                  entry.directionScore < 0 && "focus-chip-bearish"
                )}
                key={entry.ticker}
                type="button"
                onClick={() => focusTicker(entry.ticker)}
              >
                <span className="focus-symbol">{entry.ticker}</span>
                <span className="focus-meta">
                  {entry.alerts} alerts · {entry.flow} flow · {entry.dark} dark
                </span>
                <span className="focus-time">Updated {formatTime(entry.lastTs)}</span>
              </button>
            ))
          )}
        </div>
      </DeskPanel>
    );
  };

  const renderHealthPanel = (className?: string) => {
    return (
      <DeskPanel
        className={classNames("panel-health", className)}
        label="Health"
        title="Feed health"
        subtitle="A trader should always know whether the tape is fresh, paused, or dropping data."
      >
        <div className="health-grid">
          {pipelineHealth.map((pipeline) => (
            <div className="health-card" key={pipeline.label}>
              <div className="health-card-top">
                <span className={classNames("health-dot", `health-dot-${pipeline.status}`, pipeline.paused && "health-dot-paused")} />
                <strong>{pipeline.label}</strong>
              </div>
              <div className="health-card-meta">
                <span>{statusLabel(pipeline.status, pipeline.paused, mode)}</span>
                <span>{pipeline.lastUpdate ? `Updated ${formatTime(pipeline.lastUpdate)}` : "Waiting for data"}</span>
                <span>{formatCompactValue(pipeline.count)} cached</span>
                {pipeline.dropped > 0 ? <span>{pipeline.dropped} dropped while paused</span> : null}
              </div>
            </div>
          ))}
        </div>
      </DeskPanel>
    );
  };

  let viewContent: ReactNode;

  switch (view) {
    case "options-flow":
      viewContent = (
        <div className="view-grid view-grid-options">
          {renderChartPanel("panel-span-two")}
          {renderPulsePanel()}
          {renderOptionsPanel("panel-span-two")}
          {renderFlowPanel()}
          {renderClassifierPanel()}
          {renderAlertsPanel(undefined, 8, false)}
        </div>
      );
      break;
    case "signals":
      viewContent = (
        <div className="view-grid view-grid-signals">
          {renderPulsePanel("panel-span-two")}
          {renderHealthPanel()}
          {renderAlertsPanel("panel-span-two")}
          {renderClassifierPanel()}
          {renderChartPanel("panel-span-two")}
          {renderFlowPanel(undefined, 10)}
        </div>
      );
      break;
    case "off-exchange":
      viewContent = (
        <div className="view-grid view-grid-offexchange">
          {renderChartPanel("panel-span-two")}
          {renderPulsePanel()}
          {renderDarkPanel("panel-span-two")}
          {renderEquitiesPanel()}
          {renderHealthPanel()}
          {renderAlertsPanel(undefined, 8, false)}
        </div>
      );
      break;
    case "overview":
    default:
      viewContent = (
        <div className="view-grid view-grid-overview">
          {renderChartPanel("panel-span-two")}
          {renderPulsePanel()}
          {renderAlertsPanel()}
          {renderFlowPanel()}
          {renderDarkPanel()}
          {renderFocusPanel()}
          {renderHealthPanel()}
          {renderOptionsPanel("panel-span-two", 12)}
          {renderClassifierPanel(undefined, 10)}
        </div>
      );
      break;
  }

  return (
    <main className="terminal-shell">
      <aside className="terminal-rail">
        <div className="terminal-brand">
          <span className="terminal-mark">Islandflow</span>
          <p className="terminal-tag">Realtime options flow and off-exchange analysis for focused single-user research.</p>
        </div>
        <nav className="rail-nav" aria-label="Workspace views">
          {Object.values(VIEW_DEFINITIONS).map((definition) => (
            <Link
              key={definition.href}
              className={classNames("rail-link", definition.href === currentView.href && "rail-link-active")}
              href={definition.href}
            >
              <span className="rail-link-label">{definition.label}</span>
              <span className="rail-link-copy">{definition.kicker}</span>
            </Link>
          ))}
        </nav>
        <div className="rail-summary">
          <span className="rail-summary-label">Desk state</span>
          <strong>{mode === "live" ? "Live session" : "Replay session"}</strong>
          <span>{lastSeen ? `Last update ${formatTime(lastSeen)}` : "Waiting for data"}</span>
          <span>{activeTickers.length > 0 ? `Focused on ${activeTickers.join(", ")}` : "Watching the whole tape"}</span>
        </div>
      </aside>

      <section className="terminal-main">
        <header className="desk-header">
          <div className="desk-header-copy">
            <span className="desk-kicker">{currentView.kicker}</span>
            <h1>{currentView.title}</h1>
            <p>{currentView.description}</p>
          </div>
          <div className="desk-session">
            <div className="session-card">
              <span className="session-label">Mode</span>
              <strong>{mode === "live" ? "Live feed" : "Replay"}</strong>
              <span>{mode === "replay" && replaySource ? `Source ${replaySource}` : "Shared filters persist across views"}</span>
            </div>
            <div className="session-card">
              <span className="session-label">Clock</span>
              <strong>{formatDateTime(referenceTime)}</strong>
              <span>{lastSeen ? `UI update ${formatTime(lastSeen)}` : "Waiting for first event"}</span>
            </div>
          </div>
        </header>

        <section className="command-strip">
          <div className="command-primary">
            <label className="filter-block">
              <span className="filter-label">Focus tickers</span>
              <input
                className="filter-input"
                value={filterInput}
                onChange={(event) => setFilterInput(event.target.value)}
                placeholder="SPY, NVDA, AAPL"
              />
            </label>
            <button
              className="filter-clear"
              type="button"
              onClick={clearTickerFilter}
              disabled={filterInput.trim().length === 0}
            >
              Clear focus
            </button>
            <button className="mode-button" type="button" onClick={toggleMode}>
              Switch to {mode === "live" ? "Replay" : "Live"}
            </button>
          </div>
          <div className="command-secondary">
            <span className="command-caption">
              {activeTickers.length > 0 ? `Filtering ${activeTickers.join(", ")}` : "All tickers in view"}
            </span>
            <div className="command-focus-list">
              {focusNames.slice(0, 6).map((entry) => (
                <button
                  className={classNames("focus-pill", tickerSet.has(entry.ticker) && "focus-pill-active")}
                  key={entry.ticker}
                  type="button"
                  onClick={() => focusTicker(entry.ticker)}
                >
                  {entry.ticker}
                </button>
              ))}
            </div>
          </div>
        </section>

        {viewContent}
      </section>

      {selectedAlert ? (
        <AlertDrawer
          alert={selectedAlert}
          flowPacket={selectedFlowPacket}
          evidence={selectedEvidence}
          onClose={() => setSelectedAlert(null)}
        />
      ) : null}

      {selectedClassifierHit ? (
        <ClassifierHitDrawer
          hit={selectedClassifierHit}
          flowPacket={selectedClassifierFlowPacket}
          evidence={selectedClassifierEvidence}
          onClose={() => setSelectedClassifierHit(null)}
        />
      ) : null}

      {selectedDarkEvent ? (
        <DarkDrawer
          event={selectedDarkEvent}
          evidence={selectedDarkEvidence}
          underlying={selectedDarkUnderlying}
          onClose={() => setSelectedDarkEvent(null)}
        />
      ) : null}
    </main>
  );
}
