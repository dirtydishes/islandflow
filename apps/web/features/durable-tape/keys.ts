import type { DurableTapeCursor, DurableTapeSortableItem } from "./types";

export const extractDurableTapeSortTs = (item: DurableTapeSortableItem): number => {
  return item.ts ?? item.source_ts ?? item.ingest_ts ?? 0;
};

export const extractDurableTapeSortSeq = (item: DurableTapeSortableItem): number => {
  return item.seq ?? 0;
};

export const buildDurableTapeItemKey = (item: DurableTapeSortableItem): string | null => {
  if (item.trace_id) {
    return `${item.trace_id}:${item.seq ?? ""}`;
  }

  if (item.id) {
    return `id:${item.id}`;
  }

  return null;
};

export const getDurableTapeItemKey = (item: DurableTapeSortableItem): string => {
  return (
    buildDurableTapeItemKey(item) ??
    `${extractDurableTapeSortTs(item)}:${extractDurableTapeSortSeq(item)}`
  );
};

export const getDurableTapeCursor = (item: DurableTapeSortableItem): DurableTapeCursor => {
  return {
    ts: extractDurableTapeSortTs(item),
    seq: extractDurableTapeSortSeq(item)
  };
};

export const compareDurableTapeNewestFirst = (
  left: DurableTapeSortableItem,
  right: DurableTapeSortableItem
): number => {
  const tsDelta = extractDurableTapeSortTs(right) - extractDurableTapeSortTs(left);
  if (tsDelta !== 0) {
    return tsDelta;
  }
  return extractDurableTapeSortSeq(right) - extractDurableTapeSortSeq(left);
};

export const compareDurableTapeOldestFirst = (
  left: DurableTapeCursor,
  right: DurableTapeCursor
): number => {
  const tsDelta = left.ts - right.ts;
  if (tsDelta !== 0) {
    return tsDelta;
  }
  return left.seq - right.seq;
};

export const compareDurableTapeNewestCursorFirst = (
  left: DurableTapeCursor,
  right: DurableTapeCursor
): number => {
  return compareDurableTapeOldestFirst(right, left);
};

export const findAnchorRestoreIndex = (
  keys: readonly string[],
  anchorKey: string,
  fallbackKeys: readonly string[]
): number => {
  const directIndex = keys.indexOf(anchorKey);
  if (directIndex >= 0) {
    return directIndex;
  }

  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  for (const key of fallbackKeys) {
    const index = indexByKey.get(key);
    if (typeof index === "number") {
      return index;
    }
  }

  return -1;
};
