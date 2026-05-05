import { describe, expect, it } from "bun:test";
import type { OptionPrint } from "@islandflow/types";
import { buildSmartMoneyEventFromPacket } from "../../compute/src/parent-events";
import {
  buildSyntheticBurstForTest,
  buildSyntheticFlowPacketForTest,
  createSyntheticOptionsAdapter,
  listSyntheticSmartMoneyScenariosForTest,
  updateSyntheticIvForTest
} from "../src/adapters/synthetic";

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

describe("synthetic smart-money scenarios", () => {
  it("provides deterministic labeled parent-event templates for all core profiles plus noise", () => {
    const scenarios = listSyntheticSmartMoneyScenariosForTest();

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "institutional_directional",
      "retail_whale",
      "event_driven",
      "vol_seller",
      "arbitrage",
      "hedge_reactive",
      "neutral_noise"
    ]);
  });

  it("scores each labeled scenario as its intended primary profile", () => {
    const now = Date.parse("2026-01-02T15:00:00Z");
    const scenarios = listSyntheticSmartMoneyScenariosForTest().filter(
      (scenario) => scenario.hiddenLabel !== "neutral_noise"
    );

    for (const scenario of scenarios) {
      const { packet, hiddenLabel } = buildSyntheticFlowPacketForTest(scenario.id, now);
      const event = buildSmartMoneyEventFromPacket(packet);
      const winningScore = event.profile_scores[0];
      const nearbyWrongScores = event.profile_scores.filter(
        (score) => score.profile_id !== hiddenLabel && score.probability >= 0.5
      );

      expect(event.abstained, scenario.id).toBe(false);
      expect(event.primary_profile_id, scenario.id).toBe(hiddenLabel);
      expect(winningScore?.profile_id, scenario.id).toBe(hiddenLabel);
      expect(winningScore?.probability ?? 0, scenario.id).toBeGreaterThanOrEqual(0.5);
      expect(nearbyWrongScores, scenario.id).toEqual([]);
    }
  });

  it("keeps neutral background noise below the emission threshold", () => {
    const { packet } = buildSyntheticFlowPacketForTest(
      "neutral_noise",
      Date.parse("2026-01-02T15:00:00Z")
    );

    const event = buildSmartMoneyEventFromPacket(packet);

    expect(event.abstained).toBe(true);
    expect(event.primary_profile_id).toBeNull();
    expect(event.profile_scores[0]?.probability ?? 1).toBeLessThan(0.42);
  });

  it("does not expose hidden labels on emitted option prints", async () => {
    const adapter = createSyntheticOptionsAdapter({
      emitIntervalMs: 1,
      mode: "active"
    });
    const trades: OptionPrint[] = [];
    const stop = adapter.start({
      onTrade: (trade) => {
        trades.push(trade);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    stop();

    expect(trades.length).toBeGreaterThan(0);
    for (const trade of trades) {
      expect("hiddenLabel" in trade).toBe(false);
      expect("label" in trade).toBe(false);
    }
  });
});
