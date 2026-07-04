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
- compute services that reconstruct parent events, flow packets, smart-flow hypotheses, smart-flow alerts, and equity print-to-quote joins;
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
| Compute | Parent-event reconstruction, flow packets, smart-flow scoring, smart-flow alerts, rolling stats, inferred-dark signals, and equity joins. |
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
| `services/compute` | Parent-event reconstruction, flow packets, smart-flow, smart-flow alerts, inferred-dark, and equity joins. |
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
- Current/live cache reads: `/prints/options`, `/prints/equities`, `/prints/equities/range`, `/candles/equities`, `/flow/packets`, `/flow/smart-flow`, `/flow/smart-flow-alerts`, `/news`
- Cursor history: `/history/options`, `/history/nbbo`, `/history/equities`, `/history/equity-quotes`, `/history/equity-joins`, `/history/flow`, `/history/smart-flow`, `/history/smart-flow-alerts`, `/history/inferred-dark`, `/history/news`
- Replay reads: `/replay/options`, `/replay/nbbo`, `/replay/equities`, `/replay/equity-quotes`, `/replay/equity-candles`, `/replay/equity-joins`, `/replay/inferred-dark`, `/replay/flow`, `/replay/smart-flow`, `/replay/smart-flow-alerts`
- Detail hydration: `/flow/packets/:id`, `/option-prints/by-trace`, `/lookup/options-support`, `/lookup/smart-flow-alert-evidence`
- WebSockets: `/ws/live` plus channel-specific sockets for options, NBBO, equities, candles, quotes, joins, inferred-dark, flow, smart-flow, and smart-flow-alerts

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

## Smart-Flow Direction

Islandflow separates:

- facts: observed prints, quotes, timestamps, sizes, prices, venue/provider metadata;
- evidence: NBBO alignment, premium/notional concentration, quote freshness, burst timing, moneyness/DTE context, event proximity, cross-signal linkage;
- hypotheses: interpretations such as directional accumulation, retail attention flow, event positioning, volatility supply, structure arbitrage, and hedge rebalancing;
- confidence and abstention: explicit uncertainty when evidence is weak, stale, missing, or ambiguous.

Canonical smart-flow paths:

```text
/flow/smart-flow
/history/smart-flow
/replay/smart-flow
/ws/smart-flow
/flow/smart-flow-alerts
/history/smart-flow-alerts
/replay/smart-flow-alerts
/ws/smart-flow-alerts
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
- API/web: `API_PORT`, `API_HOST`, `API_CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, `ISLANDFLOW_INTERNAL_API_URL`, live retention limits
- API edge safety: `API_RATE_LIMIT_ENABLED`, `API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_REST_MAX`, `API_RATE_LIMIT_LOOKUP_MAX`, `API_RATE_LIMIT_WS_MAX`
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

### Private-edge API deployment

After the private-edge cutover, the hosted app is the public product surface. The API still runs, but browsers should reach it through same-origin routes on `<production-app-origin>`, not through `<raw-api-origin>`.

The configuration split is:

- `NEXT_PUBLIC_API_URL=` stays empty for production web builds. This makes browser REST and websocket clients use same-origin paths such as `<production-app-origin>/prints/options` and `<production-app-origin>/ws/live`.
- `ISLANDFLOW_INTERNAL_API_URL=<internal-api-origin>` is server-only. Next.js route handlers use it when they need to call the backend API directly.
- `API_HOST=<internal-api-bind-host>` should bind the API only where the edge can reach it. For the current native Nginx Proxy Manager deployment, this is the host-side bridge address used by the NPM container.
- `API_CORS_ORIGINS` can include `<production-app-origin>` and local dev origins. It is not the thing that makes the API private; edge closure and bind address do that.
- `API_RATE_LIMIT_ENABLED=1` and the matching limit values should be enabled in production once the edge forwards `X-Forwarded-For` or `X-Real-IP`.

For the current VPS deployment, native systemd is the active runtime. The API is added to the public app by keeping the native API service running and making Nginx Proxy Manager route API path prefixes from the app proxy host to the internal API origin:

```bash
systemctl --user status islandflow-web islandflow-api
curl -fsS <internal-api-origin>/health

export ISLANDFLOW_APP_DOMAIN=<production-app-origin-host>
export ISLANDFLOW_API_DOMAIN=<raw-api-origin-host>
./deployment/native/switch-npm-edge.sh native --raw-api=closed
```

That switch keeps `<raw-api-origin>` closed and installs the same-origin matcher on the app host for:

```text
/(ws|replay|prints|joins|nbbo|quotes|dark|flow|candles|history|news|lookup|option-prints|equity-joins|market-command)(/|$)
```

Then deploy native web/API changes with the edge guardrail acknowledged:

```bash
export DEPLOY_NATIVE_SYSTEMCTL_PREFIX="systemctl --user"
export DEPLOY_NATIVE_EDGE_READY=1
./deploy main --runtime native --pieces api,web
```

If only `.env` values changed and no `NEXT_PUBLIC_*` value changed, restarting the relevant units is enough:

```bash
systemctl --user restart islandflow-api islandflow-web
```

If `NEXT_PUBLIC_API_URL` changed, rebuild and redeploy the web app because it is a Next.js build-time value:

```bash
export DEPLOY_NATIVE_SYSTEMCTL_PREFIX="systemctl --user"
export DEPLOY_NATIVE_EDGE_READY=1
./deploy main --runtime native --web-only
```

Verify the private-edge posture from the server and from the public edge:

```bash
curl -fsS <internal-api-origin>/health
bun run scripts/check-public-api-routes.ts <production-app-origin>
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 5 <raw-api-origin>/health
```

The first two checks should pass. The raw API check should not return healthy API JSON; closed, timeout, 404-style, 403, 410, 421, or 502 behavior is acceptable after cutover.

For Docker rollback, keep the same public posture: `NEXT_PUBLIC_API_URL=` remains empty, `ISLANDFLOW_INTERNAL_API_URL=http://api:4000`, and `./deployment/native/switch-npm-edge.sh docker --raw-api=closed` retargets same-origin app routes to the Docker `api` service without reopening the raw API host.

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
| Smart-flow alerts and legacy removal | `docs/implementation/smart-flow-alerts/IMPLEMENT.md` |
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
