import { describe, expect, it } from "bun:test";
import {
  buildDefaultFlowFilters,
  countActiveFlowFilterGroups,
  formatCompactUsd,
  formatOptionContractLabel,
  flushPausableTapeData,
  getLiveFeedStatus,
  nextFlowFilterPopoverState,
  projectPausableTapeState,
  reducePausableTapeData,
  shouldRetainLiveSnapshotHistory,
  shouldShowEquitiesSilentFeedWarning,
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

  it("applies custom retention limits when requested", () => {
    const state = reducePausableTapeData(
      { visible: [], queued: [], seenKeys: new Set<string>(), dropped: 0 },
      [makeItem("a", 1, 100), makeItem("b", 2, 200), makeItem("c", 3, 300)],
      false,
      2
    );

    expect(state.visible.map((item) => item.trace_id)).toEqual(["c", "b"]);
    expect(state.visible).toHaveLength(2);
  });

  it("marks connected feeds stale once their freshest event ages past the threshold", () => {
    expect(getLiveFeedStatus("connected", 1000, 500, 1400)).toBe("connected");
    expect(getLiveFeedStatus("connected", 1000, 500, 1601)).toBe("stale");
    expect(getLiveFeedStatus("disconnected", 1000, 500, 1601)).toBe("disconnected");
  });

  it("keeps visible history even when live status is stale", () => {
    const projected = projectPausableTapeState([makeItem("stale", 7, 1000)], "stale", 2000);
    expect(projected.items.map((item) => item.trace_id)).toEqual(["stale"]);
    expect(projected.lastUpdate).toBeNull();
  });

  it("flags connected equities feeds that stay silent past threshold", () => {
    expect(
      shouldShowEquitiesSilentFeedWarning({
        wsStatus: "connected",
        equitiesSubscribed: true,
        connectedAt: 1_000,
        lastEquitiesEventAt: null,
        now: 20_000,
        thresholdMs: 25_000
      })
    ).toBe(false);

    expect(
      shouldShowEquitiesSilentFeedWarning({
        wsStatus: "connected",
        equitiesSubscribed: true,
        connectedAt: 1_000,
        lastEquitiesEventAt: null,
        now: 27_000,
        thresholdMs: 25_000
      })
    ).toBe(true);

    expect(
      shouldShowEquitiesSilentFeedWarning({
        wsStatus: "connected",
        equitiesSubscribed: true,
        connectedAt: 1_000,
        lastEquitiesEventAt: 20_000,
        now: 40_000,
        thresholdMs: 25_000
      })
    ).toBe(false);
  });

  it("retains live history when freshness-gated snapshots are empty", () => {
    expect(shouldRetainLiveSnapshotHistory("options", true, 0, 3)).toBe(true);
    expect(shouldRetainLiveSnapshotHistory("equities", true, 0, 2)).toBe(true);
    expect(shouldRetainLiveSnapshotHistory("alerts", true, 0, 3)).toBe(false);
    expect(shouldRetainLiveSnapshotHistory("options", true, 1, 3)).toBe(false);
    expect(shouldRetainLiveSnapshotHistory("options", false, 0, 3)).toBe(false);
  });
});

describe("options display formatters", () => {
  it("formats dashed option contracts as ticker strike expiry", () => {
    expect(formatOptionContractLabel("SPY-2025-01-17-450-C")).toEqual({
      ticker: "SPY",
      strike: "450C",
      expiration: "01-17-25"
    });
  });

  it("formats OCC contracts as ticker strike expiry", () => {
    expect(formatOptionContractLabel("AAPL250117P00150000")).toEqual({
      ticker: "AAPL",
      strike: "150P",
      expiration: "01-17-25"
    });
  });

  it("preserves decimal strikes and side suffix", () => {
    expect(formatOptionContractLabel("QQQ-2025-01-17-509.5-C")).toEqual({
      ticker: "QQQ",
      strike: "509.5C",
      expiration: "01-17-25"
    });
  });

  it("returns null when contract parsing fails", () => {
    expect(formatOptionContractLabel("not-a-contract")).toBeNull();
  });

  it("formats compact notional values", () => {
    expect(formatCompactUsd(999)).toBe("999.00");
    expect(formatCompactUsd(11_430)).toBe("11.4K");
    expect(formatCompactUsd(1_250_000)).toBe("1.3M");
    expect(formatCompactUsd(Number.NaN)).toBe("0.00");
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
