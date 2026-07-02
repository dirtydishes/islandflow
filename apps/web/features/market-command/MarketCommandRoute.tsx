"use client";

import type { NewsStory, OptionPrint, SmartFlowAlertEvent } from "@islandflow/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlertsModule } from "../alerts";
import { DurableTapeAlertRowsPane, DurableTapeOptionRowsPane } from "../durable-tape";
import {
  createStaticFlowPacketsTapeSource,
  type FlowPacketFocusRequest,
  FlowPacketsTape
} from "../flow-packets";
import { NewsWire } from "../news-wire";
import { OptionsTape } from "../options-tape";
import {
  type TerminalMarketChartMarkerPayload,
  TerminalMarketChartSection
} from "../terminal/chart-adapter";
import { PageFrame } from "../terminal/components/primitives";
import type { TerminalState } from "../terminal/state";
import { inferDarkUnderlying } from "../terminal/state-helpers";
import { MarketCommandChrome } from "./MarketCommandChrome";
import { type MarketCommandDetail, MarketCommandDetailDrawer } from "./MarketCommandDetailDrawer";
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
  const [detail, setDetail] = useState<MarketCommandDetail | null>(null);
  const preserveNextFocusDetailRef = useRef(false);
  const flowSource = useMemo(
    () => createStaticFlowPacketsTapeSource(state.filteredFlow),
    [state.filteredFlow]
  );
  const focusSignature = useMemo(
    () =>
      [
        state.activeTickers.join(","),
        state.selectedInstrumentLabel ?? "",
        state.filterInput,
        state.chartTicker
      ].join("|"),
    [state.activeTickers, state.chartTicker, state.filterInput, state.selectedInstrumentLabel]
  );
  const previousFocusSignatureRef = useRef(focusSignature);
  const focusedContractId =
    state.selectedInstrument?.kind === "option-contract"
      ? state.selectedInstrument.contractId
      : null;
  const hasDurableAlerts = state.filteredDurableAlertRows.length > 0;
  const hasDurableOptions = state.filteredDurableOptionRows.length > 0;
  const selectedDurableAlertRowId = detail?.kind === "durable-alert-row" ? detail.row.id : null;

  useEffect(() => {
    if (previousFocusSignatureRef.current === focusSignature) {
      return;
    }
    previousFocusSignatureRef.current = focusSignature;
    if (preserveNextFocusDetailRef.current) {
      preserveNextFocusDetailRef.current = false;
      return;
    }
    setDetail(null);
  }, [focusSignature]);

  const closeDetail = useCallback(() => setDetail(null), []);

  const clearTerminalDrawerSelections = useCallback(() => {
    state.setSelectedAlert(null);
    state.setSelectedNewsStory(null);
    state.setSelectedDarkEvent(null);
    state.setSelectedSmartFlowProjection(null);
  }, [state]);

  const openDetail = useCallback(
    (nextDetail: MarketCommandDetail) => {
      clearTerminalDrawerSelections();
      setDetail(nextDetail);
    },
    [clearTerminalDrawerSelections]
  );

  const preserveDetailForFocusChange = useCallback(() => {
    preserveNextFocusDetailRef.current = true;
    window.setTimeout(() => {
      preserveNextFocusDetailRef.current = false;
    }, 0);
  }, []);

  const focusOptionContract = useCallback(
    (print: OptionPrint) => {
      setDetail(null);
      state.focusOptionContract(print);
    },
    [state]
  );

  const focusFlowPacket = useCallback(
    (request: FlowPacketFocusRequest) => {
      setDetail(null);
      state.focusFlowPacketRequest(request);
    },
    [state]
  );

  const openLegacyAlert = useCallback(
    (alert: SmartFlowAlertEvent) => {
      openDetail({ kind: "legacy-alert", alert });
    },
    [openDetail]
  );

  const openNewsDetail = useCallback(
    (story: NewsStory) => {
      openDetail({ kind: "news", story });
    },
    [openDetail]
  );

  const openChartMarkerDetail = useCallback(
    (payload: TerminalMarketChartMarkerPayload) => {
      if (payload.kind === "smart-flow") {
        preserveDetailForFocusChange();
        state.focusTickerSymbol(payload.projection.hypothesis.underlying_id, "manual");
        openDetail({ kind: "smart-flow", projection: payload.projection });
        return;
      }

      const underlying = inferDarkUnderlying(payload.event, state.equityJoinMap);
      if (underlying) {
        preserveDetailForFocusChange();
        state.focusTickerSymbol(underlying, "manual");
      }
      openDetail({ kind: "inferred-dark", event: payload.event });
    },
    [openDetail, preserveDetailForFocusChange, state]
  );

  return (
    <PageFrame title="Market Command" eyebrow="Dashboard" variant="dashboard">
      <div className="market-command-shell">
        <MarketCommandChrome state={state} />
        <MarketCommandTickerRail state={state} />
        <div className="market-command-layout" data-testid="market-command-layout">
          <TerminalMarketChartSection
            className="market-command-chart-pane"
            onMarkerSelect={openChartMarkerDetail}
            state={state}
            title="Chart Context"
          />

          {hasDurableAlerts ? (
            <DurableTapeAlertRowsPane
              className="market-command-alerts-pane"
              features={ALERT_TAPE_FEATURES}
              detailMode="external"
              onSelectRow={(row) => openDetail({ kind: "durable-alert-row", row })}
              rowHeight={36}
              rows={state.filteredDurableAlertRows}
              selectedRowId={selectedDurableAlertRowId}
              title="Alerts Triage"
            />
          ) : (
            <AlertsModule
              alerts={state.filteredAlerts}
              className="market-command-alerts-pane"
              features={ALERT_TAPE_FEATURES}
              flowPacketById={state.flowPacketMap}
              onCloseDetail={closeDetail}
              onContractFocus={state.focusAlertContract}
              onEquityFocus={state.focusAlertEquity}
              onPacketFocus={focusFlowPacket}
              onSelectAlert={openLegacyAlert}
              optionPrintByTraceId={state.optionPrintMap}
              selectedAlert={detail?.kind === "legacy-alert" ? detail.alert : null}
              showDetail={false}
              template="oneThird"
              title="Alerts Triage"
            />
          )}

          <FlowPacketsTape
            className="market-command-flow-pane"
            features={COMPACT_TAPE_FEATURES}
            filters={state.flowFilters}
            onPacketFocus={focusFlowPacket}
            rowHeight={40}
            source={flowSource}
            template="oneThird"
            title="Flow Packets"
          />

          {hasDurableOptions ? (
            <DurableTapeOptionRowsPane
              className="market-command-options-pane"
              features={OPTION_TAPE_FEATURES}
              onContractFocus={focusOptionContract}
              onPacketFocus={focusFlowPacket}
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
              onContractFocus={focusOptionContract}
              onFiltersChange={state.setFlowFilters}
              onPacketFocus={focusFlowPacket}
              packetIdByOptionTraceId={state.packetIdByOptionTraceId}
              prints={state.filteredOptions}
              rowHeight={34}
              smartFlowDetailMode="disabled"
              template="half"
              title="Options Tape"
            />
          )}

          <NewsWire
            className="market-command-news-pane"
            lastUpdate={state.news.lastUpdate ?? state.liveSession.lastUpdate}
            detailMode="external"
            liveEnabled={state.mode === "live"}
            onStorySelect={openNewsDetail}
            scopeSymbols={state.activeTickers}
            showControlRails
            status={state.liveSession.status}
            stories={state.filteredNews}
            title="News Wire"
          />
        </div>
        <MarketCommandDetailDrawer detail={detail} state={state} onClose={closeDetail} />
      </div>
    </PageFrame>
  );
};
