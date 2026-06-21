import type { LiveSubscription } from "@islandflow/types";
import { getSupportedTimeframes, parseSupportedTimeframeMs } from "../market-chart";
import type { TapeVirtualListConfig, TapeVirtualPane } from "./types";

const parseBoundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

export const LIVE_HOT_WINDOW = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HOT_WINDOW,
  600,
  1,
  100000
);
export const LIVE_HOT_WINDOW_OPTIONS = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HOT_WINDOW_OPTIONS,
  1200,
  1,
  100000
);
export const LIVE_OPTIONS_HEAD_LIMIT = 100;
export const LIVE_HISTORY_SOFT_CAP = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HISTORY_SOFT_CAP,
  5000,
  100,
  50000
);
export const LIVE_HISTORY_BATCH = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_HISTORY_BATCH,
  500,
  1,
  1000
);
export const LIVE_OPTIONS_STALE_MS = 15_000;
export const LIVE_NBBO_STALE_MS = 15_000;
export const LIVE_EQUITIES_STALE_MS = 15_000;
export const LIVE_FEED_BEHIND_DELAY_MS = 15_000;
export const LIVE_EQUITIES_SILENT_WARNING_MS = parseBoundedInt(
  process.env.NEXT_PUBLIC_LIVE_EQUITIES_SILENT_WARNING_MS,
  25_000,
  5_000,
  5 * 60 * 1000
);
export const LIVE_FLOW_STALE_MS = 30_000;
export const PINNED_EVIDENCE_TTL_MS = parseBoundedInt(
  process.env.NEXT_PUBLIC_PINNED_EVIDENCE_TTL_MS,
  20 * 60 * 1000,
  60 * 1000,
  2 * 60 * 60 * 1000
);
export const PINNED_EVIDENCE_MAX_ITEMS = parseBoundedInt(
  process.env.NEXT_PUBLIC_PINNED_EVIDENCE_MAX_ITEMS,
  4000,
  100,
  50000
);
const NBBO_MAX_AGE_MS = Number(process.env.NEXT_PUBLIC_NBBO_MAX_AGE_MS);
export const NBBO_MAX_AGE_MS_SAFE =
  Number.isFinite(NBBO_MAX_AGE_MS) && NBBO_MAX_AGE_MS > 0 ? NBBO_MAX_AGE_MS : 1000;
export const FLOW_FILTER_PRESET = process.env.NEXT_PUBLIC_FLOW_FILTER_PRESET ?? "smart-money";
export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
export const SUPPORTED_CANDLE_INTERVAL_MS = parseSupportedTimeframeMs(
  process.env.NEXT_PUBLIC_CANDLE_INTERVALS_MS
);
export const CANDLE_INTERVALS = getSupportedTimeframes(SUPPORTED_CANDLE_INTERVAL_MS).map(
  (timeframe) => ({
    label: timeframe.label,
    ms: timeframe.ms
  })
);
export const LIVE_SESSION_IDLE_RECONNECT_MS = 12_000;
export const LIVE_SESSION_IDLE_CHECK_MS = 3_000;
export const LIVE_SESSION_HOT_CHANNELS = new Set<LiveSubscription["channel"]>([
  "options",
  "nbbo",
  "equities",
  "flow",
  "equity-overlay"
]);

const TAPE_VIRTUAL_CONFIG: Record<TapeVirtualPane, TapeVirtualListConfig> = {
  options: { rowHeight: 36, overscan: 44, debugLabel: "options" },
  flow: { rowHeight: 44, overscan: 24, debugLabel: "flow" },
  news: { rowHeight: 52, overscan: 28, debugLabel: "news" }
};

export const getTapeVirtualConfig = (pane: TapeVirtualPane): TapeVirtualListConfig =>
  TAPE_VIRTUAL_CONFIG[pane];

export const shouldIncludeEquitiesForDarkUnderlyingFallback = (): boolean => {
  return false;
};

export const isSyntheticAdminVisible = (value = process.env.NEXT_PUBLIC_SYNTHETIC_ADMIN): boolean =>
  value === "1";
