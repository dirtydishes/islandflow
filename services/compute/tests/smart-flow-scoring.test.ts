import { describe, expect, it } from "bun:test";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION
} from "@islandflow/types";
import { buildFlowEvidenceClusters } from "../src/smart-flow-clusters";
import { buildFlowEvidenceCandidateFromPacket } from "../src/smart-flow-evidence";
import { scoreFlowEvidenceCluster } from "../src/smart-flow-scoring";
import { buildFlowPacket } from "./helpers";

const clusterFromPackets = (
  packets: ReturnType<typeof buildFlowPacket>[],
  includeRejectedCandidates = false
) => {
  const extractions = packets.map((packet) => buildFlowEvidenceCandidateFromPacket(packet));
  const result = buildFlowEvidenceClusters(extractions, {
    windowMs: 60_000,
    includeRejectedCandidates
  });
  const cluster = result.clusters[0];
  if (!cluster) {
    throw new Error("Expected scoring test to build a cluster.");
  }
  return cluster;
};

describe("smart-flow hypothesis scoring", () => {
  it("scores clean directional evidence as a versioned bullish score vector", () => {
    const cluster = clusterFromPackets([
      buildFlowPacket({
        id: "flowpacket:score-directional",
        source_ts: 10_000,
        members: Array.from({ length: 8 }, (_, index) => `print:directional-${index}`),
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
    ]);

    const [primary, ...alternatives] = scoreFlowEvidenceCluster(cluster);

    expect(primary?.schema_version).toBe(SMART_FLOW_CONTRACT_VERSION);
    expect(primary?.policy_version).toBe(SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION);
    expect(primary?.model_version).toBe(SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION);
    expect(primary?.hypothesis_type).toBe("directional_accumulation");
    expect(primary?.direction).toBe("bullish");
    expect(primary?.evidence_strength ?? 0).toBeGreaterThan(0.65);
    expect(primary?.confidence.policy_confidence ?? 0).toBeGreaterThan(0.55);
    expect(primary?.penalties.map((penalty) => penalty.kind)).not.toContain("stale_quote_context");
    expect(alternatives.map((vector) => vector.hypothesis_type)).toContain("retail_attention_flow");
    expect(JSON.stringify(scoreFlowEvidenceCluster(cluster)).toLowerCase()).not.toContain(
      "institutional"
    );
  });

  it("preserves quote, inside-market, and low-premium negative evidence as penalties", () => {
    const cluster = clusterFromPackets(
      [
        buildFlowPacket({
          id: "flowpacket:score-negative",
          source_ts: 20_000,
          members: ["print:negative-1", "print:negative-2"],
          features: {
            option_contract_id: "SPY-2025-02-21-450-C",
            underlying_id: "SPY",
            count: 2,
            total_size: 30,
            total_premium: 7_000,
            start_ts: 19_800,
            end_ts: 20_000,
            nbbo_bid: 0.4,
            nbbo_ask: 1.2,
            nbbo_mid: 0.8,
            nbbo_spread: 0.8,
            nbbo_coverage_ratio: 1,
            nbbo_aggressive_ratio: 0.1,
            nbbo_aggressive_buy_ratio: 0.05,
            nbbo_aggressive_sell_ratio: 0.05,
            nbbo_inside_ratio: 0.92,
            conditions: "CROSS,SPREAD",
            special_print_count: 1
          }
        })
      ],
      true
    );

    const vectors = scoreFlowEvidenceCluster(cluster);
    const allPenalties = vectors.flatMap((vector) => vector.penalties);
    const penaltyKinds = allPenalties.map((penalty) => penalty.kind);

    expect(vectors[0]?.confidence.policy_confidence ?? 1).toBeLessThan(0.45);
    expect(penaltyKinds).toContain("wide_quote_context");
    expect(penaltyKinds).toContain("inside_market_context");
    expect(penaltyKinds).toContain("complex_or_special_print_context");
    expect(penaltyKinds).toContain("low_premium");
    expect(allPenalties.every((penalty) => penalty.evidence_refs.length > 0)).toBe(true);
  });

  it("keeps structure-led alternatives neutral instead of forcing direction", () => {
    const cluster = clusterFromPackets([
      buildFlowPacket({
        id: "flowpacket:score-structure",
        source_ts: 30_000,
        members: ["print:structure-1", "print:structure-2", "print:structure-3"],
        features: {
          option_contract_id: "IWM-2025-02-21-210-C",
          underlying_id: "IWM",
          count: 3,
          total_size: 900,
          total_premium: 70_000,
          start_ts: 29_800,
          end_ts: 30_000,
          nbbo_bid: 1.1,
          nbbo_ask: 1.14,
          nbbo_mid: 1.12,
          nbbo_spread: 0.04,
          nbbo_coverage_ratio: 0.92,
          nbbo_aggressive_ratio: 0.2,
          nbbo_aggressive_buy_ratio: 0.11,
          nbbo_aggressive_sell_ratio: 0.1,
          nbbo_inside_ratio: 0.55,
          structure_type: "straddle",
          structure_legs: 4,
          same_size_leg_symmetry: 0.92
        }
      })
    ]);

    const [primary] = scoreFlowEvidenceCluster(cluster);

    expect(primary?.hypothesis_type).toBe("structure_arbitrage");
    expect(primary?.direction).toBe("neutral");
    expect(primary?.penalties.map((penalty) => penalty.kind)).not.toContain(
      "conflicting_direction"
    );
  });
});
