import { describe, expect, it } from "bun:test";
import {
  createDarkInferenceState,
  evaluateDarkInferences,
  type DarkInferenceConfig
} from "../src/dark-inference";

const config: DarkInferenceConfig = {
  windowMs: 60_000,
  cooldownMs: 30_000,
  minBlockSize: 1000,
  minAccumulationSize: 2000,
  minAccumulationCount: 3,
  minPrintSize: 200,
  maxEvidence: 5,
  maxSpreadPct: 0.01,
  maxQuoteAgeMs: 1000
};

const baseJoin = {
  source_ts: 1_000,
  ingest_ts: 1_010,
  seq: 1,
  trace_id: "equityjoin:print-1",
  id: "equityjoin:print-1",
  print_trace_id: "print-1",
  quote_trace_id: "quote-1",
  features: {
    underlying_id: "SPY",
    price: 100,
    size: 1200,
    off_exchange_flag: true,
    print_ts: 1_000,
    quote_placement: "MID",
    quote_mid: 100,
    quote_spread: 0.1
  },
  join_quality: {
    quote_age_ms: 5
  }
};

describe("dark inference rules", () => {
  it("emits absorbed block on large off-exchange mid prints", () => {
    const state = createDarkInferenceState();
    const events = evaluateDarkInferences(baseJoin, config, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("absorbed_block");
    expect(events[0].evidence_refs).toEqual([baseJoin.id]);
  });

  it("skips absorbed block when quote is stale", () => {
    const state = createDarkInferenceState();
    const staleJoin = {
      ...baseJoin,
      join_quality: {
        quote_age_ms: 5000,
        quote_stale: 1
      }
    };
    const events = evaluateDarkInferences(staleJoin, config, state);
    expect(events).toHaveLength(0);
  });

  it("emits stealth accumulation on repeated buy placements", () => {
    const state = createDarkInferenceState();
    const joins = [0, 1, 2].map((offset) => ({
      ...baseJoin,
      id: `equityjoin:buy-${offset}`,
      trace_id: `equityjoin:buy-${offset}`,
      seq: 10 + offset,
      source_ts: 2_000 + offset * 500,
      features: {
        ...baseJoin.features,
        size: 800,
        quote_placement: "A"
      }
    }));

    const events = joins.flatMap((join) => evaluateDarkInferences(join, config, state));
    const accumulation = events.find((event) => event.type === "stealth_accumulation");
    expect(accumulation).toBeDefined();
    expect(accumulation?.evidence_refs.length).toBeGreaterThan(0);
  });

  it("emits distribution on repeated sell placements", () => {
    const state = createDarkInferenceState();
    const joins = [0, 1, 2].map((offset) => ({
      ...baseJoin,
      id: `equityjoin:sell-${offset}`,
      trace_id: `equityjoin:sell-${offset}`,
      seq: 20 + offset,
      source_ts: 3_000 + offset * 500,
      features: {
        ...baseJoin.features,
        size: 900,
        quote_placement: "B"
      }
    }));

    const events = joins.flatMap((join) => evaluateDarkInferences(join, config, state));
    const distribution = events.find((event) => event.type === "distribution");
    expect(distribution).toBeDefined();
    expect(distribution?.evidence_refs.length).toBeGreaterThan(0);
  });

  it("respects cooldown windows", () => {
    const state = createDarkInferenceState();
    const first = evaluateDarkInferences(baseJoin, config, state);
    const second = evaluateDarkInferences(
      { ...baseJoin, source_ts: baseJoin.source_ts + 1_000, seq: baseJoin.seq + 1 },
      config,
      state
    );

    expect(first.length).toBeGreaterThan(0);
    expect(second.find((event) => event.type === "absorbed_block")).toBeUndefined();
  });
});
