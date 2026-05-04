import { describe, expect, it } from "bun:test";
import {
  equityQuotesTableDDL,
  EQUITY_QUOTES_TABLE,
  normalizeEquityQuote
} from "../src/equity-quotes";
import { fetchEquityQuotesBefore, type ClickHouseClient } from "../src/clickhouse";

const baseQuote = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  underlying_id: "SPY",
  bid: 450.1,
  ask: 450.2
};

describe("equity-quotes storage helpers", () => {
  it("keeps required fields intact", () => {
    const normalized = normalizeEquityQuote(baseQuote);
    expect(normalized).toEqual(baseQuote);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = equityQuotesTableDDL();
    expect(ddl).toContain(EQUITY_QUOTES_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("fetches older quotes with tuple cursor ordering", async () => {
    let queryText = "";
    const client = {
      query: async ({ query }: { query: string }) => {
        queryText = query;
        return {
          async json<T>() {
            return [
              {
                ...baseQuote,
                source_ts: 90,
                ingest_ts: 201,
                seq: 2,
                trace_id: "trace-2",
                ts: 90
              }
            ] as T;
          }
        };
      }
    } as unknown as ClickHouseClient;

    const rows = await fetchEquityQuotesBefore(client, 100, 3, 25);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.trace_id).toBe("trace-2");
    expect(queryText).toContain(EQUITY_QUOTES_TABLE);
    expect(queryText).toContain("WHERE (ts, seq) < (100, 3)");
    expect(queryText).toContain("ORDER BY ts DESC, seq DESC LIMIT 25");
  });
});
