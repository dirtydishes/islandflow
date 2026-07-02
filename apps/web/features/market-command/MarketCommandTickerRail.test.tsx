import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketCommandTickerRail } from "./MarketCommandTickerRail";

const makeFeed = (items: unknown[]) => ({ items });

describe("MarketCommandTickerRail", () => {
  it("renders local fallback rail content without a server response", () => {
    const state = {
      activeTickers: ["SPY"],
      selectedInstrument: null,
      focusTickerSymbol: mock(),
      clearBoardFocus: mock(),
      options: makeFeed([]),
      equities: makeFeed([
        {
          trace_id: "spy-open",
          seq: 1,
          ts: 1_000,
          source_ts: 1_000,
          ingest_ts: 1_001,
          underlying_id: "SPY",
          price: 500,
          size: 100,
          exchange: "X",
          offExchangeFlag: false
        },
        {
          trace_id: "spy-last",
          seq: 2,
          ts: 1_500,
          source_ts: 1_500,
          ingest_ts: 1_501,
          underlying_id: "SPY",
          price: 505,
          size: 100,
          exchange: "X",
          offExchangeFlag: false
        }
      ]),
      flow: makeFeed([]),
      alerts: makeFeed([]),
      smartFlow: makeFeed([]),
      news: makeFeed([])
    };

    const html = renderToStaticMarkup(
      <MarketCommandTickerRail state={state as never} watchlist={["SPY"]} />
    );

    expect(html).toContain('data-local-fallback="true"');
    expect(html).toContain("Local fallback");
    expect(html).toContain("Pinned");
    expect(html).toContain("Important now");
    expect(html).toContain("SPY");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Clear board");
  });
});
