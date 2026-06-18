# Stage 08 Manual Attack Surface Probe Summary

Status: complete  
Mode: single-team MVP  
Inventory: `piolium/attack-surface/manual-attack-surface-inventory.md`

## Sources reviewed
- `piolium/attack-surface/knowledge-base-report.md`
- `piolium/attack-surface/candidates-summary.md`
- P3-P7 artifacts: public route authz matrix, source/sink flows, spec gap summary, state/concurrency summary
- Source files for selected slices: `services/api/src/index.ts`, `apps/web/app/api/admin/synthetic/**`, `apps/web/app/terminal.tsx`, `services/ingest-news/src/index.ts`, `docker-compose.yml`

## Inline hypotheses and verification

| ID | Reasoning | Hypothesis | Verification result | Draft |
|---|---|---|---|---|
| H1 | Backward | If synthetic admin control is high-impact, look backward from `writeSyntheticControlState` to see whether every caller is authenticated as an admin user. | Validated: API requires bearer token, but Next public route injects that token for any caller when enabled (`shared.ts:25-55`; route handlers at `status/route.ts:5-7`, `control/route.ts:5-17`; API mutation at `index.ts:1380-1388`). | `piolium/findings-draft/p8-001-public-next-admin-proxy-synthetic-control.md` |
| H2 | Backward | If provider-controlled HTML can execute in the browser, trace from feed `content` to DOM sinks. | Validated as fragile stored-XSS boundary: `item.content` becomes `content_html` (`ingest-news/src/index.ts:76-96`), regex sanitizer is used (`terminal.tsx:1272-1287`), then `dangerouslySetInnerHTML` (`terminal.tsx:5008-5009`). | `piolium/findings-draft/p8-002-provider-news-html-regex-sanitizer-xss.md` |
| H3 | Contradiction | The system assumes infra is internal-only; check for a deployment artifact that contradicts this by publishing internal services. | Validated: root compose publishes ClickHouse `8123/9000`, Redis `6379`, and NATS `4222/8222` without credentials/TLS/ACLs visible (`docker-compose.yml:4-24`). | `piolium/findings-draft/p8-003-root-compose-exposes-unauthenticated-infrastructure.md` |
| H4 | Contradiction | The API relies on deployment perimeter for proprietary data; check whether WS route code enforces auth/origin if perimeter is absent. | Validated: WS upgrades happen by path only (`services/api/src/index.ts:1846-1936`); live messages can subscribe and receive snapshots without auth (`index.ts:1982-2008`). | `piolium/findings-draft/p8-004-unauthenticated-websocket-market-streams.md` |

## Coverage by slice

| Slice | Public routes / channels | Attacker source | Sink | Result |
|---|---|---|---|---|
| Synthetic admin | `/api/admin/synthetic/*`, `/admin/synthetic/*` | Anonymous browser + feature/env enabled | NATS KV synthetic control | Finding drafted P8-001 |
| News HTML | `/history/news`, UI news drawer | Provider `item.content` | Browser DOM `dangerouslySetInnerHTML` | Finding drafted P8-002 |
| Infra services | Host ports `8123`, `9000`, `6379`, `4222`, `8222` | Network client | ClickHouse/Redis/NATS | Finding drafted P8-003 |
| WebSockets | `/ws/*`, `/ws/live` | Anonymous WS client / cross-site browser | Live broadcasts/snapshots | Finding drafted P8-004 |
| REST history/replay | `/history/*`, `/replay/*` | Anonymous HTTP query params | ClickHouse query reads | Already covered by previous P4/P5; not re-drafted except WS focus |

## Notes
- Several P8 findings intentionally promote/refresh earlier P4-P7 candidates with manual file:line evidence, as requested for Stage 08 drafts.
- No SQL injection was promoted in this pass; prior artifacts show query builders commonly use zod parsing, clamps, and quote helpers, while the higher-impact verified paths above had clearer exploitability.
