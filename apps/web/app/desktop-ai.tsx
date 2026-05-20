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

declare global {
  interface Window {
    islandflowDesktop?: DesktopAiBridge;
  }
}

type DesktopAiContextValue = {
  bridgeAvailable: boolean;
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

const createUnavailableState = (): IslandflowAiState => ({
  desktopAvailable: false,
  transportStatus: "stopped",
  transportError: "Desktop AI is only available inside the Islandflow Electron app.",
  profiles: [
    {
      id: "managed-chatgpt",
      label: "Managed ChatGPT login",
      description: "Available only in the desktop app.",
      mode: "managed-chatgpt",
      enabled: false,
      selected: true,
      statusLabel: "Desktop only"
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
      message: "Open Islandflow Desktop to connect a ChatGPT or Codex account."
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
});

const DesktopAiContext = createContext<DesktopAiContextValue | null>(null);

const rejectDesktopOnly = async (): Promise<never> => {
  throw new Error("Desktop AI is only available inside the Islandflow Electron app.");
};

export function DesktopAiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IslandflowAiState>(() => createUnavailableState());
  const [bridge, setBridge] = useState<DesktopAiBridge | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextBridge = window.islandflowDesktop ?? null;
    if (!nextBridge?.ai) {
      setBridge(null);
      setState(createUnavailableState());
      return;
    }

    setBridge(nextBridge);
    let unsubscribe = () => {};
    void nextBridge.ai.getState().then(setState).catch(() => {
      setState((current) => ({
        ...current,
        transportStatus: "error",
        transportError: "The desktop AI bridge could not load its initial state."
      }));
    });

    unsubscribe = nextBridge.ai.subscribe((nextState) => {
      setState(nextState);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const value = useMemo<DesktopAiContextValue>(
    () => ({
      bridgeAvailable: Boolean(bridge?.ai),
      state,
      loginWithBrowser: bridge?.ai.loginWithBrowser ?? rejectDesktopOnly,
      loginWithDeviceCode: bridge?.ai.loginWithDeviceCode ?? rejectDesktopOnly,
      cancelLogin: bridge?.ai.cancelLogin ?? rejectDesktopOnly,
      logout: bridge?.ai.logout ?? rejectDesktopOnly,
      updatePreferences: bridge?.ai.updatePreferences ?? rejectDesktopOnly,
      runTask: bridge?.ai.runTask ?? rejectDesktopOnly
    }),
    [bridge, state]
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
