import { describe, expect, it, mock } from "bun:test";

const redirect = mock((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

const nextNavigationMock = {
  default: {
    redirect,
    usePathname: () => "/options"
  },
  redirect,
  usePathname: () => "/options"
};

const nextNavigationResolved = import.meta.resolve("next/navigation");
const nextNavigationJsResolved = import.meta.resolve("next/navigation.js");

mock.module("next/navigation", () => ({
  ...nextNavigationMock
}));
mock.module("next/navigation.js", () => ({
  ...nextNavigationMock
}));
mock.module(nextNavigationResolved, () => ({
  ...nextNavigationMock
}));
mock.module(nextNavigationJsResolved, () => ({
  ...nextNavigationMock
}));

const terminal = await import("./terminal");
const homePage = await import("./page");
const optionsPage = await import("./options/page");
const qaPage = await import("./qa/page");
const newsPage = await import("./news/page");
const qaFeature = await import("../features/durable-tape/qa-page");

describe("terminal route modules", () => {
  it("keeps terminal pages dynamic and mapped to the route components", () => {
    expect(homePage.dynamic).toBe("force-dynamic");
    expect(optionsPage.dynamic).toBe("force-dynamic");
    expect(qaPage.dynamic).toBe("force-dynamic");
    expect(newsPage.dynamic).toBe("force-dynamic");

    expect(homePage.default().type).toBe(terminal.OverviewRoute);
    expect(optionsPage.default().type).toBe(terminal.OptionsRoute);
    expect(qaPage.default().type).toBe(terminal.QaRoute);
    expect(newsPage.default().type).toBe(terminal.NewsRoute);
  });

  it("loads QA candle bootstrap candles from the bounded API request", async () => {
    const requestedUrls: string[] = [];
    const candles = await qaFeature.fetchQaChartCandleBootstrap({
      apiBaseUrl: "https://api.example.test",
      fetcher: async (url) => {
        requestedUrls.push(url.toString());
        return Response.json({
          data: [
            {
              ts: 60_000,
              open: 100,
              high: 101,
              low: 99,
              close: 100.5,
              volume: 1000
            }
          ]
        });
      }
    });

    const requested = new URL(requestedUrls[0] ?? "");
    expect(requested.origin).toBe("https://api.example.test");
    expect(requested.pathname).toBe("/candles/equities");
    expect(requested.searchParams.get("underlying_id")).toBe("SPY");
    expect(requested.searchParams.get("interval_ms")).toBe("60000");
    expect(requested.searchParams.get("limit")).toBe("300");
    expect(requested.searchParams.get("cache")).toBe("1");
    expect(candles).toEqual([
      {
        ts: 60_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000
      }
    ]);
  });

  it("keeps QA chart status degraded instead of loading forever after bootstrap failure", () => {
    expect(
      qaFeature.resolveQaChartStatus({
        bootstrapStatus: "unavailable",
        candleCount: 0,
        liveStatus: "connected"
      })
    ).toBe("error");
    expect(
      qaFeature.resolveQaChartStatus({
        bootstrapStatus: "ready",
        candleCount: 1,
        liveStatus: "connected"
      })
    ).toBe("live");
  });

  it("rejects QA candle bootstrap HTTP failures for the local hook to catch", async () => {
    await expect(
      qaFeature.fetchQaChartCandleBootstrap({
        fetcher: async () => new Response(null, { status: 503 })
      })
    ).rejects.toThrow("QA candle bootstrap failed with 503");
  });
});
