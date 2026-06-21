import type { BusinessDay, UTCTimestamp } from "lightweight-charts";
import { DEFAULT_MARKET_CHART_INTERVALS } from "../defaults";

export type ChartTimeLike = number | string | BusinessDay;

export const toChartTime = (ts: number): UTCTimestamp => {
  return Math.floor(ts / 1000) as UTCTimestamp;
};

export const chartTimeToMs = (value: ChartTimeLike): number | null => {
  if (typeof value === "number") {
    return Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object") {
    const { year, month, day } = value;
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      year >= 1970 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return Date.UTC(year, month - 1, day);
    }
  }

  return null;
};

export const formatIntervalLabel = (
  intervalMs: number,
  intervals: readonly { label: string; ms: number }[] = DEFAULT_MARKET_CHART_INTERVALS
): string => {
  const match = intervals.find((interval) => interval.ms === intervalMs);
  if (match) {
    return match.label;
  }
  if (intervalMs >= 60_000) {
    return `${Math.round(intervalMs / 60_000)}m`;
  }
  if (intervalMs >= 1000) {
    return `${Math.round(intervalMs / 1000)}s`;
  }
  return `${intervalMs}ms`;
};
