import type { ClassifierHitEvent } from "@islandflow/types";

export const CLASSIFIER_HITS_TABLE = "classifier_hits";

export type ClassifierHitRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  classifier_id: string;
  confidence: number;
  direction: string;
  explanations_json: string;
};

export const classifierHitsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${CLASSIFIER_HITS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  classifier_id String,
  confidence Float64,
  direction String,
  explanations_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toClassifierHitRecord = (hit: ClassifierHitEvent): ClassifierHitRecord => {
  return {
    source_ts: hit.source_ts,
    ingest_ts: hit.ingest_ts,
    seq: hit.seq,
    trace_id: hit.trace_id,
    classifier_id: hit.classifier_id,
    confidence: hit.confidence,
    direction: hit.direction,
    explanations_json: JSON.stringify(hit.explanations)
  };
};

const safeJsonArray = (value: string): string[] => {
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

export const fromClassifierHitRecord = (record: ClassifierHitRecord): ClassifierHitEvent => {
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    classifier_id: record.classifier_id,
    confidence: record.confidence,
    direction: record.direction,
    explanations: safeJsonArray(record.explanations_json)
  };
};
