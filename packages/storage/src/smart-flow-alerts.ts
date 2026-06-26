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
ORDER BY (source_ts, seq)
`;
};

export const toSmartFlowAlertRecord = (alert: SmartFlowAlertEvent): SmartFlowAlertRecord => {
  return {
    source_ts: alert.source_ts,
    ingest_ts: alert.ingest_ts,
    seq: alert.seq,
    trace_id: alert.trace_id,
    schema_version: alert.schema_version,
    alert_id: alert.alert_id,
    hypothesis_id: alert.hypothesis_id,
    insight_id: alert.insight_id,
    underlying_id: alert.underlying_id,
    hypothesis_type: alert.hypothesis_type,
    direction: alert.direction,
    policy_confidence: alert.policy_confidence,
    evidence_quality: alert.evidence_quality,
    trigger_kind: alert.trigger.kind,
    projection_trace_id: alert.trigger.projection_trace_id,
    evidence_refs: alert.evidence_refs,
    alert_json: JSON.stringify(alert)
  };
};

export const fromSmartFlowAlertRecord = (record: SmartFlowAlertRecord): SmartFlowAlertEvent => {
  return SmartFlowAlertEventSchema.parse(JSON.parse(record.alert_json));
};
