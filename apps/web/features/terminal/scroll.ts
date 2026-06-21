import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { DEV_TAPE_DEBUG, bumpTapeDebugMetric, logTapeDebug } from "./debug";
import { findAnchorRestoreIndex, getTapeItemKey } from "./tape";
import type { SortableItem, TapeVirtualListConfig } from "./types";

export type ListScrollState = {
  listRef: RefObject<HTMLDivElement | null>;
  listNode: HTMLDivElement | null;
  setListRef: (node: HTMLDivElement | null) => void;
  isAtTop: boolean;
  isAtTopRef: MutableRefObject<boolean>;
  missed: number;
  resumeTick: number;
  onNewItems: (count: number) => void;
  jumpToTop: () => void;
};

export const useListScroll = (): ListScrollState => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listNode, setListNode] = useState<HTMLDivElement | null>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  const [missed, setMissed] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const isAtTopRef = useRef(true);
  const prevAtTopRef = useRef(true);

  const setListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    setListNode(node);
  }, []);

  useEffect(() => {
    isAtTopRef.current = isAtTop;
  }, [isAtTop]);

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }

    const atTop = el.scrollTop <= 2;

    if (atTop && !prevAtTopRef.current) {
      setResumeTick((prev) => prev + 1);
    }

    prevAtTopRef.current = atTop;
    isAtTopRef.current = atTop;
    setIsAtTop(atTop);

    if (atTop) {
      setMissed(0);
    }
  }, [isAtTopRef]);

  useEffect(() => {
    if (!listNode) {
      return;
    }

    const onScroll = () => {
      updateScrollState();
    };

    updateScrollState();
    listNode.addEventListener("scroll", onScroll);

    return () => {
      listNode.removeEventListener("scroll", onScroll);
    };
  }, [listNode, updateScrollState]);

  const onNewItems = useCallback((count: number) => {
    if (count <= 0) {
      return;
    }

    if (isAtTopRef.current) {
      setMissed(0);
      return;
    }

    setMissed((prev) => prev + count);
  }, []);

  const jumpToTop = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }

    isAtTopRef.current = true;
    el.scrollTop = 0;
    updateScrollState();
  }, [isAtTopRef, listRef, updateScrollState]);

  return {
    listRef,
    listNode,
    setListRef,
    isAtTop,
    isAtTopRef,
    missed,
    resumeTick,
    onNewItems,
    jumpToTop
  };
};

export const useScrollAnchor = (
  listRef: RefObject<HTMLDivElement | null>,
  isAtTopRef: MutableRefObject<boolean>
) => {
  const pendingRef = useRef<{
    key: string;
    offset: number;
    fallbackKeys: string[];
  } | null>(null);

  const readRenderedRows = useCallback((element: HTMLDivElement) => {
    return Array.from(
      element.querySelectorAll<HTMLElement>("[data-tape-key][data-row-start][data-row-size]")
    )
      .map((node) => {
        const key = node.dataset.tapeKey;
        const start = Number(node.dataset.rowStart);
        const size = Number(node.dataset.rowSize);
        if (!key || !Number.isFinite(start) || !Number.isFinite(size)) {
          return null;
        }
        return { key, start, size };
      })
      .filter((row): row is { key: string; start: number; size: number } => row !== null)
      .sort((a, b) => a.start - b.start);
  }, []);

  const capture = useCallback(() => {
    if (isAtTopRef.current) {
      pendingRef.current = null;
      return;
    }

    const el = listRef.current;
    if (!el) {
      return;
    }

    const rows = readRenderedRows(el);
    if (rows.length === 0) {
      pendingRef.current = null;
      return;
    }

    const scrollTop = el.scrollTop;
    const anchorIndex = rows.findIndex((row) => row.start + row.size > scrollTop);
    const resolvedIndex = anchorIndex >= 0 ? anchorIndex : 0;
    const anchorRow = rows[resolvedIndex];
    if (!anchorRow) {
      pendingRef.current = null;
      return;
    }

    pendingRef.current = {
      key: anchorRow.key,
      offset: Math.max(0, scrollTop - anchorRow.start),
      fallbackKeys: rows.slice(resolvedIndex).map((row) => row.key)
    };
  }, [isAtTopRef, listRef, readRenderedRows]);

  const apply = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }

    const el = listRef.current;
    if (!el) {
      return;
    }

    if (isAtTopRef.current) {
      pendingRef.current = null;
      return;
    }

    const rows = readRenderedRows(el);
    if (rows.length === 0) {
      return;
    }

    const keys = rows.map((row) => row.key);
    const restoreIndex = findAnchorRestoreIndex(keys, pending.key, pending.fallbackKeys);
    if (restoreIndex < 0) {
      return;
    }

    const row = rows[restoreIndex];
    if (!row) {
      return;
    }

    el.scrollTop = Math.max(0, row.start + pending.offset);
    bumpTapeDebugMetric("anchorRestoreCount", 1);
    if (row.key !== pending.key) {
      bumpTapeDebugMetric("anchorRestoreFallbackCount", 1);
      logTapeDebug("anchor restore fallback", {
        requested_key: pending.key,
        restored_key: row.key
      });
    }
    pendingRef.current = null;
  }, [isAtTopRef, listRef, readRenderedRows]);

  return { capture, apply };
};

export const useVirtualHistoryGate = (
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
    if (!enabled || itemCount === 0) {
      return;
    }
    if (lastVirtualIndex < itemCount - 1) {
      return;
    }
    loadRef.current();
  }, [enabled, itemCount, lastVirtualIndex]);
};

export type TapeVirtualListResult<T> = {
  totalSize: number;
  virtualItems: TapeVirtualRow<T>[];
};

export type TapeVirtualRow<T> = {
  item: T;
  key: string;
  index: number;
  start: number;
  size: number;
  end: number;
};

export const useTapeVirtualList = <T extends SortableItem>(
  items: T[],
  listRef: RefObject<HTMLDivElement | null>,
  config: TapeVirtualListConfig
): TapeVirtualListResult<T> => {
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => config.rowHeight,
    overscan: config.overscan,
    getItemKey: (index) => getTapeItemKey(items[index] as SortableItem)
  });

  const virtualItems: TapeVirtualRow<T>[] = virtualizer
    .getVirtualItems()
    .map((virtualItem) => {
      const item = items[virtualItem.index] as T | undefined;
      if (!item) {
        return null;
      }
      return {
        item,
        key: getTapeItemKey(item),
        index: virtualItem.index,
        start: virtualItem.start,
        size: virtualItem.size,
        end: virtualItem.end
      };
    })
    .filter((virtualItem): virtualItem is TapeVirtualRow<T> => virtualItem !== null);

  useEffect(() => {
    if (!DEV_TAPE_DEBUG || items.length === 0) {
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
      console.warn("[tape] false-gap watchdog", {
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
