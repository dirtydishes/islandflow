import type { FlowPacket } from "@islandflow/types";

export const buildFlowPacket = (
  opts: {
    id?: string;
    source_ts?: number;
    ingest_ts?: number;
    seq?: number;
    trace_id?: string;
    members?: string[];
    features?: FlowPacket["features"];
    join_quality?: FlowPacket["join_quality"];
  } = {}
): FlowPacket => {
  const id = opts.id ?? "flowpacket:test";
  const source_ts = opts.source_ts ?? Date.parse("2025-01-01T14:30:00Z");
  const ingest_ts = opts.ingest_ts ?? source_ts;
  const seq = opts.seq ?? 1;
  const trace_id = opts.trace_id ?? `trace:${id}`;

  return {
    source_ts,
    ingest_ts,
    seq,
    trace_id,
    id,
    members: opts.members ?? ["print:1", "print:2"],
    features: {
      count: 1,
      window_ms: 250,
      total_premium: 0,
      total_size: 0,
      first_price: 0,
      last_price: 0,
      total_premium_z: 0,
      total_size_z: 0,
      total_premium_baseline_n: 0,
      total_size_baseline_n: 0,
      nbbo_coverage_ratio: 0,
      nbbo_aggressive_buy_ratio: 0,
      nbbo_aggressive_sell_ratio: 0,
      underlying_mid: 0,
      ...opts.features
    },
    join_quality: {
      ...opts.join_quality
    }
  };
};
