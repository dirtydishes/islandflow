import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  getSyntheticAdminProxyConfig,
  isSyntheticAdminFeatureEnabled
} from "./shared";

const originalFetch = globalThis.fetch;

describe("synthetic admin proxy helpers", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SYNTHETIC_ADMIN = "1";
    process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:4000";
    process.env.SYNTHETIC_ADMIN_TOKEN = "secret-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("gates visibility on the public env flag", () => {
    expect(isSyntheticAdminFeatureEnabled("1")).toBe(true);
    expect(isSyntheticAdminFeatureEnabled("0")).toBe(false);
  });

  it("reads the proxy config from server env only", () => {
    expect(getSyntheticAdminProxyConfig()).toEqual({
      apiBaseUrl: "http://127.0.0.1:4000",
      token: "secret-token"
    });
  });

  it("proxies status requests with the backend admin token", async () => {
    const fetchMock = mock(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:4000/admin/synthetic/status");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-token");
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const route = await import("./status/route");

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 from proxy routes when the internal UI flag is off", async () => {
    process.env.NEXT_PUBLIC_SYNTHETIC_ADMIN = "0";
    const route = await import("./control/route");

    const response = await route.GET();

    expect(response.status).toBe(404);
  });
});
