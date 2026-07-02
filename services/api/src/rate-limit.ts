import { isIP } from "node:net";
import type { Logger, Metrics } from "@islandflow/observability";

export type ApiRateLimitBucket = "rest" | "lookup" | "ws";
export type ApiRateLimitRouteCategory = "rest_read" | "lookup" | "websocket" | "admin" | "unknown";
export type ApiClientAddressSource = "x_forwarded_for" | "x_real_ip" | "socket" | "unknown";

export type ApiRateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  restMax: number;
  lookupMax: number;
  wsMax: number;
};

export type ApiClientAddress = {
  key: string;
  source: ApiClientAddressSource;
};

export type ApiRouteLimitCategory =
  | {
      exempt: true;
      routeCategory: "health" | "preflight";
    }
  | {
      exempt: false;
      bucket: ApiRateLimitBucket;
      routeCategory: ApiRateLimitRouteCategory;
    };

export type ApiRateLimitAllowed = {
  allowed: true;
  route: ApiRouteLimitCategory;
};

export type ApiRateLimitRejected = {
  allowed: false;
  bucket: ApiRateLimitBucket;
  limit: number;
  remaining: 0;
  resetAt: number;
  retryAfterMs: number;
  routeCategory: ApiRateLimitRouteCategory;
  clientAddressSource: ApiClientAddressSource;
};

export type ApiRateLimitDecision = ApiRateLimitAllowed | ApiRateLimitRejected;

type FixedWindowEntry = {
  count: number;
  resetAt: number;
};

const LOOKUP_EXACT_PATHS = new Set([
  "/option-prints/by-trace",
  "/lookup/options-support",
  "/options/smart-flow-detail",
  "/equity-joins/by-id"
]);

const normalizeIpCandidate = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || /[\s"'`]/.test(trimmed)) {
    return null;
  }

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) {
    return isIP(bracketed[1]) ? bracketed[1] : null;
  }

  if (isIP(trimmed)) {
    return trimmed;
  }

  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed);
  if (ipv4WithPort && isIP(ipv4WithPort[1])) {
    return ipv4WithPort[1];
  }

  return null;
};

export const resolveApiClientAddress = (
  headers: Headers,
  socketAddress?: string | null
): ApiClientAddress => {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    for (const candidate of forwardedFor.split(",")) {
      const normalized = normalizeIpCandidate(candidate);
      if (normalized) {
        return { key: `ip:${normalized}`, source: "x_forwarded_for" };
      }
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const normalized = normalizeIpCandidate(realIp);
    if (normalized) {
      return { key: `ip:${normalized}`, source: "x_real_ip" };
    }
  }

  const socketIp = socketAddress ? normalizeIpCandidate(socketAddress) : null;
  if (socketIp) {
    return { key: `ip:${socketIp}`, source: "socket" };
  }

  return { key: "socket:unknown", source: "unknown" };
};

export const classifyApiRouteForRateLimit = (
  method: string,
  pathname: string
): ApiRouteLimitCategory => {
  if (method === "OPTIONS") {
    return { exempt: true, routeCategory: "preflight" };
  }

  if (method === "GET" && pathname === "/health") {
    return { exempt: true, routeCategory: "health" };
  }

  if (method === "GET" && pathname.startsWith("/ws/")) {
    return { exempt: false, bucket: "ws", routeCategory: "websocket" };
  }

  if (
    LOOKUP_EXACT_PATHS.has(pathname) ||
    (method === "GET" && /^\/flow\/packets\/[^/]+$/.test(pathname))
  ) {
    return { exempt: false, bucket: "lookup", routeCategory: "lookup" };
  }

  if (pathname.startsWith("/admin/synthetic/")) {
    return { exempt: false, bucket: "rest", routeCategory: "admin" };
  }

  const knownRestPrefix = [
    "/prints/",
    "/nbbo/",
    "/quotes/",
    "/candles/",
    "/joins/",
    "/dark/",
    "/flow/",
    "/market-command/",
    "/news",
    "/history/",
    "/replay/"
  ].some((prefix) => pathname.startsWith(prefix));

  return {
    exempt: false,
    bucket: "rest",
    routeCategory: knownRestPrefix ? "rest_read" : "unknown"
  };
};

export class ApiRateLimiter {
  private readonly entries = new Map<string, FixedWindowEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  check(
    req: Request,
    config: ApiRateLimitConfig,
    socketAddress?: string | null
  ): ApiRateLimitDecision {
    const url = new URL(req.url);
    const route = classifyApiRouteForRateLimit(req.method, url.pathname);

    if (!config.enabled || route.exempt) {
      return { allowed: true, route };
    }

    const limit = this.limitForBucket(config, route.bucket);
    const clientAddress = resolveApiClientAddress(req.headers, socketAddress);
    const now = this.now();
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const resetAt = windowStart + config.windowMs;
    const key = `${route.bucket}:${clientAddress.key}:${windowStart}`;
    const entry = this.entries.get(key) ?? { count: 0, resetAt };

    this.prune(now);

    if (entry.count >= limit) {
      return {
        allowed: false,
        bucket: route.bucket,
        limit,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, resetAt - now),
        routeCategory: route.routeCategory,
        clientAddressSource: clientAddress.source
      };
    }

    entry.count += 1;
    this.entries.set(key, entry);

    return { allowed: true, route };
  }

  private limitForBucket(config: ApiRateLimitConfig, bucket: ApiRateLimitBucket): number {
    switch (bucket) {
      case "lookup":
        return config.lookupMax;
      case "ws":
        return config.wsMax;
      case "rest":
      default:
        return config.restMax;
    }
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export const buildRateLimitResponse = (decision: ApiRateLimitRejected): Response => {
  return new Response(
    JSON.stringify({
      error: "rate limit exceeded",
      retry_after_ms: decision.retryAfterMs
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000)))
      }
    }
  );
};

export const recordRateLimitRejection = (
  decision: ApiRateLimitRejected,
  telemetry: { logger: Logger; metrics: Metrics }
): void => {
  telemetry.metrics.count("api.rate_limit.rejected", 1, {
    bucket: decision.bucket,
    route_category: decision.routeCategory
  });
  telemetry.logger.warn("api rate limit rejected", {
    bucket: decision.bucket,
    route_category: decision.routeCategory,
    retry_after_ms: decision.retryAfterMs,
    client_address_source: decision.clientAddressSource,
    status: 429
  });
};
