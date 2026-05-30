import { beforeEach, describe, expect, it, mock } from "bun:test";

const redirect = mock((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

mock.module("next/navigation", () => ({ default: { redirect }, redirect }));
mock.module("next/navigation.js", () => ({ default: { redirect }, redirect }));

describe("legacy page redirects", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("redirects /signals to home", async () => {
    const mod = await import("./signals/page");
    expect(() => mod.default()).toThrow("NEXT_REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects /charts to home", async () => {
    const mod = await import("./charts/page");
    expect(() => mod.default()).toThrow("NEXT_REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects /replay to home", async () => {
    const mod = await import("./replay/page");
    expect(() => mod.default()).toThrow("NEXT_REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects /tape to /options", async () => {
    const mod = await import("./tape/page");
    expect(() => mod.default()).toThrow("NEXT_REDIRECT:/options");
    expect(redirect).toHaveBeenCalledWith("/options");
  });
});
