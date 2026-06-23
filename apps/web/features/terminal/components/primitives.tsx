"use client";

import type {
  OptionFlowFilters,
  OptionFlowView,
  OptionNbboSide,
  OptionSecurityType,
  OptionType
} from "@islandflow/types";
import * as nextNavigation from "next/navigation";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState
} from "react";

import {
  buildDefaultFlowFilters,
  countActiveFlowFilterGroups,
  DEFAULT_FLOW_SECURITY_TYPES,
  nextFlowFilterPopoverState,
  toggleFilterValue
} from "../filters";
import { statusLabel } from "../format";
import type { TapeMode, WsStatus } from "../types";
import { formatTime } from "./ui-helpers";

type TapeStatusProps = {
  status: WsStatus;
  lastUpdate: number | null;
  replayTime: number | null;
  replayComplete: boolean;
  paused: boolean;
  dropped: number;
  mode: TapeMode;
};

export const TapeStatus = ({
  status,
  lastUpdate: _lastUpdate,
  replayTime,
  replayComplete,
  paused,
  dropped,
  mode
}: TapeStatusProps) => {
  const label = replayComplete ? "Replay Complete" : statusLabel(status, paused, mode);
  const pausedLabel = paused && dropped > 0 ? `+${dropped} queued` : "";

  return (
    <div
      className={`status-inline status-${status} ${mode === "replay" ? "status-replay" : ""}`.trim()}
    >
      <span className="status-dot" />
      <span className="status-inline-label">{label}</span>
      {mode === "replay" ? (
        <span className="status-inline-meta">
          Replay time {replayTime ? formatTime(replayTime) : "—"}
        </span>
      ) : null}
      <span
        className={`status-inline-counter${pausedLabel ? " status-inline-counter-visible" : ""}`}
      >
        {pausedLabel || "+000 queued"}
      </span>
    </div>
  );
};

type TapeControlsProps = {
  mode: TapeMode;
  paused: boolean;
  onTogglePause: () => void;
  isAtTop: boolean;
  missed: number;
  onJump: () => void;
};

export const TapeControls = ({
  mode,
  paused,
  onTogglePause,
  isAtTop,
  missed,
  onJump
}: TapeControlsProps) => {
  const active = !isAtTop && missed > 0;
  return (
    <div className={`tape-controls${active ? " tape-controls-active" : ""}`}>
      {mode === "replay" ? (
        <button className="pause-button" type="button" onClick={onTogglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
      ) : null}
      <button className="jump-button" type="button" onClick={onJump} disabled={isAtTop}>
        Jump to top
      </button>
      <span
        className={`missed-count${active ? " missed-count-visible" : ""}`}
        aria-hidden={!active}
      >
        +{missed} new
      </span>
    </div>
  );
};

type PageFrameVariant = "default" | "dashboard" | "options" | "news" | "durable-tapes";

type PageFrameProps = {
  title: string;
  eyebrow?: string;
  variant?: PageFrameVariant;
  actions?: ReactNode;
  children: ReactNode;
};

export const PageFrame = ({
  title,
  eyebrow,
  variant = "default",
  actions,
  children
}: PageFrameProps) => {
  const classes = ["page-shell", `page-shell-${variant}`].join(" ");
  return (
    <div className={classes} data-route-variant={variant}>
      <header className="page-header">
        <div className="page-heading">
          {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
          <h1 className="page-title">{title}</h1>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
};

type FlowFilterPopoverProps = {
  filters: OptionFlowFilters;
  onChange: Dispatch<SetStateAction<OptionFlowFilters>>;
};

const FlowFilterSection = ({ title, children }: { title: string; children: ReactNode }) => {
  return (
    <section className="flow-filter-section">
      <div className="flow-filter-section-title">{title}</div>
      {children}
    </section>
  );
};

export const FlowFilterPopover = ({ filters, onChange }: FlowFilterPopoverProps) => {
  const pathname = nextNavigation.usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeCount = countActiveFlowFilterGroups(filters);

  const toggleSecurity = (value: OptionSecurityType, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      securityTypes: toggleFilterValue(prev.securityTypes, value, enabled)
    }));
  };

  const toggleSide = (value: OptionNbboSide, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      nbboSides: toggleFilterValue(prev.nbboSides, value, enabled)
    }));
  };

  const toggleOptionType = (value: OptionType, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      optionTypes: toggleFilterValue(prev.optionTypes, value, enabled)
    }));
  };

  const applyMinNotional = (value: number | undefined) => {
    onChange((prev) => ({
      ...prev,
      minNotional: value
    }));
  };

  const applyView = (view: OptionFlowView) => {
    onChange((prev) => ({
      ...prev,
      view,
      securityTypes:
        view === "raw" ? undefined : (prev.securityTypes ?? DEFAULT_FLOW_SECURITY_TYPES),
      nbboSides: view === "raw" ? undefined : prev.nbboSides,
      optionTypes: view === "raw" ? undefined : prev.optionTypes,
      minNotional: view === "raw" ? undefined : prev.minNotional
    }));
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen((current) => nextFlowFilterPopoverState(current, "dismiss"));
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen((current) => nextFlowFilterPopoverState(current, "dismiss"));
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className={`flow-filter-popover${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`terminal-button flow-filter-trigger${activeCount > 0 ? " is-active" : ""}`}
        type="button"
        onClick={() => setOpen((current) => nextFlowFilterPopoverState(current, "toggle"))}
      >
        <span>Filter</span>
        {activeCount > 0 ? <span className="flow-filter-badge">{activeCount}</span> : null}
      </button>

      {open ? (
        <div aria-label="Flow filters" className="flow-filter-popover-panel" role="dialog">
          <div className="flow-filter-popover-head">
            <div>
              <div className="flow-filter-popover-title">Flow Filters</div>
              <div className="flow-filter-popover-copy">Changes apply immediately.</div>
            </div>
            <button
              className="terminal-button"
              type="button"
              onClick={() => onChange(buildDefaultFlowFilters())}
            >
              Reset
            </button>
          </div>

          <div className="flow-filter-popover-body">
            <FlowFilterSection title="Options View">
              <div className="flow-filter-chip-grid flow-filter-chip-grid-two">
                {[
                  { label: "Signal", value: "signal" as const },
                  { label: "All prints", value: "raw" as const }
                ].map((preset) => (
                  <button
                    className={`filter-chip ${filters.view === preset.value ? "is-active" : ""}`}
                    key={preset.value}
                    type="button"
                    onClick={() => applyView(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="flow-filter-section-copy">
                Signal keeps classifier-ready prints. All prints includes raw option tape rows.
              </p>
            </FlowFilterSection>

            <FlowFilterSection title="Security">
              <div className="flow-filter-checkbox-grid">
                {(["stock", "etf"] as OptionSecurityType[]).map((value) => (
                  <label className="flow-filter-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(filters.securityTypes ?? []).includes(value)}
                      onChange={(event) => toggleSecurity(value, event.target.checked)}
                    />
                    <span>{value.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </FlowFilterSection>

            <FlowFilterSection title="Side">
              <div className="flow-filter-checkbox-grid flow-filter-checkbox-grid-wide">
                {(["AA", "A", "MID", "B", "BB"] as OptionNbboSide[]).map((value) => (
                  <label className="flow-filter-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(filters.nbboSides ?? []).includes(value)}
                      onChange={(event) => toggleSide(value, event.target.checked)}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </FlowFilterSection>

            <FlowFilterSection title="Type">
              <div className="flow-filter-checkbox-grid">
                {(["call", "put"] as OptionType[]).map((value) => (
                  <label className="flow-filter-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(filters.optionTypes ?? []).includes(value)}
                      onChange={(event) => toggleOptionType(value, event.target.checked)}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </FlowFilterSection>

            <FlowFilterSection title="Min Notional">
              <div className="flow-filter-chip-grid">
                {[
                  { label: "All signal", value: undefined },
                  { label: ">= 25k", value: 25_000 },
                  { label: ">= 50k", value: 50_000 },
                  { label: ">= 100k", value: 100_000 }
                ].map((preset) => (
                  <button
                    className={`filter-chip ${filters.minNotional === preset.value ? "is-active" : ""}`}
                    key={preset.label}
                    type="button"
                    onClick={() => applyMinNotional(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </FlowFilterSection>
          </div>
        </div>
      ) : null}
    </div>
  );
};

type PaneProps = {
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export const Pane = ({ title, status, actions, className = "", children }: PaneProps) => {
  const classes = ["terminal-pane", className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      <div className="terminal-pane-head">
        <div className="terminal-pane-title-row">
          <h2 className="terminal-pane-title">{title}</h2>
          {status ? <div className="terminal-pane-status">{status}</div> : null}
        </div>
        {actions ? <div className="terminal-pane-actions">{actions}</div> : null}
      </div>
      <div className="terminal-pane-body">{children}</div>
    </section>
  );
};
