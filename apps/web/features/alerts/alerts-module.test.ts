import { describe, expect, it } from "bun:test";
import type { AlertEvent, FlowPacket, OptionPrint } from "@islandflow/types";

import { selectDurableTapeTemplate } from "../durable-tape";
import { ALERTS_COLUMNS, ALERTS_TEMPLATES } from "./columns";
import {
  buildAlertContextPath,
  collectAlertContextEvidence,
  getAlertFlowPacketRefs,
  resolveAlertEvidence,
  resolveAlertFlowPacket
} from "./evidence";
import {
  deriveAlertDirection,
  getAlertCursor,
  getAlertKey,
  inferAlertUnderlying,
  normalizeAlertSeverity
} from "./format";
import {
  filterAlerts,
  loadAlertsHistoryPage,
  normalizeAlertsFilters,
  normalizeAlertsScope
} from "./source";

const makeAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent =>
  ({
    trace_id: "alert:flowpacket:SPY-2026-06-22-555-C:1",
    source_ts: 1_000,
    ingest_ts: 1_001,
    seq: 2,
    score: 82,
    severity: "high",
    hits: [
      {
        trace_id: "hit:1",
        source_ts: 1_000,
        ingest_ts: 1_001,
        seq: 1,
        classifier_id: "institutional_directional",
        direction: "bullish",
        confidence: 0.91,
        explanations: ["large call sweep"]
      }
    ],
    evidence_refs: ["flowpacket:SPY-2026-06-22-555-C:1", "print:1"],
    ...overrides
  }) as AlertEvent;

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

describe("alerts module helpers", () => {
  it("exports durable alert row keys, cursors, and compact templates", () => {
    const alert = makeAlert({ trace_id: "alert-1", seq: 4, source_ts: 10 });

    expect(getAlertKey(alert)).toBe("alert-1:4");
    expect(getAlertCursor(alert)).toEqual({ ts: 10, seq: 4 });
    expect(ALERTS_TEMPLATES[0]?.columns).toEqual(["time", "symbol", "kind", "score", "state"]);
    expect(ALERTS_TEMPLATES[1]?.columns).toEqual(["time", "symbol", "kind", "score"]);
    expect(ALERTS_TEMPLATES[2]?.columns).toEqual(["time", "symbol", "state"]);

    const narrow = selectDurableTapeTemplate({
      columns: ALERTS_COLUMNS,
      templates: ALERTS_TEMPLATES,
      containerWidth: 250,
      requestedTemplate: "auto"
    });
    expect(narrow.template.id).toBe("oneThird");
  });

  it("normalizes alert severity and derives direction from classifier hits", () => {
    expect(normalizeAlertSeverity(makeAlert({ severity: "sev2", score: 90 }))).toBe("medium");
    expect(normalizeAlertSeverity(makeAlert({ severity: "custom", score: 90 }))).toBe("high");
    expect(deriveAlertDirection(makeAlert())).toBe("bullish");
    expect(deriveAlertDirection(makeAlert({ hits: [] }))).toBe("neutral");
  });

  it("owns alert context paths and evidence resolution", () => {
    const alert = makeAlert();
    const packet = makePacket();
    const print = makePrint();
    const evidence = collectAlertContextEvidence({
      alert,
      flow_packets: [packet],
      option_prints: [print],
      missing_refs: ["missing:1"]
    });

    expect(buildAlertContextPath("alert:one/two")).toBe("/flow/alerts/alert%3Aone%2Ftwo/context");
    expect(getAlertFlowPacketRefs(alert)).toEqual(["flowpacket:SPY-2026-06-22-555-C:1"]);
    expect(resolveAlertFlowPacket(alert, evidence.packets)).toBe(packet);
    expect(
      resolveAlertEvidence({ alert, packets: evidence.packets, prints: evidence.prints })
    ).toEqual([
      { kind: "flow", id: packet.id, packet },
      { kind: "print", id: print.trace_id, print }
    ]);
    expect(inferAlertUnderlying(alert, packet, [print])).toBe("SPY");
  });

  it("normalizes scope and filters array/history results", async () => {
    const filters = normalizeAlertsFilters({ minScore: 50, severities: ["HIGH", "high"] });
    const scope = normalizeAlertsScope({ tickers: ["spy", ""] });
    const alerts = [
      makeAlert({ score: 90, severity: "high" }),
      makeAlert({ trace_id: "alert:QQQ:1", score: 20, severity: "low" })
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

    expect(page.items.map((alert) => alert.trace_id)).toEqual([alerts[0]?.trace_id]);
    expect(page.items[0]?.hits[0]).toEqual({
      classifier_id: "institutional_directional",
      confidence: 0.91,
      direction: "bullish",
      explanations: ["large call sweep"]
    });
    expect(page.exhausted).toBe(true);
  });
});
