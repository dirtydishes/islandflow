import { describe, expect, it } from "bun:test";
import {
  FlowHypothesisTypeSchema,
  type FlowHypothesisType,
  type SmartMoneyDirection
} from "@islandflow/types";

import {
  getSmartFlowEvidenceQualityBand,
  getSmartFlowPolicyConfidenceBand,
  getSmartFlowSummary,
  getSmartFlowTint,
  type SmartFlowTintInput,
  type SmartFlowTintDirection,
  type SmartFlowTintTone
} from "./tinting";

const CURRENT_SMART_FLOW_HYPOTHESIS_TYPES = FlowHypothesisTypeSchema.options;

const makeSmartFlowTintInput = ({
  abstained = false,
  direction = "bullish",
  evidenceQuality = 0.64,
  hypothesisType = "directional_accumulation",
  policyConfidence = 0.74,
  reasons,
  sourceReasons = []
}: {
  abstained?: boolean;
  direction?: SmartMoneyDirection;
  evidenceQuality?: number;
  hypothesisType?: FlowHypothesisType;
  policyConfidence?: number;
  reasons?: SmartFlowTintInput["abstention"]["reasons"];
  sourceReasons?: SmartFlowTintInput["abstention"]["source_reasons"];
} = {}): SmartFlowTintInput => {
  const defaultReasons: SmartFlowTintInput["abstention"]["reasons"] = abstained
    ? ["below_policy_threshold"]
    : ["not_abstained"];

  return {
    hypothesis: {
      hypothesis_type: hypothesisType,
      direction,
      scores: {
        confidence: {
          policy_confidence: policyConfidence,
          evidence_quality: evidenceQuality
        }
      }
    },
    evidence: {
      evidence_quality: evidenceQuality
    },
    abstention: {
      abstained,
      reasons: reasons ?? defaultReasons,
      source_reasons: sourceReasons
    }
  };
};

describe("smart-flow tinting", () => {
  it("covers every current smart-flow hypothesis type", () => {
    for (const hypothesisType of CURRENT_SMART_FLOW_HYPOTHESIS_TYPES) {
      const tint = getSmartFlowTint(makeSmartFlowTintInput({ hypothesisType }));

      expect(tint.metadata.hypothesisType).toBe(hypothesisType);
      expect(tint.metadata.family).toBe(hypothesisType);
    }
  });

  it("maps smart-flow hypothesis types into semantic row hues", () => {
    const cases: [FlowHypothesisType, SmartFlowTintTone][] = [
      ["directional_accumulation", "green"],
      ["retail_attention_flow", "teal"],
      ["event_positioning", "blue"],
      ["volatility_supply", "copper"],
      ["structure_arbitrage", "violet"],
      ["hedge_rebalance", "cyan"],
      ["unclear", "neutral"]
    ];

    for (const [hypothesisType, expectedTone] of cases) {
      const tint = getSmartFlowTint(makeSmartFlowTintInput({ hypothesisType }));

      expect(tint.metadata.hypothesisType).toBe(hypothesisType);
      expect(tint.metadata.tone).toBe(expectedTone);
    }
  });

  it("maps direction states into tint metadata", () => {
    const cases: [SmartMoneyDirection, SmartFlowTintDirection][] = [
      ["bullish", "bullish"],
      ["bearish", "bearish"],
      ["neutral", "neutral"],
      ["mixed", "mixed"],
      ["unknown", "unknown"]
    ];

    for (const [inputDirection, expectedDirection] of cases) {
      const tint = getSmartFlowTint(makeSmartFlowTintInput({ direction: inputDirection }));

      expect(tint.metadata.direction).toBe(expectedDirection);
    }
  });

  it("bands policy confidence at shared smart-flow thresholds", () => {
    expect(getSmartFlowPolicyConfidenceBand(0.12)).toBe("low");
    expect(getSmartFlowPolicyConfidenceBand(0.52)).toBe("medium");
    expect(getSmartFlowPolicyConfidenceBand(0.72)).toBe("high");

    expect(
      getSmartFlowTint(makeSmartFlowTintInput({ policyConfidence: 0.12 })).metadata
    ).toMatchObject({
      policyConfidence: 0.12,
      confidenceBand: "low"
    });
    expect(
      getSmartFlowTint(makeSmartFlowTintInput({ policyConfidence: 0.52 })).metadata
    ).toMatchObject({
      policyConfidence: 0.52,
      confidenceBand: "medium"
    });
    expect(
      getSmartFlowTint(makeSmartFlowTintInput({ policyConfidence: 0.72 })).metadata
    ).toMatchObject({
      policyConfidence: 0.72,
      confidenceBand: "high"
    });
  });

  it("bands evidence quality for poor, thin, usable, and strong rows", () => {
    expect(getSmartFlowEvidenceQualityBand(0)).toBe("poor");
    expect(getSmartFlowEvidenceQualityBand(0.1)).toBe("thin");
    expect(getSmartFlowEvidenceQualityBand(0.55)).toBe("usable");
    expect(getSmartFlowEvidenceQualityBand(0.82)).toBe("strong");

    expect(getSmartFlowTint(makeSmartFlowTintInput({ evidenceQuality: 0 })).metadata).toMatchObject(
      {
        evidenceQuality: 0,
        evidenceQualityBand: "poor"
      }
    );
    expect(
      getSmartFlowTint(makeSmartFlowTintInput({ evidenceQuality: 0.1 })).metadata
    ).toMatchObject({
      evidenceQuality: 0.1,
      evidenceQualityBand: "thin"
    });
    expect(
      getSmartFlowTint(makeSmartFlowTintInput({ evidenceQuality: 0.55 })).metadata
    ).toMatchObject({
      evidenceQuality: 0.55,
      evidenceQualityBand: "usable"
    });
    expect(
      getSmartFlowTint(makeSmartFlowTintInput({ evidenceQuality: 0.82 })).metadata
    ).toMatchObject({
      evidenceQuality: 0.82,
      evidenceQualityBand: "strong"
    });
  });

  it("uses low-intensity neutral tinting and source reasons for abstention", () => {
    const tint = getSmartFlowTint(
      makeSmartFlowTintInput({
        abstained: true,
        direction: "bullish",
        evidenceQuality: 0.92,
        policyConfidence: 0.9,
        reasons: ["below_policy_threshold", "not_abstained"],
        sourceReasons: ["policy confidence below threshold"]
      })
    );

    expect(tint.metadata.abstained).toBe(true);
    expect(tint.metadata.direction).toBe("abstained");
    expect(tint.metadata.tone).toBe("neutral");
    expect(tint.metadata.abstentionReasons).toEqual(["below_policy_threshold"]);
    expect(tint.metadata.sourceReasons).toEqual(["policy confidence below threshold"]);
    expect(tint.metadata.intensity).toBeLessThanOrEqual(0.36);
    expect((tint.style as Record<string, string>)["--classifier-intensity"]).toBe("0.360");
  });

  it("summarizes smart-flow context for hover and scope labels", () => {
    const summary = getSmartFlowSummary(
      makeSmartFlowTintInput({
        abstained: true,
        policyConfidence: 0.81,
        sourceReasons: ["policy confidence below threshold"]
      })
    );

    expect(summary).toEqual({
      hypothesis: "Directional accumulation",
      direction: "abstained",
      confidence: "81% high",
      evidenceQuality: "64% usable",
      abstention: "abstained: Policy Confidence Below Threshold"
    });
  });
});
