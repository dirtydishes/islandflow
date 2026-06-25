"use client";

import type { AlertEvent } from "@islandflow/types";
import { AlertEventSchema } from "@islandflow/types";
import { useEffect, useMemo, useRef } from "react";

import { buildBrowserApiUrl } from "../api-transport";
import {
  createDurableTapeInitialHistoryCursor,
  type DurableTapeCursor,
  type DurableTapeHistoryPage,
  type DurableTapeSource
} from "../durable-tape";
import { getAlertCursor } from "./format";
import type {
  AlertsModuleFilters,
  AlertsModuleHistoryResponse,
  AlertsModuleSourceOptions,
  NormalizedAlertsModuleFilters,
  NormalizedAlertsModuleScope
} from "./types";

const DEFAULT_HISTORY_PAGE_SIZE = 160;
const DEFAULT_MAX_FILTERED_HISTORY_PAGES = 5;

export const buildAlertsApiUrl = (path: string, apiBaseUrl?: string): string => {
  return buildBrowserApiUrl(path, apiBaseUrl);
};

const parseAlerts = (items: unknown[]): AlertEvent[] => AlertEventSchema.array().parse(items);

export const normalizeAlertsScope = (
  scope?: {
    tickers?: readonly string[] | null;
    underlyingIds?: readonly string[] | null;
  } | null
): NormalizedAlertsModuleScope => {
  const values = [...(scope?.underlyingIds ?? []), ...(scope?.tickers ?? [])]
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return values.length > 0 ? { underlyingIds: Array.from(new Set(values)) } : {};
};

export const normalizeAlertsFilters = (
  filters?: AlertsModuleFilters | null
): NormalizedAlertsModuleFilters => {
  const severities = filters?.severities
    ?.map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return {
    ...(typeof filters?.minScore === "number" && Number.isFinite(filters.minScore)
      ? { minScore: filters.minScore }
      : {}),
    ...(severities?.length ? { severities: Array.from(new Set(severities)) } : {})
  };
};

const appendAlertParams = (
  params: URLSearchParams,
  scope?: NormalizedAlertsModuleScope,
  filters?: NormalizedAlertsModuleFilters
) => {
  if (scope?.underlyingIds?.length) {
    params.set("underlying_ids", scope.underlyingIds.join(","));
  }
  if (typeof filters?.minScore === "number") {
    params.set("min_score", String(filters.minScore));
  }
  if (filters?.severities?.length) {
    params.set("severity", filters.severities.join(","));
  }
};

const alertMatchesScope = (alert: AlertEvent, scope?: NormalizedAlertsModuleScope): boolean => {
  if (!scope?.underlyingIds?.length) {
    return true;
  }
  const haystack = `${alert.trace_id} ${alert.evidence_refs.join(" ")}`.toUpperCase();
  return scope.underlyingIds.some((underlying) => haystack.includes(underlying));
};

export const filterAlerts = (
  alerts: readonly AlertEvent[],
  scope?: NormalizedAlertsModuleScope,
  filters?: NormalizedAlertsModuleFilters
): AlertEvent[] =>
  alerts.filter((alert) => {
    if (!alertMatchesScope(alert, scope)) {
      return false;
    }
    if (typeof filters?.minScore === "number" && alert.score < filters.minScore) {
      return false;
    }
    if (
      filters?.severities?.length &&
      !filters.severities.includes(alert.severity.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

const parseHistoryResponse = async (response: Response): Promise<AlertsModuleHistoryResponse> => {
  const payload = (await response.json()) as AlertsModuleHistoryResponse;
  return {
    data: parseAlerts(payload.data ?? []),
    next_before: payload.next_before ?? null
  };
};

export const loadAlertsHistoryPage = async ({
  cursor,
  scope,
  filters,
  options
}: {
  cursor: DurableTapeCursor;
  scope?: NormalizedAlertsModuleScope;
  filters?: NormalizedAlertsModuleFilters;
  options?: AlertsModuleSourceOptions;
}): Promise<DurableTapeHistoryPage<AlertEvent>> => {
  const fetcher = options?.fetcher ?? fetch;
  const limit = options?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  const maxPages = options?.maxFilteredHistoryPages ?? DEFAULT_MAX_FILTERED_HISTORY_PAGES;
  let nextCursor: DurableTapeCursor | null = cursor;

  for (let page = 0; page < maxPages && nextCursor; page += 1) {
    const url = new URL(buildAlertsApiUrl("/history/alerts", options?.apiBaseUrl));
    url.searchParams.set("before_ts", String(nextCursor.ts));
    url.searchParams.set("before_seq", String(nextCursor.seq));
    url.searchParams.set("limit", String(limit));
    appendAlertParams(url.searchParams, scope, filters);

    const response = await fetcher(url.toString());
    if (!response.ok) {
      throw new Error(`Alerts history failed with HTTP ${response.status}`);
    }

    const payload = await parseHistoryResponse(response);
    const filtered = filterAlerts(payload.data ?? [], scope, filters);
    if (filtered.length > 0 || !payload.next_before) {
      return {
        items: filtered,
        nextCursor: payload.next_before,
        exhausted: !payload.next_before
      };
    }
    nextCursor = payload.next_before;
  }

  return {
    items: [],
    nextCursor,
    exhausted: !nextCursor
  };
};

type AlertsArrayListener = {
  scope: NormalizedAlertsModuleScope | undefined;
  filters: NormalizedAlertsModuleFilters | undefined;
  listener: (items: readonly AlertEvent[]) => void;
};

export const useAlertsArraySource = ({
  alerts,
  options
}: {
  alerts: readonly AlertEvent[];
  options?: AlertsModuleSourceOptions;
}): DurableTapeSource<AlertEvent, NormalizedAlertsModuleScope, NormalizedAlertsModuleFilters> => {
  const alertsRef = useRef<readonly AlertEvent[]>(alerts);
  const listenersRef = useRef(new Set<AlertsArrayListener>());
  const optionsRef = useRef(options);

  useEffect(() => {
    alertsRef.current = alerts;
    for (const entry of listenersRef.current) {
      entry.listener(filterAlerts(alerts, entry.scope, entry.filters));
    }
  }, [alerts]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  return useMemo(
    () => ({
      subscribe: ({ scope, filters }) => ({
        getSnapshot: () => filterAlerts(alertsRef.current, scope, filters),
        listen: (listener) => {
          const entry = { scope, filters, listener };
          listenersRef.current.add(entry);
          listener(filterAlerts(alertsRef.current, scope, filters));
          return () => {
            listenersRef.current.delete(entry);
          };
        },
        unsubscribe: () => {
          listenersRef.current.clear();
        }
      }),
      getInitialHistoryCursor: () => createDurableTapeInitialHistoryCursor(),
      loadOlder: (cursor, { scope, filters }) =>
        loadAlertsHistoryPage({
          cursor,
          scope,
          filters,
          options: optionsRef.current
        })
    }),
    []
  );
};
