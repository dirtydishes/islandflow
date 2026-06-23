import { describe, expect, it } from "bun:test";
import type { FlowPacket } from "@islandflow/types";

import {
  filterFlowPackets,
  getFlowPacketKey,
  getFlowPacketQualityLabel,
  loadFlowPacketsTapeHistoryPage,
  mapFlowPacketsTapeInspectEvent,
  normalizeFlowPacketsTapeScope,
  toFlowPacketFocusRequest
} from ".";

const makePacket = (overrides: Partial<FlowPacket> = {}): FlowPacket => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: "packet-trace-1",
  id: "packet-1",
  members: ["print-1", "print-2"],
  features: {
    option_contract_id: "SPY-2026-06-19-500-C",
    underlying_id: "SPY",
    count: 2,
    total_size: 20,
    total_premium: 1_500,
    total_notional: 150_000,
    nbbo_coverage_ratio: 0.75,
    nbbo_inside_ratio: 0.25,
    nbbo_spread: 0.05,
    nbbo_aggressive_buy_ratio: 0.7,
    nbbo_aggressive_sell_ratio: 0.1
  },
  join_quality: {
    nbbo_age_ms: 42,
    nbbo_stale: 0,
    nbbo_missing: 0
  },
  ...overrides
});

describe("flow packets tape helpers", () => {
  it("normalizes scope tickers without duplicates", () => {
    expect(
      normalizeFlowPacketsTapeScope({
        ticker: " spy ",
        tickers: ["aapl,nvda", "SPY"],
        underlyingIds: ["msft"],
        optionContractId: "SPY-2026-06-19-500-C"
      })
    ).toEqual({
      underlyingIds: ["SPY", "AAPL", "NVDA", "MSFT"],
      optionContractId: "SPY-2026-06-19-500-C"
    });
  });

  it("filters packets by scope and flow filters", () => {
    const packets = [
      makePacket({ id: "spy" }),
      makePacket({
        id: "aapl",
        features: {
          option_contract_id: "AAPL-2026-06-19-250-P",
          underlying_id: "AAPL",
          total_notional: 1_000,
          option_type: "put"
        }
      })
    ];

    expect(
      filterFlowPackets(packets, { underlyingIds: ["SPY"] }, { minNotional: 5_000 }).map(
        (packet) => packet.id
      )
    ).toEqual(["spy"]);
  });

  it("maps focus requests from packet members without terminal state", () => {
    expect(toFlowPacketFocusRequest(makePacket())).toEqual({
      packetId: "packet-1",
      memberTraceIds: ["print-1", "print-2"],
      optionContractId: "SPY-2026-06-19-500-C",
      source: "flow-packets"
    });
  });

  it("omits option contract id from focus requests when the packet has no contract feature", () => {
    expect(
      toFlowPacketFocusRequest(
        makePacket({
          id: "packet-without-contract",
          features: {
            underlying_id: "SPY",
            count: 1
          }
        })
      )
    ).toEqual({
      packetId: "packet-without-contract",
      memberTraceIds: ["print-1", "print-2"],
      source: "flow-packets"
    });
  });

  it("exhausts history when the api repeats an empty filtered cursor", async () => {
    const cursor = { ts: 1_000, seq: 1 };
    const response = await loadFlowPacketsTapeHistoryPage({
      cursor,
      scope: { underlyingIds: ["SPY"] },
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher: async () =>
          new Response(
            JSON.stringify({
              data: [
                makePacket({
                  id: "aapl",
                  features: {
                    option_contract_id: "AAPL-2026-06-19-250-C",
                    underlying_id: "AAPL"
                  }
                })
              ],
              next_before: cursor
            })
          )
      }
    });

    expect(response).toEqual({
      items: [],
      nextCursor: null,
      exhausted: true
    });
  });

  it("renders quality as explicit text labels", () => {
    expect(getFlowPacketQualityLabel(makePacket())).toBe(
      "Quote 75% | Inside 25% | Spr 0.05 | 42ms"
    );
    expect(
      getFlowPacketQualityLabel(
        makePacket({
          features: {
            option_contract_id: "SPY-2026-06-19-500-C",
            nbbo_missing_count: 1
          },
          join_quality: { nbbo_missing: 1 }
        })
      )
    ).toContain("Missing quote");
  });

  it("maps durable row focus to packet inspect callback payload", () => {
    const packet = makePacket();

    expect(
      mapFlowPacketsTapeInspectEvent({
        item: packet,
        rowKey: getFlowPacketKey(packet),
        index: 4
      })
    ).toEqual({
      packet,
      rowKey: "packet-1",
      index: 4
    });
  });
});
