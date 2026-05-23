import { describe, expect, it } from "bun:test";
import type { OptionPrint } from "@islandflow/types";
import { processOptionTrade, shouldPersistOptionPrint } from "../src/trade-pipeline";

const makePrint = (signalPass: boolean): OptionPrint => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: `print-${signalPass ? "pass" : "fail"}`,
  ts: 1_000,
  option_contract_id: "SPY-2025-01-17-450-C",
  price: 1.25,
  size: 100,
  exchange: "TEST",
  signal_pass: signalPass
});

describe("option trade persistence gating", () => {
  it("does not persist failing prints when signal-only persistence is enabled", async () => {
    const persisted: string[] = [];
    const rawPublished: string[] = [];
    const signalPublished: string[] = [];

    await processOptionTrade(makePrint(false), {
      persistSignalOnly: true,
      persist: async (print) => {
        persisted.push(print.trace_id);
      },
      publishRaw: async (print) => {
        rawPublished.push(print.trace_id);
      },
      publishSignal: async (print) => {
        signalPublished.push(print.trace_id);
      }
    });

    expect(persisted).toEqual([]);
    expect(rawPublished).toEqual(["print-fail"]);
    expect(signalPublished).toEqual([]);
  });

  it("persists and publishes passing prints when signal-only persistence is enabled", async () => {
    const persisted: string[] = [];
    const rawPublished: string[] = [];
    const signalPublished: string[] = [];

    await processOptionTrade(makePrint(true), {
      persistSignalOnly: true,
      persist: async (print) => {
        persisted.push(print.trace_id);
      },
      publishRaw: async (print) => {
        rawPublished.push(print.trace_id);
      },
      publishSignal: async (print) => {
        signalPublished.push(print.trace_id);
      }
    });

    expect(persisted).toEqual(["print-pass"]);
    expect(rawPublished).toEqual(["print-pass"]);
    expect(signalPublished).toEqual(["print-pass"]);
  });

  it("persists failing prints when signal-only persistence is disabled", async () => {
    const persisted: string[] = [];
    const rawPublished: string[] = [];
    const signalPublished: string[] = [];

    await processOptionTrade(makePrint(false), {
      persistSignalOnly: false,
      persist: async (print) => {
        persisted.push(print.trace_id);
      },
      publishRaw: async (print) => {
        rawPublished.push(print.trace_id);
      },
      publishSignal: async (print) => {
        signalPublished.push(print.trace_id);
      }
    });

    expect(persisted).toEqual(["print-fail"]);
    expect(rawPublished).toEqual(["print-fail"]);
    expect(signalPublished).toEqual([]);
  });
});

describe("shouldPersistOptionPrint", () => {
  it("returns true for passing prints in signal-only mode", () => {
    expect(shouldPersistOptionPrint({ signal_pass: true }, true)).toBe(true);
  });

  it("returns false for failing prints in signal-only mode", () => {
    expect(shouldPersistOptionPrint({ signal_pass: false }, true)).toBe(false);
  });

  it("returns true for failing prints when signal-only mode is disabled", () => {
    expect(shouldPersistOptionPrint({ signal_pass: false }, false)).toBe(true);
  });
});
