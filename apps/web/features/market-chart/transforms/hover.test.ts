import { describe, expect, it } from "bun:test";
import type { MarketChartHoverContext } from "../types";
import { normalizeMarketChartCandle } from "./candles";
import {
  aggregateOptionNotionalByDirection,
  buildDirectionalOptionNotionalRows,
  buildFlowContextHoverRows,
  buildHoverSnapshot,
  marketChartHoverSnapshotsEqual
} from "./hover";

const context = (ts = 60_000): MarketChartHoverContext => {
  const candle = normalizeMarketChartCandle({
    ts,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 24_000,
    trade_count: 42
  });

  return {
    symbol: "SPY",
    intervalMs: 60_000,
    time: candle.time,
    timestampMs: candle.timestampMs,
    bucketStartMs: candle.timestampMs,
    bucketEndMs: candle.timestampMs + 60_000,
    candle,
    lowerPoints: [],
    overlayPoints: []
  };
};

describe("market chart hover transforms", () => {
  it("emits stable core rows before extension-owned rows", () => {
    const snapshot = buildHoverSnapshot(context(), {
      extensionRows: [
        {
          id: "extension:flow",
          label: "Flow direction",
          value: "Bullish hypothesis",
          tone: "bullish",
          group: "Flow context"
        }
      ]
    });

    expect(snapshot.coreRows.map((row) => row.id)).toEqual(["time", "ohlc", "volume", "trades"]);
    expect(snapshot.rows.map((row) => row.id)).toEqual([
      "time",
      "ohlc",
      "volume",
      "trades",
      "extension:flow"
    ]);
    expect(snapshot.extensionRows[0].group).toBe("Flow context");
  });

  it("treats duplicate hover frames as equal while preserving point and row changes", () => {
    const first = buildHoverSnapshot(context(), {
      extensionRows: [
        {
          id: "extension:flow",
          label: "Flow direction",
          value: "Bullish hypothesis",
          tone: "bullish",
          group: "Flow context"
        }
      ],
      point: { x: 240, y: 110 }
    });
    const duplicate = buildHoverSnapshot(context(), {
      extensionRows: [
        {
          id: "extension:flow",
          label: "Flow direction",
          value: "Bullish hypothesis",
          tone: "bullish",
          group: "Flow context"
        }
      ],
      point: { x: 240, y: 110 }
    });
    const moved = buildHoverSnapshot(context(), {
      extensionRows: first.extensionRows,
      point: { x: 241, y: 110 }
    });
    const changedRows = buildHoverSnapshot(context(), {
      extensionRows: [
        {
          id: "extension:flow",
          label: "Flow direction",
          value: "Bearish hypothesis",
          tone: "bearish",
          group: "Flow context"
        }
      ],
      point: { x: 240, y: 110 }
    });

    expect(marketChartHoverSnapshotsEqual(first, duplicate)).toBe(true);
    expect(marketChartHoverSnapshotsEqual(first, moved)).toBe(false);
    expect(marketChartHoverSnapshotsEqual(first, changedRows)).toBe(false);
  });

  it("aggregates option notional by candle bucket and preserves unknown direction", () => {
    const summary = aggregateOptionNotionalByDirection(context(), [
      { timestampMs: 61_000, notional: 1_250, direction: "bullish" },
      { timestampMs: 62_000, price: 2, size: 3, direction: "bearish" },
      { timestampMs: 63_000, notional: 900, direction: "unknown" },
      { timestampMs: 121_000, notional: 10_000, direction: "bullish" }
    ]);

    expect(summary).toEqual({
      bullish: 1_250,
      bearish: 600,
      neutralUnknown: 900,
      count: 3
    });
  });

  it("renders neutral/unknown option notional as an explicit row", () => {
    const rows = buildDirectionalOptionNotionalRows(context(), [
      { timestampMs: 61_000, notional: 900, direction: "unknown" }
    ]);

    expect(rows.map((row) => row.label)).toEqual([
      "Bullish option notional",
      "Bearish option notional",
      "Neutral/unknown notional"
    ]);
    expect(rows[2]).toMatchObject({
      value: "$900.00",
      tone: "info",
      group: "Flow context"
    });
  });

  it("prefers smart-flow hover context over legacy fallback in the same bucket", () => {
    const rows = buildFlowContextHoverRows(context(), [
      {
        timestampMs: 62_000,
        sequence: 1,
        source: "legacy-smart-money",
        direction: "bearish",
        compatibility: true,
        label: "Institutional directional",
        confidence: 0.4
      },
      {
        timestampMs: 63_000,
        sequence: 2,
        source: "smart-flow",
        direction: "bullish",
        label: "Directional accumulation",
        evidenceQuality: "usable",
        evidenceScore: 0.61,
        confidence: 0.68,
        whyNot: "Watch: Wide quote context reduced fit."
      }
    ]);

    expect(rows.map((row) => [row.label, row.value, row.tone])).toEqual([
      ["Flow direction", "Bullish hypothesis · Directional accumulation", "bullish"],
      ["Evidence quality", "usable · 61%", "info"],
      ["Confidence", "68%", "info"],
      ["Why-not", "Watch: Wide quote context reduced fit.", "warning"]
    ]);
  });

  it("falls back to compatibility smart-money context and abstention copy", () => {
    const rows = buildFlowContextHoverRows(context(), [
      {
        timestampMs: 62_000,
        sequence: 1,
        source: "legacy-smart-money",
        direction: "abstained",
        compatibility: true,
        evidenceScore: 0.12,
        confidence: 0,
        whyNot: "Abstained: Stale Or Missing Quote Context",
        abstained: true
      }
    ]);

    expect(rows.map((row) => [row.label, row.value, row.tone])).toEqual([
      ["Flow direction", "Abstained compatibility fallback", "neutral"],
      ["Evidence quality", "thin · 12%", "warning"],
      ["Confidence", "0%", "warning"],
      ["Why-not", "Abstained: Stale Or Missing Quote Context", "warning"]
    ]);
  });
});
