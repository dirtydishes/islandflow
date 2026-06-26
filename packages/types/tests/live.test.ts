import { describe, expect, it } from "bun:test";
import {
  CursorSchema,
  getSubscriptionKey,
  LiveClientMessageSchema,
  LiveServerMessageSchema
} from "../src/live";

describe("live protocol types", () => {
  it("builds stable keys for generic and parameterized subscriptions", () => {
    expect(getSubscriptionKey({ channel: "flow" })).toBe("flow|{}");
    expect(getSubscriptionKey({ channel: "smart-flow" })).toBe("smart-flow");
    expect(getSubscriptionKey({ channel: "smart-flow-alerts" })).toBe("smart-flow-alerts");
    expect(getSubscriptionKey({ channel: "news" })).toBe("news");
    expect(
      getSubscriptionKey({
        channel: "options",
        filters: {
          view: "signal",
          securityTypes: ["stock"],
          nbboSides: ["A", "AA"],
          optionTypes: ["call", "put"],
          minNotional: 25000
        }
      })
    ).toBe(
      'options|{"view":"signal","securityTypes":["stock"],"nbboSides":["A","AA"],"optionTypes":["call","put"],"minNotional":25000}'
    );
    expect(
      getSubscriptionKey({
        channel: "options",
        filters: { view: "signal" },
        underlying_ids: ["NVDA", "AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      })
    ).toBe('options|{"view":"signal"}|underlyings:AAPL,NVDA|contract:AAPL-2025-01-17-200-C');
    expect(getSubscriptionKey({ channel: "equities", underlying_ids: ["NVDA", "AAPL"] })).toBe(
      "equities|underlyings:AAPL,NVDA"
    );
    expect(
      getSubscriptionKey({
        channel: "equity-candles",
        underlying_id: "SPY",
        interval_ms: 60000
      })
    ).toBe("equity-candles|SPY|60000");
    expect(getSubscriptionKey({ channel: "equity-overlay", underlying_id: "SPY" })).toBe(
      "equity-overlay|SPY"
    );
    expect(
      getSubscriptionKey({
        channel: "durable-rows",
        lanes: ["alerts", "options"],
        filters: { view: "signal", minNotional: 50000 },
        underlying_ids: ["SPY"]
      })
    ).toBe(
      'durable-rows|lanes:alerts,options|{"view":"signal","minNotional":50000}|underlyings:SPY'
    );
  });

  it("validates subscribe messages", () => {
    const parsed = LiveClientMessageSchema.parse({
      op: "subscribe",
      subscriptions: [
        { channel: "flow", filters: { nbboSides: ["AA", "A"], minNotional: 50000 } },
        { channel: "smart-flow", snapshot_limit: 25 },
        { channel: "smart-flow-alerts", snapshot_limit: 25 },
        { channel: "durable-rows", lanes: ["options", "alerts"], snapshot_limit: 100 },
        { channel: "news", snapshot_limit: 100 },
        { channel: "equity-candles", underlying_id: "SPY", interval_ms: 60000 }
      ]
    });

    expect(parsed.op).toBe("subscribe");
    expect(parsed.subscriptions).toHaveLength(6);
  });

  it("rejects retired derived live channels", () => {
    const retiredChannels = ["smart-money", "classifier-hits", "alerts"];

    for (const channel of retiredChannels) {
      expect(() =>
        LiveClientMessageSchema.parse({
          op: "subscribe",
          subscriptions: [{ channel }]
        })
      ).toThrow();
    }
  });

  it("validates snapshot and event server messages", () => {
    const cursor = CursorSchema.parse({ ts: 100, seq: 2 });
    const snapshot = LiveServerMessageSchema.parse({
      op: "snapshot",
      snapshot: {
        subscription: { channel: "smart-flow-alerts" },
        items: [],
        watermark: cursor,
        next_before: null
      }
    });
    const event = LiveServerMessageSchema.parse({
      op: "event",
      subscription: { channel: "durable-rows", lanes: ["alerts"] },
      item: {
        id: "alerts:alert-1:1",
        lane: "alerts",
        source: "server",
        ts: 100,
        source_ts: 100,
        ingest_ts: 101,
        seq: 1,
        symbol: "SPY",
        cells: {
          time: "00:00:00",
          symbol: "SPY",
          kind: "Directional accumulation hypothesis",
          confidence: "91%",
          state: "high / bullish"
        },
        badges: [{ kind: "confidence", label: "high", tone: "high" }],
        alert: {
          trace_id: "alert-1",
          alert_id: "smartflow:alert:1",
          hypothesis_id: "hypothesis:1",
          insight_id: "insight:1",
          primary_label: "Directional accumulation hypothesis",
          hypothesis_type: "directional_accumulation",
          direction: "bullish",
          policy_confidence: 0.91,
          evidence_quality: 0.76,
          confidence_band: "high",
          evidence_quality_band: "strong",
          trigger_kind: "non_abstained_hypothesis",
          projection_trace_id: "smart-flow:1"
        },
        evidence: {
          total_refs: 1,
          flow_packet_refs: ["flowpacket:1"],
          option_print_refs: [],
          unresolved_refs: [],
          underlying_id: "SPY",
          primary_packet: null,
          preview_prints: []
        }
      },
      watermark: cursor
    });

    expect(snapshot.op).toBe("snapshot");
    expect(event.op).toBe("event");
  });
});
