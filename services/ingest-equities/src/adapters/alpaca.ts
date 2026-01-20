import { createLogger } from "@islandflow/observability";
import type { EquityPrint, EquityQuote } from "@islandflow/types";
import type { EquityIngestAdapter, EquityIngestHandlers } from "./types";
import WebSocket from "ws";

export type AlpacaEquitiesFeed = "iex" | "sip";

export type AlpacaEquitiesAdapterConfig = {
  keyId: string;
  secretKey: string;
  restUrl: string;
  wsBaseUrl: string;
  feed: AlpacaEquitiesFeed;
  symbols: string[];
};

type AlpacaExchangeMetaEntry = {
  code: string;
  name: string;
};

type AlpacaTradeMessage = {
  T: "t";
  S: string;
  t: string;
  p: number;
  s: number;
  x?: string;
  c?: string[];
  z?: string;
};

type AlpacaQuoteMessage = {
  T: "q";
  S: string;
  t: string;
  bp: number;
  ap: number;
  bs?: number;
  as?: number;
  bx?: string;
  ax?: string;
  c?: string[];
  z?: string;
};

const logger = createLogger({ service: "ingest-equities" });

const normalizeSymbols = (symbols: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of symbols) {
    const symbol = entry.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) {
      continue;
    }

    seen.add(symbol);
    result.push(symbol);
  }

  return result;
};

const buildHeaders = (config: AlpacaEquitiesAdapterConfig): Record<string, string> => ({
  "APCA-API-KEY-ID": config.keyId,
  "APCA-API-SECRET-KEY": config.secretKey
});

const parseTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return Date.now();
};

const decodePayload = (data: WebSocket.RawData): unknown => {
  if (typeof data === "string") {
    return JSON.parse(data) as unknown;
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as unknown;
  }

  if (ArrayBuffer.isView(data)) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))) as unknown;
  }

  return JSON.parse(new TextDecoder().decode(new Uint8Array(data as ArrayBuffer))) as unknown;
};

const extractExchangeMeta = (payload: unknown): AlpacaExchangeMetaEntry[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const result: AlpacaExchangeMetaEntry[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const code = typeof candidate.code === "string" ? candidate.code : typeof candidate.exchange === "string" ? candidate.exchange : null;
    const name = typeof candidate.name === "string" ? candidate.name : typeof candidate.description === "string" ? candidate.description : null;
    if (!code || !name) {
      continue;
    }

    result.push({ code, name });
  }

  return result;
};

const buildExchangeNameMap = (entries: AlpacaExchangeMetaEntry[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const code = entry.code.trim();
    const name = entry.name.trim();
    if (!code || !name) {
      continue;
    }
    map.set(code, name);
  }
  return map;
};

const OFF_EXCHANGE_HINTS = ["FINRA", "TRF", "ADF", "OTC", "Trade Reporting Facility", "Alternative Display Facility"];

export const inferOffExchangeFlag = (exchangeCode: string | undefined, exchangeNameMap: Map<string, string>): boolean => {
  if (!exchangeCode) {
    return false;
  }

  const name = exchangeNameMap.get(exchangeCode) ?? "";
  const normalized = name.toUpperCase();

  if (normalized) {
    return OFF_EXCHANGE_HINTS.some((hint) => normalized.includes(hint.toUpperCase()));
  }

  // Conservative fallback: only tag the most common FINRA code when no mapping is available.
  return exchangeCode.toUpperCase() === "D";
};

const buildWsUrl = (wsBaseUrl: string, feed: AlpacaEquitiesFeed): string => {
  const parsed = new URL(wsBaseUrl);
  return `${parsed.origin}/v2/${feed}`;
};

const fetchExchangeMeta = async (config: AlpacaEquitiesAdapterConfig): Promise<Map<string, string>> => {
  const url = new URL("/v2/stocks/meta/exchanges", config.restUrl);

  try {
    const response = await fetch(url.toString(), {
      headers: buildHeaders(config)
    });

    if (!response.ok) {
      logger.warn("alpaca exchange meta request failed", {
        status: response.status
      });
      return new Map();
    }

    const payload = (await response.json()) as unknown;
    const entries = extractExchangeMeta(payload);
    return buildExchangeNameMap(entries);
  } catch (error) {
    logger.warn("alpaca exchange meta request error", {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Map();
  }
};

export const createAlpacaEquitiesAdapter = (
  config: AlpacaEquitiesAdapterConfig
): EquityIngestAdapter => {
  return {
    name: "alpaca",
    start: async (handlers: EquityIngestHandlers) => {
      if (!config.keyId || !config.secretKey) {
        throw new Error("Alpaca equities adapter requires ALPACA_KEY_ID and ALPACA_SECRET_KEY.");
      }

      const symbols = normalizeSymbols(config.symbols);
      if (symbols.length === 0) {
        throw new Error("Alpaca equities adapter requires at least one symbol.");
      }

      const exchangeNameMap = await fetchExchangeMeta(config);
      const wsUrl = buildWsUrl(config.wsBaseUrl, config.feed);
      const ws = new WebSocket(wsUrl);

      let seq = 0;
      let stopped = false;
      let authenticated = false;

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            action: "auth",
            key: config.keyId,
            secret: config.secretKey
          })
        );
      });

      const subscribe = () => {
        const message: Record<string, unknown> = {
          action: "subscribe",
          trades: symbols
        };

        if (handlers.onQuote) {
          message.quotes = symbols;
        }

        ws.send(JSON.stringify(message));
      };

      ws.on("message", (data) => {
        if (stopped) {
          return;
        }

        let payload: unknown;
        try {
          payload = decodePayload(data);
        } catch (error) {
          logger.warn("alpaca equities message decode failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          return;
        }

        if (!Array.isArray(payload)) {
          return;
        }

        for (const entry of payload) {
          if (!entry || typeof entry !== "object") {
            continue;
          }

          const message = entry as (AlpacaTradeMessage | AlpacaQuoteMessage | { T?: string; msg?: string });
          const type = message.T;

          if (type === "success") {
            const msg = (message as { msg?: string }).msg ?? "";
            if (msg === "authenticated") {
              authenticated = true;
              subscribe();
            }
            continue;
          }

          if (type === "subscription") {
            continue;
          }

          if (type === "error") {
            logger.error("alpaca equities stream error", { message });
            continue;
          }

          if (type === "t") {
            const trade = message as AlpacaTradeMessage;
            const sourceTs = parseTimestamp(trade.t);
            seq += 1;
            const exchangeCode = trade.x ?? "";

            void handlers.onTrade({
              source_ts: sourceTs,
              ingest_ts: Date.now(),
              seq,
              trace_id: `alpaca-equities-${seq}`,
              ts: sourceTs,
              underlying_id: trade.S,
              price: trade.p,
              size: trade.s,
              exchange: exchangeCode || "ALPACA",
              offExchangeFlag: inferOffExchangeFlag(exchangeCode, exchangeNameMap)
            } satisfies EquityPrint);

            continue;
          }

          if (type === "q" && handlers.onQuote) {
            const quote = message as AlpacaQuoteMessage;
            const sourceTs = parseTimestamp(quote.t);
            seq += 1;

            void handlers.onQuote({
              source_ts: sourceTs,
              ingest_ts: Date.now(),
              seq,
              trace_id: `alpaca-equity-quote-${seq}`,
              ts: sourceTs,
              underlying_id: quote.S,
              bid: quote.bp,
              ask: quote.ap
            } satisfies EquityQuote);

            continue;
          }
        }
      });

      ws.on("error", (error) => {
        logger.error("alpaca equities websocket error", {
          error: error instanceof Error ? error.message : String(error)
        });
      });

      ws.on("close", (code, reason) => {
        logger.warn("alpaca equities websocket closed", {
          code,
          reason: reason.toString(),
          authenticated
        });
      });

      return () => {
        stopped = true;
        ws.close();
      };
    }
  };
};
