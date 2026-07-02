"use client";

import { formatIntervalLabel } from "../market-chart";
import { FlowFilterPopover, TapeStatus } from "../terminal/components/primitives";
import { normalizeTickerFilterInput, TICKER_FILTER_INPUT_MAX_LENGTH } from "../terminal/filters";
import { statusLabel } from "../terminal/format";
import type { TerminalState } from "../terminal/state";
import { formatEasternTime } from "../time-format";

const formatTime = (ts: number | null | undefined): string =>
  ts ? formatEasternTime(ts, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "waiting";

const getReplayTime = (state: TerminalState): number | null =>
  state.options.replayTime ??
  state.equities.replayTime ??
  state.flow.replayTime ??
  state.alerts.replayTime ??
  state.inferredDark.replayTime;

const getReplayComplete = (state: TerminalState): boolean =>
  state.options.replayComplete ||
  state.equities.replayComplete ||
  state.flow.replayComplete ||
  state.alerts.replayComplete ||
  state.inferredDark.replayComplete;

const getQueuedCount = (state: TerminalState): number =>
  state.options.dropped +
  state.equities.dropped +
  state.flow.dropped +
  state.alerts.dropped +
  state.news.dropped;

const getFocusLabel = (state: TerminalState): string => {
  if (state.selectedInstrumentLabel) {
    return state.selectedInstrumentLabel;
  }
  if (state.activeTickers.length > 0) {
    return state.activeTickers.join(", ");
  }
  return "All symbols";
};

const HealthRow = ({
  label,
  status,
  subscribed,
  lastUpdate,
  dropped,
  mode
}: {
  label: string;
  status: TerminalState["options"]["status"];
  subscribed: boolean;
  lastUpdate: number | null;
  dropped: number;
  mode: TerminalState["mode"];
}) => (
  <div className="market-command-health-row">
    <span>{label}</span>
    <span className={`command-health-status command-health-${status}`}>
      {subscribed ? statusLabel(status, false, mode) : "Idle"}
    </span>
    <span>{formatTime(lastUpdate)}</span>
    <span>{dropped > 0 ? `${dropped} queued` : "Clear"}</span>
  </div>
);

export const MarketCommandChrome = ({ state }: { state: TerminalState }) => {
  const replayTime = getReplayTime(state);
  const focusLabel = getFocusLabel(state);
  const replaySource = state.replaySource
    ? state.replaySource.toUpperCase()
    : state.mode === "live"
      ? "LIVE HEAD"
      : "AUTO";
  const connectionLabel =
    state.mode === "live" ? statusLabel(state.liveSession.status, false, state.mode) : "Replay";
  const healthRows = [
    { label: "Options", tape: state.options, subscribed: state.routeFeatures.options },
    {
      label: "Durable",
      tape: state.durableRows,
      subscribed: state.routeFeatures.durableRows
    },
    { label: "Flow", tape: state.flow, subscribed: state.routeFeatures.flow },
    { label: "Alerts", tape: state.alerts, subscribed: state.routeFeatures.alerts },
    { label: "News", tape: state.news, subscribed: state.routeFeatures.news },
    { label: "Dark", tape: state.inferredDark, subscribed: state.routeFeatures.inferredDark }
  ];

  return (
    <section className="market-command-chrome" aria-label="Market command controls">
      <div className="market-command-chrome-primary">
        <div className="market-command-chrome-title">
          <span>islandflow</span>
          <strong>Market Command</strong>
        </div>
        <div className="market-command-chrome-status">
          <span className={`command-chip command-chip-${state.liveSession.status}`}>
            {state.mode === "live" ? "Live" : "Replay"}: {connectionLabel}
          </span>
          <TapeStatus
            dropped={getQueuedCount(state)}
            lastUpdate={state.lastSeen}
            mode={state.mode}
            paused={false}
            replayComplete={getReplayComplete(state)}
            replayTime={replayTime}
            status={state.mode === "live" ? state.liveSession.status : state.options.status}
          />
        </div>
        <div className="market-command-chrome-actions">
          <FlowFilterPopover filters={state.flowFilters} onChange={state.setFlowFilters} />
          <button
            className="terminal-button terminal-button-primary"
            type="button"
            onClick={state.toggleMode}
          >
            {state.mode === "live" ? "Replay" : "Live"}
          </button>
        </div>
      </div>

      <div className="market-command-focus-row">
        <label className="market-command-focus-input">
          <span>Focus</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            className="terminal-input"
            inputMode="text"
            maxLength={TICKER_FILTER_INPUT_MAX_LENGTH}
            name="market-command-focus"
            onChange={(event) =>
              state.setFilterInput(normalizeTickerFilterInput(event.target.value))
            }
            placeholder="SPY, NVDA, AAPL"
            spellCheck={false}
            value={state.filterInput}
          />
        </label>
        <div className="market-command-focus-ribbon" aria-label="Current dashboard focus">
          <span>{focusLabel}</span>
          <strong>
            {state.chartTicker.toUpperCase()} / {formatIntervalLabel(state.chartIntervalMs)}
          </strong>
          <em>Source {replaySource}</em>
          {state.filterInput.trim() || state.selectedInstrument ? (
            <button className="terminal-button" type="button" onClick={state.clearBoardFocus}>
              Clear board
            </button>
          ) : null}
        </div>
      </div>

      <div className="market-command-health-grid" aria-label="Feed health">
        {healthRows.map(({ label, tape, subscribed }) => (
          <HealthRow
            dropped={tape.dropped}
            key={label}
            label={label}
            lastUpdate={tape.lastUpdate}
            mode={state.mode}
            status={tape.status}
            subscribed={subscribed}
          />
        ))}
      </div>
    </section>
  );
};
