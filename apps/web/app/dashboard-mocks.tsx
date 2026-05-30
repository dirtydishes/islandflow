import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type MockVariant = "mock1" | "mock2" | "mock3" | "mock4";

type DashboardMockProps = {
  variant: MockVariant;
};

const variants: Record<
  MockVariant,
  {
    title: string;
    premise: string;
    mode: string;
    layout: string;
  }
> = {
  mock1: {
    title: "Command Deck",
    premise:
      "Closest to the reference: left navigation, ticker ribbon, dense evidence panes, replay rail.",
    mode: "Dense ops",
    layout: "classic"
  },
  mock2: {
    title: "Investigation Stack",
    premise:
      "A calmer analyst layout with the selected symbol story in the center and context wrapped around it.",
    mode: "Forensic",
    layout: "focus"
  },
  mock3: {
    title: "Signal Wall",
    premise:
      "Prioritizes alert triage and cross-symbol scanning before a user drills into price action.",
    mode: "Triage",
    layout: "signals"
  },
  mock4: {
    title: "Replay Lab",
    premise:
      "A replay-first structure with timeline, event tape, and causality context always visible.",
    mode: "Replay",
    layout: "replay"
  }
};

const tickers = [
  ["SPY", "529.18", "+0.23%", "up"],
  ["QQQ", "452.47", "+0.31%", "up"],
  ["AAPL", "194.88", "+1.22%", "up"],
  ["NVDA", "120.19", "-0.41%", "down"],
  ["TSLA", "180.72", "+0.72%", "up"],
  ["AMZN", "186.31", "+0.35%", "up"],
  ["IWM", "205.41", "+0.21%", "up"]
];

const optionRows = [
  ["2m", "AAPL", "May 17", "195 C", "5,240", "$2.31M", "Sweep", "Bullish"],
  ["3m", "AAPL", "Jun 21", "200 C", "6,800", "$1.87M", "Block", "Bullish"],
  ["4m", "NVDA", "May 24", "120 C", "9,150", "$2.01M", "Split", "Bullish"],
  ["5m", "TSLA", "Jul 19", "205 C", "10,000", "$3.45M", "Block", "Bullish"],
  ["6m", "AMZN", "May 17", "185 P", "4,500", "$1.20M", "Sweep", "Bearish"],
  ["7m", "IWM", "Jun 21", "207 C", "3,100", "$712K", "Sweep", "Bullish"],
  ["8m", "AAPL", "May 24", "197.5 C", "7,600", "$2.01M", "Block", "Bullish"]
];

const signals = [
  ["09:41:10", "Dark Flow Sweep", "AAPL", "$4.32M", "Bullish"],
  ["09:40:58", "Unusual Options Activity", "NVDA", "$2.01M", "Bullish"],
  ["09:40:21", "News Catalyst", "AAPL", "AI update", "News"],
  ["09:39:47", "Classifier Hit: Momentum", "TSLA", "91%", "Bullish"],
  ["09:39:12", "Large Block Trade", "AMZN", "$3.67M", "Bearish"]
];

const feedHealth = [
  ["OPRA Options", "Healthy", "120ms", "2,341"],
  ["CBOE Quotes", "Healthy", "85ms", "1,987"],
  ["Nasdaq TotalView", "Healthy", "92ms", "3,102"],
  ["NYSE Pillar", "Degraded", "412ms", "932"],
  ["News", "Healthy", "1.2s", "12"],
  ["Dark Pool", "Healthy", "1.0s", "421"]
];

const darkFlow = [
  ["09:41:05", "AAPL", "Buy", "25,000", "$4.87M", "Sweep"],
  ["09:40:51", "AAPL", "Buy", "18,500", "$3.60M", "Sweep"],
  ["09:40:35", "AAPL", "Sell", "30,000", "$5.84M", "Block"],
  ["09:39:59", "AAPL", "Buy", "12,000", "$2.34M", "Sweep"],
  ["09:38:47", "AAPL", "Sell", "21,000", "$4.09M", "Block"]
];

const variantOrder: MockVariant[] = ["mock1", "mock2", "mock3", "mock4"];

export function DashboardMock({ variant }: DashboardMockProps) {
  const config = variants[variant];

  return (
    <section
      className={`mock-terminal mock-terminal-${config.layout}`}
      aria-labelledby="mock-title"
    >
      <MockHeader config={config} active={variant} />
      <TickerRail />
      {variant === "mock1" ? <ClassicLayout /> : null}
      {variant === "mock2" ? <FocusLayout /> : null}
      {variant === "mock3" ? <SignalLayout /> : null}
      {variant === "mock4" ? <ReplayLayout /> : null}
    </section>
  );
}

function MockHeader({
  config,
  active
}: {
  config: (typeof variants)[MockVariant];
  active: MockVariant;
}) {
  return (
    <header className="mock-header">
      <div className="mock-brand-lockup">
        <span className="mock-mark" aria-hidden="true" />
        <div>
          <span className="mock-brand">islandflow</span>
          <h1 id="mock-title">{config.title}</h1>
        </div>
      </div>
      <p>{config.premise}</p>
      <div className="mock-header-tools">
        <span className="mock-live-dot">Live</span>
        <span className="mock-system">NATS 3ms / US-EAST-1</span>
        <span className="mock-clock">09:41:23 ET</span>
        <span className="mock-mode">{config.mode}</span>
      </div>
      <nav className="mock-switcher" aria-label="Mock variants">
        {variantOrder.map((item, index) => (
          <Link
            aria-current={item === active ? "page" : undefined}
            className={item === active ? "is-active" : ""}
            href={`/${item}`}
            key={item}
          >
            Mock {index + 1}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function TickerRail() {
  return (
    <div className="mock-ticker-rail" aria-label="Live symbol ticker">
      <div className="mock-ticker-track">
        {[...tickers, ...tickers].map(([symbol, price, move, direction], index) => (
          <article className="mock-ticker-card" key={`${symbol}-${index}`}>
            <div>
              <strong>{symbol}</strong>
              <span>{price}</span>
            </div>
            <span className={`mock-move is-${direction}`}>{move}</span>
            <Sparkline direction={direction} />
          </article>
        ))}
      </div>
    </div>
  );
}

function ClassicLayout() {
  return (
    <div className="mock-dashboard-grid mock-grid-classic">
      <OptionTape />
      <ChartPanel />
      <SignalPanel />
      <FeedHealth />
      <DarkFlow />
      <EventContext />
      <ReplayRail compact />
    </div>
  );
}

function FocusLayout() {
  return (
    <div className="mock-dashboard-grid mock-grid-focus">
      <SymbolBrief />
      <ChartPanel />
      <EventContext />
      <OptionTape condensed />
      <SignalPanel />
      <DarkFlow />
    </div>
  );
}

function SignalLayout() {
  return (
    <div className="mock-dashboard-grid mock-grid-signals">
      <SignalPanel hero />
      <OptionTape />
      <ChartPanel compact />
      <FeedHealth />
      <EventContext />
    </div>
  );
}

function ReplayLayout() {
  return (
    <div className="mock-dashboard-grid mock-grid-replay">
      <ReplayRail />
      <ChartPanel />
      <EventContext />
      <OptionTape condensed />
      <SignalPanel />
      <DarkFlow />
    </div>
  );
}

function Panel({
  title,
  meta,
  className = "",
  children
}: {
  title: string;
  meta?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`mock-panel ${className}`} aria-label={title}>
      <div className="mock-panel-head">
        <h2>{title}</h2>
        {meta ? <span>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function OptionTape({ condensed = false }: { condensed?: boolean }) {
  const rows = condensed ? optionRows.slice(0, 5) : optionRows;

  return (
    <Panel title="Option Flow Tape" meta="250+ shown" className="mock-option-tape">
      <div className="mock-table mock-table-options">
        <div className="mock-table-row mock-table-head">
          <span>Time</span>
          <span>Symbol</span>
          <span>Exp</span>
          <span>Strike</span>
          <span>Size</span>
          <span>Prem</span>
          <span>Type</span>
          <span>Score</span>
        </div>
        {rows.map((row) => (
          <div className="mock-table-row" key={`${row[0]}-${row[1]}-${row[3]}`}>
            {row.map((cell, index) => (
              <span
                className={
                  index === 6
                    ? "mock-pill is-info"
                    : index === 7
                      ? `mock-pill ${cell === "Bearish" ? "is-bearish" : "is-bullish"}`
                      : ""
                }
                key={cell}
              >
                {cell}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ChartPanel({ compact = false }: { compact?: boolean }) {
  return (
    <Panel
      title="AAPL | Price & Flow"
      meta="1m / 5m / 15m"
      className={compact ? "mock-chart is-compact" : "mock-chart"}
    >
      <div className="mock-chart-meta">
        <strong>194.88</strong>
        <span className="mock-move is-up">+2.34 (+1.22%)</span>
      </div>
      <div className="mock-candle-field" aria-hidden="true">
        {Array.from({ length: 58 }).map((_, index) => (
          <span
            className={index % 7 === 0 || index % 11 === 0 ? "is-red" : "is-green"}
            key={index}
            style={{ "--height": `${18 + ((index * 17) % 62)}%` } as CSSProperties}
          />
        ))}
      </div>
      <div className="mock-volume-field" aria-hidden="true">
        {Array.from({ length: 42 }).map((_, index) => (
          <span
            className={index % 6 === 0 ? "is-red" : "is-green"}
            key={index}
            style={{ "--height": `${14 + ((index * 23) % 68)}%` } as CSSProperties}
          />
        ))}
      </div>
    </Panel>
  );
}

function SignalPanel({ hero = false }: { hero?: boolean }) {
  return (
    <Panel
      title="Signals & Alerts"
      meta="All / Signals / System"
      className={hero ? "mock-signals is-hero" : "mock-signals"}
    >
      <div className="mock-signal-list">
        {signals.map(([time, title, symbol, value, tag]) => (
          <article className="mock-signal-item" key={`${time}-${title}`}>
            <time>{time}</time>
            <div>
              <strong>{title}</strong>
              <span>
                {symbol} / {value}
              </span>
            </div>
            <span
              className={`mock-pill ${tag === "Bearish" ? "is-bearish" : tag === "News" ? "is-news" : "is-bullish"}`}
            >
              {tag}
            </span>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function FeedHealth() {
  return (
    <Panel title="Feed Health" meta="Live checks" className="mock-feed">
      <div className="mock-table mock-table-feed">
        {feedHealth.map(([feed, status, lag, rate]) => (
          <div className="mock-table-row" key={feed}>
            <span>{feed}</span>
            <span className={`mock-pill ${status === "Degraded" ? "is-warning" : "is-bullish"}`}>
              {status}
            </span>
            <span>{lag}</span>
            <span>{rate}/s</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DarkFlow() {
  return (
    <Panel title="Dark Flow" meta="Equity prints" className="mock-dark-flow">
      <div className="mock-table mock-table-dark">
        {darkFlow.map(([time, symbol, side, size, notional, type]) => (
          <div className="mock-table-row" key={`${time}-${side}-${size}`}>
            <span>{time}</span>
            <strong>{symbol}</strong>
            <span className={`mock-pill ${side === "Sell" ? "is-bearish" : "is-bullish"}`}>
              {side}
            </span>
            <span>{size}</span>
            <span>{notional}</span>
            <span>{type}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EventContext() {
  return (
    <Panel title="Event Context" meta="Window: 15m" className="mock-context">
      <div className="mock-event-layout">
        <ol className="mock-timeline">
          {signals.slice(0, 4).map(([time, title, symbol]) => (
            <li key={`${time}-${title}`}>
              <time>{time}</time>
              <strong>{title}</strong>
              <span>{symbol} evidence linked</span>
            </li>
          ))}
        </ol>
        <div className="mock-detail">
          <h3>Why it fired</h3>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>Dark Flow Sweep</dd>
            </div>
            <div>
              <dt>Premium</dt>
              <dd>$4.32M</dd>
            </div>
            <div>
              <dt>Venue</dt>
              <dd>Off-exchange</dd>
            </div>
            <div>
              <dt>Tags</dt>
              <dd>Bullish / Sweep / Call</dd>
            </div>
          </dl>
        </div>
      </div>
    </Panel>
  );
}

function ReplayRail({ compact = false }: { compact?: boolean }) {
  return (
    <Panel
      title="Replay"
      meta="May 16, 2024"
      className={compact ? "mock-replay is-compact" : "mock-replay"}
    >
      <div className="mock-replay-controls">
        <button type="button">Prev</button>
        <button type="button">Pause</button>
        <button type="button">Next</button>
        <span>32x</span>
      </div>
      <div className="mock-replay-track">
        <span className="mock-replay-window" />
        <span className="mock-replay-now" />
      </div>
      <div className="mock-replay-times">
        <span>09:00</span>
        <strong>09:41:23 / Live</strong>
        <span>10:15</span>
      </div>
    </Panel>
  );
}

function SymbolBrief() {
  return (
    <Panel title="AAPL Evidence Brief" meta="Focused symbol" className="mock-symbol-brief">
      <div className="mock-brief-price">
        <strong>194.88</strong>
        <span className="mock-move is-up">+1.22%</span>
      </div>
      <p>
        Dark sweep pressure aligns with short-window momentum and a fresh news catalyst. Context
        confidence is high, but the largest block remains off-exchange and should be checked against
        next print behavior.
      </p>
      <div className="mock-brief-tags">
        <span className="mock-pill is-bullish">Bullish</span>
        <span className="mock-pill is-info">Sweep</span>
        <span className="mock-pill is-news">News linked</span>
      </div>
    </Panel>
  );
}

function Sparkline({ direction }: { direction: string }) {
  return (
    <svg
      className="mock-sparkline"
      viewBox="0 0 96 28"
      role="img"
      aria-label={`${direction} sparkline`}
    >
      <polyline
        fill="none"
        points={
          direction === "down"
            ? "0,8 9,12 18,10 27,17 36,14 45,21 54,18 63,23 72,19 81,24 96,20"
            : "0,22 9,18 18,20 27,13 36,15 45,9 54,12 63,6 72,10 81,4 96,7"
        }
      />
    </svg>
  );
}
