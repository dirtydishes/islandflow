import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useRef } from "react";

export type DurableTapeVirtualListConfig<TItem> = {
  rowHeight: number;
  overscan: number;
  debugLabel?: string;
  getRowKey: (item: TItem) => string;
};

export type DurableTapeVirtualListResult<TItem> = {
  totalSize: number;
  virtualItems: DurableTapeVirtualRow<TItem>[];
};

export type DurableTapeVirtualRow<TItem> = {
  item: TItem;
  key: string;
  index: number;
  start: number;
  size: number;
  end: number;
};

export const buildDurableTapeVirtualRows = <TItem>(
  items: readonly TItem[],
  virtualItems: readonly VirtualItem[],
  getRowKey: (item: TItem) => string
): DurableTapeVirtualRow<TItem>[] => {
  const rows: DurableTapeVirtualRow<TItem>[] = [];
  for (const virtualItem of virtualItems) {
    if (virtualItem.index < 0 || virtualItem.index >= items.length) {
      continue;
    }
    const item = items[virtualItem.index] as TItem;
    rows.push({
      item,
      key: getRowKey(item),
      index: virtualItem.index,
      start: virtualItem.start,
      size: virtualItem.size,
      end: virtualItem.end
    });
  }
  return rows;
};

export const useDurableTapeVirtualList = <TItem>(
  items: readonly TItem[],
  listRef: RefObject<HTMLDivElement | null>,
  config: DurableTapeVirtualListConfig<TItem>
): DurableTapeVirtualListResult<TItem> => {
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => config.rowHeight,
    overscan: config.overscan,
    getItemKey: (index) => {
      const item = items[index];
      return item ? config.getRowKey(item) : index;
    }
  });

  const virtualItems = buildDurableTapeVirtualRows(
    items,
    virtualizer.getVirtualItems(),
    config.getRowKey
  );

  useEffect(() => {
    if (!config.debugLabel || items.length === 0) {
      return;
    }
    const element = listRef.current;
    if (!element) {
      return;
    }
    const first = virtualItems[0];
    const last = virtualItems.at(-1);
    if (!first || !last) {
      return;
    }
    const visibleTopGap = Math.max(0, first.start - element.scrollTop);
    const visibleBottomGap = Math.max(0, element.scrollTop + element.clientHeight - last.end);
    if (visibleTopGap > element.clientHeight || visibleBottomGap > element.clientHeight) {
      console.warn("[durable-tape] false-gap watchdog", {
        pane: config.debugLabel,
        item_count: items.length,
        visible_top_gap: visibleTopGap,
        visible_bottom_gap: visibleBottomGap,
        viewport_height: element.clientHeight
      });
    }
  }, [config.debugLabel, items.length, listRef, virtualItems]);

  return {
    totalSize: virtualizer.getTotalSize(),
    virtualItems
  };
};

export const shouldLoadOlderFromVirtualRows = ({
  enabled,
  itemCount,
  lastVirtualIndex
}: {
  enabled: boolean;
  itemCount: number;
  lastVirtualIndex: number;
}): boolean => {
  return enabled && itemCount > 0 && lastVirtualIndex >= itemCount - 1;
};

export const useDurableVirtualHistoryGate = (
  enabled: boolean,
  itemCount: number,
  lastVirtualIndex: number,
  onLoadOlder: () => void
): void => {
  const loadRef = useRef(onLoadOlder);
  useEffect(() => {
    loadRef.current = onLoadOlder;
  }, [onLoadOlder]);

  useEffect(() => {
    if (
      !shouldLoadOlderFromVirtualRows({
        enabled,
        itemCount,
        lastVirtualIndex
      })
    ) {
      return;
    }
    loadRef.current();
  }, [enabled, itemCount, lastVirtualIndex]);
};
