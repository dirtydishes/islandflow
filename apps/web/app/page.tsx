"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AlertEvent,
  ClassifierHitEvent,
  EquityPrint,
  FlowPacket,
  OptionNBBO,
  OptionPrint
} from "@islandflow/types";

const MAX_ITEMS = 500;
const NBBO_MAX_AGE_MS = Number(process.env.NEXT_PUBLIC_NBBO_MAX_AGE_MS);
const NBBO_MAX_AGE_MS_SAFE =
  Number.isFinite(NBBO_MAX_AGE_MS) && NBBO_MAX_AGE_MS > 0 ? NBBO_MAX_AGE_MS : 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type WsStatus = "connecting" | "connected" | "disconnected";

type TapeMode = "live" | "replay";

type MessageType =
  | "option-print"
  | "option-nbbo"
  | "equity-print"
  | "flow-packet"
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
  return price.toFixed(2);
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
};

const useTape = <T extends { ts: number; seq: number }>(
  config: TapeConfig<T>
): TapeState<T> => {
  const { mode, wsPath, replayPath, expectedType, latestPath, onNewItems, captureScroll } = config;
  const batchSize = config.batchSize ?? 40;
  const pollMs = config.pollMs ?? 1000;
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
    emptyPollsRef.current = 0;
    setDropped(0);
    setStatus("connecting");
    cursorRef.current = { ts: 0, seq: 0 };
    pendingRef.current = [];
    pendingCountRef.current = 0;
    cancelFlush();
  }, [mode, cancelFlush]);

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
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Replay baseline failed with ${response.status}`);
        }

        const payload = (await response.json()) as { data?: T[] };
        const latest = payload.data?.[0];
        if (active && latest) {
          replayEndRef.current = latest.ts;
        }
      } catch (error) {
        console.warn("Failed to load replay end cursor", error);
      }
    };

    void fetchReplayEnd();

    return () => {
      active = false;
    };
  }, [mode, latestPath]);

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

          const response = await fetch(url.toString());
          if (!response.ok) {
            throw new Error(`Replay request failed with ${response.status}`);
          }

          const payload = (await response.json()) as ReplayResponse<T>;

          let sourcePrefix = replaySourceRef.current;
          if (!sourcePrefix) {
            const firstWithTrace = payload.data.find((item) => extractTracePrefix(item));
            if (firstWithTrace) {
              sourcePrefix = extractTracePrefix(firstWithTrace);
              replaySourceRef.current = sourcePrefix ?? null;
            }
          }

          const filtered = sourcePrefix
            ? payload.data.filter((item) => extractTracePrefix(item) === sourcePrefix)
            : payload.data;

          const hasForeign =
            sourcePrefix &&
            payload.data.some((item) => {
              const prefix = extractTracePrefix(item);
              return prefix !== null && prefix !== sourcePrefix;
            });

          if (filtered.length > 0) {
            const nextItems = [...filtered].reverse();
            pendingRef.current.push(...nextItems);
            pendingCountRef.current += nextItems.length;
            scheduleFlush();
            const last = filtered.at(-1);
            if (last) {
              setReplayTime(last.ts);
              if (replayEnd !== null && last.ts >= replayEnd) {
                cursorRef.current = { ts: last.ts, seq: last.seq };
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

          if (hasForeign) {
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
  }, [mode, replayPath, batchSize, pollMs, scheduleFlush, cancelFlush]);

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

type AlertSeverityStripProps = {
  alerts: AlertEvent[];
};

const AlertSeverityStrip = ({ alerts }: AlertSeverityStripProps) => {
  const windowMs = 30 * 60 * 1000;
  const now = Date.now();
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

const formatFlowMetric = (value: number, suffix?: string): string => {
  if (suffix) {
    return `${value}${suffix}`;
  }

  return value.toLocaleString();
};

export default function HomePage() {
  const [mode, setMode] = useState<TapeMode>("live");
  const [selectedAlert, setSelectedAlert] = useState<AlertEvent | null>(null);
  const [filterInput, setFilterInput] = useState<string>("");
  const optionsScroll = useListScroll();
  const equitiesScroll = useListScroll();
  const flowScroll = useListScroll();
  const alertsScroll = useListScroll();
  const classifierScroll = useListScroll();

  const optionsAnchor = useScrollAnchor(optionsScroll.listRef, optionsScroll.isAtTopRef);
  const equitiesAnchor = useScrollAnchor(equitiesScroll.listRef, equitiesScroll.isAtTopRef);
  const flowAnchor = useScrollAnchor(flowScroll.listRef, flowScroll.isAtTopRef);
  const alertsAnchor = useScrollAnchor(alertsScroll.listRef, alertsScroll.isAtTopRef);
  const classifierAnchor = useScrollAnchor(
    classifierScroll.listRef,
    classifierScroll.isAtTopRef
  );

  const options = useTape<OptionPrint>({
    mode,
    wsPath: "/ws/options",
    replayPath: "/replay/options",
    latestPath: "/prints/options",
    expectedType: "option-print",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: optionsAnchor.capture,
    onNewItems: optionsScroll.onNewItems
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

  const nbbo = useTape<OptionNBBO>({
    mode,
    wsPath: "/ws/options-nbbo",
    replayPath: "/replay/nbbo",
    latestPath: "/nbbo/options",
    expectedType: "option-nbbo",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined
  });

  const flowHold = useCallback(() => !flowScroll.isAtTopRef.current, [flowScroll.isAtTopRef]);
  const flow = useFlowStream(
    mode === "live",
    flowScroll.onNewItems,
    flowAnchor.capture,
    flowHold,
    flowScroll.resumeTick
  );
  const alerts = useLiveStream<AlertEvent>({
    enabled: mode === "live",
    wsPath: "/ws/alerts",
    expectedType: "alert",
    onNewItems: alertsScroll.onNewItems,
    captureScroll: alertsAnchor.capture
  });
  const classifierHits = useLiveStream<ClassifierHitEvent>({
    enabled: mode === "live",
    wsPath: "/ws/classifier-hits",
    expectedType: "classifier-hit",
    onNewItems: classifierScroll.onNewItems,
    captureScroll: classifierAnchor.capture
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
    alertsAnchor.apply();
  }, [alerts.items, alertsAnchor.apply]);

  useLayoutEffect(() => {
    classifierAnchor.apply();
  }, [classifierHits.items, classifierAnchor.apply]);

  const activeTickers = useMemo(() => {
    const parts = filterInput
      .split(/[,\s]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    return Array.from(new Set(parts));
  }, [filterInput]);

  const tickerSet = useMemo(() => new Set(activeTickers), [activeTickers]);

  const nbboMap = useMemo(() => {
    const map = new Map<string, OptionNBBO>();
    for (const quote of nbbo.items) {
      const existing = map.get(quote.option_contract_id);
      if (
        !existing ||
        quote.ts > existing.ts ||
        (quote.ts === existing.ts && quote.seq >= existing.seq)
      ) {
        map.set(quote.option_contract_id, quote);
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

  useEffect(() => {
    if (mode !== "live") {
      setSelectedAlert(null);
    }
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
      matchesTicker(extractUnderlying(print.option_contract_id))
    );
  }, [options.items, matchesTicker, tickerSet]);

  const filteredEquities = useMemo(() => {
    if (tickerSet.size === 0) {
      return equities.items;
    }
    return equities.items.filter((print) => matchesTicker(print.underlying_id));
  }, [equities.items, matchesTicker, tickerSet]);

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

  const lastSeen = useMemo(() => {
    return [
      options.lastUpdate,
      equities.lastUpdate,
      flow.lastUpdate,
      alerts.lastUpdate,
      classifierHits.lastUpdate
    ]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [
    options.lastUpdate,
    equities.lastUpdate,
    flow.lastUpdate,
    alerts.lastUpdate,
    classifierHits.lastUpdate
  ]);

  const toggleMode = () => {
    setMode((prev) => (prev === "live" ? "replay" : "live"));
  };

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <p className="eyebrow">Realtime flow workspace</p>
          <h1>Islandflow</h1>
          <p className="subtitle">
            Options + equities streaming over WebSocket or replayed from ClickHouse.
          </p>
        </div>
        <div className="summary">
          <span className="summary-title">Last update</span>
          <span className="summary-value">
            {lastSeen ? formatTime(lastSeen) : "Waiting for data"}
          </span>
          <button className="mode-button" type="button" onClick={toggleMode}>
            Switch to {mode === "live" ? "Replay" : "Live"}
          </button>
        </div>
      </header>

      <div className="filter-bar">
        <div>
          <p className="filter-label">Ticker filter</p>
          <p className="filter-help">
            {activeTickers.length > 0 ? `Filtering ${activeTickers.join(", ")}` : "All tickers"}
          </p>
        </div>
        <div className="filter-controls">
          <input
            className="filter-input"
            value={filterInput}
            onChange={(event) => setFilterInput(event.target.value)}
            placeholder="SPY, NVDA, AAPL"
          />
          <button
            className="filter-clear"
            type="button"
            onClick={() => setFilterInput("")}
            disabled={filterInput.trim().length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="cards">
        <section className="card card-options">
          <div className="card-header">
            <div>
              <h2>Options Tape</h2>
              <p className="card-subtitle">Newest prints first (max {MAX_ITEMS}).</p>
            </div>
          </div>
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
            {filteredOptions.length === 0 ? (
              <div className="empty">
                {tickerSet.size > 0
                  ? "No option prints match the current filter."
                  : mode === "live"
                    ? "No option prints yet. Start ingest-options."
                    : "Replay queue empty. Ensure ClickHouse has data."}
              </div>
            ) : (
              filteredOptions.map((print) => {
                const quote = nbboMap.get(print.option_contract_id);
                const nbboAge = quote ? Math.abs(print.ts - quote.ts) : null;
                const nbboStale = nbboAge !== null && nbboAge > NBBO_MAX_AGE_MS_SAFE;
                const nbboMid = quote ? (quote.bid + quote.ask) / 2 : null;
                const nbboSide = classifyNbboSide(print.price, quote);

                return (
                  <div className="row" key={`${print.trace_id}-${print.seq}`}>
                    <div>
                      <div className="contract">{print.option_contract_id}</div>
                      <div className="meta">
                        <span>${formatPrice(print.price)}</span>
                        <span>{formatSize(print.size)}x</span>
                        <span>{print.exchange}</span>
                        {print.conditions?.length ? (
                          <span>{print.conditions.join(", ")}</span>
                        ) : null}
                      </div>
                      {quote ? (
                        <div className="meta nbbo-meta">
                          <span>Bid ${formatPrice(quote.bid)}</span>
                          <span>Ask ${formatPrice(quote.ask)}</span>
                          <span>Mid ${formatPrice(nbboMid ?? 0)}</span>
                          <span>{Math.round(nbboAge ?? 0)}ms</span>
                          {nbboSide ? (
                            <span className="nbbo-side" tabIndex={0} aria-label="NBBO side legend">
                              <span className={`nbbo-tag nbbo-tag-${nbboSide.toLowerCase()}`}>
                                {nbboSide}
                              </span>
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
              })
            )}
          </div>
        </section>

        <section className="card card-equities">
          <div className="card-header">
            <div>
              <h2>Equities Tape</h2>
              <p className="card-subtitle">Off-exchange flag highlighted.</p>
            </div>
          </div>
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
            {filteredEquities.length === 0 ? (
              <div className="empty">
                {tickerSet.size > 0
                  ? "No equity prints match the current filter."
                  : mode === "live"
                    ? "No equity prints yet. Start ingest-equities."
                    : "Replay queue empty. Ensure ClickHouse has data."}
              </div>
            ) : (
              filteredEquities.map((print) => (
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
              ))
            )}
          </div>
        </section>

        <section className="card card-flow">
          <div className="card-header">
            <div>
              <h2>Flow Packets</h2>
              <p className="card-subtitle">Deterministic clusters (live only).</p>
            </div>
          </div>
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
            <TapeControls
              isAtTop={flowScroll.isAtTop}
              missed={flowScroll.missed}
              onJump={flowScroll.jumpToTop}
            />
          </div>

          <div className="card-body">
            <div className="list" ref={flowScroll.listRef}>
              {mode !== "live" ? (
                <div className="empty">Flow packets are live-only in this build.</div>
              ) : filteredFlow.length === 0 ? (
                <div className="empty">
                  {tickerSet.size > 0
                    ? "No flow packets match the current filter."
                    : "No flow packets yet. Start compute."}
                </div>
              ) : (
                filteredFlow.map((packet) => {
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
                const aggressiveBuyRatio = parseNumber(
                  features.nbbo_aggressive_buy_ratio,
                  Number.NaN
                );
                const aggressiveSellRatio = parseNumber(
                  features.nbbo_aggressive_sell_ratio,
                  Number.NaN
                );
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
                        <span>Notional ${formatUsd(notional)}</span>
                        {windowMs > 0 ? (
                          <span>{formatFlowMetric(windowMs, "ms")}</span>
                        ) : null}
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
                            {Number.isFinite(insideRatio) && insideRatio > 0
                              ? ` · In ${formatPct(insideRatio)}`
                              : ""}
                            {` · ${formatPct(aggressiveCoverage)} cov`}
                          </span>
                        ) : null}
                        {Number.isFinite(nbboBid) && Number.isFinite(nbboAsk) ? (
                          <span>
                            NBBO ${formatPrice(nbboBid)} x ${formatPrice(nbboAsk)}
                          </span>
                        ) : null}
                        {Number.isFinite(nbboMid) ? (
                          <span>Mid ${formatPrice(nbboMid)}</span>
                        ) : null}
                        {Number.isFinite(nbboSpread) ? (
                          <span>Spread ${formatPrice(nbboSpread)}</span>
                        ) : null}
                        {Number.isFinite(nbboAge) ? (
                          <span>{Math.round(nbboAge)}ms</span>
                        ) : null}
                        {nbboStale ? <span className="pill nbbo-stale">NBBO stale</span> : null}
                        {nbboMissing ? (
                          <span className="pill nbbo-missing">NBBO missing</span>
                        ) : null}
                      </div>
                    </div>
                      <div className="time">
                        {formatTime(startTs)} → {formatTime(endTs)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="card card-alerts">
          <div className="card-header">
            <div>
              <h2>Alerts</h2>
              <p className="card-subtitle">Rule-based scoring from flow packets.</p>
            </div>
          </div>
          <div className="card-controls">
            <TapeStatus
              status={alerts.status}
              lastUpdate={alerts.lastUpdate}
              replayTime={alerts.replayTime}
              replayComplete={alerts.replayComplete}
              paused={alerts.paused}
              dropped={alerts.dropped}
              mode="live"
              onTogglePause={alerts.togglePause}
            />
            <TapeControls
              isAtTop={alertsScroll.isAtTop}
              missed={alertsScroll.missed}
              onJump={alertsScroll.jumpToTop}
            />
          </div>

          <div className="card-body">
            <AlertSeverityStrip alerts={filteredAlerts} />
            <div className="list" ref={alertsScroll.listRef}>
              {mode !== "live" ? (
                <div className="empty">Alerts are live-only in this build.</div>
              ) : filteredAlerts.length === 0 ? (
                <div className="empty">
                  {tickerSet.size > 0
                    ? "No alerts match the current filter."
                    : "No alerts yet. Start compute."}
                </div>
              ) : (
                filteredAlerts.map((alert) => {
                  const primary = alert.hits[0];
                  const direction = primary ? normalizeDirection(primary.direction) : "neutral";

                  return (
                    <button
                      className="row row-button"
                      key={`${alert.trace_id}-${alert.seq}`}
                      type="button"
                      onClick={() => setSelectedAlert(alert)}
                    >
                      <div>
                        <div className="contract">
                          {primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}
                        </div>
                        <div className="meta">
                          <span className={`pill severity-${alert.severity}`}>{alert.severity}</span>
                          <span>Score {Math.round(alert.score)}</span>
                          <span>{alert.hits.length} hits</span>
                          {primary ? (
                            <span className={`pill direction-${direction}`}>{direction}</span>
                          ) : null}
                        </div>
                        {primary?.explanations?.[0] ? (
                          <div className="note">{primary.explanations[0]}</div>
                        ) : null}
                      </div>
                      <div className="time">{formatTime(alert.source_ts)}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="card card-classifiers">
          <div className="card-header">
            <div>
              <h2>Classifier Hits</h2>
              <p className="card-subtitle">Raw rule hits before alert scoring.</p>
            </div>
          </div>
          <div className="card-controls">
            <TapeStatus
              status={classifierHits.status}
              lastUpdate={classifierHits.lastUpdate}
              replayTime={classifierHits.replayTime}
              replayComplete={classifierHits.replayComplete}
              paused={classifierHits.paused}
              dropped={classifierHits.dropped}
              mode="live"
              onTogglePause={classifierHits.togglePause}
            />
            <TapeControls
              isAtTop={classifierScroll.isAtTop}
              missed={classifierScroll.missed}
              onJump={classifierScroll.jumpToTop}
            />
          </div>

          <div className="card-body">
            <div className="list" ref={classifierScroll.listRef}>
              {mode !== "live" ? (
                <div className="empty">Classifier hits are live-only in this build.</div>
              ) : filteredClassifierHits.length === 0 ? (
                <div className="empty">
                  {tickerSet.size > 0
                    ? "No classifier hits match the current filter."
                    : "No classifier hits yet. Start compute."}
                </div>
              ) : (
                filteredClassifierHits.map((hit) => {
                  const direction = normalizeDirection(hit.direction);
                  return (
                    <div className="row" key={`${hit.trace_id}-${hit.seq}`}>
                      <div>
                        <div className="contract">{humanizeClassifierId(hit.classifier_id)}</div>
                        <div className="meta">
                          <span className={`pill direction-${direction}`}>{direction}</span>
                          <span>Confidence {formatConfidence(hit.confidence)}</span>
                        </div>
                        {hit.explanations?.[0] ? (
                          <div className="note">{hit.explanations[0]}</div>
                        ) : null}
                      </div>
                      <div className="time">{formatTime(hit.source_ts)}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {selectedAlert ? (
        <AlertDrawer
          alert={selectedAlert}
          flowPacket={selectedFlowPacket}
          evidence={selectedEvidence}
          onClose={() => setSelectedAlert(null)}
        />
      ) : null}
    </main>
  );
}
