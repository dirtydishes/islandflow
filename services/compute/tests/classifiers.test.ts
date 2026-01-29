import { describe, expect, test } from "bun:test";
import type { FlowPacket } from "@islandflow/types";
import { evaluateClassifiers, type ClassifierConfig } from "../src/classifiers";

const baseConfig: ClassifierConfig = {
  sweepMinPremium: 40_000,
  sweepMinCount: 3,
  sweepMinPremiumZ: 2,
  spikeMinPremium: 20_000,
  spikeMinSize: 400,
  spikeMinPremiumZ: 2.5,
  spikeMinSizeZ: 2,
  zMinSamples: 12,
  minNbboCoverage: 0.5,
  minAggressorRatio: 0.55,
  zeroDteMaxAtmPct: 0.01,
  zeroDteMinPremium: 20_000,
  zeroDteMinSize: 400
};

const DEFAULT_TS = Date.UTC(2024, 0, 2);

const buildPacket = (
  overrides: Record<string, string | number | boolean>
): FlowPacket => {
  return {
    source_ts: DEFAULT_TS,
    ingest_ts: DEFAULT_TS,
    seq: 1,
    trace_id: "trace",
    id: "packet",
    members: ["m1"],
    features: {
      option_contract_id: "SPY-2025-01-17-450-C",
      count: 3,
      total_premium: 1000,
      total_size: 20,
      first_price: 1,
      last_price: 1.01,
      start_ts: DEFAULT_TS - 500,
      end_ts: DEFAULT_TS,
      window_ms: 500,
      ...overrides
    },
    join_quality: {}
  };
};

describe("classifier z-score behavior", () => {
  test("spike hit triggers on z-score even when absolute thresholds fail", () => {
    const packet = buildPacket({
      total_premium_z: 3.2,
      total_premium_baseline_n: 20,
      total_size_z: 0.4,
      total_size_baseline_n: 20
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "unusual_contract_spike")).toBe(true);
  });

  test("sweep hit triggers on premium z-score when baseline is ready", () => {
    const packet = buildPacket({
      total_premium_z: 2.4,
      total_premium_baseline_n: 20
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "large_bullish_call_sweep")).toBe(true);
  });

  test("sweep hit does not trigger when baseline is insufficient", () => {
    const packet = buildPacket({
      total_premium_z: 3,
      total_premium_baseline_n: 4
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "large_bullish_call_sweep")).toBe(false);
  });

  test("aggressor mix adjusts sweep confidence", () => {
    const basePacket = {
      total_premium: 120_000,
      total_size: 900,
      count: 4,
      nbbo_coverage_ratio: 0.8
    };

    const lowAgg = buildPacket({
      ...basePacket,
      nbbo_aggressive_buy_ratio: 0.2,
      nbbo_aggressive_sell_ratio: 0.2
    });
    const highAgg = buildPacket({
      ...basePacket,
      nbbo_aggressive_buy_ratio: 0.7,
      nbbo_aggressive_sell_ratio: 0.3
    });

    const lowHit = evaluateClassifiers(lowAgg, baseConfig).find(
      (hit) => hit.classifier_id === "large_bullish_call_sweep"
    );
    const highHit = evaluateClassifiers(highAgg, baseConfig).find(
      (hit) => hit.classifier_id === "large_bullish_call_sweep"
    );

    expect(lowHit).toBeTruthy();
    expect(highHit).toBeTruthy();
    expect((highHit?.confidence ?? 0)).toBeGreaterThan(lowHit?.confidence ?? 0);
  });
});

describe("classifier structure and positioning signals", () => {
  test("call overwrite triggers on sell-side aggressor mix", () => {
    const packet = buildPacket({
      option_contract_id: "SPY-2024-03-15-450-C",
      total_premium: 80_000,
      total_size: 800,
      nbbo_coverage_ratio: 0.9,
      nbbo_aggressive_sell_ratio: 0.7,
      nbbo_aggressive_buy_ratio: 0.3
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "large_call_sell_overwrite")).toBe(true);
  });

  test("put write triggers on sell-side aggressor mix", () => {
    const packet = buildPacket({
      option_contract_id: "SPY-2024-03-15-450-P",
      total_premium: 75_000,
      total_size: 700,
      nbbo_coverage_ratio: 0.85,
      nbbo_aggressive_sell_ratio: 0.68,
      nbbo_aggressive_buy_ratio: 0.32
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "large_put_sell_write")).toBe(true);
  });

  test("straddle classifier triggers on structure tag", () => {
    const packet = buildPacket({
      packet_kind: "structure",
      structure_type: "straddle",
      structure_legs: 2,
      structure_strikes: 1,
      structure_rights: "C/P",
      structure_strike_span: 0
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "straddle")).toBe(true);
  });

  test("structure classifiers are suppressed on per-contract packets", () => {
    const packet = buildPacket({
      structure_type: "straddle",
      structure_legs: 2,
      structure_strikes: 1,
      structure_rights: "C/P",
      structure_strike_span: 0
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "straddle")).toBe(false);
  });

  test("vertical spread infers direction from aggressor skew", () => {
    const packet = buildPacket({
      packet_kind: "structure",
      structure_type: "vertical",
      structure_legs: 2,
      structure_strikes: 2,
      structure_rights: "C",
      structure_strike_span: 5,
      total_premium: 55_000,
      total_size: 600,
      nbbo_coverage_ratio: 0.85,
      nbbo_aggressive_buy_ratio: 0.7,
      nbbo_aggressive_sell_ratio: 0.3
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    const hit = hits.find((candidate) => candidate.classifier_id === "vertical_spread");
    expect(hit?.direction).toBe("bullish");
  });

  test("ladder accumulation triggers on multi-strike structures", () => {
    const packet = buildPacket({
      packet_kind: "structure",
      structure_type: "ladder",
      structure_legs: 3,
      structure_strikes: 3,
      structure_rights: "C",
      structure_strike_span: 10,
      total_premium: 60_000,
      total_size: 650
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    expect(hits.some((hit) => hit.classifier_id === "ladder_accumulation")).toBe(true);
  });

  test("far-dated conviction triggers on 60DTE threshold", () => {
    const packet = buildPacket({
      option_contract_id: "SPY-2024-04-19-450-C",
      end_ts: DEFAULT_TS,
      total_premium: 70_000,
      total_size: 800
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    const hit = hits.find((candidate) => candidate.classifier_id === "far_dated_conviction");
    expect(hit?.direction).toBe("bullish");
  });

  test("zero dte gamma punch triggers when ATM and large", () => {
    const packet = buildPacket({
      option_contract_id: "SPY-2024-01-02-450-C",
      total_premium: 35_000,
      total_size: 600,
      underlying_mid: 450,
      nbbo_coverage_ratio: 0.8,
      nbbo_aggressive_buy_ratio: 0.7,
      nbbo_aggressive_sell_ratio: 0.3
    });
    const hits = evaluateClassifiers(packet, baseConfig);
    const hit = hits.find((candidate) => candidate.classifier_id === "zero_dte_gamma_punch");
    expect(hit?.direction).toBe("bullish");
  });
});
