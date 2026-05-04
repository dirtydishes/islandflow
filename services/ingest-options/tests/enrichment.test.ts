import { describe, expect, it } from "bun:test";
import type { EquityQuote, OptionNBBO, OptionPrint, OptionsSignalConfig } from "@islandflow/types";
import { enrichOptionPrint, selectAtOrBefore } from "../src/enrichment";

const config: OptionsSignalConfig = {
  mode: "all",
  minNotional: 0,
  etfMinNotional: 0,
  bidSideMinNotional: 0,
  midMinNotional: 0,
  missingNbboMinNotional: 0,
  largePrintMinSize: 1,
  largePrintMinNotional: 0,
  sweepMinNotional: 0,
  autoKeepMinNotional: 100_000,
  nbboMaxAgeMs: 1_500,
  etfUnderlyings: new Set(["SPY"])
};

const print: OptionPrint = {
  source_ts: 1_000,
  ingest_ts: 1_000,
  seq: 1,
  trace_id: "print-1",
  ts: 1_000,
  option_contract_id: "SPY-2025-01-17-450-C",
  price: 1.3,
  size: 10,
  exchange: "TEST"
};

const nbbo = (overrides: Partial<OptionNBBO> = {}): OptionNBBO => ({
  source_ts: 990,
  ingest_ts: 990,
  seq: 1,
  trace_id: "nbbo-1",
  ts: 990,
  option_contract_id: "SPY-2025-01-17-450-C",
  bid: 1.2,
  ask: 1.3,
  bidSize: 20,
  askSize: 30,
  ...overrides
});

const equityQuote = (overrides: Partial<EquityQuote> = {}): EquityQuote => ({
  source_ts: 980,
  ingest_ts: 980,
  seq: 1,
  trace_id: "eq-1",
  ts: 980,
  underlying_id: "SPY",
  bid: 450,
  ask: 450.1,
  ...overrides
});

describe("option print enrichment", () => {
  it("attaches preserved NBBO context and mirrors nbbo_side", () => {
    const enriched = enrichOptionPrint(print, nbbo(), null, config);

    expect(enriched.execution_nbbo_bid).toBe(1.2);
    expect(enriched.execution_nbbo_ask).toBe(1.3);
    expect(enriched.execution_nbbo_mid).toBe(1.25);
    expect(enriched.execution_nbbo_age_ms).toBe(10);
    expect(enriched.execution_nbbo_side).toBe("A");
    expect(enriched.nbbo_side).toBe(enriched.execution_nbbo_side);
  });

  it("attaches preserved underlying quote mid as spot", () => {
    const enriched = enrichOptionPrint(print, null, equityQuote(), config);

    expect(enriched.execution_underlying_spot).toBe(450.05);
    expect(enriched.execution_underlying_mid).toBe(450.05);
    expect(enriched.execution_underlying_source).toBe("equity_quote_mid");
    expect(enriched.execution_underlying_age_ms).toBe(20);
  });

  it("selects context at or before the print timestamp only", () => {
    const selected = selectAtOrBefore(
      [nbbo({ ts: 900, seq: 1, bid: 1 }), nbbo({ ts: 1_001, seq: 2, bid: 2 })],
      print.ts
    );

    expect(selected?.ts).toBe(900);
    expect(selected?.bid).toBe(1);
  });
});
