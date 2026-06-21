import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  SeriesMarkerBarPosition,
  SeriesMarkerShape,
  Time,
  UTCTimestamp
} from "lightweight-charts";

export type MarketChartDirection = "bullish" | "bearish" | "neutral";

export type MarketChartCandle = {
  time: UTCTimestamp;
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  notional?: number;
  tradeCount?: number;
  direction: MarketChartDirection;
  sequence?: number;
  source?: string;
  payload?: unknown;
};

export type MarketChartCandleInput = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  notional?: number | null;
  trade_count?: number | null;
  tradeCount?: number | null;
  seq?: number | null;
  source?: string | null;
  payload?: unknown;
};

export type MarketChartCandlestickData = CandlestickData<UTCTimestamp>;
export type MarketChartPriceSeries = ISeriesApi<"Candlestick", Time>;
export type MarketChartLowerPaneSeries = ISeriesApi<"Histogram", Time>;

export type MarketChartPriceRendererKind = "candles" | "heikin-ashi" | "bar" | "line" | "area";

export type MarketChartPriceRendererDefinition = {
  id: string;
  label: string;
  kind: MarketChartPriceRendererKind;
  description?: string;
};

export type MarketChartLowerValueKind = "volume" | "notional" | "signed-direction" | "indicator";

export type MarketChartLowerPoint = {
  time: UTCTimestamp;
  timestampMs: number;
  value: number;
  kind: MarketChartLowerValueKind;
  direction?: MarketChartDirection;
  label?: string;
  color?: string;
  payload?: unknown;
};

export type MarketChartLowerLayer = {
  id: string;
  label: string;
  kind: MarketChartLowerValueKind;
  points: MarketChartLowerPoint[];
  paneId?: string;
  priceFormat?: "volume" | "price" | "percent" | "custom";
  visible?: boolean;
  hoverRows?: MarketChartHoverRowProvider;
};

export type MarketChartLowerSeries = {
  layers: MarketChartLowerLayer[];
  defaultLayerId?: string;
};

export type MarketChartLowerPaneDefinition = {
  id: string;
  label: string;
  supportedKinds: MarketChartLowerValueKind[];
  defaultVisible?: boolean;
  description?: string;
};

export type MarketChartMarker<TPayload = unknown> = {
  id: string;
  time: UTCTimestamp;
  label: string;
  title?: string;
  description?: string;
  direction?: MarketChartDirection;
  position: SeriesMarkerBarPosition;
  shape: SeriesMarkerShape;
  color: string;
  payload?: TPayload;
};

export type MarketChartMarkerAdapter<TPayload = unknown> = {
  id: string;
  label: string;
  mapMarker: (marker: MarketChartMarker<TPayload>) => SeriesMarker<UTCTimestamp>;
};

export type MarketChartOverlayPoint = {
  time: UTCTimestamp;
  timestampMs: number;
  price?: number;
  value?: number;
  label?: string;
  color?: string;
  payload?: unknown;
};

export type MarketChartOverlay = {
  id: string;
  label: string;
  points: MarketChartOverlayPoint[];
  visible?: boolean;
  hoverRows?: MarketChartHoverRowProvider;
  payload?: unknown;
};

export type MarketChartOverlayDefinition = {
  id: string;
  label: string;
  description?: string;
};

export type MarketChartHoverRowTone =
  | "default"
  | "muted"
  | "bullish"
  | "bearish"
  | "neutral"
  | "info"
  | "warning";

export type MarketChartHoverRow = {
  id: string;
  label: string;
  value: string;
  tone?: MarketChartHoverRowTone;
  sourceId?: string;
};

export type MarketChartHoverSnapshot = {
  time: UTCTimestamp;
  timestampMs: number;
  symbol: string;
  intervalMs: number;
  price?: number | null;
  candle?: MarketChartCandle;
  marker?: MarketChartMarker;
  rows: MarketChartHoverRow[];
  lowerRows: MarketChartHoverRow[];
  overlayRows: MarketChartHoverRow[];
  payload?: unknown;
};

export type MarketChartHoverContext = {
  symbol: string;
  intervalMs: number;
  time: UTCTimestamp;
  timestampMs: number;
  candle?: MarketChartCandle;
  lowerPoints: MarketChartLowerPoint[];
  overlayPoints: MarketChartOverlayPoint[];
  marker?: MarketChartMarker;
};

export type MarketChartHoverRowProvider = (
  context: MarketChartHoverContext
) => MarketChartHoverRow[];

export type MarketChartSettingsSectionState = {
  enabled?: boolean;
  values: Record<string, unknown>;
};

export type MarketChartSettingsState = {
  price: {
    rendererId: string;
    showWicks: boolean;
  };
  lowerPane: {
    visible: boolean;
    activeLayerId?: string;
  };
  display: {
    showGrid: boolean;
    showMarkers: boolean;
    showOverlays: boolean;
    density: "comfortable" | "dense" | "compact";
  };
  time: {
    intervalMs: number;
  };
  sections: Record<string, MarketChartSettingsSectionState>;
};

export type MarketChartSettingsSectionDefinition = {
  id: string;
  label: string;
  defaults: MarketChartSettingsSectionState;
};

export type MarketChartToolbarAction = {
  id: string;
  label: string;
  disabled?: boolean;
  active?: boolean;
  payload?: unknown;
};

export type MarketChartLayoutPresetId = "dashboard" | "full" | "compact" | "embedded" | "sparkline";

export type MarketChartLayoutPreset = {
  id: MarketChartLayoutPresetId | string;
  label: string;
  minHeight: number;
  lowerPaneRatio: number;
  showToolbar: boolean;
  showAxisLabels: boolean;
  density: MarketChartSettingsState["display"]["density"];
};

export type MarketChartThemeTokens = {
  background: string;
  text: string;
  mutedText: string;
  grid: string;
  border: string;
  crosshair: string;
  bullish: string;
  bearish: string;
  neutral: string;
  active: string;
  lowerPositive: string;
  lowerNegative: string;
  lowerNeutral: string;
};

export type MarketChartThemeOptions = {
  tokens: MarketChartThemeTokens;
};

export type MarketChartStatus =
  | "idle"
  | "loading"
  | "live"
  | "replay"
  | "stale"
  | "offline"
  | "error";

export type MarketChartRange = {
  from: number;
  to: number;
};

export type MarketChartExtensionRegistry = {
  priceRenderers: MarketChartPriceRendererDefinition[];
  lowerPanes: MarketChartLowerPaneDefinition[];
  overlays: MarketChartOverlayDefinition[];
  markers: MarketChartMarkerAdapter[];
  toolbarActions: MarketChartToolbarAction[];
  settingsSections: MarketChartSettingsSectionDefinition[];
  hoverRows: MarketChartHoverRowProvider[];
  layoutPresets: MarketChartLayoutPreset[];
};

export type MarketChartProps = {
  symbol: string;
  intervalMs: number;
  candles: MarketChartCandle[];
  lowerSeries?: MarketChartLowerSeries;
  markers?: MarketChartMarker[];
  overlays?: MarketChartOverlay[];
  settings: MarketChartSettingsState;
  status?: MarketChartStatus;
  replayTime?: number | null;
  theme?: MarketChartThemeOptions;
  layoutPreset?: MarketChartLayoutPresetId | string;
  registry?: Partial<MarketChartExtensionRegistry>;
  onVisibleRangeChange?: (range: MarketChartRange | null) => void;
  onMarkerClick?: (marker: MarketChartMarker) => void;
  onCrosshairChange?: (snapshot: MarketChartHoverSnapshot | null) => void;
};

export type MarketChartApiRefs = {
  chart: IChartApi | null;
  priceSeries: MarketChartPriceSeries | null;
  lowerSeries: Map<string, MarketChartLowerPaneSeries>;
  markerPlugin: ISeriesMarkersPluginApi<Time> | null;
};

export type MarketChartHistogramData = HistogramData<UTCTimestamp>;
