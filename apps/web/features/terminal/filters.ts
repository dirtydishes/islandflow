import type {
  LiveSubscription,
  OptionFlowFilters,
  OptionNbboSide,
  OptionPrint,
  OptionSecurityType,
  OptionType
} from "@islandflow/types";
import { matchesOptionPrintFilters } from "@islandflow/types";
import { FLOW_FILTER_PRESET, LIVE_EQUITIES_SILENT_WARNING_MS } from "./config";
import { composeTapeItems, getTapeItemKey } from "./tape";
import type {
  OptionScope,
  SelectedInstrument,
  SortableItem,
  TapeFocusSeed,
  WsStatus
} from "./types";

export const DEFAULT_FLOW_SIDES: OptionNbboSide[] = ["AA", "A", "MID"];
export const DEFAULT_FLOW_OPTION_TYPES: OptionType[] = ["call", "put"];
export const DEFAULT_FLOW_SECURITY_TYPES: OptionSecurityType[] = ["stock"];

export const buildDefaultFlowFilters = (): OptionFlowFilters => ({
  view: "signal",
  securityTypes: DEFAULT_FLOW_SECURITY_TYPES,
  nbboSides: DEFAULT_FLOW_SIDES,
  optionTypes: DEFAULT_FLOW_OPTION_TYPES,
  minNotional:
    FLOW_FILTER_PRESET === "all" ? undefined : FLOW_FILTER_PRESET === "balanced" ? 5_000 : undefined
});

const sameFilterValues = <T extends string>(
  left: T[] | undefined,
  right: T[] | undefined
): boolean => {
  const leftValues = [...(left ?? [])].sort();
  const rightValues = [...(right ?? [])].sort();
  if (leftValues.length !== rightValues.length) {
    return false;
  }
  return leftValues.every((value, index) => value === rightValues[index]);
};

export const countActiveFlowFilterGroups = (filters: OptionFlowFilters): number => {
  const defaults = buildDefaultFlowFilters();
  let count = 0;

  if (!sameFilterValues(filters.securityTypes, defaults.securityTypes)) {
    count += 1;
  }
  if (!sameFilterValues(filters.nbboSides, defaults.nbboSides)) {
    count += 1;
  }
  if (!sameFilterValues(filters.optionTypes, defaults.optionTypes)) {
    count += 1;
  }
  if ((filters.minNotional ?? undefined) !== (defaults.minNotional ?? undefined)) {
    count += 1;
  }
  if ((filters.view ?? defaults.view) !== defaults.view) {
    count += 1;
  }

  return count;
};

export const toggleFilterValue = <T extends string>(
  values: T[] | undefined,
  value: T,
  enabled: boolean
): T[] => {
  const current = new Set(values ?? []);
  if (enabled) {
    current.add(value);
  } else {
    current.delete(value);
  }
  return [...current].sort();
};

export const nextFlowFilterPopoverState = (
  current: boolean,
  action: "toggle" | "dismiss"
): boolean => {
  return action === "toggle" ? !current : false;
};

type EquitiesSilentFeedWarningInput = {
  wsStatus: WsStatus;
  equitiesSubscribed: boolean;
  connectedAt: number | null;
  lastEquitiesEventAt: number | null;
  now?: number;
  thresholdMs?: number;
};

export const shouldShowEquitiesSilentFeedWarning = ({
  wsStatus,
  equitiesSubscribed,
  connectedAt,
  lastEquitiesEventAt,
  now = Date.now(),
  thresholdMs = LIVE_EQUITIES_SILENT_WARNING_MS
}: EquitiesSilentFeedWarningInput): boolean => {
  if (wsStatus !== "connected" || !equitiesSubscribed) {
    return false;
  }
  const baselineTs = lastEquitiesEventAt ?? connectedAt;
  if (baselineTs === null) {
    return false;
  }
  return now - baselineTs >= thresholdMs;
};

const LIVE_SNAPSHOT_HISTORY_CHANNELS = new Set<LiveSubscription["channel"]>([
  "options",
  "nbbo",
  "equities",
  "flow",
  "smart-flow",
  "smart-money",
  "classifier-hits"
]);

export const shouldRetainLiveSnapshotHistory = (
  channel: LiveSubscription["channel"],
  isSnapshot: boolean,
  snapshotItemCount: number,
  currentItemCount: number
): boolean =>
  isSnapshot &&
  snapshotItemCount === 0 &&
  currentItemCount > 0 &&
  LIVE_SNAPSHOT_HISTORY_CHANNELS.has(channel);

export const appendOptionFlowFilters = (
  params: URLSearchParams,
  filters: OptionFlowFilters | undefined
): void => {
  if (!filters) {
    return;
  }
  if (filters.view) {
    params.set("view", filters.view);
  }
  if (filters.securityTypes?.length === 1) {
    params.set("security", filters.securityTypes[0]);
  } else if (filters.securityTypes && filters.securityTypes.length > 1) {
    params.set("security", "all");
  }
  if (filters.nbboSides?.length) {
    params.set("side", filters.nbboSides.join(","));
  }
  if (filters.optionTypes?.length) {
    params.set("type", filters.optionTypes.join(","));
  }
  if (typeof filters.minNotional === "number") {
    params.set("min_notional", String(filters.minNotional));
  }
};

const appendOptionScopeParams = (
  params: URLSearchParams,
  optionScope: OptionScope | undefined
): void => {
  if (optionScope?.underlying_ids?.length) {
    params.set("underlying_ids", optionScope.underlying_ids.join(","));
  }
  if (optionScope?.option_contract_id) {
    params.set("option_contract_id", optionScope.option_contract_id);
  }
};

export const getEffectiveOptionPrintFilters = (
  flowFilters: OptionFlowFilters,
  isOptionContractFocused: boolean
): OptionFlowFilters | undefined => {
  return isOptionContractFocused ? undefined : flowFilters;
};

export const getOptionScope = (
  activeTickers: string[],
  instrumentUnderlying: string | null,
  selectedInstrument: SelectedInstrument
): OptionScope => ({
  underlying_ids:
    selectedInstrument?.kind === "option-contract"
      ? instrumentUnderlying
        ? [instrumentUnderlying]
        : undefined
      : activeTickers.length > 0
        ? activeTickers
        : instrumentUnderlying
          ? [instrumentUnderlying]
          : undefined,
  option_contract_id:
    selectedInstrument?.kind === "option-contract" ? selectedInstrument.contractId : undefined
});

export const buildOptionTapeQueryParams = (
  filters: OptionFlowFilters | undefined,
  optionScope: OptionScope | undefined
): Record<string, string | undefined> => {
  const params = new URLSearchParams();
  appendOptionFlowFilters(params, filters);
  appendOptionScopeParams(params, optionScope);
  return Object.fromEntries(params.entries());
};

const normalizeContractId = (value: string): string => value.trim();

const extractUnderlying = (contractId: string): string => {
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  return contractId.split("-")[0]?.toUpperCase() ?? contractId.toUpperCase();
};

export const filterOptionTapeItems = (
  items: OptionPrint[],
  filters: OptionFlowFilters | undefined,
  selectedInstrument: SelectedInstrument,
  tickerSet: Set<string>,
  instrumentUnderlying: string | null
): OptionPrint[] => {
  return items.filter((print) => {
    const contractId = normalizeContractId(print.option_contract_id);
    if (selectedInstrument?.kind === "option-contract") {
      return contractId === selectedInstrument.contractId;
    }
    if (!matchesOptionPrintFilters(print, filters)) {
      return false;
    }
    const underlying = extractUnderlying(contractId);
    if (tickerSet.size === 0) {
      return !instrumentUnderlying || underlying === instrumentUnderlying;
    }
    return Boolean(underlying) && tickerSet.has(underlying.toUpperCase());
  });
};

export const shouldClearOptionFocusSeed = (
  seed: TapeFocusSeed<OptionPrint> | null,
  optionFocusScopeKey: string | null,
  currentOptionSubscriptionKey: string | null,
  liveItems: OptionPrint[],
  historyItems: OptionPrint[]
): boolean => {
  if (!seed) {
    return false;
  }
  if (seed.scopeKey !== optionFocusScopeKey) {
    return true;
  }
  if (seed.subscriptionKey && seed.subscriptionKey !== currentOptionSubscriptionKey) {
    return false;
  }
  const liveKeys = new Set(
    composeTapeItems([], liveItems, historyItems).map((item) => getTapeItemKey(item))
  );
  return seed.items.every((item) => liveKeys.has(getTapeItemKey(item)));
};

export const TICKER_FILTER_INPUT_MAX_LENGTH = 120;

export const normalizeTickerFilterInput = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/，/g, ",")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, TICKER_FILTER_INPUT_MAX_LENGTH);

export const parseTickerFilterInput = (value: string): string[] => {
  const parts = normalizeTickerFilterInput(value)
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
};

export type { SortableItem };
