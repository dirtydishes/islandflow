"use client";

import type { SmartFlowAlertEvent } from "@islandflow/types";
import { SmartFlowAlertEventSchema } from "@islandflow/types";
import { useEffect, useMemo, useRef } from "react";

import { buildBrowserApiUrl } from "../api-transport";
import {
  createDurableTapeInitialHistoryCursor,
  type DurableTapeCursor,
  type DurableTapeHistoryPage,
  type DurableTapeSource
} from "../durable-tape";
import { normalizeAlertDirection } from "./format";
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

const parseAlerts = (items: unknown[]): SmartFlowAlertEvent[] =>
  SmartFlowAlertEventSchema.array().parse(items);

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

const normalizeUnitFilter = (value: number | null | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;

export const normalizeAlertsFilters = (
  filters?: AlertsModuleFilters | null
): NormalizedAlertsModuleFilters => {
  const directions = filters?.directions
    ?.map((value) => normalizeAlertDirection(value))
    .filter(Boolean);
  return {
    ...(normalizeUnitFilter(filters?.minConfidence) !== undefined
      ? { minConfidence: normalizeUnitFilter(filters?.minConfidence) }
      : {}),
    ...(normalizeUnitFilter(filters?.minEvidenceQuality) !== undefined
      ? { minEvidenceQuality: normalizeUnitFilter(filters?.minEvidenceQuality) }
      : {}),
    ...(directions?.length ? { directions: Array.from(new Set(directions)) } : {})
  };
};

const alertMatchesScope = (
  alert: SmartFlowAlertEvent,
  scope?: NormalizedAlertsModuleScope
): boolean => {
  if (!scope?.underlyingIds?.length) {
    return true;
  }
  return scope.underlyingIds.includes(alert.underlying_id.toUpperCase());
};

export const filterAlerts = (
  alerts: readonly SmartFlowAlertEvent[],
  scope?: NormalizedAlertsModuleScope,
  filters?: NormalizedAlertsModuleFilters
): SmartFlowAlertEvent[] =>
  alerts.filter((alert) => {
    if (!alertMatchesScope(alert, scope)) {
      return false;
    }
    if (
      typeof filters?.minConfidence === "number" &&
      alert.policy_confidence < filters.minConfidence
    ) {
      return false;
    }
    if (
      typeof filters?.minEvidenceQuality === "number" &&
      alert.evidence_quality < filters.minEvidenceQuality
    ) {
      return false;
    }
    if (
      filters?.directions?.length &&
      !filters.directions.includes(normalizeAlertDirection(alert.direction))
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
}): Promise<DurableTapeHistoryPage<SmartFlowAlertEvent>> => {
  const fetcher = options?.fetcher ?? fetch;
  const limit = options?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  const maxPages = options?.maxFilteredHistoryPages ?? DEFAULT_MAX_FILTERED_HISTORY_PAGES;
  let nextCursor: DurableTapeCursor | null = cursor;

  for (let page = 0; page < maxPages && nextCursor; page += 1) {
    const url = new URL(buildAlertsApiUrl("/history/smart-flow-alerts", options?.apiBaseUrl));
    url.searchParams.set("before_ts", String(nextCursor.ts));
    url.searchParams.set("before_seq", String(nextCursor.seq));
    url.searchParams.set("limit", String(limit));

    const response = await fetcher(url.toString());
    if (!response.ok) {
      throw new Error(`Smart-flow alert history failed with HTTP ${response.status}`);
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
  listener: (items: readonly SmartFlowAlertEvent[]) => void;
};

export const useAlertsArraySource = ({
  alerts,
  options
}: {
  alerts: readonly SmartFlowAlertEvent[];
  options?: AlertsModuleSourceOptions;
}): DurableTapeSource<
  SmartFlowAlertEvent,
  NormalizedAlertsModuleScope,
  NormalizedAlertsModuleFilters
> => {
  const alertsRef = useRef<readonly SmartFlowAlertEvent[]>(alerts);
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
