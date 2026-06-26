import { DEFAULT_MARKET_CHART_THEME } from "../defaults";
import type {
  MarketChartCandle,
  MarketChartHistogramData,
  MarketChartLowerLayer,
  MarketChartLowerPaneAvailableData,
  MarketChartLowerPaneDefinition,
  MarketChartLowerPaneModeId,
  MarketChartLowerPoint,
  MarketChartLowerSeries,
  MarketChartThemeOptions
} from "../types";

export type MarketChartLowerPaneBucket = Pick<MarketChartCandle, "time" | "timestampMs"> & {
  startMs?: number;
  endMs?: number;
};

export type SmartDirectionProjectionInput = {
  source_ts: number;
  seq?: number;
  notional?: number | null;
  total_notional?: number | null;
  value?: number | null;
  hypothesis?: {
    direction?: string | null;
    scores?: {
      evidence_strength?: number | null;
      fit_score?: number | null;
      confidence?: {
        conviction?: number | null;
      } | null;
    } | null;
  } | null;
  abstention?: {
    abstained?: boolean | null;
  } | null;
};

export type AllFlowPacketInput = {
  source_ts: number;
  seq?: number;
  features?: Record<string, string | number | boolean> | null;
};

export type AllFlowOptionPrintInput = {
  ts: number;
  source_ts?: number;
  seq?: number;
  price?: number;
  size?: number;
  notional?: number | null;
};

export type MarketChartLowerPaneTransformInput = {
  candles: readonly MarketChartCandle[];
  buckets?: readonly MarketChartLowerPaneBucket[];
  smartFlowProjections?: readonly SmartDirectionProjectionInput[];
  flowPackets?: readonly AllFlowPacketInput[];
  optionPrints?: readonly AllFlowOptionPrintInput[];
};

export type MarketChartLowerPaneModeDefinition = MarketChartLowerPaneDefinition & {
  id: MarketChartLowerPaneModeId;
  transform: (input: MarketChartLowerPaneTransformInput) => MarketChartLowerLayer;
};

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

const normalizeDirection = (
  value: string | null | undefined
): MarketChartLowerPoint["direction"] => {
  if (value === "bullish" || value === "bearish") {
    return value;
  }
  return "neutral";
};

const directionSign = (direction: MarketChartLowerPoint["direction"]): number => {
  if (direction === "bearish") {
    return -1;
  }
  if (direction === "bullish") {
    return 1;
  }
  return 0;
};

const directionFromSignedValue = (value: number): MarketChartLowerPoint["direction"] => {
  if (value > 0) {
    return "bullish";
  }
  if (value < 0) {
    return "bearish";
  }
  return "neutral";
};

const toFinitePositive = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
};

const getFeatureNumber = (
  features: Record<string, string | number | boolean> | null | undefined,
  keys: readonly string[]
): number | null => {
  if (!features) {
    return null;
  }
  for (const key of keys) {
    const value = toFinitePositive(features[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
};

const projectionMagnitude = (projection: SmartDirectionProjectionInput): number => {
  return (
    toFinitePositive(projection.notional) ??
    toFinitePositive(projection.total_notional) ??
    toFinitePositive(projection.value) ??
    toFinitePositive(projection.hypothesis?.scores?.evidence_strength) ??
    toFinitePositive(projection.hypothesis?.scores?.fit_score) ??
    toFinitePositive(projection.hypothesis?.scores?.confidence?.conviction) ??
    1
  );
};

const allFlowPacketMagnitude = (packet: AllFlowPacketInput): number => {
  return (
    getFeatureNumber(packet.features, ["total_notional", "notional", "total_premium", "premium"]) ??
    0
  );
};

const optionPrintMagnitude = (print: AllFlowOptionPrintInput): number => {
  return toFinitePositive(print.notional) ?? (print.price ?? 0) * (print.size ?? 0) * 100;
};

const toBuckets = (
  buckets: readonly MarketChartLowerPaneBucket[] | undefined,
  candles: readonly MarketChartCandle[]
): MarketChartLowerPaneBucket[] => {
  const source = buckets?.length ? buckets : candles;
  return [...source].sort((a, b) => a.timestampMs - b.timestampMs);
};

const inferBucketEnd = (
  bucket: MarketChartLowerPaneBucket,
  next: MarketChartLowerPaneBucket | undefined,
  previous: MarketChartLowerPaneBucket | undefined
): number => {
  if (typeof bucket.endMs === "number" && Number.isFinite(bucket.endMs)) {
    return bucket.endMs;
  }
  if (next) {
    return next.startMs ?? next.timestampMs;
  }
  const start = bucket.startMs ?? bucket.timestampMs;
  const previousStart = previous?.startMs ?? previous?.timestampMs;
  const inferredWidth =
    typeof previousStart === "number" && start > previousStart ? start - previousStart : 60_000;
  return start + inferredWidth;
};

const bucketRanges = (buckets: readonly MarketChartLowerPaneBucket[]) =>
  buckets.map((bucket, index) => {
    const start = bucket.startMs ?? bucket.timestampMs;
    return {
      bucket,
      start,
      end: inferBucketEnd(bucket, buckets[index + 1], buckets[index - 1])
    };
  });

export const buildVolumeBars = (candles: readonly MarketChartCandle[]): MarketChartLowerLayer => {
  return {
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
        direction: candle.direction,
        label: `${candle.direction} volume`
      }))
  };
};

export const buildSmartDirectionBars = (
  projections: readonly SmartDirectionProjectionInput[],
  buckets: readonly MarketChartLowerPaneBucket[]
): MarketChartLowerLayer => {
  const ranges = bucketRanges(toBuckets(buckets, []));
  const points = ranges.map(({ bucket, start, end }) => {
    const bucketProjections = projections.filter(
      (projection) => projection.source_ts >= start && projection.source_ts < end
    );
    const signed = bucketProjections.reduce((sum, projection) => {
      const direction = projection.abstention?.abstained
        ? "neutral"
        : normalizeDirection(projection.hypothesis?.direction);
      return sum + projectionMagnitude(projection) * directionSign(direction);
    }, 0);
    const direction = directionFromSignedValue(signed);

    return {
      time: bucket.time,
      timestampMs: bucket.timestampMs,
      value: signed,
      kind: "signed-direction" as const,
      direction,
      label: `${direction} flow direction`,
      payload: { source: "smart-flow" }
    };
  });

  return {
    id: "smart-direction",
    label: "Flow Direction",
    kind: "signed-direction",
    priceFormat: "price",
    points
  };
};

export const buildAllFlowBars = (
  flowPackets: readonly AllFlowPacketInput[],
  optionPrints: readonly AllFlowOptionPrintInput[],
  buckets: readonly MarketChartLowerPaneBucket[]
): MarketChartLowerLayer => {
  const ranges = bucketRanges(toBuckets(buckets, []));
  const points = ranges.map(({ bucket, start, end }) => {
    const packetTotal = flowPackets
      .filter((packet) => packet.source_ts >= start && packet.source_ts < end)
      .reduce((sum, packet) => sum + allFlowPacketMagnitude(packet), 0);
    const printTotal = optionPrints
      .filter((print) => {
        const ts = print.source_ts ?? print.ts;
        return ts >= start && ts < end;
      })
      .reduce((sum, print) => sum + optionPrintMagnitude(print), 0);
    const value = packetTotal > 0 ? packetTotal : printTotal;

    return {
      time: bucket.time,
      timestampMs: bucket.timestampMs,
      value,
      kind: "notional" as const,
      direction: "neutral" as const,
      label: "all flow notional"
    };
  });

  return {
    id: "all-flow",
    label: "All Flow",
    kind: "notional",
    priceFormat: "price",
    points
  };
};

export const getLowerPaneAvailableData = ({
  candles,
  smartFlowProjections = [],
  flowPackets = [],
  optionPrints = []
}: MarketChartLowerPaneTransformInput): MarketChartLowerPaneAvailableData => ({
  candles: candles.some((candle) => typeof candle.volume === "number"),
  smartDirection: smartFlowProjections.length > 0,
  allFlow: flowPackets.length > 0 || optionPrints.length > 0
});

export const resolveLowerPaneMode = (
  settings: { lowerPane: { mode?: string; activeLayerId?: string } },
  availableData: MarketChartLowerPaneAvailableData
): MarketChartLowerPaneModeId => {
  const requested = settings.lowerPane.mode ?? settings.lowerPane.activeLayerId;
  const requestedDefinition = MARKET_CHART_LOWER_PANE_MODE_REGISTRY.find(
    (definition) => definition.id === requested
  );
  if (requestedDefinition?.isAvailable?.(availableData)) {
    return requestedDefinition.id;
  }
  if (availableData.smartDirection) {
    return "smart-direction";
  }
  if (availableData.allFlow) {
    return "all-flow";
  }
  return "volume";
};

export const MARKET_CHART_LOWER_PANE_MODE_REGISTRY = [
  {
    id: "smart-direction",
    label: "Flow Direction",
    supportedKinds: ["signed-direction"],
    defaultVisible: true,
    description: "Directional hypothesis bars from smart-flow.",
    isAvailable: (data) => data.smartDirection,
    transformId: "buildSmartDirectionBars",
    formatter: (value) => value.toLocaleString(),
    defaultRenderer: { series: "rounded-bars", signed: true, priceFormat: "price" },
    transform: (input) =>
      buildSmartDirectionBars(input.smartFlowProjections ?? [], toBuckets(input.buckets, input.candles))
  },
  {
    id: "all-flow",
    label: "All Flow",
    supportedKinds: ["notional"],
    description: "Aggregate flow packet or option print notional by bucket.",
    isAvailable: (data) => data.allFlow,
    transformId: "buildAllFlowBars",
    formatter: (value) => value.toLocaleString(),
    defaultRenderer: { series: "rounded-bars", signed: false, priceFormat: "price" },
    transform: (input) =>
      buildAllFlowBars(
        input.flowPackets ?? [],
        input.optionPrints ?? [],
        toBuckets(input.buckets, input.candles)
      )
  },
  {
    id: "volume",
    label: "Volume",
    supportedKinds: ["volume"],
    defaultVisible: true,
    description: "Equity candle volume by bucket.",
    isAvailable: (data) => data.candles,
    transformId: "buildVolumeBars",
    formatter: (value) => value.toLocaleString(),
    defaultRenderer: { series: "rounded-bars", signed: false, priceFormat: "volume" },
    transform: (input) => buildVolumeBars(input.candles)
  }
] as const satisfies readonly MarketChartLowerPaneModeDefinition[];

export const buildLowerPaneSeries = (
  mode: MarketChartLowerPaneModeId,
  input: MarketChartLowerPaneTransformInput
): MarketChartLowerSeries => {
  const definition =
    MARKET_CHART_LOWER_PANE_MODE_REGISTRY.find((candidate) => candidate.id === mode) ??
    MARKET_CHART_LOWER_PANE_MODE_REGISTRY[0];
  const layer = definition.transform(input);

  return {
    defaultLayerId: layer.id,
    layers: [layer]
  };
};

export const buildVolumeLowerSeries = (candles: MarketChartCandle[]): MarketChartLowerSeries => {
  const layer = buildVolumeBars(candles);
  return {
    defaultLayerId: layer.id,
    layers: [layer]
  };
};
