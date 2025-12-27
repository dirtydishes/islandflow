# Real-Time Options Flow & Off-Exchange Analysis

This repository contains a real-time market-flow analysis platform focused on **options flow**, **off-exchange equity trades**, and **inferred institutional behavior**, built for low-latency, explainable analysis rather than black-box signals.

The system ingests real-time options trades/quotes and equity prints, clusters raw activity into higher-level flow events (sweeps, spreads, rolls, ladders), applies rule-first classifiers, and visualizes the results through a high-performance, TradingView-smooth interface with full replay and backtesting support.

## Core Principles

- **Explainability first** — every alert and signal is backed by observable data and explicit logic.
- **Event-sourced architecture** — all raw and derived events are persisted and replayable.
- **Market microstructure correctness** — conservative handling of aggressor inference, OI, and off-exchange prints.
- **Low-latency, tangible UX** — smooth real-time interaction that feels like an instrument panel, not a spreadsheet.

## What This Does

- Ingests real-time options market data (OPRA-derived via licensed sources)
- Ingests real-time equity trades and quotes, including off-exchange prints
- Clusters raw prints into parent flow events:
  - sweeps
  - ladders
  - spreads
  - rolls
- Applies rule-first classifiers:
  - large bullish/bearish sweeps
  - put selling / overwrites
  - volatility trades (straddles/strangles)
  - 0DTE gamma activity
  - far-dated conviction
- Infers dark-pool-like behavior (absorption, accumulation, distribution)
- Visualizes everything in real time with:
  - live flow terminals
  - off-exchange print overlays
  - inferred event markers
  - replayable charts

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
