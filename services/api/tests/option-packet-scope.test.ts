import { describe, expect, it } from "bun:test";
import {
  createClickHouseClient,
  fetchOptionPrintsForFlowPacketBefore,
  type ClickHouseClient
} from "@islandflow/storage";

const optionRow = (traceId: string, seq: number) => ({
  source_ts: 1_000 + seq,
  ingest_ts: 1_001 + seq,
  seq,
  trace_id: traceId,
  ts: 1_000 + seq,
  option_contract_id: "SPY-2026-06-22-555-C",
  price: 1.25,
  size: 100,
  exchange: "CBOE",
  conditions: [],
  signal_reasons: []
});

const packetRow = {
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: "flowpacket:trace:1",
  id: "flowpacket:1",
  members: ["member-1", "member-2"],
  features_json: JSON.stringify({ option_contract_id: "SPY-2026-06-22-555-C" }),
  join_quality_json: "{}"
};

describe("packet option-print scope storage", () => {
  it("queries bounded packet members and returns the pinned clicked print", async () => {
    const queries: string[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" }) as ClickHouseClient;
    client.query = async ({ query }) => {
      queries.push(query);
      return {
        async json<T>() {
          if (queries.length === 1) {
            return [packetRow] as T;
          }
          if (queries.length === 2) {
            return [optionRow("member-1", 1)] as T;
          }
          return [optionRow("member-2", 2)] as T;
        }
      };
    };

    const page = await fetchOptionPrintsForFlowPacketBefore(
      client,
      "flowpacket:1",
      3_000,
      9,
      25,
      "member-2"
    );

    expect(page.packet?.id).toBe("flowpacket:1");
    expect(page.data.map((row) => row.trace_id)).toEqual(["member-1"]);
    expect(page.pinned?.trace_id).toBe("member-2");
    expect(queries[1]).toContain("(ts, seq) < (3000, 9)");
    expect(queries[1]).toContain("SELECT arrayJoin(members)");
    expect(queries[1]).toContain("WHERE id = 'flowpacket:1'");
    expect(queries[1]).toContain("LIMIT 1 BY trace_id");
    expect(queries[1]).toContain("ORDER BY ts DESC, seq DESC LIMIT 25");
    expect(queries[2]).toContain("trace_id = 'member-2'");
    expect(queries[2]).toContain("SELECT arrayJoin(members)");
    expect(queries[2]).toContain("LIMIT 1 BY trace_id");
  });
});
