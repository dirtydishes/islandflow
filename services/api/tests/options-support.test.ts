import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type FlowPacket,
  type SmartFlowExplainabilityProjection,
  type SmartMoneyEvent,
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

const makeSmartMoneyEvent = (): SmartMoneyEvent => ({
  source_ts: 1_010,
  ingest_ts: 1_011,
  seq: 2,
  trace_id: "smartmoney:flowpacket:1",
  event_id: "smartmoney:event:1",
  packet_ids: ["flowpacket:1"],
  member_print_ids: ["print:1"],
  underlying_id: "SPY",
  event_kind: "single_leg_event",
  event_window_ms: 500,
  features: {
    contract_count: 1,
    print_count: 1,
    total_size: 100,
    total_premium: 50_000,
    total_notional: 5_000_000,
    start_ts: 1_000,
    end_ts: 1_010,
    window_ms: 500,
    option_contract_id: "SPY-2025-01-17-450-C",
    option_type: "C",
    dte_days: 1,
    moneyness: 1.01,
    atm_proximity: 0.01,
    aggressor_buy_ratio: 0.8,
    aggressor_sell_ratio: 0.1,
    aggressor_ratio: 0.9,
    nbbo_coverage_ratio: 0.95,
    nbbo_inside_ratio: 0.02,
    nbbo_stale_ratio: 0,
    quote_age_ms: 20,
    venue_count: 1,
    inter_fill_ms_mean: 0,
    strike_count: 1,
    strike_concentration: 1,
    structure_legs: 0,
    same_size_leg_symmetry: 0,
    net_directional_bias: 0.7,
    synthetic_iv_shock: null,
    spread_widening: null,
    underlying_move_bps: null,
    days_to_event: null,
    expiry_after_event: null,
    pre_event_concentration: null,
    special_print_ratio: 0
  },
  profile_scores: [
    {
      profile_id: "institutional_directional",
      probability: 0.8,
      confidence_band: "high",
      direction: "bullish",
      reasons: ["large_parent_event"]
    }
  ],
  primary_profile_id: "institutional_directional",
  primary_direction: "bullish",
  abstained: false,
  suppressed_reasons: []
});

const makeSmartFlowProjection = (
  smartMoney: SmartMoneyEvent
): SmartFlowExplainabilityProjection => {
  const clusterId = `cluster:${smartMoney.underlying_id}:${smartMoney.source_ts}:${smartMoney.source_ts + 60_000}`;
  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: smartMoney.source_ts,
    ingest_ts: smartMoney.ingest_ts,
    seq: smartMoney.seq,
    trace_id: `smartflow:hypothesis:${clusterId}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: `smartflow:hypothesis:${clusterId}`,
    hypothesis_id: `hypothesis:${clusterId}`,
    cluster_id: clusterId,
    candidate_ids: smartMoney.packet_ids.map((packetId) => `candidate:${packetId}`),
    underlying_id: smartMoney.underlying_id,
    hypothesis_type: "directional_accumulation",
    direction: smartMoney.primary_direction,
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: "directional_accumulation",
      direction: smartMoney.primary_direction,
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
    evidence_refs: [...smartMoney.packet_ids, ...smartMoney.member_print_ids],
    generated_from: "flow_evidence_cluster"
  });
};

describe("options support lookup", () => {
  it("projects smart_flow beside packet, smart-money, classifier, and nbbo support", async () => {
    const packet = makePacket();
    const smartMoney = makeSmartMoneyEvent();
    const smartFlow = makeSmartFlowProjection(smartMoney);
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
        fetchSmartMoneyEventsByPacketIds: async (_client, packetIds) => {
          expect(packetIds).toEqual(["flowpacket:1"]);
          return [smartMoney];
        },
        fetchSmartFlowExplainabilityByPacketIds: async (_client, packetIds) => {
          expect(packetIds).toEqual(["flowpacket:1"]);
          return [smartFlow];
        },
        fetchClassifierHitsByPacketIds: async (_client, packetIds) => {
          expect(packetIds).toEqual(["flowpacket:1"]);
          return [];
        },
        fetchNearestOptionNBBOForPrints: async (_client, inputs) => {
          expect(inputs.map((item) => item.trace_id)).toEqual(["print:1"]);
          return { "print:1": null };
        }
      }
    );

    expect(payload.packets.map((item) => item.id)).toEqual(["flowpacket:1"]);
    expect(payload.smart_money.map((item) => item.trace_id)).toEqual(["smartmoney:flowpacket:1"]);
    expect(payload.smart_flow).toHaveLength(1);
    expect(payload.smart_flow[0]?.source_channel).toBe("smart-flow");
    expect(payload.smart_flow[0]?.refs.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
    expect(payload.nbbo_by_trace_id).toEqual({ "print:1": null });
  });

  it("starts independent nbbo lookup without waiting for packet support", async () => {
    const packet = makePacket();
    const smartMoney = makeSmartMoneyEvent();
    const smartFlow = makeSmartFlowProjection(smartMoney);
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
        fetchSmartMoneyEventsByPacketIds: async () => [smartMoney],
        fetchSmartFlowExplainabilityByPacketIds: async () => [smartFlow],
        fetchClassifierHitsByPacketIds: async () => [],
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
      smart_money: [smartMoney],
      smart_flow: [smartFlow],
      nbbo_by_trace_id: { "print:1": null }
    });
  });
});
