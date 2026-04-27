import { describe, expect, it } from "bun:test";
import { createClickHouseClient, fetchOptionPrintsBefore, fetchOptionPrintsByTraceIds } from "../src/clickhouse";
import { normalizeOptionPrint, optionPrintsTableDDL, OPTION_PRINTS_TABLE } from "../src/option-prints";

const basePrint = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  option_contract_id: "SPY-2025-01-17-450-C",
  price: 1.25,
  size: 10,
  exchange: "TEST"
};

describe("option-prints storage helpers", () => {
  it("normalizes missing conditions to empty array", () => {
    const normalized = normalizeOptionPrint(basePrint);
    expect(normalized.conditions).toEqual([]);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = optionPrintsTableDDL();
    expect(ddl).toContain(OPTION_PRINTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("builds before/history and trace lookup queries", async () => {
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

    await fetchOptionPrintsBefore(client, 100, 5, 20, "alpaca");
    await fetchOptionPrintsByTraceIds(client, ["trace-1", "trace-2"]);

    expect(queries[0]).toContain("(ts, seq) < (100, 5)");
    expect(queries[0]).toContain("startsWith(trace_id, 'alpaca')");
    expect(queries[0]).toContain("ORDER BY ts DESC, seq DESC LIMIT 20");
    expect(queries[1]).toContain("trace_id IN ('trace-1', 'trace-2')");
  });
});
