import { afterEach, describe, expect, it } from "bun:test";

import { buildBrowserApiUrl, buildBrowserWsUrl } from "./api-transport";

const originalWindow = globalThis.window;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

const setWindowLocation = (href: string): void => {
  const url = new URL(href);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: url.protocol,
        hostname: url.hostname,
        host: url.host
      }
    }
  });
};

describe("browser API transport builders", () => {
  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }

    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it("uses the local API port for blank-env localhost pages", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    setWindowLocation("http://localhost:3000/durable-tapes");

    expect(buildBrowserApiUrl("/history/options")).toBe("http://localhost:4000/history/options");
    expect(buildBrowserWsUrl("/ws/live")).toBe("ws://localhost:4000/ws/live");
  });

  it("uses same-origin app paths for blank-env production pages", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    setWindowLocation("https://app.example.test/durable-tapes");

    expect(buildBrowserApiUrl("/history/options")).toBe("https://app.example.test/history/options");
    expect(buildBrowserWsUrl("/ws/live")).toBe("wss://app.example.test/ws/live");
  });

  it("keeps NEXT_PUBLIC_API_URL as an explicit override and clears base path state", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test/base?x=1#frag";
    setWindowLocation("https://app.example.test/durable-tapes");

    expect(buildBrowserApiUrl("/prints/options")).toBe("https://api.example.test/prints/options");
    expect(buildBrowserWsUrl("/ws/live")).toBe("wss://api.example.test/ws/live");
  });

  it("normalizes websocket overrides without downgrading wss origins", () => {
    setWindowLocation("https://app.example.test/durable-tapes");

    expect(buildBrowserWsUrl("/ws/live", "http://127.0.0.1:4000")).toBe(
      "ws://127.0.0.1:4000/ws/live"
    );
    expect(buildBrowserWsUrl("/ws/live", "wss://api.example.test/live")).toBe(
      "wss://api.example.test/ws/live"
    );
  });
});
