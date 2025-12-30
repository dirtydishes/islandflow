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
- Rule-first classifiers + alert scoring with ClickHouse persistence + WS/REST endpoints
- API: REST for prints/flow packets/classifier hits/alerts, WS for live options/equities/flow/alerts/hits, replay endpoints
- UI: live tapes for options/equities/flow + replay toggle + pause controls + replay time/completion
- UI: alerts + classifier hits panels, ticker filter, evidence drawer, severity strip
- Databento historical replay adapter (options) with symbol mapping
- Alpaca options adapter (dev-only, bounded contract list)
- Testing-mode throttling for ingest to reduce CPU during local dev

In progress / blocked:
- Live data adapters beyond dev-only feeds (requires licensed data source)
- Rolling stats and advanced clustering

Not started:
- Dark pool inference
- Candle service and chart overlays
- Auth / secure deployment

## Core Principles

- **Explainability first** — every alert and signal is backed by observable data and explicit logic.
- **Event-sourced architecture** — all raw and derived events are persisted and replayable.
- **Market microstructure correctness** — conservative handling of aggressor inference, OI, and off-exchange prints.
- **Low-latency, tangible UX** — smooth real-time interaction that feels like an instrument panel, not a spreadsheet.

## Current Capabilities

- Synthetic options/equity prints with deterministic sequencing across the S&P 500
- Ingest adapter seam (env-selected; options default `alpaca`, equities default `synthetic`)
- Raw event persistence in ClickHouse + streaming via NATS JetStream
- Deterministic option FlowPacket clustering (time-window)
- Classifiers + alert scoring (rule-first) with WS/REST endpoints
- API gateway with REST, WS, and replay endpoints
- UI tapes for options/equities/flow packets + alerts/hits with live/replay toggle and pause controls
- Alpaca options adapter (dev-only) with bounded contract selection
- Databento historical replay adapter (options, Python sidecar)

## Planned Capabilities (from PLAN.md)

- Real-time licensed market data ingestors (options + equities)
- Dark pool inference and evidence linking
- Candle aggregation + chart overlays
- Replay/backtesting metrics and calibration

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

Adapter selection (env):
- Options: `OPTIONS_INGEST_ADAPTER` (defaults to `alpaca`)
- Equities: `EQUITIES_INGEST_ADAPTER` (defaults to `synthetic`)
- Compute: `COMPUTE_DELIVER_POLICY` (`new` default), `COMPUTE_CONSUMER_RESET` (force skip backlog)

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
