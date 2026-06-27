import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import {
  type FlowHypothesisType,
  type FlowPacket,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type SmartFlowExplainabilityProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import { createSmartFlowSupportResolver } from "../src/smart-flow-support-resolver";

const clickhouse = {} as ClickHouseClient;

const makePacket = (overrides: Partial<FlowPacket> = {}): FlowPacket =>
  ({
    source_ts: 1_000,
    ingest_ts: 1_001,
    seq: 1,
    trace_id: "flowpacket:trace:1",
    id: "flowpacket:1",
    members: ["print:1"],
    features: { option_contract_id: "SPY-2025-01-17-450-C" },
    join_quality: {},
    ...overrides
  }) as FlowPacket;

const makeProjection = ({
  packetIds = ["flowpacket:1"],
  printIds = ["print:1"],
  confidence = 0.76,
  evidenceQuality = 0.84,
  abstained = false,
  hypothesisType = "directional_accumulation",
  seq = 2,
  sourceTs = 1_010
}: {
  packetIds?: string[];
  printIds?: string[];
  confidence?: number;
  evidenceQuality?: number;
  abstained?: boolean;
  hypothesisType?: FlowHypothesisType;
  seq?: number;
  sourceTs?: number;
} = {}): SmartFlowExplainabilityProjection => {
  const clusterId = `cluster:SPY:${sourceTs}:${sourceTs + 60_000}:${seq}`;
  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: sourceTs,
    ingest_ts: sourceTs + 1,
    seq,
    trace_id: `smartflow:hypothesis:${clusterId}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: `smartflow:hypothesis:${clusterId}`,
    hypothesis_id: `hypothesis:${clusterId}`,
    cluster_id: clusterId,
    candidate_ids: packetIds.map((packetId) => `candidate:${packetId}`),
    underlying_id: "SPY",
    hypothesis_type: hypothesisType,
    direction: "bullish",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: hypothesisType,
      direction: "bullish",
      evidence_strength: evidenceQuality,
      fit_score: confidence,
      penalty_score: 0,
      penalties: [],
      confidence: {
        policy_confidence: confidence,
        evidence_quality: evidenceQuality,
        hypothesis_margin: Math.min(1, confidence / 2),
        conviction: confidence,
        calibration_version: null
      }
    },
    alternatives: [],
    abstention: {
      abstained,
      reasons: abstained ? ["below_policy_threshold"] : ["not_abstained"],
      source_reasons: abstained ? ["policy confidence is too low"] : []
    },
    evidence_refs: [...packetIds, ...printIds],
    generated_from: "flow_evidence_cluster"
  });
};

describe("smart-flow support resolver", () => {
  it("resolves direct option-print refs without packet context", async () => {
    const projection = makeProjection({ packetIds: [], printIds: ["print:direct"] });
    const resolver = createSmartFlowSupportResolver({
      deps: {
        fetchFlowPacketsByMemberTraceIds: async (_client, traceIds) => {
          expect(traceIds).toEqual(["print:direct"]);
          return [];
        },
        fetchSmartFlowExplainabilityByEvidenceRefs: async (_client, refs) => {
          expect(refs).toEqual(["print:direct"]);
          return [projection];
        }
      }
    });

    const result = await resolver.resolve(clickhouse, { optionTraceIds: ["print:direct"] });
    const support = result.supportByTraceId.get("print:direct");

    expect(support?.packet).toBeNull();
    expect(support?.smart_flow_status).toBe("matched");
    expect(support?.smart_flow?.match_source).toBe("direct_print");
    expect(support?.smart_flow?.tint_eligible).toBe(true);
    expect(result.smartFlowProjections.map((item) => item.trace_id)).toEqual([projection.trace_id]);
  });

  it("hydrates missing packet membership and resolves durable packet projections", async () => {
    const packet = makePacket();
    const projection = makeProjection({ packetIds: [packet.id], printIds: [] });
    const resolver = createSmartFlowSupportResolver({
      deps: {
        fetchFlowPacketsByMemberTraceIds: async (_client, traceIds) => {
          expect(traceIds).toEqual(["print:1"]);
          return [packet];
        },
        fetchSmartFlowExplainabilityByEvidenceRefs: async (_client, refs) => {
          expect(refs).toEqual(["print:1", "flowpacket:1"]);
          return [projection];
        }
      }
    });

    const result = await resolver.resolve(clickhouse, { optionTraceIds: ["print:1"] });
    const support = result.supportByTraceId.get("print:1");

    expect(support?.packet?.id).toBe("flowpacket:1");
    expect(support?.smart_flow_status).toBe("matched");
    expect(support?.smart_flow?.match_source).toBe("packet_member");
    expect(support?.smart_flow?.packet_id).toBe("flowpacket:1");
  });

  it("uses hot context first and reuses positive cache hits", async () => {
    const packet = makePacket();
    const projection = makeProjection({ packetIds: [packet.id] });
    let packetLookupCount = 0;
    let projectionLookupCount = 0;
    const resolver = createSmartFlowSupportResolver({
      deps: {
        fetchFlowPacketsByMemberTraceIds: async () => {
          packetLookupCount += 1;
          return [];
        },
        fetchSmartFlowExplainabilityByEvidenceRefs: async () => {
          projectionLookupCount += 1;
          return [];
        }
      }
    });

    const first = await resolver.resolve(clickhouse, {
      optionTraceIds: ["print:1"],
      hotPackets: [packet],
      hotSmartFlowProjections: [projection]
    });
    const second = await resolver.resolve(clickhouse, { optionTraceIds: ["print:1"] });

    expect(first.supportByTraceId.get("print:1")?.smart_flow_status).toBe("matched");
    expect(second.supportByTraceId.get("print:1")?.smart_flow_status).toBe("matched");
    expect(packetLookupCount).toBe(0);
    expect(projectionLookupCount).toBe(0);
  });

  it("caches packet and projection misses to avoid repeated request storms", async () => {
    let packetLookupCount = 0;
    let projectionLookupCount = 0;
    const resolver = createSmartFlowSupportResolver({
      deps: {
        fetchFlowPacketsByMemberTraceIds: async () => {
          packetLookupCount += 1;
          return [];
        },
        fetchSmartFlowExplainabilityByEvidenceRefs: async () => {
          projectionLookupCount += 1;
          return [];
        }
      }
    });

    const first = await resolver.resolve(clickhouse, { optionTraceIds: ["print:missing"] });
    const second = await resolver.resolve(clickhouse, { optionTraceIds: ["print:missing"] });

    expect(first.supportByTraceId.get("print:missing")?.smart_flow_status).toBe(
      "packet_unavailable"
    );
    expect(second.supportByTraceId.get("print:missing")?.smart_flow_status).toBe(
      "packet_unavailable"
    );
    expect(packetLookupCount).toBe(1);
    expect(projectionLookupCount).toBe(1);
  });

  it("bounds lookup batches to the configured trace limit", async () => {
    const resolver = createSmartFlowSupportResolver({
      maxTraceIds: 2,
      deps: {
        fetchFlowPacketsByMemberTraceIds: async (_client, traceIds) => {
          expect(traceIds).toEqual(["print:1", "print:2"]);
          return [];
        },
        fetchSmartFlowExplainabilityByEvidenceRefs: async (_client, refs) => {
          expect(refs).toEqual(["print:1", "print:2"]);
          return [];
        }
      }
    });

    const result = await resolver.resolve(clickhouse, {
      optionTraceIds: ["print:1", "print:2", "print:3"]
    });

    expect(Array.from(result.supportByTraceId.keys())).toEqual(["print:1", "print:2"]);
  });

  it("selects the highest-confidence non-abstained projection and gates unclear tinting", async () => {
    const packet = makePacket();
    const abstained = makeProjection({
      packetIds: [packet.id],
      confidence: 0.99,
      abstained: true,
      seq: 10
    });
    const eligible = makeProjection({
      packetIds: [packet.id],
      confidence: 0.72,
      seq: 11
    });
    const unclear = makeProjection({
      packetIds: [packet.id],
      confidence: 0.9,
      hypothesisType: "unclear",
      seq: 12
    });
    const resolver = createSmartFlowSupportResolver({
      deps: {
        fetchFlowPacketsByMemberTraceIds: async () => [packet],
        fetchSmartFlowExplainabilityByEvidenceRefs: async () => [abstained, eligible, unclear]
      }
    });

    const result = await resolver.resolve(clickhouse, { optionTraceIds: ["print:1"] });
    const support = result.supportByTraceId.get("print:1");

    expect(support?.smart_flow?.projection_trace_id).toBe(unclear.trace_id);
    expect(support?.smart_flow?.hypothesis_type).toBe("unclear");
    expect(support?.smart_flow?.abstained).toBe(false);
    expect(support?.smart_flow?.tint_eligible).toBe(false);
  });

  it("preserves explicit unavailable states", async () => {
    const packet = makePacket({ members: ["print:packet-only"] });
    const unrelated = makeProjection({
      packetIds: ["flowpacket:other"],
      printIds: ["print:other"]
    });
    const resolver = createSmartFlowSupportResolver({
      deps: {
        fetchFlowPacketsByMemberTraceIds: async (_client, traceIds) =>
          traceIds.includes("print:packet-only") ? [packet] : [],
        fetchSmartFlowExplainabilityByEvidenceRefs: async () => []
      }
    });

    const packetUnavailable = await resolver.resolve(clickhouse, {
      optionTraceIds: ["print:no-packet"]
    });
    const smartFlowUnavailable = await resolver.resolve(clickhouse, {
      optionTraceIds: ["print:packet-only"]
    });
    const noMatching = await resolver.resolve(clickhouse, {
      optionTraceIds: ["print:unrelated"],
      hotSmartFlowProjections: [unrelated],
      allowStorageFallback: false
    });

    expect(packetUnavailable.supportByTraceId.get("print:no-packet")?.smart_flow_status).toBe(
      "packet_unavailable"
    );
    expect(smartFlowUnavailable.supportByTraceId.get("print:packet-only")?.smart_flow_status).toBe(
      "smart_flow_unavailable"
    );
    expect(noMatching.supportByTraceId.get("print:unrelated")?.smart_flow_status).toBe(
      "no_matching_projection"
    );
  });
});
