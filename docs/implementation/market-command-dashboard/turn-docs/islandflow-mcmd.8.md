# Phase 08 Turn Doc: Deterministic Drawer Browser Fixture

Beads issue: `islandflow-mcmd.8`

Phase doc: `docs/implementation/market-command-dashboard/08-deterministic-drawer-browser-fixture.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected by the closeout/selector subagent after Phase `islandflow-mcmd.7` closed and PR #108 merged into `dashboard-v2`.

Preflight:

- Assigned branch: `lavender/islandflow-mcmd-8-deterministic-drawer-fixture`
- Base branch: `dashboard-v2`
- Callback target: `019f2079-1443-7e53-95a3-ee0eb7bf5ba0`
- Beads issue claimed by the orchestrator before implementation thread launch.

## Scope

Add a deterministic browser fixture or harness for Market Command drawer interactions without relying on the production-like live API.

## Implementation Log

2026-07-02 implementation:

- Verified the prepared worktree was detached at the assigned branch tip, then
  attached it to the existing assigned branch
  `lavender/islandflow-mcmd-8-deterministic-drawer-fixture`. No branch was
  created or renamed.
- Bootstrapped the prepared worktree with `bun install --frozen-lockfile`
  because `node_modules` was absent.
- Added a root-only, non-production Market Command drawer fixture gated by the
  explicit query parameter `?marketCommandFixture=drawer`.
- Seeded deterministic SPY data for every Phase 08 browser interaction:
  durable alert row, durable option row, flow packet, news story, smart-flow
  projection/alert, inferred-dark event, equity join, chart candles, and chart
  overlay print.
- Wired the fixture through the existing terminal state contracts by replacing
  only the fixture-enabled feed snapshots and chart data. Normal `/` traffic
  still uses the live API/WebSocket integration and still exposes endpoint
  failures.
- Added fixture-only marker probe buttons for smart-flow and inferred-dark
  chart drawer paths, since those production markers are canvas-rendered and
  not directly addressable by DOM selectors.
- Added `scripts/probes/market-command-drawer-fixture.ts`, a real Chromium/CDP
  probe that opens `/`, clicks every required seeded interaction path, verifies
  drawer close behavior, and checks page-level horizontal overflow.
- Added the package script `probe:market-command-drawer-fixture` for repeatable
  local execution.
- Added focused unit coverage for the fixture gate and seeded data shape.
- `impeccable` was not available in the provided skill list, so this update uses
  the existing phase turn-doc structure directly.

## Subagent Swarms

Not used. The phase was narrow enough to implement and verify directly in the
assigned worktree.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

2026-07-02 review:

- Verified the review worktree was initially detached at the assigned branch
  tip, then attached it to the existing assigned branch
  `lavender/islandflow-mcmd-8-deterministic-drawer-fixture`. No branch was
  created or renamed.
- Reviewed the diff against Phase 08 scope. The fixture is isolated behind
  `NODE_ENV !== "production"`, root pathname `/`, and the explicit
  `?marketCommandFixture=drawer` query parameter.
- Normal `/` remains on the existing live API/WebSocket path because fixture
  feed replacement and fixture marker probes are only enabled by that gate.
- The seeded data covers durable alert rows, news stories, option rows, flow
  packets, smart-flow projections/alerts, inferred-dark markers, equity joins,
  chart candles, and chart overlay prints.
- The browser probe uses real Chromium/CDP and verifies durable alert, news,
  smart-flow, inferred-dark, option, and flow packet paths, drawer close
  behavior, and page-level horizontal overflow.
- The Docker workspace package snapshot matches the root package script change.
- No structural blockers or in-scope code repairs were found. `state.tsx` was
  already over 1k lines before this phase; `chart-adapter.tsx` remained below
  1k lines after the patch.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `ci-green`

Evidence:

- `bun install --frozen-lockfile` - passed, with no lockfile changes.
- First reviewer test attempt failed before running tests because this fresh
  prepared worktree did not have installed workspace dependencies; the
  follow-up `bun install --frozen-lockfile` bootstrap passed with no lockfile
  changes, then all gates below were rerun.
- Focused fixture/route tests:
  `bun test apps/web/features/market-command/MarketCommandRoute.test.tsx apps/web/features/market-command/browser-fixture.test.ts`
  - passed, 8 tests, 38 assertions.
- Full web test suite: `bun test apps/web` - passed, 288 tests, 818
  assertions.
- Scoped Biome:
  `bunx biome check apps/web/features/market-command/MarketCommandRoute.tsx apps/web/features/market-command/browser-fixture.ts apps/web/features/market-command/browser-fixture.test.ts apps/web/features/terminal/state.tsx apps/web/features/terminal/chart-adapter.tsx apps/web/app/globals.css scripts/probes/market-command-drawer-fixture.ts package.json deployment/docker/workspace-root/package.json`
  - passed.
- Web production build: `bun --cwd=apps/web run build` - passed.
- `git diff --check` - passed.
- The web build rewrote `apps/web/next-env.d.ts` from `.next-dev` to `.next`;
  the generated drift was restored to the pre-build dev metadata path.
- Initial Forgejo Validate task `#461` failed at `Check Docker workspace
  snapshot` because adding the root package script left
  `deployment/docker/workspace-root/package.json` out of sync.
- `bun run sync:docker-workspace` - passed, updating only
  `deployment/docker/workspace-root/package.json`.
- `bun run check:docker-workspace` - passed after the snapshot repair.
- Forgejo Validate task `#462` passed on commit
  `3e4de0f395bc7228fc59367ab657a28c6af4ea21`.
- Forgejo Validate task `#463` passed on commit
  `b0c5c9b04bb82013a712922444b6e84951dd7f0b`.
- `fj pr status 109 --wait` failed with the known Forgejo CLI response
  parsing issue, so reviewer CI evidence used `fj actions tasks`, `fj pr view
  109`, and final-head task evidence.
- Mergeability check: `git merge-tree --write-tree forgejo/dashboard-v2 HEAD`
  passed and produced tree `d4d3330fab51a2dcad583d0ce5411d3c95f80269`.

Browser evidence:

- Real Chromium path: `/usr/bin/chromium`.
- Existing production-like web service occupied port `3000`, so the fixture
  probe used a phase dev server on port `3200`:
  `WEB_DEV_PORT=3200 NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 bun --cwd=apps/web run dev`.
- Final browser probe command:
  `bun run scripts/probes/market-command-drawer-fixture.ts --target-url http://127.0.0.1:3200/ --browser-path /usr/bin/chromium --timeout 20000`.
- Final browser probe result: passed.
- Verified seeded `/` route, fixture marker probe availability, initial and
  final page-level horizontal overflow checks, durable alert row drawer open and
  close, news row drawer open and close, smart-flow marker drawer open and
  close, inferred-dark marker drawer open and close, option row contract focus,
  and flow packet row contract focus.

## PR And Commits

- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/109`
- Implementation commit:
  `79d6ed35d9a281d528199db19f0bcdfe457c00c0`
- PR evidence commit:
  `56974c0fb0aa903d338a9456d7a6293918dda00a`
- Docker workspace snapshot repair:
  `3e4de0f395bc7228fc59367ab657a28c6af4ea21`
- CI repair evidence:
  `b0c5c9b04bb82013a712922444b6e84951dd7f0b`
- Reviewer evidence commit:
  `fd6c197988e8198df284cb82645f5029a24f7b56`
- Merge commit into `dashboard-v2`: `ead46aa`

## Beads Updates

- Created follow-up issue `islandflow-mcmd.8`.
- Discovered from `islandflow-mcmd.5`.
- Orchestrator selected `islandflow-mcmd.8` after Phase 07 closeout and assigned branch `lavender/islandflow-mcmd-8-deterministic-drawer-fixture`.
- Implementation thread left `islandflow-mcmd.8` open as instructed.
- Orchestrator closed `islandflow-mcmd.8` after PR #109 merged into `dashboard-v2` with Forgejo Actions task `#464` green.

## Follow-Ups Filed

None.

## Context To Keep

- The fixture must not hide normal live endpoint failures.
- Browser QA must exercise alert, news, smart-flow, inferred-dark, option, and flow packet drawer paths.
- Do not widen into new product surfaces or ranking policy changes.

## Closeout

Implementation and thermo-nuclear review are complete. PR #109 merged into
`dashboard-v2` with merge commit `ead46aa` after Forgejo Actions task `#464`
passed for reviewer evidence head `fd6c197988`. Beads issue `islandflow-mcmd.8`
is closed by the orchestrator.
