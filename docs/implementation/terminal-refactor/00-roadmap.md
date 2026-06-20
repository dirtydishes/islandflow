# Terminal Refactor Roadmap

This roadmap breaks the `apps/web/app/terminal.tsx` refactor into implementation-sized phases. The goal is to turn the current 11k-line terminal file into a small public facade over focused terminal feature modules, while preserving current runtime behavior until each removal is proven safe.

## Source Plan

- Full plan: this document.
- Agent instructions: [`IMPLEMENT.md`](./IMPLEMENT.md)
- Current file: [`apps/web/app/terminal.tsx`](../../../apps/web/app/terminal.tsx)
- Current helper tests: [`apps/web/app/terminal.test.ts`](../../../apps/web/app/terminal.test.ts)
- Current route tests: [`apps/web/app/routes.test.ts`](../../../apps/web/app/routes.test.ts)

## Core Constraints

- Keep `apps/web/app/terminal.tsx` as the public compatibility facade until the final cleanup phase.
- Keep existing imports working during every phase: `TerminalAppShell`, `OverviewRoute`, `OptionsRoute`, `NewsRoute`, `NAV_ITEMS`, and helper exports currently used by `terminal.test.ts`.
- Put new implementation modules under `apps/web/features/terminal/`.
- Preserve `/`, `/options`, `/news`, and `/tape -> /options` behavior.
- Do not remove replay data mode. Only retired route UI is a cleanup candidate.
- Keep smart-money fallback behavior unless a separate product decision confirms smart-flow has fully replaced it.
- Use Beads for phase tracking; do not track phase progress in markdown task lists.

## Phase Sequence

| Phase | Beads issue | Depends on | Can parallelize with | Purpose |
| --- | --- | --- | --- | --- |
| 01 - Scaffold and pure utilities | `islandflow-e30y.1` | None | Pure helper lanes inside the phase | Create the feature folder and extract pure helpers behind the existing terminal facade. |
| 02 - Data hooks | `islandflow-e30y.2` | `islandflow-e30y.1` | Scroll/virtualization lane and live/session lane | Extract streaming, history, live-session, scroll, and virtual-list hooks. |
| 03 - State and shell | `islandflow-e30y.3` | `islandflow-e30y.2` | No | Extract terminal state/context and shared shell once data hooks are stable. |
| 04 - UI components | `islandflow-e30y.4` | `islandflow-e30y.3` | OPRA, news, dashboard/chart, and drawer lanes | Extract primitives, panes, route containers, drawers, and chart UI. |
| 05 - Cleanup retired code | `islandflow-e30y.5` | `islandflow-e30y.4` | Independent cleanup candidates after reachability is clear | Remove demonstrably retired route UI and stale compatibility code. |
| 06 - Final verification and publish | `islandflow-e30y.6` | `islandflow-e30y.5` | No | Run final gates, update Beads, document the session if required, commit, sync, and push. |

## Parallelization Rules

- Do not start a phase until `bd ready` shows that phase issue as unblocked.
- Phase 01 can split internally into route/config, formatter/label, tape reducer, and evidence-helper lanes after the feature folder exists.
- Phase 02 can split internally into scroll/virtualization hooks and live/session hooks after shared config and pure helpers are stable.
- Phase 04 can split internally into OPRA, News, Dashboard/Chart, and Drawers/Shell-adjacent UI groups after state/context extraction lands.
- Phase 05 can split cleanup by candidate, but each removal must have import-search evidence and passing tests.
- Phases 03 and 06 are intentionally serial because they touch the shared context/shell and final publishing workflow.

## Public Interface

The existing public import surface should survive every phase until a later phase explicitly changes it:

```ts
export {
  TerminalAppShell,
  OverviewRoute,
  OptionsRoute,
  NewsRoute,
  NAV_ITEMS
} from "./terminal";
```

The helper exports currently imported by `apps/web/app/terminal.test.ts` should also remain reachable from `./terminal` during the staged extraction. Internal modules may own the implementation, but `terminal.tsx` should re-export them until tests and route imports are intentionally updated.

## Matching Beads Epic

- `islandflow-e30y` - Plan terminal.tsx staged refactor

## Phase Documents

- [`01-scaffold-pure-utilities.md`](./01-scaffold-pure-utilities.md)
- [`02-data-hooks.md`](./02-data-hooks.md)
- [`03-state-shell.md`](./03-state-shell.md)
- [`04-ui-components.md`](./04-ui-components.md)
- [`05-cleanup-retired-code.md`](./05-cleanup-retired-code.md)
- [`06-final-verification.md`](./06-final-verification.md)
