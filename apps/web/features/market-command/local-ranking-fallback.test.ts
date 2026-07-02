import { describe, expect, it } from "bun:test";
import type { EquityPrint, FlowPacket, NewsStory, OptionPrint } from "@islandflow/types";
import {
  buildLocalMarketCommandTickerRail,
  DEFAULT_MARKET_COMMAND_WATCHLIST,
  normalizeMarketCommandWatchlist
} from "./local-ranking-fallback";

const makeOptionPrint = (overrides: Partial<OptionPrint> = {}): OptionPrint =>
  ({
    trace_id: "opt-1",
    seq: 1,
    ts: 1_000,
    source_ts: 1_000,
    ingest_ts: 1_001,
    option_contract_id: "AMD-2026-01-16-180-C",
    underlying_id: "AMD",
    option_type: "call",
    nbbo_side: "A",
    notional: 225_000,
    signal_pass: true,
    price: 2.25,
    size: 10,
    exchange: "X",
    ...overrides
  }) as OptionPrint;

const makeEquityPrint = (overrides: Partial<EquityPrint> = {}): EquityPrint =>
  ({
    trace_id: "eq-1",
    seq: 1,
    ts: 1_000,
    source_ts: 1_000,
    ingest_ts: 1_001,
    underlying_id: "SPY",
    price: 500,
    size: 100,
    exchange: "X",
    offExchangeFlag: false,
    ...overrides
  }) as EquityPrint;

const makeFlowPacket = (overrides: Partial<FlowPacket> = {}): FlowPacket =>
  ({
    trace_id: "packet-trace-1",
    seq: 1,
    source_ts: 1_000,
    ingest_ts: 1_001,
    id: "packet-1",
    members: [],
    features: {
      option_contract_id: "AMD-2026-01-16-180-C"
    },
    join_quality: {},
    ...overrides
  }) as FlowPacket;

const makeNewsStory = (overrides: Partial<NewsStory> = {}): NewsStory =>
  ({
    trace_id: "news-1",
    seq: 1,
    source_ts: 1_000,
    ingest_ts: 1_001,
    story_id: 1,
    provider: "test",
    source: "TestWire",
    headline: "AMD headline",
    summary: "",
    content_html: "",
    url: "",
    published_ts: 1_000,
    updated_ts: 1_000,
    provider_symbols: ["AMD"],
    resolved_symbols: ["AMD"],
    symbol_resolution: "provider",
    ...overrides
  }) as NewsStory;

describe("local market-command ticker rail fallback", () => {
  it("normalizes watchlists and falls back to the default pinned list", () => {
    expect(normalizeMarketCommandWatchlist([" spy ", "NVDA", "spy", "bad symbol"])).toEqual([
      "SPY",
      "NVDA"
    ]);
    expect(normalizeMarketCommandWatchlist(["bad symbol"])).toEqual([
      ...DEFAULT_MARKET_COMMAND_WATCHLIST
    ]);
  });

  it("builds a server-compatible local fallback response", () => {
    const response = buildLocalMarketCommandTickerRail({
      watchlist: ["spy", "nvda"],
      limit: 4,
      nowTs: 2_000,
      equityPrints: [
        makeEquityPrint({ trace_id: "spy-open", source_ts: 1_000, price: 500 }),
        makeEquityPrint({ trace_id: "spy-last", seq: 2, source_ts: 1_800, price: 505 })
      ],
      optionPrints: [makeOptionPrint()],
      flowPackets: [makeFlowPacket()],
      newsStories: [makeNewsStory()]
    });

    expect(response.degraded).toBe(true);
    expect(response.degraded_reasons).toEqual(["local_fallback"]);
    expect(response.watchlist).toEqual(["SPY", "NVDA"]);
    expect(response.pinned.map((item) => [item.symbol, item.source])).toEqual([
      ["SPY", "both"],
      ["NVDA", "pinned"]
    ]);
    expect(response.pinned[0]?.price).toBe(505);
    expect(response.pinned[0]?.change_pct).toBe(1);
    expect(response.important[0]?.symbol).toBe("AMD");
    expect(response.important[0]?.reasons.map((reason) => reason.kind)).toContain("flow_packet");
  });
});
