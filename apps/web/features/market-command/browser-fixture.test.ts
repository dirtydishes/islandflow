import { describe, expect, it } from "bun:test";

import {
  createMarketCommandDrawerBrowserFixture,
  isMarketCommandDrawerBrowserFixtureEnabled,
  MARKET_COMMAND_DRAWER_FIXTURE_PARAM,
  MARKET_COMMAND_DRAWER_FIXTURE_VALUE
} from "./browser-fixture";

describe("market-command drawer browser fixture", () => {
  it("requires the root route and explicit drawer fixture query", () => {
    expect(
      isMarketCommandDrawerBrowserFixtureEnabled({
        pathname: "/",
        searchParams: new URLSearchParams({
          [MARKET_COMMAND_DRAWER_FIXTURE_PARAM]: MARKET_COMMAND_DRAWER_FIXTURE_VALUE
        })
      })
    ).toBe(true);

    expect(
      isMarketCommandDrawerBrowserFixtureEnabled({
        pathname: "/options",
        searchParams: new URLSearchParams({
          [MARKET_COMMAND_DRAWER_FIXTURE_PARAM]: MARKET_COMMAND_DRAWER_FIXTURE_VALUE
        })
      })
    ).toBe(false);
    expect(
      isMarketCommandDrawerBrowserFixtureEnabled({
        pathname: "/",
        searchParams: new URLSearchParams({ [MARKET_COMMAND_DRAWER_FIXTURE_PARAM]: "off" })
      })
    ).toBe(false);
  });

  it("seeds every browser-probed Market Command drawer source", () => {
    const fixture = createMarketCommandDrawerBrowserFixture();

    expect(fixture.durableRows.some((row) => row.lane === "alerts")).toBe(true);
    expect(fixture.durableRows.some((row) => row.lane === "options")).toBe(true);
    expect(fixture.news).toHaveLength(1);
    expect(fixture.flow).toHaveLength(1);
    expect(fixture.options.length).toBeGreaterThanOrEqual(2);
    expect(fixture.smartFlow).toHaveLength(1);
    expect(fixture.inferredDark).toHaveLength(1);
    expect(fixture.equityJoins).toHaveLength(1);
    expect(fixture.chartCandles.length).toBeGreaterThan(0);
  });
});
