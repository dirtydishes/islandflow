import { mergeNewest } from "./history";
import { getDurableTapeItemKey } from "./keys";
import type {
  DurableTapeItemAccessors,
  DurableTapeScrollHoldState,
  DurableTapeSortableItem
} from "./types";

export const DURABLE_TAPE_NEW_ITEM_COUNT_CAP = 999;

export const createEmptyDurableTapeScrollHold = <TItem>(): DurableTapeScrollHoldState<TItem> => ({
  visible: [],
  queued: [],
  seenKeys: new Set<string>(),
  dropped: 0
});

export const EMPTY_DURABLE_TAPE_SCROLL_HOLD = createEmptyDurableTapeScrollHold<never>();

export const formatDurableTapeNewItemCount = (
  count: number,
  cap = DURABLE_TAPE_NEW_ITEM_COUNT_CAP
): string => {
  if (count <= 0) {
    return "0";
  }
  return count > cap ? `${cap}+` : String(count);
};

const DEFAULT_SORTABLE_ACCESSORS: DurableTapeItemAccessors<DurableTapeSortableItem> = {
  getKey: getDurableTapeItemKey,
  getCursor: (item) => ({
    ts: item.ts ?? item.source_ts ?? item.ingest_ts ?? 0,
    seq: item.seq ?? 0
  })
};

export function reduceDurableTapeScrollHold<TItem extends DurableTapeSortableItem>(
  current: DurableTapeScrollHoldState<TItem>,
  incoming: readonly TItem[],
  hold: boolean,
  retentionLimit: number,
  onTrim?: (evicted: number) => void
): DurableTapeScrollHoldState<TItem>;
export function reduceDurableTapeScrollHold<TItem>(
  current: DurableTapeScrollHoldState<TItem>,
  incoming: readonly TItem[],
  hold: boolean,
  retentionLimit: number,
  onTrim: ((evicted: number) => void) | undefined,
  accessors: DurableTapeItemAccessors<TItem>
): DurableTapeScrollHoldState<TItem>;
export function reduceDurableTapeScrollHold<TItem>(
  current: DurableTapeScrollHoldState<TItem>,
  incoming: readonly TItem[],
  hold: boolean,
  retentionLimit: number,
  onTrim?: (evicted: number) => void,
  accessors: DurableTapeItemAccessors<TItem> = DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>
): DurableTapeScrollHoldState<TItem> {
  if (incoming.length === 0) {
    return current;
  }

  const seenKeys = current.seenKeys;
  let nextSeenKeys: Set<string> | null = null;
  const unseen: TItem[] = [];

  for (const item of incoming) {
    const key = accessors.getKey(item);
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

  if (hold) {
    return {
      visible: current.visible,
      queued: mergeNewest(unseen, current.queued, retentionLimit, onTrim, accessors),
      seenKeys: nextSeenKeys ?? seenKeys,
      dropped: current.dropped + unseen.length
    };
  }

  const nextBatch = current.queued.length > 0 ? [...current.queued, ...unseen] : unseen;
  return {
    visible: mergeNewest(nextBatch, current.visible, retentionLimit, onTrim, accessors),
    queued: [],
    seenKeys: nextSeenKeys ?? seenKeys,
    dropped: 0
  };
}

export function flushDurableTapeScrollHold<TItem extends DurableTapeSortableItem>(
  current: DurableTapeScrollHoldState<TItem>,
  retentionLimit: number,
  onTrim?: (evicted: number) => void
): DurableTapeScrollHoldState<TItem>;
export function flushDurableTapeScrollHold<TItem>(
  current: DurableTapeScrollHoldState<TItem>,
  retentionLimit: number,
  onTrim: ((evicted: number) => void) | undefined,
  accessors: DurableTapeItemAccessors<TItem>
): DurableTapeScrollHoldState<TItem>;
export function flushDurableTapeScrollHold<TItem>(
  current: DurableTapeScrollHoldState<TItem>,
  retentionLimit: number,
  onTrim?: (evicted: number) => void,
  accessors: DurableTapeItemAccessors<TItem> = DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>
): DurableTapeScrollHoldState<TItem> {
  if (current.queued.length === 0) {
    return current.dropped === 0 ? current : { ...current, dropped: 0 };
  }

  return {
    visible: mergeNewest(current.queued, current.visible, retentionLimit, onTrim, accessors),
    queued: [],
    seenKeys: current.seenKeys,
    dropped: 0
  };
}

export type DurableTapeJumpToLiveResult<TItem> = {
  state: DurableTapeScrollHoldState<TItem>;
  flushedCount: number;
  scrollToTop: true;
  motion: "animated" | "instant";
};

export function flushDurableTapeJumpToLive<TItem extends DurableTapeSortableItem>(
  current: DurableTapeScrollHoldState<TItem>,
  retentionLimit: number,
  options?: {
    reducedMotion?: boolean;
    onTrim?: (evicted: number) => void;
  }
): DurableTapeJumpToLiveResult<TItem>;
export function flushDurableTapeJumpToLive<TItem>(
  current: DurableTapeScrollHoldState<TItem>,
  retentionLimit: number,
  options: {
    reducedMotion?: boolean;
    onTrim?: (evicted: number) => void;
    accessors: DurableTapeItemAccessors<TItem>;
  }
): DurableTapeJumpToLiveResult<TItem>;
export function flushDurableTapeJumpToLive<TItem>(
  current: DurableTapeScrollHoldState<TItem>,
  retentionLimit: number,
  options: {
    reducedMotion?: boolean;
    onTrim?: (evicted: number) => void;
    accessors?: DurableTapeItemAccessors<TItem>;
  } = {}
): DurableTapeJumpToLiveResult<TItem> {
  const accessors =
    options.accessors ?? (DEFAULT_SORTABLE_ACCESSORS as DurableTapeItemAccessors<TItem>);
  return {
    state: flushDurableTapeScrollHold(current, retentionLimit, options.onTrim, accessors),
    flushedCount: current.queued.length,
    scrollToTop: true,
    motion: options.reducedMotion ? "instant" : "animated"
  };
}
