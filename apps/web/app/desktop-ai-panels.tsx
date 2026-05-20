"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type {
  AlertEvent,
  ClassifierHitEvent,
  FlowPacket,
  IslandflowAiCompiledScreen,
  IslandflowAiPlanType,
  IslandflowAiRateLimitSnapshot,
  IslandflowAiReasoningEffort,
  IslandflowAiTaskKind,
  OptionFlowFilters,
  OptionPrint,
  SmartMoneyEvent
} from "@islandflow/types";
import { useDesktopAi } from "./desktop-ai";

const numberFormatter = new Intl.NumberFormat("en-US");
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

const humanizeValue = (value: string | null | undefined): string => {
  if (!value) {
    return "Unknown";
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatTokens = (value: number): string => numberFormatter.format(value);

const formatUsd = (value: number | null): string => (value === null ? "Unavailable" : usdFormatter.format(value));

const formatTimestamp = (value: number | null): string => {
  if (!value) {
    return "Not reported";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
};

const formatPercent = (value: number): string => `${Math.round(value)}%`;

const getTaskStatusLabel = (value: string): string => humanizeValue(value);

const findTask = <T extends { taskId: string }>(tasks: T[], taskId: string | null): T | null => {
  if (!taskId) {
    return null;
  }
  return tasks.find((task) => task.taskId === taskId) ?? null;
};

const getCompiledScreenSummary = (compiled: IslandflowAiCompiledScreen): string[] => {
  const filters = compiled.compiledFilters;
  if (!filters) {
    return [];
  }

  const parts: string[] = [];
  if (filters.view) {
    parts.push(`View: ${filters.view}`);
  }
  if (filters.securityTypes?.length) {
    parts.push(`Security: ${filters.securityTypes.join(", ")}`);
  }
  if (filters.optionTypes?.length) {
    parts.push(`Options: ${filters.optionTypes.join(", ")}`);
  }
  if (filters.nbboSides?.length) {
    parts.push(`NBBO: ${filters.nbboSides.join(", ")}`);
  }
  if (typeof filters.minNotional === "number") {
    parts.push(`Min notional: $${numberFormatter.format(filters.minNotional)}`);
  }

  return parts;
};

const CopilotPane = ({
  title,
  eyebrow,
  actions,
  wide = false,
  children
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) => {
  return (
    <section className={`terminal-pane copilot-pane${wide ? " copilot-pane-wide" : ""}`}>
      <div className="terminal-pane-head">
        <div className="terminal-pane-title-row">
          <div>
            {eyebrow ? <div className="copilot-kicker">{eyebrow}</div> : null}
            <h2 className="terminal-pane-title">{title}</h2>
          </div>
        </div>
        {actions ? <div className="terminal-pane-actions">{actions}</div> : null}
      </div>
      <div className="terminal-pane-body copilot-pane-body">{children}</div>
    </section>
  );
};

const UsageBreakdown = ({
  title,
  breakdown,
  normalizedCostUsd,
  turnCount,
  activeDays
}: {
  title: string;
  breakdown: {
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
  normalizedCostUsd: number | null;
  turnCount: number;
  activeDays: number;
}) => {
  return (
    <div className="copilot-usage-block">
      <div className="copilot-usage-title-row">
        <h3>{title}</h3>
        <span className="copilot-usage-cost">{formatUsd(normalizedCostUsd)}</span>
      </div>
      <div className="copilot-token-grid">
        <div className="copilot-token-row">
          <span>Total tokens</span>
          <strong>{formatTokens(breakdown.totalTokens)}</strong>
        </div>
        <div className="copilot-token-row">
          <span>Input</span>
          <strong>{formatTokens(breakdown.inputTokens)}</strong>
        </div>
        <div className="copilot-token-row">
          <span>Cached input</span>
          <strong>{formatTokens(breakdown.cachedInputTokens)}</strong>
        </div>
        <div className="copilot-token-row">
          <span>Output</span>
          <strong>{formatTokens(breakdown.outputTokens)}</strong>
        </div>
        <div className="copilot-token-row">
          <span>Reasoning</span>
          <strong>{formatTokens(breakdown.reasoningOutputTokens)}</strong>
        </div>
        <div className="copilot-token-row">
          <span>Turns</span>
          <strong>{formatTokens(turnCount)}</strong>
        </div>
        <div className="copilot-token-row">
          <span>Active days</span>
          <strong>{formatTokens(activeDays)}</strong>
        </div>
      </div>
    </div>
  );
};

const RateLimitBoard = ({ limit }: { limit: IslandflowAiRateLimitSnapshot }) => {
  return (
    <div className="copilot-limit-card" key={limit.limitId ?? limit.limitName ?? "default"}>
      <div className="copilot-limit-head">
        <div>
          <strong>{limit.limitName ?? "Default rate window"}</strong>
          <p className="copilot-note">
            {limit.planType ? `Plan ${humanizeValue(limit.planType)}` : "Plan not reported"}
          </p>
        </div>
        {limit.reachedType ? <span className="copilot-badge warning">{humanizeValue(limit.reachedType)}</span> : null}
      </div>
      <div className="copilot-limit-grid">
        {limit.primary ? (
          <div className="copilot-limit-window">
            <span>Primary</span>
            <strong>{formatPercent(limit.primary.usedPercent)}</strong>
            <p className="copilot-note">Resets {formatTimestamp(limit.primary.resetsAt)}</p>
          </div>
        ) : null}
        {limit.secondary ? (
          <div className="copilot-limit-window">
            <span>Secondary</span>
            <strong>{formatPercent(limit.secondary.usedPercent)}</strong>
            <p className="copilot-note">Resets {formatTimestamp(limit.secondary.resetsAt)}</p>
          </div>
        ) : null}
      </div>
      {limit.creditsBalance || limit.unlimitedCredits !== null ? (
        <p className="copilot-note">
          Credits:{" "}
          {limit.unlimitedCredits
            ? "unlimited"
            : limit.creditsBalance
            ? limit.creditsBalance
            : limit.hasCredits === false
            ? "none"
            : "not reported"}
        </p>
      ) : null}
    </div>
  );
};

const TaskOutput = ({
  taskId,
  emptyMessage
}: {
  taskId: string | null;
  emptyMessage: string;
}) => {
  const { state } = useDesktopAi();
  const task = findTask(state.tasks, taskId);

  if (!task) {
    return <p className="copilot-empty">{emptyMessage}</p>;
  }

  return (
    <div className="copilot-task-output" aria-live="polite">
      <div className="copilot-task-head">
        <div>
          <strong>{task.title}</strong>
          <p className="copilot-note">
            {task.subtitle} · {getTaskStatusLabel(task.status)}
          </p>
        </div>
        <span className={`copilot-badge status-${task.status}`}>{getTaskStatusLabel(task.status)}</span>
      </div>
      {task.error ? <p className="copilot-error">{task.error}</p> : null}
      {task.text ? <pre className="copilot-task-text">{task.text}</pre> : null}
      {task.compiledScreen ? <CompiledScreenResult compiled={task.compiledScreen} /> : null}
    </div>
  );
};

const CompiledScreenResult = ({ compiled }: { compiled: IslandflowAiCompiledScreen }) => {
  const summary = getCompiledScreenSummary(compiled);

  return (
    <div className="copilot-compiled-screen">
      {summary.length > 0 ? (
        <div className="copilot-chip-row">
          {summary.map((item) => (
            <span className="copilot-chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="copilot-note">No filter fields were compiled from this prompt.</p>
      )}
      {compiled.unhandledClauses.length > 0 ? (
        <div className="copilot-unhandled-list">
          <div className="copilot-list-title">Unhandled clauses</div>
          {compiled.unhandledClauses.map((item) => (
            <div className="copilot-inline-row" key={item}>
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const AccountSummary = ({
  loggedIn,
  email,
  planType
}: {
  loggedIn: boolean;
  email: string | null;
  planType: IslandflowAiPlanType | null;
}) => {
  return (
    <div className="copilot-hero">
      <div>
        <p className="copilot-kicker">Desktop-only official Codex bridge</p>
        <h1 className="page-title">Analyst Copilot</h1>
        <p className="copilot-hero-copy">
          Managed ChatGPT login stays user-scoped, deterministic smart-money classification stays in charge, and every
          AI turn is tracked with exact token telemetry from the app-server.
        </p>
      </div>
      <div className="copilot-hero-meta">
        <div className="copilot-stat">
          <span>Account</span>
          <strong>{loggedIn ? email ?? "Connected" : "Disconnected"}</strong>
        </div>
        <div className="copilot-stat">
          <span>Plan</span>
          <strong>{loggedIn ? humanizeValue(planType) : "Not connected"}</strong>
        </div>
      </div>
    </div>
  );
};

const LoginStatePanel = () => {
  const { bridgeAvailable, state, loginWithBrowser, loginWithDeviceCode, cancelLogin, logout } = useDesktopAi();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const loginState = state.account.login;
  const actionsDisabled = busyAction !== null || !bridgeAvailable;

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <CopilotPane
      title="Account and access"
      eyebrow="Managed auth"
      wide
      actions={
        <>
          {state.account.loggedIn ? (
              <button
                className="terminal-button"
                type="button"
                onClick={() => void runAction("logout", logout)}
                disabled={actionsDisabled}
              >
                {busyAction === "logout" ? "Logging out" : "Logout"}
              </button>
          ) : (
            <>
              <button
                className="terminal-button terminal-button-primary"
                type="button"
                onClick={() => void runAction("browser", loginWithBrowser)}
                disabled={actionsDisabled}
              >
                {busyAction === "browser" ? "Opening browser" : "Browser login"}
              </button>
              <button
                className="terminal-button"
                type="button"
                onClick={() => void runAction("device", loginWithDeviceCode)}
                disabled={actionsDisabled}
              >
                {busyAction === "device" ? "Preparing code" : "Device code"}
              </button>
            </>
          )}
          {(loginState.status === "browser_pending" || loginState.status === "device_code_pending") && !state.account.loggedIn ? (
              <button
                className="terminal-button"
                type="button"
                onClick={() => void runAction("cancel", cancelLogin)}
                disabled={actionsDisabled}
              >
                Cancel
              </button>
          ) : null}
        </>
      }
    >
      <AccountSummary
        loggedIn={state.account.loggedIn}
        email={state.account.email}
        planType={state.account.planType}
      />
      <div className="copilot-account-grid">
        <div className="copilot-account-card">
          <div className="copilot-list-title">Profile slots</div>
          {state.profiles.map((profile) => (
            <div className="copilot-inline-row" key={profile.id}>
              <div>
                <strong>{profile.label}</strong>
                <p className="copilot-note">{profile.description}</p>
              </div>
              <span className={`copilot-badge${profile.enabled ? "" : " muted"}`}>
                {profile.selected ? "Selected" : profile.statusLabel}
              </span>
            </div>
          ))}
        </div>
        <div className="copilot-account-card">
          <div className="copilot-list-title">Session status</div>
          <div className="copilot-inline-row">
            <span>Transport</span>
            <strong>{humanizeValue(state.transportStatus)}</strong>
          </div>
          <div className="copilot-inline-row">
            <span>Auth mode</span>
            <strong>{humanizeValue(state.account.authMode)}</strong>
          </div>
          <div className="copilot-inline-row">
            <span>OpenAI auth required</span>
            <strong>{state.account.requiresOpenaiAuth ? "Yes" : "No"}</strong>
          </div>
          {state.transportError ? <p className="copilot-error">{state.transportError}</p> : null}
          {loginState.message ? <p className="copilot-note">{loginState.message}</p> : null}
          {loginState.status === "browser_pending" ? (
            <div className="copilot-callout">
              <strong>Browser login in progress</strong>
              <p className="copilot-note">Finish the ChatGPT sign-in flow in your browser. Islandflow will update automatically.</p>
            </div>
          ) : null}
          {loginState.status === "device_code_pending" ? (
            <div className="copilot-callout">
              <strong>Device code</strong>
              <pre className="copilot-device-code">{loginState.userCode}</pre>
              <p className="copilot-note">Visit {loginState.verificationUrl} in any browser and enter the code above.</p>
            </div>
          ) : null}
          {actionError ? <p className="copilot-error">{actionError}</p> : null}
        </div>
      </div>
    </CopilotPane>
  );
};

export function DesktopAiSettingsRoute() {
  const { bridgeAvailable, shellAvailable, state, updatePreferences } = useDesktopAi();
  const [busyPreference, setBusyPreference] = useState<"model" | "reasoning" | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const rateLimits = Object.values(state.rateLimitsByLimitId);
  const selectedModel = state.preferences.model ?? "";
  const selectedReasoning = state.preferences.reasoningEffort ?? "";

  const savePreference = async (
    key: "model" | "reasoning",
    next: Partial<{ model: string | null; reasoningEffort: IslandflowAiReasoningEffort | null }>
  ) => {
    setBusyPreference(key);
    setPreferenceError(null);
    try {
      await updatePreferences(next);
    } catch (error) {
      setPreferenceError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPreference(null);
    }
  };

  return (
    <div className="page-shell">
      {!shellAvailable ? (
        <CopilotPane title="Desktop required" eyebrow="Browser-only fallback" wide>
          <div className="copilot-unavailable">
            <p>
              AI controls are intentionally read-only in the browser build. Open Islandflow Desktop to use managed ChatGPT
              login, structured Copilot turns, and app-server token telemetry.
            </p>
          </div>
        </CopilotPane>
      ) : null}

      <LoginStatePanel />

      <div className="page-grid page-grid-settings">
        <CopilotPane title="Model controls" eyebrow="Execution">
          <div className="copilot-field-grid">
            <label className="copilot-field">
              <span className="copilot-field-label">Model</span>
              <select
                className="copilot-select"
                value={selectedModel}
                onChange={(event) =>
                  void savePreference("model", { model: event.target.value.trim() ? event.target.value : null })
                }
                disabled={busyPreference !== null || state.models.length === 0 || !bridgeAvailable}
              >
                <option value="">Use server default</option>
                {state.models.map((model) => (
                  <option key={model.id} value={model.model}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="copilot-field">
              <span className="copilot-field-label">Reasoning</span>
              <select
                className="copilot-select"
                value={selectedReasoning}
                onChange={(event) =>
                  void savePreference("reasoning", {
                    reasoningEffort: event.target.value.trim()
                      ? (event.target.value as IslandflowAiReasoningEffort)
                      : null
                  })
                }
                disabled={busyPreference !== null || !bridgeAvailable}
              >
                <option value="">Use model default</option>
                <option value="none">None</option>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">XHigh</option>
              </select>
            </label>
          </div>
          <div className="copilot-model-list">
            {state.models.map((model) => (
              <div className="copilot-model-row" key={model.id}>
                <div>
                  <strong>{model.displayName}</strong>
                  <p className="copilot-note">{model.description}</p>
                </div>
                <div className="copilot-model-meta">
                  <span>{model.model}</span>
                  {model.pricing ? <span>{formatUsd(model.pricing.inputUsdPer1MTokens)} / 1M input</span> : null}
                </div>
              </div>
            ))}
          </div>
          {state.models.find((model) => model.model === state.preferences.model)?.pricing ? (
            <p className="copilot-note">
              Normalized estimates use current API pricing for the selected model, not your literal ChatGPT subscription bill.
            </p>
          ) : null}
          {preferenceError ? <p className="copilot-error">{preferenceError}</p> : null}
        </CopilotPane>

        <CopilotPane title="Rate limits" eyebrow="Live windows">
          {rateLimits.length === 0 ? (
            <p className="copilot-empty">No rate-limit snapshots have been reported yet.</p>
          ) : (
            <div className="copilot-limit-list">
              {rateLimits.map((limit) => (
                <RateLimitBoard key={limit.limitId ?? limit.limitName ?? "default"} limit={limit} />
              ))}
            </div>
          )}
        </CopilotPane>

        <CopilotPane title="Usage dashboard" eyebrow="Exact app-server telemetry" wide>
          <div className="copilot-usage-grid">
            <UsageBreakdown
              title="Today"
              breakdown={state.usage.today.breakdown}
              normalizedCostUsd={state.usage.today.normalizedCostUsd}
              turnCount={state.usage.today.turnCount}
              activeDays={state.usage.today.activeDays}
            />
            <UsageBreakdown
              title="Lifetime"
              breakdown={state.usage.lifetime.breakdown}
              normalizedCostUsd={state.usage.lifetime.normalizedCostUsd}
              turnCount={state.usage.lifetime.turnCount}
              activeDays={state.usage.lifetime.activeDays}
            />
          </div>
        </CopilotPane>

        <CopilotPane title="Recent turns" eyebrow="Per-thread usage">
          {state.usage.recentTurns.length === 0 ? (
            <p className="copilot-empty">No tracked turns yet.</p>
          ) : (
            <div className="copilot-turn-list">
              {state.usage.recentTurns.map((turn) => (
                <div className="copilot-turn-row" key={`${turn.threadId}:${turn.turnId}`}>
                  <div>
                    <strong>{turn.taskTitle ?? "Ad hoc turn"}</strong>
                    <p className="copilot-note">
                      {turn.model ?? "default"} · {formatTimestamp(turn.updatedAt)}
                    </p>
                  </div>
                  <div className="copilot-turn-metrics">
                    <span>{formatTokens(turn.breakdown.totalTokens)} tok</span>
                    <span>{formatUsd(turn.normalizedCostUsd)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CopilotPane>

        <CopilotPane title="Recent analyses" eyebrow="Task feed">
          {state.tasks.length === 0 ? (
            <p className="copilot-empty">No Copilot tasks have been run yet.</p>
          ) : (
            <div className="copilot-task-list">
              {state.tasks.map((task) => (
                <div className="copilot-task-list-row" key={task.taskId}>
                  <div>
                    <strong>{task.title}</strong>
                    <p className="copilot-note">
                      {task.subtitle} · {humanizeValue(task.model)}
                    </p>
                  </div>
                  <span className={`copilot-badge status-${task.status}`}>{getTaskStatusLabel(task.status)}</span>
                </div>
              ))}
            </div>
          )}
        </CopilotPane>
      </div>
    </div>
  );
}

export const requireDesktopActionCopy = (
  shellAvailable: boolean,
  bridgeAvailable: boolean,
  loggedIn: boolean
): string => {
  if (!shellAvailable) {
    return "This control is desktop-only. Open Islandflow Desktop to run Copilot tasks.";
  }
  if (!bridgeAvailable) {
    return "Islandflow Desktop is open, but this window is missing the native AI bridge. Reload the window or restart the app.";
  }
  if (!loggedIn) {
    return "Connect a ChatGPT or Codex account in Settings before running Copilot analysis.";
  }
  return "";
};

const SmartMoneyTaskButton = ({
  label,
  kind,
  symbol,
  disabled,
  busyKind,
  onRun
}: {
  label: string;
  kind: IslandflowAiTaskKind;
  symbol: string;
  disabled: boolean;
  busyKind: IslandflowAiTaskKind | null;
  onRun: (kind: IslandflowAiTaskKind) => void;
}) => {
  return (
    <button
      className={`terminal-button${kind === "smart-money-explain" ? " terminal-button-primary" : ""}`}
      type="button"
      onClick={() => onRun(kind)}
      disabled={busyKind !== null || disabled}
      title={`${label} for ${symbol}`}
    >
      {busyKind === kind ? "Running" : label}
    </button>
  );
};

export function SmartMoneyCopilotPanel({
  event,
  flowPacket,
  evidencePrints,
  relatedPackets
}: {
  event: SmartMoneyEvent;
  flowPacket: FlowPacket | null;
  evidencePrints: OptionPrint[];
  relatedPackets: FlowPacket[];
}) {
  const { bridgeAvailable, shellAvailable, state, runTask } = useDesktopAi();
  const [busyKind, setBusyKind] = useState<IslandflowAiTaskKind | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const disabledCopy = requireDesktopActionCopy(shellAvailable, bridgeAvailable, state.account.loggedIn);
  const actionsDisabled = !bridgeAvailable || !state.account.loggedIn;

  const handleRun = async (kind: IslandflowAiTaskKind) => {
    setBusyKind(kind);
    setTaskError(null);
    try {
      const result = await runTask({
        kind: kind as
          | "smart-money-explain"
          | "smart-money-skeptic"
          | "smart-money-burst-summary"
          | "watchlist-synthesis",
        context: {
          event,
          flowPacket,
          evidencePrints,
          relatedPackets
        }
      });
      setActiveTaskId(result.taskId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <div className="copilot-inline-panel">
      <div className="copilot-inline-head">
        <div>
          <div className="copilot-list-title">Analyst Copilot</div>
          <p className="copilot-note">Structured interpretation only, the deterministic classifier remains the source of truth.</p>
        </div>
        <Link className="terminal-button" href="/settings">
          AI settings
        </Link>
      </div>
      <div className="copilot-action-grid">
        <SmartMoneyTaskButton
          label="Explain"
          kind="smart-money-explain"
          symbol={event.underlying_id}
          disabled={actionsDisabled}
          busyKind={busyKind}
          onRun={(kind) => void handleRun(kind)}
        />
        <SmartMoneyTaskButton
          label="Counter-thesis"
          kind="smart-money-skeptic"
          symbol={event.underlying_id}
          disabled={actionsDisabled}
          busyKind={busyKind}
          onRun={(kind) => void handleRun(kind)}
        />
        <SmartMoneyTaskButton
          label="Burst summary"
          kind="smart-money-burst-summary"
          symbol={event.underlying_id}
          disabled={actionsDisabled}
          busyKind={busyKind}
          onRun={(kind) => void handleRun(kind)}
        />
        <SmartMoneyTaskButton
          label="Watchlist"
          kind="watchlist-synthesis"
          symbol={event.underlying_id}
          disabled={actionsDisabled}
          busyKind={busyKind}
          onRun={(kind) => void handleRun(kind)}
        />
      </div>
      {disabledCopy ? <p className="copilot-note">{disabledCopy}</p> : null}
      {taskError ? <p className="copilot-error">{taskError}</p> : null}
      <TaskOutput taskId={activeTaskId} emptyMessage="Run an explanation, skepticism pass, burst summary, or watchlist synthesis to see the result here." />
    </div>
  );
}

export function ReplayCopilotPanel({
  ticker,
  flowFilters,
  alerts,
  smartMoneyEvents,
  classifierHits,
  flowPackets,
  optionPrints
}: {
  ticker: string | null;
  flowFilters: OptionFlowFilters;
  alerts: AlertEvent[];
  smartMoneyEvents: SmartMoneyEvent[];
  classifierHits: ClassifierHitEvent[];
  flowPackets: FlowPacket[];
  optionPrints: OptionPrint[];
}) {
  const { bridgeAvailable, shellAvailable, state, runTask } = useDesktopAi();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const disabledCopy = requireDesktopActionCopy(shellAvailable, bridgeAvailable, state.account.loggedIn);
  const actionsDisabled = busy || !bridgeAvailable || !state.account.loggedIn;

  const handleRun = async () => {
    setBusy(true);
    setTaskError(null);
    try {
      const result = await runTask({
        kind: "replay-postmortem",
        context: {
          ticker,
          flowFilters,
          alerts,
          smartMoneyEvents,
          classifierHits,
          flowPackets,
          optionPrints
        }
      });
      setActiveTaskId(result.taskId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CopilotPane
      title="Replay postmortem"
      eyebrow="Structured recap"
      actions={
        <>
          <Link className="terminal-button" href="/settings">
            AI settings
          </Link>
          <button
            className="terminal-button terminal-button-primary"
            type="button"
            onClick={() => void handleRun()}
            disabled={actionsDisabled}
          >
            {busy ? "Running" : "Generate postmortem"}
          </button>
        </>
      }
    >
      <p className="copilot-note">
        Copilot uses the current replay slice only: ticker scope, flow filters, visible alerts, classifier hits, packets, and option prints.
      </p>
      {disabledCopy ? <p className="copilot-note">{disabledCopy}</p> : null}
      {taskError ? <p className="copilot-error">{taskError}</p> : null}
      <TaskOutput taskId={activeTaskId} emptyMessage="Generate a replay postmortem to capture the cleanest read from the current session slice." />
    </CopilotPane>
  );
}

export function ScreenCompilerPanel({
  currentFilters,
  onApplyFilters
}: {
  currentFilters: OptionFlowFilters;
  onApplyFilters: (next: OptionFlowFilters) => void;
}) {
  const { bridgeAvailable, shellAvailable, state, runTask } = useDesktopAi();
  const [prompt, setPrompt] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const activeTask = useMemo(() => findTask(state.tasks, activeTaskId), [state.tasks, activeTaskId]);
  const disabledCopy = requireDesktopActionCopy(shellAvailable, bridgeAvailable, state.account.loggedIn);
  const actionsDisabled = busy || !bridgeAvailable || !state.account.loggedIn;

  const handleCompile = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setTaskError("Write a screen request first.");
      return;
    }

    setBusy(true);
    setTaskError(null);
    try {
      const result = await runTask({
        kind: "screen-compile",
        context: {
          prompt: trimmedPrompt,
          currentFilters
        }
      });
      setActiveTaskId(result.taskId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const compiledFilters = activeTask?.compiledScreen?.compiledFilters ?? null;

  return (
    <CopilotPane
      title="Natural-language screens"
      eyebrow="Tape workflow"
      actions={
        <>
          <Link className="terminal-button" href="/settings">
            AI settings
          </Link>
          <button
            className="terminal-button terminal-button-primary"
            type="button"
            onClick={() => void handleCompile()}
            disabled={actionsDisabled}
          >
            {busy ? "Compiling" : "Compile screen"}
          </button>
        </>
      }
    >
      <div className="copilot-inline-form">
        <label className="copilot-field">
          <span className="copilot-field-label">Prompt</span>
          <textarea
            className="copilot-textarea"
            rows={4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="High-notional single-name call buying near the ask, ignore ETFs, keep it signal-only."
          />
        </label>
        <div className="copilot-current-filters">
          <div className="copilot-list-title">Current filter baseline</div>
          <pre className="copilot-json-block">{JSON.stringify(currentFilters, null, 2)}</pre>
        </div>
      </div>
      {disabledCopy ? <p className="copilot-note">{disabledCopy}</p> : null}
      {taskError ? <p className="copilot-error">{taskError}</p> : null}
      {compiledFilters ? (
        <div className="copilot-apply-row">
          <button className="terminal-button" type="button" onClick={() => onApplyFilters(compiledFilters)}>
            Apply compiled filters
          </button>
        </div>
      ) : null}
      <TaskOutput taskId={activeTaskId} emptyMessage="Compile a natural-language screen to preview the translated filter set and rationale." />
    </CopilotPane>
  );
}
