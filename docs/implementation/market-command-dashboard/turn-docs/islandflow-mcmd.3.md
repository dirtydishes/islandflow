# Phase 03 Turn Doc: Root Route Feature Upgrade

Beads issue: `islandflow-mcmd.3`

Phase doc: `docs/implementation/market-command-dashboard/03-route-feature-upgrade.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected Beads phase `islandflow-mcmd.3` from the orchestrator prompt.

Preflight:

- Worktree: `/home/delta/.codex/worktrees/b01c/islandflow`
- Branch: `lavender/islandflow-mcmd-3-route-feature-upgrade`
- Callback target: `019f2079-1443-7e53-95a3-ee0eb7bf5ba0`

## Scope

Update root `/` feature subscriptions while preserving `/qa`, `/options`, and `/news` behavior.

## Implementation Log

- Updated the normalized root `/` route feature surface in `apps/web/features/terminal/routes.ts`.
- Root `/` now enables `nbbo` and `durableRows`, completing the locked subscription set with the existing options, equities, flow, news, smart-flow-alerts, smart-flow, inferred-dark, equity-joins, equity-candles, and equity-overlay feeds.
- Preserved `/qa`, `/options`, and `/news` route feature behavior.
- Added stable route feature and live manifest assertions in `apps/web/app/terminal.test.ts`.
- Confirmed focused dashboard chart paths still send `equity-candles` and `equity-overlay` with the active chart ticker.

## Subagent Swarms

No subagents used. The scout pass found the phase surface was two route flags plus targeted assertions, so local implementation was the tighter path.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started. Per loop contract, the orchestrator creates the review thread after implementation callback.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `not-started`

Evidence:

- Local narrow route gate: `bun test apps/web/app/terminal.test.ts` passed, 92 tests.
- Required web gate: `bun test apps/web` passed, 277 tests.
- Required production build: `bun --cwd=apps/web run build` passed.
- Scoped Biome: `bunx biome check apps/web/features/terminal/routes.ts apps/web/app/terminal.test.ts` passed.
- Whitespace gate: `git diff --check` passed.
- Browser verification server: `PORT=3001 bun --cwd=apps/web run start`.
- Chromium desktop `/`, 1440x1100: document `scrollWidth` 1425, no document-level horizontal overflow, no visible dialog/backdrop overlays, `Local fallback` rail visible, screenshot `/tmp/islandflow-mcmd3-desktop.png`.
- Chromium mobile `/`, 390x844: document `scrollWidth` 390, no document-level horizontal overflow, no visible dialog/backdrop overlays, screenshot `/tmp/islandflow-mcmd3-mobile.png`.
- Chromium reduced-motion `/`, 1440x1100 with `prefers-reduced-motion: reduce`: document `scrollWidth` 1425, no document-level horizontal overflow, no visible dialog/backdrop overlays, ticker rail `is-looping` false, screenshot `/tmp/islandflow-mcmd3-reduced-motion.png`.

## PR And Commits

Pending commit and Forgejo PR.

## Beads Updates

- Created phase issue `islandflow-mcmd.3`.
- Blocked by `islandflow-mcmd.2`.
- Implementation thread did not close the Beads phase issue; closeout remains orchestrator-owned.

## Follow-Ups Filed

None.

## Context To Keep

- `/` receives durable rows, NBBO, smart-flow, inferred-dark, equity candles, and overlays.
- `/qa`, `/options`, and `/news` must not gain extra subscriptions.

## Closeout

Implementation is locally ready for commit, push, Forgejo PR, and one schema-valid callback.
