# Islandflow Architecture Entrypoints Inventory

## Public/Network Routes

### API service (`services/api/src/index.ts`, Bun on `API_HOST:API_PORT`, default `127.0.0.1:4000`)
- Health: `GET /health`.
- Synthetic admin (Bearer token expected): `GET /admin/synthetic/status`, `GET /admin/synthetic/control`, `PUT /admin/synthetic/control`.
- Recent/live REST: `GET /prints/options`, `/nbbo/options`, `/prints/equities`, `/prints/equities/range`, `/quotes/equities`, `/candles/equities`, `/joins/equities`, `/dark/inferred`, `/flow/packets`, `/flow/smart-money`, `/flow/classifier-hits`, `/flow/alerts`, `/news`.
- Context/lookup: `GET /flow/packets/:id`, `GET /flow/alerts/:trace_id/context`, alert-context helper paths, `GET /option-prints/by-trace`, `GET /equity-joins/by-id`, `POST /lookup/options-support`.
- History: `GET /history/options`, `/history/nbbo`, `/history/equities`, `/history/equity-quotes`, `/history/equity-joins`, `/history/flow`, `/history/smart-money`, `/history/classifier-hits`, `/history/alerts`, `/history/inferred-dark`, `/history/news`.
- Replay: `GET /replay/options`, `/replay/nbbo`, `/replay/equities`, `/replay/equity-quotes`, `/replay/equity-candles`, `/replay/equity-joins`, `/replay/inferred-dark`, `/replay/flow`, `/replay/smart-money`, `/replay/classifier-hits`, `/replay/alerts`.
- WebSockets: `GET /ws/options`, `/ws/options-nbbo`, `/ws/equities`, `/ws/equity-candles`, `/ws/equity-quotes`, `/ws/equity-joins`, `/ws/inferred-dark`, `/ws/flow`, `/ws/classifier-hits`, `/ws/smart-money`, `/ws/alerts`, `/ws/live`.

### Web app (`apps/web/app`, Next.js on port 3000)
- Pages: `/`, `/tape`, `/signals`, `/charts`, `/news`, `/options`, `/replay`, `/frontend-cooker`.
- Next API admin proxy: `GET /api/admin/synthetic/status`, `GET|PUT /api/admin/synthetic/control`.

### Desktop (`apps/desktop`)
- Loads `https://flow.deltaisland.io` by default or trusted local/prod URL from `ISLANDFLOW_DESKTOP_START_URL`.
- Allows external `http:`/`https:` links only when navigation source is trusted app origin.

## Attacker-Controlled Sources
- URL path segments: packet IDs, alert trace IDs, by-id/by-trace arrays.
- Query params: `limit`, `before_ts`, `before_seq`, `after_ts`, `after_seq`, `trace_prefix`, option/equity filters, candle intervals/ranges/cache flag, source selectors.
- Request bodies: `PUT /admin/synthetic/control`, `POST /lookup/options-support`, WS `/ws/live` messages.
- WebSocket connection count, channels, subscription messages.
- External feed payloads: Alpaca options/equities/news REST+WS, Databento replay JSONL from Python, IBKR JSONL from Python, msgpack frames.
- Environment: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SYNTHETIC_ADMIN`, `SYNTHETIC_ADMIN_TOKEN`, API/NATS/ClickHouse/Redis URLs, bind IPs, provider API keys, adapter choices, Python binary paths, Electron start URL.
- Internal network inputs: NATS subjects/KV, Redis cache contents, ClickHouse rows.
- CI/deploy inputs: branches/refs/env secrets, docker compose env overrides.

## High-Value Sinks
- ClickHouse `client.query({ query })`, `exec`, `insert`: `packages/storage/src/clickhouse.ts`.
- NATS `publishJson`, `subscribeJson`, stream/KV helpers: `packages/bus/src/**`.
- Redis hot live/candle cache: `services/api/src/live.ts`, candle service.
- Browser render sinks for news `content_html`, URLs, explanations/profile JSON: `apps/web/app/**`.
- Admin state mutation: `writeSyntheticControlState`, `openSyntheticControlKv`.
- Electron `BrowserWindow.loadURL`, `shell.openExternal`.
- Child execution: `Bun.spawn` in `services/ingest-options/src/adapters/databento.ts`, `ibkr.ts`, deployment scripts.
- Logs containing provider errors, URLs, trace IDs, and potential secret-bearing env/config.

## Key Source Files for Later Phases
- API routing/auth/WS: `services/api/src/index.ts`, `services/api/src/live.ts`, `services/api/src/synthetic-control.ts`, `services/api/src/option-queries.ts`, `services/api/src/alert-context.ts`.
- Storage/query construction: `packages/storage/src/clickhouse.ts`, all `packages/storage/src/*.ts` table modules.
- Bus/subjects/control: `packages/bus/src/index.ts`, `jetstream.ts`, `streams.ts`, `subjects.ts`, `synthetic-control.ts`.
- External ingestion: `services/ingest-options/src/adapters/alpaca.ts`, `databento.ts`, `ibkr.ts`, `synthetic.ts`, `services/ingest-equities/src/adapters/alpaca.ts`, `services/ingest-news/src/index.ts`.
- Compute integrity: `services/compute/src/*.ts`, `services/candles/src/*.ts`, `services/replay/src/index.ts`.
- Web/admin/UI rendering: `apps/web/app/api/admin/synthetic/shared.ts`, `control/route.ts`, `status/route.ts`, `apps/web/app/**/*.tsx`, `apps/web/next.config.mjs`.
- Desktop boundary: `apps/desktop/src/security.ts`, `apps/desktop/src/main.ts`.
- Config/secrets/env: `packages/config/src/env.ts`, `packages/config/src/alpaca.ts`, `deployment/docker/.env.example`, `deployment/docker/docker-compose.yml`.
- Deployment/CI: `scripts/deploy.ts`, `deploy`, `.forgejo/workflows/ci.yml`, `.github/workflows/*.yml`, Dockerfiles.

## Initial Custom Extraction Targets
- Remote HTTP input to ClickHouse query template literals.
- Remote WS input to JSON/zod parsing and send/broadcast loops.
- External provider/child stdout input to NATS publish and UI render fields.
- Env vars to SSRF-like fetch destinations and Electron navigation.
- Env vars to `Bun.spawn` executable/arguments.
- NATS messages to ClickHouse insert and derived compute decisions.
