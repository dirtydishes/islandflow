import type { Cursor, EquityPrint } from "@islandflow/types";
import type { ReactNode } from "react";

import type {
  DurableTapeFeatureInput,
  DurableTapeSource,
  DurableTapeTemplateId
} from "../durable-tape";

export type EquitiesTapeColumnId = "time" | "ticker" | "price" | "size" | "notional" | "venue";

export type EquitiesTapeScope = {
  ticker?: string | null;
  tickers?: readonly string[] | null;
  underlyingIds?: readonly string[] | null;
};

export type EquitiesTapeFilters = {
  venue?: string | null;
  venues?: readonly string[] | null;
  offExchange?: boolean | "all" | null;
  sinceTs?: number | null;
};

export type NormalizedEquitiesTapeScope = {
  underlyingIds?: string[];
};

export type NormalizedEquitiesTapeFilters = {
  venues?: string[];
  offExchange?: boolean;
  sinceTs?: number;
};

export type EquitiesTapeLinkedContext = {
  label: string;
  value: ReactNode;
};

export type EquitiesTapeInspectEvent = {
  print: EquityPrint;
  rowKey: string;
  index: number;
};

export type EquitiesTapeTickerFocusEvent = EquitiesTapeInspectEvent & {
  ticker: string;
};

export type EquitiesTapeSourceOptions = {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  historyPageSize?: number;
  snapshotLimit?: number;
  maxFilteredHistoryPages?: number;
  live?: boolean;
  fetcher?: typeof fetch;
  createWebSocket?: (url: string) => WebSocket;
};

export type EquitiesTapeHistoryResponse = {
  data?: EquityPrint[];
  next_before?: Cursor | null;
};

export type EquitiesTapeProps = {
  title?: string;
  ariaLabel?: string;
  className?: string;
  scope?: EquitiesTapeScope;
  filters?: EquitiesTapeFilters;
  features?: readonly DurableTapeFeatureInput[];
  template?: DurableTapeTemplateId | "auto";
  source?: DurableTapeSource<
    EquityPrint,
    NormalizedEquitiesTapeScope,
    NormalizedEquitiesTapeFilters
  >;
  sourceOptions?: EquitiesTapeSourceOptions;
  onTickerFocus?: (event: EquitiesTapeTickerFocusEvent) => void;
  onInspectPrint?: (event: EquitiesTapeInspectEvent) => void;
  renderLinkedContext?: (print: EquityPrint) => ReactNode;
  rowHeight?: number;
  overscan?: number;
};
