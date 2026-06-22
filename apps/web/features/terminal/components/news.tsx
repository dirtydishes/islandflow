"use client";

import type { NewsStory } from "@islandflow/types";
import { getSubscriptionKey as getLiveSubscriptionKey } from "@islandflow/types";
import Link from "next/link";
import { memo, useMemo } from "react";

import { formatNewsSymbolsLabel, getNewsWireStatus } from "../../news-wire/format";
import { getTapeVirtualConfig } from "../config";
import { decodeNewsText, formatNewsTimestamp, statusLabel } from "../format";
import type { TerminalState } from "../state";
import { useTapeVirtualList, useVirtualHistoryGate } from "../scroll";
import { Pane, TapeControls, TapeStatus } from "./primitives";
import { formatFlowMetric, formatTime } from "./ui-helpers";

type NewsPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

export { formatNewsSymbolsLabel, getNewsWireStatus };

export const openNewsStory = (state: TerminalState, story: NewsStory): void => {
  state.setSelectedNewsStory(null);
  state.setSelectedAlert(null);
  state.setSelectedClassifierHit(null);
  state.setSelectedSmartFlowProjection(null);
  state.setSelectedSmartMoneyEvent(null);
  state.setSelectedDarkEvent(null);
  state.setSelectedNewsStory(story);
};

export const NewsPane = memo(({ state, limit, className }: NewsPaneProps) => {
  const items = limit ? state.filteredNews.slice(0, limit) : state.filteredNews;
  const virtual = useTapeVirtualList(items, state.newsScroll.listRef, getTapeVirtualConfig("news"));
  const newsHistorySubscription = state.liveSession.manifest.find(
    (subscription) => subscription.channel === "news"
  );
  const newsHistoryKey = newsHistorySubscription
    ? getLiveSubscriptionKey(newsHistorySubscription)
    : null;
  const newsHistoryLoading = newsHistoryKey
    ? Boolean(state.liveSession.historyLoading[newsHistoryKey])
    : false;
  const newsHistoryError = newsHistoryKey ? state.liveSession.historyErrors[newsHistoryKey] : null;
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("news")
  );

  return (
    <Pane
      className={className}
      title="News Wire"
      status={
        <TapeStatus
          status={state.news.status}
          lastUpdate={state.news.lastUpdate}
          replayTime={state.news.replayTime}
          replayComplete={state.news.replayComplete}
          paused={state.news.paused}
          dropped={state.news.dropped}
          mode={state.mode}
        />
      }
      actions={
        limit ? (
          <Link className="terminal-button terminal-link-button" href="/news">
            View all
          </Link>
        ) : (
          <TapeControls
            mode={state.mode}
            paused={state.news.paused}
            onTogglePause={state.news.togglePause}
            isAtTop={state.newsScroll.isAtTop}
            missed={state.newsScroll.missed}
            onJump={state.newsScroll.jumpToTop}
          />
        )
      }
    >
      <div className="data-table-shell news-wire-shell">
        {state.mode === "live" && newsHistoryError ? (
          <div className="history-load-warning" role="status">
            Older news history failed to load: {newsHistoryError}
          </div>
        ) : null}
        {state.mode === "live" && newsHistoryLoading ? (
          <div className="history-load-warning history-load-muted" role="status">
            Loading older wire history.
          </div>
        ) : null}
        {state.mode === "replay" ? (
          <div className="empty">News is live only in v1.</div>
        ) : items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No news stories match the current filter."
              : "Waiting for live news stories."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-news" role="table" aria-label="News wire">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">SOURCE</span>
                <span className="data-table-cell">SYMBOLS</span>
                <span className="data-table-cell">STATE</span>
                <span className="data-table-cell">HEADLINE</span>
                <span className="data-table-cell">SUMMARY</span>
              </div>
              <div className="data-table-scroll" ref={state.newsScroll.setListRef}>
                <div
                  className="data-table-body"
                  style={{ height: `${virtual.totalSize}px` }}
                  aria-hidden={virtual.virtualItems.length === 0}
                >
                  {virtual.virtualItems.map(({ item: story, key, index, start, size }) => {
                    const wireStatus = getNewsWireStatus(story);
                    const headline = decodeNewsText(story.headline);
                    const summary = decodeNewsText(story.summary || story.provider);
                    return (
                      <button
                        className={`data-table-row data-table-row-button data-table-row-news data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} news-wire-row-${wireStatus}`}
                        key={key}
                        type="button"
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                        onClick={() => openNewsStory(state, story)}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatNewsTimestamp(story.published_ts)}
                        </span>
                        <span className="data-table-cell">{story.source}</span>
                        <span className="data-table-cell">{formatNewsSymbolsLabel(story)}</span>
                        <span className="data-table-cell">
                          <span className={`news-state news-state-${wireStatus}`}>
                            {wireStatus}
                          </span>
                        </span>
                        <span className="data-table-cell news-headline-cell">{headline}</span>
                        <span className="data-table-cell news-summary-cell">{summary}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
});

export const NewsControlRails = ({ state }: { state: TerminalState }) => {
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of state.filteredNews) {
      counts.set(story.source, (counts.get(story.source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [state.filteredNews]);
  const symbols = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of state.filteredNews) {
      for (const symbol of story.resolved_symbols) {
        const normalized = symbol.toUpperCase();
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [state.filteredNews]);
  const statusRows = [
    {
      label: "Wire",
      value:
        state.mode === "live"
          ? statusLabel(state.news.status, state.news.paused, state.mode)
          : "Live only",
      detail: state.news.lastUpdate ? formatTime(state.news.lastUpdate) : "waiting"
    },
    {
      label: "Stories",
      value: formatFlowMetric(state.filteredNews.length),
      detail: state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "all symbols"
    },
    {
      label: "History",
      value: state.mode === "live" ? "scroll gate" : "disabled",
      detail: state.newsScroll.isAtTop ? "at live head" : `${state.newsScroll.missed} queued`
    }
  ];

  return (
    <section className="wire-control-rails" aria-label="Wire control rails">
      <div className="wire-status-rail">
        {statusRows.map((row) => (
          <div className="wire-rail-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <em>{row.detail}</em>
          </div>
        ))}
      </div>
      <div className="wire-source-rail" aria-label="News sources">
        <span className="wire-rail-label">Sources</span>
        {sources.length === 0 ? (
          <span className="wire-empty-label">waiting</span>
        ) : (
          sources.map(([source, count]) => (
            <span className="wire-source-pill" key={source}>
              <strong>{source}</strong>
              <em>{count}</em>
            </span>
          ))
        )}
      </div>
      <div className="wire-symbol-rail" aria-label="News symbols">
        <span className="wire-rail-label">Symbols</span>
        {symbols.length === 0 ? (
          <span className="wire-empty-label">unmapped</span>
        ) : (
          symbols.map(([symbol, count]) => (
            <button key={symbol} type="button" onClick={() => state.setFilterInput(symbol)}>
              <strong>{symbol}</strong>
              <em>{count}</em>
            </button>
          ))
        )}
      </div>
    </section>
  );
};
