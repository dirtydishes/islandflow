# Context Map

Islandflow is a Bun + TypeScript monorepo with multiple domain contexts. Read the context file for the area you are changing when it exists; if it does not exist yet, proceed silently and let domain-modeling work create it lazily when the project resolves terminology or decisions.

## Contexts

| Area | Context file | Notes |
| ---- | ------------ | ----- |
| Web application | `apps/web/CONTEXT.md` | Product UI, live/replay stream presentation, dashboards, and user-facing terminology. |
| Runtime services | `services/<service>/CONTEXT.md` | Ingest, compute, candles, API, and other service-specific pipeline behavior. |
| Shared packages | `packages/<package>/CONTEXT.md` | Shared contracts, types, storage, event envelopes, and reusable infrastructure. |
| Implementation docs | `docs/implementation/<area>/CONTEXT.md` | Phase plans, roadmap vocabulary, and implementation-scope decisions. |

## ADRs

Read `docs/adr/` for system-wide decisions when it exists. Also check context-local `docs/adr/` directories under the relevant area when they exist.
