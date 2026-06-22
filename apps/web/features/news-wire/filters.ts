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
    if (symbolSet.size > 0 && !story.resolved_symbols.some((symbol) => symbolSet.has(normalize(symbol)))) {
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
