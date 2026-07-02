"use client";

import type { MarketCommandTickerRailItem } from "@islandflow/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminalState } from "../terminal/state";
import { DEFAULT_MARKET_COMMAND_WATCHLIST } from "./local-ranking-fallback";
import { useMarketCommandTickerRail } from "./useMarketCommandTickerRail";

type MarketCommandTickerRailProps = {
  state: TerminalState;
  watchlist?: readonly string[];
  limit?: number;
};

type TickerGroup = {
  id: "pinned" | "important";
  label: string;
  items: MarketCommandTickerRailItem[];
};

const formatPrice = (value: number | null): string => {
  if (value === null) {
    return "--";
  }
  if (value >= 1_000) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(value >= 100 ? 2 : 3)}`;
};

const formatChange = (item: MarketCommandTickerRailItem): string => {
  if (item.change_pct === null) {
    return "Move n/a";
  }
  const prefix = item.change_pct > 0 ? "+" : "";
  return `${prefix}${item.change_pct.toFixed(2)}%`;
};

const getDirection = (item: MarketCommandTickerRailItem): "up" | "down" | "flat" => {
  if (item.change_pct === null || item.change_pct === 0) {
    return "flat";
  }
  return item.change_pct > 0 ? "up" : "down";
};

const sourceLabel = (source: MarketCommandTickerRailItem["source"]): string => {
  if (source === "both") {
    return "Pinned + important";
  }
  return source === "pinned" ? "Pinned" : "Important";
};

const topReasonLabel = (item: MarketCommandTickerRailItem): string =>
  item.reasons[0]?.label ?? sourceLabel(item.source);

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
};

export const MarketCommandTickerRail = ({
  state,
  watchlist = DEFAULT_MARKET_COMMAND_WATCHLIST,
  limit
}: MarketCommandTickerRailProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const mobileViewport = useMediaQuery("(max-width: 700px)");
  const activeSymbols = useMemo(() => new Set(state.activeTickers), [state.activeTickers]);
  const localRanking = useMemo(
    () => ({
      optionPrints: state.options.items,
      equityPrints: state.equities.items,
      flowPackets: state.flow.items,
      alerts: state.alerts.items,
      smartFlowProjections: state.smartFlow.items,
      newsStories: state.news.items
    }),
    [
      state.alerts.items,
      state.equities.items,
      state.flow.items,
      state.news.items,
      state.options.items,
      state.smartFlow.items
    ]
  );
  const rail = useMarketCommandTickerRail({ watchlist, limit, localRanking });
  const groups: TickerGroup[] = useMemo(
    () => [
      { id: "pinned", label: "Pinned", items: rail.response.pinned },
      { id: "important", label: "Important now", items: rail.response.important }
    ],
    [rail.response.important, rail.response.pinned]
  );
  const autoLoop = overflows && !reducedMotion && !mobileViewport;
  const railStateLabel = rail.isLocalFallback
    ? "Local fallback"
    : rail.source === "server-degraded"
      ? "Server degraded"
      : "Server ranked";

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) {
      return;
    }

    const update = () => {
      setOverflows(track.scrollWidth > viewport.clientWidth + 4);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(track);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [groups]);

  const renderItem = (
    item: MarketCommandTickerRailItem,
    groupId: TickerGroup["id"],
    duplicate = false
  ) => {
    const direction = getDirection(item);
    const active = activeSymbols.has(item.symbol);
    return (
      <button
        aria-hidden={duplicate ? true : undefined}
        aria-label={`Focus ${item.symbol} on board, ${topReasonLabel(item)}`}
        aria-pressed={duplicate ? undefined : active}
        className={`command-ticker-card is-${direction}${active ? " is-active" : ""}`}
        key={`${groupId}-${item.symbol}-${duplicate ? "loop" : "primary"}`}
        onClick={() => state.focusTickerSymbol(item.symbol, "ticker-rail")}
        tabIndex={duplicate ? -1 : undefined}
        type="button"
      >
        <span className="command-ticker-symbol">{item.symbol}</span>
        <span className="command-ticker-price">{formatPrice(item.price)}</span>
        <span className="command-ticker-move">{formatChange(item)}</span>
        <span className="command-ticker-meta">
          {sourceLabel(item.source)} · {topReasonLabel(item)}
        </span>
      </button>
    );
  };

  const renderGroup = (group: TickerGroup, duplicate = false) => (
    <div
      aria-hidden={duplicate ? true : undefined}
      aria-label={duplicate ? undefined : group.label}
      className="command-ticker-group"
      key={`${group.id}-${duplicate ? "loop" : "primary"}`}
      role={duplicate ? undefined : "group"}
    >
      <span className="command-ticker-group-label">{group.label}</span>
      {group.items.length > 0 ? (
        group.items.map((item) => renderItem(item, group.id, duplicate))
      ) : (
        <span className="command-ticker-empty">No symbols</span>
      )}
    </div>
  );

  return (
    <section
      aria-label="Ticker focus rail"
      className={`command-ticker-rail${autoLoop ? " is-looping" : ""}`}
      data-local-fallback={rail.isLocalFallback ? "true" : undefined}
    >
      <div className="command-ticker-rail-head">
        <div className="command-ticker-rail-title">
          <span>Focus rail</span>
          <strong>
            {state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "Market"}
          </strong>
        </div>
        <div className="command-ticker-rail-actions">
          <span className={`command-ticker-source is-${rail.source}`}>{railStateLabel}</span>
          {rail.error ? <span className="command-ticker-error">{rail.error}</span> : null}
          {state.activeTickers.length > 0 || state.selectedInstrument ? (
            <button className="terminal-button" type="button" onClick={state.clearBoardFocus}>
              Clear board
            </button>
          ) : null}
          <button
            className="terminal-button"
            disabled={rail.isLoading}
            onClick={() => void rail.refresh()}
            type="button"
          >
            {rail.isLoading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="command-ticker-viewport" ref={viewportRef}>
        <div className="command-ticker-track" ref={trackRef}>
          {groups.map((group) => renderGroup(group))}
          {autoLoop ? groups.map((group) => renderGroup(group, true)) : null}
        </div>
      </div>
    </section>
  );
};
