"use client";

import {
  getSubscriptionKey as getLiveSubscriptionKey,
  parseOptionContractId
} from "@islandflow/types";
import { type CSSProperties, memo, type MouseEvent as ReactMouseEvent, useMemo } from "react";

import { FlowPacketsTape } from "../../flow-packets";
import { getTapeVirtualConfig } from "../config";
import { countActiveFlowFilterGroups } from "../filters";
import { formatCompactUsd, formatOptionContractLabel } from "../format";
import type { TerminalState } from "../state";
import { normalizeContractId } from "../state-helpers";
import { useTapeVirtualList, useVirtualHistoryGate } from "../scroll";
import { Pane, TapeControls, TapeStatus, FlowFilterPopover } from "./primitives";
import {
  classifyNbboSide,
  formatContractLabel,
  formatPct,
  formatPrice,
  formatSize,
  formatTime,
  humanizeClassifierId
} from "./ui-helpers";

type OptionsPaneProps = {
  state: TerminalState;
  limit?: number;
  title?: string;
  className?: string;
};

export const OptionsPane = memo(
  ({ state, limit, title = "Options", className }: OptionsPaneProps) => {
    const items = limit ? state.filteredOptions.slice(0, limit) : state.filteredOptions;
    const virtual = useTapeVirtualList(
      items,
      state.optionsScroll.listRef,
      getTapeVirtualConfig("options")
    );
    const optionHistorySubscription = state.liveSession.manifest.find(
      (subscription) => subscription.channel === "options"
    );
    const optionHistoryKey = optionHistorySubscription
      ? getLiveSubscriptionKey(optionHistorySubscription)
      : null;
    const optionHistoryError = optionHistoryKey
      ? state.liveSession.historyErrors[optionHistoryKey]
      : null;
    useVirtualHistoryGate(
      state.mode === "live" && !limit,
      items.length,
      virtual.virtualItems.at(-1)?.index ?? -1,
      () => void state.liveSession.loadOlder("options")
    );

    return (
      <Pane
        className={className}
        title={title}
        status={
          <TapeStatus
            status={state.options.status}
            lastUpdate={state.options.lastUpdate}
            replayTime={state.options.replayTime}
            replayComplete={state.options.replayComplete}
            paused={state.options.paused}
            dropped={state.options.dropped}
            mode={state.mode}
          />
        }
        actions={
          <TapeControls
            mode={state.mode}
            paused={state.options.paused}
            onTogglePause={state.options.togglePause}
            isAtTop={state.optionsScroll.isAtTop}
            missed={state.optionsScroll.missed}
            onJump={state.optionsScroll.jumpToTop}
          />
        }
      >
        <div className="data-table-shell">
          {state.mode === "live" && optionHistoryError ? (
            <div className="history-load-warning" role="status">
              Older option history failed to load: {optionHistoryError}
            </div>
          ) : null}
          {items.length === 0 ? (
            <div className="empty">
              {state.mode === "live"
                ? state.options.status === "stale"
                  ? "Feed behind. Waiting for fresh option prints."
                  : state.optionsScopedQuiet
                    ? "No recent option prints for this scope yet."
                    : state.tickerSet.size > 0
                      ? "No option prints match the current filter."
                      : "No option prints yet. Start ingest-options."
                : state.tickerSet.size > 0
                  ? "No option prints match the current filter."
                  : "Replay queue empty. Ensure ClickHouse has data."}
            </div>
          ) : (
            <div className="data-table-wrap">
              <div className="data-table data-table-options" role="table" aria-label="Options tape">
                <div className="data-table-head" role="row">
                  <span className="data-table-cell">TIME</span>
                  <span className="data-table-cell">SYM</span>
                  <span className="data-table-cell">EXP</span>
                  <span className="data-table-cell">STRIKE</span>
                  <span className="data-table-cell">C/P</span>
                  <span className="data-table-cell">SPOT</span>
                  <span className="data-table-cell">DETAILS</span>
                  <span className="data-table-cell">TYPE</span>
                  <span className="data-table-cell">VALUE</span>
                  <span className="data-table-cell">SIDE</span>
                  <span className="data-table-cell">IV</span>
                  <span className="data-table-cell">CLASSIFIER</span>
                </div>
                <div className="data-table-scroll" ref={state.optionsScroll.setListRef}>
                  <div
                    className="data-table-body"
                    style={{ height: `${virtual.totalSize}px` }}
                    aria-hidden={virtual.virtualItems.length === 0}
                  >
                    {virtual.virtualItems.map(({ item: print, key, index, start, size }) => {
                      const contractId = normalizeContractId(print.option_contract_id);
                      const parsed = parseOptionContractId(contractId);
                      const contractDisplay = formatOptionContractLabel(contractId);
                      const quote =
                        state.historicalNbboByTraceId.get(print.trace_id) ??
                        state.nbboMap.get(contractId);
                      const hasPreservedNbbo = typeof print.execution_nbbo_side === "string";
                      const nbboSide =
                        print.execution_nbbo_side ??
                        print.nbbo_side ??
                        (!hasPreservedNbbo ? classifyNbboSide(print.price, quote) : null);
                      const notional = print.notional ?? print.price * print.size * 100;
                      const spot = print.execution_underlying_spot;
                      const iv = print.execution_iv;
                      const decor = state.classifierDecorByOptionTraceId.get(print.trace_id);
                      const focusContract = (event: ReactMouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        state.focusOptionContract(print);
                      };
                      const rowStyle = {
                        ...(decor
                          ? ({ "--classifier-intensity": decor.intensity } as CSSProperties)
                          : undefined),
                        transform: `translateY(${start}px)`
                      } as CSSProperties;
                      const commonProps = {
                        className: `data-table-row data-table-row-button data-table-row-classified data-table-row-options data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}${decor ? ` is-classified classifier-${decor.tone}` : ""}`,
                        style: rowStyle,
                        "data-index": index,
                        "data-row-start": String(start),
                        "data-row-size": String(size),
                        "data-tape-key": key
                      };
                      const cells = (
                        <>
                          <span className="data-table-cell data-table-cell-number">
                            {formatTime(print.ts)}
                          </span>
                          <span className="data-table-cell">
                            <button
                              className="instrument-cell-button"
                              type="button"
                              onClick={focusContract}
                            >
                              {contractDisplay?.ticker ??
                                parsed?.root ??
                                formatContractLabel(contractId)}
                            </button>
                          </span>
                          <span className="data-table-cell">
                            <button
                              className="instrument-cell-button"
                              type="button"
                              onClick={focusContract}
                            >
                              {contractDisplay?.expiration ?? parsed?.expiry ?? "--"}
                            </button>
                          </span>
                          <span className="data-table-cell data-table-cell-number">
                            <button
                              className="instrument-cell-button"
                              type="button"
                              onClick={focusContract}
                            >
                              {contractDisplay?.strike.replace(/[CP]$/, "") ?? "--"}
                            </button>
                          </span>
                          <span className="data-table-cell">
                            <button
                              className="instrument-cell-button"
                              type="button"
                              onClick={focusContract}
                            >
                              {parsed?.right ?? contractDisplay?.strike.slice(-1) ?? "--"}
                            </button>
                          </span>
                          <span className="data-table-cell data-table-cell-number">
                            {typeof spot === "number" ? formatPrice(spot) : "--"}
                          </span>
                          <span className="data-table-cell data-table-cell-number">
                            {formatSize(print.size)}@{formatPrice(print.price)}_{nbboSide ?? "--"}
                          </span>
                          <span className="data-table-cell">{print.option_type ?? "--"}</span>
                          <span className="data-table-cell data-table-cell-number notional-emphasis">
                            ${formatCompactUsd(notional)}
                          </span>
                          <span className="data-table-cell">
                            {nbboSide ? (
                              <span className={`nbbo-tag nbbo-tag-${nbboSide.toLowerCase()}`}>
                                {nbboSide}
                              </span>
                            ) : (
                              "--"
                            )}
                          </span>
                          <span className="data-table-cell data-table-cell-number">
                            {typeof iv === "number" ? formatPct(iv) : "--"}
                          </span>
                          <span className="data-table-cell">
                            {decor ? humanizeClassifierId(decor.family) : "--"}
                          </span>
                        </>
                      );

                      return decor ? (
                        <div
                          {...commonProps}
                          key={key}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            decor.smartMoney
                              ? state.openFromSmartMoneyEvent(decor.smartMoney)
                              : decor.hit
                                ? state.openFromClassifierHit(decor.hit)
                                : undefined
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              if (decor.smartMoney) {
                                state.openFromSmartMoneyEvent(decor.smartMoney);
                              } else if (decor.hit) {
                                state.openFromClassifierHit(decor.hit);
                              }
                            }
                          }}
                        >
                          {cells}
                        </div>
                      ) : (
                        <div {...commonProps} key={key}>
                          {cells}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Pane>
    );
  }
);

type FlowPaneProps = {
  state: TerminalState;
  limit?: number;
  title?: string;
  className?: string;
};

export const FlowPane = memo(({ state, limit, title = "Flow", className }: FlowPaneProps) => {
  const optionContractId =
    state.selectedInstrument?.kind === "option-contract"
      ? state.selectedInstrument.contractId
      : null;
  const scope = useMemo(
    () => ({
      tickers: state.activeTickers,
      optionContractId
    }),
    [optionContractId, state.activeTickers]
  );
  const sourceOptions = useMemo(
    () => ({ live: state.mode === "live", snapshotLimit: limit ?? undefined }),
    [limit, state.mode]
  );

  return (
    <FlowPacketsTape
      className={className}
      filters={state.flowFilters}
      rowHeight={limit ? 40 : 44}
      scope={scope}
      sourceOptions={sourceOptions}
      template={limit ? "twoThirds" : "auto"}
      title={title}
    />
  );
});

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
