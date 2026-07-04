import { describe, expect, it } from "bun:test";
import { createClickHouseClient, fetchOptionNBBOByContractAndTs } from "../src/clickhouse";
import { normalizeOptionNBBO, optionNBBOTableDDL, OPTION_NBBO_TABLE } from "../src/option-nbbo";

const baseNbbo = {
  source_ts: 100,
  ingest_ts: 200,
  seq: 1,
  trace_id: "trace-1",
  ts: 100,
  option_contract_id: "SPY-2025-01-17-450-C",
  bid: 1.2,
  ask: 1.3,
  bidSize: 10,
  askSize: 12
};

describe("option-nbbo storage helpers", () => {
  it("keeps required fields intact", () => {
    const normalized = normalizeOptionNBBO(baseNbbo);
    expect(normalized).toEqual(baseNbbo);
  });

  it("includes the correct table name in the DDL", () => {
    const ddl = optionNBBOTableDDL();
    expect(ddl).toContain(OPTION_NBBO_TABLE);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("builds bounded exact contract/timestamp lookup queries", async () => {
    let queryText = "";
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async ({ query }) => {
      queryText = query;
      return {
        async json<T>() {
          return [{ ...baseNbbo, trace_id: "nbbo:hit" }] as T;
        }
      };
    };

    const rows = await fetchOptionNBBOByContractAndTs(client, [
      { option_contract_id: "SPY-2025-01-17-450-C", ts: 100 },
      { option_contract_id: "SPY-2025-01-17-450-C", ts: 100 },
      { option_contract_id: "QQQ-2025-01-17-400-C", ts: 200 },
      { option_contract_id: " ", ts: 300 }
    ]);

    expect(rows[0]?.trace_id).toBe("nbbo:hit");
    expect(queryText).toContain(OPTION_NBBO_TABLE);
    expect(queryText).toContain(
      "(option_contract_id, ts) IN (('SPY-2025-01-17-450-C', 100), ('QQQ-2025-01-17-400-C', 200))"
    );
    expect(queryText).toContain("LIMIT 1 BY option_contract_id, ts LIMIT 2");
  });
});
