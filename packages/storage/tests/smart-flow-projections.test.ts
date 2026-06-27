import { describe, expect, it } from "bun:test";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import { createClickHouseClient, fetchSmartFlowProjectionsByEvidenceRefs } from "../src/clickhouse";
import {
  fromSmartFlowProjectionRecord,
  SMART_FLOW_PROJECTIONS_TABLE,
  smartFlowProjectionsTableDDL,
  toSmartFlowProjectionRecord
} from "../src/smart-flow-projections";

const makeProjection = () =>
  smartFlowExplainabilityFromHypothesisEvent({
    source_ts: 1_000,
    ingest_ts: 1_010,
    seq: 12,
    trace_id: "smartflow:hypothesis:cluster:SPY:0:60000",
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: "smartflow:hypothesis:cluster:SPY:0:60000",
    hypothesis_id: "hypothesis:cluster:SPY:0:60000",
    cluster_id: "cluster:SPY:0:60000",
    candidate_ids: ["candidate:flowpacket:1"],
    underlying_id: "SPY",
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    scores: {
      schema_version: SMART_FLOW_CONTRACT_VERSION,
      policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
      model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
      hypothesis_type: "directional_accumulation",
      direction: "bullish",
      evidence_strength: 0.8,
      fit_score: 0.72,
      penalty_score: 0,
      penalties: [],
      confidence: {
        policy_confidence: 0.76,
        evidence_quality: 0.84,
        hypothesis_margin: 0.28,
        conviction: 0.72,
        calibration_version: null
      }
    },
    alternatives: [],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: ["flowpacket:1", "print:1"],
    generated_from: "flow_evidence_cluster"
  });

describe("smart-flow projection storage helpers", () => {
  it("includes the correct table name in the DDL", () => {
    const ddl = smartFlowProjectionsTableDDL();

    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
    expect(ddl).toContain(SMART_FLOW_PROJECTIONS_TABLE);
  });

  it("round-trips canonical projections while exposing query columns", () => {
    const projection = makeProjection();
    const record = toSmartFlowProjectionRecord(projection);

    expect(record.hypothesis_id).toBe(projection.refs.hypothesis_id);
    expect(record.cluster_id).toBe(projection.refs.cluster_id);
    expect(record.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
    expect(record.source_channel).toBe("smart-flow");
    expect(fromSmartFlowProjectionRecord(record)).toEqual(projection);
  });

  it("builds direct evidence-ref lookup queries", async () => {
    const projection = makeProjection();
    const queries: string[] = [];
    const client = createClickHouseClient({ url: "http://127.0.0.1:8123" });
    client.query = async ({ query }) => {
      queries.push(query);
      return {
        async json<T>() {
          return [toSmartFlowProjectionRecord(projection)] as T;
        }
      };
    };

    const [payload] = await fetchSmartFlowProjectionsByEvidenceRefs(client, ["print:1"]);

    expect(queries[0]).toContain("arrayJoin(evidence_refs) AS matched_ref");
    expect(queries[0]).toContain("hasAny(evidence_refs, ['print:1'])");
    expect(queries[0]).toContain("ORDER BY matched_ref ASC, source_ts DESC, seq DESC");
    expect(queries[0]).toContain("LIMIT 4 BY matched_ref");
    expect(payload?.refs.evidence_refs).toEqual(["flowpacket:1", "print:1"]);
  });
});
