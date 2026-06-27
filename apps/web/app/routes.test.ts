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
});
