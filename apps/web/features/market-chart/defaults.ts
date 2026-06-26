import type {
  CandlestickSeriesPartialOptions,
  ChartOptions,
  DeepPartial
} from "lightweight-charts";
import { formatChartTickTime } from "./transforms/time";
import {
  DEFAULT_MARKET_CHART_INTERVALS,
  DEFAULT_TIMEFRAME_FAVORITE_IDS
} from "./transforms/timeframes";
import type {
  MarketChartExtensionRegistry,
  MarketChartLayoutPreset,
  MarketChartSettingsState,
  MarketChartThemeOptions,
  MarketChartThemeTokens
} from "./types";

export { DEFAULT_MARKET_CHART_INTERVALS };

export const MARKET_CHART_THEME_TOKENS: MarketChartThemeTokens = {
  background: "#0d141b",
  text: "#e6edf4",
  mutedText: "#90a0b2",
  grid: "rgba(144, 160, 178, 0.12)",
  border: "rgba(144, 160, 178, 0.24)",
  crosshair: "rgba(245, 166, 35, 0.32)",
  bullish: "#25c17a",
  bearish: "#ff6b5f",
  neutral: "rgba(144, 160, 178, 0.9)",
  active: "#f5a623",
  lowerPositive: "rgba(37, 193, 122, 0.62)",
  lowerNegative: "rgba(255, 107, 95, 0.62)",
  lowerNeutral: "rgba(144, 160, 178, 0.44)"
};

export const DEFAULT_MARKET_CHART_THEME: MarketChartThemeOptions = {
  tokens: MARKET_CHART_THEME_TOKENS
};

export const DEFAULT_MARKET_CHART_SETTINGS: MarketChartSettingsState = {
  price: {
    rendererId: "candles",
    showWicks: true
  },
  lowerPane: {
    visible: true,
    mode: "smart-direction",
    activeLayerId: "smart-direction"
  },
  display: {
    showGrid: true,
    showMarkers: true,
    showOverlays: true,
    showSmartFlowMarkers: true,
    showInferredDarkMarkers: true,
    density: "dense"
  },
  timeframes: {
    intervalMs: DEFAULT_MARKET_CHART_INTERVALS[0].ms,
    favoriteIds: DEFAULT_TIMEFRAME_FAVORITE_IDS
  },
  sections: {}
};

export const MARKET_CHART_LAYOUT_PRESETS: MarketChartLayoutPreset[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    minHeight: 360,
    lowerPaneRatio: 0.24,
    showToolbar: false,
    showAxisLabels: true,
    density: "dense"
  },
  {
    id: "full",
    label: "Full",
    minHeight: 520,
    lowerPaneRatio: 0.28,
    showToolbar: true,
    showAxisLabels: true,
    density: "comfortable"
  },
  {
    id: "compact",
    label: "Compact",
    minHeight: 280,
    lowerPaneRatio: 0.22,
    showToolbar: false,
    showAxisLabels: true,
    density: "compact"
  },
  {
    id: "embedded",
    label: "Embedded",
    minHeight: 220,
    lowerPaneRatio: 0.18,
    showToolbar: false,
    showAxisLabels: false,
    density: "compact"
  },
  {
    id: "sparkline",
    label: "Sparkline",
    minHeight: 120,
    lowerPaneRatio: 0,
    showToolbar: false,
    showAxisLabels: false,
    density: "compact"
  }
];

export const MARKET_CHART_EXTENSION_REGISTRY: MarketChartExtensionRegistry = {
  priceRenderers: [
    {
      id: "candles",
      label: "Candles",
      kind: "candles",
      description: "Standard OHLC candles with semantic direction labels.",
      defaultRenderer: { series: "candlestick" }
    },
    {
      id: "heikin-ashi",
      label: "Heikin Ashi",
      kind: "heikin-ashi",
      description: "Smoothed candles derived from OHLC bars.",
      defaultRenderer: { series: "candlestick" }
    }
  ],
  lowerPanes: [
    {
      id: "smart-direction",
      label: "Flow Direction",
      supportedKinds: ["signed-direction"],
      defaultVisible: true,
      description: "Directional hypothesis bars from smart-flow.",
      isAvailable: (data) => data.smartDirection,
      transformId: "buildSmartDirectionBars",
      formatter: (value) => value.toLocaleString(),
      defaultRenderer: { series: "rounded-bars", signed: true, priceFormat: "price" }
    },
    {
      id: "all-flow",
      label: "All Flow",
      supportedKinds: ["notional"],
      description: "Aggregate flow packet or option print notional by candle bucket.",
      isAvailable: (data) => data.allFlow,
      transformId: "buildAllFlowBars",
      formatter: (value) => value.toLocaleString(),
      defaultRenderer: { series: "rounded-bars", signed: false, priceFormat: "price" }
    },
    {
      id: "volume",
      label: "Volume",
      supportedKinds: ["volume"],
      defaultVisible: true,
      description: "Equity candle volume by bucket.",
      isAvailable: (data) => data.candles,
      transformId: "buildVolumeBars",
      formatter: (value) => value.toLocaleString(),
      defaultRenderer: { series: "rounded-bars", signed: false, priceFormat: "volume" }
    }
  ],
  overlays: [],
  markers: [],
  toolbarActions: [],
  settingsSections: [
    {
      id: "price",
      label: "Price",
      defaults: { enabled: true, values: { rendererId: "candles" } }
    },
    {
      id: "lowerPane",
      label: "Lower Pane",
      defaults: { enabled: true, values: { mode: "smart-direction" } }
    },
    {
      id: "display",
      label: "Display",
      defaults: { enabled: true, values: { density: "dense" } }
    },
    {
      id: "time",
      label: "Time",
      defaults: {
        enabled: true,
        values: {
          intervalMs: DEFAULT_MARKET_CHART_INTERVALS[0].ms,
          favoriteIds: DEFAULT_TIMEFRAME_FAVORITE_IDS
        }
      }
    }
  ],
  hoverRows: [],
  layoutPresets: MARKET_CHART_LAYOUT_PRESETS
};

export const getMarketChartLayoutPreset = (
  presetId: string | undefined,
  presets: readonly MarketChartLayoutPreset[] = MARKET_CHART_LAYOUT_PRESETS
): MarketChartLayoutPreset => {
  if (!presetId) {
    return MARKET_CHART_LAYOUT_PRESETS[0];
  }
  return (
    presets.find((preset) => preset.id === presetId) ??
    MARKET_CHART_LAYOUT_PRESETS.find((preset) => preset.id === presetId) ??
    MARKET_CHART_LAYOUT_PRESETS[0]
  );
};

export const createMarketChartOptions = (
  theme: MarketChartThemeOptions = DEFAULT_MARKET_CHART_THEME,
  showGrid = true
): DeepPartial<ChartOptions> => {
  const { tokens } = theme;
  return {
    layout: {
      background: { color: tokens.background },
      textColor: tokens.mutedText,
      attributionLogo: false,
      panes: {
        separatorColor: tokens.border,
        separatorHoverColor: tokens.active,
        enableResize: true
      }
    },
    grid: {
      vertLines: { color: showGrid ? tokens.grid : "transparent" },
      horzLines: { color: showGrid ? tokens.grid : "transparent" }
    },
    crosshair: {
      vertLine: { color: tokens.crosshair },
      horzLine: { color: tokens.crosshair }
    },
    timeScale: {
      borderColor: tokens.border,
      timeVisible: true,
      tickMarkFormatter: formatChartTickTime
    },
    rightPriceScale: {
      borderColor: tokens.border
    }
  };
};

export const createMarketCandlestickSeriesOptions = (
  theme: MarketChartThemeOptions = DEFAULT_MARKET_CHART_THEME,
  showWicks = true
): CandlestickSeriesPartialOptions => {
  const { tokens } = theme;
  return {
    upColor: tokens.bullish,
    downColor: tokens.bearish,
    borderVisible: false,
    wickUpColor: showWicks ? tokens.bullish : "transparent",
    wickDownColor: showWicks ? tokens.bearish : "transparent"
  };
};
