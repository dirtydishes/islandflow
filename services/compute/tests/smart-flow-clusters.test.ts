import { describe, expect, it } from "bun:test";
import { buildFlowEvidenceClusters } from "../src/smart-flow-clusters";
import { buildFlowEvidenceCandidateFromPacket } from "../src/smart-flow-evidence";
import { buildFlowPacket } from "./helpers";

const acceptedSpyExtraction = () =>
  buildFlowEvidenceCandidateFromPacket(
    buildFlowPacket({
      id: "flowpacket:spy-accepted",
      source_ts: 10_000,
      members: ["print:accepted-1", "print:accepted-2"],
      features: {
        option_contract_id: "SPY-2025-02-21-450-C",
        underlying_id: "SPY",
        count: 2,
        total_size: 900,
        total_premium: 75_000,
        start_ts: 9_900,
        end_ts: 10_000,
        nbbo_bid: 1.2,
        nbbo_ask: 1.24,
        nbbo_mid: 1.22,
        nbbo_spread: 0.04,
        nbbo_coverage_ratio: 1,
        nbbo_aggressive_ratio: 0.8,
        nbbo_inside_ratio: 0.1,
        underlying_bid: 449.9,
        underlying_ask: 450.1,
        underlying_mid: 450,
        underlying_spread: 0.2
      }
    })
  );

const downWeightedSpyExtraction = () =>
  buildFlowEvidenceCandidateFromPacket(
    buildFlowPacket({
      id: "flowpacket:spy-down-weighted",
      source_ts: 20_000,
      members: ["print:down-1", "print:down-2"],
      features: {
        option_contract_id: "SPY-2025-02-21-452-C",
        underlying_id: "SPY",
        count: 2,
        total_size: 500,
        total_premium: 50_000,
        start_ts: 19_900,
        end_ts: 20_000,
        nbbo_bid: 1,
        nbbo_ask: 2,
        nbbo_mid: 1.5,
        nbbo_spread: 1,
        nbbo_coverage_ratio: 1,
        nbbo_aggressive_ratio: 0.2,
        nbbo_inside_ratio: 0.85,
        conditions: "SPREAD",
        special_print_count: 1
      }
    })
  );

const rejectedSpyExtraction = () =>
  buildFlowEvidenceCandidateFromPacket(
    buildFlowPacket({
      id: "flowpacket:spy-rejected",
      source_ts: 30_000,
      members: ["print:rejected-1", "print:rejected-2"],
      features: {
        option_contract_id: "SPY-2025-02-21-455-C",
        underlying_id: "SPY",
        count: 2,
        total_size: 800,
        total_premium: 80_000,
        start_ts: 29_900,
        end_ts: 30_000,
        nbbo_coverage_ratio: 0.1,
        nbbo_stale_count: 2
      }
    })
  );

describe("smart-flow evidence clustering", () => {
  it("builds deterministic clusters from eligible candidates and keeps rejected ids separate", () => {
    const accepted = acceptedSpyExtraction();
    const downWeighted = downWeightedSpyExtraction();
    const rejected = rejectedSpyExtraction();

    const result = buildFlowEvidenceClusters([downWeighted, rejected, accepted], {
      windowMs: 60_000
    });

    expect(result.rejected_candidate_ids).toEqual(["candidate:flowpacket:spy-rejected"]);
    expect(result.clusters).toHaveLength(1);

    const cluster = result.clusters[0]!;
    expect(cluster.cluster_id).toBe("cluster:SPY:0:60000");
    expect(cluster.start_ts).toBe(0);
    expect(cluster.end_ts).toBe(60_000);
    expect(cluster.window_ms).toBe(60_000);
    expect(cluster.candidate_ids).toEqual([
      "candidate:flowpacket:spy-accepted",
      "candidate:flowpacket:spy-down-weighted"
    ]);
    expect(cluster.candidate_ids).not.toContain("candidate:flowpacket:spy-rejected");
    expect(cluster.feature_summary.total_premium).toBe(125_000);
    expect(cluster.feature_summary.eligibility_status).toBe("down_weighted");
    expect(cluster.evidence_quality.caveats).toEqual(
      expect.arrayContaining(["noisy_print_context", "wide_quote_context"])
    );
  });

  it("keeps cluster keys and feature summaries stable regardless of input order", () => {
    const accepted = acceptedSpyExtraction();
    const downWeighted = downWeightedSpyExtraction();

    const forward = buildFlowEvidenceClusters([accepted, downWeighted], { windowMs: 60_000 })
      .clusters[0]!;
    const reverse = buildFlowEvidenceClusters([downWeighted, accepted], { windowMs: 60_000 })
      .clusters[0]!;

    expect(forward.cluster_id).toBe(reverse.cluster_id);
    expect(forward.candidate_ids).toEqual(reverse.candidate_ids);
    expect(forward.packet_ids).toEqual(reverse.packet_ids);
    expect(forward.feature_summary).toEqual(reverse.feature_summary);
  });

  it("adds traceable measured, derived, and inferred feature details", () => {
    const result = buildFlowEvidenceClusters(
      [acceptedSpyExtraction(), downWeightedSpyExtraction()],
      { windowMs: 60_000 }
    );
    const cluster = result.clusters[0]!;

    for (const feature of Object.values(cluster.feature_details)) {
      expect(feature.fact_ids.length).toBeGreaterThan(0);
      expect(feature.evidence_refs.length).toBeGreaterThan(0);
    }

    expect(cluster.feature_details.total_premium?.basis).toBe("measured_fact");
    expect(cluster.feature_details.total_premium?.fact_ids).toEqual(
      expect.arrayContaining([
        "fact:flowpacket:spy-accepted:premium-size",
        "fact:flowpacket:spy-down-weighted:premium-size"
      ])
    );
    expect(cluster.feature_details.candidate_count?.basis).toBe("derived_metric");
    expect(cluster.feature_details.structure_context?.basis).toBe("inferred_structure");
    expect(cluster.feature_details.structure_context?.value).toBe("complex_or_spread_context");
    expect(cluster.feature_details.structure_context?.evidence_refs).toContain("print:down-1");
  });
});
