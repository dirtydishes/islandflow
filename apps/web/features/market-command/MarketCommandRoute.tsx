"use client";

import { useMemo } from "react";

import { AlertsModule } from "../alerts";
import { DurableTapeAlertRowsPane, DurableTapeOptionRowsPane } from "../durable-tape";
import { createStaticFlowPacketsTapeSource, FlowPacketsTape } from "../flow-packets";
import { NewsWire } from "../news-wire";
import { OptionsTape } from "../options-tape";
import { TerminalMarketChartSection } from "../terminal/chart-adapter";
import { PageFrame } from "../terminal/components/primitives";
import type { TerminalState } from "../terminal/state";
import { MarketCommandChrome } from "./MarketCommandChrome";
import { MarketCommandTickerRail } from "./MarketCommandTickerRail";

const COMPACT_TAPE_FEATURES = [
  "default",
  { key: "clickhouseHistory", enabled: false },
  { key: "settingsGear", enabled: false }
] as const;

const ALERT_TAPE_FEATURES = [
  ...COMPACT_TAPE_FEATURES,
  { key: "template", value: "oneThird" }
] as const;

const OPTION_TAPE_FEATURES = [
  ...COMPACT_TAPE_FEATURES,
  { key: "template", value: "half" }
] as const;

export const MarketCommandRoute = ({ state }: { state: TerminalState }) => {
  const flowSource = useMemo(
    () => createStaticFlowPacketsTapeSource(state.filteredFlow),
    [state.filteredFlow]
  );
  const focusedContractId =
    state.selectedInstrument?.kind === "option-contract"
      ? state.selectedInstrument.contractId
      : null;
  const hasDurableAlerts = state.filteredDurableAlertRows.length > 0;
  const hasDurableOptions = state.filteredDurableOptionRows.length > 0;

  return (
    <PageFrame title="Market Command" eyebrow="Dashboard" variant="dashboard">
      <div className="market-command-shell">
        <MarketCommandChrome state={state} />
        <MarketCommandTickerRail state={state} />
        <div className="market-command-layout" data-testid="market-command-layout">
          <TerminalMarketChartSection
            className="market-command-chart-pane"
            state={state}
            title="Chart Context"
          />

          {hasDurableAlerts ? (
            <DurableTapeAlertRowsPane
              className="market-command-alerts-pane"
              features={ALERT_TAPE_FEATURES}
              rowHeight={36}
              rows={state.filteredDurableAlertRows}
              title="Alerts Triage"
            />
          ) : (
            <AlertsModule
              alerts={state.filteredAlerts}
              className="market-command-alerts-pane"
              features={ALERT_TAPE_FEATURES}
              flowPacketById={state.flowPacketMap}
              onCloseDetail={() => state.setSelectedAlert(null)}
              onContractFocus={state.focusAlertContract}
              onEquityFocus={state.focusAlertEquity}
              onPacketFocus={state.focusFlowPacketRequest}
              onSelectAlert={(alert) => {
                state.setSelectedNewsStory(null);
                state.setSelectedDarkEvent(null);
                state.setSelectedSmartFlowProjection(null);
                state.setSelectedAlert(alert);
              }}
              optionPrintByTraceId={state.optionPrintMap}
              selectedAlert={state.selectedAlert}
              showDetail={false}
              template="oneThird"
              title="Alerts Triage"
            />
          )}

          <FlowPacketsTape
            className="market-command-flow-pane"
            features={COMPACT_TAPE_FEATURES}
            filters={state.flowFilters}
            onPacketFocus={state.focusFlowPacketRequest}
            rowHeight={40}
            source={flowSource}
            template="oneThird"
            title="Flow Packets"
          />

          {hasDurableOptions ? (
            <DurableTapeOptionRowsPane
              className="market-command-options-pane"
              features={OPTION_TAPE_FEATURES}
              onContractFocus={state.focusOptionContract}
              onPacketFocus={state.focusFlowPacketRequest}
              rowHeight={34}
              rows={state.filteredDurableOptionRows}
              title="Options Tape"
            />
          ) : (
            <OptionsTape
              className="market-command-options-pane"
              features={OPTION_TAPE_FEATURES}
              filters={state.flowFilters}
              flowPacketById={state.flowPacketMap}
              focusedContractId={focusedContractId}
              nbboByContractId={state.nbboMap}
              onClearFocus={() => state.setSelectedInstrument(null)}
              onContractFocus={state.focusOptionContract}
              onFiltersChange={state.setFlowFilters}
              onPacketFocus={state.focusFlowPacketRequest}
              packetIdByOptionTraceId={state.packetIdByOptionTraceId}
              prints={state.filteredOptions}
              rowHeight={34}
              template="half"
              title="Options Tape"
            />
          )}

          <NewsWire
            className="market-command-news-pane"
            lastUpdate={state.news.lastUpdate ?? state.liveSession.lastUpdate}
            liveEnabled={state.mode === "live"}
            scopeSymbols={state.activeTickers}
            showControlRails
            status={state.liveSession.status}
            stories={state.filteredNews}
            title="News Wire"
          />
        </div>
      </div>
    </PageFrame>
  );
};
