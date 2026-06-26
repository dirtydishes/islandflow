import { describe, expect, it } from "bun:test";
import { smartFlowAlertFromProjection } from "@islandflow/types";
import {
  buildNativeSmartFlowProjectionsFromPacket,
  buildNativeSmartFlowProjectionsFromPackets,
  NativeSmartFlowRuntime
} from "../src/smart-flow-runtime";
import { buildFlowPacket } from "./helpers";

const buildDirectionalRuntimePacket = (id: string, ts: number) =>
  buildFlowPacket({
    id,
    source_ts: ts,
    ingest_ts: ts + 10,
    seq: ts,
    members: Array.from({ length: 4 }, (_, index) => `print:${id}:${index}`),
    features: {
      option_contract_id: "SPY-2025-02-21-450-C",
      underlying_id: "SPY",
      count: 4,
      total_size: 1100,
      total_premium: 90_000,
      start_ts: ts - 100,
      end_ts: ts,
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
  });

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

  it("derives smart-flow alerts from non-abstained native projections", () => {
    const [projection] = buildNativeSmartFlowProjectionsFromPacket(
      buildFlowPacket({
        id: "flowpacket:runtime-alert",
        source_ts: 30_000,
        ingest_ts: 30_010,
        seq: 43,
        members: Array.from({ length: 8 }, (_, index) => `print:runtime-alert-${index}`),
        features: {
          option_contract_id: "SPY-2025-02-21-450-C",
          underlying_id: "SPY",
          count: 8,
          total_size: 2200,
          total_premium: 180_000,
          start_ts: 29_800,
          end_ts: 30_000,
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
    if (!projection) {
      throw new Error("expected directional packet to emit a projection");
    }

    const alert = smartFlowAlertFromProjection(projection);

    expect(alert).not.toBeNull();
    expect(alert?.trigger.kind).toBe("non_abstained_hypothesis");
    expect(alert?.projection).toEqual(projection);
    expect(alert?.policy_confidence).toBe(
      projection.hypothesis.scores.confidence.policy_confidence
    );
    expect(alert?.evidence_quality).toBe(projection.hypothesis.scores.confidence.evidence_quality);
    expect(alert).not.toHaveProperty("score");
    expect(alert).not.toHaveProperty("severity");
    expect(alert).not.toHaveProperty("hits");
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
    expect(projection ? smartFlowAlertFromProjection(projection) : null).toBeNull();
  });

  it("emits completed windows with the same cluster shape as replay-style batch evaluation", () => {
    const first = buildDirectionalRuntimePacket("flowpacket:runtime-window-a", 10_000);
    const second = buildDirectionalRuntimePacket("flowpacket:runtime-window-b", 20_000);
    const nextWindow = buildDirectionalRuntimePacket("flowpacket:runtime-window-c", 61_000);
    const runtime = new NativeSmartFlowRuntime();

    expect(runtime.ingest(first).projections).toEqual([]);
    expect(runtime.ingest(second).projections).toEqual([]);
    const flush = runtime.ingest(nextWindow);
    const expected = buildNativeSmartFlowProjectionsFromPackets([first, second]);

    expect(flush.projections).toEqual(expected);
    expect(flush.projections[0]?.refs.candidate_ids).toEqual([
      "candidate:flowpacket:runtime-window-a",
      "candidate:flowpacket:runtime-window-b"
    ]);

    expect(runtime.pendingCount).toBe(3);
    flush.commit();
    expect(runtime.pendingCount).toBe(1);
  });
});
