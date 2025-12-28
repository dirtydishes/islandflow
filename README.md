# Real-Time Options Flow & Off-Exchange Analysis

This repository contains a real-time market-flow analysis platform focused on **options flow**, **off-exchange equity trades**, and **inferred institutional behavior**, built for low-latency, explainable analysis rather than black-box signals.

The system ingests real-time options trades/quotes and equity prints, clusters raw activity into higher-level flow events (sweeps, spreads, rolls, ladders), applies rule-first classifiers, and visualizes the results through a high-performance, TradingView-smooth interface with full replay and backtesting support.

## CURRENT STATE (Plan Progress)

Plan progress (rough): [####------]

Done now (in repo):
- Bun monorepo + infra docker compose (ClickHouse, Redis, NATS JetStream)
- Shared event schemas + logging + config helpers
- Synthetic options/equity prints published to NATS and persisted to ClickHouse
- Deterministic option FlowPacket clustering (time window) + persistence
- API: REST for prints/flow packets, WS for live options/equities/flow, replay endpoints
- UI: live tapes for options/equities/flow + replay toggle + pause controls

In progress / blocked:
- Real data adapters (requires licensed data source)
- Rolling stats and advanced clustering

Not started:
- Classifiers + alert scoring
- Dark pool inference
- Candle service and chart overlays
- Auth / secure deployment

## Core Principles

- **Explainability first** — every alert and signal is backed by observable data and explicit logic.
- **Event-sourced architecture** — all raw and derived events are persisted and replayable.
- **Market microstructure correctness** — conservative handling of aggressor inference, OI, and off-exchange prints.
- **Low-latency, tangible UX** — smooth real-time interaction that feels like an instrument panel, not a spreadsheet.

## Current Capabilities

- Synthetic options/equity prints with deterministic sequencing
- Raw event persistence in ClickHouse + streaming via NATS JetStream
- Deterministic option FlowPacket clustering (time-window)
- API gateway with REST, WS, and replay endpoints
- UI tapes for options/equities/flow packets with live/replay toggle and pause controls

## Planned Capabilities (from PLAN.md)

- Real-time licensed market data ingestors (options + equities)
- Rule-first classifiers and alert scoring
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

Start everything (infra + services + web):
- `bun run dev`

Run just the web app (auto-picks a free port in 3001-3005):
- `bun --cwd apps/web run dev`

Run just the API:
- `bun --cwd services/api run dev`

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
