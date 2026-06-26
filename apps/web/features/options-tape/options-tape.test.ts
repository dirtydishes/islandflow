import { describe, expect, it } from "bun:test";
import {
  type FlowPacket,
  type FlowHypothesisType,
  FlowHypothesisTypeSchema,
  type OptionPrint,
  type SmartFlowExplainabilityProjection,
  type SmartMoneyDirection
} from "@islandflow/types";

import { createDurableTapeInitialHistoryCursor, selectDurableTapeTemplate } from "../durable-tape";
import {
  formatOptionsTapeContractLabel,
  formatOptionsTapeDteLabel,
  getOptionsTapePrintCursor,
  getOptionsTapePrintKey,
  loadOptionsTapeHistoryPage
} from ".";
import { OPTIONS_TAPE_COLUMNS, OPTIONS_TAPE_TEMPLATES_BY_MODE } from "./columns";
import {
  applyOptionsTapeSecurityPreset,
  applyOptionsTapeSidePreset,
  applyOptionsTapeTypePreset,
  buildDefaultOptionsTapeFilters,
  filterOptionsTapePrints,
  getOptionsTapeQueryParams,
  getOptionsTapeScopeFilters,
  getOptionsTapeSidePreset
} from "./filters";
import {
  buildOptionsTapeSmartFlowContextByTraceId,
  getOptionsTapeDecorRowTint,
  getOptionsTapeEvidenceQualityBand,
  getOptionsTapePolicyConfidenceBand,
  getOptionsTapeRowTintFromContext,
  getOptionsTapeRowTintClassName,
  getOptionsTapeRowTintStyle,
  getOptionsTapeSmartFlowSummary,
  getOptionsTapeSmartFlowRowTint,
  type OptionsTapeSmartFlowTintInput,
  type OptionsTapeTintDirection,
  type OptionsTapeTintTone
} from "./tinting";

const makePrint = (overrides: Partial<OptionPrint> = {}): OptionPrint => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: "print-1",
  ts: 1_000,
  option_contract_id: "SPY-2026-06-22-555-C",
  price: 1.25,
  size: 100,
  exchange: "CBOE",
  option_type: "call",
  nbbo_side: "A",
  notional: 12_500,
  signal_pass: true,
  signal_profile: "balanced",
  is_etf: false,
  ...overrides
});

describe("options tape helpers", () => {
  it("formats primary contract labels for 0DTE and dated expiries", () => {
    const now = new Date("2026-06-22T13:30:00").getTime();
    expect(formatOptionsTapeContractLabel("SPY-2026-06-22-555-C", now)).toBe("SPY 0DTE 555C");
    expect(formatOptionsTapeContractLabel("NVDA-2026-06-28-145-P", now)).toBe("NVDA 6/28 145P");
    expect(formatOptionsTapeDteLabel("NVDA-2026-06-28-145-P", now)).toBe("6D");
  });

  it("exports durable row key and cursor accessors", () => {
    const print = makePrint({ trace_id: "abc", ts: 10, seq: 3 });
    expect(getOptionsTapePrintKey(print)).toBe("abc:3");
    expect(getOptionsTapePrintCursor(print)).toEqual({ ts: 10, seq: 3 });
  });

  it("keeps no-horizontal-scroll templates small by state", () => {
    expect(OPTIONS_TAPE_TEMPLATES_BY_MODE.global[0]?.columns).toEqual([
      "time",
      "contract",
      "price",
      "size",
      "premium",
      "side",
      "iv"
    ]);
    expect(OPTIONS_TAPE_TEMPLATES_BY_MODE.packet[0]?.columns).toEqual([
      "dte",
      "time",
      "price",
      "size",
      "premium",
      "side",
      "spot"
    ]);
    expect(OPTIONS_TAPE_TEMPLATES_BY_MODE.contract[0]?.columns).toEqual([
      "time",
      "price",
      "size",
      "premium",
      "nbbo",
      "side",
      "exchange",
      "iv"
    ]);
  });

  it("steps down templates for narrow containers", () => {
    const globalSelection = selectDurableTapeTemplate({
      columns: OPTIONS_TAPE_COLUMNS,
      templates: OPTIONS_TAPE_TEMPLATES_BY_MODE.global,
      containerWidth: 330,
      requestedTemplate: "auto"
    });
    expect(globalSelection.template.id).toBe("oneThird");
    expect(globalSelection.columns.map((column) => column.id)).toEqual([
      "contract",
      "premium",
      "side"
    ]);

    const packetSelection = selectDurableTapeTemplate({
      columns: OPTIONS_TAPE_COLUMNS,
      templates: OPTIONS_TAPE_TEMPLATES_BY_MODE.packet,
      containerWidth: 200,
      requestedTemplate: "auto"
    });
    expect(packetSelection.template.id).toBe("micro");
    expect(packetSelection.columns.map((column) => column.id)).toEqual(["premium", "side"]);
  });

  it("applies settings presets without changing default signal semantics", () => {
    const defaults = buildDefaultOptionsTapeFilters();
    expect(defaults).toEqual({
      view: "signal",
      securityTypes: ["stock"],
      nbboSides: ["AA", "A", "MID"],
      optionTypes: ["call", "put"]
    });
    expect(getOptionsTapeSidePreset(defaults)).toBe("default");
    expect(getOptionsTapeSidePreset(applyOptionsTapeSidePreset(defaults, "bb"))).toBe("bb");
    expect(applyOptionsTapeTypePreset(defaults, "calls").optionTypes).toEqual(["call"]);
    expect(applyOptionsTapeSecurityPreset(defaults, "all").securityTypes).toEqual(["stock", "etf"]);
  });

  it("serializes filter and scope query params for option history", () => {
    const params = getOptionsTapeQueryParams(
      { optionContractId: "SPY-2026-06-22-555-C", underlyingIds: ["SPY"] },
      { ...buildDefaultOptionsTapeFilters(), minNotional: 25_000 },
      50
    );
    expect(params.toString()).toBe(
      "limit=50&view=signal&security=stock&side=AA%2CA%2CMID&type=call%2Cput&min_notional=25000&underlying_ids=SPY&option_contract_id=SPY-2026-06-22-555-C"
    );
  });

  it("filters history pages to packet member trace ids", async () => {
    const requestedUrls: string[] = [];
    const page = await loadOptionsTapeHistoryPage({
      cursor: { ts: 2_000, seq: 2 },
      scope: {
        optionContractId: "SPY-2026-06-22-555-C",
        packetMemberTraceIds: ["member-2"]
      },
      filters: buildDefaultOptionsTapeFilters(),
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher: async (url) => {
          requestedUrls.push(url.toString());
          return Response.json({
            data: [
              makePrint({ trace_id: "member-1", seq: 1 }),
              makePrint({ trace_id: "member-2", seq: 2 })
            ],
            next_before: null
          });
        }
      }
    });

    expect(requestedUrls[0]).toContain("/history/options?");
    expect(page.items.map((print) => print.trace_id)).toEqual(["member-2"]);
    expect(page.exhausted).toBe(true);
  });

  it("can seed filtered history from an empty live head cursor", async () => {
    const requestedUrls: string[] = [];
    const page = await loadOptionsTapeHistoryPage({
      cursor: createDurableTapeInitialHistoryCursor(2_500),
      filters: { ...buildDefaultOptionsTapeFilters(), minNotional: 10_000 },
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher: async (url) => {
          requestedUrls.push(url.toString());
          return Response.json({
            data: [makePrint({ trace_id: "older-match", seq: 7, ts: 2_000, notional: 50_000 })],
            next_before: { ts: 2_000, seq: 7 }
          });
        }
      }
    });

    expect(requestedUrls[0]).toContain("before_ts=2500");
    expect(requestedUrls[0]).toContain(`before_seq=${Number.MAX_SAFE_INTEGER}`);
    expect(requestedUrls[0]).toContain("min_notional=10000");
    expect(page.items.map((print) => print.trace_id)).toEqual(["older-match"]);
    expect(page.exhausted).toBe(false);
  });

  it("keeps broad filters out of packet and contract scopes", () => {
    const filters = { ...buildDefaultOptionsTapeFilters(), nbboSides: ["AA" as const] };
    const packetScope = {
      optionContractId: "SPY-2026-06-22-555-C",
      packetMemberTraceIds: ["member-1", "member-2"]
    };
    const contractScope = { optionContractId: "SPY-2026-06-22-555-C" };
    const prints = [
      makePrint({ trace_id: "member-1", nbbo_side: "B", signal_pass: false }),
      makePrint({ trace_id: "member-2", nbbo_side: "BB", signal_pass: false }),
      makePrint({ trace_id: "other", nbbo_side: "AA" })
    ];

    expect(getOptionsTapeScopeFilters(undefined, filters)).toBe(filters);
    expect(getOptionsTapeScopeFilters(packetScope, filters)).toBeUndefined();
    expect(getOptionsTapeScopeFilters(contractScope, filters)).toBeUndefined();
    expect(
      filterOptionsTapePrints(prints, packetScope, getOptionsTapeScopeFilters(packetScope, filters))
    ).toEqual([prints[0], prints[1]]);
    expect(
      filterOptionsTapePrints(
        prints,
        contractScope,
        getOptionsTapeScopeFilters(contractScope, filters)
      )
    ).toEqual(prints);
  });
});

describe("options tape row tint helpers", () => {
  const makeFlowPacket = (overrides: Partial<FlowPacket> = {}): FlowPacket =>
    ({
      source_ts: 1_000,
      ingest_ts: 1_001,
      seq: 1,
      trace_id: "flowpacket:trace:1",
      id: "flowpacket:1",
      members: ["member-1", "member-2"],
      features: { option_contract_id: "SPY-2026-06-22-555-C" },
      join_quality: {},
      ...overrides
    }) as FlowPacket;

  const makeSmartFlowProjection = ({
    abstained = false,
    direction = "bullish",
    evidenceQuality = 0.64,
    hypothesisType = "directional_accumulation",
    policyConfidence = 0.74,
    refs = ["print-1"],
    sourceReasons = [],
    sourceTs = 1_000,
    seq = 1
  }: {
    abstained?: boolean;
    direction?: SmartMoneyDirection;
    evidenceQuality?: number;
    hypothesisType?: FlowHypothesisType;
    policyConfidence?: number;
    refs?: string[];
    sourceReasons?: string[];
    sourceTs?: number;
    seq?: number;
  } = {}): SmartFlowExplainabilityProjection =>
    ({
      source_ts: sourceTs,
      ingest_ts: sourceTs + 1,
      seq,
      trace_id: `smart-flow:${seq}`,
      source_channel: "smart-flow",
      refs: {
        trace_id: `smart-flow:${seq}`,
        event_id: `event:${seq}`,
        hypothesis_id: `hypothesis:${seq}`,
        insight_id: `insight:${seq}`,
        cluster_id: `cluster:${seq}`,
        candidate_ids: [`candidate:${seq}`],
        evidence_refs: refs
      },
      evidence: {
        evidence_refs: refs,
        evidence_quality: evidenceQuality,
        penalties: []
      },
      hypothesis: {
        source_ts: sourceTs,
        ingest_ts: sourceTs + 1,
        seq,
        trace_id: `hypothesis:${seq}`,
        schema_version: "smart-flow.contracts.v1",
        policy_version: "smart-flow.policy.compat.v1",
        model_version: "smart-flow.model.unscored.v1",
        event_id: `event:${seq}`,
        hypothesis_id: `hypothesis:${seq}`,
        cluster_id: `cluster:${seq}`,
        candidate_ids: [`candidate:${seq}`],
        underlying_id: "SPY",
        hypothesis_type: hypothesisType,
        direction,
        scores: {
          schema_version: "smart-flow.contracts.v1",
          policy_version: "smart-flow.policy.compat.v1",
          model_version: "smart-flow.model.unscored.v1",
          hypothesis_type: hypothesisType,
          direction,
          evidence_strength: evidenceQuality,
          fit_score: policyConfidence,
          penalty_score: 0,
          penalties: [],
          confidence: {
            policy_confidence: policyConfidence,
            evidence_quality: evidenceQuality,
            hypothesis_margin: 0.2,
            conviction: policyConfidence,
            calibration_version: null
          }
        },
        alternatives: [],
        abstention: {
          abstained,
          reasons: abstained ? ["below_policy_threshold"] : ["not_abstained"],
          source_reasons: sourceReasons
        },
        evidence_refs: refs,
        generated_from: "flow_evidence_cluster"
      },
      insight: {
        schema_version: "smart-flow.contracts.v1",
        policy_version: "smart-flow.policy.compat.v1",
        insight_id: `insight:${seq}`,
        hypothesis_id: `hypothesis:${seq}`,
        underlying_id: "SPY",
        label: "Directional accumulation hypothesis",
        summary: "Evidence-backed directional flow.",
        direction,
        confidence_band: "high",
        confidence: policyConfidence,
        evidence_refs: refs,
        abstention: {
          abstained,
          reasons: abstained ? ["below_policy_threshold"] : ["not_abstained"],
          source_reasons: sourceReasons
        },
        alternatives: []
      },
      abstention: {
        abstained,
        reasons: abstained ? ["below_policy_threshold"] : ["not_abstained"],
        source_reasons: sourceReasons
      },
      alternatives: [],
      versions: {
        contract: "smart-flow.contracts.v1",
        projection: "smart-flow.explainability-projection.v1",
        policy: "smart-flow.policy.compat.v1",
        model: "smart-flow.model.unscored.v1"
      },
      projection_version: "smart-flow.explainability-projection.v1",
      policy_version: "smart-flow.policy.compat.v1",
      model_version: "smart-flow.model.unscored.v1",
      schema_version: "smart-flow.contracts.v1"
    }) as SmartFlowExplainabilityProjection;

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
    reasons?: OptionsTapeSmartFlowTintInput["abstention"]["reasons"];
    sourceReasons?: OptionsTapeSmartFlowTintInput["abstention"]["source_reasons"];
  } = {}): OptionsTapeSmartFlowTintInput => {
    const defaultReasons: OptionsTapeSmartFlowTintInput["abstention"]["reasons"] = abstained
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

  it("maps every current smart-flow hypothesis type into row metadata and classes", () => {
    for (const hypothesisType of FlowHypothesisTypeSchema.options) {
      const tint = getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ hypothesisType }));
      const classToken = hypothesisType.replaceAll("_", "-");

      expect(tint.metadata.hypothesisType).toBe(hypothesisType);
      expect(tint.metadata.family).toBe(hypothesisType);
      expect(tint.className).toContain(`options-tape-row-hypothesis-${classToken}`);
      expect(tint.className).toContain("options-tape-smart-flow-row");
    }
  });

  it("maps smart-flow hypothesis types into semantic row hues", () => {
    const cases: [FlowHypothesisType, OptionsTapeTintTone][] = [
      ["directional_accumulation", "green"],
      ["retail_attention_flow", "teal"],
      ["event_positioning", "blue"],
      ["volatility_supply", "copper"],
      ["structure_arbitrage", "violet"],
      ["hedge_rebalance", "cyan"],
      ["unclear", "neutral"]
    ];

    for (const [hypothesisType, expectedTone] of cases) {
      const tint = getOptionsTapeSmartFlowRowTint(
        makeSmartFlowTintInput({ hypothesisType, direction: "bearish" })
      );

      expect(tint.metadata.hypothesisType).toBe(hypothesisType);
      expect(tint.metadata.tone).toBe(expectedTone);
      expect(tint.className).toContain(`classifier-${expectedTone}`);
      expect(tint.className).toContain("options-tape-row-direction-bearish");
    }
  });

  it("maps direction states into row metadata and modifier classes", () => {
    const cases: [SmartMoneyDirection, OptionsTapeTintDirection][] = [
      ["bullish", "bullish"],
      ["bearish", "bearish"],
      ["neutral", "neutral"],
      ["mixed", "mixed"],
      ["unknown", "unknown"]
    ];

    for (const [inputDirection, expectedDirection] of cases) {
      const tint = getOptionsTapeSmartFlowRowTint(
        makeSmartFlowTintInput({ direction: inputDirection })
      );

      expect(tint.metadata.direction).toBe(expectedDirection);
      expect(tint.className).toContain(`options-tape-row-direction-${expectedDirection}`);
    }
  });

  it("bands policy confidence at the current smart-flow thresholds", () => {
    expect(getOptionsTapePolicyConfidenceBand(0.12)).toBe("low");
    expect(getOptionsTapePolicyConfidenceBand(0.52)).toBe("medium");
    expect(getOptionsTapePolicyConfidenceBand(0.72)).toBe("high");

    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ policyConfidence: 0.12 })).className
    ).toContain("options-tape-row-confidence-low");
    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ policyConfidence: 0.52 })).className
    ).toContain("options-tape-row-confidence-medium");
    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ policyConfidence: 0.72 })).className
    ).toContain("options-tape-row-confidence-high");
  });

  it("bands evidence quality for poor, thin, usable, and strong rows", () => {
    expect(getOptionsTapeEvidenceQualityBand(0)).toBe("poor");
    expect(getOptionsTapeEvidenceQualityBand(0.1)).toBe("thin");
    expect(getOptionsTapeEvidenceQualityBand(0.55)).toBe("usable");
    expect(getOptionsTapeEvidenceQualityBand(0.82)).toBe("strong");

    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ evidenceQuality: 0 })).className
    ).toContain("options-tape-row-evidence-poor");
    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ evidenceQuality: 0.1 })).className
    ).toContain("options-tape-row-evidence-thin");
    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ evidenceQuality: 0.55 })).className
    ).toContain("options-tape-row-evidence-usable");
    expect(
      getOptionsTapeSmartFlowRowTint(makeSmartFlowTintInput({ evidenceQuality: 0.82 })).className
    ).toContain("options-tape-row-evidence-strong");
  });

  it("uses low-intensity neutral tinting and source reasons for abstention", () => {
    const tint = getOptionsTapeSmartFlowRowTint(
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
    expect(tint.className).toContain("options-tape-row-abstained");
    expect(tint.className).toContain("classifier-neutral");
  });

  it("maps smart-flow direct option-print refs and packet members to row contexts", () => {
    const packet = makeFlowPacket({
      id: "flowpacket:1",
      trace_id: "flowpacket:trace:1",
      members: ["member-1", "member-2"]
    });
    const projection = makeSmartFlowProjection({ refs: ["flowpacket:1", "direct-1"] });
    const contexts = buildOptionsTapeSmartFlowContextByTraceId({
      projections: [projection],
      flowPacketById: new Map([[packet.id, packet]])
    });

    expect(contexts.get("direct-1")?.source).toBe("direct-print");
    expect(contexts.get("direct-1")?.directPrintRefs).toEqual(["direct-1"]);
    expect(contexts.get("member-1")?.source).toBe("packet-member");
    expect(contexts.get("member-2")?.packetRefs).toEqual(["flowpacket:1"]);
    expect(contexts.get("member-2")?.expandedPacketRefs).toEqual(["member-1", "member-2"]);
  });

  it("keeps direct smart-flow evidence ahead of packet expansion for the same row", () => {
    const packet = makeFlowPacket({ id: "flowpacket:1", members: ["shared-print"] });
    const projection = makeSmartFlowProjection({ refs: ["flowpacket:1", "shared-print"] });
    const contexts = buildOptionsTapeSmartFlowContextByTraceId({
      projections: [projection],
      flowPacketById: new Map([[packet.id, packet]])
    });

    expect(contexts.get("shared-print")?.source).toBe("direct-print");
  });

  it("prefers smart-flow row tinting over legacy decor for the same print", () => {
    const projection = makeSmartFlowProjection();
    const tint = getOptionsTapeRowTintFromContext({
      smartFlow: {
        projection,
        source: "direct-print",
        evidenceRefs: ["print-1"],
        directPrintRefs: ["print-1"],
        packetRefs: [],
        expandedPacketRefs: []
      },
      decor: {
        family: "legacy",
        tone: "red",
        intensity: 1
      }
    });

    expect(tint?.metadata.source).toBe("smart-flow");
    expect(tint?.metadata.hypothesisType).toBe("directional_accumulation");
    expect(tint?.className).toContain("options-tape-smart-flow-row");
  });

  it("summarizes smart-flow context for hover and scope labels", () => {
    const summary = getOptionsTapeSmartFlowSummary(
      makeSmartFlowProjection({
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

  it("maps existing options decor into DurableTape row hook outputs", () => {
    const tint = getOptionsTapeDecorRowTint({
      family: "institutional_directional",
      tone: "green",
      intensity: 0.7
    });

    expect(getOptionsTapeRowTintClassName(tint)).toContain("options-tape-decor-row");
    expect(getOptionsTapeRowTintClassName(tint)).toContain("classifier-green");
    expect(
      (getOptionsTapeRowTintStyle(tint) as Record<string, string> | undefined)?.[
        "--classifier-intensity"
      ]
    ).toBe("0.700");
  });
});
