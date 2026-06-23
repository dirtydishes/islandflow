"use client";

import { countActiveFlowFilterGroups } from "../filters";
import type { TerminalState } from "../state";
import { FlowFilterPopover } from "./primitives";
import { formatTime } from "./ui-helpers";

export const OpraIntakeRail = ({ state }: { state: TerminalState }) => {
  const contractActive = state.selectedInstrument?.kind === "option-contract";
  const contractLabel = contractActive
    ? (state.selectedInstrumentLabel ?? "Contract focus")
    : "No contract focus";
  const filterCount = countActiveFlowFilterGroups(state.flowFilters);

  return (
    <section className="opra-command-rail" aria-label="OPRA intake controls">
      <div className="opra-command-cell">
        <span>Mode</span>
        <strong>{state.mode === "live" ? "OPRA Live" : "Replay"}</strong>
        <em>{state.options.lastUpdate ? formatTime(state.options.lastUpdate) : "waiting"}</em>
      </div>
      <div className="opra-command-cell">
        <span>Scope</span>
        <strong>
          {state.activeTickers.length > 0 ? state.activeTickers.join(", ") : "All symbols"}
        </strong>
        <em>{state.filteredOptions.length} prints visible</em>
      </div>
      <div className="opra-command-cell">
        <span>Contract</span>
        <strong>{contractLabel}</strong>
        <em>{contractActive ? "click clear to release" : "select any option row"}</em>
      </div>
      <div className="opra-command-cell">
        <span>Flow Filters</span>
        <strong>{filterCount > 0 ? `${filterCount} active` : "baseline"}</strong>
        <em>{state.flowFilters.view === "raw" ? "all prints" : "signal view"}</em>
      </div>
      <div className="opra-command-actions">
        <button
          className={`terminal-button contract-filter-button${contractActive ? " is-active" : ""}`}
          type="button"
          disabled={!contractActive}
          onClick={() => state.setSelectedInstrument(null)}
          title={
            contractActive ? "Clear active contract filter" : "Focus a contract in the OPRA tape"
          }
        >
          <span className="contract-filter-button-label">
            {contractActive ? "Clear Contract" : "Contract Focus"}
          </span>
        </button>
        <FlowFilterPopover filters={state.flowFilters} onChange={state.setFlowFilters} />
      </div>
    </section>
  );
};
