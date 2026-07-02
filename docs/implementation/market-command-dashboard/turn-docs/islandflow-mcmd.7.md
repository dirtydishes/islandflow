# Phase 07 Turn Doc: Polish, Performance, And Visual QA

Beads issue: `islandflow-mcmd.7`

Phase doc: `docs/implementation/market-command-dashboard/07-polish-performance-visual-qa.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected by the closeout/selector subagent after Phase `islandflow-mcmd.6` closed and PR #107 merged into `dashboard-v2`.

Preflight:

- Assigned branch: `lavender/islandflow-mcmd-7-polish-performance-visual-qa`
- Base branch: `dashboard-v2`
- Callback target: `019f2079-1443-7e53-95a3-ee0eb7bf5ba0`
- Beads issue claimed by the orchestrator before implementation thread launch.

## Scope

Tune and verify the completed dashboard for layout stability, reduced motion, density, contrast, browser behavior, and degraded fallback.

## Implementation Log

2026-07-02 implementation:

- Verified the prepared worktree was detached, then attached it to the existing
  assigned branch `lavender/islandflow-mcmd-7-polish-performance-visual-qa`.
  No branch was created or renamed.
- Bootstrapped the prepared worktree with `bun install --frozen-lockfile` after
  the first focused market-command test run failed before product code because
  `node_modules` was absent.
- Added ticker-rail QA state attributes for browser probes:
  `data-source`, `data-overflows`, `data-auto-loop`, `data-mobile-viewport`,
  and `data-reduced-motion`.
- Made ticker rail source status announce politely, kept local fallback visibly
  labeled, and added component coverage for fallback source and no-loop SSR
  state.
- Tightened final dashboard polish in CSS:
  - bounded the market-command shell and layout against page-level horizontal
    overflow;
  - fixed desktop dashboard grid row heights for chart/alerts, flow/options,
    and news;
  - gave the ticker rail stable card, source-chip, action, and row dimensions;
  - preserved mobile manual rail scrolling with auto-loop disabled;
  - made reduced-motion robustly disable ticker animation.
- During browser QA, caught and fixed a hydration mismatch caused by reading
  `window.matchMedia` in the media-query hook's initial state. The hook now
  starts server-stable and updates from the effect after hydration.
- `impeccable` was not available in the provided skill list, so this update uses
  the existing phase turn-doc structure directly.

## Subagent Swarms

Not used. The phase was narrow enough to keep local, with a temporary fixture
API/WebSocket used only for deterministic Chromium QA.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started by this implementation thread. The orchestrator owns review-thread
creation after the implementation callback.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `local-gates-passed`; Forgejo CI not started until the PR is
opened.

Evidence:

- `bun install --frozen-lockfile` - passed after the prepared worktree initially
  had no installed dependencies.
- Initial focused test before dependency bootstrap:
  `bun test apps/web/features/market-command` failed before product assertions
  because `react/jsx-dev-runtime` and `@islandflow/types` could not be resolved.
- Focused market-command tests after bootstrap:
  `bun test apps/web/features/market-command` - passed, 11 tests.
- Scoped Biome:
  `bunx biome check apps/web/features/market-command/MarketCommandTickerRail.tsx apps/web/features/market-command/MarketCommandTickerRail.test.tsx apps/web/app/globals.css`
  - passed.
- Full test suite: `bun test` - passed, 547 tests, 4164 assertions.
- Web production build: `bun --cwd=apps/web run build` - passed.
- `git diff --check` - passed.
- Build-generated `apps/web/next-env.d.ts` drift from `.next-dev` to `.next`
  was restored to the pre-build dev metadata path.

Browser evidence:

- Real Chromium path: `/usr/bin/chromium` (`Chromium 149.0.7827.196`).
- Worktree web server: `WEB_DEV_PORT=3107 bun --cwd=apps/web run dev`.
- Default local API failure was verified before fixture use:
  `curl --max-time 5 http://127.0.0.1:4000/health` failed to connect, and
  `curl --max-time 5 http://172.18.0.1:4000/health` timed out after 5s. No
  production-like service was restarted.
- Fallback desktop `1440x1100` with unreachable default API:
  screenshot `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fallback-desktop.png`.
  Verified chart, alerts, flow packets, options tape, and news modules render,
  local fallback rail is visible with `data-source="local-fallback"`, rail
  overflows and auto-loops on desktop, overlays `0`, and horizontal overflow `0`.
- Fallback mobile `390x844`:
  screenshot `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fallback-mobile.png`.
  Verified stacked layout, local fallback rail, `data-mobile-viewport="true"`,
  `data-auto-loop="false"`, overlays `0`, and horizontal overflow `0`.
- Fallback reduced-motion desktop:
  screenshot `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fallback-reduced-motion.png`.
  Verified `prefers-reduced-motion: reduce`, `data-reduced-motion="true"`,
  `data-auto-loop="false"`, local fallback rail, overlays `0`, and horizontal
  overflow `0`.
- Fresh-server hydration check after the media-query repair: mobile and
  reduced-motion reloads emitted no hydration warnings, with rail attributes
  still updating to `data-mobile-viewport="true"` and `data-reduced-motion="true"`
  respectively.
- Populated deterministic pass used a temporary local fixture API/WebSocket on
  `127.0.0.1:4000` without restarting host services.
- Populated desktop `1440x1100`:
  screenshots
  `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fixture-desktop.png`
  and
  `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fixture-desktop-after-interactions.png`.
  Verified chart rendered with 12 canvas elements, alerts `1`, flow packets `1`,
  options `1`, news `2`, server-ranked rail, overlays `0`, and horizontal
  overflow `0`.
- Rail hover/focus pause: with the server-ranked desktop rail auto-looping,
  hovering the rail changed the track animation play state to `paused`; clicking
  `NVDA` then set the board focus input to `NVDA`.
- Alert row selection opened the shared detail drawer with durable alert detail
  and kept the alerts pane at `459x560` and alert row at `459x36` before and
  after drawer opening. Escape closed the drawer and returned overlays to `0`.
- Flow packet activation on `NVDA-2026-07-17-150-C` focused the related option
  contract; the focus ribbon changed to `Contract: NVDA 07-17-26 150C`, and the
  related options row remained visible.
- Focused/global news ordering after `NVDA` focus showed `Focused NVDA` with 1
  story and `Market wire` with 1 story, preserving both focused and global news.
- Live-update stability: during fixture WebSocket updates, durable tape header
  and row dimensions stayed fixed:
  alerts head/row `459x30`/`459x36`, flow `459x30`/`459x40`, options
  `925x30`/`925x36`, news `1392x30`/`1392x52`; horizontal overflow remained `0`.
- Populated mobile `390x844`:
  screenshot `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fixture-mobile.png`.
  Verified stacked layout, chart/alerts/flow/options/news all visible, row
  counts `1/1/1/2`, `data-mobile-viewport="true"`, `data-auto-loop="false"`,
  overlays `0`, and horizontal overflow `0`.
- Populated reduced-motion desktop:
  screenshot `docs/implementation/market-command-dashboard/turn-docs/artifacts/mcmd7-fixture-reduced-motion.png`.
  Verified server-ranked rail, `data-reduced-motion="true"`,
  `data-auto-loop="false"`, row counts `1/1/1/2`, overlays `0`, and horizontal
  overflow `0`.

## PR And Commits

- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/108`
- Implementation commit: `a3923096595cb80080267d1280c0785bb2e2fb2d8`

## Beads Updates

- Created phase issue `islandflow-mcmd.7`.
- Blocked by `islandflow-mcmd.6`.
- Orchestrator claimed `islandflow-mcmd.7` after Phase 06 closeout and assigned branch `lavender/islandflow-mcmd-7-polish-performance-visual-qa`.
- Implementation thread left `islandflow-mcmd.7` open as instructed.

## Follow-Ups Filed

None.

## Context To Keep

- Browser QA covers desktop, mobile, reduced motion, no horizontal overflow, endpoint fallback, and stable panes.
- File follow-ups for future refinements instead of widening final QA.
- Ticker rail QA state attributes are intentional browser-probe hooks and should
  stay aligned with the actual media-query and overflow state.
- The deterministic browser fixture was temporary and not committed; it used the
  same `/ws/live`, `/market-command/tickers`, candle, and equity-range paths the
  dashboard consumes.

## Closeout

Implementation local gates and browser QA are complete. PR #108 is open against
`dashboard-v2`. Implementation callback is still pending in this thread.
