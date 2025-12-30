import type { OptionNBBO } from "@islandflow/types";

export const OPTION_NBBO_TABLE = "option_nbbo";

export const optionNBBOTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${OPTION_NBBO_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  ts UInt64,
  option_contract_id String,
  bid Float64,
  ask Float64,
  bidSize UInt32,
  askSize UInt32
)
ENGINE = MergeTree
ORDER BY (ts, option_contract_id)
`;
};

export const normalizeOptionNBBO = (nbbo: OptionNBBO): OptionNBBO => {
  return nbbo;
};
