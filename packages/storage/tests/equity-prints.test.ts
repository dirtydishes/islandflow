import { describe, expect, it } from "bun:test";
import {
  createClickHouseClient,
  fetchEquityPrintsAfter,
  fetchEquityPrintsBefore,
  fetchRecentEquityPrints
} from "../src/clickhouse";
import { equityPrintsTableDDL, EQUITY_PRINTS_TABLE } from "../src/equity-prints";

const basePrint = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  underlying_id: "SPY",
  price: 450.1,
  size: 100,
  exchange: "TEST",
  offExchangeFlag: false
};

describe("equity-prints storage helpers", () => {
  it("keeps required fields intact", () => {
    expect(basePrint.offExchangeFlag).toBe(false);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = equityPrintsTableDDL();
    expect(ddl).toContain(EQUITY_PRINTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("builds scoped recent, before, and after queries", async () => {
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

    await fetchRecentEquityPrints(client, 25, {
      underlyingIds: ["AAPL", "NVDA"],
      sinceTs: 123
    });
    await fetchEquityPrintsBefore(client, 100, 5, 20, {
      underlyingIds: ["AAPL"],
      sinceTs: 50
    });
    await fetchEquityPrintsAfter(client, 100, 5, 20, {
      underlyingIds: ["NVDA"],
      sinceTs: 50
    });

    expect(queries[0]).toContain("underlying_id IN ('AAPL', 'NVDA')");
    expect(queries[0]).toContain("ts >= 123");
    expect(queries[1]).toContain("(ts, seq) < (100, 5)");
    expect(queries[1]).toContain("underlying_id IN ('AAPL')");
    expect(queries[1]).toContain("ts >= 50");
    expect(queries[2]).toContain("((ts, seq) > (100, 5))");
    expect(queries[2]).toContain("underlying_id IN ('NVDA')");
    expect(queries[2]).toContain("ts >= 50");
  });
});
