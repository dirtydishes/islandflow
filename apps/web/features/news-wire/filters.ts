import type { NewsStory } from "@islandflow/types";

import { getNewsWireStatus } from "./format";

export type NewsWireMappedFilter = "all" | "mapped" | "unmapped";

export type NewsWireFilters = {
  scopeSymbols?: readonly string[];
  sources?: readonly string[];
  symbols?: readonly string[];
  mapped?: NewsWireMappedFilter;
  updatedOnly?: boolean;
};

export type NewsWireRelevanceSummary = {
  focused: number;
  market: number;
};

export type NewsWireRelevanceCursor = {
  ts: number;
  seq: number;
};

export type NewsWireFacet = {
  value: string;
  count: number;
};

export type NewsWireFacets = {
  sources: NewsWireFacet[];
  symbols: NewsWireFacet[];
  updated: number;
  mapped: number;
  unmapped: number;
};

const normalize = (value: string): string => value.trim().toUpperCase();

const NEWS_WIRE_FOCUS_SORT_BOOST_MS = 1_000_000_000_000_000;

const toSet = (values: readonly string[] | undefined): Set<string> =>
  new Set((values ?? []).map(normalize).filter(Boolean));

const hasActiveSet = (values: readonly string[] | undefined): boolean => toSet(values).size > 0;

export const hasActiveNewsWireFilters = (filters: NewsWireFilters): boolean => {
  return (
    hasActiveSet(filters.sources) ||
    hasActiveSet(filters.symbols) ||
    (filters.mapped ?? "all") !== "all" ||
    filters.updatedOnly === true
  );
};

export const matchesNewsWireScope = (
  story: NewsStory,
  scopeSymbols: readonly string[] | undefined
): boolean => {
  const scope = toSet(scopeSymbols);
  if (scope.size === 0) {
    return true;
  }
  return story.resolved_symbols.some((symbol) => scope.has(normalize(symbol)));
};

export const isNewsStoryFocusedForScope = (
  story: NewsStory,
  scopeSymbols: readonly string[] | undefined
): boolean => hasActiveSet(scopeSymbols) && matchesNewsWireScope(story, scopeSymbols);

export const summarizeNewsWireRelevance = (
  stories: readonly NewsStory[],
  scopeSymbols: readonly string[] | undefined
): NewsWireRelevanceSummary => {
  if (!hasActiveSet(scopeSymbols)) {
    return { focused: 0, market: stories.length };
  }

  let focused = 0;
  for (const story of stories) {
    if (isNewsStoryFocusedForScope(story, scopeSymbols)) {
      focused += 1;
    }
  }

  return {
    focused,
    market: stories.length - focused
  };
};

export const orderNewsStoriesByScopeRelevance = (
  stories: readonly NewsStory[],
  scopeSymbols: readonly string[] | undefined
): NewsStory[] => {
  if (!hasActiveSet(scopeSymbols)) {
    return [...stories];
  }

  const focused: NewsStory[] = [];
  const market: NewsStory[] = [];
  for (const story of stories) {
    if (isNewsStoryFocusedForScope(story, scopeSymbols)) {
      focused.push(story);
    } else {
      market.push(story);
    }
  }

  return [...focused, ...market];
};

export const getNewsWireRelevanceSortCursor = <TStory extends NewsStory>(
  story: TStory,
  scopeSymbols: readonly string[] | undefined,
  getCursor: (story: TStory) => NewsWireRelevanceCursor
): NewsWireRelevanceCursor => {
  const cursor = getCursor(story);
  if (!isNewsStoryFocusedForScope(story, scopeSymbols)) {
    return cursor;
  }

  return {
    ts: Math.min(Number.MAX_SAFE_INTEGER, cursor.ts + NEWS_WIRE_FOCUS_SORT_BOOST_MS),
    seq: cursor.seq
  };
};

export const filterNewsStories = (
  stories: readonly NewsStory[],
  filters: NewsWireFilters = {}
): NewsStory[] => {
  const sourceSet = new Set((filters.sources ?? []).map((source) => source.trim()).filter(Boolean));
  const symbolSet = toSet(filters.symbols);
  const mapped = filters.mapped ?? "all";

  return stories.filter((story) => {
    if (!matchesNewsWireScope(story, filters.scopeSymbols)) {
      return false;
    }
    if (sourceSet.size > 0 && !sourceSet.has(story.source)) {
      return false;
    }
    if (
      symbolSet.size > 0 &&
      !story.resolved_symbols.some((symbol) => symbolSet.has(normalize(symbol)))
    ) {
      return false;
    }
    if (mapped === "mapped" && story.resolved_symbols.length === 0) {
      return false;
    }
    if (mapped === "unmapped" && story.resolved_symbols.length > 0) {
      return false;
    }
    if (filters.updatedOnly && getNewsWireStatus(story) !== "updated") {
      return false;
    }
    return true;
  });
};

const countValues = (values: Iterable<string>): NewsWireFacet[] => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

export const getNewsWireFacets = (stories: readonly NewsStory[]): NewsWireFacets => {
  let updated = 0;
  let mapped = 0;
  let unmapped = 0;
  const symbols: string[] = [];

  for (const story of stories) {
    const status = getNewsWireStatus(story);
    if (status === "updated") {
      updated += 1;
    }
    if (story.resolved_symbols.length > 0) {
      mapped += 1;
      symbols.push(...story.resolved_symbols.map(normalize));
    } else {
      unmapped += 1;
    }
  }

  return {
    sources: countValues(stories.map((story) => story.source)),
    symbols: countValues(symbols),
    updated,
    mapped,
    unmapped
  };
};

export const getNewsWireFilterKey = (filters: NewsWireFilters): string => {
  const serialize = (values: readonly string[] | undefined) =>
    [...toSet(values)].sort((a, b) => a.localeCompare(b)).join(",");
  return JSON.stringify({
    scope: serialize(filters.scopeSymbols),
    sources: [...(filters.sources ?? [])].sort((a, b) => a.localeCompare(b)).join(","),
    symbols: serialize(filters.symbols),
    mapped: filters.mapped ?? "all",
    updatedOnly: filters.updatedOnly === true
  });
};
