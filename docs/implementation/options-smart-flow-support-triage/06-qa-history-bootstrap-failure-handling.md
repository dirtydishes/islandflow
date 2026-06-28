# Phase 06: QA History Bootstrap Failure Handling

Canonical Beads issue: `islandflow-j06e.6`

Epic: `islandflow-j06e`

Status is tracked in Beads. This doc is implementation context for the follow-up discovered during Phase 04.

## Outcome

Handle unavailable API/history bootstrap paths for `/options` and `/qa` without unhandled browser rejections or development overlays.

## Scope

Allowed:

- Make options history loading handle API-origin failures as a bounded degraded state.
- Make QA candle/bootstrap loading handle API-origin failures without unhandled promise rejections.
- Preserve current successful API behavior when the API is available.
- Add focused tests for unavailable API/history paths and existing successful loading paths.
- Add browser verification for `/options` and `/qa` with unavailable API behavior.

Out of scope:

- New options support, packet, or more-info behavior.
- Broad QA redesign.
- Changing API routing, deployment, or CORS policy.
- Suppressing legitimate errors globally.
- Unbounded retry loops.

## Inputs

- Phase 04 QA diagnostics and module settings.
- Phase 05 more-info detail loading patterns.
- `apps/web/features/options-tape/`
- `apps/web/features/durable-tape/qa-page.tsx`
- Route tests and browser QA harness patterns.

## Implementation Notes

- Prefer explicit local degraded state or no-op retry controls over global error swallowing.
- Keep retries bounded and user-initiated unless an existing local pattern already handles backoff.
- Do not make the default product module show QA diagnostics to explain the degraded state.
- Avoid coupling QA candle bootstrap failures to options tape support/detail state.

## Beads

- Epic: `islandflow-j06e`
- Issue: `islandflow-j06e.6`
- Discovered from: `islandflow-j06e.4`
- Parallel-safe: No. This is the remaining epic child and should finish before epic closeout.

## Expected Files Or Areas

- `apps/web/features/options-tape/`
- `apps/web/features/durable-tape/qa-page.tsx`
- `apps/web/app/routes.test.ts`
- Tests near options tape and QA route integration.

## Quality Gates

```bash
bun test apps/web/features/options-tape
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun --cwd=apps/web run build
```

Browser verification should cover `/options` and `/qa` with unavailable API/history bootstrap behavior at desktop and mobile widths.

## Completion Criteria

- `/options` renders without unhandled promise rejections when the API origin is unavailable.
- `/qa` renders without unhandled promise rejections when history/bootstrap calls fail.
- Existing successful history and chart behavior remains unchanged when the API is available.
- Retry or degraded-state behavior is bounded and visible or intentionally quiet.
- The phase turn doc records implementation, review, CI/gates, Beads updates, and any follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for API routing, deployment, CORS, or broader QA reliability work.
