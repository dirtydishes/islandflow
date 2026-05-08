import { describe, expect, it } from "bun:test";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";
import {
  NAV_ITEMS,
  appendHistoryTail,
  buildDefaultFlowFilters,
  classifierToneForFamily,
  composeTapeItems,
  deriveAlertDirection,
  countActiveFlowFilterGroups,
  findAnchorRestoreIndex,
  formatCompactUsd,
  formatOptionContractLabel,
  flushPausableTapeData,
  getAlertWindowAnchorTs,
  getHotChannelFeedStatus,
  getScopedLiveAutoHydrationChannels,
  getLiveHistoryRetentionCap,
  getOptionTableSnapshot,
  getLiveFeedStatus,
  getLiveManifest,
  getRouteFeatures,
  getTapeVirtualConfig,
  mergeNewestWithOverflow,
  normalizeAlertSeverity,
  nextFlowFilterPopoverState,
  projectPausableTapeState,
  reducePausableTapeData,
  shouldRetainLiveSnapshotHistory,
  shouldIncludeEquitiesForDarkUnderlyingFallback,
  shouldShowEquitiesSilentFeedWarning,
  selectPrimaryClassifierHit,
  smartMoneyProfileLabel,
  smartMoneyToneForProfile,
  statusLabel,
  toggleFilterValue
} from "./terminal";

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

const makeAlert = (overrides: Record<string, unknown> = {}) =>
  ({
    trace_id: "alert-1",
    seq: 1,
    source_ts: 1_000,
    severity: "low",
    score: 20,
    hits: [],
    ...overrides
  }) as any;

describe("live manifest", () => {
  it("includes only tape channels on /tape", () => {
    const filters = buildDefaultFlowFilters();
    const channels = getLiveManifest("/tape", "SPY", 60000, filters).map(
      (subscription) => subscription.channel
    );

    expect(channels).toEqual(["options", "nbbo", "equities", "flow"]);
  });

  it("dedupes tape options subscription", () => {
    const tapeOptionsSubscriptions = getLiveManifest(
      "/tape",
      "SPY",
      60000,
      buildDefaultFlowFilters()
    ).filter((subscription) => subscription.channel === "options");
    expect(tapeOptionsSubscriptions).toHaveLength(1);
  });

  it("keeps option filters on /tape options subscriptions", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 125_000
    };

    const tapeOptionsSubscription = getLiveManifest("/tape", "SPY", 60000, filters).find(
      (subscription) => subscription.channel === "options"
    );

    expect(tapeOptionsSubscription?.filters).toBe(filters);
  });

  it("applies global flow filters to flow subscriptions on /tape", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 50_000
    };

    const tapeFlowSubscription = getLiveManifest("/tape", "SPY", 60000, filters).find(
      (subscription) => subscription.channel === "flow"
    );

    expect(tapeFlowSubscription?.filters).toBe(filters);
  });

  it("includes scoped option and equity subscriptions", () => {
    const manifest = getLiveManifest(
      "/tape",
      "AAPL",
      60000,
      buildDefaultFlowFilters(),
      {
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      },
      { underlying_ids: ["AAPL"] }
    );
    const optionsSubscription = manifest.find(
      (subscription): subscription is Extract<(typeof manifest)[number], { channel: "options" }> =>
        subscription.channel === "options"
    );
    const equitiesSubscription = manifest.find(
      (subscription): subscription is Extract<(typeof manifest)[number], { channel: "equities" }> =>
        subscription.channel === "equities"
    );

    expect(optionsSubscription?.underlying_ids).toEqual(["AAPL"]);
    expect(optionsSubscription?.option_contract_id).toBe("AAPL-2025-01-17-200-C");
    expect(equitiesSubscription?.underlying_ids).toEqual(["AAPL"]);
  });

  it("scopes /signals subscriptions to signals channels only", () => {
    const channels = getLiveManifest("/signals", "SPY", 60000, buildDefaultFlowFilters()).map(
      (subscription) => subscription.channel
    );

    expect(channels).toEqual([
      "alerts",
      "smart-money",
      "classifier-hits",
      "inferred-dark",
      "equity-joins"
    ]);
  });

  it("scopes /charts subscriptions to chart channels only", () => {
    const channels = getLiveManifest("/charts", "SPY", 60000, buildDefaultFlowFilters()).map(
      (subscription) => subscription.channel
    );

    expect(channels).toEqual([
      "smart-money",
      "inferred-dark",
      "equity-joins",
      "equity-candles",
      "equity-overlay"
    ]);
  });
});

describe("route feature map", () => {
  it("maps /tape to tape panes and dependencies", () => {
    const features = getRouteFeatures("/tape");
    expect(features.showOptionsPane).toBe(true);
    expect(features.showEquitiesPane).toBe(true);
    expect(features.showFlowPane).toBe(true);
    expect(features.needsClassifierDecor).toBe(true);
    expect(features.alerts).toBe(false);
  });

  it("maps /signals to signal panes and dependencies", () => {
    const features = getRouteFeatures("/signals");
    expect(features.showAlertsPane).toBe(true);
    expect(features.showClassifierPane).toBe(true);
    expect(features.showDarkPane).toBe(true);
    expect(features.options).toBe(false);
    expect(features.equityJoins).toBe(true);
  });

  it("maps /charts to chart panes and dependencies", () => {
    const features = getRouteFeatures("/charts");
    expect(features.showChartPane).toBe(true);
    expect(features.showFocusPane).toBe(true);
    expect(features.equityCandles).toBe(true);
    expect(features.equityOverlay).toBe(true);
    expect(features.alerts).toBe(false);
  });
});

describe("fixed tape virtualization config", () => {
  it("uses expected fixed row heights and overscan by table", () => {
    expect(getTapeVirtualConfig("options")).toEqual({ rowHeight: 36, overscan: 24, debugLabel: "options" });
    expect(getTapeVirtualConfig("equities")).toEqual({ rowHeight: 36, overscan: 20, debugLabel: "equities" });
    expect(getTapeVirtualConfig("flow")).toEqual({ rowHeight: 44, overscan: 16, debugLabel: "flow" });
    expect(getTapeVirtualConfig("alerts")).toEqual({ rowHeight: 44, overscan: 16, debugLabel: "alerts" });
    expect(getTapeVirtualConfig("classifier")).toEqual({ rowHeight: 44, overscan: 16, debugLabel: "classifier" });
    expect(getTapeVirtualConfig("dark")).toEqual({ rowHeight: 44, overscan: 16, debugLabel: "dark" });
  });
});

describe("dark underlying route dependency helper", () => {
  it("does not keep extra equities subscriptions when joins+trace fallback are sufficient", () => {
    expect(shouldIncludeEquitiesForDarkUnderlyingFallback()).toBe(false);
    expect(
      getLiveManifest("/signals", "SPY", 60000, buildDefaultFlowFilters()).some(
        (subscription) => subscription.channel === "equities"
      )
    ).toBe(false);
    expect(
      getLiveManifest("/charts", "SPY", 60000, buildDefaultFlowFilters()).some(
        (subscription) => subscription.channel === "equities"
      )
    ).toBe(false);
  });
});

describe("terminal navigation", () => {
  it("exposes only Home and Tape as top-level destinations", () => {
    expect(NAV_ITEMS).toEqual([
      { href: "/", label: "Home" },
      { href: "/tape", label: "Tape" }
    ]);
  });
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

  it("waits for an additional behind-delay before surfacing stale", () => {
    expect(getLiveFeedStatus("connected", 1000, 500, 2000, 15_000)).toBe("connected");
    expect(getLiveFeedStatus("connected", 1000, 500, 16_501, 15_000)).toBe("stale");
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

describe("live tape history helpers", () => {
  it("composes tape items across seed, live, and history without seam duplicates", () => {
    const seed = [makeItem("seed", 1, 100), makeItem("dup", 2, 200)];
    const live = [makeItem("live", 5, 500), makeItem("dup", 2, 200)];
    const history = [makeItem("old", 0, 50), makeItem("mid", 3, 300)];

    expect(composeTapeItems(seed, live, history).map((item) => item.trace_id)).toEqual([
      "live",
      "mid",
      "dup",
      "seed",
      "old"
    ]);
  });

  it("keeps a clicked seed row visible before scoped live and history arrive", () => {
    const clicked = makeItem("clicked", 3, 300);

    expect(composeTapeItems([clicked], [], []).map((item) => item.trace_id)).toEqual(["clicked"]);
  });

  it("drops focus seed duplicates once equivalent live or history rows arrive", () => {
    const clicked = makeItem("clicked", 3, 300);
    const live = [makeItem("new", 4, 400)];
    const history = [makeItem("clicked", 3, 300)];

    expect(composeTapeItems([clicked], live, history).map((item) => item.trace_id)).toEqual([
      "new",
      "clicked"
    ]);
  });

  it("promotes hot-window overflow into the history tail", () => {
    const currentHot = [makeItem("hot-3", 3, 300), makeItem("hot-2", 2, 200), makeItem("hot-1", 1, 100)];
    const incoming = [makeItem("hot-4", 4, 400)];

    const { kept, evicted } = mergeNewestWithOverflow(incoming, currentHot, 3);
    const nextHistory = appendHistoryTail([], evicted, kept, 5000);

    expect(kept.map((item) => item.trace_id)).toEqual(["hot-4", "hot-3", "hot-2"]);
    expect(nextHistory.map((item) => item.trace_id)).toEqual(["hot-1"]);
  });

  it("keeps the combined tape continuous beyond the hot live window", () => {
    let hot: Array<ReturnType<typeof makeItem>> = [];
    let history: Array<ReturnType<typeof makeItem>> = [];

    for (let seq = 1; seq <= 5; seq += 1) {
      const { kept, evicted } = mergeNewestWithOverflow([makeItem(`row-${seq}`, seq, seq * 100)], hot, 2);
      hot = kept;
      history = appendHistoryTail(history, evicted, hot, 5000);
    }

    expect([...hot, ...history].map((item) => item.trace_id)).toEqual([
      "row-5",
      "row-4",
      "row-3",
      "row-2",
      "row-1"
    ]);
  });

  it("appends older scoped rows behind the hot live head", () => {
    const liveHead = Array.from({ length: 100 }, (_, idx) =>
      makeItem(`hot-${idx}`, 200 - idx, 2_000 - idx)
    );
    const older = [makeItem("older-1", 99, 999), makeItem("older-2", 98, 998)];

    const next = appendHistoryTail([], older, liveHead, 5000);

    expect(next.map((item) => item.trace_id)).toEqual(["older-1", "older-2"]);
  });

  it("skips duplicates already present in the live head", () => {
    const liveHead = [makeItem("latest", 3, 300), makeItem("duplicate", 2, 200)];
    const older = [makeItem("duplicate", 2, 200), makeItem("older", 1, 100)];

    const next = appendHistoryTail([], older, liveHead, 5000);

    expect(next.map((item) => item.trace_id)).toEqual(["older"]);
  });

  it("dedupes the seam between promoted overflow and fetched history", () => {
    const currentHot = [makeItem("hot-3", 3, 300), makeItem("hot-2", 2, 200), makeItem("hot-1", 1, 100)];
    const { kept, evicted } = mergeNewestWithOverflow([makeItem("hot-4", 4, 400)], currentHot, 3);
    const promoted = appendHistoryTail([], evicted, kept, 5000);
    const merged = appendHistoryTail(promoted, [makeItem("hot-1", 1, 100), makeItem("older", 0, 50)], kept, 5000);

    expect(merged.map((item) => item.trace_id)).toEqual(["hot-1", "older"]);
    expect(new Set([...kept, ...merged].map((item) => item.trace_id)).size).toBe(kept.length + merged.length);
  });

  it("trims the history tail to the soft cap", () => {
    const current = [makeItem("existing", 4, 400)];
    const older = [makeItem("older-1", 3, 300), makeItem("older-2", 2, 200)];

    const next = appendHistoryTail(current, older, [], 2);

    expect(next.map((item) => item.trace_id)).toEqual(["existing", "older-1"]);
  });

  it("keeps scoped option and equity history on the normal retention cap", () => {
    expect(
      getLiveHistoryRetentionCap({
        channel: "options",
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      } as any)
    ).toBeGreaterThan(0);
    expect(
      getLiveHistoryRetentionCap({
        channel: "equities",
        underlying_ids: ["AAPL"]
      } as any)
    ).toBeGreaterThan(0);
  });

  it("keeps auto-hydrating scoped live history while next_before exists", () => {
    const manifest = getLiveManifest(
      "/tape",
      "AAPL",
      60000,
      buildDefaultFlowFilters(),
      {
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      },
      { underlying_ids: ["AAPL"] }
    );
    const historyCursors = Object.fromEntries(
      manifest.map((subscription) => [getLiveSubscriptionKey(subscription), { ts: 1, seq: 1 }])
    );

    expect(
      getScopedLiveAutoHydrationChannels(true, "/tape", manifest, historyCursors, {})
    ).toEqual(["options", "equities"]);
    expect(
      getScopedLiveAutoHydrationChannels(true, "/tape", manifest, historyCursors, {
        [getLiveSubscriptionKey(manifest.find((subscription) => subscription.channel === "options")!)]: true
      })
    ).toEqual(["equities"]);
    expect(
      getScopedLiveAutoHydrationChannels(true, "/tape", manifest, {
        ...historyCursors,
        [getLiveSubscriptionKey(manifest.find((subscription) => subscription.channel === "equities")!)]: null
      }, {})
    ).toEqual(["options"]);
  });

  it("restores the same anchor key after live insertions at the top", () => {
    const nextKeys = ["new-1", "new-2", "anchor", "after-1", "after-2"];
    expect(findAnchorRestoreIndex(nextKeys, "anchor", ["anchor", "after-1", "after-2"])).toBe(2);
  });

  it("falls forward to the nearest surviving key when the anchor is evicted", () => {
    const nextKeys = ["new-1", "after-1", "after-2"];
    expect(findAnchorRestoreIndex(nextKeys, "anchor", ["anchor", "after-1", "after-2"])).toBe(1);
  });

  it("keeps the same anchor when history is appended at the bottom", () => {
    const nextKeys = ["anchor", "after-1", "after-2", "older-1", "older-2"];
    expect(findAnchorRestoreIndex(nextKeys, "anchor", ["anchor", "after-1", "after-2"])).toBe(0);
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

  it("renders options table snapshot values from preserved spot and IV", () => {
    expect(
      getOptionTableSnapshot({
        price: 1.25,
        size: 10,
        notional: 12_500,
        execution_nbbo_side: "A",
        execution_underlying_spot: 450.05,
        execution_iv: 0.42
      })
    ).toEqual({
      spot: "450.05",
      iv: "42%",
      side: "A",
      details: "10@1.25_A",
      value: "12.5K"
    });
  });

  it("renders legacy options table snapshot spot and IV as dashes", () => {
    const snapshot = getOptionTableSnapshot({
      price: 1,
      size: 2
    });

    expect(snapshot.spot).toBe("--");
    expect(snapshot.iv).toBe("--");
  });
});

describe("classifier row decoration helpers", () => {
  it("maps classifier families to row tones", () => {
    expect(classifierToneForFamily("large_bullish_call_sweep")).toBe("green");
    expect(classifierToneForFamily("large_bearish_put_sweep")).toBe("red");
    expect(classifierToneForFamily("straddle")).toBe("blue");
    expect(classifierToneForFamily("unknown_family")).toBe("neutral");
  });

  it("selects primary hits by confidence, source timestamp, then seq", () => {
    const hit = selectPrimaryClassifierHit([
      { ...makeAlert({ classifier_id: "old", confidence: 0.9, source_ts: 1_000, seq: 1 }), direction: "bullish", explanations: [] },
      { ...makeAlert({ classifier_id: "new", confidence: 0.9, source_ts: 2_000, seq: 1 }), direction: "bullish", explanations: [] },
      { ...makeAlert({ classifier_id: "low", confidence: 0.5, source_ts: 3_000, seq: 9 }), direction: "bullish", explanations: [] }
    ]);

    expect(hit?.classifier_id).toBe("new");
  });
});

describe("smart-money profile helpers", () => {
  it("labels and colors primary profiles", () => {
    expect(smartMoneyProfileLabel("institutional_directional")).toBe("Institutional Directional");
    expect(smartMoneyProfileLabel(null)).toBe("Abstained");
    expect(smartMoneyToneForProfile("event_driven")).toBe("blue");
    expect(smartMoneyToneForProfile(null)).toBe("neutral");
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

describe("signals helpers", () => {
  it("normalizes severity aliases/casing and falls back to score", () => {
    expect(normalizeAlertSeverity(makeAlert({ severity: "HIGH", score: 1 }))).toBe("high");
    expect(normalizeAlertSeverity(makeAlert({ severity: "med", score: 1 }))).toBe("medium");
    expect(normalizeAlertSeverity(makeAlert({ severity: "informational", score: 99 }))).toBe("low");
    expect(normalizeAlertSeverity(makeAlert({ severity: "unknown", score: 80 }))).toBe("high");
    expect(normalizeAlertSeverity(makeAlert({ severity: "unknown", score: 45 }))).toBe("medium");
    expect(normalizeAlertSeverity(makeAlert({ severity: "unknown", score: 44 }))).toBe("low");
  });

  it("derives dominant direction with confidence tie-break and neutral fallback", () => {
    expect(
      deriveAlertDirection(
        makeAlert({
          hits: [
            { direction: "bullish", confidence: 0.4 },
            { direction: "bullish", confidence: 0.2 },
            { direction: "bearish", confidence: 0.9 }
          ]
        })
      )
    ).toBe("bullish");

    expect(
      deriveAlertDirection(
        makeAlert({
          hits: [
            { direction: "bullish", confidence: 0.4 },
            { direction: "bearish", confidence: 0.9 }
          ]
        })
      )
    ).toBe("bearish");

    expect(deriveAlertDirection(makeAlert({ hits: [{ direction: "weird", confidence: 0.4 }] }))).toBe(
      "neutral"
    );
    expect(deriveAlertDirection(makeAlert({ hits: [] }))).toBe("neutral");
  });

  it("anchors strip window to latest visible alert timestamp", () => {
    const alerts = [
      makeAlert({ source_ts: 1_700_000_000_000, severity: "high" }),
      makeAlert({ source_ts: 1_700_000_000_000 - 10 * 60 * 1000, severity: "low" })
    ];
    expect(getAlertWindowAnchorTs(alerts, 42)).toBe(1_700_000_000_000);
    expect(getAlertWindowAnchorTs([], 42)).toBe(42);
  });

  it("returns connected/stale live status labels without live wording", () => {
    expect(statusLabel("connected", false, "live")).toBe("Connected");
    expect(statusLabel("stale", false, "live")).toBe("Feed behind");
  });

  it("treats healthy scoped channels as connected even when no matching rows are visible", () => {
    expect(getHotChannelFeedStatus("connected", { healthy: true })).toBe("connected");
  });

  it("surfaces feed behind only when the backend channel health is stale", () => {
    expect(getHotChannelFeedStatus("connected", { healthy: false })).toBe("stale");
    expect(getHotChannelFeedStatus("disconnected", { healthy: true })).toBe("disconnected");
  });
});
