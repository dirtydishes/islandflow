import { describe, expect, it } from "bun:test";
import {
  DEFAULT_REMOTE_API_URL,
  DEFAULT_WEB_DEV_PORT,
  HOSTED_API_QA_WEB_DEV_PORT,
  resolveWebDevConfig
} from "./dev-config";

describe("web dev config", () => {
  it("defaults to the hosted API on localhost port 3000", () => {
    expect(resolveWebDevConfig({})).toEqual({
      apiUrl: DEFAULT_REMOTE_API_URL,
      apiUrlSource: "default",
      hostedApiCorsWarning: null,
      port: DEFAULT_WEB_DEV_PORT,
      portSource: "default"
    });
  });

  it("allows the supported hosted-backend QA fallback port", () => {
    expect(resolveWebDevConfig({ WEB_DEV_PORT: String(HOSTED_API_QA_WEB_DEV_PORT) })).toEqual({
      apiUrl: DEFAULT_REMOTE_API_URL,
      apiUrlSource: "default",
      hostedApiCorsWarning: null,
      port: HOSTED_API_QA_WEB_DEV_PORT,
      portSource: "WEB_DEV_PORT"
    });
  });

  it("lets WEB_DEV_PORT override a generic PORT value", () => {
    expect(resolveWebDevConfig({ PORT: "3001", WEB_DEV_PORT: "3100" }).port).toBe(3100);
    expect(resolveWebDevConfig({ PORT: "3001", WEB_DEV_PORT: "3100" }).portSource).toBe(
      "WEB_DEV_PORT"
    );
  });

  it("accepts PORT for environments that already set it", () => {
    expect(resolveWebDevConfig({ PORT: "3100" })).toMatchObject({
      port: 3100,
      portSource: "PORT"
    });
  });

  it("warns when the hosted API is paired with an unsupported local port", () => {
    const config = resolveWebDevConfig({ WEB_DEV_PORT: "3001" });

    expect(config.hostedApiCorsWarning).toContain("WEB_DEV_PORT=3100");
  });

  it("does not warn about custom API origins", () => {
    const config = resolveWebDevConfig({
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
      WEB_DEV_PORT: "3001"
    });

    expect(config.hostedApiCorsWarning).toBeNull();
  });

  it("rejects invalid port values before starting Next.js", () => {
    expect(() => resolveWebDevConfig({ WEB_DEV_PORT: "0" })).toThrow("WEB_DEV_PORT");
    expect(() => resolveWebDevConfig({ PORT: "abc" })).toThrow("PORT");
  });
});
