import type { AlertEvent, ClassifierHit, SmartMoneyProfileScore } from "@islandflow/types";

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
  primary_profile_id: string;
  profile_scores_json: string;
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
  evidence_refs_json String,
  primary_profile_id String DEFAULT '',
  profile_scores_json String DEFAULT '[]'
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const alertsTableMigrations = (): string[] => [
  `ALTER TABLE ${ALERTS_TABLE} ADD COLUMN IF NOT EXISTS primary_profile_id String DEFAULT ''`,
  `ALTER TABLE ${ALERTS_TABLE} ADD COLUMN IF NOT EXISTS profile_scores_json String DEFAULT '[]'`
];

export const toAlertRecord = (alert: AlertEvent): AlertRecord => {
  return {
    source_ts: alert.source_ts,
    ingest_ts: alert.ingest_ts,
    seq: alert.seq,
    trace_id: alert.trace_id,
    score: alert.score,
    severity: alert.severity,
    hits_json: JSON.stringify(alert.hits),
    evidence_refs_json: JSON.stringify(alert.evidence_refs),
    primary_profile_id: alert.primary_profile_id ?? "",
    profile_scores_json: JSON.stringify(alert.profile_scores ?? [])
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

const safeProfileScoreArray = (value: string): SmartMoneyProfileScore[] => {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => {
        const record = entry as Partial<SmartMoneyProfileScore>;
        return {
          profile_id: String(record.profile_id ?? "") as SmartMoneyProfileScore["profile_id"],
          probability: Number(record.probability ?? 0),
          confidence_band: String(record.confidence_band ?? "low") as SmartMoneyProfileScore["confidence_band"],
          direction: String(record.direction ?? "unknown") as SmartMoneyProfileScore["direction"],
          reasons: Array.isArray(record.reasons) ? record.reasons.map((item) => String(item)) : []
        };
      });
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
    evidence_refs: safeStringArray(record.evidence_refs_json),
    ...(record.primary_profile_id ? { primary_profile_id: record.primary_profile_id as AlertEvent["primary_profile_id"] } : {}),
    profile_scores: safeProfileScoreArray(record.profile_scores_json)
  };
};
