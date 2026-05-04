![Islandflow logo](assets/logo.png)

![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-b91c1c?style=for-the-badge)

# Real-Time Options Flow & Off-Exchange Analysis

> **Pre-alpha warning** This project is in an early pre-alpha state. It will not perform consistently or as expected, and APIs, behavior, and data contracts may change without notice.

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

| Variable | Default | What it controls |
| --- | --- | --- |
| `NATS_URL` | `nats://127.0.0.1:4222` | JetStream broker address used by all services. |
| `CLICKHOUSE_URL` | `http://127.0.0.1:8123` | ClickHouse HTTP endpoint for reads/writes. |
| `CLICKHOUSE_DATABASE` | `default` | ClickHouse database/schema name. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis endpoint for rolling stats, live caches, and candle cache. |

### Ingest selection and synthetic behavior

| Variable | Default | What it controls |
| --- | --- | --- |
| `OPTIONS_INGEST_ADAPTER` | `synthetic` | Options ingest source: `synthetic`, `alpaca`, `ibkr`, or `databento`. |
| `EQUITIES_INGEST_ADAPTER` | `synthetic` | Equities ingest source: `synthetic` or `alpaca`. |
| `EMIT_INTERVAL_MS` | `1000` | Emit cadence for synthetic ingest adapters. |
| `SYNTHETIC_MARKET_MODE` | `realistic` | Shared synthetic profile (`realistic`, `active`, `firehose`) used when per-service override is unset. |
| `SYNTHETIC_OPTIONS_MODE` | empty | Options-only synthetic profile override; falls back to `SYNTHETIC_MARKET_MODE`. |
| `SYNTHETIC_EQUITIES_MODE` | empty | Equities-only synthetic profile override; falls back to `SYNTHETIC_MARKET_MODE`. |

Synthetic profile intent:
- `realistic`: default local mode with lower synthetic burstiness/noise.
- `active`: busier demo flow while still readable.
- `firehose`: stress mode for throughput/backpressure/hot-window behavior.

### Options ingest adapter configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `ALPACA_KEY_ID` | empty | Alpaca API key for options/equities adapters. Required when `*_INGEST_ADAPTER=alpaca`. |
| `ALPACA_SECRET_KEY` | empty | Alpaca API secret for options/equities adapters. Required when `*_INGEST_ADAPTER=alpaca`. |
| `ALPACA_REST_URL` | `https://data.alpaca.markets` | Alpaca REST base URL for contract discovery/reference calls. |
| `ALPACA_WS_BASE_URL` | `wss://stream.data.alpaca.markets/v1beta1` (options), `wss://stream.data.alpaca.markets` (equities) | Alpaca websocket base URL. |
| `ALPACA_FEED` | `indicative` | Options feed tier for Alpaca options (`indicative` or `opra`). |
| `ALPACA_UNDERLYINGS` | `SPY,NVDA,AAPL` | Comma-separated symbols targeted by Alpaca ingest. |
| `ALPACA_STRIKES_PER_SIDE` | `8` | Contracts selected per side of spot for Alpaca options chain sampling. |
| `ALPACA_MAX_DTE_DAYS` | `30` | Max days-to-expiry included for Alpaca options contract selection. |
| `ALPACA_MONEYNESS_PCT` | `0.06` | Primary moneyness filter for Alpaca options contract selection. |
| `ALPACA_MONEYNESS_FALLBACK_PCT` | `0.1` | Wider fallback moneyness filter if candidate set is too sparse. |
| `ALPACA_MAX_QUOTES` | `200` | Upper bound on selected Alpaca options contracts/quotes per cycle. |
| `ALPACA_EQUITIES_FEED` | `iex` | Alpaca equities feed (`iex` free tier, `sip` paid consolidated feed). |

### Databento replay adapter configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `DATABENTO_API_KEY` | empty | Databento API key. Required when `OPTIONS_INGEST_ADAPTER=databento`. |
| `DATABENTO_DATASET` | `OPRA.PILLAR` | Databento dataset name. |
| `DATABENTO_SCHEMA` | `trades` | Databento schema for options trade records. |
| `DATABENTO_NBBO_SCHEMA` | `tbbo` | Databento schema for options NBBO records. |
| `DATABENTO_START` | empty | Required replay start timestamp/string passed to sidecar. |
| `DATABENTO_END` | empty | Optional replay end timestamp/string. |
| `DATABENTO_SYMBOLS` | `ALL` | Symbol selection forwarded to Databento sidecar query. |
| `DATABENTO_STYPE_IN` | `raw_symbol` | Databento input symbology type. |
| `DATABENTO_STYPE_OUT` | `raw_symbol` | Databento output symbology type. |
| `DATABENTO_LIMIT` | `0` | Max Databento records (`0` means no explicit limit). |
| `DATABENTO_PRICE_SCALE` | `1` | Multiplier applied to decoded prices from sidecar output. |
| `DATABENTO_PYTHON_BIN` | `python3` | Python executable used to run Databento sidecar script. |

### IBKR options adapter configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `IBKR_HOST` | `127.0.0.1` | TWS/Gateway host for IBKR bridge. |
| `IBKR_PORT` | `7497` | TWS/Gateway port for IBKR bridge. |
| `IBKR_CLIENT_ID` | `0` | IBKR client id used by the bridge connection. |
| `IBKR_SYMBOL` | `SPY` | Underlying symbol requested from IBKR. |
| `IBKR_EXPIRY` | `20250117` | Option expiry (YYYYMMDD) requested from IBKR. |
| `IBKR_STRIKE` | `450` | Strike requested from IBKR. |
| `IBKR_RIGHT` | `C` | Option side (`C` or `P`). |
| `IBKR_EXCHANGE` | `SMART` | IBKR exchange routing code. |
| `IBKR_CURRENCY` | `USD` | Contract currency. |
| `IBKR_PYTHON_BIN` | `python3` | Python executable used for IBKR sidecar. |

### Options signal filtering

| Variable | Default | What it controls |
| --- | --- | --- |
| `OPTIONS_SIGNAL_MODE` | `smart-money` | Signal pass policy (`smart-money`, `balanced`, `all`) for options prints. |
| `OPTIONS_SIGNAL_MIN_NOTIONAL` | `10000` | Base minimum notional for most signal candidates. |
| `OPTIONS_SIGNAL_ETF_MIN_NOTIONAL` | `50000` | ETF-specific minimum notional for signal inclusion. |
| `OPTIONS_SIGNAL_BID_SIDE_MIN_NOTIONAL` | `25000` | Minimum notional for bid-side (`B`/`BB`) or sweep/ISO thresholds. |
| `OPTIONS_SIGNAL_MID_MIN_NOTIONAL` | `20000` | Minimum notional for non-sweep/non-ISO `MID` prints. |
| `OPTIONS_SIGNAL_NBBO_MAX_AGE_MS` | `1500` | NBBO freshness threshold used during signal classification. |
| `OPTIONS_SIGNAL_ETF_UNDERLYINGS` | `SPY,QQQ,IWM,DIA,TLT,GLD,SLV,XLF,XLE,XLV,XLI,XLP,XLU,XLY,SMH,ARKK` | Comma-separated underlyings treated as ETFs by signal filters. |

Default `smart-money` policy rejects lower-information prints and keeps high-confidence/high-notional/sweep-style flow; `balanced` lowers thresholds; `all` bypasses filtering.

### Compute/classifier/dark-inference configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `CLUSTER_WINDOW_MS` | `500` | Time window used to cluster nearby option prints into a packet candidate. |
| `COMPUTE_DELIVER_POLICY` | `new` | Consumer start policy for compute stream subscriptions (`new`, `all`, `last`, `last_per_subject`). |
| `COMPUTE_CONSUMER_RESET` | `false` | If true, resets durable consumer position for compute on startup. |
| `NBBO_MAX_AGE_MS` | `1000` | Max NBBO age accepted when enriching option prints in compute. |
| `ROLLING_WINDOW_SIZE` | `50` | Number of observations retained per rolling metric key. |
| `ROLLING_TTL_SEC` | `86400` | Redis TTL for rolling metric keys. |
| `EQUITY_QUOTE_MAX_AGE_MS` | `1000` | Max quote staleness when joining equity prints for inference. |
| `DARK_INFER_WINDOW_MS` | `60000` | Sliding window length for dark-style inference accumulation. |
| `DARK_INFER_COOLDOWN_MS` | `30000` | Cooldown before emitting repeated dark inferences for same symbol/pattern. |
| `DARK_INFER_MIN_BLOCK_SIZE` | `2000` | Minimum single-print size for block-style dark inference evidence. |
| `DARK_INFER_MIN_ACCUM_SIZE` | `3000` | Minimum aggregate size for accumulation-style dark inference evidence. |
| `DARK_INFER_MIN_ACCUM_COUNT` | `4` | Minimum print count for accumulation-style dark inference. |
| `DARK_INFER_MIN_PRINT_SIZE` | `200` | Minimum print size considered as dark inference evidence. |
| `DARK_INFER_MAX_EVIDENCE` | `20` | Max evidence items attached to one inferred dark event. |
| `DARK_INFER_MAX_SPREAD_PCT` | `0.005` | Maximum spread percentage allowed for dark inference confidence. |
| `CLASSIFIER_SWEEP_MIN_PREMIUM` | `40000` | Minimum premium to trigger sweep classifier logic. |
| `CLASSIFIER_SWEEP_MIN_COUNT` | `3` | Minimum child prints in cluster for sweep classifier hit. |
| `CLASSIFIER_SWEEP_MIN_PREMIUM_Z` | `2` | Min premium z-score for sweep classifier confirmation. |
| `CLASSIFIER_SPIKE_MIN_PREMIUM` | `20000` | Minimum premium for spike classifier logic. |
| `CLASSIFIER_SPIKE_MIN_SIZE` | `400` | Minimum total size for spike classifier logic. |
| `CLASSIFIER_SPIKE_MIN_PREMIUM_Z` | `2.5` | Min premium z-score for spike classifier confirmation. |
| `CLASSIFIER_SPIKE_MIN_SIZE_Z` | `2` | Min size z-score for spike classifier confirmation. |
| `CLASSIFIER_Z_MIN_SAMPLES` | `12` | Minimum rolling sample count before z-score gating applies. |
| `CLASSIFIER_MIN_NBBO_COVERAGE` | `0.5` | Required fraction of prints in cluster with valid NBBO context. |
| `CLASSIFIER_MIN_AGGRESSOR_RATIO` | `0.55` | Minimum aggressor-side ratio for classifier confidence. |
| `CLASSIFIER_0DTE_MAX_ATM_PCT` | `0.01` | Max distance-from-ATM to qualify as near-ATM 0DTE event. |
| `CLASSIFIER_0DTE_MIN_PREMIUM` | `20000` | Minimum premium for 0DTE classifier events. |
| `CLASSIFIER_0DTE_MIN_SIZE` | `400` | Minimum size for 0DTE classifier events. |

### Candle service configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `CANDLE_INTERVALS_MS` | `60000,300000` | Comma-separated candle intervals generated from equity prints. |
| `CANDLE_MAX_LATE_MS` | `0` | Allowed lateness for out-of-order prints before candle rejection/roll policy applies. |
| `CANDLE_CACHE_LIMIT` | `2000` | Max cached candles per `(underlying, interval)` in Redis (`0` disables cache). |
| `CANDLE_DELIVER_POLICY` | `new` | Consumer start policy for candle service (`new`, `all`, `last`, `last_per_subject`). |
| `CANDLE_CONSUMER_RESET` | `false` | If true, resets candle durable consumer position on startup. |

### API + live cache configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `API_PORT` | `4000` | API service listen port. |
| `REST_DEFAULT_LIMIT` | `200` | Default record count when a REST endpoint omits `limit`. |
| `API_DELIVER_POLICY` | `new` | JetStream consumer start policy used by API live subscribers (`new`, `all`, `last`, `last_per_subject`). |
| `API_CONSUMER_RESET` | `false` | If true, API resets/recreates its live durable consumers on startup. |
| `LIVE_LIMIT_OPTIONS` | `10000` | In-memory/Redis live cache depth for options channel (clamped `1..100000`). |
| `LIVE_LIMIT_NBBO` | `10000` | Live cache depth for options NBBO channel (clamped `1..100000`). |
| `LIVE_LIMIT_EQUITIES` | `10000` | Live cache depth for equities channel (clamped `1..100000`). |
| `LIVE_LIMIT_EQUITY_QUOTES` | `10000` | Live cache depth for equity quotes channel (clamped `1..100000`). |
| `LIVE_LIMIT_EQUITY_JOINS` | `10000` | Live cache depth for equity join channel (clamped `1..100000`). |
| `LIVE_LIMIT_FLOW` | `10000` | Live cache depth for flow packet channel (clamped `1..100000`). |
| `LIVE_LIMIT_CLASSIFIER_HITS` | `10000` | Live cache depth for classifier hits channel (clamped `1..100000`). |
| `LIVE_LIMIT_ALERTS` | `10000` | Live cache depth for alerts channel (clamped `1..100000`). |
| `LIVE_LIMIT_INFERRED_DARK` | `10000` | Live cache depth for inferred dark channel (clamped `1..100000`). |

### Web client configuration (`NEXT_PUBLIC_*`)

| Variable | Default | What it controls |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | auto-detected (`window.location.origin` in browser; `http://127.0.0.1:4000` fallback) | Explicit base URL for API/WS calls from the web app. |
| `NEXT_PUBLIC_LIVE_HOT_WINDOW` | `2000` | Max hot-window items retained for non-options live streams in UI state (`100..100000`). |
| `NEXT_PUBLIC_LIVE_HOT_WINDOW_OPTIONS` | `25000` | Dedicated max hot-window items retained for options prints (`100..100000`). |
| `NEXT_PUBLIC_NBBO_MAX_AGE_MS` | `1000` | Frontend NBBO staleness threshold used for UI status/placement logic. |
| `NEXT_PUBLIC_LIVE_EQUITIES_SILENT_WARNING_MS` | `25000` | Delay before warning when equities stream is quiet (`5000..300000`). |
| `NEXT_PUBLIC_PINNED_EVIDENCE_TTL_MS` | `1200000` | TTL for pinned evidence objects in UI (`60000..7200000`). |
| `NEXT_PUBLIC_PINNED_EVIDENCE_MAX_ITEMS` | `4000` | Maximum pinned evidence cache size in UI (`100..50000`). |
| `NEXT_PUBLIC_FLOW_FILTER_PRESET` | `smart-money` | Default flow filter preset applied on page load (`smart-money`, `balanced`, `all`). |

### Replay and testing controls

| Variable | Default | What it controls |
| --- | --- | --- |
| `REPLAY_ENABLED` | `false` | Dev-script toggle: starts replay service in `bun run dev` when truthy. |
| `REPLAY_STREAMS` | `options,nbbo,equities,equity-quotes` | Replay stream selection (`all` or comma list of supported aliases). |
| `REPLAY_START_TS` | `0` | Replay lower-bound timestamp; `0` means from earliest stored data. |
| `REPLAY_END_TS` | `0` | Replay upper-bound timestamp; `0` means no explicit end bound. |
| `REPLAY_SPEED` | `1` | Replay speed multiplier relative to original event timing. |
| `REPLAY_BATCH_SIZE` | `200` | Batch fetch size per replay stream pull. |
| `REPLAY_LOG_EVERY` | `1000` | Progress log interval (emitted event count). |
| `TESTING_MODE` | `false` | Enables ingest publish throttling for deterministic/lower-volume test runs. |
| `TESTING_THROTTLE_MS` | `200` | Minimum delay between emitted events while `TESTING_MODE=true`. |

## Quick Notes

- Python dependencies are required only for IBKR/Databento sidecars (`services/ingest-options/py/requirements.txt`).
- Candle construction is server-side; the client consumes prebuilt OHLC events.
- Option prints now persist as enriched raw rows and can be queried as either:
  - `view=signal` — default live/UI path and compute input.
  - `view=raw` — audit/debug path that preserves every stored print.
- The default Tape page options/packets posture is now stock-only, hides `B` / `BB`, keeps calls and puts visible, and applies in-memory min-notional controls immediately.
- Live retention uses a two-tier model:
  - ClickHouse is durable server history; Redis is a bounded hot cache per live generic channel.
  - `LIVE_LIMIT_*` controls initial snapshot/hot-cache depth, not total persisted history.
  - Browser state is only a rendering window and UI preferences, not a market-data database.
  - Devices connected to the same API hydrate from the same server-seen history.
  - UI keeps a bounded hot window for rendering performance around the signal view rather than raw noise.
  - Options prints can use a deeper dedicated cap via `NEXT_PUBLIC_LIVE_HOT_WINDOW_OPTIONS` without raising every other feed.
  - Alert/drawer evidence is pinned and hydrated by id/trace so details remain inspectable after hot-window eviction.
- Firehose-readiness strategy:
  - preserve raw ingest for storage/replay,
  - feed compute and default live UI from the filtered signal path,
  - add filterable live subscription contracts now so selective delivery can move server-side without reshaping the protocol later.
- This repository is for personal, non-redistributed usage.

## Useful Examples

Realistic local demo:

```bash
SYNTHETIC_MARKET_MODE=realistic \
OPTIONS_SIGNAL_MODE=smart-money \
bun run dev
```

Active demo:

```bash
SYNTHETIC_MARKET_MODE=active bun run dev
```

Firehose stress test:

```bash
SYNTHETIC_MARKET_MODE=firehose \
NEXT_PUBLIC_LIVE_HOT_WINDOW=2000 \
bun run dev
```

Show raw options flow for debugging:

```text
/prints/options?view=raw&security=all
/history/options?view=raw&security=all&before_ts=<ts>&before_seq=<seq>
/replay/options?view=raw&security=all&after_ts=<ts>&after_seq=<seq>
```
