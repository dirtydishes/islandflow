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

Reviewer pass completed on 2026-07-02 in the assigned worktree on
`lavender/islandflow-mcmd-2-ticker-rail-focus-model`.

Findings:

- No blocking structural findings remain. The diff stays within Phase 02 scope:
  ticker rail, board focus helpers, local fallback, and the root rail swap only.
- The client fallback ranking intentionally mirrors the server response shape
  while reading already-hydrated terminal state; no route subscription, layout,
  drawer, news ordering, or watchlist persistence scope was added.
- No edited file crossed the 1k-line threshold because of this phase. The large
  pre-existing shared files remained large, but the phase changes in those files
  were narrow and localized.
- No repair commits were needed.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `ci-green`

Evidence:

- Initial reviewer rerun of `bun test apps/web/features/terminal` failed before
  phase code ran because this prepared worktree had no `node_modules` and Bun
  could not resolve `@islandflow/types`.
- `bun install --frozen-lockfile` - passed, installed workspace dependencies,
  no lockfile change.
- `bun test apps/web/features/terminal` - passed, 16 tests, 51 assertions.
- `bun test apps/web/features/market-command` - passed, 5 tests, 22 assertions.
- `bun --cwd=apps/web run build` - passed.
- `bunx biome check apps/web/features/market-command apps/web/features/terminal/state.tsx apps/web/app/terminal.tsx apps/web/app/globals.css` - passed.
- `git diff --check forgejo/dashboard-v2...HEAD` - passed.
- `fj actions tasks` - latest PR task `#442` for commit `7ecdfb9f8a`
  succeeded: `Validate`, `pull_request`, 1m29s.
- `fj pr status 103 --wait` failed with the known Forgejo CLI response parsing
  issue for Actions job URLs, so CI state was verified through `fj actions
  tasks`.
- `git merge-tree --write-tree --messages forgejo/dashboard-v2 HEAD` - passed
  with tree `2335236c6052f34255154d9f017dcf06a6987986`.

Browser evidence:

- Reviewer started this worktree's web server on `http://localhost:3001` with
  `PORT=3001 WEB_DEV_PORT=3001 bun --cwd=apps/web run dev`; existing host services on
  `3000` and Docker-bridge `4000` were left untouched.
- Python Playwright with `/usr/bin/chromium`, desktop `1440x1000`, `/`, ticker
  endpoint forced to fail: visible `LOCAL FALLBACK`, 8 primary ticker buttons,
  keyboard focus landed on the `SPY` button, pressing Enter set
  `input[name="ticker-filter"]` to `SPY`, `Clear board` became visible, center
  hit-test landed on the card, and document/body horizontal overflow was `0`.
- Desktop overflow motion sample: `is-looping` appeared after overflow
  detection, baseline animation was `command-ticker-loop` / `running`, hover
  paused it, and keyboard focus paused it.
- Python Playwright mobile `390x900`: visible `LOCAL FALLBACK`, ticker click set
  `input[name="ticker-filter"]` to `SPY`, document/body horizontal overflow was
  `0`, center hit-test landed on the card, `is-looping` was absent, and
  animation was `none`.
- Python Playwright desktop with emulated `prefers-reduced-motion: reduce`:
  visible `LOCAL FALLBACK`, ticker click set board focus to `SPY`,
  document/body horizontal overflow was `0`, center hit-test landed on the card,
  `is-looping` was absent, and animation was `none`.
- Local API note: the dev script defaulted to `http://127.0.0.1:4000`; reviewer
  `curl` to that origin failed with HTTP code `000`, while
  `http://172.18.0.1:4000/market-command/tickers?watchlist=SPY&limit=1`
  returned `404` from the host service. Browser fallback was therefore verified
  through forced Fetch interception rather than depending on the host service.

## PR And Commits

- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/103`
- Commits:
  - `7806c19` - `add market command ticker rail focus model`
  - `7ecdfb9` - `record market command ticker rail pr`

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

Review approved. Callback pending.
