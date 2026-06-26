import { describe, expect, it } from "bun:test";
import { buildNativeSmartFlowProjectionsFromPacket } from "../src/smart-flow-runtime";
import { buildFlowPacket } from "./helpers";

describe("native smart-flow runtime", () => {
  it("builds canonical explainability projections directly from flow packets", () => {
    const [projection] = buildNativeSmartFlowProjectionsFromPacket(
      buildFlowPacket({
        id: "flowpacket:runtime-directional",
        source_ts: 10_000,
        ingest_ts: 10_010,
        seq: 42,
        members: Array.from({ length: 8 }, (_, index) => `print:runtime-${index}`),
        features: {
          option_contract_id: "SPY-2025-02-21-450-C",
          underlying_id: "SPY",
          count: 8,
          total_size: 2200,
          total_premium: 180_000,
          start_ts: 9_800,
          end_ts: 10_000,
          nbbo_bid: 1.2,
          nbbo_ask: 1.24,
          nbbo_mid: 1.22,
          nbbo_spread: 0.04,
          nbbo_coverage_ratio: 1,
          nbbo_aggressive_ratio: 0.82,
          nbbo_aggressive_buy_ratio: 0.78,
          nbbo_aggressive_sell_ratio: 0.04,
          nbbo_inside_ratio: 0.05,
          underlying_bid: 449.9,
          underlying_ask: 450.1,
          underlying_mid: 450,
          underlying_spread: 0.2
        }
      })
    );

    expect(projection?.source_channel).toBe("smart-flow");
    expect(projection?.compatibility).toBeUndefined();
    expect(projection?.hypothesis.hypothesis_type).toBe("directional_accumulation");
    expect(projection?.refs.evidence_refs).toContain("flowpacket:runtime-directional");
    expect(projection?.refs.evidence_refs).toContain("print:runtime-0");
  });

  it("persists abstention state for weak rejected packets", () => {
    const [projection] = buildNativeSmartFlowProjectionsFromPacket(
      buildFlowPacket({
        id: "flowpacket:runtime-abstain",
        source_ts: 20_000,
        features: {
          option_contract_id: "SPY-2025-02-21-450-C",
          underlying_id: "SPY",
          total_premium: 100,
          total_size: 1,
          nbbo_coverage_ratio: 0,
          nbbo_stale_ratio: 1,
          nbbo_aggressive_ratio: 0
        }
      })
    );

    expect(projection?.source_channel).toBe("smart-flow");
    expect(projection?.abstention.abstained).toBe(true);
    expect(projection?.hypothesis.hypothesis_type).toBe("unclear");
  });
});
