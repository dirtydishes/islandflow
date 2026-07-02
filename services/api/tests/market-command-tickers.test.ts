import { describe, expect, it } from "bun:test";
import {
  type EquityPrint,
  type FlowPacket,
  type NewsStory,
  type OptionPrint,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  SMART_FLOW_MODEL_VERSION,
  SMART_FLOW_POLICY_VERSION,
  type SmartFlowExplainabilityProjection,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import {
  buildMarketCommandTickerRail,
  parseMarketCommandTickerRailParams,
  resolveMarketCommandRegularSession
} from "../src/market-command-tickers";

const ts = (iso: string): number => Date.parse(iso);

const makeProjection = (
  symbol: string,
  sourceTs: number,
  seq = 1
): SmartFlowExplainabilityProjection => {
  const clusterId = `cluster:${symbol}:${sourceTs}:${sourceTs + 60_000}`;
  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: sourceTs,
    ingest_ts: sourceTs + 1,
    seq,
    trace_id: `smartflow:hypothesis:${clusterId}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_POLICY_VERSION,
    model_version: SMART_FLOW_MODEL_VERSION,
    event_id: `smartflow:hypothesis:${clusterId}`,
    hypothesis_id: `hypothesis:${clusterId}`,
    cluster_id: clusterId,
    candidate_ids: [`candidate:flowpacket:${seq}`],
    underlying_id: symbol,
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: "directional_accumulation",
      direction: "bullish",
      evidence_strength: 0.84,
      fit_score: 0.78,
      penalty_score: 0,
      penalties: [],
      confidence: {
        policy_confidence: 0.9,
        evidence_quality: 0.9,
        hypothesis_margin: 0.35,
        conviction: 0.82,
        calibration_version: null
      }
    },
    alternatives: [],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: [`flowpacket:${seq}`, `print:${seq}`],
    generated_from: "flow_evidence_cluster"
  });
};

const makeFlowPacket = (
  symbol: string,
  sourceTs: number,
  premium: number,
  seq = 1
): FlowPacket => ({
  source_ts: sourceTs,
  ingest_ts: sourceTs + 1,
  seq,
  trace_id: `flowpacket:trace:${symbol}:${seq}`,
  id: `flowpacket:${symbol}:${seq}`,
  members: [`print:${symbol}:${seq}`],
  features: {
    option_contract_id: `${symbol}-2026-07-17-500-C`,
    underlying_id: symbol,
    total_premium: premium
  },
  join_quality: {}
});

const makeOptionPrint = (
  symbol: string,
  sourceTs: number,
  notional: number,
  seq = 1
): OptionPrint => ({
  source_ts: sourceTs,
  ingest_ts: sourceTs + 1,
  seq,
  trace_id: `print:${symbol}:${seq}`,
  ts: sourceTs,
  option_contract_id: `${symbol}-2026-07-17-500-C`,
  underlying_id: symbol,
  option_type: "call",
  price: notional / 10_000,
  size: 100,
  exchange: "CBOE",
  notional,
  nbbo_side: "A",
  signal_pass: true,
  signal_profile: "smart-flow"
});

const makeEquityPrint = (
  symbol: string,
  sourceTs: number,
  price: number,
  seq = 1
): EquityPrint => ({
  source_ts: sourceTs,
  ingest_ts: sourceTs + 1,
  seq,
  trace_id: `equity:${symbol}:${seq}`,
  ts: sourceTs,
  underlying_id: symbol,
  price,
  size: 100,
  exchange: "NYSE",
  offExchangeFlag: false
});

const makeNews = (symbol: string, publishedTs: number, storyId = 1): NewsStory => ({
  source_ts: publishedTs,
  ingest_ts: publishedTs + 1,
  seq: storyId,
  trace_id: `news:${storyId}`,
  story_id: storyId,
  provider: "test",
  source: "wire",
  headline: `${symbol} headline`,
  summary: "",
  content_html: "",
  url: "",
  published_ts: publishedTs,
  updated_ts: publishedTs,
  provider_symbols: [],
  resolved_symbols: [symbol],
  symbol_resolution: "provider"
});

describe("market-command ticker query params", () => {
  it("normalizes watchlist symbols, dedupes, and caps watchlist and limit", () => {
    const manySymbols = Array.from({ length: 40 }, (_, index) => `sym${index}`).join(",");
    const params = parseMarketCommandTickerRailParams(
      new URL(
        `http://api.test/market-command/tickers?watchlist=spy,QQQ,spy,${manySymbols}&limit=99`
      )
    );

    expect(params.watchlist.slice(0, 3)).toEqual(["SPY", "QQQ", "SYM0"]);
    expect(params.watchlist).toHaveLength(32);
    expect(params.limit).toBe(32);
  });

  it("uses the default core watchlist and rejects invalid input", () => {
    expect(
      parseMarketCommandTickerRailParams(new URL("http://api.test/market-command/tickers"))
    ).toEqual({
      watchlist: ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "MSFT", "META", "AMZN"],
      limit: 16
    });
    expect(() =>
      parseMarketCommandTickerRailParams(
        new URL("http://api.test/market-command/tickers?watchlist=bad symbol")
      )
    ).toThrow("invalid ticker symbol");
    expect(() =>
      parseMarketCommandTickerRailParams(
        new URL("http://api.test/market-command/tickers?limit=1.5")
      )
    ).toThrow("limit must be a positive integer");
  });
});

describe("market-command regular session window", () => {
  it("selects current or most recent regular sessions in America/New_York", () => {
    expect(resolveMarketCommandRegularSession(ts("2026-06-30T13:15:00.000Z"))).toMatchObject({
      selection: "previous_regular",
      start_ts: ts("2026-06-29T13:30:00.000Z"),
      end_ts: ts("2026-06-29T20:00:00.000Z")
    });
    expect(resolveMarketCommandRegularSession(ts("2026-06-30T14:15:00.000Z"))).toMatchObject({
      selection: "current",
      start_ts: ts("2026-06-30T13:30:00.000Z"),
      end_ts: ts("2026-06-30T14:15:00.000Z")
    });
    expect(resolveMarketCommandRegularSession(ts("2026-06-27T16:00:00.000Z"))).toMatchObject({
      selection: "previous_regular",
      start_ts: ts("2026-06-26T13:30:00.000Z"),
      end_ts: ts("2026-06-26T20:00:00.000Z")
    });
    expect(resolveMarketCommandRegularSession(ts("2026-06-28T16:00:00.000Z"))).toMatchObject({
      selection: "previous_regular",
      start_ts: ts("2026-06-26T13:30:00.000Z"),
      end_ts: ts("2026-06-26T20:00:00.000Z")
    });
    expect(resolveMarketCommandRegularSession(ts("2026-06-29T12:45:00.000Z"))).toMatchObject({
      selection: "previous_regular",
      start_ts: ts("2026-06-26T13:30:00.000Z"),
      end_ts: ts("2026-06-26T20:00:00.000Z")
    });
  });
});

describe("market-command ticker ranking", () => {
  it("keeps pinned order stable, excludes pinned duplicates, and ranks evidence before movers", () => {
    const nowTs = ts("2026-06-30T14:15:00.000Z");
    const session = resolveMarketCommandRegularSession(nowTs);
    const spyProjection = makeProjection("SPY", ts("2026-06-30T14:05:00.000Z"), 1);
    const spyAlert = smartFlowAlertFromProjection(spyProjection);
    if (!spyAlert) {
      throw new Error("expected non-abstained projection to derive an alert");
    }

    const response = buildMarketCommandTickerRail({
      params: { watchlist: ["SPY", "QQQ"], limit: 4 },
      session,
      nowTs,
      data: {
        alerts: [spyAlert],
        smartFlowProjections: [spyProjection],
        flowPackets: [makeFlowPacket("NVDA", ts("2026-06-30T14:03:00.000Z"), 600_000, 2)],
        optionPrints: [makeOptionPrint("SPY", ts("2026-06-30T14:04:00.000Z"), 500_000, 3)],
        equityPrints: [
          makeEquityPrint("TSLA", ts("2026-06-30T13:31:00.000Z"), 100, 4),
          makeEquityPrint("TSLA", ts("2026-06-30T14:02:00.000Z"), 120, 5)
        ],
        news: [makeNews("AAPL", ts("2026-06-30T14:01:00.000Z"), 6)]
      }
    });

    expect(response.pinned.map((item) => item.symbol)).toEqual(["SPY", "QQQ"]);
    expect(response.pinned[0]).toMatchObject({ symbol: "SPY", source: "both" });
    expect(response.pinned[0]?.reasons).toHaveLength(3);
    expect(response.important.map((item) => item.symbol)).toEqual(["NVDA", "TSLA", "AAPL"]);
    expect(response.important.some((item) => item.symbol === "SPY")).toBe(false);
  });

  it("returns useful degraded watchlist output from live-cache shaped data", () => {
    const nowTs = ts("2026-06-30T14:15:00.000Z");
    const session = resolveMarketCommandRegularSession(nowTs);
    const response = buildMarketCommandTickerRail({
      params: { watchlist: ["SPY"], limit: 16 },
      session,
      nowTs,
      data: {
        equityPrints: [makeEquityPrint("SPY", ts("2026-06-30T14:10:00.000Z"), 512.34)]
      },
      degradedReasons: ["ClickHouse unavailable"]
    });

    expect(response.degraded).toBe(true);
    expect(response.degraded_reasons).toEqual(["ClickHouse unavailable"]);
    expect(response.pinned).toMatchObject([
      {
        symbol: "SPY",
        source: "pinned",
        price: 512.34
      }
    ]);
  });

  it("filters prior-session evidence out of the ranking", () => {
    const nowTs = ts("2026-06-30T14:15:00.000Z");
    const session = resolveMarketCommandRegularSession(nowTs);
    const response = buildMarketCommandTickerRail({
      params: { watchlist: ["SPY"], limit: 16 },
      session,
      nowTs,
      data: {
        flowPackets: [
          makeFlowPacket("NVDA", ts("2026-06-29T19:30:00.000Z"), 10_000_000, 1),
          makeFlowPacket("TSLA", ts("2026-06-30T14:00:00.000Z"), 300_000, 2)
        ]
      }
    });

    expect(response.important.map((item) => item.symbol)).toEqual(["TSLA"]);
  });

  it("ignores malformed symbols and scores only signal option prints", () => {
    const nowTs = ts("2026-06-30T14:15:00.000Z");
    const session = resolveMarketCommandRegularSession(nowTs);
    const rawOptionPrint = {
      ...makeOptionPrint("TSLA", ts("2026-06-30T14:08:00.000Z"), 5_000_000, 1),
      signal_pass: false
    };
    const malformedOptionPrint = {
      ...makeOptionPrint("BAD", ts("2026-06-30T14:09:00.000Z"), 6_000_000, 2),
      underlying_id: "bad symbol",
      option_contract_id: "bad symbol-2026-07-17-500-C"
    };
    const malformedEquityPrint = {
      ...makeEquityPrint("BAD", ts("2026-06-30T14:10:00.000Z"), 100, 3),
      underlying_id: "bad symbol"
    };

    const response = buildMarketCommandTickerRail({
      params: { watchlist: ["SPY"], limit: 16 },
      session,
      nowTs,
      data: {
        optionPrints: [
          rawOptionPrint,
          malformedOptionPrint,
          makeOptionPrint("NVDA", ts("2026-06-30T14:11:00.000Z"), 500_000, 4)
        ],
        equityPrints: [malformedEquityPrint]
      }
    });

    expect(response.important.map((item) => item.symbol)).toEqual(["NVDA"]);
  });
});
