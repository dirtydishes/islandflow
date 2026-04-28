import { describe, expect, it } from "bun:test";
import {
  deriveOptionPrintMetadata,
  evaluateOptionSignal,
  resolveSyntheticMarketModes,
  type OptionsSignalConfig
} from "../src/options-flow";

const baseConfig: OptionsSignalConfig = {
  mode: "smart-money",
  minNotional: 10_000,
  etfMinNotional: 50_000,
  bidSideMinNotional: 25_000,
  midMinNotional: 20_000,
  missingNbboMinNotional: 50_000,
  largePrintMinSize: 500,
  largePrintMinNotional: 10_000,
  sweepMinNotional: 25_000,
  autoKeepMinNotional: 100_000,
  nbboMaxAgeMs: 1_500,
  etfUnderlyings: new Set(["SPY", "QQQ"])
};

describe("options-flow helpers", () => {
  it("resolves synthetic modes with per-service overrides", () => {
    expect(
      resolveSyntheticMarketModes({
        syntheticMarketMode: "active",
        syntheticOptionsMode: "firehose"
      })
    ).toEqual({
      market: "active",
      options: "firehose",
      equities: "active"
    });
  });

  it("derives underlying, notional, nbbo side, and etf metadata", () => {
    const metadata = deriveOptionPrintMetadata(
      {
        option_contract_id: "SPY-2025-01-17-450-C",
        price: 2.5,
        size: 100,
        ts: 5_000
      },
      {
        bid: 2.3,
        ask: 2.5,
        ts: 4_500
      },
      baseConfig
    );

    expect(metadata.underlying_id).toBe("SPY");
    expect(metadata.option_type).toBe("call");
    expect(metadata.notional).toBe(25_000);
    expect(metadata.nbbo_side).toBe("A");
    expect(metadata.is_etf).toBe(true);
  });

  it("accepts and rejects smart-money thresholds at boundaries", () => {
    const acceptedAsk = evaluateOptionSignal(
      {
        size: 100,
        conditions: [],
        underlying_id: "AAPL",
        option_type: "call",
        notional: 10_000,
        nbbo_side: "A",
        is_etf: false
      },
      baseConfig
    );
    expect(acceptedAsk.signalPass).toBe(true);

    const rejectedLow = evaluateOptionSignal(
      {
        size: 100,
        conditions: [],
        underlying_id: "AAPL",
        option_type: "call",
        notional: 9_999,
        nbbo_side: "A",
        is_etf: false
      },
      baseConfig
    );
    expect(rejectedLow.signalPass).toBe(false);

    const rejectedBid = evaluateOptionSignal(
      {
        size: 100,
        conditions: [],
        underlying_id: "AAPL",
        option_type: "put",
        notional: 24_999,
        nbbo_side: "B",
        is_etf: false
      },
      baseConfig
    );
    expect(rejectedBid.signalPass).toBe(false);

    const acceptedSweep = evaluateOptionSignal(
      {
        size: 100,
        conditions: ["SWEEP"],
        underlying_id: "AAPL",
        option_type: "call",
        notional: 25_000,
        nbbo_side: "MID",
        is_etf: false
      },
      baseConfig
    );
    expect(acceptedSweep.signalPass).toBe(true);

    const rejectedEtf = evaluateOptionSignal(
      {
        size: 100,
        conditions: [],
        underlying_id: "SPY",
        option_type: "call",
        notional: 49_999,
        nbbo_side: "A",
        is_etf: true
      },
      baseConfig
    );
    expect(rejectedEtf.signalPass).toBe(false);
  });
});
