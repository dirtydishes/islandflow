import { describe, expect, it } from "bun:test";
import {
  CursorSchema,
  LiveClientMessageSchema,
  LiveServerMessageSchema,
  getSubscriptionKey
} from "../src/live";

describe("live protocol types", () => {
  it("builds stable keys for generic and parameterized subscriptions", () => {
    expect(getSubscriptionKey({ channel: "flow" })).toBe("flow");
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
        { channel: "flow" },
        { channel: "equity-candles", underlying_id: "SPY", interval_ms: 60000 }
      ]
    });

    expect(parsed.op).toBe("subscribe");
    expect(parsed.subscriptions).toHaveLength(2);
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
      subscription: { channel: "equity-overlay", underlying_id: "SPY" },
      item: {
        source_ts: 100,
        ingest_ts: 101,
        seq: 1,
        trace_id: "eq-1",
        ts: 100,
        underlying_id: "SPY",
        price: 500,
        size: 10,
        exchange: "X",
        offExchangeFlag: true
      },
      watermark: cursor
    });

    expect(snapshot.op).toBe("snapshot");
    expect(event.op).toBe("event");
  });
});
