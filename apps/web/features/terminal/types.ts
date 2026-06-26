import type { LiveSubscription } from "@islandflow/types";

export type TapeVirtualPane = "options" | "flow" | "news";

export type TapeVirtualListConfig = {
  rowHeight: number;
  overscan: number;
  debugLabel: TapeVirtualPane;
};

export type RouteFeatures = {
  options: boolean;
  nbbo: boolean;
  equities: boolean;
  flow: boolean;
  news: boolean;
  alerts: boolean;
  durableRows: boolean;
  smartFlow: boolean;
  smartMoney: boolean;
  classifierHits: boolean;
  inferredDark: boolean;
  equityJoins: boolean;
  equityCandles: boolean;
  equityOverlay: boolean;
  showOptionsPane: boolean;
  showEquitiesPane: boolean;
  showFlowPane: boolean;
  showNewsPane: boolean;
  showAlertsPane: boolean;
  showDarkPane: boolean;
  showChartPane: boolean;
  needsClassifierDecor: boolean;
  needsAlertEvidencePrefetch: boolean;
  needsDarkUnderlying: boolean;
};

export type OptionScope = Pick<
  Extract<LiveSubscription, { channel: "options" }>,
  "underlying_ids" | "option_contract_id"
>;

export type EquityScope = Pick<
  Extract<LiveSubscription, { channel: "equities" }>,
  "underlying_ids"
>;

export type SelectedInstrument =
  | null
  | { kind: "equity"; underlyingId: string }
  | { kind: "option-contract"; contractId: string; underlyingId: string };

export type TapeFocusSeed<T> = {
  scopeKey: string;
  subscriptionKey?: string;
  items: T[];
};

export type WsStatus = "connecting" | "connected" | "disconnected" | "stale";

export type TapeMode = "live" | "replay";

export type SortableItem = {
  ts?: number;
  source_ts?: number;
  ingest_ts?: number;
  seq?: number;
  trace_id?: string;
  id?: string;
};

export type PinnedEntry<T> = {
  value: T;
  updatedAt: number;
};

export type OptionContractDisplay = {
  ticker: string;
  strike: string;
  expiration: string;
};

export type PausableTapeData<T> = {
  visible: T[];
  queued: T[];
  seenKeys: Set<string>;
  dropped: number;
};

export type LiveHistoryBuffer<T> = {
  liveHead: T[];
  queuedLive: T[];
  historyTail: T[];
  nextBefore: import("@islandflow/types").Cursor | null;
  historyLoading: boolean;
  historyExhausted: boolean;
  autoHydrating: boolean;
};
