import { describe, expect, it } from "bun:test";
import {
  EquityPrintSchema,
  EquityQuoteSchema,
  OptionNBBOSchema,
  OptionPrintSchema
} from "@islandflow/types";
import {
  createDeterministicPrng,
  type GeneratedEventBatch,
  generateSyntheticMarketBatch,
  hashGeneratedEventBatch,
  normalizeSyntheticProfile,
  type SyntheticMarketProfile,
  stableStringify
} from "../src";

const profile: SyntheticMarketProfile = {
  start_ts: Date.parse("2026-01-02T14:30:00Z"),
  steps: 3,
  scenario_id: "phase-01-context-only",
  symbols: [
    {
      id: "nvda-core",
      underlying_id: "NVDA",
      base_price: 124.5,
      exchange: "NASDAQ"
    },
    {
      id: "spy-core",
      underlying_id: "SPY",
      base_price: 501.25,
      exchange: "ARCA"
    }
  ],
  liquidity: {
    id: "tight-demo-liquidity",
    equity_spread_bps: 4,
    equity_quote_size: 900,
    equity_trade_size: 180,
    option_spread_bps: 140,
    option_quote_size: 70,
    option_trade_size: 18,
    off_exchange_ratio: 0.2,
    arrival_interval_ms: 100
  },
  volatility: {
    id: "gentle-drift",
    drift_bps_per_step: 2.5,
    price_noise_bps: 5,
    option_iv: 0.38
  },
  option_chain: {
    id: "complete-test-chain",
    expiries_days: [7, 14],
    strike_offsets_bps: [-250, 0, 250],
    option_types: ["call", "put"],
    strike_step: 5,
    sparse_contract_ratio: 0
  }
};

const seedBundle = {
  seed: 42,
  namespace: "phase-01-test",
  partition: "deterministic-spine"
};

const assertCentTick = (value: number) => {
  expect(Math.round(value * 100)).toBe(value * 100);
};

const buildBatch = (): GeneratedEventBatch =>
  generateSyntheticMarketBatch({
    seed_bundle: seedBundle,
    profile
  });

describe("deterministic synthetic market spine", () => {
  it("produces byte-stable and hash-stable batches for fixed inputs", () => {
    const batchA = buildBatch();
    const batchB = buildBatch();

    expect(stableStringify(batchA)).toBe(stableStringify(batchB));
    expect(hashGeneratedEventBatch(batchA)).toBe(hashGeneratedEventBatch(batchB));
    expect(hashGeneratedEventBatch(batchA)).toBe("fnv1a32:ad3b2f3f");
  });

  it("wraps a repeatable PRNG that can be forked by partition", () => {
    const first = createDeterministicPrng(seedBundle);
    const second = createDeterministicPrng(seedBundle);
    const forked = first.fork("child");

    expect([first.nextFloat(), first.nextInt(1, 10), first.nextFloat()]).toEqual([
      second.nextFloat(),
      second.nextInt(1, 10),
      second.nextFloat()
    ]);
    expect(forked.nextFloat()).not.toBe(first.nextFloat());
  });

  it("emits canonical market event contracts and keeps provenance separate", () => {
    const batch = buildBatch();
    const seenKinds = new Set(batch.events.map((entry) => entry.kind));

    expect(seenKinds).toEqual(
      new Set(["equity_quote", "equity_print", "option_nbbo", "option_print"])
    );

    for (const generated of batch.events) {
      if (generated.kind === "equity_quote") {
        EquityQuoteSchema.parse(generated.event);
      }
      if (generated.kind === "equity_print") {
        EquityPrintSchema.parse(generated.event);
      }
      if (generated.kind === "option_nbbo") {
        OptionNBBOSchema.parse(generated.event);
      }
      if (generated.kind === "option_print") {
        OptionPrintSchema.parse(generated.event);
      }

      expect(batch.provenance_by_trace_id[generated.event.trace_id]?.source_kind).toBe(
        "synthetic_market"
      );
      expect(batch.provenance_by_trace_id[generated.event.trace_id]?.scenario_id).toBe(
        "phase-01-context-only"
      );
    }

    const eventBytes = stableStringify(batch.events);
    expect(eventBytes).not.toContain("hidden");
    expect(eventBytes).not.toContain("source_kind");
    expect(eventBytes).not.toContain("scenario_id");
  });

  it("keeps event ordering, ticks, and quote/trade invariants valid", () => {
    const batch = buildBatch();
    const ordered = [...batch.events].sort(
      (a, b) => a.event.ts - b.event.ts || a.event.seq - b.event.seq
    );

    expect(batch.events).toEqual(ordered);

    for (const generated of batch.events) {
      if (generated.kind === "equity_quote") {
        expect(generated.event.ask).toBeGreaterThan(generated.event.bid);
        assertCentTick(generated.event.bid);
        assertCentTick(generated.event.ask);
      }

      if (generated.kind === "equity_print") {
        expect(generated.event.size).toBeGreaterThan(0);
        assertCentTick(generated.event.price);
      }

      if (generated.kind === "option_nbbo") {
        expect(generated.event.ask).toBeGreaterThan(generated.event.bid);
        expect(generated.event.bidSize).toBeGreaterThan(0);
        expect(generated.event.askSize).toBeGreaterThan(0);
        assertCentTick(generated.event.bid);
        assertCentTick(generated.event.ask);
      }

      if (generated.kind === "option_print") {
        expect(generated.event.execution_nbbo_bid).toBeLessThanOrEqual(generated.event.price);
        expect(generated.event.price).toBeLessThanOrEqual(generated.event.execution_nbbo_ask);
        expect(generated.event.notional).toBeCloseTo(
          generated.event.price * generated.event.size * 100
        );
        assertCentTick(generated.event.price);
        assertCentTick(generated.event.notional ?? 0);
      }
    }
  });

  it("normalizes profile inputs without requiring infrastructure", () => {
    const normalized = normalizeSyntheticProfile({
      start_ts: -10,
      steps: 0,
      symbols: [
        {
          underlying_id: " nvda ",
          base_price: -12,
          exchange: " nasdaq "
        }
      ],
      liquidity: {
        equity_spread_bps: -1,
        option_spread_bps: 10_000,
        off_exchange_ratio: 5,
        arrival_interval_ms: 0
      },
      option_chain: {
        expiries_days: [-1, 14.4, 14],
        strike_offsets_bps: [],
        option_types: ["call"],
        strike_step: 0,
        sparse_contract_ratio: 2
      }
    });

    expect(normalized.start_ts).toBe(0);
    expect(normalized.steps).toBe(1);
    expect(normalized.symbols[0]).toMatchObject({
      underlying_id: "NVDA",
      base_price: 1,
      exchange: "NASDAQ"
    });
    expect(normalized.liquidity.equity_spread_bps).toBe(1);
    expect(normalized.liquidity.option_spread_bps).toBe(2500);
    expect(normalized.liquidity.off_exchange_ratio).toBe(1);
    expect(normalized.liquidity.arrival_interval_ms).toBe(1);
    expect(normalized.option_chain.expiries_days).toEqual([1, 14]);
    expect(normalized.option_chain.option_types).toEqual(["call"]);
    expect(normalized.option_chain.strike_step).toBe(0.5);
    expect(normalized.option_chain.sparse_contract_ratio).toBe(0.95);
  });
});
