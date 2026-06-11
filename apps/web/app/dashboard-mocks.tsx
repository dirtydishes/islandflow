import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type MockVariant = "mock1" | "mock2" | "mock3" | "mock4" | "mock5" | "mock6" | "mock7" | "mock8";

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
    title: "Signal Docket",
    shortName: "Docket",
    routeName: "Case Tape",
    premise: "Active claims, confirms, contra-flow, and invalidation marks on one symbol docket.",
    bodyClass: "mock-court"
  },
  mock2: {
    title: "Alert Queue",
    shortName: "Desk",
    routeName: "Desk Queue",
    premise: "Ranked live signals by urgency, source state, and tape confirmation.",
    bodyClass: "mock-desk"
  },
  mock3: {
    title: "Replay Tape",
    shortName: "Replay",
    routeName: "Tape Review",
    premise: "Frame-locked replay across prints, candles, packet state, and notes.",
    bodyClass: "mock-theatre"
  },
  mock4: {
    title: "Pressure Map",
    shortName: "Map",
    routeName: "Cross-Market",
    premise: "Sector heat, linked symbols, and flow clusters before single-name drilldown.",
    bodyClass: "mock-map"
  },
  mock5: {
    title: "OPRA Intake",
    shortName: "Options",
    routeName: "OPRA",
    premise: "Contract tape, premium concentration, sweep shape, ask lift, and packet eligibility.",
    bodyClass: "mock-options"
  },
  mock6: {
    title: "Packet Stack",
    shortName: "Packets",
    routeName: "Packets",
    premise: "Flow packets scored by options burst, tape response, venue mix, and sector echo.",
    bodyClass: "mock-packets"
  },
  mock7: {
    title: "Alert Blotter",
    shortName: "Alerts",
    routeName: "Alerts",
    premise: "Smart-money alerts with trigger, read type, severity, and invalidation level.",
    bodyClass: "mock-alerts"
  },
  mock8: {
    title: "Activity Matrix",
    shortName: "Matrix",
    routeName: "Matrix",
    premise: "Options, packet, alert, and market context stitched into one activity map.",
    bodyClass: "mock-graph"
  }
};

const variantOrder: MockVariant[] = [
  "mock1",
  "mock2",
  "mock3",
  "mock4",
  "mock5",
  "mock6",
  "mock7",
  "mock8"
];

const symbols = [
  {
    symbol: "AAPL",
    price: "194.88",
    move: "+1.22%",
    direction: "up",
    score: 94,
    sector: "Mega cap tech"
  },
  {
    symbol: "NVDA",
    price: "120.19",
    move: "-0.41%",
    direction: "down",
    score: 81,
    sector: "AI semis"
  },
  {
    symbol: "TSLA",
    price: "180.72",
    move: "+0.72%",
    direction: "up",
    score: 76,
    sector: "EV complex"
  },
  {
    symbol: "AMZN",
    price: "186.31",
    move: "+0.35%",
    direction: "up",
    score: 68,
    sector: "Consumer platform"
  },
  {
    symbol: "IWM",
    price: "205.41",
    move: "+0.21%",
    direction: "up",
    score: 59,
    sector: "Small caps"
  }
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
  {
    name: "Mega cap tech",
    heat: 92,
    flow: "+$8.4M",
    symbols: ["AAPL", "MSFT", "AMZN"],
    x: 16,
    y: 22
  },
  { name: "AI semis", heat: 81, flow: "+$5.1M", symbols: ["NVDA", "AMD", "AVGO"], x: 64, y: 26 },
  {
    name: "Beta basket",
    heat: 66,
    flow: "+$3.8M",
    symbols: ["TSLA", "COIN", "PLTR"],
    x: 34,
    y: 66
  },
  { name: "Defensive", heat: 38, flow: "-$1.2M", symbols: ["XLU", "XLV", "PG"], x: 74, y: 70 }
];

const intakeRows = [
  [
    "09:41:23.420",
    "AAPL",
    "17MAY24 195C",
    "12,480",
    "$4.32M",
    "sweep",
    "61%",
    "+3.8σ",
    "candidate"
  ],
  [
    "09:41:18.092",
    "AAPL",
    "21JUN24 200C",
    "8,920",
    "$2.74M",
    "split sweep",
    "58%",
    "+2.9σ",
    "join"
  ],
  [
    "09:40:52.774",
    "QQQ",
    "17MAY24 458C",
    "19,600",
    "$5.10M",
    "block lift",
    "49%",
    "+2.1σ",
    "confirm"
  ],
  ["09:40:11.018", "NVDA", "24MAY24 120C", "7,340", "$2.01M", "iso sweep", "42%", "+1.7σ", "watch"],
  [
    "09:39:47.660",
    "TSLA",
    "19JUL24 205C",
    "10,000",
    "$3.45M",
    "block",
    "38%",
    "+2.4σ",
    "candidate"
  ],
  ["09:39:12.105", "AMZN", "17MAY24 185P", "4,500", "$1.20M", "sweep", "36%", "-1.9σ", "reject"],
  ["09:38:59.443", "IWM", "17MAY24 205C", "14,250", "$1.92M", "multi-leg", "31%", "+1.4σ", "watch"]
];

const packetSteps = [
  {
    label: "options burst",
    time: "09:41:23",
    weight: 92,
    detail: "AAPL 195C + 200C clustered inside 72s with ask-side pressure"
  },
  {
    label: "equity trace",
    time: "09:41:48",
    weight: 74,
    detail: "25k dark buy and visible bid lift hold above 194.50"
  },
  {
    label: "venue mix",
    time: "09:42:06",
    weight: 68,
    detail: "Off-exchange share at 64%, above session baseline by 18 points"
  },
  {
    label: "sector echo",
    time: "09:42:31",
    weight: 57,
    detail: "QQQ confirms, semis neutral, no broad risk-off objection"
  },
  {
    label: "packet ready",
    time: "09:42:44",
    weight: 86,
    detail: "SMP candidate: stealth accumulation into short-dated calls"
  }
];

const packetRows = [
  ["PKT-8841", "AAPL", "ready", "5 sources", "stealth accumulation", "86"],
  ["PKT-8838", "TSLA", "building", "3 sources", "momentum ignition", "71"],
  ["PKT-8834", "NVDA", "held", "2 sources", "call wall absorption", "63"],
  ["PKT-8827", "AMZN", "rejected", "2 sources", "put sweep divergence", "39"]
];

const alertRows = [
  [
    "09:42:51",
    "AAPL",
    "SMP Alert",
    "stealth accumulation",
    "options led stock by 72s; dark share elevated",
    "accept above 194.50",
    "high"
  ],
  [
    "09:41:58",
    "TSLA",
    "Ignition Watch",
    "momentum ignition",
    "block call buy plus tape acceleration",
    "fails below 178.80",
    "medium"
  ],
  [
    "09:40:34",
    "NVDA",
    "Absorption",
    "call wall defense",
    "buyers absorbed at 120 but price did not expand",
    "rejects 120.40",
    "watch"
  ],
  [
    "09:39:22",
    "AMZN",
    "Divergence",
    "put sweep against basket",
    "bearish premium while sector bid held",
    "reclaims 186.20",
    "low"
  ]
];

const graphLanes = [
  { label: "Options", x1: "5%", x2: "31%", y: "18%", tone: "good", text: "195C sweep + 200C join" },
  {
    label: "Packet",
    x1: "35%",
    x2: "60%",
    y: "35%",
    tone: "info",
    text: "PKT-8841 ready, 5 sources"
  },
  {
    label: "Alert",
    x1: "63%",
    x2: "88%",
    y: "22%",
    tone: "accent",
    text: "SMP alert: stealth accumulation"
  },
  {
    label: "Market",
    x1: "20%",
    x2: "82%",
    y: "69%",
    tone: "watch",
    text: "QQQ confirms; semis neutral"
  }
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
      {variant === "mock5" ? <OptionsIntake /> : null}
      {variant === "mock6" ? <PacketForensics /> : null}
      {variant === "mock7" ? <AlertReasonWall /> : null}
      {variant === "mock8" ? <MarketActivityGraph /> : null}
    </main>
  );
}

function MockNavigation({ active, concept }: { active: MockVariant; concept: Concept }) {
  return (
    <header className="mock-nav" aria-label="Terminal navigation">
      <Link className="mock-brand" href="/mock1">
        <span>IF</span>
        <strong>terminal studies</strong>
      </Link>
      <nav className="mock-route-tabs" aria-label="Terminal studies">
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
      <div className="mock-now" aria-label="Market clock">
        <span>live tape</span>
        <strong>09:41:23 ET</strong>
      </div>
      <section className="mock-hero" aria-label="Route summary">
        <p>{concept.routeName}</p>
        <h1 id="mock-title">{concept.title}</h1>
        <span>{concept.premise}</span>
      </section>
    </header>
  );
}

function SignalCourt() {
  return (
    <section className="mock-court-layout" aria-label="Signal docket">
      <Panel className="mock-verdict" title="Active read">
        <div className="mock-verdict-mark">AAPL</div>
        <h2>Dark sweep confirmed by short-dated call lift.</h2>
        <p>AAPL holds above 194.50 with options lead, elevated dark share, and QQQ support.</p>
        <div className="mock-verdict-actions">
          <button type="button">Open tape</button>
          <button type="button">Set watch</button>
        </div>
      </Panel>
      <Panel className="mock-exhibits" title="Evidence">
        <EvidenceStack />
      </Panel>
      <Panel className="mock-court-chart" title="Price tape">
        <ChartSketch density={60} marker="signal" />
      </Panel>
      <Panel className="mock-objections" title="Contra">
        <FactList
          items={[
            ["Venue", "64% off-exchange share, +18 pts vs session"],
            ["Sector", "QQQ confirms; semis neutral"],
            ["Invalid", "Below 194.50"]
          ]}
        />
      </Panel>
    </section>
  );
}

function TriageDesk() {
  return (
    <section className="mock-desk-layout" aria-label="Alert queue">
      <aside className="mock-desk-rail" aria-label="Queue filters">
        <strong>route</strong>
        {["all", "hot", "chart", "stale"].map((item, index) => (
          <button className={index === 1 ? "is-active" : ""} type="button" key={item}>
            {item}
          </button>
        ))}
      </aside>
      <Panel className="mock-queue-board" title="Priority">
        {anomalies.map((item, index) => (
          <article
            className={index === 0 ? "mock-desk-ticket is-selected" : "mock-desk-ticket"}
            key={item.time}
          >
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
      <Panel className="mock-desk-workspace" title="Selected">
        <div className="mock-workspace-head">
          <span>AAPL</span>
          <h2>Dark sweep aligns with call pressure</h2>
          <p>Monitor acceptance above 194.50; invalidate on failed retest.</p>
        </div>
        <ChartSketch density={42} marker="decision line" />
      </Panel>
      <Panel className="mock-desk-health" title="Feeds">
        <HealthRows />
        <FactList
          items={[
            ["Confluence", "4/5 sources"],
            ["Analog", "Apr 26 open"],
            ["Risk", "Dark share elevated"]
          ]}
        />
      </Panel>
    </section>
  );
}

function ReplayTheatre() {
  return (
    <section className="mock-theatre-layout" aria-label="Replay tape">
      <Panel className="mock-stage" title="Frame">
        <div className="mock-stage-head">
          <div>
            <span>May 16, 2024</span>
            <h2>09:41:23 confirm window</h2>
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
      <Panel className="mock-script" title="Sequence">
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
      <Panel className="mock-theatre-tape" title="Flow">
        <FlowRows compact />
      </Panel>
      <Panel className="mock-director-notes" title="Notes">
        <FactList
          items={[
            ["Lead", "Dark cluster first"],
            ["Confirm", "195C sweep +72s"],
            ["Watch", "One candle acceptance"]
          ]}
        />
      </Panel>
    </section>
  );
}

function SectorCartography() {
  return (
    <section className="mock-map-layout" aria-label="Pressure map">
      <Panel className="mock-map-canvas" title="Pressure">
        <div className="mock-territory">
          {atlasGroups.map((group) => (
            <article
              className="mock-territory-node"
              key={group.name}
              style={
                {
                  "--x": `${group.x}%`,
                  "--y": `${group.y}%`,
                  "--heat": group.heat
                } as CSSProperties
              }
            >
              <strong>{group.name}</strong>
              <span>{group.flow}</span>
            </article>
          ))}
        </div>
      </Panel>
      <Panel className="mock-map-index" title="Clusters">
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
      <Panel className="mock-map-flow" title="Linked">
        <FlowRows compact />
      </Panel>
    </section>
  );
}

function OptionsIntake() {
  return (
    <section className="mock-options-layout" aria-label="OPRA intake">
      <div className="mock-options-command" aria-label="Options filters">
        {["OPRA LIVE", "ASK LIFT", "+2 SIGMA", "PACKET FIT", "AAPL"].map((item, index) => (
          <button className={index === 3 ? "is-active" : ""} type="button" key={item}>
            {item}
          </button>
        ))}
      </div>
      <div className="mock-options-tape" role="table" aria-label="Options flow intake blotter">
        <div className="mock-options-row is-head" role="row">
          {["Time", "Sym", "Contract", "Qty", "Premium", "Print", "Ask", "Z", "State"].map(
            (item) => (
              <span role="columnheader" key={item}>
                {item}
              </span>
            )
          )}
        </div>
        {intakeRows.map(([time, symbol, contract, size, premium, shape, ask, baseline, use]) => (
          <div
            className={`mock-options-row is-${use}`}
            role="row"
            key={`${time}-${symbol}-${contract}`}
          >
            <time>{time}</time>
            <strong>{symbol}</strong>
            <span>{contract}</span>
            <span>{size}</span>
            <span>{premium}</span>
            <span>{shape}</span>
            <span>{ask}</span>
            <span>{baseline}</span>
            <Badge tone={use === "reject" ? "Bearish" : use === "watch" ? "Watch" : "Bullish"}>
              {use}
            </Badge>
          </div>
        ))}
      </div>
      <aside className="mock-options-depth" aria-label="Selected contract">
        <h2>AAPL 195C</h2>
        <dl>
          <div>
            <dt>fit</dt>
            <dd>92%</dd>
          </div>
          <div>
            <dt>repeat</dt>
            <dd>3 prints</dd>
          </div>
          <div>
            <dt>venue</dt>
            <dd>ask 61%</dd>
          </div>
          <div>
            <dt>trigger</dt>
            <dd>hold 194.50</dd>
          </div>
        </dl>
      </aside>
      <FlowLadder />
    </section>
  );
}

function PacketForensics() {
  return (
    <section className="mock-packet-layout" aria-label="Packet stack">
      <div className="mock-packet-chain" aria-label="Packet chain">
        {packetSteps.map((step, index) => (
          <article key={step.label} style={{ "--weight": step.weight } as CSSProperties}>
            <time>{step.time}</time>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
            <span>
              {index === packetSteps.length - 1 ? "alert eligible" : `${step.weight}% weight`}
            </span>
          </article>
        ))}
      </div>
      <div className="mock-packet-ledger" role="table" aria-label="Packet state ledger">
        <div className="mock-packet-row is-head" role="row">
          {["Packet", "Sym", "State", "Sources", "Read", "Score"].map((item) => (
            <span role="columnheader" key={item}>
              {item}
            </span>
          ))}
        </div>
        {packetRows.map(([id, symbol, state, sources, reason, score]) => (
          <div className={`mock-packet-row is-${state}`} role="row" key={id}>
            <strong>{id}</strong>
            <span>{symbol}</span>
            <Badge tone={state === "rejected" ? "Bearish" : state === "held" ? "Watch" : "Bullish"}>
              {state}
            </Badge>
            <span>{sources}</span>
            <span>{reason}</span>
            <span>{score}</span>
          </div>
        ))}
      </div>
      <aside className="mock-packet-inspector" aria-label="Packet lineage">
        <h2>PKT-8841 lineage</h2>
        <FactList
          items={[
            ["Options", "195C sweep + 200C join"],
            ["Equity", "Dark buy after options burst"],
            ["Trigger", "Acceptance above 194.50"]
          ]}
        />
      </aside>
    </section>
  );
}

function AlertReasonWall() {
  return (
    <section className="mock-alert-layout" aria-label="SMP alert blotter">
      <div className="mock-alert-wall" role="table" aria-label="Alert blotter">
        <div className="mock-alert-row is-head" role="row">
          {["Time", "Sym", "Type", "Read", "Trigger", "Invalid", "Severity"].map((item) => (
            <span role="columnheader" key={item}>
              {item}
            </span>
          ))}
        </div>
        {alertRows.map(([time, symbol, type, reason, why, invalidation, severity]) => (
          <div className={`mock-alert-row is-${severity}`} role="row" key={`${time}-${symbol}`}>
            <time>{time}</time>
            <strong>{symbol}</strong>
            <span>{type}</span>
            <span>{reason}</span>
            <p>{why}</p>
            <span>{invalidation}</span>
            <Badge
              tone={severity === "low" ? "Bearish" : severity === "watch" ? "Watch" : "Bullish"}
            >
              {severity}
            </Badge>
          </div>
        ))}
      </div>
      <aside className="mock-alert-reason" aria-label="Selected alert stack">
        <h2>AAPL 09:42:51</h2>
        <ol>
          <li>
            <strong>Options lead</strong>
            <span>Short-dated call premium before visible stock move.</span>
          </li>
          <li>
            <strong>Packet confirm</strong>
            <span>Dark share high; QQQ supportive.</span>
          </li>
          <li>
            <strong>SMP type</strong>
            <span>Stealth accumulation, not chase flow.</span>
          </li>
        </ol>
      </aside>
    </section>
  );
}

function MarketActivityGraph() {
  return (
    <section className="mock-graph-layout" aria-label="Activity matrix">
      <div className="mock-graph-canvas" aria-label="Options packet alert matrix">
        {graphLanes.map((lane) => (
          <div
            className={`mock-graph-link is-${lane.tone}`}
            key={lane.label}
            style={{ "--x1": lane.x1, "--x2": lane.x2, "--y": lane.y } as CSSProperties}
          >
            <strong>{lane.label}</strong>
            <span>{lane.text}</span>
          </div>
        ))}
        <div className="mock-graph-node is-options">OPRA intake</div>
        <div className="mock-graph-node is-packet">Packet PKT-8841</div>
        <div className="mock-graph-node is-alert">SMP alert</div>
        <div className="mock-graph-node is-market">Market state</div>
      </div>
      <div className="mock-graph-routes" aria-label="Route map">
        {[
          ["OPRA", "raw contract tape"],
          ["Packets", "merged source stack"],
          ["Alerts", "SMP read + invalidation"],
          ["Replay", "frame audit"]
        ].map(([route, purpose]) => (
          <div key={route}>
            <strong>{route}</strong>
            <span>{purpose}</span>
          </div>
        ))}
      </div>
      <div className="mock-graph-strip" aria-label="Matrix status">
        <FactList
          items={[
            ["State", "Raw -> packet -> alert"],
            ["Scope", "No duplicate panes"],
            ["Audit", "Alert traces to OPRA source"]
          ]}
        />
      </div>
    </section>
  );
}

function Panel({
  className,
  title,
  children
}: {
  className?: string;
  title: string;
  children: ReactNode;
}) {
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
    <div className="mock-chart" aria-label="Price and volume trace">
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

function FlowLadder() {
  return (
    <div className="mock-flow-ladder" aria-label="Options flow ladder">
      {["raw print", "candidate", "packet", "SMP alert"].map((item, index) => (
        <div className={index === 1 ? "is-active" : ""} key={item}>
          <span>{index + 1}</span>
          <strong>{item}</strong>
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
    tone === "Bearish"
      ? "bearish"
      : tone === "Watch" || tone === "Mixed"
        ? "watch"
        : tone === "Info"
          ? "info"
          : "bullish";

  return <span className={`mock-badge is-${normalized}`}>{children}</span>;
}
