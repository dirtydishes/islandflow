import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bebas_Neue,
  DM_Serif_Display,
  Manrope,
  Newsreader,
  Oswald,
  Sora,
  Special_Elite
} from "next/font/google";

const brutal = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-concept-brutal"
});

const editorialDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-concept-editorial-display"
});

const conceptSans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-concept-sans"
});

const editorialBody = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-concept-editorial-body"
});

const condensed = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-concept-condensed"
});

const future = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-concept-future"
});

const notebook = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-concept-notebook"
});

const feedStates = [
  { label: "Opt", tone: "positive", value: "Live" },
  { label: "Eq", tone: "positive", value: "Live" },
  { label: "Flow", tone: "accent", value: "Dense" },
  { label: "Alert", tone: "negative", value: "9 high" }
];

const overviewMetrics = [
  { label: "Options", value: "284" },
  { label: "Equities", value: "142" },
  { label: "Flow", value: "36" },
  { label: "Alerts", value: "9" },
  { label: "Rules", value: "14" },
  { label: "Dark", value: "3" }
];

const alertRows = [
  {
    title: "Stealth Accumulation",
    meta: "Bullish  |  Score 92  |  NVDA",
    note: "Repeated bid-side sweeps with dark follow-through.",
    tone: "positive"
  },
  {
    title: "Distribution Cluster",
    meta: "Bearish  |  Score 81  |  SPY",
    note: "Offer-heavy packets rolling across three expiries.",
    tone: "negative"
  },
  {
    title: "Gamma Pressure",
    meta: "Neutral  |  Score 74  |  QQQ",
    note: "Market makers pinned near intraday resistance.",
    tone: "neutral"
  }
] as const;

const flowRows = [
  {
    title: "SPY 2026-06-21 C605",
    meta: "18 prints  |  $2.8M notional  |  Agg 78%",
    note: "Window 640ms with ask-side urgency.",
    tone: "accent"
  },
  {
    title: "AAPL 2026-05-17 P185",
    meta: "11 prints  |  $1.1M notional  |  Spread $0.07",
    note: "Sweeps split across ARCA and CBOE.",
    tone: "negative"
  },
  {
    title: "TSLA 2026-07-19 C240",
    meta: "8 prints  |  $980k notional  |  In 33%",
    note: "Late acceleration after lit print burst.",
    tone: "positive"
  }
] as const;

const equityRows = [
  {
    title: "NVDA",
    meta: "$972.44  |  28,400x  |  Off-Ex",
    note: "Dark ratio lifting into midday highs.",
    tone: "positive"
  },
  {
    title: "SPY",
    meta: "$604.12  |  91,300x  |  Lit",
    note: "Index tape absorbing after alert burst.",
    tone: "neutral"
  },
  {
    title: "AAPL",
    meta: "$214.77  |  18,100x  |  Off-Ex",
    note: "Block prints clustering beneath ask.",
    tone: "accent"
  }
] as const;

const conceptSummary = [
  {
    id: "concept-1",
    index: "01",
    title: "Mission Control",
    style: "Dark command center"
  },
  {
    id: "concept-2",
    index: "02",
    title: "Market Journal",
    style: "Editorial financial desk"
  },
  {
    id: "concept-3",
    index: "03",
    title: "Aurora Glass",
    style: "Futurist glass cockpit"
  },
  {
    id: "concept-4",
    index: "04",
    title: "Tape Wall",
    style: "Brutalist signal board"
  },
  {
    id: "concept-5",
    index: "05",
    title: "Field Notebook",
    style: "Analyst workbench"
  }
] as const;

type ConceptSectionProps = {
  id: string;
  index: string;
  title: string;
  label: string;
  summary: string;
  designChoices: string[];
  responsive: string[];
  className: string;
  children: ReactNode;
};

function ConceptSection({
  id,
  index,
  title,
  label,
  summary,
  designChoices,
  responsive,
  className,
  children
}: ConceptSectionProps) {
  return (
    <section className={`concept-section ${className}`} id={id}>
      <div className="concept-copy">
        <div className="concept-copy-head">
          <div className="concept-kicker">
            <span>{`Concept ${index}`}</span>
            <span>{label}</span>
          </div>
          <h2 className="concept-name">{title}</h2>
          <p className="concept-summary">{summary}</p>
        </div>

        <div className="concept-detail">
          <h3 className="concept-detail-title">Key Design Choices</h3>
          <ul className="concept-bullet-list">
            {designChoices.map((choice) => (
              <li key={choice}>{choice}</li>
            ))}
          </ul>
        </div>

        <div className="concept-detail">
          <h3 className="concept-detail-title">Responsive Considerations</h3>
          <ul className="concept-bullet-list">
            {responsive.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="concept-preview">{children}</div>
    </section>
  );
}

function MockTopbar({ brand, kicker }: { brand: string; kicker: string }) {
  return (
    <div className="mock-topbar">
      <div className="mock-brand">
        <span className="mock-brand-kicker">{kicker}</span>
        <span className="mock-brand-name">{brand}</span>
      </div>

      <div className="mock-status-cluster">
        {feedStates.map((feed) => (
          <div className={`mock-chip mock-chip-${feed.tone}`} key={feed.label}>
            <span>{feed.label}</span>
            <strong>{feed.value}</strong>
          </div>
        ))}
      </div>

      <div className="mock-actions">
        <div className="mock-filter">Filter: SPY, NVDA, AAPL</div>
        <button className="mock-button" type="button">
          Replay
        </button>
      </div>
    </div>
  );
}

function MetricRack() {
  return (
    <div className="mock-metric-rack">
      {overviewMetrics.map((metric) => (
        <div className="mock-metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Module({
  title,
  subtitle,
  children,
  className = ""
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mock-module ${className}`.trim()}>
      <div className="mock-module-head">
        <div>
          <p className="mock-module-kicker">{subtitle ?? "Core module"}</p>
          <h3 className="mock-module-title">{title}</h3>
        </div>
        <span className="mock-module-meta">Live</span>
      </div>
      {children}
    </section>
  );
}

function ChartModule({ label }: { label: string }) {
  return (
    <div className="mock-chart">
      <div className="mock-chart-labels">
        <span>{label}</span>
        <span>Signals layered on price</span>
      </div>
      <svg
        aria-hidden="true"
        className="mock-chart-svg"
        preserveAspectRatio="none"
        viewBox="0 0 520 220"
      >
        <path
          className="mock-chart-area"
          d="M0 180 L46 170 L92 150 L138 158 L184 136 L230 144 L276 115 L322 126 L368 92 L414 104 L460 70 L520 84 L520 220 L0 220 Z"
        />
        <polyline
          className="mock-chart-line"
          fill="none"
          points="0,180 46,170 92,150 138,158 184,136 230,144 276,115 322,126 368,92 414,104 460,70 520,84"
        />
        <circle className="mock-chart-marker" cx="184" cy="136" r="7" />
        <circle className="mock-chart-marker mock-chart-marker-alt" cx="368" cy="92" r="7" />
        <circle className="mock-chart-marker" cx="460" cy="70" r="7" />
      </svg>
      <div className="mock-chart-axis">
        <span>09:30</span>
        <span>11:00</span>
        <span>12:30</span>
        <span>14:00</span>
        <span>15:30</span>
      </div>
    </div>
  );
}

type MockRow = {
  title: string;
  meta: string;
  note: string;
  tone: string;
};

function ListModule({
  title,
  subtitle,
  rows
}: {
  title: string;
  subtitle: string;
  rows: readonly MockRow[];
}) {
  return (
    <Module subtitle={subtitle} title={title}>
      <div className="mock-row-list">
        {rows.map((row) => (
          <article className={`mock-row mock-row-${row.tone}`} key={`${title}-${row.title}`}>
            <div className="mock-row-head">
              <h4>{row.title}</h4>
              <span className={`mock-tone-dot mock-tone-dot-${row.tone}`} />
            </div>
            <p className="mock-row-meta">{row.meta}</p>
            <p className="mock-row-note">{row.note}</p>
          </article>
        ))}
      </div>
    </Module>
  );
}

function MissionControlMockup() {
  return (
    <div className="mockup-frame mission-frame">
      <MockTopbar brand="Islandflow / Mission" kicker="Overview redesign" />
      <MetricRack />

      <div className="mission-command">
        <div className="mission-main">
          <Module className="mission-chart-module" subtitle="Primary chart" title="Price + signal map">
            <ChartModule label="NVDA in focus" />
          </Module>
          <Module subtitle="Session summary" title="Execution notes">
            <div className="mock-summary-grid">
              <div className="mock-summary-card">
                <span>Highest urgency</span>
                <strong>Stealth accumulation in NVDA</strong>
              </div>
              <div className="mock-summary-card">
                <span>Replay readiness</span>
                <strong>Databento and Alpaca aligned</strong>
              </div>
            </div>
          </Module>
        </div>

        <div className="mission-side">
          <ListModule rows={alertRows} subtitle="Alert queue" title="Alerts" />
          <ListModule rows={flowRows} subtitle="Packet tape" title="Flow" />
        </div>
      </div>

      <div className="mission-footer">
        <ListModule rows={equityRows} subtitle="Equity tape" title="Equities" />
        <Module subtitle="Focus" title="Operator panel">
          <div className="mock-operator-grid">
            <div className="mock-operator-item">
              <span>Mode</span>
              <strong>Live</strong>
            </div>
            <div className="mock-operator-item">
              <span>Source</span>
              <strong>Auto</strong>
            </div>
            <div className="mock-operator-item">
              <span>Dark hits</span>
              <strong>03</strong>
            </div>
            <div className="mock-operator-item">
              <span>Focus ticker</span>
              <strong>NVDA</strong>
            </div>
          </div>
        </Module>
      </div>
    </div>
  );
}

function MarketJournalMockup() {
  return (
    <div className="mockup-frame editorial-frame">
      <div className="editorial-masthead">
        <div>
          <span className="editorial-volume">Vol. 27</span>
          <h3>The Islandflow Market Journal</h3>
        </div>
        <div className="editorial-meta">
          <span>Overview page redesign</span>
          <span>Same trading intelligence, calmer reading flow</span>
        </div>
      </div>

      <div className="editorial-toolbar">
        <span>Filter: SPY, NVDA, AAPL</span>
        <span>Mode: Live</span>
        <span>Replay ready</span>
      </div>

      <div className="editorial-hero">
        <Module className="editorial-hero-chart" subtitle="Lead story" title="Signals gather around NVDA">
          <ChartModule label="Narrative chart" />
        </Module>

        <Module subtitle="Editor note" title="Why this layout works">
          <div className="editorial-copy">
            <p>
              The page reads like a market front page: chart first, context second, then secondary
              feeds as supporting columns.
            </p>
            <p>
              The same terminal content feels more analytical and less mechanical, which suits
              review sessions and replay mode.
            </p>
          </div>
        </Module>
      </div>

      <div className="editorial-columns">
        <ListModule rows={alertRows} subtitle="Column A" title="Alerts" />
        <ListModule rows={flowRows} subtitle="Column B" title="Flow" />
        <ListModule rows={equityRows} subtitle="Column C" title="Equities" />
      </div>
    </div>
  );
}

function AuroraGlassMockup() {
  return (
    <div className="mockup-frame glass-frame">
      <MockTopbar brand="Islandflow Horizon" kicker="Aurora glass shell" />

      <div className="glass-overview">
        <Module subtitle="Ambient snapshot" title="Feed health">
          <MetricRack />
        </Module>
        <Module className="glass-chart-module" subtitle="Floating center" title="Signal cockpit">
          <ChartModule label="QQQ in focus" />
        </Module>
        <ListModule rows={alertRows} subtitle="Action stack" title="Alerts" />
      </div>

      <div className="glass-secondary">
        <ListModule rows={flowRows} subtitle="Liquidity map" title="Flow" />
        <ListModule rows={equityRows} subtitle="Market tape" title="Equities" />
      </div>
    </div>
  );
}

function TapeWallMockup() {
  return (
    <div className="mockup-frame brutal-frame">
      <div className="brutal-banner">
        <div className="brutal-banner-copy">
          <span>Islandflow Overview</span>
          <h3>Watch the tape before the tape watches you.</h3>
        </div>
        <div className="brutal-badges">
          <span>Live mode</span>
          <span>Filter: SPY, NVDA, AAPL</span>
          <span>Replay hotkey ready</span>
        </div>
      </div>

      <div className="brutal-main">
        <Module subtitle="Count wall" title="Session totals">
          <MetricRack />
        </Module>

        <Module className="brutal-chart-module" subtitle="Center stage" title="Price pressure">
          <ChartModule label="SPY in focus" />
        </Module>
      </div>

      <div className="brutal-ribbons">
        <ListModule rows={alertRows} subtitle="Ribbon one" title="Alerts" />
        <ListModule rows={flowRows} subtitle="Ribbon two" title="Flow" />
        <ListModule rows={equityRows} subtitle="Ribbon three" title="Equities" />
      </div>
    </div>
  );
}

function FieldNotebookMockup() {
  return (
    <div className="mockup-frame notebook-frame">
      <div className="notebook-topbar">
        <div className="notebook-title">
          <span>Islandflow Research Board</span>
          <h3>Overview page as an analyst workbench</h3>
        </div>
        <div className="notebook-tabs">
          <span>Live</span>
          <span>Replay</span>
          <span>Filtered: NVDA / SPY / AAPL</span>
        </div>
      </div>

      <div className="notebook-layout">
        <div className="notebook-main">
          <Module className="notebook-chart-module" subtitle="Pinned chart" title="Price and events">
            <ChartModule label="AAPL in focus" />
          </Module>
          <Module subtitle="Margin notes" title="What to notice">
            <div className="notebook-callouts">
              <div className="notebook-callout">
                <span>Alert bias</span>
                <strong>Bullish momentum concentrated in tech.</strong>
              </div>
              <div className="notebook-callout">
                <span>Flow quality</span>
                <strong>Packet clustering suggests institutional pacing.</strong>
              </div>
              <div className="notebook-callout">
                <span>Replay use</span>
                <strong>Good for post-close annotation and handoff.</strong>
              </div>
            </div>
          </Module>
        </div>

        <div className="notebook-notes">
          <ListModule rows={alertRows} subtitle="Sticky note A" title="Alerts" />
          <ListModule rows={flowRows} subtitle="Sticky note B" title="Flow" />
          <ListModule rows={equityRows} subtitle="Sticky note C" title="Equities" />
        </div>
      </div>
    </div>
  );
}

export default function ConceptsPage() {
  const fontVariables = [
    brutal.variable,
    editorialDisplay.variable,
    conceptSans.variable,
    editorialBody.variable,
    condensed.variable,
    future.variable,
    notebook.variable
  ].join(" ");

  return (
    <div className={`${fontVariables} page-shell concepts-page`}>
      <header className="page-header concepts-header">
        <div>
          <p className="concepts-eyebrow">Frontend redesign study</p>
          <h1 className="page-title">Five Overview concepts for Islandflow</h1>
          <p className="concepts-lead">
            Each concept keeps the same product story intact: filter controls, live or replay mode,
            chart context, alerts, flow packets, and equities tape. What changes is the visual
            system, layout logic, and the feeling of operating the page.
          </p>
        </div>
        <div className="page-actions">
          <Link className="terminal-button" href="/">
            Current overview
          </Link>
        </div>
      </header>

      <section className="concepts-intro">
        <div className="concepts-intro-card">
          <h2 className="concepts-intro-title">What stays consistent</h2>
          <p>
            Every direction below preserves the same core modules and the same analyst workflow.
            These are presentation explorations, not product scope changes.
          </p>
        </div>

        <div className="concept-anchors">
          {conceptSummary.map((concept) => (
            <a className="concept-anchor" href={`#${concept.id}`} key={concept.id}>
              <span>{concept.index}</span>
              <strong>{concept.title}</strong>
              <small>{concept.style}</small>
            </a>
          ))}
        </div>
      </section>

      <ConceptSection
        className="concept-mission"
        designChoices={[
          "Dark industrial palette with amber accents, condensed headings, and mono metadata to feel like a serious command surface.",
          "Chart-first asymmetry gives the overview page a clear hierarchy: monitor price action, then scan alerts and packets, then glance at equities.",
          "Compact operator panels keep high-density content readable without flattening everything into identical cards."
        ]}
        id="concept-1"
        index="01"
        label="Dark command center"
        responsive={[
          "Desktop uses a wide mission grid where the chart owns the left side and secondary queues stack on the right for fast peripheral scanning.",
          "Mobile collapses into a single priority stack with metrics first, chart second, and action feeds grouped by urgency so the screen never feels cramped."
        ]}
        summary="A sharper, more cinematic take on the existing terminal metaphor. This is the closest to a pro desk, but with stronger hierarchy and fewer visually equal surfaces."
        title="Mission Control"
      >
        <MissionControlMockup />
      </ConceptSection>

      <ConceptSection
        className="concept-editorial"
        designChoices={[
          "A light editorial theme reframes the dashboard as a readable market briefing rather than a pure execution console.",
          "Serif display typography, column structure, and calmer spacing make replay sessions and post-market reviews feel more thoughtful.",
          "The same modules are presented like lead story plus supporting columns, which helps users understand importance at a glance."
        ]}
        id="concept-2"
        index="02"
        label="Editorial financial desk"
        responsive={[
          "Desktop treats the chart as the front-page hero with three supporting columns below, preserving scanning order without overwhelming the user.",
          "Mobile turns those columns into a clean reading sequence: hero chart, editor note, alerts, flow, then equities, with generous spacing for thumb scrolling."
        ]}
        summary="A newsroom-inspired redesign that makes Islandflow feel like a premium market publication. It is calmer, brighter, and easier to read over long review sessions."
        title="Market Journal"
      >
        <MarketJournalMockup />
      </ConceptSection>

      <ConceptSection
        className="concept-glass"
        designChoices={[
          "Layered translucent panels and atmospheric gradients create a future-facing cockpit without sacrificing legibility.",
          "The chart floats at the center of the layout, while feed health and alert context orbit around it like instrumentation.",
          "Rounded geometry and softer contrast make this direction feel premium and modern, especially for demos or investor-facing moments."
        ]}
        id="concept-3"
        index="03"
        label="Futurist glass cockpit"
        responsive={[
          "Desktop uses a three-part aerial composition with the chart in the middle and support modules to either side, reinforcing a central command feel.",
          "Mobile turns the floating modules into stacked glass cards with larger touch targets and reduced translucency so readability holds up outdoors and on glare-heavy screens."
        ]}
        summary="A more aspirational interface direction built around depth, blur, and glowing instrumentation. The product feels advanced without drifting into novelty."
        title="Aurora Glass"
      >
        <AuroraGlassMockup />
      </ConceptSection>

      <ConceptSection
        className="concept-brutal"
        designChoices={[
          "Oversized headlines, hard borders, and high-contrast color blocks turn the page into a signal board with attitude.",
          "The layout is intentionally loud: totals hit first, the chart becomes a billboard, and the queues read like tape ribbons.",
          "This direction favors decisiveness and memorability over subtlety, making it the boldest concept in the set."
        ]}
        id="concept-4"
        index="04"
        label="Brutalist signal board"
        responsive={[
          "Desktop keeps the giant headline and billboard chart while turning the lower ribbons into equal-width scan lanes for alerts, flow, and equities.",
          "Mobile preserves the graphic energy but reduces typographic scale, converts ribbons into stacked slabs, and keeps high contrast for quick glanceability."
        ]}
        summary="A poster-like redesign with aggressive typography and rigid modularity. It is meant to feel unmistakable and high-energy the moment it loads."
        title="Tape Wall"
      >
        <TapeWallMockup />
      </ConceptSection>

      <ConceptSection
        className="concept-notebook"
        designChoices={[
          "Warm neutrals, paper textures, and typewriter accents make the interface feel like a strategist's annotated desk instead of a machine room.",
          "Pinned callouts and note-card modules support interpretation, which is useful when the page is used for research, teaching, or end-of-day handoff.",
          "The chart remains central, but the surrounding content is framed as observations and evidence rather than alerts alone."
        ]}
        id="concept-5"
        index="05"
        label="Analyst workbench"
        responsive={[
          "Desktop behaves like a split research spread with one side for chart analysis and the other for callouts and modular notes.",
          "Mobile turns each pinned note into a full-width card and preserves the annotation feel by keeping short labeled sections rather than dense control strips."
        ]}
        summary="A softer research-oriented direction that makes Islandflow feel deeply human and collaborative. This one is the best fit for annotation-heavy workflows."
        title="Field Notebook"
      >
        <FieldNotebookMockup />
      </ConceptSection>
    </div>
  );
}
