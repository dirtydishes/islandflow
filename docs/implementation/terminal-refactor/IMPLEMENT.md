# Implementing the Terminal Refactor

This directory is the active implementation guide for the staged `apps/web/app/terminal.tsx` refactor.

Start with the full plan: [`00-roadmap.md`](./00-roadmap.md).

Readable status board: [`IMPLEMENT.html`](./IMPLEMENT.html).

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Only work on a terminal-refactor phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-e30y` - Plan terminal.tsx staged refactor

Phase issues:

- `islandflow-e30y.1` - Phase 01: scaffold and pure utilities
- `islandflow-e30y.2` - Phase 02: data hooks
- `islandflow-e30y.3` - Phase 03: state and shell
- `islandflow-e30y.4` - Phase 04: UI components
- `islandflow-e30y.5` - Phase 05: cleanup retired code
- `islandflow-e30y.6` - Phase 06: final verification and publish

## How To Pick Up Work

1. Run `bd ready`.
2. Pick the next ready `islandflow-e30y.*` issue.
3. Run `bd show <issue-id>` and read its `spec_id`.
4. Read [`00-roadmap.md`](./00-roadmap.md).
5. Read the phase document linked by the issue.
6. Claim the issue with `bd update <issue-id> --claim`.
7. Implement only that phase unless Beads dependencies explicitly unblock a parallel lane.

## Parallelization

The roadmap names which phases and lanes can be parallelized. Do not infer extra parallelism from file boundaries alone.

- Phase 01 can split by pure helper lane after the feature folder exists.
- Phase 02 can split into scroll/virtualization and live/session lanes.
- Phase 04 can split into OPRA, News, Dashboard/Chart, and Drawer lanes.
- Phase 05 can split by cleanup candidate after reachability is proven.
- Phases 03 and 06 are serial.

## Required Gates

Each phase document lists its gates. At minimum, keep these commands in mind:

```bash
bun test apps/web/app/terminal.test.ts
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun --cwd=apps/web run build
```

Phase 06 requires full closeout:

```bash
bun test
bun --cwd=apps/web run build
bd dolt push
git push forgejo <branch>
git status
```

## Scope Discipline

- Keep `apps/web/app/terminal.tsx` as a compatibility facade until the cleanup phase.
- Preserve `/`, `/options`, `/news`, and `/tape -> /options` behavior.
- Do not remove replay data mode.
- Do not remove smart-money fallback behavior without a separate Beads issue or product decision.
- If a phase becomes too large, create child Beads issues and add dependencies before continuing.
