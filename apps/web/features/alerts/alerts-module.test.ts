import { describe, expect, it, mock } from "bun:test";
import {
  type FlowPacket,
  type OptionPrint,
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type SmartFlowAlertEvent,
  type SmartFlowExplainabilityProjection,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { selectDurableTapeTemplate } from "../durable-tape";
import { AlertDetail } from "./AlertsModule";
import { ALERTS_COLUMNS, ALERTS_TEMPLATES, renderAlertsRow } from "./columns";
import {
  buildAlertFlowPacketPath,
  buildAlertOptionPrintsPath,
  collectAlertContextEvidence,
  getAlertFlowPacketRefs,
  getAlertOptionPrintRefs,
  resolveAlertEvidence,
  resolveAlertFlowPacket
} from "./evidence";
import {
  getAlertConfidenceEvidenceLabel,
  getAlertCursor,
  getAlertKey,
  getAlertName,
  getAlertPrimaryOptionRef,
  getAlertPrimaryPacketRef,
  getAlertWindowAnchorTs,
  inferAlertUnderlying
} from "./format";
import {
  filterAlerts,
  loadAlertsHistoryPage,
  normalizeAlertsFilters,
  normalizeAlertsScope
} from "./source";
import {
  getSmartFlowAlertRowTint,
  getSmartFlowAlertRowTintClassName,
  getSmartFlowAlertRowTintStyle
} from "./tinting";
import type { AlertEvidenceHydration } from "./types";

const makeProjection = (
  overrides: Partial<SmartFlowExplainabilityProjection["hypothesis"]> = {}
): SmartFlowExplainabilityProjection => {
  const scores: SmartFlowExplainabilityProjection["hypothesis"]["scores"] = {
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    evidence_strength: 0.8,
    fit_score: 0.72,
    penalty_score: 0,
    penalties: [],
    confidence: {
      policy_confidence: 0.76,
      evidence_quality: 0.84,
      hypothesis_margin: 0.28,
      conviction: 0.72,
      calibration_version: null
    }
  };

  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: 1_000,
    ingest_ts: 1_010,
    seq: 12,
    trace_id: "smartflow:hypothesis:cluster:SPY:0:60000",
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: "smartflow:hypothesis:cluster:SPY:0:60000",
    hypothesis_id: "hypothesis:cluster:SPY:0:60000",
    cluster_id: "cluster:SPY:0:60000",
    candidate_ids: ["candidate:flowpacket:SPY-2026-06-22-555-C:1"],
    underlying_id: "SPY",
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    alternatives: [],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: ["flowpacket:SPY-2026-06-22-555-C:1", "print:1"],
    generated_from: "flow_evidence_cluster",
    ...overrides,
    scores: overrides.scores ?? scores
  });
};

const makeAlert = (
  overrides: Partial<SmartFlowAlertEvent> = {},
  projectionOverrides: Partial<SmartFlowExplainabilityProjection["hypothesis"]> = {}
): SmartFlowAlertEvent => {
  const projection = makeProjection(projectionOverrides);
  const alert = smartFlowAlertFromProjection(projection, {
    alert_id: overrides.alert_id,
    trace_id: overrides.trace_id
  });
  if (!alert) {
    throw new Error("expected canonical alert");
  }
  return { ...alert, ...overrides };
};

const makePacket = (overrides: Partial<FlowPacket> = {}): FlowPacket =>
  ({
    id: "flowpacket:SPY-2026-06-22-555-C:1",
    trace_id: "flowpacket:SPY-2026-06-22-555-C:1",
    source_ts: 1_000,
    ingest_ts: 1_001,
    seq: 1,
    members: ["print:1"],
    features: {
      option_contract_id: "SPY-2026-06-22-555-C"
    },
    join_quality: {},
    ...overrides
  }) as FlowPacket;

const makePrint = (overrides: Partial<OptionPrint> = {}): OptionPrint =>
  ({
    trace_id: "print:1",
    source_ts: 1_000,
    ingest_ts: 1_001,
    seq: 1,
    ts: 1_000,
    option_contract_id: "SPY-2026-06-22-555-C",
    underlying_id: "SPY",
    price: 1.25,
    size: 100,
    exchange: "CBOE",
    option_type: "call",
    nbbo_side: "A",
    notional: 12_500,
    signal_pass: true,
    ...overrides
  }) as OptionPrint;

const renderNode = (node: ReactNode): string =>
  renderToStaticMarkup(createElement(Fragment, null, node));

type TestElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

const collectElements = (
  node: ReactNode,
  type: string,
  found: TestElement[] = []
): TestElement[] => {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectElements(child, type, found);
    }
    return found;
  }
  if (!isValidElement(node)) {
    return found;
  }
  const element = node as TestElement;
  if (node.type === type) {
    found.push(element);
  }
  collectElements(element.props.children, type, found);
  return found;
};

describe("alerts module helpers", () => {
  it("exports canonical smart-flow alert row keys, cursors, and compact templates", () => {
    const alert = makeAlert({
      alert_id: "alert-1",
      trace_id: "alert-trace-1",
      seq: 4,
      source_ts: 10
    });

    expect(getAlertKey(alert)).toBe("alert-1:4");
    expect(getAlertCursor(alert)).toEqual({ ts: 10, seq: 4 });
    expect(ALERTS_TEMPLATES[0]?.columns).toEqual([
      "time",
      "symbol",
      "hypothesis",
      "direction",
      "confidenceEvidence"
    ]);
    expect(ALERTS_TEMPLATES[1]?.columns).toEqual([
      "time",
      "symbol",
      "hypothesis",
      "confidenceEvidence"
    ]);
    expect(ALERTS_TEMPLATES[2]?.columns).toEqual(["time", "symbol", "direction"]);

    const narrow = selectDurableTapeTemplate({
      columns: ALERTS_COLUMNS,
      templates: ALERTS_TEMPLATES,
      containerWidth: 250,
      requestedTemplate: "auto"
    });
    expect(narrow.template.id).toBe("oneThird");
  });

  it("renders row columns without legacy score or severity presentation", () => {
    const alert = makeAlert();
    const markup = renderNode(renderAlertsRow({ alert, columns: ALERTS_COLUMNS }));

    expect(markup).toContain("SPY");
    expect(markup).toContain("Directional accumulation");
    expect(markup).toContain("bullish");
    expect(markup).toContain("76% / 84% strong");
    expect(markup.toLowerCase()).not.toContain("severity");
    expect(markup).not.toContain(">Score<");
  });

  it("applies shared smart-flow tint metadata to alert rows", () => {
    const alert = makeAlert();
    const tint = getSmartFlowAlertRowTint(alert);

    expect(tint.metadata.hypothesisType).toBe("directional_accumulation");
    expect(tint.metadata.confidenceBand).toBe("high");
    expect(tint.metadata.evidenceQualityBand).toBe("strong");
    expect(getSmartFlowAlertRowTintClassName(alert)).toContain("alerts-smart-flow-row");
    expect(getSmartFlowAlertRowTintClassName(alert)).toContain("classifier-green");
    expect(getSmartFlowAlertRowTintClassName(alert)).toContain("alerts-row-direction-bullish");
    expect(
      (getSmartFlowAlertRowTintStyle(alert) as Record<string, string>)["--classifier-intensity"]
    ).toBe("0.784");
  });

  it("owns canonical alert evidence paths and evidence resolution", () => {
    const alert = makeAlert();
    const packet = makePacket();
    const print = makePrint();
    const evidence = collectAlertContextEvidence({
      flow_packets: [packet],
      option_prints: [print],
      missing_refs: ["missing:1"]
    });

    expect(buildAlertFlowPacketPath("flowpacket:one/two")).toBe(
      "/flow/packets/flowpacket%3Aone%2Ftwo"
    );
    expect(buildAlertOptionPrintsPath(["print:1", "print:2"])).toBe(
      "/option-prints/by-trace?trace_id=print%3A1&trace_id=print%3A2"
    );
    expect(getAlertFlowPacketRefs(alert)).toEqual(["flowpacket:SPY-2026-06-22-555-C:1"]);
    expect(getAlertOptionPrintRefs(alert)).toEqual(["print:1"]);
    expect(getAlertPrimaryPacketRef(alert)).toBe("flowpacket:SPY-2026-06-22-555-C:1");
    expect(getAlertPrimaryOptionRef(alert)).toBe("print:1");
    expect(resolveAlertFlowPacket(alert, evidence.packets)).toBe(packet);
    expect(
      resolveAlertEvidence({ alert, packets: evidence.packets, prints: evidence.prints })
    ).toEqual([
      { kind: "flow", id: packet.id, packet },
      { kind: "print", id: print.trace_id, print }
    ]);
    expect(inferAlertUnderlying(alert, packet, [print])).toBe("SPY");
  });

  it("normalizes canonical alert scope and filters array/history results", async () => {
    const filters = normalizeAlertsFilters({
      minConfidence: 0.7,
      minEvidenceQuality: 0.8,
      directions: ["BULLISH", "bullish"]
    });
    const scope = normalizeAlertsScope({ tickers: ["spy", ""] });
    const alerts = [
      makeAlert(),
      makeAlert(
        { alert_id: "alert:qqq", trace_id: "alert:qqq" },
        {
          underlying_id: "QQQ",
          scores: {
            ...makeProjection().hypothesis.scores,
            confidence: {
              ...makeProjection().hypothesis.scores.confidence,
              policy_confidence: 0.4,
              evidence_quality: 0.4
            }
          }
        }
      )
    ];

    expect(filterAlerts(alerts, scope, filters)).toEqual([alerts[0]]);

    const page = await loadAlertsHistoryPage({
      cursor: { ts: 2_000, seq: 5 },
      scope,
      filters,
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher: async () =>
          Response.json({
            data: alerts,
            next_before: null
          })
      }
    });

    expect(page.items.map((alert) => alert.alert_id)).toEqual([alerts[0]?.alert_id]);
    expect(page.items[0]).not.toHaveProperty("score");
    expect(page.exhausted).toBe(true);
  });

  it("orders detail sections with fast triage before alternatives and versions", () => {
    const scores = makeProjection().hypothesis.scores;
    const alert = makeAlert(
      {},
      {
        alternatives: [
          {
            hypothesis_type: "event_positioning",
            direction: "neutral",
            score: 0.42,
            reasons: ["event window was weaker"]
          }
        ],
        scores: {
          ...scores,
          penalty_score: 0.2,
          penalties: [
            {
              penalty_id: "penalty:wide_quote",
              kind: "wide_quote_context",
              score: 0.2,
              reason: "Quote context was wide.",
              evidence_refs: ["print:1"]
            }
          ]
        }
      }
    );
    const hydration: AlertEvidenceHydration = {
      evidence: [],
      flowPacket: null,
      status: { traceId: alert.trace_id, loading: false, missingRefs: [], error: null }
    };
    const markup = renderNode(AlertDetail({ alert, hydration }));

    expect(markup.indexOf("Fast triage")).toBeLessThan(markup.indexOf("Alternatives considered"));
    expect(markup.indexOf("Alternatives considered")).toBeLessThan(
      markup.indexOf("Why-not context")
    );
    expect(markup.indexOf("Policy penalties")).toBeLessThan(markup.indexOf("Version trace"));
    expect(markup).toContain("Non-abstained flow hypothesis met alert policy.");
    expect(markup.toLowerCase()).not.toContain("classifier");
    expect(markup.toLowerCase()).not.toContain("severity");
    expect(markup).not.toContain(">Score<");
  });

  it("preserves packet, contract, and equity focus callbacks from alert evidence", () => {
    const alert = makeAlert();
    const packet = makePacket();
    const print = makePrint();
    const hydration: AlertEvidenceHydration = {
      evidence: [
        { kind: "flow", id: packet.id, packet },
        { kind: "print", id: print.trace_id, print }
      ],
      flowPacket: packet,
      status: { traceId: alert.trace_id, loading: false, missingRefs: [], error: null }
    };
    const onPacketFocus = mock(() => {});
    const onContractFocus = mock(() => {});
    const onEquityFocus = mock(() => {});
    const element = AlertDetail({
      alert,
      hydration,
      callbacks: { onPacketFocus, onContractFocus, onEquityFocus }
    });
    const buttons = collectElements(element, "button");

    for (const button of buttons) {
      expect(button.props.disabled).toBeFalsy();
      (button.props.onClick as () => void)();
    }

    expect(onPacketFocus).toHaveBeenCalledWith({
      packetId: packet.id,
      memberTraceIds: packet.members,
      optionContractId: "SPY-2026-06-22-555-C",
      source: "alerts"
    });
    expect(onContractFocus).toHaveBeenCalledWith({ print, source: "alerts" });
    expect(onEquityFocus).toHaveBeenCalledWith({ underlyingId: "SPY", source: "alerts" });
  });

  it("anchors strip window to latest visible canonical alert timestamp", () => {
    const alerts = [
      makeAlert({ source_ts: 1_700_000_000_000 }),
      makeAlert({
        alert_id: "alert:older",
        trace_id: "alert:older",
        source_ts: 1_700_000_000_000 - 10 * 60 * 1000
      })
    ];
    expect(getAlertWindowAnchorTs(alerts, 42)).toBe(1_700_000_000_000);
    expect(getAlertWindowAnchorTs([], 42)).toBe(42);
  });
});
