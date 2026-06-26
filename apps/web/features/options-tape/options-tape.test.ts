import { describe, expect, it } from "bun:test";
import {
  type FlowPacket,
  type FlowHypothesisType,
  type OptionPrint,
  type SmartFlowExplainabilityProjection,
  type SmartMoneyDirection
} from "@islandflow/types";

import { getDurableOptionRowTint } from "../durable-tape/row-view-models";
import { createDurableTapeInitialHistoryCursor } from "../durable-tape/history";
import { selectDurableTapeTemplate } from "../durable-tape/templates";
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
  buildOptionsTapeSupportPacketMaps,
  buildOptionsTapeSupportRequest,
  createOptionsTapeSupportHydratingSource
} from "./support-hydration";
import {
  buildOptionsTapeSmartFlowContextByTraceId,
  getOptionsTapeRowTintFromContext,
  getOptionsTapeRowTintClassName,
  getOptionsTapeRowTintStyle,
  getOptionsTapeSmartFlowSummary,
  getOptionsTapeSmartFlowRowTint,
  type OptionsTapeSmartFlowTintInput
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

  it("wraps shared smart-flow tinting in stable options-tape row classes", () => {
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
    expect(tint.metadata.source).toBe("smart-flow");
    expect(tint.className).toContain("options-tape-row-abstained");
    expect(tint.className).toContain("options-tape-row-confidence-high");
    expect(tint.className).toContain("options-tape-row-evidence-strong");
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

  it("maps smart-flow row tinting from canonical context", () => {
    const projection = makeSmartFlowProjection();
    const tint = getOptionsTapeRowTintFromContext({
      smartFlow: {
        projection,
        source: "direct-print",
        evidenceRefs: ["print-1"],
        directPrintRefs: ["print-1"],
        packetRefs: [],
        expandedPacketRefs: []
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

  it("does not tint rows without canonical smart-flow context", () => {
    const tint = getOptionsTapeRowTintFromContext({});

    expect(getOptionsTapeRowTintClassName(tint)).toBeUndefined();
    expect(getOptionsTapeRowTintStyle(tint)).toBeUndefined();
  });

  it("requests support for loaded history rows and maps hydrated smart-flow into tint context", async () => {
    const historyPrint = makePrint({
      trace_id: "older-history",
      execution_nbbo_side: undefined,
      nbbo_side: undefined
    });
    const hydratedRows: string[][] = [];
    const source = createOptionsTapeSupportHydratingSource(
      {
        subscribe: () => ({
          getSnapshot: () => [],
          unsubscribe: () => {}
        }),
        loadOlder: async () => ({
          items: [historyPrint],
          nextCursor: null,
          exhausted: true
        })
      },
      (rows) => hydratedRows.push(rows.map((row) => row.trace_id))
    );

    const page = await source.loadOlder({ ts: 2_000, seq: 2 }, {});
    expect(page.items.map((row) => row.trace_id)).toEqual(["older-history"]);
    expect(hydratedRows).toEqual([["older-history"]]);

    const request = buildOptionsTapeSupportRequest(page.items, {
      smartFlowContextByTraceId: new Map(),
      nbboByTraceId: new Map()
    });
    expect(request.traceIds).toEqual(["older-history"]);
    expect(request.nbboContext).toEqual([
      {
        trace_id: "older-history",
        option_contract_id: "SPY-2026-06-22-555-C",
        ts: 1_000
      }
    ]);

    const packet = makeFlowPacket({ id: "flowpacket:history", members: ["older-history"] });
    const packetMaps = buildOptionsTapeSupportPacketMaps([packet]);
    const projection = makeSmartFlowProjection({
      refs: ["flowpacket:history", "older-history"]
    });
    const contexts = buildOptionsTapeSmartFlowContextByTraceId({
      projections: [projection],
      flowPacketById: packetMaps.flowPacketById,
      flowPacketByTraceId: packetMaps.flowPacketByTraceId
    });
    const tint = getOptionsTapeRowTintFromContext({
      smartFlow: contexts.get("older-history")
    });

    expect(tint?.metadata.source).toBe("smart-flow");
    expect(tint?.className).toContain("options-tape-smart-flow-row");
  });

  it("uses the same smart-flow tint helper for durable option rows", () => {
    const projection = makeSmartFlowProjection({
      refs: ["flowpacket:durable", "durable-print"]
    });
    const row = {
      id: "options:durable-print:1",
      lane: "options",
      source: "server",
      ts: 1_000,
      seq: 1,
      source_ts: 1_000,
      ingest_ts: 1_001,
      cells: {},
      badges: [],
      option: {
        trace_id: "durable-print",
        option_contract_id: "SPY-2026-06-22-555-C",
        price: 1.25,
        size: 100,
        premium: 12_500,
        side: "A",
        exchange: "CBOE",
        nbbo: null
      },
      support: {
        packet: {
          id: "flowpacket:durable",
          member_trace_ids: ["durable-print"],
          member_count: 1
        },
        classifier: null,
        smart_money: null,
        smart_flow: projection
      }
    } as never;

    const durableTint = getDurableOptionRowTint(row);
    const canonicalTint = getOptionsTapeSmartFlowRowTint(projection);

    expect(durableTint?.metadata).toEqual(canonicalTint.metadata);
    expect(durableTint?.className).toBe(canonicalTint.className);
    expect(durableTint?.style).toEqual(canonicalTint.style);
  });
});
