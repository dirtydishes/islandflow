import { describe, expect, it } from "bun:test";

import { resolveDurableTapeComponentFeatures, resolveDurableTapeFeatures } from "./feature-flags";
import { resolveDurableTapeRowDecoration } from "./row-hooks";

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

  it("keeps feature-level template overrides when no template prop is supplied", () => {
    const resolved = resolveDurableTapeComponentFeatures({
      features: ["default", { key: "template", value: "twoThirds" }]
    });

    expect(resolved.template).toBe("twoThirds");
  });

  it("lets an explicit template prop override feature-level template entries", () => {
    const resolved = resolveDurableTapeComponentFeatures({
      features: ["default", { key: "template", value: "twoThirds" }],
      template: "half"
    });

    expect(resolved.template).toBe("half");
  });
});

describe("durable tape row hook resolver", () => {
  const input = {
    item: { id: "row-1" },
    rowKey: "row-1",
    index: 3
  };

  it("returns row class and style hooks when row tinting is enabled", () => {
    const resolved = resolveDurableTapeRowDecoration({
      enabled: true,
      input,
      getRowClassName: ({ rowKey, index }) => `row-${rowKey}-${index}`,
      getRowStyle: ({ item }) => ({ opacity: item.id === "row-1" ? 0.8 : 1 })
    });

    expect(resolved).toEqual({
      className: "row-row-1-3",
      style: { opacity: 0.8 }
    });
  });

  it("does not call row hooks when row tinting is disabled", () => {
    let calls = 0;
    const resolved = resolveDurableTapeRowDecoration({
      enabled: false,
      input,
      getRowClassName: () => {
        calls += 1;
        return "should-not-apply";
      },
      getRowStyle: () => {
        calls += 1;
        return { opacity: 0.1 };
      }
    });

    expect(resolved).toEqual({});
    expect(calls).toBe(0);
  });
});
