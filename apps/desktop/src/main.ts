import { app, BrowserWindow, shell } from "electron";
import type { Event as ElectronEvent } from "electron";

import {
  DESKTOP_PRODUCTION_URL,
  isSafeExternalUrl,
  isTrustedAppUrl,
  resolveDesktopStartUrl
} from "./security.js";

const WINDOW_BACKGROUND_COLOR = "#06080b";
const WINDOW_TITLE = "Islandflow";

let mainWindow: BrowserWindow | null = null;

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

const ensureMainWindow = (): void => {
  if (mainWindow) {
    return;
  }

  mainWindow = createMainWindow();
};

app.whenReady().then(() => {
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
