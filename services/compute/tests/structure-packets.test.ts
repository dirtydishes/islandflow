import { describe, expect, test } from "bun:test";
import { summarizeStructure } from "../src/structures";
import {
  buildStructureFlowPacket,
  planStructurePacket,
  shouldEmitStructurePacket,
  type LegEvidence
} from "../src/structure-packets";

const placements = (overrides?: Partial<LegEvidence["placements"]>): LegEvidence["placements"] => ({
  aa: 0,
  a: 0,
  b: 0,
  bb: 0,
  mid: 0,
  missing: 0,
  stale: 0,
  ...overrides
});

const leg = (input: Partial<LegEvidence> & Pick<LegEvidence, "contractId" | "right" | "strike">): LegEvidence => {
  return {
    contractId: input.contractId,
    root: "SPY",
    expiry: input.expiry ?? "2025-01-17",
    right: input.right,
    strike: input.strike,
    startTs: input.startTs ?? 1000,
    endTs: input.endTs ?? 1100,
    members: input.members ?? [input.contractId],
    totalSize: input.totalSize ?? 100,
    totalPremium: input.totalPremium ?? 1000,
    placements: input.placements ?? placements(),
    source_ts: input.source_ts ?? 1000,
    ingest_ts: input.ingest_ts ?? 1200,
    seq: input.seq ?? 1
  };
};

describe("structure packet planning", () => {
  test("emits only on latest leg endTs", () => {
    const call = leg({
      contractId: "SPY-2025-01-17-450-C",
      right: "C",
      strike: 450,
      endTs: 1100
    });
    const put = leg({
      contractId: "SPY-2025-01-17-450-P",
      right: "P",
      strike: 450,
      endTs: 1125
    });
    const legs: LegEvidence[] = [call, put];

    expect(shouldEmitStructurePacket(legs, call.contractId)).toBe(false);
    expect(shouldEmitStructurePacket(legs, put.contractId)).toBe(true);
  });

  test("plans deterministic id + members across legs", () => {
    const call = leg({
      contractId: "SPY-2025-01-17-450-C",
      right: "C",
      strike: 450,
      members: ["p2", "p1"],
      totalSize: 20,
      totalPremium: 4000,
      placements: placements({ aa: 1, mid: 1 })
    });
    const put = leg({
      contractId: "SPY-2025-01-17-450-P",
      right: "P",
      strike: 450,
      startTs: 1005,
      endTs: 1120,
      members: ["p3"],
      totalSize: 10,
      totalPremium: 1500,
      placements: placements({ bb: 1 })
    });

    const legs = [call, put];
    const summary = summarizeStructure(legs);
    expect(summary?.type).toBe("straddle");

    const plan = planStructurePacket(legs, summary!, 500);
    expect(plan).not.toBeNull();

    expect(plan!.pseudoContractId).toBe("SPY-2025-01-17-STRUCT-straddle");
    expect(plan!.id.startsWith("flowpacket:SPY-2025-01-17-STRUCT-straddle:")).toBe(true);
    expect(plan!.members).toEqual(["p1", "p2", "p3"]);
    expect(plan!.totalSize).toBe(30);
    expect(plan!.totalPremium).toBe(5500);
    expect(plan!.count).toBe(3);

    const swappedPlan = planStructurePacket([put, call], summary!, 500);
    expect(swappedPlan).not.toBeNull();
    expect(swappedPlan!.id).toBe(plan!.id);
    expect(swappedPlan!.members).toEqual(plan!.members);
  });

  test("builds structure FlowPacket with aggregate aggressor ratios", () => {
    const call = leg({
      contractId: "SPY-2025-01-17-450-C",
      right: "C",
      strike: 450,
      members: ["p1", "p2"],
      totalSize: 20,
      totalPremium: 4000,
      placements: placements({ aa: 1, mid: 1 })
    });
    const put = leg({
      contractId: "SPY-2025-01-17-450-P",
      right: "P",
      strike: 450,
      members: ["p3"],
      totalSize: 10,
      totalPremium: 1500,
      placements: placements({ bb: 1 })
    });

    const legs = [call, put];
    const summary = summarizeStructure(legs);
    const plan = planStructurePacket(legs, summary!, 500);
    const packet = buildStructureFlowPacket(plan!, summary!);

    expect(packet.features.packet_kind).toBe("structure");
    expect(packet.features.underlying_id).toBe("SPY");
    expect(packet.features.nbbo_aa_count).toBe(1);
    expect(packet.features.nbbo_bb_count).toBe(1);
    expect(packet.features.nbbo_mid_count).toBe(1);
    expect(packet.features.nbbo_coverage_ratio).toBeCloseTo(1, 6);

    // 2 aggressive (AA + BB) out of 3 classified (AA + BB + MID)
    expect(packet.features.nbbo_aggressive_ratio).toBeCloseTo(2 / 3, 4);
  });

  test("includes roll metadata when structure type is roll", () => {
    const near = leg({
      contractId: "SPY-2025-01-17-450-C",
      right: "C",
      strike: 450,
      expiry: "2025-01-17",
      members: ["p1"],
      totalSize: 10,
      totalPremium: 2000,
      placements: placements({ aa: 1 })
    });
    const far = leg({
      contractId: "SPY-2025-02-21-455-C",
      right: "C",
      strike: 455,
      expiry: "2025-02-21",
      startTs: 1010,
      endTs: 1120,
      members: ["p2"],
      totalSize: 12,
      totalPremium: 2500,
      placements: placements({ bb: 1 })
    });

    const legs = [near, far];
    const summary = summarizeStructure(legs);
    expect(summary?.type).toBe("roll");

    const plan = planStructurePacket(legs, summary!, 500);
    const packet = buildStructureFlowPacket(plan!, summary!);

    expect(packet.features.structure_expiries_count).toBe(2);
    expect(packet.features.roll_from_expiry).toBe("2025-01-17");
    expect(packet.features.roll_to_expiry).toBe("2025-02-21");
    expect(packet.features.roll_from_strike).toBe(450);
    expect(packet.features.roll_to_strike).toBe(455);
    expect(packet.features.roll_strike_delta).toBe(5);
  });
});
