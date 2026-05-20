import { describe, expect, it } from "bun:test";

import { ChartsRoute, ReplayRoute, SettingsRoute, SignalsRoute } from "./terminal";

describe("route entrypoints", () => {
  it("renders the signals route directly", async () => {
    const mod = await import("./signals/page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect((mod.default() as any).type).toBe(SignalsRoute);
  });

  it("renders the charts route directly", async () => {
    const mod = await import("./charts/page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect((mod.default() as any).type).toBe(ChartsRoute);
  });

  it("renders the replay route directly", async () => {
    const mod = await import("./replay/page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect((mod.default() as any).type).toBe(ReplayRoute);
  });

  it("renders the settings route directly", async () => {
    const mod = await import("./settings/page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect((mod.default() as any).type).toBe(SettingsRoute);
  });
});
