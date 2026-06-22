import { describe, expect, it } from "bun:test";
import type { VirtualItem } from "@tanstack/react-virtual";

import { getDurableTapeItemKey } from "./keys";
import { buildDurableTapeVirtualRows, shouldLoadOlderFromVirtualRows } from "./virtual";

const makeItem = (traceId: string, seq: number, ts: number) => ({
  trace_id: traceId,
  seq,
  ts
});

const makeVirtual = (index: number): VirtualItem =>
  ({
    index,
    key: index,
    start: index * 36,
    size: 36,
    end: index * 36 + 36,
    lane: 0
  }) as VirtualItem;

describe("durable tape virtual rows", () => {
  it("uses data row keys rather than array indexes", () => {
    const items = [makeItem("a", 1, 100), makeItem("b", 2, 200)];
    const rows = buildDurableTapeVirtualRows(items, [makeVirtual(0), makeVirtual(1)], (item) =>
      getDurableTapeItemKey(item)
    );

    expect(rows.map((row) => row.key)).toEqual(["a:1", "b:2"]);
  });

  it("keeps existing row keys stable when hot rows insert above them", () => {
    const before = [makeItem("b", 2, 200), makeItem("a", 1, 100)];
    const after = [makeItem("c", 3, 300), ...before];

    const beforeRows = buildDurableTapeVirtualRows(
      before,
      [makeVirtual(0), makeVirtual(1)],
      getDurableTapeItemKey
    );
    const afterRows = buildDurableTapeVirtualRows(
      after,
      [makeVirtual(1), makeVirtual(2)],
      getDurableTapeItemKey
    );

    expect(afterRows.map((row) => row.key)).toEqual(beforeRows.map((row) => row.key));
  });

  it("ignores virtual indexes with no backing item", () => {
    const rows = buildDurableTapeVirtualRows(
      [makeItem("a", 1, 100)],
      [makeVirtual(0), makeVirtual(4)],
      getDurableTapeItemKey
    );

    expect(rows.map((row) => row.key)).toEqual(["a:1"]);
  });

  it("detects when the last virtual row reaches the history tail", () => {
    expect(
      shouldLoadOlderFromVirtualRows({
        enabled: true,
        itemCount: 12,
        lastVirtualIndex: 11
      })
    ).toBe(true);
    expect(
      shouldLoadOlderFromVirtualRows({
        enabled: true,
        itemCount: 12,
        lastVirtualIndex: 10
      })
    ).toBe(false);
  });
});
