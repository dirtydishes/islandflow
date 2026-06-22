import {
  compareDurableTapeNewestFirst,
  compareDurableTapeOldestFirst,
  extractDurableTapeSortSeq,
  extractDurableTapeSortTs,
  getDurableTapeCursor,
  getDurableTapeItemKey
} from "./keys";
import type { DurableTapeCursor, DurableTapeSortableItem } from "./types";

export const DURABLE_TAPE_DEFAULT_HOT_LIMIT = 500;

export const mergeNewestWithOverflow = <TItem extends DurableTapeSortableItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit = DURABLE_TAPE_DEFAULT_HOT_LIMIT,
  onTrim?: (evicted: number) => void
): { kept: TItem[]; evicted: TItem[] } => {
  const combined = [...incoming, ...existing];
  if (combined.length === 0) {
    return { kept: combined, evicted: [] };
  }

  const seen = new Set<string>();
  const deduped: TItem[] = [];

  for (const item of combined) {
    const key = getDurableTapeItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort(compareDurableTapeNewestFirst);

  const safeLimit = Math.max(1, Math.floor(limit));
  const evicted = deduped.slice(safeLimit);
  if (evicted.length > 0) {
    onTrim?.(evicted.length);
  }

  return {
    kept: deduped.slice(0, safeLimit),
    evicted
  };
};

export const mergeNewest = <TItem extends DurableTapeSortableItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit = DURABLE_TAPE_DEFAULT_HOT_LIMIT,
  onTrim?: (evicted: number) => void
): TItem[] => {
  return mergeNewestWithOverflow(incoming, existing, limit, onTrim).kept;
};

export const composeTapeItems = <TItem extends DurableTapeSortableItem>(
  seedItems: readonly TItem[],
  liveItems: readonly TItem[],
  historyItems: readonly TItem[]
): TItem[] => {
  const deduped = new Map<string, TItem>();
  for (const item of [...seedItems, ...liveItems, ...historyItems]) {
    deduped.set(getDurableTapeItemKey(item), item);
  }
  return Array.from(deduped.values()).sort(compareDurableTapeNewestFirst);
};

export const appendHistoryTail = <TItem extends DurableTapeSortableItem>(
  current: readonly TItem[],
  incoming: readonly TItem[],
  liveHead: readonly TItem[],
  cap = 0
): TItem[] => {
  if (incoming.length === 0) {
    return [...current];
  }

  const seen = new Set<string>(liveHead.map((item) => getDurableTapeItemKey(item)));
  const combined: TItem[] = [];

  for (const item of [...current, ...incoming]) {
    const key = getDurableTapeItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(item);
  }

  combined.sort(compareDurableTapeNewestFirst);

  return cap > 0 ? combined.slice(0, cap) : combined;
};

export const mergeHeldTapeHistory = <TItem extends DurableTapeSortableItem>(
  displayedHistory: readonly TItem[],
  incomingHistory: readonly TItem[],
  frozenLiveHead: readonly TItem[]
): TItem[] => {
  if (displayedHistory.length === 0) {
    return appendHistoryTail([], incomingHistory, frozenLiveHead, 0);
  }

  const sortedDisplayed = appendHistoryTail([], displayedHistory, frozenLiveHead, 0);
  const tail = sortedDisplayed.at(-1);
  const tailTs = tail ? extractDurableTapeSortTs(tail) : Number.POSITIVE_INFINITY;
  const tailSeq = tail ? extractDurableTapeSortSeq(tail) : Number.POSITIVE_INFINITY;
  const olderIncoming = incomingHistory.filter((item) => {
    const itemTs = extractDurableTapeSortTs(item);
    if (itemTs < tailTs) {
      return true;
    }
    return itemTs === tailTs && extractDurableTapeSortSeq(item) < tailSeq;
  });

  return appendHistoryTail(sortedDisplayed, olderIncoming, frozenLiveHead, 0);
};

export const selectOlderHistoryCursor = <TItem>(
  items: readonly TItem[],
  getCursor: (item: TItem) => DurableTapeCursor
): DurableTapeCursor | null => {
  let oldest: DurableTapeCursor | null = null;

  for (const item of items) {
    const cursor = getCursor(item);
    if (!oldest || compareDurableTapeOldestFirst(cursor, oldest) < 0) {
      oldest = cursor;
    }
  }

  return oldest;
};

export const selectOlderHistoryCursorFromSortable = <TItem extends DurableTapeSortableItem>(
  items: readonly TItem[]
): DurableTapeCursor | null => {
  return selectOlderHistoryCursor(items, getDurableTapeCursor);
};
