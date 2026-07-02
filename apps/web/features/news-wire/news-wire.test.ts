import { describe, expect, it } from "bun:test";

import { selectDurableTapeTemplate } from "../durable-tape/templates";
import {
  filterNewsStories,
  getNewsWireRelevanceSortCursor,
  isNewsStoryFocusedForScope,
  orderNewsStoriesByScopeRelevance,
  summarizeNewsWireRelevance
} from "./filters";
import {
  formatNewsBodyText,
  formatNewsSymbolsLabel,
  getNewsStoryCursor,
  getNewsWireStatus
} from "./format";
import {
  buildNewsWireHistoryUrl,
  fetchNewsWireHistoryPage,
  NEWS_WIRE_HISTORY_BATCH,
  NEWS_WIRE_HISTORY_ENDPOINT
} from "./history";
import { NEWS_WIRE_COLUMNS, NEWS_WIRE_TEMPLATES } from "./templates";

const makeStory = (overrides: Partial<Parameters<typeof getNewsWireStatus>[0]> = {}) =>
  ({
    trace_id: "news-1",
    seq: 1,
    source_ts: 1_000,
    ingest_ts: 1_001,
    story_id: 77,
    provider: "alpaca",
    source: "Reuters",
    headline: "AAPL moves",
    summary: "summary",
    content_html: "<p>body</p>",
    url: "https://example.com/story",
    published_ts: 1_000,
    updated_ts: 1_000,
    provider_symbols: ["AAPL"],
    resolved_symbols: ["AAPL"],
    symbol_resolution: "provider",
    ...overrides
  }) as Parameters<typeof getNewsWireStatus>[0];

describe("news wire helpers", () => {
  it("formats mapped, crowded, market-wide, and unmapped symbol labels", () => {
    expect(formatNewsSymbolsLabel(makeStory({ resolved_symbols: ["AAPL", "MSFT"] }))).toBe(
      "AAPL, MSFT"
    );
    expect(
      formatNewsSymbolsLabel(
        makeStory({ resolved_symbols: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"] })
      )
    ).toBe("AAPL, MSFT, NVDA, TSLA +1");
    expect(
      formatNewsSymbolsLabel(makeStory({ resolved_symbols: [], symbol_resolution: "none" }))
    ).toBe("unmapped");
    expect(
      formatNewsSymbolsLabel(makeStory({ resolved_symbols: [], symbol_resolution: "derived" }))
    ).toBe("market");
  });

  it("keeps updated state out of default columns while exposing status for detail", () => {
    expect(getNewsWireStatus(makeStory({ updated_ts: 2_000 }))).toBe("updated");
    expect(getNewsWireStatus(makeStory({ resolved_symbols: ["SPY"] }))).toBe("mapped");
    expect(getNewsWireStatus(makeStory({ resolved_symbols: [] }))).toBe("unmapped");
    expect(NEWS_WIRE_TEMPLATES[0]?.columns).toEqual(["time", "source", "symbols", "headline"]);
  });

  it("steps down to the one-third headline template before horizontal scrolling is required", () => {
    const selection = selectDurableTapeTemplate({
      columns: NEWS_WIRE_COLUMNS,
      templates: NEWS_WIRE_TEMPLATES,
      containerWidth: 390,
      requestedTemplate: "auto"
    });

    expect(selection.template.id).toBe("oneThird");
    expect(selection.columns.map((column) => column.id)).toEqual(["time", "headline"]);
    expect(selection.fits).toBe(true);
  });

  it("filters by route scope, source, mapped state, updated state, and explicit symbols", () => {
    const stories = [
      makeStory({ trace_id: "a", resolved_symbols: ["AAPL"], source: "Reuters" }),
      makeStory({
        trace_id: "b",
        resolved_symbols: ["MSFT"],
        source: "Bloomberg",
        updated_ts: 2_000
      }),
      makeStory({ trace_id: "c", resolved_symbols: [], source: "Newswire" })
    ];

    expect(
      filterNewsStories(stories, { scopeSymbols: ["AAPL"] }).map((story) => story.trace_id)
    ).toEqual(["a"]);
    expect(
      filterNewsStories(stories, { sources: ["Bloomberg"] }).map((story) => story.trace_id)
    ).toEqual(["b"]);
    expect(
      filterNewsStories(stories, { mapped: "unmapped" }).map((story) => story.trace_id)
    ).toEqual(["c"]);
    expect(
      filterNewsStories(stories, { symbols: ["MSFT"], updatedOnly: true }).map(
        (story) => story.trace_id
      )
    ).toEqual(["b"]);
  });

  it("promotes focused ticker stories without hiding the market wire", () => {
    const stories = [
      makeStory({ trace_id: "market-open", resolved_symbols: [], symbol_resolution: "derived" }),
      makeStory({ trace_id: "spy-first", resolved_symbols: ["SPY"] }),
      makeStory({ trace_id: "msft", resolved_symbols: ["MSFT"] }),
      makeStory({ trace_id: "spy-second", resolved_symbols: ["AAPL", "SPY"] })
    ];

    const ordered = orderNewsStoriesByScopeRelevance(stories, ["SPY"]);

    expect(ordered.map((story) => story.trace_id)).toEqual([
      "spy-first",
      "spy-second",
      "market-open",
      "msft"
    ]);
    expect(summarizeNewsWireRelevance(stories, ["SPY"])).toEqual({
      focused: 2,
      market: 2
    });
  });

  it("keeps focused relevance stable for history rows outside the live rank set", () => {
    const focusedOlder = makeStory({
      trace_id: "spy-old-history",
      published_ts: 1_000,
      resolved_symbols: ["SPY"]
    });
    const marketNewer = makeStory({
      trace_id: "market-newer",
      published_ts: 5_000,
      resolved_symbols: ["QQQ"]
    });

    const focusedCursor = getNewsWireRelevanceSortCursor(focusedOlder, ["SPY"], getNewsStoryCursor);
    const marketCursor = getNewsWireRelevanceSortCursor(marketNewer, ["SPY"], getNewsStoryCursor);

    expect(isNewsStoryFocusedForScope(focusedOlder, ["SPY"])).toBe(true);
    expect(isNewsStoryFocusedForScope(marketNewer, ["SPY"])).toBe(false);
    expect(focusedCursor.ts).toBeGreaterThan(marketCursor.ts);
    expect(focusedCursor.seq).toBe(getNewsStoryCursor(focusedOlder).seq);
    expect(marketCursor).toEqual(getNewsStoryCursor(marketNewer));
  });

  it("preserves the market wire when the focused ticker has no mapped stories", () => {
    const stories = [
      makeStory({ trace_id: "market-open", resolved_symbols: [], symbol_resolution: "derived" }),
      makeStory({ trace_id: "msft", resolved_symbols: ["MSFT"] })
    ];

    const ordered = orderNewsStoriesByScopeRelevance(stories, ["NVDA"]);

    expect(ordered.map((story) => story.trace_id)).toEqual(["market-open", "msft"]);
    expect(summarizeNewsWireRelevance(stories, ["NVDA"])).toEqual({
      focused: 0,
      market: 2
    });
  });

  it("uses published timestamp and seq for /history/news cursor requests", () => {
    const cursor = getNewsStoryCursor(makeStory({ published_ts: 123_456, seq: 9 }));
    const url = buildNewsWireHistoryUrl({
      cursor,
      buildApiUrl: (path) => `https://api.example.test${path}`
    });

    expect(cursor).toEqual({ ts: 123_456, seq: 9 });
    expect(url).toBe(
      `https://api.example.test${NEWS_WIRE_HISTORY_ENDPOINT}?before_ts=123456&before_seq=9&limit=${NEWS_WIRE_HISTORY_BATCH}`
    );
  });

  it("continues paging history until client-side filters find a matching story", async () => {
    const requestedUrls: string[] = [];
    const matchingStory = makeStory({
      trace_id: "matching",
      seq: 6,
      published_ts: 600,
      resolved_symbols: ["AAPL"]
    });

    const page = await fetchNewsWireHistoryPage({
      cursor: { ts: 1_000, seq: 10 },
      filters: { symbols: ["AAPL"] },
      buildApiUrl: (path) => `https://api.example.test${path}`,
      fetcher: async (url) => {
        requestedUrls.push(url);
        if (requestedUrls.length === 1) {
          return Response.json({
            data: [
              makeStory({
                trace_id: "miss",
                seq: 9,
                published_ts: 900,
                resolved_symbols: ["MSFT"]
              })
            ],
            next_before: { ts: 900, seq: 9 }
          });
        }
        return Response.json({
          data: [matchingStory],
          next_before: { ts: 600, seq: 6 }
        });
      }
    });

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[1]).toContain("before_ts=900&before_seq=9");
    expect(page.items.map((story) => story.trace_id)).toEqual(["matching"]);
    expect(page.nextCursor).toEqual({ ts: 600, seq: 6 });
    expect(page.exhausted).toBe(false);
  });

  it("surfaces non-ok history response details", async () => {
    await expect(
      fetchNewsWireHistoryPage({
        cursor: { ts: 1_000, seq: 10 },
        fetcher: async () =>
          new Response(JSON.stringify({ detail: "history unavailable" }), {
            status: 503,
            statusText: "Service Unavailable"
          })
      })
    ).rejects.toThrow("history unavailable");
  });

  it("formats provider html bodies as decoded text for detail rendering", () => {
    expect(
      formatNewsBodyText(
        '<p>Safe &amp; useful</p><img src=x onerror="alert(1)"><script>alert(2)</script>'
      )
    ).toBe("Safe & useful");
  });
});
