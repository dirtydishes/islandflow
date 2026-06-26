"use client";

import {
  type EquityCandle,
  type EquityPrint,
  type FlowPacket,
  type InferredDarkEvent,
  type OptionPrint,
  parseOptionContractId,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { type ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildTimeframeToolbarModel,
  buildDirectionalOptionNotionalRows,
  buildFlowContextHoverRows,
  buildLowerPaneSeries,
  DEFAULT_MARKET_CHART_SETTINGS,
  formatIntervalLabel,
  getLowerPaneAvailableData,
  MarketChart,
  MarketChartSettings,
  MarketChartSection,
  resolveLowerPaneMode,
  type MarketChartCandle,
  type MarketChartFlowContextInput,
  type MarketChartHoverRowProvider,
  type MarketChartMarker,
  type MarketChartOptionFlowInput,
  type MarketChartOverlay,
  type MarketChartRange,
  type MarketChartSettingsAction,
  type MarketChartStatus,
  normalizeMarketChartCandles,
  toChartTime,
  useMarketChartSettings
} from "../market-chart";
import { getChartFlowMarkerItems } from "./charts/markers";
import { SUPPORTED_CANDLE_INTERVAL_MS } from "./config";
import {
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  statusLabel
} from "./format";
import { extractUnderlying, normalizeContractId } from "./state-helpers";
import type { TerminalState } from "./state";
import { buildApiUrl, readErrorDetail } from "./transport";
import type { TapeMode, WsStatus } from "./types";
import { formatTime } from "./components/ui-helpers";

export type TerminalMarketChartMarkerPayload =
  | { kind: "smart-flow"; projection: SmartFlowExplainabilityProjection }
  | { kind: "inferred-dark"; event: InferredDarkEvent };

type TerminalChartFetchState = {
  candles: EquityCandle[];
  status: WsStatus;
  lastUpdate: number | null;
  error: string | null;
};

const EMPTY_FETCH_STATE: TerminalChartFetchState = {
  candles: [],
  status: "connecting",
  lastUpdate: null,
  error: null
};

const terminalCandleSignature = (candle: EquityCandle): unknown[] => [
  candle.trace_id,
  candle.seq,
  candle.ts,
  candle.interval_ms,
  candle.underlying_id,
  candle.open,
  candle.high,
  candle.low,
  candle.close,
  candle.volume,
  candle.trade_count,
  candle.ingest_ts
];

const terminalChartFetchStateSignature = (state: TerminalChartFetchState): string =>
  JSON.stringify([
    state.status,
    state.lastUpdate ?? "",
    state.error ?? "",
    state.candles.map(terminalCandleSignature)
  ]);

const terminalChartFetchStatesEqual = (
  current: TerminalChartFetchState,
  next: TerminalChartFetchState
): boolean => terminalChartFetchStateSignature(current) === terminalChartFetchStateSignature(next);

const MAX_DARK_MARKERS = 120;
const MAX_TOTAL_MARKERS = 320;
const OFF_EXCHANGE_OVERLAY_COLOR = "rgba(77, 163, 255, 0.58)";

const getChartSettingsStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const sortByTsSeq = <T extends { ts?: number; source_ts?: number; seq: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const aTs = a.ts ?? a.source_ts ?? 0;
    const bTs = b.ts ?? b.source_ts ?? 0;
    const tsDelta = aTs - bTs;
    if (tsDelta !== 0) {
      return tsDelta;
    }
    return a.seq - b.seq;
  });

const matchesChartTicker = (value: string | null | undefined, chartTicker: string): boolean =>
  value ? value.toUpperCase() === chartTicker.toUpperCase() : false;

const getFlowPacketUnderlying = (packet: FlowPacket): string | null => {
  const explicitUnderlying = packet.features.underlying_id;
  if (typeof explicitUnderlying === "string" && explicitUnderlying.trim().length > 0) {
    return explicitUnderlying.toUpperCase();
  }

  const featureContract = packet.features.option_contract_id;
  if (typeof featureContract === "string" && featureContract.trim().length > 0) {
    return extractUnderlying(normalizeContractId(featureContract));
  }

  const packetContract = packet.id.match(/^flowpacket:([^:]+):/)?.[1] ?? packet.id;
  return extractUnderlying(normalizeContractId(packetContract));
};

const getOptionPrintUnderlying = (print: OptionPrint): string | null => {
  if (print.underlying_id) {
    return print.underlying_id.toUpperCase();
  }
  return extractUnderlying(normalizeContractId(print.option_contract_id));
};

type TerminalOptionRight = "call" | "put";

const normalizeOptionRight = (
  value: string | null | undefined,
  contractId?: string | null
): TerminalOptionRight | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "call" || normalized === "c") {
    return "call";
  }
  if (normalized === "put" || normalized === "p") {
    return "put";
  }

  const parsed = parseOptionContractId(contractId ?? undefined);
  if (parsed?.right === "C") {
    return "call";
  }
  if (parsed?.right === "P") {
    return "put";
  }
  return null;
};

const optionSideToHoverDirection = (
  side: string | null | undefined,
  optionRight: TerminalOptionRight | null
): MarketChartOptionFlowInput["direction"] => {
  const buySide = side === "AA" || side === "A";
  const sellSide = side === "B" || side === "BB";
  if (!optionRight || (!buySide && !sellSide)) {
    return "unknown";
  }
  if (optionRight === "call") {
    return buySide ? "bullish" : "bearish";
  }
  return buySide ? "bearish" : "bullish";
};

const featureNumber = (
  features: Record<string, string | number | boolean>,
  keys: readonly string[]
): number | null => {
  for (const key of keys) {
    const value = features[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
};

const featureString = (
  features: Record<string, string | number | boolean>,
  keys: readonly string[]
): string | null => {
  for (const key of keys) {
    const value = features[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
};

const flowPacketHoverDirection = (packet: FlowPacket): MarketChartOptionFlowInput["direction"] => {
  const explicitDirection = featureString(packet.features, [
    "direction",
    "primary_direction",
    "flow_direction",
    "smart_flow_direction"
  ]);
  if (
    explicitDirection === "bullish" ||
    explicitDirection === "bearish" ||
    explicitDirection === "neutral"
  ) {
    return explicitDirection;
  }
  return optionSideToHoverDirection(
    featureString(packet.features, ["execution_nbbo_side", "nbbo_side", "side"]),
    normalizeOptionRight(
      featureString(packet.features, ["option_type", "option_right", "right"]),
      featureString(packet.features, ["option_contract_id", "contract_id"])
    )
  );
};

const flowPacketHoverNotional = (packet: FlowPacket): number | null =>
  featureNumber(packet.features, ["total_notional", "notional", "total_premium", "premium"]);

const toOptionFlowHoverInputs = (
  flowPackets: readonly FlowPacket[],
  optionPrints: readonly OptionPrint[]
): MarketChartOptionFlowInput[] => [
  ...flowPackets.map((packet) => ({
    timestampMs: packet.source_ts,
    sequence: packet.seq,
    notional: flowPacketHoverNotional(packet),
    direction: flowPacketHoverDirection(packet)
  })),
  ...optionPrints.map((print) => ({
    timestampMs: print.source_ts ?? print.ts,
    sequence: print.seq,
    notional: print.notional ?? print.price * print.size * 100,
    price: print.price,
    size: print.size,
    direction: optionSideToHoverDirection(
      print.execution_nbbo_side ?? print.nbbo_side,
      normalizeOptionRight(print.option_type, print.option_contract_id)
    )
  }))
];

const toFlowContextHoverInputs = (
  smartFlowProjections: readonly SmartFlowExplainabilityProjection[]
): MarketChartFlowContextInput[] =>
  smartFlowProjections.map((projection) => ({
    timestampMs: projection.source_ts,
    sequence: projection.seq,
    source: "smart-flow",
    direction: smartFlowDirectionLabel(projection),
    label: smartFlowHypothesisLabel(projection.hypothesis.hypothesis_type),
    evidenceQuality: smartFlowEvidenceQualityLabel(projection.evidence.evidence_quality),
    evidenceScore: projection.evidence.evidence_quality,
    confidence: projection.hypothesis.scores.confidence.policy_confidence,
    whyNot: smartFlowWhyNotLabel(projection),
    abstained: projection.abstention.abstained
  }));

export const buildTerminalMarketChartHoverRowProvider = ({
  smartFlowProjections,
  flowPackets,
  optionPrints
}: {
  smartFlowProjections: readonly SmartFlowExplainabilityProjection[];
  flowPackets: readonly FlowPacket[];
  optionPrints: readonly OptionPrint[];
}): MarketChartHoverRowProvider => {
  const optionFlowInputs = toOptionFlowHoverInputs(flowPackets, optionPrints);
  const flowContextInputs = toFlowContextHoverInputs(smartFlowProjections);

  return (context) => [
    ...buildDirectionalOptionNotionalRows(context, optionFlowInputs),
    ...buildFlowContextHoverRows(context, flowContextInputs)
  ];
};

export const normalizeTerminalChartCandles = (
  candles: readonly EquityCandle[]
): MarketChartCandle[] =>
  normalizeMarketChartCandles(
    sortByTsSeq([...candles]).map((candle) => ({
      ts: candle.ts,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      trade_count: candle.trade_count,
      seq: candle.seq,
      source: candle.underlying_id,
      payload: candle
    }))
  );

export const buildTerminalEquityOverlays = (
  prints: readonly EquityPrint[],
  visible = true
): MarketChartOverlay[] => {
  const points = sortByTsSeq([...prints])
    .filter((print) => print.offExchangeFlag)
    .map((print) => ({
      time: toChartTime(print.ts),
      timestampMs: print.ts,
      price: print.price,
      value: print.size,
      label: `${print.exchange} off-exchange`,
      color: OFF_EXCHANGE_OVERLAY_COLOR,
      payload: print
    }));

  if (points.length === 0) {
    return [];
  }

  return [
    {
      id: "equity-off-exchange",
      label: "Off-exchange prints",
      points,
      visible
    }
  ];
};

export const buildTerminalLowerPaneInput = ({
  chartTicker,
  candles,
  smartFlowProjections,
  flowPackets,
  optionPrints
}: {
  chartTicker: string;
  candles: readonly MarketChartCandle[];
  smartFlowProjections: readonly SmartFlowExplainabilityProjection[];
  flowPackets: readonly FlowPacket[];
  optionPrints: readonly OptionPrint[];
}) => ({
  candles,
  smartFlowProjections,
  flowPackets: flowPackets.filter((packet) =>
    matchesChartTicker(getFlowPacketUnderlying(packet), chartTicker)
  ),
  optionPrints: optionPrints.filter((print) =>
    matchesChartTicker(getOptionPrintUnderlying(print), chartTicker)
  )
});

export const mapTerminalChartStatus = (
  status: WsStatus,
  mode: TapeMode,
  error: string | null
): MarketChartStatus => {
  if (error) {
    return "error";
  }
  if (mode === "replay") {
    return "replay";
  }
  if (status === "connected") {
    return "live";
  }
  if (status === "stale") {
    return "stale";
  }
  if (status === "disconnected") {
    return "offline";
  }
  return "loading";
};

export const getTerminalChartReplayEndTs = (
  mode: TapeMode,
  replayTime: number | null,
  intervalMs: number
): number | null => {
  if (mode !== "replay" || replayTime === null) {
    return null;
  }
  const replayBucket = Math.floor(replayTime / intervalMs);
  return (replayBucket + 1) * intervalMs - 1;
};

export const buildTerminalMarketChartMarkers = ({
  smartFlowProjections,
  inferredDark,
  visibleRangeMs
}: {
  smartFlowProjections: readonly SmartFlowExplainabilityProjection[];
  inferredDark: readonly InferredDarkEvent[];
  visibleRangeMs: MarketChartRange | null;
}): MarketChartMarker<TerminalMarketChartMarkerPayload>[] => {
  if (!visibleRangeMs) {
    return [];
  }

  const markers: MarketChartMarker<TerminalMarketChartMarkerPayload>[] = [];
  const flowMarkerItems = getChartFlowMarkerItems(smartFlowProjections, visibleRangeMs);

  for (const item of flowMarkerItems) {
    const { projection } = item;
    const direction = smartFlowDirectionTone(projection);
    markers.push({
      id: `smart-flow:${projection.refs.hypothesis_id}:${projection.seq}`,
      time: toChartTime(projection.source_ts),
      label: projection.abstention.abstained ? "ABS" : "HYP",
      title: "Smart-flow hypothesis",
      direction,
      position: direction === "bullish" ? "belowBar" : "aboveBar",
      color:
        direction === "bullish"
          ? "#25c17a"
          : direction === "bearish"
            ? "#ff6b5f"
            : "rgba(144, 160, 178, 0.9)",
      shape: direction === "bullish" ? "arrowUp" : direction === "bearish" ? "arrowDown" : "circle",
      payload: { kind: "smart-flow", projection }
    });
  }

  const inRangeDark = sortByTsSeq(
    inferredDark.filter(
      (event) => event.source_ts >= visibleRangeMs.from && event.source_ts <= visibleRangeMs.to
    )
  );
  const cappedDark =
    inRangeDark.length > MAX_DARK_MARKERS
      ? inRangeDark.slice(inRangeDark.length - MAX_DARK_MARKERS)
      : inRangeDark;

  for (const event of cappedDark) {
    markers.push({
      id: `dark:${event.trace_id}:${event.seq}`,
      time: toChartTime(event.source_ts),
      label: "D",
      title: "Inferred dark evidence",
      direction: "neutral",
      position: "aboveBar",
      color: "rgba(31, 74, 123, 0.9)",
      shape: "square",
      payload: { kind: "inferred-dark", event }
    });
  }

  markers.sort((a, b) => {
    const delta = Number(a.time) - Number(b.time);
    if (delta !== 0) {
      return delta;
    }
    return a.id.localeCompare(b.id);
  });

  return markers.length > MAX_TOTAL_MARKERS
    ? markers.slice(markers.length - MAX_TOTAL_MARKERS)
    : markers;
};

type TerminalMarketChartSectionProps = {
  state: TerminalState;
  title?: string;
  className?: string;
};

export const TerminalMarketChartSection = memo(
  ({ state, title = "Chart Context", className }: TerminalMarketChartSectionProps) => {
    const settingsStorage = useMemo(() => getChartSettingsStorage(), []);
    const settingsCapabilities = useMemo(
      () => ({
        priceRendererIds: ["candles", "heikin-ashi"],
        lowerPaneModeIds: ["smart-direction", "all-flow", "volume"],
        supportedIntervalMs: SUPPORTED_CANDLE_INTERVAL_MS,
        showOverlaySettings: true,
        showSmartFlowMarkerSettings: true,
        showInferredDarkMarkerSettings: true
      }),
      []
    );
    const { settings, dispatch: dispatchSettings } = useMarketChartSettings({
      storage: settingsStorage,
      capabilities: settingsCapabilities,
      supportedIntervalMs: SUPPORTED_CANDLE_INTERVAL_MS,
      initialSettings: {
        ...DEFAULT_MARKET_CHART_SETTINGS,
        timeframes: {
          ...DEFAULT_MARKET_CHART_SETTINGS.timeframes,
          intervalMs: state.chartIntervalMs
        }
      }
    });
    const [visibleRangeMs, setVisibleRangeMs] = useState<MarketChartRange | null>(null);
    const [overlayRangePrints, setOverlayRangePrints] = useState<EquityPrint[]>([]);
    const [fetchState, setFetchState] = useState<TerminalChartFetchState>({
      ...EMPTY_FETCH_STATE,
      status: state.mode === "live" ? "connecting" : "connected"
    });
    const overlayAbortRef = useRef<AbortController | null>(null);
    const setFetchStateIfChanged = useCallback((next: TerminalChartFetchState) => {
      setFetchState((current) => (terminalChartFetchStatesEqual(current, next) ? current : next));
    }, []);

    const timeframeModel = useMemo(
      () =>
        buildTimeframeToolbarModel({
          selectedIntervalMs: state.chartIntervalMs,
          favoriteIds: settings.timeframes.favoriteIds,
          supportedIntervalMs: SUPPORTED_CANDLE_INTERVAL_MS
        }),
      [state.chartIntervalMs, settings.timeframes.favoriteIds]
    );
    const selectedTimeframe = timeframeModel.selected;
    const normalizedChartIntervalMs = selectedTimeframe.ms;

    useEffect(() => {
      if (state.chartIntervalMs !== normalizedChartIntervalMs) {
        state.setChartIntervalMs(normalizedChartIntervalMs);
      }
    }, [state, normalizedChartIntervalMs]);

    useEffect(() => {
      if (settings.timeframes.intervalMs !== normalizedChartIntervalMs) {
        dispatchSettings({ type: "set-interval", intervalMs: normalizedChartIntervalMs });
      }
    }, [dispatchSettings, normalizedChartIntervalMs, settings.timeframes.intervalMs]);

    const handleSettingsAction = useCallback(
      (action: MarketChartSettingsAction) => {
        dispatchSettings(action);
      },
      [dispatchSettings]
    );

    const handleIntervalSelect = useCallback(
      (event: ChangeEvent<HTMLSelectElement>) => {
        const intervalMs = Number(event.currentTarget.value);
        if (Number.isFinite(intervalMs)) {
          state.setChartIntervalMs(intervalMs);
        }
      },
      [state]
    );

    const replayEndTs = useMemo(
      () =>
        getTerminalChartReplayEndTs(
          state.mode,
          state.equities.replayTime,
          normalizedChartIntervalMs
        ),
      [state.equities.replayTime, state.mode, normalizedChartIntervalMs]
    );

    useEffect(() => {
      let active = true;
      const abort = new AbortController();
      setFetchStateIfChanged({
        candles: [],
        status: state.mode === "live" ? "connecting" : "connected",
        lastUpdate: null,
        error: null
      });
      setOverlayRangePrints([]);

      const fetchCandles = async () => {
        try {
          const url = new URL(buildApiUrl("/candles/equities"));
          url.searchParams.set("underlying_id", state.chartTicker);
          url.searchParams.set("interval_ms", normalizedChartIntervalMs.toString());
          url.searchParams.set("limit", "300");
          url.searchParams.set("cache", "1");
          if (state.mode === "replay" && replayEndTs !== null) {
            url.searchParams.set("end_ts", replayEndTs.toString());
          }
          const response = await fetch(url.toString(), { signal: abort.signal });
          if (!response.ok) {
            const detail = await readErrorDetail(response);
            throw new Error(
              `Candle fetch failed (${response.status})${detail ? `: ${detail}` : ""}`
            );
          }
          const payload = (await response.json()) as { data?: EquityCandle[] };
          if (!active) {
            return;
          }
          const candles = sortByTsSeq(payload.data ?? []);
          const last = candles.at(-1);
          setFetchStateIfChanged({
            candles,
            status: "connected",
            lastUpdate: last ? (last.ingest_ts ?? last.ts) : null,
            error: null
          });
        } catch (error) {
          if (!active || (error instanceof DOMException && error.name === "AbortError")) {
            return;
          }
          setFetchStateIfChanged({
            candles: [],
            status: "disconnected",
            lastUpdate: null,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };

      void fetchCandles();

      return () => {
        active = false;
        abort.abort();
      };
    }, [
      state.chartTicker,
      state.mode,
      normalizedChartIntervalMs,
      replayEndTs,
      setFetchStateIfChanged
    ]);

    useEffect(() => {
      if (state.mode !== "live") {
        return;
      }
      const candles = sortByTsSeq(state.liveSession.chartCandles);
      if (candles.length === 0) {
        return;
      }
      const last = candles.at(-1);
      setFetchStateIfChanged({
        candles,
        status: state.liveSession.status,
        lastUpdate: last ? (last.ingest_ts ?? last.ts) : state.liveSession.lastUpdate,
        error: null
      });
    }, [
      state.liveSession.chartCandles,
      state.liveSession.lastUpdate,
      state.liveSession.status,
      state.mode,
      setFetchStateIfChanged
    ]);

    useEffect(() => {
      overlayAbortRef.current?.abort();
      if (!visibleRangeMs || !settings.display.showOverlays) {
        setOverlayRangePrints([]);
        return;
      }

      const abort = new AbortController();
      overlayAbortRef.current = abort;
      const timer = window.setTimeout(() => {
        const url = new URL(buildApiUrl("/prints/equities/range"));
        url.searchParams.set("underlying_id", state.chartTicker);
        url.searchParams.set("start_ts", Math.floor(visibleRangeMs.from).toString());
        url.searchParams.set("end_ts", Math.floor(visibleRangeMs.to).toString());
        url.searchParams.set("limit", "1000");

        void fetch(url.toString(), { signal: abort.signal })
          .then(async (response) => {
            if (!response.ok) {
              const detail = await readErrorDetail(response);
              throw new Error(
                `Equity range fetch failed (${response.status})${detail ? `: ${detail}` : ""}`
              );
            }
            return (await response.json()) as { data?: EquityPrint[] };
          })
          .then((payload) => {
            if (!abort.signal.aborted) {
              setOverlayRangePrints(payload.data ?? []);
            }
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            console.warn("Overlay fetch failed", error);
          });
      }, 180);

      return () => {
        window.clearTimeout(timer);
        abort.abort();
      };
    }, [settings.display.showOverlays, state.chartTicker, visibleRangeMs]);

    const normalizedCandles = useMemo(
      () => normalizeTerminalChartCandles(fetchState.candles),
      [fetchState.candles]
    );
    const overlays = useMemo(
      () =>
        buildTerminalEquityOverlays(
          state.mode === "live"
            ? [...overlayRangePrints, ...state.liveSession.chartOverlay]
            : overlayRangePrints,
          settings.display.showOverlays
        ),
      [
        overlayRangePrints,
        settings.display.showOverlays,
        state.liveSession.chartOverlay,
        state.mode
      ]
    );
    const markers = useMemo(() => {
      const allMarkers = buildTerminalMarketChartMarkers({
        smartFlowProjections: state.chartSmartFlowProjections,
        inferredDark: state.chartInferredDark,
        visibleRangeMs
      });
      return allMarkers.filter((marker) => {
        const payload = marker.payload as TerminalMarketChartMarkerPayload | undefined;
        if (payload?.kind === "smart-flow") {
          return settings.display.showSmartFlowMarkers;
        }
        if (payload?.kind === "inferred-dark") {
          return settings.display.showInferredDarkMarkers;
        }
        return true;
      });
    }, [
      settings.display.showInferredDarkMarkers,
      settings.display.showSmartFlowMarkers,
      state.chartSmartFlowProjections,
      state.chartInferredDark,
      visibleRangeMs
    ]);
    const lowerPaneInput = useMemo(
      () =>
        buildTerminalLowerPaneInput({
          chartTicker: state.chartTicker,
          candles: normalizedCandles,
          smartFlowProjections: state.chartSmartFlowProjections,
          flowPackets: state.flow.items as readonly FlowPacket[],
          optionPrints: state.options.items as readonly OptionPrint[]
        }),
      [
        normalizedCandles,
        state.chartTicker,
        state.chartSmartFlowProjections,
        state.flow.items,
        state.options.items
      ]
    );
    const lowerPaneAvailableData = useMemo(
      () => getLowerPaneAvailableData(lowerPaneInput),
      [lowerPaneInput]
    );
    const resolvedLowerPaneMode = useMemo(
      () => resolveLowerPaneMode(settings, lowerPaneAvailableData),
      [lowerPaneAvailableData, settings]
    );
    const lowerSeries = useMemo(
      () => buildLowerPaneSeries(resolvedLowerPaneMode, lowerPaneInput),
      [lowerPaneInput, resolvedLowerPaneMode]
    );
    const chartHoverRows = useMemo(
      () => [buildTerminalMarketChartHoverRowProvider(lowerPaneInput)],
      [lowerPaneInput]
    );
    const chartRegistry = useMemo(
      () => ({
        hoverRows: chartHoverRows
      }),
      [chartHoverRows]
    );
    const chartSettings = useMemo(
      () => ({
        ...settings,
        timeframes: {
          ...settings.timeframes,
          intervalMs: normalizedChartIntervalMs
        },
        display: {
          ...settings.display,
          density: "dense" as const
        },
        lowerPane: {
          ...settings.lowerPane,
          mode: resolvedLowerPaneMode,
          activeLayerId: resolvedLowerPaneMode
        }
      }),
      [normalizedChartIntervalMs, resolvedLowerPaneMode, settings]
    );
    const status = state.mode === "live" ? state.liveSession.status : fetchState.status;
    const marketChartStatus = mapTerminalChartStatus(status, state.mode, fetchState.error);
    const hasData = normalizedCandles.length > 0;
    const lastUpdate =
      state.mode === "live"
        ? (fetchState.lastUpdate ?? state.liveSession.lastUpdate)
        : fetchState.lastUpdate;
    const favoriteLabel = selectedTimeframe.favorite
      ? `Remove ${selectedTimeframe.label} from favorite intervals`
      : `Add ${selectedTimeframe.label} to favorite intervals`;
    const intervalLabel = formatIntervalLabel(normalizedChartIntervalMs);
    const emptyLabel =
      state.mode === "live"
        ? `No ${intervalLabel} candles yet.`
        : `No ${intervalLabel} replay candles.`;

    const handleMarkerClick = useCallback(
      (marker: MarketChartMarker) => {
        const payload = marker.payload as TerminalMarketChartMarkerPayload | undefined;
        if (!payload) {
          return;
        }
        if (payload.kind === "smart-flow") {
          state.handleSmartFlowMarkerClick(payload.projection);
        } else {
          state.handleDarkMarkerClick(payload.event);
        }
      },
      [state]
    );

    return (
      <MarketChartSection
        className={className}
        title={title}
        meta={
          <div className="chart-meta terminal-chart-meta">
            <div className={`chart-status chart-status-${status}`}>
              <span className="chart-dot" />
              <span>{statusLabel(status, false, state.mode)}</span>
            </div>
            <span className="chart-meta-time">
              {lastUpdate ? `Updated ${formatTime(lastUpdate)}` : "Waiting for data"}
            </span>
          </div>
        }
        actions={
          <div className="chart-controls terminal-chart-controls">
            <div className="chart-intervals" aria-label="Favorite chart intervals">
              {timeframeModel.toolbarItems.map((interval) => (
                <button
                  key={interval.ms}
                  className={`interval-button${interval.ms === normalizedChartIntervalMs ? " active" : ""}`}
                  type="button"
                  onClick={() => state.setChartIntervalMs(interval.ms)}
                  aria-pressed={interval.ms === normalizedChartIntervalMs}
                  title={`${interval.label} candles`}
                >
                  {interval.label}
                </button>
              ))}
            </div>
            <label className="timeframe-dropdown-label">
              <span className="sr-only">Chart interval</span>
              <select
                className="timeframe-dropdown"
                value={selectedTimeframe.ms}
                onChange={handleIntervalSelect}
                aria-label="Chart interval"
              >
                {timeframeModel.dropdownItems.map((interval) => (
                  <option key={interval.ms} value={interval.ms} disabled={interval.disabled}>
                    {interval.dropdownLabel}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`timeframe-favorite-toggle${selectedTimeframe.favorite ? " is-active" : ""}`}
              type="button"
              aria-label={favoriteLabel}
              aria-pressed={selectedTimeframe.favorite}
              title={favoriteLabel}
              onClick={() =>
                handleSettingsAction({
                  type: "toggle-timeframe-favorite",
                  id: selectedTimeframe.id
                })
              }
            >
              <span aria-hidden="true">{selectedTimeframe.favorite ? "★" : "☆"}</span>
            </button>
            <button
              className={`overlay-toggle${settings.display.showOverlays ? " overlay-toggle-on" : ""}`}
              type="button"
              aria-pressed={settings.display.showOverlays}
              title="Toggle off-exchange print overlay"
              onClick={() =>
                handleSettingsAction({
                  type: "set-display",
                  key: "showOverlays",
                  value: !settings.display.showOverlays
                })
              }
            >
              Off-Ex {settings.display.showOverlays ? "On" : "Off"}
            </button>
            <MarketChartSettings
              settings={settings}
              availableData={lowerPaneAvailableData}
              timeframeItems={timeframeModel.dropdownItems}
              capabilities={settingsCapabilities}
              onAction={handleSettingsAction}
            />
            <span className="chart-hint">{state.chartTicker}</span>
          </div>
        }
      >
        <div className="chart-panel terminal-market-chart-panel">
          <MarketChart
            symbol={state.chartTicker}
            intervalMs={normalizedChartIntervalMs}
            candles={normalizedCandles}
            lowerSeries={lowerSeries}
            markers={markers}
            overlays={overlays}
            settings={chartSettings}
            status={marketChartStatus}
            replayTime={state.equities.replayTime}
            layoutPreset="dashboard"
            registry={chartRegistry}
            onVisibleRangeChange={setVisibleRangeMs}
            onMarkerClick={handleMarkerClick}
          />
          {fetchState.error ? (
            <div className="empty chart-empty">Chart error: {fetchState.error}</div>
          ) : !hasData ? (
            <div className="empty chart-empty">{emptyLabel}</div>
          ) : null}
        </div>
      </MarketChartSection>
    );
  }
);

TerminalMarketChartSection.displayName = "TerminalMarketChartSection";
