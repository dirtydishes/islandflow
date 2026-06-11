import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type MockVariant = "mock1" | "mock2" | "mock3" | "mock4";

type DashboardMockProps = {
  variant: MockVariant;
};

type Concept = {
  title: string;
  shortName: string;
  premise: string;
  bestFor: string;
  layout: string;
};

const concepts: Record<MockVariant, Concept> = {
  mock1: {
    title: "Evidence Canvas",
    shortName: "Canvas",
    premise:
      "A selected anomaly becomes the organizing object. Price, options, prints, news, and replay evidence attach around one decision path.",
    bestFor: "single-symbol investigation",
    layout: "canvas"
  },
  mock2: {
    title: "Anomaly Queue",
    shortName: "Queue",
    premise:
      "The terminal behaves like an alert operations room: ranked work enters from the left, evidence resolves in the center, and confidence checks stay pinned.",
    bestFor: "live triage under volume",
    layout: "queue"
  },
  mock3: {
    title: "Replay Room",
    shortName: "Replay",
    premise:
      "Historical sessions become inspectable rooms. The time spine leads, with every event and chart panel synchronized to the replay cursor.",
    bestFor: "after-action review",
    layout: "replay"
  },
  mock4: {
    title: "Market Atlas",
    shortName: "Atlas",
    premise:
      "Symbols are mapped as related territories. Sector pressure, cross-asset flow, and event clusters reveal where attention is concentrating.",
    bestFor: "cross-market scanning",
    layout: "atlas"
  }
};

const variantOrder: MockVariant[] = ["mock1", "mock2", "mock3", "mock4"];

const symbols = [
  { symbol: "AAPL", price: "194.88", move: "+1.22%", direction: "up", score: 94, sector: "Mega cap tech" },
  { symbol: "NVDA", price: "120.19", move: "-0.41%", direction: "down", score: 81, sector: "AI semis" },
  { symbol: "TSLA", price: "180.72", move: "+0.72%", direction: "up", score: 76, sector: "EV complex" },
  { symbol: "AMZN", price: "186.31", move: "+0.35%", direction: "up", score: 68, sector: "Consumer platform" },
  { symbol: "IWM", price: "205.41", move: "+0.21%", direction: "up", score: 59, sector: "Small caps" }
];

const anomalies = [
  {
    time: "09:41:10",
    symbol: "AAPL",
    title: "Dark sweep aligns with call pressure",
    value: "$4.32M",
    confidence: "High",
    direction: "Bullish",
    cause: "off-exchange prints led the options burst by 72s"
  },
  {
    time: "09:40:58",
    symbol: "NVDA",
    title: "Call wall absorbed at 120",
    value: "$2.01M",
    confidence: "Medium",
    direction: "Mixed",
    cause: "quote lift faded after the second split sweep"
  },
  {
    time: "09:39:47",
    symbol: "TSLA",
    title: "Momentum classifier fired",
    value: "91%",
    confidence: "High",
    direction: "Bullish",
    cause: "volume acceleration exceeded five-session baseline"
  },
  {
    time: "09:39:12",
    symbol: "AMZN",
    title: "Large block against tape",
    value: "$3.67M",
    confidence: "Watch",
    direction: "Bearish",
    cause: "print direction diverged from sector basket"
  }
];

const evidence = [
  ["Options", "195 C sweep", "$2.31M", "Bullish"],
  ["Equity", "25,000 dark buy", "$4.87M", "Bullish"],
  ["News", "AI update crossed", "09:40:21", "Info"],
  ["Tape", "Momentum burst", "+1.22%", "Bullish"],
  ["Venue", "Off-exchange share", "64%", "Watch"]
];

const optionRows = [
  ["2m", "AAPL", "May 17", "195 C", "5,240", "$2.31M", "Sweep", "Bullish"],
  ["3m", "AAPL", "Jun 21", "200 C", "6,800", "$1.87M", "Block", "Bullish"],
  ["4m", "NVDA", "May 24", "120 C", "9,150", "$2.01M", "Split", "Mixed"],
  ["5m", "TSLA", "Jul 19", "205 C", "10,000", "$3.45M", "Block", "Bullish"],
  ["6m", "AMZN", "May 17", "185 P", "4,500", "$1.20M", "Sweep", "Bearish"]
];

const health = [
  ["OPRA", "healthy", "120ms"],
  ["CBOE", "healthy", "85ms"],
  ["NYSE", "degraded", "412ms"],
  ["News", "healthy", "1.2s"]
];

const timeline = [
  ["09:36", "Baseline drift", "AAPL and QQQ correlation widens"],
  ["09:39", "First print", "Dark block appears before visible call lift"],
  ["09:41", "Signal fired", "Sweep pressure confirms the print cluster"],
  ["09:45", "Replay note", "Price accepted above prior liquidity shelf"]
];

const atlasGroups = [
  { name: "Mega cap tech", heat: 92, flow: "+$8.4M", symbols: ["AAPL", "MSFT", "AMZN"], x: 12, y: 14 },
  { name: "AI semis", heat: 81, flow: "+$5.1M", symbols: ["NVDA", "AMD", "AVGO"], x: 56, y: 22 },
  { name: "Beta basket", heat: 66, flow: "+$3.8M", symbols: ["TSLA", "COIN", "PLTR"], x: 30, y: 58 },
  { name: "Defensive", heat: 38, flow: "-$1.2M", symbols: ["XLU", "XLV", "PG"], x: 68, y: 64 }
];

export function DashboardMock({ variant }: DashboardMockProps) {
  const concept = concepts[variant];

  return (
    <main className={`mock-redesign mock-redesign-${concept.layout}`} aria-labelledby="mock-title">
      <MockHeader active={variant} concept={concept} />
      {variant === "mock1" ? <EvidenceCanvas /> : null}
      {variant === "mock2" ? <AnomalyQueue /> : null}
      {variant === "mock3" ? <ReplayRoom /> : null}
      {variant === "mock4" ? <MarketAtlas /> : null}
    </main>
  );
}

function MockHeader({ active, concept }: { active: MockVariant; concept: Concept }) {
  return (
    <header className="mock-redesign-header">
      <div className="mock-redesign-title">
        <span className="mock-redesign-product">islandflow concepts</span>
        <h1 id="mock-title">{concept.title}</h1>
        <p>{concept.premise}</p>
      </div>
      <div className="mock-redesign-meta" aria-label="Concept metadata">
        <span>best for: {concept.bestFor}</span>
        <span>09:41:23 ET</span>
        <span className="is-live">live data sketch</span>
      </div>
      <nav className="mock-redesign-switcher" aria-label="Mock variants">
        {variantOrder.map((item) => (
          <Link
            aria-current={item === active ? "page" : undefined}
            className={item === active ? "is-active" : ""}
            href={`/${item}`}
            key={item}
          >
            {concepts[item].shortName}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function EvidenceCanvas() {
  return (
    <section className="mock-canvas-grid" aria-label="Evidence canvas concept">
      <div className="mock-symbol-strip">
        {symbols.map((item) => (
          <article className="mock-symbol-tile" key={item.symbol}>
            <div>
              <strong>{item.symbol}</strong>
              <span>{item.sector}</span>
            </div>
            <ScoreDial score={item.score} />
          </article>
        ))}
      </div>
      <Panel className="mock-canvas-brief" label="active case">
        <div className="mock-case-heading">
          <span className="mock-case-symbol">AAPL</span>
          <div>
            <h2>Dark sweep pressure is confirmed by options lift</h2>
            <p>
              The interface treats one fired anomaly as a case file. Every pane answers whether the
              signal is meaningful, explainable, and worth continued attention.
            </p>
          </div>
          <span className="mock-confidence">94 confidence</span>
        </div>
        <EvidenceLinks />
      </Panel>
      <ChartPanel className="mock-canvas-chart" mode="annotated" />
      <FlowTape className="mock-canvas-tape" />
      <CausalityPanel className="mock-canvas-context" />
    </section>
  );
}

function AnomalyQueue() {
  return (
    <section className="mock-queue-grid" aria-label="Anomaly queue concept">
      <Panel className="mock-queue-list" label="ranked work">
        {anomalies.map((item, index) => (
          <article className={index === 0 ? "mock-queue-item is-selected" : "mock-queue-item"} key={item.time}>
            <time>{item.time}</time>
            <div>
              <strong>{item.symbol}</strong>
              <span>{item.title}</span>
            </div>
            <Badge tone={item.direction}>{item.direction}</Badge>
          </article>
        ))}
      </Panel>
      <Panel className="mock-queue-inspector" label="current anomaly">
        <div className="mock-inspector-header">
          <span>AAPL</span>
          <h2>Dark sweep aligns with call pressure</h2>
          <p>Off-exchange prints led the options burst by 72 seconds. The next decision is whether the move is being accepted above the liquidity shelf.</p>
        </div>
        <EvidenceLinks compact />
        <ChartPanel mode="compressed" />
      </Panel>
      <Panel className="mock-queue-checks" label="confidence checks">
        <CheckList />
        <FeedHealth />
      </Panel>
    </section>
  );
}

function ReplayRoom() {
  return (
    <section className="mock-replay-grid" aria-label="Replay room concept">
      <Panel className="mock-replay-stage" label="session replay">
        <div className="mock-replay-hero">
          <div>
            <span>May 16, 2024</span>
            <h2>09:41:23, signal confirmation window</h2>
          </div>
          <div className="mock-replay-controls" aria-label="Replay controls">
            <button type="button">Back 30s</button>
            <button type="button">Pause replay</button>
            <button type="button">Forward 30s</button>
            <span>32x</span>
          </div>
        </div>
        <ReplayTrack />
        <ChartPanel mode="replay" />
      </Panel>
      <Panel className="mock-replay-spine" label="event spine">
        <ol className="mock-time-spine">
          {timeline.map(([time, title, detail]) => (
            <li key={time}>
              <time>{time}</time>
              <strong>{title}</strong>
              <span>{detail}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <FlowTape className="mock-replay-tape" condensed />
      <CausalityPanel className="mock-replay-notes" />
    </section>
  );
}

function MarketAtlas() {
  return (
    <section className="mock-atlas-grid" aria-label="Market atlas concept">
      <Panel className="mock-atlas-map" label="attention map">
        <div className="mock-atlas-field">
          {atlasGroups.map((group) => (
            <article
              className="mock-atlas-node"
              key={group.name}
              style={{ "--x": `${group.x}%`, "--y": `${group.y}%`, "--heat": group.heat } as CSSProperties}
            >
              <strong>{group.name}</strong>
              <span>{group.flow}</span>
            </article>
          ))}
        </div>
      </Panel>
      <Panel className="mock-atlas-symbols" label="cluster detail">
        {atlasGroups.map((group) => (
          <article className="mock-cluster-row" key={group.name}>
            <div>
              <strong>{group.name}</strong>
              <span>{group.symbols.join(" / ")}</span>
            </div>
            <ScoreDial score={group.heat} />
          </article>
        ))}
      </Panel>
      <Panel className="mock-atlas-correlation" label="linked evidence">
        <EvidenceLinks compact />
        <FlowTape condensed />
      </Panel>
    </section>
  );
}

function Panel({ className, label, children }: { className?: string; label: string; children: ReactNode }) {
  return (
    <section className={`mock-redesign-panel ${className ?? ""}`} aria-label={label}>
      <div className="mock-panel-label">{label}</div>
      {children}
    </section>
  );
}

function EvidenceLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "mock-evidence-list is-compact" : "mock-evidence-list"}>
      {evidence.map(([source, title, value, tone]) => (
        <article className="mock-evidence-card" key={`${source}-${title}`}>
          <span>{source}</span>
          <strong>{title}</strong>
          <div>
            <span>{value}</span>
            <Badge tone={tone}>{tone}</Badge>
          </div>
        </article>
      ))}
    </div>
  );
}

function FlowTape({ className = "", condensed = false }: { className?: string; condensed?: boolean }) {
  const rows = condensed ? optionRows.slice(0, 4) : optionRows;

  return (
    <Panel className={`mock-flow-tape ${className}`} label="flow tape">
      <div className="mock-redesign-table">
        <div className="mock-redesign-row is-head">
          <span>Time</span>
          <span>Symbol</span>
          <span>Contract</span>
          <span>Size</span>
          <span>Premium</span>
          <span>Read</span>
        </div>
        {rows.map(([time, symbol, exp, strike, size, premium, type, read]) => (
          <div className="mock-redesign-row" key={`${time}-${symbol}-${strike}`}>
            <span>{time}</span>
            <strong>{symbol}</strong>
            <span>{exp} {strike}</span>
            <span>{size}</span>
            <span>{premium}</span>
            <Badge tone={read}>{type}</Badge>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ChartPanel({ className = "", mode }: { className?: string; mode: "annotated" | "compressed" | "replay" }) {
  const count = mode === "compressed" ? 38 : 64;

  return (
    <Panel className={`mock-redesign-chart ${className} is-${mode}`} label="price and flow">
      <div className="mock-chart-topline">
        <div>
          <span>AAPL</span>
          <strong>194.88</strong>
        </div>
        <Badge tone="Bullish">+1.22%</Badge>
      </div>
      <div className="mock-chart-field" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <span
            className={index % 8 === 0 || index % 13 === 0 ? "is-red" : "is-green"}
            key={index}
            style={{ "--height": `${18 + ((index * 19) % 66)}%` } as CSSProperties}
          />
        ))}
        <i className="mock-chart-marker" />
      </div>
      <div className="mock-volume-field" aria-hidden="true">
        {Array.from({ length: 42 }).map((_, index) => (
          <span
            className={index % 7 === 0 ? "is-red" : "is-green"}
            key={index}
            style={{ "--height": `${14 + ((index * 23) % 70)}%` } as CSSProperties}
          />
        ))}
      </div>
    </Panel>
  );
}

function CausalityPanel({ className = "" }: { className?: string }) {
  return (
    <Panel className={`mock-causality ${className}`} label="why it fired">
      <dl>
        <div>
          <dt>Lead indicator</dt>
          <dd>Dark flow cluster</dd>
        </div>
        <div>
          <dt>Confirming evidence</dt>
          <dd>195 C sweep pressure</dd>
        </div>
        <div>
          <dt>Contradiction</dt>
          <dd>Venue concentration is high</dd>
        </div>
        <div>
          <dt>Next check</dt>
          <dd>Acceptance above 194.50</dd>
        </div>
      </dl>
    </Panel>
  );
}

function FeedHealth() {
  return (
    <div className="mock-feed-health">
      {health.map(([name, state, lag]) => (
        <div key={name}>
          <strong>{name}</strong>
          <Badge tone={state === "degraded" ? "Watch" : "Bullish"}>{state}</Badge>
          <span>{lag}</span>
        </div>
      ))}
    </div>
  );
}

function CheckList() {
  const checks = [
    ["Source agreement", "4 of 5 linked sources agree"],
    ["Staleness", "last event 11s ago"],
    ["Replay match", "similar to Apr 26 open"],
    ["Risk note", "off-exchange share elevated"]
  ];

  return (
    <div className="mock-check-list">
      {checks.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReplayTrack() {
  return (
    <div className="mock-replay-track-redesign">
      <span>09:00</span>
      <div>
        <i />
      </div>
      <strong>09:41:23</strong>
      <span>10:15</span>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  return (
    <span className="mock-score-dial" style={{ "--score": score } as CSSProperties}>
      {score}
    </span>
  );
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  const normalized =
    tone === "Bearish" ? "bearish" : tone === "Watch" || tone === "Mixed" ? "watch" : tone === "Info" ? "info" : "bullish";

  return <span className={`mock-badge is-${normalized}`}>{children}</span>;
}
