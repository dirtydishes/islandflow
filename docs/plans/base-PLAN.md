# PLAN.md — Real-Time Options Flow & Off-Exchange Analysis Platform

## Purpose
Build a **real-time, non-delayed** market-flow analysis system for **personal use** that ingests options trades/quotes and equity prints, clusters raw activity into higher-level flow events, applies **explainable rule-first classifiers**, infers dark-pool-like behavior, and visualizes everything in a **TradingView-smooth** interface with full replay and backtesting.

---

## Non-Negotiables
- **Runtime & tooling:** Bun everywhere (services, scripts, dev, CI)
- **Language:** TypeScript
- **Frontend:** Next.js + React (App Router)
- **Realtime:** WebSockets (server → client)
- **Eventing:** NATS JetStream (default) or Redpanda (Kafka-compatible)
- **Storage:** ClickHouse (authoritative event log + analytics), Redis (hot state)
- **Charting:** TradingView Lightweight Charts + custom Canvas/WebGL overlays
- **Scope:** Personal, non-delayed use only (no redistribution)

---

## Guiding Principles
- **Explainability first:** every alert links to evidence and explicit logic.
- **Event-sourced:** raw and derived events are persisted and replayable.
- **Microstructure correctness:** conservative inference, explicit confidence.
- **Low latency UX:** smooth pan/zoom, minimal main-thread work.
- **Determinism:** live behavior equals replay behavior.

---

## High-Level Architecture
**Sources → Ingest → Event Bus → Compute → Storage → API/WS → UI**

- Sources: options trades/quotes (OPRA-derived via licensed source), equity trades/quotes (incl. off-exchange flags)
- Ingest services normalize and publish immutable events
- Compute clusters prints, computes rolling stats, runs classifiers, emits alerts and inferred events
- ClickHouse stores everything; Redis serves hot joins/baselines
- API/WS streams curated live data and serves historical queries
- Next.js UI renders live terminals and charts

---

## Monorepo Layout (Bun workspaces)

apps/
web/                 # Next.js UI (flow, charts, alerts)
services/
ingest-options/      # Options feed adapters (trades + NBBO)
ingest-equities/     # Equity trades/quotes ingestion
compute/             # Clustering, stats, classifiers, inference
candles/             # Server-side candle aggregation
refdata/             # Symbols, chains, corp actions
eod-enricher/        # OI + metadata snapshots
api/                 # REST + WebSocket gateway
packages/
types/               # Shared TS types + zod schemas
ui/                  # Design system + motion primitives
chart/               # Chart wrappers + overlay renderers

---

## Core Event Schemas (canonical)
- `OptionPrint` `{ ts, option_contract_id, price, size, exchange, conditions }`
- `OptionNBBO` `{ ts, option_contract_id, bid, ask, bidSize, askSize }`
- `EquityPrint` `{ ts, underlying_id, price, size, exchange, offExchangeFlag }`
- `EquityQuote` `{ ts, underlying_id, bid, ask }`
- `FlowPacket` `{ id, members[], features{}, join_quality{} }`
- `ClassifierHit` `{ classifier_id, confidence, direction, explanations[] }`
- `AlertEvent` `{ score, severity, hits[], evidence_refs[] }`
- `InferredDarkEvent` `{ type, confidence, evidence_refs[] }`

All events include `{ source_ts, ingest_ts, seq, trace_id }`.

---

## Epic 1 — Repo Scaffold & Infra (Day 1)
**Build**
- Initialize Bun monorepo; Docker compose for ClickHouse, Redis, NATS.
- Shared config, logging (JSON), metrics hooks.
- Define zod schemas + TS types.

**Acceptance**
- `bun run dev` boots infra + empty services + web shell.

---

## Epic 2 — Realtime Ingestion (Days 2–4)
### Options Ingestor
- Adapter interface: connect/subscribe/onTrade/onNBBO.
- Normalize to `OptionPrint`/`OptionNBBO`; publish.

### Equity Ingestor
- Stream `EquityPrint`/`EquityQuote`; tag off-exchange when provided.

**Acceptance**
- Live events visible via CLI subscriber.
- Raw events persisted to ClickHouse.

---

## Epic 3 — Rolling Stats & Clustering (Days 4–7)
### Rolling Stats (Redis)
- Premium/size baselines (median/MAD or mean/std).
- Intraday curves; liquidity/spread penalties.

### Clustering
- Contract sweeps (250–2000ms windows).
- Adjacent-strike ladders.
- Multi-leg detection (spreads/straddles/rolls).

**Acceptance**
- Deterministic `FlowPacket` emission; replayable.

---

## Epic 4 — Classifiers & Alert Scoring (Days 7–10)
Implement rule-first classifiers (each returns confidence + explanation):
1. Large Bullish Call Sweep
2. Large Bearish Put Sweep
3. Large Call Sell (overwrite)
4. Large Put Sell (put write)
5. Unusual Contract Spike (z-score)
6. New Position Likely (vol/OI)
7. Closing/Unwind Likely
8. 0DTE Gamma Punch (ATM)
9. Far-Dated Conviction (60DTE+)
10. Straddle/Strangle (long/short vol)
11. Vertical Spread (debit/credit)
12. Roll Up/Down/Out
13. Multi-Strike Ladder Accumulation
14. No Follow-Through / Absorbed

**Alert Scoring**
- Weighted score from premium, aggressor, z-scores, structure bonus minus noise.
- Throttles, dedupe, cooldowns.

**Acceptance**
- Alerts fire with human-readable “why”; unit tests per classifier.

---

## Epic 5 — Dark Pool Inference (Days 10–12)
**Inference (derived, separate from raw)**
- Absorbed blocks
- Stealth accumulation
- Distribution
- Hidden liquidity zones

**Acceptance**
- `InferredDarkEvent` links to evidence windows and chart markers.

---

## Epic 6 — API & WebSockets (Days 12–14)
- REST: queries for prints, packets, inferred events; candle ranges.
- WS: channels for live flow, alerts, equity prints, inferred events.
- Backpressure aware fan-out.

**Acceptance**
- Stable live streaming under load.

---

## Epic 7 — UI: Live Terminals & Workspaces (Days 14–18)
- Live options flow terminal (virtualized, deep filters).
- Dark pool/off-exchange tape.
- Alerts center.
- Ticker workspace (flow + chart + tape).
- Tangible UX: motion, depth, blueprint grid.

**Acceptance**
- 60fps interaction while streaming.

---

## Epic 8 — Charting (Days 18–24)
**Base**
- TradingView Lightweight Charts (candles, volume, crosshair).

**Overlays**
- Off-exchange prints as circles (radius ~ sqrt(size)).
- Inferred events & classifier markers.
- Viewport-driven rendering; OffscreenCanvas when available.

**Acceptance**
- TV-smooth pan/zoom; overlays stay aligned.

---

## Epic 9 — Replay & Backtesting (Days 24–28)
- Replay mode re-streams from ClickHouse.
- Metrics: forward returns, hit rates, calibration.

**Acceptance**
- Live and replay share the same pipeline.

---

## ADDENDUM — Missing-but-Crucial Epics

### Epic 10 — Reference Data, Symbology & Corporate Actions
- Underlyings, option chains, OCC adjustments, corp actions.
- Canonical IDs; symbol normalizer.

**Acceptance**
- Splits/adjustments don’t break replay or joins.

### Epic 11 — EOD Enrichment (OI & Metadata)
- Nightly OI snapshots; provenance tagging.

**Acceptance**
- OI-based features reference correct snapshot date.

### Epic 12 — Time Sync, Ordering & Join Quality
- NTP/chrony; bounded join windows; join quality scores.

**Acceptance**
- Stable aggressor inference under replay.

### Epic 13 — Candle Aggregation Service
- Server-built 1s/5s/1m OHLCV; Redis hot cache.

**Acceptance**
- Candle queries <100ms for hot ranges.

### Epic 14 — Backpressure & Load Shedding
- Bounded queues; UI sampling; DLQ; replay namespace.

**Acceptance**
- System degrades gracefully during spikes.

### Epic 15 — Observability
- Metrics, structured logs, tracing IDs.

**Acceptance**
- End-to-end lag visible in one dashboard.

### Epic 16 — Secure Personal Deployment
- Auth (single-user), TLS, rate limits; no public endpoints.

**Acceptance**
- Anonymous access blocked; VPS-safe.

### Epic 17 — UX State: Saved Filters, Workspaces, Hotkeys
- Presets, layouts, evidence panel.

**Acceptance**
- One-click reproducibility of setups.

---

## Milestones
- **MVP-1:** realtime options flow, clustering, 10+ classifiers, live terminal.
- **MVP-2:** off-exchange prints, inferred DP events, chart overlays, alerts.
- **MVP-2.5:** candles, observability, backpressure, auth.
- **MVP-3:** replay/backtesting, metrics dashboards.

---

## Non-Goals
- No black-box predictions
- No profit guarantees
- No real-time redistribution

## Notes
- Market data usage must comply with provider terms.
- All inference is probabilistic and labeled as such.
