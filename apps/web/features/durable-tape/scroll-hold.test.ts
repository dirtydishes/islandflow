import { describe, expect, it } from "bun:test";

import {
  createEmptyDurableTapeScrollHold,
  flushDurableTapeJumpToLive,
  flushDurableTapeScrollHold,
  formatDurableTapeNewItemCount,
  reduceDurableTapeScrollHold
} from "./scroll-hold";

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

describe("durable tape scroll hold", () => {
  it("inserts incoming rows immediately at the live head", () => {
    const state = reduceDurableTapeScrollHold(
      createEmptyDurableTapeScrollHold<ReturnType<typeof makeItem>>(),
      [makeItem("a", 1, 100), makeItem("b", 2, 200)],
      false,
      10
    );

    expect(state.visible.map((item) => item.trace_id)).toEqual(["b", "a"]);
    expect(state.queued).toEqual([]);
    expect(state.dropped).toBe(0);
  });

  it("queues incoming rows away from the live head without moving visible rows", () => {
    const visible = reduceDurableTapeScrollHold(
      createEmptyDurableTapeScrollHold<ReturnType<typeof makeItem>>(),
      [makeItem("a", 1, 100)],
      false,
      10
    );
    const held = reduceDurableTapeScrollHold(visible, [makeItem("b", 2, 200)], true, 10);

    expect(held.visible.map((item) => item.trace_id)).toEqual(["a"]);
    expect(held.queued.map((item) => item.trace_id)).toEqual(["b"]);
    expect(held.dropped).toBe(1);
  });

  it("flushes queued rows in one batch when returning to live", () => {
    const visible = reduceDurableTapeScrollHold(
      createEmptyDurableTapeScrollHold<ReturnType<typeof makeItem>>(),
      [makeItem("a", 1, 100)],
      false,
      10
    );
    const held = reduceDurableTapeScrollHold(
      visible,
      [makeItem("b", 2, 200), makeItem("c", 3, 300)],
      true,
      10
    );
    const flushed = flushDurableTapeScrollHold(held, 10);

    expect(flushed.visible.map((item) => item.trace_id)).toEqual(["c", "b", "a"]);
    expect(flushed.queued).toEqual([]);
    expect(flushed.dropped).toBe(0);
  });

  it("reports jump-to-live as an instant transition for reduced motion", () => {
    const visible = reduceDurableTapeScrollHold(
      createEmptyDurableTapeScrollHold<ReturnType<typeof makeItem>>(),
      [makeItem("a", 1, 100)],
      false,
      10
    );
    const held = reduceDurableTapeScrollHold(visible, [makeItem("b", 2, 200)], true, 10);
    const result = flushDurableTapeJumpToLive(held, 10, { reducedMotion: true });

    expect(result.flushedCount).toBe(1);
    expect(result.scrollToTop).toBe(true);
    expect(result.motion).toBe("instant");
  });

  it("caps visible new item counts at 999+", () => {
    expect(formatDurableTapeNewItemCount(0)).toBe("0");
    expect(formatDurableTapeNewItemCount(999)).toBe("999");
    expect(formatDurableTapeNewItemCount(1000)).toBe("999+");
  });
});
