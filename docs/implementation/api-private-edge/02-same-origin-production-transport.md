# Phase 02: Same-Origin Production Transport

## Intent

Make production browser traffic use the app origin for REST and websocket calls while preserving local dev ergonomics.

## Required Work

- Keep `NEXT_PUBLIC_API_URL` as an explicit override only, not a production default.
- Ensure browser URL builders resolve local hosts to the local API and nonlocal hosts to same-origin app paths.
- Add `ISLANDFLOW_INTERNAL_API_URL` for server-only Next route handlers that need to call the backend API.
- Update synthetic admin proxy code to use the server-only internal API URL, not a public env var.
- Extend the app-origin NPM/deploy matcher to include all browser-used API path prefixes:
  `ws`, `replay`, `prints`, `joins`, `nbbo`, `quotes`, `dark`, `flow`, `candles`, `history`, `news`, `lookup`, `option-prints`, and `equity-joins`.
- Update production smoke probes to validate same-origin success and fail when the built web bundle references the raw API origin.

## Acceptance Criteria

- Production browser code can run with blank `NEXT_PUBLIC_API_URL`.
- App-origin REST and websocket paths cover all browser-used endpoints.
- Server-only proxy code reads `ISLANDFLOW_INTERNAL_API_URL`.
- The raw API host remains open until Phase 04; this phase proves same-origin is ready first.
- Tests cover local fallback, same-origin production fallback, explicit override, and websocket URL conversion.

## Suggested Checks

```bash
bd show islandflow-hnbk.3
bun test apps/web/features/terminal apps/web/features/news-wire apps/web/app/api/admin/synthetic
bun --cwd=apps/web run build
bun run scripts/probes/durable-tapes-production-smoke.ts --target=<production-app-origin>/durable-tapes --api-origin=<internal-or-placeholder-origin>
```

## Implementation Subagents

The Phase 02 worker may use helper subagents for parallel transport and edge-contract review.

Good helper targets:

- Browser REST and websocket URL builders.
- Server-only proxy config and synthetic admin proxy behavior.
- Deployment helper and NPM route matcher coverage.
- Production smoke probe and bundle-hostname checks.

Helpers may propose specific edits or tests, but the worker owns the transport contract, branch, Beads updates, commit, PR state, and final callback.

## Out Of Scope

- Raw API host closure.
- Login/session auth.
- Rate limiting beyond any small test scaffolding needed for this phase.
