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
  execution_nbbo_bid Nullable(Float64),
  execution_nbbo_ask Nullable(Float64),
  execution_nbbo_mid Nullable(Float64),
  execution_nbbo_spread Nullable(Float64),
  execution_nbbo_bid_size Nullable(UInt32),
  execution_nbbo_ask_size Nullable(UInt32),
  execution_nbbo_ts Nullable(UInt64),
  execution_nbbo_age_ms Nullable(Float64),
  execution_nbbo_side Nullable(String),
  execution_underlying_spot Nullable(Float64),
  execution_underlying_bid Nullable(Float64),
  execution_underlying_ask Nullable(Float64),
  execution_underlying_mid Nullable(Float64),
  execution_underlying_spread Nullable(Float64),
  execution_underlying_ts Nullable(UInt64),
  execution_underlying_age_ms Nullable(Float64),
  execution_underlying_source Nullable(String),
  execution_iv Nullable(Float64),
  execution_iv_source Nullable(String),
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
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_bid Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_ask Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_mid Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_spread Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_bid_size Nullable(UInt32)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_ask_size Nullable(UInt32)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_ts Nullable(UInt64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_age_ms Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_nbbo_side Nullable(String)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_spot Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_bid Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_ask Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_mid Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_spread Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_ts Nullable(UInt64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_age_ms Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_underlying_source Nullable(String)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_iv Nullable(Float64)`,
    `ALTER TABLE ${OPTION_PRINTS_TABLE} ADD COLUMN IF NOT EXISTS execution_iv_source Nullable(String)`,
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
