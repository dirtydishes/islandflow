import { describe, expect, it } from "bun:test";
import {
  buildDefaultFlowFilters,
  countActiveFlowFilterGroups,
  flushPausableTapeData,
  getLiveFeedStatus,
  nextFlowFilterPopoverState,
  reducePausableTapeData,
  toggleFilterValue
} from "./terminal";

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

describe("live tape pausable helpers", () => {
  it("queues new items while paused and flushes them on resume", () => {
    let state = reducePausableTapeData(
      { visible: [], queued: [], seenKeys: new Set<string>(), dropped: 0 },
      [makeItem("a", 1, 100), makeItem("b", 2, 200)],
      false
    );

    expect(state.visible.map((item) => item.trace_id)).toEqual(["b", "a"]);
    expect(state.dropped).toBe(0);

    state = reducePausableTapeData(state, [makeItem("c", 3, 300)], true);
    expect(state.visible.map((item) => item.trace_id)).toEqual(["b", "a"]);
    expect(state.queued.map((item) => item.trace_id)).toEqual(["c"]);
    expect(state.dropped).toBe(1);

    state = flushPausableTapeData(state);
    expect(state.visible.map((item) => item.trace_id)).toEqual(["c", "b", "a"]);
    expect(state.queued).toHaveLength(0);
    expect(state.dropped).toBe(0);
  });

  it("does not duplicate unchanged arrays", () => {
    let state = reducePausableTapeData(
      { visible: [], queued: [], seenKeys: new Set<string>(), dropped: 0 },
      [makeItem("a", 1, 100)],
      false
    );

    state = reducePausableTapeData(state, [makeItem("a", 1, 100)], false);
    expect(state.visible.map((item) => item.trace_id)).toEqual(["a"]);
  });

  it("marks connected feeds stale once their freshest event ages past the threshold", () => {
    expect(getLiveFeedStatus("connected", 1000, 500, 1400)).toBe("connected");
    expect(getLiveFeedStatus("connected", 1000, 500, 1601)).toBe("stale");
    expect(getLiveFeedStatus("disconnected", 1000, 500, 1601)).toBe("disconnected");
  });
});

describe("flow filter popup helpers", () => {
  it("opens and closes the popup via toggle and dismiss actions", () => {
    expect(nextFlowFilterPopoverState(false, "toggle")).toBe(true);
    expect(nextFlowFilterPopoverState(true, "toggle")).toBe(false);
    expect(nextFlowFilterPopoverState(true, "dismiss")).toBe(false);
  });

  it("tracks active filter groups and resets to defaults", () => {
    const defaults = buildDefaultFlowFilters();
    const next = {
      ...defaults,
      securityTypes: toggleFilterValue(defaults.securityTypes, "etf", true),
      nbboSides: toggleFilterValue(defaults.nbboSides, "B", true),
      minNotional: 25_000
    };

    expect(countActiveFlowFilterGroups(defaults)).toBe(0);
    expect(countActiveFlowFilterGroups(next)).toBe(3);
    expect(buildDefaultFlowFilters()).toEqual(defaults);
  });
});
