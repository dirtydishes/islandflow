import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SYNTHETIC_CONTROL_STATE,
  type EquityPrint,
  type EquityQuote
} from "@islandflow/types";
import { createSyntheticEquitiesAdapter } from "../src/adapters/synthetic";

describe("synthetic equities demo playback", () => {
  it("emits selected deterministic demo profile runs through the live adapter", async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 12));
    stop();

    expect(prints.length).toBeGreaterThan(0);
    expect(quotes.length).toBeGreaterThan(0);
    const runIds = new Set(prints.map((print) => print.trace_id.split(":live:")[0]));
    expect(runIds.has("phase03-c")).toBe(true);
    expect(runIds.has("phase03-e")).toBe(true);
    for (const print of prints) {
      expect("scenario_id" in print).toBe(false);
      expect("hiddenLabel" in print).toBe(false);
    }
  });
});
