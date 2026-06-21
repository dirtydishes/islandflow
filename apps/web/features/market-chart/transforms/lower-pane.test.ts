import { describe, expect, it } from "bun:test";
import {
  buildAllFlowBars,
  buildSmartDirectionBars,
  buildVolumeBars,
  resolveLowerPaneMode
} from "./lower-pane";
import { normalizeMarketChartCandle } from "./candles";
import { toChartTime } from "./time";
import type { MarketChartCandle } from "../types";

const candle = (ts: number, volume = 100): MarketChartCandle =>
  normalizeMarketChartCandle({
    ts,
    open: 10,
    high: 12,
    low: 9,
    close: ts === 60_000 ? 11 : 9,
    volume
  });

describe("market chart lower-pane transforms", () => {
  it("builds volume bars from candle volume with direction labels", () => {
    const layer = buildVolumeBars([candle(60_000, 250), candle(120_000, 125)]);

    expect(layer).toMatchObject({
      id: "volume",
      kind: "volume",
      priceFormat: "volume",
      points: [
        {
          time: toChartTime(60_000),
          value: 250,
          direction: "bullish",
          label: "bullish volume"
        },
        {
          time: toChartTime(120_000),
          value: 125,
          direction: "bearish",
          label: "bearish volume"
        }
      ]
    });
  });

  it("prefers smart-flow projections for signed direction bars", () => {
    const buckets = [candle(60_000), candle(120_000)];
    const layer = buildSmartDirectionBars(
      [
        {
          source_ts: 65_000,
          notional: 100,
          hypothesis: { direction: "bullish" }
        },
        {
          source_ts: 125_000,
          notional: 60,
          hypothesis: { direction: "bearish" }
        }
      ],
      [
        {
          source_ts: 65_000,
          primary_direction: "bearish",
          features: { total_notional: 999 }
        }
      ],
      buckets
    );

    expect(layer.points.map((point) => point.value)).toEqual([100, -60]);
    expect(layer.points.map((point) => point.direction)).toEqual(["bullish", "bearish"]);
    expect(layer.points[0].payload).toEqual({ source: "smart-flow" });
  });

  it("falls back to legacy smart-money per bucket when smart-flow is sparse", () => {
    const buckets = [candle(60_000), candle(120_000), candle(180_000)];
    const layer = buildSmartDirectionBars(
      [
        {
          source_ts: 65_000,
          notional: 100,
          hypothesis: { direction: "bullish" }
        },
        {
          source_ts: 185_000,
          notional: 50,
          hypothesis: { direction: "bearish" }
        }
      ],
      [
        {
          source_ts: 125_000,
          primary_direction: "bearish",
          features: { total_notional: 300 }
        },
        {
          source_ts: 185_000,
          primary_direction: "bullish",
          features: { total_notional: 999 }
        }
      ],
      buckets
    );

    expect(layer.points.map((point) => point.value)).toEqual([100, -300, -50]);
    expect(layer.points.map((point) => point.payload)).toEqual([
      { source: "smart-flow" },
      { source: "legacy-smart-money" },
      { source: "smart-flow" }
    ]);
  });

  it("falls back to legacy smart-money events when smart-flow is unavailable", () => {
    const layer = buildSmartDirectionBars(
      [],
      [
        {
          source_ts: 65_000,
          primary_direction: "bearish",
          features: { total_notional: 300 }
        }
      ],
      [candle(60_000)]
    );

    expect(layer.points[0]).toMatchObject({
      value: -300,
      direction: "bearish",
      payload: { source: "legacy-smart-money" }
    });
  });

  it("aggregates all-flow packet or option-print notional by bucket", () => {
    const layer = buildAllFlowBars(
      [
        {
          source_ts: 65_000,
          features: { total_notional: 250 }
        }
      ],
      [
        {
          ts: 125_000,
          price: 2,
          size: 3
        }
      ],
      [candle(60_000), candle(120_000)]
    );

    expect(layer.points.map((point) => point.value)).toEqual([250, 600]);
    expect(layer.points.every((point) => point.direction === "neutral")).toBe(true);
  });

  it("resolves unavailable lower-pane selections to the best available mode", () => {
    expect(
      resolveLowerPaneMode(
        { lowerPane: { mode: "all-flow" } },
        { candles: true, smartDirection: true, allFlow: false }
      )
    ).toBe("smart-direction");
    expect(
      resolveLowerPaneMode(
        { lowerPane: { mode: "smart-direction" } },
        { candles: true, smartDirection: false, allFlow: true }
      )
    ).toBe("all-flow");
    expect(
      resolveLowerPaneMode(
        { lowerPane: { mode: "smart-direction" } },
        { candles: true, smartDirection: false, allFlow: false }
      )
    ).toBe("volume");
  });
});
