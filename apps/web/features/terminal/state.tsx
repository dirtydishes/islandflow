"use client";

import type {
  AlertEvent,
  ClassifierHitEvent,
  DurableTapeAlertRowViewModel,
  DurableTapeOptionRowViewModel,
  DurableTapeRowViewModel,
  EquityPrint,
  EquityPrintJoin,
  FlowPacket,
  InferredDarkEvent,
  LiveSubscription,
  NewsStory,
  OptionFlowFilters,
  OptionNBBO,
  OptionPrint,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import {
  getSubscriptionKey as getLiveSubscriptionKey,
  matchesFlowPacketFilters,
  parseOptionContractId
} from "@islandflow/types";
import * as nextNavigation from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import type { AlertContractFocusRequest, AlertEquityFocusRequest } from "../alerts";
import type { FlowPacketFocusRequest } from "../flow-packets";
import { sortBySourceTime } from "./charts/markers";
import {
  CANDLE_INTERVALS,
  LIVE_HOT_WINDOW_OPTIONS,
  LIVE_OPTIONS_HEAD_LIMIT,
  PINNED_EVIDENCE_MAX_ITEMS
} from "./config";
import { bumpTapeDebugMetric, logTapeDebug } from "./debug";
import {
  getAlertFlowPacketRefs,
  getSmartFlowEvidenceRefs,
  getSmartFlowOptionPrintRefs,
  getSmartFlowPacketRefs,
  getSmartFlowPinnedFlowKeys,
  getSmartFlowPinnedOptionKeys,
  prunePinnedEntries,
  resolveAlertFlowPacket
} from "./evidence";
import {
  buildDefaultFlowFilters,
  buildOptionTapeQueryParams,
  filterOptionTapeItems,
  getEffectiveOptionPrintFilters,
  getOptionScope,
  parseTickerFilterInput,
  shouldClearOptionFocusSeed,
  shouldShowEquitiesSilentFeedWarning
} from "./filters";
import { formatOptionContractLabel, selectPrimaryClassifierHit } from "./format";
import {
  type OptionSupportNbboContext,
  stableHydrationKey,
  stableOptionSupportNbboKey,
  terminalHydrationScheduler
} from "./hydration-scheduler";
import { toStaticTapeState, useLiveSession, usePausableTapeView, useTape } from "./live";
import { getLiveManifest, getRouteFeatures } from "./routes";
import { useListScroll, useScrollAnchor } from "./scroll";
import {
  buildClassifierDecor,
  buildSmartMoneyDecor,
  type ClassifierDecor,
  type DarkEvidenceItem,
  EMPTY_CLASSIFIER_DECOR_BY_OPTION_TRACE_ID,
  EMPTY_CLASSIFIER_HITS_BY_PACKET_ID,
  EMPTY_PACKET_ID_BY_OPTION_TRACE_ID,
  type EvidenceItem,
  extractUnderlying,
  inferDarkUnderlying,
  normalizeContractId,
  normalizeJoinRefCandidates,
  resolveJoinFromRef,
  upsertPinnedEntries
} from "./state-helpers";
import {
  composeTapeItems,
  frontendRetentionMetrics,
  getHotChannelFeedStatus,
  getTapeItemKey,
  incrementRetentionMetric,
  mergeNewest,
  setRetentionMetric
} from "./tape";
import { buildApiUrl, extractReplaySource, readErrorDetail } from "./transport";
import type {
  EquityScope,
  OptionScope,
  PinnedEntry,
  SelectedInstrument,
  TapeFocusSeed,
  TapeMode
} from "./types";

const EMPTY_ALERT_EVENTS: AlertEvent[] = [];
const EMPTY_CLASSIFIER_HIT_EVENTS: ClassifierHitEvent[] = [];
const EMPTY_SMART_FLOW_EXPLAINABILITY: SmartFlowExplainabilityProjection[] = [];
const EMPTY_SMART_MONEY_EVENTS: SmartMoneyEvent[] = [];
const EMPTY_INFERRED_DARK_EVENTS: InferredDarkEvent[] = [];
const EMPTY_NEWS_STORIES: NewsStory[] = [];
const EMPTY_DURABLE_OPTION_ROWS: DurableTapeOptionRowViewModel[] = [];
const EMPTY_DURABLE_ALERT_ROWS: DurableTapeAlertRowViewModel[] = [];

const EMPTY_OPTION_PRINT_MAP = new Map<string, OptionPrint>();
const EMPTY_FLOW_PACKET_MAP = new Map<string, FlowPacket>();

const useLatestRef = <T,>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

export const useTerminalState = () => {
  const pathname = nextNavigation.usePathname();
  const routeFeatures = useMemo(() => getRouteFeatures(pathname), [pathname]);
  const [mode, setMode] = useState<TapeMode>("live");
  const [replaySource, setReplaySource] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertEvent | null>(null);
  const [selectedNewsStory, setSelectedNewsStory] = useState<NewsStory | null>(null);
  const [selectedDarkEvent, setSelectedDarkEvent] = useState<InferredDarkEvent | null>(null);
  const [selectedClassifierHit, setSelectedClassifierHit] = useState<ClassifierHitEvent | null>(
    null
  );
  const [selectedSmartMoneyEvent, setSelectedSmartMoneyEvent] = useState<SmartMoneyEvent | null>(
    null
  );
  const [selectedSmartFlowProjection, setSelectedSmartFlowProjection] =
    useState<SmartFlowExplainabilityProjection | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<SelectedInstrument>(null);
  const [optionFocusSeed, setOptionFocusSeed] = useState<TapeFocusSeed<OptionPrint> | null>(null);
  const [equityFocusSeed, setEquityFocusSeed] = useState<TapeFocusSeed<EquityPrint> | null>(null);
  const [filterInput, setFilterInput] = useState<string>("");
  const [flowFilters, setFlowFilters] = useState<OptionFlowFilters>(() =>
    buildDefaultFlowFilters()
  );
  const [chartIntervalMs, setChartIntervalMs] = useState<number>(CANDLE_INTERVALS[0].ms);
  const activeTickers = useMemo(() => parseTickerFilterInput(filterInput), [filterInput]);
  const tickerSet = useMemo(() => new Set(activeTickers), [activeTickers]);
  const instrumentUnderlying = selectedInstrument?.underlyingId.toUpperCase() ?? null;
  const isOptionContractFocused = selectedInstrument?.kind === "option-contract";
  const focusedOptionContractId =
    selectedInstrument?.kind === "option-contract" ? selectedInstrument.contractId : null;
  const optionFocusScopeKey = focusedOptionContractId
    ? `option-contract:${focusedOptionContractId}`
    : null;
  const equityFocusScopeKey =
    selectedInstrument?.kind === "equity"
      ? `equity:${selectedInstrument.underlyingId.toUpperCase()}`
      : null;
  const effectiveOptionPrintFilters = useMemo(
    () => getEffectiveOptionPrintFilters(flowFilters, isOptionContractFocused),
    [flowFilters, isOptionContractFocused]
  );
  const optionScope = useMemo(
    () => getOptionScope(activeTickers, instrumentUnderlying, selectedInstrument),
    [activeTickers, instrumentUnderlying, selectedInstrument]
  );
  const equityScope = useMemo(
    () => ({
      underlying_ids:
        activeTickers.length > 0
          ? activeTickers
          : instrumentUnderlying
            ? [instrumentUnderlying]
            : undefined
    }),
    [activeTickers, instrumentUnderlying]
  );
  const chartTicker = useMemo(
    () => instrumentUnderlying ?? activeTickers[0] ?? "SPY",
    [activeTickers, instrumentUnderlying]
  );
  const selectedInstrumentLabel = useMemo(() => {
    if (!selectedInstrument) {
      return null;
    }
    if (selectedInstrument.kind === "equity") {
      return `Equity: ${selectedInstrument.underlyingId}`;
    }
    const display = formatOptionContractLabel(selectedInstrument.contractId);
    return display
      ? `Contract: ${display.ticker} ${display.expiration} ${display.strike}`
      : `Contract: ${selectedInstrument.contractId}`;
  }, [selectedInstrument]);
  const liveManifest = useMemo(
    () =>
      getLiveManifest(
        pathname,
        chartTicker.toUpperCase(),
        chartIntervalMs,
        flowFilters,
        optionScope,
        equityScope,
        effectiveOptionPrintFilters
      ),
    [
      pathname,
      chartTicker,
      chartIntervalMs,
      flowFilters,
      optionScope,
      equityScope,
      effectiveOptionPrintFilters
    ]
  );
  const liveSession = useLiveSession(mode === "live", pathname, liveManifest);
  const optionsLastUpdate = liveSession.lastEventByChannel.options ?? null;
  const nbboLastUpdate = liveSession.lastEventByChannel.nbbo ?? null;
  const equitiesLastUpdate = liveSession.lastEventByChannel.equities ?? null;
  const equityJoinsLastUpdate = liveSession.lastEventByChannel["equity-joins"] ?? null;
  const flowLastUpdate = liveSession.lastEventByChannel.flow ?? null;
  const alertsLastUpdate = liveSession.lastEventByChannel.alerts ?? null;
  const durableRowsLastUpdate = liveSession.lastEventByChannel["durable-rows"] ?? null;
  const classifierHitsLastUpdate = liveSession.lastEventByChannel["classifier-hits"] ?? null;
  const smartFlowLastUpdate = liveSession.lastEventByChannel["smart-flow"] ?? null;
  const smartMoneyLastUpdate = liveSession.lastEventByChannel["smart-money"] ?? null;
  const inferredDarkLastUpdate = liveSession.lastEventByChannel["inferred-dark"] ?? null;
  const newsLastUpdate = liveSession.lastEventByChannel.news ?? null;
  const currentOptionSubscription = useMemo(
    () =>
      liveManifest.find(
        (subscription): subscription is Extract<LiveSubscription, { channel: "options" }> =>
          subscription.channel === "options"
      ) ?? null,
    [liveManifest]
  );
  const currentOptionSubscriptionKey = useMemo(
    () => (currentOptionSubscription ? getLiveSubscriptionKey(currentOptionSubscription) : null),
    [currentOptionSubscription]
  );
  const equitiesLiveSubscriptionActive = routeFeatures.equities;

  const handleReplaySource = useCallback((value: string | null) => {
    setReplaySource(value);
  }, []);

  useEffect(() => {
    setReplaySource(null);
  }, [mode]);

  useEffect(() => {
    if (
      !selectedAlert &&
      !selectedNewsStory &&
      !selectedClassifierHit &&
      !selectedDarkEvent &&
      !selectedSmartFlowProjection &&
      !selectedSmartMoneyEvent
    ) {
      return;
    }

    const dismissDrawers = () => {
      setSelectedAlert(null);
      setSelectedNewsStory(null);
      setSelectedClassifierHit(null);
      setSelectedSmartFlowProjection(null);
      setSelectedSmartMoneyEvent(null);
      setSelectedDarkEvent(null);
    };

    const handlePointerDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(".drawer")) {
        return;
      }
      dismissDrawers();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissDrawers();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedAlert,
    selectedNewsStory,
    selectedClassifierHit,
    selectedDarkEvent,
    selectedSmartFlowProjection,
    selectedSmartMoneyEvent
  ]);

  const optionsScroll = useListScroll();
  const equitiesScroll = useListScroll();
  const flowScroll = useListScroll();
  const darkScroll = useListScroll();
  const alertsScroll = useListScroll();
  const classifierScroll = useListScroll();
  const newsScroll = useListScroll();

  const optionsAnchor = useScrollAnchor(optionsScroll.listRef, optionsScroll.isAtTopRef);
  const equitiesAnchor = useScrollAnchor(equitiesScroll.listRef, equitiesScroll.isAtTopRef);
  const flowAnchor = useScrollAnchor(flowScroll.listRef, flowScroll.isAtTopRef);
  const darkAnchor = useScrollAnchor(darkScroll.listRef, darkScroll.isAtTopRef);
  const alertsAnchor = useScrollAnchor(alertsScroll.listRef, alertsScroll.isAtTopRef);
  const classifierAnchor = useScrollAnchor(classifierScroll.listRef, classifierScroll.isAtTopRef);
  const newsAnchor = useScrollAnchor(newsScroll.listRef, newsScroll.isAtTopRef);
  const disableReplayGrouping = useCallback(() => null, []);
  const optionQueryParams = useMemo<Record<string, string | undefined>>(
    () => buildOptionTapeQueryParams(effectiveOptionPrintFilters, optionScope),
    [effectiveOptionPrintFilters, optionScope]
  );

  const options = useTape<OptionPrint>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/options",
    replayPath: "/replay/options",
    latestPath: "/prints/options",
    expectedType: "option-print",
    hotWindowLimit: LIVE_HOT_WINDOW_OPTIONS,
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: optionsAnchor.capture,
    onNewItems: optionsScroll.onNewItems,
    getReplayKey: isOptionContractFocused ? disableReplayGrouping : extractReplaySource,
    onReplaySourceKey: isOptionContractFocused ? undefined : handleReplaySource,
    queryParams: optionQueryParams,
    replaySourceKey: isOptionContractFocused ? null : replaySource
  });

  const equities = useTape<EquityPrint>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/equities",
    replayPath: "/replay/equities",
    latestPath: "/prints/equities",
    expectedType: "equity-print",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: equitiesAnchor.capture,
    onNewItems: equitiesScroll.onNewItems
  });

  useEffect(() => {
    if (isOptionContractFocused && replaySource !== null) {
      setReplaySource(null);
    }
  }, [isOptionContractFocused, replaySource]);

  const equityJoins = useTape<EquityPrintJoin>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/equity-joins",
    replayPath: "/replay/equity-joins",
    latestPath: "/joins/equities",
    expectedType: "equity-join",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    getReplayKey: disableReplayGrouping
  });

  const nbbo = useTape<OptionNBBO>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/options-nbbo",
    replayPath: "/replay/nbbo",
    latestPath: "/nbbo/options",
    expectedType: "option-nbbo",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    getReplayKey: extractReplaySource,
    replaySourceKey: replaySource
  });

  const inferredDark = useTape<InferredDarkEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/inferred-dark",
    replayPath: "/replay/inferred-dark",
    latestPath: "/dark/inferred",
    expectedType: "inferred-dark",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: darkAnchor.capture,
    onNewItems: darkScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });

  const flow = useTape<FlowPacket>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/flow",
    replayPath: "/replay/flow",
    latestPath: "/flow/packets",
    expectedType: "flow-packet",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: flowAnchor.capture,
    onNewItems: flowScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const alerts = useTape<AlertEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/alerts",
    replayPath: "/replay/alerts",
    latestPath: "/flow/alerts",
    expectedType: "alert",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: alertsAnchor.capture,
    onNewItems: alertsScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const classifierHits = useTape<ClassifierHitEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/classifier-hits",
    replayPath: "/replay/classifier-hits",
    latestPath: "/flow/classifier-hits",
    expectedType: "classifier-hit",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: classifierAnchor.capture,
    onNewItems: classifierScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const smartFlow = useTape<SmartFlowExplainabilityProjection>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/smart-flow",
    replayPath: "/replay/smart-flow",
    latestPath: "/flow/smart-flow",
    expectedType: "smart-flow",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: classifierAnchor.capture,
    onNewItems: classifierScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });
  const smartMoney = useTape<SmartMoneyEvent>({
    mode,
    liveEnabled: false,
    wsPath: "/ws/smart-money",
    replayPath: "/replay/smart-money",
    latestPath: "/flow/smart-money",
    expectedType: "smart-money",
    batchSize: mode === "replay" ? 120 : undefined,
    pollMs: mode === "replay" ? 200 : undefined,
    captureScroll: classifierAnchor.capture,
    onNewItems: classifierScroll.onNewItems,
    getReplayKey: disableReplayGrouping
  });

  const optionsChannelStatus = getHotChannelFeedStatus(
    liveSession.status,
    liveSession.channelHealth.options
  );
  const equitiesChannelStatus = getHotChannelFeedStatus(
    liveSession.status,
    liveSession.channelHealth.equities
  );
  const flowChannelStatus = getHotChannelFeedStatus(
    liveSession.status,
    liveSession.channelHealth.flow
  );

  const liveOptions = usePausableTapeView<OptionPrint>({
    enabled: mode === "live",
    sourceStatus: optionsChannelStatus,
    sourceItems: liveSession.options,
    historyTail: liveSession.optionsHistory,
    lastUpdate: optionsLastUpdate,
    retentionLimit: LIVE_OPTIONS_HEAD_LIMIT,
    captureScroll: optionsAnchor.capture,
    onNewItems: optionsScroll.onNewItems,
    shouldHold: () => !optionsScroll.isAtTopRef.current,
    resumeSignal: optionsScroll.resumeTick
  });
  const liveEquities = usePausableTapeView<EquityPrint>({
    enabled: mode === "live",
    sourceStatus: equitiesChannelStatus,
    sourceItems: liveSession.equities,
    historyTail: liveSession.equitiesHistory,
    lastUpdate: equitiesLastUpdate,
    captureScroll: equitiesAnchor.capture,
    onNewItems: equitiesScroll.onNewItems,
    shouldHold: () => !equitiesScroll.isAtTopRef.current,
    resumeSignal: equitiesScroll.resumeTick
  });
  const liveFlow = usePausableTapeView<FlowPacket>({
    enabled: mode === "live",
    sourceStatus: flowChannelStatus,
    sourceItems: liveSession.flow,
    historyTail: liveSession.flowHistory,
    lastUpdate: flowLastUpdate,
    captureScroll: flowAnchor.capture,
    onNewItems: flowScroll.onNewItems,
    shouldHold: () => !flowScroll.isAtTopRef.current,
    resumeSignal: flowScroll.resumeTick
  });
  const liveNews = usePausableTapeView<NewsStory>({
    enabled: mode === "live",
    sourceStatus: liveSession.status,
    sourceItems: liveSession.news,
    historyTail: liveSession.newsHistory,
    lastUpdate: newsLastUpdate,
    retentionLimit: LIVE_OPTIONS_HEAD_LIMIT,
    captureScroll: newsAnchor.capture,
    onNewItems: newsScroll.onNewItems,
    shouldHold: () => !newsScroll.isAtTopRef.current,
    resumeSignal: newsScroll.resumeTick
  });

  const seededLiveOptionsItems = useMemo(
    () =>
      composeTapeItems(
        optionFocusSeed?.scopeKey === optionFocusScopeKey ? optionFocusSeed.items : [],
        liveOptions.liveItems ?? [],
        liveOptions.historyItems ?? []
      ),
    [liveOptions.historyItems, liveOptions.liveItems, optionFocusScopeKey, optionFocusSeed]
  );
  const seededLiveEquitiesItems = useMemo(
    () =>
      composeTapeItems(
        equityFocusSeed?.scopeKey === equityFocusScopeKey ? equityFocusSeed.items : [],
        liveEquities.liveItems ?? [],
        liveEquities.historyItems ?? []
      ),
    [equityFocusScopeKey, equityFocusSeed, liveEquities.historyItems, liveEquities.liveItems]
  );

  const liveNbboItems = useMemo(
    () => composeTapeItems([], liveSession.nbbo, liveSession.nbboHistory),
    [liveSession.nbbo, liveSession.nbboHistory]
  );
  const liveEquityJoinItems = useMemo(
    () => composeTapeItems([], liveSession.equityJoins, liveSession.equityJoinsHistory),
    [liveSession.equityJoins, liveSession.equityJoinsHistory]
  );
  const liveAlertItems = useMemo(
    () => composeTapeItems([], liveSession.alerts, liveSession.alertsHistory),
    [liveSession.alerts, liveSession.alertsHistory]
  );
  const liveDurableRowItems = useMemo(
    () => composeTapeItems([], liveSession.durableRows, liveSession.durableRowsHistory),
    [liveSession.durableRows, liveSession.durableRowsHistory]
  );
  const liveClassifierHitItems = useMemo(
    () => composeTapeItems([], liveSession.classifierHits, liveSession.classifierHitsHistory),
    [liveSession.classifierHits, liveSession.classifierHitsHistory]
  );
  const liveSmartFlowItems = useMemo(
    () => composeTapeItems([], liveSession.smartFlow, liveSession.smartFlowHistory),
    [liveSession.smartFlow, liveSession.smartFlowHistory]
  );
  const liveSmartMoneyItems = useMemo(
    () => composeTapeItems([], liveSession.smartMoney, liveSession.smartMoneyHistory),
    [liveSession.smartMoney, liveSession.smartMoneyHistory]
  );
  const liveInferredDarkItems = useMemo(
    () => composeTapeItems([], liveSession.inferredDark, liveSession.inferredDarkHistory),
    [liveSession.inferredDark, liveSession.inferredDarkHistory]
  );

  const optionsFeed = mode === "live" ? { ...liveOptions, items: seededLiveOptionsItems } : options;
  const nbboFeed =
    mode === "live"
      ? toStaticTapeState(
          getHotChannelFeedStatus(liveSession.status, liveSession.channelHealth.nbbo),
          liveNbboItems,
          nbboLastUpdate
        )
      : nbbo;
  const equitiesFeed =
    mode === "live" ? { ...liveEquities, items: seededLiveEquitiesItems } : equities;
  const equityJoinsFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveEquityJoinItems, equityJoinsLastUpdate)
      : equityJoins;
  const flowFeed = mode === "live" ? liveFlow : flow;
  const newsFeed = mode === "live" ? liveNews : toStaticTapeState("disconnected", [], null);
  const alertsFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveAlertItems, alertsLastUpdate)
      : alerts;
  const durableRowsFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveDurableRowItems, durableRowsLastUpdate)
      : toStaticTapeState<DurableTapeRowViewModel>("disconnected", [], null);
  const classifierHitsFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveClassifierHitItems, classifierHitsLastUpdate)
      : classifierHits;
  const smartFlowFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveSmartFlowItems, smartFlowLastUpdate)
      : smartFlow;
  const smartMoneyFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveSmartMoneyItems, smartMoneyLastUpdate)
      : smartMoney;
  const inferredDarkFeed =
    mode === "live"
      ? toStaticTapeState(liveSession.status, liveInferredDarkItems, inferredDarkLastUpdate)
      : inferredDark;

  useLayoutEffect(() => {
    optionsAnchor.apply();
  }, [optionsFeed.items, optionsAnchor.apply]);

  useLayoutEffect(() => {
    equitiesAnchor.apply();
  }, [equitiesFeed.items, equitiesAnchor.apply]);

  useLayoutEffect(() => {
    flowAnchor.apply();
  }, [flowFeed.items, flowAnchor.apply]);

  useLayoutEffect(() => {
    darkAnchor.apply();
  }, [inferredDarkFeed.items, darkAnchor.apply]);

  useLayoutEffect(() => {
    alertsAnchor.apply();
  }, [alertsFeed.items, alertsAnchor.apply]);

  useLayoutEffect(() => {
    classifierAnchor.apply();
  }, [smartFlowFeed.items, smartMoneyFeed.items, classifierHitsFeed.items, classifierAnchor.apply]);

  useLayoutEffect(() => {
    newsAnchor.apply();
  }, [newsFeed.items, newsAnchor.apply]);

  const nbboMap = useMemo(() => {
    const map = new Map<string, OptionNBBO>();
    for (const quote of nbboFeed.items) {
      const contractId = normalizeContractId(quote.option_contract_id);
      const existing = map.get(contractId);
      if (
        !existing ||
        quote.ts > existing.ts ||
        (quote.ts === existing.ts && quote.seq >= existing.seq)
      ) {
        map.set(contractId, quote);
      }
    }
    return map;
  }, [nbboFeed.items]);

  const optionPrintMap = useMemo(() => {
    const map = new Map<string, OptionPrint>();
    for (const print of optionsFeed.items) {
      if (print.trace_id) {
        map.set(print.trace_id, print);
      }
    }
    return map;
  }, [optionsFeed.items]);

  const equityJoinMap = useMemo(() => {
    const map = new Map<string, EquityPrintJoin>();
    for (const join of equityJoinsFeed.items) {
      map.set(join.id, join);
    }
    return map;
  }, [equityJoinsFeed.items]);

  const flowPacketMap = useMemo(() => {
    const map = new Map<string, FlowPacket>();
    for (const packet of flowFeed.items) {
      map.set(packet.id, packet);
    }
    return map;
  }, [flowFeed.items]);
  const [pinnedOptionPrintMap, setPinnedOptionPrintMap] = useState<
    Map<string, PinnedEntry<OptionPrint>>
  >(() => new Map());
  const [pinnedFlowPacketMap, setPinnedFlowPacketMap] = useState<
    Map<string, PinnedEntry<FlowPacket>>
  >(() => new Map());
  const [pinnedEquityJoinMap, setPinnedEquityJoinMap] = useState<
    Map<string, PinnedEntry<EquityPrintJoin>>
  >(() => new Map());
  const [optionSupportSmartMoney, setOptionSupportSmartMoney] = useState<SmartMoneyEvent[]>([]);
  const [optionSupportClassifierHits, setOptionSupportClassifierHits] = useState<
    ClassifierHitEvent[]
  >([]);
  const [historicalNbboByTraceId, setHistoricalNbboByTraceId] = useState<
    Map<string, OptionNBBO | null>
  >(() => new Map());

  const resolvedOptionPrintMap = useMemo(() => {
    const merged = new Map<string, OptionPrint>();
    for (const [key, entry] of pinnedOptionPrintMap) {
      merged.set(key, entry.value);
    }
    for (const [key, value] of optionPrintMap) {
      merged.set(key, value);
    }
    return merged;
  }, [optionPrintMap, pinnedOptionPrintMap]);
  const resolvedFlowPacketMap = useMemo(() => {
    const merged = new Map<string, FlowPacket>();
    for (const [key, entry] of pinnedFlowPacketMap) {
      merged.set(key, entry.value);
    }
    for (const [key, value] of flowPacketMap) {
      merged.set(key, value);
    }
    return merged;
  }, [flowPacketMap, pinnedFlowPacketMap]);
  const resolvedEquityJoinMap = useMemo(() => {
    const merged = new Map<string, EquityPrintJoin>();
    for (const [key, entry] of pinnedEquityJoinMap) {
      merged.set(key, entry.value);
    }
    for (const [key, value] of equityJoinMap) {
      merged.set(key, value);
    }
    return merged;
  }, [equityJoinMap, pinnedEquityJoinMap]);

  useEffect(() => {
    setRetentionMetric(
      "pinnedStoreSize",
      pinnedOptionPrintMap.size + pinnedFlowPacketMap.size + pinnedEquityJoinMap.size
    );
  }, [pinnedOptionPrintMap.size, pinnedFlowPacketMap.size, pinnedEquityJoinMap.size]);

  useEffect(() => {
    if (!selectedDarkEvent || mode !== "live") {
      return;
    }

    const missingIds = selectedDarkEvent.evidence_refs.filter(
      (id) => resolveJoinFromRef(id, resolvedEquityJoinMap) === null
    );
    if (missingIds.length === 0) {
      return;
    }

    incrementRetentionMetric("pinnedFetchMisses", missingIds.length);
    const url = new URL(buildApiUrl("/equity-joins/by-id"));
    const requested = new Set<string>();
    for (const id of missingIds) {
      for (const candidate of normalizeJoinRefCandidates(id)) {
        if (!requested.has(candidate)) {
          requested.add(candidate);
          url.searchParams.append("id", candidate);
        }
      }
    }
    void fetch(url.toString())
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorDetail(response));
        }
        return response.json();
      })
      .then((payload: { data?: EquityPrintJoin[] }) => {
        const next = new Map<string, EquityPrintJoin>();
        for (const item of payload.data ?? []) {
          if (!item || !item.id || !item.trace_id) {
            continue;
          }
          next.set(item.id, item);
          next.set(item.trace_id, item);
          if (item.print_trace_id) {
            next.set(item.print_trace_id, item);
          }
        }
        if (next.size > 0) {
          const now = Date.now();
          setPinnedEquityJoinMap((prev) => upsertPinnedEntries(prev, next, now));
        }
      })
      .catch((error) => {
        incrementRetentionMetric("pinnedFetchFailures", 1);
        console.warn("Failed to fetch dark evidence joins", error);
      });
  }, [selectedDarkEvent, mode, resolvedEquityJoinMap]);

  const selectedDarkEvidence = useMemo((): DarkEvidenceItem[] => {
    if (!selectedDarkEvent) {
      return [];
    }

    return selectedDarkEvent.evidence_refs.map((id) => {
      const join = resolveJoinFromRef(id, resolvedEquityJoinMap);
      if (join) {
        return { kind: "join", id, join };
      }
      return { kind: "unknown", id };
    });
  }, [selectedDarkEvent, resolvedEquityJoinMap]);

  const selectedDarkUnderlying = useMemo(() => {
    if (!routeFeatures.needsDarkUnderlying || !selectedDarkEvent) {
      return null;
    }
    return inferDarkUnderlying(selectedDarkEvent, resolvedEquityJoinMap);
  }, [routeFeatures.needsDarkUnderlying, selectedDarkEvent, resolvedEquityJoinMap]);

  useEffect(() => {
    if (mode !== "live") {
      setSelectedAlert(null);
    }
    setSelectedDarkEvent(null);
    setSelectedClassifierHit(null);
    setSelectedSmartFlowProjection(null);
    setSelectedSmartMoneyEvent(null);
  }, [mode]);

  const extractPacketContract = useCallback((packet: FlowPacket): string => {
    const contract = packet.features.option_contract_id;
    if (typeof contract === "string") {
      return contract;
    }
    const match = packet.id.match(/^flowpacket:([^:]+):/);
    return match?.[1] ?? packet.id;
  }, []);

  const extractUnderlyingFromTrace = useCallback((traceId: string): string | null => {
    const match = traceId.match(/flowpacket:([^:]+):/);
    if (!match?.[1]) {
      return null;
    }
    return extractUnderlying(match[1]);
  }, []);

  const extractPacketIdFromClassifierHitTrace = useCallback((traceId: string): string | null => {
    const idx = traceId.indexOf("flowpacket:");
    if (idx < 0) {
      return null;
    }
    return traceId.slice(idx);
  }, []);

  const classifierHitsByPacketId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return EMPTY_CLASSIFIER_HITS_BY_PACKET_ID;
    }
    const map = new Map<string, ClassifierHitEvent[]>();
    for (const hit of [...classifierHitsFeed.items, ...optionSupportClassifierHits]) {
      const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
      if (!packetId) {
        continue;
      }
      map.set(packetId, [...(map.get(packetId) ?? []), hit]);
    }
    return map;
  }, [
    classifierHitsFeed.items,
    optionSupportClassifierHits,
    extractPacketIdFromClassifierHitTrace,
    routeFeatures.needsClassifierDecor
  ]);

  const smartMoneyByPacketId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return new Map<string, SmartMoneyEvent>();
    }
    const map = new Map<string, SmartMoneyEvent>();
    for (const event of [...smartMoneyFeed.items, ...optionSupportSmartMoney]) {
      for (const packetId of event.packet_ids) {
        const existing = map.get(packetId);
        if (!existing || event.source_ts > existing.source_ts || event.seq > existing.seq) {
          map.set(packetId, event);
        }
      }
    }
    return map;
  }, [smartMoneyFeed.items, optionSupportSmartMoney, routeFeatures.needsClassifierDecor]);

  const packetIdByOptionTraceId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return EMPTY_PACKET_ID_BY_OPTION_TRACE_ID;
    }
    const map = new Map<string, string>();
    for (const packet of resolvedFlowPacketMap.values()) {
      for (const member of packet.members) {
        map.set(member, packet.id);
      }
    }
    return map;
  }, [resolvedFlowPacketMap, routeFeatures.needsClassifierDecor]);

  const classifierDecorByOptionTraceId = useMemo(() => {
    if (!routeFeatures.needsClassifierDecor) {
      return EMPTY_CLASSIFIER_DECOR_BY_OPTION_TRACE_ID;
    }
    const map = new Map<string, ClassifierDecor>();
    for (const [traceId, packetId] of packetIdByOptionTraceId) {
      const smartMoneyEvent = smartMoneyByPacketId.get(packetId);
      if (smartMoneyEvent) {
        map.set(traceId, buildSmartMoneyDecor(smartMoneyEvent));
        continue;
      }
      const primary = selectPrimaryClassifierHit(classifierHitsByPacketId.get(packetId) ?? []);
      if (primary) {
        map.set(traceId, buildClassifierDecor(primary));
      }
    }
    return map;
  }, [
    classifierHitsByPacketId,
    packetIdByOptionTraceId,
    smartMoneyByPacketId,
    routeFeatures.needsClassifierDecor
  ]);

  const optionSupportHydrationInput = useMemo(() => {
    const traceIds: string[] = [];
    const nbboContext: OptionSupportNbboContext[] = [];
    if (!routeFeatures.needsClassifierDecor || mode !== "live" || optionsFeed.items.length === 0) {
      return { traceIds, nbboContext };
    }

    for (const print of optionsFeed.items.slice(0, 1000)) {
      if (!print.trace_id || classifierDecorByOptionTraceId.has(print.trace_id)) {
        continue;
      }
      if (!packetIdByOptionTraceId.has(print.trace_id)) {
        traceIds.push(print.trace_id);
      }
      const missingPreservedNbbo =
        typeof print.execution_nbbo_side !== "string" &&
        typeof print.nbbo_side !== "string" &&
        !historicalNbboByTraceId.has(print.trace_id);
      if (missingPreservedNbbo) {
        nbboContext.push({
          trace_id: print.trace_id,
          option_contract_id: print.option_contract_id,
          ts: print.ts
        });
      }
      if (traceIds.length >= 250 && nbboContext.length >= 250) {
        break;
      }
    }

    const uniqueTraceIds = Array.from(new Set(traceIds)).slice(0, 250);
    const uniqueNbboContext = Array.from(
      new Map(nbboContext.map((item) => [item.trace_id, item])).values()
    ).slice(0, 250);
    return { traceIds: uniqueTraceIds, nbboContext: uniqueNbboContext };
  }, [
    mode,
    optionsFeed.items,
    classifierDecorByOptionTraceId,
    packetIdByOptionTraceId,
    historicalNbboByTraceId,
    routeFeatures.needsClassifierDecor
  ]);

  const optionSupportTraceKey = stableHydrationKey(optionSupportHydrationInput.traceIds);
  const optionSupportNbboKey = stableOptionSupportNbboKey(optionSupportHydrationInput.nbboContext);

  useEffect(() => {
    if (!routeFeatures.needsClassifierDecor || mode !== "live") {
      return;
    }

    const uniqueTraceIds = optionSupportHydrationInput.traceIds;
    const uniqueNbboContext = optionSupportHydrationInput.nbboContext;
    if (uniqueTraceIds.length === 0 && uniqueNbboContext.length === 0) {
      return;
    }

    let active = true;
    void terminalHydrationScheduler
      .requestOptionSupport({
        traceIds: uniqueTraceIds,
        nbboContext: uniqueNbboContext
      })
      .then((payload) => {
        if (!active) {
          return;
        }
        const now = Date.now();
        const packetMap = new Map<string, FlowPacket>();
        for (const packet of payload.packets ?? []) {
          if (!packet || !packet.id) {
            continue;
          }
          packetMap.set(packet.id, packet);
        }
        if (packetMap.size > 0) {
          setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, packetMap, now));
        }
        if (payload.smartMoney.length) {
          const filtered = payload.smartMoney.filter((item): item is SmartMoneyEvent =>
            Boolean(item && item.trace_id)
          );
          setOptionSupportSmartMoney((prev) =>
            mergeNewest(filtered, prev, PINNED_EVIDENCE_MAX_ITEMS)
          );
        }
        if (payload.classifierHits.length) {
          const filtered = payload.classifierHits.filter((item): item is ClassifierHitEvent =>
            Boolean(item && item.trace_id)
          );
          setOptionSupportClassifierHits((prev) =>
            mergeNewest(filtered, prev, PINNED_EVIDENCE_MAX_ITEMS)
          );
        }
        if (Object.keys(payload.nbboByTraceId).length > 0) {
          setHistoricalNbboByTraceId((prev) => {
            const next = new Map(prev);
            for (const [traceId, quote] of Object.entries(payload.nbboByTraceId)) {
              next.set(traceId, quote);
            }
            return next;
          });
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        console.warn("Failed to hydrate option row support", error);
      });

    return () => {
      active = false;
    };
  }, [mode, optionSupportNbboKey, optionSupportTraceKey, routeFeatures.needsClassifierDecor]);

  const selectedClassifierPacketId = useMemo(() => {
    if (!selectedClassifierHit) {
      return null;
    }
    return extractPacketIdFromClassifierHitTrace(selectedClassifierHit.trace_id);
  }, [extractPacketIdFromClassifierHitTrace, selectedClassifierHit]);

  const selectedClassifierMissingPacketIds = useMemo(
    () =>
      selectedClassifierPacketId && !resolvedFlowPacketMap.has(selectedClassifierPacketId)
        ? [selectedClassifierPacketId]
        : [],
    [resolvedFlowPacketMap, selectedClassifierPacketId]
  );
  const selectedClassifierMissingPacketKey = stableHydrationKey(selectedClassifierMissingPacketIds);

  useEffect(() => {
    if (mode !== "live" || selectedClassifierMissingPacketIds.length === 0) {
      return;
    }

    let active = true;
    incrementRetentionMetric("pinnedFetchMisses", selectedClassifierMissingPacketIds.length);
    void terminalHydrationScheduler
      .requestFlowPackets(selectedClassifierMissingPacketIds)
      .then(({ packets }) => {
        if (!active || packets.length === 0) {
          return;
        }
        const next = new Map<string, FlowPacket>();
        for (const packet of packets) {
          next.set(packet.id, packet);
        }
        setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        incrementRetentionMetric("pinnedFetchFailures", 1);
        console.warn("Failed to fetch classifier flow packet", error);
      });

    return () => {
      active = false;
    };
  }, [mode, selectedClassifierMissingPacketKey]);

  const selectedClassifierFlowPacket = useMemo(() => {
    if (!selectedClassifierPacketId) {
      return null;
    }
    return resolvedFlowPacketMap.get(selectedClassifierPacketId) ?? null;
  }, [resolvedFlowPacketMap, selectedClassifierPacketId]);

  const selectedClassifierEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedClassifierHit) {
      return [];
    }

    if (!selectedClassifierPacketId) {
      return [];
    }

    const packet = resolvedFlowPacketMap.get(selectedClassifierPacketId);
    if (!packet) {
      return [];
    }

    return packet.members.map((id) => {
      const print = resolvedOptionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [
    resolvedFlowPacketMap,
    resolvedOptionPrintMap,
    selectedClassifierHit,
    selectedClassifierPacketId
  ]);

  const selectedSmartFlowRefs = useMemo(
    () =>
      selectedSmartFlowProjection ? getSmartFlowEvidenceRefs(selectedSmartFlowProjection) : [],
    [selectedSmartFlowProjection]
  );
  const selectedSmartFlowPacketRefs = useMemo(
    () => (selectedSmartFlowProjection ? getSmartFlowPacketRefs(selectedSmartFlowProjection) : []),
    [selectedSmartFlowProjection]
  );
  const selectedSmartFlowPrintRefs = useMemo(
    () =>
      selectedSmartFlowProjection ? getSmartFlowOptionPrintRefs(selectedSmartFlowProjection) : [],
    [selectedSmartFlowProjection]
  );
  const selectedSmartFlowEvidence = useMemo((): EvidenceItem[] => {
    return selectedSmartFlowRefs.map((id) => {
      const packet = resolvedFlowPacketMap.get(id);
      if (packet) {
        return { kind: "flow", id, packet };
      }
      const print = resolvedOptionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [resolvedFlowPacketMap, resolvedOptionPrintMap, selectedSmartFlowRefs]);

  const selectedSmartFlowMissingPacketIds = useMemo(
    () => selectedSmartFlowPacketRefs.filter((id) => !resolvedFlowPacketMap.has(id)),
    [resolvedFlowPacketMap, selectedSmartFlowPacketRefs]
  );
  const selectedSmartFlowMissingPacketKey = stableHydrationKey(selectedSmartFlowMissingPacketIds);
  const selectedSmartFlowMissingPrintIds = useMemo(
    () => selectedSmartFlowPrintRefs.filter((id) => !resolvedOptionPrintMap.has(id)),
    [resolvedOptionPrintMap, selectedSmartFlowPrintRefs]
  );
  const selectedSmartFlowMissingPrintKey = stableHydrationKey(selectedSmartFlowMissingPrintIds);

  useEffect(() => {
    if (!selectedSmartFlowProjection || mode !== "live") {
      return;
    }

    let active = true;
    if (selectedSmartFlowMissingPacketIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", selectedSmartFlowMissingPacketIds.length);
      void terminalHydrationScheduler
        .requestFlowPackets(selectedSmartFlowMissingPacketIds)
        .then(({ packets }) => {
          if (!active) {
            return;
          }
          const next = new Map<string, FlowPacket>();
          for (const packet of packets) {
            next.set(packet.id, packet);
          }
          if (next.size > 0) {
            setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to fetch smart-flow flow packets", error);
        });
    }

    if (selectedSmartFlowMissingPrintIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", selectedSmartFlowMissingPrintIds.length);
      void terminalHydrationScheduler
        .requestOptionPrints(selectedSmartFlowMissingPrintIds)
        .then(({ prints }) => {
          if (!active) {
            return;
          }
          const next = new Map<string, OptionPrint>();
          for (const item of prints) {
            next.set(item.trace_id, item);
          }
          if (next.size > 0) {
            setPinnedOptionPrintMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to fetch smart-flow option prints", error);
        });
    }

    return () => {
      active = false;
    };
  }, [
    mode,
    selectedSmartFlowMissingPacketKey,
    selectedSmartFlowMissingPrintKey,
    selectedSmartFlowProjection
  ]);

  const selectedSmartMoneyFlowPacket = useMemo(() => {
    const packetId = selectedSmartMoneyEvent?.packet_ids[0];
    return packetId ? (resolvedFlowPacketMap.get(packetId) ?? null) : null;
  }, [resolvedFlowPacketMap, selectedSmartMoneyEvent]);

  const selectedSmartMoneyEvidence = useMemo((): EvidenceItem[] => {
    if (!selectedSmartMoneyEvent) {
      return [];
    }
    return selectedSmartMoneyEvent.member_print_ids.map((id) => {
      const print = resolvedOptionPrintMap.get(id);
      if (print) {
        return { kind: "print", id, print };
      }
      return { kind: "unknown", id };
    });
  }, [resolvedOptionPrintMap, selectedSmartMoneyEvent]);

  const selectedSmartMoneyMissingPacketIds = useMemo(
    () =>
      (selectedSmartMoneyEvent?.packet_ids ?? []).filter((id) => !resolvedFlowPacketMap.has(id)),
    [resolvedFlowPacketMap, selectedSmartMoneyEvent]
  );
  const selectedSmartMoneyMissingPacketKey = stableHydrationKey(selectedSmartMoneyMissingPacketIds);
  const selectedSmartMoneyMissingPrintIds = useMemo(
    () =>
      (selectedSmartMoneyEvent?.member_print_ids ?? []).filter(
        (id) => !resolvedOptionPrintMap.has(id)
      ),
    [resolvedOptionPrintMap, selectedSmartMoneyEvent]
  );
  const selectedSmartMoneyMissingPrintKey = stableHydrationKey(selectedSmartMoneyMissingPrintIds);

  useEffect(() => {
    if (!selectedSmartMoneyEvent || mode !== "live") {
      return;
    }

    let active = true;
    if (selectedSmartMoneyMissingPacketIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", selectedSmartMoneyMissingPacketIds.length);
      void terminalHydrationScheduler
        .requestFlowPackets(selectedSmartMoneyMissingPacketIds)
        .then(({ packets }) => {
          if (!active) {
            return;
          }
          const next = new Map<string, FlowPacket>();
          for (const packet of packets) {
            next.set(packet.id, packet);
          }
          if (next.size > 0) {
            setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to fetch smart-money flow packets", error);
        });
    }

    if (selectedSmartMoneyMissingPrintIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", selectedSmartMoneyMissingPrintIds.length);
      void terminalHydrationScheduler
        .requestOptionPrints(selectedSmartMoneyMissingPrintIds)
        .then(({ prints }) => {
          if (!active) {
            return;
          }
          const next = new Map<string, OptionPrint>();
          for (const item of prints) {
            next.set(item.trace_id, item);
          }
          if (next.size > 0) {
            setPinnedOptionPrintMap((prev) => upsertPinnedEntries(prev, next, Date.now()));
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to fetch smart-money option prints", error);
        });
    }

    return () => {
      active = false;
    };
  }, [
    mode,
    selectedSmartMoneyEvent,
    selectedSmartMoneyMissingPacketKey,
    selectedSmartMoneyMissingPrintKey
  ]);

  const inferAlertUnderlying = useCallback(
    (alert: AlertEvent): string | null => {
      const fromTrace = extractUnderlyingFromTrace(alert.trace_id);
      if (fromTrace) {
        return fromTrace;
      }

      const packet = resolveAlertFlowPacket(alert, resolvedFlowPacketMap);
      if (packet) {
        return extractUnderlying(extractPacketContract(packet));
      }

      for (const ref of alert.evidence_refs) {
        const print = resolvedOptionPrintMap.get(ref);
        if (print) {
          return extractUnderlying(print.option_contract_id);
        }
      }

      return null;
    },
    [
      extractPacketContract,
      extractUnderlyingFromTrace,
      resolvedFlowPacketMap,
      resolvedOptionPrintMap
    ]
  );

  const matchesTicker = useCallback(
    (value: string | null) => {
      if (tickerSet.size === 0) {
        return true;
      }
      if (!value) {
        return false;
      }
      return tickerSet.has(value.toUpperCase());
    },
    [tickerSet]
  );

  const filteredOptions = useMemo(() => {
    return filterOptionTapeItems(
      optionsFeed.items,
      effectiveOptionPrintFilters,
      selectedInstrument,
      tickerSet,
      instrumentUnderlying
    );
  }, [
    effectiveOptionPrintFilters,
    instrumentUnderlying,
    optionsFeed.items,
    selectedInstrument,
    tickerSet
  ]);

  const filteredEquities = useMemo(() => {
    if (tickerSet.size === 0) {
      if (instrumentUnderlying) {
        return equitiesFeed.items.filter(
          (print) => print.underlying_id.toUpperCase() === instrumentUnderlying
        );
      }
      return equitiesFeed.items;
    }
    return equitiesFeed.items.filter((print) => matchesTicker(print.underlying_id));
  }, [equitiesFeed.items, matchesTicker, tickerSet, instrumentUnderlying]);

  const filteredOptionsRef = useLatestRef(filteredOptions);
  const filteredEquitiesRef = useLatestRef(filteredEquities);
  const resolvedOptionPrintMapRef = useLatestRef(resolvedOptionPrintMap);

  useEffect(() => {
    if (!optionFocusSeed) {
      return;
    }
    if (
      shouldClearOptionFocusSeed(
        optionFocusSeed,
        optionFocusScopeKey,
        currentOptionSubscriptionKey,
        liveOptions.liveItems ?? [],
        liveOptions.historyItems ?? []
      )
    ) {
      setOptionFocusSeed(null);
    }
  }, [
    currentOptionSubscriptionKey,
    liveOptions.historyItems,
    liveOptions.liveItems,
    optionFocusScopeKey,
    optionFocusSeed
  ]);

  useEffect(() => {
    if (!equityFocusSeed) {
      return;
    }
    if (equityFocusSeed.scopeKey !== equityFocusScopeKey) {
      setEquityFocusSeed(null);
      return;
    }
    const composedBaseItems = composeTapeItems(
      [],
      liveEquities.liveItems ?? [],
      liveEquities.historyItems ?? []
    );
    const liveKeys = new Set(composedBaseItems.map((item) => getTapeItemKey(item)));
    if (equityFocusSeed.items.every((item) => liveKeys.has(getTapeItemKey(item)))) {
      setEquityFocusSeed(null);
    }
  }, [equityFocusScopeKey, equityFocusSeed, liveEquities.historyItems, liveEquities.liveItems]);

  const focusOptionContract = useCallback(
    (print: OptionPrint) => {
      const contractId = normalizeContractId(print.option_contract_id);
      const parsed = parseOptionContractId(contractId);
      const underlyingId = (
        print.underlying_id ??
        parsed?.root ??
        extractUnderlying(contractId)
      ).toUpperCase();
      const scopeKey = `option-contract:${contractId}`;
      const subscriptionKey = getLiveSubscriptionKey({
        channel: "options",
        underlying_ids: [underlyingId],
        option_contract_id: contractId
      });
      const seedItems = composeTapeItems(
        [print],
        filteredOptionsRef.current.filter(
          (candidate) => normalizeContractId(candidate.option_contract_id) === contractId
        ),
        []
      );
      setOptionFocusSeed({ scopeKey, subscriptionKey, items: seedItems });
      bumpTapeDebugMetric("focusSeedRowCount", seedItems.length);
      logTapeDebug("option focus seed captured", {
        contract_id: contractId,
        subscription_key: subscriptionKey,
        row_count: seedItems.length
      });
      setSelectedInstrument({
        kind: "option-contract",
        contractId,
        underlyingId
      });
    },
    [filteredOptionsRef]
  );

  const focusEquityTicker = useCallback(
    (print: EquityPrint) => {
      const underlyingId = print.underlying_id.toUpperCase();
      const scopeKey = `equity:${underlyingId}`;
      const seedItems = composeTapeItems(
        [print],
        filteredEquitiesRef.current.filter(
          (candidate) => candidate.underlying_id.toUpperCase() === underlyingId
        ),
        []
      );
      setEquityFocusSeed({ scopeKey, items: seedItems });
      bumpTapeDebugMetric("focusSeedRowCount", seedItems.length);
      logTapeDebug("equity focus seed captured", {
        underlying_id: underlyingId,
        row_count: seedItems.length
      });
      setSelectedInstrument({
        kind: "equity",
        underlyingId
      });
    },
    [filteredEquitiesRef]
  );

  const focusFlowPacketRequest = useCallback(
    (request: FlowPacketFocusRequest) => {
      if (!request.optionContractId) {
        return;
      }
      const contractId = normalizeContractId(request.optionContractId);
      const parsed = parseOptionContractId(contractId);
      const underlyingId = (parsed?.root ?? extractUnderlying(contractId)).toUpperCase();
      const scopeKey = `option-contract:${contractId}`;
      const subscriptionKey = getLiveSubscriptionKey({
        channel: "options",
        underlying_ids: [underlyingId],
        option_contract_id: contractId
      });
      const memberTraceIds = new Set(request.memberTraceIds);
      const memberPrints = request.memberTraceIds
        .map((traceId) => resolvedOptionPrintMapRef.current.get(traceId))
        .filter((print): print is OptionPrint => Boolean(print));
      const seedItems = composeTapeItems(
        memberPrints,
        filteredOptionsRef.current.filter(
          (candidate) =>
            normalizeContractId(candidate.option_contract_id) === contractId &&
            (memberTraceIds.size === 0 || memberTraceIds.has(candidate.trace_id))
        ),
        []
      );
      setOptionFocusSeed({ scopeKey, subscriptionKey, items: seedItems });
      bumpTapeDebugMetric("focusSeedRowCount", seedItems.length);
      logTapeDebug("packet focus seed captured", {
        packet_id: request.packetId,
        source: request.source,
        contract_id: contractId,
        row_count: seedItems.length
      });
      setSelectedInstrument({
        kind: "option-contract",
        contractId,
        underlyingId
      });
    },
    [filteredOptionsRef, resolvedOptionPrintMapRef]
  );

  const focusAlertContract = useCallback(
    (request: AlertContractFocusRequest) => {
      focusOptionContract(request.print);
    },
    [focusOptionContract]
  );

  const focusAlertEquity = useCallback(
    (request: AlertEquityFocusRequest) => {
      const underlyingId = request.underlyingId.toUpperCase();
      const scopeKey = `equity:${underlyingId}`;
      const seedItems = filteredEquitiesRef.current.filter(
        (candidate) => candidate.underlying_id.toUpperCase() === underlyingId
      );
      setEquityFocusSeed({ scopeKey, items: seedItems });
      bumpTapeDebugMetric("focusSeedRowCount", seedItems.length);
      logTapeDebug("alert equity focus captured", {
        underlying_id: underlyingId,
        source: request.source,
        row_count: seedItems.length
      });
      setSelectedInstrument({
        kind: "equity",
        underlyingId
      });
    },
    [filteredEquitiesRef]
  );

  const clearSelectedInstrument = useCallback(() => {
    setSelectedInstrument(null);
  }, []);

  const clearSelectedAlert = useCallback(() => {
    setSelectedAlert(null);
  }, []);

  const equitiesSilentWarning = shouldShowEquitiesSilentFeedWarning({
    wsStatus: liveSession.status,
    equitiesSubscribed: mode === "live" && equitiesLiveSubscriptionActive,
    connectedAt: liveSession.connectedAt,
    lastEquitiesEventAt: liveSession.lastEventByChannel.equities ?? null
  });
  const optionsScopeActive = Boolean(
    optionScope.option_contract_id || optionScope.underlying_ids?.length
  );
  const equitiesScopeActive = Boolean(equityScope.underlying_ids?.length);
  const optionsScopedQuiet =
    mode === "live" &&
    optionsScopeActive &&
    optionsChannelStatus === "connected" &&
    filteredOptions.length === 0;
  const equitiesScopedQuiet =
    mode === "live" &&
    equitiesScopeActive &&
    equitiesChannelStatus === "connected" &&
    filteredEquities.length === 0;

  const previousScopedQuietRef = useRef({
    options: optionsScopedQuiet,
    equities: equitiesScopedQuiet
  });

  useEffect(() => {
    const previous = previousScopedQuietRef.current;
    if (previous.options !== optionsScopedQuiet) {
      bumpTapeDebugMetric("scopedQuietTransitions", 1);
      logTapeDebug("options scoped quiet transition", { active: optionsScopedQuiet });
    }
    if (previous.equities !== equitiesScopedQuiet) {
      bumpTapeDebugMetric("scopedQuietTransitions", 1);
      logTapeDebug("equities scoped quiet transition", { active: equitiesScopedQuiet });
    }
    previousScopedQuietRef.current = {
      options: optionsScopedQuiet,
      equities: equitiesScopedQuiet
    };
  }, [equitiesScopedQuiet, optionsScopedQuiet]);

  const filteredInferredDark = useMemo(() => {
    if (!routeFeatures.inferredDark) {
      return EMPTY_INFERRED_DARK_EVENTS;
    }
    if (tickerSet.size === 0) {
      return inferredDarkFeed.items;
    }
    return inferredDarkFeed.items.filter((event) => {
      const underlying = inferDarkUnderlying(event, resolvedEquityJoinMap);
      return matchesTicker(underlying);
    });
  }, [
    resolvedEquityJoinMap,
    inferredDarkFeed.items,
    matchesTicker,
    tickerSet,
    routeFeatures.inferredDark
  ]);

  const filteredFlow = useMemo(() => {
    return flowFeed.items.filter((packet) => {
      if (!matchesFlowPacketFilters(packet, flowFilters)) {
        return false;
      }
      if (tickerSet.size === 0) {
        return true;
      }
      return matchesTicker(extractUnderlying(extractPacketContract(packet)));
    });
  }, [flowFeed.items, flowFilters, extractPacketContract, matchesTicker, tickerSet]);

  const filteredAlerts = useMemo(() => {
    if (!routeFeatures.showAlertsPane && !routeFeatures.needsAlertEvidencePrefetch) {
      return EMPTY_ALERT_EVENTS;
    }
    if (tickerSet.size === 0) {
      return alertsFeed.items;
    }
    return alertsFeed.items.filter((alert) => matchesTicker(inferAlertUnderlying(alert)));
  }, [
    alertsFeed.items,
    inferAlertUnderlying,
    matchesTicker,
    tickerSet,
    routeFeatures.showAlertsPane,
    routeFeatures.needsAlertEvidencePrefetch
  ]);

  const filteredDurableOptionRows = useMemo(() => {
    if (!routeFeatures.durableRows) {
      return EMPTY_DURABLE_OPTION_ROWS;
    }
    const rows = durableRowsFeed.items.filter(
      (row): row is DurableTapeOptionRowViewModel => row.lane === "options"
    );
    if (tickerSet.size === 0) {
      return rows;
    }
    return rows.filter((row) => matchesTicker(row.symbol ?? row.option.underlying_id ?? null));
  }, [durableRowsFeed.items, matchesTicker, routeFeatures.durableRows, tickerSet]);

  const filteredDurableAlertRows = useMemo(() => {
    if (!routeFeatures.durableRows) {
      return EMPTY_DURABLE_ALERT_ROWS;
    }
    const rows = durableRowsFeed.items.filter(
      (row): row is DurableTapeAlertRowViewModel => row.lane === "alerts"
    );
    if (tickerSet.size === 0) {
      return rows;
    }
    return rows.filter((row) => matchesTicker(row.symbol ?? row.evidence.underlying_id));
  }, [durableRowsFeed.items, matchesTicker, routeFeatures.durableRows, tickerSet]);

  const filteredNews = useMemo(() => {
    if (!routeFeatures.news && !routeFeatures.showNewsPane) {
      return EMPTY_NEWS_STORIES;
    }
    if (tickerSet.size === 0) {
      return newsFeed.items;
    }
    return newsFeed.items.filter((story) =>
      story.resolved_symbols.some((symbol) => matchesTicker(symbol))
    );
  }, [matchesTicker, newsFeed.items, routeFeatures.news, routeFeatures.showNewsPane, tickerSet]);

  const visibleAlerts = useMemo(() => {
    if (routeFeatures.needsAlertEvidencePrefetch) {
      return filteredAlerts.slice(0, 12);
    }
    if (routeFeatures.showAlertsPane) {
      return filteredAlerts.slice(0, 12);
    }
    return EMPTY_ALERT_EVENTS;
  }, [filteredAlerts, routeFeatures.needsAlertEvidencePrefetch, routeFeatures.showAlertsPane]);

  const visibleAlertEvidenceRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const alert of visibleAlerts) {
      for (const id of alert.evidence_refs.slice(0, 8)) {
        refs.add(id);
      }
    }
    return Array.from(refs).sort();
  }, [visibleAlerts]);

  const visibleAlertMissingPacketIds = useMemo(() => {
    if (!routeFeatures.needsAlertEvidencePrefetch || mode !== "live") {
      return [];
    }
    const visiblePacketIds = visibleAlerts.flatMap((alert) => getAlertFlowPacketRefs(alert));
    return Array.from(new Set(visiblePacketIds)).filter((id) => !resolvedFlowPacketMap.has(id));
  }, [mode, resolvedFlowPacketMap, routeFeatures.needsAlertEvidencePrefetch, visibleAlerts]);
  const visibleAlertMissingPacketKey = stableHydrationKey(visibleAlertMissingPacketIds);

  const visibleAlertMissingPrintIds = useMemo(() => {
    if (!routeFeatures.needsAlertEvidencePrefetch || mode !== "live") {
      return [];
    }
    return visibleAlertEvidenceRefs.filter(
      (id) => !resolvedFlowPacketMap.has(id) && !resolvedOptionPrintMap.has(id)
    );
  }, [
    mode,
    resolvedFlowPacketMap,
    resolvedOptionPrintMap,
    routeFeatures.needsAlertEvidencePrefetch,
    visibleAlertEvidenceRefs
  ]);
  const visibleAlertMissingPrintKey = stableHydrationKey(visibleAlertMissingPrintIds);

  useEffect(() => {
    if (
      !routeFeatures.needsAlertEvidencePrefetch ||
      mode !== "live" ||
      (visibleAlertMissingPacketIds.length === 0 && visibleAlertMissingPrintIds.length === 0)
    ) {
      return;
    }

    let active = true;
    if (visibleAlertMissingPacketIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", visibleAlertMissingPacketIds.length);
      void terminalHydrationScheduler
        .requestFlowPackets(visibleAlertMissingPacketIds)
        .then(({ packets }) => {
          if (!active) {
            return;
          }
          const next = new Map<string, FlowPacket>();
          for (const packet of packets) {
            next.set(packet.id, packet);
          }
          if (next.size > 0) {
            const now = Date.now();
            setPinnedFlowPacketMap((prev) => upsertPinnedEntries(prev, next, now));
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to prefetch visible alert packets", error);
        });
    }

    if (visibleAlertMissingPrintIds.length > 0) {
      incrementRetentionMetric("pinnedFetchMisses", visibleAlertMissingPrintIds.length);
      void terminalHydrationScheduler
        .requestOptionPrints(visibleAlertMissingPrintIds)
        .then(({ prints }) => {
          if (!active) {
            return;
          }
          const next = new Map<string, OptionPrint>();
          for (const item of prints) {
            next.set(item.trace_id, item);
          }
          if (next.size > 0) {
            const now = Date.now();
            setPinnedOptionPrintMap((prev) => upsertPinnedEntries(prev, next, now));
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          incrementRetentionMetric("pinnedFetchFailures", 1);
          console.warn("Failed to prefetch visible alert evidence", error);
        });
    }

    return () => {
      active = false;
    };
  }, [
    mode,
    visibleAlertMissingPacketKey,
    visibleAlertMissingPrintKey,
    routeFeatures.needsAlertEvidencePrefetch
  ]);

  const activePinnedFlowKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedAlert) {
      for (const packetId of getAlertFlowPacketRefs(selectedAlert)) {
        keys.add(packetId);
      }
    }
    if (selectedClassifierPacketId) {
      keys.add(selectedClassifierPacketId);
    }
    for (const packetId of selectedSmartMoneyEvent?.packet_ids ?? []) {
      keys.add(packetId);
    }
    for (const packetId of getSmartFlowPinnedFlowKeys(selectedSmartFlowProjection)) {
      keys.add(packetId);
    }
    for (const alert of visibleAlerts) {
      for (const packetId of getAlertFlowPacketRefs(alert)) {
        keys.add(packetId);
      }
    }
    return keys;
  }, [
    selectedAlert,
    selectedClassifierPacketId,
    selectedSmartFlowProjection,
    selectedSmartMoneyEvent,
    visibleAlerts
  ]);

  const activePinnedOptionKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedAlert) {
      for (const id of selectedAlert.evidence_refs) {
        keys.add(id);
      }
    }
    if (selectedClassifierFlowPacket) {
      for (const id of selectedClassifierFlowPacket.members) {
        keys.add(id);
      }
    }
    for (const id of selectedSmartMoneyEvent?.member_print_ids ?? []) {
      keys.add(id);
    }
    for (const id of getSmartFlowPinnedOptionKeys(selectedSmartFlowProjection)) {
      keys.add(id);
    }
    for (const id of visibleAlertEvidenceRefs) {
      keys.add(id);
    }
    return keys;
  }, [
    selectedAlert,
    selectedClassifierFlowPacket,
    selectedSmartFlowProjection,
    selectedSmartMoneyEvent,
    visibleAlertEvidenceRefs
  ]);

  const activePinnedJoinKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedDarkEvent) {
      for (const id of selectedDarkEvent.evidence_refs) {
        for (const candidate of normalizeJoinRefCandidates(id)) {
          keys.add(candidate);
        }
      }
    }
    return keys;
  }, [selectedDarkEvent]);

  useEffect(() => {
    if (mode !== "live") {
      return;
    }

    const prune = () => {
      const now = Date.now();
      setPinnedOptionPrintMap((prev) => prunePinnedEntries(prev, activePinnedOptionKeys, now));
      setPinnedFlowPacketMap((prev) => prunePinnedEntries(prev, activePinnedFlowKeys, now));
      setPinnedEquityJoinMap((prev) => prunePinnedEntries(prev, activePinnedJoinKeys, now));
    };

    prune();
    const interval = window.setInterval(prune, 60000);
    return () => {
      window.clearInterval(interval);
    };
  }, [mode, activePinnedOptionKeys, activePinnedFlowKeys, activePinnedJoinKeys]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      console.info("frontend live retention metrics", frontendRetentionMetrics);
    }, 60000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const filteredClassifierHits = useMemo(() => {
    if (!routeFeatures.classifierHits) {
      return EMPTY_CLASSIFIER_HIT_EVENTS;
    }
    if (tickerSet.size === 0) {
      return classifierHitsFeed.items;
    }
    return classifierHitsFeed.items.filter((hit) => {
      const underlying = extractUnderlyingFromTrace(hit.trace_id);
      return matchesTicker(underlying);
    });
  }, [
    classifierHitsFeed.items,
    extractUnderlyingFromTrace,
    matchesTicker,
    tickerSet,
    routeFeatures.classifierHits
  ]);

  const filteredSmartFlowProjections = useMemo(() => {
    if (!routeFeatures.smartFlow) {
      return EMPTY_SMART_FLOW_EXPLAINABILITY;
    }
    if (tickerSet.size === 0) {
      return smartFlowFeed.items;
    }
    return smartFlowFeed.items.filter((projection) =>
      matchesTicker(projection.hypothesis.underlying_id)
    );
  }, [matchesTicker, smartFlowFeed.items, tickerSet, routeFeatures.smartFlow]);

  const filteredSmartMoneyEvents = useMemo(() => {
    if (!routeFeatures.smartMoney) {
      return EMPTY_SMART_MONEY_EVENTS;
    }
    if (tickerSet.size === 0) {
      return smartMoneyFeed.items;
    }
    return smartMoneyFeed.items.filter((event) => matchesTicker(event.underlying_id));
  }, [matchesTicker, smartMoneyFeed.items, tickerSet, routeFeatures.smartMoney]);

  const chartSmartMoneyEvents = useMemo(() => {
    if (!routeFeatures.showChartPane) {
      return EMPTY_SMART_MONEY_EVENTS;
    }
    const desired = chartTicker.toUpperCase();
    return smartMoneyFeed.items
      .filter((event) => event.underlying_id.toUpperCase() === desired)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
  }, [chartTicker, smartMoneyFeed.items, routeFeatures.showChartPane]);

  const chartSmartFlowProjections = useMemo(() => {
    if (!routeFeatures.showChartPane) {
      return EMPTY_SMART_FLOW_EXPLAINABILITY;
    }
    const desired = chartTicker.toUpperCase();
    return sortBySourceTime(
      smartFlowFeed.items.filter(
        (projection) => projection.hypothesis.underlying_id.toUpperCase() === desired
      )
    );
  }, [chartTicker, smartFlowFeed.items, routeFeatures.showChartPane]);

  const chartInferredDark = useMemo(() => {
    if (!routeFeatures.showChartPane) {
      return EMPTY_INFERRED_DARK_EVENTS;
    }
    const desired = chartTicker.toUpperCase();
    return inferredDarkFeed.items
      .filter((event) => inferDarkUnderlying(event, resolvedEquityJoinMap) === desired)
      .sort((a, b) => {
        const delta = a.source_ts - b.source_ts;
        if (delta !== 0) {
          return delta;
        }
        return a.seq - b.seq;
      });
  }, [chartTicker, inferredDarkFeed.items, resolvedEquityJoinMap, routeFeatures.showChartPane]);

  const findAlertForClassifierHit = useCallback(
    (hit: ClassifierHitEvent): AlertEvent | null => {
      const packetId = extractPacketIdFromClassifierHitTrace(hit.trace_id);
      if (!packetId) {
        return null;
      }

      const desiredTrace = `alert:${packetId}`;
      return (
        alertsFeed.items.find(
          (item) =>
            item.trace_id === desiredTrace || getAlertFlowPacketRefs(item).includes(packetId)
        ) ?? null
      );
    },
    [alertsFeed.items, extractPacketIdFromClassifierHitTrace]
  );

  const openFromClassifierHit = useCallback(
    (hit: ClassifierHitEvent) => {
      const alert = findAlertForClassifierHit(hit);
      if (alert) {
        setSelectedNewsStory(null);
        setSelectedClassifierHit(null);
        setSelectedDarkEvent(null);
        setSelectedSmartFlowProjection(null);
        setSelectedSmartMoneyEvent(null);
        setSelectedAlert(alert);
        return;
      }

      setSelectedNewsStory(null);
      setSelectedAlert(null);
      setSelectedDarkEvent(null);
      setSelectedSmartFlowProjection(null);
      setSelectedSmartMoneyEvent(null);
      setSelectedClassifierHit(hit);
    },
    [findAlertForClassifierHit]
  );

  const openFromSmartFlowProjection = useCallback(
    (projection: SmartFlowExplainabilityProjection) => {
      setSelectedNewsStory(null);
      setSelectedAlert(null);
      setSelectedClassifierHit(null);
      setSelectedDarkEvent(null);
      setSelectedSmartMoneyEvent(null);
      setSelectedSmartFlowProjection(projection);
    },
    []
  );

  const openFromSmartMoneyEvent = useCallback((event: SmartMoneyEvent) => {
    setSelectedNewsStory(null);
    setSelectedAlert(null);
    setSelectedClassifierHit(null);
    setSelectedDarkEvent(null);
    setSelectedSmartFlowProjection(null);
    setSelectedSmartMoneyEvent(event);
  }, []);

  const handleSmartMoneyMarkerClick = useCallback(
    (event: SmartMoneyEvent) => {
      openFromSmartMoneyEvent(event);
    },
    [openFromSmartMoneyEvent]
  );

  const handleSmartFlowMarkerClick = useCallback(
    (projection: SmartFlowExplainabilityProjection) => {
      openFromSmartFlowProjection(projection);
    },
    [openFromSmartFlowProjection]
  );

  const handleDarkMarkerClick = useCallback((event: InferredDarkEvent) => {
    setSelectedNewsStory(null);
    setSelectedAlert(null);
    setSelectedClassifierHit(null);
    setSelectedSmartFlowProjection(null);
    setSelectedSmartMoneyEvent(null);
    setSelectedDarkEvent(event);
  }, []);

  const lastSeen = useMemo(() => {
    const updates: Array<number | null> = [];
    if (routeFeatures.options || routeFeatures.showOptionsPane) {
      updates.push(optionsFeed.lastUpdate);
    }
    if (routeFeatures.equities || routeFeatures.showEquitiesPane) {
      updates.push(equitiesFeed.lastUpdate);
    }
    if (routeFeatures.inferredDark || routeFeatures.showDarkPane) {
      updates.push(inferredDarkFeed.lastUpdate);
    }
    if (routeFeatures.flow || routeFeatures.showFlowPane) {
      updates.push(flowFeed.lastUpdate);
    }
    if (routeFeatures.news || routeFeatures.showNewsPane) {
      updates.push(newsFeed.lastUpdate);
    }
    if (routeFeatures.alerts || routeFeatures.showAlertsPane) {
      updates.push(alertsFeed.lastUpdate);
    }
    if (routeFeatures.durableRows) {
      updates.push(durableRowsFeed.lastUpdate);
    }
    if (routeFeatures.smartFlow || routeFeatures.showChartPane) {
      updates.push(smartFlowFeed.lastUpdate);
    }
    if (routeFeatures.smartMoney || routeFeatures.showChartPane) {
      updates.push(smartMoneyFeed.lastUpdate);
    }
    if (routeFeatures.classifierHits) {
      updates.push(classifierHitsFeed.lastUpdate);
    }
    return (
      updates.filter((value): value is number => value !== null).sort((a, b) => b - a)[0] ?? null
    );
  }, [
    routeFeatures.options,
    routeFeatures.showOptionsPane,
    routeFeatures.equities,
    routeFeatures.showEquitiesPane,
    routeFeatures.inferredDark,
    routeFeatures.showDarkPane,
    routeFeatures.flow,
    routeFeatures.showFlowPane,
    routeFeatures.news,
    routeFeatures.showNewsPane,
    routeFeatures.alerts,
    routeFeatures.showAlertsPane,
    routeFeatures.durableRows,
    routeFeatures.smartFlow,
    routeFeatures.smartMoney,
    routeFeatures.showChartPane,
    routeFeatures.classifierHits,
    optionsFeed.lastUpdate,
    equitiesFeed.lastUpdate,
    inferredDarkFeed.lastUpdate,
    flowFeed.lastUpdate,
    newsFeed.lastUpdate,
    alertsFeed.lastUpdate,
    durableRowsFeed.lastUpdate,
    smartMoneyFeed.lastUpdate,
    smartFlowFeed.lastUpdate,
    classifierHitsFeed.lastUpdate
  ]);

  return {
    mode,
    setMode,
    replaySource,
    setReplaySource,
    selectedAlert,
    setSelectedAlert,
    selectedNewsStory,
    setSelectedNewsStory,
    selectedDarkEvent,
    setSelectedDarkEvent,
    selectedClassifierHit,
    setSelectedClassifierHit,
    selectedSmartFlowProjection,
    setSelectedSmartFlowProjection,
    selectedSmartMoneyEvent,
    setSelectedSmartMoneyEvent,
    selectedInstrument,
    setSelectedInstrument,
    clearSelectedInstrument,
    selectedInstrumentLabel,
    filterInput,
    setFilterInput,
    flowFilters,
    setFlowFilters,
    chartIntervalMs,
    setChartIntervalMs,
    optionsScroll,
    equitiesScroll,
    flowScroll,
    darkScroll,
    alertsScroll,
    classifierScroll,
    newsScroll,
    options: optionsFeed,
    equities: equitiesFeed,
    equityJoins: equityJoinsFeed,
    nbbo: nbboFeed,
    inferredDark: inferredDarkFeed,
    news: newsFeed,
    flow: flowFeed,
    alerts: alertsFeed,
    durableRows: durableRowsFeed,
    smartFlow: smartFlowFeed,
    smartMoney: smartMoneyFeed,
    classifierHits: classifierHitsFeed,
    liveSession,
    routeFeatures,
    activeTickers,
    tickerSet,
    chartTicker,
    nbboMap,
    historicalNbboByTraceId,
    optionPrintMap: resolvedOptionPrintMap,
    equityJoinMap: resolvedEquityJoinMap,
    flowPacketMap: resolvedFlowPacketMap,
    classifierHitsByPacketId,
    packetIdByOptionTraceId,
    classifierDecorByOptionTraceId,
    selectedDarkEvidence,
    selectedDarkUnderlying,
    selectedClassifierPacketId,
    selectedClassifierFlowPacket,
    selectedClassifierEvidence,
    selectedSmartFlowEvidence,
    selectedSmartMoneyFlowPacket,
    selectedSmartMoneyEvidence,
    filteredOptions,
    filteredEquities,
    optionsScopedQuiet,
    equitiesScopedQuiet,
    equitiesSilentWarning,
    filteredInferredDark,
    filteredNews,
    filteredFlow,
    filteredAlerts,
    filteredDurableOptionRows,
    filteredDurableAlertRows,
    filteredSmartFlowProjections,
    filteredSmartMoneyEvents,
    filteredClassifierHits,
    chartSmartFlowProjections,
    chartSmartMoneyEvents,
    chartInferredDark,
    focusOptionContract,
    focusEquityTicker,
    focusFlowPacketRequest,
    focusAlertContract,
    focusAlertEquity,
    clearSelectedAlert,
    openFromSmartFlowProjection,
    openFromSmartMoneyEvent,
    openFromClassifierHit,
    handleSmartFlowMarkerClick,
    handleSmartMoneyMarkerClick,
    handleDarkMarkerClick,
    lastSeen,
    toggleMode: () => {
      setMode((prev) => (prev === "live" ? "replay" : "live"));
    }
  };
};

export type TerminalState = ReturnType<typeof useTerminalState>;

type TerminalSelector<T> = (state: TerminalState) => T;
type TerminalSelectorEquality<T> = (left: T, right: T) => boolean;

type TerminalStateStore = {
  getSnapshot: () => TerminalState;
  setSnapshot: (state: TerminalState) => void;
  subscribe: (listener: () => void) => () => void;
};

const createTerminalStateStore = (initialState: TerminalState): TerminalStateStore => {
  let snapshot = initialState;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (state) => {
      if (Object.is(snapshot, state)) {
        return;
      }
      snapshot = state;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};

export const TerminalContext = createContext<TerminalStateStore | null>(null);
export const TerminalStateStoreContext = TerminalContext;

export const useTerminalStateStore = (state: TerminalState): TerminalStateStore => {
  const storeRef = useRef<TerminalStateStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTerminalStateStore(state);
  }

  useLayoutEffect(() => {
    storeRef.current?.setSnapshot(state);
  }, [state]);

  return storeRef.current;
};

export const useTerminal = (): TerminalState => {
  const store = useContext(TerminalContext);
  if (!store) {
    throw new Error("Terminal context missing");
  }
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};

export const shallowEqualTerminalSelection = <T extends Record<string, unknown>>(
  left: T,
  right: T
): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
};

export const useTerminalSelector = <T,>(
  selector: TerminalSelector<T>,
  isEqual: TerminalSelectorEquality<T> = Object.is
): T => {
  const store = useContext(TerminalStateStoreContext);
  if (!store) {
    throw new Error("Terminal state store missing");
  }

  const selectedRef = useRef<T | null>(null);
  const hasSelectedRef = useRef(false);
  const selectorRef = useLatestRef(selector);
  const equalityRef = useLatestRef(isEqual);

  const getSelectedSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getSnapshot());
    if (hasSelectedRef.current && equalityRef.current(selectedRef.current as T, next)) {
      return selectedRef.current as T;
    }
    selectedRef.current = next;
    hasSelectedRef.current = true;
    return next;
  }, [equalityRef, selectorRef, store]);

  return useSyncExternalStore(store.subscribe, getSelectedSnapshot, getSelectedSnapshot);
};

export { EMPTY_FLOW_PACKET_MAP, EMPTY_OPTION_PRINT_MAP };
