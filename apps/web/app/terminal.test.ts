import { describe, expect, it, mock } from "bun:test";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";

const redirect = mock((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

const nextNavigationMock = {
  default: {
    redirect,
    usePathname: () => "/options"
  },
  redirect,
  usePathname: () => "/options"
};

const nextNavigationResolved = import.meta.resolve("next/navigation");
const nextNavigationJsResolved = import.meta.resolve("next/navigation.js");

mock.module("next/navigation", () => ({
  ...nextNavigationMock
}));
mock.module("next/navigation.js", () => ({
  ...nextNavigationMock
}));
mock.module(nextNavigationResolved, () => ({
  ...nextNavigationMock
}));
mock.module(nextNavigationJsResolved, () => ({
  ...nextNavigationMock
}));

const {
  NAV_ITEMS,
  appendHistoryTail,
  buildAlertContextPath,
  buildDefaultFlowFilters,
  buildTerminalEquityOverlays,
  buildTerminalLowerPaneInput,
  buildTerminalMarketChartHoverRowProvider,
  buildTerminalMarketChartMarkers,
  buildOptionTapeQueryParams,
  classifierToneForFamily,
  collectAlertContextEvidence,
  composeTapeItems,
  deriveAlertDirection,
  countActiveFlowFilterGroups,
  decodeNewsText,
  filterOptionTapeItems,
  findAnchorRestoreIndex,
  formatCompactUsd,
  formatOptionContractLabel,
  flushPausableTapeData,
  getEffectiveOptionPrintFilters,
  getAlertWindowAnchorTs,
  getChartFlowMarkerItems,
  getHotChannelFeedStatus,
  getLiveHistoryRetentionCap,
  getOptionTableSnapshot,
  getOptionScope,
  getLiveFeedStatus,
  getLiveManifest,
  getLiveSubscriptionResetChannels,
  getSmartFlowEvidenceRefs,
  getSmartFlowOptionPrintRefs,
  getSmartFlowPacketRefs,
  getSmartFlowPinnedFlowKeys,
  getSmartFlowPinnedOptionKeys,
  getTerminalNavCurrentHref,
  getTerminalChartReplayEndTs,
  getRouteFeatures,
  getTapeVirtualConfig,
  mergeHeldTapeHistory,
  mergeNewestWithOverflow,
  mapTerminalChartStatus,
  normalizeAlertSeverity,
  normalizeTickerFilterInput,
  normalizeTerminalChartCandles,
  nextFlowFilterPopoverState,
  isSyntheticAdminVisible,
  parseTickerFilterInput,
  prunePinnedEntries,
  projectPausableTapeState,
  reducePausableTapeData,
  shouldRetainLiveSnapshotHistory,
  shouldIncludeEquitiesForDarkUnderlyingFallback,
  shouldShowEquitiesSilentFeedWarning,
  selectPrimaryClassifierHit,
  shouldClearOptionFocusSeed,
  smartMoneyProfileLabel,
  smartMoneyToneForProfile,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  getAlertFlowPacketRefs,
  normalizeTerminalPathname,
  resolveAlertFlowPacket,
  statusLabel,
  toggleFilterValue
} = await import("./terminal");

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

const makeOptionPrint = (overrides: Record<string, unknown> = {}) =>
  ({
    trace_id: "opt-1",
    seq: 1,
    ts: 1_000,
    source_ts: 1_000,
    ingest_ts: 1_001,
    option_contract_id: "AAPL-2025-01-17-200-C",
    underlying_id: "AAPL",
    option_type: "call",
    nbbo_side: "A",
    notional: 250_000,
    signal_pass: true,
    price: 1,
    size: 10,
    exchange: "X",
    ...overrides
  }) as any;

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

describe("pinned evidence pruning", () => {
  it("returns the existing map when no entries need pruning", () => {
    const now = 50_000;
    const current = new Map([
      ["flowpacket:1", { value: { id: "flowpacket:1" }, updatedAt: now - 500 }],
      ["trace:2", { value: { id: "trace:2" }, updatedAt: now - 1_000 }]
    ]);

    const next = prunePinnedEntries(current, new Set(), now);

    expect(next).toBe(current);
  });
});

describe("alert context hydration helpers", () => {
  it("builds the persisted ClickHouse context endpoint path", () => {
    expect(buildAlertContextPath("alert:large_call/one")).toBe(
      "/flow/alerts/alert%3Alarge_call%2Fone/context"
    );
  });

  it("merges hydrated packets and prints into pinned evidence maps", () => {
    const packet = {
      trace_id: "flowpacket:1",
      id: "flowpacket:1",
      members: ["print:1"],
      source_ts: 1,
      ingest_ts: 2,
      seq: 1,
      features: {},
      join_quality: {}
    } as any;
    const print = makeOptionPrint({
      trace_id: "print:1",
      execution_nbbo_bid: 1.2,
      execution_nbbo_ask: 1.3,
      execution_underlying_spot: 450.05
    });

    const evidence = collectAlertContextEvidence({
      alert: makeAlert({ evidence_refs: ["flowpacket:1", "print:1"] }),
      flow_packets: [packet],
      option_prints: [print],
      missing_refs: []
    });

    expect(evidence.packets.get("flowpacket:1")).toBe(packet);
    expect(evidence.prints.get("print:1")?.execution_nbbo_bid).toBe(1.2);
    expect(evidence.prints.get("print:1")?.execution_underlying_spot).toBe(450.05);
  });

  it("finds flow-packet refs even when they are not first in alert evidence", () => {
    const alert = makeAlert({
      evidence_refs: ["smartmoney:single_leg_event:flowpacket:1", "flowpacket:1", "print:1"]
    });

    expect(getAlertFlowPacketRefs(alert)).toEqual(["flowpacket:1"]);
  });

  it("resolves the primary alert flow packet from hydrated historical context", () => {
    const packet = {
      trace_id: "flowpacket:1",
      id: "flowpacket:1",
      members: ["print:1"],
      source_ts: 1,
      ingest_ts: 2,
      seq: 1,
      features: {},
      join_quality: {}
    } as any;
    const alert = makeAlert({
      evidence_refs: ["smartmoney:single_leg_event:flowpacket:1", "flowpacket:1", "print:1"]
    });
    const packets = new Map<string, typeof packet>([[packet.id, packet]]);

    expect(resolveAlertFlowPacket(alert, packets)).toBe(packet);
  });
});

describe("live manifest", () => {
  it("includes only options channels on /options", () => {
    const filters = buildDefaultFlowFilters();
    const channels = getLiveManifest("/options", "SPY", 60000, filters).map(
      (subscription) => subscription.channel
    );

    expect(channels).toEqual(["options", "nbbo", "flow"]);
  });

  it("keeps /tape as a compatibility alias for /options subscriptions", () => {
    expect(getLiveManifest("/tape", "SPY", 60000, buildDefaultFlowFilters())).toEqual(
      getLiveManifest("/options", "SPY", 60000, buildDefaultFlowFilters())
    );
  });

  it("dedupes options subscriptions on /options", () => {
    const tapeOptionsSubscriptions = getLiveManifest(
      "/options",
      "SPY",
      60000,
      buildDefaultFlowFilters()
    ).filter((subscription) => subscription.channel === "options");
    expect(tapeOptionsSubscriptions).toHaveLength(1);
  });

  it("keeps option filters on /options subscriptions", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 125_000
    };

    const tapeOptionsSubscription = getLiveManifest("/options", "SPY", 60000, filters).find(
      (subscription) => subscription.channel === "options"
    );

    expect(tapeOptionsSubscription?.filters).toBe(filters);
  });

  it("applies global flow filters to flow subscriptions on /options", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 50_000
    };

    const tapeFlowSubscription = getLiveManifest("/options", "SPY", 60000, filters).find(
      (subscription) => subscription.channel === "flow"
    );

    expect(tapeFlowSubscription?.filters).toBe(filters);
  });

  it("includes scoped option subscriptions on /options", () => {
    const manifest = getLiveManifest(
      "/options",
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

    expect(optionsSubscription?.underlying_ids).toEqual(["AAPL"]);
    expect(optionsSubscription?.option_contract_id).toBe("AAPL-2025-01-17-200-C");
    expect(optionsSubscription?.snapshot_limit).toBe(100);
    expect(manifest.some((subscription) => subscription.channel === "equities")).toBe(false);
  });

  it("drops option-print filters for contract-focused options subscriptions but keeps flow filters", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 500_000,
      optionTypes: ["put" as const]
    };
    const manifest = getLiveManifest(
      "/options",
      "AAPL",
      60000,
      filters,
      {
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      },
      { underlying_ids: ["AAPL"] },
      undefined
    );
    const optionsSubscription = manifest.find((subscription) => subscription.channel === "options");
    const flowSubscription = manifest.find((subscription) => subscription.channel === "flow");

    expect(optionsSubscription?.filters).toBeUndefined();
    expect(flowSubscription?.filters).toBe(filters);
  });

  it("includes news subscriptions on home and /news", () => {
    expect(
      getLiveManifest("/", "SPY", 60000, buildDefaultFlowFilters()).map(
        (subscription) => subscription.channel
      )
    ).toContain("news");
    expect(
      getLiveManifest("/news", "SPY", 60000, buildDefaultFlowFilters()).map(
        (subscription) => subscription.channel
      )
    ).toEqual(["news"]);
  });

  it("subscribes /durable-tapes to every composed tape feed without chart feeds", () => {
    const filters = buildDefaultFlowFilters();
    const manifest = getLiveManifest("/durable-tapes", "SPY", 60000, filters);
    const channels = manifest.map((subscription) => subscription.channel);

    expect(channels).toEqual([
      "options",
      "nbbo",
      "equities",
      "flow",
      "news",
      "alerts",
      "classifier-hits"
    ]);
    expect(manifest.find((subscription) => subscription.channel === "options")?.filters).toBe(
      filters
    );
    expect(manifest.find((subscription) => subscription.channel === "flow")?.filters).toBe(filters);
    expect(channels).not.toContain("equity-candles");
    expect(channels).not.toContain("equity-overlay");
  });

  it("normalizes retired route subscriptions to the home manifest", () => {
    const home = getLiveManifest("/", "SPY", 60000, buildDefaultFlowFilters());

    expect(getLiveManifest("/signals", "SPY", 60000, buildDefaultFlowFilters())).toEqual(home);
    expect(getLiveManifest("/charts", "SPY", 60000, buildDefaultFlowFilters())).toEqual(home);
    expect(getLiveManifest("/replay", "SPY", 60000, buildDefaultFlowFilters())).toEqual(home);
  });

  it("uses 15m chart interval selections for dashboard candle subscriptions", () => {
    const manifest = getLiveManifest("/", "SPY", 900_000, buildDefaultFlowFilters());
    const candleSubscription = manifest.find(
      (subscription) => subscription.channel === "equity-candles"
    );

    expect(candleSubscription).toMatchObject({
      channel: "equity-candles",
      underlying_id: "SPY",
      interval_ms: 900_000
    });
  });

  it("clamps unregistered chart intervals through the shared timeframe registry", () => {
    const manifest = getLiveManifest("/", "SPY", 42_000, buildDefaultFlowFilters());
    const candleSubscription = manifest.find(
      (subscription) => subscription.channel === "equity-candles"
    );

    expect(candleSubscription).toMatchObject({
      channel: "equity-candles",
      underlying_id: "SPY",
      interval_ms: 60_000
    });
  });

  it("resets live chart streams when candle or overlay subscription keys change", () => {
    const current = getLiveManifest("/", "SPY", 60_000, buildDefaultFlowFilters());
    const nextTicker = getLiveManifest("/", "NVDA", 60_000, buildDefaultFlowFilters());
    const nextInterval = getLiveManifest("/", "SPY", 900_000, buildDefaultFlowFilters());

    expect(Array.from(getLiveSubscriptionResetChannels(current, nextTicker)).sort()).toEqual([
      "equity-candles",
      "equity-overlay"
    ]);
    expect(Array.from(getLiveSubscriptionResetChannels(current, nextInterval)).sort()).toEqual([
      "equity-candles"
    ]);
    expect(Array.from(getLiveSubscriptionResetChannels(current, current))).toEqual([]);
  });
});

describe("contract-focused option helpers", () => {
  it("uses the focused contract underlying for option scope even when ticker input differs", () => {
    expect(
      getOptionScope(["MSFT"], "AAPL", {
        kind: "option-contract",
        contractId: "AAPL-2025-01-17-200-C",
        underlyingId: "AAPL"
      })
    ).toEqual({
      underlying_ids: ["AAPL"],
      option_contract_id: "AAPL-2025-01-17-200-C"
    });
  });

  it("ignores broad flow filters for focused contract options", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 500_000
    };
    const items = [
      makeOptionPrint({
        trace_id: "focused-low",
        option_contract_id: "AAPL-2025-01-17-200-C",
        notional: 100_000,
        signal_pass: false
      }),
      makeOptionPrint({
        trace_id: "focused-high",
        seq: 2,
        ts: 2_000,
        option_contract_id: "AAPL-2025-01-17-200-C",
        notional: 750_000
      }),
      makeOptionPrint({
        trace_id: "other-contract",
        seq: 3,
        ts: 3_000,
        option_contract_id: "MSFT-2025-01-17-300-C",
        underlying_id: "MSFT",
        notional: 900_000
      })
    ];

    expect(
      filterOptionTapeItems(
        items,
        getEffectiveOptionPrintFilters(filters, true),
        {
          kind: "option-contract",
          contractId: "AAPL-2025-01-17-200-C",
          underlyingId: "AAPL"
        },
        new Set(["MSFT"]),
        "AAPL"
      ).map((item) => item.trace_id)
    ).toEqual(["focused-low", "focused-high"]);
  });

  it("includes option_contract_id and drops broad filters in focused replay query params", () => {
    const filters = {
      ...buildDefaultFlowFilters(),
      minNotional: 500_000,
      optionTypes: ["put" as const]
    };

    expect(
      buildOptionTapeQueryParams(getEffectiveOptionPrintFilters(filters, true), {
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      })
    ).toEqual({
      underlying_ids: "AAPL",
      option_contract_id: "AAPL-2025-01-17-200-C"
    });
  });

  it("includes the selected options view in tape query params", () => {
    expect(
      buildOptionTapeQueryParams(
        {
          ...buildDefaultFlowFilters(),
          view: "raw",
          securityTypes: undefined,
          nbboSides: undefined,
          optionTypes: undefined
        },
        { underlying_ids: ["AAPL"] }
      )
    ).toEqual({
      view: "raw",
      underlying_ids: "AAPL"
    });
  });

  it("keeps the focus seed until the matching scoped subscription has loaded it", () => {
    const seedItem = makeOptionPrint({
      trace_id: "focused-seed",
      option_contract_id: "AAPL-2025-01-17-200-C"
    });
    const seed = {
      scopeKey: "option-contract:AAPL-2025-01-17-200-C",
      subscriptionKey: getLiveSubscriptionKey({
        channel: "options",
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      }),
      items: [seedItem]
    };

    expect(
      shouldClearOptionFocusSeed(
        seed,
        "option-contract:AAPL-2025-01-17-200-C",
        getLiveSubscriptionKey({
          channel: "options",
          filters: {
            ...buildDefaultFlowFilters(),
            minNotional: 500_000
          },
          underlying_ids: ["AAPL"]
        }),
        [makeOptionPrint({ trace_id: "broad-old" })],
        []
      )
    ).toBe(false);

    expect(
      shouldClearOptionFocusSeed(
        seed,
        "option-contract:AAPL-2025-01-17-200-C",
        getLiveSubscriptionKey({
          channel: "options",
          underlying_ids: ["AAPL"],
          option_contract_id: "AAPL-2025-01-17-200-C"
        }),
        [seedItem],
        []
      )
    ).toBe(true);
  });
});

describe("route feature map", () => {
  it("maps /options to the options and packets panes", () => {
    const features = getRouteFeatures("/options");
    expect(features.showOptionsPane).toBe(true);
    expect(features.showEquitiesPane).toBe(false);
    expect(features.showFlowPane).toBe(true);
    expect(features.needsClassifierDecor).toBe(true);
    expect(features.alerts).toBe(false);
  });

  it("keeps /tape route compatibility while normalizing to /options", () => {
    expect(normalizeTerminalPathname("/tape")).toBe("/options");
    expect(getTerminalNavCurrentHref("/tape")).toBe("/options");
    expect(getRouteFeatures("/tape")).toEqual(getRouteFeatures("/options"));
  });

  it("normalizes retired terminal routes to the home feature surface", () => {
    expect(normalizeTerminalPathname("/signals")).toBe("/");
    expect(normalizeTerminalPathname("/charts")).toBe("/");
    expect(normalizeTerminalPathname("/replay")).toBe("/");
    expect(getRouteFeatures("/signals")).toEqual(getRouteFeatures("/"));
    expect(getRouteFeatures("/charts")).toEqual(getRouteFeatures("/"));
    expect(getRouteFeatures("/replay")).toEqual(getRouteFeatures("/"));
  });

  it("maps /news to the dedicated news pane", () => {
    const features = getRouteFeatures("/news");
    expect(features.news).toBe(true);
    expect(features.showNewsPane).toBe(true);
    expect(features.showAlertsPane).toBe(false);
  });

  it("maps /durable-tapes to all durable module panes while keeping chart feeds off", () => {
    const features = getRouteFeatures("/durable-tapes");
    expect(normalizeTerminalPathname("/durable-tapes")).toBe("/durable-tapes");
    expect(getTerminalNavCurrentHref("/durable-tapes")).toBe("/durable-tapes");
    expect(features.showOptionsPane).toBe(true);
    expect(features.showFlowPane).toBe(true);
    expect(features.showEquitiesPane).toBe(true);
    expect(features.showNewsPane).toBe(true);
    expect(features.showAlertsPane).toBe(true);
    expect(features.needsClassifierDecor).toBe(true);
    expect(features.needsAlertEvidencePrefetch).toBe(true);
    expect(features.showChartPane).toBe(false);
    expect(features.equityCandles).toBe(false);
  });
});

describe("fixed tape virtualization config", () => {
  it("uses expected fixed row heights and overscan by table", () => {
    expect(getTapeVirtualConfig("options")).toEqual({
      rowHeight: 36,
      overscan: 44,
      debugLabel: "options"
    });
    expect(getTapeVirtualConfig("flow")).toEqual({
      rowHeight: 44,
      overscan: 24,
      debugLabel: "flow"
    });
    expect(getTapeVirtualConfig("news")).toEqual({
      rowHeight: 52,
      overscan: 28,
      debugLabel: "news"
    });
  });
});

describe("news text formatting", () => {
  it("decodes common html entities in provider text", () => {
    expect(
      decodeNewsText(
        "Palantir CEO Alex Karp Is &#39;Rooting For Elon&#39; &amp; Clients &#x27;Screaming&#x27;"
      )
    ).toBe("Palantir CEO Alex Karp Is 'Rooting For Elon' & Clients 'Screaming'");
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeNewsText("Keep &market; literal")).toBe("Keep &market; literal");
  });
});

describe("dark underlying route dependency helper", () => {
  it("does not keep extra equities subscriptions for options-only surfaces", () => {
    expect(shouldIncludeEquitiesForDarkUnderlyingFallback()).toBe(false);
    expect(
      getLiveManifest("/options", "SPY", 60000, buildDefaultFlowFilters()).some(
        (subscription) => subscription.channel === "equities"
      )
    ).toBe(false);
    expect(
      getLiveManifest("/news", "SPY", 60000, buildDefaultFlowFilters()).some(
        (subscription) => subscription.channel === "equities"
      )
    ).toBe(false);
  });
});

describe("terminal navigation", () => {
  it("exposes Dashboard, Options, and News as top-level destinations", () => {
    expect(NAV_ITEMS).toEqual([
      { href: "/", label: "Dashboard" },
      { href: "/options", label: "Options" },
      { href: "/news", label: "News" }
    ]);
  });
});

describe("synthetic admin visibility", () => {
  it("shows the internal control rail only when the public admin flag is enabled", () => {
    expect(isSyntheticAdminVisible("1")).toBe(true);
    expect(isSyntheticAdminVisible("0")).toBe(false);
    expect(isSyntheticAdminVisible(undefined)).toBe(false);
  });
});

describe("ticker filter helpers", () => {
  it("normalizes pasted ticker input into a stable terminal format", () => {
    expect(normalizeTickerFilterInput(" spy，\n nvda\u0000 aapl ")).toBe(" SPY, NVDA AAPL ");
  });

  it("parses, uppercases, and deduplicates ticker tokens", () => {
    expect(parseTickerFilterInput("spy, nvda spy\nqqq")).toEqual(["SPY", "NVDA", "QQQ"]);
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
    expect(shouldRetainLiveSnapshotHistory("smart-flow", true, 0, 2)).toBe(true);
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
    const currentHot = [
      makeItem("hot-3", 3, 300),
      makeItem("hot-2", 2, 200),
      makeItem("hot-1", 1, 100)
    ];
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
      const { kept, evicted } = mergeNewestWithOverflow(
        [makeItem(`row-${seq}`, seq, seq * 100)],
        hot,
        2
      );
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
    const currentHot = [
      makeItem("hot-3", 3, 300),
      makeItem("hot-2", 2, 200),
      makeItem("hot-1", 1, 100)
    ];
    const { kept, evicted } = mergeNewestWithOverflow([makeItem("hot-4", 4, 400)], currentHot, 3);
    const promoted = appendHistoryTail([], evicted, kept, 5000);
    const merged = appendHistoryTail(
      promoted,
      [makeItem("hot-1", 1, 100), makeItem("older", 0, 50)],
      kept,
      5000
    );

    expect(merged.map((item) => item.trace_id)).toEqual(["hot-1", "older"]);
    expect(new Set([...kept, ...merged].map((item) => item.trace_id)).size).toBe(
      kept.length + merged.length
    );
  });

  it("trims the history tail to the soft cap", () => {
    const current = [makeItem("existing", 4, 400)];
    const older = [makeItem("older-1", 3, 300), makeItem("older-2", 2, 200)];

    const next = appendHistoryTail(current, older, [], 2);

    expect(next.map((item) => item.trace_id)).toEqual(["existing", "older-1"]);
  });

  it("keeps option and equity history effectively unbounded while scrolling", () => {
    expect(
      getLiveHistoryRetentionCap({
        channel: "options",
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      } as any)
    ).toBe(0);
    expect(
      getLiveHistoryRetentionCap({
        channel: "equities",
        underlying_ids: ["AAPL"]
      } as any)
    ).toBe(0);
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

  it("keeps held ClickHouse history stable when newer live overflow arrives", () => {
    const frozenLive = [makeItem("hot-5", 5, 500), makeItem("hot-4", 4, 400)];
    const displayed = [makeItem("hist-3", 3, 300), makeItem("hist-2", 2, 200)];
    const incoming = [
      makeItem("overflow-newer", 6, 600),
      makeItem("hot-4", 4, 400),
      makeItem("hist-3", 3, 300),
      makeItem("hist-2", 2, 200)
    ];

    expect(
      mergeHeldTapeHistory(displayed, incoming, frozenLive).map((item) => item.trace_id)
    ).toEqual(["hist-3", "hist-2"]);
  });

  it("appends truly older lazy-loaded rows to the held history tail", () => {
    const frozenLive = [makeItem("hot-5", 5, 500), makeItem("hot-4", 4, 400)];
    const displayed = [makeItem("hist-3", 3, 300), makeItem("hist-2", 2, 200)];
    const incoming = [
      makeItem("hist-3", 3, 300),
      makeItem("hist-2", 2, 200),
      makeItem("older-1", 1, 100),
      makeItem("older-0", 0, 50)
    ];

    expect(
      mergeHeldTapeHistory(displayed, incoming, frozenLive).map((item) => item.trace_id)
    ).toEqual(["hist-3", "hist-2", "older-1", "older-0"]);
  });

  it("resyncs buffered live history by replacing the held segment after resume", () => {
    const frozenLive = [makeItem("hot-5", 5, 500), makeItem("hot-4", 4, 400)];
    const held = mergeHeldTapeHistory(
      [makeItem("hist-3", 3, 300), makeItem("hist-2", 2, 200)],
      [makeItem("overflow-newer", 6, 600), makeItem("hist-3", 3, 300), makeItem("older-1", 1, 100)],
      frozenLive
    );
    const resynced = appendHistoryTail([], [makeItem("overflow-newer", 6, 600), ...held], [], 0);

    expect(held.map((item) => item.trace_id)).toEqual(["hist-3", "hist-2", "older-1"]);
    expect(resynced.map((item) => item.trace_id)).toEqual([
      "overflow-newer",
      "hist-3",
      "hist-2",
      "older-1"
    ]);
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
      {
        ...makeAlert({ classifier_id: "old", confidence: 0.9, source_ts: 1_000, seq: 1 }),
        direction: "bullish",
        explanations: []
      },
      {
        ...makeAlert({ classifier_id: "new", confidence: 0.9, source_ts: 2_000, seq: 1 }),
        direction: "bullish",
        explanations: []
      },
      {
        ...makeAlert({ classifier_id: "low", confidence: 0.5, source_ts: 3_000, seq: 9 }),
        direction: "bullish",
        explanations: []
      }
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

describe("smart-flow explainability helpers", () => {
  const makeProjection = (overrides: Record<string, unknown> = {}) =>
    ({
      source_ts: 1_000,
      ingest_ts: 1_001,
      seq: 1,
      trace_id: "smart-flow:1",
      source_channel: "smart-flow",
      refs: {
        evidence_refs: ["flowpacket:1", "print:1"],
        hypothesis_id: "hypothesis:1",
        ...((overrides.refs as Record<string, unknown> | undefined) ?? {})
      },
      evidence: {
        evidence_refs: ["print:1", "print:2"],
        evidence_quality: 0.64,
        penalties: [],
        ...((overrides.evidence as Record<string, unknown> | undefined) ?? {})
      },
      hypothesis: {
        hypothesis_type: "directional_accumulation",
        underlying_id: "SPY",
        direction: "bullish",
        evidence_refs: ["flowpacket:1", "print:2"],
        ...((overrides.hypothesis as Record<string, unknown> | undefined) ?? {})
      },
      abstention: {
        abstained: false,
        reasons: ["not_abstained"],
        source_reasons: [],
        ...((overrides.abstention as Record<string, unknown> | undefined) ?? {})
      },
      alternatives: [],
      ...overrides
    }) as any;

  const makeLegacySmartMoneyEvent = (overrides: Record<string, unknown> = {}) =>
    ({
      source_ts: 1_000,
      ingest_ts: 1_001,
      seq: 1,
      trace_id: "smart-money:1",
      underlying_id: "SPY",
      primary_direction: "bullish",
      primary_profile_id: "institutional_directional",
      abstained: false,
      profile_scores: [],
      ...overrides
    }) as any;

  const makeDarkEvent = (overrides: Record<string, unknown> = {}) =>
    ({
      source_ts: 1_500,
      ingest_ts: 1_501,
      seq: 1,
      trace_id: "dark:1",
      type: "off_exchange_cluster",
      confidence: 0.72,
      evidence_refs: ["equity:1"],
      ...overrides
    }) as any;

  it("labels hypotheses and evidence quality without certainty language", () => {
    expect(smartFlowHypothesisLabel("directional_accumulation")).toBe("Directional accumulation");
    expect(smartFlowHypothesisLabel("unclear")).toBe("No clear flow hypothesis");
    expect(smartFlowEvidenceQualityLabel(0.9)).toBe("strong");
    expect(smartFlowEvidenceQualityLabel(0.6)).toBe("usable");
    expect(smartFlowEvidenceQualityLabel(0.1)).toBe("thin");
    expect(smartFlowEvidenceQualityLabel(0)).toBe("poor");
  });

  it("uses neutral direction language when a projection abstains", () => {
    const projection = makeProjection({
      hypothesis: {
        hypothesis_type: "directional_accumulation",
        direction: "bullish",
        evidence_refs: ["flowpacket:1"]
      },
      abstention: {
        abstained: true,
        reasons: ["below_policy_threshold"],
        source_reasons: ["policy confidence below threshold"]
      }
    });

    expect(smartFlowDirectionLabel(projection)).toBe("abstained");
    expect(smartFlowDirectionTone(projection)).toBe("neutral");
  });

  it("merges smart-flow evidence refs into inspectable packet and print groups", () => {
    const projection = makeProjection();

    expect(getSmartFlowEvidenceRefs(projection)).toEqual(["flowpacket:1", "print:1", "print:2"]);
    expect(getSmartFlowPacketRefs(projection)).toEqual(["flowpacket:1"]);
    expect(getSmartFlowOptionPrintRefs(projection)).toEqual(["print:1", "print:2"]);
    expect(getSmartFlowPinnedFlowKeys(projection)).toEqual(["flowpacket:1"]);
    expect(getSmartFlowPinnedOptionKeys(projection)).toEqual(["print:1", "print:2"]);
  });

  it("summarizes abstention, penalties, and alternatives as why-not context", () => {
    expect(
      smartFlowWhyNotLabel(
        makeProjection({
          abstention: {
            abstained: true,
            reasons: ["stale_quote_context"],
            source_reasons: ["stale_or_missing_quote_context"]
          }
        })
      )
    ).toBe("Abstained: Stale Or Missing Quote Context");

    expect(
      smartFlowWhyNotLabel(
        makeProjection({
          evidence: {
            evidence_refs: ["print:1"],
            evidence_quality: 0.4,
            penalties: [
              {
                penalty_id: "penalty:1",
                kind: "wide_quote_context",
                score: 0.8,
                reason: "Wide quote context reduced fit.",
                evidence_refs: ["print:1"]
              }
            ]
          }
        })
      )
    ).toBe("Watch: Wide quote context reduced fit.");

    expect(
      smartFlowWhyNotLabel(
        makeProjection({
          alternatives: [
            {
              hypothesis_type: "hedge_rebalance",
              direction: "neutral",
              score: 0.44,
              reasons: ["Similar timing context."]
            }
          ]
        })
      )
    ).toBe("Alternative considered: Hedge rebalance");
  });

  it("prefers smart-flow projections for chart marker source rows", () => {
    const projection = makeProjection({
      source_ts: 2_000,
      seq: 2,
      refs: { hypothesis_id: "hypothesis:2" }
    });
    const legacy = makeLegacySmartMoneyEvent({ source_ts: 2_000, seq: 1 });

    const items = getChartFlowMarkerItems([projection], [legacy], { from: 1_000, to: 3_000 });

    expect(items).toEqual([{ kind: "smart-flow", projection }]);
  });

  it("uses legacy smart-money events only when no smart-flow projection is available", () => {
    const outOfRangeProjection = makeProjection({
      source_ts: 8_000,
      refs: { hypothesis_id: "hypothesis:outside" }
    });
    const legacy = makeLegacySmartMoneyEvent({ source_ts: 2_000, seq: 4 });

    const items = getChartFlowMarkerItems([outOfRangeProjection], [legacy], {
      from: 1_000,
      to: 3_000
    });

    expect(items).toEqual([{ kind: "smart-money-fallback", event: legacy }]);
  });

  it("sorts smart-flow chart marker rows by source time and sequence", () => {
    const later = makeProjection({
      source_ts: 2_000,
      seq: 2,
      refs: { hypothesis_id: "hypothesis:later" }
    });
    const earlier = makeProjection({
      source_ts: 1_500,
      seq: 9,
      refs: { hypothesis_id: "hypothesis:earlier" }
    });

    const items = getChartFlowMarkerItems([later, earlier], [], { from: 1_000, to: 3_000 });

    expect(
      items.map((item) => item.kind === "smart-flow" && item.projection.refs.hypothesis_id)
    ).toEqual(["hypothesis:earlier", "hypothesis:later"]);
  });

  it("maps terminal chart candles and off-exchange overlays into reusable chart inputs", () => {
    const candles = normalizeTerminalChartCandles([
      {
        trace_id: "candle:2",
        source_ts: 2_000,
        ingest_ts: 2_100,
        seq: 2,
        ts: 2_000,
        interval_ms: 60_000,
        underlying_id: "SPY",
        open: 102,
        high: 104,
        low: 101,
        close: 101,
        volume: 20,
        trade_count: 4
      },
      {
        trace_id: "candle:1",
        source_ts: 1_000,
        ingest_ts: 1_100,
        seq: 1,
        ts: 1_000,
        interval_ms: 60_000,
        underlying_id: "SPY",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 10,
        trade_count: 2
      }
    ] as any);

    expect(candles.map((candle) => candle.timestampMs)).toEqual([1_000, 2_000]);
    expect(candles.map((candle) => candle.direction)).toEqual(["bullish", "bearish"]);

    const overlays = buildTerminalEquityOverlays([
      {
        trace_id: "print:1",
        source_ts: 1_000,
        ingest_ts: 1_001,
        seq: 1,
        ts: 1_000,
        underlying_id: "SPY",
        price: 101,
        size: 100,
        exchange: "D",
        offExchangeFlag: true
      },
      {
        trace_id: "print:2",
        source_ts: 2_000,
        ingest_ts: 2_001,
        seq: 2,
        ts: 2_000,
        underlying_id: "SPY",
        price: 102,
        size: 50,
        exchange: "N",
        offExchangeFlag: false
      }
    ] as any);

    expect(overlays).toHaveLength(1);
    expect(overlays[0].points).toHaveLength(1);
    expect(overlays[0].points[0]).toMatchObject({ timestampMs: 1_000, price: 101, value: 100 });
  });

  it("scopes lower-pane all-flow inputs to the active chart ticker", () => {
    const input = buildTerminalLowerPaneInput({
      chartTicker: "SPY",
      candles: [],
      smartFlowProjections: [makeProjection()],
      smartMoneyEvents: [makeLegacySmartMoneyEvent()],
      flowPackets: [
        {
          id: "flowpacket:SPY-2025-01-17-450-C:1",
          trace_id: "flowpacket:spy:1",
          source_ts: 1_000,
          ingest_ts: 1_001,
          seq: 1,
          members: [],
          features: { total_notional: 100, option_contract_id: "SPY-2025-01-17-450-C" },
          join_quality: {}
        },
        {
          id: "flowpacket:aapl:1",
          trace_id: "flowpacket:aapl:1",
          source_ts: 1_000,
          ingest_ts: 1_001,
          seq: 2,
          members: [],
          features: { total_notional: 200, underlying_id: "AAPL" },
          join_quality: {}
        },
        {
          id: "flowpacket:SPY-2025-01-17-455-P:2",
          trace_id: "flowpacket:spy:2",
          source_ts: 2_000,
          ingest_ts: 2_001,
          seq: 3,
          members: [],
          features: { total_notional: 300 },
          join_quality: {}
        }
      ] as any,
      optionPrints: [
        makeOptionPrint({
          trace_id: "print:spy:1",
          option_contract_id: "SPY-2025-01-17-450-C",
          underlying_id: "SPY"
        }),
        makeOptionPrint({
          trace_id: "print:aapl:1",
          option_contract_id: "AAPL-2025-01-17-200-C",
          underlying_id: "AAPL"
        }),
        makeOptionPrint({
          trace_id: "print:spy:2",
          option_contract_id: "SPY-2025-01-17-455-P",
          underlying_id: undefined
        })
      ] as any
    });

    expect(input.smartFlowProjections).toHaveLength(1);
    expect(input.smartMoneyEvents).toHaveLength(1);
    expect(input.flowPackets.map((packet) => packet.seq)).toEqual([1, 3]);
    expect(input.optionPrints.map((print) => print.trace_id)).toEqual([
      "print:spy:1",
      "print:spy:2"
    ]);
  });

  it("maps option hover notional with call/put-aware side direction", () => {
    const provider = buildTerminalMarketChartHoverRowProvider({
      smartFlowProjections: [],
      smartMoneyEvents: [],
      flowPackets: [
        {
          id: "flowpacket:SPY-2025-01-17-460-P:1",
          trace_id: "flowpacket:spy:put-sell",
          source_ts: 1_003,
          ingest_ts: 1_004,
          seq: 4,
          members: [],
          features: {
            total_notional: 500,
            option_contract_id: "SPY-2025-01-17-460-P",
            nbbo_side: "B"
          },
          join_quality: {}
        }
      ] as any,
      optionPrints: [
        makeOptionPrint({
          trace_id: "print:call-buy",
          source_ts: 1_001,
          ts: 1_001,
          seq: 1,
          option_contract_id: "SPY-2025-01-17-450-C",
          underlying_id: "SPY",
          option_type: "call",
          execution_nbbo_side: "A",
          nbbo_side: "A",
          notional: 100
        }),
        makeOptionPrint({
          trace_id: "print:put-buy",
          source_ts: 1_002,
          ts: 1_002,
          seq: 2,
          option_contract_id: "SPY-2025-01-17-455-P",
          underlying_id: "SPY",
          option_type: "put",
          execution_nbbo_side: "A",
          nbbo_side: "A",
          notional: 200
        }),
        makeOptionPrint({
          trace_id: "print:put-mid",
          source_ts: 1_003,
          ts: 1_003,
          seq: 3,
          option_contract_id: "SPY-2025-01-17-456-P",
          underlying_id: "SPY",
          option_type: "put",
          execution_nbbo_side: "MID",
          nbbo_side: "MID",
          notional: 300
        })
      ] as any
    });

    const rows = provider({
      symbol: "SPY",
      intervalMs: 60_000,
      time: 1 as any,
      timestampMs: 1_000,
      bucketStartMs: 1_000,
      bucketEndMs: 61_000,
      lowerPoints: [],
      overlayPoints: []
    });

    expect(rows.slice(0, 3).map((row) => [row.label, row.value, row.tone])).toEqual([
      ["Bullish option notional", "$600.00", "bullish"],
      ["Bearish option notional", "$200.00", "bearish"],
      ["Neutral/unknown notional", "$300.00", "info"]
    ]);
  });

  it("maps smart-flow, legacy fallback, and inferred dark events into clickable chart markers", () => {
    const projection = makeProjection({
      source_ts: 2_000,
      seq: 2,
      refs: { hypothesis_id: "hypothesis:2" }
    });
    const legacy = makeLegacySmartMoneyEvent({ source_ts: 2_000, seq: 1 });
    const dark = makeDarkEvent({ source_ts: 2_500, seq: 3 });

    const smartFlowMarkers = buildTerminalMarketChartMarkers({
      smartFlowProjections: [projection],
      smartMoneyEvents: [legacy],
      inferredDark: [dark],
      visibleRangeMs: { from: 1_000, to: 3_000 }
    });

    expect(smartFlowMarkers.map((marker) => marker.payload?.kind).sort()).toEqual([
      "inferred-dark",
      "smart-flow"
    ]);
    expect(smartFlowMarkers.find((marker) => marker.payload?.kind === "smart-flow")).toMatchObject({
      id: "smart-flow:hypothesis:2:2",
      label: "HYP",
      position: "belowBar"
    });

    const fallbackMarkers = buildTerminalMarketChartMarkers({
      smartFlowProjections: [],
      smartMoneyEvents: [legacy],
      inferredDark: [],
      visibleRangeMs: { from: 1_000, to: 3_000 }
    });

    expect(fallbackMarkers).toHaveLength(1);
    expect(fallbackMarkers[0]).toMatchObject({
      id: "smart-money:smart-money:1:1",
      label: "INS"
    });
    expect(fallbackMarkers[0].payload?.kind).toBe("smart-money");
  });

  it("maps terminal feed status into reusable chart status metadata", () => {
    expect(mapTerminalChartStatus("connected", "live", null)).toBe("live");
    expect(mapTerminalChartStatus("stale", "live", null)).toBe("stale");
    expect(mapTerminalChartStatus("connected", "replay", null)).toBe("replay");
    expect(mapTerminalChartStatus("connected", "live", "failed")).toBe("error");
  });

  it("keeps replay candle fetches pinned to the active replay interval bucket", () => {
    expect(getTerminalChartReplayEndTs("replay", 125_000, 60_000)).toBe(179_999);
    expect(getTerminalChartReplayEndTs("replay", 900_000, 300_000)).toBe(1_199_999);
    expect(getTerminalChartReplayEndTs("live", 125_000, 60_000)).toBeNull();
    expect(getTerminalChartReplayEndTs("replay", null, 60_000)).toBeNull();
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
    expect(countActiveFlowFilterGroups({ ...defaults, view: "raw" })).toBe(1);
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

    expect(
      deriveAlertDirection(makeAlert({ hits: [{ direction: "weird", confidence: 0.4 }] }))
    ).toBe("neutral");
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

  it("returns connected/held/stale live status labels without live wording", () => {
    expect(statusLabel("connected", false, "live")).toBe("Connected");
    expect(statusLabel("connected", true, "live")).toBe("Held");
    expect(statusLabel("stale", false, "live")).toBe("Feed behind");
    expect(statusLabel("stale", true, "live")).toBe("Feed behind");
  });

  it("keeps replay pause wording on replay tapes", () => {
    expect(statusLabel("connected", true, "replay")).toBe("Paused");
  });

  it("treats healthy scoped channels as connected even when no matching rows are visible", () => {
    expect(getHotChannelFeedStatus("connected", { healthy: true })).toBe("connected");
  });

  it("surfaces feed behind only when the backend channel health is stale", () => {
    expect(getHotChannelFeedStatus("connected", { healthy: false })).toBe("stale");
    expect(getHotChannelFeedStatus("disconnected", { healthy: true })).toBe("disconnected");
  });
});
