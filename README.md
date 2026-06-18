![Islandflow logo](assets/logo.png)

![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-b91c1c?style=for-the-badge)

# Real-Time Options Flow & Off-Exchange Analysis

> **Pre-alpha warning** This project is in an early pre-alpha state. It will not perform consistently or as expected, and APIs, behavior, and data contracts may change without notice.

Islandflow is a Bun + TypeScript monorepo for a personal-use, event-sourced market microstructure research platform focused on:

- multi-source options/equities/news ingest (synthetic + live adapters),
- deterministic parent-event reconstruction over prints, quotes, and NBBO,
- explainable participant-style flow classification (not a single binary "smart money" flag),
- evidence-linked alerts, packet drilldowns, and context hydration,
- real-time + historical + replay delivery over REST and WebSocket,
- terminal-style inspection UI for tape, signals, charts, and news.

In its current state, Islandflow acts as an event-sourced intelligence layer on top of raw market microstructure events. Services publish and consume through NATS/JetStream, persist both raw and derived events in ClickHouse, and expose low-latency live feeds plus cursor-based history/replay APIs for research and operator workflows.

## Current Implementation Status

Implemented now:

- Bun workspaces with shared packages for schemas, bus, config, observability, and ClickHouse access.
- Infra orchestration via Docker Compose for local NATS JetStream, ClickHouse, and Redis.
- Options ingest service with synthetic, Alpaca options, IBKR bridge, and Databento historical replay adapters.
- Equities ingest service with synthetic and Alpaca equities trades/quotes adapters.
- News ingest service for Alpaca news backfill and websocket publication.
- Compute service for deterministic parent-event reconstruction, flow packets, NBBO quality features, rolling baselines, smart-money profile scoring, compatibility classifier hits, alerts, inferred dark-style events, and equity print-to-quote joins.
- Candles service for server-side equity candle aggregation, ClickHouse persistence, optional Redis hot cache, and NATS publication.
- Replay service for deterministic ClickHouse-to-NATS republishing with multi-stream merge, stable tie-break ordering, speed, start, and end controls.
- API service with REST endpoints, cursor pagination, replay/history endpoints, live hot-cache hydration, and WebSocket channels for options, NBBO, equities, quotes, joins, flow, classifier hits, alerts, smart-money events, inferred dark, candles, and news.
- Next.js web app upgraded to Next.js `16.2.6`, React `19.2.0`, and React DOM `19.2.0`.
- Evidence-centric terminal UI, live/replay controls, chart-focused routes, news view, profile-aware smart-money display, and alert-context hydration.
- Thin Electron desktop shell in `apps/desktop` that can wrap the hosted app or local web UI.
- Refdata + EOD enricher service entrypoints are present, with refdata able to validate or refresh the event-calendar cache.

Planned / not yet complete:

- production-grade licensed feed integrations and entitlement workflow,
- richer refdata/corp-action enrichment,
- secure deployment/auth hardening,
- native deployment unit templates and rollback helpers,
- signed/notarized desktop distribution and richer desktop-native features,
- deeper calibration workflows from `PLAN.md` and `SMART_MONEY_REBUILD_PLAN.md`.

## Core Principles

- **Explainability first**: inferred outputs are evidence-backed and human-readable.
- **Event sourcing**: raw and derived events persist to support replay.
- **Determinism**: replay behavior tracks live pipeline logic.
- **Microstructure awareness**: bounded joins, confidence scoring, and explicit uncertainty.
- **Taxonomy over folklore**: "smart money" is modeled as participant-style hypotheses, not a single binary label.
- **Bun-first tooling**: runtime, package management, scripts, and tests use Bun.

## How Print Classification Works (Current Approach)

Islandflow follows the same high-level philosophy captured in [`smartmoney.md`](smartmoney.md): the tape is informative but noisy, and a useful classifier should model multiple participant-style hypotheses instead of forcing every print into one "smart money" bucket.

Current flow in the compute pipeline:

1. **Ingest + normalize** options prints, NBBO, equity prints/quotes, and news into shared schemas.
2. **Reconstruct parent events** from child prints using bounded clustering windows, quote alignment, and structure-aware packet planning.
3. **Compute evidence features** such as aggressor side vs NBBO, premium/notional concentration, burst timing, quote freshness/coverage, DTE/moneyness context, and cross-signal linkage.
4. **Score profile hypotheses** including `institutional_directional`, `retail_whale`, `event_driven`, `vol_seller`, `arbitrage`, and `hedge_reactive`, with reason codes and confidence bands.
5. **Emit explainable artifacts** (`FlowPacket`, `SmartMoneyEvent`, `ClassifierHitEvent`, `AlertEvent`, inferred-dark events) for both live fanout and historical replay.

Important behavior:

- The classifier can **abstain** when evidence is weak.
- Suppression guards reduce known false positives (stale/missing quote context, special/complex print ambiguity, hedge-reactive or parity-like structure confusion).
- Compatibility endpoints remain available while newer smart-money semantics are first-class.

## Smart-Money Classification Taxonomy

Islandflow now emits first-class `SmartMoneyEvent` records instead of treating old classifier hits as the final semantic object. `FlowPacket` remains the clustering bridge, while smart-money events carry typed features, profile scores, confidence bands, directions, reason codes, abstention state, and suppression reasons.

Public profile IDs:

| Profile ID | Meaning | Common evidence |
| --- | --- | --- |
| `institutional_directional` | Large directional parent flow with stronger institutional-style conviction. | premium, size, sweep/burst behavior, aggressor imbalance, quote quality, not short-dated retail-chase context |
| `retail_whale` | Large retail-style speculative bursts, often short-dated or attention-driven. | short-dated OTM concentration, burst prints, IV shock, lower premium than institutional blocks |
| `event_driven` | Flow aligned to known upcoming events. | event-calendar proximity, expiry after event, pre-event concentration, spread/IV pressure |
| `vol_seller` | Premium-selling or short-volatility structure evidence. | sell-side premium, straddles/strangles, neutral direction |
| `arbitrage` | Multi-leg or symmetric structures with low directional exposure. | matched leg symmetry, same-size legs, near-flat directional bias |
| `hedge_reactive` | Hedge or dealer-reaction style flow around short-dated ATM/gamma context. | 0-2 DTE, near-ATM contracts, underlying move linkage, size |

Compatibility surfaces remain in place:

- `ClassifierHitEvent` is derived from `SmartMoneyEvent.primary_profile_id`.
- `AlertEvent` may include `primary_profile_id` and `profile_scores`.
- Legacy classifier and alert endpoints still work.

Primary smart-money access paths:

```text
/flow/smart-money
/history/smart-money
/replay/smart-money
/ws/smart-money
```

The classifier intentionally abstains when evidence is weak or quote context is stale/missing. Suppression guards cover stale quotes, complex/special prints, retail-frenzy directional confusion, hedge-reactive short-dated ATM contexts, and arbitrage symmetry.

## Monorepo Layout

- `apps/web` — Next.js UI shell/routes.
- `apps/desktop` — Electron desktop shell that loads the hosted or local Islandflow app.
- `services/ingest-options` — options print/NBBO ingest adapters.
- `services/ingest-equities` — equity print/quote ingest adapters.
- `services/ingest-news` — Alpaca news backfill and websocket ingest.
- `services/compute` — parent-event reconstruction, flow packets, smart-money scoring, alerts, inferred dark.
- `services/candles` — server-side candle aggregation + cache.
- `services/replay` — ClickHouse to NATS replay streamer.
- `services/api` — REST + WebSocket gateway.
- `services/refdata` — event-calendar validation/provider refresh scaffolding.
- `services/eod-enricher` — scaffold service.
- `packages/types` — shared event schemas/types.
- `packages/storage` — ClickHouse tables/queries.
- `packages/bus` — NATS/JetStream helpers.
- `packages/config` — env parsing.
- `packages/observability` — logger + metrics facade.
- `deployment/docker` — supported VPS Docker Compose runtime.
- `deployment/native` — experimental host-native Bun + systemd deployment notes.

## Build and Run

Install dependencies:

```bash
bun install
```

Start infrastructure only:

```bash
bun run dev:infra
```

Create env file:

```bash
cp .env.example .env
```

Start infra + all services + web:

```bash
bun run dev
```

Start services only, assuming infra is already running:

```bash
bun run dev:services
```

Start web only:

```bash
bun run dev:web
```

Recommended fast iteration loop:

```bash
bun run dev:infra
bun run dev:services
bun run dev:web
```

This keeps Docker in the local workflow where it helps most, for NATS, ClickHouse, and Redis, while keeping the app services in native Bun/Next.js loops.

## CI

Forgejo Actions under `.forgejo/workflows` are the canonical CI path for this repository.

The baseline workflow lives at `.forgejo/workflows/ci.yml` and runs on:

- pull requests,
- pushes to `main`,
- manual dispatches from the Forgejo Actions UI.

The fast `validate` job is intentionally limited to checks that already have good local signal:

- `bun install --frozen-lockfile`
- `bun test`
- `bun run check:docker-workspace`
- `bun --cwd=apps/web run build`

Runner expectations:

- Provide an `ubuntu-latest` label backed by Docker, for example `ubuntu-latest:docker://node:20-bookworm`.
- An optional alias such as `docker:docker://node:20-bookworm` is fine for future explicit targeting, but the baseline workflow only requires `ubuntu-latest`.
- The backing image must include Node.js because the checkout action is Node-based.

What this CI path does not cover yet:

- Docker image builds under `deployment/docker`
- NATS, Redis, or ClickHouse service-container integration coverage
- deployment, release, or coverage-reporting workflows

To rerun or troubleshoot a job in Forgejo:

- Open the repository's `Actions` tab.
- Select the `CI` workflow.
- Use `Run workflow` for a manual dispatch, or open an existing run and use the rerun action from that run page.

## Deployment Workflow

Docker remains the supported and recommended path for the current VPS.

```bash
./deploy main
./deploy main --runtime docker
./deploy current-branch
./deploy current-branch --runtime docker
```

Important deployment notes:

- Run the deploy helper from the local repo checkout, not from the VPS shell.
- Do not run the repo-root `docker-compose.yml` on the VPS. It is local infra only and can create duplicate exposed NATS, ClickHouse, and Redis containers on the server.
- The Docker stack lives in `deployment/docker` and is separate from local development infra.
- Partial deploys are supported with `--web-only`, `--api-only`, `--services-only`, `--workers-only`, `--fast`, `--no-build`, and `--force-recreate`.
- `--fast` defaults to a services-only Docker rollout when no explicit scope is provided and trims public API route-suite verification while preserving remote service health checks.
- `./deploy current-branch` requires a clean local working tree and pushes the branch before moving the server checkout.
- The helper has Forgejo-aware remote resolution for deployments and branch pushes.
- When run from `/home/delta/islandflow` on the VPS itself, `./deploy` can execute locally instead of SSHing back into the same server.
- Native deployment is opt-in and experimental:

```bash
./deploy main --runtime native
./deploy current-branch --runtime native
```

Native deployment expects Bun, systemd units, host-reachable infra, and deliberate reverse-proxy changes. Native deploys are intended primarily for worker-only fast iteration until the public edge is cut over deliberately.

Read more:

- `deployment/docker/README.md`
- `deployment/native/README.md`

## Desktop Shell

Islandflow includes a thin Electron desktop shell in `apps/desktop`.

What it is:

- a macOS-first wrapper around the hosted app at `https://flow.deltaisland.io`,
- a native app window plus packaging/distribution shell,
- a way to run the existing web UI inside Electron without local backend services.

What it is not yet:

- a bundled backend runtime,
- a packaged local Next.js frontend,
- a desktop feature layer with notifications, preferences, auto-updates, signing, or notarization.

Run the desktop shell against a local web UI:

```bash
bun run dev:desktop
```

Run the desktop shell directly against the hosted app:

```bash
bun run dev:desktop:remote
```

Package the desktop shell:

```bash
bun run package:desktop
bun run make:desktop
```

Desktop-specific environment:

- `ISLANDFLOW_DESKTOP_START_URL` is only used by the Electron shell and is restricted to trusted Islandflow app origins.
- `NEXT_PUBLIC_API_URL` remains the web app API/WebSocket origin control and usually points at `https://api.flow.deltaisland.io` when developing local UI inside Electron.

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
| `SYNTHETIC_MARKET_MODE` | `realistic` | Legacy load alias used before the hosted control is changed: `realistic` -> `steady`, `active` -> `active`, `firehose` -> `firehose`. |
| `SYNTHETIC_OPTIONS_MODE` | empty | Options-only legacy load alias override. |
| `SYNTHETIC_EQUITIES_MODE` | empty | Equities-only legacy load alias override. |
| `SYNTHETIC_CONTROL_ENABLED` | `false` | Enables the protected synthetic admin API when both hosted ingest adapters are synthetic. |
| `SYNTHETIC_ADMIN_TOKEN` | empty | Bearer token required by the API and web proxy for synthetic admin requests. |
| `NEXT_PUBLIC_SYNTHETIC_ADMIN` | `0` | Shows the internal synthetic control drawer in the web app when set to `1`. |

Named demo profiles live in `@islandflow/synthetic-market/profiles`. The default `market-command` profile cycles deterministic scenario runs such as `phase03-a`, `phase03-b`, `phase03-f`, and `phase03-g`. Load profiles change playback cadence and repeated run count only: `steady` emits one run per base interval, `active` halves the interval, and `firehose` uses a quarter interval with two named runs per tick.

### Alpaca and news configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `ALPACA_API_KEY` | empty | Legacy single-token fallback kept for older Alpaca setups. Prefer explicit key ID + secret vars for current Alpaca auth. |
| `ALPACA_API_KEY_ID` | empty | Preferred Alpaca key ID used for market-data REST and websocket auth. |
| `ALPACA_KEY_ID` | empty | Alternate name accepted for the Alpaca key ID. |
| `ALPACA_API_SECRET_KEY` | empty | Preferred Alpaca secret key paired with `ALPACA_API_KEY_ID`. |
| `ALPACA_SECRET_KEY` | empty | Alternate name accepted for the Alpaca secret key. |
| `ALPACA_REST_URL` | `https://data.alpaca.markets` | Alpaca REST base URL. |
| `ALPACA_WS_BASE_URL` | `wss://stream.data.alpaca.markets/v1beta1` for options, `wss://stream.data.alpaca.markets` for equities/news | Alpaca websocket base URL. |
| `ALPACA_FEED` | `indicative` | Options feed tier: `indicative` or `opra`. |
| `ALPACA_UNDERLYINGS` | `SPY,NVDA,AAPL` | Comma-separated symbols targeted by Alpaca ingest. |
| `ALPACA_STRIKES_PER_SIDE` | `8` | Contracts selected per side of spot for Alpaca options chain sampling. |
| `ALPACA_MAX_DTE_DAYS` | `30` | Max days-to-expiry included for Alpaca options contract selection. |
| `ALPACA_MONEYNESS_PCT` | `0.06` | Primary moneyness filter for Alpaca options contract selection. |
| `ALPACA_MONEYNESS_FALLBACK_PCT` | `0.1` | Wider fallback moneyness filter if candidate set is too sparse. |
| `ALPACA_MAX_QUOTES` | `200` | Upper bound on selected Alpaca options contracts/quotes per cycle. |
| `ALPACA_EQUITIES_FEED` | `iex` | Alpaca equities feed: `iex` or `sip`. |
| `ALPACA_NEWS_BACKFILL_LIMIT` | `50` | Alpaca news stories fetched on startup, capped at 50 by the Alpaca News API. |
| `ALPACA_NEWS_WEBSOCKET_PATH` | `/v1beta1/news` | Alpaca news websocket path. |

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
| `DATABENTO_LIMIT` | `0` | Max Databento records, where `0` means no explicit limit. |
| `DATABENTO_PRICE_SCALE` | `1` | Multiplier applied to decoded prices from sidecar output. |
| `DATABENTO_PYTHON_BIN` | `python3` | Python executable used to run Databento sidecar script. |

### IBKR options adapter configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `IBKR_HOST` | `127.0.0.1` | TWS/Gateway host for IBKR bridge. |
| `IBKR_PORT` | `7497` | TWS/Gateway port for IBKR bridge. |
| `IBKR_CLIENT_ID` | `0` | IBKR client id used by the bridge connection. |
| `IBKR_SYMBOL` | `SPY` | Underlying symbol requested from IBKR. |
| `IBKR_EXPIRY` | `20250117` | Option expiry requested from IBKR. |
| `IBKR_STRIKE` | `450` | Strike requested from IBKR. |
| `IBKR_RIGHT` | `C` | Option side: `C` or `P`. |
| `IBKR_EXCHANGE` | `SMART` | IBKR exchange routing code. |
| `IBKR_CURRENCY` | `USD` | Contract currency. |
| `IBKR_PYTHON_BIN` | `python3` | Python executable used for IBKR sidecar. |

### Options signal filtering

| Variable | Default | What it controls |
| --- | --- | --- |
| `OPTIONS_SIGNAL_MODE` | `smart-money` | Signal pass policy: `smart-money`, `balanced`, or `all`. |
| `OPTIONS_SIGNAL_MIN_NOTIONAL` | `10000` | Base minimum notional for most signal candidates. |
| `OPTIONS_SIGNAL_ETF_MIN_NOTIONAL` | `50000` | ETF-specific minimum notional for signal inclusion. |
| `OPTIONS_SIGNAL_BID_SIDE_MIN_NOTIONAL` | `25000` | Minimum notional for bid-side or sweep/ISO thresholds. |
| `OPTIONS_SIGNAL_MID_MIN_NOTIONAL` | `20000` | Minimum notional for non-sweep/non-ISO `MID` prints. |
| `OPTIONS_SIGNAL_NBBO_MAX_AGE_MS` | `1500` | NBBO freshness threshold used during signal classification. |
| `OPTIONS_SIGNAL_ETF_UNDERLYINGS` | `SPY,QQQ,IWM,DIA,TLT,GLD,SLV,XLF,XLE,XLV,XLI,XLP,XLU,XLY,SMH,ARKK` | ETF underlyings treated specially by signal filters. |

Default `smart-money` policy rejects lower-information prints and keeps higher-confidence, higher-notional, sweep-style flow. `balanced` lowers thresholds. `all` bypasses filtering.

### Compute, classifier, and dark-inference configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `CLUSTER_WINDOW_MS` | `500` | Time window used to cluster nearby option prints into packet candidates. |
| `COMPUTE_DELIVER_POLICY` | `new` | Consumer start policy for compute subscriptions. |
| `COMPUTE_CONSUMER_RESET` | `false` | Resets durable consumer position for compute on startup when true. |
| `NBBO_MAX_AGE_MS` | `1000` | Max NBBO age accepted when enriching option prints in compute. |
| `ROLLING_WINDOW_SIZE` | `50` | Number of observations retained per rolling metric key. |
| `ROLLING_TTL_SEC` | `86400` | Redis TTL for rolling metric keys. |
| `EQUITY_QUOTE_MAX_AGE_MS` | `1000` | Max quote staleness when joining equity prints for inference. |
| `DARK_INFER_WINDOW_MS` | `60000` | Sliding window length for dark-style inference accumulation. |
| `DARK_INFER_COOLDOWN_MS` | `30000` | Cooldown before repeated dark inferences for same symbol/pattern. |
| `SMART_MONEY_EVENT_CALENDAR_PATH` | empty | Optional JSON event-calendar file used by compute. |
| `REFDATA_EVENT_CALENDAR_PATH` | empty | Optional JSON event-calendar path for refdata; falls back to `SMART_MONEY_EVENT_CALENDAR_PATH`. |
| `REFDATA_EVENT_CALENDAR_PROVIDER` | empty | Set to `alpha_vantage` to refresh event-calendar cache from Alpha Vantage. |
| `ALPHA_VANTAGE_API_KEY` | empty | Alpha Vantage key for provider-backed event-calendar refresh. |

### API, live cache, and web client

| Variable | Default | What it controls |
| --- | --- | --- |
| `API_PORT` | `4000` | API service listen port. |
| `REST_DEFAULT_LIMIT` | `200` | Default REST record count. |
| `API_DELIVER_POLICY` | `new` | JetStream consumer start policy used by API live subscribers. |
| `API_CONSUMER_RESET` | `false` | Resets/recreates API live durable consumers on startup when true. |
| `API_CORS_ORIGINS` | `https://flow.deltaisland.io,http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3100,http://localhost:3100` | Comma-separated browser origins allowed to call the API directly; local web and desktop-local dev rely on these headers. |
| `LIVE_LIMIT_DEFAULT` | `1000` | Optional generic live cache depth default. |
| `LIVE_LIMIT_FLOW` | `500` | Live cache depth for flow packet events unless overridden. |
| `LIVE_LIMIT_SMART_MONEY` | `300` | Live cache depth for smart-money events unless overridden. |
| `LIVE_LIMIT_OPTIONS` | `1000` | Live cache depth for options channel unless overridden. |
| `LIVE_LIMIT_ALERTS` | `300` | Live cache depth for alerts channel unless overridden. |
| `LIVE_LIMIT_NEWS` | `100` | Live cache depth for news channel unless overridden. |
| `NEXT_PUBLIC_API_URL` | `https://api.flow.deltaisland.io` for local web dev, auto-detected in browser when unset by other runners | Explicit base URL for API/WS calls from the web app. |
| `NEXT_PUBLIC_LIVE_HOT_WINDOW` | `600` | Max hot-window items retained for non-options live streams in UI state. |
| `NEXT_PUBLIC_LIVE_HOT_WINDOW_OPTIONS` | `1200` | Dedicated max hot-window items retained for options prints. |
| `NEXT_PUBLIC_NBBO_MAX_AGE_MS` | `1000` | Frontend NBBO staleness threshold. |
| `NEXT_PUBLIC_FLOW_FILTER_PRESET` | `smart-money` | Default flow filter preset: `smart-money`, `balanced`, or `all`. |
| `NEXT_ALLOWED_DEV_ORIGINS` | empty, plus auto-detected local IPv4 addresses | Optional comma-separated extra hostnames/IPs allowed to load Next.js dev resources when local browser tooling reaches the dev server through a nonstandard local interface. |

### Replay and testing controls

| Variable | Default | What it controls |
| --- | --- | --- |
| `REPLAY_ENABLED` | `false` | Starts replay service in `bun run dev` when truthy. |
| `REPLAY_SOURCE` | `clickhouse` | Replay backing source: `clickhouse` for materialized rows or `synthetic_fixture` for infra-free synthetic fixture replay. |
| `REPLAY_SYNTHETIC_FIXTURE_DIR` | empty | Synthetic fixture directory containing `manifest.json` and sidecars when `REPLAY_SOURCE=synthetic_fixture`. |
| `REPLAY_SYNTHETIC_MANIFEST_PATH` | empty | Direct synthetic fixture manifest path; takes precedence over `REPLAY_SYNTHETIC_FIXTURE_DIR`. |
| `REPLAY_SYNTHETIC_SOURCE_ID` | `synthetic_market` | Synthetic source selector used to verify fixture provenance before replay. |
| `REPLAY_SYNTHETIC_RUN_ID` | empty | Optional synthetic run selector; when set, the fixture run must match before replay starts. |
| `REPLAY_STREAMS` | `options,nbbo,equities,equity-quotes` | Replay stream selection. |
| `REPLAY_START_TS` | `0` | Replay lower-bound timestamp. |
| `REPLAY_END_TS` | `0` | Replay upper-bound timestamp. |
| `REPLAY_SPEED` | `1` | Replay speed multiplier. |
| `REPLAY_BATCH_SIZE` | `200` | Batch fetch size per stream. |
| `REPLAY_LOG_EVERY` | `1000` | Progress log interval. |
| `TESTING_MODE` | `false` | Enables ingest publish throttling for deterministic/lower-volume test runs. |
| `TESTING_THROTTLE_MS` | `200` | Minimum delay between emitted events while `TESTING_MODE=true`. |

## Quick Notes

- Python dependencies are required only for IBKR/Databento sidecars: `services/ingest-options/py/requirements.txt`.
- Candle construction is server-side; the client consumes prebuilt OHLC events.
- Option prints persist as enriched raw rows and can be queried as `view=signal` or `view=raw`.
- The default Tape page options/packets posture is stock-only, hides `B` / `BB`, keeps calls and puts visible, and applies in-memory min-notional controls immediately.
- Live retention uses ClickHouse for durable server history, Redis for bounded hot cache, and browser state for rendering windows/preferences.
- Alert and drawer evidence is pinned and hydrated by id/trace so details remain inspectable after hot-window eviction.
- Firehose readiness keeps raw ingest for storage/replay, routes default compute/UI through filtered signals, and keeps subscription contracts ready for server-side selective delivery.
- This repository is for personal, non-redistributed usage.

## Useful Examples

Realistic local demo:

```bash
SYNTHETIC_MARKET_MODE=realistic \
OPTIONS_SIGNAL_MODE=smart-money \
bun run dev
```

Active deterministic demo:

```bash
SYNTHETIC_MARKET_MODE=active bun run dev
```

Firehose stress test:

```bash
SYNTHETIC_MARKET_MODE=firehose \
NEXT_PUBLIC_LIVE_HOT_WINDOW=2000 \
bun run dev
```

Hosted demo profile controls:

```bash
SYNTHETIC_CONTROL_ENABLED=true \
SYNTHETIC_ADMIN_TOKEN=dev-token \
NEXT_PUBLIC_SYNTHETIC_ADMIN=1 \
NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 \
OPTIONS_INGEST_ADAPTER=synthetic \
EQUITIES_INGEST_ADAPTER=synthetic \
bun run dev
```

Open the synthetic control drawer in the terminal UI to select `Market Command`, `Event Response`, `Quiet Range`, or `Stress Tape`, then choose `Steady`, `Active`, or `Firehose` load.

Show raw options flow for debugging:

```text
/prints/options?view=raw&security=all
/history/options?view=raw&security=all&before_ts=<ts>&before_seq=<seq>
/replay/options?view=raw&security=all&after_ts=<ts>&after_seq=<seq>
```
