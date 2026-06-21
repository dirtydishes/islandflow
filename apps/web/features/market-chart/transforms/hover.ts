import type {
  MarketChartHoverContext,
  MarketChartHoverRow,
  MarketChartHoverSnapshot
} from "../types";

const formatPrice = (value: number): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export const buildCoreHoverRows = (context: MarketChartHoverContext): MarketChartHoverRow[] => {
  const { candle } = context;
  if (!candle) {
    return [];
  }
  return [
    { id: "open", label: "Open", value: formatPrice(candle.open) },
    { id: "high", label: "High", value: formatPrice(candle.high) },
    { id: "low", label: "Low", value: formatPrice(candle.low) },
    { id: "close", label: "Close", value: formatPrice(candle.close), tone: candle.direction }
  ];
};

export const buildHoverSnapshot = (
  context: MarketChartHoverContext,
  extensionRows: MarketChartHoverRow[] = []
): MarketChartHoverSnapshot => {
  const lowerRows = context.lowerPoints.map((point) => ({
    id: `lower:${point.kind}:${point.timestampMs}`,
    label: point.label ?? point.kind,
    value: point.value.toLocaleString(),
    tone: point.direction
  }));
  const overlayRows = context.overlayPoints.map((point) => ({
    id: `overlay:${point.timestampMs}:${point.label ?? "point"}`,
    label: point.label ?? "Overlay",
    value:
      typeof point.price === "number"
        ? formatPrice(point.price)
        : typeof point.value === "number"
          ? point.value.toLocaleString()
          : "active",
    tone: "info" as const
  }));

  return {
    time: context.time,
    timestampMs: context.timestampMs,
    symbol: context.symbol,
    intervalMs: context.intervalMs,
    price: context.candle?.close ?? null,
    candle: context.candle,
    marker: context.marker,
    rows: [...buildCoreHoverRows(context), ...extensionRows],
    lowerRows,
    overlayRows
  };
};
