import type { Cursor, LiveSubscription } from "@islandflow/types";
import { LIVE_HISTORY_SOFT_CAP, LIVE_HOT_WINDOW } from "./config";
import type { LiveHistoryBuffer, PausableTapeData, SortableItem, WsStatus } from "./types";

type RetentionMetricKey =
  | "hotWindowEvictions"
  | "pinnedFetchMisses"
  | "pinnedFetchFailures"
  | "pinnedStoreSize";

export const frontendRetentionMetrics: Record<RetentionMetricKey, number> = {
  hotWindowEvictions: 0,
  pinnedFetchMisses: 0,
  pinnedFetchFailures: 0,
  pinnedStoreSize: 0
};

export const incrementRetentionMetric = (key: RetentionMetricKey, count = 1): void => {
  frontendRetentionMetrics[key] += count;
};

export const setRetentionMetric = (key: RetentionMetricKey, value: number): void => {
  frontendRetentionMetrics[key] = value;
};

export const extractSortTs = (item: SortableItem): number =>
  item.ts ?? item.source_ts ?? item.ingest_ts ?? 0;

export const extractSortSeq = (item: SortableItem): number => item.seq ?? 0;

export const buildItemKey = (item: SortableItem): string | null => {
  if (item.trace_id) {
    return `${item.trace_id}:${item.seq ?? ""}`;
  }

  if (item.id) {
    return `id:${item.id}`;
  }

  return null;
};

export const mergeNewestWithOverflow = <T extends SortableItem>(
  incoming: T[],
  existing: T[],
  limit = LIVE_HOT_WINDOW,
  onTrim?: (evicted: number) => void
): { kept: T[]; evicted: T[] } => {
  const combined = [...incoming, ...existing];
  if (combined.length === 0) {
    return { kept: combined, evicted: [] };
  }

  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of combined) {
    const key = buildItemKey(item);
    if (key) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const delta = extractSortTs(b) - extractSortTs(a);
    if (delta !== 0) {
      return delta;
    }
    return extractSortSeq(b) - extractSortSeq(a);
  });

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

export const mergeNewest = <T extends SortableItem>(
  incoming: T[],
  existing: T[],
  limit = LIVE_HOT_WINDOW,
  onTrim?: (evicted: number) => void
): T[] => {
  return mergeNewestWithOverflow(incoming, existing, limit, onTrim).kept;
};

export const getTapeItemKey = (item: SortableItem): string => {
  return buildItemKey(item) ?? `${extractSortTs(item)}:${extractSortSeq(item)}`;
};

export const composeTapeItems = <T extends SortableItem>(
  seedItems: T[],
  liveItems: T[],
  historyItems: T[]
): T[] => {
  const deduped = new Map<string, T>();
  for (const item of [...seedItems, ...liveItems, ...historyItems]) {
    deduped.set(getTapeItemKey(item), item);
  }
  return Array.from(deduped.values()).sort((a, b) => {
    const delta = extractSortTs(b) - extractSortTs(a);
    if (delta !== 0) {
      return delta;
    }
    return extractSortSeq(b) - extractSortSeq(a);
  });
};

export const reducePausableTapeData = <T extends SortableItem>(
  current: PausableTapeData<T>,
  incoming: T[],
  paused: boolean,
  retentionLimit = LIVE_HOT_WINDOW
): PausableTapeData<T> => {
  if (incoming.length === 0) {
    return current;
  }

  const seenKeys = current.seenKeys;
  let nextSeenKeys: Set<string> | null = null;
  const unseen: T[] = [];

  for (const item of incoming) {
    const key = getTapeItemKey(item);
    if (seenKeys.has(key)) {
      break;
    }
    if (!nextSeenKeys) {
      nextSeenKeys = new Set(seenKeys);
    }
    nextSeenKeys.add(key);
    unseen.push(item);
  }

  if (unseen.length === 0) {
    return current;
  }

  if (paused) {
    return {
      visible: current.visible,
      queued: mergeNewest(unseen, current.queued, retentionLimit, (evicted) =>
        incrementRetentionMetric("hotWindowEvictions", evicted)
      ),
      seenKeys: nextSeenKeys ?? seenKeys,
      dropped: current.dropped + unseen.length
    };
  }

  const nextBatch = current.queued.length > 0 ? [...current.queued, ...unseen] : unseen;
  return {
    visible: mergeNewest(nextBatch, current.visible, retentionLimit, (evicted) =>
      incrementRetentionMetric("hotWindowEvictions", evicted)
    ),
    queued: [],
    seenKeys: nextSeenKeys ?? seenKeys,
    dropped: 0
  };
};

export const flushPausableTapeData = <T extends SortableItem>(
  current: PausableTapeData<T>,
  retentionLimit = LIVE_HOT_WINDOW
): PausableTapeData<T> => {
  if (current.queued.length === 0) {
    return current.dropped === 0 ? current : { ...current, dropped: 0 };
  }

  return {
    visible: mergeNewest(current.queued, current.visible, retentionLimit, (evicted) =>
      incrementRetentionMetric("hotWindowEvictions", evicted)
    ),
    queued: [],
    seenKeys: current.seenKeys,
    dropped: 0
  };
};

export const EMPTY_PAUSABLE_TAPE = {
  visible: [],
  queued: [],
  seenKeys: new Set<string>(),
  dropped: 0
};

export const appendHistoryTail = <T extends SortableItem>(
  current: T[],
  incoming: T[],
  liveHead: T[],
  cap = LIVE_HISTORY_SOFT_CAP
): T[] => {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set<string>(liveHead.map((item) => getTapeItemKey(item)));
  const combined: T[] = [];

  for (const item of [...current, ...incoming]) {
    const key = getTapeItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(item);
  }

  combined.sort((a, b) => {
    const delta = extractSortTs(b) - extractSortTs(a);
    if (delta !== 0) {
      return delta;
    }
    return extractSortSeq(b) - extractSortSeq(a);
  });

  return cap > 0 ? combined.slice(0, cap) : combined;
};

export const mergeHeldTapeHistory = <T extends SortableItem>(
  displayedHistory: T[],
  incomingHistory: T[],
  frozenLiveHead: T[]
): T[] => {
  if (displayedHistory.length === 0) {
    return appendHistoryTail([], incomingHistory, frozenLiveHead, 0);
  }

  const sortedDisplayed = appendHistoryTail([], displayedHistory, frozenLiveHead, 0);
  const tail = sortedDisplayed.at(-1);
  const tailTs = tail ? extractSortTs(tail) : Number.POSITIVE_INFINITY;
  const tailSeq = tail ? extractSortSeq(tail) : Number.POSITIVE_INFINITY;
  const olderIncoming = incomingHistory.filter((item) => {
    const itemTs = extractSortTs(item);
    if (itemTs < tailTs) {
      return true;
    }
    return itemTs === tailTs && extractSortSeq(item) < tailSeq;
  });

  return appendHistoryTail(sortedDisplayed, olderIncoming, frozenLiveHead, 0);
};

export const getLiveHistoryRetentionCap = (subscription: LiveSubscription): number => {
  switch (subscription.channel) {
    case "options":
    case "equities":
      return 0;
    default:
      return LIVE_HISTORY_SOFT_CAP;
  }
};

export const getLiveFeedStatus = (
  sourceStatus: WsStatus,
  freshestTs: number | null,
  thresholdMs: number,
  now = Date.now(),
  behindDelayMs = 0
): WsStatus => {
  if (sourceStatus !== "connected") {
    return sourceStatus;
  }
  if (freshestTs === null) {
    return "connected";
  }

  const ageMs = now - freshestTs;
  if (ageMs <= thresholdMs) {
    return "connected";
  }

  const behindMs = ageMs - thresholdMs;
  return behindMs > behindDelayMs ? "stale" : "connected";
};

export const getHotChannelFeedStatus = (
  sourceStatus: WsStatus,
  health: { healthy: boolean } | null | undefined
): WsStatus => {
  if (sourceStatus !== "connected") {
    return sourceStatus;
  }
  if (!health) {
    return "connected";
  }
  return health.healthy ? "connected" : "stale";
};

export const findAnchorRestoreIndex = (
  keys: string[],
  anchorKey: string,
  fallbackKeys: string[]
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

export const projectPausableTapeState = <T extends SortableItem>(
  visible: T[],
  status: WsStatus,
  lastUpdate: number | null
): { items: T[]; lastUpdate: number | null } => ({
  items: visible,
  lastUpdate: status === "stale" ? null : lastUpdate
});

export type { LiveHistoryBuffer, PausableTapeData };
