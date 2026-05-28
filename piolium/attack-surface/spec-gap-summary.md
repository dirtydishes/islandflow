# Stage 07 — Specification, Framework Contract & Parser Gaps

## Scope

Phase 3 identified no formal application RFC/spec commitments, so this stage focused on de facto framework/runtime contracts: Bun HTTP/WebSocket routing, Next.js route-handler proxying, Docker/proxy deployment assumptions, and internal infrastructure trust channels.

## High-signal gaps retained

1. **Unauthenticated infrastructure services exposed by root Compose** — `docker-compose.yml` publishes ClickHouse, Redis, and NATS directly on host ports with no credentials/TLS/ACL configuration. This violates the deployment contract implied by the production compose file, where these services are internal-only. Draft: `piolium/findings-draft/p7-001-root-compose-exposes-unauth-infra.md`.

## Reviewed but not retained as new P7 findings

- **WebSocket Origin/auth contract**: Bun upgrades `/ws/*` by path only and does not inspect `Origin` or auth. This is already covered by existing draft `p4-002-unauthenticated-websocket-market-data-streams.md`; no duplicate P7 draft was created.
- **Public unauthenticated REST market-data APIs**: already covered by `p4-003-public-api-exposes-queryable-market-history.md`.
- **Provider HTML rendering/sanitization**: already covered by `p4-001-stored-xss-news-html-regex-sanitizer.md`.
- **Next.js synthetic admin proxy target (`NEXT_PUBLIC_API_URL`)**: server-side admin proxy derives its target from a public/build-time env var. This is a hardening concern and config footgun, but I did not retain it as Medium+ without an external attacker path to set deployment env or read the server-only `SYNTHETIC_ADMIN_TOKEN`.
- **Encoded path parsing for `/flow/alerts/:trace/context` and `/flow/packets/:id`**: manual regex checks occur on `URL.pathname` before `decodeURIComponent`, allowing `%2F` inside decoded IDs. Current impact appears limited to identifier lookup, not authorization/routing bypass, so it was not retained.

## Framework-contract conclusion

The most concrete new Stage 07 gap is a deployment-mode differential: production compose relies on internal-only Docker networking for ClickHouse/Redis/NATS, while the root compose publishes those same unauthenticated services on all interfaces by default. If the root compose is used on a workstation/VPS with reachable host ports, a network attacker can publish forged NATS events, read/write Redis state, or query/alter ClickHouse data outside any API-layer checks.
