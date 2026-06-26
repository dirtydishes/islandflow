import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type FlowPacket,
  type SmartFlowExplainabilityProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import { lookupOptionsSupport } from "../src/options-support";

const clickhouse = {} as ClickHouseClient;

const makePacket = (): FlowPacket =>
  ({
    source_ts: 1_000,
    ingest_ts: 1_001,
    seq: 1,
    trace_id: "flowpacket:trace:1",
    id: "flowpacket:1",
    members: ["print:1"],
    features: { option_contract_id: "SPY-2025-01-17-450-C" },
    join_quality: {}
  }) as FlowPacket;

const makeSmartFlowProjection = (packet: FlowPacket): SmartFlowExplainabilityProjection => {
  const sourceTs = 1_010;
  const clusterId = `cluster:SPY:${sourceTs}:${sourceTs + 60_000}`;
  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: sourceTs,
    ingest_ts: sourceTs + 1,
    seq: 2,
    trace_id: `smartflow:hypothesis:${clusterId}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: `smartflow:hypothesis:${clusterId}`,
    hypothesis_id: `hypothesis:${clusterId}`,
    cluster_id: clusterId,
    candidate_ids: [`candidate:${packet.id}`],
    underlying_id: "SPY",
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: "directional_accumulation",
      direction: "bullish",
      evidence_strength: 0.8,
      fit_score: 0.72,
      penalty_score: 0,
      penalties: [],
      confidence: {
        policy_confidence: 0.76,
        evidence_quality: 0.84,
        hypothesis_margin: 0.28,
        conviction: 0.72,
        calibration_version: null
      }
    },
    alternatives: [],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: [packet.id, ...packet.members],
    generated_from: "flow_evidence_cluster"
  });
};

describe("options support lookup", () => {
  it("projects canonical smart_flow beside packet and nbbo support", async () => {
    const packet = makePacket();
    const smartFlow = makeSmartFlowProjection(packet);
    const payload = await lookupOptionsSupport(
      clickhouse,
      {
        trace_ids: ["print:1"],
        nbbo_context: [{ trace_id: "print:1", option_contract_id: "SPY-2025-01-17-450-C", ts: 1 }]
      },
      {
        fetchFlowPacketsByMemberTraceIds: async (_client, traceIds) => {
          expect(traceIds).toEqual(["print:1"]);
          return [packet];
        },
        fetchSmartFlowExplainabilityByPacketIds: async (_client, packetIds) => {
          expect(packetIds).toEqual(["flowpacket:1"]);
          return [smartFlow];
        },
        fetchNearestOptionNBBOForPrints: async (_client, inputs) => {
          expect(inputs.map((item) => item.trace_id)).toEqual(["print:1"]);
          return { "print:1": null };
        }
      }
    );

    expect(payload.packets.map((item) => item.id)).toEqual(["flowpacket:1"]);
    expect(payload.smart_flow).toHaveLength(1);
    expect(payload.smart_flow[0]?.source_channel).toBe("smart-flow");
    expect(payload.smart_flow[0]?.refs.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
    expect(payload.nbbo_by_trace_id).toEqual({ "print:1": null });
  });

  it("starts independent nbbo lookup without waiting for packet support", async () => {
    const packet = makePacket();
    const smartFlow = makeSmartFlowProjection(packet);
    let releasePacketLookup!: () => void;
    const packetLookupGate = new Promise<void>((resolve) => {
      releasePacketLookup = resolve;
    });
    let nbboStarted = false;

    const lookup = lookupOptionsSupport(
      clickhouse,
      {
        trace_ids: ["print:1"],
        nbbo_context: [{ trace_id: "print:1", option_contract_id: "SPY-2025-01-17-450-C", ts: 1 }]
      },
      {
        fetchFlowPacketsByMemberTraceIds: async () => {
          await packetLookupGate;
          return [packet];
        },
        fetchSmartFlowExplainabilityByPacketIds: async () => [smartFlow],
        fetchNearestOptionNBBOForPrints: async () => {
          nbboStarted = true;
          return { "print:1": null };
        }
      }
    );

    try {
      expect(nbboStarted).toBe(true);
    } finally {
      releasePacketLookup();
    }

    await expect(lookup).resolves.toMatchObject({
      packets: [packet],
      smart_flow: [smartFlow],
      nbbo_by_trace_id: { "print:1": null }
    });
  });
});
