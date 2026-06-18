# Stage 04 Source-to-Sink Flows (All Severities)

Tooling note: `codeql` and `semgrep` were not present on PATH. Per instruction, Stage 04 fell back to grep/read plus Phase 3 candidate prioritization. Custom placeholder CodeQL queries and Semgrep rules are stored under `piolium/codeql-queries/` and `piolium/semgrep-rules/`.

## High-priority flows

| ID | Source | Path | Sink | Security relevance | Draft |
|---|---|---|---|---|---|
| F-001 | Alpaca/provider news `item.content` (`services/ingest-news/src/index.ts:78`) | `content_html` -> NATS/ClickHouse -> `sanitizeNewsHtml` regex (`apps/web/app/terminal.tsx:1272`) | `dangerouslySetInnerHTML` (`apps/web/app/terminal.tsx:5009`) | Stored XSS via provider-controlled HTML | `p4-001` |
| F-002 | Remote WebSocket upgrade and messages (`services/api/src/index.ts:1844`, `1959`) | unauthenticated `serverRef.upgrade` -> socket set/subscription -> `liveState.getSnapshot` | `socket.send` fanout/snapshot (`services/api/src/index.ts:1982`) | Unauthenticated data streaming/resource abuse | `p4-002` |
| F-003 | Remote HTTP query/path params (`services/api/src/index.ts:1357`) | manual routes parse params -> storage fetchers | ClickHouse `client.query` in `packages/storage/src/clickhouse.ts` | Public data exfil if API exposed | `p4-003` |
| F-004 | Next admin proxy route body/path + env base (`apps/web/app/api/admin/synthetic/*.ts`) | fixed route paths -> `new URL(path, NEXT_PUBLIC_API_URL)` -> bearer header from `SYNTHETIC_ADMIN_TOKEN` | `fetch(url.toString())` (`shared.ts:51`) | Environment-controlled SSRF/control channel; path fixed, so downgraded | none |
| F-005 | HTTP admin control body + auth header (`services/api/src/index.ts:1339`, `1386`) | bearer token compare -> `SyntheticControlStateSchema.parse` | `writeSyntheticControlState` (`services/api/src/index.ts:1387`) | Hidden control channel; gated by token/feature flag | none |
| F-006 | WebSocket live message bytes (`services/api/src/index.ts:1959`) | `TextDecoder` -> `JSON.parse` -> Zod schemas | subscription maps/live snapshots | DoS potential; needs message-size/connection quotas | covered by `p4-002` |
| F-007 | Env/config Python binary and adapter settings | `buildArgs(trimmed)` / `args` arrays | `Bun.spawn` (`databento.ts:305`, `ibkr.ts:92`) | Local/env-controlled subprocess path; no shell, downgraded to env/admin-only | none |
| F-008 | User query arrays (`trace_id`, `id`, filters) | `url.searchParams.getAll` -> query-builder helpers (`quoteString`, `buildStringList`, `clamp*`) | ClickHouse template queries | SQLi mostly mitigated by escaping/clamps; query DoS still worth limits | none |

## Hidden-control-channel review

- `authorization` / `x-synthetic-admin-token` in `services/api/src/index.ts:327-333`: affects admin control authorization; correctly checked for `/admin/synthetic/*`, absent from data routes.
- `NEXT_PUBLIC_SYNTHETIC_ADMIN`, `NEXT_PUBLIC_API_URL`, `SYNTHETIC_ADMIN_TOKEN` in `apps/web/app/api/admin/synthetic/shared.ts`: controls whether the admin proxy exists and where it sends privileged bearer requests.
- `window.location.host` in `apps/web/app/terminal.tsx:1024/1045`: client-side API/WS endpoint selection follows current origin; relevant to reverse-proxy host trust but not a server-side SSRF.
- Response `content-type` checks in `terminal.tsx` and scripts: robustness checks, not auth/routing controls.

## Dropped/low candidates

- Test secrets in `*.test.ts`: source-controlled test literals only.
- `exec` matches in ClickHouse client: SQL execution/query API, not OS command execution.
- Static `redirect("/")`/`redirect("/options")`: no user-controlled URL.
- `Array.join` path-traversal matches: mostly string formatting/query construction false positives.
- Dev/deploy `Bun.spawn`/`spawnSync` in scripts: local tooling/admin context unless used by untrusted CI input.
