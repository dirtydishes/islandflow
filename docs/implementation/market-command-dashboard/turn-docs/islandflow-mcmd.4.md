# Phase 04 Turn Doc: Dashboard Layout Replacement

Beads issue: `islandflow-mcmd.4`

Phase doc: `docs/implementation/market-command-dashboard/04-dashboard-layout-replacement.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected Beads phase `islandflow-mcmd.4` from the orchestrator prompt.

Preflight:

- Worktree: `/home/delta/.codex/worktrees/61c6/islandflow`
- Branch: `lavender/islandflow-mcmd-4-dashboard-layout-replacement`
- Callback target: `019f2079-1443-7e53-95a3-ee0eb7bf5ba0`
- Initial worktree state was detached; attached to the existing assigned branch after fetching `dashboard-v2` and `lavender/islandflow-mcmd-4-dashboard-layout-replacement` from `forgejo`.

## Scope

Replace the root dashboard body with `MarketCommandRoute`, chrome, rail, chart, alerts, flow packets, options tape, and news.

## Implementation Log

- Added `apps/web/features/market-command/MarketCommandRoute.tsx`.
- Added `apps/web/features/market-command/MarketCommandChrome.tsx`.
- Updated `OverviewRoute` in `apps/web/app/terminal.tsx` to delegate the root dashboard to `MarketCommandRoute`.
- Root `/` now composes the locked Market Command surface:
  - chrome with status, replay, health, focus input, filter control, and clear-board action
  - Phase 02 `MarketCommandTickerRail`
  - `TerminalMarketChartSection`
  - durable alert rows when present, raw `AlertsModule` fallback otherwise
  - `FlowPacketsTape` with `template="oneThird"`
  - durable option rows when present, raw `OptionsTape` fallback otherwise
  - full-width `NewsWire`
- Removed the old standalone panes from the root route composition:
  - `CommandPriorityBoard`
  - `CommandDecisionLevels`
  - `FeedHealthPane`
  - `EventContextPane`
  - `HomeReplayRail`
  - `EquitiesTape`
- Added responsive Market Command CSS in `apps/web/app/globals.css`:
  - desktop grid uses three equal tracks with chart spanning two columns and alerts one column, then flow one column and options two columns
  - tablet/mobile stack order is chrome, rail, chart, alerts, options, flow, news
  - pane min-heights and scoped overrides keep durable/news scroll bodies from collapsing under shared module defaults
- Added `apps/web/features/market-command/MarketCommandRoute.test.tsx` for route composition and durable-first fallback behavior.

## Subagent Swarms

Used three bounded read-only scout subagents:

- Route scout mapped the old `OverviewRoute` pane composition, removable standalone panes, and marker click handlers to preserve.
- Component-contract scout mapped props/imports for ticker rail, durable alert/option panes, raw fallbacks, flow packets, news wire, and chart section.
- CSS/test/browser scout mapped existing layout conventions, breakpoints, test style, and browser verification commands.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started. Per implementation-thread scope, reviewer thread creation remains orchestrator-owned after callback.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `not-started`

Evidence:

- Dependency bootstrap: initial focused market-command test run failed because this prepared worktree had no installed workspace dependencies and could not resolve `react/jsx-dev-runtime` or `@islandflow/types`.
- Dependency bootstrap: `bun install --frozen-lockfile` passed and installed workspace dependencies.
- Focused market-command tests: `bun test apps/web/features/market-command` passed, 7 tests.
- Required web gate: `bun test apps/web` passed, 279 tests.
- Required production build: `bun --cwd=apps/web run build` passed.
- Scoped Biome: `bunx biome check apps/web/app/terminal.tsx apps/web/app/globals.css apps/web/features/market-command/MarketCommandChrome.tsx apps/web/features/market-command/MarketCommandRoute.tsx apps/web/features/market-command/MarketCommandRoute.test.tsx` passed.
- Whitespace gate: `git diff --check` passed.
- Browser verification server: `PORT=3104 HOSTNAME=127.0.0.1 bun --cwd=apps/web run start` from the production build.
- Chromium executable: `/usr/bin/chromium`.
- Desktop `/`, 1440x1100:
  - no horizontal page overflow: `clientWidth=1440`, `scrollWidth=1440`, overflow `0`
  - chart/alerts ratio `2.017`
  - options/flow ratio `2.017`
  - full-width news delta `0.02px`
  - independent module scroll regions found for alerts, flow, options, and news with `overflow-y: auto`
  - top-level layout overlap candidates: none
  - degraded ranking label visible as `Local fallback`
  - screenshot: `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd4-desktop-1440x1100.png`
- Mobile `/`, 390x844:
  - no horizontal page overflow: `clientWidth=390`, `scrollWidth=390`, overflow `0`
  - stack order by top position: chrome, rail, chart, alerts, options, flow, news
  - independent module scroll regions found for alerts, flow, options, and news with `overflow-y: auto`
  - top-level layout overlap candidates: none
  - degraded ranking label visible as `Local fallback`
  - ticker animation computed as `none`
  - screenshot: `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd4-mobile-390x844.png`
- Reduced-motion `/`, 1440x1100:
  - no horizontal page overflow: `clientWidth=1440`, `scrollWidth=1440`, overflow `0`
  - chart/alerts ratio `2.017`
  - options/flow ratio `2.017`
  - full-width news delta `0.02px`
  - top-level layout overlap candidates: none
  - ticker animation computed as `none`
  - screenshot: `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd4-reduced-motion-1440x1100.png`

## PR And Commits

- Forgejo PR: pending.
- Implementation commit: pending.

## Beads Updates

- Created phase issue `islandflow-mcmd.4`.
- Blocked by `islandflow-mcmd.3`.
- Implementation thread did not close the Beads phase issue; closeout remains orchestrator-owned.

## Follow-Ups Filed

None.

## Context To Keep

- Desktop layout uses chart/alerts 2fr/1fr, flow/options 1fr/2fr, and full-width news.
- Use durable panes first and raw module fallbacks only when durable rows are unavailable.
- Remove old standalone dashboard panes from the root route.
- `TerminalMarketChartSection` still owns smart-flow and inferred-dark marker click dispatch, so existing marker drawer behavior is preserved for Phase 05.
- Browser verification used local fallback ranking because the isolated production server could not fetch the ranking/API data.

## Closeout

Implementation complete locally. PR publication and callback are pending.
