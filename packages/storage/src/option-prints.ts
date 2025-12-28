import type { OptionPrint } from "@islandflow/types";

export const OPTION_PRINTS_TABLE = "option_prints";

export const optionPrintsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${OPTION_PRINTS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  ts UInt64,
  option_contract_id String,
  price Float64,
  size UInt32,
  exchange String,
  conditions Array(String)
)
ENGINE = MergeTree
ORDER BY (ts, option_contract_id)
`;
};

export const normalizeOptionPrint = (print: OptionPrint): OptionPrint => {
  return {
    ...print,
    conditions: print.conditions ?? []
  };
};
