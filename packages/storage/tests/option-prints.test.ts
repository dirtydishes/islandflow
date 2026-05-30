import { describe, expect, it } from "bun:test";
import {
  createClickHouseClient,
  fetchOptionPrintsBefore,
  fetchOptionPrintsByTraceIds,
  fetchRecentOptionPrints
} from "../src/clickhouse";
import {
  normalizeOptionPrint,
  optionPrintsTableDDL,
  OPTION_PRINTS_TABLE
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
  });

  it("builds before/history and trace lookup queries", async () => {
    const queries: string[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async ({ query }) => {
      queries.push(query);
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

    expect(queries[0]).toContain("signal_pass = 1");
    expect(queries[0]).toContain("(is_etf = 0 OR is_etf IS NULL)");
    expect(queries[0]).toContain("nbbo_side IN ('AA', 'A')");
    expect(queries[0]).toContain("option_type IN ('call')");
    expect(queries[0]).toContain("notional >= 25000");
    expect(queries[0]).toContain("underlying_id IN ('AAPL', 'NVDA')");
    expect(queries[0]).toContain("option_contract_id = 'AAPL-2025-01-17-200-C'");
    expect(queries[0]).toContain("ts >= 123");
    expect(queries[1]).toContain("(ts, seq) < (100, 5)");
    expect(queries[1]).toContain("startsWith(trace_id, 'alpaca')");
    expect(queries[1]).not.toContain("signal_pass = 1");
    expect(queries[1]).toContain("ORDER BY ts DESC, seq DESC LIMIT 20");
    expect(queries[2]).toContain("trace_id IN ('trace-1', 'trace-2')");
    expect(rows[0].execution_nbbo_side).toBe("A");
    expect(rows[0].execution_underlying_spot).toBe(450.05);
    expect(rows[0].execution_iv).toBe(0.42);
    expect(rows[0].signal_reasons).toEqual(["large_notional"]);
  });
});
