import { describe, expect, it } from "bun:test";

import {
  createUnavailableState,
  detectDesktopShell,
  resolveDesktopAiRuntime,
} from "./desktop-ai";
import {
  getDesktopAiModelListEmptyCopy,
  getDesktopAiModelSelectLabel,
  getDesktopAiProfileBadgeLabel,
  getDesktopAiSettingsBridgeNotice,
  requireDesktopActionCopy,
} from "./desktop-ai-panels";

describe("desktop ai runtime detection", () => {
  it("recognizes Electron user agents before the bridge is available", () => {
    const runtime = resolveDesktopAiRuntime({
      navigator: {
        userAgent: "Mozilla/5.0 Islandflow Electron/39.0.0 Safari/537.36",
      },
    });

    expect(runtime.shellAvailable).toBe(true);
    expect(runtime.bridgeAvailable).toBe(false);
    expect(runtime.bridge).toBeNull();
  });

  it("treats a bridged window as desktop even without an Electron user agent", () => {
    const runtime = resolveDesktopAiRuntime({
      islandflowDesktop: {
        ai: {
          getState: async () =>
            createUnavailableState({
              shellAvailable: true,
              bridgeAvailable: true,
            }),
          loginWithBrowser: async () => {},
          loginWithDeviceCode: async () => {},
          cancelLogin: async () => {},
          logout: async () => {},
          updatePreferences: async () => {},
          runTask: async () => ({ taskId: "task-1" }),
          subscribe: () => () => {},
        },
      },
      navigator: { userAgent: "Mozilla/5.0" },
    });

    expect(runtime.shellAvailable).toBe(true);
    expect(runtime.bridgeAvailable).toBe(true);
    expect(runtime.bridge).not.toBeNull();
  });
});

describe("desktop ai unavailable state", () => {
  it("keeps desktopAvailable false for real browser fallbacks", () => {
    const state = createUnavailableState();

    expect(state.desktopAvailable).toBe(false);
    expect(state.transportStatus).toBe("stopped");
    expect(state.transportError).toContain("Electron app");
  });

  it("reports desktop-shell bridge failures without pretending the app is a browser", () => {
    const state = createUnavailableState({ shellAvailable: true });

    expect(state.desktopAvailable).toBe(true);
    expect(state.transportStatus).toBe("error");
    expect(state.transportError).toContain("native AI bridge");
    expect(state.account.login.message).toContain("Reload the window");
  });
});

describe("desktop action copy", () => {
  it("asks for the desktop app only when the shell is genuinely absent", () => {
    expect(requireDesktopActionCopy(false, false, false)).toContain(
      "Open Islandflow Desktop",
    );
  });

  it("surfaces bridge recovery guidance inside the desktop shell", () => {
    expect(requireDesktopActionCopy(true, false, false)).toContain(
      "missing the native AI bridge",
    );
  });

  it("asks for login once the bridge is present", () => {
    expect(requireDesktopActionCopy(true, true, false)).toContain(
      "Connect a ChatGPT or Codex account",
    );
  });

  it("clears helper copy when the action is ready", () => {
    expect(requireDesktopActionCopy(true, true, true)).toBe("");
  });
});

describe("desktop shell detection", () => {
  it("matches Electron signatures", () => {
    expect(detectDesktopShell("Mozilla/5.0 Electron/39.0.0")).toBe(true);
    expect(
      detectDesktopShell("Mozilla/5.0 Chrome/136.0.0.0 Safari/537.36"),
    ).toBe(false);
  });
});

describe("desktop ai settings copy", () => {
  it("explains when the desktop app itself is required", () => {
    expect(getDesktopAiSettingsBridgeNotice(false, false)).toEqual({
      title: "Desktop app required",
      body: "Open Islandflow Desktop to connect ChatGPT, load managed models, and use native Copilot controls.",
    });
  });

  it("explains when the native bridge is missing from the desktop window", () => {
    expect(getDesktopAiSettingsBridgeNotice(true, false)?.title).toBe(
      "Bridge unavailable in this window",
    );
  });

  it("keeps the model selector explicit before login", () => {
    expect(getDesktopAiModelSelectLabel(true, true, false, 0)).toBe(
      "Connect ChatGPT to load models",
    );
    expect(getDesktopAiModelListEmptyCopy(true, true, false)).toContain(
      "Connect a ChatGPT or Codex account",
    );
  });

  it("keeps the model selector explicit while the bridge is disconnected", () => {
    expect(getDesktopAiModelSelectLabel(true, false, false, 0)).toBe(
      "Bridge unavailable",
    );
    expect(getDesktopAiModelListEmptyCopy(true, false, false)).toContain(
      "native AI bridge reconnects",
    );
  });

  it("shows the real status label when a selected profile is unusable", () => {
    expect(
      getDesktopAiProfileBadgeLabel(true, "Bridge unavailable", false),
    ).toBe("Bridge unavailable");
    expect(
      getDesktopAiProfileBadgeLabel(true, "Bridge unavailable", true),
    ).toBe("Selected");
  });
});
