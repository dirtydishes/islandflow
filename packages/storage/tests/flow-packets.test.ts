import { describe, expect, it } from "bun:test";
import { createClickHouseClient, fetchFlowPacketById, fetchFlowPacketsBefore } from "../src/clickhouse";
import {
  flowPacketsTableDDL,
  FLOW_PACKETS_TABLE,
  fromFlowPacketRecord,
  toFlowPacketRecord
} from "../src/flow-packets";

const packet = {
  source_ts: 10,
  ingest_ts: 20,
  seq: 1,
  trace_id: "fp-1",
  id: "fp-1",
  members: ["p1", "p2"],
  features: {
    option_contract_id: "SPY-2025-01-17-450-C",
    count: 2,
    total_size: 30
  },
  join_quality: {
    nbbo_age_ms: 5
  }
};

describe("flow-packets storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = flowPacketsTableDDL();
    expect(ddl).toContain(FLOW_PACKETS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("round-trips flow packet records", () => {
    const record = toFlowPacketRecord(packet);
    const restored = fromFlowPacketRecord(record);
    expect(restored.features).toEqual(packet.features);
    expect(restored.join_quality).toEqual(packet.join_quality);
  });

  it("builds before-history and id lookup queries", async () => {
    const queries: string[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async ({ query }) => {
      queries.push(query);
      return {
        async json<T>() {
          return [] as T;
        }
      };
    };

    await fetchFlowPacketsBefore(client, 200, 3, 15);
    await fetchFlowPacketById(client, "fp-1");

    expect(queries[0]).toContain("(source_ts, seq) < (200, 3)");
    expect(queries[0]).toContain("ORDER BY source_ts DESC, seq DESC LIMIT 15");
    expect(queries[1]).toContain("WHERE id = 'fp-1'");
  });
});
