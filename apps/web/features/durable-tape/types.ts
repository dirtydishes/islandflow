import type { CSSProperties, ReactNode } from "react";

export type DurableTapeCursor = {
  ts: number;
  seq: number;
};

export type DurableTapeSortableItem = {
  ts?: number;
  source_ts?: number;
  ingest_ts?: number;
  seq?: number;
  trace_id?: string;
  id?: string;
};

export type DurableTapeQuery<TScope, TFilters> = {
  scope?: TScope;
  filters?: TFilters;
};

export type DurableTapeHistoryPage<TItem> = {
  items: TItem[];
  nextCursor?: DurableTapeCursor | null;
  exhausted?: boolean;
  historyUnavailable?: {
    label: string;
    detail?: string;
    retryable?: boolean;
  };
};

export type DurableTapeItemAccessors<TItem> = {
  getKey: (item: TItem) => string;
  getCursor: (item: TItem) => DurableTapeCursor;
};

export type DurableTapeSubscription<TItem> = {
  getSnapshot?: () => readonly TItem[];
  listen?: (listener: (items: readonly TItem[]) => void) => () => void;
  unsubscribe: () => void;
};

export type DurableTapeSource<TItem, TScope, TFilters> = {
  subscribe: (input: DurableTapeQuery<TScope, TFilters>) => DurableTapeSubscription<TItem>;
  getInitialHistoryCursor?: (
    input: DurableTapeQuery<TScope, TFilters>
  ) => DurableTapeCursor | null | undefined;
  loadOlder: (
    cursor: DurableTapeCursor,
    input: DurableTapeQuery<TScope, TFilters>
  ) => Promise<DurableTapeHistoryPage<TItem>>;
};

export type DurableTapeTemplateId = "full" | "twoThirds" | "half" | "oneThird" | "micro";

export type DurableTapeBooleanFeatureKey =
  | "liveHotHead"
  | "clickhouseHistory"
  | "scrollGate"
  | "scrollHold"
  | "jumpToLive"
  | "newItemCount"
  | "hoverDetails"
  | "keyboardInspect"
  | "responsiveTemplates"
  | "rowTinting"
  | "settingsGear"
  | "noHorizontalScroll";

export type DurableTapeResolvedFeatures = Record<DurableTapeBooleanFeatureKey, boolean> & {
  template: DurableTapeTemplateId | "auto";
};

export type DurableTapeFeatureInput =
  | "default"
  | DurableTapeBooleanFeatureKey
  | {
      key: DurableTapeBooleanFeatureKey;
      enabled?: boolean;
    }
  | {
      key: "template";
      value: DurableTapeTemplateId | "auto";
      enabled?: boolean;
    };

export type DurableTapeColumnAlign = "start" | "end" | "center";

export type DurableTapeColumnDefinition<TItem, TColumnId extends string = string> = {
  id: TColumnId;
  label: string;
  minWidth: number;
  className?: string;
  align?: DurableTapeColumnAlign;
  render?: (item: TItem) => ReactNode;
};

export type DurableTapeColumnOverride<TItem, TColumnId extends string = string> = {
  id: TColumnId;
  enabled?: boolean;
  label?: string;
  minWidth?: number;
  className?: string;
  align?: DurableTapeColumnAlign;
  render?: (item: TItem) => ReactNode;
};

export type DurableTapeTemplate<TColumnId extends string = string> = {
  id: DurableTapeTemplateId;
  label?: string;
  columns: readonly TColumnId[];
};

export type DurableTapeTemplateSelection<TItem, TColumnId extends string = string> = {
  template: DurableTapeTemplate<TColumnId>;
  columns: DurableTapeColumnDefinition<TItem, TColumnId>[];
  minWidth: number;
  pinned: boolean;
  fits: boolean;
};

export type DurableTapeFocusEvent<TItem> = {
  item: TItem;
  rowKey: string;
  index: number;
};

export type DurableTapeRowHookInput<TItem> = {
  item: TItem;
  rowKey: string;
  index: number;
};

export type DurableTapeRowClassNameGetter<TItem> = (
  input: DurableTapeRowHookInput<TItem>
) => string | undefined;

export type DurableTapeRowStyleGetter<TItem> = (
  input: DurableTapeRowHookInput<TItem>
) => CSSProperties | undefined;

export type DurableTapeRowRenderer<TItem> = (input: {
  item: TItem;
  rowKey: string;
  index: number;
  columns: DurableTapeColumnDefinition<TItem>[];
}) => ReactNode;

export type DurableTapeHoverRenderer<TItem> = (input: {
  item: TItem;
  rowKey: string;
  index: number;
}) => ReactNode;

export type DurableTapeProps<TItem, TScope = unknown, TFilters = unknown> = {
  title?: string;
  ariaLabel?: string;
  className?: string;
  scope?: TScope;
  filters?: TFilters;
  features?: readonly DurableTapeFeatureInput[];
  template?: DurableTapeTemplateId | "auto";
  templates?: readonly DurableTapeTemplate[];
  columns?: DurableTapeColumnDefinition<TItem>[];
  columnOverrides?: DurableTapeColumnOverride<TItem>[];
  getRowKey: (item: TItem) => string;
  getCursor: (item: TItem) => DurableTapeCursor;
  getSortCursor?: (item: TItem) => DurableTapeCursor;
  source: DurableTapeSource<TItem, TScope, TFilters>;
  renderRow: DurableTapeRowRenderer<TItem>;
  renderHover?: DurableTapeHoverRenderer<TItem>;
  getRowClassName?: DurableTapeRowClassNameGetter<TItem>;
  getRowStyle?: DurableTapeRowStyleGetter<TItem>;
  onFocus?: (event: DurableTapeFocusEvent<TItem>) => void;
  onActivate?: (event: DurableTapeFocusEvent<TItem>) => void;
  rowHeight?: number;
  overscan?: number;
};

export type DurableTapeScrollHoldState<TItem> = {
  visible: TItem[];
  queued: TItem[];
  seenKeys: Set<string>;
  dropped: number;
};
