import type { FlowPacket, OptionPrint, SmartFlowAlertEvent } from "@islandflow/types";

import type {
  DurableTapeFeatureInput,
  DurableTapeSource,
  DurableTapeTemplateId
} from "../durable-tape";
import type { FlowPacketFocusRequest } from "../flow-packets";

export type AlertColumnId = "time" | "symbol" | "hypothesis" | "direction" | "confidenceEvidence";

export type AlertsModuleScope = {
  tickers?: readonly string[] | null;
  underlyingIds?: readonly string[] | null;
};

export type NormalizedAlertsModuleScope = {
  underlyingIds?: string[];
};

export type AlertsModuleFilters = {
  minConfidence?: number | null;
  minEvidenceQuality?: number | null;
  directions?: readonly string[] | null;
};

export type NormalizedAlertsModuleFilters = {
  minConfidence?: number;
  minEvidenceQuality?: number;
  directions?: string[];
};

export type AlertEvidenceItem =
  | { kind: "flow"; id: string; packet: FlowPacket }
  | { kind: "print"; id: string; print: OptionPrint }
  | { kind: "context"; id: string; label: string }
  | { kind: "unknown"; id: string };

export type AlertContextBundle = {
  alert?: unknown;
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
  data?: SmartFlowAlertEvent[];
  next_before?: { ts: number; seq: number } | null;
};

export type AlertsModuleProps = AlertActionCallbacks & {
  title?: string;
  ariaLabel?: string;
  className?: string;
  alerts?: readonly SmartFlowAlertEvent[];
  source?: DurableTapeSource<
    SmartFlowAlertEvent,
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
  selectedAlert?: SmartFlowAlertEvent | null;
  onSelectAlert?: (alert: SmartFlowAlertEvent) => void;
  onCloseDetail?: () => void;
  showDetail?: boolean;
  rowHeight?: number;
  overscan?: number;
};
