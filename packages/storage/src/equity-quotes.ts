import type { EquityQuote } from "@islandflow/types";

export const EQUITY_QUOTES_TABLE = "equity_quotes";

export const equityQuotesTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${EQUITY_QUOTES_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  ts UInt64,
  underlying_id String,
  bid Float64,
  ask Float64
)
ENGINE = MergeTree
ORDER BY (ts, underlying_id)
`;
};

export const normalizeEquityQuote = (quote: EquityQuote): EquityQuote => {
  return quote;
};
