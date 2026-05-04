import { describe, expect, it } from "bun:test";
import { buildSyntheticBurstForTest, updateSyntheticIvForTest } from "../src/adapters/synthetic";

const totalBurstNotional = (burst: {
  basePrice: number;
  baseSize: number;
  printCount: number;
}): number => burst.basePrice * burst.baseSize * burst.printCount * 100;

describe("synthetic options burst sizing", () => {
  it("keeps realistic-mode ask lifts inside the configured notional band", () => {
    const burst = buildSyntheticBurstForTest(2, Date.UTC(2026, 0, 2), "realistic");

    expect(burst.scenarioId).toBe("ask_lift");
    expect(totalBurstNotional(burst)).toBeGreaterThanOrEqual(9_000);
    expect(totalBurstNotional(burst)).toBeLessThanOrEqual(35_000);
  });

  it("keeps active-mode sweeps inside the configured notional band", () => {
    const burst = buildSyntheticBurstForTest(1, Date.UTC(2026, 0, 2), "active");

    expect(burst.scenarioId).toBe("bearish_sweep");
    expect(totalBurstNotional(burst)).toBeGreaterThanOrEqual(120_000);
    expect(totalBurstNotional(burst)).toBeLessThanOrEqual(240_000);
  });
});

describe("synthetic options IV model", () => {
  it("increases under repeated same-contract ask buying", () => {
    let state = updateSyntheticIvForTest(undefined, {
      ts: 1_000,
      placement: "A",
      size: 100,
      notional: 20_000,
      dteDays: 1,
      moneyness: 1.02
    });
    const firstIv = state.iv;

    state = updateSyntheticIvForTest(state, {
      ts: 1_100,
      placement: "AA",
      size: 300,
      notional: 80_000,
      dteDays: 1,
      moneyness: 1.02
    });

    expect(state.iv).toBeGreaterThan(firstIv);
  });

  it("decays after inactivity", () => {
    const active = updateSyntheticIvForTest(undefined, {
      ts: 1_000,
      placement: "AA",
      size: 500,
      notional: 120_000,
      dteDays: 7,
      moneyness: 1.1
    });
    const decayed = updateSyntheticIvForTest(active, {
      ts: 181_000,
      placement: "MID",
      size: 10,
      notional: 1_000,
      dteDays: 7,
      moneyness: 1.1
    });

    expect(decayed.iv).toBeLessThan(active.iv);
  });

  it("keeps IV within clamps", () => {
    let state = undefined;
    for (let i = 0; i < 80; i += 1) {
      state = updateSyntheticIvForTest(state, {
        ts: 1_000 + i * 10,
        placement: "AA",
        size: 10_000,
        notional: 5_000_000,
        dteDays: 0,
        moneyness: 1.8
      });
    }

    expect(state.iv).toBeGreaterThanOrEqual(0.05);
    expect(state.iv).toBeLessThanOrEqual(2.5);
  });
});
