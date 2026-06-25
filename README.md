![Islandflow logo](assets/logo.png)

![Status: pre-pre-alpha](https://img.shields.io/badge/status-pre--pre--alpha-b91c1c?style=for-the-badge)

# Islandflow

> **Pre-pre-alpha: not ready for use.** Islandflow is exploratory personal research software. It has been gutted and rebuilt several times over the past couple months as the market-data model, service boundaries, replay assumptions, realtime transport, storage contracts, and UI architecture became clearer.
>
> This is my long-running "magnum opus" project and an intentionally ambitious learning experience. I had never dealt with many of these market-data, event-sourcing, replay, realtime UI, deployment, and service-boundary problems before, so the project has evolved through repeated rebuilding instead of premature polish.
>
> The current priority is a rock-solid foundation: event contracts, shared modules, essential services, storage boundaries, replay paths, live transport, and durable UI primitives. UI/UX polish and actual usability are deliberately secondary until the core system is trustworthy.
>
> Expect broken workflows, missing docs, unstable APIs, unstable data contracts, synthetic/local-development defaults, incomplete deployment paths, and more major rewrites. This README describes the current repository direction and foundation surfaces, not a usable product.

Islandflow is being rebuilt as a Bun + TypeScript monorepo for event-sourced market microstructure research. The long-term product idea is an evidence-first terminal for serious individual traders and researchers: options flow, equity prints, inferred dark/off-exchange signals, news, chart context, alerts, and deterministic replay in one inspectable system.

This is personal research software, not financial advice, not a trading system, and not a redistribution-ready market-data product.

## Current Direction

Islandflow is a foundation for an event-sourced intelligence layer over raw market events.

```text
ingest adapters
  -> NATS JetStream subjects
  -> compute, candles, replay, API consumers
  -> ClickHouse durable storage + Redis hot/rolling caches
  -> REST, cursor history, replay APIs, and WebSocket live feeds
  -> Next.js terminal UI and experimental Electron shell
```

The system is currently focused on:

- canonical event schemas for options, NBBO, equities, equity quotes, news, derived flow, alerts, candles, inferred-dark events, and live transport;
- deterministic synthetic market data and fixture generation for repeatable testing;
- compute services that reconstruct parent events, flow packets, smart-flow/smart-money hypotheses, alerts, and equity print-to-quote joins;
- server-side candle aggregation and replayable historical streams;
- cursor-based API surfaces for live, history, and replay workflows;
- reusable durable tape modules for options, flow packets, equities, alerts, and news;
- a restrained terminal-style UI built for evidence, density, and eventual operator workflows;
- deployment paths for the current VPS, with Docker as the supported runtime and native Bun/systemd as an experimental cutover path.

## How It Has Evolved

Islandflow started as a much more direct options-flow and market-dashboard idea. As the project hit real complexity, it became clear that the hard part was not simply drawing a better tape or chart; it was building trustworthy foundations for event semantics, replay, storage, realtime delivery, provider adapters, and explainable signal generation.

That learning changed the project. Early assumptions were replaced by a deeper event-sourced architecture, synthetic fixtures, shared contracts, durable tape modules, smarter live-state boundaries, and more deliberate deployment paths. The current rebuild is the result of that evolution: less focused on appearing usable quickly, more focused on becoming reliable enough that future usability work has something solid underneath it.

## What Exists Today

These are active construction areas, not stable product features.

| Area | Current state |
| --- | --- |
| Runtime | Bun workspaces across `apps/*`, `services/*`, and `packages/*`. |
| Local infra | Docker Compose for NATS JetStream, ClickHouse, and Redis. |
| Shared packages | Types, bus helpers, config parsing, observability facade, ClickHouse storage/query helpers, synthetic market fixtures/profiles. |
| Options ingest | Synthetic, Alpaca options, Databento sidecar replay, and IBKR sidecar bridge paths. |
| Equities ingest | Synthetic and Alpaca equities trades/quotes paths. |
| News ingest | Alpaca news backfill and websocket publication. |
| Compute | Parent-event reconstruction, flow packets, smart-flow/smart-money scoring, classifier compatibility events, alerts, rolling stats, inferred-dark signals, and equity joins. |
| Candles | Server-side equity OHLC aggregation, ClickHouse persistence, optional Redis cache, and NATS publication. |
| Replay | ClickHouse and synthetic-fixture replay paths with ordered multi-stream publication controls. |
| API | REST endpoints, cursor history/replay endpoints, live cache hydration, synthetic controls, and WebSocket live channels. |
| Web | Next.js 16 + React 19 terminal shell, market chart module, durable tape modules, route-specific surfaces, and internal QA routes. |
| Desktop | Thin Electron wrapper around the hosted or local web app. No bundled backend yet. |
| Deployment | Docker VPS stack is the supported path. Native Bun/systemd deployment assets exist but are experimental and scope-gated. |

## What Is Still Not Ready

- Stable public APIs, stable event contracts, or durable compatibility promises.
- Production-grade licensed feed entitlement and provider operations.
- Auth, secure multi-user deployment, or public SaaS hardening.
- Reliable end-to-end user workflows.
- UI/UX polish around real daily usage.
- Signed/notarized desktop distribution or desktop-native features.
- Complete refdata/corporate-action enrichment.
- Fully calibrated smart-flow scoring against real historical outcomes.
- A clean "install and use this" path for anyone other than the repo owner.

## Monorepo Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js web app and terminal UI. |
| `apps/desktop` | Electron shell that wraps the hosted or local web app. |
| `services/api` | REST, history/replay, live cache, websocket, and synthetic-control gateway. |
| `services/compute` | Parent-event reconstruction, flow packets, smart-flow/smart-money, alerts, inferred-dark, and equity joins. |
| `services/candles` | Equity candle aggregation and publication. |
| `services/ingest-options` | Options print/NBBO ingest adapters. |
| `services/ingest-equities` | Equity trade/quote ingest adapters. |
| `services/ingest-news` | News backfill and websocket ingest. |
| `services/replay` | Deterministic historical/synthetic replay publisher. |
| `services/refdata` | Event-calendar validation/provider refresh scaffolding. |
| `services/eod-enricher` | Scaffold service for future enrichment work. |
| `packages/types` | Shared event, live transport, durable tape, smart-flow, and synthetic-market types. |
| `packages/bus` | NATS/JetStream subjects, streams, reconciliation, and synthetic-control helpers. |
| `packages/storage` | ClickHouse DDL, row transforms, and query builders. |
| `packages/config` | Shared environment parsing. |
| `packages/observability` | Logger and metrics facade. |
| `packages/synthetic-market` | Deterministic synthetic scenarios, fixtures, manifests, and demo load profiles. |
| `deployment/docker` | Supported VPS Docker Compose runtime. |
| `deployment/native` | Experimental Bun + systemd native runtime and cutover helpers. |
| `docs/implementation` | Active phase plans and execution docs. |
| `docs/plans` and `docs/research-docs` | Background architecture reviews and research notes. |

## API Surface

The API is intentionally not stable yet, but the current gateway exposes these families:

- Health: `GET /health`
- Current/live cache reads: `/prints/options`, `/prints/equities`, `/prints/equities/range`, `/candles/equities`, `/flow/packets`, `/flow/smart-money`, `/flow/smart-flow`, `/flow/classifier-hits`, `/flow/alerts`, `/news`
- Cursor history: `/history/options`, `/history/nbbo`, `/history/equities`, `/history/equity-quotes`, `/history/equity-joins`, `/history/flow`, `/history/smart-money`, `/history/smart-flow`, `/history/classifier-hits`, `/history/alerts`, `/history/inferred-dark`, `/history/news`
- Replay reads: `/replay/options`, `/replay/nbbo`, `/replay/equities`, `/replay/equity-quotes`, `/replay/equity-candles`, `/replay/equity-joins`, `/replay/inferred-dark`, `/replay/flow`, `/replay/smart-money`, `/replay/smart-flow`, `/replay/classifier-hits`, `/replay/alerts`
- Detail hydration: `/flow/packets/:id`, `/flow/alerts/:traceId/context`
- WebSockets: `/ws/live` plus channel-specific sockets for options, NBBO, equities, candles, quotes, joins, inferred-dark, flow, classifier hits, smart-money, smart-flow, and alerts

Option print reads support signal/raw views and filter parameters used by the terminal UI. These contracts are evolving with the durable-tapes and performance work.

## Web Surfaces

Current routes are implementation and validation surfaces, not finished product flows.

| Route | Current purpose |
| --- | --- |
| `/` | Main terminal composition surface. |
| `/options` | Options-focused durable tape route. |
| `/durable-tapes` | Internal route for composing and stress-testing durable tape modules. |
| `/news` | News-focused route. |
| `/charts` | Chart-focused route. |
| `/signals` | Signal-oriented route. |
| `/tape` | Tape-oriented route. |
| `/replay` | Legacy alias that currently maps back to the main terminal behavior. |
| `/mock*` | Design/mock exploration surfaces. |

The durable UI direction is dense, restrained, evidence-first, and stable under live update pressure. It should feel like an instrument panel, not a promotional trading app.

## Smart-Flow And Smart-Money Direction

Islandflow is moving away from a single binary "smart money" label. The current direction separates:

- facts: observed prints, quotes, timestamps, sizes, prices, venue/provider metadata;
- evidence: NBBO alignment, premium/notional concentration, quote freshness, burst timing, moneyness/DTE context, event proximity, cross-signal linkage;
- hypotheses: participant-style interpretations such as institutional directional flow, retail whale activity, event-driven positioning, volatility selling, arbitrage-like structures, and hedge-reactive activity;
- confidence and abstention: explicit uncertainty when evidence is weak, stale, missing, or ambiguous.

Current smart-money compatibility surfaces remain, but newer smart-flow work is trying to make the data model more honest and inspectable.

Primary smart-money paths today:

```text
/flow/smart-money
/history/smart-money
/replay/smart-money
/ws/smart-money
```

Smart-flow paths are being developed alongside them:

```text
/flow/smart-flow
/history/smart-flow
/replay/smart-flow
/ws/smart-flow
```

## Local Development

Prerequisites:

- Bun
- Docker and Docker Compose for local NATS, ClickHouse, and Redis
- Provider credentials only if you leave synthetic mode

Install dependencies:

```bash
bun install
```

Create local configuration:

```bash
cp .env.example .env
```

Run the full local stack:

```bash
bun run dev
```

Or run each layer separately:

```bash
bun run dev:infra
bun run dev:services
bun run dev:web
```

Stop local infra:

```bash
bun run dev:infra:down
```

Fast web-only iteration defaults to the local API:

```bash
bun run dev:web
```

To test against a nonlocal API, opt in explicitly and make sure that API allows the selected local web port:

```bash
WEB_DEV_PORT=3100 NEXT_PUBLIC_API_URL=<raw-api-origin> bun run dev:web
```

The default local posture is synthetic market data. Real provider modes require credentials and are not the safest first path.

## Configuration

All runtime configuration flows through `.env`. Start with `.env.example`; do not treat this README as the complete source of configuration truth.

Important groups:

- Infra: `NATS_URL`, `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `REDIS_URL`
- Options ingest: `OPTIONS_INGEST_ADAPTER=synthetic|alpaca|databento|ibkr`
- Equities ingest: `EQUITIES_INGEST_ADAPTER=synthetic|alpaca`
- Provider credentials: Alpaca, Databento, IBKR, Alpha Vantage
- Synthetic controls: `SYNTHETIC_CONTROL_ENABLED`, `SYNTHETIC_ADMIN_TOKEN`, `NEXT_PUBLIC_SYNTHETIC_ADMIN`
- API/web: `API_PORT`, `API_CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, live retention limits
- Compute: NBBO freshness, rolling windows, classifier/smart-flow thresholds, cache sizes
- Replay: `REPLAY_ENABLED`, `REPLAY_STREAMS`, `REPLAY_START_TS`, `REPLAY_END_TS`, `REPLAY_SPEED`
- Deployment: Docker and native runtime variables under `deployment/docker/.env.example` and `deployment/native`

Python dependencies are only needed for the IBKR and Databento sidecars under `services/ingest-options/py`.

## Common Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start local infra, services, and web through the repo dev runner. |
| `bun run dev:infra` | Start local Docker infra only. |
| `bun run dev:services` | Start backend services against already-running infra. |
| `bun run dev:web` | Start the Next.js web app. |
| `bun run dev:desktop` | Start Electron against local web. |
| `bun run dev:desktop:remote` | Start Electron against the hosted app. |
| `bun run synthetic:fixture` | Generate deterministic synthetic fixture data. |
| `bun test` | Run the Bun test suite. |
| `bun run fmt:check` | Check formatting. |
| `bun run lint` | Run Biome lint. |
| `bun run typecheck` | Run workspace typechecks. |
| `bun --cwd=apps/web run build` | Build the web app. |
| `bun run check:public-api-routes` | Validate public API route coverage expectations. |
| `bun run check:docker-workspace` | Validate the Docker workspace snapshot. |

## Validation

Local validation should scale with the change. The full CI-shaped gate is:

```bash
bun install --frozen-lockfile
bun run fmt:check
bun run lint
bun run typecheck
bun test
bun run check:public-api-routes
bun run check:docker-workspace
bun --cwd=apps/web run build
```

Forgejo Actions runs the same broad validation on pull requests, pushes to `main`, and manual workflow dispatches.

Focused examples:

```bash
bun test services/compute/tests
bun test services/api/tests packages/storage/tests
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test apps/web/features/durable-tape apps/web/features/terminal
```

Durable-tapes performance work has a dedicated probe:

```bash
bun run dev:web
bun run scripts/probes/durable-tapes-perf.ts \
  --target=http://localhost:3000/durable-tapes \
  --warmup=30s \
  --duration=180s \
  --output=docs/implementation/durable-tapes-performance/baselines/local-api.json
```

## Deployment

Forgejo is the canonical remote:

```text
https://git.dirtydishes.dev/dirtydishes/islandflow
```

The default production-like runtime is Docker:

```bash
./deploy main --runtime docker
./deploy current-branch --runtime docker
```

Use `./deploy` with no arguments for the guided deploy prompt.

Important deployment notes:

- The repo-root `docker-compose.yml` is local development infra only.
- The VPS Docker stack lives in `deployment/docker`.
- Docker is the supported runtime and rollback path.
- Native Bun/systemd deployment assets live in `deployment/native` and are experimental/scope-gated.
- Do not let Docker and native services own the same Islandflow worker/API scope at the same time; durable JetStream consumers make that unsafe.
- When Docker workspace dependencies change, run `bun run sync:docker-workspace` and `bun run check:docker-workspace`.

Read:

- `deployment/docker/README.md`
- `deployment/native/README.md`

## Desktop Shell

The Electron app in `apps/desktop` is a thin shell. It can load:

- local web UI during development;
- hosted `<production-app-origin>`;
- trusted Islandflow app origins configured through `ISLANDFLOW_DESKTOP_START_URL`.

It does not bundle backend services, local infra, auto-updates, signing, notarization, native notifications, or desktop-specific product features yet.

Commands:

```bash
bun run dev:desktop
bun run dev:desktop:remote
bun run package:desktop
bun run make:desktop
```

## Planning And Work Tracking

Implementation work is tracked with Beads:

```bash
bd prime
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Active implementation plans live under `docs/implementation`:

| Stream | Entry point |
| --- | --- |
| Synthetic market data | `docs/implementation/synthetic-market-data/00-roadmap.md` |
| Smart money / smart flow | `docs/implementation/smart-money/00-roadmap.md` |
| Reusable market chart | `docs/implementation/lightweight-charts/IMPLEMENT.md` |
| Durable tape modules | `docs/implementation/durable-tapes/IMPLEMENT.md` |
| Durable-tapes performance hardening | `docs/implementation/durable-tapes-performance/IMPLEMENT.md` |

Planning precedence for implementation work:

1. Current Beads issue
2. Referenced phase document under `docs/implementation`
3. Architecture plan under `docs/plans`
4. Research report under `docs/research-docs`

The product/design north star is in `PRODUCT.md`: precise, composed, forensic, evidence before impression, utility over theater, stable under volatility, and explicit about data semantics.

## Current Philosophy

The codebase is finally moving toward the shape it probably needed from the start:

- contracts before screens;
- deterministic fixtures before demos;
- replay before confidence;
- evidence before labels;
- small shared modules before repeated UI surfaces;
- explicit uncertainty before pretend precision;
- operationally boring services before polish.

That is why the project may look more rebuilt than "iterated." The goal is not to preserve early assumptions. The goal is to learn from them and make the foundation strong enough that the eventual product can be useful without being fragile.
