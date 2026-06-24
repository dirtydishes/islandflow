import type {
  AlertEvent,
  ClassifierHitEvent,
  Cursor,
  DurableTapeRowViewModel,
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  EquityQuote,
  FlowPacket,
  InferredDarkEvent,
  LiveHotChannelHealthMap,
  LiveServerMessage,
  LiveSubscription,
  NewsStory,
  OptionNBBO,
  OptionPrint,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveWindowBuffer } from "../durable-tape";
import {
  LIVE_HISTORY_BATCH,
  LIVE_HISTORY_SOFT_CAP,
  LIVE_HOT_WINDOW,
  LIVE_OPTIONS_HEAD_LIMIT,
  LIVE_SESSION_HOT_CHANNELS,
  LIVE_SESSION_IDLE_CHECK_MS,
  LIVE_SESSION_IDLE_RECONNECT_MS
} from "./config";
import { appendOptionFlowFilters, shouldRetainLiveSnapshotHistory } from "./filters";
import { appendLiveScopeParams } from "./routes";
import {
  appendHistoryTail,
  composeTapeItems,
  createLiveWindowBuffer,
  EMPTY_PAUSABLE_TAPE,
  extractSortTs,
  flushPausableTapeData,
  getLiveHistoryRetentionCap,
  incrementRetentionMetric,
  mergeHeldTapeHistory,
  mergeNewest,
  projectPausableTapeState,
  reducePausableTapeData
} from "./tape";
import {
  buildApiUrl,
  buildWsUrl,
  extractTracePrefix,
  type MessageType,
  type ReplayCursor,
  type ReplayResponse,
  readErrorDetail,
  type StreamMessage
} from "./transport";
import type { PausableTapeData, SortableItem, TapeMode, WsStatus } from "./types";

const sendLiveSubscribeRequest = (
  socket: WebSocket,
  subscriptions: LiveSubscription[]
): void => {
  const rawSubscriptions = subscriptions.filter(
    (subscription) => subscription.channel !== "durable-rows"
  );
  const durableRowSubscriptions = subscriptions.filter(
    (subscription) => subscription.channel === "durable-rows"
  );

  if (rawSubscriptions.length > 0) {
    socket.send(JSON.stringify({ op: "subscribe", subscriptions: rawSubscriptions }));
  }
  for (const durableRowSubscription of durableRowSubscriptions) {
    socket.send(JSON.stringify({ op: "subscribe", subscriptions: [durableRowSubscription] }));
  }
};

export type TapeState<T> = {
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

export type TapeConfig<T> = {
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

export const useTape = <T extends SortableItem & { seq: number }>(
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
  }, [mode, wsPath, expectedType, scheduleFlush, cancelFlush, config.liveEnabled]);

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

export const toStaticTapeState = <T>(
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

export type PausableTapeViewConfig<T extends SortableItem & { seq: number }> = {
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

export const usePausableTapeView = <T extends SortableItem & { seq: number }>(
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

export const useLiveStream = <T extends SortableItem>(config: {
  enabled: boolean;
  wsPath: string;
  expectedType: MessageType;
  onNewItems?: (count: number) => void;
  captureScroll?: () => void;
  shouldHold?: () => boolean;
  resumeSignal?: number;
}): TapeState<T> => {
  const [status, setStatus] = useState<WsStatus>(config.enabled ? "connecting" : "disconnected");
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

      const nextBatch = holdRef.current.length > 0 ? [...holdRef.current, ...buffered] : buffered;
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

export const useFlowStream = (
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

export type LiveSessionState = {
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
  smartFlowHistory: SmartFlowExplainabilityProjection[];
  smartMoneyHistory: SmartMoneyEvent[];
  classifierHitsHistory: ClassifierHitEvent[];
  alertsHistory: AlertEvent[];
  durableRowsHistory: DurableTapeRowViewModel[];
  newsHistory: NewsStory[];
  inferredDarkHistory: InferredDarkEvent[];
  options: OptionPrint[];
  nbbo: OptionNBBO[];
  equities: EquityPrint[];
  equityQuotes: EquityQuote[];
  equityJoins: EquityPrintJoin[];
  flow: FlowPacket[];
  smartFlow: SmartFlowExplainabilityProjection[];
  smartMoney: SmartMoneyEvent[];
  classifierHits: ClassifierHitEvent[];
  alerts: AlertEvent[];
  durableRows: DurableTapeRowViewModel[];
  news: NewsStory[];
  inferredDark: InferredDarkEvent[];
  chartCandles: EquityCandle[];
  chartOverlay: EquityPrint[];
};

export type LiveHistoryResponse<T> = {
  data: T[];
  next_before: Cursor | null;
};

export const LIVE_HISTORY_ENDPOINTS: Partial<Record<LiveSubscription["channel"], string>> = {
  options: "/history/options",
  nbbo: "/history/nbbo",
  equities: "/history/equities",
  "equity-quotes": "/history/equity-quotes",
  "equity-joins": "/history/equity-joins",
  flow: "/history/flow",
  "smart-flow": "/history/smart-flow",
  "smart-money": "/history/smart-money",
  "classifier-hits": "/history/classifier-hits",
  alerts: "/history/alerts",
  news: "/history/news",
  "inferred-dark": "/history/inferred-dark"
};

type LiveSubscriptionResetChannel =
  | "options"
  | "equities"
  | "durable-rows"
  | "equity-candles"
  | "equity-overlay";

type PendingLiveEventBatch = {
  subscription: LiveSubscription;
  items: unknown[];
  updateAt: number;
};

export const getLiveSubscriptionResetChannels = (
  currentSubscriptions: Iterable<LiveSubscription>,
  nextSubscriptions: LiveSubscription[]
): Set<LiveSubscriptionResetChannel> => {
  const currentMap = new Map(
    Array.from(currentSubscriptions, (subscription) => [
      getLiveSubscriptionKey(subscription),
      subscription
    ])
  );
  const nextMap = new Map(
    nextSubscriptions.map((subscription) => [getLiveSubscriptionKey(subscription), subscription])
  );
  const nextKeys = new Set(nextMap.keys());
  const currentKeys = new Set(currentMap.keys());
  const changedSubscriptions = [
    ...Array.from(currentKeys)
      .filter((key) => !nextKeys.has(key))
      .map((key) => currentMap.get(key) ?? null),
    ...Array.from(nextKeys)
      .filter((key) => !currentKeys.has(key))
      .map((key) => nextMap.get(key) ?? null)
  ].filter((subscription): subscription is LiveSubscription => subscription !== null);

  const resetChannels = new Set<LiveSubscriptionResetChannel>();
  for (const subscription of changedSubscriptions) {
    if (
      subscription.channel === "options" ||
      subscription.channel === "equities" ||
      subscription.channel === "durable-rows" ||
      subscription.channel === "equity-candles" ||
      subscription.channel === "equity-overlay"
    ) {
      resetChannels.add(subscription.channel);
    }
  }
  return resetChannels;
};

export const useLiveSession = (
  enabled: boolean,
  _pathname: string,
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
  const [smartFlow, setSmartFlow] = useState<SmartFlowExplainabilityProjection[]>([]);
  const [smartMoney, setSmartMoney] = useState<SmartMoneyEvent[]>([]);
  const [classifierHits, setClassifierHits] = useState<ClassifierHitEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [durableRows, setDurableRows] = useState<DurableTapeRowViewModel[]>([]);
  const [news, setNews] = useState<NewsStory[]>([]);
  const [inferredDark, setInferredDark] = useState<InferredDarkEvent[]>([]);
  const [optionsHistory, setOptionsHistory] = useState<OptionPrint[]>([]);
  const [nbboHistory, setNbboHistory] = useState<OptionNBBO[]>([]);
  const [equitiesHistory, setEquitiesHistory] = useState<EquityPrint[]>([]);
  const [equityJoinsHistory, setEquityJoinsHistory] = useState<EquityPrintJoin[]>([]);
  const [flowHistory, setFlowHistory] = useState<FlowPacket[]>([]);
  const [smartFlowHistory, setSmartFlowHistory] = useState<SmartFlowExplainabilityProjection[]>([]);
  const [smartMoneyHistory, setSmartMoneyHistory] = useState<SmartMoneyEvent[]>([]);
  const [classifierHitsHistory, setClassifierHitsHistory] = useState<ClassifierHitEvent[]>([]);
  const [alertsHistory, setAlertsHistory] = useState<AlertEvent[]>([]);
  const [durableRowsHistory, setDurableRowsHistory] = useState<DurableTapeRowViewModel[]>([]);
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
  const smartFlowRef = useRef<SmartFlowExplainabilityProjection[]>([]);
  const smartMoneyRef = useRef<SmartMoneyEvent[]>([]);
  const classifierHitsRef = useRef<ClassifierHitEvent[]>([]);
  const alertsRef = useRef<AlertEvent[]>([]);
  const durableRowsRef = useRef<DurableTapeRowViewModel[]>([]);
  const newsRef = useRef<NewsStory[]>([]);
  const inferredDarkRef = useRef<InferredDarkEvent[]>([]);
  const chartCandlesRef = useRef<EquityCandle[]>([]);
  const chartOverlayRef = useRef<EquityPrint[]>([]);
  const liveBuffersRef = useRef<{
    options: LiveWindowBuffer<OptionPrint>;
    nbbo: LiveWindowBuffer<OptionNBBO>;
    equities: LiveWindowBuffer<EquityPrint>;
    equityQuotes: LiveWindowBuffer<EquityQuote>;
    equityJoins: LiveWindowBuffer<EquityPrintJoin>;
    flow: LiveWindowBuffer<FlowPacket>;
    smartFlow: LiveWindowBuffer<SmartFlowExplainabilityProjection>;
    smartMoney: LiveWindowBuffer<SmartMoneyEvent>;
    classifierHits: LiveWindowBuffer<ClassifierHitEvent>;
    alerts: LiveWindowBuffer<AlertEvent>;
    durableRows: LiveWindowBuffer<DurableTapeRowViewModel>;
    news: LiveWindowBuffer<NewsStory>;
    inferredDark: LiveWindowBuffer<InferredDarkEvent>;
    chartCandles: LiveWindowBuffer<EquityCandle>;
    chartOverlay: LiveWindowBuffer<EquityPrint>;
  } | null>(null);
  const optionsHistoryRef = useRef<OptionPrint[]>([]);
  const nbboHistoryRef = useRef<OptionNBBO[]>([]);
  const equitiesHistoryRef = useRef<EquityPrint[]>([]);
  const equityJoinsHistoryRef = useRef<EquityPrintJoin[]>([]);
  const flowHistoryRef = useRef<FlowPacket[]>([]);
  const smartFlowHistoryRef = useRef<SmartFlowExplainabilityProjection[]>([]);
  const smartMoneyHistoryRef = useRef<SmartMoneyEvent[]>([]);
  const classifierHitsHistoryRef = useRef<ClassifierHitEvent[]>([]);
  const alertsHistoryRef = useRef<AlertEvent[]>([]);
  const durableRowsHistoryRef = useRef<DurableTapeRowViewModel[]>([]);
  const newsHistoryRef = useRef<NewsStory[]>([]);
  const inferredDarkHistoryRef = useRef<InferredDarkEvent[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const idleWatchdogRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const lastEventAtRef = useRef<number | null>(null);
  const subscribedKeysRef = useRef<Set<string>>(new Set());
  const subscribedMapRef = useRef<Map<string, LiveSubscription>>(new Map());
  const pendingEventBatchesRef = useRef<Map<string, PendingLiveEventBatch>>(new Map());
  const eventFlushHandleRef = useRef<number | null>(null);
  if (liveBuffersRef.current === null) {
    const onTrim = (evicted: number) => incrementRetentionMetric("hotWindowEvictions", evicted);
    liveBuffersRef.current = {
      options: createLiveWindowBuffer<OptionPrint>({ limit: LIVE_OPTIONS_HEAD_LIMIT, onTrim }),
      nbbo: createLiveWindowBuffer<OptionNBBO>({ limit: LIVE_HOT_WINDOW, onTrim }),
      equities: createLiveWindowBuffer<EquityPrint>({ limit: LIVE_HOT_WINDOW, onTrim }),
      equityQuotes: createLiveWindowBuffer<EquityQuote>({ limit: LIVE_HOT_WINDOW, onTrim }),
      equityJoins: createLiveWindowBuffer<EquityPrintJoin>({ limit: LIVE_HOT_WINDOW, onTrim }),
      flow: createLiveWindowBuffer<FlowPacket>({ limit: LIVE_HOT_WINDOW, onTrim }),
      smartFlow: createLiveWindowBuffer<SmartFlowExplainabilityProjection>({
        limit: LIVE_HOT_WINDOW,
        onTrim
      }),
      smartMoney: createLiveWindowBuffer<SmartMoneyEvent>({ limit: LIVE_HOT_WINDOW, onTrim }),
      classifierHits: createLiveWindowBuffer<ClassifierHitEvent>({
        limit: LIVE_HOT_WINDOW,
        onTrim
      }),
      alerts: createLiveWindowBuffer<AlertEvent>({ limit: LIVE_HOT_WINDOW, onTrim }),
      durableRows: createLiveWindowBuffer<DurableTapeRowViewModel>({
        limit: LIVE_OPTIONS_HEAD_LIMIT,
        onTrim
      }),
      news: createLiveWindowBuffer<NewsStory>({ limit: LIVE_OPTIONS_HEAD_LIMIT, onTrim }),
      inferredDark: createLiveWindowBuffer<InferredDarkEvent>({ limit: LIVE_HOT_WINDOW, onTrim }),
      chartCandles: createLiveWindowBuffer<EquityCandle>({ limit: LIVE_HOT_WINDOW, onTrim }),
      chartOverlay: createLiveWindowBuffer<EquityPrint>({ limit: LIVE_HOT_WINDOW, onTrim })
    };
  }
  const liveBuffers = liveBuffersRef.current;
  const resetLiveBuffers = (): void => {
    liveBuffers.options.reset([]);
    liveBuffers.nbbo.reset([]);
    liveBuffers.equities.reset([]);
    liveBuffers.equityQuotes.reset([]);
    liveBuffers.equityJoins.reset([]);
    liveBuffers.flow.reset([]);
    liveBuffers.smartFlow.reset([]);
    liveBuffers.smartMoney.reset([]);
    liveBuffers.classifierHits.reset([]);
    liveBuffers.alerts.reset([]);
    liveBuffers.durableRows.reset([]);
    liveBuffers.news.reset([]);
    liveBuffers.inferredDark.reset([]);
    liveBuffers.chartCandles.reset([]);
    liveBuffers.chartOverlay.reset([]);
  };
  const cancelScheduledEventFlush = (): void => {
    if (eventFlushHandleRef.current !== null) {
      cancelAnimationFrame(eventFlushHandleRef.current);
      eventFlushHandleRef.current = null;
    }
  };
  const clearPendingEventBatches = (): void => {
    pendingEventBatchesRef.current.clear();
    cancelScheduledEventFlush();
  };
  const replaceArrayState = <T>(
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
      setSmartFlow([]);
      setSmartMoney([]);
      setClassifierHits([]);
      setAlerts([]);
      setDurableRows([]);
      setNews([]);
      setInferredDark([]);
      setOptionsHistory([]);
      setNbboHistory([]);
      setEquitiesHistory([]);
      setEquityJoinsHistory([]);
      setFlowHistory([]);
      setSmartFlowHistory([]);
      setSmartMoneyHistory([]);
      setClassifierHitsHistory([]);
      setAlertsHistory([]);
      setDurableRowsHistory([]);
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
      smartFlowRef.current = [];
      smartMoneyRef.current = [];
      classifierHitsRef.current = [];
      alertsRef.current = [];
      durableRowsRef.current = [];
      newsRef.current = [];
      inferredDarkRef.current = [];
      chartCandlesRef.current = [];
      chartOverlayRef.current = [];
      resetLiveBuffers();
      clearPendingEventBatches();
      optionsHistoryRef.current = [];
      nbboHistoryRef.current = [];
      equitiesHistoryRef.current = [];
      equityJoinsHistoryRef.current = [];
      flowHistoryRef.current = [];
      smartFlowHistoryRef.current = [];
      smartMoneyHistoryRef.current = [];
      classifierHitsHistoryRef.current = [];
      alertsHistoryRef.current = [];
      durableRowsHistoryRef.current = [];
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
        sendLiveSubscribeRequest(socket, toSubscribe);
      }
      subscribedKeysRef.current = nextKeys;
      subscribedMapRef.current = nextMap;
    };

    const commitLastEventUpdates = (updates: Map<LiveSubscription["channel"], number>) => {
      if (updates.size === 0) {
        return;
      }

      let latest = 0;
      for (const updateAt of updates.values()) {
        latest = Math.max(latest, updateAt);
      }
      if (latest <= 0) {
        return;
      }

      lastEventAtRef.current = latest;
      setLastEventByChannel((current) => {
        const next = { ...current };
        let changed = false;
        for (const [channel, updateAt] of updates) {
          if (next[channel] !== updateAt) {
            next[channel] = updateAt;
            changed = true;
          }
        }
        return changed ? next : current;
      });
      setLastUpdate(latest);
    };

    const applySubscriptionItems = (
      subscription: LiveSubscription,
      items: readonly unknown[],
      isSnapshot: boolean,
      nextBefore?: Cursor | null
    ): boolean => {
      const subscriptionKey = getLiveSubscriptionKey(subscription);

      const mergeItems = <T extends SortableItem>(
        setter: Dispatch<SetStateAction<T[]>>,
        ref: { current: T[] },
        buffer: LiveWindowBuffer<T>,
        nextItems: T[],
        history?: {
          setter: Dispatch<SetStateAction<T[]>>;
          ref: { current: T[] };
          cap?: number;
        }
      ) => {
        if (isSnapshot) {
          const next = shouldRetainLiveSnapshotHistory(
            subscription.channel,
            true,
            nextItems.length,
            ref.current.length
          )
            ? ref.current
            : nextItems;
          replaceArrayState(setter, ref, buffer.reset(next).items);
          return;
        }

        const { items: kept, evicted } = buffer.upsertMany(nextItems);
        replaceArrayState(setter, ref, kept);
        if (history && evicted.length > 0) {
          mergeHistoryState(history.setter, history.ref, evicted, kept, history.cap);
        }
      };

      switch (subscription.channel) {
        case "options":
          mergeItems(setOptions, optionsRef, liveBuffers.options, items as OptionPrint[], {
            setter: setOptionsHistory,
            ref: optionsHistoryRef,
            cap: getLiveHistoryRetentionCap(subscription)
          });
          break;
        case "nbbo":
          mergeItems(setNbbo, nbboRef, liveBuffers.nbbo, items as OptionNBBO[], {
            setter: setNbboHistory,
            ref: nbboHistoryRef
          });
          break;
        case "equities":
          mergeItems(setEquities, equitiesRef, liveBuffers.equities, items as EquityPrint[], {
            setter: setEquitiesHistory,
            ref: equitiesHistoryRef,
            cap: getLiveHistoryRetentionCap(subscription)
          });
          break;
        case "equity-quotes":
          mergeItems(
            setEquityQuotes,
            equityQuotesRef,
            liveBuffers.equityQuotes,
            items as EquityQuote[]
          );
          break;
        case "equity-joins":
          mergeItems(
            setEquityJoins,
            equityJoinsRef,
            liveBuffers.equityJoins,
            items as EquityPrintJoin[],
            {
              setter: setEquityJoinsHistory,
              ref: equityJoinsHistoryRef
            }
          );
          break;
        case "flow":
          mergeItems(setFlow, flowRef, liveBuffers.flow, items as FlowPacket[], {
            setter: setFlowHistory,
            ref: flowHistoryRef
          });
          break;
        case "smart-flow":
          mergeItems(
            setSmartFlow,
            smartFlowRef,
            liveBuffers.smartFlow,
            items as SmartFlowExplainabilityProjection[],
            {
              setter: setSmartFlowHistory,
              ref: smartFlowHistoryRef
            }
          );
          break;
        case "smart-money":
          mergeItems(
            setSmartMoney,
            smartMoneyRef,
            liveBuffers.smartMoney,
            items as SmartMoneyEvent[],
            {
              setter: setSmartMoneyHistory,
              ref: smartMoneyHistoryRef
            }
          );
          break;
        case "classifier-hits":
          mergeItems(
            setClassifierHits,
            classifierHitsRef,
            liveBuffers.classifierHits,
            items as ClassifierHitEvent[],
            {
              setter: setClassifierHitsHistory,
              ref: classifierHitsHistoryRef
            }
          );
          break;
        case "alerts":
          mergeItems(setAlerts, alertsRef, liveBuffers.alerts, items as AlertEvent[], {
            setter: setAlertsHistory,
            ref: alertsHistoryRef
          });
          break;
        case "durable-rows":
          mergeItems(
            setDurableRows,
            durableRowsRef,
            liveBuffers.durableRows,
            items as DurableTapeRowViewModel[],
            {
              setter: setDurableRowsHistory,
              ref: durableRowsHistoryRef,
              cap: LIVE_HISTORY_SOFT_CAP
            }
          );
          break;
        case "news":
          mergeItems(setNews, newsRef, liveBuffers.news, items as NewsStory[], {
            setter: setNewsHistory,
            ref: newsHistoryRef
          });
          break;
        case "inferred-dark":
          mergeItems(
            setInferredDark,
            inferredDarkRef,
            liveBuffers.inferredDark,
            items as InferredDarkEvent[],
            {
              setter: setInferredDarkHistory,
              ref: inferredDarkHistoryRef
            }
          );
          break;
        case "equity-candles":
          mergeItems(
            setChartCandles,
            chartCandlesRef,
            liveBuffers.chartCandles,
            items as EquityCandle[]
          );
          break;
        case "equity-overlay":
          mergeItems(
            setChartOverlay,
            chartOverlayRef,
            liveBuffers.chartOverlay,
            items as EquityPrint[]
          );
          break;
      }

      if (isSnapshot) {
        setHistoryCursors((current) => ({
          ...current,
          [subscriptionKey]: nextBefore ?? null
        }));
        setHistoryErrors((current) => ({
          ...current,
          [subscriptionKey]: null
        }));
      }

      return items.length > 0;
    };

    const flushPendingEventBatches = () => {
      cancelScheduledEventFlush();
      const batches = Array.from(pendingEventBatchesRef.current.values());
      pendingEventBatchesRef.current.clear();
      if (batches.length === 0) {
        return;
      }

      const lastEvents = new Map<LiveSubscription["channel"], number>();
      for (const batch of batches) {
        const applied = applySubscriptionItems(batch.subscription, batch.items, false);
        if (applied) {
          const current = lastEvents.get(batch.subscription.channel) ?? 0;
          lastEvents.set(batch.subscription.channel, Math.max(current, batch.updateAt));
        }
      }
      commitLastEventUpdates(lastEvents);
    };

    const scheduleEventFlush = () => {
      if (eventFlushHandleRef.current !== null) {
        return;
      }
      eventFlushHandleRef.current = requestAnimationFrame(flushPendingEventBatches);
    };

    const queueEvent = (subscription: LiveSubscription, item: unknown) => {
      const subscriptionKey = getLiveSubscriptionKey(subscription);
      const updateAt = Date.now();
      const current = pendingEventBatchesRef.current.get(subscriptionKey);
      if (current) {
        current.items.push(item);
        current.updateAt = updateAt;
      } else {
        pendingEventBatchesRef.current.set(subscriptionKey, {
          subscription,
          items: [item],
          updateAt
        });
      }
      scheduleEventFlush();
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

      if (message.op === "event") {
        queueEvent(message.subscription, message.item);
        return;
      }

      flushPendingEventBatches();
      const updateAt = Date.now();
      const applied = applySubscriptionItems(
        message.snapshot.subscription,
        message.snapshot.items,
        true,
        message.snapshot.next_before
      );
      if (applied) {
        commitLastEventUpdates(new Map([[message.snapshot.subscription.channel, updateAt]]));
      }
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
      clearPendingEventBatches();
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
    const resetScopedChannels = getLiveSubscriptionResetChannels(
      subscribedMapRef.current.values(),
      manifest
    );
    if (resetScopedChannels.has("options")) {
      optionsRef.current = [];
      optionsHistoryRef.current = [];
      liveBuffers.options.reset([]);
      setOptions([]);
      setOptionsHistory([]);
    }
    if (resetScopedChannels.has("equities")) {
      equitiesRef.current = [];
      equitiesHistoryRef.current = [];
      liveBuffers.equities.reset([]);
      setEquities([]);
      setEquitiesHistory([]);
    }
    if (resetScopedChannels.has("durable-rows")) {
      durableRowsRef.current = [];
      durableRowsHistoryRef.current = [];
      liveBuffers.durableRows.reset([]);
      setDurableRows([]);
      setDurableRowsHistory([]);
    }
    if (resetScopedChannels.has("equity-candles")) {
      chartCandlesRef.current = [];
      liveBuffers.chartCandles.reset([]);
      setChartCandles([]);
    }
    if (resetScopedChannels.has("equity-overlay")) {
      chartOverlayRef.current = [];
      liveBuffers.chartOverlay.reset([]);
      setChartOverlay([]);
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
      sendLiveSubscribeRequest(socket, toSubscribe);
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
          case "smart-flow":
            mergeOlder(setSmartFlowHistory, smartFlowHistoryRef, smartFlowRef.current);
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
    smartFlowHistory,
    smartMoneyHistory,
    classifierHitsHistory,
    alertsHistory,
    durableRowsHistory,
    newsHistory,
    inferredDarkHistory,
    options,
    nbbo,
    equities,
    equityQuotes,
    equityJoins,
    flow,
    smartFlow,
    smartMoney,
    classifierHits,
    alerts,
    durableRows,
    news,
    inferredDark,
    chartCandles,
    chartOverlay
  };
};
