import {
  compareDurableTapeNewestCursorFirst,
  compareDurableTapeOldestFirst,
  extractDurableTapeSortSeq,
  extractDurableTapeSortTs,
  getDurableTapeCursor,
  getDurableTapeItemKey
} from "./keys";
import type { DurableTapeCursor, DurableTapeItemAccessors, DurableTapeSortableItem } from "./types";

export const DURABLE_TAPE_DEFAULT_HOT_LIMIT = 500;
export const DURABLE_TAPE_INITIAL_HISTORY_SEQ = Number.MAX_SAFE_INTEGER;

const DEFAULT_SORTABLE_ACCESSORS: DurableTapeItemAccessors<DurableTapeSortableItem> = {
  getKey: getDurableTapeItemKey,
  getCursor: getDurableTapeCursor
};

export const getDefaultDurableTapeItemAccessors = <
  TItem extends DurableTapeSortableItem
>(): DurableTapeItemAccessors<TItem> => {
  return DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>;
};

export function mergeNewestWithOverflow<TItem extends DurableTapeSortableItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit?: number,
  onTrim?: (evicted: number) => void
): { kept: TItem[]; evicted: TItem[] };
export function mergeNewestWithOverflow<TItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit: number | undefined,
  onTrim: ((evicted: number) => void) | undefined,
  accessors: DurableTapeItemAccessors<TItem>
): { kept: TItem[]; evicted: TItem[] };
export function mergeNewestWithOverflow<TItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit = DURABLE_TAPE_DEFAULT_HOT_LIMIT,
  onTrim?: (evicted: number) => void,
  accessors: DurableTapeItemAccessors<TItem> = DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>
): { kept: TItem[]; evicted: TItem[] } {
  const combined = [...incoming, ...existing];
  if (combined.length === 0) {
    return { kept: combined, evicted: [] };
  }

  const seen = new Set<string>();
  const deduped: TItem[] = [];

  for (const item of combined) {
    const key = accessors.getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((left, right) =>
    compareDurableTapeNewestCursorFirst(accessors.getCursor(left), accessors.getCursor(right))
  );

  const safeLimit = Math.max(1, Math.floor(limit));
  const evicted = deduped.slice(safeLimit);
  if (evicted.length > 0) {
    onTrim?.(evicted.length);
  }

  return {
    kept: deduped.slice(0, safeLimit),
    evicted
  };
}

export function mergeNewest<TItem extends DurableTapeSortableItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit?: number,
  onTrim?: (evicted: number) => void
): TItem[];
export function mergeNewest<TItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit: number | undefined,
  onTrim: ((evicted: number) => void) | undefined,
  accessors: DurableTapeItemAccessors<TItem>
): TItem[];
export function mergeNewest<TItem>(
  incoming: readonly TItem[],
  existing: readonly TItem[],
  limit = DURABLE_TAPE_DEFAULT_HOT_LIMIT,
  onTrim?: (evicted: number) => void,
  accessors?: DurableTapeItemAccessors<TItem>
): TItem[] {
  return mergeNewestWithOverflow(
    incoming,
    existing,
    limit,
    onTrim,
    accessors ?? (DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>)
  ).kept;
}

export function composeTapeItems<TItem extends DurableTapeSortableItem>(
  seedItems: readonly TItem[],
  liveItems: readonly TItem[],
  historyItems: readonly TItem[]
): TItem[];
export function composeTapeItems<TItem>(
  seedItems: readonly TItem[],
  liveItems: readonly TItem[],
  historyItems: readonly TItem[],
  accessors: DurableTapeItemAccessors<TItem>
): TItem[];
export function composeTapeItems<TItem>(
  seedItems: readonly TItem[],
  liveItems: readonly TItem[],
  historyItems: readonly TItem[],
  accessors: DurableTapeItemAccessors<TItem> = DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>
): TItem[] {
  const deduped = new Map<string, TItem>();
  for (const item of [...seedItems, ...liveItems, ...historyItems]) {
    deduped.set(accessors.getKey(item), item);
  }
  return Array.from(deduped.values()).sort((left, right) =>
    compareDurableTapeNewestCursorFirst(accessors.getCursor(left), accessors.getCursor(right))
  );
}

export function appendHistoryTail<TItem extends DurableTapeSortableItem>(
  current: readonly TItem[],
  incoming: readonly TItem[],
  liveHead: readonly TItem[],
  cap?: number
): TItem[];
export function appendHistoryTail<TItem>(
  current: readonly TItem[],
  incoming: readonly TItem[],
  liveHead: readonly TItem[],
  cap: number | undefined,
  accessors: DurableTapeItemAccessors<TItem>
): TItem[];
export function appendHistoryTail<TItem>(
  current: readonly TItem[],
  incoming: readonly TItem[],
  liveHead: readonly TItem[],
  cap = 0,
  accessors: DurableTapeItemAccessors<TItem> = DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>
): TItem[] {
  if (incoming.length === 0) {
    return [...current];
  }

  const seen = new Set<string>(liveHead.map((item) => accessors.getKey(item)));
  const combined: TItem[] = [];

  for (const item of [...current, ...incoming]) {
    const key = accessors.getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(item);
  }

  combined.sort((left, right) =>
    compareDurableTapeNewestCursorFirst(accessors.getCursor(left), accessors.getCursor(right))
  );

  return cap > 0 ? combined.slice(0, cap) : combined;
}

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

export const createDurableTapeInitialHistoryCursor = (now = Date.now()): DurableTapeCursor => ({
  ts: Math.max(0, Math.floor(now)),
  seq: DURABLE_TAPE_INITIAL_HISTORY_SEQ
});

export const isSameDurableTapeCursor = (
  left: DurableTapeCursor,
  right: DurableTapeCursor
): boolean => left.ts === right.ts && left.seq === right.seq;

export const shouldApplyDurableTapeHistoryLoad = ({
  loadGeneration,
  currentGeneration
}: {
  loadGeneration: number;
  currentGeneration: number;
}): boolean => loadGeneration === currentGeneration;

export const selectDurableTapeHistoryCursor = <TItem>({
  currentCursor,
  items,
  getCursor,
  initialCursor
}: {
  currentCursor?: DurableTapeCursor | null;
  items: readonly TItem[];
  getCursor: (item: TItem) => DurableTapeCursor;
  initialCursor?: DurableTapeCursor | null;
}): DurableTapeCursor | null => {
  if (currentCursor) {
    return currentCursor;
  }

  const rowCursor = selectOlderHistoryCursor(items, getCursor);
  if (rowCursor) {
    return rowCursor;
  }

  return items.length === 0 ? (initialCursor ?? null) : null;
};

export const selectOlderHistoryCursorFromSortable = <TItem extends DurableTapeSortableItem>(
  items: readonly TItem[]
): DurableTapeCursor | null => {
  return selectOlderHistoryCursor(items, getDurableTapeCursor);
};
