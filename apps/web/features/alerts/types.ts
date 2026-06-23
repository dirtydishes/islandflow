import type { AlertEvent, FlowPacket, OptionPrint } from "@islandflow/types";

import type {
  DurableTapeFeatureInput,
  DurableTapeSource,
  DurableTapeTemplateId
} from "../durable-tape";
import type { FlowPacketFocusRequest } from "../flow-packets";

export type AlertColumnId = "time" | "symbol" | "kind" | "score" | "state";

export type AlertsModuleScope = {
  tickers?: readonly string[] | null;
  underlyingIds?: readonly string[] | null;
};

export type NormalizedAlertsModuleScope = {
  underlyingIds?: string[];
};

export type AlertsModuleFilters = {
  minScore?: number | null;
  severities?: readonly string[] | null;
};

export type NormalizedAlertsModuleFilters = {
  minScore?: number;
  severities?: string[];
};

export type AlertEvidenceItem =
  | { kind: "flow"; id: string; packet: FlowPacket }
  | { kind: "print"; id: string; print: OptionPrint }
  | { kind: "unknown"; id: string };

export type AlertContextBundle = {
  alert: AlertEvent | null;
  flow_packets: FlowPacket[];
  option_prints: OptionPrint[];
  missing_refs: string[];
};

export type AlertContextStatus = {
  traceId: string | null;
  loading: boolean;
  missingRefs: string[];
  error: string | null;
};

export type AlertEvidenceHydration = {
  evidence: AlertEvidenceItem[];
  flowPacket: FlowPacket | null;
  status: AlertContextStatus;
};

export type AlertEquityFocusRequest = {
  underlyingId: string;
  source: "alerts";
};

export type AlertContractFocusRequest = {
  print: OptionPrint;
  source: "alerts";
};

export type AlertActionCallbacks = {
  onPacketFocus?: (request: FlowPacketFocusRequest) => void;
  onContractFocus?: (request: AlertContractFocusRequest) => void;
  onEquityFocus?: (request: AlertEquityFocusRequest) => void;
};

export type AlertsModuleSourceOptions = {
  apiBaseUrl?: string;
  historyPageSize?: number;
  maxFilteredHistoryPages?: number;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export type AlertsModuleHistoryResponse = {
  data?: AlertEvent[];
  next_before?: { ts: number; seq: number } | null;
};

export type AlertsModuleProps = AlertActionCallbacks & {
  title?: string;
  ariaLabel?: string;
  className?: string;
  alerts?: readonly AlertEvent[];
  source?: DurableTapeSource<
    AlertEvent,
    NormalizedAlertsModuleScope,
    NormalizedAlertsModuleFilters
  >;
  sourceOptions?: AlertsModuleSourceOptions;
  scope?: AlertsModuleScope;
  filters?: AlertsModuleFilters;
  features?: readonly DurableTapeFeatureInput[];
  template?: DurableTapeTemplateId | "auto";
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  optionPrintByTraceId?: ReadonlyMap<string, OptionPrint>;
  selectedAlert?: AlertEvent | null;
  onSelectAlert?: (alert: AlertEvent) => void;
  onCloseDetail?: () => void;
  showDetail?: boolean;
  rowHeight?: number;
  overscan?: number;
};
