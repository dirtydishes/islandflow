import type {
  ClassifierHitEvent,
  FlowPacket,
  OptionFlowFilters,
  OptionNBBO,
  OptionPrint,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import type { Dispatch, ReactNode, SetStateAction } from "react";

import type {
  DurableTapeFeatureInput,
  DurableTapeSource,
  DurableTapeTemplateId
} from "../durable-tape";

export type OptionsTapeColumnId =
  | "time"
  | "contract"
  | "dte"
  | "price"
  | "size"
  | "premium"
  | "side"
  | "iv"
  | "spot"
  | "nbbo"
  | "exchange";

export type OptionsTapeMode = "global" | "packet" | "contract";

export type OptionsTapeScope =
  | { mode: "global" }
  | {
      mode: "contract";
      optionContractId: string;
      underlyingId?: string;
      smartFlow?: OptionsTapeSmartFlowContext;
    }
  | {
      mode: "packet";
      packetId: string;
      memberTraceIds: string[];
      optionContractId: string;
      underlyingId?: string;
      smartFlow?: OptionsTapeSmartFlowContext;
    };

export type OptionsTapeSourceScope = {
  optionContractId?: string;
  underlyingIds?: string[];
  packetMemberTraceIds?: string[];
};

export type OptionsTapeHistoryResponse = {
  data?: OptionPrint[];
  next_before?: { ts: number; seq: number } | null;
};

export type OptionsTapeSourceOptions = {
  apiBaseUrl?: string;
  historyPageSize?: number;
  maxFilteredHistoryPages?: number;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export type FlowPacketFocusRequest = {
  packetId: string;
  memberTraceIds: string[];
  optionContractId?: string;
  source: "options-tape" | "flow-packets" | "alerts";
};

export type OnPacketFocus = (request: FlowPacketFocusRequest) => void;

export type OptionsTapeDecor = {
  hit?: ClassifierHitEvent;
  smartMoney?: SmartMoneyEvent;
  family: string;
  tone: string;
  intensity: number;
};

export type OptionsTapeSmartFlowRefSource = "direct-print" | "packet-member";

export type OptionsTapeSmartFlowContext = {
  projection: SmartFlowExplainabilityProjection;
  source: OptionsTapeSmartFlowRefSource;
  evidenceRefs: string[];
  directPrintRefs: string[];
  packetRefs: string[];
  expandedPacketRefs: string[];
};

export type OptionsTapePacketContext = {
  packet: FlowPacket;
  packetId: string;
  memberTraceIds: string[];
};

export type OptionsTapeRowContext = {
  print: OptionPrint;
  packet?: OptionsTapePacketContext;
  smartFlow?: OptionsTapeSmartFlowContext;
  decor?: OptionsTapeDecor;
  nbbo?: OptionNBBO | null;
};

export type OptionsTapeProps = {
  title?: string;
  ariaLabel?: string;
  className?: string;
  prints?: readonly OptionPrint[];
  source?: DurableTapeSource<OptionPrint, OptionsTapeSourceScope, OptionFlowFilters>;
  sourceOptions?: OptionsTapeSourceOptions;
  filters?: OptionFlowFilters;
  onFiltersChange?: Dispatch<SetStateAction<OptionFlowFilters>>;
  template?: DurableTapeTemplateId | "auto";
  features?: readonly DurableTapeFeatureInput[];
  flowPacketByTraceId?: ReadonlyMap<string, FlowPacket>;
  packetIdByOptionTraceId?: ReadonlyMap<string, string>;
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  decorByTraceId?: ReadonlyMap<string, OptionsTapeDecor>;
  smartFlowProjections?: readonly SmartFlowExplainabilityProjection[];
  nbboByContractId?: ReadonlyMap<string, OptionNBBO>;
  nbboByTraceId?: ReadonlyMap<string, OptionNBBO | null>;
  focusedContractId?: string | null;
  onContractFocus?: (print: OptionPrint) => void;
  onPacketFocus?: OnPacketFocus;
  onClearFocus?: () => void;
  renderLinkedContext?: (context: OptionsTapeRowContext) => ReactNode;
  rowHeight?: number;
  overscan?: number;
};
