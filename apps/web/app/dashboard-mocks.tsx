import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type MockVariant = "mock1" | "mock2" | "mock3" | "mock4";

type DashboardMockProps = {
  variant: MockVariant;
};

type Concept = {
  title: string;
  shortName: string;
  routeName: string;
  premise: string;
  bodyClass: string;
};

const concepts: Record<MockVariant, Concept> = {
  mock1: {
    title: "Signal Court",
    shortName: "Court",
    routeName: "Case Board",
    premise:
      "A fired signal is treated as a legal brief: evidence, objections, market context, and the live price trace are arranged around the claim.",
    bodyClass: "mock-court"
  },
  mock2: {
    title: "Triage Desk",
    shortName: "Desk",
    routeName: "Live Queue",
    premise:
      "The user works down a prioritized desk queue with clear routing, severity, source health, and next action controls always in reach.",
    bodyClass: "mock-desk"
  },
  mock3: {
    title: "Replay Theatre",
    shortName: "Theatre",
    routeName: "Session Review",
    premise:
      "Replay becomes a scrub room: the time rail leads, and every event, chart move, and note locks to the current evidence frame.",
    bodyClass: "mock-theatre"
  },
  mock4: {
    title: "Sector Cartography",
    shortName: "Map",
    routeName: "Market Map",
    premise:
      "Cross-market pressure is drawn as territories, so the trader can see where attention clusters before opening a single-symbol case.",
    bodyClass: "mock-map"
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
  ["2m", "AAPL", "May 17 195 C", "5,240", "$2.31M", "Sweep", "Bullish"],
  ["3m", "AAPL", "Jun 21 200 C", "6,800", "$1.87M", "Block", "Bullish"],
  ["4m", "NVDA", "May 24 120 C", "9,150", "$2.01M", "Split", "Mixed"],
  ["5m", "TSLA", "Jul 19 205 C", "10,000", "$3.45M", "Block", "Bullish"],
  ["6m", "AMZN", "May 17 185 P", "4,500", "$1.20M", "Sweep", "Bearish"]
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
  { name: "Mega cap tech", heat: 92, flow: "+$8.4M", symbols: ["AAPL", "MSFT", "AMZN"], x: 16, y: 22 },
  { name: "AI semis", heat: 81, flow: "+$5.1M", symbols: ["NVDA", "AMD", "AVGO"], x: 64, y: 26 },
  { name: "Beta basket", heat: 66, flow: "+$3.8M", symbols: ["TSLA", "COIN", "PLTR"], x: 34, y: 66 },
  { name: "Defensive", heat: 38, flow: "-$1.2M", symbols: ["XLU", "XLV", "PG"], x: 74, y: 70 }
];

export function DashboardMock({ variant }: DashboardMockProps) {
  const concept = concepts[variant];

  return (
    <main className={`mock-redesign ${concept.bodyClass}`} aria-labelledby="mock-title">
      <MockNavigation active={variant} concept={concept} />
      {variant === "mock1" ? <SignalCourt /> : null}
      {variant === "mock2" ? <TriageDesk /> : null}
      {variant === "mock3" ? <ReplayTheatre /> : null}
      {variant === "mock4" ? <SectorCartography /> : null}
    </main>
  );
}

function MockNavigation({ active, concept }: { active: MockVariant; concept: Concept }) {
  return (
    <header className="mock-nav" aria-label="Mock redesign navigation">
      <Link className="mock-brand" href="/mock1">
        <span>IF</span>
        <strong>mock lab</strong>
      </Link>
      <nav className="mock-route-tabs" aria-label="Mock variants">
        {variantOrder.map((item) => (
          <Link
            aria-current={item === active ? "page" : undefined}
            className={item === active ? "is-active" : ""}
            href={`/${item}`}
            key={item}
          >
            <span>{concepts[item].routeName}</span>
            <strong>{concepts[item].shortName}</strong>
          </Link>
        ))}
      </nav>
      <div className="mock-now" aria-label="Current session state">
        <span>live sketch</span>
        <strong>09:41:23 ET</strong>
      </div>
      <section className="mock-hero" aria-label="Concept summary">
        <p>{concept.routeName}</p>
        <h1 id="mock-title">{concept.title}</h1>
        <span>{concept.premise}</span>
      </section>
    </header>
  );
}

function SignalCourt() {
  return (
    <section className="mock-court-layout" aria-label="Signal court concept">
      <Panel className="mock-verdict" title="Current claim">
        <div className="mock-verdict-mark">AAPL</div>
        <h2>Dark sweep pressure is confirmed by call lift.</h2>
        <p>
          Treat the alert as a claim to prove. The board shows confirming evidence,
          contradictions, and what must happen next before the trade deserves attention.
        </p>
        <div className="mock-verdict-actions">
          <button type="button">Open case</button>
          <button type="button">Mark watch</button>
        </div>
      </Panel>
      <Panel className="mock-exhibits" title="Evidence exhibits">
        <EvidenceStack />
      </Panel>
      <Panel className="mock-court-chart" title="Price testimony">
        <ChartSketch density={60} marker="claim filed" />
      </Panel>
      <Panel className="mock-objections" title="Objections">
        <FactList
          items={[
            ["Venue concentration", "64% off-exchange share is above normal"],
            ["Sector check", "QQQ confirmation is present but not decisive"],
            ["Invalidation", "Acceptance fails below 194.50"]
          ]}
        />
      </Panel>
    </section>
  );
}

function TriageDesk() {
  return (
    <section className="mock-desk-layout" aria-label="Triage desk concept">
      <aside className="mock-desk-rail" aria-label="Queue filters">
        <strong>route</strong>
        {["all", "urgent", "needs chart", "stale source"].map((item, index) => (
          <button className={index === 1 ? "is-active" : ""} type="button" key={item}>
            {item}
          </button>
        ))}
      </aside>
      <Panel className="mock-queue-board" title="Priority queue">
        {anomalies.map((item, index) => (
          <article className={index === 0 ? "mock-desk-ticket is-selected" : "mock-desk-ticket"} key={item.time}>
            <time>{item.time}</time>
            <div>
              <strong>{item.symbol}</strong>
              <span>{item.title}</span>
              <em>{item.cause}</em>
            </div>
            <Badge tone={item.direction}>{item.confidence}</Badge>
          </article>
        ))}
      </Panel>
      <Panel className="mock-desk-workspace" title="Selected alert">
        <div className="mock-workspace-head">
          <span>AAPL</span>
          <h2>Dark sweep aligns with call pressure</h2>
          <p>Next action: verify whether price accepts above the prior liquidity shelf.</p>
        </div>
        <ChartSketch density={42} marker="decision" />
      </Panel>
      <Panel className="mock-desk-health" title="Source status">
        <HealthRows />
        <FactList
          items={[
            ["Agreement", "4 of 5 linked sources agree"],
            ["Replay match", "Similar to Apr 26 open"],
            ["Risk note", "Off-exchange share elevated"]
          ]}
        />
      </Panel>
    </section>
  );
}

function ReplayTheatre() {
  return (
    <section className="mock-theatre-layout" aria-label="Replay theatre concept">
      <Panel className="mock-stage" title="Replay frame">
        <div className="mock-stage-head">
          <div>
            <span>May 16, 2024</span>
            <h2>09:41:23 confirmation window</h2>
          </div>
          <div className="mock-stage-controls" aria-label="Replay controls">
            <button type="button">-30s</button>
            <button type="button">Pause</button>
            <button type="button">+30s</button>
            <strong>32x</strong>
          </div>
        </div>
        <ReplayRail />
        <ChartSketch density={72} marker="cursor" />
      </Panel>
      <Panel className="mock-script" title="Event script">
        <ol>
          {timeline.map(([time, title, detail]) => (
            <li key={time}>
              <time>{time}</time>
              <strong>{title}</strong>
              <span>{detail}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel className="mock-theatre-tape" title="Synced tape">
        <FlowRows compact />
      </Panel>
      <Panel className="mock-director-notes" title="Director notes">
        <FactList
          items={[
            ["Lead", "Dark flow cluster arrived first"],
            ["Confirm", "195 C sweep followed within 72s"],
            ["Watch", "Acceptance needs one more candle"]
          ]}
        />
      </Panel>
    </section>
  );
}

function SectorCartography() {
  return (
    <section className="mock-map-layout" aria-label="Sector cartography concept">
      <Panel className="mock-map-canvas" title="Pressure territory">
        <div className="mock-territory">
          {atlasGroups.map((group) => (
            <article
              className="mock-territory-node"
              key={group.name}
              style={{ "--x": `${group.x}%`, "--y": `${group.y}%`, "--heat": group.heat } as CSSProperties}
            >
              <strong>{group.name}</strong>
              <span>{group.flow}</span>
            </article>
          ))}
        </div>
      </Panel>
      <Panel className="mock-map-index" title="Cluster index">
        {atlasGroups.map((group) => (
          <article className="mock-cluster" key={group.name}>
            <div>
              <strong>{group.name}</strong>
              <span>{group.symbols.join(" / ")}</span>
            </div>
            <Meter value={group.heat} />
          </article>
        ))}
      </Panel>
      <Panel className="mock-map-flow" title="Linked flow">
        <FlowRows compact />
      </Panel>
    </section>
  );
}

function Panel({ className, title, children }: { className?: string; title: string; children: ReactNode }) {
  return (
    <section className={`mock-panel ${className ?? ""}`} aria-label={title}>
      <header>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function EvidenceStack() {
  return (
    <div className="mock-evidence-stack">
      {evidence.map(([source, title, value, tone]) => (
        <article className="mock-evidence" key={`${source}-${title}`}>
          <span>{source}</span>
          <strong>{title}</strong>
          <div>
            <em>{value}</em>
            <Badge tone={tone}>{tone}</Badge>
          </div>
        </article>
      ))}
    </div>
  );
}

function ChartSketch({ density, marker }: { density: number; marker: string }) {
  return (
    <div className="mock-chart" aria-label="Synthetic price and volume sketch">
      <div className="mock-chart-readout">
        <span>AAPL</span>
        <strong>194.88</strong>
        <Badge tone="Bullish">+1.22%</Badge>
      </div>
      <div className="mock-bars" aria-hidden="true">
        {Array.from({ length: density }).map((_, index) => (
          <span
            className={index % 8 === 0 || index % 13 === 0 ? "is-down" : "is-up"}
            key={index}
            style={{ "--height": `${16 + ((index * 19) % 68)}%` } as CSSProperties}
          />
        ))}
        <i>{marker}</i>
      </div>
      <div className="mock-volume" aria-hidden="true">
        {Array.from({ length: 36 }).map((_, index) => (
          <span
            className={index % 7 === 0 ? "is-down" : "is-up"}
            key={index}
            style={{ "--height": `${12 + ((index * 23) % 70)}%` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

function FlowRows({ compact = false }: { compact?: boolean }) {
  const rows = compact ? optionRows.slice(0, 4) : optionRows;

  return (
    <div className="mock-flow-table">
      <div className="mock-flow-row is-head">
        <span>Age</span>
        <span>Symbol</span>
        <span>Contract</span>
        <span>Size</span>
        <span>Premium</span>
        <span>Read</span>
      </div>
      {rows.map(([time, symbol, contract, size, premium, type, read]) => (
        <div className="mock-flow-row" key={`${time}-${symbol}-${contract}`}>
          <span>{time}</span>
          <strong>{symbol}</strong>
          <span>{contract}</span>
          <span>{size}</span>
          <span>{premium}</span>
          <Badge tone={read}>{type}</Badge>
        </div>
      ))}
    </div>
  );
}

function HealthRows() {
  return (
    <div className="mock-health">
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

function FactList({ items }: { items: string[][] }) {
  return (
    <dl className="mock-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReplayRail() {
  return (
    <div className="mock-replay-rail">
      <span>09:00</span>
      <div>
        <i />
      </div>
      <strong>09:41:23</strong>
      <span>10:15</span>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <span className="mock-meter" style={{ "--value": `${value}%` } as CSSProperties}>
      <i />
      <em>{value}</em>
    </span>
  );
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  const normalized =
    tone === "Bearish" ? "bearish" : tone === "Watch" || tone === "Mixed" ? "watch" : tone === "Info" ? "info" : "bullish";

  return <span className={`mock-badge is-${normalized}`}>{children}</span>;
}
