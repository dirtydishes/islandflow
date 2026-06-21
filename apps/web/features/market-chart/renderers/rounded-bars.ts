import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import { DEFAULT_MARKET_CHART_THEME } from "../defaults";
import { lowerPointColor } from "../transforms/lower-pane";
import type { MarketChartDirection, MarketChartLowerLayer, MarketChartThemeOptions } from "../types";

export type MarketChartRoundedBarData = CustomData<UTCTimestamp> & {
  value: number;
  color: string;
  direction?: MarketChartDirection;
  label?: string;
};

type RoundedBarSeriesOptions = CustomSeriesOptions & {
  barWidthRatio: number;
  maxBarWidth: number;
  radius: number;
};

const DEFAULT_ROUNDED_BAR_OPTIONS: RoundedBarSeriesOptions = {
  ...customSeriesDefaultOptions,
  color: DEFAULT_MARKET_CHART_THEME.tokens.lowerNeutral,
  barWidthRatio: 0.68,
  maxBarWidth: 18,
  radius: 5,
  lastValueVisible: false,
  priceLineVisible: false
};

const isRoundedBarData = (
  data: MarketChartRoundedBarData | CustomSeriesWhitespaceData<UTCTimestamp>
): data is MarketChartRoundedBarData => {
  return typeof (data as MarketChartRoundedBarData).value === "number";
};

const buildRoundedRectPath = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radii: readonly [number, number, number, number]
) => {
  const [topLeft, topRight, bottomRight, bottomLeft] = radii.map((radius) =>
    Math.max(0, Math.min(radius, width / 2, height / 2))
  ) as [number, number, number, number];

  context.beginPath();
  context.moveTo(x + topLeft, y);
  context.lineTo(x + width - topRight, y);
  if (topRight > 0) {
    context.quadraticCurveTo(x + width, y, x + width, y + topRight);
  }
  context.lineTo(x + width, y + height - bottomRight);
  if (bottomRight > 0) {
    context.quadraticCurveTo(x + width, y + height, x + width - bottomRight, y + height);
  }
  context.lineTo(x + bottomLeft, y + height);
  if (bottomLeft > 0) {
    context.quadraticCurveTo(x, y + height, x, y + height - bottomLeft);
  }
  context.lineTo(x, y + topLeft);
  if (topLeft > 0) {
    context.quadraticCurveTo(x, y, x + topLeft, y);
  }
  context.closePath();
};

class RoundedBarPaneRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, MarketChartRoundedBarData> | null = null;
  private options: RoundedBarSeriesOptions = DEFAULT_ROUNDED_BAR_OPTIONS;

  update(data: PaneRendererCustomData<Time, MarketChartRoundedBarData>, options: RoundedBarSeriesOptions) {
    this.data = data;
    this.options = options;
  }

  draw(
    target: Parameters<ICustomSeriesPaneRenderer["draw"]>[0],
    priceConverter: PriceToCoordinateConverter
  ) {
    const data = this.data;
    if (!data?.visibleRange) {
      return;
    }

    const zeroCoordinate = priceConverter(0);
    if (zeroCoordinate === null) {
      return;
    }

    const from = Math.max(0, Math.floor(data.visibleRange.from));
    const to = Math.min(data.bars.length, Math.ceil(data.visibleRange.to));
    const effectiveSpacing = Math.max(1, data.barSpacing * Math.max(1, data.conflationFactor));

    target.useBitmapCoordinateSpace(
      ({ context, horizontalPixelRatio, verticalPixelRatio }) => {
        const width = Math.max(
          2 * horizontalPixelRatio,
          Math.min(
            this.options.maxBarWidth * horizontalPixelRatio,
            effectiveSpacing * this.options.barWidthRatio * horizontalPixelRatio
          )
        );
        const radius = this.options.radius * Math.min(horizontalPixelRatio, verticalPixelRatio);
        const baseline = Math.round(zeroCoordinate * verticalPixelRatio);

        for (let index = from; index < to; index += 1) {
          const item = data.bars[index];
          if (!item) {
            continue;
          }
          const value = item.originalData.value;
          const valueCoordinate = priceConverter(value);
          if (valueCoordinate === null) {
            continue;
          }

          const x = Math.round(item.x * horizontalPixelRatio - width / 2);
          const yValue = Math.round(valueCoordinate * verticalPixelRatio);
          const top = Math.min(yValue, baseline);
          const rawHeight = Math.abs(baseline - yValue);
          const height = Math.max(rawHeight, 2 * verticalPixelRatio);
          const isPositive = value > 0;
          const isNegative = value < 0;
          const radii: [number, number, number, number] = isPositive
            ? [radius, radius, 0, 0]
            : isNegative
              ? [0, 0, radius, radius]
              : [radius, radius, radius, radius];

          context.fillStyle = item.originalData.color;
          buildRoundedRectPath(context, x, top, width, height, radii);
          context.fill();
        }
      }
    );
  }
}

class RoundedBarPaneView
  implements ICustomSeriesPaneView<Time, MarketChartRoundedBarData, RoundedBarSeriesOptions>
{
  private rendererInstance = new RoundedBarPaneRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this.rendererInstance;
  }

  update(
    data: PaneRendererCustomData<Time, MarketChartRoundedBarData>,
    seriesOptions: RoundedBarSeriesOptions
  ): void {
    this.rendererInstance.update(data, seriesOptions);
  }

  priceValueBuilder(plotRow: MarketChartRoundedBarData): CustomSeriesPricePlotValues {
    return plotRow.value >= 0 ? [0, plotRow.value, plotRow.value] : [plotRow.value, 0, plotRow.value];
  }

  isWhitespace(
    data: MarketChartRoundedBarData | CustomSeriesWhitespaceData<Time>
  ): data is CustomSeriesWhitespaceData<Time> {
    return !isRoundedBarData(data as MarketChartRoundedBarData | CustomSeriesWhitespaceData<UTCTimestamp>);
  }

  defaultOptions(): RoundedBarSeriesOptions {
    return DEFAULT_ROUNDED_BAR_OPTIONS;
  }
}

export const createRoundedBarSeriesPaneView = () => new RoundedBarPaneView();

export const toRoundedBarSeriesData = (
  layer: MarketChartLowerLayer,
  theme: MarketChartThemeOptions = DEFAULT_MARKET_CHART_THEME
): MarketChartRoundedBarData[] =>
  layer.points.map((point) => ({
    time: point.time,
    value: point.value,
    color: lowerPointColor(point, theme),
    direction: point.direction,
    label: point.label,
    customValues: {
      kind: point.kind,
      label: point.label,
      direction: point.direction
    }
  }));
