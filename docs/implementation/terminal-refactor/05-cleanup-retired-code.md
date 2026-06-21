# Phase 05: Cleanup Retired Code

Beads issue: `islandflow-e30y.5`

Full plan: [`00-roadmap.md`](./00-roadmap.md)

## Purpose

Remove stale terminal code only after extraction makes import reachability and route behavior clear.

## Cleanup Candidates

- Retired route exports: `SignalsRoute`, `ChartsRoute`, and `ReplayRoute`, because the current page files redirect away from those routes.
- Components only reachable from retired route exports, such as `ClassifierPane`, `FocusPane`, `ReplayConsole`, and any unreferenced alert/dark/equities panes.
- Route-feature branches for `/signals`, `/charts`, and `/replay`, after tests are updated to reflect the current supported terminal surfaces.
- Compatibility CSS for removed route UI, only when class-name search confirms there are no remaining consumers.

## Explicit Retentions

- Keep `/tape` compatibility as an alias to `/options`; current route tests and terminal tests assert this behavior.
- Keep replay data mode and replay endpoints used by live/replay hooks.
- Keep smart-money fallback behavior unless a separate Beads issue or product decision says smart-flow has fully replaced it.
- Keep `/mock*` shell bypass unless mock routes are removed in a separate cleanup decision.

## Dependencies

- Depends on: `islandflow-e30y.4`.
- Blocks: `islandflow-e30y.6`.

## Parallel Work

Cleanup can split by candidate after Phase 04, but every removal needs:

- `rg` evidence that the symbol/class/route is no longer used.
- Updated or removed tests that previously documented retired behavior.
- A short note in the Beads issue explaining why the removal is safe.

## Acceptance Gates

- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`
- The remaining public terminal facade exports only supported route surfaces and intentionally retained compatibility helpers.
