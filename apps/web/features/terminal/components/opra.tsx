"use client";

import {
  getSubscriptionKey as getLiveSubscriptionKey,
  parseOptionContractId
} from "@islandflow/types";
import { type CSSProperties, memo, type MouseEvent as ReactMouseEvent } from "react";

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
  formatFlowMetric,
  formatPct,
  formatPrice,
  formatSize,
  formatTime,
  formatUsd,
  humanizeClassifierId,
  parseNumber
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
  const items = limit ? state.filteredFlow.slice(0, limit) : state.filteredFlow;
  const virtual = useTapeVirtualList(items, state.flowScroll.listRef, getTapeVirtualConfig("flow"));
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("flow")
  );

  return (
    <Pane
      className={className}
      title={title}
      status={
        <TapeStatus
          status={state.flow.status}
          lastUpdate={state.flow.lastUpdate}
          replayTime={state.flow.replayTime}
          replayComplete={state.flow.replayComplete}
          paused={state.flow.paused}
          dropped={state.flow.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.flow.paused}
          onTogglePause={state.flow.togglePause}
          isAtTop={state.flowScroll.isAtTop}
          missed={state.flowScroll.missed}
          onJump={state.flowScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No flow packets match the current filter."
              : state.mode === "live"
                ? state.flow.status === "stale"
                  ? "Feed behind. Waiting for fresh flow packets."
                  : "No flow packets yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-flow" role="table" aria-label="Flow packets">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">CONTRACT</span>
                <span className="data-table-cell">PRINTS</span>
                <span className="data-table-cell">SIZE</span>
                <span className="data-table-cell">NOTIONAL</span>
                <span className="data-table-cell">WINDOW</span>
                <span className="data-table-cell">STRUCTURE</span>
                <span className="data-table-cell">NBBO</span>
                <span className="data-table-cell">QUALITY</span>
              </div>
              <div className="data-table-scroll" ref={state.flowScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {virtual.virtualItems.map(({ item: packet, key, index, start, size }) => {
                    const features = packet.features ?? {};
                    const contract = String(features.option_contract_id ?? packet.id ?? "unknown");
                    const count = parseNumber(features.count, packet.members.length);
                    const totalSize = parseNumber(features.total_size, 0);
                    const totalNotional = parseNumber(features.total_notional, Number.NaN);
                    const notional = Number.isFinite(totalNotional)
                      ? totalNotional
                      : parseNumber(features.total_premium, 0) * 100;
                    const startTs = parseNumber(features.start_ts, packet.source_ts);
                    const endTs = parseNumber(features.end_ts, startTs);
                    const windowMs = parseNumber(features.window_ms, 0);
                    const structureType =
                      typeof features.structure_type === "string" ? features.structure_type : "";
                    const structureLegs = parseNumber(features.structure_legs, 0);
                    const structureRights =
                      typeof features.structure_rights === "string"
                        ? features.structure_rights
                        : "";
                    const structureStrikes = parseNumber(features.structure_strikes, 0);
                    const nbboBid = parseNumber(features.nbbo_bid, Number.NaN);
                    const nbboAsk = parseNumber(features.nbbo_ask, Number.NaN);
                    const nbboMid = parseNumber(features.nbbo_mid, Number.NaN);
                    const nbboSpread = parseNumber(features.nbbo_spread, Number.NaN);
                    const aggressiveBuyRatio = parseNumber(
                      features.nbbo_aggressive_buy_ratio,
                      Number.NaN
                    );
                    const aggressiveSellRatio = parseNumber(
                      features.nbbo_aggressive_sell_ratio,
                      Number.NaN
                    );
                    const aggressiveCoverage = parseNumber(
                      features.nbbo_coverage_ratio,
                      Number.NaN
                    );
                    const insideRatio = parseNumber(features.nbbo_inside_ratio, Number.NaN);
                    const nbboAge = parseNumber(packet.join_quality.nbbo_age_ms, Number.NaN);
                    const nbboStale = parseNumber(packet.join_quality.nbbo_stale, 0) > 0;
                    const nbboMissing = parseNumber(packet.join_quality.nbbo_missing, 0) > 0;
                    const structureLabel = structureType
                      ? `${structureType.replace(/_/g, " ")}${structureRights ? ` ${structureRights}` : ""}${structureLegs > 0 ? ` ${structureLegs}L` : ""}${structureStrikes > 0 ? ` ${structureStrikes}K` : ""}`
                      : "--";
                    const nbboLabel =
                      Number.isFinite(nbboBid) && Number.isFinite(nbboAsk)
                        ? `${formatPrice(nbboBid)} x ${formatPrice(nbboAsk)}`
                        : Number.isFinite(nbboMid)
                          ? `Mid ${formatPrice(nbboMid)}`
                          : "--";
                    const qualityLabel = [
                      Number.isFinite(aggressiveCoverage) && aggressiveCoverage > 0
                        ? `Agg ${formatPct(aggressiveBuyRatio)}/${formatPct(aggressiveSellRatio)} ${formatPct(aggressiveCoverage)} cov`
                        : null,
                      Number.isFinite(insideRatio) && insideRatio > 0
                        ? `In ${formatPct(insideRatio)}`
                        : null,
                      Number.isFinite(nbboSpread) ? `Spr ${formatPrice(nbboSpread)}` : null,
                      Number.isFinite(nbboAge) ? `${Math.round(nbboAge)}ms` : null,
                      nbboStale ? "Stale" : null,
                      nbboMissing ? "Missing" : null
                    ]
                      .filter(Boolean)
                      .join(" | ");

                    return (
                      <div
                        className={`data-table-row data-table-row-flow data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}${nbboStale || nbboMissing ? " data-table-row-warn" : ""}`}
                        key={key}
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatTime(startTs)} → {formatTime(endTs)}
                        </span>
                        <span className="data-table-cell">{contract}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatFlowMetric(count)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatFlowMetric(totalSize)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          ${formatUsd(notional)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {windowMs > 0 ? formatFlowMetric(windowMs, "ms") : "--"}
                        </span>
                        <span className="data-table-cell">{structureLabel}</span>
                        <span className="data-table-cell data-table-cell-number">{nbboLabel}</span>
                        <span className="data-table-cell">{qualityLabel || "--"}</span>
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
