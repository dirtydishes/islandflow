"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EquityPrint, OptionPrint } from "@islandflow/types";

const MAX_ITEMS = 60;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type WsStatus = "connecting" | "connected" | "disconnected";

type TapeMode = "live" | "replay";

type MessageType = "option-print" | "equity-print";

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

type TapeState<T> = {
  status: WsStatus;
  items: T[];
  lastUpdate: number | null;
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
  expectedType: MessageType;
  batchSize?: number;
  pollMs?: number;
};

const useTape = <T extends { ts: number; seq: number }>(
  config: TapeConfig<T>
): TapeState<T> => {
  const { mode, wsPath, replayPath, expectedType } = config;
  const batchSize = config.batchSize ?? 40;
  const pollMs = config.pollMs ?? 1000;
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [items, setItems] = useState<T[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [paused, setPaused] = useState<boolean>(false);
  const [dropped, setDropped] = useState<number>(0);
  const reconnectRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const cursorRef = useRef<ReplayCursor>({ ts: 0, seq: 0 });
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
    setDropped(0);
    setStatus("connecting");
    cursorRef.current = { ts: 0, seq: 0 };
  }, [mode]);

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

          setItems((prev) => {
            const next = [message.payload, ...prev];
            return next.slice(0, MAX_ITEMS);
          });
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

      try {
        const cursor = cursorRef.current;
        const url = new URL(buildApiUrl(replayPath));
        url.searchParams.set("after_ts", cursor.ts.toString());
        url.searchParams.set("after_seq", cursor.seq.toString());
        url.searchParams.set("limit", batchSize.toString());

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Replay request failed with ${response.status}`);
        }

        const payload = (await response.json()) as ReplayResponse<T>;
        if (payload.data.length > 0) {
          const nextItems = [...payload.data].reverse();
          setItems((prev) => {
            const next = [...nextItems, ...prev];
            return next.slice(0, MAX_ITEMS);
          });
          setLastUpdate(Date.now());
        }

        if (payload.next) {
          cursorRef.current = payload.next;
        }

        setStatus("connected");
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

  return { status, items, lastUpdate, paused, dropped, togglePause };
};

type TapeStatusProps = {
  status: WsStatus;
  lastUpdate: number | null;
  paused: boolean;
  dropped: number;
  mode: TapeMode;
  onTogglePause: () => void;
};

const TapeStatus = ({ status, lastUpdate, paused, dropped, mode, onTogglePause }: TapeStatusProps) => {
  const replayClass = mode === "replay" ? "status-replay" : "";
  const pausedClass = paused ? "status-paused" : "";

  return (
    <div className={`status status-${status} status-compact ${replayClass} ${pausedClass}`.trim()}>
      <span className="status-dot" />
      <span>{statusLabel(status, paused, mode)}</span>
      {lastUpdate ? (
        <span className="timestamp">Updated {formatTime(lastUpdate)}</span>
      ) : (
        <span className="timestamp">Waiting for data</span>
      )}
      {paused && dropped > 0 ? (
        <span className="timestamp">{dropped} new while paused</span>
      ) : null}
      <button className="pause-button" type="button" onClick={onTogglePause}>
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
};

export default function HomePage() {
  const [mode, setMode] = useState<TapeMode>("live");

  const options = useTape<OptionPrint>({
    mode,
    wsPath: "/ws/options",
    replayPath: "/replay/options",
    expectedType: "option-print"
  });

  const equities = useTape<EquityPrint>({
    mode,
    wsPath: "/ws/equities",
    replayPath: "/replay/equities",
    expectedType: "equity-print"
  });

  const lastSeen = useMemo(() => {
    return [options.lastUpdate, equities.lastUpdate]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [options.lastUpdate, equities.lastUpdate]);

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
            <TapeStatus
              status={options.status}
              lastUpdate={options.lastUpdate}
              paused={options.paused}
              dropped={options.dropped}
              mode={mode}
              onTogglePause={options.togglePause}
            />
          </div>

          <div className="list">
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
            <TapeStatus
              status={equities.status}
              lastUpdate={equities.lastUpdate}
              paused={equities.paused}
              dropped={equities.dropped}
              mode={mode}
              onTogglePause={equities.togglePause}
            />
          </div>

          <div className="list">
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
      </div>
    </main>
  );
}
