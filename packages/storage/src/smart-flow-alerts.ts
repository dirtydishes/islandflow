import { type SmartFlowAlertEvent, SmartFlowAlertEventSchema } from "@islandflow/types";

export const SMART_FLOW_ALERTS_TABLE = "smart_flow_alerts";

export type SmartFlowAlertRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  schema_version: string;
  alert_id: string;
  hypothesis_id: string;
  insight_id: string;
  underlying_id: string;
  hypothesis_type: string;
  direction: string;
  policy_confidence: number;
  evidence_quality: number;
  trigger_kind: string;
  projection_trace_id: string;
  evidence_refs: string[];
  alert_json: string;
};

export const smartFlowAlertsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${SMART_FLOW_ALERTS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  schema_version String,
  alert_id String,
  hypothesis_id String,
  insight_id String,
  underlying_id String,
  hypothesis_type String,
  direction String,
  policy_confidence Float64,
  evidence_quality Float64,
  trigger_kind String,
  projection_trace_id String,
  evidence_refs Array(String),
  alert_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq, alert_id)
`;
};

export const toSmartFlowAlertRecord = (alert: SmartFlowAlertEvent): SmartFlowAlertRecord => {
  const parsed = SmartFlowAlertEventSchema.parse(alert);
  return {
    source_ts: parsed.source_ts,
    ingest_ts: parsed.ingest_ts,
    seq: parsed.seq,
    trace_id: parsed.trace_id,
    schema_version: parsed.schema_version,
    alert_id: parsed.alert_id,
    hypothesis_id: parsed.hypothesis_id,
    insight_id: parsed.insight_id,
    underlying_id: parsed.underlying_id,
    hypothesis_type: parsed.hypothesis_type,
    direction: parsed.direction,
    policy_confidence: parsed.policy_confidence,
    evidence_quality: parsed.evidence_quality,
    trigger_kind: parsed.trigger.kind,
    projection_trace_id: parsed.trigger.projection_trace_id,
    evidence_refs: parsed.evidence_refs,
    alert_json: JSON.stringify(parsed)
  };
};

export const fromSmartFlowAlertRecord = (record: SmartFlowAlertRecord): SmartFlowAlertEvent => {
  return SmartFlowAlertEventSchema.parse(JSON.parse(record.alert_json));
};
