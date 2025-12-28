import type { FlowPacket } from "@islandflow/types";

export const FLOW_PACKETS_TABLE = "flow_packets";

export type FlowPacketRecord = {
  source_ts: number;
  ingest_ts: number;
  seq: number;
  trace_id: string;
  id: string;
  members: string[];
  features_json: string;
  join_quality_json: string;
};

export const flowPacketsTableDDL = (): string => {
  return `
CREATE TABLE IF NOT EXISTS ${FLOW_PACKETS_TABLE} (
  source_ts UInt64,
  ingest_ts UInt64,
  seq UInt64,
  trace_id String,
  id String,
  members Array(String),
  features_json String,
  join_quality_json String
)
ENGINE = MergeTree
ORDER BY (source_ts, seq)
`;
};

export const toFlowPacketRecord = (packet: FlowPacket): FlowPacketRecord => {
  return {
    source_ts: packet.source_ts,
    ingest_ts: packet.ingest_ts,
    seq: packet.seq,
    trace_id: packet.trace_id,
    id: packet.id,
    members: packet.members,
    features_json: JSON.stringify(packet.features),
    join_quality_json: JSON.stringify(packet.join_quality)
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

export const fromFlowPacketRecord = (record: FlowPacketRecord): FlowPacket => {
  return {
    source_ts: record.source_ts,
    ingest_ts: record.ingest_ts,
    seq: record.seq,
    trace_id: record.trace_id,
    id: record.id,
    members: record.members,
    features: safeJson(record.features_json, {}),
    join_quality: safeJson(record.join_quality_json, {}) as Record<string, number>
  };
};
