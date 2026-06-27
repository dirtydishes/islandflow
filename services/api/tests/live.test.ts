import { describe, expect, it } from "bun:test";
import { type ClickHouseClient } from "@islandflow/storage";
import {
  SMART_FLOW_CONTRACT_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
  SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
  type SmartFlowAlertEvent,
  type SmartFlowExplainabilityProjection,
  smartFlowAlertFromProjection,
  smartFlowExplainabilityFromHypothesisEvent
} from "@islandflow/types";
import {
  buildOptionSnapshotFilters,
  HOT_LIVE_REDIS_KEYS,
  isLiveItemFresh,
  LiveStateManager,
  resolveGenericLiveLimits,
  resolveLiveStateConfig,
  shouldFanoutLiveEvent
} from "../src/live";

const makeClickHouse = (queryResolver?: (query: string) => unknown[]): ClickHouseClient =>
  ({
    exec: async () => {},
    insert: async () => {},
    ping: async () => ({ success: true }),
    close: async () => {},
    query: async ({ query }: { query: string }) => ({
      async json<T>() {
        return (queryResolver?.(query) ?? []) as T;
      }
    })
  }) as ClickHouseClient;

const makeRedis = () => {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();

  return {
    isOpen: true,
    async lRange(key: string, start: number, stop: number) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
    async lPush(key: string, value: string) {
      const next = lists.get(key) ?? [];
      next.unshift(value);
      lists.set(key, next);
      return next.length;
    },
    async lTrim(key: string, start: number, stop: number) {
      const next = lists.get(key) ?? [];
      lists.set(key, start > stop ? [] : next.slice(start, stop + 1));
      return "OK";
    },
    async hGet(key: string, field: string) {
      return hashes.get(key)?.get(field) ?? null;
    },
    async hSet(key: string, field: string, value: string) {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    }
  };
};

const makeSmartFlowProjection = (
  now = Date.now(),
  overrides: {
    seq?: number;
    packetIds?: string[];
    printIds?: string[];
    underlyingId?: string;
  } = {}
): SmartFlowExplainabilityProjection => {
  const seq = overrides.seq ?? 7;
  const packetIds = overrides.packetIds ?? ["flowpacket:7"];
  const printIds = overrides.printIds ?? ["print:7"];
  const underlyingId = overrides.underlyingId ?? "SPY";
  const clusterId = `cluster:${underlyingId}:${now}:${now + 60_000}`;
  return smartFlowExplainabilityFromHypothesisEvent({
    source_ts: now,
    ingest_ts: now + 1,
    seq,
    trace_id: `smartflow:hypothesis:${clusterId}`,
    schema_version: SMART_FLOW_CONTRACT_VERSION,
    policy_version: SMART_FLOW_HYPOTHESIS_SCORE_POLICY_VERSION,
    model_version: SMART_FLOW_HYPOTHESIS_SCORE_MODEL_VERSION,
    event_id: `smartflow:hypothesis:${clusterId}`,
    hypothesis_id: `hypothesis:${clusterId}`,
    cluster_id: clusterId,
    candidate_ids: packetIds.map((packetId) => `candidate:${packetId}`),
    underlying_id: underlyingId,
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
    alternatives: [
      {
        hypothesis_type: "hedge_rebalance",
        direction: "neutral",
        score: 0.31,
        reasons: ["could_be_hedge_rebalance"]
      }
    ],
    abstention: { abstained: false, reasons: ["not_abstained"], source_reasons: [] },
    evidence_refs: [...packetIds, ...printIds],
    generated_from: "flow_evidence_cluster"
  });
};

describe("LiveStateManager", () => {
  it("resolves live limits from env with clamping", () => {
    const limits = resolveGenericLiveLimits({
      LIVE_LIMIT_OPTIONS: "777",
      LIVE_LIMIT_NBBO: "200000",
      LIVE_LIMIT_FLOW: "bad"
    } as NodeJS.ProcessEnv);

    expect(limits.options).toBe(777);
    expect(limits.nbbo).toBe(100000);
    expect(limits.flow).toBe(500);
    expect(limits["smart-flow"]).toBe(300);
    expect(limits["smart-flow-alerts"]).toBe(300);
    expect(limits["equity-quotes"]).toBe(500);
    expect(resolveGenericLiveLimits({} as NodeJS.ProcessEnv).options).toBe(100);
  });

  it("hydrates snapshots from redis generic windows", async () => {
    const redis = makeRedis();
    const now = Date.now();
    await redis.lPush(
      "live:flow",
      JSON.stringify({
        source_ts: now,
        ingest_ts: now + 1,
        seq: 1,
        trace_id: "flow-1",
        id: "flow-1",
        members: ["a"],
        features: {},
        join_quality: {}
      })
    );
    await redis.hSet("live:cursors", "flow", JSON.stringify({ ts: now, seq: 1 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "flow" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 1 });
    expect(snapshot.next_before).toEqual({ ts: now, seq: 1 });
  });

  it("persists parameterized candle and overlay caches on ingest", async () => {
    const redis = makeRedis();
    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.ingest("equity-candles", {
      source_ts: 100,
      ingest_ts: 101,
      seq: 1,
      trace_id: "candle:SPY:60000:100",
      ts: 100,
      interval_ms: 60000,
      underlying_id: "SPY",
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      volume: 10,
      trade_count: 1
    });
    await manager.ingest("equity-overlay", {
      source_ts: 110,
      ingest_ts: 111,
      seq: 2,
      trace_id: "eq-1",
      ts: 110,
      underlying_id: "SPY",
      price: 10,
      size: 5,
      exchange: "X",
      offExchangeFlag: true
    });

    const candleSnapshot = await manager.getSnapshot({
      channel: "equity-candles",
      underlying_id: "SPY",
      interval_ms: 60000
    });
    const overlaySnapshot = await manager.getSnapshot({
      channel: "equity-overlay",
      underlying_id: "SPY"
    });

    expect(candleSnapshot.items).toHaveLength(1);
    expect(overlaySnapshot.items).toHaveLength(1);
    expect(candleSnapshot.watermark).toEqual({ ts: 100, seq: 1 });
    expect(overlaySnapshot.watermark).toEqual({ ts: 110, seq: 2 });
  });

  it("trims generic windows to configured per-channel limits", async () => {
    const redis = makeRedis();
    const now = Date.now();
    const manager = new LiveStateManager(makeClickHouse(), redis as never, {
      options: 10000,
      nbbo: 10000,
      equities: 10000,
      "equity-quotes": 10000,
      "equity-joins": 10000,
      flow: 2,
      "smart-flow": 10000,
      "smart-flow-alerts": 10000,
      "inferred-dark": 10000
    });

    await manager.ingest("flow", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "flow-1",
      id: "flow-1",
      members: ["a"],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now + 10,
      ingest_ts: now + 11,
      seq: 2,
      trace_id: "flow-2",
      id: "flow-2",
      members: ["b"],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now + 20,
      ingest_ts: now + 21,
      seq: 3,
      trace_id: "flow-3",
      id: "flow-3",
      members: ["c"],
      features: {},
      join_quality: {}
    });

    const snapshot = await manager.getSnapshot({ channel: "flow" });
    expect(snapshot.items).toHaveLength(2);
    expect((snapshot.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "flow-3",
      "flow-2"
    ]);

    const persisted = await redis.lRange("live:flow", 0, 99);
    await manager.flushRedisWrites();
    const flushed = await redis.lRange("live:flow", 0, 99);
    expect(persisted).toHaveLength(0);
    expect(flushed).toHaveLength(2);

    const stats = manager.getStatsSnapshot();
    expect(stats.trimOperations).toBeGreaterThan(0);
    expect(stats.redisFlushCount).toBeGreaterThan(0);
    expect(stats.cacheDepthByKey["live:flow"]).toBe(2);
  });

  it("stores smart-flow explainability projections as a canonical live channel", async () => {
    const now = Date.now();
    const projection = makeSmartFlowProjection(now);
    const manager = new LiveStateManager(makeClickHouse(), null);

    await manager.ingest("smart-flow", projection);

    const snapshot = await manager.getSnapshot({ channel: "smart-flow" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 7 });
    expect(snapshot.next_before).toEqual({ ts: now, seq: 7 });
    expect((snapshot.items as Array<typeof projection>)[0]?.hypothesis.hypothesis_type).toBe(
      "directional_accumulation"
    );
    expect((snapshot.items as Array<typeof projection>)[0]?.refs.evidence_refs).toEqual([
      "flowpacket:7",
      "print:7"
    ]);
    expect((snapshot.items as Array<typeof projection>)[0]?.alternatives[0]?.reasons).toEqual([
      "could_be_hedge_rebalance"
    ]);
  });

  it("stores smart-flow alerts as a canonical live channel", async () => {
    const now = Date.now();
    const projection = makeSmartFlowProjection(now);
    const alert = smartFlowAlertFromProjection(projection);
    if (!alert) {
      throw new Error("expected non-abstained projection to derive an alert");
    }
    const manager = new LiveStateManager(makeClickHouse(), null);

    await manager.ingest("smart-flow-alerts", alert);

    const snapshot = await manager.getSnapshot({ channel: "smart-flow-alerts" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 7 });
    expect(snapshot.next_before).toEqual({ ts: now, seq: 7 });
    expect((snapshot.items as SmartFlowAlertEvent[])[0]?.alert_id).toBe(alert.alert_id);
    expect((snapshot.items as SmartFlowAlertEvent[])[0]?.trigger.kind).toBe(
      "non_abstained_hypothesis"
    );
    expect((snapshot.items as SmartFlowAlertEvent[])[0]?.projection.source_channel).toBe(
      "smart-flow"
    );
  });

  it("keeps same-cursor smart-flow alerts with distinct alert identities", async () => {
    const now = Date.now();
    const first = smartFlowAlertFromProjection(makeSmartFlowProjection(now), {
      alert_id: "smartflow:alert:SPY",
      trace_id: "smartflow:alert:SPY"
    });
    const second = smartFlowAlertFromProjection(
      makeSmartFlowProjection(now, {
        packetIds: ["flowpacket:8"],
        printIds: ["print:8"],
        underlyingId: "QQQ"
      }),
      {
        alert_id: "smartflow:alert:QQQ",
        trace_id: "smartflow:alert:QQQ"
      }
    );
    if (!first || !second) {
      throw new Error("expected non-abstained projections to derive alerts");
    }
    const manager = new LiveStateManager(makeClickHouse(), null);

    await manager.ingest("smart-flow-alerts", first);
    await manager.ingest("smart-flow-alerts", second);

    const snapshot = await manager.getSnapshot({ channel: "smart-flow-alerts" });

    expect(snapshot.items).toHaveLength(2);
    expect(new Set((snapshot.items as SmartFlowAlertEvent[]).map((item) => item.alert_id))).toEqual(
      new Set(["smartflow:alert:SPY", "smartflow:alert:QQQ"])
    );
    expect(snapshot.watermark).toEqual({ ts: now, seq: 7 });
  });

  it("composes durable option and alert row models from cached live windows", async () => {
    const now = Date.now();
    const manager = new LiveStateManager(makeClickHouse(), null);
    const optionPrint = {
      source_ts: now + 5,
      ingest_ts: now + 6,
      seq: 8,
      trace_id: "print:7",
      ts: now + 5,
      option_contract_id: "SPY-2025-01-17-450-C",
      underlying_id: "SPY",
      option_type: "call",
      price: 1.25,
      size: 10,
      exchange: "X",
      notional: 12_500,
      nbbo_side: "A",
      signal_pass: true,
      signal_reasons: ["large_print"],
      signal_profile: "balanced",
      execution_nbbo_bid: 1.2,
      execution_nbbo_ask: 1.3,
      execution_nbbo_mid: 1.25,
      execution_nbbo_age_ms: 12,
      execution_underlying_spot: 450.1
    };
    const flowPacket = {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 7,
      trace_id: "flowpacket:7",
      id: "flowpacket:7",
      members: ["print:7"],
      features: {
        option_contract_id: "SPY-2025-01-17-450-C"
      },
      join_quality: {}
    };
    const smartFlow = makeSmartFlowProjection(now + 12);
    const alert = smartFlowAlertFromProjection(smartFlow, {
      alert_id: "smartflow:alert:7",
      trace_id: "smartflow:alert:7"
    });
    expect(alert).not.toBeNull();

    await manager.ingest("flow", flowPacket);
    await manager.ingest("options", optionPrint);
    await manager.ingest("smart-flow", smartFlow);
    await manager.ingest("smart-flow-alerts", alert);

    const snapshot = await manager.getSnapshot({
      channel: "durable-rows",
      lanes: ["options", "alerts"],
      snapshot_limit: 10
    });
    const rows = snapshot.items as Array<Record<string, any>>;
    const optionRow = rows.find((row) => row.lane === "options");
    const alertRow = rows.find((row) => row.lane === "alerts");

    expect(optionRow?.support.packet.id).toBe("flowpacket:7");
    expect(optionRow?.support.smart_flow.source_channel).toBe("smart-flow");
    expect(optionRow?.support.smart_flow.refs.evidence_refs).toEqual(["flowpacket:7", "print:7"]);
    expect(optionRow?.option.nbbo.source).toBe("print");
    expect(alertRow?.evidence.primary_packet.id).toBe("flowpacket:7");
    expect(alertRow?.evidence.preview_prints[0]?.trace_id).toBe("print:7");

    const deltaRows = manager.composeDurableRowsForEvent(
      { channel: "durable-rows", lanes: ["options"], snapshot_limit: 10 },
      "smart-flow",
      smartFlow
    );
    expect(deltaRows).toHaveLength(1);
    expect((deltaRows[0] as any).support.smart_flow.source_channel).toBe("smart-flow");
  });

  it("resolves durable support after subscription filtering before the resolver trace cap", async () => {
    const now = Date.now();
    const targetContract = "TARGET-2025-01-17-450-C";
    const manager = new LiveStateManager(makeClickHouse(), null, {
      options: 300,
      nbbo: 1000,
      equities: 1000,
      "equity-quotes": 500,
      "equity-joins": 500,
      flow: 300,
      "smart-flow": 300,
      "smart-flow-alerts": 300,
      "inferred-dark": 300,
      news: 100
    });

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "print:target",
      ts: now,
      option_contract_id: targetContract,
      underlying_id: "TARGET",
      option_type: "call",
      price: 1.25,
      size: 10,
      exchange: "X",
      notional: 12_500
    });
    for (let index = 0; index < 260; index += 1) {
      await manager.ingest("options", {
        source_ts: now + 1_000 + index,
        ingest_ts: now + 1_001 + index,
        seq: 10 + index,
        trace_id: `print:decoy:${index}`,
        ts: now + 1_000 + index,
        option_contract_id: "SPY-2025-01-17-450-C",
        underlying_id: "SPY",
        option_type: "call",
        price: 1,
        size: 1,
        exchange: "X",
        notional: 100
      });
    }

    const packet = {
      source_ts: now + 2,
      ingest_ts: now + 3,
      seq: 2,
      trace_id: "flowpacket:target",
      id: "flowpacket:target",
      members: ["print:target"],
      features: {
        option_contract_id: targetContract
      },
      join_quality: {}
    };
    const smartFlow = makeSmartFlowProjection(now + 4, {
      packetIds: ["flowpacket:target"],
      printIds: ["print:target"],
      underlyingId: "TARGET"
    });

    await manager.ingest("flow", packet);
    await manager.ingest("smart-flow", smartFlow);

    const snapshot = await manager.getSnapshot({
      channel: "durable-rows",
      lanes: ["options"],
      option_contract_id: targetContract,
      snapshot_limit: 10
    });
    const [row] = snapshot.items as Array<Record<string, any>>;

    expect(snapshot.items).toHaveLength(1);
    expect(row?.option.trace_id).toBe("print:target");
    expect(row?.support.smart_flow_status).toBe("matched");
    expect(row?.support.smart_flow.projection_trace_id).toBe(smartFlow.trace_id);
  });

  it("reorders out-of-order live events without dropping newest-first semantics", async () => {
    const now = Date.now();
    const manager = new LiveStateManager(makeClickHouse(), null, {
      limits: {
        options: 1000,
        nbbo: 1000,
        equities: 1000,
        "equity-quotes": 500,
        "equity-joins": 500,
        flow: 3,
        "smart-flow": 300,
        "smart-flow-alerts": 300,
        "inferred-dark": 300
      },
      scopedCacheMaxKeys: 32,
      redisFlushIntervalMs: 250,
      redisFlushMaxItems: 100
    });

    await manager.ingest("flow", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 2,
      trace_id: "flow-2",
      id: "flow-2",
      members: [],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now - 1_000,
      ingest_ts: now - 999,
      seq: 1,
      trace_id: "flow-1",
      id: "flow-1",
      members: [],
      features: {},
      join_quality: {}
    });

    const snapshot = await manager.getSnapshot({ channel: "flow" });
    expect((snapshot.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "flow-2",
      "flow-1"
    ]);
    expect(manager.getStatsSnapshot().outOfOrderEvents).toBe(1);
  });

  it("evicts least-recently-used scoped candle caches past the configured key limit", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null, {
      limits: resolveGenericLiveLimits(),
      scopedCacheMaxKeys: 1,
      redisFlushIntervalMs: 250,
      redisFlushMaxItems: 100
    });

    await manager.ingest("equity-candles", {
      source_ts: 100,
      ingest_ts: 101,
      seq: 1,
      trace_id: "candle:SPY:60000:100",
      ts: 100,
      interval_ms: 60000,
      underlying_id: "SPY",
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      volume: 10,
      trade_count: 1
    });
    await manager.ingest("equity-candles", {
      source_ts: 200,
      ingest_ts: 201,
      seq: 2,
      trace_id: "candle:QQQ:60000:200",
      ts: 200,
      interval_ms: 60000,
      underlying_id: "QQQ",
      open: 3,
      high: 4,
      low: 3,
      close: 4,
      volume: 20,
      trade_count: 2
    });

    const qqqSnapshot = await manager.getSnapshot({
      channel: "equity-candles",
      underlying_id: "QQQ",
      interval_ms: 60000
    });
    const spySnapshot = await manager.getSnapshot({
      channel: "equity-candles",
      underlying_id: "SPY",
      interval_ms: 60000
    });

    expect(qqqSnapshot.items).toHaveLength(1);
    expect(spySnapshot.items).toEqual([]);
    expect(manager.getStatsSnapshot().cacheEvictions).toBeGreaterThan(0);
  });

  it("filters option and flow snapshots using subscription filters", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "opt-1",
      ts: now,
      option_contract_id: "AAPL-2025-01-17-200-C",
      price: 1,
      size: 100,
      exchange: "X",
      underlying_id: "AAPL",
      option_type: "call",
      notional: 10000,
      nbbo_side: "A",
      is_etf: false,
      signal_pass: true,
      signal_reasons: ["keep:ask-side"],
      signal_profile: "smart-flow"
    });
    await manager.ingest("options", {
      source_ts: now + 10,
      ingest_ts: now + 11,
      seq: 2,
      trace_id: "opt-2",
      ts: now + 10,
      option_contract_id: "SPY-2025-01-17-500-P",
      price: 1,
      size: 100,
      exchange: "X",
      underlying_id: "SPY",
      option_type: "put",
      notional: 10000,
      nbbo_side: "B",
      is_etf: true,
      signal_pass: true,
      signal_reasons: ["keep:ask-side"],
      signal_profile: "smart-flow"
    });
    await manager.ingest("flow", {
      source_ts: now + 20,
      ingest_ts: now + 21,
      seq: 3,
      trace_id: "flow-1",
      id: "flow-1",
      members: ["opt-1"],
      features: {
        option_contract_id: "AAPL-2025-01-17-200-C",
        total_notional: 10000,
        is_etf: false,
        option_type: "call",
        nbbo_a_count: 1,
        nbbo_aa_count: 0,
        nbbo_mid_count: 0,
        nbbo_b_count: 0,
        nbbo_bb_count: 0,
        nbbo_missing_count: 0,
        nbbo_stale_count: 0
      },
      join_quality: {}
    });

    const optionSnapshot = await manager.getSnapshot({
      channel: "options",
      filters: { securityTypes: ["stock"], nbboSides: ["A"], optionTypes: ["call"] }
    });
    const flowSnapshot = await manager.getSnapshot({
      channel: "flow",
      filters: { securityTypes: ["stock"], nbboSides: ["A"], optionTypes: ["call"] }
    });

    expect(optionSnapshot.items).toHaveLength(1);
    expect(flowSnapshot.items).toHaveLength(1);
  });

  it("keeps stale persisted items in live snapshots", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now - 20_000,
      ingest_ts: now - 19_999,
      seq: 1,
      trace_id: "opt-stale",
      ts: now - 20_000,
      option_contract_id: "AAPL-2025-01-17-200-C",
      price: 1,
      size: 10,
      exchange: "X"
    });
    await manager.ingest("options", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "opt-fresh",
      ts: now - 5_000,
      option_contract_id: "AAPL-2025-01-17-205-C",
      price: 1,
      size: 10,
      exchange: "X"
    });

    await manager.ingest("nbbo", {
      source_ts: now - 20_000,
      ingest_ts: now - 19_999,
      seq: 1,
      trace_id: "nbbo-stale",
      ts: now - 20_000,
      option_contract_id: "AAPL-2025-01-17-200-C",
      bid: 1,
      ask: 1.1,
      bidSize: 10,
      askSize: 10
    });
    await manager.ingest("nbbo", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "nbbo-fresh",
      ts: now - 5_000,
      option_contract_id: "AAPL-2025-01-17-205-C",
      bid: 1,
      ask: 1.1,
      bidSize: 10,
      askSize: 10
    });

    await manager.ingest("equities", {
      source_ts: now - 20_000,
      ingest_ts: now - 19_999,
      seq: 1,
      trace_id: "eq-stale",
      ts: now - 20_000,
      underlying_id: "AAPL",
      price: 100,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });
    await manager.ingest("equities", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "eq-fresh",
      ts: now - 5_000,
      underlying_id: "AAPL",
      price: 101,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });

    await manager.ingest("flow", {
      source_ts: now - 40_000,
      ingest_ts: now - 39_999,
      seq: 1,
      trace_id: "flow-stale",
      id: "flow-stale",
      members: ["opt-stale"],
      features: {},
      join_quality: {}
    });
    await manager.ingest("flow", {
      source_ts: now - 5_000,
      ingest_ts: now - 4_999,
      seq: 2,
      trace_id: "flow-fresh",
      id: "flow-fresh",
      members: ["opt-fresh"],
      features: {},
      join_quality: {}
    });

    const [optionsSnapshot, nbboSnapshot, equitiesSnapshot, flowSnapshot] = await Promise.all([
      manager.getSnapshot({ channel: "options" }),
      manager.getSnapshot({ channel: "nbbo" }),
      manager.getSnapshot({ channel: "equities" }),
      manager.getSnapshot({ channel: "flow" })
    ]);

    expect(
      (optionsSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)
    ).toEqual(["opt-fresh", "opt-stale"]);
    expect(
      (nbboSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)
    ).toEqual(["nbbo-fresh", "nbbo-stale"]);
    expect(
      (equitiesSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)
    ).toEqual(["eq-fresh", "eq-stale"]);
    expect((flowSnapshot.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "flow-fresh",
      "flow-stale"
    ]);
  });

  it("caps generic options snapshots at the 100-row hot head by default", async () => {
    const manager = new LiveStateManager(
      makeClickHouse(),
      null,
      resolveLiveStateConfig({} as NodeJS.ProcessEnv)
    );
    const now = Date.now();

    for (let seq = 1; seq <= 150; seq += 1) {
      await manager.ingest("options", {
        source_ts: now + seq,
        ingest_ts: now + seq,
        seq,
        trace_id: `opt-${seq}`,
        ts: now + seq,
        option_contract_id: "AAPL-2025-01-17-200-C",
        price: 1,
        size: 10,
        exchange: "X",
        signal_pass: true
      });
    }

    const snapshot = await manager.getSnapshot({ channel: "options" });

    expect(snapshot.items).toHaveLength(100);
    expect((snapshot.items as Array<{ trace_id: string }>)[0].trace_id).toBe("opt-150");
    expect(snapshot.next_before).toEqual({ ts: now + 51, seq: 51 });
  });

  it("seeds scoped option snapshots from clickhouse rows older than 24h", async () => {
    const now = Date.now();
    const staleTs = now - 25 * 60 * 60 * 1000;
    const manager = new LiveStateManager(
      makeClickHouse((query) =>
        query.includes("FROM option_prints")
          ? [
              {
                source_ts: staleTs,
                ingest_ts: staleTs + 1,
                seq: 1,
                trace_id: "opt-ancient",
                ts: staleTs,
                option_contract_id: "AAPL-2025-01-17-200-C",
                underlying_id: "AAPL",
                price: 1,
                size: 10,
                exchange: "X",
                signal_pass: true
              }
            ]
          : []
      ),
      null
    );

    const snapshot = await manager.getSnapshot({
      channel: "options",
      underlying_ids: ["AAPL"],
      option_contract_id: "AAPL-2025-01-17-200-C"
    });

    expect((snapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)).toEqual([
      "opt-ancient"
    ]);
    expect(snapshot.next_before).toEqual({ ts: staleTs, seq: 1 });
    expect(isLiveItemFresh("options", snapshot.items[0], now)).toBe(false);
  });

  it("builds raw contract-only snapshot filters for focused option subscriptions", () => {
    expect(
      buildOptionSnapshotFilters({
        channel: "options",
        filters: {
          view: "signal",
          minNotional: 500_000,
          nbboSides: ["A"],
          optionTypes: ["call"],
          securityTypes: ["stock"]
        },
        underlying_ids: ["AAPL"],
        option_contract_id: "AAPL-2025-01-17-200-C"
      })
    ).toEqual({
      view: "raw",
      optionContractId: "AAPL-2025-01-17-200-C"
    });
  });

  it("returns raw contract rows for focused option snapshots even when broad filters would reject them", async () => {
    const manager = new LiveStateManager(
      makeClickHouse((query) => {
        expect(query).toContain("option_contract_id = 'AAPL-2025-01-17-200-C'");
        expect(query).not.toContain("signal_pass = 1");
        expect(query).not.toContain("notional >=");
        expect(query).not.toContain("nbbo_side IN");
        expect(query).not.toContain("option_type IN");
        return [
          {
            source_ts: 1_000,
            ingest_ts: 1_001,
            seq: 1,
            trace_id: "opt-raw",
            ts: 1_000,
            option_contract_id: "AAPL-2025-01-17-200-C",
            underlying_id: "AAPL",
            option_type: "put",
            nbbo_side: "B",
            notional: 50_000,
            signal_pass: false,
            price: 1,
            size: 5,
            exchange: "X"
          }
        ];
      }),
      null
    );

    const snapshot = await manager.getSnapshot({
      channel: "options",
      filters: {
        view: "signal",
        minNotional: 500_000,
        nbboSides: ["A"],
        optionTypes: ["call"],
        securityTypes: ["stock"]
      },
      underlying_ids: ["AAPL"],
      option_contract_id: "AAPL-2025-01-17-200-C"
    });

    expect((snapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)).toEqual([
      "opt-raw"
    ]);
  });

  it("prefers cached scoped option rows before clickhouse backfill", async () => {
    const now = Date.now();
    const manager = new LiveStateManager(
      makeClickHouse((query) =>
        query.includes("FROM option_prints")
          ? [
              {
                source_ts: now - 1_000,
                ingest_ts: now - 999,
                seq: 1,
                trace_id: "opt-backfill",
                ts: now - 1_000,
                option_contract_id: "AAPL-2025-01-17-200-C",
                underlying_id: "AAPL",
                price: 1,
                size: 10,
                exchange: "X",
                signal_pass: false
              }
            ]
          : []
      ),
      null
    );

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 2,
      trace_id: "opt-hot",
      ts: now,
      option_contract_id: "AAPL-2025-01-17-200-C",
      underlying_id: "AAPL",
      price: 2,
      size: 10,
      exchange: "X",
      signal_pass: true
    });

    const snapshot = await manager.getSnapshot({
      channel: "options",
      underlying_ids: ["AAPL"],
      option_contract_id: "AAPL-2025-01-17-200-C"
    });

    expect(
      (snapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id).slice(0, 2)
    ).toEqual(["opt-hot", "opt-backfill"]);
  });

  it("seeds scoped equity snapshots from clickhouse rows older than 24h", async () => {
    const now = Date.now();
    const staleTs = now - 25 * 60 * 60 * 1000;
    const manager = new LiveStateManager(
      makeClickHouse((query) =>
        query.includes("FROM equity_prints")
          ? [
              {
                source_ts: staleTs,
                ingest_ts: staleTs + 1,
                seq: 1,
                trace_id: "eq-ancient",
                ts: staleTs,
                underlying_id: "AAPL",
                price: 100,
                size: 10,
                exchange: "X",
                offExchangeFlag: false
              }
            ]
          : []
      ),
      null
    );

    const snapshot = await manager.getSnapshot({
      channel: "equities",
      underlying_ids: ["AAPL"]
    });

    expect((snapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)).toEqual([
      "eq-ancient"
    ]);
    expect(snapshot.next_before).toEqual({ ts: staleTs, seq: 1 });
    expect(isLiveItemFresh("equities", snapshot.items[0], now)).toBe(false);
  });

  it("hydrates retained rows older than 24h into generic live snapshots and keeps them stale", async () => {
    const redis = makeRedis();
    const now = Date.now();
    const staleTs = now - 25 * 60 * 60 * 1000;

    await redis.lPush(
      "live:options",
      JSON.stringify({
        source_ts: staleTs,
        ingest_ts: staleTs + 1,
        seq: 1,
        trace_id: "opt-retained",
        ts: staleTs,
        option_contract_id: "AAPL-2025-01-17-200-C",
        underlying_id: "AAPL",
        price: 1,
        size: 10,
        exchange: "X",
        signal_pass: true
      })
    );
    await redis.hSet("live:cursors", "options", JSON.stringify({ ts: staleTs, seq: 1 }));

    await redis.lPush(
      "live:equities",
      JSON.stringify({
        source_ts: staleTs,
        ingest_ts: staleTs + 1,
        seq: 2,
        trace_id: "eq-retained",
        ts: staleTs,
        underlying_id: "AAPL",
        price: 100,
        size: 10,
        exchange: "X",
        offExchangeFlag: false
      })
    );
    await redis.hSet("live:cursors", "equities", JSON.stringify({ ts: staleTs, seq: 2 }));

    await redis.lPush(
      "live:flow",
      JSON.stringify({
        source_ts: staleTs,
        ingest_ts: staleTs + 1,
        seq: 3,
        trace_id: "flow-retained",
        id: "flow-retained",
        members: ["opt-retained"],
        features: {},
        join_quality: {}
      })
    );
    await redis.hSet("live:cursors", "flow", JSON.stringify({ ts: staleTs, seq: 3 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();

    const [optionsSnapshot, equitiesSnapshot, flowSnapshot] = await Promise.all([
      manager.getSnapshot({ channel: "options" }),
      manager.getSnapshot({ channel: "equities" }),
      manager.getSnapshot({ channel: "flow" })
    ]);

    expect(
      (optionsSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)
    ).toEqual(["opt-retained"]);
    expect(
      (equitiesSnapshot.items as Array<{ trace_id: string }>).map((item) => item.trace_id)
    ).toEqual(["eq-retained"]);
    expect((flowSnapshot.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "flow-retained"
    ]);
    expect(isLiveItemFresh("options", optionsSnapshot.items[0], now)).toBe(false);
    expect(isLiveItemFresh("equities", equitiesSnapshot.items[0], now)).toBe(false);
    expect(isLiveItemFresh("flow", flowSnapshot.items[0], now)).toBe(false);
  });

  it("keeps only the newest NBBO quote per contract across hydrate and ingest", async () => {
    const redis = makeRedis();
    const now = Date.now();

    await redis.lPush(
      "live:nbbo",
      JSON.stringify({
        source_ts: now - 2_000,
        ingest_ts: now - 1_999,
        seq: 1,
        trace_id: "nbbo-old",
        ts: now - 2_000,
        option_contract_id: "AAPL-2025-01-17-200-C",
        bid: 1,
        ask: 1.1,
        bidSize: 10,
        askSize: 10
      })
    );
    await redis.lPush(
      "live:nbbo",
      JSON.stringify({
        source_ts: now - 1_000,
        ingest_ts: now - 999,
        seq: 2,
        trace_id: "nbbo-new",
        ts: now - 1_000,
        option_contract_id: "AAPL-2025-01-17-200-C",
        bid: 1.2,
        ask: 1.3,
        bidSize: 12,
        askSize: 12
      })
    );
    await redis.lPush(
      "live:nbbo",
      JSON.stringify({
        source_ts: now - 500,
        ingest_ts: now - 499,
        seq: 3,
        trace_id: "nbbo-other",
        ts: now - 500,
        option_contract_id: "MSFT-2025-01-17-300-C",
        bid: 2,
        ask: 2.1,
        bidSize: 15,
        askSize: 15
      })
    );
    await redis.hSet("live:cursors", "nbbo", JSON.stringify({ ts: now - 500, seq: 3 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();

    await manager.ingest("nbbo", {
      source_ts: now - 250,
      ingest_ts: now - 249,
      seq: 4,
      trace_id: "nbbo-latest",
      ts: now - 250,
      option_contract_id: "AAPL-2025-01-17-200-C",
      bid: 1.4,
      ask: 1.5,
      bidSize: 14,
      askSize: 14
    });

    const snapshot = await manager.getSnapshot({ channel: "nbbo" });
    expect(snapshot.items).toHaveLength(2);
    expect(
      (snapshot.items as Array<{ option_contract_id: string; trace_id: string }>).map((item) => [
        item.option_contract_id,
        item.trace_id
      ])
    ).toEqual([
      ["AAPL-2025-01-17-200-C", "nbbo-latest"],
      ["MSFT-2025-01-17-300-C", "nbbo-other"]
    ]);
  });

  it("stores older valid ingest for freshness-gated channels", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("equities", {
      source_ts: now - 60_000,
      ingest_ts: now - 59_999,
      seq: 1,
      trace_id: "eq-stale",
      ts: now - 60_000,
      underlying_id: "AAPL",
      price: 100,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });

    const snapshot = await manager.getSnapshot({ channel: "equities" });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.next_before).toEqual({ ts: now - 60_000, seq: 1 });
  });

  it("hydrates equity quotes from redis", async () => {
    const redis = makeRedis();
    const now = Date.now();
    await redis.lPush(
      "live:equity-quotes",
      JSON.stringify({
        source_ts: now,
        ingest_ts: now + 1,
        seq: 1,
        trace_id: "quote-1",
        ts: now,
        underlying_id: "SPY",
        bid: 450,
        ask: 450.01
      })
    );
    await redis.hSet("live:cursors", "equity-quotes", JSON.stringify({ ts: now, seq: 1 }));

    const manager = new LiveStateManager(makeClickHouse(), redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "equity-quotes" });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 1 });
    expect(snapshot.next_before).toEqual({ ts: now, seq: 1 });
  });

  it("hydrates equity quotes from clickhouse when redis is empty and persists hot cache", async () => {
    const redis = makeRedis();
    const now = Date.now();
    const clickhouse = {
      ...makeClickHouse(),
      query: async ({ query }: { query: string }) => ({
        async json<T>() {
          if (query.includes("equity_quotes")) {
            return [
              {
                source_ts: now,
                ingest_ts: now + 1,
                seq: 2,
                trace_id: "quote-2",
                ts: now,
                underlying_id: "SPY",
                bid: 451,
                ask: 451.01
              }
            ] as T;
          }
          return [] as T;
        }
      })
    } as ClickHouseClient;

    const manager = new LiveStateManager(clickhouse, redis as never);
    await manager.hydrate();
    const snapshot = await manager.getSnapshot({ channel: "equity-quotes" });
    const persisted = await redis.lRange("live:equity-quotes", 0, 10);

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.watermark).toEqual({ ts: now, seq: 2 });
    expect(persisted).toHaveLength(1);
  });

  it("includes hot-channel health for options, nbbo, equities, and flow", async () => {
    const manager = new LiveStateManager(makeClickHouse(), null);
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "opt-health",
      ts: now,
      option_contract_id: "AAPL-2025-01-17-200-C",
      price: 1,
      size: 10,
      exchange: "X"
    });
    await manager.ingest("nbbo", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "nbbo-health",
      ts: now,
      option_contract_id: "AAPL-2025-01-17-200-C",
      bid: 1,
      ask: 1.1,
      bidSize: 10,
      askSize: 10
    });
    await manager.ingest("equities", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "eq-health",
      ts: now,
      underlying_id: "AAPL",
      price: 100,
      size: 10,
      exchange: "X",
      offExchangeFlag: false
    });
    await manager.ingest("flow", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "flow-health",
      id: "flow-health",
      members: [],
      features: {},
      join_quality: {}
    });

    const health = manager.getHotChannelHealth();
    expect(health.options.healthy).toBe(true);
    expect(health.nbbo.healthy).toBe(true);
    expect(health.equities.healthy).toBe(true);
    expect(health.flow.healthy).toBe(true);
    expect(health.options.freshness_age_ms).not.toBeNull();
    expect(health.nbbo.freshness_age_ms).not.toBeNull();
    expect(health.equities.freshness_age_ms).not.toBeNull();
    expect(health.flow.freshness_age_ms).not.toBeNull();
  });

  it("tracks generic cache and scoped clickhouse snapshot sources separately", async () => {
    const manager = new LiveStateManager(
      makeClickHouse(() => []),
      null
    );
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "opt-snapshot",
      ts: now,
      option_contract_id: "SPY-2025-01-17-500-C",
      price: 1,
      size: 10,
      exchange: "X"
    });

    await manager.getSnapshot({ channel: "options" });
    await manager.getSnapshot({
      channel: "options",
      underlying_ids: ["QQQ"],
      option_contract_id: "QQQ-2025-01-17-400-C"
    });

    const stats = manager.getStatsSnapshot();
    expect(stats.genericCacheSnapshots).toBe(1);
    expect(stats.scopedClickHouseSnapshots).toBe(1);
  });

  it("keeps backend channel health healthy when a scoped query is quiet", async () => {
    const manager = new LiveStateManager(
      makeClickHouse(() => []),
      null
    );
    const now = Date.now();

    await manager.ingest("options", {
      source_ts: now,
      ingest_ts: now + 1,
      seq: 1,
      trace_id: "opt-global",
      ts: now,
      option_contract_id: "SPY-2025-01-17-500-C",
      price: 1,
      size: 10,
      exchange: "X"
    });

    const quietSnapshot = await manager.getSnapshot({
      channel: "options",
      underlying_ids: ["QQQ"],
      option_contract_id: "QQQ-2025-01-17-400-C"
    });

    expect(quietSnapshot.items).toEqual([]);
    expect(manager.getHotChannelHealth().options.healthy).toBe(true);
    expect(
      manager.getStatsSnapshot().freshnessAgeMsByKey[HOT_LIVE_REDIS_KEYS.options]
    ).toBeLessThanOrEqual(50);
  });

  it("exposes freshness helper for feed status", () => {
    expect(isLiveItemFresh("options", { ts: 1000 }, 1010)).toBe(true);
    expect(isLiveItemFresh("options", { ts: 1000 }, 20_001)).toBe(false);
    expect(isLiveItemFresh("equity-joins", { source_ts: 1 }, 1_000_000)).toBe(true);
  });

  it("gates live feed fanout to the rolling visibility window", () => {
    const now = Date.now();
    expect(shouldFanoutLiveEvent("options", { ts: now })).toBe(true);
    expect(shouldFanoutLiveEvent("equities", { ts: now - 25 * 60 * 60 * 1000 })).toBe(false);
    expect(shouldFanoutLiveEvent("flow", { source_ts: now - 25 * 60 * 60 * 1000 })).toBe(false);
    expect(shouldFanoutLiveEvent("equity-candles", { ts: 1000 })).toBe(true);
  });
});
