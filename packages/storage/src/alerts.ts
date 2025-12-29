import type { AlertEvent, ClassifierHit } from "@islandflow/types";

export const ALERTS_TABLE = "alerts";

export type AlertRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  score: number;
  severity: string;
  hits_json: string;
  evidence_refs_json: string;
};

export const alertsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${ALERTS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  score Float64,
  severity String,
  hits_json String,
  evidence_refs_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toAlertRecord = (alert: AlertEvent): AlertRecord => {
  return {
    source_ts: alert.source_ts,
    ingest_ts: alert.ingest_ts,
    seq: alert.seq,
    trace_id: alert.trace_id,
    score: alert.score,
    severity: alert.severity,
    hits_json: JSON.stringify(alert.hits),
    evidence_refs_json: JSON.stringify(alert.evidence_refs)
  };
};

const safeHitArray = (value: string): ClassifierHit[] => {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => {
        const record = entry as Partial<ClassifierHit>;
        return {
          classifier_id: String(record.classifier_id ?? ""),
          confidence: Number(record.confidence ?? 0),
          direction: String(record.direction ?? ""),
          explanations: Array.isArray(record.explanations)
            ? record.explanations.map((item) => String(item))
            : []
        };
      });
    }
  } catch {
    // ignore
  }

  return [];
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

export const fromAlertRecord = (record: AlertRecord): AlertEvent => {
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    score: record.score,
    severity: record.severity,
    hits: safeHitArray(record.hits_json),
    evidence_refs: safeStringArray(record.evidence_refs_json)
  };
};
