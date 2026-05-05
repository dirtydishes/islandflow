import { describe, expect, it } from "bun:test";
import { buildSmartMoneyEventFromPacket } from "../src/parent-events";
import {
  buildSmartMoneyEventsForReplay,
  compareSmartMoneyReplayOutputs,
  evaluateSmartMoneyEvents
} from "../src/smart-money-evaluation";
import { buildFlowPacket } from "./helpers";

const institutionalPacket = buildFlowPacket({
  id: "flowpacket:eval-institutional",
  seq: 2,
  source_ts: Date.parse("2025-01-15T15:00:01Z"),
  features: {
    option_contract_id: "SPY-2025-02-21-450-C",
    underlying_id: "SPY",
    count: 8,
    window_ms: 450,
    total_size: 2200,
    total_premium: 180_000,
    total_notional: 18_000_000,
    nbbo_coverage_ratio: 0.92,
    nbbo_aggressive_ratio: 0.82,
    nbbo_aggressive_buy_ratio: 0.78,
    nbbo_aggressive_sell_ratio: 0.04,
    nbbo_inside_ratio: 0.08,
    underlying_mid: 448
  }
});

const eventDrivenPacket = buildFlowPacket({
  id: "flowpacket:eval-event-driven",
  seq: 1,
  source_ts: Date.parse("2025-01-15T15:00:00Z"),
  features: {
    option_contract_id: "AAPL-2025-02-07-225-C",
    underlying_id: "AAPL",
    count: 1,
    window_ms: 450,
    total_size: 1800,
    total_premium: 160_000,
    total_notional: 16_000_000,
    nbbo_coverage_ratio: 0.5,
    nbbo_aggressive_ratio: 0.4,
    nbbo_aggressive_buy_ratio: 0.4,
    nbbo_aggressive_sell_ratio: 0.1,
    nbbo_inside_ratio: 0.08,
    underlying_mid: 224
  }
});

const stalePacket = buildFlowPacket({
  id: "flowpacket:eval-stale",
  seq: 3,
  source_ts: Date.parse("2025-01-15T15:00:02Z"),
  features: {
    option_contract_id: "SPY-2025-02-21-450-C",
    underlying_id: "SPY",
    count: 8,
    window_ms: 450,
    total_size: 2200,
    total_premium: 180_000,
    nbbo_coverage_ratio: 0.1,
    nbbo_missing_count: 8
  }
});

const calendarOptions = {
  "flowpacket:eval-event-driven": {
    eventCalendarMatch: {
      underlying_id: "AAPL",
      event_ts: Date.parse("2025-01-31T21:00:00Z"),
      event_kind: "earnings",
      announced_ts: Date.parse("2024-12-20T21:00:00Z"),
      days_to_event: 16.25
    }
  }
};

describe("smart money evaluation utilities", () => {
  it("compares replay-style live and batch outputs with stable event signatures", () => {
    const liveEvents = [institutionalPacket, eventDrivenPacket, stalePacket].map((packet) =>
      buildSmartMoneyEventFromPacket(packet, calendarOptions[packet.id])
    );
    const batchEvents = buildSmartMoneyEventsForReplay(
      [stalePacket, institutionalPacket, eventDrivenPacket],
      calendarOptions
    );

    const report = compareSmartMoneyReplayOutputs(liveEvents, batchEvents);
    expect(report.consistent).toBe(true);
    expect(report.live_count).toBe(3);
    expect(report.batch_count).toBe(3);
    expect(report.matched_count).toBe(3);
    expect(report.mismatches).toEqual([]);
  });

  it("reports signature mismatches when live and batch scoring diverge", () => {
    const liveEvent = buildSmartMoneyEventFromPacket(institutionalPacket);
    const batchEvent = {
      ...liveEvent,
      primary_profile_id: "retail_whale" as const
    };

    const report = compareSmartMoneyReplayOutputs([liveEvent], [batchEvent]);
    expect(report.consistent).toBe(false);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]?.field).toBe("signature");
  });

  it("summarizes precision, recall, calibration, abstention rate, and economic sanity", () => {
    const events = buildSmartMoneyEventsForReplay(
      [institutionalPacket, eventDrivenPacket, stalePacket],
      calendarOptions
    );
    const report = evaluateSmartMoneyEvents(
      events,
      [
        {
          event_id: "smartmoney:single_leg_event:flowpacket:eval-institutional",
          profile_id: "institutional_directional",
          direction: "bullish",
          realized_return_bps: 42
        },
        {
          event_id: "smartmoney:single_leg_event:flowpacket:eval-event-driven",
          profile_id: "event_driven",
          direction: "bullish",
          realized_return_bps: 18
        },
        {
          event_id: "smartmoney:single_leg_event:flowpacket:eval-stale",
          profile_id: null,
          realized_return_bps: -12
        }
      ],
      4
    );

    expect(report.sample_count).toBe(3);
    expect(report.labeled_count).toBe(3);
    expect(report.emitted_count).toBe(2);
    expect(report.abstained_count).toBe(1);
    expect(report.abstention_rate).toBeCloseTo(1 / 3);
    expect(report.profile_precision.institutional_directional).toBe(1);
    expect(report.profile_recall.event_driven).toBe(1);
    expect(report.calibration).toHaveLength(4);
    expect(report.calibration.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    expect(report.economic_sanity.directional_count).toBe(2);
    expect(report.economic_sanity.direction_hit_rate).toBe(1);
    expect(report.economic_sanity.average_signed_return_bps).toBe(30);
  });
});
