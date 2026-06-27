import type {
  OptionFlowFilters,
  OptionFlowView,
  OptionNbboSide,
  OptionPrint,
  OptionSecurityType,
  OptionType
} from "@islandflow/types";
import { matchesOptionPrintFilters } from "@islandflow/types";

import type { OptionsTapeSourceScope } from "./types";

export const OPTIONS_TAPE_DEFAULT_SIDES: OptionNbboSide[] = ["AA", "A", "MID"];
export const OPTIONS_TAPE_DEFAULT_OPTION_TYPES: OptionType[] = ["call", "put"];
export const OPTIONS_TAPE_DEFAULT_SECURITY_TYPES: OptionSecurityType[] = ["stock"];

export type OptionsTapeSidePreset =
  | "default"
  | "aa"
  | "a"
  | "ask"
  | "mid"
  | "bid"
  | "b"
  | "bb"
  | "custom";

export const buildDefaultOptionsTapeFilters = (): OptionFlowFilters => ({
  view: "signal",
  securityTypes: OPTIONS_TAPE_DEFAULT_SECURITY_TYPES,
  nbboSides: OPTIONS_TAPE_DEFAULT_SIDES,
  optionTypes: OPTIONS_TAPE_DEFAULT_OPTION_TYPES
});

const sameValues = <T extends string>(
  left: readonly T[] | undefined,
  right: readonly T[]
): boolean => {
  const leftValues = [...(left ?? [])].sort();
  const rightValues = [...right].sort();
  return (
    leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index])
  );
};

export const getOptionsTapeSidePreset = (
  filters: Pick<OptionFlowFilters, "nbboSides">
): OptionsTapeSidePreset => {
  if (sameValues(filters.nbboSides, OPTIONS_TAPE_DEFAULT_SIDES)) {
    return "default";
  }
  if (sameValues(filters.nbboSides, ["AA"])) {
    return "aa";
  }
  if (sameValues(filters.nbboSides, ["A"])) {
    return "a";
  }
  if (sameValues(filters.nbboSides, ["AA", "A"])) {
    return "ask";
  }
  if (sameValues(filters.nbboSides, ["MID"])) {
    return "mid";
  }
  if (sameValues(filters.nbboSides, ["B", "BB"])) {
    return "bid";
  }
  if (sameValues(filters.nbboSides, ["B"])) {
    return "b";
  }
  if (sameValues(filters.nbboSides, ["BB"])) {
    return "bb";
  }
  return "custom";
};

export const applyOptionsTapeView = (
  filters: OptionFlowFilters,
  view: OptionFlowView
): OptionFlowFilters =>
  view === "raw"
    ? {
        view: "raw",
        optionTypes: filters.optionTypes,
        securityTypes: filters.securityTypes,
        minNotional: filters.minNotional
      }
    : {
        ...buildDefaultOptionsTapeFilters(),
        ...filters,
        view: "signal",
        securityTypes: filters.securityTypes ?? OPTIONS_TAPE_DEFAULT_SECURITY_TYPES,
        nbboSides: filters.nbboSides ?? OPTIONS_TAPE_DEFAULT_SIDES,
        optionTypes: filters.optionTypes ?? OPTIONS_TAPE_DEFAULT_OPTION_TYPES
      };

export const applyOptionsTapeSidePreset = (
  filters: OptionFlowFilters,
  preset: OptionsTapeSidePreset
): OptionFlowFilters => {
  const sidesByPreset: Record<Exclude<OptionsTapeSidePreset, "custom">, OptionNbboSide[]> = {
    default: OPTIONS_TAPE_DEFAULT_SIDES,
    aa: ["AA"],
    a: ["A"],
    ask: ["AA", "A"],
    mid: ["MID"],
    bid: ["B", "BB"],
    b: ["B"],
    bb: ["BB"]
  };
  if (preset === "custom") {
    return filters;
  }
  return { ...filters, nbboSides: sidesByPreset[preset] };
};

export const applyOptionsTapeTypePreset = (
  filters: OptionFlowFilters,
  preset: "calls" | "puts" | "both"
): OptionFlowFilters => ({
  ...filters,
  optionTypes: preset === "calls" ? ["call"] : preset === "puts" ? ["put"] : ["call", "put"]
});

export const applyOptionsTapeSecurityPreset = (
  filters: OptionFlowFilters,
  preset: "stocks" | "etfs" | "all"
): OptionFlowFilters => ({
  ...filters,
  securityTypes: preset === "stocks" ? ["stock"] : preset === "etfs" ? ["etf"] : ["stock", "etf"]
});

export const getOptionsTapeQueryParams = (
  scope: OptionsTapeSourceScope | undefined,
  filters: OptionFlowFilters | undefined,
  limit: number
): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (filters?.view) {
    params.set("view", filters.view);
  }
  if (filters?.securityTypes?.length === 1) {
    params.set("security", filters.securityTypes[0]);
  } else if (filters?.securityTypes && filters.securityTypes.length > 1) {
    params.set("security", "all");
  }
  if (filters?.nbboSides?.length) {
    params.set("side", filters.nbboSides.join(","));
  }
  if (filters?.optionTypes?.length) {
    params.set("type", filters.optionTypes.join(","));
  }
  if (typeof filters?.minNotional === "number") {
    params.set("min_notional", String(filters.minNotional));
  }
  if (scope?.underlyingIds?.length) {
    params.set("underlying_ids", scope.underlyingIds.join(","));
  }
  if (scope?.packetId) {
    params.set("flow_packet_id", scope.packetId);
  }
  if (scope?.selectedTraceId) {
    params.set("pinned_trace_id", scope.selectedTraceId);
  }
  if (scope?.optionContractId) {
    params.set("option_contract_id", scope.optionContractId);
  }
  return params;
};

export const getOptionsTapeScopeFilters = (
  scope: OptionsTapeSourceScope | undefined,
  filters: OptionFlowFilters | undefined
): OptionFlowFilters | undefined =>
  scope?.packetId || scope?.packetMemberTraceIds?.length || scope?.optionContractId
    ? undefined
    : filters;

export const filterOptionsTapePrints = (
  prints: readonly OptionPrint[],
  scope: OptionsTapeSourceScope | undefined,
  filters: OptionFlowFilters | undefined
): OptionPrint[] => {
  const memberTraceIds = new Set(scope?.packetMemberTraceIds ?? []);
  return prints.filter((print) => {
    if (memberTraceIds.size > 0 && !memberTraceIds.has(print.trace_id)) {
      return false;
    }
    if (
      !scope?.packetId &&
      scope?.optionContractId &&
      print.option_contract_id.trim() !== scope.optionContractId
    ) {
      return false;
    }
    return matchesOptionPrintFilters(print, filters);
  });
};
