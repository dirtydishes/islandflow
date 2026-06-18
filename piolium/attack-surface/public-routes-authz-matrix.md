# Public Routes Authorization Matrix

Scope: Stage 05 public-route authorization/access-control review. Sources: `piolium/attack-surface/knowledge-base-report.md`, `piolium/attack-surface/architecture-entrypoints.md`, `services/api/src/index.ts`, and Next admin proxy route handlers.

**Roles modeled**: anonymous internet client, authenticated app user (no app auth found), synthetic admin token holder, internal/reverse-proxy peer.

**Hidden control channels**
- API bind/proxy exposure: `API_HOST` defaults to `127.0.0.1`, but any reverse-proxy route or `API_HOST=0.0.0.0` exposes all public API/WS routes without handler-level re-check.
- Synthetic admin API accepts `Authorization: Bearer` and fallback `x-synthetic-admin-token` (`services/api/src/index.ts:320-327`); API admin routes are otherwise guarded by `authenticateSyntheticAdminRequest` (`services/api/src/index.ts:1326-1351`).
- Next admin proxy target and availability are env controlled: `NEXT_PUBLIC_SYNTHETIC_ADMIN`, `NEXT_PUBLIC_API_URL`, and server-side `SYNTHETIC_ADMIN_TOKEN` (`apps/web/app/api/admin/synthetic/shared.ts:10-22`).
- Next admin proxy unconditionally injects the bearer token on behalf of the requester (`apps/web/app/api/admin/synthetic/shared.ts:44-55`), so browser caller identity is not re-checked.
- WebSocket upgrade routes check only method/path before `serverRef.upgrade` (`services/api/src/index.ts:1846-1939`); no Origin/auth/rate guard observed.

| # | Public route / operation | Handler | Expected checks | Actual checks by role | Middleware / proxy-derived identity | Hidden controls | Anomaly / draft |
|---:|---|---|---|---|---|---|---|
| 1 | `GET /health` | `services/api/src/index.ts:1360` | Public health | anon: allowed; auth/admin/internal: allowed | none | bind/proxy only | none |
| 2 | API `GET /admin/synthetic/status` | `services/api/src/index.ts:1364` | Synthetic admin only | anon/auth: 401; token-holder: allowed; internal: allowed only with token | `Authorization` or `x-synthetic-admin-token` | `SYNTHETIC_CONTROL_ENABLED`, backend mode | none |
| 3 | API `GET /admin/synthetic/control` | `services/api/src/index.ts:1372` | Synthetic admin only | anon/auth: 401; token-holder: allowed | same as above | same as above | none |
| 4 | API `PUT /admin/synthetic/control` | `services/api/src/index.ts:1380` | Synthetic admin only | anon/auth: 401; token-holder: can mutate control state | same as above | same as above | none at API layer |
| 5 | Next `GET /api/admin/synthetic/status` | `apps/web/app/api/admin/synthetic/status/route.ts:5` | Admin/browser session or equivalent server-side auth before proxying | anon/auth: allowed when feature/env configured; backend receives server bearer token; synthetic admin role effectively conferred | server route injects `Authorization: Bearer ${SYNTHETIC_ADMIN_TOKEN}` | `NEXT_PUBLIC_SYNTHETIC_ADMIN=1`, `NEXT_PUBLIC_API_URL` | **p5-001** |
| 6 | Next `GET /api/admin/synthetic/control` | `apps/web/app/api/admin/synthetic/control/route.ts:5` | Admin/browser session | anon/auth: allowed when feature/env configured; reads admin control | server token injection | same | **p5-001** |
| 7 | Next `PUT /api/admin/synthetic/control` | `apps/web/app/api/admin/synthetic/control/route.ts:11` | Admin/browser session + CSRF/origin intent | anon/auth: allowed when feature/env configured; body forwarded with server token | server token injection | same | **p5-001** |
| 8 | Recent REST reads: `GET /prints/options`, `/nbbo/options`, `/prints/equities`, `/quotes/equities`, `/joins/equities`, `/dark/inferred`, `/flow/packets`, `/flow/smart-money`, `/flow/classifier-hits`, `/flow/alerts`, `/news` | `services/api/src/index.ts:1407-1533` | Public per current architecture, or proxy/firewall if proprietary data | anon/auth/admin/internal: allowed; zod/limit parsing only | none | `API_HOST`/reverse proxy | review target: proprietary data scraping if exposed |
| 9 | Filtered/range REST reads: `GET /prints/equities/range`, `/candles/equities` | `services/api/src/index.ts:1438,1460` | Public per current architecture, bounded query params | anon/auth/admin/internal: allowed; parameter validation/limit only | optional Redis cache selected by request `cache` | bind/proxy, cache flag | none filed |
| 10 | Alert context helper route(s) | `services/api/src/index.ts:1539`, `:1670` | Public/read-only, bounded trace id | anon/auth/admin/internal: allowed; trace id parse/length check on regex path | none | bind/proxy | none filed |
| 11 | History REST reads: `/history/options`, `/history/nbbo`, `/history/equities`, `/history/equity-quotes`, `/history/equity-joins`, `/history/flow`, `/history/smart-money`, `/history/classifier-hits`, `/history/alerts`, `/history/inferred-dark`, `/history/news` | `services/api/src/index.ts:1558-1656` | Public per current architecture, bounded cursors/limits | anon/auth/admin/internal: allowed; cursor/limit validation only | none | bind/proxy | review target: bulk history extraction if not intended public |
| 12 | Object lookup reads: `GET /flow/packets/:id`, `/option-prints/by-trace`, `/equity-joins/by-id` | `services/api/src/index.ts:1664,1681,1714` | Public/read-only if market data IDs are non-sensitive | anon/auth/admin/internal: allowed; no actor ownership model present | none | bind/proxy | none filed; no user/tenant objects identified |
| 13 | Support lookup: `POST /lookup/options-support` | `services/api/src/index.ts:1687` | Public/read-only aggregation with body validation | anon/auth/admin/internal: allowed; zod body schema; no auth | none | bind/proxy | none filed |
| 14 | Replay reads: `/replay/options`, `/replay/nbbo`, `/replay/equities`, `/replay/equity-quotes`, `/replay/equity-candles`, `/replay/equity-joins`, `/replay/inferred-dark`, `/replay/flow`, `/replay/smart-money`, `/replay/classifier-hits`, `/replay/alerts` | `services/api/src/index.ts:1720-1838` | Public per current architecture, bounded cursors/limits | anon/auth/admin/internal: allowed; zod parsing/limits only | none | bind/proxy | review target: bulk replay extraction if proprietary |
| 15 | Legacy WebSockets: `/ws/options`, `/ws/options-nbbo`, `/ws/equities`, `/ws/equity-candles`, `/ws/equity-quotes`, `/ws/equity-joins`, `/ws/inferred-dark`, `/ws/flow`, `/ws/classifier-hits`, `/ws/smart-money`, `/ws/alerts` | `services/api/src/index.ts:1846-1926`, `:1958-1978` | Public live market streams or edge auth/rate/origin guard if proprietary | anon/auth/admin/internal: upgrade allowed by path; no Origin/auth check | none | bind/proxy, WebSocket origin not checked | review target: unauth streaming/resource exposure |
| 16 | Live WebSocket subscription API: `GET /ws/live` + subscribe/unsubscribe/ping messages | `services/api/src/index.ts:1934`, `:1982-2008` | Public live API with schema limits; auth/rate/origin if proprietary | anon/auth/admin/internal: upgrade allowed; messages schema-validated but no auth | subscription data from client message | bind/proxy, WebSocket origin not checked | review target: unauth streaming/resource exposure |
| 17 | Next public pages `/`, `/tape`, `/signals`, `/charts`, `/news`, `/options`, `/replay` | `apps/web/app/**` | Public UI | anon/auth/admin/internal: allowed by file routing | browser calls API configured by env | `NEXT_PUBLIC_API_URL` exposed to client | none filed |

## Anomalies promoted to drafts

- `piolium/findings-draft/p5-001-public-next-admin-proxy-confers-synthetic-admin.md` — public Next.js synthetic admin proxy routes inject the server admin token without authenticating the browser caller.

## Notes

No user/account/tenant ownership model was found in the enumerated market-data API, so public data endpoints were not filed as missing-guard findings solely because they lack auth. They remain deployment-policy review targets because the KB notes proprietary research value and exposure depends on reverse proxy/bind settings.
