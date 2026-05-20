import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { Event as ElectronEvent, IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_PRODUCTION_URL,
  isSafeExternalUrl,
  isTrustedAppUrl,
  resolveDesktopStartUrl
} from "./security.js";
import { IslandflowDesktopAiService } from "./desktop-ai.js";
import {
  DESKTOP_AI_CANCEL_LOGIN,
  DESKTOP_AI_GET_STATE,
  DESKTOP_AI_LOGIN_BROWSER,
  DESKTOP_AI_LOGIN_DEVICE,
  DESKTOP_AI_LOGOUT,
  DESKTOP_AI_RUN_TASK,
  DESKTOP_AI_STATE_CHANNEL,
  DESKTOP_AI_UPDATE_PREFERENCES
} from "./desktop-ai-ipc.js";

const WINDOW_BACKGROUND_COLOR = "#06080b";
const WINDOW_TITLE = "Islandflow";

let mainWindow: BrowserWindow | null = null;
let desktopAiService: IslandflowDesktopAiService | null = null;

const PRELOAD_PATH = fileURLToPath(new URL("./preload.js", import.meta.url));

const canOpenExternalUrl = (sourceUrl: string, targetUrl: string): boolean => {
  return isTrustedAppUrl(sourceUrl) && isSafeExternalUrl(targetUrl);
};

const openExternalUrl = async (sourceUrl: string, targetUrl: string): Promise<void> => {
  if (!canOpenExternalUrl(sourceUrl, targetUrl)) {
    return;
  }

  await shell.openExternal(targetUrl);
};

const installNavigationGuards = (window: BrowserWindow): void => {
  const { webContents } = window;
  const { session } = webContents;

  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const handleNavigationAttempt = (event: ElectronEvent, targetUrl: string) => {
    if (isTrustedAppUrl(targetUrl)) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(webContents.getURL(), targetUrl);
  };

  webContents.on("will-navigate", handleNavigationAttempt);
  webContents.on("will-redirect", handleNavigationAttempt);

  webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(webContents.getURL(), url);
    return { action: "deny" };
  });
};

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    title: WINDOW_TITLE,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });

  installNavigationGuards(window);

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const startUrl = resolveDesktopStartUrl(process.env.ISLANDFLOW_DESKTOP_START_URL);
  if (process.env.ISLANDFLOW_DESKTOP_START_URL && startUrl === DESKTOP_PRODUCTION_URL) {
    console.warn(
      `[desktop] Refused untrusted ISLANDFLOW_DESKTOP_START_URL; falling back to ${DESKTOP_PRODUCTION_URL}`
    );
  }

  void window.loadURL(startUrl);
  return window;
};

const broadcastDesktopAiState = (): void => {
  if (!desktopAiService) {
    return;
  }

  const state = desktopAiService.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DESKTOP_AI_STATE_CHANNEL, state);
  }
};

const getTrustedSenderUrl = (event: IpcMainInvokeEvent): string => {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedAppUrl(senderUrl)) {
    throw new Error(`Rejected desktop AI IPC from untrusted origin: ${senderUrl || "unknown"}`);
  }

  return senderUrl;
};

const registerDesktopAiIpc = (service: IslandflowDesktopAiService): void => {
  const guard = (event: IpcMainInvokeEvent): void => {
    getTrustedSenderUrl(event);
  };

  ipcMain.handle(DESKTOP_AI_GET_STATE, async (event) => {
    guard(event);
    await service.start();
    return service.getState();
  });

  ipcMain.handle(DESKTOP_AI_LOGIN_BROWSER, async (event) => {
    guard(event);
    await service.loginWithBrowser();
  });

  ipcMain.handle(DESKTOP_AI_LOGIN_DEVICE, async (event) => {
    guard(event);
    await service.loginWithDeviceCode();
  });

  ipcMain.handle(DESKTOP_AI_CANCEL_LOGIN, async (event) => {
    guard(event);
    await service.cancelLogin();
  });

  ipcMain.handle(DESKTOP_AI_LOGOUT, async (event) => {
    guard(event);
    await service.logout();
  });

  ipcMain.handle(DESKTOP_AI_UPDATE_PREFERENCES, async (event, next) => {
    guard(event);
    await service.updatePreferences(next);
  });

  ipcMain.handle(DESKTOP_AI_RUN_TASK, async (event, request) => {
    guard(event);
    return service.runTask(request);
  });
};

const ensureMainWindow = (): void => {
  if (mainWindow) {
    return;
  }

  mainWindow = createMainWindow();
};

app.whenReady().then(() => {
  desktopAiService = new IslandflowDesktopAiService(
    app.getPath("userData"),
    async (url) => {
      await shell.openExternal(url);
    },
    () => {
      broadcastDesktopAiState();
    }
  );
  registerDesktopAiIpc(desktopAiService);
  void desktopAiService.start().catch((error) => {
    console.error("[desktop-ai] Failed to start Codex bridge:", error);
    broadcastDesktopAiState();
  });
  ensureMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ensureMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
