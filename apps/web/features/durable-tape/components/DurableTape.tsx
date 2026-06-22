"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";

import { resolveDurableTapeComponentFeatures } from "../feature-flags";
import { appendHistoryTail, composeTapeItems, selectOlderHistoryCursor } from "../history";
import {
  createEmptyDurableTapeScrollHold,
  flushDurableTapeJumpToLive,
  reduceDurableTapeScrollHold
} from "../scroll-hold";
import { selectDurableTapeTemplate } from "../templates";
import type {
  DurableTapeColumnDefinition,
  DurableTapeProps,
  DurableTapeScrollHoldState,
  DurableTapeTemplate
} from "../types";
import { useDurableTapeVirtualList, useDurableVirtualHistoryGate } from "../virtual";
import { DurableTapeHeader } from "./DurableTapeHeader";
import { DurableTapeHoverSurface } from "./DurableTapeHoverSurface";
import { DurableTapeJumpToLive } from "./DurableTapeJumpToLive";
import { DurableTapeSettingsPopover } from "./DurableTapeSettingsPopover";

const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_HOT_LIMIT = 500;

const EMPTY_COLUMNS: DurableTapeColumnDefinition<unknown>[] = [];
const EMPTY_TEMPLATES: DurableTapeTemplate[] = [{ id: "micro", columns: [] }];

const useMeasuredWidth = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const update = () => {
      setWidth(element.clientWidth);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
};

export const DurableTape = <TItem, TScope = unknown, TFilters = unknown>({
  title,
  ariaLabel,
  className = "",
  scope,
  filters,
  features: featureInputs,
  template: templateProp,
  templates = EMPTY_TEMPLATES,
  columns = EMPTY_COLUMNS as DurableTapeColumnDefinition<TItem>[],
  columnOverrides,
  getRowKey,
  getCursor,
  source,
  renderRow,
  renderHover,
  onFocus,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN
}: DurableTapeProps<TItem, TScope, TFilters>) => {
  const { ref: rootRef, width } = useMeasuredWidth();
  const listRef = useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasAtTopRef = useRef(true);
  const settingsDialogId = useId();
  const [isAtTop, setIsAtTop] = useState(true);
  const [historyItems, setHistoryItems] = useState<TItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hovered, setHovered] = useState<{
    item: TItem;
    rowKey: string;
    index: number;
  } | null>(null);
  const [scrollHold, setScrollHold] = useState<DurableTapeScrollHoldState<TItem>>(() =>
    createEmptyDurableTapeScrollHold<TItem>()
  );

  const itemAccessors = useMemo(
    () => ({
      getKey: getRowKey,
      getCursor
    }),
    [getCursor, getRowKey]
  );

  const resolvedFeatures = useMemo(() => {
    return resolveDurableTapeComponentFeatures({
      features: featureInputs,
      template: templateProp
    });
  }, [featureInputs, templateProp]);

  const selectedTemplate = useMemo(() => {
    return selectDurableTapeTemplate({
      templates,
      columns,
      columnOverrides,
      containerWidth: width,
      requestedTemplate: resolvedFeatures.responsiveTemplates
        ? resolvedFeatures.template
        : resolvedFeatures.template === "auto"
          ? "full"
          : resolvedFeatures.template
    });
  }, [
    columnOverrides,
    columns,
    resolvedFeatures.responsiveTemplates,
    resolvedFeatures.template,
    templates,
    width
  ]);

  const query = useMemo(() => ({ scope, filters }), [scope, filters]);

  useEffect(() => {
    setHistoryItems([]);
    setHistoryLoading(false);
    setHistoryExhausted(false);
    setHovered(null);
    setScrollHold(createEmptyDurableTapeScrollHold<TItem>());
    wasAtTopRef.current = true;
    setIsAtTop(true);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [query, source]);

  useEffect(() => {
    const subscription = source.subscribe(query);
    const applySnapshot = (items: readonly TItem[]) => {
      setScrollHold((current) =>
        reduceDurableTapeScrollHold(
          current,
          items,
          resolvedFeatures.scrollHold && !wasAtTopRef.current,
          DEFAULT_HOT_LIMIT,
          undefined,
          itemAccessors
        )
      );
    };

    const snapshot = subscription.getSnapshot?.();
    if (snapshot) {
      applySnapshot(snapshot);
    }
    const unsubscribe = subscription.listen?.(applySnapshot);

    return () => {
      unsubscribe?.();
      subscription.unsubscribe();
    };
  }, [itemAccessors, query, resolvedFeatures.scrollHold, source]);

  const items = useMemo(() => {
    return composeTapeItems([], scrollHold.visible, historyItems, itemAccessors);
  }, [historyItems, itemAccessors, scrollHold.visible]);

  const virtual = useDurableTapeVirtualList(items, listRef, {
    rowHeight,
    overscan,
    debugLabel: title ?? ariaLabel ?? "durable-tape",
    getRowKey
  });

  const loadOlder = useCallback(async () => {
    if (!resolvedFeatures.clickhouseHistory || historyLoading || historyExhausted) {
      return;
    }

    const cursor = selectOlderHistoryCursor(items, getCursor);
    if (!cursor) {
      return;
    }

    setHistoryLoading(true);
    try {
      const page = await source.loadOlder(cursor, query);
      setHistoryItems((current) =>
        appendHistoryTail(current, page.items, scrollHold.visible, 0, itemAccessors)
      );
      setHistoryExhausted(page.exhausted === true || page.nextCursor === null);
    } finally {
      setHistoryLoading(false);
    }
  }, [
    getCursor,
    historyExhausted,
    historyLoading,
    itemAccessors,
    items,
    query,
    resolvedFeatures.clickhouseHistory,
    scrollHold.visible,
    source
  ]);

  useDurableVirtualHistoryGate(
    resolvedFeatures.clickhouseHistory,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void loadOlder()
  );

  const flushToLiveHead = useCallback(() => {
    setScrollHold((current) => {
      const result = flushDurableTapeJumpToLive(current, DEFAULT_HOT_LIMIT, {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        accessors: itemAccessors
      });
      return result.state;
    });
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
    wasAtTopRef.current = true;
    setIsAtTop(true);
  }, [itemAccessors]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    settingsTriggerRef.current?.focus();
  }, []);

  const onScroll = useCallback(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }
    const atTop = element.scrollTop <= 2;
    if (atTop && !wasAtTopRef.current) {
      flushToLiveHead();
    }
    wasAtTopRef.current = atTop;
    setIsAtTop(atTop);
  }, [flushToLiveHead]);

  const gridTemplateColumns = selectedTemplate.columns
    .map((column) => `minmax(0, ${Math.max(1, column.minWidth)}fr)`)
    .join(" ");
  const rowStyle = { "--durable-tape-grid": gridTemplateColumns } as CSSProperties;
  const tapeLabel = ariaLabel ?? title ?? "Durable tape";
  const canInspectRows = resolvedFeatures.keyboardInspect || Boolean(onFocus);
  const canShowHover = resolvedFeatures.hoverDetails && Boolean(renderHover);

  const showHoverDetail = useCallback(
    (item: TItem, rowKey: string, index: number) => {
      if (canShowHover) {
        setHovered({ item, rowKey, index });
      }
    },
    [canShowHover]
  );

  const clearHoverDetail = useCallback((rowKey: string) => {
    setHovered((current) => (current?.rowKey === rowKey ? null : current));
  }, []);

  return (
    <section
      className={`durable-tape ${className}`.trim()}
      data-template={selectedTemplate.template.id}
      data-template-pinned={selectedTemplate.pinned}
      ref={rootRef}
    >
      <DurableTapeHeader
        title={title}
        actions={
          <>
            {resolvedFeatures.jumpToLive ? (
              <DurableTapeJumpToLive
                count={scrollHold.dropped}
                disabled={isAtTop && scrollHold.dropped === 0}
                onJump={flushToLiveHead}
              />
            ) : null}
            {resolvedFeatures.settingsGear ? (
              <button
                className="durable-tape-settings-trigger"
                type="button"
                ref={settingsTriggerRef}
                aria-expanded={settingsOpen}
                aria-controls={settingsOpen ? settingsDialogId : undefined}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                Settings
              </button>
            ) : null}
          </>
        }
      />
      <div className="durable-tape-table" role="table" aria-label={tapeLabel}>
        {selectedTemplate.columns.length > 0 ? (
          <div className="durable-tape-head" role="row" style={rowStyle}>
            {selectedTemplate.columns.map((column) => (
              <span className="durable-tape-cell" key={column.id} role="columnheader">
                {column.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="durable-tape-scroll" ref={listRef} onScroll={onScroll}>
          <div
            className="durable-tape-body"
            style={{ height: `${virtual.totalSize}px` }}
            aria-busy={historyLoading}
          >
            {virtual.virtualItems.map(({ item, key, index, start, size }) => (
              <div
                className="durable-tape-row"
                data-tape-key={key}
                data-row-start={start}
                data-row-size={size}
                key={key}
                role="row"
                tabIndex={canInspectRows ? 0 : -1}
                style={{
                  ...rowStyle,
                  height: `${size}px`,
                  transform: `translateY(${start}px)`
                }}
                onFocus={() => {
                  onFocus?.({ item, rowKey: key, index });
                  showHoverDetail(item, key, index);
                }}
                onBlur={() => clearHoverDetail(key)}
                onMouseEnter={() => showHoverDetail(item, key, index)}
                onMouseLeave={() => clearHoverDetail(key)}
                onPointerDown={() => showHoverDetail(item, key, index)}
              >
                {renderRow({ item, rowKey: key, index, columns: selectedTemplate.columns })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <DurableTapeSettingsPopover
        id={settingsDialogId}
        open={settingsOpen}
        features={resolvedFeatures}
        template={selectedTemplate.template.id}
        onClose={closeSettings}
      />
      <DurableTapeHoverSurface open={Boolean(canShowHover && hovered)}>
        {renderHover && hovered ? renderHover(hovered) : null}
      </DurableTapeHoverSurface>
    </section>
  );
};
