"use client";

import type {
  SyntheticControlState,
  SyntheticDemoProfileId,
  SyntheticDerivedStatus,
  SyntheticLoadProfileId
} from "@islandflow/types";
import Link from "next/link";
import * as nextNavigation from "next/navigation";
import { memo, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { isSyntheticAdminVisible } from "./config";
import { normalizeTickerFilterInput, TICKER_FILTER_INPUT_MAX_LENGTH } from "./filters";
import { getTerminalNavCurrentHref, NAV_ITEMS } from "./routes";
import {
  shallowEqualTerminalSelection,
  TerminalContext,
  type TerminalState,
  useTerminal,
  useTerminalSelector,
  useTerminalState,
  useTerminalStateStore
} from "./state";

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString();
};

type SyntheticAdminStatusResponse = {
  enabled: boolean;
  backend_mode: "synthetic" | "mixed" | "live";
  adapters: {
    options: string;
    equities: string;
  };
  control: SyntheticControlState | null;
  derived: SyntheticDerivedStatus | null;
  profiles?: SyntheticProfileCatalog;
  disabled_reason?: string;
};

type SyntheticAdminControlResponse = {
  control: SyntheticControlState;
  derived?: SyntheticDerivedStatus | null;
};

const SYNTHETIC_ADMIN_PROXY_PATHS = {
  status: "/api/admin/synthetic/status",
  control: "/api/admin/synthetic/control"
} as const;

type SyntheticDemoProfileSummary = {
  id: SyntheticDemoProfileId;
  title: string;
  description: string;
  default_load_profile_id: SyntheticLoadProfileId;
  runs: Array<{
    scenario_id: string;
    run_id: string;
    run_name: string;
    title: string;
    family: string;
  }>;
};

type SyntheticLoadProfileSummary = {
  id: SyntheticLoadProfileId;
  title: string;
  description: string;
  rate_multiplier: number;
  volume_multiplier: number;
  mode: string;
};

type SyntheticProfileCatalog = {
  demo_profiles: SyntheticDemoProfileSummary[];
  load_profiles: SyntheticLoadProfileSummary[];
};

const SYNTHETIC_PROFILE_CATALOG_FALLBACK: SyntheticProfileCatalog = {
  demo_profiles: [
    {
      id: "market-command",
      title: "Market Command",
      description: "Balanced deterministic run sequence.",
      default_load_profile_id: "steady",
      runs: []
    },
    {
      id: "event-response",
      title: "Event Response",
      description: "Event and hedge-response deterministic runs.",
      default_load_profile_id: "active",
      runs: []
    },
    {
      id: "quiet-range",
      title: "Quiet Range",
      description: "Structure, volatility-supply, and no-alert runs.",
      default_load_profile_id: "steady",
      runs: []
    },
    {
      id: "stress-tape",
      title: "Stress Tape",
      description: "All named synthetic scenario runs.",
      default_load_profile_id: "firehose",
      runs: []
    }
  ],
  load_profiles: [
    {
      id: "steady",
      title: "Steady",
      description: "One deterministic run per base interval.",
      rate_multiplier: 1,
      volume_multiplier: 1,
      mode: "realistic"
    },
    {
      id: "active",
      title: "Active",
      description: "Faster deterministic playback.",
      rate_multiplier: 2,
      volume_multiplier: 1,
      mode: "active"
    },
    {
      id: "firehose",
      title: "Firehose",
      description: "Fast deterministic playback with repeated named runs.",
      rate_multiplier: 4,
      volume_multiplier: 2,
      mode: "firehose"
    }
  ]
};

const SYNTHETIC_PROFILE_ORDER: Array<keyof SyntheticControlState["profile_weights"]> = [
  "institutional_directional",
  "retail_whale",
  "event_driven",
  "vol_seller",
  "arbitrage",
  "hedge_reactive"
];

const SYNTHETIC_PROFILE_LABELS: Record<keyof SyntheticControlState["profile_weights"], string> = {
  institutional_directional: "Institutional Directional",
  retail_whale: "Retail Whale",
  event_driven: "Event Driven",
  vol_seller: "Vol Seller",
  arbitrage: "Arbitrage",
  hedge_reactive: "Hedge Reactive"
};

const buildDefaultSyntheticControl = (): SyntheticControlState => ({
  demo_profile_id: "market-command",
  load_profile_id: "steady",
  preset_id: "balanced_demo",
  coverage_assist: true,
  coverage_window_minutes: 20,
  shared_seed: 11,
  profile_weights: {
    institutional_directional: 1.0,
    retail_whale: 1.0,
    event_driven: 1.0,
    vol_seller: 1.0,
    arbitrage: 1.0,
    hedge_reactive: 1.0
  },
  updated_at: 0,
  updated_by: "internal-ui"
});

type SyntheticControlPatch = Omit<Partial<SyntheticControlState>, "profile_weights"> & {
  profile_weights?: Partial<SyntheticControlState["profile_weights"]>;
};

const createSyntheticControlDraft = (
  current: SyntheticControlState,
  patch: SyntheticControlPatch
): SyntheticControlState => ({
  ...current,
  ...patch,
  profile_weights: {
    ...current.profile_weights,
    ...(patch.profile_weights ?? {})
  },
  updated_at: Date.now(),
  updated_by: "internal-ui"
});

const ShellMetricStrip = () => {
  const state = useTerminal();
  const focus = state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "ALL";
  const replay = state.replaySource ? state.replaySource.toUpperCase() : "AUTO";

  return (
    <div className="shell-metrics">
      <div className="shell-metric">
        <span className="shell-metric-label">Mode</span>
        <span className="shell-metric-value">{state.mode === "live" ? "LIVE" : "REPLAY"}</span>
      </div>
      <div className="shell-metric">
        <span className="shell-metric-label">Focus</span>
        <span className="shell-metric-value">{focus}</span>
      </div>
      <div className="shell-metric">
        <span className="shell-metric-label">Source</span>
        <span className="shell-metric-value">{replay}</span>
      </div>
      <div className="shell-metric">
        <span className="shell-metric-label">Last</span>
        <span className="shell-metric-value">
          {state.lastSeen ? formatTime(state.lastSeen) : "WAITING"}
        </span>
      </div>
    </div>
  );
};

function SyntheticControlDock() {
  const visible = isSyntheticAdminVisible();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SyntheticAdminStatusResponse | null>(null);
  const [draft, setDraft] = useState<SyntheticControlState | null>(null);
  const [saved, setSaved] = useState<SyntheticControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const savedRef = useRef<SyntheticControlState | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(SYNTHETIC_ADMIN_PROXY_PATHS.status, {
          cache: "no-store"
        });
        if (cancelled) {
          return;
        }
        if (response.status === 404) {
          setStatus({
            enabled: false,
            backend_mode: "live",
            adapters: { options: "unknown", equities: "unknown" },
            control: null,
            derived: null,
            disabled_reason: "Synthetic admin backend is disabled."
          });
          setLoading(false);
          return;
        }
        const nextStatus = (await response.json()) as SyntheticAdminStatusResponse;
        setStatus(nextStatus);
        if (!dirtyRef.current) {
          const nextControl = nextStatus.control ?? buildDefaultSyntheticControl();
          setDraft(nextControl);
          setSaved(nextControl);
          savedRef.current = nextControl;
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !status?.enabled || !draft || !dirtyRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      const nextDraft = draft;
      setSaving(true);
      setError(null);
      void fetch(SYNTHETIC_ADMIN_PROXY_PATHS.control, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(nextDraft)
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail ?? body?.error ?? "Synthetic control update failed");
          }
          return (await response.json()) as SyntheticAdminControlResponse;
        })
        .then((payload) => {
          dirtyRef.current = false;
          savedRef.current = payload.control;
          setSaved(payload.control);
          setDraft(payload.control);
          setStatus((current) =>
            current
              ? {
                  ...current,
                  control: payload.control,
                  derived: payload.derived ?? current.derived
                }
              : current
          );
        })
        .catch((updateError) => {
          dirtyRef.current = false;
          setError(updateError instanceof Error ? updateError.message : String(updateError));
          setDraft(savedRef.current);
        })
        .finally(() => {
          setSaving(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeout);
    };
  }, [draft, status?.enabled, visible]);

  if (!visible) {
    return null;
  }

  const currentControl = draft ?? saved ?? buildDefaultSyntheticControl();
  const disabled = !status?.enabled;
  const derived = status?.derived;
  const profileCatalog = status?.profiles ?? SYNTHETIC_PROFILE_CATALOG_FALLBACK;
  const selectedDemoProfile =
    profileCatalog.demo_profiles.find((profile) => profile.id === currentControl.demo_profile_id) ??
    profileCatalog.demo_profiles[0];
  const selectedLoadProfile =
    profileCatalog.load_profiles.find((profile) => profile.id === currentControl.load_profile_id) ??
    profileCatalog.load_profiles[0];

  const updateControl = (patch: SyntheticControlPatch) => {
    dirtyRef.current = true;
    setDraft((current) =>
      createSyntheticControlDraft(current ?? buildDefaultSyntheticControl(), patch)
    );
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Synthetic control"
        className={`synthetic-control-gear${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="synthetic-control-gear-mark">+</span>
      </button>

      {open ? (
        <aside className="synthetic-control-drawer" aria-label="Synthetic control drawer">
          <div className="synthetic-control-header">
            <div>
              <p className="synthetic-control-kicker">Synthetic Control</p>
              <h3>Hosted tape operator rail</h3>
            </div>
            <button className="drawer-close" onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </div>

          {loading ? (
            <p className="drawer-note">Loading hosted synthetic status…</p>
          ) : disabled ? (
            <div className="synthetic-control-disabled">
              <p className="synthetic-control-disabled-label">Unavailable</p>
              <p>{status?.disabled_reason ?? "Synthetic control is currently unavailable."}</p>
              <span>
                Backend: {status?.backend_mode ?? "unknown"} · Options:{" "}
                {status?.adapters.options ?? "unknown"} · Equities:{" "}
                {status?.adapters.equities ?? "unknown"}
              </span>
            </div>
          ) : (
            <>
              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Demo Profile</span>
                  <span>{saving ? "Saving…" : "Live"}</span>
                </div>
                <label className="synthetic-control-select">
                  <select
                    onChange={(event) =>
                      updateControl({
                        demo_profile_id: event.target.value as SyntheticDemoProfileId
                      })
                    }
                    value={currentControl.demo_profile_id}
                  >
                    {profileCatalog.demo_profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedDemoProfile?.runs.length ? (
                  <div className="synthetic-hit-list synthetic-run-list">
                    {selectedDemoProfile.runs.map((run) => (
                      <div className="synthetic-hit-row" key={run.run_id}>
                        <span>{run.title}</span>
                        <strong>{run.run_id}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Load Profile</span>
                  <span>
                    {selectedLoadProfile ? `${selectedLoadProfile.rate_multiplier}x` : "—"}
                  </span>
                </div>
                <div className="synthetic-segment-row">
                  {profileCatalog.load_profiles.map((profile) => (
                    <button
                      className={`synthetic-segment${currentControl.load_profile_id === profile.id ? " is-active" : ""}`}
                      key={profile.id}
                      onClick={() =>
                        updateControl({
                          load_profile_id: profile.id
                        })
                      }
                      type="button"
                    >
                      {profile.title}
                    </button>
                  ))}
                </div>
              </section>

              <section className="synthetic-control-section">
                <div className="synthetic-control-section-head">
                  <span>Live Status</span>
                  <span>{status?.backend_mode ?? "unknown"}</span>
                </div>
                <div className="synthetic-status-grid">
                  <div>
                    <span>Regime</span>
                    <strong>{derived?.regime ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Session</span>
                    <strong>{derived?.session_phase ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Focus</span>
                    <strong>
                      {derived?.focus_symbols?.length ? derived.focus_symbols.join(", ") : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Backend</span>
                    <strong>{status?.enabled ? "Enabled" : "Disabled"}</strong>
                  </div>
                </div>
                <div className="synthetic-hit-list">
                  {SYNTHETIC_PROFILE_ORDER.map((profileId) => (
                    <div className="synthetic-hit-row" key={profileId}>
                      <span>{SYNTHETIC_PROFILE_LABELS[profileId]}</span>
                      <strong>{derived?.profile_hit_counts?.[profileId] ?? 0}</strong>
                    </div>
                  ))}
                </div>
              </section>

              {error ? <p className="drawer-note synthetic-control-error">{error}</p> : null}
            </>
          )}
        </aside>
      ) : null}
    </>
  );
}

export type TerminalDrawersRenderer = (state: TerminalState) => ReactNode;

type TerminalAppShellProps = {
  children: ReactNode;
  renderDrawers?: TerminalDrawersRenderer;
};

type TerminalChromeProps = TerminalAppShellProps;

const EMPTY_TERMINAL_DRAWER_STATE = {
  selectedAlert: null,
  selectedNewsStory: null,
  selectedClassifierHit: null,
  selectedSmartFlowProjection: null,
  selectedSmartMoneyEvent: null,
  selectedDarkEvent: null
};

const selectTerminalDrawerState = (state: TerminalState): Partial<TerminalState> => {
  if (
    !state.selectedAlert &&
    !state.selectedNewsStory &&
    !state.selectedClassifierHit &&
    !state.selectedSmartFlowProjection &&
    !state.selectedSmartMoneyEvent &&
    !state.selectedDarkEvent
  ) {
    return EMPTY_TERMINAL_DRAWER_STATE;
  }

  return {
    flowPacketMap: state.flowPacketMap,
    focusAlertContract: state.focusAlertContract,
    focusAlertEquity: state.focusAlertEquity,
    focusFlowPacketRequest: state.focusFlowPacketRequest,
    optionPrintMap: state.optionPrintMap,
    selectedAlert: state.selectedAlert,
    selectedClassifierEvidence: state.selectedClassifierEvidence,
    selectedClassifierFlowPacket: state.selectedClassifierFlowPacket,
    selectedClassifierHit: state.selectedClassifierHit,
    selectedDarkEvent: state.selectedDarkEvent,
    selectedDarkEvidence: state.selectedDarkEvidence,
    selectedDarkUnderlying: state.selectedDarkUnderlying,
    selectedNewsStory: state.selectedNewsStory,
    selectedSmartFlowEvidence: state.selectedSmartFlowEvidence,
    selectedSmartFlowProjection: state.selectedSmartFlowProjection,
    selectedSmartMoneyEvent: state.selectedSmartMoneyEvent,
    selectedSmartMoneyEvidence: state.selectedSmartMoneyEvidence,
    selectedSmartMoneyFlowPacket: state.selectedSmartMoneyFlowPacket,
    setSelectedAlert: state.setSelectedAlert,
    setSelectedClassifierHit: state.setSelectedClassifierHit,
    setSelectedDarkEvent: state.setSelectedDarkEvent,
    setSelectedNewsStory: state.setSelectedNewsStory,
    setSelectedSmartFlowProjection: state.setSelectedSmartFlowProjection,
    setSelectedSmartMoneyEvent: state.setSelectedSmartMoneyEvent
  };
};

const TerminalDrawersOutlet = memo(function TerminalDrawersOutlet({
  renderDrawers
}: {
  renderDrawers?: TerminalDrawersRenderer;
}) {
  const drawerState = useTerminalSelector(selectTerminalDrawerState, shallowEqualTerminalSelection);
  return renderDrawers ? renderDrawers(drawerState as TerminalState) : null;
});

export function TerminalAppShell({ children, renderDrawers }: TerminalAppShellProps) {
  const pathname = nextNavigation.usePathname();

  if (pathname?.startsWith("/mock")) {
    return (
      <div className="mock-shell">
        <a className="skip-link mock-skip-link" href="#mock-title">
          Skip to mock content
        </a>
        {children}
      </div>
    );
  }

  return <TerminalChrome renderDrawers={renderDrawers}>{children}</TerminalChrome>;
}

function TerminalChrome({ children, renderDrawers }: TerminalChromeProps) {
  const state = useTerminalState();
  const terminalStore = useTerminalStateStore(state);
  const pathname = nextNavigation.usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tickerFieldId = useId();
  const tickerHintId = useId();
  const activeNavHref = getTerminalNavCurrentHref(pathname);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen]);

  return (
    <TerminalContext.Provider value={terminalStore}>
      <div className="terminal-shell">
        <a className="skip-link" href="#terminal-content">
          Skip to terminal content
        </a>

        <div className="terminal-frame">
          <header className="terminal-topbar">
            <div className="terminal-topbar-leading">
              <button
                aria-controls="terminal-nav-drawer"
                aria-expanded={drawerOpen}
                aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
                className="terminal-button terminal-menu-trigger"
                type="button"
                onClick={() => setDrawerOpen((current) => !current)}
              >
                <span aria-hidden="true" className="terminal-menu-trigger-icon">
                  <span />
                  <span />
                  <span />
                </span>
                <span>Menu</span>
              </button>
            </div>
            <div className="terminal-topbar-actions">
              <div className="terminal-topbar-controls">
                {state.selectedInstrumentLabel &&
                state.selectedInstrument?.kind !== "option-contract" ? (
                  <span className="instrument-focus-chip">
                    <span>{state.selectedInstrumentLabel}</span>
                    <button type="button" onClick={() => state.setSelectedInstrument(null)}>
                      Clear
                    </button>
                  </span>
                ) : null}
                <label className="terminal-filter">
                  <span className="terminal-filter-label" id={tickerHintId}>
                    Ticker
                  </span>
                  <span className="terminal-filter-field">
                    <input
                      id={tickerFieldId}
                      aria-describedby={tickerHintId}
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      className="terminal-input"
                      value={state.filterInput}
                      inputMode="text"
                      maxLength={TICKER_FILTER_INPUT_MAX_LENGTH}
                      name="ticker-filter"
                      onChange={(event) =>
                        state.setFilterInput(normalizeTickerFilterInput(event.target.value))
                      }
                      placeholder="SPY, NVDA, AAPL"
                      spellCheck={false}
                    />
                  </span>
                </label>
                <button
                  aria-label="Clear ticker filter"
                  className="terminal-button"
                  type="button"
                  onClick={() => state.setFilterInput("")}
                  disabled={state.filterInput.trim().length === 0}
                  title="Clear ticker filter"
                >
                  Clear
                </button>
              </div>
              <div className="terminal-topbar-mode">
                <button
                  aria-label={
                    state.mode === "live" ? "Switch to replay mode" : "Switch to live mode"
                  }
                  aria-pressed={state.mode !== "live"}
                  className="terminal-button terminal-button-primary"
                  type="button"
                  onClick={state.toggleMode}
                  title={state.mode === "live" ? "Switch to replay mode" : "Switch to live mode"}
                >
                  {state.mode === "live" ? "Replay" : "Live"}
                </button>
              </div>
            </div>
          </header>

          <main className="terminal-content" id="terminal-content">
            {children}
          </main>
        </div>

        {drawerOpen ? (
          <>
            <button
              aria-label="Close navigation drawer"
              className="terminal-drawer-backdrop"
              type="button"
              onClick={() => setDrawerOpen(false)}
            />
            <aside
              aria-label="Primary navigation"
              className="terminal-nav-drawer"
              id="terminal-nav-drawer"
            >
              <div className="terminal-drawer-head">
                <div className="terminal-brand">
                  <span className="terminal-brand-kicker">IF</span>
                  <span className="terminal-brand-name">islandflow</span>
                </div>
                <button
                  aria-label="Close navigation drawer"
                  className="terminal-button terminal-drawer-close"
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                >
                  Close
                </button>
              </div>
              <nav aria-label="Primary" className="terminal-nav">
                {NAV_ITEMS.map((item) => {
                  const active = activeNavHref === item.href;
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={`terminal-nav-link${active ? " terminal-nav-link-active" : ""}`}
                      href={item.href}
                      key={item.href}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <ShellMetricStrip />
            </aside>
          </>
        ) : null}

        <SyntheticControlDock />
        <TerminalDrawersOutlet renderDrawers={renderDrawers} />
      </div>
    </TerminalContext.Provider>
  );
}
