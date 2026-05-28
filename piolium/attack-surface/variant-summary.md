# Phase 12 Variant Summary

Variant analysis reviewed surviving findings in `piolium/findings-draft/` and searched code/attack-surface artifacts for sibling sources, sinks, and flow shapes. `piolium/attack-pattern-registry.json` was not present, so no registry update could be made.

## Confirmed variants

1. `piolium/findings-draft/p12-001-unauthenticated-nats-market-event-injection.md` — expands the confirmed unauthenticated `flow.news` producer-impersonation flaw to the other trusted market/derived NATS subjects consumed by API, compute, and candles.
2. `piolium/findings-draft/p12-002-candles-jetstream-redelivery-duplicates-derived-candles.md` — same JetStream side-effects-before-ack idempotency gap as compute, present in the candles worker.

## Searches performed

- HTML injection/XSS: only `apps/web/app/terminal.tsx` uses `dangerouslySetInnerHTML` and the regex sanitizer pattern.
- Admin proxy: only `apps/web/app/api/admin/synthetic/*` injects a server bearer token into public Next route proxying.
- WebSocket auth/origin: unauthenticated upgrade pattern is centralized in `services/api/src/index.ts`; no additional WS servers found.
- NATS producer trust: API consumer binding matrix and worker subscriptions show additional subjects accepting schema-only messages from the unauthenticated broker.
- JetStream redelivery/idempotency: candles worker matches the compute side-effect-before-ack shape.
- Infrastructure exposure: root compose exposure finding remains centralized to root `docker-compose.yml`; production compose does not publish infra ports directly in the same way.
