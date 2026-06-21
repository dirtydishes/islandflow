import { DEFAULT_MARKET_CHART_SETTINGS, MARKET_CHART_EXTENSION_REGISTRY } from "../defaults";
import type {
  MarketChartSettingsCapabilities,
  MarketChartSettingsSectionDefinition,
  MarketChartSettingsSectionState,
  MarketChartSettingsState
} from "../types";
import {
  DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS,
  normalizeSupportedTimeframeMs,
  normalizeTimeframeFavoriteIds,
  normalizeTimeframeIntervalMs,
  reduceTimeframeFavorites,
  type MarketChartTimeframeId
} from "./timeframes";

export type MarketChartSettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type MarketChartSettingsContext = {
  supportedIntervalMs?: readonly number[];
  priceRendererIds?: readonly string[];
  lowerPaneModeIds?: readonly string[];
  settingsSections?: readonly MarketChartSettingsSectionDefinition[];
  capabilities?: MarketChartSettingsCapabilities;
};

export type MarketChartSettingsAction =
  | { type: "set-price-renderer"; rendererId: string }
  | { type: "set-price-wicks"; showWicks: boolean }
  | { type: "set-lower-pane-mode"; mode: string }
  | { type: "set-lower-pane-visible"; visible: boolean }
  | { type: "set-display"; key: keyof MarketChartSettingsState["display"]; value: boolean | string }
  | { type: "set-interval"; intervalMs: number }
  | { type: "set-timeframe-favorites"; favoriteIds: string[] }
  | { type: "toggle-timeframe-favorite"; id: MarketChartTimeframeId }
  | { type: "set-section"; id: string; state: MarketChartSettingsSectionState }
  | { type: "reset" };

type StoredMarketChartSettings = {
  version: typeof MARKET_CHART_SETTINGS_STORAGE_VERSION;
  settings: PartialMarketChartSettings;
};

type PartialMarketChartSettings = Partial<{
  price: Partial<MarketChartSettingsState["price"]>;
  lowerPane: Partial<MarketChartSettingsState["lowerPane"]>;
  display: Partial<MarketChartSettingsState["display"]>;
  timeframes: Partial<MarketChartSettingsState["timeframes"]>;
  sections: Record<string, Partial<MarketChartSettingsSectionState>>;
}>;

export const MARKET_CHART_SETTINGS_STORAGE_VERSION = 1;
export const MARKET_CHART_SETTINGS_STORAGE_KEY = "islandflow.market-chart.settings.v1";

const cloneDefaults = (): MarketChartSettingsState => ({
  price: { ...DEFAULT_MARKET_CHART_SETTINGS.price },
  lowerPane: { ...DEFAULT_MARKET_CHART_SETTINGS.lowerPane },
  display: { ...DEFAULT_MARKET_CHART_SETTINGS.display },
  timeframes: {
    intervalMs: DEFAULT_MARKET_CHART_SETTINGS.timeframes.intervalMs,
    favoriteIds: [...DEFAULT_MARKET_CHART_SETTINGS.timeframes.favoriteIds]
  },
  sections: { ...DEFAULT_MARKET_CHART_SETTINGS.sections }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const boolOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const densityOr = (
  value: unknown,
  fallback: MarketChartSettingsState["display"]["density"]
): MarketChartSettingsState["display"]["density"] =>
  value === "comfortable" || value === "dense" || value === "compact" ? value : fallback;

const allowedSet = (
  values: readonly string[] | undefined,
  fallback: readonly string[]
): ReadonlySet<string> => new Set(values?.length ? values : fallback);

const resolveSupportedIntervalMs = (context: MarketChartSettingsContext): readonly number[] =>
  normalizeSupportedTimeframeMs(
    context.capabilities?.supportedIntervalMs ??
      context.supportedIntervalMs ??
      DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
  );

const knownSectionIds = (context: MarketChartSettingsContext): ReadonlySet<string> => {
  const sections = context.settingsSections ?? MARKET_CHART_EXTENSION_REGISTRY.settingsSections;
  const capabilityIds = context.capabilities?.settingsSectionIds;
  const ids = capabilityIds?.length ? capabilityIds : sections.map((section) => section.id);
  return new Set(ids);
};

const normalizeSections = (
  sections: unknown,
  context: MarketChartSettingsContext
): Record<string, MarketChartSettingsSectionState> => {
  if (!isRecord(sections)) {
    return {};
  }

  const known = knownSectionIds(context);
  const normalized: Record<string, MarketChartSettingsSectionState> = {};
  for (const [id, value] of Object.entries(sections)) {
    if (!known.has(id) || !isRecord(value)) {
      continue;
    }
    const values = isRecord(value.values) ? value.values : {};
    normalized[id] = {
      enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
      values
    };
  }
  return normalized;
};

export const normalizeMarketChartSettings = (
  input: unknown,
  context: MarketChartSettingsContext = {}
): MarketChartSettingsState => {
  const defaults = cloneDefaults();
  const settings = isRecord(input) ? input : {};
  const supportedIntervalMs = resolveSupportedIntervalMs(context);
  const priceRendererIds = allowedSet(
    context.capabilities?.priceRendererIds ?? context.priceRendererIds,
    ["candles", "heikin-ashi"]
  );
  const lowerPaneModeIds = allowedSet(
    context.capabilities?.lowerPaneModeIds ?? context.lowerPaneModeIds,
    ["smart-direction", "all-flow", "volume"]
  );
  const price = isRecord(settings.price) ? settings.price : {};
  const lowerPane = isRecord(settings.lowerPane) ? settings.lowerPane : {};
  const display = isRecord(settings.display) ? settings.display : {};
  const timeframes = isRecord(settings.timeframes) ? settings.timeframes : {};

  const rendererId = stringOr(price.rendererId, defaults.price.rendererId);
  const lowerPaneMode = stringOr(
    lowerPane.mode ?? lowerPane.activeLayerId,
    defaults.lowerPane.mode
  );

  return {
    price: {
      rendererId: priceRendererIds.has(rendererId) ? rendererId : defaults.price.rendererId,
      showWicks: boolOr(price.showWicks, defaults.price.showWicks)
    },
    lowerPane: {
      visible: boolOr(lowerPane.visible, defaults.lowerPane.visible),
      mode: lowerPaneModeIds.has(lowerPaneMode) ? lowerPaneMode : defaults.lowerPane.mode,
      activeLayerId: lowerPaneModeIds.has(lowerPaneMode) ? lowerPaneMode : defaults.lowerPane.mode
    },
    display: {
      showGrid: boolOr(display.showGrid, defaults.display.showGrid),
      showMarkers: boolOr(display.showMarkers, defaults.display.showMarkers),
      showOverlays: boolOr(display.showOverlays, defaults.display.showOverlays),
      showSmartFlowMarkers: boolOr(
        display.showSmartFlowMarkers,
        defaults.display.showSmartFlowMarkers
      ),
      showInferredDarkMarkers: boolOr(
        display.showInferredDarkMarkers,
        defaults.display.showInferredDarkMarkers
      ),
      density: densityOr(display.density, defaults.display.density)
    },
    timeframes: {
      intervalMs: normalizeTimeframeIntervalMs(
        typeof timeframes.intervalMs === "number"
          ? timeframes.intervalMs
          : defaults.timeframes.intervalMs,
        supportedIntervalMs
      ),
      favoriteIds: normalizeTimeframeFavoriteIds(
        Array.isArray(timeframes.favoriteIds)
          ? timeframes.favoriteIds
          : defaults.timeframes.favoriteIds,
        supportedIntervalMs
      )
    },
    sections: normalizeSections(settings.sections, context)
  };
};

export const reduceMarketChartSettings = (
  state: MarketChartSettingsState,
  action: MarketChartSettingsAction,
  context: MarketChartSettingsContext = {}
): MarketChartSettingsState => {
  if (action.type === "reset") {
    return normalizeMarketChartSettings(cloneDefaults(), context);
  }

  if (action.type === "set-price-renderer") {
    return normalizeMarketChartSettings(
      { ...state, price: { ...state.price, rendererId: action.rendererId } },
      context
    );
  }

  if (action.type === "set-price-wicks") {
    return normalizeMarketChartSettings(
      { ...state, price: { ...state.price, showWicks: action.showWicks } },
      context
    );
  }

  if (action.type === "set-lower-pane-mode") {
    return normalizeMarketChartSettings(
      {
        ...state,
        lowerPane: { ...state.lowerPane, mode: action.mode, activeLayerId: action.mode }
      },
      context
    );
  }

  if (action.type === "set-lower-pane-visible") {
    return normalizeMarketChartSettings(
      { ...state, lowerPane: { ...state.lowerPane, visible: action.visible } },
      context
    );
  }

  if (action.type === "set-display") {
    return normalizeMarketChartSettings(
      { ...state, display: { ...state.display, [action.key]: action.value } },
      context
    );
  }

  if (action.type === "set-interval") {
    return normalizeMarketChartSettings(
      { ...state, timeframes: { ...state.timeframes, intervalMs: action.intervalMs } },
      context
    );
  }

  if (action.type === "set-timeframe-favorites") {
    return normalizeMarketChartSettings(
      { ...state, timeframes: { ...state.timeframes, favoriteIds: action.favoriteIds } },
      context
    );
  }

  if (action.type === "toggle-timeframe-favorite") {
    const supportedIntervalMs = resolveSupportedIntervalMs(context);
    const favorites = reduceTimeframeFavorites(
      { favoriteIds: state.timeframes.favoriteIds as MarketChartTimeframeId[] },
      { type: "toggle", id: action.id },
      supportedIntervalMs
    );
    return normalizeMarketChartSettings(
      { ...state, timeframes: { ...state.timeframes, favoriteIds: favorites.favoriteIds } },
      context
    );
  }

  if (action.type === "set-section") {
    return normalizeMarketChartSettings(
      { ...state, sections: { ...state.sections, [action.id]: action.state } },
      context
    );
  }

  return state;
};

export const readMarketChartSettings = (
  storage: MarketChartSettingsStorage | null | undefined,
  context: MarketChartSettingsContext = {}
): MarketChartSettingsState => {
  if (!storage) {
    return normalizeMarketChartSettings(cloneDefaults(), context);
  }

  try {
    const raw = storage.getItem(MARKET_CHART_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeMarketChartSettings(cloneDefaults(), context);
    }

    const parsed = JSON.parse(raw) as Partial<StoredMarketChartSettings>;
    if (parsed.version !== MARKET_CHART_SETTINGS_STORAGE_VERSION) {
      return normalizeMarketChartSettings(cloneDefaults(), context);
    }
    return normalizeMarketChartSettings(parsed.settings, context);
  } catch {
    return normalizeMarketChartSettings(cloneDefaults(), context);
  }
};

export const writeMarketChartSettings = (
  storage: MarketChartSettingsStorage | null | undefined,
  settings: MarketChartSettingsState,
  context: MarketChartSettingsContext = {}
): void => {
  if (!storage) {
    return;
  }

  const payload: StoredMarketChartSettings = {
    version: MARKET_CHART_SETTINGS_STORAGE_VERSION,
    settings: normalizeMarketChartSettings(settings, context)
  };

  try {
    storage.setItem(MARKET_CHART_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable or quota-limited. The in-memory settings still apply.
  }
};
