import type { EquityPrintJoin } from "@islandflow/types";

export const EQUITY_PRINT_JOINS_TABLE = "equity_print_joins";

export type EquityPrintJoinRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  id: string;
  print_trace_id: string;
  quote_trace_id: string;
  features_json: string;
  join_quality_json: string;
};

export const equityPrintJoinsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${EQUITY_PRINT_JOINS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  id String,
  print_trace_id String,
  quote_trace_id String,
  features_json String,
  join_quality_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toEquityPrintJoinRecord = (join: EquityPrintJoin): EquityPrintJoinRecord => {
  return {
    source_ts: join.source_ts,
    ingest_ts: join.ingest_ts,
    seq: join.seq,
    trace_id: join.trace_id,
    id: join.id,
    print_trace_id: join.print_trace_id,
    quote_trace_id: join.quote_trace_id,
    features_json: JSON.stringify(join.features),
    join_quality_json: JSON.stringify(join.join_quality)
  };
};

const safeJson = (value: string, fallback: Record<string, unknown>): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }

  return fallback;
};

export const fromEquityPrintJoinRecord = (record: EquityPrintJoinRecord): EquityPrintJoin => {
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    id: record.id,
    print_trace_id: record.print_trace_id,
    quote_trace_id: record.quote_trace_id,
    features: safeJson(record.features_json, {}),
    join_quality: safeJson(record.join_quality_json, {}) as Record<string, number>
  };
};
