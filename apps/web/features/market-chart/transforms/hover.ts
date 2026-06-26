import { formatEasternTime } from "../../time-format";
import type {
  MarketChartDirection,
  MarketChartHoverContext,
  MarketChartHoverPoint,
  MarketChartHoverRow,
  MarketChartHoverSnapshot
} from "../types";
import { formatIntervalLabel } from "./time";

export type MarketChartOptionFlowDirection = MarketChartDirection | "unknown";

export type MarketChartOptionFlowInput = {
  timestampMs: number;
  sequence?: number;
  notional?: number | null;
  price?: number | null;
  size?: number | null;
  direction?: MarketChartOptionFlowDirection | null;
};

export type MarketChartOptionNotionalSummary = {
  bullish: number;
  bearish: number;
  neutralUnknown: number;
  count: number;
};

export type MarketChartFlowContextSource = "smart-flow";

export type MarketChartFlowContextInput = {
  timestampMs: number;
  sequence?: number;
  source: MarketChartFlowContextSource;
  direction?: MarketChartDirection | "abstained" | "unknown" | null;
  label?: string | null;
  evidenceQuality?: string | null;
  evidenceScore?: number | null;
  confidence?: number | null;
  whyNot?: string | null;
  abstained?: boolean;
};

type BuildHoverSnapshotOptions = {
  extensionRows?: MarketChartHoverRow[];
  lowerRows?: MarketChartHoverRow[];
  overlayRows?: MarketChartHoverRow[];
  point?: MarketChartHoverPoint;
};

const HOVER_EXTENSION_GROUP = "Flow context";

const formatPrice = (value: number): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const formatInteger = (value: number): string =>
  Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });

const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "$0.00";
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}$${abs.toFixed(2)}`;
};

const formatPercent = (value: number): string =>
  `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const titleCase = (value: string): string =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const formatHoverTime = (timestampMs: number, intervalMs: number): string => {
  const time = formatEasternTime(timestampMs, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(intervalMs < 60_000 ? { second: "2-digit" } : {}),
    timeZoneName: "short"
  });
  return `${time} · ${formatIntervalLabel(intervalMs)}`;
};

const inHoverBucket = (context: MarketChartHoverContext, timestampMs: number): boolean =>
  timestampMs >= context.bucketStartMs && timestampMs < context.bucketEndMs;

const toOptionNotional = (item: MarketChartOptionFlowInput): number => {
  if (typeof item.notional === "number" && Number.isFinite(item.notional) && item.notional >= 0) {
    return item.notional;
  }
  if (
    typeof item.price === "number" &&
    Number.isFinite(item.price) &&
    item.price >= 0 &&
    typeof item.size === "number" &&
    Number.isFinite(item.size) &&
    item.size >= 0
  ) {
    return item.price * item.size * 100;
  }
  return 0;
};

const normalizeOptionDirection = (
  value: MarketChartOptionFlowInput["direction"]
): MarketChartOptionFlowDirection => {
  if (value === "bullish" || value === "bearish" || value === "neutral") {
    return value;
  }
  return "unknown";
};

const normalizeFlowTone = (
  value: MarketChartFlowContextInput["direction"],
  abstained?: boolean
): MarketChartHoverRow["tone"] => {
  if (abstained || value === "abstained") {
    return "neutral";
  }
  if (value === "bullish" || value === "bearish" || value === "neutral") {
    return value;
  }
  return "neutral";
};

const evidenceQualityFromScore = (score: number): string => {
  if (score >= 0.82) {
    return "strong";
  }
  if (score >= 0.55) {
    return "usable";
  }
  if (score > 0) {
    return "thin";
  }
  return "poor";
};

const sortByBucketOrder = <T extends { timestampMs: number; sequence?: number }>(
  items: readonly T[]
): T[] =>
  [...items].sort((a, b) => {
    const tsDelta = a.timestampMs - b.timestampMs;
    if (tsDelta !== 0) {
      return tsDelta;
    }
    return (a.sequence ?? 0) - (b.sequence ?? 0);
  });

const hoverRowsSignature = (rows: readonly MarketChartHoverRow[]): unknown[] =>
  rows.map((row) => [
    row.id,
    row.label,
    row.value,
    row.tone ?? "",
    row.sourceId ?? "",
    row.group ?? ""
  ]);

const hoverCandleSignature = (snapshot: MarketChartHoverSnapshot): unknown[] => {
  const { candle } = snapshot;
  if (!candle) {
    return [];
  }
  return [
    candle.time,
    candle.timestampMs,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume ?? "",
    candle.notional ?? "",
    candle.tradeCount ?? "",
    candle.direction,
    candle.sequence ?? "",
    candle.source ?? ""
  ];
};

const hoverMarkerSignature = (snapshot: MarketChartHoverSnapshot): unknown[] => {
  const { marker } = snapshot;
  if (!marker) {
    return [];
  }
  return [
    marker.id,
    marker.time,
    marker.label,
    marker.title ?? "",
    marker.description ?? "",
    marker.direction ?? "",
    marker.position,
    marker.shape,
    marker.color
  ];
};

export const getMarketChartHoverSnapshotSignature = (
  snapshot: MarketChartHoverSnapshot | null
): string => {
  if (!snapshot) {
    return "null";
  }

  return JSON.stringify([
    snapshot.symbol,
    snapshot.intervalMs,
    snapshot.time,
    snapshot.timestampMs,
    snapshot.bucketStartMs,
    snapshot.bucketEndMs,
    snapshot.price ?? "",
    snapshot.point?.x ?? "",
    snapshot.point?.y ?? "",
    hoverCandleSignature(snapshot),
    hoverMarkerSignature(snapshot),
    hoverRowsSignature(snapshot.coreRows),
    hoverRowsSignature(snapshot.extensionRows),
    hoverRowsSignature(snapshot.lowerRows),
    hoverRowsSignature(snapshot.overlayRows)
  ]);
};

export const marketChartHoverSnapshotsEqual = (
  current: MarketChartHoverSnapshot | null,
  next: MarketChartHoverSnapshot | null
): boolean =>
  getMarketChartHoverSnapshotSignature(current) === getMarketChartHoverSnapshotSignature(next);

export const aggregateOptionNotionalByDirection = (
  context: MarketChartHoverContext,
  items: readonly MarketChartOptionFlowInput[]
): MarketChartOptionNotionalSummary => {
  return items
    .filter((item) => inHoverBucket(context, item.timestampMs))
    .reduce(
      (summary, item) => {
        const notional = toOptionNotional(item);
        const direction = normalizeOptionDirection(item.direction);
        if (direction === "bullish") {
          summary.bullish += notional;
        } else if (direction === "bearish") {
          summary.bearish += notional;
        } else {
          summary.neutralUnknown += notional;
        }
        summary.count += 1;
        return summary;
      },
      { bullish: 0, bearish: 0, neutralUnknown: 0, count: 0 }
    );
};

export const buildDirectionalOptionNotionalRows = (
  context: MarketChartHoverContext,
  items: readonly MarketChartOptionFlowInput[],
  group = HOVER_EXTENSION_GROUP
): MarketChartHoverRow[] => {
  const summary = aggregateOptionNotionalByDirection(context, items);
  return [
    {
      id: "option-notional:bullish",
      label: "Bullish option notional",
      value: formatUsd(summary.bullish),
      tone: "bullish",
      group
    },
    {
      id: "option-notional:bearish",
      label: "Bearish option notional",
      value: formatUsd(summary.bearish),
      tone: "bearish",
      group
    },
    {
      id: "option-notional:neutral-unknown",
      label: "Neutral/unknown notional",
      value: formatUsd(summary.neutralUnknown),
      tone: summary.neutralUnknown > 0 ? "info" : "muted",
      group
    }
  ];
};

export const buildFlowContextHoverRows = (
  context: MarketChartHoverContext,
  items: readonly MarketChartFlowContextInput[],
  group = HOVER_EXTENSION_GROUP
): MarketChartHoverRow[] => {
  const bucketItems = sortByBucketOrder(
    items.filter((item) => inHoverBucket(context, item.timestampMs))
  );
  const selected = bucketItems.filter((item) => item.source === "smart-flow").at(-1);
  if (!selected) {
    return [];
  }

  const isAbstained = selected.abstained || selected.direction === "abstained";
  const tone = normalizeFlowTone(selected.direction, isAbstained);
  const directionLabel = isAbstained
    ? "Abstained"
    : selected.direction && selected.direction !== "unknown"
      ? titleCase(selected.direction)
      : "Neutral/unknown";
  const sourceLabel = "hypothesis";
  const label = selected.label ? ` · ${selected.label}` : "";
  const quality =
    selected.evidenceQuality ??
    (typeof selected.evidenceScore === "number"
      ? evidenceQualityFromScore(selected.evidenceScore)
      : null);

  const rows: MarketChartHoverRow[] = [
    {
      id: "flow-context:direction",
      label: "Flow direction",
      value: `${directionLabel} ${sourceLabel}${label}`,
      tone,
      group
    }
  ];

  if (quality) {
    rows.push({
      id: "flow-context:evidence-quality",
      label: "Evidence quality",
      value:
        typeof selected.evidenceScore === "number"
          ? `${quality} · ${formatPercent(selected.evidenceScore)}`
          : quality,
      tone: quality === "poor" || quality === "thin" ? "warning" : "info",
      group
    });
  }

  if (typeof selected.confidence === "number" && Number.isFinite(selected.confidence)) {
    rows.push({
      id: "flow-context:confidence",
      label: "Confidence",
      value: formatPercent(selected.confidence),
      tone: selected.confidence >= 0.55 ? "info" : "warning",
      group
    });
  }

  if (selected.whyNot) {
    rows.push({
      id: "flow-context:why-not",
      label: "Why-not",
      value: selected.whyNot,
      tone: selected.whyNot === "No active why-not guard" ? "muted" : "warning",
      group
    });
  }

  return rows;
};

export const buildCoreHoverRows = (context: MarketChartHoverContext): MarketChartHoverRow[] => {
  const { candle } = context;
  const rows: MarketChartHoverRow[] = [
    {
      id: "time",
      label: "Time",
      value: formatHoverTime(context.bucketStartMs, context.intervalMs),
      tone: "muted"
    }
  ];

  if (!candle) {
    return rows;
  }

  rows.push(
    {
      id: "ohlc",
      label: "OHLC",
      value: `O ${formatPrice(candle.open)} · H ${formatPrice(candle.high)} · L ${formatPrice(candle.low)} · C ${formatPrice(candle.close)}`,
      tone: candle.direction
    },
    {
      id: "volume",
      label: "Volume",
      value: typeof candle.volume === "number" ? formatInteger(candle.volume) : "--",
      tone: "default"
    }
  );

  if (typeof candle.tradeCount === "number") {
    rows.push({
      id: "trades",
      label: "Trades",
      value: formatInteger(candle.tradeCount),
      tone: "default"
    });
  }

  return rows;
};

export const buildHoverSnapshot = (
  context: MarketChartHoverContext,
  options: MarketChartHoverRow[] | BuildHoverSnapshotOptions = {}
): MarketChartHoverSnapshot => {
  const coreRows = buildCoreHoverRows(context);
  const extensionRows = Array.isArray(options) ? options : (options.extensionRows ?? []);
  const point = Array.isArray(options) ? undefined : options.point;
  const lowerExtensionRows = Array.isArray(options) ? [] : (options.lowerRows ?? []);
  const overlayExtensionRows = Array.isArray(options) ? [] : (options.overlayRows ?? []);
  const lowerRows = [
    ...lowerExtensionRows,
    ...context.lowerPoints.map((point) => ({
      id: `lower:${point.kind}:${point.timestampMs}`,
      label: point.label ?? point.kind,
      value: point.value.toLocaleString(),
      tone: point.direction,
      group: "Lower pane"
    }))
  ];
  const overlayRows = [
    ...overlayExtensionRows,
    ...context.overlayPoints.map((point) => ({
      id: `overlay:${point.timestampMs}:${point.label ?? "point"}`,
      label: point.label ?? "Overlay",
      value:
        typeof point.price === "number"
          ? formatPrice(point.price)
          : typeof point.value === "number"
            ? point.value.toLocaleString()
            : "active",
      tone: "info" as const,
      group: "Overlays"
    }))
  ];

  return {
    time: context.time,
    timestampMs: context.timestampMs,
    bucketStartMs: context.bucketStartMs,
    bucketEndMs: context.bucketEndMs,
    symbol: context.symbol,
    intervalMs: context.intervalMs,
    price: context.candle?.close ?? null,
    candle: context.candle,
    marker: context.marker,
    point,
    coreRows,
    extensionRows,
    rows: [...coreRows, ...extensionRows],
    lowerRows,
    overlayRows
  };
};
