import type { BusinessDay, UTCTimestamp } from "lightweight-charts";
import { formatEasternDate, formatEasternTime } from "../../time-format";
import { MARKET_CHART_TIMEFRAME_REGISTRY } from "./timeframes";

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

type ChartTickKind = "year" | "month" | "day" | "time" | "time-with-seconds";

const normalizeTickKind = (tickMarkType: unknown): ChartTickKind => {
  if (typeof tickMarkType === "number") {
    switch (tickMarkType) {
      case 0:
        return "year";
      case 1:
        return "month";
      case 2:
        return "day";
      case 4:
        return "time-with-seconds";
      default:
        return "time";
    }
  }

  const normalized = String(tickMarkType ?? "").toLowerCase();
  if (normalized.includes("year")) {
    return "year";
  }
  if (normalized.includes("month")) {
    return "month";
  }
  if (normalized.includes("day")) {
    return "day";
  }
  if (normalized.includes("second")) {
    return "time-with-seconds";
  }
  return "time";
};

export const formatChartTickTime = (value: ChartTimeLike, tickMarkType?: unknown): string => {
  const timestampMs = chartTimeToMs(value);
  if (timestampMs === null) {
    return "";
  }

  switch (normalizeTickKind(tickMarkType)) {
    case "year":
      return formatEasternDate(timestampMs, { year: "numeric", month: undefined, day: undefined });
    case "month":
      return formatEasternDate(timestampMs, { year: undefined, month: "short", day: undefined });
    case "day":
      return formatEasternDate(timestampMs, { year: undefined, month: "short", day: "numeric" });
    case "time-with-seconds":
      return formatEasternTime(timestampMs, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      });
    case "time":
      return formatEasternTime(timestampMs, { hour: "numeric", minute: "2-digit" });
  }
};

export const formatIntervalLabel = (
  intervalMs: number,
  intervals: readonly { label: string; ms: number }[] = MARKET_CHART_TIMEFRAME_REGISTRY
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
