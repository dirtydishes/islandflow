import { describe, expect, it } from "bun:test";
import { isAlertContextPath, parseAlertContextTraceIdPath } from "../src/alert-context";

describe("alert context route helpers", () => {
  it("extracts a valid alert trace id from the context endpoint path", () => {
    expect(parseAlertContextTraceIdPath("/flow/alerts/alert%3Actx%2Fone/context")).toBe("alert:ctx/one");
  });

  it("returns null for unrelated alert paths", () => {
    expect(isAlertContextPath("/flow/alerts")).toBe(false);
    expect(parseAlertContextTraceIdPath("/flow/alerts/alert:ctx")).toBeNull();
  });

  it("rejects malformed trace ids safely", () => {
    expect(() => parseAlertContextTraceIdPath("/flow/alerts/%20/context")).toThrow();
    expect(() => parseAlertContextTraceIdPath("/flow/alerts/%24bad/context")).toThrow();
  });
});
