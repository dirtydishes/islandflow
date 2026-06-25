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
    "https://app.example.test, http://127.0.0.1:3000/, http://localhost:3100"
  );

  it("normalizes configured origins", () => {
    expect(allowedOrigins.has("https://app.example.test")).toBe(true);
    expect(allowedOrigins.has("http://127.0.0.1:3000")).toBe(true);
    expect(allowedOrigins.has("http://localhost:3100")).toBe(true);
    expect(allowedOrigins.has("http://127.0.0.1:3000/")).toBe(false);
  });

  it("reflects allowed browser origins", () => {
    const req = new Request("https://api.example.test/prints/options", {
      headers: {
        origin: "http://127.0.0.1:3000"
      }
    });

    expect(resolveCorsOrigin(req, allowedOrigins)).toBe("http://127.0.0.1:3000");
  });

  it("keeps the alternate local web dev port in default origins", () => {
    const defaultOrigins = parseCorsAllowedOrigins(DEFAULT_API_CORS_ORIGINS);

    for (const origin of ["http://127.0.0.1:3100", "http://localhost:3100"]) {
      const req = new Request("https://api.example.test/history/news", {
        headers: {
          origin
        }
      });

      expect(resolveCorsOrigin(req, defaultOrigins)).toBe(origin);
    }
  });

  it("does not reflect unknown origins", () => {
    const req = new Request("https://api.example.test/prints/options", {
      headers: {
        origin: "http://evil.example"
      }
    });

    expect(resolveCorsOrigin(req, allowedOrigins)).toBeNull();
  });

  it("adds cors headers to normal responses for allowed origins", async () => {
    const req = new Request("https://api.example.test/health", {
      headers: {
        origin: "https://app.example.test"
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

    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers preflight requests for allowed origins", () => {
    const req = new Request("https://api.example.test/lookup/options-support", {
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
