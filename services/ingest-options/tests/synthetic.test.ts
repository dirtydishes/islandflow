import { describe, expect, it } from "bun:test";
import { buildSyntheticBurstForTest } from "../src/adapters/synthetic";

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
