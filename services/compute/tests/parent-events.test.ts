import { describe, expect, it } from "bun:test";
import {
  buildSmartMoneyEventFromPacket,
  deriveClassifierHitsFromSmartMoneyEvent
} from "../src/parent-events";
import { buildFlowPacket } from "./helpers";

describe("smart money parent events", () => {
  it("scores institutional directional parent events and derives legacy hits", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:institutional",
      source_ts: Date.parse("2025-01-15T15:00:00Z"),
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

    const event = buildSmartMoneyEventFromPacket(packet);
    expect(event.event_kind).toBe("single_leg_event");
    expect(event.primary_profile_id).toBe("institutional_directional");
    expect(event.primary_direction).toBe("bullish");

    const hits = deriveClassifierHitsFromSmartMoneyEvent(event);
    expect(hits[0]?.classifier_id).toBe("smart_money_institutional_directional");
  });

  it("abstains when quote context is stale or missing", () => {
    const packet = buildFlowPacket({
      id: "flowpacket:stale",
      features: {
        option_contract_id: "SPY-2025-02-21-450-C",
        count: 8,
        window_ms: 450,
        total_size: 2200,
        total_premium: 180_000,
        nbbo_coverage_ratio: 0.1,
        nbbo_missing_count: 8
      }
    });

    const event = buildSmartMoneyEventFromPacket(packet);
    expect(event.abstained).toBe(true);
    expect(event.primary_profile_id).toBeNull();
    expect(event.suppressed_reasons).toContain("stale_or_missing_quote_context");
  });
});
