import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import {
  type FlowPacket,
  type OptionNBBO,
  type OptionPrint,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type SmartFlowExplainabilityProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import {
  lookupOptionsSmartFlowTriageDetail,
  parseOptionsSmartFlowDetailParams
} from "../src/options-smart-flow-detail";
import { lookupOptionsSupport } from "../src/options-support";
import { resolveSmartFlowSupportFromContext } from "../src/smart-flow-support-resolver";

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

const makePrint = (overrides: Partial<OptionPrint> = {}): OptionPrint => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: "print:1",
  ts: 1_000,
  option_contract_id: "SPY-2025-01-17-450-C",
  price: 1.25,
  size: 100,
  exchange: "CBOE",
  option_type: "call",
  nbbo_side: "A",
  notional: 12_500,
  signal_pass: true,
  signal_profile: "smart-flow",
  ...overrides
});

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
        resolveSmartFlowSupport: async (_client, input) => {
          expect(input.optionTraceIds).toEqual(["print:1"]);
          return {
            supportByTraceId: resolveSmartFlowSupportFromContext({
              optionTraceIds: input.optionTraceIds,
              packets: [packet],
              projections: [smartFlow]
            }),
            packets: [packet],
            smartFlowProjections: [smartFlow],
            storageLookups: {
              packetTraceIds: ["print:1"],
              evidenceRefs: ["print:1", "flowpacket:1"]
            }
          };
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
    expect(payload.support_by_trace_id["print:1"]?.smart_flow_status).toBe("matched");
    expect(payload.support_by_trace_id["print:1"]?.smart_flow?.tint_eligible).toBe(true);
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
        resolveSmartFlowSupport: async (_client, input) => {
          await packetLookupGate;
          return {
            supportByTraceId: resolveSmartFlowSupportFromContext({
              optionTraceIds: input.optionTraceIds,
              packets: [packet],
              projections: [smartFlow]
            }),
            packets: [packet],
            smartFlowProjections: [smartFlow],
            storageLookups: {
              packetTraceIds: input.optionTraceIds,
              evidenceRefs: ["print:1", "flowpacket:1"]
            }
          };
        },
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
      support_by_trace_id: {
        "print:1": {
          smart_flow_status: "matched"
        }
      },
      nbbo_by_trace_id: { "print:1": null }
    });
  });
});

describe("options smart-flow triage detail", () => {
  it("parses bounded detail params", () => {
    const params = parseOptionsSmartFlowDetailParams(
      new URL(
        "http://localhost/options/smart-flow-detail?option_trace_id=print%3A1&projection_trace_id=smartflow%3A1&packet_id=flowpacket%3A1&option_contract_id=SPY-2025-01-17-450-C&packet_before_ts=500&packet_before_seq=5&contract_before_ts=400&contract_before_seq=4&packet_limit=8&contract_limit=9"
      )
    );

    expect(params).toMatchObject({
      optionTraceId: "print:1",
      projectionTraceId: "smartflow:1",
      packetId: "flowpacket:1",
      optionContractId: "SPY-2025-01-17-450-C",
      packetBefore: { ts: 500, seq: 5 },
      contractBefore: { ts: 400, seq: 4 },
      packetLimit: 8,
      contractLimit: 9
    });
  });

  it("returns projection detail plus bounded server-composed packet and contract rows", async () => {
    const packet = makePacket();
    const smartFlow = makeSmartFlowProjection(packet);
    const selected = makePrint();
    const packetPeer = makePrint({ trace_id: "print:2", seq: 2, ts: 990 });
    const contractPeer = makePrint({ trace_id: "print:3", seq: 3, ts: 980 });
    const supportInputs: string[][] = [];

    const detail = await lookupOptionsSmartFlowTriageDetail(
      clickhouse,
      {
        optionTraceId: "print:1",
        projectionTraceId: smartFlow.trace_id,
        packetId: packet.id,
        optionContractId: selected.option_contract_id,
        packetBefore: { ts: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER },
        packetLimit: 12,
        contractBefore: { ts: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER },
        contractLimit: 12
      },
      {
        resolveSmartFlowSupport: async (_client, input) => {
          supportInputs.push(input.optionTraceIds);
          return {
            supportByTraceId: resolveSmartFlowSupportFromContext({
              optionTraceIds: input.optionTraceIds,
              packets: [packet],
              projections: [smartFlow]
            }),
            packets: [packet],
            smartFlowProjections: [smartFlow],
            storageLookups: {
              packetTraceIds: input.optionTraceIds,
              evidenceRefs: [packet.id, ...input.optionTraceIds]
            }
          };
        },
        fetchFlowPacketById: async (_client, packetId) => (packetId === packet.id ? packet : null),
        fetchOptionPrintsByTraceIds: async (_client, traceIds) =>
          traceIds.includes(selected.trace_id) ? [selected] : [],
        fetchOptionPrintsForFlowPacketBefore: async (
          _client,
          packetId,
          _beforeTs,
          _beforeSeq,
          limit,
          pinnedTraceId
        ) => {
          expect(packetId).toBe(packet.id);
          expect(limit).toBe(12);
          expect(pinnedTraceId).toBe(selected.trace_id);
          return { packet, pinned: selected, data: [packetPeer] };
        },
        fetchOptionPrintsBefore: async (
          _client,
          _beforeTs,
          _beforeSeq,
          limit,
          _source,
          filters
        ) => {
          expect(limit).toBe(12);
          expect(filters).toMatchObject({
            view: "raw",
            optionContractId: selected.option_contract_id
          });
          return [contractPeer];
        },
        fetchNearestOptionNBBOForPrints: async (_client, inputs) =>
          Object.fromEntries(inputs.map((input) => [input.trace_id, null as OptionNBBO | null]))
      }
    );

    expect(supportInputs[0]).toEqual(["print:1"]);
    expect(detail.projection_trace_id).toBe(smartFlow.trace_id);
    expect(detail.packet?.id).toBe(packet.id);
    expect(detail.selected_print?.option.trace_id).toBe(selected.trace_id);
    expect(detail.packet_members.rows.map((row) => row.option.trace_id)).toEqual([
      selected.trace_id,
      packetPeer.trace_id
    ]);
    expect(detail.exact_contract.rows.map((row) => row.option.trace_id)).toEqual([
      selected.trace_id,
      contractPeer.trace_id
    ]);
    expect(detail.packet_members.rows[0]?.support.smart_flow_status).toBe("matched");
    expect(detail.detail_unavailable_reason).toBeNull();
  });
});
