import { describe, expect, it } from "bun:test";
import {
  OPTION_PRINT_TRACE_ID_MAX_LENGTH,
  OPTION_PRINT_TRACE_LOOKUP_MAX_IDS
} from "@islandflow/storage";
import {
  getOptionPrintTraceLookupErrorStatus,
  OptionPrintTraceLookupValidationError,
  parseOptionPrintTraceLookupParams
} from "../src/option-print-lookup";

const lookupUrl = (params: string): URL =>
  new URL(`http://localhost/option-prints/by-trace${params}`);

describe("option print trace lookup params", () => {
  it("returns an empty lookup for omitted ids", () => {
    expect(parseOptionPrintTraceLookupParams(lookupUrl(""))).toEqual([]);
  });

  it("trims and dedupes trace ids", () => {
    const url = lookupUrl("?trace_id=trace-1&trace_id=%20trace-1%20&trace_id=trace-2");

    expect(parseOptionPrintTraceLookupParams(url)).toEqual(["trace-1", "trace-2"]);
  });

  it("rejects oversized batches", () => {
    const url = lookupUrl("");
    for (let index = 0; index <= OPTION_PRINT_TRACE_LOOKUP_MAX_IDS; index += 1) {
      url.searchParams.append("trace_id", `trace-${index}`);
    }

    expect(() => parseOptionPrintTraceLookupParams(url)).toThrow(
      OptionPrintTraceLookupValidationError
    );
  });

  it("rejects overlong trace ids", () => {
    const url = lookupUrl(`?trace_id=${"x".repeat(OPTION_PRINT_TRACE_ID_MAX_LENGTH + 1)}`);

    expect(() => parseOptionPrintTraceLookupParams(url)).toThrow(
      OptionPrintTraceLookupValidationError
    );
  });

  it("maps validation and storage failures to bounded response statuses", () => {
    expect(
      getOptionPrintTraceLookupErrorStatus(new OptionPrintTraceLookupValidationError("bad input"))
    ).toBe(400);
    expect(getOptionPrintTraceLookupErrorStatus(new Error("ClickHouse timed out"))).toBe(503);
  });
});
