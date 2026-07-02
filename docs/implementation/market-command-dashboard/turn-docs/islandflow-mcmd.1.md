# Phase 01 Turn Doc: Server Ranking Contract

Beads issue: `islandflow-mcmd.1`

Phase doc: `docs/implementation/market-command-dashboard/01-server-ranking-contract.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected Beads issue `islandflow-mcmd.1` on assigned branch
`lavender/islandflow-mcmd-1-server-ranking-contract` in the assigned prepared worktree.

## Scope

Add shared market-command ticker rail types, pure server ranking, and `GET /market-command/tickers`.

## Implementation Log

- Added `packages/types/src/market-command.ts` with the shared ticker rail response schema, item schema, reason schema, session metadata, degradation fields, and strict response validation. Exported the contract from `packages/types/src/index.ts`.
- Added `services/api/src/market-command-tickers.ts` as the pure server ranking module. It normalizes and caps watchlists, caps `limit`, resolves current or most recent regular session in `America/New_York`, scores evidence with the phase weights and a 45-minute half-life, keeps only top-three reasons, preserves pinned order, excludes pinned symbols from `important`, and returns degraded-but-useful pinned output.
- Wired `GET /market-command/tickers` into `services/api/src/index.ts`. The route reads live cache first, then bounded ClickHouse reads before the selected session end and since the session start where existing storage filters support it. ClickHouse read failures become degraded reasons instead of blanking the rail.
- Added `LiveStateManager.getCachedGenericItems(...)` as a read-only cache accessor for route composition without forcing scoped ClickHouse backfill.
- Classified `/market-command/tickers` as ordinary REST (`rest_read`) in `services/api/src/rate-limit.ts`.
- Added focused type, ranking, parser, session-window, degraded fallback, duplicate exclusion, session filtering, and rate-limit tests.

## Subagent Swarms

- Route scout: confirmed `services/api/src/index.ts` uses direct Bun route branches and that `/market-command/tickers` belongs with ordinary GET feed routes; recommended `/market-command/` in the REST prefix list.
- Live/storage scout: mapped safe live cache channels and existing storage APIs for equities, option prints, flow packets, smart-flow projections, smart-flow alerts, and news.
- Type/test scout: confirmed `packages/types` root barrel export pattern and direct pure-module API test style; warned not to import the API server entrypoint from tests.
- Session-window scout: confirmed there is no reusable market-calendar helper; recommended deterministic Monday-Friday `America/New_York` regular-session selection without holiday integration.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Reviewer pass completed in the assigned worktree on
`lavender/islandflow-mcmd-1-server-ranking-contract`.

Findings repaired in scope:

- The live-cache option evidence path could rank raw/non-signal option prints even though the
  storage path intentionally queried the signal view. Repaired the ranker so option-print evidence
  only scores prints with `signal_pass === true`.
- The option/equity symbol extraction paths normalized stored symbols directly. A malformed stored
  symbol could turn otherwise useful degraded rail output into a hard ranking failure. Repaired the
  ranker to ignore malformed stored symbols the same way alert/flow/news extraction already did.

Findings remaining:

- None for Phase 01 scope. The added server API code is phase-bounded; no UI files, route
  subscriptions, hidden routes, or dashboard layout files were touched.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `review-repair-local-gates-green`

Evidence:

- `bun test packages/types` - passed, 24 tests.
- `bun test services/api/tests` - passed, 81 tests after reviewer regression coverage.
- `bun test` - passed, 531 tests after reviewer regression coverage.
- `bunx tsc -p services/api/tsconfig.json --noEmit` - passed.
- `bunx biome check <phase touched files>` - passed.
- `git diff --check` - passed.
- Forgejo Actions before reviewer repair: task `#438` for `d084df629d` passed (`Validate`,
  pull_request). Task `#437` for the superseded initial PR head was cancelled.
- `bun run check` - blocked by unrelated pre-existing import-order diagnostics outside this phase scope, including `apps/desktop/src/main.ts`, `apps/web/app/layout.tsx`, and multiple existing app/service files. Touched files pass targeted Biome.

Post-repair Forgejo CI is pending reviewer repair commit/push.

## PR And Commits

- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/102`
- Commits: pushed on `lavender/islandflow-mcmd-1-server-ranking-contract`; callback carries the exact commit list.
- `fj pr view 102` on 2026-07-01 showed the PR open against `dashboard-v2`. The orchestrator
  stated that PR base/closeout correction is being handled separately, so the reviewer did not
  change PR base or merge state.

## Beads Updates

- Created phase issue `islandflow-mcmd.1`.
- Implementation thread verified the issue is in progress and did not close it; orchestrator owns phase closeout.

## Follow-Ups Filed

None.

## Context To Keep

- Ranking is evidence-first and current-session bounded.
- Pinned symbols must remain stable in request order.
- Degraded output should keep the ticker rail useful.
- `GET /market-command/tickers?watchlist=SPY,QQQ,NVDA,TSLA,AAPL,MSFT,META,AMZN&limit=16` returns all pinned symbols and up to `limit` important symbols.
- Holidays are intentionally not modeled in Phase 01; the session helper uses the current or most recent Monday-Friday regular session.

## Closeout

Implementation PR opened. Callback pending.
