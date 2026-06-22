import { describe, expect, it } from "bun:test";
import {
  createCorsPreflightResponse,
  DEFAULT_API_CORS_ORIGINS,
  parseCorsAllowedOrigins,
  resolveCorsOrigin,
  withCorsHeaders
} from "../src/cors";

describe("api cors helpers", () => {
  const allowedOrigins = parseCorsAllowedOrigins(
    "https://flow.deltaisland.io, http://127.0.0.1:3000/, http://localhost:3100"
  );

  it("normalizes configured origins", () => {
    expect(allowedOrigins.has("https://flow.deltaisland.io")).toBe(true);
    expect(allowedOrigins.has("http://127.0.0.1:3000")).toBe(true);
    expect(allowedOrigins.has("http://localhost:3100")).toBe(true);
    expect(allowedOrigins.has("http://127.0.0.1:3000/")).toBe(false);
  });

  it("reflects allowed browser origins", () => {
    const req = new Request("https://api.flow.deltaisland.io/prints/options", {
      headers: {
        origin: "http://127.0.0.1:3000"
      }
    });

    expect(resolveCorsOrigin(req, allowedOrigins)).toBe("http://127.0.0.1:3000");
  });

  it("keeps the hosted-backend web QA fallback port in default origins", () => {
    const defaultOrigins = parseCorsAllowedOrigins(DEFAULT_API_CORS_ORIGINS);
    const req = new Request("https://api.flow.deltaisland.io/history/news", {
      headers: {
        origin: "http://localhost:3100"
      }
    });

    expect(resolveCorsOrigin(req, defaultOrigins)).toBe("http://localhost:3100");
  });

  it("does not reflect unknown origins", () => {
    const req = new Request("https://api.flow.deltaisland.io/prints/options", {
      headers: {
        origin: "http://evil.example"
      }
    });

    expect(resolveCorsOrigin(req, allowedOrigins)).toBeNull();
  });

  it("adds cors headers to normal responses for allowed origins", async () => {
    const req = new Request("https://api.flow.deltaisland.io/health", {
      headers: {
        origin: "https://flow.deltaisland.io"
      }
    });
    const response = withCorsHeaders(
      req,
      new Response(JSON.stringify({ status: "ok" }), {
        headers: {
          "content-type": "application/json"
        }
      }),
      allowedOrigins
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://flow.deltaisland.io");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers preflight requests for allowed origins", () => {
    const req = new Request("https://api.flow.deltaisland.io/lookup/options-support", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3100",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization"
      }
    });
    const response = createCorsPreflightResponse(req, allowedOrigins);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3100");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type,authorization");
  });
});
