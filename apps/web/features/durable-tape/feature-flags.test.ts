import { describe, expect, it } from "bun:test";

import { resolveDurableTapeFeatures } from "./feature-flags";

describe("durable tape feature resolver", () => {
  it("expands default features in place", () => {
    const resolved = resolveDurableTapeFeatures(["default"]);

    expect(resolved.liveHotHead).toBe(true);
    expect(resolved.clickhouseHistory).toBe(true);
    expect(resolved.scrollHold).toBe(true);
    expect(resolved.jumpToLive).toBe(true);
    expect(resolved.noHorizontalScroll).toBe(true);
    expect(resolved.template).toBe("auto");
  });

  it("applies structured overrides left to right", () => {
    const resolved = resolveDurableTapeFeatures([
      "default",
      { key: "settingsGear", enabled: false },
      { key: "template", value: "twoThirds" },
      { key: "settingsGear", enabled: true },
      { key: "template", value: "half" }
    ]);

    expect(resolved.settingsGear).toBe(true);
    expect(resolved.template).toBe("half");
  });

  it("does not mutate feature input objects", () => {
    const override = { key: "scrollHold" as const, enabled: false };
    const inputs = ["default" as const, override] as const;

    resolveDurableTapeFeatures(inputs);

    expect(override).toEqual({ key: "scrollHold", enabled: false });
    expect(inputs).toEqual(["default", { key: "scrollHold", enabled: false }]);
  });

  it("rejects unknown feature strings", () => {
    expect(() => resolveDurableTapeFeatures(["default", "bogus" as any])).toThrow(
      "Unknown durable tape feature"
    );
  });
});
