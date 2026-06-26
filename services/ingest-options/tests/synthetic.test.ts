import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  type FlowHypothesisType,
  type OptionNBBO,
  type OptionPrint,
  type SmartFlowProfileId
} from "@islandflow/types";
import { buildNativeSmartFlowProjectionsFromPacket } from "../../compute/src/smart-flow-runtime";
import {
  buildSyntheticBurstForTest,
  buildSyntheticFlowPacketForTest,
  createSyntheticOptionsAdapter,
  listSyntheticSmartFlowScenariosForTest,
  updateSyntheticIvForTest
} from "../src/adapters/synthetic";

const FORBIDDEN_LABEL_FIELDS = ["scenario_id", "label", "hiddenLabel", "labels", "source_kind"];

const STABLE_SYNTHETIC_PROFILE_HYPOTHESES: Partial<Record<SmartFlowProfileId, FlowHypothesisType>> =
  {
    institutional_directional: "directional_accumulation",
    retail_whale: "retail_attention_flow"
  };

const totalBurstNotional = (burst: {
  legs: Array<{
    basePrice: number;
    baseSize: number;
  }>;
  cycles: number;
}): number =>
  burst.legs.reduce((sum, leg) => sum + leg.basePrice * leg.baseSize * burst.cycles * 100, 0);

const findBurst = (
  mode: "realistic" | "active",
  scenarioId: string,
  now = Date.UTC(2026, 0, 2)
) => {
  for (let i = 1; i <= 360; i += 1) {
    const burst = buildSyntheticBurstForTest(i, now + i * 1_000, mode);
    if (burst.scenarioId === scenarioId) {
      return burst;
    }
  }
  throw new Error(`Unable to find synthetic scenario ${scenarioId} in mode ${mode}`);
};

describe("synthetic options burst sizing", () => {
  it("keeps realistic-mode ask-lift accumulation inside the configured notional band", () => {
    const burst = findBurst("realistic", "ask_lift_accumulation");

    expect(burst.scenarioId).toBe("ask_lift_accumulation");
    expect(totalBurstNotional(burst)).toBeGreaterThanOrEqual(12_000);
    expect(totalBurstNotional(burst)).toBeLessThanOrEqual(90_000);
  });

  it("keeps active-mode call sweeps inside the configured notional band", () => {
    const burst = findBurst("active", "call_sweep");

    expect(burst.scenarioId).toBe("call_sweep");
    expect(totalBurstNotional(burst)).toBeGreaterThanOrEqual(70_000);
    expect(totalBurstNotional(burst)).toBeLessThanOrEqual(420_000);
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

describe("synthetic smart-flow scenarios", () => {
  it("provides deterministic labeled parent-event templates for all core profiles plus noise", () => {
    const scenarios = listSyntheticSmartFlowScenariosForTest();

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

  it("projects labeled scenarios through canonical smart-flow contracts", () => {
    const now = Date.parse("2026-01-02T15:00:00Z");
    const scenarios = listSyntheticSmartFlowScenariosForTest().filter(
      (scenario) => scenario.label !== "neutral_noise"
    );

    for (const scenario of scenarios) {
      const { packet, hiddenLabel } = buildSyntheticFlowPacketForTest(scenario.id, now);
      const [projection] = buildNativeSmartFlowProjectionsFromPacket(packet);
      const expected = STABLE_SYNTHETIC_PROFILE_HYPOTHESES[scenario.label as SmartFlowProfileId];

      expect(projection, scenario.id).toBeDefined();
      expect(projection?.source_channel, scenario.id).toBe("smart-flow");
      expect(projection?.hypothesis.generated_from, scenario.id).toBe("flow_evidence_cluster");
      if (expected) {
        expect(projection?.abstention.abstained, scenario.id).toBe(false);
        expect(projection?.hypothesis.hypothesis_type, scenario.id).toBe(expected);
        expect(
          projection?.hypothesis.scores.confidence.policy_confidence ?? 0,
          scenario.id
        ).toBeGreaterThanOrEqual(0.5);
      }
      expect(hiddenLabel.length, scenario.id).toBeGreaterThan(0);
    }
  });

  it("covers every smart-flow label in active runtime mode over a deterministic sample", () => {
    const seen = new Set<string>();
    const now = Date.parse("2026-01-02T15:00:00Z");

    for (let i = 1; i <= 120; i += 1) {
      const burst = buildSyntheticBurstForTest(i, now + i * 1_000, "active");
      seen.add(burst.label);
    }

    expect(seen).toEqual(
      new Set([
        "institutional_directional",
        "retail_whale",
        "event_driven",
        "vol_seller",
        "arbitrage",
        "hedge_reactive",
        "neutral_noise"
      ])
    );
  });

  it("covers every smart-flow label in realistic mode within a default twenty-minute window", () => {
    const seen = new Set<string>();
    const now = Date.parse("2026-01-02T15:00:00Z");

    for (let i = 1; i <= 120; i += 1) {
      const burst = buildSyntheticBurstForTest(i, now + i * 10_000, "realistic");
      seen.add(burst.label);
    }

    expect(seen).toEqual(
      new Set([
        "institutional_directional",
        "retail_whale",
        "event_driven",
        "vol_seller",
        "arbitrage",
        "hedge_reactive",
        "neutral_noise"
      ])
    );
  });

  it("keeps neutral background noise below the emission threshold", () => {
    const { packet } = buildSyntheticFlowPacketForTest(
      "neutral_noise",
      Date.parse("2026-01-02T15:00:00Z")
    );

    const [projection] = buildNativeSmartFlowProjectionsFromPacket(packet);

    expect(projection?.abstention.abstained).toBe(true);
    expect(projection?.hypothesis.hypothesis_type).toBe("unclear");
    expect(projection?.hypothesis.scores.confidence.policy_confidence ?? 1).toBeLessThan(0.42);
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
    expect(trades.some((trade) => trade.trace_id.startsWith("synthetic-options-"))).toBe(true);
    for (const trade of trades) {
      for (const field of FORBIDDEN_LABEL_FIELDS) {
        expect(field in trade).toBe(false);
      }
    }
  });

  it("emits selected deterministic demo runs once while regular ticks produce dynamic bursts", async () => {
    const adapter = createSyntheticOptionsAdapter({
      emitIntervalMs: 1,
      mode: "realistic",
      getControl: () => ({
        ...DEFAULT_SYNTHETIC_CONTROL_STATE,
        demo_profile_id: "quiet-range",
        load_profile_id: "firehose"
      })
    });
    const trades: OptionPrint[] = [];
    const nbbo: OptionNBBO[] = [];
    const stop = adapter.start({
      onTrade: (trade) => {
        trades.push(trade);
      },
      onNBBO: (quote) => {
        nbbo.push(quote);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    stop();

    expect(trades.length).toBeGreaterThan(0);
    expect(nbbo.length).toBeGreaterThan(0);
    expect(trades.some((trade) => trade.trace_id.startsWith("synthetic-options-"))).toBe(true);
    const demoTrades = trades.filter((trade) => trade.trace_id.includes(":live:"));
    const runIds = new Set(demoTrades.map((trade) => trade.trace_id.split(":live:")[0]));
    const runSerials = new Set(
      demoTrades.map((trade) => trade.trace_id.match(/:live:(\d+):/)?.[1])
    );
    expect(runIds.has("phase03-f")).toBe(true);
    expect(runIds.has("phase03-d")).toBe(true);
    expect(runSerials).toEqual(new Set(["1", "2"]));
    for (const event of [...trades, ...nbbo]) {
      for (const field of FORBIDDEN_LABEL_FIELDS) {
        expect(field in event).toBe(false);
      }
    }
  });
});
