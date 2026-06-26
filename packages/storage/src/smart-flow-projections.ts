import {
  SmartFlowExplainabilityProjectionSchema,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";

export const SMART_FLOW_PROJECTIONS_TABLE = "smart_flow_projections";

export type SmartFlowProjectionRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  projection_version: string;
  source_channel: string;
  hypothesis_id: string;
  cluster_id: string;
  underlying_id: string;
  candidate_ids: string[];
  evidence_refs: string[];
  abstained: boolean;
  projection_json: string;
};

export const smartFlowProjectionsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${SMART_FLOW_PROJECTIONS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  projection_version String,
  source_channel String,
  hypothesis_id String,
  cluster_id String,
  underlying_id String,
  candidate_ids Array(String),
  evidence_refs Array(String),
  abstained Bool,
  projection_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toSmartFlowProjectionRecord = (
  projection: SmartFlowExplainabilityProjection
): SmartFlowProjectionRecord => {
  return {
    source_ts: projection.source_ts,
    ingest_ts: projection.ingest_ts,
    seq: projection.seq,
    trace_id: projection.trace_id,
    projection_version: projection.projection_version,
    source_channel: projection.source_channel,
    hypothesis_id: projection.refs.hypothesis_id,
    cluster_id: projection.refs.cluster_id,
    underlying_id: projection.hypothesis.underlying_id,
    candidate_ids: projection.refs.candidate_ids,
    evidence_refs: projection.refs.evidence_refs,
    abstained: projection.abstention.abstained,
    projection_json: JSON.stringify(projection)
  };
};

export const fromSmartFlowProjectionRecord = (
  record: SmartFlowProjectionRecord
): SmartFlowExplainabilityProjection => {
  return SmartFlowExplainabilityProjectionSchema.parse(JSON.parse(record.projection_json));
};
