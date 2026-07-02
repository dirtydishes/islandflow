# Phase 02 Turn Doc: Ticker Rail And Board Focus Model

Beads issue: `islandflow-mcmd.2`

Phase doc: `docs/implementation/market-command-dashboard/02-ticker-rail-focus-model.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected Beads issue `islandflow-mcmd.2` on assigned branch
`lavender/islandflow-mcmd-2-ticker-rail-focus-model` in the assigned Codex
worktree.

## Scope

Add board ticker focus helpers, ticker rail polling, local fallback ranking, and the rail component.

## Implementation Log

- Added the `apps/web/features/market-command/` feature folder with:
  - `focus-model.ts` for normalized board ticker focus requests.
  - `local-ranking-fallback.ts` for server-compatible local fallback rail
    responses from terminal state feeds.
  - `useMarketCommandTickerRail.ts` for `GET /market-command/tickers` polling
    every 30 seconds, shared-schema validation, stale/error state, and local
    fallback display.
  - `MarketCommandTickerRail.tsx` for the pinned/important rail UI, visible
    server/degraded/local-fallback state, keyboard-focusable ticker buttons,
    manual refresh, and board clear controls.
- Replaced the existing root dashboard `CommandSymbolRail` usage with
  `MarketCommandTickerRail`, without changing route feature subscriptions or
  widening into the full dashboard layout replacement.
- Added terminal state helpers:
  - `focusTickerSymbol(symbol, source)` uppercases/scopes `filterInput`, clears
    selected instruments and open board detail drawers, and clears focus seeds.
  - `clearBoardFocus()` clears `filterInput`, selected instruments, focus seeds,
    and board detail drawers.
- Updated `focusOptionContract` and `focusFlowPacketRequest` to set
  `filterInput` to the focused contract underlying while preserving contract
  focus. Existing contract clear paths still clear only `selectedInstrument`, so
  clearing contract focus does not clear ticker focus.
- Added rail CSS for fixed card sizing, visible fallback/degraded chips,
  overflow-only auto-loop, pause on hover/focus, reduced-motion disablement, and
  mobile scroll fallback.
- Added focused tests for focus normalization, local fallback ranking, and
  static component fallback rendering.

## Subagent Swarms

No subagents used. The phase surface was bounded enough to map directly in the
implementation thread after reading the terminal state, Phase 01 server
contract, and existing rail/CSS patterns.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `local-gates-passed; forgejo-ci-pending-pr`

Evidence:

- `bun test apps/web/features/terminal` - passed, 16 tests.
- `bun test apps/web/features/market-command` - passed, 5 tests.
- `bun --cwd=apps/web run build` - passed.
- `bunx biome check apps/web/features/market-command apps/web/features/terminal/state.tsx apps/web/app/terminal.tsx apps/web/app/globals.css` - passed.

Browser evidence:

- Started this worktree's web server on `http://localhost:3001` with
  `WEB_DEV_PORT=3001 bun --cwd=apps/web run dev`; existing host services on
  `3000` and Docker-bridge `4000` were left untouched.
- Chromium desktop `1440x1000`, `/`, ticker endpoint forced to fail through
  DevTools Fetch interception: rail rendered with visible `Local fallback`, 8
  primary buttons, document/body horizontal overflow `0`, button keyboard focus
  worked, clicking `SPY` set the ticker input to `SPY`, and `Clear board`
  became visible.
- Desktop overflow sample: rail content overflowed the viewport and the
  `is-looping` class appeared after the layout observer ran; animation name was
  `command-ticker-loop` and hover/focus paused the track.
- Chromium mobile `390x900`: rail rendered with visible fallback state, animation
  disabled, document horizontal overflow `0`, and after hydration a ticker click
  set the input to `SPY`.
- Chromium desktop with emulated `prefers-reduced-motion: reduce`: rail rendered
  with fallback state, content overflowed internally, animation remained `none`,
  and ticker click still set board focus.
- Local API note: the dev script defaulted to `http://127.0.0.1:4000`, but
  `curl` to that origin failed in this worktree session while the host service
  was bound on Docker bridge. That gave a real local-fallback path in addition
  to the forced-failure browser probes.

## PR And Commits

- PR: pending Forgejo create after commit/push.
- Commits: pending.

## Beads Updates

- Created phase issue `islandflow-mcmd.2`.
- Blocked by `islandflow-mcmd.1`.
- Implementation thread verified the issue is in progress and claimed it with
  `bd update islandflow-mcmd.2 --claim`. The phase issue was not closed;
  orchestrator owns closeout.

## Follow-Ups Filed

None.

## Context To Keep

- Rail failure falls back to local ranking with visible `Local fallback` labeling.
- Reduced motion and mobile disable auto-loop.
- Board focus should keep chart, alerts, flow, options, and news aligned.

## Closeout

Implementation complete locally. Forgejo push, PR creation, and implementation
callback pending.
