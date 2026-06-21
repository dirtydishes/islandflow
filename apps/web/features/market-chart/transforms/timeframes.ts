export type MarketChartTimeframeId = "1m" | "5m" | "15m" | "30m" | "1h";

export type MarketChartTimeframe = {
  id: MarketChartTimeframeId;
  label: string;
  ms: number;
  defaultFavorite: boolean;
  supportedByDefault: boolean;
};

export type TimeframeFavoritesState = {
  favoriteIds: MarketChartTimeframeId[];
};

export type TimeframeFavoritesAction =
  | { type: "favorite"; id: MarketChartTimeframeId }
  | { type: "unfavorite"; id: MarketChartTimeframeId }
  | { type: "toggle"; id: MarketChartTimeframeId }
  | { type: "reset" };

export type TimeframeToolbarItem = MarketChartTimeframe & {
  available: boolean;
  favorite: boolean;
  selected: boolean;
  disabled: boolean;
  dropdownLabel: string;
};

export type TimeframeToolbarModel = {
  selected: TimeframeToolbarItem;
  toolbarItems: TimeframeToolbarItem[];
  dropdownItems: TimeframeToolbarItem[];
  favoriteIds: MarketChartTimeframeId[];
  supportedIntervalMs: number[];
};

export type TimeframeFavoritesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredTimeframeFavorites = {
  version: typeof TIMEFRAME_FAVORITES_STORAGE_VERSION;
  favoriteIds: MarketChartTimeframeId[];
};

export const TIMEFRAME_FAVORITES_STORAGE_VERSION = 1;
export const TIMEFRAME_FAVORITES_STORAGE_KEY = "islandflow.market-chart.timeframe-favorites.v1";

export const MARKET_CHART_TIMEFRAME_REGISTRY = [
  { id: "1m", label: "1m", ms: 60_000, defaultFavorite: true, supportedByDefault: true },
  { id: "5m", label: "5m", ms: 300_000, defaultFavorite: true, supportedByDefault: true },
  { id: "15m", label: "15m", ms: 900_000, defaultFavorite: true, supportedByDefault: true },
  { id: "30m", label: "30m", ms: 1_800_000, defaultFavorite: false, supportedByDefault: false },
  { id: "1h", label: "1h", ms: 3_600_000, defaultFavorite: false, supportedByDefault: false }
] as const satisfies readonly MarketChartTimeframe[];

export const DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS = MARKET_CHART_TIMEFRAME_REGISTRY.filter(
  (timeframe) => timeframe.supportedByDefault
).map((timeframe) => timeframe.ms);

export const DEFAULT_TIMEFRAME_FAVORITE_IDS = MARKET_CHART_TIMEFRAME_REGISTRY.filter(
  (timeframe) => timeframe.defaultFavorite && timeframe.supportedByDefault
).map((timeframe) => timeframe.id);

export const DEFAULT_MARKET_CHART_INTERVALS = MARKET_CHART_TIMEFRAME_REGISTRY.filter(
  (timeframe) => timeframe.defaultFavorite && timeframe.supportedByDefault
).map((timeframe) => ({ label: timeframe.label, ms: timeframe.ms }));

const timeframeById = new Map<MarketChartTimeframeId, MarketChartTimeframe>(
  MARKET_CHART_TIMEFRAME_REGISTRY.map((timeframe) => [timeframe.id, timeframe])
);

const timeframeByMs = new Map<number, MarketChartTimeframe>(
  MARKET_CHART_TIMEFRAME_REGISTRY.map((timeframe) => [timeframe.ms, timeframe])
);

const registryIntervalMs: ReadonlySet<number> = new Set(
  MARKET_CHART_TIMEFRAME_REGISTRY.map((timeframe) => timeframe.ms)
);

const toIntervalNumber = (value: string): number | null => {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
};

export const parseSupportedTimeframeMs = (
  value: string | undefined,
  fallback: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): number[] => {
  if (!value || value.trim().length === 0) {
    return normalizeSupportedTimeframeMs(fallback);
  }

  const parsed = value
    .split(",")
    .map(toIntervalNumber)
    .filter((interval): interval is number => interval !== null);

  const normalized = normalizeSupportedTimeframeMs(parsed);
  return normalized.length > 0 ? normalized : normalizeSupportedTimeframeMs(fallback);
};

export const normalizeSupportedTimeframeMs = (
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): number[] => {
  const supported = new Set(
    supportedIntervalMs
      .map((interval) => Math.floor(interval))
      .filter((interval) => Number.isFinite(interval) && registryIntervalMs.has(interval))
  );

  return MARKET_CHART_TIMEFRAME_REGISTRY.filter((timeframe) => supported.has(timeframe.ms)).map(
    (timeframe) => timeframe.ms
  );
};

export const getSupportedTimeframes = (
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): MarketChartTimeframe[] => {
  const supported = new Set(normalizeSupportedTimeframeMs(supportedIntervalMs));
  return MARKET_CHART_TIMEFRAME_REGISTRY.filter((timeframe) => supported.has(timeframe.ms));
};

export const getTimeframeByMs = (intervalMs: number): MarketChartTimeframe | null => {
  return timeframeByMs.get(intervalMs) ?? null;
};

export const getTimeframeById = (id: MarketChartTimeframeId): MarketChartTimeframe | null => {
  return timeframeById.get(id) ?? null;
};

export const normalizeTimeframeIntervalMs = (
  intervalMs: number,
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): number => {
  const supported = normalizeSupportedTimeframeMs(supportedIntervalMs);
  return supported.includes(intervalMs)
    ? intervalMs
    : (supported[0] ?? DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS[0]);
};

export const createDefaultTimeframeFavorites = (
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): TimeframeFavoritesState => ({
  favoriteIds: normalizeTimeframeFavoriteIds(DEFAULT_TIMEFRAME_FAVORITE_IDS, supportedIntervalMs)
});

export const normalizeTimeframeFavoriteIds = (
  favoriteIds: readonly unknown[],
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): MarketChartTimeframeId[] => {
  const supported = new Set(normalizeSupportedTimeframeMs(supportedIntervalMs));
  const requested = new Set(favoriteIds);

  return MARKET_CHART_TIMEFRAME_REGISTRY.filter(
    (timeframe) => supported.has(timeframe.ms) && requested.has(timeframe.id)
  ).map((timeframe) => timeframe.id);
};

export const reduceTimeframeFavorites = (
  state: TimeframeFavoritesState,
  action: TimeframeFavoritesAction,
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): TimeframeFavoritesState => {
  if (action.type === "reset") {
    return createDefaultTimeframeFavorites(supportedIntervalMs);
  }

  const timeframe = getTimeframeById(action.id);
  const supported = new Set(normalizeSupportedTimeframeMs(supportedIntervalMs));
  if (!timeframe || !supported.has(timeframe.ms)) {
    return {
      favoriteIds: normalizeTimeframeFavoriteIds(state.favoriteIds, supportedIntervalMs)
    };
  }

  const current = new Set(normalizeTimeframeFavoriteIds(state.favoriteIds, supportedIntervalMs));
  const shouldFavorite =
    action.type === "favorite" || (action.type === "toggle" && !current.has(action.id));

  if (shouldFavorite) {
    current.add(action.id);
  } else {
    current.delete(action.id);
  }

  return {
    favoriteIds: normalizeTimeframeFavoriteIds(Array.from(current), supportedIntervalMs)
  };
};

export const readTimeframeFavorites = (
  storage: TimeframeFavoritesStorage | null | undefined,
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): TimeframeFavoritesState => {
  if (!storage) {
    return createDefaultTimeframeFavorites(supportedIntervalMs);
  }

  try {
    const raw = storage.getItem(TIMEFRAME_FAVORITES_STORAGE_KEY);
    if (!raw) {
      return createDefaultTimeframeFavorites(supportedIntervalMs);
    }

    const parsed = JSON.parse(raw) as Partial<StoredTimeframeFavorites>;
    if (
      parsed.version !== TIMEFRAME_FAVORITES_STORAGE_VERSION ||
      !Array.isArray(parsed.favoriteIds)
    ) {
      return createDefaultTimeframeFavorites(supportedIntervalMs);
    }

    return {
      favoriteIds: normalizeTimeframeFavoriteIds(parsed.favoriteIds, supportedIntervalMs)
    };
  } catch {
    return createDefaultTimeframeFavorites(supportedIntervalMs);
  }
};

export const writeTimeframeFavorites = (
  storage: TimeframeFavoritesStorage | null | undefined,
  state: TimeframeFavoritesState,
  supportedIntervalMs: readonly number[] = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
): void => {
  if (!storage) {
    return;
  }

  const payload: StoredTimeframeFavorites = {
    version: TIMEFRAME_FAVORITES_STORAGE_VERSION,
    favoriteIds: normalizeTimeframeFavoriteIds(state.favoriteIds, supportedIntervalMs)
  };

  try {
    storage.setItem(TIMEFRAME_FAVORITES_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be blocked or quota-limited; favorite changes should remain usable in memory.
  }
};

export const buildTimeframeToolbarModel = ({
  selectedIntervalMs,
  favoriteIds,
  supportedIntervalMs = DEFAULT_SUPPORTED_CANDLE_INTERVAL_MS
}: {
  selectedIntervalMs: number;
  favoriteIds: readonly MarketChartTimeframeId[];
  supportedIntervalMs?: readonly number[];
}): TimeframeToolbarModel => {
  const supported = new Set(normalizeSupportedTimeframeMs(supportedIntervalMs));
  const normalizedFavoriteIds = normalizeTimeframeFavoriteIds(favoriteIds, supportedIntervalMs);
  const favoriteSet = new Set(normalizedFavoriteIds);
  const selectedMs = normalizeTimeframeIntervalMs(selectedIntervalMs, supportedIntervalMs);
  const selectedTimeframe = getTimeframeByMs(selectedMs) ?? MARKET_CHART_TIMEFRAME_REGISTRY[0];

  const toItem = (timeframe: MarketChartTimeframe): TimeframeToolbarItem => {
    const available = supported.has(timeframe.ms);
    return {
      ...timeframe,
      available,
      favorite: favoriteSet.has(timeframe.id),
      selected: timeframe.ms === selectedTimeframe.ms,
      disabled: !available,
      dropdownLabel: available ? timeframe.label : `${timeframe.label} unavailable`
    };
  };

  const dropdownItems = MARKET_CHART_TIMEFRAME_REGISTRY.map(toItem);
  const selected =
    dropdownItems.find((item) => item.ms === selectedTimeframe.ms) ?? toItem(selectedTimeframe);

  return {
    selected,
    toolbarItems: dropdownItems.filter((item) => item.favorite && item.available),
    dropdownItems,
    favoriteIds: normalizedFavoriteIds,
    supportedIntervalMs: normalizeSupportedTimeframeMs(supportedIntervalMs)
  };
};
