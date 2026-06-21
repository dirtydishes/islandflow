import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  type EquityPrint,
  type EquityQuote
} from "@islandflow/types";
import { CandleAggregator } from "../../candles/src/aggregator";
import { createSyntheticEquitiesAdapter } from "../src/adapters/synthetic";

const FORBIDDEN_LABEL_FIELDS = ["scenario_id", "label", "hiddenLabel", "labels", "source_kind"];
const LIT_EXCHANGES = new Set(["NYSE", "NASDAQ", "ARCA", "BATS", "IEX", "MEMX"]);

describe("synthetic equities demo playback", () => {
  it("emits selected deterministic demo runs once while regular ticks produce varied SPY background prints", async () => {
    const adapter = createSyntheticEquitiesAdapter({
      emitIntervalMs: 1,
      mode: "realistic",
      getControl: () => ({
        ...DEFAULT_SYNTHETIC_CONTROL_STATE,
        demo_profile_id: "event-response",
        load_profile_id: "firehose"
      })
    });
    const prints: EquityPrint[] = [];
    const quotes: EquityQuote[] = [];
    const stop = adapter.start({
      onTrade: (print) => {
        prints.push(print);
      },
      onQuote: (quote) => {
        quotes.push(quote);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();

    expect(prints.length).toBeGreaterThan(0);
    expect(quotes.length).toBeGreaterThan(0);
    const demoPrints = prints.filter((print) => print.trace_id.includes(":live:"));
    const runIds = new Set(demoPrints.map((print) => print.trace_id.split(":live:")[0]));
    const runSerials = new Set(
      demoPrints.map((print) => print.trace_id.match(/:live:(\d+):/)?.[1])
    );
    expect(runIds.has("phase03-c")).toBe(true);
    expect(runIds.has("phase03-e")).toBe(true);
    expect(runSerials).toEqual(new Set(["1", "2"]));

    const backgroundSpyPrints = prints.filter(
      (print) => print.trace_id.startsWith("synthetic-equities-") && print.underlying_id === "SPY"
    );
    expect(backgroundSpyPrints.length).toBeGreaterThan(2);
    expect(new Set(backgroundSpyPrints.map((print) => print.price)).size).toBeGreaterThan(1);
    expect(
      prints.filter((print) => print.offExchangeFlag && LIT_EXCHANGES.has(print.exchange))
    ).toEqual([]);

    const aggregator = new CandleAggregator({ intervalsMs: [60_000], maxLateMs: 0 });
    for (const print of backgroundSpyPrints) {
      aggregator.ingest(print);
    }
    const [candle] = aggregator.drain();
    expect(candle.underlying_id).toBe("SPY");
    expect(candle.trade_count).toBe(backgroundSpyPrints.length);
    expect(candle.high).toBeGreaterThan(candle.low);
    expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
    expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));

    for (const event of [...prints, ...quotes]) {
      for (const field of FORBIDDEN_LABEL_FIELDS) {
        expect(field in event).toBe(false);
      }
    }
  });
});
