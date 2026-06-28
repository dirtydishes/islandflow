"use client";

import type { OptionFlowFilters, OptionFlowView } from "@islandflow/types";
import { optionFlowFilterKey } from "@islandflow/types";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

import {
  applyOptionsTapeSecurityPreset,
  applyOptionsTapeSidePreset,
  applyOptionsTapeTypePreset,
  applyOptionsTapeView,
  buildDefaultOptionsTapeFilters,
  getOptionsTapeSidePreset,
  type OptionsTapeSidePreset
} from "./filters";
import {
  buildDefaultOptionsTapeSettings,
  getVisibleOptionsTapeColumnOrder,
  normalizeOptionsTapeSettings,
  reduceOptionsTapeSettings,
  type OptionsTapeSettingsState
} from "./settings";

type OptionsTapeSettingsProps = {
  filters: OptionFlowFilters;
  settings: OptionsTapeSettingsState;
  onApplyFilters: Dispatch<SetStateAction<OptionFlowFilters>>;
  onApplySettings: Dispatch<SetStateAction<OptionsTapeSettingsState>>;
};

const VIEW_PRESETS: Array<{ label: string; value: OptionFlowView }> = [
  { label: "Signal prints", value: "signal" },
  { label: "All prints", value: "raw" }
];

const SIDE_PRESETS: Array<{ label: string; value: OptionsTapeSidePreset }> = [
  { label: "Default", value: "default" },
  { label: "AA only", value: "aa" },
  { label: "A only", value: "a" },
  { label: "Ask side", value: "ask" },
  { label: "Mid", value: "mid" },
  { label: "Bid side", value: "bid" },
  { label: "B only", value: "b" },
  { label: "BB only", value: "bb" },
  { label: "Custom", value: "custom" }
];

const TYPE_PRESETS: Array<{ label: string; value: "calls" | "puts" | "both" }> = [
  { label: "Calls", value: "calls" },
  { label: "Puts", value: "puts" },
  { label: "Calls + Puts", value: "both" }
];

const SECURITY_PRESETS: Array<{ label: string; value: "stocks" | "etfs" | "all" }> = [
  { label: "Stocks", value: "stocks" },
  { label: "ETFs", value: "etfs" },
  { label: "All", value: "all" }
];

const PREMIUM_PRESETS: Array<{ label: string; value: number | undefined }> = [
  { label: "All", value: undefined },
  { label: ">= 25K", value: 25_000 },
  { label: ">= 50K", value: 50_000 },
  { label: ">= 100K", value: 100_000 }
];

const useDismissableOptionsPopover = (
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void
) => {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open, rootRef]);
};

export const OptionsTapeHelp = () => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const helpId = useId();

  useDismissableOptionsPopover(open, rootRef, () => setOpen(false));

  return (
    <div className={`options-tape-help ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        aria-controls={open ? helpId : undefined}
        aria-expanded={open}
        aria-label="Options tape help"
        className="options-tape-help-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open ? (
        <div
          className="options-tape-help-panel"
          id={helpId}
          role="dialog"
          aria-label="Options tape help"
        >
          <strong>Smart-flow row treatment</strong>
          <p>
            Row color comes from canonical smart-flow support attached to a direct option print or a
            packet member. Abstained and unclear hypotheses stay as context and do not tint rows.
          </p>
          <p>
            Packet scope shows prints inside the matched packet. Contract scope shows the normalized
            option contract. QA can expose unavailable support states; product modules keep those
            diagnostics out of default columns.
          </p>
          <p>
            Use the tint, hover evidence, packet focus, and support state as triage cues before
            widening back to the full tape.
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const OptionsTapeSettings = ({
  filters,
  settings,
  onApplyFilters,
  onApplySettings
}: OptionsTapeSettingsProps) => {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [draftFilters, setDraftFilters] = useState<OptionFlowFilters>(() => filters);
  const [draftSettings, setDraftSettings] = useState<OptionsTapeSettingsState>(() =>
    normalizeOptionsTapeSettings(settings)
  );
  const sidePreset = getOptionsTapeSidePreset(draftFilters);
  const visibleColumnOrder = getVisibleOptionsTapeColumnOrder(draftSettings);
  const customPremium =
    typeof draftFilters.minNotional === "number" ? draftFilters.minNotional : "";
  const filtersChanged = optionFlowFilterKey(draftFilters) !== optionFlowFilterKey(filters);
  const settingsChanged =
    JSON.stringify(normalizeOptionsTapeSettings(draftSettings)) !==
    JSON.stringify(normalizeOptionsTapeSettings(settings));
  const applyDisabled = !filtersChanged && !settingsChanged;

  useDismissableOptionsPopover(open, rootRef, () => setOpen(false));

  useEffect(() => {
    if (!open) {
      setDraftFilters(filters);
      setDraftSettings(normalizeOptionsTapeSettings(settings));
    }
  }, [filters, open, settings]);

  const applyDrafts = () => {
    if (filtersChanged) {
      onApplyFilters(draftFilters);
    }
    if (settingsChanged) {
      onApplySettings(normalizeOptionsTapeSettings(draftSettings));
    }
  };

  const resetSettings = () => {
    const nextFilters = buildDefaultOptionsTapeFilters();
    const nextSettings = buildDefaultOptionsTapeSettings();
    setDraftFilters(nextFilters);
    setDraftSettings(nextSettings);
    onApplyFilters(nextFilters);
    onApplySettings(nextSettings);
  };

  return (
    <div className={`options-tape-settings ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        aria-controls={open ? dialogId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="options-tape-gear"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        Settings
      </button>
      {open ? (
        <div
          className="options-tape-settings-panel"
          id={dialogId}
          role="dialog"
          aria-label="Options tape filters"
        >
          <div className="options-tape-settings-head">
            <div>
              <strong>Options Settings</strong>
              <p>Filter changes reload the tape after apply.</p>
            </div>
            <div className="options-tape-settings-actions">
              <button className="terminal-button" type="button" onClick={resetSettings}>
                Reset
              </button>
              <button
                className={`terminal-button ${filtersChanged ? "is-active" : ""}`.trim()}
                disabled={applyDisabled}
                type="button"
                onClick={applyDrafts}
              >
                Apply refresh
              </button>
            </div>
          </div>
          <section>
            <span>Smart-flow</span>
            <label className="options-tape-toggle">
              <input
                type="checkbox"
                checked={draftSettings.smartFlowOnly}
                onChange={(event) =>
                  setDraftSettings((current) =>
                    reduceOptionsTapeSettings(current, {
                      type: "set-smart-flow-only",
                      value: event.target.checked
                    })
                  )
                }
              />
              <strong>Smart-flow rows only</strong>
            </label>
          </section>
          <section>
            <span>View</span>
            <div className="options-tape-chip-row">
              {VIEW_PRESETS.map((preset) => (
                <button
                  className={draftFilters.view === preset.value ? "is-active" : ""}
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setDraftFilters((current) => applyOptionsTapeView(current, preset.value))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Side</span>
            <div className="options-tape-chip-row options-tape-chip-row-wide">
              {SIDE_PRESETS.map((preset) => (
                <button
                  className={sidePreset === preset.value ? "is-active" : ""}
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setDraftFilters((current) => applyOptionsTapeSidePreset(current, preset.value))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Type</span>
            <div className="options-tape-chip-row">
              {TYPE_PRESETS.map((preset) => (
                <button
                  className={
                    (preset.value === "calls" && draftFilters.optionTypes?.join() === "call") ||
                    (preset.value === "puts" && draftFilters.optionTypes?.join() === "put") ||
                    (preset.value === "both" && (draftFilters.optionTypes?.length ?? 0) !== 1)
                      ? "is-active"
                      : ""
                  }
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setDraftFilters((current) => applyOptionsTapeTypePreset(current, preset.value))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Security</span>
            <div className="options-tape-chip-row">
              {SECURITY_PRESETS.map((preset) => (
                <button
                  className={
                    (preset.value === "stocks" && draftFilters.securityTypes?.join() === "stock") ||
                    (preset.value === "etfs" && draftFilters.securityTypes?.join() === "etf") ||
                    (preset.value === "all" && (draftFilters.securityTypes?.length ?? 0) !== 1)
                      ? "is-active"
                      : ""
                  }
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setDraftFilters((current) =>
                      applyOptionsTapeSecurityPreset(current, preset.value)
                    )
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Premium</span>
            <div className="options-tape-chip-row">
              {PREMIUM_PRESETS.map((preset) => (
                <button
                  className={draftFilters.minNotional === preset.value ? "is-active" : ""}
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    setDraftFilters((current) => ({ ...current, minNotional: preset.value }))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="options-tape-custom-premium">
              <span>Custom</span>
              <input
                inputMode="numeric"
                min={0}
                type="number"
                value={customPremium}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraftFilters((current) => ({
                    ...current,
                    minNotional: Number.isFinite(value) && value > 0 ? value : undefined
                  }));
                }}
              />
            </label>
          </section>
          <section>
            <span>Columns</span>
            <div className="options-tape-column-controls">
              {draftSettings.columnOrder.map((columnId, index) => {
                const visible = visibleColumnOrder.includes(columnId);
                return (
                  <div className="options-tape-column-control" key={columnId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={
                          (columnId === "info" && visible) ||
                          (visible && visibleColumnOrder.length === 1)
                        }
                        onChange={(event) =>
                          setDraftSettings((current) =>
                            reduceOptionsTapeSettings(current, {
                              type: "toggle-column",
                              id: columnId,
                              visible: event.target.checked
                            })
                          )
                        }
                      />
                      <span>{columnId}</span>
                    </label>
                    <div>
                      <button
                        aria-label={`Move ${columnId} column earlier`}
                        disabled={index === 0}
                        type="button"
                        onClick={() =>
                          setDraftSettings((current) =>
                            reduceOptionsTapeSettings(current, {
                              type: "move-column",
                              id: columnId,
                              direction: "up"
                            })
                          )
                        }
                      >
                        Up
                      </button>
                      <button
                        aria-label={`Move ${columnId} column later`}
                        disabled={index === draftSettings.columnOrder.length - 1}
                        type="button"
                        onClick={() =>
                          setDraftSettings((current) =>
                            reduceOptionsTapeSettings(current, {
                              type: "move-column",
                              id: columnId,
                              direction: "down"
                            })
                          )
                        }
                      >
                        Down
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
