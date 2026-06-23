"use client";

import type { OptionFlowFilters, OptionPrint } from "@islandflow/types";
import { OptionPrintSchema } from "@islandflow/types";
import { useEffect, useMemo, useRef } from "react";

import type {
  DurableTapeCursor,
  DurableTapeHistoryPage,
  DurableTapeSource
} from "../durable-tape";
import { filterOptionsTapePrints, getOptionsTapeQueryParams } from "./filters";
import type {
  OptionsTapeHistoryResponse,
  OptionsTapeSourceOptions,
  OptionsTapeSourceScope
} from "./types";

const DEFAULT_HISTORY_PAGE_SIZE = 220;
const DEFAULT_MAX_FILTERED_HISTORY_PAGES = 5;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const getEnvApiBase = (): string | undefined => process.env.NEXT_PUBLIC_API_URL;

export const buildOptionsTapeApiUrl = (path: string, apiBaseUrl?: string): string => {
  const base = apiBaseUrl ?? getEnvApiBase();
  if (base) {
    const url = new URL(base);
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    url.protocol = secure ? "https:" : "http:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const { protocol, hostname } = window.location;
  const isLocal = LOCAL_HOSTS.has(hostname);
  const host = isLocal ? `${hostname}:4000` : window.location.host;
  return `${protocol === "https:" ? "https" : "http"}://${host}${path}`;
};

const parseOptionPrints = (items: unknown[]): OptionPrint[] =>
  OptionPrintSchema.array().parse(items);

const parseHistoryResponse = async (response: Response): Promise<OptionsTapeHistoryResponse> => {
  const payload = (await response.json()) as OptionsTapeHistoryResponse;
  return {
    data: parseOptionPrints(payload.data ?? []),
    next_before: payload.next_before ?? null
  };
};

export const loadOptionsTapeHistoryPage = async ({
  cursor,
  scope,
  filters,
  options
}: {
  cursor: DurableTapeCursor;
  scope?: OptionsTapeSourceScope;
  filters?: OptionFlowFilters;
  options?: OptionsTapeSourceOptions;
}): Promise<DurableTapeHistoryPage<OptionPrint>> => {
  const fetcher = options?.fetcher ?? fetch;
  const limit = options?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  const maxPages = options?.maxFilteredHistoryPages ?? DEFAULT_MAX_FILTERED_HISTORY_PAGES;
  let nextCursor: DurableTapeCursor | null = cursor;

  for (let page = 0; page < maxPages && nextCursor; page += 1) {
    const url = new URL(buildOptionsTapeApiUrl("/history/options", options?.apiBaseUrl));
    const params = getOptionsTapeQueryParams(scope, filters, limit);
    params.set("before_ts", String(nextCursor.ts));
    params.set("before_seq", String(nextCursor.seq));
    url.search = params.toString();

    const response = await fetcher(url.toString());
    if (!response.ok) {
      throw new Error(`Options history failed with HTTP ${response.status}`);
    }

    const payload = await parseHistoryResponse(response);
    const filtered = filterOptionsTapePrints(payload.data ?? [], scope, filters);
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

export const useOptionsTapeArraySource = ({
  prints,
  options
}: {
  prints: readonly OptionPrint[];
  options?: OptionsTapeSourceOptions;
}): DurableTapeSource<OptionPrint, OptionsTapeSourceScope, OptionFlowFilters> => {
  const printsRef = useRef<readonly OptionPrint[]>(prints);
  const listenersRef = useRef(new Set<(items: readonly OptionPrint[]) => void>());
  const optionsRef = useRef(options);

  useEffect(() => {
    printsRef.current = prints;
    for (const listener of listenersRef.current) {
      listener(prints);
    }
  }, [prints]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  return useMemo(
    () => ({
      subscribe: ({ scope, filters }) => ({
        getSnapshot: () => filterOptionsTapePrints(printsRef.current, scope, filters),
        listen: (listener) => {
          listenersRef.current.add(listener);
          listener(filterOptionsTapePrints(printsRef.current, scope, filters));
          return () => {
            listenersRef.current.delete(listener);
          };
        },
        unsubscribe: () => {
          listenersRef.current.clear();
        }
      }),
      loadOlder: (cursor, { scope, filters }) =>
        loadOptionsTapeHistoryPage({
          cursor,
          scope,
          filters,
          options: optionsRef.current
        })
    }),
    []
  );
};

