"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EquityPrint, FlowPacket, OptionPrint } from "@islandflow/types";

const MAX_ITEMS = 500;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type WsStatus = "connecting" | "connected" | "disconnected";

type TapeMode = "live" | "replay";

type MessageType = "option-print" | "equity-print" | "flow-packet";

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

type ListScrollState = {
  listRef: React.RefObject<HTMLDivElement>;
  isAtTop: boolean;
  missed: number;
  onNewItems: (count: number) => void;
  jumpToTop: () => void;
};

const useListScroll = (): ListScrollState => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  const [missed, setMissed] = useState(0);
  const isAtTopRef = useRef(true);

  useEffect(() => {
    isAtTopRef.current = isAtTop;
  }, [isAtTop]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }

    const onScroll = () => {
      const atTop = el.scrollTop <= 2;
      setIsAtTop(atTop);
      if (atTop) {
        setMissed(0);
      }
    };

    onScroll();
    el.addEventListener("scroll", onScroll);

    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

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

    el.scrollTo({ top: 0, behavior: "smooth" });
    setMissed(0);
  }, []);

  return { listRef, isAtTop, missed, onNewItems, jumpToTop };
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
  onNewItems?: (count: number) => void;
};

const useTape = <T extends { ts: number; seq: number }>(
  config: TapeConfig<T>
): TapeState<T> => {
  const { mode, wsPath, replayPath, expectedType, latestPath, onNewItems } = config;
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

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

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
  }, [mode]);

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

          if (onNewItems) {
            onNewItems(1);
          }

          setItems((prev) => mergeNewest([message.payload], prev));
          setLastUpdate(Date.now());
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
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [mode, wsPath, expectedType]);

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
            if (onNewItems) {
              onNewItems(nextItems.length);
            }
            setItems((prev) => mergeNewest(nextItems, prev));
            setLastUpdate(Date.now());
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
    };
  }, [mode, replayPath, batchSize, pollMs]);

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
  onNewItems?: (count: number) => void
): TapeState<FlowPacket> => {
  const [status, setStatus] = useState<WsStatus>(enabled ? "connecting" : "disconnected");
  const [items, setItems] = useState<FlowPacket[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [replayTime] = useState<number | null>(null);
  const [replayComplete] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [dropped, setDropped] = useState<number>(0);
  const reconnectRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

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
    if (!enabled) {
      setStatus("disconnected");
      return;
    }

    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      setStatus("connecting");

      const socket = new WebSocket(buildWsUrl("/ws/flow"));
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
          const message = JSON.parse(event.data) as StreamMessage<FlowPacket>;
          if (!message || message.type !== "flow-packet") {
            return;
          }

          if (pausedRef.current) {
            setDropped((prev) => prev + 1);
            setLastUpdate(Date.now());
            return;
          }

          if (onNewItems) {
            onNewItems(1);
          }

          setItems((prev) => mergeNewest([message.payload], prev));
          setLastUpdate(Date.now());
        } catch (error) {
          console.warn("Failed to parse flow packet", error);
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
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [enabled]);

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

const formatFlowMetric = (value: number, suffix?: string): string => {
  if (suffix) {
    return `${value}${suffix}`;
  }

  return value.toLocaleString();
};

export default function HomePage() {
  const [mode, setMode] = useState<TapeMode>("live");
  const optionsScroll = useListScroll();
  const equitiesScroll = useListScroll();
  const flowScroll = useListScroll();

  const options = useTape<OptionPrint>({
    mode,
    wsPath: "/ws/options",
    replayPath: "/replay/options",
    latestPath: "/prints/options",
    expectedType: "option-print",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
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
    onNewItems: equitiesScroll.onNewItems
  });

  const flow = useFlowStream(mode === "live", flowScroll.onNewItems);

  const lastSeen = useMemo(() => {
    return [options.lastUpdate, equities.lastUpdate, flow.lastUpdate]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [options.lastUpdate, equities.lastUpdate, flow.lastUpdate]);

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

      <div className="cards">
        <section className="card">
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
            {options.items.length === 0 ? (
              <div className="empty">
                {mode === "live"
                  ? "No option prints yet. Start ingest-options."
                  : "Replay queue empty. Ensure ClickHouse has data."}
              </div>
            ) : (
              options.items.map((print) => (
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
                  </div>
                  <div className="time">{formatTime(print.ts)}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
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
            {equities.items.length === 0 ? (
              <div className="empty">
                {mode === "live"
                  ? "No equity prints yet. Start ingest-equities."
                  : "Replay queue empty. Ensure ClickHouse has data."}
              </div>
            ) : (
              equities.items.map((print) => (
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

        <section className="card">
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

          <div className="list" ref={flowScroll.listRef}>
            {mode !== "live" ? (
              <div className="empty">Flow packets are live-only in this build.</div>
            ) : flow.items.length === 0 ? (
              <div className="empty">No flow packets yet. Start compute.</div>
            ) : (
              flow.items.map((packet) => {
                const features = packet.features ?? {};
                const contract = String(features.option_contract_id ?? packet.id ?? "unknown");
                const count = parseNumber(features.count, packet.members.length);
                const totalSize = parseNumber(features.total_size, 0);
                const totalPremium = parseNumber(features.total_premium, 0);
                const startTs = parseNumber(features.start_ts, packet.source_ts);
                const endTs = parseNumber(features.end_ts, startTs);
                const windowMs = parseNumber(features.window_ms, 0);

                return (
                  <div className="row" key={packet.id}>
                    <div>
                      <div className="contract">{contract}</div>
                      <div className="meta flow-meta">
                        <span>{formatFlowMetric(count)} prints</span>
                        <span>{formatFlowMetric(totalSize)} size</span>
                        <span>${formatPrice(totalPremium)}</span>
                        {windowMs > 0 ? (
                          <span>{formatFlowMetric(windowMs, "ms")}</span>
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
        </section>
      </div>
    </main>
  );
}
