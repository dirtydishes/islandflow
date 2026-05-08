import { describe, expect, it } from "bun:test";
import { parseOptionPrintQuery } from "../src/option-queries";

describe("parseOptionPrintQuery", () => {
  it("keeps broad option flow filters for non-contract requests", () => {
    const url = new URL(
      "http://localhost/prints/options?view=signal&security=stock&side=A&type=call&min_notional=500000&underlying_ids=AAPL,MSFT"
    );

    expect(parseOptionPrintQuery(url)).toEqual({
      scope: {
        underlyingIds: ["AAPL", "MSFT"],
        optionContractId: undefined
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
      isContractDrilldown: false
    });
  });

  it("switches contract requests to raw contract-only storage filters", () => {
    const url = new URL(
      "http://localhost/replay/options?view=signal&security=stock&side=A&type=call&min_notional=500000&underlying_id=AAPL&option_contract_id=AAPL-2025-01-17-200-C"
    );

    expect(parseOptionPrintQuery(url)).toEqual({
      scope: {
        underlyingIds: ["AAPL"],
        optionContractId: "AAPL-2025-01-17-200-C"
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
      isContractDrilldown: true
    });
  });
});
