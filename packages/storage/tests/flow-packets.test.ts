import { describe, expect, it } from "bun:test";
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
});
