import { describe, expect, it, mock } from "bun:test";
import type { DurableTapeAlertRowViewModel, NewsStory } from "@islandflow/types";
import { renderToStaticMarkup } from "react-dom/server";

import { DurableTapeAlertRowsPane } from "../durable-tape";
import { buildDefaultFlowFilters } from "../terminal/filters";
import { MarketCommandDetailDrawer } from "./MarketCommandDetailDrawer";
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

const makeDurableAlertRow = (
  overrides: Partial<DurableTapeAlertRowViewModel> = {}
): DurableTapeAlertRowViewModel => ({
  id: "alert-row-1",
  lane: "alerts",
  ts: 1_000,
  seq: 1,
  source_ts: 1_000,
  ingest_ts: 1_001,
  source: "server",
  symbol: "SPY",
  cells: {
    time: "09:30:00",
    symbol: "SPY",
    kind: "Directional accumulation",
    confidence: "76%",
    state: "high / bullish",
    evidence: "3 refs"
  },
  badges: [{ kind: "band", label: "High", tone: "green" }],
  evidence_summary: {
    label: "3 refs",
    refs: ["flowpacket:1", "print:1", "print:2"],
    counts: {
      total: 3,
      flow_packets: 1,
      option_prints: 2,
      unresolved: 0
    }
  },
  drilldown_refs: ["flowpacket:1", "print:1", "print:2"],
  alert: {
    trace_id: "alert:1",
    alert_id: "alert-1",
    hypothesis_id: "hypothesis-1",
    insight_id: "insight-1",
    primary_label: "Directional accumulation",
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    policy_confidence: 0.76,
    evidence_quality: 0.82,
    confidence_band: "high",
    evidence_quality_band: "strong",
    trigger_kind: "policy",
    projection_trace_id: "projection-1"
  },
  evidence: {
    total_refs: 3,
    flow_packet_refs: ["flowpacket:1"],
    option_print_refs: ["print:1", "print:2"],
    unresolved_refs: [],
    underlying_id: "SPY",
    primary_packet: {
      id: "flowpacket:1",
      option_contract_id: "SPY-2026-06-19-500-C",
      member_trace_ids: ["print:1", "print:2"],
      member_count: 2
    },
    preview_prints: [
      {
        trace_id: "print:1",
        option_contract_id: "SPY-2026-06-19-500-C",
        ts: 1_000,
        price: 1.25,
        size: 10,
        premium: 1_250,
        exchange: "CBOE"
      }
    ]
  },
  ...overrides
});

const makeNewsStory = (overrides: Partial<NewsStory> = {}): NewsStory => ({
  trace_id: "news-1",
  seq: 1,
  source_ts: 1_000,
  ingest_ts: 1_001,
  story_id: 77,
  provider: "alpaca",
  source: "Reuters",
  headline: "SPY leadership broadens",
  summary: "summary",
  content_html: "<p>body</p>",
  url: "https://example.com/story",
  published_ts: 1_000,
  updated_ts: 1_000,
  provider_symbols: ["SPY"],
  resolved_symbols: ["SPY"],
  symbol_resolution: "provider",
  ...overrides
});

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

  it("keeps external durable alert selection out of the inline pane detail", () => {
    const row = makeDurableAlertRow();
    const html = renderToStaticMarkup(
      <DurableTapeAlertRowsPane
        detailMode="external"
        onSelectRow={noop}
        rows={[row]}
        selectedRowId={row.id}
      />
    );

    expect(html).toContain('data-row-source="server"');
    expect(html).not.toContain("alerts-module-detail");
    expect(html).not.toContain("Close detail");
  });

  it("renders durable alert rows in the shared Market Command drawer", () => {
    const row = makeDurableAlertRow();
    const html = renderToStaticMarkup(
      <MarketCommandDetailDrawer
        detail={{ kind: "durable-alert-row", row }}
        state={makeState() as never}
        onClose={noop}
      />
    );

    expect(html).toContain('data-testid="market-command-detail-drawer"');
    expect(html).toContain("Durable alert row");
    expect(html).toContain("Directional accumulation");
    expect(html).toContain("Server-composed alert detail");
  });

  it("labels focused and market news sections without hiding the global wire", () => {
    const html = renderToStaticMarkup(
      <MarketCommandRoute
        state={
          makeState({
            activeTickers: ["SPY"],
            news: makeFeed({
              items: [
                makeNewsStory({ trace_id: "market", resolved_symbols: [] }),
                makeNewsStory({ trace_id: "focused", resolved_symbols: ["SPY"] })
              ]
            })
          }) as never
        }
      />
    );

    expect(html).toContain("Focused SPY");
    expect(html).toContain("Market wire");
  });

  it("renders news stories in the shared Market Command drawer", () => {
    const html = renderToStaticMarkup(
      <MarketCommandDetailDrawer
        detail={{ kind: "news", story: makeNewsStory({ headline: "NVDA story opens" }) }}
        state={makeState() as never}
        onClose={noop}
      />
    );

    expect(html).toContain("News wire");
    expect(html).toContain("NVDA story opens");
  });
});
