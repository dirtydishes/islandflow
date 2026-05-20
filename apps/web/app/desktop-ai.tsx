"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type {
  IslandflowAiReasoningEffort,
  IslandflowAiState,
  IslandflowAiTaskRequest
} from "@islandflow/types";

type DesktopAiBridge = {
  ai: {
    getState: () => Promise<IslandflowAiState>;
    loginWithBrowser: () => Promise<void>;
    loginWithDeviceCode: () => Promise<void>;
    cancelLogin: () => Promise<void>;
    logout: () => Promise<void>;
    updatePreferences: (
      next: Partial<{ model: string | null; reasoningEffort: IslandflowAiReasoningEffort | null }>
    ) => Promise<void>;
    runTask: (request: IslandflowAiTaskRequest) => Promise<{ taskId: string }>;
    subscribe: (listener: (state: IslandflowAiState) => void) => () => void;
  };
};

type DesktopAiRuntime = {
  shellAvailable: boolean;
  bridgeAvailable: boolean;
  bridge: DesktopAiBridge | null;
};

declare global {
  interface Window {
    islandflowDesktop?: DesktopAiBridge;
  }
}

type DesktopAiContextValue = {
  bridgeAvailable: boolean;
  shellAvailable: boolean;
  state: IslandflowAiState;
  loginWithBrowser: () => Promise<void>;
  loginWithDeviceCode: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (
    next: Partial<{ model: string | null; reasoningEffort: IslandflowAiReasoningEffort | null }>
  ) => Promise<void>;
  runTask: (request: IslandflowAiTaskRequest) => Promise<{ taskId: string }>;
};

const BRIDGE_POLL_INTERVAL_MS = 250;
const BRIDGE_POLL_MAX_ATTEMPTS = 20;
const ELECTRON_USER_AGENT_PATTERN = /\bElectron\/\S+/i;

export const detectDesktopShell = (userAgent: string | null | undefined): boolean =>
  Boolean(userAgent && ELECTRON_USER_AGENT_PATTERN.test(userAgent));

export const resolveDesktopAiRuntime = (
  value:
    | {
        islandflowDesktop?: DesktopAiBridge;
        navigator?: { userAgent?: string | null };
      }
    | null
    | undefined
): DesktopAiRuntime => {
  const bridge = value?.islandflowDesktop?.ai ? value.islandflowDesktop : null;
  const bridgeAvailable = Boolean(bridge?.ai);
  const shellAvailable = bridgeAvailable || detectDesktopShell(value?.navigator?.userAgent);

  return {
    shellAvailable,
    bridgeAvailable,
    bridge
  };
};

export const createUnavailableState = (runtime?: Partial<DesktopAiRuntime>): IslandflowAiState => {
  const shellAvailable = Boolean(runtime?.shellAvailable || runtime?.bridgeAvailable);
  const bridgeAvailable = Boolean(runtime?.bridgeAvailable);
  const transportError = !shellAvailable
    ? "Desktop AI is only available inside the Islandflow Electron app."
    : bridgeAvailable
    ? "The desktop AI bridge loaded, but its initial state could not be read."
    : "Islandflow Desktop is open, but the native AI bridge is unavailable in this session.";
  const loginMessage = !shellAvailable
    ? "Open Islandflow Desktop to connect a ChatGPT or Codex account."
    : bridgeAvailable
    ? "The desktop bridge connected, but its initial state did not load. Retry the action or restart Islandflow if this persists."
    : "This desktop window is missing its native AI bridge. Reload the window or restart Islandflow if this persists.";

  return {
    desktopAvailable: shellAvailable,
    transportStatus: shellAvailable ? "error" : "stopped",
    transportError,
    profiles: [
      {
        id: "managed-chatgpt",
        label: "Managed ChatGPT login",
        description: shellAvailable
          ? "Managed ChatGPT login belongs to the desktop shell, but this window is not connected to the native bridge yet."
          : "Available only in the desktop app.",
        mode: "managed-chatgpt",
        enabled: shellAvailable,
        selected: true,
        statusLabel: shellAvailable ? "Bridge unavailable" : "Desktop only"
      }
    ],
    selectedProfileId: "managed-chatgpt",
    account: {
      loggedIn: false,
      email: null,
      planType: null,
      authMode: null,
      requiresOpenaiAuth: true,
      login: {
        status: "idle",
        message: loginMessage
      }
    },
    preferences: {
      model: null,
      reasoningEffort: "high"
    },
    models: [],
    rateLimitsByLimitId: {},
    usage: {
      today: {
        breakdown: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0
        },
        normalizedCostUsd: 0,
        turnCount: 0,
        activeDays: 0
      },
      lifetime: {
        breakdown: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0
        },
        normalizedCostUsd: 0,
        turnCount: 0,
        activeDays: 0
      },
      recentTurns: []
    },
    tasks: [],
    updatedAt: Date.now()
  };
};

const DesktopAiContext = createContext<DesktopAiContextValue | null>(null);

const rejectDesktopOnly = async (): Promise<never> => {
  throw new Error("Desktop AI is only available inside the Islandflow Electron app.");
};

export function DesktopAiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IslandflowAiState>(() => createUnavailableState());
  const [bridge, setBridge] = useState<DesktopAiBridge | null>(null);
  const [shellAvailable, setShellAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let unsubscribe = () => {};
    let pollTimer: number | null = null;
    let attempts = 0;

    const connectBridge = (runtime: DesktopAiRuntime): boolean => {
      if (!runtime.bridge) {
        return false;
      }

      setShellAvailable(runtime.shellAvailable);
      setBridge(runtime.bridge);
      void runtime.bridge.ai.getState().then(
        (nextState) => {
          if (!disposed) {
            setState(nextState);
          }
        },
        () => {
          if (!disposed) {
            setState(createUnavailableState(runtime));
          }
        }
      );

      unsubscribe = runtime.bridge.ai.subscribe((nextState) => {
        if (!disposed) {
          setState(nextState);
        }
      });

      return true;
    };

    const syncRuntime = (): boolean => {
      const runtime = resolveDesktopAiRuntime(window);
      setShellAvailable(runtime.shellAvailable);
      if (connectBridge(runtime)) {
        return true;
      }

      setBridge(null);
      setState(createUnavailableState(runtime));
      return false;
    };

    if (!syncRuntime()) {
      const pollForBridge = () => {
        if (disposed) {
          return;
        }

        attempts += 1;
        if (syncRuntime() || attempts >= BRIDGE_POLL_MAX_ATTEMPTS) {
          return;
        }

        pollTimer = window.setTimeout(pollForBridge, BRIDGE_POLL_INTERVAL_MS);
      };

      pollTimer = window.setTimeout(pollForBridge, BRIDGE_POLL_INTERVAL_MS);
    }

    return () => {
      disposed = true;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
      unsubscribe();
    };
  }, []);

  const value = useMemo<DesktopAiContextValue>(
    () => ({
      bridgeAvailable: Boolean(bridge?.ai),
      shellAvailable,
      state,
      loginWithBrowser: bridge?.ai.loginWithBrowser ?? rejectDesktopOnly,
      loginWithDeviceCode: bridge?.ai.loginWithDeviceCode ?? rejectDesktopOnly,
      cancelLogin: bridge?.ai.cancelLogin ?? rejectDesktopOnly,
      logout: bridge?.ai.logout ?? rejectDesktopOnly,
      updatePreferences: bridge?.ai.updatePreferences ?? rejectDesktopOnly,
      runTask: bridge?.ai.runTask ?? rejectDesktopOnly
    }),
    [bridge, shellAvailable, state]
  );

  return <DesktopAiContext.Provider value={value}>{children}</DesktopAiContext.Provider>;
}

export const useDesktopAi = (): DesktopAiContextValue => {
  const value = useContext(DesktopAiContext);
  if (!value) {
    throw new Error("Desktop AI context missing");
  }
  return value;
};
