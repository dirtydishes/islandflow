"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OptionPrint } from "@islandflow/types";

const MAX_ITEMS = 60;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type WsStatus = "connecting" | "connected" | "disconnected";

type OptionMessage = {
  type: "option-print";
  payload: OptionPrint;
};

const buildWsUrl = (): string => {
  const envBase = process.env.NEXT_PUBLIC_API_URL;

  if (envBase) {
    const url = new URL(envBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/options";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  const isLocal = LOCAL_HOSTS.has(hostname);
  const host = isLocal ? `${hostname}:4000` : window.location.host;

  return `${wsProtocol}://${host}/ws/options`;
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

export default function HomePage() {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [prints, setPrints] = useState<OptionPrint[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "connected":
        return "Live";
      case "connecting":
        return "Connecting";
      case "disconnected":
      default:
        return "Disconnected";
    }
  }, [status]);

  useEffect(() => {
    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      setStatus("connecting");

      const socket = new WebSocket(buildWsUrl());
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
          const message = JSON.parse(event.data) as OptionMessage;
          if (message.type !== "option-print") {
            return;
          }

          setPrints((prev) => {
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
  }, []);

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <p className="eyebrow">Realtime flow workspace</p>
          <h1>Islandflow</h1>
          <p className="subtitle">Live option prints streaming from /ws/options.</p>
        </div>
        <div className={`status status-${status}`}>
          <span className="status-dot" />
          <span>{statusLabel}</span>
          {lastUpdate ? (
            <span className="timestamp">Updated {formatTime(lastUpdate)}</span>
          ) : (
            <span className="timestamp">Waiting for data</span>
          )}
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Options Tape</h2>
            <p className="card-subtitle">Newest prints first (max {MAX_ITEMS}).</p>
          </div>
          <span className="badge">Live</span>
        </div>

        <div className="list">
          {prints.length === 0 ? (
            <div className="empty">No prints yet. Start ingest-options to populate the tape.</div>
          ) : (
            prints.map((print) => (
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
    </main>
  );
}
