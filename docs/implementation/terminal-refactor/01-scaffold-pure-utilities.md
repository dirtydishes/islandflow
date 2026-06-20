# Phase 01: Scaffold and Pure Utilities

Beads issue: `islandflow-e30y.1`

Full plan: [`00-roadmap.md`](./00-roadmap.md)

## Purpose

Create the terminal feature module home and move pure, testable helpers out of `apps/web/app/terminal.tsx` without changing the external import surface or runtime behavior.

## Scope

- Add `apps/web/features/terminal/`.
- Create focused pure modules for config, route features, formatting, ticker/filter helpers, pausable tape reducers, evidence refs, and chart marker builders.
- Keep `apps/web/app/terminal.tsx` as a compatibility facade that re-exports the helpers used by existing tests.
- Move only logic that does not depend on React state, DOM APIs, websockets, or rendered JSX.

## Suggested Module Split

- `config.ts`: env-derived constants, virtual list config, candle interval config, stale thresholds.
- `routes.ts`: terminal path normalization, route feature map, nav current href, nav items.
- `format.ts`: price, size, time, option contract, news timestamp, label helpers.
- `filters.ts`: default flow filters, filter counting/toggling, ticker input parsing, option tape filtering/query helpers.
- `tape.ts`: sortable item helpers, pausable tape reducers, history merge helpers, feed status helpers.
- `evidence.ts`: alert context path, evidence collection, alert/smart-flow ref helpers, pinned evidence pruning.
- `charts/markers.ts`: chart flow marker item types and marker selection helpers.

## Dependencies

- Depends on: none.
- Blocks: `islandflow-e30y.2`.

## Parallel Work

After the folder scaffold exists, independent agents can work on these lanes:

- Route/config extraction.
- Formatting and label helpers.
- Tape reducer/history helpers.
- Evidence and chart marker helpers.

Each lane must leave `apps/web/app/terminal.tsx` exporting the old names.

## Acceptance Gates

- `bun test apps/web/app/terminal.test.ts`
- No behavior changes to `/`, `/options`, `/news`, or `/tape`.
- The full plan remains linked from any newly created module notes or comments that reference the staged refactor.
