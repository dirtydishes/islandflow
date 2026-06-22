import { describe, expect, it } from "bun:test";

import {
  appendHistoryTail,
  composeTapeItems,
  mergeHeldTapeHistory,
  mergeNewestWithOverflow,
  selectOlderHistoryCursor,
  selectOlderHistoryCursorFromSortable
} from "./history";

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

const customAccessors = {
  getKey: (item: { key: string; cursor: { ts: number; seq: number } }) => item.key,
  getCursor: (item: { key: string; cursor: { ts: number; seq: number } }) => item.cursor
};

describe("durable tape history composition", () => {
  it("sorts the hot head newest-first and returns overflow", () => {
    const { kept, evicted } = mergeNewestWithOverflow(
      [makeItem("new", 4, 400), makeItem("old-duplicate", 1, 100)],
      [makeItem("mid", 3, 300), makeItem("old-duplicate", 1, 100)],
      2
    );

    expect(kept.map((item) => item.trace_id)).toEqual(["new", "mid"]);
    expect(evicted.map((item) => item.trace_id)).toEqual(["old-duplicate"]);
  });

  it("dedupes seed, hot, and ClickHouse history rows across the seam", () => {
    const items = composeTapeItems(
      [makeItem("clicked", 2, 200)],
      [makeItem("new", 4, 400), makeItem("clicked", 2, 200)],
      [makeItem("older", 1, 100)]
    );

    expect(items.map((item) => item.trace_id)).toEqual(["new", "clicked", "older"]);
  });

  it("supports caller-provided identity and cursor accessors", () => {
    const items = composeTapeItems(
      [{ key: "clicked", cursor: { ts: 200, seq: 2 } }],
      [
        { key: "new", cursor: { ts: 400, seq: 4 } },
        { key: "clicked", cursor: { ts: 200, seq: 2 } }
      ],
      [{ key: "older", cursor: { ts: 100, seq: 1 } }],
      customAccessors
    );

    expect(items.map((item) => item.key)).toEqual(["new", "clicked", "older"]);
  });

  it("promotes hot overflow into the history tail without duplicating the live head", () => {
    const hot = [makeItem("hot-3", 3, 300), makeItem("hot-2", 2, 200)];
    const { kept, evicted } = mergeNewestWithOverflow([makeItem("hot-4", 4, 400)], hot, 2);
    const history = appendHistoryTail([], evicted, kept, 0);

    expect(kept.map((item) => item.trace_id)).toEqual(["hot-4", "hot-3"]);
    expect(history.map((item) => item.trace_id)).toEqual(["hot-2"]);
  });

  it("uses caller-provided accessors when appending the history tail", () => {
    const current = [{ key: "hist-2", cursor: { ts: 200, seq: 2 } }];
    const incoming = [
      { key: "live-duplicate", cursor: { ts: 300, seq: 3 } },
      { key: "hist-1", cursor: { ts: 100, seq: 1 } }
    ];
    const liveHead = [{ key: "live-duplicate", cursor: { ts: 300, seq: 3 } }];

    const history = appendHistoryTail(current, incoming, liveHead, 0, customAccessors);

    expect(history.map((item) => item.key)).toEqual(["hist-2", "hist-1"]);
  });

  it("keeps held history stable while appending truly older rows", () => {
    const held = [makeItem("hist-3", 3, 300), makeItem("hist-2", 2, 200)];
    const incoming = [
      makeItem("overflow-newer", 6, 600),
      makeItem("hist-3", 3, 300),
      makeItem("older-1", 1, 100)
    ];

    expect(
      mergeHeldTapeHistory(held, incoming, [makeItem("hot-5", 5, 500)]).map((item) => item.trace_id)
    ).toEqual(["hist-3", "hist-2", "older-1"]);
  });

  it("selects the oldest composed cursor for older-history paging", () => {
    const cursor = selectOlderHistoryCursorFromSortable([
      makeItem("hot", 8, 800),
      makeItem("older", 2, 200),
      makeItem("oldest", 1, 200)
    ]);

    expect(cursor).toEqual({ ts: 200, seq: 1 });
  });

  it("returns null when no rows can supply a cursor", () => {
    expect(selectOlderHistoryCursor([], (item: never) => item)).toBeNull();
  });
});
