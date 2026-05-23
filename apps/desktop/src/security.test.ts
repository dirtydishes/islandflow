import { describe, expect, it } from "bun:test";

import {
  DESKTOP_PRODUCTION_URL,
  isSafeExternalUrl,
  isTrustedAppUrl,
  resolveDesktopStartUrl
} from "./security.js";

describe("desktop URL policy", () => {
  it("allows the hosted production origin on /options", () => {
    expect(isTrustedAppUrl("https://flow.deltaisland.io/options?symbol=SPY")).toBe(true);
  });

  it("keeps /tape trusted as a compatibility path on the same origin", () => {
    expect(isTrustedAppUrl("https://flow.deltaisland.io/tape?symbol=SPY")).toBe(true);
  });

  it("allows local dev origins", () => {
    expect(isTrustedAppUrl("http://127.0.0.1:3000/signals")).toBe(true);
    expect(isTrustedAppUrl("http://localhost:3000/charts")).toBe(true);
  });

  it("rejects untrusted origins", () => {
    expect(isTrustedAppUrl("https://example.com")).toBe(false);
    expect(isTrustedAppUrl("http://127.0.0.1:4000")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isTrustedAppUrl("not a url")).toBe(false);
    expect(isTrustedAppUrl("javascript:alert('xss')")).toBe(false);
  });

  it("treats third-party http targets as external-only", () => {
    expect(isSafeExternalUrl("https://deltaisland.io/about")).toBe(true);
    expect(isSafeExternalUrl("mailto:support@deltaisland.io")).toBe(false);
    expect(isSafeExternalUrl("https://flow.deltaisland.io/help")).toBe(false);
  });

  it("falls back to production when the desktop start URL is invalid", () => {
    expect(resolveDesktopStartUrl(undefined)).toBe(DESKTOP_PRODUCTION_URL);
    expect(resolveDesktopStartUrl("https://example.com")).toBe(DESKTOP_PRODUCTION_URL);
    expect(resolveDesktopStartUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(resolveDesktopStartUrl("https://flow.deltaisland.io/options")).toBe(
      "https://flow.deltaisland.io/options"
    );
  });
});
