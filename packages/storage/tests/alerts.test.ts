import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "../src/clickhouse";
import { alertsTableDDL, ALERTS_TABLE, fromAlertRecord, toAlertRecord } from "../src/alerts";
import { fetchAlertContextByTraceId } from "../src/clickhouse";
import { toFlowPacketRecord } from "../src/flow-packets";

const alert = {
  source_ts: 10,
  ingest_ts: 20,
  seq: 1,
  trace_id: "alert:fp-1",
  score: 78,
  severity: "medium",
  hits: [
    {
      classifier_id: "large_bullish_call_sweep",
      confidence: 0.72,
      direction: "bullish",
      explanations: ["Likely call sweep.", "Premium $50000."]
    }
  ],
  evidence_refs: ["flowpacket:1", "print:1"]
};

const packet = {
  source_ts: 11,
  ingest_ts: 21,
  seq: 2,
  trace_id: "flowpacket:1",
  id: "flowpacket:1",
  members: ["print:1"],
  features: {
    option_contract_id: "SPY-2026-06-19-500-C",
    count: 1,
    total_size: 50
  },
  join_quality: {}
};

const print = {
  source_ts: 12,
  ingest_ts: 22,
  seq: 3,
  trace_id: "print:1",
  ts: 12,
  option_contract_id: "SPY-2026-06-19-500-C",
  price: 1.45,
  size: 50,
  exchange: "XTEST",
  conditions: [],
  nbbo_side: "A",
  execution_nbbo_bid: 1.4,
  execution_nbbo_ask: 1.5,
  execution_nbbo_mid: 1.45,
  execution_nbbo_spread: 0.1,
  execution_nbbo_age_ms: 14,
  execution_nbbo_side: "A",
  execution_underlying_spot: 500.25,
  execution_underlying_bid: 500.2,
  execution_underlying_ask: 500.3,
  execution_underlying_mid: 500.25,
  execution_underlying_age_ms: 9,
  execution_iv: 0.31,
  signal_reasons: [],
  signal_pass: true
};

const makeClient = (resolver: (query: string) => unknown[]): ClickHouseClient =>
  ({
    exec: async () => {},
    insert: async () => {},
    ping: async () => ({ success: true }),
    close: async () => {},
    query: async ({ query }: { query: string }) => ({
      async json<T>() {
        return resolver(query) as T;
      }
    })
  }) as ClickHouseClient;

describe("alerts storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = alertsTableDDL();
    expect(ddl).toContain(ALERTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("round-trips alert records", () => {
    const record = toAlertRecord(alert);
    const restored = fromAlertRecord(record);
    expect(restored.hits).toEqual(alert.hits);
    expect(restored.evidence_refs).toEqual(alert.evidence_refs);
    expect(restored.severity).toBe(alert.severity);
  });

  it("fetches persisted alert context and reports unresolved refs", async () => {
    const contextAlert = {
      ...alert,
      trace_id: "alert:ctx",
      evidence_refs: ["flowpacket:1", "print:1", "print:missing"]
    };
    const queries: string[] = [];
    const client = makeClient((query) => {
      queries.push(query);
      if (query.includes(ALERTS_TABLE)) {
        return [toAlertRecord(contextAlert)];
      }
      if (query.includes("flow_packets")) {
        return [toFlowPacketRecord(packet)];
      }
      if (query.includes("option_prints")) {
        return [print];
      }
      return [];
    });

    const bundle = await fetchAlertContextByTraceId(client, "alert:ctx");

    expect(bundle.alert?.trace_id).toBe("alert:ctx");
    expect(bundle.flow_packets.map((item) => item.id)).toEqual(["flowpacket:1"]);
    expect(bundle.option_prints.map((item) => item.trace_id)).toEqual(["print:1"]);
    expect(bundle.option_prints[0]?.execution_nbbo_side).toBe("A");
    expect(bundle.option_prints[0]?.execution_nbbo_bid).toBe(1.4);
    expect(bundle.option_prints[0]?.execution_underlying_spot).toBe(500.25);
    expect(bundle.option_prints[0]?.execution_iv).toBe(0.31);
    expect(bundle.missing_refs).toEqual(["print:missing"]);
    expect(queries[0]).toContain("trace_id = 'alert:ctx'");
    expect(queries[1]).toContain("id IN");
    expect(queries[2]).toContain("trace_id IN ('print:1', 'print:missing')");
  });

  it("returns an empty context when the alert is missing", async () => {
    const bundle = await fetchAlertContextByTraceId(
      makeClient(() => []),
      "alert:missing"
    );

    expect(bundle).toEqual({
      alert: null,
      flow_packets: [],
      option_prints: [],
      missing_refs: []
    });
  });
});
