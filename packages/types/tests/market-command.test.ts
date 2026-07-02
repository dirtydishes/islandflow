import { describe, expect, it } from "bun:test";
import {
  MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION,
  MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
  MarketCommandTickerRailResponseSchema
} from "../src";

describe("market-command ticker rail contract", () => {
  const payload = {
    schema_version: MARKET_COMMAND_TICKER_RAIL_SCHEMA_VERSION,
    generated_at_ts: 1_000,
    session: {
      timezone: MARKET_COMMAND_TICKER_RAIL_TIMEZONE,
      selection: "current",
      start_ts: 100,
      end_ts: 900
    },
    watchlist: ["SPY", "QQQ"],
    limit: 16,
    degraded: false,
    degraded_reasons: [],
    pinned: [
      {
        symbol: "SPY",
        source: "both",
        rank: 1,
        score: 42.5,
        price: 510.12,
        change: 1.2,
        change_pct: 0.236,
        last_ts: 850,
        reasons: [
          {
            kind: "smart_flow_alert",
            label: "Smart-flow alert bullish directional_accumulation",
            score: 38.5,
            weight: 50,
            ts: 850,
            source_id: "smartflow:alert:1"
          },
          {
            kind: "watchlist_boost",
            label: "Pinned watchlist symbol",
            score: 4,
            weight: 4,
            ts: null
          }
        ]
      }
    ],
    important: [
      {
        symbol: "NVDA",
        source: "important",
        rank: 1,
        score: 24,
        price: null,
        change: null,
        change_pct: null,
        last_ts: 820,
        reasons: [
          {
            kind: "flow_packet",
            label: "Flow packet $250k",
            score: 24,
            weight: 22,
            ts: 820,
            source_id: "flowpacket:1"
          }
        ]
      }
    ]
  };

  it("validates the public rail response payload", () => {
    expect(MarketCommandTickerRailResponseSchema.parse(payload)).toEqual(payload);
  });

  it("rejects malformed symbols, overlong limits, and extra response keys", () => {
    expect(
      MarketCommandTickerRailResponseSchema.safeParse({
        ...payload,
        watchlist: ["spy"]
      }).success
    ).toBe(false);
    expect(
      MarketCommandTickerRailResponseSchema.safeParse({
        ...payload,
        limit: 33
      }).success
    ).toBe(false);
    expect(
      MarketCommandTickerRailResponseSchema.safeParse({
        ...payload,
        extra: true
      }).success
    ).toBe(false);
  });

  it("keeps rail item reasons bounded to the top three contributors", () => {
    const tooManyReasons = {
      ...payload,
      pinned: [
        {
          ...payload.pinned[0],
          reasons: [
            ...payload.pinned[0].reasons,
            {
              kind: "news",
              label: "News",
              score: 3,
              weight: 10,
              ts: 840
            },
            {
              kind: "equity_move",
              label: "Equity move +1.00%",
              score: 2,
              weight: 12,
              ts: 830
            }
          ]
        }
      ]
    };

    expect(MarketCommandTickerRailResponseSchema.safeParse(tooManyReasons).success).toBe(false);
  });
});
