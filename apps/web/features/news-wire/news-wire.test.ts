import { describe, expect, it } from "bun:test";

import { selectDurableTapeTemplate } from "../durable-tape/templates";
import { filterNewsStories } from "./filters";
import { formatNewsSymbolsLabel, getNewsStoryCursor, getNewsWireStatus } from "./format";
import {
  buildNewsWireHistoryUrl,
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

  it("uses published timestamp and seq for /history/news cursor requests", () => {
    const cursor = getNewsStoryCursor(makeStory({ published_ts: 123_456, seq: 9 }));
    const url = buildNewsWireHistoryUrl({
      cursor,
      buildApiUrl: (path) => `https://api.flow.deltaisland.io${path}`
    });

    expect(cursor).toEqual({ ts: 123_456, seq: 9 });
    expect(url).toBe(
      `https://api.flow.deltaisland.io${NEWS_WIRE_HISTORY_ENDPOINT}?before_ts=123456&before_seq=9&limit=${NEWS_WIRE_HISTORY_BATCH}`
    );
  });
});
