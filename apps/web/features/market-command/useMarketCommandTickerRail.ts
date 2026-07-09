"use client";

import {
  type MarketCommandTickerRailResponse,
  MarketCommandTickerRailResponseSchema
} from "@islandflow/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildApiUrl, readErrorDetail } from "../terminal/transport";
import {
  buildLocalMarketCommandTickerRail,
  DEFAULT_MARKET_COMMAND_WATCHLIST,
  MARKET_COMMAND_TICKER_RAIL_LIMIT,
  type MarketCommandLocalRankingInput,
  normalizeMarketCommandWatchlist
} from "./local-ranking-fallback";

export const MARKET_COMMAND_TICKER_RAIL_POLL_MS = 30_000;

export type MarketCommandTickerRailSource = "server" | "server-degraded" | "local-fallback";

export type UseMarketCommandTickerRailInput = {
  watchlist?: readonly string[];
  limit?: number;
  pollMs?: number;
  localRanking?: Omit<MarketCommandLocalRankingInput, "watchlist" | "limit">;
};

export type UseMarketCommandTickerRailResult = {
  response: MarketCommandTickerRailResponse;
  source: MarketCommandTickerRailSource;
  isLoading: boolean;
  isLocalFallback: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  nextRefreshAt: number | null;
  refresh: () => Promise<void>;
};

const buildTickerRailUrl = (watchlist: readonly string[], limit: number): string => {
  const url = new URL(buildApiUrl("/market-command/tickers"));
  url.searchParams.set("watchlist", watchlist.join(","));
  url.searchParams.set("limit", String(limit));
  return url.toString();
};

export const useMarketCommandTickerRail = ({
  watchlist = DEFAULT_MARKET_COMMAND_WATCHLIST,
  limit = MARKET_COMMAND_TICKER_RAIL_LIMIT,
  pollMs = MARKET_COMMAND_TICKER_RAIL_POLL_MS,
  localRanking
}: UseMarketCommandTickerRailInput = {}): UseMarketCommandTickerRailResult => {
  const normalizedWatchlist = useMemo(
    () => normalizeMarketCommandWatchlist(watchlist),
    [watchlist]
  );
  const cappedLimit = Math.max(1, Math.min(32, Math.floor(limit)));
  const [serverResponse, setServerResponse] = useState<MarketCommandTickerRailResponse | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const requestSeqRef = useRef(0);

  const fallbackResponse = useMemo(
    () =>
      buildLocalMarketCommandTickerRail({
        ...localRanking,
        watchlist: normalizedWatchlist,
        limit: cappedLimit
      }),
    [cappedLimit, localRanking, normalizedWatchlist]
  );

  const endpoint = useMemo(
    () => buildTickerRailUrl(normalizedWatchlist, cappedLimit),
    [cappedLimit, normalizedWatchlist]
  );

  const refresh = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setIsLoading(true);
    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(await readErrorDetail(response));
      }
      const parsed = MarketCommandTickerRailResponseSchema.parse(await response.json());
      if (requestSeqRef.current !== requestSeq) {
        return;
      }
      setServerResponse(parsed);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (caught) {
      if (requestSeqRef.current !== requestSeq) {
        return;
      }
      setServerResponse(null);
      setError(caught instanceof Error ? caught.message : "Ticker rail request failed");
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setIsLoading(false);
        setNextRefreshAt(Date.now() + pollMs);
      }
    }
  }, [endpoint, pollMs]);

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (!active) {
        return;
      }
      void refresh();
    };

    tick();
    const interval = window.setInterval(tick, pollMs);
    return () => {
      active = false;
      window.clearInterval(interval);
      requestSeqRef.current += 1;
    };
  }, [pollMs, refresh]);

  const response = serverResponse ?? fallbackResponse;
  const source: MarketCommandTickerRailSource = serverResponse
    ? serverResponse.degraded
      ? "server-degraded"
      : "server"
    : "local-fallback";

  return {
    response,
    source,
    isLoading,
    isLocalFallback: source === "local-fallback",
    error,
    lastUpdatedAt,
    nextRefreshAt,
    refresh
  };
};
