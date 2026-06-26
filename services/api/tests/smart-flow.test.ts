import { describe, expect, it } from "bun:test";
import {
  type ClickHouseClient,
  toSmartFlowAlertRecord,
  toSmartFlowProjectionRecord
} from "@islandflow/storage";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  SMART_FLOW_MODEL_VERSION,
  SMART_FLOW_POLICY_VERSION,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import {
  fetchRecentSmartFlowExplainability,
  fetchSmartFlowExplainabilityByPacketIds,
  smartFlowCursor
} from "../src/smart-flow";
import {
  fetchRecentSmartFlowAlertEvents,
  fetchSmartFlowAlertEventsAfter,
  fetchSmartFlowAlertEventsBefore,
  smartFlowAlertCursor
} from "../src/smart-flow-alerts";

const makeClickHouse = (rows: unknown[], queries: string[] = []): ClickHouseClient =>
  ({
    exec: async () => {},
    insert: async () => {},
    ping: async () => ({ success: true }),
    close: async () => {},
    query: async ({ query }) => {
      queries.push(query);
      return {
        async json<T>() {
          return rows as T;
        }
      };
    }
  }) as ClickHouseClient;

const makeSmartFlowProjection = () =>
  smartFlowExplainabilityFromHypothesisEvent({
    source_ts: 1_000,
    ingest_ts: 1_005,
    seq: 12,
    trace_id: "smartflow:hypothesis:cluster:SPY:1000:1120",
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_POLICY_VERSION,
    model_version: SMART_FLOW_MODEL_VERSION,
    event_id: "smartflow:hypothesis:cluster:SPY:1000:1120",
    hypothesis_id: "hypothesis:cluster:SPY:1000:1120",
    cluster_id: "cluster:SPY:1000:1120",
    candidate_ids: ["candidate:flowpacket:12"],
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
      fit_score: 0.7,
      penalty_score: 0.1,
      penalties: [
        {
          penalty_id: "penalty:cluster:SPY:1000:1120:directional_accumulation:wide_quote",
          kind: "wide_quote_context",
          score: 0.1,
          reason: "The option quote was wide enough to discount confidence.",
          evidence_refs: ["flowpacket:12"],
          feature_key: "option_spread_bps_max"
        }
      ],
      confidence: {
        policy_confidence: 0.64,
        evidence_quality: 0.8,
        hypothesis_margin: 0.12,
        conviction: 0.58,
        calibration_version: null
      }
    },
    alternatives: [
      {
        hypothesis_type: "hedge_rebalance",
        direction: "neutral",
        score: 0.32,
        reasons: ["near_atm_short_dated_context"]
      }
    ],
    abstention: {
      abstained: false,
      reasons: ["not_abstained"],
      source_reasons: []
    },
    evidence_refs: ["flowpacket:12", "print:12"],
    generated_from: "flow_evidence_cluster"
  });

describe("smart-flow API projections", () => {
  it("reads recent canonical smart-flow projection rows without smart-money storage", async () => {
    const projection = makeSmartFlowProjection();
    const queries: string[] = [];
    const [payload] = await fetchRecentSmartFlowExplainability(
      makeClickHouse([toSmartFlowProjectionRecord(projection)], queries),
      1
    );

    expect(queries[0]).toContain("smart_flow_projections");
    expect(queries[0]).not.toContain("smart_money_events");
    expect(payload?.source_channel).toBe("smart-flow");
    expect(payload?.projection_version).toBe("smart-flow.explainability-projection.v1");
    expect(payload?.hypothesis.hypothesis_type).toBe("directional_accumulation");
    expect(payload?.refs.evidence_refs).toEqual(["flowpacket:12", "print:12"]);
    expect(payload?.abstention.reasons).toEqual(["not_abstained"]);
    expect(payload?.alternatives[0]?.hypothesis_type).toBe("hedge_rebalance");
    expect(smartFlowCursor(payload!)).toEqual({ ts: 1_000, seq: 12 });
  });

  it("looks up canonical smart-flow projections by packet evidence refs", async () => {
    const projection = makeSmartFlowProjection();
    const queries: string[] = [];
    const [payload] = await fetchSmartFlowExplainabilityByPacketIds(
      makeClickHouse([toSmartFlowProjectionRecord(projection)], queries),
      ["flowpacket:12"]
    );

    expect(queries[0]).toContain("has(evidence_refs, 'flowpacket:12')");
    expect(payload?.refs.cluster_id).toBe("cluster:SPY:1000:1120");
  });
});

describe("smart-flow alert API projections", () => {
  it("reads recent canonical smart-flow alert rows without legacy alert storage", async () => {
    const projection = makeSmartFlowProjection();
    const alert = smartFlowAlertFromProjection(projection);
    if (!alert) {
      throw new Error("expected non-abstained projection to derive an alert");
    }
    const queries: string[] = [];
    const [payload] = await fetchRecentSmartFlowAlertEvents(
      makeClickHouse([toSmartFlowAlertRecord(alert)], queries),
      1
    );

    expect(queries[0]).toContain("smart_flow_alerts");
    expect(queries[0]).not.toContain("FROM alerts");
    expect(payload?.alert_id).toBe(alert.alert_id);
    expect(payload?.trigger.kind).toBe("non_abstained_hypothesis");
    expect(payload?.projection.refs.evidence_refs).toEqual(["flowpacket:12", "print:12"]);
    expect(smartFlowAlertCursor(payload!)).toEqual({ ts: 1_000, seq: 12 });
  });

  it("queries smart-flow alerts after and before cursors", async () => {
    const projection = makeSmartFlowProjection();
    const alert = smartFlowAlertFromProjection(projection);
    if (!alert) {
      throw new Error("expected non-abstained projection to derive an alert");
    }
    const queries: string[] = [];
    const client = makeClickHouse([toSmartFlowAlertRecord(alert)], queries);

    const [after] = await fetchSmartFlowAlertEventsAfter(client, 900, 10, 5);
    const [before] = await fetchSmartFlowAlertEventsBefore(client, 1_100, 20, 5);

    expect(after?.alert_id).toBe(alert.alert_id);
    expect(before?.alert_id).toBe(alert.alert_id);
    expect(queries[0]).toContain("(source_ts, seq) > (900, 10)");
    expect(queries[1]).toContain("(source_ts, seq) < (1100, 20)");
  });
});
