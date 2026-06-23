import type { Cursor, FlowPacket, OptionFlowFilters } from "@islandflow/types";
import type { ReactNode } from "react";

import type {
  DurableTapeFeatureInput,
  DurableTapeSource,
  DurableTapeTemplateId
} from "../durable-tape";

export type FlowPacketColumnId =
  | "time"
  | "contract"
  | "prints"
  | "premium"
  | "window"
  | "side"
  | "quality";

export type FlowPacketsTapeScope = {
  ticker?: string | null;
  tickers?: readonly string[] | null;
  underlyingIds?: readonly string[] | null;
  optionContractId?: string | null;
};

export type NormalizedFlowPacketsTapeScope = {
  underlyingIds?: string[];
  optionContractId?: string;
};

export type FlowPacketsTapeFilters = OptionFlowFilters;

export type FlowPacketFocusRequest = {
  packetId: string;
  memberTraceIds: string[];
  optionContractId?: string;
  source: "options-tape" | "flow-packets" | "alerts";
};

export type OnPacketFocus = (request: FlowPacketFocusRequest) => void;

export type FlowPacketsTapeInspectEvent = {
  packet: FlowPacket;
  rowKey: string;
  index: number;
};

export type FlowPacketsTapeSourceOptions = {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  historyPageSize?: number;
  snapshotLimit?: number;
  maxFilteredHistoryPages?: number;
  live?: boolean;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  createWebSocket?: (url: string) => WebSocket;
};

export type FlowPacketsTapeHistoryResponse = {
  data?: FlowPacket[];
  next_before?: Cursor | null;
};

export type FlowPacketsTapeProps = {
  title?: string;
  ariaLabel?: string;
  className?: string;
  scope?: FlowPacketsTapeScope;
  filters?: FlowPacketsTapeFilters;
  features?: readonly DurableTapeFeatureInput[];
  template?: DurableTapeTemplateId | "auto";
  source?: DurableTapeSource<FlowPacket, NormalizedFlowPacketsTapeScope, FlowPacketsTapeFilters>;
  sourceOptions?: FlowPacketsTapeSourceOptions;
  onInspectPacket?: (event: FlowPacketsTapeInspectEvent) => void;
  onPacketFocus?: OnPacketFocus;
  renderLinkedContext?: (packet: FlowPacket) => ReactNode;
  rowHeight?: number;
  overscan?: number;
};
