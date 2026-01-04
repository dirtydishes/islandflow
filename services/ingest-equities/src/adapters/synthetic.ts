import { SP500_SYMBOLS, type EquityPrint, type EquityQuote } from "@islandflow/types";
import type { EquityIngestAdapter, EquityIngestHandlers } from "./types";

type SyntheticEquitiesAdapterConfig = {
  emitIntervalMs: number;
};

const EXCHANGES = ["NYSE", "NASDAQ", "ARCA", "BATS", "IEX", "TEST"];

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

export const createSyntheticEquitiesAdapter = (
  config: SyntheticEquitiesAdapterConfig
): EquityIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: EquityIngestHandlers) => {
      let seq = 0;
      let quoteSeq = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      let stopped = false;

      const emit = () => {
        if (stopped) {
          return;
        }

        const now = Date.now();
        const batchSize = 3;

        for (let i = 0; i < batchSize; i += 1) {
          seq += 1;
          const symbol = SP500_SYMBOLS[(seq + i) % SP500_SYMBOLS.length];
          const symbolHash = hashSymbol(symbol);
          const basePrice = 25 + (symbolHash % 475);
          const price = Number((basePrice + ((seq % 40) - 20) * 0.05).toFixed(2));
          const size = 10 + (seq % 600);
          const exchange = EXCHANGES[(seq + symbolHash) % EXCHANGES.length];
          const offExchangeFlag = (seq + i) % 6 === 0;
          const eventTs = now + i * 4;
          const print = buildSyntheticPrint(seq, eventTs, symbol, price, size, exchange, offExchangeFlag);
          void handlers.onTrade(print);

          if (handlers.onQuote) {
            quoteSeq += 1;
            const spread = Math.max(0.02, Number((price * 0.002).toFixed(2)));
            const bid = Math.max(0.01, Number((price - spread / 2).toFixed(2)));
            const ask = Math.max(bid + 0.01, Number((price + spread / 2).toFixed(2)));
            const quote = buildSyntheticQuote(quoteSeq, eventTs, symbol, bid, ask);
            void handlers.onQuote(quote);
          }
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
