import { describe, expect, it } from "bun:test";
import { booleanEnvSchema } from "../src/env";

describe("booleanEnvSchema", () => {
  it("parses explicit string booleans without treating every non-empty string as true", () => {
    expect(booleanEnvSchema.parse("true")).toBe(true);
    expect(booleanEnvSchema.parse("1")).toBe(true);
    expect(booleanEnvSchema.parse("yes")).toBe(true);
    expect(booleanEnvSchema.parse("on")).toBe(true);
    expect(booleanEnvSchema.parse("false")).toBe(false);
    expect(booleanEnvSchema.parse("0")).toBe(false);
    expect(booleanEnvSchema.parse("no")).toBe(false);
    expect(booleanEnvSchema.parse("off")).toBe(false);
  });

  it("preserves native booleans and rejects ambiguous strings", () => {
    expect(booleanEnvSchema.parse(true)).toBe(true);
    expect(booleanEnvSchema.parse(false)).toBe(false);
    expect(() => booleanEnvSchema.parse("enabled")).toThrow();
  });
});
