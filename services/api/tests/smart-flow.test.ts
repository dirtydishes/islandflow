import { describe, expect, it } from "bun:test";
import { type ClickHouseClient, toSmartMoneyEventRecord } from "@islandflow/storage";
import type { SmartMoneyEvent } from "@islandflow/types";
import {
  fetchRecentSmartFlowExplainability,
  projectSmartFlowExplainability,
  smartFlowCursor
} from "../src/smart-flow";

const makeClickHouse = (rows: unknown[]): ClickHouseClient =>
  ({
    exec: async () => {},
    insert: async () => {},
    ping: async () => ({ success: true }),
    close: async () => {},
    query: async () => ({
      async json<T>() {
        return rows as T;
      }
    })
  }) as ClickHouseClient;

const makeSmartMoneyEvent = (): SmartMoneyEvent => ({
  source_ts: 1_000,
  ingest_ts: 1_005,
  seq: 12,
  trace_id: "smartmoney:flowpacket:12",
  event_id: "smartmoney:event:12",
  packet_ids: ["flowpacket:12"],
  member_print_ids: ["print:12"],
  underlying_id: "SPY",
  event_kind: "single_leg_event",
  event_window_ms: 500,
  features: {
    contract_count: 1,
    print_count: 3,
    total_size: 900,
    total_premium: 90_000,
    total_notional: 9_000_000,
    start_ts: 1_000,
    end_ts: 1_120,
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
    venue_count: 2,
    inter_fill_ms_mean: 60,
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
      probability: 0.78,
      confidence_band: "high",
      direction: "bullish",
      reasons: ["large_parent_event"]
    },
    {
      profile_id: "retail_whale",
      probability: 0.34,
      confidence_band: "low",
      direction: "bullish",
      reasons: ["burst_print_pattern"]
    }
  ],
  primary_profile_id: "institutional_directional",
  primary_direction: "bullish",
  abstained: false,
  suppressed_reasons: []
});

describe("smart-flow API projections", () => {
  it("projects recent smart-money storage rows into smart-flow explainability payloads", async () => {
    const event = makeSmartMoneyEvent();
    const [payload] = await fetchRecentSmartFlowExplainability(
      makeClickHouse([toSmartMoneyEventRecord(event)]),
      1
    );

    expect(payload?.source_channel).toBe("smart-money");
    expect(payload?.projection_version).toBe("smart-flow.explainability-projection.v1");
    expect(payload?.hypothesis.hypothesis_type).toBe("directional_accumulation");
    expect(payload?.insight.summary).toContain("Alternative explanations considered");
    expect(payload?.refs.evidence_refs).toEqual(["flowpacket:12", "print:12"]);
    expect(payload?.abstention.reasons).toEqual(["not_abstained"]);
    expect(payload?.alternatives[0]?.reasons).toEqual(["burst_print_pattern"]);
    expect(smartFlowCursor(payload!)).toEqual({ ts: 1_000, seq: 12 });
  });

  it("keeps projection logic reusable for websocket fanout", () => {
    const [payload] = projectSmartFlowExplainability([makeSmartMoneyEvent()]);

    expect(payload?.versions.contract).toBe("smart-flow.contracts.v1");
    expect(payload?.compatibility?.compatibility_only).toBe(true);
    expect(payload?.compatibility?.legacy_channel).toBe("smart-money");
  });
});
