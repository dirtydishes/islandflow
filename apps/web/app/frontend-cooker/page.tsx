"use client";

import { useMemo, useState } from "react";
import styles from "./frontend-cooker.module.css";

const variations = [
  { id: "pit", name: "Open-Outcry Pit", rationale: "A loud exchange-floor command center optimized for immediate threat recognition and dense scan paths." },
  { id: "atlas", name: "Glass Atlas", rationale: "A calm geospatial intelligence room that makes flow feel mapped, layered, and explorable." },
  { id: "ledger", name: "Ivory Ledger", rationale: "A refined analyst notebook with editorial hierarchy for slower, higher-confidence review." },
  { id: "neon", name: "Neon Underpass", rationale: "A kinetic cyberpunk tape for traders who want momentum, heat, and speed above all." },
  { id: "paper", name: "Signal Gazette", rationale: "A newspaper-like briefing that turns raw options activity into a morning intelligence digest." }
];

const flowRows = [
  ["NVDA", "910C", "05-17", "$4.8M", "AA", "+92%", "Sweep"],
  ["TSLA", "175P", "05-10", "$2.1M", "BB", "−68%", "ISO"],
  ["AAPL", "205C", "06-21", "$1.4M", "A", "+41%", "Block"],
  ["SPY", "520P", "05-03", "$8.7M", "B", "−53%", "Split"],
  ["AMD", "162C", "05-24", "$910K", "AA", "+77%", "Sweep"]
];

function MiniChart({ variant }: { variant: string }) {
  return <div className={`${styles.chart} ${styles[`chart_${variant}`]}`} aria-label="Mock price and flow chart">
    {Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ height: `${24 + ((i * 17) % 58)}%`, animationDelay: `${i * 35}ms` }} />)}
    <b />
  </div>;
}

function AppMock({ id }: { id: string }) {
  return <main className={`${styles.mock} ${styles[id]}`}>
    <nav className={styles.productNav}>
      <strong>ISLANDFLOW</strong><span>Overview</span><span>Live Tape</span><span>Signals</span><span>Replay</span><button>Filter Flow</button>
    </nav>
    <section className={styles.hero}>
      <div><p className={styles.kicker}>Live Options Intelligence</p><h1>Unusual flow surfaced before the crowd.</h1><p className={styles.copy}>Representative redesign of the IslandFlow terminal: live status, option sweeps, inferred dark activity, classifier hits, and replay controls.</p></div>
      <div className={styles.statusCard}><span className={styles.liveDot}/>Connected · 1,284 msgs/min<br/><b>$42.6M</b><small> premium tracked in active window</small></div>
    </section>
    <section className={styles.metrics}>{["Alert score 87", "Bullish 62%", "Dark pool 14", "Stale feeds 0"].map(x => <article key={x}>{x}</article>)}</section>
    <section className={styles.workspace}>
      <div className={styles.primaryPanel}><div className={styles.panelHead}><h2>Flow Radar</h2><button>Pause Tape</button></div><MiniChart variant={id}/></div>
      <div className={styles.sidePanel}><h2>Classifier Hits</h2><div className={styles.alert}>High conviction: NVDA call sweep above ask with confirming equity print.</div><div className={styles.empty}>Empty state: no stale NBBO quotes in the last 15s.</div><div className={styles.loading}>Loading replay baseline…</div><div className={styles.error}>Error state: dark inference source delayed.</div></div>
    </section>
    <section className={styles.tableWrap}><table><thead><tr>{["Ticker", "Contract", "Expiry", "Notional", "Side", "Delta", "Condition"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{flowRows.map((r) => <tr key={r.join("")}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody></table></section>
  </main>;
}

export default function FrontendCooker() {
  const [active, setActive] = useState(0);
  const current = variations[active];
  const nav = useMemo(() => variations.slice(0, 5), []);
  return <div className={styles.cookerShell}>
    <aside className={styles.chrome}><div><p>Frontend Cooker</p><h2>{current.name}</h2><small>{current.rationale}</small></div><div className={styles.switcher}>{nav.map((v, i) => <button key={v.id} className={i === active ? styles.active : ""} onClick={() => setActive(i)}><b>{i + 1}</b><span>{v.name}</span></button>)}</div><footer>Target: IslandFlow trading terminal overview</footer></aside>
    <AppMock id={current.id}/>
  </div>;
}
