import { decode, encode } from "@msgpack/msgpack";
import { createLogger } from "@islandflow/observability";
import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";
import WebSocket from "ws";

type AlpacaFeed = "indicative" | "opra";

type AlpacaOptionsAdapterConfig = {
  keyId: string;
  secretKey: string;
  restUrl: string;
  wsBaseUrl: string;
  feed: AlpacaFeed;
  underlyings: string[];
  strikesPerSide: number;
  maxDteDays: number;
  moneynessPct: number;
  moneynessFallbackPct: number;
  maxQuotes: number;
};

type OptionContract = {
  symbol: string;
  root: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
};

type OptionSnapshotResponse = {
  snapshots?: Record<string, unknown>;
  next_page_token?: string | null;
};

type StockSnapshotResponse = {
  latestTrade?: { p?: number };
  latestQuote?: { bp?: number; ap?: number };
};

type AlpacaTradeMessage = {
  T: "t";
  S: string;
  t: string;
  p: number;
  s: number;
  x?: string;
  c?: string;
};

type AlpacaQuoteMessage = {
  T: "q";
  S: string;
  t: string;
  bp: number;
  bs: number;
  ap: number;
  as: number;
  bx?: string;
  ax?: string;
  c?: string;
};

type ExpiryInfo = {
  iso: string;
  date: Date;
  dte: number;
  isMonthly: boolean;
};

const logger = createLogger({ service: "ingest-options" });

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const diffDays = (from: Date, to: Date): number =>
  Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);

const isThirdFriday = (date: Date): boolean => {
  const day = date.getUTCDate();
  return date.getUTCDay() === 5 && day >= 15 && day <= 21;
};

const parseOccSymbol = (symbol: string): OptionContract | null => {
  if (symbol.length < 15) {
    return null;
  }

  const tail = symbol.slice(-15);
  const root = symbol.slice(0, -15);
  const expiryRaw = tail.slice(0, 6);
  const right = tail.slice(6, 7);
  const strikeRaw = tail.slice(7);

  if (!/^\d{6}$/.test(expiryRaw) || !/^\d{8}$/.test(strikeRaw)) {
    return null;
  }

  if (right !== "C" && right !== "P") {
    return null;
  }

  const year = 2000 + Number(expiryRaw.slice(0, 2));
  const month = Number(expiryRaw.slice(2, 4)) - 1;
  const day = Number(expiryRaw.slice(4, 6));
  const expiryDate = new Date(Date.UTC(year, month, day));
  const expiry = formatDate(expiryDate);
  const strike = Number(strikeRaw) / 1000;

  if (!root || !Number.isFinite(strike)) {
    return null;
  }

  return {
    symbol,
    root,
    expiry,
    strike,
    right
  };
};

const formatStrike = (strike: number): string => {
  const fixed = strike.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
};

const formatContractId = (contract: OptionContract): string =>
  `${contract.root}-${contract.expiry}-${formatStrike(contract.strike)}-${contract.right}`;

const normalizeUnderlyings = (value: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    const symbol = entry.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) {
      continue;
    }

    seen.add(symbol);
    result.push(symbol);
  }

  return result;
};

const buildHeaders = (config: AlpacaOptionsAdapterConfig): Record<string, string> => ({
  "APCA-API-KEY-ID": config.keyId,
  "APCA-API-SECRET-KEY": config.secretKey
});

const fetchJson = async <T>(
  url: URL,
  config: AlpacaOptionsAdapterConfig
): Promise<T> => {
  const response = await fetch(url.toString(), {
    headers: buildHeaders(config)
  });

  if (!response.ok) {
    throw new Error(`Alpaca request failed (${response.status}) for ${url.toString()}`);
  }

  return (await response.json()) as T;
};

const fetchUnderlyingPrice = async (
  symbol: string,
  config: AlpacaOptionsAdapterConfig
): Promise<number> => {
  const url = new URL(`/v2/stocks/${symbol}/snapshot`, config.restUrl);
  const payload = await fetchJson<StockSnapshotResponse>(url, config);
  const tradePrice = payload.latestTrade?.p;
  const bid = payload.latestQuote?.bp;
  const ask = payload.latestQuote?.ap;

  if (typeof tradePrice === "number" && tradePrice > 0) {
    return tradePrice;
  }

  if (typeof bid === "number" && typeof ask === "number" && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }

  throw new Error(`Unable to resolve underlying price for ${symbol}`);
};

const fetchOptionSnapshots = async (
  underlying: string,
  config: AlpacaOptionsAdapterConfig,
  startDate: string,
  endDate: string,
  strikeLower: number,
  strikeUpper: number
): Promise<OptionContract[]> => {
  const contracts: OptionContract[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(`/v1beta1/options/snapshots/${underlying}`, config.restUrl);
    url.searchParams.set("feed", config.feed);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("expiration_date_gte", startDate);
    url.searchParams.set("expiration_date_lte", endDate);
    url.searchParams.set("strike_price_gte", strikeLower.toFixed(3));
    url.searchParams.set("strike_price_lte", strikeUpper.toFixed(3));
    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }

    const payload = await fetchJson<OptionSnapshotResponse>(url, config);
    const snapshots = payload.snapshots ?? {};

    for (const symbol of Object.keys(snapshots)) {
      if (seen.has(symbol)) {
        continue;
      }

      const parsed = parseOccSymbol(symbol);
      if (!parsed) {
        continue;
      }

      seen.add(symbol);
      contracts.push(parsed);
    }

    pageToken = payload.next_page_token ?? undefined;
  } while (pageToken);

  return contracts;
};

const selectExpiries = (
  contracts: OptionContract[],
  maxDteDays: number
): ExpiryInfo[] => {
  const today = new Date();
  const expiryMap = new Map<string, ExpiryInfo>();

  for (const contract of contracts) {
    if (expiryMap.has(contract.expiry)) {
      continue;
    }

    const parts = contract.expiry.split("-").map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
      continue;
    }

    const expiryDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const dte = diffDays(today, expiryDate);

    if (dte < 0 || dte > maxDteDays) {
      continue;
    }

    expiryMap.set(contract.expiry, {
      iso: contract.expiry,
      date: expiryDate,
      dte,
      isMonthly: isThirdFriday(expiryDate)
    });
  }

  const expiries = Array.from(expiryMap.values()).sort((a, b) => a.dte - b.dte);
  const monthly = expiries.filter((expiry) => expiry.isMonthly);
  const weekly = expiries.filter((expiry) => !expiry.isMonthly);

  const selected: ExpiryInfo[] = [];
  if (weekly.length > 0) {
    selected.push(weekly[0]);
  }
  if (monthly.length > 0 && monthly[0].iso !== selected[0]?.iso) {
    selected.push(monthly[0]);
  }

  for (const expiry of expiries) {
    if (selected.length >= 2) {
      break;
    }
    if (!selected.some((picked) => picked.iso === expiry.iso)) {
      selected.push(expiry);
    }
  }

  return selected.sort((a, b) => a.dte - b.dte);
};

const selectContractsForUnderlying = (
  contracts: OptionContract[],
  price: number,
  config: AlpacaOptionsAdapterConfig
) => {
  const selectedExpiries = selectExpiries(contracts, config.maxDteDays);
  const expirySet = new Set(selectedExpiries.map((expiry) => expiry.iso));
  const strikesByExpiry = new Map<string, Map<number, { call?: string; put?: string }>>();

  for (const contract of contracts) {
    if (!expirySet.has(contract.expiry)) {
      continue;
    }

    const strikeMap = strikesByExpiry.get(contract.expiry) ?? new Map();
    const entry = strikeMap.get(contract.strike) ?? {};

    if (contract.right === "C") {
      entry.call = contract.symbol;
    } else {
      entry.put = contract.symbol;
    }

    strikeMap.set(contract.strike, entry);
    strikesByExpiry.set(contract.expiry, strikeMap);
  }

  const symbols: string[] = [];
  const contractIds = new Map<string, string>();
  let insufficient = false;

  for (const expiry of selectedExpiries) {
    const strikeMap = strikesByExpiry.get(expiry.iso);
    if (!strikeMap) {
      insufficient = true;
      continue;
    }

    const minStrike = price * (1 - config.moneynessPct);
    const maxStrike = price * (1 + config.moneynessPct);
    const strikePairs = Array.from(strikeMap.entries())
      .filter(([strike, pair]) => pair.call && pair.put && strike >= minStrike && strike <= maxStrike)
      .map(([strike, pair]) => ({
        strike,
        call: pair.call as string,
        put: pair.put as string,
        distance: Math.abs(strike - price)
      }))
      .sort((a, b) => (a.distance === b.distance ? a.strike - b.strike : a.distance - b.distance));

    if (strikePairs.length < config.strikesPerSide) {
      insufficient = true;
    }

    const selected = strikePairs.slice(0, config.strikesPerSide);
    for (const strike of selected) {
      symbols.push(strike.call, strike.put);
      const callContract = parseOccSymbol(strike.call);
      const putContract = parseOccSymbol(strike.put);
      if (callContract) {
        contractIds.set(strike.call, formatContractId(callContract));
      }
      if (putContract) {
        contractIds.set(strike.put, formatContractId(putContract));
      }
    }
  }

  return {
    symbols,
    contractIds,
    selectedExpiries,
    insufficient
  };
};

const decodePayload = (data: WebSocket.RawData): unknown => {
  if (typeof data === "string") {
    return JSON.parse(data) as unknown;
  }

  if (data instanceof ArrayBuffer) {
    return decode(new Uint8Array(data));
  }

  if (ArrayBuffer.isView(data)) {
    return decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  return decode(new Uint8Array(data as ArrayBuffer));
};

const parseTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return Date.now();
};

export const createAlpacaOptionsAdapter = (
  config: AlpacaOptionsAdapterConfig
): OptionIngestAdapter => {
  return {
    name: "alpaca",
    start: async (handlers: OptionIngestHandlers) => {
      if (!config.keyId || !config.secretKey) {
        throw new Error("Alpaca adapter requires ALPACA_KEY_ID and ALPACA_SECRET_KEY.");
      }

      const underlyings = normalizeUnderlyings(config.underlyings);
      if (underlyings.length === 0) {
        throw new Error("Alpaca adapter requires at least one underlying symbol.");
      }

      let selectedSymbols: string[] = [];
      let contractIdMap = new Map<string, string>();

      for (const underlying of underlyings) {
        const price = await fetchUnderlyingPrice(underlying, config);
        const today = startOfUtcDay(new Date());
        const startDate = formatDate(today);
        const endDate = formatDate(new Date(today.getTime() + config.maxDteDays * MS_PER_DAY));
        const strikeLower = price * (1 - config.moneynessPct);
        const strikeUpper = price * (1 + config.moneynessPct);

        let contracts = await fetchOptionSnapshots(
          underlying,
          config,
          startDate,
          endDate,
          strikeLower,
          strikeUpper
        );

        let selection = selectContractsForUnderlying(contracts, price, config);

        if (selection.insufficient && config.moneynessFallbackPct > config.moneynessPct) {
          const fallbackLower = price * (1 - config.moneynessFallbackPct);
          const fallbackUpper = price * (1 + config.moneynessFallbackPct);
          contracts = await fetchOptionSnapshots(
            underlying,
            config,
            startDate,
            endDate,
            fallbackLower,
            fallbackUpper
          );
          selection = selectContractsForUnderlying(contracts, price, {
            ...config,
            moneynessPct: config.moneynessFallbackPct
          });
          logger.warn("alpaca selection widened moneyness window", {
            underlying,
            moneyness_pct: config.moneynessFallbackPct
          });
        }

        const expiryList = selection.selectedExpiries.map((expiry) => expiry.iso);
        logger.info("alpaca contract selection", {
          underlying,
          price,
          expiries: expiryList,
          contracts: selection.symbols.length
        });

        selectedSymbols = selectedSymbols.concat(selection.symbols);
        for (const [symbol, contractId] of selection.contractIds) {
          contractIdMap.set(symbol, contractId);
        }
      }

      if (selectedSymbols.length === 0) {
        throw new Error("Alpaca adapter did not select any option contracts.");
      }

      if (selectedSymbols.length > config.maxQuotes) {
        selectedSymbols = selectedSymbols.slice(0, config.maxQuotes);
        contractIdMap = new Map(
          selectedSymbols.map((symbol) => [symbol, contractIdMap.get(symbol) ?? symbol])
        );
        logger.warn("alpaca contract list truncated to max quote limit", {
          max_quotes: config.maxQuotes,
          selected: selectedSymbols.length
        });
      }

      const wsBase = config.wsBaseUrl.endsWith("/")
        ? config.wsBaseUrl.slice(0, -1)
        : config.wsBaseUrl;
      const wsUrl = `${wsBase}/${config.feed}`;
      const ws = new WebSocket(wsUrl, {
        headers: {
          ...buildHeaders(config),
          "Content-Type": "application/msgpack"
        }
      });

      let seq = 0;
      let stopped = false;

      ws.on("open", () => {
        const subscribe: Record<string, unknown> = {
          action: "subscribe",
          trades: selectedSymbols
        };

        if (handlers.onNBBO) {
          subscribe.quotes = selectedSymbols;
        }

        ws.send(encode(subscribe));
      });

      ws.on("message", (data) => {
        if (stopped) {
          return;
        }

        let payload: unknown;
        try {
          payload = decodePayload(data);
        } catch (error) {
          logger.warn("alpaca message decode failed", {
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

          const message = entry as AlpacaTradeMessage | AlpacaQuoteMessage | { T?: string; msg?: string };
          const type = message.T;

          if (type === "t") {
            const trade = message as AlpacaTradeMessage;
            const contractId = contractIdMap.get(trade.S);
            if (!contractId) {
              continue;
            }

            const sourceTs = parseTimestamp(trade.t);
            seq += 1;
            void handlers.onTrade({
              source_ts: sourceTs,
              ingest_ts: Date.now(),
              seq,
              trace_id: `alpaca-${seq}`,
              ts: sourceTs,
              option_contract_id: contractId,
              price: trade.p,
              size: trade.s,
              exchange: trade.x ?? "OPRA",
              conditions: trade.c ? [trade.c] : undefined
            });
            continue;
          }

          if (type === "q" && handlers.onNBBO) {
            const quote = message as AlpacaQuoteMessage;
            const contractId = contractIdMap.get(quote.S);
            if (!contractId) {
              continue;
            }

            const sourceTs = parseTimestamp(quote.t);
            seq += 1;
            void handlers.onNBBO({
              source_ts: sourceTs,
              ingest_ts: Date.now(),
              seq,
              trace_id: `alpaca-${seq}`,
              ts: sourceTs,
              option_contract_id: contractId,
              bid: quote.bp,
              ask: quote.ap,
              bidSize: quote.bs,
              askSize: quote.as
            });
            continue;
          }

          if (type === "error") {
            logger.error("alpaca stream error", { message });
          } else if (type === "success" || type === "subscription") {
            logger.info("alpaca stream status", { message });
          }
        }
      });

      ws.on("error", (error) => {
        logger.error("alpaca websocket error", {
          error: error instanceof Error ? error.message : String(error)
        });
      });

      ws.on("close", (code, reason) => {
        logger.warn("alpaca websocket closed", { code, reason: reason.toString() });
      });

      return () => {
        stopped = true;
        ws.close();
      };
    }
  };
};
