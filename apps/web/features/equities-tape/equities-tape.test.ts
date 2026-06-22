import { describe, expect, it } from "bun:test";
import type { EquityPrint } from "@islandflow/types";

import {
  filterEquityPrints,
  getEquitiesTapeHistoryParams,
  getEquityPrintKey,
  loadEquitiesTapeHistoryPage,
  mapEquitiesTapeInspectEvent,
  normalizeEquitiesTapeFilters,
  normalizeEquitiesTapeScope
} from ".";

const makePrint = (overrides: Partial<EquityPrint> = {}): EquityPrint => ({
  source_ts: 1_000,
  ingest_ts: 1_001,
  seq: 1,
  trace_id: "eq-1",
  ts: 1_000,
  underlying_id: "SPY",
  price: 450.12,
  size: 100,
  exchange: "ARCA",
  offExchangeFlag: false,
  ...overrides
});

describe("equities tape helpers", () => {
  it("normalizes ticker scope without duplicates", () => {
    expect(
      normalizeEquitiesTapeScope({
        ticker: " spy ",
        tickers: ["aapl,nvda", "SPY"],
        underlyingIds: ["msft"]
      })
    ).toEqual({
      underlyingIds: ["SPY", "AAPL", "NVDA", "MSFT"]
    });
  });

  it("normalizes venue and off-exchange filters", () => {
    expect(
      normalizeEquitiesTapeFilters({
        venue: " trf ",
        venues: ["arca", "TRF"],
        offExchange: true,
        sinceTs: 123.7
      })
    ).toEqual({
      venues: ["TRF", "ARCA"],
      offExchange: true,
      sinceTs: 123
    });
  });

  it("filters venue and off-exchange locally", () => {
    const prints = [
      makePrint({ trace_id: "lit", exchange: "ARCA", offExchangeFlag: false }),
      makePrint({ trace_id: "dark", seq: 2, exchange: "TRF", offExchangeFlag: true })
    ];

    expect(
      filterEquityPrints(prints, { venues: ["TRF"], offExchange: true }).map(
        (print) => print.trace_id
      )
    ).toEqual(["dark"]);
  });

  it("builds history params with ticker scope", () => {
    expect(
      getEquitiesTapeHistoryParams({
        cursor: { ts: 1_500, seq: 9 },
        scope: { underlyingIds: ["AAPL", "NVDA"] },
        filters: { sinceTs: 1_000 },
        limit: 25
      }).toString()
    ).toBe("before_ts=1500&before_seq=9&limit=25&underlying_ids=AAPL%2CNVDA&since_ts=1000");
  });

  it("walks history pages until a client-side venue filter matches", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      const page =
        urls.length === 1
          ? [makePrint({ exchange: "ARCA" })]
          : [
              makePrint({
                trace_id: "match",
                seq: 2,
                ts: 900,
                exchange: "TRF",
                offExchangeFlag: true
              })
            ];
      return new Response(
        JSON.stringify({
          data: page,
          next_before: urls.length === 1 ? { ts: 900, seq: 2 } : null
        }),
        { status: 200 }
      );
    };

    const page = await loadEquitiesTapeHistoryPage({
      cursor: { ts: 1_000, seq: 1 },
      filters: { venues: ["TRF"], offExchange: true },
      options: {
        apiBaseUrl: "https://api.example.test",
        fetcher,
        historyPageSize: 1
      }
    });

    expect(urls).toHaveLength(2);
    expect(page.items.map((print) => print.trace_id)).toEqual(["match"]);
    expect(page.exhausted).toBe(true);
  });

  it("maps durable row focus to print inspect callback payload", () => {
    const print = makePrint();

    expect(
      mapEquitiesTapeInspectEvent({
        item: print,
        rowKey: getEquityPrintKey(print),
        index: 3
      })
    ).toEqual({
      print,
      rowKey: "eq-1",
      index: 3
    });
  });
});
