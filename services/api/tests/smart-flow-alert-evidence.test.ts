import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@islandflow/storage";
import type {
  EquityPrint,
  EquityQuote,
  FlowPacket,
  OptionNBBO,
  OptionPrint
} from "@islandflow/types";
import {
  parseSmartFlowAlertEvidenceRef,
  resolveSmartFlowAlertEvidenceBundle,
  type SmartFlowAlertEvidenceResolverDeps
} from "../src/smart-flow-alert-evidence";

const clickhouse = {} as ClickHouseClient;

const makePacket = (id = "flowpacket:packet:1"): FlowPacket => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: id,
  id,
  members: ["print:1"],
  features: { option_contract_id: "SPY-2026-06-22-555-C" },
  join_quality: {}
});

const makeOptionPrint = (traceId = "print:1"): OptionPrint => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 2,
  trace_id: traceId,
  ts: 1_000,
  option_contract_id: "SPY-2026-06-22-555-C",
  price: 1.25,
  size: 100,
  exchange: "CBOE",
  underlying_id: "SPY",
  option_type: "call",
  notional: 12_500,
  signal_pass: true
});

const makeNbbo = (): OptionNBBO => ({
  source_ts: 1_700,
  ingest_ts: 1_701,
  seq: 3,
  trace_id: "nbbo:1",
  ts: 1_700,
  option_contract_id: "SPY:COMPLEX",
  bid: 1.2,
  ask: 1.3,
  bidSize: 10,
  askSize: 12
});

const makeQuote = (): EquityQuote => ({
  source_ts: 1_700,
  ingest_ts: 1_701,
  seq: 4,
  trace_id: "quote:1",
  ts: 1_700,
  underlying_id: "SPY",
  bid: 450.1,
  ask: 450.2
});

const makeEquityPrint = (): EquityPrint => ({
  source_ts: 1_700,
  ingest_ts: 1_701,
  seq: 5,
  trace_id: "eq:1",
  ts: 1_700,
  underlying_id: "SPY",
  price: 450.15,
  size: 100,
  exchange: "DARK",
  offExchangeFlag: true
});

describe("smart-flow alert evidence resolver", () => {
  it("parses exact timestamp refs by the last colon", () => {
    expect(parseSmartFlowAlertEvidenceRef("option-nbbo:SPY:COMPLEX:1700")).toEqual({
      kind: "option_nbbo",
      ref: "option-nbbo:SPY:COMPLEX:1700",
      lookup: { option_contract_id: "SPY:COMPLEX", ts: 1700 }
    });
    expect(parseSmartFlowAlertEvidenceRef("equity-quote:SPY:1700")).toEqual({
      kind: "equity_quote",
      ref: "equity-quote:SPY:1700",
      lookup: { underlying_id: "SPY", ts: 1700 }
    });
    expect(parseSmartFlowAlertEvidenceRef("option-nbbo:SPY:not-a-ts")).toMatchObject({
      kind: "unresolved",
      inferredKind: "option_nbbo",
      reason: "malformed_ref"
    });
  });

  it("resolves mixed refs with deduped storage calls and ordered response items", async () => {
    const calls: Record<string, unknown[]> = {};
    const deps: SmartFlowAlertEvidenceResolverDeps = {
      fetchFlowPacketsByIds: async (_client, ids) => {
        calls.flow = ids;
        return [makePacket()];
      },
      fetchOptionPrintsByTraceIds: async (_client, traceIds) => {
        calls.prints = traceIds;
        return [makeOptionPrint("print:1"), makeOptionPrint("bare-trace")];
      },
      fetchOptionNBBOByContractAndTs: async (_client, lookups) => {
        calls.nbbo = lookups;
        return [makeNbbo()];
      },
      fetchEquityQuotesByUnderlyingAndTs: async (_client, lookups) => {
        calls.quotes = lookups;
        return [makeQuote()];
      },
      fetchEquityPrintsByTraceIds: async (_client, traceIds) => {
        calls.equityPrints = traceIds;
        return [makeEquityPrint()];
      }
    };

    const bundle = await resolveSmartFlowAlertEvidenceBundle(
      clickhouse,
      {
        alert_id: "alert:1",
        refs: [
          "flowpacket:packet:1",
          "print:1",
          "option-nbbo:SPY:COMPLEX:1700",
          "equity-quote:spy:1700",
          "equity-print:eq:1",
          "synthetic-label:scenario:large-call",
          "external-context:macro-window",
          "news-story:42",
          "event-calendar:fomc",
          "bare-trace",
          "print:1",
          "flowpacket:missing",
          "missing-trace",
          "option-nbbo:SPY:not-a-ts",
          "legacy-alert:1"
        ]
      },
      deps
    );

    expect(calls.flow).toEqual(["flowpacket:packet:1", "flowpacket:missing"]);
    expect(calls.prints).toEqual(["print:1", "bare-trace", "missing-trace"]);
    expect(calls.nbbo).toEqual([{ option_contract_id: "SPY:COMPLEX", ts: 1700 }]);
    expect(calls.quotes).toEqual([{ underlying_id: "spy", ts: 1700 }]);
    expect(calls.equityPrints).toEqual(["eq:1"]);
    expect(bundle.items.map((item) => item.kind)).toEqual([
      "flow_packet",
      "option_print",
      "option_nbbo",
      "equity_quote",
      "equity_print",
      "synthetic_label",
      "external_context",
      "external_context",
      "external_context",
      "option_print",
      "option_print",
      "unresolved",
      "unresolved",
      "unresolved",
      "unresolved"
    ]);
    expect(bundle.items[10]).toEqual(bundle.items[1]);
    expect(bundle.items[11]).toMatchObject({
      ref: "flowpacket:missing",
      inferred_kind: "flow_packet",
      reason: "not_found"
    });
    expect(bundle.items[12]).toMatchObject({
      ref: "missing-trace",
      inferred_kind: "option_print",
      reason: "not_found"
    });
    expect(bundle.items[13]).toMatchObject({
      ref: "option-nbbo:SPY:not-a-ts",
      inferred_kind: "option_nbbo",
      reason: "malformed_ref"
    });
    expect(bundle.items[14]).toMatchObject({
      ref: "legacy-alert:1",
      inferred_kind: "unknown",
      reason: "unsupported_ref"
    });
  });
});
