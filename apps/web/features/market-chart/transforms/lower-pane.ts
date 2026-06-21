import { DEFAULT_MARKET_CHART_THEME } from "../defaults";
import type {
  MarketChartCandle,
  MarketChartHistogramData,
  MarketChartLowerLayer,
  MarketChartLowerPoint,
  MarketChartLowerSeries,
  MarketChartThemeOptions
} from "../types";

export const lowerPointColor = (
  point: Pick<MarketChartLowerPoint, "direction" | "color">,
  theme: MarketChartThemeOptions = DEFAULT_MARKET_CHART_THEME
): string => {
  if (point.color) {
    return point.color;
  }
  if (point.direction === "bullish") {
    return theme.tokens.lowerPositive;
  }
  if (point.direction === "bearish") {
    return theme.tokens.lowerNegative;
  }
  return theme.tokens.lowerNeutral;
};

export const toLowerPaneHistogramData = (
  layer: MarketChartLowerLayer,
  theme: MarketChartThemeOptions = DEFAULT_MARKET_CHART_THEME
): MarketChartHistogramData[] => {
  return layer.points.map((point) => ({
    time: point.time,
    value: point.value,
    color: lowerPointColor(point, theme)
  }));
};

export const buildVolumeLowerSeries = (candles: MarketChartCandle[]): MarketChartLowerSeries => {
  return {
    defaultLayerId: "volume",
    layers: [
      {
        id: "volume",
        label: "Volume",
        kind: "volume",
        priceFormat: "volume",
        points: candles
          .filter((candle) => typeof candle.volume === "number")
          .map((candle) => ({
            time: candle.time,
            timestampMs: candle.timestampMs,
            value: candle.volume ?? 0,
            kind: "volume",
            direction: candle.direction
          }))
      }
    ]
  };
};
