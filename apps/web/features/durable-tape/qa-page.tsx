"use client";

import type { DurableTapeOptionRowViewModel } from "@islandflow/types";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";

import { AlertsModule } from "../alerts";
import { buildBrowserApiUrl } from "../api-transport";
import { createStaticEquitiesTapeSource, EquitiesTape } from "../equities-tape";
import { createStaticFlowPacketsTapeSource, FlowPacketsTape } from "../flow-packets";
import {
  buildLowerPaneSeries,
  DEFAULT_MARKET_CHART_SETTINGS,
  MarketChart,
  type MarketChartCandle,
  type MarketChartCandleInput,
  type MarketChartLayoutPresetId,
  type MarketChartLowerSeries,
  MarketChartSection,
  type MarketChartSettingsState,
  type MarketChartStatus,
  normalizeMarketChartCandles
} from "../market-chart";
import { NewsWire } from "../news-wire";
import { OptionsTape } from "../options-tape";
import {
  getDurableOptionSupportStateLabel,
  getDurableOptionSupportStateTone
} from "./row-view-models";
import { PageFrame } from "../terminal/components/primitives";
import {
  selectDurableTapesAlertsPane,
  selectDurableTapesEquitiesPane,
  selectDurableTapesFlowPane,
  selectDurableTapesNewsPane,
  selectDurableTapesOptionsPane
} from "../terminal/pane-state";
import { useTerminal } from "../terminal/state";
import type { DurableTapeFeatureInput, DurableTapeTemplateId } from "./types";

type QaTemplateId = Extract<DurableTapeTemplateId, "full" | "twoThirds" | "oneThird">;

type QaTemplateLane = {
  id: QaTemplateId;
  label: string;
  caption: string;
  sizeClass: string;
};

type QaSectionProps = {
  id: string;
  title: string;
  summary: string;
  options: string[];
  children: ReactNode;
  style?: CSSProperties;
};

type QaTemplateMatrixProps = {
  renderPreview: (template: QaTemplateId) => ReactNode;
};

type QaChartPreviewProps = {
  template: QaTemplateId;
  candles: MarketChartCandle[];
  lowerSeries: MarketChartLowerSeries;
  status: MarketChartStatus;
};

type QaOptionsSupportDiagnosticsProps = {
  rows: readonly DurableTapeOptionRowViewModel[];
  status: string;
};

const QA_INTERVAL_MS = 60_000;
const QA_FEATURES: DurableTapeFeatureInput[] = [
  "default",
  { key: "clickhouseHistory", enabled: false },
  { key: "settingsGear", enabled: false }
];
const QA_TEMPLATE_LANES: QaTemplateLane[] = [
  {
    id: "full",
    label: "Full",
    caption: "Default full template",
    sizeClass: "durable-tapes-template-frame-full"
  },
  {
    id: "twoThirds",
    label: "2/3",
    caption: "Default two-thirds template",
    sizeClass: "durable-tapes-template-frame-two-thirds"
  },
  {
    id: "oneThird",
    label: "1/3",
    caption: "Default one-third template",
    sizeClass: "durable-tapes-template-frame-one-third"
  }
];

const formatTemplateId = (template: QaTemplateId): string =>
  template === "twoThirds" ? "twoThirds" : template;

const QA_MARKET_CHART_SETTINGS: MarketChartSettingsState = {
  ...DEFAULT_MARKET_CHART_SETTINGS,
  lowerPane: {
    ...DEFAULT_MARKET_CHART_SETTINGS.lowerPane,
    visible: true,
    mode: "smart-direction",
    activeLayerId: "smart-direction"
  },
  display: {
    ...DEFAULT_MARKET_CHART_SETTINGS.display,
    showMarkers: false,
    showOverlays: false,
    showSmartFlowMarkers: false,
    showInferredDarkMarkers: false,
    density: "dense"
  },
  timeframes: {
    ...DEFAULT_MARKET_CHART_SETTINGS.timeframes,
    intervalMs: QA_INTERVAL_MS
  }
};

const buildByIdMap = <T extends { id?: string; trace_id?: string }>(
  items: readonly T[],
  key: "id" | "trace_id"
): Map<string, T> => {
  const map = new Map<string, T>();
  for (const item of items) {
    const value = item[key];
    if (value) {
      map.set(value, item);
    }
  }
  return map;
};

const useQaChartCandleBootstrap = (): MarketChartCandleInput[] => {
  const [candles, setCandles] = useState<MarketChartCandleInput[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    const url = new URL(buildBrowserApiUrl("/candles/equities"));
    url.searchParams.set("underlying_id", "SPY");
    url.searchParams.set("interval_ms", QA_INTERVAL_MS.toString());
    url.searchParams.set("limit", "300");
    url.searchParams.set("cache", "1");

    void fetch(url.toString(), { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`QA candle bootstrap failed with ${response.status}`);
        }
        return (await response.json()) as { data?: MarketChartCandleInput[] };
      })
      .then((payload) => {
        if (!abort.signal.aborted) {
          setCandles(payload.data ?? []);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.warn("Failed to load QA chart candles", error);
      });

    return () => {
      abort.abort();
    };
  }, []);

  return candles;
};

const QaSection = ({ id, title, summary, options, children, style }: QaSectionProps) => (
  <section className="durable-tapes-qa-section" id={id} style={style}>
    <div className="durable-tapes-qa-section-head">
      <div>
        <h2>{title}</h2>
        <p>{summary}</p>
      </div>
      <div className="durable-tapes-qa-options" aria-label={`${title} QA options`}>
        {options.map((option) => (
          <span className="durable-tapes-qa-option" key={option}>
            {option}
          </span>
        ))}
      </div>
    </div>
    {children}
  </section>
);

const QaTemplateMatrix = ({ renderPreview }: QaTemplateMatrixProps) => (
  <div className="durable-tapes-template-matrix">
    {QA_TEMPLATE_LANES.map((lane) => (
      <div className={`durable-tapes-template-frame ${lane.sizeClass}`} key={lane.id}>
        <div className="durable-tapes-template-label">
          <strong>{lane.label}</strong>
          <span>{lane.caption}</span>
        </div>
        <div className="durable-tapes-template-surface">{renderPreview(lane.id)}</div>
      </div>
    ))}
  </div>
);

const QAMarketChartPreview = ({ template, candles, lowerSeries, status }: QaChartPreviewProps) => {
  const preset: MarketChartLayoutPresetId =
    template === "full" ? "full" : template === "twoThirds" ? "compact" : "embedded";

  return (
    <MarketChartSection
      className="durable-tapes-chart-module"
      title={`SPY smart-flow chart, ${formatTemplateId(template)}`}
      meta="Candles with smart-flow direction bars"
    >
      <div className="durable-tapes-chart-panel">
        <MarketChart
          symbol="SPY"
          intervalMs={QA_INTERVAL_MS}
          candles={candles}
          lowerSeries={lowerSeries}
          settings={QA_MARKET_CHART_SETTINGS}
          status={status}
          layoutPreset={preset}
        />
      </div>
    </MarketChartSection>
  );
};

const SUPPORT_STATE_LABELS: Record<
  DurableTapeOptionRowViewModel["support"]["smart_flow_status"],
  string
> = {
  matched: "Smart-flow attached",
  no_matching_projection: "No matching projection",
  packet_unavailable: "Packet unavailable",
  smart_flow_unavailable: "Smart-flow unavailable"
};

const QaOptionsSupportDiagnostics = ({ rows, status }: QaOptionsSupportDiagnosticsProps) => {
  const counts = useMemo(() => {
    const next = new Map<DurableTapeOptionRowViewModel["support"]["smart_flow_status"], number>();
    for (const row of rows) {
      const key = row.support.smart_flow_status;
      next.set(key, (next.get(key) ?? 0) + 1);
    }
    return next;
  }, [rows]);
  const sampleRows = rows.slice(0, 8);

  return (
    <div className="durable-tapes-support-diagnostics">
      <div className="durable-tapes-support-diagnostics-head">
        <div>
          <span>Support State</span>
          <strong>{rows.length.toLocaleString()} server rows</strong>
        </div>
        <em>Durable rows feed: {status}</em>
      </div>
      {rows.length === 0 ? (
        <p className="durable-tapes-support-empty">
          No server-composed option rows are available for diagnostics.
        </p>
      ) : (
        <>
          <div className="durable-tapes-support-counts" aria-label="Support state counts">
            {Object.entries(SUPPORT_STATE_LABELS).map(([state, label]) => (
              <span key={state}>
                {label}:{" "}
                {(
                  counts.get(
                    state as DurableTapeOptionRowViewModel["support"]["smart_flow_status"]
                  ) ?? 0
                ).toLocaleString()}
              </span>
            ))}
          </div>
          <div
            className="durable-tapes-support-table"
            role="table"
            aria-label="Options support diagnostics"
          >
            <div role="row">
              <span role="columnheader">Trace</span>
              <span role="columnheader">Support State</span>
              <span role="columnheader">Packet</span>
              <span role="columnheader">Reason</span>
            </div>
            {sampleRows.map((row) => (
              <div role="row" key={row.id}>
                <span role="cell">{row.option.trace_id}</span>
                <span
                  className={`options-tape-support-state options-tape-support-state-${getDurableOptionSupportStateTone(row)}`}
                  role="cell"
                >
                  {getDurableOptionSupportStateLabel(row)}
                </span>
                <span role="cell">{row.support.packet?.id ?? "--"}</span>
                <span role="cell">
                  {row.support.smart_flow_unavailable_reason ?? row.evidence_summary?.label ?? "--"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const DurableTapesQaRoute = () => {
  const state = useTerminal();
  const optionsPane = selectDurableTapesOptionsPane(state);
  const flowPane = selectDurableTapesFlowPane(state);
  const equitiesPane = selectDurableTapesEquitiesPane(state);
  const alertsPane = selectDurableTapesAlertsPane(state);
  const newsPane = selectDurableTapesNewsPane(state);
  const optionPrints = optionsPane.prints;
  const flowPackets = flowPane.packets;
  const equityPrints = equitiesPane.prints;
  const smartFlowProjections = optionsPane.smartFlowProjections;
  const alerts = alertsPane.alerts;
  const newsStories = newsPane.stories;
  const fetchedChartCandles = useQaChartCandleBootstrap();
  const chartCandleInput =
    state.liveSession.chartCandles.length > 0
      ? state.liveSession.chartCandles
      : fetchedChartCandles;
  const chartCandles = useMemo(
    () => normalizeMarketChartCandles(chartCandleInput),
    [chartCandleInput]
  );
  const chartLowerSeries = useMemo(
    () =>
      buildLowerPaneSeries("smart-direction", {
        candles: chartCandles,
        smartFlowProjections
      }),
    [chartCandles, smartFlowProjections]
  );
  const chartStatus: MarketChartStatus =
    state.liveSession.status === "connected"
      ? chartCandles.length > 0
        ? "live"
        : "loading"
      : state.liveSession.status === "stale"
        ? "stale"
        : state.liveSession.status === "connecting"
          ? "loading"
          : "error";

  const flowSource = useMemo(() => createStaticFlowPacketsTapeSource(flowPackets), [flowPackets]);
  const equitiesSource = useMemo(
    () => createStaticEquitiesTapeSource(equityPrints),
    [equityPrints]
  );
  const flowPacketByTraceId = useMemo(() => buildByIdMap(flowPackets, "trace_id"), [flowPackets]);
  const liveNewsEnabled = newsPane.liveEnabled;

  return (
    <PageFrame title="Durable Tapes QA" eyebrow="QA" variant="qa">
      <div className="durable-tapes-route-shell">
        <QaSection
          id="durable-tapes-chart"
          title="Lightweight Chart"
          summary="Candlestick coverage with the smart-flow signed bar layer mounted in the lower pane."
          options={["lightweight-charts", "smart-direction bars", "live candles", "no overlays"]}
          style={
            {
              "--qa-full-height": "620px",
              "--qa-compact-height": "360px"
            } as CSSProperties
          }
        >
          <QaTemplateMatrix
            renderPreview={(template) => (
              <QAMarketChartPreview
                candles={chartCandles}
                lowerSeries={chartLowerSeries}
                status={chartStatus}
                template={template}
              />
            )}
          />
        </QaSection>

        <QaSection
          id="durable-tapes-options"
          title="Options Tape"
          summary="OPRA print rows with smart-flow tinting, packet context, NBBO fields, hover detail, filter controls, and real support diagnostics."
          options={[
            "templates pinned",
            "row tinting",
            "support diagnostics",
            "filters",
            "history off"
          ]}
        >
          <QaOptionsSupportDiagnostics
            rows={optionsPane.rowViewModels}
            status={optionsPane.rowViewModelStatus}
          />
          <QaTemplateMatrix
            renderPreview={(template) => (
              <OptionsTape
                className="durable-tapes-demo-module durable-tapes-demo-options"
                features={QA_FEATURES}
                filters={optionsPane.filters}
                flowPacketById={optionsPane.flowPacketById}
                flowPacketByTraceId={flowPacketByTraceId}
                focusedContractId={optionsPane.focusedContractId}
                nbboByContractId={optionsPane.nbboByContractId}
                onClearFocus={optionsPane.onClearFocus}
                onContractFocus={optionsPane.onContractFocus}
                onFiltersChange={optionsPane.onFiltersChange}
                onPacketFocus={optionsPane.onPacketFocus}
                packetIdByOptionTraceId={optionsPane.packetIdByOptionTraceId}
                prints={optionPrints}
                rowHeight={34}
                template={template}
                title="Options Tape"
              />
            )}
          />
        </QaSection>

        <QaSection
          id="durable-tapes-flow"
          title="Flow Packets"
          summary="Packet rows for contract focus, structure labels, quote-quality badges, premium sizing, and row activation."
          options={[
            "templates pinned",
            "packet focus",
            "quote state",
            "hover detail",
            "history off"
          ]}
        >
          <QaTemplateMatrix
            renderPreview={(template) => (
              <FlowPacketsTape
                className="durable-tapes-demo-module durable-tapes-demo-flow"
                features={QA_FEATURES}
                filters={flowPane.filters}
                onPacketFocus={flowPane.onPacketFocus}
                rowHeight={40}
                source={flowSource}
                template={template}
                title="Flow Packets"
              />
            )}
          />
        </QaSection>

        <QaSection
          id="durable-tapes-equities"
          title="Equities Tape"
          summary="Equity prints for off-exchange badges, venue filtering, ticker focus, hover evidence, and compact numeric columns."
          options={[
            "templates pinned",
            "ticker focus",
            "off-exchange badges",
            "hover detail",
            "history off"
          ]}
        >
          <QaTemplateMatrix
            renderPreview={(template) => (
              <EquitiesTape
                className="durable-tapes-demo-module durable-tapes-demo-equities"
                features={QA_FEATURES}
                onTickerFocus={(event) => equitiesPane.onTickerFocus(event.print)}
                rowHeight={34}
                source={equitiesSource}
                template={template}
                title="Equities Tape"
              />
            )}
          />
        </QaSection>

        <QaSection
          id="durable-tapes-alerts"
          title="Alerts"
          summary="Smart-flow alert rows with canonical projections, evidence hydration, detail actions, and semantic row tinting."
          options={[
            "templates pinned",
            "alert detail",
            "evidence refs",
            "row tinting",
            "history off"
          ]}
        >
          <QaTemplateMatrix
            renderPreview={(template) => (
              <AlertsModule
                alerts={alerts}
                className="durable-tapes-demo-module durable-tapes-demo-alerts"
                features={QA_FEATURES}
                flowPacketById={alertsPane.flowPacketById}
                onCloseDetail={alertsPane.onCloseDetail}
                onContractFocus={alertsPane.onContractFocus}
                onEquityFocus={alertsPane.onEquityFocus}
                onPacketFocus={alertsPane.onPacketFocus}
                onSelectAlert={alertsPane.onSelectAlert}
                optionPrintByTraceId={alertsPane.optionPrintByTraceId}
                rowHeight={36}
                selectedAlert={alertsPane.selectedAlert}
                template={template}
                title="Alerts"
              />
            )}
          />
        </QaSection>

        <QaSection
          id="durable-tapes-news"
          title="News Wire"
          summary="Newswire rows for source, symbol mapping, updated-state treatment, story selection, hover preview, and detail drawer."
          options={[
            "templates pinned",
            "story detail",
            "symbol rails",
            "hover detail",
            "history off"
          ]}
          style={
            {
              "--qa-full-height": "500px",
              "--qa-compact-height": "360px"
            } as CSSProperties
          }
        >
          <QaTemplateMatrix
            renderPreview={(template) => (
              <NewsWire
                className="durable-tapes-demo-module durable-tapes-demo-news"
                historyEnabled={false}
                lastUpdate={newsPane.lastUpdate}
                liveEnabled={liveNewsEnabled || newsStories.length > 0}
                scopeSymbols={newsPane.activeTickers}
                showControlRails={template === "full"}
                status={newsPane.status}
                stories={newsStories}
                template={template}
                title="News Wire"
              />
            )}
          />
        </QaSection>
      </div>
    </PageFrame>
  );
};
