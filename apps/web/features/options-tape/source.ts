"use client";

import type { FlowPacket, OptionFlowFilters, OptionPrint } from "@islandflow/types";
import { FlowPacketSchema, OptionPrintSchema } from "@islandflow/types";
import { useEffect, useMemo, useRef } from "react";

import { buildBrowserApiUrl } from "../api-transport";
import { createDurableTapeInitialHistoryCursor } from "../durable-tape/history";
import type {
  DurableTapeCursor,
  DurableTapeHistoryPage,
  DurableTapeSource
} from "../durable-tape/types";
import { filterOptionsTapePrints, getOptionsTapeQueryParams } from "./filters";
import type {
  OptionsTapeHistoryResponse,
  OptionsTapeSourceOptions,
  OptionsTapeSourceScope
} from "./types";

const DEFAULT_HISTORY_PAGE_SIZE = 220;
const DEFAULT_MAX_FILTERED_HISTORY_PAGES = 5;

export const buildOptionsTapeApiUrl = (path: string, apiBaseUrl?: string): string => {
  return buildBrowserApiUrl(path, apiBaseUrl);
};

const parseOptionPrints = (items: unknown[]): OptionPrint[] =>
  OptionPrintSchema.array().parse(items);

const parseOptionPrint = (item: unknown): OptionPrint | null =>
  item ? OptionPrintSchema.parse(item) : null;

const parseFlowPacket = (item: unknown): FlowPacket | null =>
  item ? FlowPacketSchema.parse(item) : null;

type OptionsTapeArrayListener = {
  scope: OptionsTapeSourceScope | undefined;
  filters: OptionFlowFilters | undefined;
  listener: (items: readonly OptionPrint[]) => void;
};

const parseHistoryResponse = async (response: Response): Promise<OptionsTapeHistoryResponse> => {
  const payload = (await response.json()) as OptionsTapeHistoryResponse;
  const hasPacket = Object.hasOwn(payload, "packet");
  const hasPinned = Object.hasOwn(payload, "pinned");
  return {
    data: parseOptionPrints(payload.data ?? []),
    next_before: payload.next_before ?? null,
    packet: hasPacket ? parseFlowPacket(payload.packet ?? null) : undefined,
    pinned: hasPinned ? parseOptionPrint(payload.pinned ?? null) : undefined
  };
};

const prependPinnedPrint = (
  prints: readonly OptionPrint[],
  pinned: OptionPrint | null | undefined
): OptionPrint[] => {
  if (!pinned) {
    return [...prints];
  }
  return [pinned, ...prints.filter((print) => print.trace_id !== pinned.trace_id)];
};

const shouldBypassLiveSnapshot = (scope: OptionsTapeSourceScope | undefined): boolean =>
  Boolean(scope?.packetId || scope?.optionContractId);

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
    if (Object.hasOwn(payload, "packet")) {
      options?.onPacketHydrated?.(payload.packet ?? null);
    }
    const filtered = filterOptionsTapePrints(
      prependPinnedPrint(payload.data ?? [], payload.pinned),
      scope,
      filters
    );
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

export const createOptionsTapeFilteredSource = <TScope, TFilters>(
  source: DurableTapeSource<OptionPrint, TScope, TFilters>,
  predicate: (print: OptionPrint) => boolean
): DurableTapeSource<OptionPrint, TScope, TFilters> => {
  const filterRows = (rows: readonly OptionPrint[]): OptionPrint[] => rows.filter(predicate);

  return {
    subscribe: (input) => {
      const subscription = source.subscribe(input);
      return {
        getSnapshot: subscription.getSnapshot
          ? () => filterRows(subscription.getSnapshot?.() ?? [])
          : undefined,
        listen: subscription.listen
          ? (listener) =>
              subscription.listen?.((items) => listener(filterRows(items))) ?? (() => {})
          : undefined,
        unsubscribe: () => subscription.unsubscribe()
      };
    },
    getInitialHistoryCursor: source.getInitialHistoryCursor
      ? (input) => source.getInitialHistoryCursor?.(input)
      : undefined,
    loadOlder: async (cursor, input) => {
      const page = await source.loadOlder(cursor, input);
      return {
        ...page,
        items: filterRows(page.items)
      };
    }
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
  const listenersRef = useRef(new Set<OptionsTapeArrayListener>());
  const optionsRef = useRef(options);

  useEffect(() => {
    printsRef.current = prints;
    for (const entry of listenersRef.current) {
      entry.listener(filterOptionsTapePrints(prints, entry.scope, entry.filters));
    }
  }, [prints]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  return useMemo(
    () => ({
      subscribe: ({ scope, filters }) => ({
        getSnapshot: () =>
          shouldBypassLiveSnapshot(scope)
            ? []
            : filterOptionsTapePrints(printsRef.current, scope, filters),
        listen: (listener) => {
          if (shouldBypassLiveSnapshot(scope)) {
            listener([]);
            return () => {};
          }
          const entry = { scope, filters, listener };
          listenersRef.current.add(entry);
          listener(filterOptionsTapePrints(printsRef.current, scope, filters));
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
