import { describe, expect, it } from "bun:test";

import {
  HydrationScheduler,
  stableHydrationKey,
  stableOptionSupportNbboKey
} from "./hydration-scheduler";

process.env.NEXT_PUBLIC_API_URL = "https://api.test";

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });

const makeOptionPrint = (traceId: string) =>
  ({
    trace_id: traceId,
    option_contract_id: "SPY-2026-06-26-500-C",
    underlying_id: "SPY",
    option_type: "call",
    ts: 1,
    source_ts: 1,
    ingest_ts: 1,
    seq: 1,
    price: 1,
    size: 1,
    notional: 100,
    exchange: "X"
  }) as any;

const makeFlowPacket = (id: string, members: string[]) =>
  ({
    id,
    trace_id: id,
    members,
    source_ts: 1,
    ingest_ts: 1,
    seq: 1,
    features: {},
    join_quality: {}
  }) as any;

const makeSmartFlowProjection = (packetId: string, traceId = "smartflow:1") =>
  ({
    trace_id: traceId,
    source_ts: 1,
    ingest_ts: 1,
    seq: 1,
    refs: {
      trace_id: traceId,
      event_id: "smartflow:event:1",
      hypothesis_id: "hypothesis:1",
      insight_id: "smartflow:insight:1",
      cluster_id: packetId,
      candidate_ids: [`candidate:${packetId}`],
      evidence_refs: [packetId, "print:1"]
    },
    evidence: {
      evidence_refs: [packetId, "print:1"],
      evidence_quality: 0.82,
      penalties: []
    },
    hypothesis: {
      evidence_refs: [packetId, "print:1"]
    }
  }) as any;

const makeSmartFlowSupportResolution = (packet: any, smartFlow: any) => ({
  packet,
  smart_flow_status: "matched",
  smart_flow: {
    status: "matched",
    source_channel: "smart-flow",
    projection_id: smartFlow.refs.event_id,
    projection_trace_id: smartFlow.trace_id,
    packet_id: packet.id,
    match_source: "packet_member",
    tint_eligible: true,
    hypothesis_type: "directional_accumulation",
    direction: "bullish",
    confidence: 0.82,
    evidence_quality: 0.82,
    abstained: false,
    refs: {
      evidence_refs: smartFlow.refs.evidence_refs,
      packet_refs: [packet.id],
      option_print_refs: ["print:1"]
    },
    counts: {
      evidence_refs: smartFlow.refs.evidence_refs.length,
      flow_packets: 1,
      option_prints: 1
    }
  }
});

describe("hydration scheduler keys", () => {
  it("builds stable sorted keys for missing ids and nbbo context", () => {
    expect(stableHydrationKey(["b", "a", "a", " "])).toBe("a\nb");
    expect(
      stableOptionSupportNbboKey([
        { trace_id: "print:2", option_contract_id: "SPY-2026-06-26-500-C", ts: 20 },
        { trace_id: "print:1", option_contract_id: "SPY-2026-06-26-500-C", ts: 10 }
      ])
    ).toBe("print:1\tSPY-2026-06-26-500-C\t10\nprint:2\tSPY-2026-06-26-500-C\t20");
  });
});

describe("HydrationScheduler", () => {
  it("batches duplicate option print lookups and reuses in-flight work", async () => {
    const requests: URL[] = [];
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      fetcher: async (input, init) => {
        expect(init?.signal).toBeUndefined();
        const url = new URL(String(input));
        requests.push(url);
        return jsonResponse({
          data: url.searchParams.getAll("trace_id").map((traceId) => makeOptionPrint(traceId))
        });
      }
    });

    const [left, right] = await Promise.all([
      scheduler.requestOptionPrints(["b", "a", "a"]),
      scheduler.requestOptionPrints(["a"])
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/option-prints/by-trace");
    expect(requests[0]?.searchParams.getAll("trace_id")).toEqual(["a", "b"]);
    expect(left.prints.map((print) => print.trace_id)).toEqual(["a", "b"]);
    expect(right.prints.map((print) => print.trace_id)).toEqual(["a"]);
  });

  it("negative-caches empty option print lookups until the miss ttl expires", async () => {
    let now = 0;
    let requestCount = 0;
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      negativeTtlMs: 50,
      now: () => now,
      fetcher: async () => {
        requestCount += 1;
        return jsonResponse({ data: [] });
      }
    });

    await scheduler.requestOptionPrints(["missing"]);
    await scheduler.requestOptionPrints(["missing"]);
    expect(requestCount).toBe(1);

    now = 51;
    await scheduler.requestOptionPrints(["missing"]);
    expect(requestCount).toBe(2);
  });

  it("negative-caches 404 option print lookups as missing evidence", async () => {
    let requestCount = 0;
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      negativeTtlMs: 50,
      fetcher: async () => {
        requestCount += 1;
        return jsonResponse({ error: "not found" }, 404);
      }
    });

    await expect(scheduler.requestOptionPrints(["missing"])).resolves.toEqual({
      prints: [],
      missingTraceIds: ["missing"]
    });
    await scheduler.requestOptionPrints(["missing"]);
    expect(requestCount).toBe(1);
  });

  it("backs off failed option print endpoints instead of spinning", async () => {
    let now = 0;
    let requestCount = 0;
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      backoffBaseMs: 1_000,
      now: () => now,
      fetcher: async () => {
        requestCount += 1;
        return new Response("unavailable", { status: 503 });
      }
    });

    await expect(scheduler.requestOptionPrints(["a"])).rejects.toThrow("HTTP 503");
    await expect(scheduler.requestOptionPrints(["b"])).resolves.toEqual({
      prints: [],
      missingTraceIds: ["b"]
    });
    expect(requestCount).toBe(1);

    now = 1_001;
    await expect(scheduler.requestOptionPrints(["c"])).rejects.toThrow("HTTP 503");
    expect(requestCount).toBe(2);
  });

  it("fetches flow packets with bounded parallelism", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      flowPacketBatchSize: 2,
      fetcher: async (input) => {
        const url = new URL(String(input));
        const packetId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        started.push(packetId);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return jsonResponse({ data: makeFlowPacket(packetId, []) });
      }
    });

    const request = scheduler.requestFlowPackets(["flowpacket:1", "flowpacket:2"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual(["flowpacket:1", "flowpacket:2"]);
    for (const release of releases) {
      release();
    }
    await expect(request).resolves.toMatchObject({
      missingPacketIds: [],
      packets: [{ id: "flowpacket:1" }, { id: "flowpacket:2" }]
    });
  });

  it("batches option support requests and serves repeated traces from cache", async () => {
    const packet = makeFlowPacket("flowpacket:SPY-2026-06-26-500-C:1", ["print:1"]);
    const smartFlow = makeSmartFlowProjection(packet.id);
    let requestCount = 0;
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      fetcher: async (_input, init) => {
        requestCount += 1;
        expect(init?.method).toBe("POST");
        expect(init?.signal).toBeUndefined();
        return jsonResponse({
          packets: [packet],
          support_by_trace_id: {
            "print:1": makeSmartFlowSupportResolution(packet, smartFlow)
          },
          nbbo_by_trace_id: { "print:1": null }
        });
      }
    });

    const [left, right] = await Promise.all([
      scheduler.requestOptionSupport({
        traceIds: ["print:1"],
        nbboContext: [{ trace_id: "print:1", option_contract_id: "SPY", ts: 1 }]
      }),
      scheduler.requestOptionSupport({ traceIds: ["print:1"] })
    ]);

    expect(requestCount).toBe(1);
    expect(left.packets.map((item) => item.id)).toEqual([packet.id]);
    expect(left.smartFlowSupportByTraceId.get("print:1")?.smart_flow?.projection_trace_id).toBe(
      "smartflow:1"
    );
    expect(left.nbboByTraceId).toEqual({ "print:1": null });
    expect(right.packets.map((item) => item.id)).toEqual([packet.id]);
    expect(right.smartFlowSupportByTraceId.get("print:1")?.smart_flow_status).toBe("matched");

    await scheduler.requestOptionSupport({ traceIds: ["print:1"] });
    expect(requestCount).toBe(1);
  });

  it("does not treat cached packet membership as compact support for unrequested members", async () => {
    const packet = makeFlowPacket("flowpacket:SPY-2026-06-26-500-C:1", ["print:1", "print:2"]);
    const smartFlow = makeSmartFlowProjection(packet.id);
    const requestedTraceIds: string[][] = [];
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { trace_ids?: string[] };
        const traceIds = body.trace_ids ?? [];
        requestedTraceIds.push(traceIds);
        return jsonResponse({
          packets: [packet],
          support_by_trace_id: Object.fromEntries(
            traceIds.map((traceId) => [traceId, makeSmartFlowSupportResolution(packet, smartFlow)])
          )
        });
      }
    });

    await scheduler.requestOptionSupport({ traceIds: ["print:1"] });
    const second = await scheduler.requestOptionSupport({ traceIds: ["print:2"] });

    expect(requestedTraceIds).toEqual([["print:1"], ["print:2"]]);
    expect(second.smartFlowSupportByTraceId.get("print:2")?.smart_flow_status).toBe("matched");
  });

  it("keeps explicit unavailable smart-flow support bounded while packet support is cached", async () => {
    const packet = makeFlowPacket("flowpacket:SPY-2026-06-26-500-C:miss", ["print:missing"]);
    let requestCount = 0;
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      fetcher: async () => {
        requestCount += 1;
        return jsonResponse({
          packets: [packet],
          support_by_trace_id: {
            "print:missing": {
              packet,
              smart_flow_status: "smart_flow_unavailable",
              smart_flow_unavailable_reason:
                "no smart-flow projection references the hydrated packet or direct option print",
              smart_flow: null
            }
          }
        });
      }
    });

    const first = await scheduler.requestOptionSupport({ traceIds: ["print:missing"] });
    expect(first).toEqual({
      packets: [packet],
      smartFlowSupportByTraceId: new Map([
        [
          "print:missing",
          {
            packet,
            smart_flow_status: "smart_flow_unavailable",
            smart_flow_unavailable_reason:
              "no smart-flow projection references the hydrated packet or direct option print",
            smart_flow: null
          }
        ]
      ]),
      nbboByTraceId: {}
    });
    await scheduler.requestOptionSupport({ traceIds: ["print:missing"] });
    expect(requestCount).toBe(1);
  });

  it("retries unavailable smart-flow support after the negative ttl", async () => {
    let now = 0;
    let requestCount = 0;
    const packet = makeFlowPacket("flowpacket:SPY-2026-06-26-500-C:retry", ["print:retry"]);
    const smartFlow = makeSmartFlowProjection(packet.id);
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      negativeTtlMs: 10,
      now: () => now,
      fetcher: async () => {
        requestCount += 1;
        return jsonResponse({
          packets: [packet],
          support_by_trace_id:
            requestCount === 1
              ? {
                  "print:retry": {
                    packet,
                    smart_flow_status: "smart_flow_unavailable",
                    smart_flow_unavailable_reason:
                      "no smart-flow projection references the hydrated packet or direct option print",
                    smart_flow: null
                  }
                }
              : {
                  "print:retry": makeSmartFlowSupportResolution(packet, smartFlow)
                }
        });
      }
    });

    expect(
      (
        await scheduler.requestOptionSupport({ traceIds: ["print:retry"] })
      ).smartFlowSupportByTraceId.get("print:retry")?.smart_flow_status
    ).toBe("smart_flow_unavailable");

    now = 5;
    await scheduler.requestOptionSupport({ traceIds: ["print:retry"] });
    expect(requestCount).toBe(1);

    now = 11;
    expect(
      (
        await scheduler.requestOptionSupport({ traceIds: ["print:retry"] })
      ).smartFlowSupportByTraceId.get("print:retry")?.smart_flow_status
    ).toBe("matched");
    expect(requestCount).toBe(2);
  });

  it("keeps option support nbbo hits on the positive ttl and misses on the negative ttl", async () => {
    let now = 0;
    let requestCount = 0;
    const quote = {
      option_contract_id: "SPY-2026-06-26-500-C",
      bid: 1,
      ask: 1.1,
      bid_size: 10,
      ask_size: 12,
      ts: 1,
      source_ts: 1
    } as any;
    const scheduler = new HydrationScheduler({
      batchDelayMs: 0,
      positiveTtlMs: 100,
      negativeTtlMs: 10,
      now: () => now,
      fetcher: async (_input, init) => {
        requestCount += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          nbbo_context?: Array<{ trace_id: string }>;
        };
        const traceIds = new Set((body.nbbo_context ?? []).map((item) => item.trace_id));
        return jsonResponse({
          nbbo_by_trace_id: traceIds.has("hit") ? { hit: quote } : {}
        });
      }
    });

    await expect(
      scheduler.requestOptionSupport({
        nbboContext: [
          { trace_id: "hit", option_contract_id: "SPY", ts: 1 },
          { trace_id: "miss", option_contract_id: "SPY", ts: 1 }
        ]
      })
    ).resolves.toMatchObject({
      nbboByTraceId: { hit: quote, miss: null }
    });
    expect(requestCount).toBe(1);

    now = 11;
    await scheduler.requestOptionSupport({
      nbboContext: [{ trace_id: "hit", option_contract_id: "SPY", ts: 1 }]
    });
    expect(requestCount).toBe(1);

    await scheduler.requestOptionSupport({
      nbboContext: [{ trace_id: "miss", option_contract_id: "SPY", ts: 1 }]
    });
    expect(requestCount).toBe(2);
  });
});
