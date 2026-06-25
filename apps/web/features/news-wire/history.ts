import type { NewsStory } from "@islandflow/types";

import { buildBrowserApiUrl } from "../api-transport";
import type { DurableTapeCursor, DurableTapeHistoryPage } from "../durable-tape";
import { filterNewsStories, type NewsWireFilters } from "./filters";

export const NEWS_WIRE_HISTORY_ENDPOINT = "/history/news";
export const NEWS_WIRE_HISTORY_BATCH = 200;

type NewsWireHistoryResponse = {
  data?: NewsStory[];
  next_before?: DurableTapeCursor | null;
};

export type NewsWireHistoryFetcher = (url: string) => Promise<Response>;
export type NewsWireApiUrlBuilder = (path: string) => string;

export const buildNewsWireApiUrl: NewsWireApiUrlBuilder = (path) => {
  return buildBrowserApiUrl(path);
};

export const buildNewsWireHistoryUrl = ({
  cursor,
  limit = NEWS_WIRE_HISTORY_BATCH,
  buildApiUrl = buildNewsWireApiUrl
}: {
  cursor: DurableTapeCursor;
  limit?: number;
  buildApiUrl?: NewsWireApiUrlBuilder;
}): string => {
  const url = new URL(buildApiUrl(NEWS_WIRE_HISTORY_ENDPOINT));
  url.search = new URLSearchParams({
    before_ts: String(cursor.ts),
    before_seq: String(cursor.seq),
    limit: String(limit)
  }).toString();
  return url.toString();
};

const getCursorKey = (cursor: DurableTapeCursor): string => `${cursor.ts}:${cursor.seq}`;

const readHistoryError = async (response: Response): Promise<string> => {
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const text = await response.text();
  if (!text) {
    return statusLabel;
  }
  try {
    const payload = JSON.parse(text) as { detail?: string; error?: string; message?: string };
    return payload.detail ?? payload.error ?? payload.message ?? statusLabel;
  } catch {
    return `${statusLabel}: ${text.slice(0, 240)}`;
  }
};

export const fetchNewsWireHistoryPage = async ({
  cursor,
  filters,
  fetcher = fetch,
  buildApiUrl = buildNewsWireApiUrl,
  limit = NEWS_WIRE_HISTORY_BATCH
}: {
  cursor: DurableTapeCursor;
  filters?: NewsWireFilters;
  fetcher?: NewsWireHistoryFetcher;
  buildApiUrl?: NewsWireApiUrlBuilder;
  limit?: number;
}): Promise<DurableTapeHistoryPage<NewsStory>> => {
  let activeCursor: DurableTapeCursor | null = cursor;
  const seenCursors = new Set<string>([getCursorKey(cursor)]);

  while (activeCursor) {
    const response = await fetcher(
      buildNewsWireHistoryUrl({ cursor: activeCursor, limit, buildApiUrl })
    );
    if (!response.ok) {
      throw new Error(await readHistoryError(response));
    }

    const payload = (await response.json()) as NewsWireHistoryResponse;
    const items = filterNewsStories(payload.data ?? [], filters ?? {});
    const nextCursor = payload.next_before ?? null;
    if (items.length > 0 || nextCursor === null) {
      return {
        items,
        nextCursor,
        exhausted: nextCursor === null
      };
    }

    const nextCursorKey = getCursorKey(nextCursor);
    if (seenCursors.has(nextCursorKey)) {
      return { items: [], nextCursor: null, exhausted: true };
    }
    seenCursors.add(nextCursorKey);
    activeCursor = nextCursor;
  }

  return { items: [], nextCursor: null, exhausted: true };
};
