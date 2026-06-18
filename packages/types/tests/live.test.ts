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
  });

  it("validates subscribe messages", () => {
    const parsed = LiveClientMessageSchema.parse({
      op: "subscribe",
      subscriptions: [
        { channel: "flow", filters: { nbboSides: ["AA", "A"], minNotional: 50000 } },
        { channel: "smart-flow", snapshot_limit: 25 },
        { channel: "news", snapshot_limit: 100 },
        { channel: "equity-candles", underlying_id: "SPY", interval_ms: 60000 }
      ]
    });

    expect(parsed.op).toBe("subscribe");
    expect(parsed.subscriptions).toHaveLength(4);
  });

  it("validates snapshot and event server messages", () => {
    const cursor = CursorSchema.parse({ ts: 100, seq: 2 });
    const snapshot = LiveServerMessageSchema.parse({
      op: "snapshot",
      snapshot: {
        subscription: { channel: "alerts" },
        items: [],
        watermark: cursor,
        next_before: null
      }
    });
    const event = LiveServerMessageSchema.parse({
      op: "event",
      subscription: { channel: "news" },
      item: {
        source_ts: 100,
        ingest_ts: 101,
        seq: 1,
        trace_id: "alpaca:1",
        story_id: 1,
        provider: "alpaca",
        source: "Benzinga",
        headline: "TSLA rises",
        summary: "",
        content_html: "<p>TSLA rises</p>",
        url: "https://example.com/story",
        published_ts: 100,
        updated_ts: 100,
        provider_symbols: ["TSLA"],
        resolved_symbols: ["TSLA"],
        symbol_resolution: "provider"
      },
      watermark: cursor
    });

    expect(snapshot.op).toBe("snapshot");
    expect(event.op).toBe("event");
  });
});
