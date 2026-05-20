import { contextBridge, ipcRenderer } from "electron";
import type {
  IslandflowAiReasoningEffort,
  IslandflowAiState,
  IslandflowAiTaskRequest
} from "@islandflow/types";
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

const bridge = {
  ai: {
    getState: (): Promise<IslandflowAiState> => ipcRenderer.invoke(DESKTOP_AI_GET_STATE),
    loginWithBrowser: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_LOGIN_BROWSER),
    loginWithDeviceCode: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_LOGIN_DEVICE),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_CANCEL_LOGIN),
    logout: (): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_LOGOUT),
    updatePreferences: (
      next: Partial<{ model: string | null; reasoningEffort: IslandflowAiReasoningEffort | null }>
    ): Promise<void> => ipcRenderer.invoke(DESKTOP_AI_UPDATE_PREFERENCES, next),
    runTask: (request: IslandflowAiTaskRequest): Promise<{ taskId: string }> =>
      ipcRenderer.invoke(DESKTOP_AI_RUN_TASK, request),
    subscribe: (listener: (state: IslandflowAiState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: IslandflowAiState) => {
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
