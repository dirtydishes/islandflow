# Real-Time Options Flow & Off-Exchange Analysis

This repository contains a Bun + TypeScript monorepo for a personal-use, event-sourced market microstructure research platform focused on:

- options prints + NBBO,
- off-exchange equity prints,
- explainable rule-based flow classification,
- deterministic replay,
- evidence-linked UI inspection.

## Current Implementation Status

Implemented now:

- Bun workspaces with shared packages for schemas, bus, config, observability, and ClickHouse access.
- Infra orchestration via Docker Compose (NATS JetStream, ClickHouse, Redis).
- Options ingest service with adapters:
  - synthetic stream,
  - Alpaca options (dev-focused, bounded contracts),
  - IBKR bridge (Python sidecar),
  - Databento historical replay adapter (Python sidecar).
- Equities ingest service with adapters:
  - synthetic stream,
  - Alpaca equities trades/quotes.
- Compute service:
  - deterministic option print clustering into `FlowPacket`s,
  - NBBO join quality features and aggressor-mix metrics,
  - rolling baselines in Redis,
  - structure summarization and structure packet emission,
  - rule-based classifiers + confidence-scored alert events,
  - dark-style inferred events from equity prints/quotes,
  - equity print-to-quote join events.
- Candles service:
  - server-side equity candle aggregation,
  - ClickHouse persistence,
  - optional Redis hot cache,
  - NATS publication.
- Replay service:
  - deterministic republishing from ClickHouse to NATS,
  - multi-stream merge with stable tie-break ordering,
  - speed/start/end controls.
- API service:
  - REST endpoints for recent + cursor pagination,
  - REST range endpoints for chart windows,
  - REST replay-oriented endpoints,
  - WebSocket channels for options, NBBO, equities, quotes, joins, flow, classifier hits, alerts, inferred dark, and candles.
- Next.js web app:
  - live tape/workspace views,
  - replay controls and status,
  - signals and chart-focused routes,
  - evidence-centric terminal UI.
- Refdata + EOD enricher service entrypoints are present but currently scaffolds (lifecycle/logging only).

Planned / not yet complete:

- production-grade licensed feed integrations and entitlement workflow,
- richer refdata/corp-action enrichment,
- secure deployment/auth hardening,
- deeper structure + calibration workflows from `PLAN.md`.

## Core Principles

- **Explainability first** — inferred outputs are evidence-backed and human-readable.
- **Event sourcing** — raw and derived events persist to support replay.
- **Determinism** — replay behavior tracks live pipeline logic.
- **Microstructure awareness** — bounded joins, confidence scoring, and explicit uncertainty.
- **Bun-first tooling** — runtime/package/scripts all use Bun.

## Monorepo Layout

- `apps/web` — Next.js UI shell/routes.
- `services/ingest-options` — options print/NBBO ingest adapters.
- `services/ingest-equities` — equity print/quote ingest adapters.
- `services/compute` — clustering, structures, classifiers, alerts, inferred dark.
- `services/candles` — server-side candle aggregation + cache.
- `services/replay` — ClickHouse → NATS replay streamer.
- `services/api` — REST + WebSocket gateway.
- `services/refdata` — scaffold service.
- `services/eod-enricher` — scaffold service.
- `packages/types` — shared event schemas/types.
- `packages/storage` — ClickHouse tables/queries.
- `packages/bus` — NATS/JetStream helpers.
- `packages/config` — env parsing.
- `packages/observability` — logger + metrics facade.

## Build and Run

Install dependencies:

- `bun install`

Start infrastructure only:

- `docker compose up -d`

Create env file:

- copy `.env.example` to `.env` and set provider credentials as needed.

Start infra + all services + web:

- `bun run dev`

Start services only (assumes infra is already running):

- `bun run dev:services`

Start web only:

- `bun run dev:web`

## Environment Configuration

All runtime configuration comes from `.env`.

### Core infrastructure

- `NATS_URL` (default `nats://127.0.0.1:4222`)
- `CLICKHOUSE_URL` (default `http://127.0.0.1:8123`)
- `CLICKHOUSE_DATABASE` (default `default`)
- `REDIS_URL` (default `redis://127.0.0.1:6379`)

### Ingest adapter selection

- `OPTIONS_INGEST_ADAPTER` (`synthetic` | `alpaca` | `ibkr` | `databento`)
- `EQUITIES_INGEST_ADAPTER` (`synthetic` | `alpaca`)
- `EMIT_INTERVAL_MS` (synthetic emit cadence)

### Options adapter settings

- Alpaca: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_REST_URL`, `ALPACA_WS_BASE_URL`, `ALPACA_FEED`, `ALPACA_UNDERLYINGS`, `ALPACA_STRIKES_PER_SIDE`, `ALPACA_MAX_DTE_DAYS`, `ALPACA_MONEYNESS_PCT`, `ALPACA_MONEYNESS_FALLBACK_PCT`, `ALPACA_MAX_QUOTES`
- Databento: `DATABENTO_API_KEY`, `DATABENTO_DATASET`, `DATABENTO_SCHEMA`, `DATABENTO_NBBO_SCHEMA`, `DATABENTO_START`, `DATABENTO_END`, `DATABENTO_SYMBOLS`, `DATABENTO_STYPE_IN`, `DATABENTO_STYPE_OUT`, `DATABENTO_LIMIT`, `DATABENTO_PRICE_SCALE`, `DATABENTO_PYTHON_BIN`
- IBKR: `IBKR_HOST`, `IBKR_PORT`, `IBKR_CLIENT_ID`, `IBKR_SYMBOL`, `IBKR_EXPIRY`, `IBKR_STRIKE`, `IBKR_RIGHT`, `IBKR_EXCHANGE`, `IBKR_CURRENCY`, `IBKR_PYTHON_BIN`

### Equities adapter settings

- `ALPACA_EQUITIES_FEED` (`iex` or `sip`)

### Compute / classifiers / inference

- Delivery and windowing: `COMPUTE_DELIVER_POLICY`, `COMPUTE_CONSUMER_RESET`, `NBBO_MAX_AGE_MS`, `ROLLING_WINDOW_SIZE`, `ROLLING_TTL_SEC`
- Classifiers: `CLASSIFIER_SWEEP_MIN_PREMIUM`, `CLASSIFIER_SWEEP_MIN_COUNT`, `CLASSIFIER_SWEEP_MIN_PREMIUM_Z`, `CLASSIFIER_SPIKE_MIN_PREMIUM`, `CLASSIFIER_SPIKE_MIN_SIZE`, `CLASSIFIER_SPIKE_MIN_PREMIUM_Z`, `CLASSIFIER_SPIKE_MIN_SIZE_Z`, `CLASSIFIER_Z_MIN_SAMPLES`, `CLASSIFIER_MIN_NBBO_COVERAGE`, `CLASSIFIER_MIN_AGGRESSOR_RATIO`, `CLASSIFIER_0DTE_MAX_ATM_PCT`, `CLASSIFIER_0DTE_MIN_PREMIUM`, `CLASSIFIER_0DTE_MIN_SIZE`
- Dark inference: `EQUITY_QUOTE_MAX_AGE_MS`, `DARK_INFER_WINDOW_MS`, `DARK_INFER_COOLDOWN_MS`, `DARK_INFER_MIN_BLOCK_SIZE`, `DARK_INFER_MIN_ACCUM_SIZE`, `DARK_INFER_MIN_ACCUM_COUNT`, `DARK_INFER_MIN_PRINT_SIZE`, `DARK_INFER_MAX_EVIDENCE`, `DARK_INFER_MAX_SPREAD_PCT`

### Candles

- `CANDLE_INTERVALS_MS`, `CANDLE_MAX_LATE_MS`, `CANDLE_CACHE_LIMIT`, `CANDLE_DELIVER_POLICY`, `CANDLE_CONSUMER_RESET`

### API

- `API_PORT`, `REST_DEFAULT_LIMIT`
- `LIVE_LIMIT_OPTIONS`, `LIVE_LIMIT_NBBO`, `LIVE_LIMIT_EQUITIES`, `LIVE_LIMIT_EQUITY_JOINS`, `LIVE_LIMIT_FLOW`, `LIVE_LIMIT_CLASSIFIER_HITS`, `LIVE_LIMIT_ALERTS`, `LIVE_LIMIT_INFERRED_DARK` (bounded live generic cache depths; defaults `10000`, max `100000`)

### Web live retention

- `NEXT_PUBLIC_LIVE_HOT_WINDOW` (frontend hot live window cap; default `2000`)
- `NEXT_PUBLIC_PINNED_EVIDENCE_TTL_MS` (pinned evidence TTL; default `1200000`)
- `NEXT_PUBLIC_PINNED_EVIDENCE_MAX_ITEMS` (pinned evidence cache guardrail; default `4000`)

### Replay service

- `REPLAY_ENABLED`, `REPLAY_STREAMS`, `REPLAY_START_TS`, `REPLAY_END_TS`, `REPLAY_SPEED`, `REPLAY_BATCH_SIZE`, `REPLAY_LOG_EVERY`

### Testing-mode throttling

- `TESTING_MODE`
- `TESTING_THROTTLE_MS`

## Quick Notes

- Python dependencies are required only for IBKR/Databento sidecars (`services/ingest-options/py/requirements.txt`).
- Candle construction is server-side; the client consumes prebuilt OHLC events.
- Live retention uses a two-tier model:
  - API/Redis maintain a bounded hot cache per live generic channel.
  - UI keeps a bounded hot window for rendering performance.
  - Alert/drawer evidence is pinned and hydrated by id/trace so details remain inspectable after hot-window eviction.
- This repository is for personal, non-redistributed usage.
