import type { LiveSubscription } from "@islandflow/types";

import {
  appendHistoryTail,
  buildDurableTapeItemKey,
  composeTapeItems,
  createLiveWindowBuffer,
  extractDurableTapeSortSeq,
  extractDurableTapeSortTs,
  findAnchorRestoreIndex,
  flushDurableTapeScrollHold,
  getDurableTapeItemKey,
  mergeHeldTapeHistory,
  mergeNewest,
  mergeNewestWithOverflow,
  reduceDurableTapeScrollHold
} from "../durable-tape";
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

export const extractSortTs = extractDurableTapeSortTs;
export const extractSortSeq = extractDurableTapeSortSeq;
export const buildItemKey = buildDurableTapeItemKey;
export const getTapeItemKey = getDurableTapeItemKey;

export {
  appendHistoryTail,
  composeTapeItems,
  createLiveWindowBuffer,
  findAnchorRestoreIndex,
  mergeHeldTapeHistory,
  mergeNewest,
  mergeNewestWithOverflow
};

export const reducePausableTapeData = <T extends SortableItem>(
  current: PausableTapeData<T>,
  incoming: T[],
  paused: boolean,
  retentionLimit = LIVE_HOT_WINDOW
): PausableTapeData<T> => {
  return reduceDurableTapeScrollHold(current, incoming, paused, retentionLimit, (evicted) =>
    incrementRetentionMetric("hotWindowEvictions", evicted)
  );
};

export const flushPausableTapeData = <T extends SortableItem>(
  current: PausableTapeData<T>,
  retentionLimit = LIVE_HOT_WINDOW
): PausableTapeData<T> => {
  return flushDurableTapeScrollHold(current, retentionLimit, (evicted) =>
    incrementRetentionMetric("hotWindowEvictions", evicted)
  );
};

export const EMPTY_PAUSABLE_TAPE = {
  visible: [],
  queued: [],
  seenKeys: new Set<string>(),
  dropped: 0
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

export const projectPausableTapeState = <T extends SortableItem>(
  visible: T[],
  status: WsStatus,
  lastUpdate: number | null
): { items: T[]; lastUpdate: number | null } => ({
  items: visible,
  lastUpdate: status === "stale" ? null : lastUpdate
});

export type { LiveHistoryBuffer, PausableTapeData };
