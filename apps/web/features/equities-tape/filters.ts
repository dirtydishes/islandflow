import type { EquityPrint, LiveSubscription } from "@islandflow/types";

import type {
  EquitiesTapeFilters,
  EquitiesTapeScope,
  NormalizedEquitiesTapeFilters,
  NormalizedEquitiesTapeScope
} from "./types";

const normalizeToken = (value: string): string | null => {
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
};

const uniqueNormalizedTokens = (items: readonly string[]): string[] => {
  return Array.from(
    new Set(
      items
        .flatMap((item) => item.split(","))
        .map(normalizeToken)
        .filter((item): item is string => item !== null)
    )
  );
};

export const normalizeEquitiesTapeScope = (
  scope?: EquitiesTapeScope
): NormalizedEquitiesTapeScope => {
  const underlyings = uniqueNormalizedTokens([
    ...(scope?.ticker ? [scope.ticker] : []),
    ...(scope?.tickers ?? []),
    ...(scope?.underlyingIds ?? [])
  ]);

  return underlyings.length > 0 ? { underlyingIds: underlyings } : {};
};

export const normalizeEquitiesTapeFilters = (
  filters?: EquitiesTapeFilters
): NormalizedEquitiesTapeFilters => {
  const venues = uniqueNormalizedTokens([
    ...(filters?.venue ? [filters.venue] : []),
    ...(filters?.venues ?? [])
  ]);
  const normalized: NormalizedEquitiesTapeFilters = {};

  if (venues.length > 0) {
    normalized.venues = venues;
  }
  if (typeof filters?.offExchange === "boolean") {
    normalized.offExchange = filters.offExchange;
  }
  if (typeof filters?.sinceTs === "number" && Number.isFinite(filters.sinceTs)) {
    normalized.sinceTs = Math.max(0, Math.floor(filters.sinceTs));
  }

  return normalized;
};

export const getEquitiesTapeSubscription = (
  scope: NormalizedEquitiesTapeScope,
  snapshotLimit: number
): Extract<LiveSubscription, { channel: "equities" }> => ({
  channel: "equities",
  underlying_ids: scope.underlyingIds,
  snapshot_limit: snapshotLimit
});

export const getEquitiesTapeHistoryParams = ({
  cursor,
  scope,
  filters,
  limit
}: {
  cursor: { ts: number; seq: number };
  scope?: NormalizedEquitiesTapeScope;
  filters?: NormalizedEquitiesTapeFilters;
  limit: number;
}): URLSearchParams => {
  const params = new URLSearchParams({
    before_ts: String(Math.max(0, Math.floor(cursor.ts))),
    before_seq: String(Math.max(0, Math.floor(cursor.seq))),
    limit: String(Math.max(1, Math.floor(limit)))
  });

  if (scope?.underlyingIds?.length) {
    params.set("underlying_ids", scope.underlyingIds.join(","));
  }
  if (typeof filters?.sinceTs === "number") {
    params.set("since_ts", String(filters.sinceTs));
  }

  return params;
};

export const matchesEquitiesTapeFilters = (
  print: EquityPrint,
  filters?: NormalizedEquitiesTapeFilters
): boolean => {
  if (!filters) {
    return true;
  }
  if (filters.venues?.length) {
    const venue = print.exchange.trim().toUpperCase();
    if (!filters.venues.includes(venue)) {
      return false;
    }
  }
  if (typeof filters.offExchange === "boolean" && print.offExchangeFlag !== filters.offExchange) {
    return false;
  }
  if (typeof filters.sinceTs === "number" && print.ts < filters.sinceTs) {
    return false;
  }
  return true;
};

export const filterEquityPrints = (
  prints: readonly EquityPrint[],
  filters?: NormalizedEquitiesTapeFilters
): EquityPrint[] => {
  return prints.filter((print) => matchesEquitiesTapeFilters(print, filters));
};
