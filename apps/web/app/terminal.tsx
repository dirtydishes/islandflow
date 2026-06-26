"use client";

import { memo, type ReactNode, useMemo } from "react";

import { AlertsModule } from "../features/alerts";
import { createStaticEquitiesTapeSource, EquitiesTape } from "../features/equities-tape";
import { createStaticFlowPacketsTapeSource, FlowPacketsTape } from "../features/flow-packets";
import { NewsWire } from "../features/news-wire";
import { OptionsTape } from "../features/options-tape";
import { DurableTapeAlertRowsPane, DurableTapeOptionRowsPane } from "../features/durable-tape";
import { TerminalMarketChartSection } from "../features/terminal/chart-adapter";
import {
  CommandDecisionLevels,
  CommandDeckHeader,
  CommandMetricsStrip,
  CommandPriorityBoard,
  CommandSymbolRail,
  EventContextPane,
  FeedHealthPane,
  HomeReplayRail
} from "../features/terminal/components/charts";
import { renderTerminalDrawers } from "../features/terminal/components/drawers";
import { OpraIntakeRail } from "../features/terminal/components/opra";
import { FlowFilterPopover, PageFrame } from "../features/terminal/components/primitives";
import {
  selectDurableTapesAlertsPane,
  selectDurableTapesEquitiesPane,
  selectDurableTapesFlowPane,
  selectDurableTapesNewsPane,
  selectDurableTapesOptionsPane
} from "../features/terminal/pane-state";
import { TerminalAppShell as TerminalFeatureAppShell } from "../features/terminal/shell";
import {
  shallowEqualTerminalSelection,
  useTerminal,
  useTerminalSelector
} from "../features/terminal/state";

export type { TerminalMarketChartMarkerPayload } from "../features/terminal/chart-adapter";
export {
  buildTerminalEquityOverlays,
  buildTerminalLowerPaneInput,
  buildTerminalMarketChartHoverRowProvider,
  buildTerminalMarketChartMarkers,
  getTerminalChartReplayEndTs,
  mapTerminalChartStatus,
  normalizeTerminalChartCandles
} from "../features/terminal/chart-adapter";
export type { ChartFlowMarkerItem } from "../features/terminal/charts/markers";
export { getChartFlowMarkerItems } from "../features/terminal/charts/markers";
export {
  getTapeVirtualConfig,
  isSyntheticAdminVisible,
  shouldIncludeEquitiesForDarkUnderlyingFallback
} from "../features/terminal/config";
export {
  buildAlertContextPath,
  collectAlertContextEvidence,
  getAlertFlowPacketRefs,
  getSmartFlowEvidenceRefs,
  getSmartFlowOptionPrintRefs,
  getSmartFlowPacketRefs,
  getSmartFlowPinnedFlowKeys,
  getSmartFlowPinnedOptionKeys,
  prunePinnedEntries,
  resolveAlertFlowPacket
} from "../features/terminal/evidence";
export {
  buildDefaultFlowFilters,
  buildOptionTapeQueryParams,
  countActiveFlowFilterGroups,
  filterOptionTapeItems,
  getEffectiveOptionPrintFilters,
  getOptionScope,
  nextFlowFilterPopoverState,
  normalizeTickerFilterInput,
  parseTickerFilterInput,
  shouldClearOptionFocusSeed,
  shouldRetainLiveSnapshotHistory,
  shouldShowEquitiesSilentFeedWarning,
  toggleFilterValue
} from "../features/terminal/filters";
export {
  classifierToneForFamily,
  decodeNewsText,
  deriveAlertDirection,
  formatCompactUsd,
  formatNewsTimestamp,
  formatOptionContractLabel,
  getAlertWindowAnchorTs,
  getOptionTableSnapshot,
  normalizeAlertSeverity,
  selectPrimaryClassifierHit,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  smartMoneyProfileLabel,
  smartMoneyToneForProfile,
  statusLabel
} from "../features/terminal/format";
export { getLiveSubscriptionResetChannels } from "../features/terminal/live";
export {
  selectDurableTapesAlertsPane,
  selectDurableTapesEquitiesPane,
  selectDurableTapesFlowPane,
  selectDurableTapesNewsPane,
  selectDurableTapesOptionsPane
} from "../features/terminal/pane-state";
export {
  getLiveManifest,
  getRouteFeatures,
  getTerminalNavCurrentHref,
  NAV_ITEMS,
  normalizeTerminalPathname,
  buildDurableTapesRouteFeatures
} from "../features/terminal/routes";
export { shallowEqualTerminalSelection } from "../features/terminal/state";
export {
  appendHistoryTail,
  composeTapeItems,
  findAnchorRestoreIndex,
  flushPausableTapeData,
  getHotChannelFeedStatus,
  getLiveFeedStatus,
  getLiveHistoryRetentionCap,
  mergeHeldTapeHistory,
  mergeNewestWithOverflow,
  projectPausableTapeState,
  reducePausableTapeData
} from "../features/terminal/tape";
export { FlowFilterPopover };

export function TerminalAppShell({ children }: { children: ReactNode }) {
  return (
    <TerminalFeatureAppShell renderDrawers={renderTerminalDrawers}>
      {children}
    </TerminalFeatureAppShell>
  );
}

const DURABLE_TAPES_ROUTE_FEATURES = [
  "default",
  { key: "clickhouseHistory", enabled: false },
  { key: "settingsGear", enabled: false }
] as const;

export function OverviewRoute() {
  const state = useTerminal();
  const flowSource = useMemo(
    () => createStaticFlowPacketsTapeSource(state.filteredFlow),
    [state.filteredFlow]
  );
  const equitiesSource = useMemo(
    () => createStaticEquitiesTapeSource(state.filteredEquities),
    [state.filteredEquities]
  );
  const compactTapeFeatures = useMemo(
    () =>
      [
        "default",
        { key: "clickhouseHistory", enabled: false },
        { key: "settingsGear", enabled: false }
      ] as const,
    []
  );

  return (
    <PageFrame title="Market Command" eyebrow="Dashboard" variant="dashboard">
      <div className="market-command-shell">
        <CommandDeckHeader state={state} />
        <CommandMetricsStrip state={state} />
        <CommandSymbolRail state={state} />
        <div className="market-command-grid">
          <CommandPriorityBoard state={state} />
          <TerminalMarketChartSection
            state={state}
            title="Chart Context"
            className="market-command-chart"
          />
          <CommandDecisionLevels state={state} />
          <OptionsTape
            className="command-contracts-tape"
            decorByTraceId={state.classifierDecorByOptionTraceId}
            features={compactTapeFeatures}
            filters={state.flowFilters}
            flowPacketById={state.flowPacketMap}
            focusedContractId={
              state.selectedInstrument?.kind === "option-contract"
                ? state.selectedInstrument.contractId
                : null
            }
            nbboByContractId={state.nbboMap}
            nbboByTraceId={state.historicalNbboByTraceId}
            onClearFocus={() => state.setSelectedInstrument(null)}
            onContractFocus={state.focusOptionContract}
            onFiltersChange={state.setFlowFilters}
            onPacketFocus={state.focusFlowPacketRequest}
            packetIdByOptionTraceId={state.packetIdByOptionTraceId}
            prints={state.filteredOptions.slice(0, 36)}
            rowHeight={34}
            smartFlowProjections={state.filteredSmartFlowProjections}
            template="half"
            title="Recent Contracts"
          />
          <FlowPacketsTape
            className="command-flow-tape"
            features={compactTapeFeatures}
            filters={state.flowFilters}
            onPacketFocus={state.focusFlowPacketRequest}
            rowHeight={40}
            source={flowSource}
            template="oneThird"
            title="Flow Packets"
          />
          <EquitiesTape
            className="command-equities-tape"
            features={compactTapeFeatures}
            onTickerFocus={(event) => state.focusEquityTicker(event.print)}
            rowHeight={34}
            source={equitiesSource}
            template="oneThird"
            title="Equities Tape"
          />
          <FeedHealthPane state={state} />
          <EventContextPane state={state} />
          <HomeReplayRail state={state} />
        </div>
      </div>
    </PageFrame>
  );
}

const DurableTapesOptionsPane = memo(function DurableTapesOptionsPane() {
  const pane = useTerminalSelector(selectDurableTapesOptionsPane, shallowEqualTerminalSelection);

  if (pane.useRowViewModels) {
    return (
      <DurableTapeOptionRowsPane
        className="durable-tapes-options"
        features={DURABLE_TAPES_ROUTE_FEATURES}
        onContractFocus={pane.onContractFocus}
        onPacketFocus={pane.onPacketFocus}
        rows={pane.rowViewModels}
        rowHeight={34}
        title="Options Tape"
      />
    );
  }

  return (
    <OptionsTape
      className="durable-tapes-options"
      decorByTraceId={pane.decorByTraceId}
      features={DURABLE_TAPES_ROUTE_FEATURES}
      filters={pane.filters}
      flowPacketById={pane.flowPacketById}
      focusedContractId={pane.focusedContractId}
      nbboByContractId={pane.nbboByContractId}
      nbboByTraceId={pane.nbboByTraceId}
      onClearFocus={pane.onClearFocus}
      onContractFocus={pane.onContractFocus}
      onFiltersChange={pane.onFiltersChange}
      onPacketFocus={pane.onPacketFocus}
      packetIdByOptionTraceId={pane.packetIdByOptionTraceId}
      prints={pane.prints}
      rowHeight={34}
      smartFlowProjections={pane.smartFlowProjections}
      title="Options Tape"
    />
  );
});

const DurableTapesFlowPane = memo(function DurableTapesFlowPane() {
  const pane = useTerminalSelector(selectDurableTapesFlowPane, shallowEqualTerminalSelection);
  const source = useMemo(() => createStaticFlowPacketsTapeSource(pane.packets), [pane.packets]);

  return (
    <FlowPacketsTape
      className="durable-tapes-flow"
      features={DURABLE_TAPES_ROUTE_FEATURES}
      filters={pane.filters}
      onPacketFocus={pane.onPacketFocus}
      rowHeight={40}
      source={source}
      title="Flow Packets"
    />
  );
});

const DurableTapesEquitiesPane = memo(function DurableTapesEquitiesPane() {
  const pane = useTerminalSelector(selectDurableTapesEquitiesPane, shallowEqualTerminalSelection);
  const source = useMemo(() => createStaticEquitiesTapeSource(pane.prints), [pane.prints]);

  return (
    <EquitiesTape
      className="durable-tapes-equities"
      features={DURABLE_TAPES_ROUTE_FEATURES}
      onTickerFocus={(event) => pane.onTickerFocus(event.print)}
      rowHeight={34}
      source={source}
      title="Equities Tape"
    />
  );
});

const DurableTapesAlertsPane = memo(function DurableTapesAlertsPane() {
  const pane = useTerminalSelector(selectDurableTapesAlertsPane, shallowEqualTerminalSelection);

  if (pane.useRowViewModels) {
    return (
      <DurableTapeAlertRowsPane
        className="durable-tapes-alerts"
        features={DURABLE_TAPES_ROUTE_FEATURES}
        rows={pane.rowViewModels}
        rowHeight={36}
        title="Alerts"
      />
    );
  }

  return (
    <AlertsModule
      alerts={pane.alerts}
      className="durable-tapes-alerts"
      features={DURABLE_TAPES_ROUTE_FEATURES}
      flowPacketById={pane.flowPacketById}
      onCloseDetail={pane.onCloseDetail}
      onContractFocus={pane.onContractFocus}
      onEquityFocus={pane.onEquityFocus}
      onPacketFocus={pane.onPacketFocus}
      onSelectAlert={pane.onSelectAlert}
      optionPrintByTraceId={pane.optionPrintByTraceId}
      rowHeight={36}
      selectedAlert={pane.selectedAlert}
      title="Alerts"
    />
  );
});

const DurableTapesNewsPane = memo(function DurableTapesNewsPane() {
  const pane = useTerminalSelector(selectDurableTapesNewsPane, shallowEqualTerminalSelection);

  return (
    <NewsWire
      className="durable-tapes-news"
      historyEnabled={false}
      lastUpdate={pane.lastUpdate}
      liveEnabled={pane.liveEnabled}
      scopeSymbols={pane.activeTickers}
      showControlRails
      status={pane.status}
      stories={pane.stories}
      title="News Wire"
    />
  );
});

export function DurableTapesExampleRoute() {
  return (
    <PageFrame title="Durable Tapes" eyebrow="QA" variant="durable-tapes">
      <div className="durable-tapes-route-shell">
        <div className="durable-tapes-grid">
          <DurableTapesOptionsPane />
          <DurableTapesFlowPane />
          <DurableTapesEquitiesPane />
          <DurableTapesAlertsPane />
          <DurableTapesNewsPane />
        </div>
      </div>
    </PageFrame>
  );
}

export function NewsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="Newswire" eyebrow="News" variant="news">
      <div className="wire-control-shell">
        <NewsWire
          className="news-pane-full"
          lastUpdate={state.liveSession.lastUpdate}
          liveEnabled={state.mode === "live"}
          scopeSymbols={state.activeTickers}
          showControlRails
          status={state.liveSession.status}
          stories={state.liveSession.news}
        />
      </div>
    </PageFrame>
  );
}

export function OptionsRoute() {
  const state = useTerminal();
  return (
    <PageFrame title="OPRA Intake" eyebrow="Options" variant="options">
      <div className="opra-intake-shell">
        <OpraIntakeRail state={state} />
        <div className="opra-intake-grid opra-intake-grid-tape-first">
          <OptionsTape
            className="opra-options-tape"
            decorByTraceId={state.classifierDecorByOptionTraceId}
            filters={state.flowFilters}
            flowPacketById={state.flowPacketMap}
            focusedContractId={
              state.selectedInstrument?.kind === "option-contract"
                ? state.selectedInstrument.contractId
                : null
            }
            nbboByContractId={state.nbboMap}
            nbboByTraceId={state.historicalNbboByTraceId}
            onClearFocus={() => state.setSelectedInstrument(null)}
            onContractFocus={state.focusOptionContract}
            onFiltersChange={state.setFlowFilters}
            onPacketFocus={state.focusFlowPacketRequest}
            packetIdByOptionTraceId={state.packetIdByOptionTraceId}
            prints={state.filteredOptions}
            smartFlowProjections={state.filteredSmartFlowProjections}
            title="OPRA Tape"
          />
        </div>
      </div>
    </PageFrame>
  );
}
