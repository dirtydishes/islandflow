# Stage 01 Advisory & Dependency Intelligence Summary

## Scope and coverage
- Target: `/Users/kell/dev/islandflow`.
- Repository identity resolution: `islandflow` via basename fallback. No `owner/repo` was resolved from env, git remote, or manifests, so repo-specific GitHub Security Advisory API queries were skipped.
- Local git history: available. Repo commit search found `8464287 fix cves from forgejo issue 10 with dependency upgrades` and index commit `bff5334`, indicating recent dependency security remediation.
- First-party advisory signals: no project-owned CVE/GHSA IDs found outside installed `node_modules` and piolium artifacts.
- NVD keyword query for `islandflow`: 0 results.
- OSV batch query against npm dependencies: 116 historical advisories across dependency names. These are dependency-history signals, not all applicable to the pinned/ranged versions.

## Advisory inventory highlights

| Package/component | Advisory | Severity | CVE/alias | Affected / fixed range from OSV | Relevance to Islandflow |
|---|---:|---|---|---|---|
| `next` / web middleware | GHSA-f82v-jwr5-mffw | CRITICAL | CVE-2025-29927 | introduced 13.0.0; fixed 13.5.9 | Current `next ^16.2.6` appears beyond fixed range, but this class maps directly to auth/route middleware review. |
| `next` / script rendering | GHSA-gx5p-jg67-6x7h | MODERATE | CVE-2026-44580 | introduced 13.0.0; fixed 15.5.16 | Current range appears beyond fixed range; still informs XSS review for UI data rendering. |
| `next` / middleware redirect | GHSA-4342-x723-ch2f | MODERATE | CVE-2025-57822 | introduced 0.9.9; fixed 14.2.32 | Current range appears beyond fixed range; SSRF/redirect behavior remains important around API origin controls. |
| `next` / authorization | GHSA-7gfc-8cq8-jh5f | HIGH | CVE-2024-51479 | introduced 9.5.5; fixed 14.2.15 | Current range appears beyond fixed range; historical pattern is auth bypass in path/middleware matching. |
| `ws` | GHSA-2mhh-w6q8-5hxw | LOW | CVE-2016-10518 | introduced 0; fixed 1.0.1 | Current `ws ^8.21.0` appears beyond fixed range; websocket parsing and resource handling remain high-value. |
| `redis` | GHSA-35q2-47q7-3pc3 | HIGH | CVE-2021-29469 | introduced 2.6.0; fixed 3.1.1 | Current `redis ^5.10.0` appears beyond fixed range; Redis is security-relevant for hot caches/rolling stats. |
| `zod` | GHSA-m95q-7qp3-xv42 | MODERATE | CVE-2023-4316 | introduced 0; fixed 3.22.3 | Current `zod ^3.23.8` appears beyond fixed range; validates DoS risk from schema parsing. |
| `nats` | GHSA-prmc-5v5w-c465 | CRITICAL | none | introduced 2.0.0-201; fixed 2.0.0-209 | Current `nats ^2.24.0` appears beyond fixed range; credentials/TLS configuration remains critical. |
| `electron` | GHSA-2q4g-w47c-4674 | HIGH | CVE-2020-15174 | introduced 8.0.0-beta.0; fixed 8.5.1 | Current `electron ^39.2.0` appears beyond fixed range; desktop navigation/origin controls remain core. |
| `react-dom` | GHSA-mvjj-gqq2-p4hw | MODERATE | CVE-2018-6341 | introduced 16.0.0; fixed 16.0.1 | Current `react-dom ^19.2.0` appears beyond fixed range; historical XSS pattern relevant to rendering market/news data. |

OSV historical advisory counts by dependency name: `next` 55, `electron` 48, `ws` 6, `nats` 2, `react` 2, `react-dom` 1, `redis` 1, `zod` 1.

## Dependency intelligence
- Runtime stack: Bun workspaces, TypeScript, Next.js web frontend, Electron shell, multiple TS services, plus optional Python sidecars for IBKR/Databento options replay.
- Security-relevant direct dependencies:
  - `next ^16.2.6`, `react ^19.2.0`, `react-dom ^19.2.0`: public web UI and route surface. Historical patterns: auth bypass, middleware matching, SSRF redirects, cache poisoning, XSS.
  - `electron ^39.2.0`: desktop shell that loads hosted/local app. Historical patterns: navigation escape, protocol/IPC misuse, sandbox and origin boundary failures.
  - `ws ^8.21.0`: live market/news ingest websocket clients. Risk: parser/resource exhaustion and trust in third-party market data.
  - `nats ^2.24.0`: event bus/JetStream control plane. Risk: credential exposure, subject authorization, replay/control messages.
  - `redis ^5.10.0`: hot caches and rolling metrics. Risk: cache poisoning, key construction, TTL abuse, DoS.
  - `@clickhouse/client ^0.2.6`: durable event/history store. Risk: query construction, cursor pagination, large result-set DoS.
  - `zod ^3.23.8`: schema validation. Risk: validation DoS and inconsistent parse/sanitize boundaries.
  - `@msgpack/msgpack ^3.1.3`: binary decode in options ingest. Risk: malformed binary/resource exhaustion.
  - `@pierre/diffs ^1.2.2`: low-visibility dependency; should be inspected for maintainer health and reachable use.
- Root overrides pin `postcss`, `tar`, and `tmp`, suggesting prior remediation of known transitive CVEs.

## Architecture hints
- Components: `apps/web` Next.js UI; `apps/desktop` Electron shell; services for API, options/equities/news ingest, candles, compute, replay, refdata, eod-enricher; shared packages for bus, config, observability, storage, types.
- Transports/data stores: REST, WebSocket, NATS/JetStream, ClickHouse HTTP, Redis, external Alpaca websockets/REST, Databento/IBKR Python sidecars, Docker Compose deployment.
- Trust boundaries: internet/user-facing web and API; desktop-local Electron-to-hosted-app boundary; third-party market data feeds; internal NATS subjects; ClickHouse/Redis persistence; deployment/runtime environment variables containing API keys.
- Highest-risk flows for later stages:
  1. API REST/WebSocket endpoints handling cursor pagination, replay/history, raw `security=all` debug views, and live channel fanout.
  2. Ingest adapters accepting external websocket/binary/sidecar data before schema normalization and NATS publication.
  3. NATS subject publishing/subscription and replay service controls that can reintroduce stale or attacker-controlled events.
  4. Electron shell origin allowlist, navigation controls, preload/IPC exposure, and `ISLANDFLOW_DESKTOP_START_URL` handling.
  5. ClickHouse query construction for filters, cursors, symbols, and time windows.

## Pattern analysis and audit targeting
- Component heatmap from dependency history: web/Next.js is hottest (55 OSV advisories), Electron desktop second (48), websocket/event-ingest layer third (`ws`, `nats`).
- Recurring bug classes to hunt: auth bypass/middleware confusion, XSS/rendering injection, SSRF/open redirect, DoS/resource exhaustion, cache poisoning, navigation/IPC boundary bypass.
- Attack surface trends: network inputs dominate: HTTP routes, WebSocket streams, NATS messages, Redis/cache keys, ClickHouse query parameters, and external market-data payloads.
- Patch-quality signal: repeated Next.js and Electron advisory history means later review should assume framework boundary fixes are historically bypass-prone and verify application-level compensating controls.
- Recommended next-stage focus: prioritize DFD slices for API live/history/replay, ingest-to-NATS normalization, Electron shell boundary, and ClickHouse storage query paths. Mandatory review chambers should include auth bypass, XSS, SSRF/open redirect, parser/validation DoS, and message/cache poisoning.

## Artifacts produced
- `piolium/attack-surface/deps.tsv` — direct dependency inventory.
- `piolium/attack-surface/npm-dep-names.txt` — unique npm package names queried.
- `piolium/attack-surface/osv-query.json` and `osv-querybatch.json` — OSV batch request/response.
- `piolium/attack-surface/osv-findings.tsv` — flattened OSV package/advisory list.
- `piolium/attack-surface/osv-selected-details.json` — detail records for representative advisories.
- `piolium/attack-surface/nvd-islandflow.json` — NVD keyword response.
