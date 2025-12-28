"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EquityPrint, OptionPrint } from "@islandflow/types";

const MAX_ITEMS = 60;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type WsStatus = "connecting" | "connected" | "disconnected";

type MessageType = "option-print" | "equity-print";

type StreamMessage<T> = {
  type: MessageType;
  payload: T;
};

type TapeState<T> = {
  status: WsStatus;
  items: T[];
  lastUpdate: number | null;
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

const formatPrice = (price: number): string => {
  return price.toFixed(2);
};

const formatSize = (size: number): string => {
  return size.toLocaleString();
};

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString();
};

const statusLabel = (status: WsStatus): string => {
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

const useTape = <T,>(path: string, expectedType: MessageType): TapeState<T> => {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [items, setItems] = useState<T[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      setStatus("connecting");

      const socket = new WebSocket(buildWsUrl(path));
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
  }, [path, expectedType]);

  return { status, items, lastUpdate };
};

type TapeStatusProps = {
  status: WsStatus;
  lastUpdate: number | null;
};

const TapeStatus = ({ status, lastUpdate }: TapeStatusProps) => {
  return (
    <div className={`status status-${status} status-compact`}>
      <span className="status-dot" />
      <span>{statusLabel(status)}</span>
      {lastUpdate ? (
        <span className="timestamp">Updated {formatTime(lastUpdate)}</span>
      ) : (
        <span className="timestamp">Waiting for data</span>
      )}
    </div>
  );
};

export default function HomePage() {
  const options = useTape<OptionPrint>("/ws/options", "option-print");
  const equities = useTape<EquityPrint>("/ws/equities", "equity-print");

  const lastSeen = useMemo(() => {
    return [options.lastUpdate, equities.lastUpdate]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null;
  }, [options.lastUpdate, equities.lastUpdate]);

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <p className="eyebrow">Realtime flow workspace</p>
          <h1>Islandflow</h1>
          <p className="subtitle">
            Options + equities streaming over WebSocket from the local API gateway.
          </p>
        </div>
        <div className="summary">
          <span className="summary-title">Last update</span>
          <span className="summary-value">
            {lastSeen ? formatTime(lastSeen) : "Waiting for data"}
          </span>
        </div>
      </header>

      <div className="cards">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>Options Tape</h2>
              <p className="card-subtitle">Newest prints first (max {MAX_ITEMS}).</p>
            </div>
            <TapeStatus status={options.status} lastUpdate={options.lastUpdate} />
          </div>

          <div className="list">
            {options.items.length === 0 ? (
              <div className="empty">No option prints yet. Start ingest-options.</div>
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
            <TapeStatus status={equities.status} lastUpdate={equities.lastUpdate} />
          </div>

          <div className="list">
            {equities.items.length === 0 ? (
              <div className="empty">No equity prints yet. Start ingest-equities.</div>
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
