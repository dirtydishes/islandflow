import { describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "../src/clickhouse";
import { NEWS_TABLE, fromNewsRecord, newsTableDDL, toNewsRecord } from "../src/news";
import { fetchNewsAfter, fetchNewsBefore, fetchRecentNews } from "../src/clickhouse";

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

const story = {
  source_ts: 100,
  ingest_ts: 101,
  seq: 3,
  trace_id: "alpaca:77",
  story_id: 77,
  provider: "alpaca",
  source: "Benzinga",
  headline: "TSLA rises",
  summary: "Summary",
  content_html: "<p>TSLA rises</p>",
  url: "https://example.com/story",
  published_ts: 100,
  updated_ts: 120,
  provider_symbols: ["TSLA"],
  resolved_symbols: ["TSLA", "AAPL"],
  symbol_resolution: "mixed" as const
};

describe("news storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = newsTableDDL();
    expect(ddl).toContain(NEWS_TABLE);
    expect(ddl).toContain("ReplacingMergeTree");
  });

  it("round-trips news records", () => {
    const record = toNewsRecord(story);
    const restored = fromNewsRecord(record);
    expect(restored).toEqual(story);
  });

  it("uses latest-revision selection for recent and cursor queries", async () => {
    const queries: string[] = [];
    const client = makeClient((query) => {
      queries.push(query);
      return [toNewsRecord(story)];
    });

    const recent = await fetchRecentNews(client, 10);
    const before = await fetchNewsBefore(client, 200, 10, 10);
    const after = await fetchNewsAfter(client, 50, 1, 10);

    expect(recent[0]?.trace_id).toBe("alpaca:77");
    expect(before[0]?.story_id).toBe(77);
    expect(after[0]?.updated_ts).toBe(120);
    expect(queries[0]).toContain("row_number() OVER");
    expect(queries[1]).toContain("published_ts");
    expect(queries[2]).toContain("(published_ts, seq) > (50, 1)");
  });
});
