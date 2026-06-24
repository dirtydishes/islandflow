import { describe, expect, it } from "bun:test";
import {
  createClickHouseClient,
  fetchOptionPrintsBefore,
  fetchOptionPrintsByTraceIds,
  fetchRecentOptionPrints
} from "../src/clickhouse";
import {
  normalizeOptionPrint,
  OPTION_PRINT_QUERY_TIMEOUT_MS,
  OPTION_PRINTS_TABLE,
  OPTION_PRINT_TRACE_ID_MAX_LENGTH,
  OPTION_PRINT_TRACE_LOOKUP_MAX_IDS,
  optionPrintsTableDDL
} from "../src/option-prints";

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

type CapturedQuery = {
  query: string;
  settings?: Record<string, string | number | boolean>;
  timeoutMs?: number;
};

describe("option-prints storage helpers", () => {
  it("normalizes missing conditions to empty array", () => {
    const normalized = normalizeOptionPrint(basePrint);
    expect(normalized.conditions).toEqual([]);
  });

  it("normalizes legacy rows with missing execution context", () => {
    const normalized = normalizeOptionPrint(basePrint);
    expect(normalized.execution_nbbo_bid).toBeUndefined();
    expect(normalized.execution_underlying_spot).toBeUndefined();
    expect(normalized.execution_iv).toBeUndefined();
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = optionPrintsTableDDL();
    expect(ddl).toContain(OPTION_PRINTS_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
    expect(ddl).toContain("execution_nbbo_bid Nullable(Float64)");
    expect(ddl).toContain("execution_underlying_spot Nullable(Float64)");
    expect(ddl).toContain("execution_iv Nullable(Float64)");
    expect(ddl).toContain("idx_option_prints_trace_id");
  });

  it("builds before/history and trace lookup queries", async () => {
    const queries: CapturedQuery[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async (params) => {
      const { query } = params;
      queries.push(params);
      return {
        async json<T>() {
          if (query.includes("trace-ctx")) {
            return [
              {
                ...basePrint,
                trace_id: "trace-ctx",
                conditions: [],
                execution_nbbo_bid: "1.20",
                execution_nbbo_ask: "1.30",
                execution_nbbo_mid: "1.25",
                execution_nbbo_side: "A",
                execution_underlying_spot: "450.05",
                execution_underlying_source: "equity_quote_mid",
                execution_iv: "0.42",
                execution_iv_source: "synthetic_pressure_model",
                signal_reasons: ["large_notional"],
                signal_pass: 1
              }
            ] as T;
          }
          return [] as T;
        }
      };
    };

    await fetchRecentOptionPrints(client, 25, undefined, {
      view: "signal",
      security: "stock",
      nbboSides: ["AA", "A"],
      optionTypes: ["call"],
      minNotional: 25_000,
      underlyingIds: ["AAPL", "NVDA"],
      optionContractId: "AAPL-2025-01-17-200-C",
      sinceTs: 123
    });
    await fetchOptionPrintsBefore(client, 100, 5, 20, "alpaca", { view: "raw" });
    await fetchOptionPrintsByTraceIds(client, ["trace-1", "trace-2"]);
    const rows = await fetchRecentOptionPrints(client, 1, "trace-ctx", { view: "signal" });

    expect(queries[0]?.query).toContain("signal_pass = 1");
    expect(queries[0]?.query).toContain("(is_etf = 0 OR is_etf IS NULL)");
    expect(queries[0]?.query).toContain("nbbo_side IN ('AA', 'A')");
    expect(queries[0]?.query).toContain("option_type IN ('call')");
    expect(queries[0]?.query).toContain("notional >= 25000");
    expect(queries[0]?.query).toContain("underlying_id IN ('AAPL', 'NVDA')");
    expect(queries[0]?.query).toContain("option_contract_id = 'AAPL-2025-01-17-200-C'");
    expect(queries[0]?.query).toContain("ts >= 123");
    expect(queries[0]?.settings?.max_execution_time).toBe(2);
    expect(queries[0]?.timeoutMs).toBe(OPTION_PRINT_QUERY_TIMEOUT_MS);
    expect(queries[1]?.query).toContain("(ts, seq) < (100, 5)");
    expect(queries[1]?.query).toContain("startsWith(trace_id, 'alpaca')");
    expect(queries[1]?.query).not.toContain("signal_pass = 1");
    expect(queries[1]?.query).toContain("ORDER BY ts DESC, seq DESC LIMIT 20");
    expect(queries[2]?.query).toContain("trace_id IN ('trace-1', 'trace-2')");
    expect(queries[2]?.settings?.max_execution_time).toBe(2);
    expect(queries[2]?.timeoutMs).toBe(OPTION_PRINT_QUERY_TIMEOUT_MS);
    expect(rows[0].execution_nbbo_side).toBe("A");
    expect(rows[0].execution_underlying_spot).toBe(450.05);
    expect(rows[0].execution_iv).toBe(0.42);
    expect(rows[0].signal_reasons).toEqual(["large_notional"]);
  });

  it("returns an empty trace lookup without querying ClickHouse", async () => {
    const queries: CapturedQuery[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async (params) => {
      queries.push(params);
      return {
        async json<T>() {
          return [] as T;
        }
      };
    };

    await expect(fetchOptionPrintsByTraceIds(client, ["", "   "])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("dedupes, caps, and bounds trace lookup queries", async () => {
    const queries: CapturedQuery[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async (params) => {
      queries.push(params);
      return {
        async json<T>() {
          return [
            {
              ...basePrint,
              trace_id: "trace-hit",
              conditions: [],
              signal_reasons: []
            }
          ] as T;
        }
      };
    };
    const traceIds = [
      "trace-hit",
      " trace-hit ",
      "x".repeat(OPTION_PRINT_TRACE_ID_MAX_LENGTH + 1),
      ...Array.from(
        { length: OPTION_PRINT_TRACE_LOOKUP_MAX_IDS + 5 },
        (_, index) => `trace-${index}`
      )
    ];

    const rows = await fetchOptionPrintsByTraceIds(client, traceIds);

    expect(rows.map((row) => row.trace_id)).toEqual(["trace-hit"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.query).toContain("trace_id IN ('trace-hit', 'trace-0'");
    expect(queries[0]?.query).not.toContain(`trace-${OPTION_PRINT_TRACE_LOOKUP_MAX_IDS}`);
    expect(queries[0]?.query).toContain(`LIMIT ${OPTION_PRINT_TRACE_LOOKUP_MAX_IDS}`);
    expect(queries[0]?.settings?.max_execution_time).toBe(2);
    expect(queries[0]?.timeoutMs).toBe(OPTION_PRINT_QUERY_TIMEOUT_MS);
  });

  it("passes bounded query settings through the ClickHouse HTTP client", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      urls.push(String(input));
      return new Response("{}\n", { status: 200 });
    }) as typeof fetch;

    try {
      const client = createClickHouseClient({
        url: "http://127.0.0.1:8123",
        database: "islandflow_test"
      });
      const result = await client.query({
        query: "SELECT 1",
        format: "JSONEachRow",
        settings: { max_execution_time: 2 },
        timeoutMs: OPTION_PRINT_QUERY_TIMEOUT_MS
      });

      await result.json();
      const url = new URL(urls[0] ?? "");
      expect(url.searchParams.get("database")).toBe("islandflow_test");
      expect(url.searchParams.get("query")).toBe("SELECT 1 FORMAT JSONEachRow");
      expect(url.searchParams.get("max_execution_time")).toBe("2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
