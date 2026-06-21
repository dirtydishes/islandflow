import type {
  MarketChartCandle,
  MarketChartCandleInput,
  MarketChartCandlestickData
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

export const normalizeMarketChartCandles = (
  candles: MarketChartCandleInput[]
): MarketChartCandle[] => {
  return candles.map(normalizeMarketChartCandle);
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
