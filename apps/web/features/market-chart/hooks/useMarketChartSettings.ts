"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  normalizeMarketChartSettings,
  readMarketChartSettings,
  reduceMarketChartSettings,
  writeMarketChartSettings,
  type MarketChartSettingsAction,
  type MarketChartSettingsContext,
  type MarketChartSettingsStorage
} from "../transforms/settings";
import type { MarketChartSettingsState } from "../types";

type UseMarketChartSettingsInput = MarketChartSettingsContext & {
  storage?: MarketChartSettingsStorage | null;
  initialSettings?: MarketChartSettingsState;
  persist?: boolean;
};

export const useMarketChartSettings = ({
  storage,
  initialSettings,
  persist = true,
  ...context
}: UseMarketChartSettingsInput = {}) => {
  const contextRef = useRef(context);
  contextRef.current = context;
  const [hydrated, setHydrated] = useState(false);
  const [settings, dispatchBase] = useReducer(
    (state: MarketChartSettingsState, action: MarketChartSettingsAction) =>
      reduceMarketChartSettings(state, action, contextRef.current),
    initialSettings,
    (value) => normalizeMarketChartSettings(value, context)
  );

  useEffect(() => {
    dispatchBase({ type: "reset" });
    const stored = readMarketChartSettings(storage, contextRef.current);
    for (const action of [
      { type: "set-price-renderer" as const, rendererId: stored.price.rendererId },
      { type: "set-price-wicks" as const, showWicks: stored.price.showWicks },
      { type: "set-lower-pane-mode" as const, mode: stored.lowerPane.mode },
      { type: "set-lower-pane-visible" as const, visible: stored.lowerPane.visible },
      { type: "set-display" as const, key: "showGrid" as const, value: stored.display.showGrid },
      {
        type: "set-display" as const,
        key: "showMarkers" as const,
        value: stored.display.showMarkers
      },
      {
        type: "set-display" as const,
        key: "showOverlays" as const,
        value: stored.display.showOverlays
      },
      {
        type: "set-display" as const,
        key: "showSmartFlowMarkers" as const,
        value: stored.display.showSmartFlowMarkers
      },
      {
        type: "set-display" as const,
        key: "showInferredDarkMarkers" as const,
        value: stored.display.showInferredDarkMarkers
      },
      { type: "set-display" as const, key: "density" as const, value: stored.display.density },
      { type: "set-interval" as const, intervalMs: stored.timeframes.intervalMs },
      {
        type: "set-timeframe-favorites" as const,
        favoriteIds: stored.timeframes.favoriteIds
      }
    ]) {
      dispatchBase(action);
    }
    for (const [id, state] of Object.entries(stored.sections)) {
      dispatchBase({ type: "set-section", id, state });
    }
    setHydrated(true);
  }, [storage]);

  useEffect(() => {
    if (!persist || !hydrated) {
      return;
    }
    writeMarketChartSettings(storage, settings, contextRef.current);
  }, [hydrated, persist, settings, storage]);

  const dispatch = useCallback((action: MarketChartSettingsAction) => {
    dispatchBase(action);
  }, []);

  return useMemo(
    () => ({
      settings,
      dispatch,
      hydrated
    }),
    [dispatch, hydrated, settings]
  );
};
