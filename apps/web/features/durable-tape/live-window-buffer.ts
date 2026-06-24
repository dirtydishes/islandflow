import {
  compareDurableTapeNewestCursorFirst,
  getDurableTapeCursor,
  getDurableTapeItemKey
} from "./keys";
import type { DurableTapeItemAccessors, DurableTapeSortableItem } from "./types";

export type LiveWindowSnapshot<TItem> = {
  items: TItem[];
  evicted: TItem[];
};

export type LiveWindowBuffer<TItem> = {
  upsertMany: (items: readonly TItem[]) => LiveWindowSnapshot<TItem>;
  reset: (items: readonly TItem[]) => LiveWindowSnapshot<TItem>;
  getSnapshot: () => LiveWindowSnapshot<TItem>;
};

export type LiveWindowBufferOptions<TItem> = {
  limit?: number;
  accessors?: DurableTapeItemAccessors<TItem>;
  onTrim?: (evicted: number) => void;
};

const DEFAULT_LIMIT = 500;

const normalizeLimit = (limit: number | undefined): number => {
  return Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT));
};

const DEFAULT_ACCESSORS: DurableTapeItemAccessors<DurableTapeSortableItem> = {
  getKey: getDurableTapeItemKey,
  getCursor: getDurableTapeCursor
};

type KeyedItem<TItem> = {
  key: string;
  item: TItem;
};

export function createLiveWindowBuffer<TItem extends DurableTapeSortableItem>(
  options?: LiveWindowBufferOptions<TItem>
): LiveWindowBuffer<TItem>;
export function createLiveWindowBuffer<TItem>(
  options: LiveWindowBufferOptions<TItem> & {
    accessors: DurableTapeItemAccessors<TItem>;
  }
): LiveWindowBuffer<TItem>;
export function createLiveWindowBuffer<TItem>(
  options: LiveWindowBufferOptions<TItem> = {}
): LiveWindowBuffer<TItem> {
  const accessors = options.accessors ?? (DEFAULT_ACCESSORS as DurableTapeItemAccessors<TItem>);
  const limit = normalizeLimit(options.limit);
  const itemsByKey = new Map<string, TItem>();
  const orderedKeys: string[] = [];
  let snapshotItems: TItem[] = [];

  const collectIncoming = (items: readonly TItem[]): KeyedItem<TItem>[] => {
    const seen = new Set<string>();
    const keyedItems: KeyedItem<TItem>[] = [];
    for (const item of items) {
      const key = accessors.getKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      keyedItems.push({ key, item });
    }
    return keyedItems;
  };

  const rebuildSnapshot = (): void => {
    snapshotItems = orderedKeys
      .map((key) => itemsByKey.get(key))
      .filter((item): item is TItem => item !== undefined);
  };

  const findInsertIndex = (item: TItem): number => {
    let low = 0;
    let high = orderedKeys.length;
    const cursor = accessors.getCursor(item);

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const midItem = itemsByKey.get(orderedKeys[mid]);
      if (!midItem) {
        high = mid;
        continue;
      }

      const order = compareDurableTapeNewestCursorFirst(accessors.getCursor(midItem), cursor);
      if (order < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  };

  const removeKey = (key: string): void => {
    const index = orderedKeys.indexOf(key);
    if (index >= 0) {
      orderedKeys.splice(index, 1);
    }
  };

  const insertIncoming = (incoming: readonly KeyedItem<TItem>[]): void => {
    for (let index = incoming.length - 1; index >= 0; index -= 1) {
      const { key, item } = incoming[index];
      if (itemsByKey.has(key)) {
        removeKey(key);
      }
      itemsByKey.set(key, item);
      orderedKeys.splice(findInsertIndex(item), 0, key);
    }
  };

  const evictOverflow = (notify: boolean): TItem[] => {
    if (orderedKeys.length <= limit) {
      return [];
    }

    const evictedKeys = orderedKeys.splice(limit);
    const evicted: TItem[] = [];
    for (const key of evictedKeys) {
      const item = itemsByKey.get(key);
      if (item) {
        evicted.push(item);
      }
      itemsByKey.delete(key);
    }

    if (notify && evicted.length > 0) {
      options.onTrim?.(evicted.length);
    }

    return evicted;
  };

  const snapshot = (evicted: TItem[]): LiveWindowSnapshot<TItem> => ({
    items: snapshotItems,
    evicted
  });

  return {
    upsertMany(items) {
      const incoming = collectIncoming(items);
      if (incoming.length === 0) {
        return snapshot([]);
      }

      insertIncoming(incoming);
      const evicted = evictOverflow(true);
      rebuildSnapshot();
      return snapshot(evicted);
    },
    reset(items) {
      itemsByKey.clear();
      orderedKeys.length = 0;
      insertIncoming(collectIncoming(items));
      const evicted = evictOverflow(false);
      rebuildSnapshot();
      return snapshot(evicted);
    },
    getSnapshot() {
      return snapshot([]);
    }
  };
}
