import { describe, expect, it } from "bun:test";
import {
  SMART_MONEY_EVENTS_TABLE,
  fromSmartMoneyEventRecord,
  smartMoneyEventsTableDDL,
  toSmartMoneyEventRecord
} from "../src/smart-money-events";
import type { SmartMoneyEvent } from "@islandflow/types";

const event: SmartMoneyEvent = {
  source_ts: 10,
  ingest_ts: 20,
  seq: 1,
  trace_id: "smartmoney:flowpacket:1",
  event_id: "smartmoney:single_leg_event:flowpacket:1",
  packet_ids: ["flowpacket:1"],
  member_print_ids: ["print:1"],
  underlying_id: "SPY",
  event_kind: "single_leg_event",
  event_window_ms: 500,
  features: {
    contract_count: 1,
    print_count: 3,
    total_size: 900,
    total_premium: 75_000,
    total_notional: 7_500_000,
    start_ts: 10,
    end_ts: 10,
    window_ms: 500,
    option_contract_id: "SPY-2025-01-17-450-C",
    option_type: "C",
    dte_days: 1,
    moneyness: 1,
    atm_proximity: 0.01,
    aggressor_buy_ratio: 0.7,
    aggressor_sell_ratio: 0.1,
    aggressor_ratio: 0.8,
    nbbo_coverage_ratio: 0.9,
    nbbo_inside_ratio: 0.1,
    nbbo_stale_ratio: 0,
    quote_age_ms: 20,
    venue_count: 2,
    inter_fill_ms_mean: 100,
    strike_count: 1,
    strike_concentration: 1,
    structure_legs: 0,
    same_size_leg_symmetry: 0,
    net_directional_bias: 0.6,
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
      probability: 0.74,
      confidence_band: "high",
      direction: "bullish",
      reasons: ["large_parent_event"]
    }
  ],
  primary_profile_id: "institutional_directional",
  primary_direction: "bullish",
  abstained: false,
  suppressed_reasons: []
};

describe("smart money event storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = smartMoneyEventsTableDDL();
    expect(ddl).toContain(SMART_MONEY_EVENTS_TABLE);
    expect(ddl).toContain("profile_scores_json");
  });

  it("round-trips smart money event records", () => {
    const restored = fromSmartMoneyEventRecord(toSmartMoneyEventRecord(event));
    expect(restored.event_id).toBe(event.event_id);
    expect(restored.profile_scores).toEqual(event.profile_scores);
    expect(restored.features.total_premium).toBe(event.features.total_premium);
  });
});
