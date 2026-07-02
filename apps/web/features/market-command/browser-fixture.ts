import type {
  DurableTapeRowViewModel,
  EquityCandle,
  EquityPrint,
  EquityPrintJoin,
  FlowHypothesisEvent,
  FlowPacket,
  InferredDarkEvent,
  NewsStory,
  OptionNBBO,
  OptionPrint,
  SmartFlowAlertEvent,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import {
  DurableTapeAlertRowViewModelSchema,
  DurableTapeOptionRowViewModelSchema,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  SMART_FLOW_MODEL_VERSION,
  SMART_FLOW_POLICY_VERSION,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";

export const MARKET_COMMAND_DRAWER_FIXTURE_PARAM = "marketCommandFixture";
export const MARKET_COMMAND_DRAWER_FIXTURE_VALUE = "drawer";
export const MARKET_COMMAND_DRAWER_FIXTURE_KEYS = {
  durableAlertRow: "fixture-durable-alert-row",
  durableOptionRow: "fixture-durable-option-row",
  flowPacket: "flowpacket:SPY-2026-07-17-550-C:fixture-1",
  newsStory: "fixture-news-story-1"
} as const;

type SearchParamsLike = {
  get: (key: string) => string | null;
};

export type MarketCommandDrawerBrowserFixture = {
  lastUpdate: number;
  options: OptionPrint[];
  nbbo: OptionNBBO[];
  equities: EquityPrint[];
  equityJoins: EquityPrintJoin[];
  flow: FlowPacket[];
  smartFlow: SmartFlowExplainabilityProjection[];
  alerts: SmartFlowAlertEvent[];
  durableRows: DurableTapeRowViewModel[];
  news: NewsStory[];
  inferredDark: InferredDarkEvent[];
  chartCandles: EquityCandle[];
  chartOverlay: EquityPrint[];
};

const BASE_TS = Date.UTC(2026, 6, 2, 13, 34, 0);
const CONTRACT_ID = "SPY-2026-07-17-550-C";
const FLOW_PACKET_ID = MARKET_COMMAND_DRAWER_FIXTURE_KEYS.flowPacket;
const OPTION_PRINT_1 = "fixture-option-print-1";
const OPTION_PRINT_2 = "fixture-option-print-2";
const EQUITY_JOIN_ID = "equityjoin:fixture-spy-dark-print";

const isFixtureRuntimeAllowed = (): boolean => process.env.NODE_ENV !== "production";

export const isMarketCommandDrawerBrowserFixtureEnabled = ({
  pathname,
  searchParams
}: {
  pathname: string | null | undefined;
  searchParams: SearchParamsLike | null | undefined;
}): boolean =>
  isFixtureRuntimeAllowed() &&
  pathname === "/" &&
  searchParams?.get(MARKET_COMMAND_DRAWER_FIXTURE_PARAM) === MARKET_COMMAND_DRAWER_FIXTURE_VALUE;

const makeOptionPrint = ({
  traceId,
  seq,
  ts,
  price,
  size
}: {
  traceId: string;
  seq: number;
  ts: number;
  price: number;
  size: number;
}): OptionPrint => ({
  trace_id: traceId,
  source_ts: ts,
  ingest_ts: ts + 35,
  seq,
  ts,
  option_contract_id: CONTRACT_ID,
  underlying_id: "SPY",
  option_type: "call",
  price,
  size,
  exchange: "CBOE",
  conditions: ["AUTO"],
  notional: price * size * 100,
  nbbo_side: "A",
  execution_nbbo_bid: price - 0.04,
  execution_nbbo_ask: price + 0.04,
  execution_nbbo_mid: price,
  execution_nbbo_spread: 0.08,
  execution_nbbo_bid_size: 140,
  execution_nbbo_ask_size: 160,
  execution_nbbo_ts: ts - 14,
  execution_nbbo_age_ms: 14,
  execution_nbbo_side: "A",
  execution_underlying_spot: 549.18,
  execution_underlying_bid: 549.16,
  execution_underlying_ask: 549.2,
  execution_underlying_mid: 549.18,
  execution_underlying_spread: 0.04,
  execution_underlying_ts: ts - 20,
  execution_underlying_age_ms: 20,
  execution_underlying_source: "equity_quote_mid",
  execution_iv: 0.22,
  execution_iv_source: "synthetic_pressure_model",
  is_etf: false,
  signal_pass: true,
  signal_reasons: ["fixture_smart_flow"],
  signal_profile: "smart-flow"
});

const makeFlowPacket = (prints: readonly OptionPrint[]): FlowPacket => ({
  trace_id: "fixture-flow-packet-trace",
  source_ts: BASE_TS + 45_000,
  ingest_ts: BASE_TS + 45_050,
  seq: 10,
  id: FLOW_PACKET_ID,
  members: prints.map((print) => print.trace_id),
  features: {
    underlying_id: "SPY",
    option_contract_id: CONTRACT_ID,
    option_type: "call",
    structure_type: "single_contract",
    structure_rights: "call",
    structure_legs: 1,
    structure_strikes: 1,
    count: prints.length,
    total_size: prints.reduce((total, print) => total + print.size, 0),
    total_premium: prints.reduce((total, print) => total + (print.notional ?? 0), 0),
    total_notional: prints.reduce((total, print) => total + (print.notional ?? 0), 0),
    start_ts: prints[0]?.ts ?? BASE_TS,
    end_ts: prints.at(-1)?.ts ?? BASE_TS,
    window_ms: 42_000,
    nbbo_a_count: prints.length,
    nbbo_aa_count: 0,
    nbbo_mid_count: 0,
    nbbo_b_count: 0,
    nbbo_bb_count: 0,
    nbbo_missing_count: 0,
    nbbo_stale_count: 0,
    nbbo_coverage_ratio: 1,
    nbbo_inside_ratio: 0,
    nbbo_aggressive_buy_ratio: 0.92,
    nbbo_aggressive_sell_ratio: 0.02,
    nbbo_bid: 3.4,
    nbbo_ask: 3.52,
    nbbo_spread: 0.12,
    execution_nbbo_side: "A",
    side: "A",
    direction: "bullish",
    is_etf: false
  },
  join_quality: {
    nbbo_age_ms: 14,
    nbbo_missing: 0,
    nbbo_stale: 0
  }
});

const makeSmartFlowProjection = (): SmartFlowExplainabilityProjection => {
  const hypothesis: FlowHypothesisEvent = {
    trace_id: "fixture-smart-flow-projection",
    source_ts: BASE_TS + 60_000,
    ingest_ts: BASE_TS + 60_050,
    seq: 20,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_POLICY_VERSION,
    model_version: SMART_FLOW_MODEL_VERSION,
    event_id: "fixture-smart-flow-event",
    hypothesis_id: "fixture-smart-flow-hypothesis",
    cluster_id: "fixture-smart-flow-cluster",
    candidate_ids: ["fixture-smart-flow-candidate"],
    underlying_id: "SPY",
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: "directional_accumulation",
      direction: "bullish",
      evidence_strength: 0.86,
      fit_score: 0.82,
      penalty_score: 0.04,
      penalties: [],
      confidence: {
        policy_confidence: 0.81,
        evidence_quality: 0.86,
        hypothesis_margin: 0.33,
        conviction: 0.78,
        calibration_version: "fixture-v1"
      }
    },
    alternatives: [
      {
        hypothesis_type: "event_positioning",
        direction: "bullish",
        score: 0.42,
        reasons: ["fixture alternative with weaker timing fit"]
      }
    ],
    abstention: {
      abstained: false,
      reasons: ["not_abstained"],
      source_reasons: ["fixture accepted directional accumulation"]
    },
    evidence_refs: [FLOW_PACKET_ID, OPTION_PRINT_1, OPTION_PRINT_2],
    generated_from: "flow_evidence_cluster"
  };

  return smartFlowExplainabilityFromHypothesisEvent(hypothesis, {
    insight_id: "fixture-smart-flow-insight"
  });
};

const makeEquityJoin = (): EquityPrintJoin => ({
  trace_id: "fixture-spy-dark-join-trace",
  source_ts: BASE_TS + 75_000,
  ingest_ts: BASE_TS + 75_050,
  seq: 30,
  id: EQUITY_JOIN_ID,
  print_trace_id: "fixture-spy-equity-print-dark",
  quote_trace_id: "fixture-spy-equity-quote-dark",
  features: {
    underlying_id: "SPY",
    price: 549.42,
    size: 48_000,
    exchange: "TRF",
    off_exchange_flag: true,
    quote_placement: "ABOVE_MID",
    quote_bid: 549.38,
    quote_ask: 549.44,
    quote_mid: 549.41,
    quote_spread: 0.06
  },
  join_quality: {
    quote_age_ms: 18,
    quote_missing: 0,
    quote_stale: 0
  }
});

const makeInferredDark = (): InferredDarkEvent => ({
  trace_id: "dark:stealth_accumulation:SPY:fixture-1",
  source_ts: BASE_TS + 75_000,
  ingest_ts: BASE_TS + 75_060,
  seq: 31,
  type: "stealth_accumulation",
  confidence: 0.83,
  evidence_refs: [EQUITY_JOIN_ID]
});

const makeChartCandles = (): EquityCandle[] =>
  Array.from({ length: 8 }, (_, index) => {
    const ts = BASE_TS + index * 60_000;
    const open = 548.4 + index * 0.16;
    const close = open + (index % 2 === 0 ? 0.22 : -0.04);
    return {
      trace_id: `fixture-spy-candle-${index + 1}`,
      source_ts: ts,
      ingest_ts: ts + 20,
      seq: index + 1,
      ts,
      interval_ms: 60_000,
      underlying_id: "SPY",
      open,
      high: Math.max(open, close) + 0.18,
      low: Math.min(open, close) - 0.12,
      close,
      volume: 120_000 + index * 8_000,
      trade_count: 450 + index * 15
    };
  });

const makeEquityPrint = (join: EquityPrintJoin): EquityPrint => ({
  trace_id: join.print_trace_id,
  source_ts: join.source_ts,
  ingest_ts: join.ingest_ts,
  seq: join.seq,
  ts: join.source_ts,
  underlying_id: "SPY",
  price: 549.42,
  size: 48_000,
  exchange: "TRF",
  offExchangeFlag: true
});

const makeNewsStory = (): NewsStory => ({
  trace_id: MARKET_COMMAND_DRAWER_FIXTURE_KEYS.newsStory,
  source_ts: BASE_TS + 90_000,
  ingest_ts: BASE_TS + 90_050,
  seq: 40,
  story_id: 4242,
  provider: "fixture",
  source: "Fixture Wire",
  headline: "Fixture News Opens Drawer",
  summary: "A deterministic SPY news story for the Market Command drawer probe.",
  content_html: "<p>Fixture story body confirms the shared drawer can render news rows.</p>",
  url: "https://example.com/market-command-fixture",
  published_ts: BASE_TS + 90_000,
  updated_ts: BASE_TS + 90_000,
  provider_symbols: ["SPY"],
  resolved_symbols: ["SPY"],
  symbol_resolution: "provider"
});

const makeDurableOptionRow = (
  print: OptionPrint,
  packet: FlowPacket,
  projection: SmartFlowExplainabilityProjection
) =>
  DurableTapeOptionRowViewModelSchema.parse({
    id: MARKET_COMMAND_DRAWER_FIXTURE_KEYS.durableOptionRow,
    lane: "options",
    ts: print.ts,
    seq: print.seq,
    source_ts: print.source_ts,
    ingest_ts: print.ingest_ts,
    source: "server",
    symbol: "SPY",
    cells: {
      time: "09:34:18",
      contract: "Fixture Option SPY 550C",
      price: "$3.48",
      size: "120",
      premium: "$41,760",
      side: "A",
      nbbo: "3.44 x 3.52",
      support: "Fixture smart-flow attached"
    },
    badges: [{ kind: "fixture", label: "Fixture", tone: "blue" }],
    evidence_summary: {
      label: "3 refs",
      refs: [FLOW_PACKET_ID, OPTION_PRINT_1, OPTION_PRINT_2],
      counts: {
        total: 3,
        flow_packets: 1,
        option_prints: 2,
        unresolved: 0
      }
    },
    drilldown_refs: [FLOW_PACKET_ID, OPTION_PRINT_1, OPTION_PRINT_2],
    option: {
      trace_id: print.trace_id,
      option_contract_id: print.option_contract_id,
      underlying_id: print.underlying_id,
      option_type: print.option_type,
      price: print.price,
      size: print.size,
      premium: print.notional ?? null,
      side: print.execution_nbbo_side ?? null,
      exchange: print.exchange,
      conditions: print.conditions,
      signal: {
        pass: true,
        profile: "smart-flow",
        reasons: ["fixture_smart_flow"]
      },
      execution: {
        iv: print.execution_iv ?? null,
        underlying_spot: print.execution_underlying_spot ?? null,
        quote_age_ms: print.execution_nbbo_age_ms ?? null
      },
      nbbo: {
        bid: print.execution_nbbo_bid ?? 0,
        ask: print.execution_nbbo_ask ?? 0,
        mid: print.execution_nbbo_mid ?? null,
        spread: print.execution_nbbo_spread ?? null,
        source: "print",
        age_ms: print.execution_nbbo_age_ms ?? null
      }
    },
    support: {
      packet: {
        id: packet.id,
        trace_id: packet.trace_id,
        option_contract_id: CONTRACT_ID,
        member_trace_ids: packet.members,
        member_count: packet.members.length
      },
      smart_flow_status: "matched",
      smart_flow: {
        status: "matched",
        source_channel: "smart-flow",
        projection_id: projection.refs.hypothesis_id,
        projection_trace_id: projection.trace_id,
        packet_id: packet.id,
        match_source: "packet_member",
        tint_eligible: true,
        hypothesis_type: projection.hypothesis.hypothesis_type,
        direction: projection.hypothesis.direction,
        confidence: projection.hypothesis.scores.confidence.policy_confidence,
        evidence_quality: projection.evidence.evidence_quality,
        abstained: projection.abstention.abstained,
        refs: {
          evidence_refs: projection.refs.evidence_refs,
          packet_refs: [packet.id],
          option_print_refs: [OPTION_PRINT_1, OPTION_PRINT_2]
        },
        counts: {
          evidence_refs: projection.refs.evidence_refs.length,
          flow_packets: 1,
          option_prints: 2
        }
      }
    }
  });

const makeDurableAlertRow = (
  packet: FlowPacket,
  projection: SmartFlowExplainabilityProjection,
  prints: readonly OptionPrint[]
) =>
  DurableTapeAlertRowViewModelSchema.parse({
    id: MARKET_COMMAND_DRAWER_FIXTURE_KEYS.durableAlertRow,
    lane: "alerts",
    ts: projection.source_ts,
    seq: projection.seq,
    source_ts: projection.source_ts,
    ingest_ts: projection.ingest_ts,
    source: "server",
    symbol: "SPY",
    cells: {
      time: "09:35:00",
      symbol: "SPY",
      kind: "Fixture Durable Alert",
      confidence: "81%",
      state: "high / bullish",
      evidence: "3 refs"
    },
    badges: [{ kind: "confidence", label: "High", tone: "green" }],
    evidence_summary: {
      label: "3 refs",
      refs: [packet.id, ...prints.map((print) => print.trace_id)],
      counts: {
        total: 3,
        flow_packets: 1,
        option_prints: 2,
        unresolved: 0
      }
    },
    drilldown_refs: [packet.id, ...prints.map((print) => print.trace_id)],
    alert: {
      trace_id: "fixture-durable-alert-trace",
      alert_id: "fixture-durable-alert",
      hypothesis_id: projection.refs.hypothesis_id,
      insight_id: projection.refs.insight_id,
      primary_label: "Fixture Durable Alert",
      hypothesis_type: projection.hypothesis.hypothesis_type,
      direction: projection.hypothesis.direction,
      policy_confidence: projection.hypothesis.scores.confidence.policy_confidence,
      evidence_quality: projection.evidence.evidence_quality,
      confidence_band: "high",
      evidence_quality_band: "strong",
      trigger_kind: "fixture",
      projection_trace_id: projection.trace_id
    },
    evidence: {
      total_refs: 3,
      flow_packet_refs: [packet.id],
      option_print_refs: prints.map((print) => print.trace_id),
      unresolved_refs: [],
      underlying_id: "SPY",
      primary_packet: {
        id: packet.id,
        option_contract_id: CONTRACT_ID,
        member_trace_ids: packet.members,
        member_count: packet.members.length
      },
      preview_prints: prints.map((print) => ({
        trace_id: print.trace_id,
        option_contract_id: print.option_contract_id,
        ts: print.ts,
        price: print.price,
        size: print.size,
        premium: print.notional ?? null,
        exchange: print.exchange
      }))
    }
  });

export const createMarketCommandDrawerBrowserFixture = (): MarketCommandDrawerBrowserFixture => {
  const options = [
    makeOptionPrint({
      traceId: OPTION_PRINT_1,
      seq: 1,
      ts: BASE_TS + 18_000,
      price: 3.48,
      size: 120
    }),
    makeOptionPrint({
      traceId: OPTION_PRINT_2,
      seq: 2,
      ts: BASE_TS + 42_000,
      price: 3.56,
      size: 100
    })
  ];
  const packet = makeFlowPacket(options);
  const projection = makeSmartFlowProjection();
  const alert = smartFlowAlertFromProjection(projection, {
    alert_id: "fixture-smart-flow-alert",
    trace_id: "fixture-smart-flow-alert-trace"
  });
  const equityJoin = makeEquityJoin();
  const equityPrint = makeEquityPrint(equityJoin);
  const durableOption = makeDurableOptionRow(options[0], packet, projection);
  const durableAlert = makeDurableAlertRow(packet, projection, options);

  if (!alert) {
    throw new Error("Market Command drawer fixture smart-flow alert could not be created.");
  }

  return {
    lastUpdate: BASE_TS + 95_000,
    options,
    nbbo: [],
    equities: [equityPrint],
    equityJoins: [equityJoin],
    flow: [packet],
    smartFlow: [projection],
    alerts: [alert],
    durableRows: [durableAlert, durableOption],
    news: [makeNewsStory()],
    inferredDark: [makeInferredDark()],
    chartCandles: makeChartCandles(),
    chartOverlay: [equityPrint]
  };
};
