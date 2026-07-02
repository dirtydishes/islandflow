import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { buildDefaultFlowFilters } from "../terminal/filters";
import { MarketCommandRoute } from "./MarketCommandRoute";

const noop = mock(() => {});

const makeFeed = (overrides: Record<string, unknown> = {}) => ({
  status: "connected",
  items: [],
  liveItems: [],
  historyItems: [],
  lastUpdate: 1_000,
  replayTime: null,
  replayComplete: false,
  paused: false,
  dropped: 0,
  togglePause: noop,
  ...overrides
});

const makeState = (overrides: Record<string, unknown> = {}) => {
  const filters = buildDefaultFlowFilters();

  return {
    mode: "live",
    setMode: noop,
    replaySource: null,
    setReplaySource: noop,
    selectedAlert: null,
    setSelectedAlert: noop,
    selectedNewsStory: null,
    setSelectedNewsStory: noop,
    selectedDarkEvent: null,
    setSelectedDarkEvent: noop,
    selectedSmartFlowProjection: null,
    setSelectedSmartFlowProjection: noop,
    selectedInstrument: null,
    setSelectedInstrument: noop,
    clearSelectedInstrument: noop,
    selectedInstrumentLabel: null,
    filterInput: "SPY",
    setFilterInput: noop,
    flowFilters: filters,
    setFlowFilters: noop,
    chartIntervalMs: 60_000,
    setChartIntervalMs: noop,
    options: makeFeed(),
    equities: makeFeed(),
    equityJoins: makeFeed(),
    nbbo: makeFeed(),
    inferredDark: makeFeed(),
    news: makeFeed(),
    flow: makeFeed(),
    alerts: makeFeed(),
    durableRows: makeFeed(),
    smartFlow: makeFeed(),
    liveSession: {
      status: "connected",
      lastUpdate: 1_000,
      manifest: [],
      chartCandles: [],
      chartOverlay: []
    },
    routeFeatures: {
      options: true,
      nbbo: true,
      equities: true,
      flow: true,
      news: true,
      alerts: true,
      durableRows: true,
      smartFlow: true,
      inferredDark: true,
      equityJoins: true,
      equityCandles: true,
      equityOverlay: true,
      showOptionsPane: true,
      showEquitiesPane: true,
      showFlowPane: true,
      showNewsPane: true,
      showAlertsPane: true,
      showDarkPane: true,
      showChartPane: true,
      needsSmartFlowDecor: true,
      needsAlertEvidencePrefetch: true,
      needsDarkUnderlying: true
    },
    activeTickers: ["SPY"],
    tickerSet: new Set(["SPY"]),
    chartTicker: "SPY",
    nbboMap: new Map(),
    optionPrintMap: new Map(),
    equityJoinMap: new Map(),
    flowPacketMap: new Map(),
    packetIdByOptionTraceId: new Map(),
    selectedDarkEvidence: [],
    selectedDarkUnderlying: null,
    selectedSmartFlowEvidence: [],
    filteredOptions: [],
    filteredEquities: [],
    optionsScopedQuiet: false,
    equitiesScopedQuiet: false,
    equitiesSilentWarning: false,
    filteredInferredDark: [],
    filteredNews: [],
    filteredFlow: [],
    filteredAlerts: [],
    filteredDurableOptionRows: [],
    filteredDurableAlertRows: [],
    filteredSmartFlowProjections: [],
    chartSmartFlowProjections: [],
    chartInferredDark: [],
    focusOptionContract: noop,
    focusTickerSymbol: noop,
    clearBoardFocus: noop,
    focusEquityTicker: noop,
    focusFlowPacketRequest: noop,
    focusAlertContract: noop,
    focusAlertEquity: noop,
    clearSelectedAlert: noop,
    openFromSmartFlowProjection: noop,
    handleSmartFlowMarkerClick: noop,
    handleDarkMarkerClick: noop,
    lastSeen: 1_000,
    toggleMode: noop,
    ...overrides
  };
};

describe("MarketCommandRoute", () => {
  it("composes the replacement dashboard without old standalone panes", () => {
    const html = renderToStaticMarkup(<MarketCommandRoute state={makeState() as never} />);

    expect(html).toContain("Market Command");
    expect(html).toContain("Focus rail");
    expect(html).toContain("Chart Context");
    expect(html).toContain("Alerts Triage");
    expect(html).toContain("Flow Packets");
    expect(html).toContain("Options Tape");
    expect(html).toContain("News Wire");

    expect(html).not.toContain("Priority Board");
    expect(html).not.toContain("Decision Levels");
    expect(html).not.toContain("Feed Health");
    expect(html).not.toContain("Event Context");
    expect(html).not.toContain("Replay / Mode");
    expect(html).not.toContain("Equities Tape");
  });

  it("uses durable alert and option row panes before raw fallbacks", () => {
    const durableHtml = renderToStaticMarkup(
      <MarketCommandRoute
        state={
          makeState({
            filteredDurableAlertRows: [{}],
            filteredDurableOptionRows: [{}]
          }) as never
        }
      />
    );
    const fallbackHtml = renderToStaticMarkup(<MarketCommandRoute state={makeState() as never} />);

    expect(durableHtml.match(/data-row-source="server"/g)?.length).toBe(2);
    expect(fallbackHtml).not.toContain('data-row-source="server"');
  });
});
