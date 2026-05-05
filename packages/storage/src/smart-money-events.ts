import type { SmartMoneyEvent } from "@islandflow/types";

export const SMART_MONEY_EVENTS_TABLE = "smart_money_events";

export type SmartMoneyEventRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  event_id: string;
  packet_ids: string[];
  member_print_ids: string[];
  underlying_id: string;
  event_kind: string;
  event_window_ms: number;
  features_json: string;
  profile_scores_json: string;
  primary_profile_id: string;
  primary_direction: string;
  abstained: boolean;
  suppressed_reasons_json: string;
};

export const smartMoneyEventsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${SMART_MONEY_EVENTS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  event_id String,
  packet_ids Array(String),
  member_print_ids Array(String),
  underlying_id String,
  event_kind String,
  event_window_ms UInt64,
  features_json String,
  profile_scores_json String,
  primary_profile_id String,
  primary_direction String,
  abstained Bool,
  suppressed_reasons_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toSmartMoneyEventRecord = (event: SmartMoneyEvent): SmartMoneyEventRecord => {
  return {
    source_ts: event.source_ts,
    ingest_ts: event.ingest_ts,
    seq: event.seq,
    trace_id: event.trace_id,
    event_id: event.event_id,
    packet_ids: event.packet_ids,
    member_print_ids: event.member_print_ids,
    underlying_id: event.underlying_id,
    event_kind: event.event_kind,
    event_window_ms: event.event_window_ms,
    features_json: JSON.stringify(event.features),
    profile_scores_json: JSON.stringify(event.profile_scores),
    primary_profile_id: event.primary_profile_id ?? "",
    primary_direction: event.primary_direction,
    abstained: event.abstained,
    suppressed_reasons_json: JSON.stringify(event.suppressed_reasons)
  };
};

const safeJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const fromSmartMoneyEventRecord = (record: SmartMoneyEventRecord): SmartMoneyEvent => {
  const primaryProfileId = record.primary_profile_id.trim();
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    event_id: record.event_id,
    packet_ids: record.packet_ids,
    member_print_ids: record.member_print_ids,
    underlying_id: record.underlying_id,
    event_kind: record.event_kind as SmartMoneyEvent["event_kind"],
    event_window_ms: record.event_window_ms,
    features: safeJson(record.features_json, {} as SmartMoneyEvent["features"]),
    profile_scores: safeJson(record.profile_scores_json, [] as SmartMoneyEvent["profile_scores"]),
    primary_profile_id: primaryProfileId
      ? (primaryProfileId as SmartMoneyEvent["primary_profile_id"])
      : null,
    primary_direction: record.primary_direction as SmartMoneyEvent["primary_direction"],
    abstained: Boolean(record.abstained),
    suppressed_reasons: safeJson(record.suppressed_reasons_json, [] as string[])
  };
};
