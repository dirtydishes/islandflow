"use client";

import type { NewsStory } from "@islandflow/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createDurableTapeInitialHistoryCursor,
  DurableTape,
  type DurableTapeCursor,
  type DurableTapeHistoryPage,
  type DurableTapeRowRenderer,
  type DurableTapeSource,
  type DurableTapeTemplateId
} from "../durable-tape";
import {
  filterNewsStories,
  getNewsWireFacets,
  getNewsWireFilterKey,
  hasActiveNewsWireFilters,
  matchesNewsWireScope,
  type NewsWireFilters,
  type NewsWireMappedFilter,
  orderNewsStoriesByScopeRelevance,
  summarizeNewsWireRelevance
} from "./filters";
import {
  decodeNewsText,
  formatNewsBodyText,
  formatNewsDateTime,
  formatNewsSymbolsLabel,
  formatNewsTimestamp,
  getNewsStoryCursor,
  getNewsStoryKey,
  getNewsWireStatus
} from "./format";
import {
  fetchNewsWireHistoryPage,
  type NewsWireApiUrlBuilder,
  type NewsWireHistoryFetcher
} from "./history";
import { NEWS_WIRE_COLUMNS, NEWS_WIRE_TEMPLATES } from "./templates";

export type NewsWireConnectionStatus = "connecting" | "connected" | "disconnected" | "stale";
export type NewsWireScopeMode = "filter" | "promote";

export type NewsWireProps = {
  stories: readonly NewsStory[];
  title?: string;
  className?: string;
  liveEnabled?: boolean;
  status?: NewsWireConnectionStatus;
  lastUpdate?: number | null;
  scopeSymbols?: readonly string[];
  scopeMode?: NewsWireScopeMode;
  showControlRails?: boolean;
  template?: DurableTapeTemplateId | "auto";
  historyEnabled?: boolean;
  detailMode?: "inline" | "external";
  fetcher?: NewsWireHistoryFetcher;
  buildApiUrl?: NewsWireApiUrlBuilder;
  onStorySelect?: (story: NewsStory) => void;
};

type LocalFilterState = {
  sources: string[];
  symbols: string[];
  mapped: NewsWireMappedFilter;
  updatedOnly: boolean;
};

type NewsWireHistoryState = {
  loading: boolean;
  error: string | null;
};

const EMPTY_FILTERS: LocalFilterState = {
  sources: [],
  symbols: [],
  mapped: "all",
  updatedOnly: false
};

const formatConnectionLabel = (status: NewsWireConnectionStatus | undefined): string => {
  switch (status) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    case "stale":
      return "stale";
    case "disconnected":
      return "offline";
    default:
      return "waiting";
  }
};

const formatCompactCount = (value: number): string => {
  if (value < 1_000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
};

const formatScopeLabel = (scopeSymbols: readonly string[] | undefined): string =>
  scopeSymbols && scopeSymbols.length > 0 ? scopeSymbols.join(", ") : "all symbols";

const toggleValue = (values: readonly string[], value: string): string[] => {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
};

const toWireFilters = (
  localFilters: LocalFilterState,
  scopeSymbols: readonly string[] | undefined
): NewsWireFilters => ({
  scopeSymbols,
  sources: localFilters.sources,
  symbols: localFilters.symbols,
  mapped: localFilters.mapped,
  updatedOnly: localFilters.updatedOnly
});

const useArrayNewsWireSource = ({
  stories,
  filters,
  historyEnabled,
  fetcher,
  buildApiUrl,
  orderStories,
  onHistoryState
}: {
  stories: readonly NewsStory[];
  filters: NewsWireFilters;
  historyEnabled: boolean;
  fetcher?: NewsWireHistoryFetcher;
  buildApiUrl?: NewsWireApiUrlBuilder;
  orderStories?: (stories: readonly NewsStory[]) => NewsStory[];
  onHistoryState: (state: NewsWireHistoryState) => void;
}): DurableTapeSource<NewsStory, undefined, string> => {
  const storiesRef = useRef<readonly NewsStory[]>(stories);
  const filtersRef = useRef<NewsWireFilters>(filters);
  const listenersRef = useRef(new Set<(items: readonly NewsStory[]) => void>());
  const historyEnabledRef = useRef(historyEnabled);
  const fetcherRef = useRef(fetcher);
  const buildApiUrlRef = useRef(buildApiUrl);
  const orderStoriesRef = useRef(orderStories);
  const historyStateRef = useRef(onHistoryState);

  useEffect(() => {
    storiesRef.current = stories;
    for (const listener of listenersRef.current) {
      listener(stories);
    }
  }, [stories]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    historyEnabledRef.current = historyEnabled;
  }, [historyEnabled]);

  useEffect(() => {
    fetcherRef.current = fetcher;
    buildApiUrlRef.current = buildApiUrl;
    orderStoriesRef.current = orderStories;
    historyStateRef.current = onHistoryState;
  }, [buildApiUrl, fetcher, orderStories, onHistoryState]);

  return useMemo(
    () => ({
      subscribe: () => ({
        getSnapshot: () => storiesRef.current,
        listen: (listener) => {
          listenersRef.current.add(listener);
          return () => listenersRef.current.delete(listener);
        },
        unsubscribe: () => {}
      }),
      getInitialHistoryCursor: () =>
        historyEnabledRef.current ? createDurableTapeInitialHistoryCursor() : null,
      loadOlder: async (cursor: DurableTapeCursor): Promise<DurableTapeHistoryPage<NewsStory>> => {
        if (!historyEnabledRef.current) {
          return { items: [], nextCursor: null, exhausted: true };
        }

        historyStateRef.current({ loading: true, error: null });
        try {
          const page = await fetchNewsWireHistoryPage({
            cursor,
            filters: filtersRef.current,
            fetcher: fetcherRef.current,
            buildApiUrl: buildApiUrlRef.current
          });
          const orderPageStories = orderStoriesRef.current;
          historyStateRef.current({ loading: false, error: null });
          return {
            ...page,
            items: orderPageStories ? orderPageStories(page.items) : page.items
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          historyStateRef.current({ loading: false, error: message });
          return { items: [], nextCursor: null, exhausted: true };
        }
      }
    }),
    []
  );
};

const NewsWireControls = ({
  stories,
  filters,
  status,
  lastUpdate,
  historyState,
  scopeSymbols,
  scopeMode,
  onToggleSource,
  onToggleSymbol,
  onMappedChange,
  onToggleUpdatedOnly,
  onReset
}: {
  stories: readonly NewsStory[];
  filters: LocalFilterState;
  status?: NewsWireConnectionStatus;
  lastUpdate?: number | null;
  historyState: NewsWireHistoryState;
  scopeSymbols?: readonly string[];
  scopeMode: NewsWireScopeMode;
  onToggleSource: (source: string) => void;
  onToggleSymbol: (symbol: string) => void;
  onMappedChange: (mapped: NewsWireMappedFilter) => void;
  onToggleUpdatedOnly: () => void;
  onReset: () => void;
}) => {
  const controlScopeSymbols = scopeMode === "filter" ? scopeSymbols : undefined;
  const scopedStories = useMemo(
    () => stories.filter((story) => matchesNewsWireScope(story, controlScopeSymbols)),
    [controlScopeSymbols, stories]
  );
  const facets = useMemo(() => getNewsWireFacets(scopedStories), [scopedStories]);
  const active = hasActiveNewsWireFilters(toWireFilters(filters, controlScopeSymbols));
  const scopeLabel =
    scopeMode === "promote" && scopeSymbols && scopeSymbols.length > 0
      ? `focus ${formatScopeLabel(scopeSymbols)} + market`
      : formatScopeLabel(controlScopeSymbols);

  return (
    <section className="news-wire-control-rails" aria-label="News wire controls">
      <div className="news-wire-status-rail">
        <div className="news-wire-rail-row">
          <span>Wire</span>
          <strong>{formatConnectionLabel(status)}</strong>
          <em>{lastUpdate ? formatNewsTimestamp(lastUpdate) : "waiting"}</em>
        </div>
        <div className="news-wire-rail-row">
          <span>Stories</span>
          <strong>{formatCompactCount(scopedStories.length)}</strong>
          <em>{scopeLabel}</em>
        </div>
        <div className="news-wire-rail-row">
          <span>History</span>
          <strong>{historyState.loading ? "loading" : "scroll gate"}</strong>
          <em>{historyState.error ? "needs attention" : "live only"}</em>
        </div>
      </div>

      <div className="news-wire-filter-rail" aria-label="News source filters">
        <span className="news-wire-rail-label">Sources</span>
        {facets.sources.length === 0 ? (
          <span className="news-wire-empty-label">waiting</span>
        ) : (
          facets.sources.slice(0, 8).map((source) => (
            <button
              className={filters.sources.includes(source.value) ? "is-active" : ""}
              key={source.value}
              type="button"
              onClick={() => onToggleSource(source.value)}
            >
              <strong>{source.value}</strong>
              <em>{source.count}</em>
            </button>
          ))
        )}
      </div>

      <div className="news-wire-filter-rail" aria-label="News symbol filters">
        <span className="news-wire-rail-label">Symbols</span>
        {facets.symbols.length === 0 ? (
          <span className="news-wire-empty-label">unmapped</span>
        ) : (
          facets.symbols.slice(0, 10).map((symbol) => (
            <button
              className={filters.symbols.includes(symbol.value) ? "is-active" : ""}
              key={symbol.value}
              type="button"
              onClick={() => onToggleSymbol(symbol.value)}
            >
              <strong>{symbol.value}</strong>
              <em>{symbol.count}</em>
            </button>
          ))
        )}
      </div>

      <div className="news-wire-filter-rail news-wire-mode-rail" aria-label="News state filters">
        <span className="news-wire-rail-label">State</span>
        {(["all", "mapped", "unmapped"] as const).map((mapped) => (
          <button
            className={filters.mapped === mapped ? "is-active" : ""}
            key={mapped}
            type="button"
            onClick={() => onMappedChange(mapped)}
          >
            <strong>{mapped}</strong>
            <em>
              {mapped === "mapped"
                ? facets.mapped
                : mapped === "unmapped"
                  ? facets.unmapped
                  : scopedStories.length}
            </em>
          </button>
        ))}
        <button
          className={filters.updatedOnly ? "is-active" : ""}
          type="button"
          onClick={onToggleUpdatedOnly}
        >
          <strong>updated</strong>
          <em>{facets.updated}</em>
        </button>
        <button type="button" onClick={onReset} disabled={!active}>
          <strong>reset</strong>
          <em>{active ? "active" : "clear"}</em>
        </button>
      </div>
    </section>
  );
};

const NewsWireHover = ({ story }: { story: NewsStory }) => {
  const summary = decodeNewsText(story.summary || "");
  const status = getNewsWireStatus(story);
  return (
    <div className="news-wire-hover-content">
      <div className="news-wire-hover-head">
        <strong>{story.source}</strong>
        <span className={`news-wire-state news-wire-state-${status}`}>{status}</span>
      </div>
      {summary ? <p>{summary}</p> : <p>Provider summary unavailable.</p>}
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>{story.provider}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>
            {story.updated_ts > story.published_ts ? formatNewsDateTime(story.updated_ts) : "no"}
          </dd>
        </div>
        <div>
          <dt>Mapped</dt>
          <dd>{story.resolved_symbols.length > 0 ? story.resolved_symbols.join(", ") : "none"}</dd>
        </div>
      </dl>
    </div>
  );
};

const NewsWireDetail = ({ story, onClose }: { story: NewsStory; onClose: () => void }) => {
  const headline = decodeNewsText(story.headline);
  const summary = decodeNewsText(story.summary);
  const bodyText = formatNewsBodyText(story.content_html);
  const status = getNewsWireStatus(story);

  return (
    <aside className="news-wire-detail" aria-label="News story detail">
      <div className="news-wire-detail-header">
        <div>
          <p>News wire</p>
          <h3>{headline}</h3>
          <span>
            {story.source} | Published {formatNewsDateTime(story.published_ts)}
            {story.updated_ts !== story.published_ts
              ? ` | Updated ${formatNewsDateTime(story.updated_ts)}`
              : ""}
          </span>
        </div>
        <button className="terminal-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="news-wire-detail-meta">
        <span className={`news-wire-state news-wire-state-${status}`}>{status}</span>
        <span>{story.symbol_resolution}</span>
        <span>{story.provider}</span>
      </div>

      {summary ? (
        <section>
          <h4>Summary</h4>
          <p>{summary}</p>
        </section>
      ) : null}

      <section>
        <h4>Mapped symbols</h4>
        <p>{story.resolved_symbols.length > 0 ? story.resolved_symbols.join(", ") : "none"}</p>
      </section>

      <section>
        <h4>Provider symbols</h4>
        <p>{story.provider_symbols.length > 0 ? story.provider_symbols.join(", ") : "none"}</p>
      </section>

      <section>
        <h4>Story</h4>
        {bodyText ? (
          <p className="news-wire-detail-body">{bodyText}</p>
        ) : (
          <p>Story body unavailable.</p>
        )}
      </section>

      {story.url ? (
        <section>
          <h4>Source link</h4>
          <a
            className="terminal-button terminal-link-button"
            href={story.url}
            rel="noreferrer"
            target="_blank"
          >
            Open original article
          </a>
        </section>
      ) : null}
    </aside>
  );
};

export const NewsWire = ({
  stories,
  title = "News Wire",
  className = "",
  liveEnabled = true,
  status,
  lastUpdate,
  scopeSymbols,
  scopeMode = "filter",
  showControlRails = false,
  template = "auto",
  historyEnabled = true,
  detailMode = "inline",
  fetcher,
  buildApiUrl,
  onStorySelect
}: NewsWireProps) => {
  const [filters, setFilters] = useState<LocalFilterState>(EMPTY_FILTERS);
  const [selectedStory, setSelectedStory] = useState<NewsStory | null>(null);
  const [historyState, setHistoryState] = useState<NewsWireHistoryState>({
    loading: false,
    error: null
  });

  const promotedScopeActive = scopeMode === "promote" && (scopeSymbols?.length ?? 0) > 0;
  const wireScopeSymbols = scopeMode === "filter" ? scopeSymbols : undefined;
  const wireFilters = useMemo(
    () => toWireFilters(filters, wireScopeSymbols),
    [filters, wireScopeSymbols]
  );
  const filteredStories = useMemo(
    () => filterNewsStories(stories, wireFilters),
    [stories, wireFilters]
  );
  const orderedStories = useMemo(
    () =>
      scopeMode === "promote"
        ? orderNewsStoriesByScopeRelevance(filteredStories, scopeSymbols)
        : filteredStories,
    [filteredStories, scopeMode, scopeSymbols]
  );
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        filters: getNewsWireFilterKey(wireFilters),
        promotedScope: scopeMode === "promote" ? formatScopeLabel(scopeSymbols) : "",
        scopeMode
      }),
    [scopeMode, scopeSymbols, wireFilters]
  );
  const activeFilters = hasActiveNewsWireFilters(wireFilters);
  const relevanceSummary = useMemo(
    () => summarizeNewsWireRelevance(filteredStories, scopeSymbols),
    [filteredStories, scopeSymbols]
  );
  const focusedStoryKeys = useMemo(() => {
    if (!promotedScopeActive) {
      return new Set<string>();
    }
    return new Set(
      orderedStories
        .filter((story) => matchesNewsWireScope(story, scopeSymbols))
        .map((story) => getNewsStoryKey(story))
    );
  }, [orderedStories, promotedScopeActive, scopeSymbols]);
  const storySortRanks = useMemo(() => {
    if (!promotedScopeActive) {
      return new Map<string, number>();
    }
    return new Map(orderedStories.map((story, index) => [getNewsStoryKey(story), index]));
  }, [orderedStories, promotedScopeActive]);
  const getRelevanceSortCursor = useCallback(
    (story: NewsStory) => {
      const rank = storySortRanks.get(getNewsStoryKey(story));
      if (rank === undefined) {
        return getNewsStoryCursor(story);
      }
      const sortValue = Number.MAX_SAFE_INTEGER - rank;
      return { ts: sortValue, seq: sortValue };
    },
    [storySortRanks]
  );
  const focusLabel = promotedScopeActive ? `Focused ${formatScopeLabel(scopeSymbols)}` : "Focused";
  const orderHistoryStories = useCallback(
    (items: readonly NewsStory[]) => orderNewsStoriesByScopeRelevance(items, scopeSymbols),
    [scopeSymbols]
  );
  const source = useArrayNewsWireSource({
    stories: orderedStories,
    filters: wireFilters,
    historyEnabled: liveEnabled && historyEnabled,
    fetcher,
    buildApiUrl,
    orderStories: scopeMode === "promote" ? orderHistoryStories : undefined,
    onHistoryState: setHistoryState
  });

  const selectStory = useCallback(
    (story: NewsStory) => {
      if (detailMode === "inline") {
        setSelectedStory(story);
      }
      onStorySelect?.(story);
    },
    [detailMode, onStorySelect]
  );

  const renderRow = useCallback<DurableTapeRowRenderer<NewsStory>>(
    ({ item: story, columns }) => {
      const headline = decodeNewsText(story.headline);
      const sectionLabel = promotedScopeActive
        ? focusedStoryKeys.has(getNewsStoryKey(story))
          ? focusLabel
          : "Market wire"
        : null;
      const sectionClass = sectionLabel === focusLabel ? "focused" : "market";

      return columns.map((column) => {
        let content: ReactNode;
        if (column.id === "time") {
          content = formatNewsTimestamp(story.published_ts);
        } else if (column.id === "source") {
          content = story.source;
        } else if (column.id === "symbols") {
          content = formatNewsSymbolsLabel(story);
        } else {
          content = (
            <span className="news-wire-headline-stack">
              {sectionLabel ? (
                <span className={`news-wire-relevance-badge news-wire-relevance-${sectionClass}`}>
                  {sectionLabel}
                </span>
              ) : null}
              <span className="news-wire-headline-text">{headline}</span>
            </span>
          );
        }

        return (
          <span
            className={`durable-tape-cell ${column.className ?? ""}`.trim()}
            key={column.id}
            role="cell"
            title={typeof content === "string" ? content : headline}
          >
            {content}
          </span>
        );
      });
    },
    [focusLabel, focusedStoryKeys, promotedScopeActive]
  );

  const getRowClassName = useCallback(
    ({ item: story }: { item: NewsStory }) => {
      if (!promotedScopeActive) {
        return undefined;
      }
      return focusedStoryKeys.has(getNewsStoryKey(story))
        ? "news-wire-row-focused"
        : "news-wire-row-market";
    },
    [focusedStoryKeys, promotedScopeActive]
  );

  const emptyMessage = !liveEnabled
    ? "News is live only in v1."
    : activeFilters || (scopeMode === "filter" && scopeSymbols && scopeSymbols.length > 0)
      ? "No news stories match the current filter."
      : "Waiting for live news stories.";
  const showRelevanceStrip = liveEnabled && promotedScopeActive;
  const hasPrelude = showRelevanceStrip || Boolean(historyState.error);

  useEffect(() => {
    if (detailMode !== "inline" || !selectedStory) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedStory(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailMode, selectedStory]);

  return (
    <section className={`news-wire-module ${className}`.trim()}>
      {showControlRails ? (
        <NewsWireControls
          stories={stories}
          filters={filters}
          status={status}
          lastUpdate={lastUpdate}
          historyState={historyState}
          scopeSymbols={scopeSymbols}
          scopeMode={scopeMode}
          onToggleSource={(sourceValue) =>
            setFilters((current) => ({
              ...current,
              sources: toggleValue(current.sources, sourceValue)
            }))
          }
          onToggleSymbol={(symbol) =>
            setFilters((current) => ({
              ...current,
              symbols: toggleValue(current.symbols, symbol)
            }))
          }
          onMappedChange={(mapped) => setFilters((current) => ({ ...current, mapped }))}
          onToggleUpdatedOnly={() =>
            setFilters((current) => ({ ...current, updatedOnly: !current.updatedOnly }))
          }
          onReset={() => setFilters(EMPTY_FILTERS)}
        />
      ) : null}

      {hasPrelude ? (
        <div className="news-wire-prelude">
          {showRelevanceStrip ? (
            <section className="news-wire-relevance-strip" aria-label="News relevance sections">
              <span
                className={
                  relevanceSummary.focused > 0
                    ? "news-wire-relevance-chip news-wire-relevance-focused"
                    : "news-wire-relevance-chip news-wire-relevance-empty"
                }
              >
                <strong>{focusLabel}</strong>
                <em>{formatCompactCount(relevanceSummary.focused)} stories</em>
              </span>
              <span className="news-wire-relevance-chip news-wire-relevance-market">
                <strong>Market wire</strong>
                <em>{formatCompactCount(relevanceSummary.market)} stories</em>
              </span>
            </section>
          ) : null}

          {historyState.error ? (
            <div className="news-wire-history-warning" role="status">
              Older news history failed to load: {historyState.error}
            </div>
          ) : null}
        </div>
      ) : null}

      {!liveEnabled ? (
        <div className="news-wire-live-only" role="status">
          {emptyMessage}
        </div>
      ) : (
        <div className="news-wire-tape-frame">
          <DurableTape
            ariaLabel="News wire"
            className="news-wire-tape"
            columns={NEWS_WIRE_COLUMNS}
            features={[
              "default",
              { key: "settingsGear", enabled: false },
              { key: "template", value: template }
            ]}
            filters={filterKey}
            getCursor={getNewsStoryCursor}
            getRowKey={getNewsStoryKey}
            getSortCursor={promotedScopeActive ? getRelevanceSortCursor : undefined}
            getRowClassName={getRowClassName}
            onActivate={({ item }) => selectStory(item)}
            renderHover={({ item }) => <NewsWireHover story={item} />}
            renderRow={renderRow}
            rowHeight={52}
            overscan={28}
            source={source}
            template={template}
            templates={NEWS_WIRE_TEMPLATES}
            title={title}
          />
          {orderedStories.length === 0 ? (
            <div className="news-wire-empty" role="status">
              {emptyMessage}
            </div>
          ) : null}
        </div>
      )}

      {detailMode === "inline" && selectedStory ? (
        <NewsWireDetail story={selectedStory} onClose={() => setSelectedStory(null)} />
      ) : null}
    </section>
  );
};
