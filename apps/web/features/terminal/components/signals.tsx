"use client";

import type {
  AlertEvent,
  ClassifierHitEvent,
  SmartFlowExplainabilityProjection,
  SmartMoneyEvent
} from "@islandflow/types";
import { memo } from "react";

import { getTapeVirtualConfig } from "../config";
import {
  deriveAlertDirection,
  getAlertWindowAnchorTs,
  normalizeAlertSeverity,
  smartFlowDirectionLabel,
  smartFlowDirectionTone,
  smartFlowEvidenceQualityLabel,
  smartFlowHypothesisLabel,
  smartFlowWhyNotLabel,
  smartMoneyProfileLabel
} from "../format";
import type { TerminalState } from "../state";
import { inferDarkUnderlying } from "../state-helpers";
import { useTapeVirtualList, useVirtualHistoryGate } from "../scroll";
import { Pane, TapeControls, TapeStatus } from "./primitives";
import {
  formatConfidence,
  formatFlowMetric,
  formatTime,
  humanizeClassifierId,
  normalizeDirection
} from "./ui-helpers";

type AlertSeverityStripProps = {
  alerts: AlertEvent[];
};

export const AlertSeverityStrip = ({ alerts }: AlertSeverityStripProps) => {
  const windowMs = 30 * 60 * 1000;
  const windowAnchor = getAlertWindowAnchorTs(alerts);
  const severityCounts = alerts.reduce(
    (acc, alert) => {
      if (windowAnchor - alert.source_ts > windowMs) {
        return acc;
      }
      const severity = normalizeAlertSeverity(alert);
      if (severity === "high") {
        acc.high += 1;
      } else if (severity === "medium") {
        acc.medium += 1;
      } else {
        acc.low += 1;
      }
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );

  const directionCounts = alerts.reduce(
    (acc, alert) => {
      if (windowAnchor - alert.source_ts > windowMs) {
        return acc;
      }
      const direction = deriveAlertDirection(alert);
      acc[direction] += 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );

  const severityTotal = severityCounts.high + severityCounts.medium + severityCounts.low;
  const highPct = severityTotal > 0 ? (severityCounts.high / severityTotal) * 100 : 0;
  const mediumPct = severityTotal > 0 ? (severityCounts.medium / severityTotal) * 100 : 0;
  const lowPct = severityTotal > 0 ? (severityCounts.low / severityTotal) * 100 : 0;

  const directionTotal =
    directionCounts.bullish + directionCounts.bearish + directionCounts.neutral;
  const bullishPct = directionTotal > 0 ? (directionCounts.bullish / directionTotal) * 100 : 0;
  const bearishPct = directionTotal > 0 ? (directionCounts.bearish / directionTotal) * 100 : 0;
  const neutralPct = directionTotal > 0 ? (directionCounts.neutral / directionTotal) * 100 : 0;

  return (
    <div className="alert-strips">
      <div className="alert-strip-section">
        <div className="alert-strip-header">
          <span>Severity (last 30m)</span>
          <span>{severityTotal} alerts</span>
        </div>
        <div className="alert-strip-bar">
          <div className="strip-segment severity-high" style={{ width: `${highPct}%` }}>
            {severityCounts.high > 0 ? `High ${severityCounts.high}` : ""}
          </div>
          <div className="strip-segment severity-medium" style={{ width: `${mediumPct}%` }}>
            {severityCounts.medium > 0 ? `Med ${severityCounts.medium}` : ""}
          </div>
          <div className="strip-segment severity-low" style={{ width: `${lowPct}%` }}>
            {severityCounts.low > 0 ? `Low ${severityCounts.low}` : ""}
          </div>
        </div>
      </div>
      <div className="alert-strip-section">
        <div className="alert-strip-header">
          <span>Direction (last 30m)</span>
          <span>{directionTotal} alerts</span>
        </div>
        <div className="alert-strip-bar">
          <div className="strip-segment direction-bullish" style={{ width: `${bullishPct}%` }}>
            {directionCounts.bullish > 0 ? `Bull ${directionCounts.bullish}` : ""}
          </div>
          <div className="strip-segment direction-bearish" style={{ width: `${bearishPct}%` }}>
            {directionCounts.bearish > 0 ? `Bear ${directionCounts.bearish}` : ""}
          </div>
          <div className="strip-segment direction-neutral" style={{ width: `${neutralPct}%` }}>
            {directionCounts.neutral > 0 ? `Neut ${directionCounts.neutral}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

type AlertsPaneProps = {
  state: TerminalState;
  limit?: number;
  withStrip?: boolean;
  className?: string;
};

export const AlertsPane = memo(
  ({ state, limit, withStrip = false, className }: AlertsPaneProps) => {
    const items = limit ? state.filteredAlerts.slice(0, limit) : state.filteredAlerts;
    const virtual = useTapeVirtualList(
      items,
      state.alertsScroll.listRef,
      getTapeVirtualConfig("alerts")
    );
    useVirtualHistoryGate(
      state.mode === "live" && !limit,
      items.length,
      virtual.virtualItems.at(-1)?.index ?? -1,
      () => void state.liveSession.loadOlder("alerts")
    );

    return (
      <Pane
        className={className}
        title="Alerts"
        status={
          <TapeStatus
            status={state.alerts.status}
            lastUpdate={state.alerts.lastUpdate}
            replayTime={state.alerts.replayTime}
            replayComplete={state.alerts.replayComplete}
            paused={state.alerts.paused}
            dropped={state.alerts.dropped}
            mode={state.mode}
          />
        }
        actions={
          <TapeControls
            mode={state.mode}
            paused={state.alerts.paused}
            onTogglePause={state.alerts.togglePause}
            isAtTop={state.alertsScroll.isAtTop}
            missed={state.alertsScroll.missed}
            onJump={state.alertsScroll.jumpToTop}
          />
        }
      >
        {withStrip ? <AlertSeverityStrip alerts={state.filteredAlerts} /> : null}
        <div className="data-table-shell">
          {items.length === 0 ? (
            <div className="empty">
              {state.tickerSet.size > 0
                ? "No alerts match the current filter."
                : state.mode === "live"
                  ? "No alerts yet. Start compute."
                  : "Replay queue empty. Ensure ClickHouse has data."}
            </div>
          ) : (
            <div className="data-table-wrap">
              <div className="data-table data-table-alerts" role="table" aria-label="Alerts">
                <div className="data-table-head" role="row">
                  <span className="data-table-cell">TIME</span>
                  <span className="data-table-cell">ALERT</span>
                  <span className="data-table-cell">SEV</span>
                  <span className="data-table-cell">SCORE</span>
                  <span className="data-table-cell">HITS</span>
                  <span className="data-table-cell">DIR</span>
                  <span className="data-table-cell">NOTE</span>
                </div>
                <div className="data-table-scroll" ref={state.alertsScroll.setListRef}>
                  <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                    {virtual.virtualItems.map(({ item: alert, key, index, start, size }) => {
                      const primary = alert.hits[0];
                      const direction = deriveAlertDirection(alert);
                      const severity = normalizeAlertSeverity(alert);

                      return (
                        <button
                          className={`data-table-row data-table-row-button data-table-row-alerts data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-severity-${severity}`}
                          key={key}
                          type="button"
                          data-index={index}
                          data-row-start={String(start)}
                          data-row-size={String(size)}
                          data-tape-key={key}
                          style={{ transform: `translateY(${start}px)` }}
                          onClick={() => {
                            state.setSelectedNewsStory(null);
                            state.setSelectedDarkEvent(null);
                            state.setSelectedClassifierHit(null);
                            state.setSelectedSmartFlowProjection(null);
                            state.setSelectedSmartMoneyEvent(null);
                            state.setSelectedAlert(alert);
                          }}
                        >
                          <span className="data-table-cell data-table-cell-number">
                            {formatTime(alert.source_ts)}
                          </span>
                          <span className="data-table-cell">
                            {primary ? humanizeClassifierId(primary.classifier_id) : "Alert"}
                          </span>
                          <span className="data-table-cell">{severity}</span>
                          <span className="data-table-cell data-table-cell-number">
                            {Math.round(alert.score)}
                          </span>
                          <span className="data-table-cell data-table-cell-number">
                            {alert.hits.length}
                          </span>
                          <span className="data-table-cell">{direction}</span>
                          <span className="data-table-cell">
                            {primary?.explanations?.[0] ?? "--"}
                          </span>
                        </button>
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

type ClassifierPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

export const ClassifierPane = memo(({ state, limit, className }: ClassifierPaneProps) => {
  const smartFlowItems = limit
    ? state.filteredSmartFlowProjections.slice(0, limit)
    : state.filteredSmartFlowProjections;
  const legacySmartMoneyItems =
    smartFlowItems.length === 0
      ? limit
        ? state.filteredSmartMoneyEvents.slice(0, limit)
        : state.filteredSmartMoneyEvents
      : [];
  const legacyItems =
    smartFlowItems.length === 0 && legacySmartMoneyItems.length === 0
      ? limit
        ? state.filteredClassifierHits.slice(0, limit)
        : state.filteredClassifierHits
      : [];
  const items: Array<SmartFlowExplainabilityProjection | SmartMoneyEvent | ClassifierHitEvent> =
    smartFlowItems.length > 0
      ? smartFlowItems
      : legacySmartMoneyItems.length > 0
        ? legacySmartMoneyItems
        : legacyItems;
  const virtual = useTapeVirtualList(
    items,
    state.classifierScroll.listRef,
    getTapeVirtualConfig("classifier")
  );
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => {
      void state.liveSession.loadOlder("smart-flow");
      void state.liveSession.loadOlder("smart-money");
      void state.liveSession.loadOlder("classifier-hits");
    }
  );
  const showingSmartFlow = smartFlowItems.length > 0;
  const showingSmartMoney = !showingSmartFlow && legacySmartMoneyItems.length > 0;

  return (
    <Pane
      className={className}
      title="Flow Hypotheses"
      status={
        <TapeStatus
          status={state.smartFlow.status}
          lastUpdate={
            state.smartFlow.lastUpdate ??
            state.smartMoney.lastUpdate ??
            state.classifierHits.lastUpdate
          }
          replayTime={
            state.smartFlow.replayTime ??
            state.smartMoney.replayTime ??
            state.classifierHits.replayTime
          }
          replayComplete={
            state.smartFlow.replayComplete ||
            state.smartMoney.replayComplete ||
            state.classifierHits.replayComplete
          }
          paused={state.smartFlow.paused}
          dropped={state.smartFlow.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.smartFlow.paused}
          onTogglePause={state.smartFlow.togglePause}
          isAtTop={state.classifierScroll.isAtTop}
          missed={state.classifierScroll.missed}
          onJump={state.classifierScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No smart-flow hypotheses match the current filter."
              : state.mode === "live"
                ? "No smart-flow hypotheses yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div
              className={`data-table ${
                showingSmartFlow ? "data-table-smart-flow" : "data-table-classifier"
              }`}
              role="table"
              aria-label={showingSmartFlow ? "Smart-flow hypotheses" : "Compatibility classifiers"}
            >
              {showingSmartFlow ? (
                <div className="data-table-head" role="row">
                  <span className="data-table-cell">TIME</span>
                  <span className="data-table-cell">HYPOTHESIS</span>
                  <span className="data-table-cell">DIR</span>
                  <span className="data-table-cell">CONF</span>
                  <span className="data-table-cell">CONV</span>
                  <span className="data-table-cell">EVIDENCE</span>
                  <span className="data-table-cell">WHY-NOT</span>
                </div>
              ) : (
                <div className="data-table-head" role="row">
                  <span className="data-table-cell">TIME</span>
                  <span className="data-table-cell">PROFILE</span>
                  <span className="data-table-cell">DIR</span>
                  <span className="data-table-cell">PROB</span>
                  <span className="data-table-cell">NOTE</span>
                </div>
              )}
              <div className="data-table-scroll" ref={state.classifierScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {showingSmartFlow
                    ? virtual.virtualItems.map(({ item, key, index, start, size }) => {
                        const projection = item as SmartFlowExplainabilityProjection;
                        const hypothesis = projection.hypothesis;
                        const scores = hypothesis.scores.confidence;
                        const direction = smartFlowDirectionLabel(projection);
                        const rowDirection = smartFlowDirectionTone(projection);
                        const evidenceQuality = smartFlowEvidenceQualityLabel(
                          projection.evidence.evidence_quality
                        );
                        return (
                          <button
                            className={`data-table-row data-table-row-button data-table-row-classifier data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-direction-${rowDirection}`}
                            key={key}
                            type="button"
                            data-index={index}
                            data-row-start={String(start)}
                            data-row-size={String(size)}
                            data-tape-key={key}
                            style={{ transform: `translateY(${start}px)` }}
                            onClick={() => state.openFromSmartFlowProjection(projection)}
                          >
                            <span className="data-table-cell data-table-cell-number">
                              {formatTime(projection.source_ts)}
                            </span>
                            <span className="data-table-cell">
                              {smartFlowHypothesisLabel(hypothesis.hypothesis_type)}
                            </span>
                            <span className="data-table-cell">{direction}</span>
                            <span className="data-table-cell data-table-cell-number">
                              {formatConfidence(scores.policy_confidence)}
                            </span>
                            <span className="data-table-cell data-table-cell-number">
                              {formatConfidence(scores.conviction)}
                            </span>
                            <span className="data-table-cell">
                              {evidenceQuality} /{" "}
                              {formatConfidence(projection.evidence.evidence_quality)}
                            </span>
                            <span className="data-table-cell">
                              {smartFlowWhyNotLabel(projection)}
                            </span>
                          </button>
                        );
                      })
                    : showingSmartMoney
                      ? virtual.virtualItems.map(({ item, key, index, start, size }) => {
                          const event = item as SmartMoneyEvent;
                          const primaryScore =
                            event.profile_scores.find(
                              (score) => score.profile_id === event.primary_profile_id
                            ) ?? event.profile_scores[0];
                          const direction = normalizeDirection(event.primary_direction);
                          return (
                            <button
                              className={`data-table-row data-table-row-button data-table-row-classifier data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-direction-${direction}`}
                              key={key}
                              type="button"
                              data-index={index}
                              data-row-start={String(start)}
                              data-row-size={String(size)}
                              data-tape-key={key}
                              style={{ transform: `translateY(${start}px)` }}
                              onClick={() => state.openFromSmartMoneyEvent(event)}
                            >
                              <span className="data-table-cell data-table-cell-number">
                                {formatTime(event.source_ts)}
                              </span>
                              <span className="data-table-cell">
                                {smartMoneyProfileLabel(event.primary_profile_id)}
                              </span>
                              <span className="data-table-cell">{direction}</span>
                              <span className="data-table-cell data-table-cell-number">
                                {primaryScore ? formatConfidence(primaryScore.probability) : "--"}
                              </span>
                              <span className="data-table-cell">
                                {event.abstained
                                  ? (event.suppressed_reasons[0] ?? "abstained")
                                  : (primaryScore?.reasons[0] ??
                                    primaryScore?.confidence_band ??
                                    "--")}
                              </span>
                            </button>
                          );
                        })
                      : virtual.virtualItems.map(({ item, key, index, start, size }) => {
                          const hit = item as ClassifierHitEvent;
                          const direction = normalizeDirection(hit.direction);
                          return (
                            <button
                              className={`data-table-row data-table-row-button data-table-row-classifier data-table-virtual-row${index % 2 === 1 ? " is-even" : ""} data-table-row-direction-${direction}`}
                              key={key}
                              type="button"
                              data-index={index}
                              data-row-start={String(start)}
                              data-row-size={String(size)}
                              data-tape-key={key}
                              style={{ transform: `translateY(${start}px)` }}
                              onClick={() => state.openFromClassifierHit(hit)}
                            >
                              <span className="data-table-cell data-table-cell-number">
                                {formatTime(hit.source_ts)}
                              </span>
                              <span className="data-table-cell">
                                {humanizeClassifierId(hit.classifier_id)}
                              </span>
                              <span className="data-table-cell">{direction}</span>
                              <span className="data-table-cell data-table-cell-number">
                                {formatConfidence(hit.confidence)}
                              </span>
                              <span className="data-table-cell">
                                {hit.explanations?.[0] ?? "--"}
                              </span>
                            </button>
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

type DarkPaneProps = {
  state: TerminalState;
  limit?: number;
  className?: string;
};

export const DarkPane = memo(({ state, limit, className }: DarkPaneProps) => {
  const items = limit ? state.filteredInferredDark.slice(0, limit) : state.filteredInferredDark;
  const virtual = useTapeVirtualList(items, state.darkScroll.listRef, getTapeVirtualConfig("dark"));
  useVirtualHistoryGate(
    state.mode === "live" && !limit,
    items.length,
    virtual.virtualItems.at(-1)?.index ?? -1,
    () => void state.liveSession.loadOlder("inferred-dark")
  );

  return (
    <Pane
      className={className}
      title="Dark"
      status={
        <TapeStatus
          status={state.inferredDark.status}
          lastUpdate={state.inferredDark.lastUpdate}
          replayTime={state.inferredDark.replayTime}
          replayComplete={state.inferredDark.replayComplete}
          paused={state.inferredDark.paused}
          dropped={state.inferredDark.dropped}
          mode={state.mode}
        />
      }
      actions={
        <TapeControls
          mode={state.mode}
          paused={state.inferredDark.paused}
          onTogglePause={state.inferredDark.togglePause}
          isAtTop={state.darkScroll.isAtTop}
          missed={state.darkScroll.missed}
          onJump={state.darkScroll.jumpToTop}
        />
      }
    >
      <div className="data-table-shell">
        {items.length === 0 ? (
          <div className="empty">
            {state.tickerSet.size > 0
              ? "No inferred dark events match the current filter."
              : state.mode === "live"
                ? "No inferred dark events yet. Start compute."
                : "Replay queue empty. Ensure ClickHouse has data."}
          </div>
        ) : (
          <div className="data-table-wrap">
            <div className="data-table data-table-dark" role="table" aria-label="Dark events">
              <div className="data-table-head" role="row">
                <span className="data-table-cell">TIME</span>
                <span className="data-table-cell">TYPE</span>
                <span className="data-table-cell">SYM</span>
                <span className="data-table-cell">CONF</span>
                <span className="data-table-cell">EVIDENCE</span>
                <span className="data-table-cell">NOTE</span>
              </div>
              <div className="data-table-scroll" ref={state.darkScroll.setListRef}>
                <div className="data-table-body" style={{ height: `${virtual.totalSize}px` }}>
                  {virtual.virtualItems.map(({ item: event, key, index, start, size }) => {
                    const underlying = inferDarkUnderlying(event, state.equityJoinMap);
                    const evidenceCount = event.evidence_refs.length;

                    return (
                      <button
                        className={`data-table-row data-table-row-button data-table-row-dark data-table-virtual-row${index % 2 === 1 ? " is-even" : ""}`}
                        key={key}
                        type="button"
                        data-index={index}
                        data-row-start={String(start)}
                        data-row-size={String(size)}
                        data-tape-key={key}
                        style={{ transform: `translateY(${start}px)` }}
                        onClick={() => {
                          state.setSelectedNewsStory(null);
                          state.setSelectedAlert(null);
                          state.setSelectedClassifierHit(null);
                          state.setSelectedSmartFlowProjection(null);
                          state.setSelectedSmartMoneyEvent(null);
                          state.setSelectedDarkEvent(event);
                        }}
                      >
                        <span className="data-table-cell data-table-cell-number">
                          {formatTime(event.source_ts)}
                        </span>
                        <span className="data-table-cell">{humanizeClassifierId(event.type)}</span>
                        <span className="data-table-cell">{underlying ?? "Unknown"}</span>
                        <span className="data-table-cell data-table-cell-number">
                          {formatConfidence(event.confidence)}
                        </span>
                        <span className="data-table-cell data-table-cell-number">
                          {evidenceCount}
                        </span>
                        <span className="data-table-cell">
                          {underlying ? "--" : "Underlying not in current join cache."}
                        </span>
                      </button>
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
