import type { EquityPrint } from "@islandflow/types";
import type { EquityIngestAdapter, EquityIngestHandlers } from "./types";

type SyntheticEquitiesAdapterConfig = {
  emitIntervalMs: number;
};

const buildSyntheticPrint = (seq: number, now: number): EquityPrint => {
  return {
    source_ts: now,
    ingest_ts: now,
    seq,
    trace_id: `ingest-equities-${seq}`,
    ts: now,
    underlying_id: "SPY",
    price: 450.1,
    size: 100,
    exchange: "TEST",
    offExchangeFlag: false
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

        seq += 1;
        const now = Date.now();
        const print = buildSyntheticPrint(seq, now);
        void handlers.onTrade(print);
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
