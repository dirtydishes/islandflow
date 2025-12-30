import { SP500_SYMBOLS, type EquityPrint } from "@islandflow/types";
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

export const createSyntheticEquitiesAdapter = (
  config: SyntheticEquitiesAdapterConfig
): EquityIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: EquityIngestHandlers) => {
      let seq = 0;
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
          const print = buildSyntheticPrint(seq, now + i * 4, symbol, price, size, exchange, offExchangeFlag);
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
