import { SP500_SYMBOLS, type EquityPrint, type EquityQuote } from "@islandflow/types";
import type { EquityIngestAdapter, EquityIngestHandlers } from "./types";

type SyntheticEquitiesAdapterConfig = {
  emitIntervalMs: number;
};

const EXCHANGES = ["NYSE", "NASDAQ", "ARCA", "BATS", "IEX", "TEST"];
const DARK_EXCHANGE = "OTC";

type PricePlacement = "MID" | "A" | "AA" | "B" | "BB";
type DarkScenario = "block" | "buy" | "sell";

const DARK_SEQUENCE: DarkScenario[] = [
  "block",
  "buy",
  "buy",
  "buy",
  "buy",
  "sell",
  "sell",
  "sell",
  "sell"
];

const hashSymbol = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const buildSyntheticPrint = (
  seq: number,
  now: number,
  symbol: string,
  price: number,
  size: number,
  exchange: string,
  offExchangeFlag: boolean
): EquityPrint => {
  return {
    source_ts: now,
    ingest_ts: now,
    seq,
    trace_id: `synthetic-equities-${seq}`,
    ts: now,
    underlying_id: symbol,
    price,
    size,
    exchange,
    offExchangeFlag
  };
};

const buildSyntheticQuote = (
  seq: number,
  now: number,
  symbol: string,
  bid: number,
  ask: number
): EquityQuote => {
  return {
    source_ts: now,
    ingest_ts: now,
    seq,
    trace_id: `synthetic-equity-quote-${seq}`,
    ts: now,
    underlying_id: symbol,
    bid,
    ask
  };
};

const formatPrice = (value: number): number => {
  return Number(value.toFixed(2));
};

const buildQuoteFromMid = (mid: number) => {
  const spread = Math.max(0.05, Number((mid * 0.002).toFixed(2)));
  const half = spread / 2;
  const bid = formatPrice(Math.max(0.01, mid - half));
  const ask = formatPrice(Math.max(bid + 0.01, mid + half));
  const epsilon = Math.max(0.01, spread * 0.05);

  return { bid, ask, spread, epsilon };
};

const priceForPlacement = (
  mid: number,
  quote: { bid: number; ask: number; epsilon: number },
  placement: PricePlacement
): number => {
  const { bid, ask, epsilon } = quote;

  let price = mid;
  switch (placement) {
    case "AA":
      price = ask + epsilon * 1.5;
      break;
    case "A":
      price = ask;
      break;
    case "BB":
      price = bid - epsilon * 1.5;
      break;
    case "B":
      price = bid;
      break;
    case "MID":
    default:
      price = mid;
      break;
  }

  return formatPrice(Math.max(0.01, price));
};

export const createSyntheticEquitiesAdapter = (
  config: SyntheticEquitiesAdapterConfig
): EquityIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: EquityIngestHandlers) => {
      let seq = 0;
      let quoteSeq = 0;
      let darkStep = 0;
      let darkSymbolIndex = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      let stopped = false;

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        const batchSize = 3;

        const darkSymbol = SP500_SYMBOLS[darkSymbolIndex % SP500_SYMBOLS.length];
        const darkHash = hashSymbol(darkSymbol);
        const darkBase = 25 + (darkHash % 475);
        const darkDrift = ((darkStep % 24) - 12) * 0.08;
        const darkMid = formatPrice(darkBase + darkDrift);
        const darkQuote = buildQuoteFromMid(darkMid);
        const scenario = DARK_SEQUENCE[darkStep % DARK_SEQUENCE.length];
        const darkTs = now;

        if (handlers.onQuote) {
          quoteSeq += 1;
          const quoteEvent = buildSyntheticQuote(
            quoteSeq,
            darkTs - 2,
            darkSymbol,
            darkQuote.bid,
            darkQuote.ask
          );
          void handlers.onQuote(quoteEvent);
        }

        seq += 1;
        let darkPlacement: PricePlacement = "MID";
        let darkSize = 2600;
        if (scenario === "buy") {
          darkPlacement = darkStep % 2 === 0 ? "A" : "AA";
          darkSize = 800;
        } else if (scenario === "sell") {
          darkPlacement = darkStep % 2 === 0 ? "B" : "BB";
          darkSize = 800;
        }
        const darkPrice = priceForPlacement(darkMid, darkQuote, darkPlacement);
        const darkPrint = buildSyntheticPrint(
          seq,
          darkTs,
          darkSymbol,
          darkPrice,
          darkSize,
          DARK_EXCHANGE,
          true
        );
        void handlers.onTrade(darkPrint);

        darkStep += 1;
        if (darkStep >= DARK_SEQUENCE.length) {
          darkStep = 0;
          darkSymbolIndex += 1;
        }

        for (let i = 0; i < batchSize; i += 1) {
          seq += 1;
          const symbol = SP500_SYMBOLS[(seq + i) % SP500_SYMBOLS.length];
          const symbolHash = hashSymbol(symbol);
          const basePrice = 25 + (symbolHash % 475);
          const mid = formatPrice(basePrice + ((seq % 40) - 20) * 0.05);
          const quote = buildQuoteFromMid(mid);
          const placement: PricePlacement =
            seq % 11 === 0 ? "A" : seq % 13 === 0 ? "B" : "MID";
          const price = priceForPlacement(mid, quote, placement);
          const size = 10 + (seq % 600);
          const exchange = EXCHANGES[(seq + symbolHash) % EXCHANGES.length];
          const offExchangeFlag = (seq + i) % 6 === 0;
          const eventTs = now + i * 4;

          if (handlers.onQuote) {
            quoteSeq += 1;
            const quoteEventTs = eventTs - 2;
            const quoteEvent = buildSyntheticQuote(quoteSeq, quoteEventTs, symbol, quote.bid, quote.ask);
            void handlers.onQuote(quoteEvent);
          }

          const print = buildSyntheticPrint(seq, eventTs, symbol, price, size, exchange, offExchangeFlag);
          void handlers.onTrade(print);
        }
      };

      timer = setInterval(emit, config.emitIntervalMs);

      return () => {
        stopped = true;
        if (timer) {
          clearInterval(timer);
        }
      };
    }
  };
};
