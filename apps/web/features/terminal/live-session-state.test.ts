import { describe, expect, it } from "bun:test";
import type { LiveSubscription } from "@islandflow/types";

import {
  createLiveSessionChannelBufferRegistry,
  createLiveSessionEventBatcher,
  getLiveSubscriptionResetChannels
} from "./live-session-state";

const optionsSubscription: LiveSubscription = { channel: "options" };
const flowSubscription: LiveSubscription = { channel: "flow" };

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

const createManualScheduler = () => {
  let nextHandle = 1;
  let scheduled: (() => void) | null = null;
  const canceled: number[] = [];

  return {
    canceled,
    runScheduled() {
      const flush = scheduled;
      scheduled = null;
      flush?.();
    },
    scheduleFlush(flush: () => void) {
      scheduled = flush;
      const handle = nextHandle;
      nextHandle += 1;
      return handle;
    },
    cancelFlush(handle: number) {
      canceled.push(handle);
    }
  };
};

describe("live session channel buffer registry", () => {
  it("owns channel buffer creation, reset, dedupe, and ordering", () => {
    const registry = createLiveSessionChannelBufferRegistry();

    const first = registry.upsertSubscriptionItems("options", [
      makeItem("older", 1, 100),
      makeItem("newer", 3, 300)
    ]);
    const updated = registry.upsertSubscriptionItems("options", [makeItem("older", 1, 200)]);

    expect(first.items.map((item) => [item.trace_id, item.ts])).toEqual([
      ["newer", 300],
      ["older", 100]
    ]);
    expect(updated.items.map((item) => [item.trace_id, item.ts])).toEqual([
      ["newer", 300],
      ["older", 200]
    ]);

    registry.resetSubscriptionChannel("options");

    expect(registry.getSubscriptionSnapshot("options").items).toEqual([]);
  });

  it("detects live-session channels that need scoped resets", () => {
    const current: LiveSubscription[] = [{ channel: "durable-rows" }];
    const next: LiveSubscription[] = [
      {
        channel: "durable-rows",
        underlying_ids: ["SPY"]
      }
    ];

    expect(Array.from(getLiveSubscriptionResetChannels(current, next))).toEqual(["durable-rows"]);
  });
});

describe("live session event batcher", () => {
  it("coalesces websocket events by subscription and flushes them in first-seen order", () => {
    const scheduler = createManualScheduler();
    const applied: string[] = [];
    const flushed: [LiveSubscription["channel"], number][] = [];
    let now = 100;

    const batcher = createLiveSessionEventBatcher({
      ...scheduler,
      now: () => now,
      applyBatch(batch) {
        applied.push(
          `${batch.subscription.channel}:${batch.items
            .map((item) => (item as ReturnType<typeof makeItem>).trace_id)
            .join(",")}`
        );
        return batch.items.length > 0;
      },
      onFlush(updates) {
        flushed.push(...updates.entries());
      }
    });

    batcher.queueEvent(optionsSubscription, makeItem("opt-a", 1, 100));
    now = 110;
    batcher.queueEvent(optionsSubscription, makeItem("opt-b", 2, 200));
    now = 120;
    batcher.queueEvent(flowSubscription, makeItem("flow-a", 1, 100));

    scheduler.runScheduled();

    expect(applied).toEqual(["options:opt-a,opt-b", "flow:flow-a"]);
    expect(flushed).toEqual([
      ["options", 110],
      ["flow", 120]
    ]);
    expect(scheduler.canceled).toEqual([1]);
  });

  it("drains queued websocket events before snapshot application", () => {
    const scheduler = createManualScheduler();
    const order: string[] = [];

    const batcher = createLiveSessionEventBatcher({
      ...scheduler,
      applyBatch(batch) {
        order.push(`event:${(batch.items[0] as ReturnType<typeof makeItem>).trace_id}`);
        return true;
      }
    });

    batcher.queueEvent(optionsSubscription, makeItem("queued-before-snapshot", 1, 100));
    batcher.drainQueuedEventsBeforeSnapshot();
    order.push("snapshot:options");
    scheduler.runScheduled();

    expect(order).toEqual(["event:queued-before-snapshot", "snapshot:options"]);
    expect(scheduler.canceled).toEqual([1]);
  });

  it("clears queued websocket events and cancels pending frame flushes", () => {
    const scheduler = createManualScheduler();
    const applied: string[] = [];

    const batcher = createLiveSessionEventBatcher({
      ...scheduler,
      applyBatch(batch) {
        applied.push(batch.subscription.channel);
        return true;
      }
    });

    batcher.queueEvent(optionsSubscription, makeItem("dropped", 1, 100));
    batcher.clear();
    scheduler.runScheduled();

    expect(applied).toEqual([]);
    expect(scheduler.canceled).toEqual([1]);
  });
});
