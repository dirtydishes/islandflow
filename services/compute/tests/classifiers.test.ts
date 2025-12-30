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
  minAggressorRatio: 0.55
};

const buildPacket = (
  overrides: Record<string, string | number | boolean>
): FlowPacket => {
  return {
    source_ts: 1,
    ingest_ts: 1,
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
