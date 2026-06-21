import { describe, expect, it } from "bun:test";
import { DEFAULT_MARKET_CHART_SETTINGS } from "../defaults";
import {
  MARKET_CHART_SETTINGS_STORAGE_KEY,
  MARKET_CHART_SETTINGS_STORAGE_VERSION,
  normalizeMarketChartSettings,
  readMarketChartSettings,
  reduceMarketChartSettings,
  writeMarketChartSettings
} from "./settings";
import type { MarketChartSettingsStorage } from "./settings";

const createStorage = (seed: Record<string, string> = {}): MarketChartSettingsStorage => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    }
  };
};

describe("market chart settings reducer and persistence", () => {
  it("uses phase defaults for price, lower pane, markers, and timeframes", () => {
    expect(DEFAULT_MARKET_CHART_SETTINGS).toMatchObject({
      price: { rendererId: "candles", showWicks: true },
      lowerPane: { visible: true, mode: "smart-direction", activeLayerId: "smart-direction" },
      display: {
        showGrid: true,
        showMarkers: true,
        showOverlays: true,
        showSmartFlowMarkers: true,
        showInferredDarkMarkers: true,
        density: "dense"
      },
      timeframes: {
        intervalMs: 60_000,
        favoriteIds: ["1m", "5m", "15m"]
      }
    });
  });

  it("reduces price, lower pane, display, and timeframe changes", () => {
    const context = { supportedIntervalMs: [60_000, 300_000, 900_000] };
    let settings = normalizeMarketChartSettings(DEFAULT_MARKET_CHART_SETTINGS, context);
    settings = reduceMarketChartSettings(
      settings,
      { type: "set-price-renderer", rendererId: "heikin-ashi" },
      context
    );
    settings = reduceMarketChartSettings(
      settings,
      { type: "set-lower-pane-mode", mode: "all-flow" },
      context
    );
    settings = reduceMarketChartSettings(
      settings,
      { type: "set-display", key: "showGrid", value: false },
      context
    );
    settings = reduceMarketChartSettings(
      settings,
      { type: "set-interval", intervalMs: 900_000 },
      context
    );
    settings = reduceMarketChartSettings(
      settings,
      { type: "toggle-timeframe-favorite", id: "15m" },
      context
    );

    expect(settings.price.rendererId).toBe("heikin-ashi");
    expect(settings.lowerPane).toMatchObject({ mode: "all-flow", activeLayerId: "all-flow" });
    expect(settings.display.showGrid).toBe(false);
    expect(settings.timeframes.intervalMs).toBe(900_000);
    expect(settings.timeframes.favoriteIds).toEqual(["1m", "5m"]);
  });

  it("recovers from malformed persisted settings", () => {
    const storage = createStorage({ [MARKET_CHART_SETTINGS_STORAGE_KEY]: "{" });

    expect(readMarketChartSettings(storage).lowerPane.mode).toBe("smart-direction");
    expect(readMarketChartSettings(storage).price.rendererId).toBe("candles");
  });

  it("ignores unknown keys and keeps only known extension sections", () => {
    const settings = normalizeMarketChartSettings(
      {
        price: { rendererId: "missing-renderer" },
        lowerPane: { mode: "missing-pane" },
        display: { showGrid: false, unknown: true },
        timeframes: { intervalMs: 1_800_000, favoriteIds: ["1m", "30m", "bogus"] },
        sections: {
          "known-extension": { enabled: true, values: { alpha: 1 } },
          "orphan-extension": { enabled: true, values: { beta: 2 } }
        },
        "future.namespace": { value: true }
      },
      {
        supportedIntervalMs: [60_000, 300_000],
        settingsSections: [
          {
            id: "known-extension",
            label: "Known Extension",
            defaults: { enabled: true, values: {} }
          }
        ]
      }
    );

    expect(settings.price.rendererId).toBe("candles");
    expect(settings.lowerPane.mode).toBe("smart-direction");
    expect(settings.display.showGrid).toBe(false);
    expect(settings.timeframes).toEqual({ intervalMs: 60_000, favoriteIds: ["1m"] });
    expect(settings.sections).toEqual({
      "known-extension": { enabled: true, values: { alpha: 1 } }
    });
  });

  it("writes versioned normalized settings payloads", () => {
    const storage = createStorage();
    const settings = reduceMarketChartSettings(DEFAULT_MARKET_CHART_SETTINGS, {
      type: "set-price-renderer",
      rendererId: "heikin-ashi"
    });

    writeMarketChartSettings(storage, settings);
    expect(JSON.parse(storage.getItem(MARKET_CHART_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      version: MARKET_CHART_SETTINGS_STORAGE_VERSION,
      settings: {
        price: { rendererId: "heikin-ashi" }
      }
    });
  });
});
