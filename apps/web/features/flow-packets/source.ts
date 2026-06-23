import {
  type FlowPacket,
  FlowPacketSchema,
  getSubscriptionKey as getLiveSubscriptionKey,
  type LiveServerMessage,
  type LiveSubscription,
  parseLivePayload
} from "@islandflow/types";

import { mergeNewest, type DurableTapeCursor } from "../durable-tape";
import { filterFlowPackets, getFlowPacketCursor, getFlowPacketKey } from "./format";
import type {
  FlowPacketsTapeFilters,
  FlowPacketsTapeHistoryResponse,
  FlowPacketsTapeSourceOptions,
  NormalizedFlowPacketsTapeScope
} from "./types";

const DEFAULT_HISTORY_PAGE_SIZE = 200;
const DEFAULT_SNAPSHOT_LIMIT = 200;
const DEFAULT_MAX_FILTERED_HISTORY_PAGES = 6;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const getEnvApiBase = (): string | undefined => process.env.NEXT_PUBLIC_API_URL;

export const buildFlowPacketsTapeApiUrl = (path: string, apiBaseUrl?: string): string => {
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

export const buildFlowPacketsTapeWsUrl = (path: string, wsBaseUrl?: string): string => {
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

const parseFlowPackets = (items: unknown[]): FlowPacket[] => FlowPacketSchema.array().parse(items);

const appendFlowFilterParams = (
  params: URLSearchParams,
  filters: FlowPacketsTapeFilters | undefined
): void => {
  if (!filters) {
    return;
  }
  if (filters.view) {
    params.set("view", filters.view);
  }
  if (filters.securityTypes?.length) {
    params.set("security", filters.securityTypes.length === 1 ? filters.securityTypes[0] : "all");
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

const parseHistoryResponse = async (
  response: Response
): Promise<FlowPacketsTapeHistoryResponse> => {
  const payload = (await response.json()) as FlowPacketsTapeHistoryResponse;
  return {
    data: parseFlowPackets(payload.data ?? []),
    next_before: payload.next_before ?? null
  };
};

const isSameCursor = (left: DurableTapeCursor, right: DurableTapeCursor): boolean =>
  left.ts === right.ts && left.seq === right.seq;

export const loadFlowPacketsTapeHistoryPage = async ({
  cursor,
  scope,
  filters,
  options
}: {
  cursor: DurableTapeCursor;
  scope?: NormalizedFlowPacketsTapeScope;
  filters?: FlowPacketsTapeFilters;
  options?: FlowPacketsTapeSourceOptions;
}) => {
  const fetcher = options?.fetcher ?? fetch;
  const limit = options?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  const maxPages = options?.maxFilteredHistoryPages ?? DEFAULT_MAX_FILTERED_HISTORY_PAGES;
  let nextCursor: DurableTapeCursor | null = cursor;

  for (let page = 0; page < maxPages && nextCursor; page += 1) {
    const url = new URL(buildFlowPacketsTapeApiUrl("/history/flow", options?.apiBaseUrl));
    url.searchParams.set("before_ts", String(nextCursor.ts));
    url.searchParams.set("before_seq", String(nextCursor.seq));
    url.searchParams.set("limit", String(limit));
    appendFlowFilterParams(url.searchParams, filters);

    const response = await fetcher(url.toString());
    if (!response.ok) {
      throw new Error(`Flow packet history failed with HTTP ${response.status}`);
    }

    const payload = await parseHistoryResponse(response);
    const filtered = filterFlowPackets(payload.data ?? [], scope, filters);
    const responseCursor = payload.next_before ?? null;
    const cursorStalled = responseCursor ? isSameCursor(responseCursor, nextCursor) : false;
    if (filtered.length > 0 || !responseCursor || cursorStalled) {
      return {
        items: filtered,
        nextCursor: cursorStalled ? null : responseCursor,
        exhausted: !responseCursor || cursorStalled
      };
    }
    nextCursor = responseCursor;
  }

  return {
    items: [],
    nextCursor,
    exhausted: !nextCursor
  };
};

export const createFlowPacketsTapeSource = (options: FlowPacketsTapeSourceOptions = {}) => ({
  subscribe: ({
    scope,
    filters
  }: {
    scope?: NormalizedFlowPacketsTapeScope;
    filters?: FlowPacketsTapeFilters;
  }) => {
    const listeners = new Set<(items: readonly FlowPacket[]) => void>();
    const accessors = {
      getKey: getFlowPacketKey,
      getCursor: getFlowPacketCursor
    };
    const snapshotLimit = options.snapshotLimit ?? DEFAULT_SNAPSHOT_LIMIT;
    const subscription: LiveSubscription = {
      channel: "flow",
      filters,
      snapshot_limit: snapshotLimit
    };
    const subscriptionKey = getLiveSubscriptionKey(subscription);
    let items: FlowPacket[] = [];
    let socket: WebSocket | null = null;
    let closed = false;

    const publish = () => {
      const filtered = filterFlowPackets(items, scope, filters);
      for (const listener of listeners) {
        listener(filtered);
      }
    };

    const replaceItems = (nextItems: readonly FlowPacket[]) => {
      items = filterFlowPackets([...nextItems], scope, filters).slice(0, snapshotLimit);
      publish();
    };

    const mergeItems = (nextItems: readonly FlowPacket[]) => {
      items = mergeNewest(
        filterFlowPackets([...nextItems], scope, filters),
        items,
        snapshotLimit,
        undefined,
        accessors
      );
      publish();
    };

    if (options.live !== false && typeof WebSocket !== "undefined") {
      socket = (options.createWebSocket ?? ((url: string) => new WebSocket(url)))(
        buildFlowPacketsTapeWsUrl("/ws/live", options.wsBaseUrl)
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
            message.snapshot.subscription.channel === "flow" &&
            getLiveSubscriptionKey(message.snapshot.subscription) === subscriptionKey
          ) {
            replaceItems(parseFlowPackets(message.snapshot.items));
          }
          return;
        }
        if (
          message.op === "event" &&
          message.subscription.channel === "flow" &&
          getLiveSubscriptionKey(message.subscription) === subscriptionKey
        ) {
          mergeItems([parseLivePayload("flow", message.item) as FlowPacket]);
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
    }

    return {
      getSnapshot: () => filterFlowPackets(items, scope, filters),
      listen: (listener: (items: readonly FlowPacket[]) => void) => {
        listeners.add(listener);
        listener(filterFlowPackets(items, scope, filters));
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
  loadOlder: (
    cursor: DurableTapeCursor,
    {
      scope,
      filters
    }: {
      scope?: NormalizedFlowPacketsTapeScope;
      filters?: FlowPacketsTapeFilters;
    }
  ) => loadFlowPacketsTapeHistoryPage({ cursor, scope, filters, options })
});

export const createStaticFlowPacketsTapeSource = (packets: readonly FlowPacket[]) => ({
  subscribe: ({
    scope,
    filters
  }: {
    scope?: NormalizedFlowPacketsTapeScope;
    filters?: FlowPacketsTapeFilters;
  }) => ({
    getSnapshot: () => filterFlowPackets(packets, scope, filters),
    listen: (listener: (items: readonly FlowPacket[]) => void) => {
      listener(filterFlowPackets(packets, scope, filters));
      return () => {};
    },
    unsubscribe: () => {}
  }),
  loadOlder: async () => ({ items: [], nextCursor: null, exhausted: true })
});
