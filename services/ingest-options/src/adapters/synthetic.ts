import type { OptionPrint } from "@islandflow/types";
import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type SyntheticOptionsAdapterConfig = {
  emitIntervalMs: number;
};

const buildSyntheticPrint = (seq: number, now: number): OptionPrint => {
  return {
    source_ts: now,
    ingest_ts: now,
    seq,
    trace_id: `ingest-options-${seq}`,
    ts: now,
    option_contract_id: "SPY-2025-01-17-450-C",
    price: 1.25,
    size: 10,
    exchange: "TEST",
    conditions: ["TEST"]
  };
};

export const createSyntheticOptionsAdapter = (
  config: SyntheticOptionsAdapterConfig
): OptionIngestAdapter => {
  return {
    name: "synthetic",
    start: (handlers: OptionIngestHandlers) => {
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
