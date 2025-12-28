import type { EquityPrint } from "@islandflow/types";

export const EQUITY_PRINTS_TABLE = "equity_prints";

export const equityPrintsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${EQUITY_PRINTS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  ts UInt64,
  underlying_id String,
  price Float64,
  size UInt32,
  exchange String,
  offExchangeFlag Bool
)
ENGINE = MergeTree
ORDER BY (ts, underlying_id)
`;
};

export const normalizeEquityPrint = (print: EquityPrint): EquityPrint => {
  return print;
};
