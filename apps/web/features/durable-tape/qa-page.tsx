"use client";

import type {
  EquityPrint,
  FlowHypothesisType,
  FlowPacket,
  NewsStory,
  OptionFlowFilters,
  OptionNBBO,
  OptionPrint,
  SmartFlowAlertEvent,
  SmartFlowDirection,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { AlertsModule } from "../alerts";
import { createStaticEquitiesTapeSource, EquitiesTape } from "../equities-tape";
import { createStaticFlowPacketsTapeSource, FlowPacketsTape } from "../flow-packets";
import {
  buildLowerPaneSeries,
  DEFAULT_MARKET_CHART_SETTINGS,
  MarketChart,
  MarketChartSection,
  normalizeMarketChartCandles,
  type MarketChartCandle,
  type MarketChartLayoutPresetId,
  type MarketChartSettingsState
} from "../market-chart";
import { NewsWire } from "../news-wire";
import { OptionsTape } from "../options-tape";
import { PageFrame } from "../terminal/components/primitives";
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
};

const QA_BASE_TS = Date.UTC(2026, 5, 26, 14, 30, 0);
const QA_INTERVAL_MS = 60_000;
const QA_FEATURES: DurableTapeFeatureInput[] = [
  "default",
  { key: "clickhouseHistory", enabled: false },
  { key: "settingsGear", enabled: false }
];
const QA_FLOW_FILTERS: OptionFlowFilters = {
  view: "raw",
  optionTypes: ["call", "put"]
};

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

const QA_CONTRACTS = [
  { id: "SPY-2026-07-17-555-C", underlying: "SPY", type: "call" as const, spot: 552.24 },
  { id: "SPY-2026-07-17-548-P", underlying: "SPY", type: "put" as const, spot: 552.18 },
  { id: "QQQ-2026-07-17-492-C", underlying: "QQQ", type: "call" as const, spot: 489.7 },
  { id: "NVDA-2026-07-17-158-C", underlying: "NVDA", type: "call" as const, spot: 156.38 }
];

const formatTemplateId = (template: QaTemplateId): string =>
  template === "twoThirds" ? "twoThirds" : template;

const makeOptionPrint = (index: number): OptionPrint => {
  const contract = QA_CONTRACTS[index % QA_CONTRACTS.length];
  const size = 45 + (index % 7) * 26;
  const price = Number((1.05 + (index % 6) * 0.34 + index * 0.015).toFixed(2));
  const side = index % 5 === 0 ? "BB" : index % 3 === 0 ? "MID" : index % 2 === 0 ? "AA" : "A";
  const ts = QA_BASE_TS - index * 17_000;
  const nbboBid = Number(Math.max(0.01, price - 0.06).toFixed(2));
  const nbboAsk = Number((price + 0.07).toFixed(2));

  return {
    trace_id: `qa:option:${index + 1}`,
    source_ts: ts,
    ingest_ts: ts + 8,
    seq: 1_000 + index,
    ts,
    option_contract_id: contract.id,
    underlying_id: contract.underlying,
    option_type: contract.type,
    price,
    size,
    exchange: index % 3 === 0 ? "CBOE" : index % 3 === 1 ? "PHLX" : "MIAX",
    conditions: index % 4 === 0 ? ["sweep"] : ["regular"],
    notional: Math.round(price * size * 100),
    nbbo_side: side,
    execution_nbbo_bid: nbboBid,
    execution_nbbo_ask: nbboAsk,
    execution_nbbo_mid: Number(((nbboBid + nbboAsk) / 2).toFixed(2)),
    execution_nbbo_spread: Number((nbboAsk - nbboBid).toFixed(2)),
    execution_nbbo_bid_size: 20 + index,
    execution_nbbo_ask_size: 22 + index,
    execution_nbbo_ts: ts - 120,
    execution_nbbo_age_ms: 120 + (index % 5) * 18,
    execution_nbbo_side: side,
    execution_underlying_spot: contract.spot + (index % 5) * 0.18,
    execution_iv: Number((0.21 + (index % 5) * 0.018).toFixed(3)),
    execution_iv_source: "synthetic_pressure_model",
    is_etf: contract.underlying === "SPY" || contract.underlying === "QQQ",
    signal_pass: index % 2 === 0 || index % 5 === 0,
    signal_reasons: index % 2 === 0 ? ["premium", "aggressive_nbbo"] : ["context"],
    signal_profile: "smart-flow"
  };
};

const QA_OPTION_PRINTS: OptionPrint[] = Array.from({ length: 28 }, (_, index) =>
  makeOptionPrint(index)
);

const makeFlowPacket = (index: number, memberStart: number, memberCount: number): FlowPacket => {
  const members = QA_OPTION_PRINTS.slice(memberStart, memberStart + memberCount).map(
    (print) => print.trace_id
  );
  const anchor = QA_OPTION_PRINTS[memberStart] ?? QA_OPTION_PRINTS[0];
  const totalPremium = QA_OPTION_PRINTS.slice(memberStart, memberStart + memberCount).reduce(
    (sum, print) => sum + (print.notional ?? print.price * print.size * 100),
    0
  );
  const totalSize = QA_OPTION_PRINTS.slice(memberStart, memberStart + memberCount).reduce(
    (sum, print) => sum + print.size,
    0
  );
  const startTs = anchor.source_ts - 640;
  const endTs = anchor.source_ts + 180;

  return {
    id: `flowpacket:${anchor.option_contract_id}:${index + 1}`,
    trace_id: `qa:flowpacket:${index + 1}`,
    source_ts: anchor.source_ts,
    ingest_ts: anchor.ingest_ts + 12,
    seq: 2_000 + index,
    members,
    features: {
      option_contract_id: anchor.option_contract_id,
      underlying_id: anchor.underlying_id ?? "SPY",
      count: memberCount,
      total_size: totalSize,
      total_premium: totalPremium,
      total_notional: totalPremium,
      start_ts: startTs,
      end_ts: endTs,
      window_ms: endTs - startTs,
      nbbo_coverage_ratio: 0.92 - index * 0.03,
      nbbo_inside_ratio: 0.08 + index * 0.02,
      nbbo_aggressive_buy_ratio: index % 2 === 0 ? 0.78 : 0.34,
      nbbo_aggressive_sell_ratio: index % 2 === 0 ? 0.12 : 0.56,
      nbbo_bid: anchor.execution_nbbo_bid ?? 0,
      nbbo_ask: anchor.execution_nbbo_ask ?? 0,
      nbbo_spread: anchor.execution_nbbo_spread ?? 0,
      structure_type: index % 2 === 0 ? "single_sweep" : "repeat_lot",
      structure_rights: anchor.option_type === "call" ? "calls" : "puts",
      structure_legs: index % 2 === 0 ? 1 : 2,
      structure_strikes: index % 2 === 0 ? 1 : 2
    },
    join_quality: {
      nbbo_age_ms: 120 + index * 26,
      nbbo_stale: index === 3 ? 1 : 0,
      nbbo_missing: 0
    }
  };
};

const QA_FLOW_PACKETS: FlowPacket[] = [
  makeFlowPacket(0, 0, 5),
  makeFlowPacket(1, 5, 5),
  makeFlowPacket(2, 10, 6),
  makeFlowPacket(3, 16, 6),
  makeFlowPacket(4, 22, 6)
];

const makeProjection = ({
  index,
  packet,
  direction,
  hypothesisType,
  confidence,
  evidenceQuality
}: {
  index: number;
  packet: FlowPacket;
  direction: SmartFlowDirection;
  hypothesisType: FlowHypothesisType;
  confidence: number;
  evidenceQuality: number;
}): SmartFlowExplainabilityProjection => {
  const evidenceRefs = [packet.id, ...packet.members.slice(0, 2)];
  const hypothesisId = `hypothesis:qa:${index + 1}`;

  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: packet.source_ts,
    ingest_ts: packet.ingest_ts + 18,
    seq: 3_000 + index,
    trace_id: `qa:smart-flow:${index + 1}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: `smartflow:hypothesis:qa:${index + 1}`,
    hypothesis_id: hypothesisId,
    cluster_id: `cluster:qa:${index + 1}`,
    candidate_ids: [`candidate:${packet.id}`],
    underlying_id:
      typeof packet.features.underlying_id === "string" ? packet.features.underlying_id : "SPY",
    hypothesis_type: hypothesisType,
    direction,
    alternatives: [],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: evidenceRefs,
    generated_from: "flow_evidence_cluster",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: hypothesisType,
      direction,
      evidence_strength: evidenceQuality,
      fit_score: Math.max(0.4, confidence - 0.08),
      penalty_score: Math.max(0, 1 - evidenceQuality) * 0.28,
      penalties: [],
      confidence: {
        policy_confidence: confidence,
        evidence_quality: evidenceQuality,
        hypothesis_margin: Math.max(0.18, confidence - 0.5),
        conviction: Math.max(0.4, confidence - 0.04),
        calibration_version: null
      }
    }
  });
};

const QA_SMART_FLOW_PROJECTIONS: SmartFlowExplainabilityProjection[] = [
  makeProjection({
    index: 0,
    packet: QA_FLOW_PACKETS[0],
    direction: "bullish",
    hypothesisType: "directional_accumulation",
    confidence: 0.81,
    evidenceQuality: 0.86
  }),
  makeProjection({
    index: 1,
    packet: QA_FLOW_PACKETS[1],
    direction: "bearish",
    hypothesisType: "hedge_rebalance",
    confidence: 0.68,
    evidenceQuality: 0.73
  }),
  makeProjection({
    index: 2,
    packet: QA_FLOW_PACKETS[2],
    direction: "bullish",
    hypothesisType: "event_positioning",
    confidence: 0.76,
    evidenceQuality: 0.79
  }),
  makeProjection({
    index: 3,
    packet: QA_FLOW_PACKETS[3],
    direction: "neutral",
    hypothesisType: "structure_arbitrage",
    confidence: 0.58,
    evidenceQuality: 0.66
  }),
  makeProjection({
    index: 4,
    packet: QA_FLOW_PACKETS[4],
    direction: "bearish",
    hypothesisType: "directional_accumulation",
    confidence: 0.64,
    evidenceQuality: 0.7
  })
];

const QA_ALERTS: SmartFlowAlertEvent[] = QA_SMART_FLOW_PROJECTIONS.map((projection, index) => {
  const alert = smartFlowAlertFromProjection(projection, {
    alert_id: `qa:alert:${index + 1}`,
    trace_id: `qa:alert-trace:${index + 1}`
  });
  if (!alert) {
    throw new Error("QA smart-flow projection did not create an alert.");
  }
  return alert;
});

const QA_EQUITY_PRINTS: EquityPrint[] = Array.from({ length: 26 }, (_, index) => {
  const ticker = index % 4 === 0 ? "NVDA" : index % 3 === 0 ? "QQQ" : "SPY";
  const priceBase = ticker === "NVDA" ? 156.2 : ticker === "QQQ" ? 489.4 : 552.1;
  const ts = QA_BASE_TS - index * 19_000;
  return {
    trace_id: `qa:equity:${index + 1}`,
    source_ts: ts,
    ingest_ts: ts + 6,
    seq: 4_000 + index,
    ts,
    underlying_id: ticker,
    price: Number((priceBase + (index % 7) * 0.11 - (index % 4) * 0.07).toFixed(2)),
    size: 100 + (index % 8) * 75,
    exchange: index % 5 === 0 ? "TRF" : index % 2 === 0 ? "NYSE" : "ARCA",
    offExchangeFlag: index % 5 === 0
  };
});

const QA_NEWS_STORIES: NewsStory[] = Array.from({ length: 18 }, (_, index) => {
  const symbols = index % 4 === 0 ? ["NVDA", "SPY"] : index % 3 === 0 ? ["QQQ"] : ["SPY", "QQQ"];
  const ts = QA_BASE_TS - index * 97_000;
  return {
    trace_id: `qa:news:${index + 1}`,
    source_ts: ts,
    ingest_ts: ts + 20,
    seq: 5_000 + index,
    story_id: 90_000 + index,
    provider: "qa-wire",
    source: index % 2 === 0 ? "MarketDesk" : "Briefing",
    headline:
      index % 3 === 0
        ? `${symbols[0]} options desk flags concentrated sweep activity`
        : `${symbols[0]} tape update: liquidity remains focused near opening range`,
    summary: "Fixture headline used to verify news wire templates, symbol chips, and hover detail.",
    content_html:
      "<p>Fixture article body used for durable-tape QA. It keeps the row detail path active.</p>",
    url: "",
    published_ts: ts,
    updated_ts: index % 4 === 0 ? ts + 42_000 : ts,
    provider_symbols: symbols,
    resolved_symbols: symbols,
    symbol_resolution: "provider"
  };
});

const QA_CHART_CANDLES: MarketChartCandle[] = normalizeMarketChartCandles(
  Array.from({ length: 42 }, (_, index) => {
    const ts = QA_BASE_TS - (41 - index) * QA_INTERVAL_MS;
    const wave = Math.sin(index / 3) * 0.82;
    const drift = index * 0.045;
    const open = 551.4 + drift + wave;
    const close = open + (index % 5 === 0 ? -0.62 : index % 3 === 0 ? -0.18 : 0.36);
    const high = Math.max(open, close) + 0.42 + (index % 4) * 0.06;
    const low = Math.min(open, close) - 0.38 - (index % 3) * 0.04;

    return {
      ts,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 22_000 + index * 620,
      trade_count: 140 + index * 4,
      seq: 6_000 + index,
      source: "SPY"
    };
  })
);

const QA_CHART_PROJECTIONS: SmartFlowExplainabilityProjection[] = QA_SMART_FLOW_PROJECTIONS.map(
  (projection, index) => ({
    ...projection,
    source_ts: QA_BASE_TS - (34 - index * 8) * QA_INTERVAL_MS,
    ingest_ts: QA_BASE_TS - (34 - index * 8) * QA_INTERVAL_MS + 20,
    seq: 7_000 + index
  })
);

const QA_CHART_LOWER_SERIES = buildLowerPaneSeries("smart-direction", {
  candles: QA_CHART_CANDLES,
  smartFlowProjections: QA_CHART_PROJECTIONS
});

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

const buildNbboMap = (prints: readonly OptionPrint[]): Map<string, OptionNBBO> => {
  const map = new Map<string, OptionNBBO>();
  for (const print of prints) {
    if (map.has(print.option_contract_id)) {
      continue;
    }
    map.set(print.option_contract_id, {
      trace_id: `qa:nbbo:${print.option_contract_id}`,
      source_ts: print.source_ts - 20,
      ingest_ts: print.ingest_ts - 12,
      seq: print.seq,
      ts: print.ts - 20,
      option_contract_id: print.option_contract_id,
      bid: print.execution_nbbo_bid ?? Math.max(0.01, print.price - 0.06),
      ask: print.execution_nbbo_ask ?? print.price + 0.07,
      bidSize: print.execution_nbbo_bid_size ?? 20,
      askSize: print.execution_nbbo_ask_size ?? 22
    });
  }
  return map;
};

const buildPacketIdByOptionTraceId = (packets: readonly FlowPacket[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const packet of packets) {
    for (const traceId of packet.members) {
      map.set(traceId, packet.id);
    }
  }
  return map;
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

const QAMarketChartPreview = ({ template }: QaChartPreviewProps) => {
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
          candles={QA_CHART_CANDLES}
          lowerSeries={QA_CHART_LOWER_SERIES}
          settings={QA_MARKET_CHART_SETTINGS}
          status="live"
          layoutPreset={preset}
        />
      </div>
    </MarketChartSection>
  );
};

export const DurableTapesQaRoute = () => {
  const state = useTerminal();
  const [qaFlowFilters, setQaFlowFilters] = useState<OptionFlowFilters>(QA_FLOW_FILTERS);
  const optionPrints = QA_OPTION_PRINTS;
  const flowPackets = QA_FLOW_PACKETS;
  const equityPrints = QA_EQUITY_PRINTS;
  const smartFlowProjections = QA_SMART_FLOW_PROJECTIONS;
  const alerts = QA_ALERTS;
  const newsStories = QA_NEWS_STORIES;

  const flowSource = useMemo(() => createStaticFlowPacketsTapeSource(flowPackets), [flowPackets]);
  const equitiesSource = useMemo(
    () => createStaticEquitiesTapeSource(equityPrints),
    [equityPrints]
  );
  const flowPacketById = useMemo(() => buildByIdMap(flowPackets, "id"), [flowPackets]);
  const flowPacketByTraceId = useMemo(() => buildByIdMap(flowPackets, "trace_id"), [flowPackets]);
  const optionPrintByTraceId = useMemo(
    () => buildByIdMap(optionPrints, "trace_id"),
    [optionPrints]
  );
  const packetIdByOptionTraceId = useMemo(
    () => buildPacketIdByOptionTraceId(flowPackets),
    [flowPackets]
  );
  const nbboByContractId = useMemo(() => buildNbboMap(optionPrints), [optionPrints]);
  const selectedAlert = alerts[0] ?? null;
  const liveNewsEnabled = state.mode === "live";

  return (
    <PageFrame title="Durable Tapes QA" eyebrow="QA" variant="qa">
      <div className="durable-tapes-route-shell">
        <QaSection
          id="durable-tapes-chart"
          title="Lightweight Chart"
          summary="Candlestick coverage with the smart-flow signed bar layer mounted in the lower pane."
          options={["lightweight-charts", "smart-direction bars", "fixture candles", "no overlays"]}
          style={
            {
              "--qa-full-height": "620px",
              "--qa-compact-height": "360px"
            } as CSSProperties
          }
        >
          <QaTemplateMatrix
            renderPreview={(template) => <QAMarketChartPreview template={template} />}
          />
        </QaSection>

        <QaSection
          id="durable-tapes-options"
          title="Options Tape"
          summary="OPRA print rows with smart-flow tinting, packet context, NBBO fields, hover detail, and filter controls."
          options={["templates pinned", "row tinting", "hover detail", "filters", "history off"]}
        >
          <QaTemplateMatrix
            renderPreview={(template) => (
              <OptionsTape
                className="durable-tapes-demo-module durable-tapes-demo-options"
                features={QA_FEATURES}
                filters={qaFlowFilters}
                flowPacketById={flowPacketById}
                flowPacketByTraceId={flowPacketByTraceId}
                nbboByContractId={nbboByContractId}
                onClearFocus={state.clearSelectedInstrument}
                onContractFocus={state.focusOptionContract}
                onFiltersChange={setQaFlowFilters}
                onPacketFocus={state.focusFlowPacketRequest}
                packetIdByOptionTraceId={packetIdByOptionTraceId}
                prints={optionPrints}
                rowHeight={34}
                smartFlowProjections={smartFlowProjections}
                supportHydrationEnabled={false}
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
                filters={qaFlowFilters}
                onPacketFocus={state.focusFlowPacketRequest}
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
                onTickerFocus={(event) => state.focusEquityTicker(event.print)}
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
                flowPacketById={flowPacketById}
                onCloseDetail={state.clearSelectedAlert}
                onContractFocus={state.focusAlertContract}
                onEquityFocus={state.focusAlertEquity}
                onPacketFocus={state.focusFlowPacketRequest}
                onSelectAlert={state.setSelectedAlert}
                optionPrintByTraceId={optionPrintByTraceId}
                rowHeight={36}
                selectedAlert={selectedAlert}
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
                lastUpdate={state.news.lastUpdate ?? QA_BASE_TS}
                liveEnabled={liveNewsEnabled || newsStories.length > 0}
                scopeSymbols={["SPY", "QQQ", "NVDA"]}
                showControlRails={template === "full"}
                status="connected"
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
