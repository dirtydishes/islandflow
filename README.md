# Real-Time Options Flow & Off-Exchange Analysis

This repository contains a real-time market-flow analysis platform focused on **options flow**, **off-exchange equity trades**, and **inferred institutional behavior**, built for low-latency, explainable analysis rather than black-box signals.

The system ingests real-time options trades/quotes and equity prints, clusters raw activity into higher-level flow events (sweeps, spreads, rolls, ladders), applies rule-first classifiers, and visualizes the results through a high-performance, TradingView-smooth interface with full replay and backtesting support.

## CURRENT STATE (Plan Progress)

Plan progress (rough): [#####-----]

Done now (in repo):
- Bun monorepo + infra docker compose (ClickHouse, Redis, NATS JetStream)
- Shared event schemas + logging + config helpers
- Synthetic options/equity prints (full S&P 500) published to NATS and persisted to ClickHouse
- Deterministic option FlowPacket clustering (time window) + persistence
- Rolling stats in Redis (premium/size/spread) with z-score features on FlowPackets
- FlowPacket structure tags (vertical/ladder/straddle/strangle) for multi-leg bursts
- Aggressor mix features (NBBO placement ratios) on FlowPackets
- Rule-first classifiers + alert scoring with ClickHouse persistence + WS/REST endpoints
- Structure packet emission with full constituent evidence + roll metadata
- Roll classifier surfaced from detected multi-leg roll structures
- API: REST for prints/flow packets/classifier hits/alerts, WS for live options/equities/flow/alerts/hits, replay endpoints
- API: equities prints range query endpoint for chart overlays and drill-down
- UI: live tapes for options/equities/flow + replay toggle + pause controls + replay time/completion
- UI: alerts + classifier hits panels, ticker filter, evidence drawer, severity strip
- UI chart overlays for off-exchange equity prints + classifier/dark markers with linked evidence drawer behavior
- Databento historical replay adapter (options) with symbol mapping
- Alpaca options adapter (dev-only, bounded contract list)
- Alpaca equities adapter (stocks trades/quotes via WS)
- IBKR options adapter (single-underlying bridge via `ib_insync`)
- Dark-pool-style inference (absorbed blocks, stealth accumulation, distribution) with WS/REST surfaces and UI list
- Testing-mode throttling for ingest to reduce CPU during local dev
- Alert scoring calibration updates for confidence/coverage-aware severity

In progress / blocked:
- Production-grade licensed live data feeds (beyond current dev/test bridges)
- Advanced clustering (spreads/rolls beyond basic structure tags)
- Expanded chart overlays and annotation density controls

Not started:
- Reference data/corporate action enrichment
- Auth / secure deployment

## Core Principles

- **Explainability first** — every alert and signal is backed by observable data and explicit logic.
- **Event-sourced architecture** — all raw and derived events are persisted and replayable.
- **Market microstructure correctness** — conservative handling of aggressor inference, OI, and off-exchange prints.
- **Low-latency, tangible UX** — smooth real-time interaction that feels like an instrument panel, not a spreadsheet.

## Current Capabilities

- Synthetic options/equity prints with deterministic sequencing across the S&P 500
- Ingest adapter seam (env-selected; options default `synthetic`, equities: `synthetic` or `alpaca`)
- Raw event persistence in ClickHouse + streaming via NATS JetStream
- Deterministic option FlowPacket clustering (time-window)
- Rolling stats baselines in Redis with z-score features on FlowPackets
- Basic multi-leg structure tagging on FlowPackets
- Aggressor mix features from NBBO placement on FlowPackets
- Classifiers + alert scoring (rule-first) with WS/REST endpoints
- Structure packet emission with roll-aware metadata and evidence lists
- Roll classifier (rule-based, explainable) emitted from structure packets
- API gateway with REST, WS, and replay endpoints
- Equities prints range REST endpoint for chart/time-window inspection
- Server-built equity candles (service + REST/WS surfaces)
- UI tapes for options/equities/flow packets + alerts/hits with live/replay toggle and pause controls
- Chart overlays for off-exchange prints, classifier markers, and dark-pool markers with evidence linking
- Alpaca options adapter (dev-only) with bounded contract selection
- IBKR options adapter (single-underlying bridge via Python sidecar)
- Databento historical replay adapter (options, Python sidecar)
- Dark-pool-style inference (absorbed blocks, stealth accumulation, distribution) with evidence links and replay

## Planned Capabilities (from PLAN.md)

- Real-time licensed market data ingestors (options + equities)
- Candle aggregation + chart overlays
- Replay/backtesting metrics and calibration
- Reference data, symbology, and corporate-action handling

## Tech Stack

- **Runtime & tooling:** Bun
- **Language:** TypeScript
- **Frontend:** Next.js + React
- **Realtime:** WebSockets
- **Event streaming:** NATS JetStream or Redpanda
- **Storage:** ClickHouse, Redis
- **Charting:** TradingView Lightweight Charts + custom canvas/WebGL overlays

## Repository Structure

apps/
web/
services/
ingest-options/
ingest-equities/
compute/
api/
packages/
types/
ui/
chart/

## Build and Run

Install dependencies:
- `bun install`

Start infra:
- `docker compose up -d`

Create env file:
- Copy `.env.example` to `.env` and fill in the API keys you plan to use.

Start everything (infra + services + web):
- `bun run dev`

Run just the web app (fixed to port 3000):
- `bun run dev:web`

Run just the API:
- `bun --cwd services/api run dev`

## Environment Configuration

All runtime configuration is driven by `.env`. Start by copying `.env.example` and edit the values you need. Defaults below match `.env.example` unless otherwise noted.

### Core infrastructure

These define how services connect to the event bus and storage backends. Documentation links are provided for convenience.

- `NATS_URL` (default `nats://localhost:4222`) — NATS JetStream endpoint. See [NATS](https://nats.io/) and [JetStream](https://docs.nats.io/nats-concepts/jetstream).  
- `CLICKHOUSE_URL` (default `http://localhost:8123`) — ClickHouse HTTP endpoint. See [ClickHouse](https://clickhouse.com/).  
- `CLICKHOUSE_DATABASE` (default `default`) — ClickHouse database name.  
- `REDIS_URL` (default `redis://localhost:6379`) — Redis endpoint for rolling stats. See [Redis](https://redis.io/).  

### Adapter selection

- `OPTIONS_INGEST_ADAPTER` (default `synthetic`) — options ingest adapter: `synthetic`, `alpaca`, `ibkr`, `databento`.  
- `EQUITIES_INGEST_ADAPTER` (default `synthetic`) — equities ingest adapter: `synthetic`, `alpaca`.  
- `EMIT_INTERVAL_MS` (default `1000`) — synthetic equities emit cadence.  

### Alpaca options adapter (dev-only)

Provider links: [Alpaca](https://alpaca.markets/), [Alpaca Market Data API](https://alpaca.markets/docs/api-references/market-data-api/).

- `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` — credentials.  
- `ALPACA_REST_URL` (default `https://data.alpaca.markets`) — REST endpoint.  
- `ALPACA_WS_BASE_URL` (default `wss://stream.data.alpaca.markets/v1beta1`) — streaming endpoint.  
- `ALPACA_FEED` (default `indicative`) — use `opra` when you have a subscription.  
- `ALPACA_EQUITIES_FEED` (default `iex`) — equities feed: `iex` (free) or `sip` (paid).  
- `ALPACA_UNDERLYINGS` (default `SPY,NVDA,AAPL`) — comma-separated list of symbols.  
- `ALPACA_STRIKES_PER_SIDE` (default `8`) — strikes per side around ATM.  
- `ALPACA_MAX_DTE_DAYS` (default `30`) — expiry horizon.  
- `ALPACA_MONEYNESS_PCT` (default `0.06`) — ATM band for strike selection.  
- `ALPACA_MONEYNESS_FALLBACK_PCT` (default `0.1`) — fallback band if strikes are sparse.  
- `ALPACA_MAX_QUOTES` (default `200`) — subscription size guardrail.  

### Databento historical replay adapter

Provider links: [Databento](https://databento.com/), [Databento API](https://databento.com/docs/api-reference).

- `DATABENTO_API_KEY` — API key.  
- `DATABENTO_DATASET` (default `OPRA.PILLAR`) — dataset.  
- `DATABENTO_SCHEMA` (default `trades`) — schema.  
- `DATABENTO_START` — ISO date/time start for replay.  
- `DATABENTO_END` — ISO date/time end (optional).  
- `DATABENTO_SYMBOLS` (default `SPY.OPT`) — comma list or dataset symbols.  
- `DATABENTO_STYPE_IN` (default `parent`) — input symbology type.  
- `DATABENTO_STYPE_OUT` (default `instrument_id`) — output symbology type.  
- `DATABENTO_LIMIT` (default `0`) — record cap (0 means no cap).  
- `DATABENTO_PRICE_SCALE` (default `1`) — divide raw price by this value.  
- `DATABENTO_PYTHON_BIN` (default `py/.venv/bin/python`) — Python executable for replay sidecar.  

### IBKR options adapter (Python sidecar)

Provider links: [Interactive Brokers](https://www.interactivebrokers.com/), [IBKR API docs](https://interactivebrokers.github.io/).

- `IBKR_HOST` (default `127.0.0.1`) — TWS/Gateway host.  
- `IBKR_PORT` (default `7497`) — TWS/Gateway port.  
- `IBKR_CLIENT_ID` (default `0`) — API client ID.  
- `IBKR_SYMBOL` (default `SPY`) — underlying symbol.  
- `IBKR_EXPIRY` (default `20250117`) — expiry in `YYYYMMDD`.  
- `IBKR_STRIKE` (default `450`) — strike price.  
- `IBKR_RIGHT` (default `C`) — option right (`C` or `P`).  
- `IBKR_EXCHANGE` (default `SMART`) — exchange route.  
- `IBKR_CURRENCY` (default `USD`) — currency.  
- `IBKR_PYTHON_BIN` (default `python3`) — Python executable for sidecar.  

### Compute + market-structure tuning

- `COMPUTE_DELIVER_POLICY` (default `new`) — consumer start behavior (`new` or `all`).  
- `COMPUTE_CONSUMER_RESET` (default `false`) — force consumer reset (skip backlog).  
- `NBBO_MAX_AGE_MS` (default `1000`) — max allowed NBBO age for joins.  
- `NEXT_PUBLIC_NBBO_MAX_AGE_MS` (default `1000`) — UI-visible NBBO age for display gating.  
- `ROLLING_WINDOW_SIZE` (default `50`) — rolling stats window length.  
- `ROLLING_TTL_SEC` (default `86400`) — rolling stats TTL in seconds.  

### Classifier thresholds

- `CLASSIFIER_SWEEP_MIN_PREMIUM` (default `40000`) — absolute sweep premium floor.  
- `CLASSIFIER_SWEEP_MIN_COUNT` (default `3`) — minimum leg count for sweeps.  
- `CLASSIFIER_SWEEP_MIN_PREMIUM_Z` (default `2`) — sweep premium z-score threshold.  
- `CLASSIFIER_SPIKE_MIN_PREMIUM` (default `20000`) — absolute spike premium floor.  
- `CLASSIFIER_SPIKE_MIN_SIZE` (default `400`) — absolute spike size floor.  
- `CLASSIFIER_SPIKE_MIN_PREMIUM_Z` (default `2.5`) — spike premium z-score threshold.  
- `CLASSIFIER_SPIKE_MIN_SIZE_Z` (default `2`) — spike size z-score threshold.  
- `CLASSIFIER_Z_MIN_SAMPLES` (default `12`) — minimum samples before z-scores apply.  
- `CLASSIFIER_MIN_NBBO_COVERAGE` (default `0.5`) — NBBO coverage ratio gate.  
- `CLASSIFIER_MIN_AGGRESSOR_RATIO` (default `0.55`) — aggressor ratio gate.  
- `CLASSIFIER_0DTE_MAX_ATM_PCT` (default `0.01`) — max ATM distance as pct of underlying for 0DTE gamma punch.  
- `CLASSIFIER_0DTE_MIN_PREMIUM` (default `20000`) — 0DTE gamma punch premium floor.  
- `CLASSIFIER_0DTE_MIN_SIZE` (default `400`) — 0DTE gamma punch size floor.  

### Replay service

- `REPLAY_ENABLED` (default `false`) — start the replay streamer when running `bun run dev`.  
- `REPLAY_STREAMS` (default `options,nbbo,equities,equity-quotes`) — comma list of streams to re-publish.  
- `REPLAY_START_TS` (default `0`) — start timestamp in ms since epoch (0 means beginning).  
- `REPLAY_END_TS` (default `0`) — end timestamp in ms since epoch (0 means no end).  
- `REPLAY_SPEED` (default `1`) — playback speed (1 = real-time, 2 = 2x, 0 = as fast as possible).  
- `REPLAY_BATCH_SIZE` (default `200`) — batch size per ClickHouse fetch.  
- `REPLAY_LOG_EVERY` (default `1000`) — log progress every N events.  

### Testing + throttling

- `TESTING_MODE` (default `false`) — enable ingest throttling for local dev.  
- `TESTING_THROTTLE_MS` (default `200`) — minimum spacing between emitted prints.  

Testing mode (throttles ingest to reduce CPU):
- `TESTING_MODE=true` enables throttling
- `TESTING_THROTTLE_MS=200` minimum spacing between emitted prints (per ingest service)

IBKR adapter (options, via Python `ib_insync`):
- Install Python deps: `python3 -m pip install -r services/ingest-options/py/requirements.txt`
- Set `OPTIONS_INGEST_ADAPTER=ibkr` and configure:
  - `IBKR_HOST`, `IBKR_PORT`, `IBKR_CLIENT_ID`
  - `IBKR_SYMBOL`, `IBKR_EXPIRY` (YYYYMMDD), `IBKR_STRIKE`, `IBKR_RIGHT`
  - Optional: `IBKR_EXCHANGE` (default `SMART`), `IBKR_CURRENCY` (default `USD`), `IBKR_PYTHON_BIN`

Alpaca adapter (options, dev-only bridge):
- Set `OPTIONS_INGEST_ADAPTER=alpaca` and configure:
  - `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`
  - `ALPACA_UNDERLYINGS` (comma-separated, default `SPY,NVDA,AAPL`)
  - Optional: `ALPACA_FEED` (`indicative` default, `opra` with subscription)
  - Optional: `ALPACA_MAX_QUOTES` (default `200`), `ALPACA_REST_URL`, `ALPACA_WS_BASE_URL`
  - Optional selection tuning: `ALPACA_STRIKES_PER_SIDE` (default `8`), `ALPACA_MAX_DTE_DAYS` (default `30`),
    `ALPACA_MONEYNESS_PCT` (default `0.06`), `ALPACA_MONEYNESS_FALLBACK_PCT` (default `0.10`)

Alpaca selection policy (dev-only, deterministic):
- Pick nearest weekly and nearest monthly expiries within 30 DTE (fallback to earliest expiries if missing)
- For each expiry, select 8 strikes per side closest to ATM within ±6% (fallback to ±10% if needed)
- Subscriptions are built once at startup to keep the stream bounded and repeatable

Databento historical replay adapter (options, via Python `databento`):
- Install Python deps: `python3 -m pip install -r services/ingest-options/py/requirements.txt`
- Set `OPTIONS_INGEST_ADAPTER=databento` and configure:
  - `DATABENTO_API_KEY`, `DATABENTO_START` (ISO date/time)
  - Optional: `DATABENTO_END`, `DATABENTO_DATASET` (default `OPRA.PILLAR`), `DATABENTO_SCHEMA` (default `trades`)
  - Optional: `DATABENTO_SYMBOLS` (`ALL` or comma list), `DATABENTO_STYPE_IN`/`DATABENTO_STYPE_OUT` (default `raw_symbol`)
  - Optional: `DATABENTO_LIMIT` (record cap), `DATABENTO_PRICE_SCALE` (divide raw price), `DATABENTO_PYTHON_BIN`
- This adapter replays historical data only; live capture will be added later.

Run tests:
- `bun test`

## Status

Active build for personal, non-delayed analytical use. Multi-user access and redistribution are intentionally out of scope.

## Non-Goals

- No black-box AI predictions
- No profit guarantees
- No real-time data redistribution
- No guessing at intent without evidence

## License / Usage

For research and personal analytical use.  
Market data usage is subject to the terms of the data providers.
