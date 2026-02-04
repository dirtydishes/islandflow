import { describe, expect, it } from "bun:test";
import type { ClassifierHitEvent } from "@islandflow/types";
import { scoreAlert } from "../src/alert-scoring";
import { buildFlowPacket } from "./helpers";

const hit = (confidence: number): ClassifierHitEvent =>
  ({
    source_ts: 1,
    ingest_ts: 1,
    seq: 1,
    trace_id: `hit:${confidence}`,
    classifier_id: "test",
    confidence,
    direction: "neutral",
    explanations: ["test"]
  }) satisfies ClassifierHitEvent;

describe("alert scoring", () => {
  it("classifies <45 as low", () => {
    const packet = buildFlowPacket({
      features: {
        total_premium: 44_000
      }
    });

    const result = scoreAlert(packet, []);
    expect(result.score).toBe(44);
    expect(result.severity).toBe("low");
  });

  it("classifies >=45 as medium", () => {
    const packet = buildFlowPacket({
      features: {
        total_premium: 45_000
      }
    });

    const result = scoreAlert(packet, []);
    expect(result.score).toBe(45);
    expect(result.severity).toBe("medium");
  });

  it("classifies >=80 as high", () => {
    const packet = buildFlowPacket({
      features: {
        total_premium: 65_000
      }
    });

    const result = scoreAlert(packet, [hit(0.5)]);
    expect(result.score).toBe(80);
    expect(result.severity).toBe("high");
  });

  it("keeps 79 as medium", () => {
    const packet = buildFlowPacket({
      features: {
        total_premium: 64_000
      }
    });

    const result = scoreAlert(packet, [hit(0.5)]);
    expect(result.score).toBe(79);
    expect(result.severity).toBe("medium");
  });
});
