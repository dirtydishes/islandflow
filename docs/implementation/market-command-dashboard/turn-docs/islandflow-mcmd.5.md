# Phase 05 Turn Doc: Hybrid Detail Drawer Model

Beads issue: `islandflow-mcmd.5`

Phase doc: `docs/implementation/market-command-dashboard/05-hybrid-detail-model.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected by the closeout/selector subagent after Phase `islandflow-mcmd.4` closed and PR #105 merged into `dashboard-v2`.

Preflight:

- Assigned branch: `lavender/islandflow-mcmd-5-hybrid-detail-model`
- Base branch: `dashboard-v2`
- Callback target: `019f2079-1443-7e53-95a3-ee0eb7bf5ba0`
- Beads issue claimed by the orchestrator before implementation thread launch.

## Scope

Extend durable alert selection for external detail and add the shared dashboard detail drawer.

## Implementation Log

2026-07-02 implementation:

- Added external alert-row selection to `DurableTapeAlertRowsPane` with `detailMode`, `selectedRowId`, and `onSelectRow`, preserving inline detail as the default behavior.
- Added `MarketCommandDetailDrawer` as the dashboard-owned shared drawer for durable alert rows, smart-flow chart markers, inferred-dark markers, news stories, and legacy alert fallback details.
- Routed Market Command durable alert rows, chart marker clicks, and news story selection into the shared drawer. Smart-flow and inferred-dark marker clicks focus the relevant ticker before opening detail.
- Kept alert hover previews inline. External alert detail no longer renders `alerts-module-detail` inside the 1/3 alerts pane.
- Wrapped option and flow packet row actions so they focus the contract/packet and close any open Market Command drawer instead of opening a competing large detail surface. Disabled the raw `OptionsTape` smart-flow detail panel only for Market Command fallback usage.
- Added focused static component tests for external alert selection and durable alert drawer rendering.

## Subagent Swarms

Not used; bounded local inspection was sufficient.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started. The orchestrator owns review-thread creation after the implementation callback.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `not-started`

Evidence:

- `bun install --frozen-lockfile` passed after the prepared worktree initially lacked installed dependencies.
- `bun test apps/web/features/durable-tape` passed: 41 tests.
- `bun test apps/web/features/market-command` passed: 9 tests.
- `bun test apps/web/features/options-tape` passed: 27 tests, run because the raw options detail surface was touched.
- `bun test apps/web/features/news-wire` passed: 8 tests, run because news detail mode was touched.
- `bun test apps/web/features/terminal/live-session-state.test.ts apps/web/features/api-transport.test.ts` passed: 11 tests.
- `bunx biome check` passed for touched files.
- `git diff --check` passed.
- `bun --cwd=apps/web run build` passed.

Browser evidence:

- Started the worktree web app on `http://localhost:3105` first; confirmed desktop `/` renders the replacement dashboard with no drawer open, local fallback ranking visible, desktop overflow `-15`, and mobile 390px overflow `0` with reduced motion emulation active.
- Restarted the worktree web app on `http://localhost:3100` with `NEXT_PUBLIC_API_URL=http://172.18.0.1:4000`. A populated Chromium snapshot of `/` showed 261 alert rows, 203 news rows, 100 option rows, 430 flow rows, desktop overflow `-15`, and mobile 390px overflow `0`.
- Follow-up interaction probes could not be completed reliably because the deployment-host API at `172.18.0.1:4000` later timed out even on `/health`, and fresh Chromium pages remained in `Connecting` with no live rows. The code paths are covered by the focused component tests above; a deterministic browser fixture follow-up was filed as `islandflow-mcmd.8`.

## PR And Commits

- PR: https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/106
- `a6bb311` — add market command shared detail drawer

## Beads Updates

- Created phase issue `islandflow-mcmd.5`.
- Blocked by `islandflow-mcmd.4`.
- Orchestrator claimed `islandflow-mcmd.5` after Phase 04 closeout and assigned branch `lavender/islandflow-mcmd-5-hybrid-detail-model`.
- Implementation filed follow-up `islandflow-mcmd.8` for deterministic browser fixtures because live API/socket availability blocked repeatable drawer interaction probes.

## Follow-Ups Filed

- `islandflow-mcmd.8` — Add deterministic Market Command drawer browser fixture.

## Context To Keep

- `detailMode="external"` must not consume alert pane height.
- Hover previews remain inline.
- Shared drawer handles alerts, smart-flow markers, inferred-dark markers, and news stories.

## Closeout

Implementation PR #106 is open against `dashboard-v2` and branch `lavender/islandflow-mcmd-5-hybrid-detail-model` is pushed to Forgejo. Beads phase `islandflow-mcmd.5` intentionally left open for orchestrator/reviewer closeout.
