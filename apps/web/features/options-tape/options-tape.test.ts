import { describe, expect, it } from "bun:test";
import {
  type DurableTapeSmartFlowSupport,
  type FlowHypothesisType,
  type FlowPacket,
  type OptionPrint,
  type SmartFlowDirection,
  type SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { createDurableTapeInitialHistoryCursor } from "../durable-tape/history";
import { getDurableOptionRowTint } from "../durable-tape/row-view-models";
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
  buildOptionsTapeSupportRequest,
  createOptionsTapeSupportHydratingSource
} from "./support-hydration";
import {
  getOptionsTapeRowTintClassName,
  getOptionsTapeRowTintFromContext,
  getOptionsTapeRowTintStyle,
  getOptionsTapeSmartFlowContextFromSupport,
  getOptionsTapeSmartFlowRowTint,
  getOptionsTapeSmartFlowSummary,
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

  it("serializes packet scope query params with a pinned clicked trace", () => {
    const params = getOptionsTapeQueryParams(
      {
        packetId: "flowpacket:1",
        selectedTraceId: "member-2",
        optionContractId: "SPY-2026-06-22-555-C"
      },
      undefined,
      25
    );

    expect(params.get("limit")).toBe("25");
    expect(params.get("flow_packet_id")).toBe("flowpacket:1");
    expect(params.get("pinned_trace_id")).toBe("member-2");
    expect(params.get("option_contract_id")).toBe("SPY-2026-06-22-555-C");
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

  it("loads packet scope rows from API and places the clicked print first", async () => {
    const packet = makeFlowPacket({ members: ["clicked", "member-2"] });
    const requestedUrls: string[] = [];
    const hydratedPackets: Array<FlowPacket | null> = [];
    const page = await loadOptionsTapeHistoryPage({
      cursor: { ts: 2_000, seq: 2 },
      scope: {
        packetId: "flowpacket:1",
        selectedTraceId: "clicked",
        optionContractId: "SPY-2026-06-22-555-C"
      },
      options: {
        apiBaseUrl: "https://api.example.test",
        historyPageSize: 30,
        onPacketHydrated: (hydratedPacket) => hydratedPackets.push(hydratedPacket),
        fetcher: async (url) => {
          requestedUrls.push(url.toString());
          return Response.json({
            packet,
            pinned: makePrint({ trace_id: "clicked", seq: 7 }),
            data: [
              makePrint({
                trace_id: "member-2",
                seq: 8,
                option_contract_id: "SPY-2026-06-22-560-C"
              }),
              makePrint({ trace_id: "clicked", seq: 7 })
            ],
            next_before: { ts: 1_000, seq: 7 }
          });
        }
      }
    });

    expect(requestedUrls[0]).toContain("flow_packet_id=flowpacket%3A1");
    expect(requestedUrls[0]).toContain("pinned_trace_id=clicked");
    expect(page.items.map((print) => print.trace_id)).toEqual(["clicked", "member-2"]);
    expect(page.nextCursor).toEqual({ ts: 1_000, seq: 7 });
    expect(hydratedPackets[0]?.id).toBe("flowpacket:1");
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
      packetId: "flowpacket:1",
      optionContractId: "SPY-2026-06-22-555-C",
      packetMemberTraceIds: ["member-1", "member-2"]
    };
    const contractScope = { optionContractId: "SPY-2026-06-22-555-C" };
    const prints = [
      makePrint({ trace_id: "member-1", nbbo_side: "B", signal_pass: false }),
      makePrint({
        trace_id: "member-2",
        nbbo_side: "BB",
        option_contract_id: "SPY-2026-06-22-560-C",
        signal_pass: false
      }),
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
    ).toEqual([prints[0], prints[2]]);
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
    direction?: SmartFlowDirection;
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
        policy_version: "smart-flow.policy.v1",
        model_version: "smart-flow.model.rules.v1",
        event_id: `event:${seq}`,
        hypothesis_id: `hypothesis:${seq}`,
        cluster_id: `cluster:${seq}`,
        candidate_ids: [`candidate:${seq}`],
        underlying_id: "SPY",
        hypothesis_type: hypothesisType,
        direction,
        scores: {
          schema_version: "smart-flow.contracts.v1",
          policy_version: "smart-flow.policy.v1",
          model_version: "smart-flow.model.rules.v1",
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
        policy_version: "smart-flow.policy.v1",
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
        policy: "smart-flow.policy.v1",
        model: "smart-flow.model.rules.v1"
      },
      projection_version: "smart-flow.explainability-projection.v1",
      policy_version: "smart-flow.policy.v1",
      model_version: "smart-flow.model.rules.v1",
      schema_version: "smart-flow.contracts.v1"
    }) as SmartFlowExplainabilityProjection;

  const makeDurableSmartFlowSupport = (
    projection: SmartFlowExplainabilityProjection,
    overrides: Partial<DurableTapeSmartFlowSupport> = {}
  ): DurableTapeSmartFlowSupport => {
    const evidenceRefs = projection.refs.evidence_refs;
    const packetRefs = evidenceRefs.filter((ref) => ref.startsWith("flowpacket:"));
    const optionPrintRefs = evidenceRefs.filter((ref) => !ref.startsWith("flowpacket:"));
    return {
      status: "matched",
      source_channel: "smart-flow",
      projection_id: projection.refs.event_id,
      projection_trace_id: projection.trace_id,
      packet_id: packetRefs[0] ?? null,
      match_source: packetRefs.length > 0 ? "packet_member" : "direct_print",
      tint_eligible:
        !projection.abstention.abstained && projection.hypothesis.hypothesis_type !== "unclear",
      hypothesis_type: projection.hypothesis.hypothesis_type,
      direction: projection.hypothesis.direction,
      confidence: projection.hypothesis.scores.confidence.policy_confidence,
      evidence_quality: projection.hypothesis.scores.confidence.evidence_quality,
      abstained: projection.abstention.abstained,
      refs: {
        evidence_refs: evidenceRefs,
        packet_refs: packetRefs,
        option_print_refs: optionPrintRefs
      },
      counts: {
        evidence_refs: evidenceRefs.length,
        flow_packets: packetRefs.length,
        option_prints: optionPrintRefs.length
      },
      ...overrides
    };
  };

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
    direction?: SmartFlowDirection;
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

  it("wraps eligible shared smart-flow tinting in stable options-tape row classes", () => {
    const tint = getOptionsTapeSmartFlowRowTint(
      makeSmartFlowTintInput({
        direction: "bullish",
        evidenceQuality: 0.92,
        policyConfidence: 0.9
      })
    );

    expect(tint?.metadata.abstained).toBe(false);
    expect(tint?.metadata.direction).toBe("bullish");
    expect(tint?.metadata.tone).toBe("green");
    expect(tint?.metadata.source).toBe("smart-flow");
    expect(tint?.className).toContain("options-tape-row-confidence-high");
    expect(tint?.className).toContain("options-tape-row-evidence-strong");
    expect(tint?.className).toContain("smart-flow-tone-green");
  });

  it("maps compact direct smart-flow support to row context and tint", () => {
    const projection = makeSmartFlowProjection({ refs: ["print-1"] });
    const support = makeDurableSmartFlowSupport(projection);
    const context = getOptionsTapeSmartFlowContextFromSupport({
      optionTraceId: "print-1",
      supportResolution: {
        packet: null,
        smart_flow_status: "matched",
        smart_flow: support
      }
    });
    const tint = getOptionsTapeRowTintFromContext({
      smartFlow: context
    });

    expect(context?.source).toBe("direct-print");
    expect(context?.directPrintRefs).toEqual(["print-1"]);
    expect(tint?.metadata.source).toBe("smart-flow");
    expect(tint?.metadata.hypothesisType).toBe("directional_accumulation");
    expect(tint?.className).toContain("options-tape-smart-flow-row");
  });

  it("maps compact packet-member support without projection reconstruction", () => {
    const packet = makeFlowPacket({
      id: "flowpacket:1",
      trace_id: "flowpacket:trace:1",
      members: ["member-1", "member-2"]
    });
    const projection = makeSmartFlowProjection({ refs: ["flowpacket:1"] });
    const support = makeDurableSmartFlowSupport(projection);
    const context = getOptionsTapeSmartFlowContextFromSupport({
      optionTraceId: "member-2",
      supportResolution: {
        packet,
        smart_flow_status: "matched",
        smart_flow: support
      }
    });

    expect(context?.source).toBe("packet-member");
    expect(context?.packetRefs).toEqual(["flowpacket:1"]);
    expect(context?.expandedPacketRefs).toEqual(["member-1", "member-2"]);
    expect(getOptionsTapeRowTintFromContext({ smartFlow: context })?.className).toContain(
      "options-tape-smart-flow-row"
    );
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
      smartFlowSupportByTraceId: new Map(),
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
    const projection = makeSmartFlowProjection({
      refs: ["flowpacket:history", "older-history"]
    });
    const support = makeDurableSmartFlowSupport(projection);
    const context = getOptionsTapeSmartFlowContextFromSupport({
      optionTraceId: "older-history",
      supportResolution: {
        packet,
        smart_flow_status: "matched",
        smart_flow: support
      }
    });
    const tint = getOptionsTapeRowTintFromContext({
      smartFlow: context
    });

    expect(tint?.metadata.source).toBe("smart-flow");
    expect(tint?.className).toContain("options-tape-smart-flow-row");
  });

  it("uses the same smart-flow tint helper for durable option rows", () => {
    const projection = makeSmartFlowProjection({ refs: ["flowpacket:durable"] });
    const support = makeDurableSmartFlowSupport(projection);
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
          member_trace_ids: [],
          member_count: 250
        },
        smart_flow_status: "matched",
        smart_flow: support
      }
    } as never;

    const durableTint = getDurableOptionRowTint(row);
    const canonicalTint = getOptionsTapeSmartFlowRowTint(projection);

    expect(canonicalTint).toBeDefined();
    expect(durableTint?.metadata).toEqual(canonicalTint?.metadata);
    expect(durableTint?.className).toBe(canonicalTint?.className);
    expect(durableTint?.style).toEqual(canonicalTint?.style);
  });

  it("keeps abstained and unclear support as context without row tint", () => {
    const abstained = makeDurableSmartFlowSupport(
      makeSmartFlowProjection({ abstained: true, refs: ["print-1"] })
    );
    const unclear = makeDurableSmartFlowSupport(
      makeSmartFlowProjection({ hypothesisType: "unclear", refs: ["print-2"] })
    );
    const abstainedContext = getOptionsTapeSmartFlowContextFromSupport({
      optionTraceId: "print-1",
      smartFlow: abstained
    });
    const unclearContext = getOptionsTapeSmartFlowContextFromSupport({
      optionTraceId: "print-2",
      smartFlow: unclear
    });

    expect(abstainedContext).toBeDefined();
    expect(unclearContext).toBeDefined();
    expect(
      abstainedContext && getOptionsTapeSmartFlowSummary(abstainedContext.projection).direction
    ).toBe("abstained");
    expect(unclearContext?.projection.hypothesis.hypothesis_type).toBe("unclear");
    expect(getOptionsTapeRowTintFromContext({ smartFlow: abstainedContext })).toBeUndefined();
    expect(getOptionsTapeRowTintFromContext({ smartFlow: unclearContext })).toBeUndefined();
  });

  it("does not tint durable option rows when compact support is not tint eligible", () => {
    const projection = makeSmartFlowProjection({
      hypothesisType: "unclear",
      refs: ["flowpacket:durable"]
    });
    const support = makeDurableSmartFlowSupport(projection, { tint_eligible: false });
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
          member_trace_ids: [],
          member_count: 250
        },
        smart_flow_status: "matched",
        smart_flow: support
      }
    } as never;

    expect(getDurableOptionRowTint(row)).toBeUndefined();
  });
});
