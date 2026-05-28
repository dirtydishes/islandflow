# Manual Attack Surface Inventory (Stage 08)

## Highest-impact slices selected
1. Synthetic admin control: public Next.js route handlers proxy to API admin endpoints with server bearer token.
2. Provider/news HTML to browser DOM: Alpaca `content` is stored and later rendered through a regex sanitizer and `dangerouslySetInnerHTML`.
3. Live WebSocket/API market data exposure: public WS upgrades and history reads have no handler-level auth/origin checks.
4. Root Docker Compose infrastructure: ClickHouse, Redis, and NATS are published on host ports without credentials in the compose file.

## Public routes / URLs
- Next admin proxy: `GET /api/admin/synthetic/status`, `GET/PUT /api/admin/synthetic/control` (`apps/web/app/api/admin/synthetic/status/route.ts:5-7`, `apps/web/app/api/admin/synthetic/control/route.ts:5-17`).
- API admin backend: `GET /admin/synthetic/status`, `GET/PUT /admin/synthetic/control` (`services/api/src/index.ts:1364-1388`).
- API history/news and related reads: `/history/news` (`services/api/src/index.ts:1656-1660`) plus other unauthenticated history/replay/read endpoints documented in P5 matrix.
- WebSockets: `/ws/options`, `/ws/options-nbbo`, `/ws/equities`, `/ws/equity-candles`, `/ws/equity-quotes`, `/ws/equity-joins`, `/ws/inferred-dark`, `/ws/flow`, `/ws/classifier-hits`, `/ws/smart-money`, `/ws/alerts`, `/ws/live` (`services/api/src/index.ts:1846-1936`).
- Host infra ports from root compose: ClickHouse HTTP/native `8123/9000`, Redis `6379`, NATS client/monitor `4222/8222` (`docker-compose.yml:4-24`).

## Attacker-controlled sources
- Anonymous browser requests to Next route handlers when `NEXT_PUBLIC_SYNTHETIC_ADMIN=1`.
- HTTP query/path parameters and WebSocket connection/message bytes to the API.
- Alpaca/provider news `item.content`, `item.summary`, `item.url`, and symbols before persistence/display.
- Network clients reaching published compose ports on the host.
- Environment hidden controls: `NEXT_PUBLIC_API_URL`, `SYNTHETIC_ADMIN_TOKEN`, `API_HOST`, compose deployment choice.

## Sinks
- NATS KV write of synthetic control state through API admin PUT (`services/api/src/index.ts:1386-1388`).
- Browser DOM HTML sink: `dangerouslySetInnerHTML` for news story body (`apps/web/app/terminal.tsx:5009`).
- WebSocket `serverRef.upgrade` and live snapshots (`services/api/src/index.ts:1847-1935`, `1982-2008`).
- ClickHouse query reads for history/replay (`services/api/src/index.ts:1556-1660`, storage package).
- Direct ClickHouse/Redis/NATS network services from root compose (`docker-compose.yml:4-24`).

## Hidden control channels
- `NEXT_PUBLIC_SYNTHETIC_ADMIN` enables/disables admin proxy; `NEXT_PUBLIC_API_URL` chooses the privileged proxy target; `SYNTHETIC_ADMIN_TOKEN` is injected server-side (`apps/web/app/api/admin/synthetic/shared.ts:10-22`, `44-55`).
- API admin accepts either bearer token or `x-synthetic-admin-token` fallback (`services/api/src/index.ts:320-333`).
- API exposure depends on `API_HOST`/reverse proxy rather than handler auth; WS routes do not inspect `Origin`.
- Root compose vs production compose changes infra from internal-only to host-published.

## Exploit-relevant paths
- Browser -> Next `/api/admin/synthetic/control` -> server injects bearer -> API admin -> NATS KV synthetic control mutation.
- Provider news HTML -> `content_html` -> ClickHouse/API `/history/news` -> React drawer -> regex sanitizer -> `dangerouslySetInnerHTML`.
- Remote WS client -> `/ws/live` upgrade -> subscribe message -> `liveState.getSnapshot` -> live/research data stream.
- Network client -> host port `4222` NATS -> publish forged subjects / KV updates; or `8123/9000` ClickHouse -> query/alter data; or `6379` Redis -> read/write cache.
