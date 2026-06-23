import {
  type EquityPrint,
  EquityPrintSchema,
  getSubscriptionKey as getLiveSubscriptionKey,
  type LiveServerMessage,
  parseLivePayload
} from "@islandflow/types";

import { createDurableTapeInitialHistoryCursor, mergeNewest } from "../durable-tape";
import {
  filterEquityPrints,
  getEquitiesTapeHistoryParams,
  getEquitiesTapeSubscription
} from "./filters";
import { getEquityPrintCursor, getEquityPrintKey } from "./format";
import type {
  EquitiesTapeHistoryResponse,
  EquitiesTapeSourceOptions,
  NormalizedEquitiesTapeFilters,
  NormalizedEquitiesTapeScope
} from "./types";

const DEFAULT_HISTORY_PAGE_SIZE = 200;
const DEFAULT_SNAPSHOT_LIMIT = 200;
const DEFAULT_MAX_FILTERED_HISTORY_PAGES = 6;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const getEnvApiBase = (): string | undefined => process.env.NEXT_PUBLIC_API_URL;

export const buildEquitiesTapeApiUrl = (path: string, apiBaseUrl?: string): string => {
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

export const buildEquitiesTapeWsUrl = (path: string, wsBaseUrl?: string): string => {
  const base = wsBaseUrl ?? getEnvApiBase();
  if (base) {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const { protocol, hostname } = window.location;
  const isLocal = LOCAL_HOSTS.has(hostname);
  const host = isLocal ? `${hostname}:4000` : window.location.host;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${path}`;
};

const parseEquityPrints = (items: unknown[]): EquityPrint[] =>
  EquityPrintSchema.array().parse(items);

const parseHistoryResponse = async (response: Response): Promise<EquitiesTapeHistoryResponse> => {
  const payload = (await response.json()) as EquitiesTapeHistoryResponse;
  return {
    data: parseEquityPrints(payload.data ?? []),
    next_before: payload.next_before ?? null
  };
};

export const loadEquitiesTapeHistoryPage = async ({
  cursor,
  scope,
  filters,
  options
}: {
  cursor: { ts: number; seq: number };
  scope?: NormalizedEquitiesTapeScope;
  filters?: NormalizedEquitiesTapeFilters;
  options?: EquitiesTapeSourceOptions;
}) => {
  const fetcher = options?.fetcher ?? fetch;
  const limit = options?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  const maxPages = options?.maxFilteredHistoryPages ?? DEFAULT_MAX_FILTERED_HISTORY_PAGES;
  let nextCursor: typeof cursor | null = cursor;

  for (let page = 0; page < maxPages && nextCursor; page += 1) {
    const url = new URL(buildEquitiesTapeApiUrl("/history/equities", options?.apiBaseUrl));
    url.search = getEquitiesTapeHistoryParams({
      cursor: nextCursor,
      scope,
      filters,
      limit
    }).toString();

    const response = await fetcher(url.toString());
    if (!response.ok) {
      throw new Error(`Equities history failed with HTTP ${response.status}`);
    }

    const payload = await parseHistoryResponse(response);
    const filtered = filterEquityPrints(payload.data ?? [], filters);
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

export const createEquitiesTapeSource = (options: EquitiesTapeSourceOptions = {}) => ({
  subscribe: ({
    scope,
    filters
  }: {
    scope?: NormalizedEquitiesTapeScope;
    filters?: NormalizedEquitiesTapeFilters;
  }) => {
    const listeners = new Set<(items: readonly EquityPrint[]) => void>();
    const accessors = {
      getKey: getEquityPrintKey,
      getCursor: getEquityPrintCursor
    };
    const snapshotLimit = options.snapshotLimit ?? DEFAULT_SNAPSHOT_LIMIT;
    const subscription = getEquitiesTapeSubscription(scope ?? {}, snapshotLimit);
    const subscriptionKey = getLiveSubscriptionKey(subscription);
    let items: EquityPrint[] = [];
    let socket: WebSocket | null = null;
    let closed = false;

    const publish = () => {
      const filtered = filterEquityPrints(items, filters);
      for (const listener of listeners) {
        listener(filtered);
      }
    };

    const replaceItems = (nextItems: readonly EquityPrint[]) => {
      items = filterEquityPrints([...nextItems], filters).slice(0, snapshotLimit);
      publish();
    };

    const mergeItems = (nextItems: readonly EquityPrint[]) => {
      items = mergeNewest(
        filterEquityPrints([...nextItems], filters),
        items,
        snapshotLimit,
        undefined,
        accessors
      );
      publish();
    };

    if (options.live !== false && typeof WebSocket !== "undefined") {
      socket = (options.createWebSocket ?? ((url: string) => new WebSocket(url)))(
        buildEquitiesTapeWsUrl("/ws/live", options.wsBaseUrl)
      );
      socket.onopen = () => {
        if (!closed) {
          socket?.send(JSON.stringify({ op: "subscribe", subscriptions: [subscription] }));
        }
      };
      socket.onmessage = (event) => {
        if (closed) {
          return;
        }
        const message = JSON.parse(event.data as string) as LiveServerMessage;
        if (message.op === "snapshot") {
          if (
            message.snapshot.subscription.channel === "equities" &&
            getLiveSubscriptionKey(message.snapshot.subscription) === subscriptionKey
          ) {
            replaceItems(parseEquityPrints(message.snapshot.items));
          }
          return;
        }
        if (
          message.op === "event" &&
          message.subscription.channel === "equities" &&
          getLiveSubscriptionKey(message.subscription) === subscriptionKey
        ) {
          mergeItems([parseLivePayload("equities", message.item) as EquityPrint]);
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
    }

    return {
      getSnapshot: () => items,
      listen: (listener: (items: readonly EquityPrint[]) => void) => {
        listeners.add(listener);
        if (items.length > 0) {
          listener(filterEquityPrints(items, filters));
        }
        return () => {
          listeners.delete(listener);
        };
      },
      unsubscribe: () => {
        closed = true;
        if (typeof WebSocket !== "undefined" && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: "unsubscribe", subscriptions: [subscription] }));
        }
        socket?.close();
        listeners.clear();
      }
    };
  },
  getInitialHistoryCursor: () => createDurableTapeInitialHistoryCursor(),
  loadOlder: (
    cursor: { ts: number; seq: number },
    {
      scope,
      filters
    }: {
      scope?: NormalizedEquitiesTapeScope;
      filters?: NormalizedEquitiesTapeFilters;
    }
  ) => loadEquitiesTapeHistoryPage({ cursor, scope, filters, options })
});
