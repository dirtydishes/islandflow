import type { EquityCandle } from "@islandflow/types";

export const EQUITY_CANDLES_TABLE = "equity_candles";

export const equityCandlesTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${EQUITY_CANDLES_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  ts UInt64,
  interval_ms UInt32,
  underlying_id String,
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume UInt64,
  trade_count UInt32
)
ENGINE = MergeTree
ORDER BY (underlying_id, interval_ms, ts)
`;
};

export const normalizeEquityCandle = (candle: EquityCandle): EquityCandle => {
  return candle;
};
