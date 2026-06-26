import { describe, expect, it } from "bun:test";
import {
  deriveCandleDirection,
  normalizeMarketChartCandle,
  toChartCandle,
  toHeikinAshiCandles
} from "./candles";
import { chartTimeToMs, formatChartTickTime, formatIntervalLabel, toChartTime } from "./time";

const normalizeSpaces = (value: string): string => value.replace(/\s+/g, " ");

describe("market chart candle transforms", () => {
  it("normalizes shared candle shape without terminal state", () => {
    const candle = normalizeMarketChartCandle({
      ts: 1_720_000_123_456,
      open: 100,
      high: 105,
      low: 98,
      close: 104,
      volume: 1200,
      notional: 124_800,
      trade_count: 17,
      seq: 9
    });

    expect(candle).toMatchObject({
      time: 1_720_000_123,
      timestampMs: 1_720_000_123_456,
      open: 100,
      high: 105,
      low: 98,
      close: 104,
      volume: 1200,
      notional: 124_800,
      tradeCount: 17,
      direction: "bullish",
      sequence: 9
    });
  });

  it("converts normalized candles to lightweight candlestick data", () => {
    expect(
      toChartCandle({
        ts: 60_000,
        open: 10,
        high: 12,
        low: 9,
        close: 9.5
      })
    ).toEqual({
      time: toChartTime(60_000),
      open: 10,
      high: 12,
      low: 9,
      close: 9.5
    });
  });

  it("derives candle direction from open and close", () => {
    expect(deriveCandleDirection(10, 11)).toBe("bullish");
    expect(deriveCandleDirection(10, 9)).toBe("bearish");
    expect(deriveCandleDirection(10, 10)).toBe("neutral");
  });

  it("builds Heikin Ashi candles without mutating source candles", () => {
    const source = [
      normalizeMarketChartCandle({
        ts: 60_000,
        open: 10,
        high: 13,
        low: 9,
        close: 12,
        volume: 100
      }),
      normalizeMarketChartCandle({
        ts: 120_000,
        open: 12,
        high: 15,
        low: 11,
        close: 14,
        volume: 150
      })
    ];

    expect(toHeikinAshiCandles(source)).toMatchObject([
      {
        time: toChartTime(60_000),
        open: 11,
        high: 13,
        low: 9,
        close: 11,
        volume: 100,
        direction: "neutral"
      },
      {
        time: toChartTime(120_000),
        open: 11,
        high: 15,
        low: 11,
        close: 13,
        volume: 150,
        direction: "bullish"
      }
    ]);
    expect(source[0].open).toBe(10);
  });

  it("formats known and ad hoc interval labels", () => {
    expect(formatIntervalLabel(60_000)).toBe("1m");
    expect(formatIntervalLabel(300_000)).toBe("5m");
    expect(formatIntervalLabel(900_000)).toBe("15m");
    expect(formatIntervalLabel(3_600_000)).toBe("1h");
    expect(formatIntervalLabel(15_000)).toBe("15s");
    expect(formatIntervalLabel(250)).toBe("250ms");
  });

  it("converts lightweight chart times back to milliseconds", () => {
    expect(chartTimeToMs(60)).toBe(60_000);
    expect(chartTimeToMs("2026-06-21T00:00:00.000Z")).toBe(Date.UTC(2026, 5, 21));
    expect(chartTimeToMs({ year: 2026, month: 6, day: 21 })).toBe(Date.UTC(2026, 5, 21));
    expect(chartTimeToMs({ year: 2026, month: 13, day: 21 })).toBeNull();
  });

  it("formats chart ticks in Eastern time", () => {
    const ts = Math.floor(Date.UTC(2026, 5, 26, 14, 30, 15) / 1000);

    expect(normalizeSpaces(formatChartTickTime(ts))).toBe("10:30 AM");
    expect(normalizeSpaces(formatChartTickTime(ts, 4))).toBe("10:30:15 AM");
    expect(formatChartTickTime(ts, 2)).toBe("Jun 26");
  });
});
