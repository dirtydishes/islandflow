import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { getOptionPrintQueryErrorStatus, parseOptionPrintQuery } from "../src/option-queries";

describe("parseOptionPrintQuery", () => {
  it("keeps broad option flow filters for non-contract requests", () => {
    const url = new URL(
      "http://localhost/prints/options?view=signal&security=stock&side=A&type=call&min_notional=500000&underlying_ids=AAPL,MSFT"
    );

    expect(parseOptionPrintQuery(url)).toEqual({
      scope: {
        underlyingIds: ["AAPL", "MSFT"],
        optionContractId: undefined,
        flowPacketId: undefined,
        pinnedTraceId: undefined
      },
      flowFilters: {
        view: "signal",
        securityTypes: ["stock"],
        nbboSides: ["A"],
        optionTypes: ["call"],
        minNotional: 500000
      },
      storageFilters: {
        view: "signal",
        security: "stock",
        nbboSides: ["A"],
        optionTypes: ["call"],
        minNotional: 500000,
        underlyingIds: ["AAPL", "MSFT"],
        optionContractId: undefined
      },
      isContractDrilldown: false,
      isPacketScope: false
    });
  });

  it("switches contract requests to raw contract-only storage filters", () => {
    const url = new URL(
      "http://localhost/replay/options?view=signal&security=stock&side=A&type=call&min_notional=500000&underlying_id=AAPL&option_contract_id=AAPL-2025-01-17-200-C"
    );

    expect(parseOptionPrintQuery(url)).toEqual({
      scope: {
        underlyingIds: ["AAPL"],
        optionContractId: "AAPL-2025-01-17-200-C",
        flowPacketId: undefined,
        pinnedTraceId: undefined
      },
      flowFilters: {
        view: "signal",
        securityTypes: ["stock"],
        nbboSides: ["A"],
        optionTypes: ["call"],
        minNotional: 500000
      },
      storageFilters: {
        view: "raw",
        optionContractId: "AAPL-2025-01-17-200-C"
      },
      isContractDrilldown: true,
      isPacketScope: false
    });
  });

  it("marks packet scope requests and strips broad filters from storage filters", () => {
    const url = new URL(
      "http://localhost/history/options?view=signal&side=A&type=call&flow_packet_id=flowpacket%3A1&pinned_trace_id=print%3A2&option_contract_id=SPY-2026-06-22-555-C"
    );

    expect(parseOptionPrintQuery(url)).toEqual({
      scope: {
        underlyingIds: undefined,
        optionContractId: "SPY-2026-06-22-555-C",
        flowPacketId: "flowpacket:1",
        pinnedTraceId: "print:2"
      },
      flowFilters: {
        view: "signal",
        securityTypes: ["stock"],
        nbboSides: ["A"],
        optionTypes: ["call"],
        minNotional: undefined
      },
      storageFilters: {
        view: "raw",
        optionContractId: "SPY-2026-06-22-555-C"
      },
      isContractDrilldown: true,
      isPacketScope: true
    });
  });

  it("maps parse failures and storage failures to distinct route statuses", () => {
    expect(getOptionPrintQueryErrorStatus(new z.ZodError([]))).toBe(400);
    expect(getOptionPrintQueryErrorStatus(new Error("ClickHouse request timed out"))).toBe(503);
  });
});
