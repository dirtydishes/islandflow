import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAppServerChildEnv, IslandflowDesktopAiService, summarizeRateLimit } from "./desktop-ai.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "islandflow-desktop-ai-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("desktop ai auth environment", () => {
  it("scrubs global OpenAI keys for managed ChatGPT sessions", () => {
    const env = createAppServerChildEnv("managed-chatgpt", {
      OPENAI_API_KEY: "openai-test",
      CODEX_API_KEY: "codex-test",
      HOME: "/tmp/home"
    });

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.HOME).toBe("/tmp/home");
  });

  it("preserves keys for api-key mode", () => {
    const env = createAppServerChildEnv("api-key", {
      OPENAI_API_KEY: "openai-test",
      CODEX_API_KEY: "codex-test"
    });

    expect(env.OPENAI_API_KEY).toBe("openai-test");
    expect(env.CODEX_API_KEY).toBe("codex-test");
  });
});

describe("desktop ai usage and state tracking", () => {
  it("records exact token usage notifications into usage rollups", async () => {
    const dir = await makeTempDir();
    const service = new IslandflowDesktopAiService(dir, async () => {}, () => {});
    const internal = service as any;

    internal.state.account.email = "analyst@example.com";
    internal.state.account.planType = "plus";
    internal.state.preferences.model = "gpt-5.4";
    internal.state.tasks = [
      {
        taskId: "task-1",
        kind: "smart-money-explain",
        title: "Explain smart money event",
        subtitle: "AAPL",
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        threadId: "thread-1",
        turnId: "turn-1",
        model: "gpt-5.4",
        reasoningEffort: "high",
        text: "",
        error: null,
        compiledScreen: null
      }
    ];
    internal.activeTasksByThreadId.set("thread-1", {
      taskId: "task-1",
      taskKind: "smart-money-explain",
      taskTitle: "Explain smart money event",
      profileId: "managed-chatgpt"
    });

    await internal.handleNotification("thread/tokenUsage/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      tokenUsage: {
        total: {
          totalTokens: 1800,
          inputTokens: 1000,
          cachedInputTokens: 500,
          outputTokens: 250,
          reasoningOutputTokens: 50
        },
        last: {
          totalTokens: 1800,
          inputTokens: 1000,
          cachedInputTokens: 500,
          outputTokens: 250,
          reasoningOutputTokens: 50
        }
      }
    });

    expect(service.getState().usage.today.breakdown).toEqual({
      totalTokens: 1800,
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 250,
      reasoningOutputTokens: 50
    });
    expect(service.getState().usage.today.turnCount).toBe(1);
    expect(service.getState().usage.recentTurns[0]?.normalizedCostUsd).toBeCloseTo(0.007125, 6);
  });

  it("stores rate-limit snapshots with reset times", async () => {
    const dir = await makeTempDir();
    const service = new IslandflowDesktopAiService(dir, async () => {}, () => {});
    const internal = service as any;

    await internal.handleNotification("account/rateLimits/updated", {
      rateLimits: {
        limitId: "chatgpt_plus",
        limitName: "ChatGPT Plus",
        primary: {
          usedPercent: 38.4,
          windowDurationMins: 180,
          resetsAt: 1_710_000_000_000
        },
        secondary: {
          usedPercent: 12.1,
          windowDurationMins: 1440,
          resetsAt: 1_710_003_600_000
        },
        planType: "plus"
      }
    });

    expect(service.getState().rateLimitsByLimitId.chatgpt_plus).toEqual(
      summarizeRateLimit({
        limitId: "chatgpt_plus",
        limitName: "ChatGPT Plus",
        primary: {
          usedPercent: 38.4,
          windowDurationMins: 180,
          resetsAt: 1_710_000_000_000
        },
        secondary: {
          usedPercent: 12.1,
          windowDurationMins: 1440,
          resetsAt: 1_710_003_600_000
        },
        planType: "plus"
      })
    );
  });

  it("clears local account state on logout", async () => {
    const dir = await makeTempDir();
    const service = new IslandflowDesktopAiService(dir, async () => {}, () => {});
    const internal = service as any;

    internal.client = {
      request: async () => ({})
    };
    internal.state.account.loggedIn = true;
    internal.state.account.email = "analyst@example.com";
    internal.state.account.planType = "plus";
    internal.state.account.login = { status: "browser_pending", message: "Waiting", loginId: "login-1", authUrl: "https://example.com" };

    await service.logout();

    expect(service.getState().account.loggedIn).toBe(false);
    expect(service.getState().account.email).toBeNull();
    expect(service.getState().account.planType).toBeNull();
    expect(service.getState().account.login).toEqual({ status: "idle", message: "Logged out." });
  });
});
