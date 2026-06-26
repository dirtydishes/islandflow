import type {
  MarketChartCandle,
  MarketChartCandleInput,
  MarketChartCandlestickData,
  MarketChartPriceModeId,
  MarketChartPriceRendererDefinition
} from "../types";
import { toChartTime } from "./time";

const toOptionalNumber = (value: number | null | undefined): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const deriveCandleDirection = (
  open: number,
  close: number
): MarketChartCandle["direction"] => {
  if (close > open) {
    return "bullish";
  }
  if (close < open) {
    return "bearish";
  }
  return "neutral";
};

export const normalizeMarketChartCandle = (candle: MarketChartCandleInput): MarketChartCandle => {
  return {
    time: toChartTime(candle.ts),
    timestampMs: candle.ts,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: toOptionalNumber(candle.volume),
    notional: toOptionalNumber(candle.notional),
    tradeCount: toOptionalNumber(candle.tradeCount ?? candle.trade_count),
    direction: deriveCandleDirection(candle.open, candle.close),
    sequence: toOptionalNumber(candle.seq),
    source: candle.source ?? undefined,
    payload: candle.payload
  };
};

const isRenderableCandle = (candle: MarketChartCandle): boolean =>
  [candle.timestampMs, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
  candle.high >= candle.low;

const compareCandlesForChart = (a: MarketChartCandle, b: MarketChartCandle): number => {
  const timeDelta = a.time - b.time;
  if (timeDelta !== 0) {
    return timeDelta;
  }

  const timestampDelta = a.timestampMs - b.timestampMs;
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return (a.sequence ?? 0) - (b.sequence ?? 0);
};

export const normalizeMarketChartCandles = (
  candles: MarketChartCandleInput[]
): MarketChartCandle[] => {
  const candlesByTime = new Map<MarketChartCandle["time"], MarketChartCandle>();
  const normalized = candles
    .map(normalizeMarketChartCandle)
    .filter(isRenderableCandle)
    .sort(compareCandlesForChart);

  for (const candle of normalized) {
    candlesByTime.set(candle.time, candle);
  }

  return [...candlesByTime.values()];
};

export const toCandlestickData = (
  candle: Pick<MarketChartCandle, "time" | "open" | "high" | "low" | "close">
): MarketChartCandlestickData => {
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close
  };
};

export const toCandlestickSeriesData = (
  candles: Pick<MarketChartCandle, "time" | "open" | "high" | "low" | "close">[]
): MarketChartCandlestickData[] => {
  return candles.map(toCandlestickData);
};

export const toChartCandle = (candle: MarketChartCandleInput): MarketChartCandlestickData => {
  return toCandlestickData(normalizeMarketChartCandle(candle));
};

export const toHeikinAshiCandles = (candles: readonly MarketChartCandle[]): MarketChartCandle[] => {
  const next: MarketChartCandle[] = [];

  for (const candle of candles) {
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const previous = next.at(-1);
    const open = previous ? (previous.open + previous.close) / 2 : (candle.open + candle.close) / 2;
    const high = Math.max(candle.high, open, close);
    const low = Math.min(candle.low, open, close);

    next.push({
      ...candle,
      open,
      high,
      low,
      close,
      direction: deriveCandleDirection(open, close)
    });
  }

  return next;
};

export type MarketChartPriceModeDefinition = MarketChartPriceRendererDefinition & {
  id: MarketChartPriceModeId;
  transform: (candles: readonly MarketChartCandle[]) => MarketChartCandle[];
};

export const MARKET_CHART_PRICE_MODE_REGISTRY = [
  {
    id: "candles",
    label: "Candles",
    kind: "candles",
    description: "Standard OHLC candles.",
    defaultRenderer: { series: "candlestick" },
    transform: (candles) => [...candles]
  },
  {
    id: "heikin-ashi",
    label: "Heikin Ashi",
    kind: "heikin-ashi",
    description: "Smoothed OHLC candles.",
    defaultRenderer: { series: "candlestick" },
    transform: toHeikinAshiCandles
  }
] as const satisfies readonly MarketChartPriceModeDefinition[];

export const resolvePriceMode = (rendererId: string): MarketChartPriceModeDefinition => {
  return (
    MARKET_CHART_PRICE_MODE_REGISTRY.find((definition) => definition.id === rendererId) ??
    MARKET_CHART_PRICE_MODE_REGISTRY[0]
  );
};
