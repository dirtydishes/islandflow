import { describe, expect, it } from "bun:test";
import {
  type ApiRateLimitConfig,
  ApiRateLimiter,
  type ApiRateLimitRejected,
  buildRateLimitResponse,
  classifyApiRouteForRateLimit,
  recordRateLimitRejection,
  resolveApiClientAddress
} from "../src/rate-limit";

const config = (overrides: Partial<ApiRateLimitConfig> = {}): ApiRateLimitConfig => ({
  enabled: true,
  windowMs: 60_000,
  restMax: 2,
  lookupMax: 1,
  wsMax: 1,
  ...overrides
});

const request = (path: string, init: RequestInit = {}): Request =>
  new Request(`http://api.test${path}`, init);

describe("api rate limit route categories", () => {
  it("exempts health and preflight traffic", () => {
    expect(classifyApiRouteForRateLimit("GET", "/health")).toEqual({
      exempt: true,
      routeCategory: "health"
    });
    expect(classifyApiRouteForRateLimit("OPTIONS", "/lookup/options-support")).toEqual({
      exempt: true,
      routeCategory: "preflight"
    });
  });

  it("assigns lookup, websocket, admin, and ordinary rest buckets without query strings", () => {
    expect(classifyApiRouteForRateLimit("POST", "/lookup/options-support")).toMatchObject({
      exempt: false,
      bucket: "lookup",
      routeCategory: "lookup"
    });
    expect(classifyApiRouteForRateLimit("GET", "/option-prints/by-trace")).toMatchObject({
      exempt: false,
      bucket: "lookup",
      routeCategory: "lookup"
    });
    expect(classifyApiRouteForRateLimit("GET", "/options/smart-flow-detail")).toMatchObject({
      exempt: false,
      bucket: "lookup",
      routeCategory: "lookup"
    });
    expect(classifyApiRouteForRateLimit("GET", "/flow/packets/packet-1")).toMatchObject({
      exempt: false,
      bucket: "lookup",
      routeCategory: "lookup"
    });
    expect(classifyApiRouteForRateLimit("GET", "/ws/live")).toMatchObject({
      exempt: false,
      bucket: "ws",
      routeCategory: "websocket"
    });
    expect(classifyApiRouteForRateLimit("GET", "/admin/synthetic/status")).toMatchObject({
      exempt: false,
      bucket: "rest",
      routeCategory: "admin"
    });
    expect(classifyApiRouteForRateLimit("GET", "/prints/options")).toMatchObject({
      exempt: false,
      bucket: "rest",
      routeCategory: "rest_read"
    });
  });
});

describe("api rate limit client address resolution", () => {
  it("uses the first valid x-forwarded-for value", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.10, 10.0.0.2",
      "x-real-ip": "198.51.100.5"
    });

    expect(resolveApiClientAddress(headers, "127.0.0.1")).toEqual({
      key: "ip:203.0.113.10",
      source: "x_forwarded_for"
    });
  });

  it("falls back to x-real-ip, socket address, and unknown safely", () => {
    expect(
      resolveApiClientAddress(new Headers({ "x-forwarded-for": "garbage" }), "127.0.0.1")
    ).toEqual({
      key: "ip:127.0.0.1",
      source: "socket"
    });
    expect(resolveApiClientAddress(new Headers({ "x-real-ip": "198.51.100.9" }), null)).toEqual({
      key: "ip:198.51.100.9",
      source: "x_real_ip"
    });
    expect(resolveApiClientAddress(new Headers(), null)).toEqual({
      key: "socket:unknown",
      source: "unknown"
    });
  });
});

describe("api fixed-window rate limiter", () => {
  it("allows disabled requests and does not consume enabled quota", () => {
    let now = 1_000;
    const limiter = new ApiRateLimiter(() => now);

    expect(
      limiter.check(request("/prints/options"), config({ enabled: false }), null).allowed
    ).toBe(true);
    expect(limiter.check(request("/prints/options"), config({ restMax: 1 }), null).allowed).toBe(
      true
    );
    expect(limiter.check(request("/prints/options"), config({ restMax: 1 }), null).allowed).toBe(
      false
    );

    now = 61_000;
    expect(limiter.check(request("/prints/options"), config({ restMax: 1 }), null).allowed).toBe(
      true
    );
  });

  it("keeps separate buckets and client addresses", () => {
    const limiter = new ApiRateLimiter(() => 1_000);
    const firstClient = { headers: { "x-forwarded-for": "203.0.113.1" } };
    const secondClient = { headers: { "x-forwarded-for": "203.0.113.2" } };

    expect(
      limiter.check(
        request("/lookup/options-support", { method: "POST", ...firstClient }),
        config()
      ).allowed
    ).toBe(true);
    expect(
      limiter.check(
        request("/lookup/options-support", { method: "POST", ...firstClient }),
        config()
      ).allowed
    ).toBe(false);
    expect(limiter.check(request("/prints/options", firstClient), config()).allowed).toBe(true);
    expect(
      limiter.check(
        request("/lookup/options-support", { method: "POST", ...secondClient }),
        config()
      ).allowed
    ).toBe(true);
  });

  it("exempts health from quota and limits websocket upgrades separately", () => {
    const limiter = new ApiRateLimiter(() => 1_000);

    for (let index = 0; index < 5; index += 1) {
      expect(limiter.check(request("/health"), config({ restMax: 1 }), null).allowed).toBe(true);
    }

    expect(limiter.check(request("/prints/options"), config({ restMax: 1 }), null).allowed).toBe(
      true
    );
    expect(limiter.check(request("/prints/options"), config({ restMax: 1 }), null).allowed).toBe(
      false
    );

    expect(limiter.check(request("/ws/live"), config({ wsMax: 1 }), null).allowed).toBe(true);
    expect(limiter.check(request("/ws/live"), config({ wsMax: 1 }), null).allowed).toBe(false);
  });

  it("leaves synthetic admin bearer and header auth semantics to the admin route", () => {
    const limiter = new ApiRateLimiter(() => 1_000);

    expect(
      limiter.check(
        request("/admin/synthetic/status", {
          headers: { authorization: "Bearer secret-token" }
        }),
        config({ restMax: 2 }),
        null
      )
    ).toMatchObject({
      allowed: true,
      route: { exempt: false, bucket: "rest", routeCategory: "admin" }
    });
    expect(
      limiter.check(
        request("/admin/synthetic/control", {
          headers: { "x-synthetic-admin-token": "secret-token" }
        }),
        config({ restMax: 2 }),
        null
      )
    ).toMatchObject({
      allowed: true,
      route: { exempt: false, bucket: "rest", routeCategory: "admin" }
    });
  });

  it("builds bounded json 429 responses and coarse rejection telemetry", async () => {
    const decision: ApiRateLimitRejected = {
      allowed: false,
      bucket: "lookup",
      limit: 1,
      remaining: 0,
      resetAt: 61_000,
      retryAfterMs: 42_000,
      routeCategory: "lookup",
      clientAddressSource: "x_forwarded_for"
    };
    const logs: unknown[] = [];
    const metrics: unknown[] = [];

    recordRateLimitRejection(decision, {
      logger: {
        debug: () => {},
        info: () => {},
        warn: (_msg, context) => logs.push(context),
        error: () => {}
      },
      metrics: {
        count: (name, value, tags) => metrics.push({ name, value, tags }),
        gauge: () => {},
        timing: () => {}
      }
    });
    const response = buildRateLimitResponse(decision);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({
      error: "rate limit exceeded",
      retry_after_ms: 42_000
    });
    expect(metrics).toEqual([
      {
        name: "api.rate_limit.rejected",
        value: 1,
        tags: { bucket: "lookup", route_category: "lookup" }
      }
    ]);
    expect(logs).toEqual([
      {
        bucket: "lookup",
        route_category: "lookup",
        retry_after_ms: 42_000,
        client_address_source: "x_forwarded_for",
        status: 429
      }
    ]);
  });
});
