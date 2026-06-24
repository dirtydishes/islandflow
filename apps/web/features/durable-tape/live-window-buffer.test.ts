import { describe, expect, it } from "bun:test";

import { mergeNewestWithOverflow } from "./history";
import { createLiveWindowBuffer } from "./live-window-buffer";

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

const expectUpsertParity = (
  incoming: readonly ReturnType<typeof makeItem>[],
  existing: readonly ReturnType<typeof makeItem>[],
  limit: number
) => {
  const buffer = createLiveWindowBuffer<ReturnType<typeof makeItem>>({ limit });
  buffer.reset(existing);

  const incremental = buffer.upsertMany(incoming);
  const merged = mergeNewestWithOverflow(incoming, existing, limit);

  expect(incremental.items.map((item) => item.trace_id)).toEqual(
    merged.kept.map((item) => item.trace_id)
  );
  expect(incremental.evicted.map((item) => item.trace_id)).toEqual(
    merged.evicted.map((item) => item.trace_id)
  );
};

describe("live window buffer", () => {
  it("inserts newer rows without changing merge semantics", () => {
    expectUpsertParity(
      [makeItem("new", 4, 400)],
      [makeItem("mid", 3, 300), makeItem("old", 1, 100)],
      4
    );
  });

  it("uses incoming duplicate updates by key", () => {
    const buffer = createLiveWindowBuffer<ReturnType<typeof makeItem>>({ limit: 3 });
    buffer.reset([makeItem("same", 3, 300), makeItem("old", 1, 100)]);

    const snapshot = buffer.upsertMany([makeItem("same", 3, 500)]);

    expect(snapshot.items.map((item) => [item.trace_id, item.ts])).toEqual([
      ["same", 500],
      ["old", 100]
    ]);
  });

  it("keeps out-of-order incoming rows in newest-first order", () => {
    expectUpsertParity(
      [makeItem("older", 2, 200)],
      [makeItem("newer", 5, 500), makeItem("mid", 3, 300)],
      5
    );
  });

  it("resets from unsorted rows with the same bounded ordering as merge", () => {
    const rows = [
      makeItem("old", 1, 100),
      makeItem("new", 4, 400),
      makeItem("dupe", 3, 300),
      makeItem("dupe", 3, 350)
    ];
    const buffer = createLiveWindowBuffer<ReturnType<typeof makeItem>>({ limit: 3 });

    const snapshot = buffer.reset(rows);
    const merged = mergeNewestWithOverflow(rows, [], 3);

    expect(snapshot.items.map((item) => [item.trace_id, item.ts])).toEqual(
      merged.kept.map((item) => [item.trace_id, item.ts])
    );
    expect(snapshot.evicted.map((item) => item.trace_id)).toEqual(
      merged.evicted.map((item) => item.trace_id)
    );
  });

  it("evicts overflow rows and reports trims", () => {
    let trimmed = 0;
    const buffer = createLiveWindowBuffer<ReturnType<typeof makeItem>>({
      limit: 2,
      onTrim: (count) => {
        trimmed += count;
      }
    });
    buffer.reset([makeItem("row-2", 2, 200), makeItem("row-1", 1, 100)]);

    const snapshot = buffer.upsertMany([makeItem("row-3", 3, 300)]);

    expect(snapshot.items.map((item) => item.trace_id)).toEqual(["row-3", "row-2"]);
    expect(snapshot.evicted.map((item) => item.trace_id)).toEqual(["row-1"]);
    expect(trimmed).toBe(1);
  });

  it("preserves incoming batch order for equal cursors", () => {
    const buffer = createLiveWindowBuffer<ReturnType<typeof makeItem>>({ limit: 4 });
    buffer.reset([makeItem("existing", 1, 100)]);

    const snapshot = buffer.upsertMany([
      makeItem("incoming-a", 1, 100),
      makeItem("incoming-b", 1, 100)
    ]);

    expect(snapshot.items.map((item) => item.trace_id)).toEqual([
      "incoming-a",
      "incoming-b",
      "existing"
    ]);
  });
});
