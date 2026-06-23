import { describe, expect, it } from "bun:test";
import type { OptionPrint } from "@islandflow/types";

import { createDurableTapeInitialHistoryCursor, selectDurableTapeTemplate } from "../durable-tape";
import {
  formatOptionsTapeContractLabel,
  formatOptionsTapeDteLabel,
  getOptionsTapePrintCursor,
  getOptionsTapePrintKey,
  loadOptionsTapeHistoryPage
} from ".";
import { OPTIONS_TAPE_COLUMNS, OPTIONS_TAPE_TEMPLATES_BY_MODE } from "./columns";
import {
  applyOptionsTapeSecurityPreset,
  applyOptionsTapeSidePreset,
  applyOptionsTapeTypePreset,
  buildDefaultOptionsTapeFilters,
  filterOptionsTapePrints,
  getOptionsTapeQueryParams,
  getOptionsTapeScopeFilters,
  getOptionsTapeSidePreset
} from "./filters";

const makePrint = (overrides: Partial<OptionPrint> = {}): OptionPrint => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: "print-1",
  ts: 1_000,
  option_contract_id: "SPY-2026-06-22-555-C",
  price: 1.25,
  size: 100,
  exchange: "CBOE",
  option_type: "call",
  nbbo_side: "A",
  notional: 12_500,
  signal_pass: true,
  signal_profile: "balanced",
  is_etf: false,
  ...overrides
});

describe("options tape helpers", () => {
  it("formats primary contract labels for 0DTE and dated expiries", () => {
    const now = new Date("2026-06-22T13:30:00").getTime();
    expect(formatOptionsTapeContractLabel("SPY-2026-06-22-555-C", now)).toBe("SPY 0DTE 555C");
    expect(formatOptionsTapeContractLabel("NVDA-2026-06-28-145-P", now)).toBe("NVDA 6/28 145P");
    expect(formatOptionsTapeDteLabel("NVDA-2026-06-28-145-P", now)).toBe("6D");
  });

  it("exports durable row key and cursor accessors", () => {
    const print = makePrint({ trace_id: "abc", ts: 10, seq: 3 });
    expect(getOptionsTapePrintKey(print)).toBe("abc:3");
    expect(getOptionsTapePrintCursor(print)).toEqual({ ts: 10, seq: 3 });
  });

  it("keeps no-horizontal-scroll templates small by state", () => {
    expect(OPTIONS_TAPE_TEMPLATES_BY_MODE.global[0]?.columns).toEqual([
      "time",
      "contract",
      "price",
      "size",
      "premium",
      "side",
      "iv"
    ]);
    expect(OPTIONS_TAPE_TEMPLATES_BY_MODE.packet[0]?.columns).toEqual([
      "dte",
      "time",
      "price",
      "size",
      "premium",
      "side",
      "spot"
    ]);
    expect(OPTIONS_TAPE_TEMPLATES_BY_MODE.contract[0]?.columns).toEqual([
      "time",
      "price",
      "size",
      "premium",
      "nbbo",
      "side",
      "exchange",
      "iv"
    ]);
  });

  it("steps down templates for narrow containers", () => {
    const globalSelection = selectDurableTapeTemplate({
      columns: OPTIONS_TAPE_COLUMNS,
      templates: OPTIONS_TAPE_TEMPLATES_BY_MODE.global,
      containerWidth: 330,
      requestedTemplate: "auto"
    });
    expect(globalSelection.template.id).toBe("oneThird");
    expect(globalSelection.columns.map((column) => column.id)).toEqual([
      "contract",
      "premium",
      "side"
    ]);

    const packetSelection = selectDurableTapeTemplate({
      columns: OPTIONS_TAPE_COLUMNS,
      templates: OPTIONS_TAPE_TEMPLATES_BY_MODE.packet,
      containerWidth: 200,
      requestedTemplate: "auto"
    });
    expect(packetSelection.template.id).toBe("micro");
    expect(packetSelection.columns.map((column) => column.id)).toEqual(["premium", "side"]);
  });

  it("applies settings presets without changing default signal semantics", () => {
    const defaults = buildDefaultOptionsTapeFilters();
    expect(defaults).toEqual({
      view: "signal",
      securityTypes: ["stock"],
      nbboSides: ["AA", "A", "MID"],
      optionTypes: ["call", "put"]
    });
    expect(getOptionsTapeSidePreset(defaults)).toBe("default");
    expect(getOptionsTapeSidePreset(applyOptionsTapeSidePreset(defaults, "bb"))).toBe("bb");
    expect(applyOptionsTapeTypePreset(defaults, "calls").optionTypes).toEqual(["call"]);
    expect(applyOptionsTapeSecurityPreset(defaults, "all").securityTypes).toEqual(["stock", "etf"]);
  });

  it("serializes filter and scope query params for option history", () => {
    const params = getOptionsTapeQueryParams(
      { optionContractId: "SPY-2026-06-22-555-C", underlyingIds: ["SPY"] },
      { ...buildDefaultOptionsTapeFilters(), minNotional: 25_000 },
      50
    );
    expect(params.toString()).toBe(
      "limit=50&view=signal&security=stock&side=AA%2CA%2CMID&type=call%2Cput&min_notional=25000&underlying_ids=SPY&option_contract_id=SPY-2026-06-22-555-C"
    );
  });

  it("filters history pages to packet member trace ids", async () => {
    const requestedUrls: string[] = [];
    const page = await loadOptionsTapeHistoryPage({
      cursor: { ts: 2_000, seq: 2 },
      scope: {
        optionContractId: "SPY-2026-06-22-555-C",
        packetMemberTraceIds: ["member-2"]
      },
      filters: buildDefaultOptionsTapeFilters(),
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher: async (url) => {
          requestedUrls.push(url.toString());
          return Response.json({
            data: [
              makePrint({ trace_id: "member-1", seq: 1 }),
              makePrint({ trace_id: "member-2", seq: 2 })
            ],
            next_before: null
          });
        }
      }
    });

    expect(requestedUrls[0]).toContain("/history/options?");
    expect(page.items.map((print) => print.trace_id)).toEqual(["member-2"]);
    expect(page.exhausted).toBe(true);
  });

  it("can seed filtered history from an empty live head cursor", async () => {
    const requestedUrls: string[] = [];
    const page = await loadOptionsTapeHistoryPage({
      cursor: createDurableTapeInitialHistoryCursor(2_500),
      filters: { ...buildDefaultOptionsTapeFilters(), minNotional: 10_000 },
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher: async (url) => {
          requestedUrls.push(url.toString());
          return Response.json({
            data: [makePrint({ trace_id: "older-match", seq: 7, ts: 2_000, notional: 50_000 })],
            next_before: { ts: 2_000, seq: 7 }
          });
        }
      }
    });

    expect(requestedUrls[0]).toContain("before_ts=2500");
    expect(requestedUrls[0]).toContain(`before_seq=${Number.MAX_SAFE_INTEGER}`);
    expect(requestedUrls[0]).toContain("min_notional=10000");
    expect(page.items.map((print) => print.trace_id)).toEqual(["older-match"]);
    expect(page.exhausted).toBe(false);
  });

  it("keeps broad filters out of packet and contract scopes", () => {
    const filters = { ...buildDefaultOptionsTapeFilters(), nbboSides: ["AA" as const] };
    const packetScope = {
      optionContractId: "SPY-2026-06-22-555-C",
      packetMemberTraceIds: ["member-1", "member-2"]
    };
    const contractScope = { optionContractId: "SPY-2026-06-22-555-C" };
    const prints = [
      makePrint({ trace_id: "member-1", nbbo_side: "B", signal_pass: false }),
      makePrint({ trace_id: "member-2", nbbo_side: "BB", signal_pass: false }),
      makePrint({ trace_id: "other", nbbo_side: "AA" })
    ];

    expect(getOptionsTapeScopeFilters(undefined, filters)).toBe(filters);
    expect(getOptionsTapeScopeFilters(packetScope, filters)).toBeUndefined();
    expect(getOptionsTapeScopeFilters(contractScope, filters)).toBeUndefined();
    expect(
      filterOptionsTapePrints(prints, packetScope, getOptionsTapeScopeFilters(packetScope, filters))
    ).toEqual([prints[0], prints[1]]);
    expect(
      filterOptionsTapePrints(
        prints,
        contractScope,
        getOptionsTapeScopeFilters(contractScope, filters)
      )
    ).toEqual(prints);
  });
});
