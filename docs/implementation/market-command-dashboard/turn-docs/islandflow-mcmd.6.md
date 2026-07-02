# Phase 06 Turn Doc: News Relevance Ordering

Beads issue: `islandflow-mcmd.6`

Phase doc: `docs/implementation/market-command-dashboard/06-news-relevance-ordering.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected by the closeout/selector subagent after Phase `islandflow-mcmd.5` closed and PR #106 merged into `dashboard-v2`.

Preflight:

- Assigned branch: `lavender/islandflow-mcmd-6-news-relevance-ordering`
- Base branch: `dashboard-v2`
- Callback target: `019f2079-1443-7e53-95a3-ee0eb7bf5ba0`
- Beads issue claimed by the orchestrator before implementation thread launch.

## Scope

Promote focused ticker stories first while preserving broader market stories in the full-width News Wire.

## Implementation Log

- Verified assigned worktree was detached at the assigned commit, then attached it to
  `lavender/islandflow-mcmd-6-news-relevance-ordering`.
- Added focused-plus-market relevance ordering to `NewsWire` behind an opt-in
  `scopeMode="promote"` prop. Default `scopeSymbols` behavior remains filtered
  for existing `/news` and durable tape QA consumers.
- Added focused and market section labels in the same News Wire surface:
  a compact relevance strip above the tape and per-row labels in the headline
  cell.
- Updated Market Command to use promoted scope mode and pass the full
  `state.news.items` feed so focused ticker changes do not hide broader market
  stories before News Wire can order them.
- Added a `getSortCursor` extension to `DurableTape` so News Wire can preserve
  relevance ordering visually without corrupting the real history cursor used
  for paging.
- Kept news detail behavior on the Phase 05 shared drawer by preserving
  `detailMode="external"` and the Market Command `openNewsDetail` callback.

## Subagent Swarms

Not used. The implementation was small enough to keep local, with direct code
scouting for News Wire, terminal focus state, DurableTape ordering, and route
tests.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `not-started`

Evidence:

- `bun test apps/web` - passed, 285 tests.
- `bun --cwd=apps/web run build` - passed, Next.js production build completed.
- Scoped Biome:
  `./node_modules/.bin/biome check apps/web/features/durable-tape/components/DurableTape.tsx apps/web/features/durable-tape/types.ts apps/web/features/news-wire/NewsWire.tsx apps/web/features/news-wire/filters.ts apps/web/features/news-wire/news-wire.test.ts apps/web/features/market-command/MarketCommandRoute.tsx apps/web/features/market-command/MarketCommandRoute.test.tsx apps/web/app/globals.css`
  - passed.
- `git diff --check` - passed.

Browser evidence:

- Real Chromium path: `/usr/bin/chromium`.
- Fallback pass on `http://127.0.0.1:3001/` with default API origin failing:
  desktop `1440x1100` with `prefers-reduced-motion: reduce` and mobile
  `390x900`. Verified Market Command, News Wire, Focus rail, local fallback
  label, reduced-motion no-loop, overlay-free rendering, and no page-level
  horizontal overflow.
- Seeded live pass using a temporary local fake API on `127.0.0.1:4011` and the
  worktree dev server on `127.0.0.1:3001`: desktop `1440x1100` and mobile
  `390x900`. Verified SPY focus promoted the SPY story above a newer market
  story, market stories remained below with `Market wire` labels, the story
  opened in the shared drawer rather than inline detail, NVDA focus showed
  `Focused NVDA` with `0 stories`, all market stories remained visible, the
  drawer closed cleanly, and no page-level horizontal overflow was detected.
- Temporary dev server, fake API, and Chromium processes were stopped after
  verification.

## PR And Commits

Pending commit and PR.

## Beads Updates

- Created phase issue `islandflow-mcmd.6`.
- Blocked by `islandflow-mcmd.5`.
- Orchestrator claimed `islandflow-mcmd.6` after Phase 05 closeout and assigned branch `lavender/islandflow-mcmd-6-news-relevance-ordering`.

## Follow-Ups Filed

None.

## Context To Keep

- Focused and market stories are labeled in one wire, not split routes.
- Empty focused stories must not hide the broader market wire.

## Closeout

Implementation local verification complete. Beads issue remains open for the
orchestrator/reviewer workflow as instructed.
