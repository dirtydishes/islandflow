const { contextBridge, ipcRenderer } = require("electron");

const DESKTOP_AI_STATE_CHANNEL = "islandflow:desktop-ai:state";
const DESKTOP_AI_GET_STATE = "islandflow:desktop-ai:get-state";
const DESKTOP_AI_LOGIN_BROWSER = "islandflow:desktop-ai:login-browser";
const DESKTOP_AI_LOGIN_DEVICE = "islandflow:desktop-ai:login-device";
const DESKTOP_AI_CANCEL_LOGIN = "islandflow:desktop-ai:cancel-login";
const DESKTOP_AI_LOGOUT = "islandflow:desktop-ai:logout";
const DESKTOP_AI_UPDATE_PREFERENCES = "islandflow:desktop-ai:update-preferences";
const DESKTOP_AI_RUN_TASK = "islandflow:desktop-ai:run-task";

type DesktopAiState = any;
type DesktopAiTaskRequest = any;
type DesktopAiPreferenceUpdate = Partial<{
  model: string | null;
  reasoningEffort: string | null;
}>;

const bridge = {
  ai: {
    getState: (): Promise<DesktopAiState> => ipcRenderer.invoke(DESKTOP_AI_GET_STATE),
    loginWithBrowser: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_LOGIN_BROWSER),
    loginWithDeviceCode: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_LOGIN_DEVICE),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_CANCEL_LOGIN),
    logout: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_LOGOUT),
    updatePreferences: (next: DesktopAiPreferenceUpdate): Promise<void> =>
      ipcRenderer.invoke(DESKTOP_AI_UPDATE_PREFERENCES, next),
    runTask: (request: DesktopAiTaskRequest): Promise<{ taskId: string }> =>
      ipcRenderer.invoke(DESKTOP_AI_RUN_TASK, request),
    subscribe: (listener: (state: DesktopAiState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: DesktopAiState) => {
        listener(state);
      };

      ipcRenderer.on(DESKTOP_AI_STATE_CHANNEL, handler);
      return () => {
        ipcRenderer.off(DESKTOP_AI_STATE_CHANNEL, handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld("islandflowDesktop", bridge);
