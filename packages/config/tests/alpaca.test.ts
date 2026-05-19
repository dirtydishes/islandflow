import { describe, expect, it } from "bun:test";
import {
  buildAlpacaAuthHeaders,
  buildAlpacaWebSocketAuthMessage,
  hasAlpacaCredentials,
  resolveAlpacaCredentials
} from "../src/alpaca";

describe("resolveAlpacaCredentials", () => {
  it("prefers explicit key-id and secret vars", () => {
    const credentials = resolveAlpacaCredentials({
      ALPACA_API_KEY: "legacy-token",
      ALPACA_API_KEY_ID: "key-id",
      ALPACA_API_SECRET_KEY: "secret"
    });

    expect(credentials).toEqual({
      keyId: "key-id",
      secret: "secret",
      legacyToken: "legacy-token",
      usesLegacyBearer: false
    });
    expect(hasAlpacaCredentials(credentials)).toBe(true);
    expect(buildAlpacaAuthHeaders(credentials)).toEqual({
      "APCA-API-KEY-ID": "key-id",
      "APCA-API-SECRET-KEY": "secret"
    });
    expect(buildAlpacaWebSocketAuthMessage(credentials)).toEqual({
      action: "auth",
      key: "key-id",
      secret: "secret"
    });
  });

  it("supports the older bearer-token fallback when no secret exists", () => {
    const credentials = resolveAlpacaCredentials({
      ALPACA_API_KEY: "legacy-token"
    });

    expect(credentials.usesLegacyBearer).toBe(true);
    expect(hasAlpacaCredentials(credentials)).toBe(true);
    expect(buildAlpacaAuthHeaders(credentials)).toEqual({
      Authorization: "Bearer legacy-token"
    });
    expect(buildAlpacaWebSocketAuthMessage(credentials)).toEqual({
      action: "auth",
      key: "legacy-token",
      secret: ""
    });
  });

  it("supports alternate secret env names", () => {
    const credentials = resolveAlpacaCredentials({
      ALPACA_KEY_ID: "short-key",
      ALPACA_SECRET_KEY: "short-secret"
    });

    expect(credentials).toEqual({
      keyId: "short-key",
      secret: "short-secret",
      legacyToken: "",
      usesLegacyBearer: false
    });
  });
});
