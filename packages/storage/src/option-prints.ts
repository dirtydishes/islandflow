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
  conditions Array(String),
  underlying_id Nullable(String),
  option_type Nullable(String),
  notional Nullable(Float64),
  nbbo_side Nullable(String),
  is_etf Nullable(Bool),
  signal_pass Nullable(Bool),
  signal_reasons Array(String) DEFAULT [],
  signal_profile Nullable(String)
)
ENGINE = MergeTree
ORDER BY (ts, option_contract_id)
`;
};

export const optionPrintsTableMigrations = (): string[] => {
  return [
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS underlying_id Nullable(String)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS option_type Nullable(String)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS notional Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS nbbo_side Nullable(String)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS is_etf Nullable(Bool)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS signal_pass Nullable(Bool)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS signal_reasons Array(String) DEFAULT []`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS signal_profile Nullable(String)`
  ];
};

export const normalizeOptionPrint = (print: OptionPrint): OptionPrint => {
  return {
    ...print,
    conditions: print.conditions ?? [],
    signal_reasons: print.signal_reasons ?? []
  };
};
