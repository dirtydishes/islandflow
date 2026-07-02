# Phase 03: Root Route Feature Upgrade

Canonical Beads issue: `islandflow-mcmd.3`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Update root `/` dashboard feature subscriptions so the replacement dashboard receives every required feed while preserving `/qa`, `/options`, and `/news` behavior.

## Scope

Allowed:

- Update root route features for `/`.
- Ensure `/` subscribes to:
  - `options`
  - `nbbo`
  - `equities`
  - `flow`
  - `news`
  - `smart-flow-alerts`
  - `smart-flow`
  - `durable-rows`
  - `inferred-dark`
  - `equity-joins`
  - `equity-candles`
  - `equity-overlay`
- Add/adjust route feature tests.
- Confirm chart candles and overlays still receive data for focused ticker paths.

Out of scope:

- Dashboard layout replacement.
- Ticker rail visual work.
- Detail drawer.
- News ordering.
- Changes to `/qa`, `/options`, or `/news` feature sets except test fixtures required to prove no change.

## Inputs

- `apps/web/app/terminal.tsx`
- `apps/web/features/terminal/`
- Existing route feature tests.
- `docs/implementation/market-command-dashboard/02-ticker-rail-focus-model.md`

## Implementation Notes

- Keep the public navigation label `Dashboard`.
- Do not create a hidden v2 route.
- Preserve route-specific behavior:
  - `/qa` remains a QA/diagnostic surface.
  - `/options` keeps its existing options workflow.
  - `/news` keeps its existing news workflow.
- Prefer small route-feature helpers or tables if they already exist. Avoid a broad route rewrite in this phase.
- This phase should prove the data surface before visual replacement begins.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.3`
- Depends on: `islandflow-mcmd.2`
- Parallel-safe: No. Layout work should wait until the root feed surface is known.

## Expected Files Or Areas

- `apps/web/app/terminal.tsx`
- `apps/web/features/terminal/`
- Route feature tests under `apps/web/`

## Suggested Swarms

- Route feature scout: map current route-to-feature behavior.
- Regression scout: verify `/qa`, `/options`, and `/news` expected subscriptions.
- Chart data scout: confirm candle/overlay dependencies and focused symbol paths.
- Test scout: add stable route feature assertions without coupling to implementation internals.

## Quality Gates

```bash
bun test apps/web
bun --cwd=apps/web run build
```

Run narrower route tests first when available, then the build.

## Completion Criteria

- `/` subscribes to durable rows and NBBO.
- `/` includes the locked root dashboard feature set.
- Existing route tests still pass.
- No extra subscriptions are added to `/options` or `/news`.
- Phase turn doc records implementation, review, CI/gates, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for any unrelated route or bootstrap cleanup discovered during subscription work.
