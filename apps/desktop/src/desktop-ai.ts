import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IslandflowAiCompiledScreenSchema,
  IslandflowAiProfileModeSchema,
  IslandflowAiReasoningEffortSchema,
  IslandflowAiTaskRequestSchema,
  type IslandflowAiCompiledScreen,
  type IslandflowAiModelSummary,
  type IslandflowAiPlanType,
  type IslandflowAiPricing,
  type IslandflowAiProfileMode,
  type IslandflowAiRateLimitSnapshot,
  type IslandflowAiReasoningEffort,
  type IslandflowAiState,
  type IslandflowAiTaskKind,
  type IslandflowAiTaskRequest,
  type IslandflowAiTaskSnapshot,
  type IslandflowAiTokenBreakdown,
  type IslandflowAiUsageRollup,
  type IslandflowAiUsageTurnRecord
} from "@islandflow/types";

const MANAGED_CHATGPT_PROFILE_ID = "managed-chatgpt";
const WORKSPACE_PROVIDER_PROFILE_ID = "workspace-provider";
const APP_SERVER_SERVICE_NAME = "Islandflow Analyst Copilot";
const APP_SERVER_SANDBOX_CWD = "copilot-sandbox";
const PREFERENCES_FILE = "copilot-preferences.json";
const USAGE_FILE = "copilot-usage.json";
const DEFAULT_REASONING = IslandflowAiReasoningEffortSchema.parse("high");

const EMPTY_BREAKDOWN: IslandflowAiTokenBreakdown = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0
};

type JsonRpcSuccess = {
  id: number;
  result: unknown;
};

type JsonRpcFailure = {
  id: number;
  error: {
    message?: string;
    code?: number;
    data?: unknown;
  };
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
  id?: never;
};

type JsonRpcServerRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcMessage = JsonRpcSuccess | JsonRpcFailure | JsonRpcNotification | JsonRpcServerRequest;

type CodexModelRecord = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: IslandflowAiReasoningEffort }>;
  defaultReasoningEffort: IslandflowAiReasoningEffort | null;
};

type CodexThreadStartResult = {
  thread: {
    id: string;
  };
  model: string;
  reasoningEffort: IslandflowAiReasoningEffort | null;
};

type CodexTurnStartResult = {
  turn: {
    id: string;
  };
};

type PersistedUsageStore = {
  version: 1;
  turns: Record<string, IslandflowAiUsageTurnRecord>;
};

type PersistedPreferences = {
  model: string | null;
  reasoningEffort: IslandflowAiReasoningEffort | null;
};

type OpenExternalFn = (url: string) => Promise<void>;

type ActiveTaskContext = {
  taskId: string;
  taskKind: IslandflowAiTaskKind;
  taskTitle: string;
  profileId: string;
};

const MODEL_PRICING: Record<string, IslandflowAiPricing> = {
  "gpt-5.5": {
    inputUsdPer1MTokens: 5,
    cachedInputUsdPer1MTokens: 0.5,
    outputUsdPer1MTokens: 30,
    sourceLabel: "OpenAI GPT-5.5 model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.5"
  },
  "gpt-5.4": {
    inputUsdPer1MTokens: 2.5,
    cachedInputUsdPer1MTokens: 0.25,
    outputUsdPer1MTokens: 15,
    sourceLabel: "OpenAI GPT-5.4 model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.4"
  },
  "gpt-5.4-mini": {
    inputUsdPer1MTokens: 0.75,
    cachedInputUsdPer1MTokens: 0.075,
    outputUsdPer1MTokens: 4.5,
    sourceLabel: "OpenAI GPT-5.4 mini model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-mini"
  },
  "gpt-5.3-codex": {
    inputUsdPer1MTokens: 1.75,
    cachedInputUsdPer1MTokens: 0.175,
    outputUsdPer1MTokens: 14,
    sourceLabel: "OpenAI GPT-5.3-Codex model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.3-codex"
  },
  "gpt-5.2": {
    inputUsdPer1MTokens: 1.75,
    cachedInputUsdPer1MTokens: 0.175,
    outputUsdPer1MTokens: 14,
    sourceLabel: "OpenAI GPT-5.2 model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.2"
  },
  "gpt-5.2-codex": {
    inputUsdPer1MTokens: 1.75,
    cachedInputUsdPer1MTokens: 0.175,
    outputUsdPer1MTokens: 14,
    sourceLabel: "OpenAI GPT-5.2-Codex model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.2-codex"
  },
  "gpt-5-codex": {
    inputUsdPer1MTokens: 1.25,
    cachedInputUsdPer1MTokens: 0.125,
    outputUsdPer1MTokens: 10,
    sourceLabel: "OpenAI GPT-5-Codex model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5-codex"
  },
  "codex-mini-latest": {
    inputUsdPer1MTokens: 1.5,
    cachedInputUsdPer1MTokens: 0.375,
    outputUsdPer1MTokens: 6,
    sourceLabel: "OpenAI codex-mini-latest model pricing",
    sourceUrl: "https://developers.openai.com/api/docs/models/codex-mini-latest"
  }
};

const createEmptyUsageRollup = (): IslandflowAiUsageRollup => ({
  breakdown: { ...EMPTY_BREAKDOWN },
  normalizedCostUsd: 0,
  turnCount: 0,
  activeDays: 0
});

const createInitialState = (): IslandflowAiState => ({
  desktopAvailable: true,
  transportStatus: "starting",
  transportError: null,
  profiles: [
    {
      id: MANAGED_CHATGPT_PROFILE_ID,
      label: "Managed ChatGPT login",
      description: "User-scoped ChatGPT or Codex sign-in managed by the official app-server.",
      mode: "managed-chatgpt",
      enabled: true,
      selected: true,
      statusLabel: "Active"
    },
    {
      id: WORKSPACE_PROVIDER_PROFILE_ID,
      label: "Workspace provider slot",
      description: "Reserved for future shared API-key or enterprise access-token flows.",
      mode: "workspace-provider",
      enabled: false,
      selected: false,
      statusLabel: "Reserved"
    }
  ],
  selectedProfileId: MANAGED_CHATGPT_PROFILE_ID,
  account: {
    loggedIn: false,
    email: null,
    planType: null,
    authMode: null,
    requiresOpenaiAuth: true,
    login: { status: "idle", message: null }
  },
  preferences: {
    model: null,
    reasoningEffort: DEFAULT_REASONING
  },
  models: [],
  rateLimitsByLimitId: {},
  usage: {
    today: createEmptyUsageRollup(),
    lifetime: createEmptyUsageRollup(),
    recentTurns: []
  },
  tasks: [],
  updatedAt: Date.now()
});

const buildUsageKey = (threadId: string, turnId: string): string => `${threadId}:${turnId}`;

const normalizeBreakdown = (value: Partial<IslandflowAiTokenBreakdown> | null | undefined): IslandflowAiTokenBreakdown => ({
  totalTokens: value?.totalTokens ?? 0,
  inputTokens: value?.inputTokens ?? 0,
  cachedInputTokens: value?.cachedInputTokens ?? 0,
  outputTokens: value?.outputTokens ?? 0,
  reasoningOutputTokens: value?.reasoningOutputTokens ?? 0
});

const addBreakdowns = (
  left: IslandflowAiTokenBreakdown,
  right: IslandflowAiTokenBreakdown
): IslandflowAiTokenBreakdown => ({
  totalTokens: left.totalTokens + right.totalTokens,
  inputTokens: left.inputTokens + right.inputTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens
});

const isoDayKey = (timestampMs: number): string => new Date(timestampMs).toISOString().slice(0, 10);

const sanitizeJsonText = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return trimmed;
};

const estimateNormalizedCost = (
  model: string | null,
  breakdown: IslandflowAiTokenBreakdown
): number | null => {
  if (!model) {
    return null;
  }
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return null;
  }
  const outputBillableTokens = breakdown.outputTokens + breakdown.reasoningOutputTokens;
  const usd =
    (breakdown.inputTokens / 1_000_000) * pricing.inputUsdPer1MTokens +
    (breakdown.cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPer1MTokens +
    (outputBillableTokens / 1_000_000) * pricing.outputUsdPer1MTokens;
  return Number(usd.toFixed(6));
};

const compactTaskList = (tasks: IslandflowAiTaskSnapshot[]): IslandflowAiTaskSnapshot[] =>
  [...tasks].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 24);

export const summarizeRateLimit = (snapshot: any): IslandflowAiRateLimitSnapshot => ({
  limitId: typeof snapshot?.limitId === "string" ? snapshot.limitId : null,
  limitName: typeof snapshot?.limitName === "string" ? snapshot.limitName : null,
  primary: snapshot?.primary
    ? {
        usedPercent: Number(snapshot.primary.usedPercent ?? 0),
        windowDurationMins:
          snapshot.primary.windowDurationMins === null || snapshot.primary.windowDurationMins === undefined
            ? null
            : Number(snapshot.primary.windowDurationMins),
        resetsAt:
          snapshot.primary.resetsAt === null || snapshot.primary.resetsAt === undefined
            ? null
            : Number(snapshot.primary.resetsAt)
      }
    : null,
  secondary: snapshot?.secondary
    ? {
        usedPercent: Number(snapshot.secondary.usedPercent ?? 0),
        windowDurationMins:
          snapshot.secondary.windowDurationMins === null || snapshot.secondary.windowDurationMins === undefined
            ? null
            : Number(snapshot.secondary.windowDurationMins),
        resetsAt:
          snapshot.secondary.resetsAt === null || snapshot.secondary.resetsAt === undefined
            ? null
            : Number(snapshot.secondary.resetsAt)
      }
    : null,
  planType: snapshot?.planType ?? null,
  reachedType: snapshot?.rateLimitReachedType ?? null,
  hasCredits:
    snapshot?.credits?.hasCredits === undefined || snapshot?.credits?.hasCredits === null
      ? null
      : Boolean(snapshot.credits.hasCredits),
  unlimitedCredits:
    snapshot?.credits?.unlimited === undefined || snapshot?.credits?.unlimited === null
      ? null
      : Boolean(snapshot.credits.unlimited),
  creditsBalance: typeof snapshot?.credits?.balance === "string" ? snapshot.credits.balance : null
});

export const createAppServerChildEnv = (
  profileMode: IslandflowAiProfileMode,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv => {
  const childEnv = { ...baseEnv };
  if (profileMode !== "api-key") {
    delete childEnv.OPENAI_API_KEY;
    delete childEnv.CODEX_API_KEY;
  }
  return childEnv;
};

const createTaskSnapshot = (request: IslandflowAiTaskRequest): Pick<IslandflowAiTaskSnapshot, "kind" | "title" | "subtitle"> => {
  switch (request.kind) {
    case "smart-money-explain":
      return {
        kind: request.kind,
        title: "Explain smart money event",
        subtitle: `${request.context.event.underlying_id} · ${request.context.event.primary_direction}`
      };
    case "smart-money-skeptic":
      return {
        kind: request.kind,
        title: "Counter-thesis pass",
        subtitle: `${request.context.event.underlying_id} · skepticism`
      };
    case "smart-money-burst-summary":
      return {
        kind: request.kind,
        title: "Burst summary",
        subtitle: `${request.context.event.underlying_id} · related packets`
      };
    case "watchlist-synthesis":
      return {
        kind: request.kind,
        title: "Watchlist synthesis",
        subtitle: `${request.context.event.underlying_id} · setups`
      };
    case "replay-postmortem":
      return {
        kind: request.kind,
        title: "Replay postmortem",
        subtitle: `${request.context.ticker ?? "All symbols"} · replay session`
      };
    case "screen-compile":
      return {
        kind: request.kind,
        title: "Natural-language screen",
        subtitle: request.context.prompt
      };
  }

  throw new Error("Unsupported Copilot task kind.");
};

const SMART_MONEY_RUBRIC = [
  "Treat the deterministic classifier and event payload as the source of truth.",
  "Act as an evidence interpreter, not the live classifier.",
  "Use only the provided structured payloads, do not call tools or inspect the filesystem.",
  "Lead with the clearest thesis, but include uncertainty, missing evidence, and alternate explanations.",
  "Prefer practical market structure language: aggressor side, concentration, event timing, IV shock, NBBO quality, and packet construction.",
  "Do not pretend to know price action or fundamentals beyond the supplied data.",
  "When the data suggests retail frenzy, dealer hedging, volatility selling, or arbitrage, say so plainly.",
  "Keep the answer terse, structured, and useful under pressure."
].join("\n");

const BASE_INSTRUCTIONS = [
  "You are Islandflow Analyst Copilot.",
  "Work only from the structured Islandflow context provided in the user message.",
  "Never call tools, never browse, and never inspect files.",
  "If evidence is missing or ambiguous, say that directly."
].join("\n");

const buildUserPrompt = (request: IslandflowAiTaskRequest): string => {
  switch (request.kind) {
    case "smart-money-explain":
      return [
        "Explain this selected smart-money event for a trader who wants the key evidence fast.",
        "Output sections named Thesis, Evidence, Caveats, and What To Watch.",
        JSON.stringify(request.context, null, 2)
      ].join("\n\n");
    case "smart-money-skeptic":
      return [
        "Run a skepticism pass on this selected smart-money event.",
        "Output sections named Why It Might Be Wrong, Alternate Microstructure Explanations, Missing Evidence, and Confidence Check.",
        JSON.stringify(request.context, null, 2)
      ].join("\n\n");
    case "smart-money-burst-summary":
      return [
        "Summarize the burst across the related packets for this selected smart-money event.",
        "Output sections named Burst Read, Packet Relationships, Quality Flags, and Trading Relevance.",
        JSON.stringify(request.context, null, 2)
      ].join("\n\n");
    case "watchlist-synthesis":
      return [
        "Turn this event into a practical watchlist and setup brief.",
        "Output sections named Watchlist, Trigger Levels Or Conditions, Invalidations, and Session Notes.",
        JSON.stringify(request.context, null, 2)
      ].join("\n\n");
    case "replay-postmortem":
      return [
        "Write a replay postmortem from this structured replay slice.",
        "Output sections named Session Read, Best Evidence, What Was Noise, and Follow-up Questions.",
        JSON.stringify(request.context, null, 2)
      ].join("\n\n");
    case "screen-compile":
      return [
        "Compile this natural-language screen into the existing Islandflow filter model where possible.",
        "Return only valid JSON that matches the requested schema.",
        JSON.stringify(request.context, null, 2)
      ].join("\n\n");
  }

  throw new Error("Unsupported Copilot task kind.");
};

const buildScreenOutputSchema = () => ({
  type: "object",
  additionalProperties: false,
  required: ["compiledFilters", "rationale", "unhandledClauses", "sanitizedPrompt"],
  properties: {
    compiledFilters: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            view: { type: "string", enum: ["signal", "raw"] },
            securityTypes: {
              type: "array",
              items: { type: "string", enum: ["stock", "etf"] }
            },
            nbboSides: {
              type: "array",
              items: { type: "string", enum: ["AA", "A", "MID", "B", "BB", "MISSING", "STALE"] }
            },
            optionTypes: {
              type: "array",
              items: { type: "string", enum: ["call", "put"] }
            },
            minNotional: { type: "number", minimum: 0 }
          }
        },
        { type: "null" }
      ]
    },
    rationale: { type: "string" },
    unhandledClauses: {
      type: "array",
      items: { type: "string" }
    },
    sanitizedPrompt: { type: "string" }
  }
});

const createUsageStore = (): PersistedUsageStore => ({
  version: 1,
  turns: {}
});

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  private buffer = "";
  private nextId = 1;

  constructor(
    private readonly sandboxCwd: string,
    private readonly onNotification: (method: string, params: unknown) => Promise<void> | void,
    private readonly onExit: (reason: string) => Promise<void> | void
  ) {}

  async start(profileMode: IslandflowAiProfileMode): Promise<void> {
    if (this.child) {
      return;
    }

    await mkdir(this.sandboxCwd, { recursive: true });

    this.child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: createAppServerChildEnv(profileMode)
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      void this.flushBuffer();
    });

    this.child.stderr.on("data", (chunk: string) => {
      console.warn(`[desktop-ai] ${chunk.trim()}`);
    });

    this.child.once("exit", (code, signal) => {
      this.child = null;
      this.buffer = "";
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Codex app-server exited before replying to request ${id}.`));
      }
      this.pending.clear();
      void this.onExit(`app-server exited${code !== null ? ` (${code})` : ""}${signal ? ` via ${signal}` : ""}`);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "islandflow-desktop",
        title: "Islandflow Desktop",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [
          "app/list/updated",
          "remoteControl/status/changed",
          "skills/changed",
          "plugin/installed"
        ]
      }
    });

    this.notify("initialized");
  }

  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }
    this.child.kill("SIGTERM");
    this.child = null;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.child) {
      throw new Error("Codex app-server is not running.");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, 30_000);

      this.pending.set(id, { resolve, reject, timeout });
      this.child?.stdin.write(payload);
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child) {
      return;
    }
    this.child.stdin.write(JSON.stringify(params === undefined ? { method } : { method, params }) + "\n");
  }

  private async flushBuffer(): Promise<void> {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      const message = JSON.parse(line) as JsonRpcMessage;
      if ("id" in message && "result" in message) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          pending.resolve(message.result);
        }
        continue;
      }

      if ("id" in message && "error" in message) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          pending.reject(new Error(message.error.message ?? `Request ${message.id} failed.`));
        }
        continue;
      }

      if (typeof (message as Partial<JsonRpcServerRequest>).id === "number" && "method" in message) {
        this.respondUnsupported(message as JsonRpcServerRequest);
        continue;
      }

      if ("method" in message) {
        await this.onNotification(message.method, message.params);
      }
    }
  }

  private respondUnsupported(message: JsonRpcServerRequest): void {
    if (!this.child) {
      return;
    }
    this.child.stdin.write(
      JSON.stringify({
        id: message.id,
        error: {
          message: `Islandflow desktop does not support server request ${message.method}.`
        }
      }) + "\n"
    );
  }
}

export class IslandflowDesktopAiService {
  private readonly preferencesPath: string;
  private readonly usagePath: string;
  private readonly sandboxCwd: string;
  private readonly client: CodexAppServerClient;
  private readonly activeTasksByThreadId = new Map<string, ActiveTaskContext>();
  private usageStore: PersistedUsageStore = createUsageStore();
  private state: IslandflowAiState = createInitialState();
  private serviceTier: string | null = null;
  private started = false;

  constructor(
    userDataPath: string,
    private readonly openExternalUrl: OpenExternalFn,
    private readonly publishState: (state: IslandflowAiState) => void
  ) {
    this.preferencesPath = path.join(userDataPath, PREFERENCES_FILE);
    this.usagePath = path.join(userDataPath, USAGE_FILE);
    this.sandboxCwd = path.join(userDataPath, APP_SERVER_SANDBOX_CWD);
    this.client = new CodexAppServerClient(
      this.sandboxCwd,
      async (method, params) => {
        await this.handleNotification(method, params);
      },
      async (reason) => {
        this.state.transportStatus = "restarting";
        this.state.transportError = reason;
        this.failActiveTasks(reason);
        this.emitState();
      }
    );
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await mkdir(path.dirname(this.preferencesPath), { recursive: true });
    await mkdir(this.sandboxCwd, { recursive: true });
    await this.loadPreferences();
    await this.loadUsageStore();
    await this.ensureClientReady();
  }

  getState(): IslandflowAiState {
    return this.state;
  }

  async loginWithBrowser(): Promise<void> {
    await this.start();
    await this.ensureClientReady();

    const result = await this.client.request<any>("account/login/start", {
      type: "chatgpt",
      codexStreamlinedLogin: true
    });

    this.state.account.login = {
      status: "browser_pending",
      message: "Waiting for browser sign-in to complete.",
      loginId: String(result.loginId),
      authUrl: String(result.authUrl)
    };
    this.emitState();
    await this.openExternalUrl(String(result.authUrl));
  }

  async loginWithDeviceCode(): Promise<void> {
    await this.start();
    await this.ensureClientReady();

    const result = await this.client.request<any>("account/login/start", {
      type: "chatgptDeviceCode"
    });

    this.state.account.login = {
      status: "device_code_pending",
      message: "Enter the device code in your browser to finish sign-in.",
      loginId: String(result.loginId),
      verificationUrl: String(result.verificationUrl),
      userCode: String(result.userCode)
    };
    this.emitState();
    await this.openExternalUrl(String(result.verificationUrl));
  }

  async cancelLogin(): Promise<void> {
    const login = this.state.account.login;
    if (login.status !== "browser_pending" && login.status !== "device_code_pending") {
      return;
    }
    await this.client.request("account/login/cancel", { loginId: login.loginId });
    this.state.account.login = { status: "idle", message: "Login cancelled." };
    this.emitState();
  }

  async logout(): Promise<void> {
    await this.client.request("account/logout", {});
    this.state.account.loggedIn = false;
    this.state.account.email = null;
    this.state.account.planType = null;
    this.state.account.login = { status: "idle", message: "Logged out." };
    this.emitState();
  }

  async updatePreferences(
    next: Partial<{ model: string | null; reasoningEffort: IslandflowAiReasoningEffort | null }>
  ): Promise<void> {
    this.state.preferences = {
      model: next.model === undefined ? this.state.preferences.model : next.model,
      reasoningEffort:
        next.reasoningEffort === undefined
          ? this.state.preferences.reasoningEffort
          : next.reasoningEffort
    };
    await this.savePreferences();
    this.emitState();
  }

  async runTask(rawRequest: unknown): Promise<{ taskId: string }> {
    await this.start();

    if (!this.state.account.loggedIn) {
      throw new Error("Log into a ChatGPT or Codex account first.");
    }

    const request = IslandflowAiTaskRequestSchema.parse(rawRequest);
    const meta = createTaskSnapshot(request);
    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const task: IslandflowAiTaskSnapshot = {
      taskId,
      kind: meta.kind,
      title: meta.title,
      subtitle: meta.subtitle,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      threadId: null,
      turnId: null,
      model: this.state.preferences.model,
      reasoningEffort: this.state.preferences.reasoningEffort,
      text: "",
      error: null,
      compiledScreen: null
    };

    this.state.tasks = compactTaskList([task, ...this.state.tasks]);
    this.emitState();

    try {
      await this.ensureClientReady();

      const thread = await this.client.request<CodexThreadStartResult>("thread/start", {
        model: this.state.preferences.model ?? undefined,
        cwd: this.sandboxCwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        serviceName: APP_SERVER_SERVICE_NAME,
        baseInstructions: BASE_INSTRUCTIONS,
        developerInstructions: SMART_MONEY_RUBRIC,
        ephemeral: true,
        serviceTier: this.serviceTier ?? undefined
      });

      this.activeTasksByThreadId.set(thread.thread.id, {
        taskId,
        taskKind: task.kind,
        taskTitle: task.title,
        profileId: this.state.selectedProfileId
      });
      this.patchTask(taskId, {
        status: "running",
        threadId: thread.thread.id,
        model: thread.model,
        reasoningEffort: thread.reasoningEffort ?? this.state.preferences.reasoningEffort
      });

      const turn = await this.client.request<CodexTurnStartResult>("turn/start", {
        threadId: thread.thread.id,
        input: [
          {
            type: "text",
            text: buildUserPrompt(request),
            text_elements: []
          }
        ],
        model: this.state.preferences.model ?? undefined,
        effort: this.state.preferences.reasoningEffort ?? undefined,
        serviceTier: this.serviceTier ?? undefined,
        outputSchema: request.kind === "screen-compile" ? buildScreenOutputSchema() : undefined
      });

      this.patchTask(taskId, {
        turnId: turn.turn.id
      });

      return { taskId };
    } catch (error) {
      this.patchTask(taskId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async ensureClientReady(): Promise<void> {
    const selectedProfile = this.resolveSelectedProfileMode();
    this.state.transportStatus = this.state.transportStatus === "restarting" ? "restarting" : "starting";
    this.emitState();

    try {
      await this.client.start(selectedProfile);
      await this.refreshServerState();
      this.state.transportStatus = "ready";
      this.state.transportError = null;
      this.emitState();
    } catch (error) {
      this.state.transportStatus = "error";
      this.state.transportError = error instanceof Error ? error.message : String(error);
      this.emitState();
      throw error;
    }
  }

  private async refreshServerState(): Promise<void> {
    const [config, models, account, auth, rateLimits] = await Promise.all([
      this.client.request<any>("config/read", {}),
      this.client.request<any>("model/list", {}),
      this.client.request<any>("account/read", { refreshToken: false }),
      this.client.request<any>("getAuthStatus", {}),
      this.client.request<any>("account/rateLimits/read", {})
    ]);

    this.serviceTier = typeof config?.config?.service_tier === "string" ? config.config.service_tier : null;
    const configModel = typeof config?.config?.model === "string" ? config.config.model : null;
    const configReasoning =
      config?.config?.model_reasoning_effort === null || config?.config?.model_reasoning_effort === undefined
        ? null
        : IslandflowAiReasoningEffortSchema.parse(config.config.model_reasoning_effort);

    if (!this.state.preferences.model) {
      this.state.preferences.model = configModel;
    }
    if (!this.state.preferences.reasoningEffort) {
      this.state.preferences.reasoningEffort = configReasoning ?? DEFAULT_REASONING;
    }

    this.state.models = (Array.isArray(models?.data) ? models.data : [])
      .filter((model: CodexModelRecord) => !model.hidden)
      .map((model: CodexModelRecord): IslandflowAiModelSummary => ({
        id: model.id,
        model: model.model,
        displayName: model.displayName,
        description: model.description,
        isDefault: Boolean(model.isDefault),
        supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort),
        defaultReasoningEffort: model.defaultReasoningEffort,
        pricing: MODEL_PRICING[model.model] ?? null
      }));

    this.state.account.loggedIn = Boolean(account?.account);
    this.state.account.email =
      account?.account?.type === "chatgpt" && typeof account.account.email === "string"
        ? account.account.email
        : null;
    this.state.account.planType =
      account?.account?.type === "chatgpt" ? (account.account.planType as IslandflowAiPlanType) : null;
    this.state.account.authMode = auth?.authMethod ?? null;
    this.state.account.requiresOpenaiAuth = Boolean(account?.requiresOpenaiAuth ?? auth?.requiresOpenaiAuth ?? true);
    if (this.state.account.login.status === "idle") {
      this.state.account.login = {
        status: "idle",
        message: this.state.account.loggedIn ? "Connected." : null
      };
    }

    this.state.rateLimitsByLimitId = this.normalizeRateLimitBuckets(rateLimits);
    this.rebuildUsageDashboard();
  }

  private normalizeRateLimitBuckets(payload: any): Record<string, IslandflowAiRateLimitSnapshot> {
    const bucketEntries = Object.entries(payload?.rateLimitsByLimitId ?? {});
    if (bucketEntries.length === 0 && payload?.rateLimits) {
      const single = summarizeRateLimit(payload.rateLimits);
      return {
        [single.limitId ?? "default"]: single
      };
    }

    return Object.fromEntries(
      bucketEntries.map(([key, value]) => [key, summarizeRateLimit(value)])
    );
  }

  private async handleNotification(method: string, params: unknown): Promise<void> {
    switch (method) {
      case "account/updated": {
        const payload = params as { authMode: string | null; planType: IslandflowAiPlanType | null };
        this.state.account.authMode = payload.authMode as any;
        this.state.account.planType = payload.planType;
        this.emitState();
        return;
      }
      case "account/login/completed": {
        const payload = params as { success: boolean; error: string | null };
        if (payload.success) {
          this.state.account.login = { status: "idle", message: "Connected." };
          await this.refreshServerState();
        } else {
          this.state.account.login = {
            status: "error",
            message: payload.error ?? "Login failed.",
            loginId: null
          };
        }
        this.emitState();
        return;
      }
      case "account/rateLimits/updated": {
        const payload = summarizeRateLimit((params as { rateLimits: unknown }).rateLimits);
        this.state.rateLimitsByLimitId = {
          ...this.state.rateLimitsByLimitId,
          [payload.limitId ?? "default"]: payload
        };
        this.emitState();
        return;
      }
      case "item/agentMessage/delta": {
        const payload = params as { threadId: string; delta: string };
        const activeTask = this.activeTasksByThreadId.get(payload.threadId);
        if (!activeTask) {
          return;
        }
        const current = this.state.tasks.find((task) => task.taskId === activeTask.taskId);
        if (!current) {
          return;
        }
        this.patchTask(activeTask.taskId, {
          text: current.text + payload.delta
        });
        return;
      }
      case "item/completed": {
        const payload = params as {
          threadId: string;
          item: { type: string; text?: string };
        };
        if (payload.item.type !== "agentMessage") {
          return;
        }
        const activeTask = this.activeTasksByThreadId.get(payload.threadId);
        if (!activeTask) {
          return;
        }
        if (typeof payload.item.text === "string") {
          this.patchTask(activeTask.taskId, {
            text: payload.item.text
          });
        }
        return;
      }
      case "thread/tokenUsage/updated": {
        const payload = params as {
          threadId: string;
          turnId: string;
          tokenUsage: {
            total: IslandflowAiTokenBreakdown;
            last: IslandflowAiTokenBreakdown;
          };
        };
        this.recordUsage(payload.threadId, payload.turnId, payload.tokenUsage.last);
        return;
      }
      case "turn/completed": {
        const payload = params as {
          threadId: string;
          turn: {
            id: string;
            status: string;
            error: { message: string } | null;
          };
        };
        const activeTask = this.activeTasksByThreadId.get(payload.threadId);
        if (!activeTask) {
          return;
        }
        const current = this.state.tasks.find((task) => task.taskId === activeTask.taskId);
        if (!current) {
          return;
        }

        if (payload.turn.status === "failed") {
          this.patchTask(activeTask.taskId, {
            status: "failed",
            error: payload.turn.error?.message ?? "The Copilot turn failed."
          });
        } else {
          let compiledScreen: IslandflowAiCompiledScreen | null = null;
          let nextText = current.text;
          if (current.kind === "screen-compile") {
            compiledScreen = this.tryParseCompiledScreen(current.text);
            if (compiledScreen) {
              nextText = compiledScreen.rationale;
            }
          }

          this.patchTask(activeTask.taskId, {
            status: "completed",
            compiledScreen,
            text: nextText,
            error: null
          });
        }

        this.activeTasksByThreadId.delete(payload.threadId);
        return;
      }
      default:
        return;
    }
  }

  private tryParseCompiledScreen(text: string): IslandflowAiCompiledScreen | null {
    try {
      return IslandflowAiCompiledScreenSchema.parse(JSON.parse(sanitizeJsonText(text)));
    } catch {
      return null;
    }
  }

  private recordUsage(threadId: string, turnId: string, rawBreakdown: IslandflowAiTokenBreakdown): void {
    const activeTask = this.activeTasksByThreadId.get(threadId);
    const currentTask = activeTask
      ? this.state.tasks.find((task) => task.taskId === activeTask.taskId)
      : null;
    const breakdown = normalizeBreakdown(rawBreakdown);
    const record: IslandflowAiUsageTurnRecord = {
      threadId,
      turnId,
      taskId: currentTask?.taskId ?? null,
      taskKind: currentTask?.kind ?? null,
      taskTitle: currentTask?.title ?? null,
      dayKey: isoDayKey(Date.now()),
      profileId: activeTask?.profileId ?? this.state.selectedProfileId,
      accountEmail: this.state.account.email,
      planType: this.state.account.planType,
      model: currentTask?.model ?? this.state.preferences.model,
      breakdown,
      normalizedCostUsd: estimateNormalizedCost(currentTask?.model ?? this.state.preferences.model, breakdown),
      updatedAt: Date.now()
    };

    this.usageStore.turns[buildUsageKey(threadId, turnId)] = record;
    void this.saveUsageStore();
    this.rebuildUsageDashboard();
    this.emitState();
  }

  private rebuildUsageDashboard(): void {
    const records = Object.values(this.usageStore.turns).filter((record) => {
      if (record.profileId !== this.state.selectedProfileId) {
        return false;
      }
      if (this.state.account.email) {
        return record.accountEmail === this.state.account.email;
      }
      return true;
    });

    const todayKey = isoDayKey(Date.now());
    this.state.usage = {
      today: this.rollupUsage(records.filter((record) => record.dayKey === todayKey)),
      lifetime: this.rollupUsage(records),
      recentTurns: [...records].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 12)
    };
  }

  private rollupUsage(records: IslandflowAiUsageTurnRecord[]): IslandflowAiUsageRollup {
    const breakdown = records.reduce(
      (accumulator, record) => addBreakdowns(accumulator, record.breakdown),
      { ...EMPTY_BREAKDOWN }
    );
    const normalizedCostUsd = records.reduce((accumulator, record) => accumulator + (record.normalizedCostUsd ?? 0), 0);
    return {
      breakdown,
      normalizedCostUsd: Number(normalizedCostUsd.toFixed(6)),
      turnCount: records.length,
      activeDays: new Set(records.map((record) => record.dayKey)).size
    };
  }

  private failActiveTasks(reason: string): void {
    for (const activeTask of this.activeTasksByThreadId.values()) {
      this.patchTask(activeTask.taskId, {
        status: "failed",
        error: reason
      });
    }
    this.activeTasksByThreadId.clear();
  }

  private patchTask(taskId: string, updates: Partial<IslandflowAiTaskSnapshot>): void {
    this.state.tasks = compactTaskList(
      this.state.tasks.map((task) =>
        task.taskId === taskId
          ? {
              ...task,
              ...updates,
              updatedAt: Date.now()
            }
          : task
      )
    );
    this.emitState();
  }

  private emitState(): void {
    this.state.updatedAt = Date.now();
    this.publishState({
      ...this.state,
      profiles: this.state.profiles.map((profile) => ({
        ...profile,
        selected: profile.id === this.state.selectedProfileId
      })),
      tasks: compactTaskList(this.state.tasks)
    });
  }

  private resolveSelectedProfileMode(): IslandflowAiProfileMode {
    const selected = this.state.profiles.find((profile) => profile.id === this.state.selectedProfileId);
    return IslandflowAiProfileModeSchema.parse(selected?.mode ?? "managed-chatgpt");
  }

  private async loadPreferences(): Promise<void> {
    try {
      const raw = await readFile(this.preferencesPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedPreferences;
      this.state.preferences = {
        model: typeof parsed.model === "string" ? parsed.model : null,
        reasoningEffort:
          parsed.reasoningEffort === null || parsed.reasoningEffort === undefined
            ? DEFAULT_REASONING
            : IslandflowAiReasoningEffortSchema.parse(parsed.reasoningEffort)
      };
    } catch {
      // Use defaults on first run or after malformed local state.
    }
  }

  private async savePreferences(): Promise<void> {
    const payload: PersistedPreferences = {
      model: this.state.preferences.model,
      reasoningEffort: this.state.preferences.reasoningEffort
    };
    await writeFile(this.preferencesPath, JSON.stringify(payload, null, 2), "utf8");
  }

  private async loadUsageStore(): Promise<void> {
    try {
      const raw = await readFile(this.usagePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedUsageStore;
      if (parsed.version === 1 && parsed.turns) {
        this.usageStore = parsed;
      }
    } catch {
      this.usageStore = createUsageStore();
    }
    this.rebuildUsageDashboard();
  }

  private async saveUsageStore(): Promise<void> {
    await writeFile(this.usagePath, JSON.stringify(this.usageStore, null, 2), "utf8");
  }
}
