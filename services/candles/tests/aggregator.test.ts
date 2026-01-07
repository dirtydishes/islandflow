import { describe, expect, test } from "bun:test";
import type { EquityPrint } from "@islandflow/types";
import { CandleAggregator } from "../src/aggregator";

const buildPrint = (overrides: Partial<EquityPrint> = {}): EquityPrint => {
  const ts = overrides.ts ?? 0;
  return {
    source_ts: overrides.source_ts ?? ts,
    ingest_ts: overrides.ingest_ts ?? ts,
    seq: overrides.seq ?? 0,
    trace_id: overrides.trace_id ?? `print:${overrides.seq ?? 0}`,
    ts,
    underlying_id: overrides.underlying_id ?? "AAPL",
    price: overrides.price ?? 0,
    size: overrides.size ?? 1,
    exchange: overrides.exchange ?? "TEST",
    offExchangeFlag: overrides.offExchangeFlag ?? false
  };
};

describe("CandleAggregator", () => {
  test("emits candle with correct OHLC and volume", () => {
    const aggregator = new CandleAggregator({ intervalsMs: [1000], maxLateMs: 0 });

    const first = buildPrint({ ts: 1000, price: 10, size: 100, seq: 1 });
    const second = buildPrint({ ts: 1500, price: 12, size: 50, seq: 2 });
    const third = buildPrint({ ts: 2500, price: 11, size: 10, seq: 3 });

    expect(aggregator.ingest(first).emitted).toHaveLength(0);
    expect(aggregator.ingest(second).emitted).toHaveLength(0);

    const result = aggregator.ingest(third);
    expect(result.emitted).toHaveLength(1);

    const candle = result.emitted[0];
    expect(candle.ts).toBe(1000);
    expect(candle.open).toBe(10);
    expect(candle.high).toBe(12);
    expect(candle.low).toBe(10);
    expect(candle.close).toBe(12);
    expect(candle.volume).toBe(150);
    expect(candle.trade_count).toBe(2);
    expect(candle.seq).toBe(2);
    expect(candle.source_ts).toBe(1000);
    expect(candle.ingest_ts).toBe(1500);
  });

  test("respects open and close order with out-of-order prints", () => {
    const aggregator = new CandleAggregator({ intervalsMs: [1000], maxLateMs: 2000 });

    const late = buildPrint({ ts: 1500, price: 15, size: 10, seq: 2 });
    const early = buildPrint({ ts: 1200, price: 11, size: 20, seq: 1 });

    aggregator.ingest(late);
    aggregator.ingest(early);

    const [candle] = aggregator.drain();
    expect(candle.open).toBe(11);
    expect(candle.close).toBe(15);
    expect(candle.trade_count).toBe(2);
    expect(candle.seq).toBe(2);
    expect(candle.source_ts).toBe(1200);
    expect(candle.ingest_ts).toBe(1500);
  });

  test("drops late prints once window is closed", () => {
    const aggregator = new CandleAggregator({ intervalsMs: [1000], maxLateMs: 0 });

    const first = buildPrint({ ts: 1000, price: 10, size: 100, seq: 1 });
    const next = buildPrint({ ts: 3000, price: 14, size: 50, seq: 2 });
    const late = buildPrint({ ts: 1500, price: 9, size: 25, seq: 3 });

    aggregator.ingest(first);
    const flush = aggregator.ingest(next);
    expect(flush.emitted).toHaveLength(1);

    const lateResult = aggregator.ingest(late);
    expect(lateResult.emitted).toHaveLength(0);
    expect(lateResult.droppedLate).toBe(1);
  });
});
