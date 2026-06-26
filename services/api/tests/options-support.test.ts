import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import type { FlowPacket, SmartMoneyEvent } from "@islandflow/types";
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

describe("options support lookup", () => {
  it("projects smart_flow beside packet, smart-money, classifier, and nbbo support", async () => {
    const packet = makePacket();
    const smartMoney = makeSmartMoneyEvent();
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
    expect(payload.smart_flow[0]?.source_channel).toBe("smart-money");
    expect(payload.smart_flow[0]?.refs.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
    expect(payload.nbbo_by_trace_id).toEqual({ "print:1": null });
  });
});
