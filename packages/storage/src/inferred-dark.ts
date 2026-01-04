import type { InferredDarkEvent } from "@islandflow/types";

export const INFERRED_DARK_TABLE = "inferred_dark";

export type InferredDarkRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  type: string;
  confidence: number;
  evidence_refs_json: string;
};

export const inferredDarkTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${INFERRED_DARK_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  type String,
  confidence Float64,
  evidence_refs_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toInferredDarkRecord = (event: InferredDarkEvent): InferredDarkRecord => {
  return {
    source_ts: event.source_ts,
    ingest_ts: event.ingest_ts,
    seq: event.seq,
    trace_id: event.trace_id,
    type: event.type,
    confidence: event.confidence,
    evidence_refs_json: JSON.stringify(event.evidence_refs)
  };
};

const safeStringArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry));
    }
  } catch {
    // ignore
  }

  return [];
};

export const fromInferredDarkRecord = (record: InferredDarkRecord): InferredDarkEvent => {
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    type: record.type,
    confidence: record.confidence,
    evidence_refs: safeStringArray(record.evidence_refs_json)
  };
};
