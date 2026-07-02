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

Replacement reviewer worktree:

- Worktree: `/home/delta/.codex/worktrees/1361/islandflow`
- Branch: `lavender/islandflow-mcmd-3-route-feature-upgrade`
- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/104`

Thermo-nuclear review result: approved with no code repairs.

Evidence:

- Branch preflight attached the detached prepared checkout to the existing assigned branch and verified it was clean against `forgejo/lavender/islandflow-mcmd-3-route-feature-upgrade`.
- Reviewed `apps/web/features/terminal/routes.ts` against the Phase 03 scope. The production change stays in the existing route-feature table and only changes root `/` feature booleans for `nbbo` and `durableRows`.
- Reviewed `apps/web/app/terminal.test.ts` assertions for the locked root feed set, focused chart candle/overlay paths, and unchanged `/qa`, `/options`, and `/news` route behavior.
- File-size check: `apps/web/app/terminal.test.ts` was already over 1k lines on `forgejo/dashboard-v2` at 1697 lines and is 1770 lines after this PR, so this phase does not cross the thermo-nuclear 1k-line threshold. A broad test split would be out of scope for this routing-only phase.
- No ad-hoc route branches, hidden v2 route, nav-label change, layout replacement, ticker rail visual change, detail drawer change, news ordering change, or watchlist persistence change found in the implementation diff.
- Reviewer finding: no remaining structural blocker. The direct route-feature-table edit is the smallest maintainable implementation for this phase.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `ci-green` for implementation head `e76bc526dd` before reviewer doc-closeout; final reviewer doc-closeout CI is recorded below after push.

Evidence:

- Reviewer bootstrap: initial `bun test apps/web/app/terminal.test.ts` failed before assertions because this prepared review worktree did not have installed workspace dependencies and could not resolve `@islandflow/types`.
- Reviewer bootstrap: `bun install --frozen-lockfile` passed and installed 1100 packages.
- Local narrow route gate: `bun test apps/web/app/terminal.test.ts` passed, 92 tests.
- Required web gate: `bun test apps/web` passed, 277 tests.
- Required production build: `bun --cwd=apps/web run build` passed.
- Scoped Biome: `bunx biome check apps/web/features/terminal/routes.ts apps/web/app/terminal.test.ts` passed.
- Whitespace gate: `git diff --check` passed.
- Browser verification server: `PORT=3104 HOSTNAME=127.0.0.1 bun --cwd=apps/web run start`.
- Chromium desktop `/`, 1440x1100: document `clientWidth` 1440 and `scrollWidth` 1440, body `clientWidth` 1440 and `scrollWidth` 1440, no document/body horizontal overflow, no visible dialog/backdrop candidates, `Local fallback` rail label visible, screenshot `/tmp/islandflow-mcmd3-review-desktop.png`.
- Chromium mobile `/`, 390x844: document `clientWidth` 390 and `scrollWidth` 390, body `clientWidth` 390 and `scrollWidth` 390, no document/body horizontal overflow, no visible dialog/backdrop candidates, `Local fallback` rail label visible, ticker rail not looping at this width, screenshot `/tmp/islandflow-mcmd3-review-mobile.png`.
- Chromium reduced-motion `/`, 1440x1100 with `prefers-reduced-motion: reduce`: document `clientWidth` 1440 and `scrollWidth` 1440, body `clientWidth` 1440 and `scrollWidth` 1440, no document/body horizontal overflow, no visible dialog/backdrop candidates, `Local fallback` rail label visible, ticker rail `is-looping` false, screenshot `/tmp/islandflow-mcmd3-review-reduced-motion.png`.
- Forgejo CI before reviewer doc-closeout: task #445 for head `e76bc526dd` passed (`Validate`, pull_request, 1m24s).
- Forgejo CI after reviewer doc-closeout is verified after this committed doc update and recorded in the review callback; writing the final task id here would create another doc-only head requiring another CI run.

## PR And Commits

- Forgejo PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/104`
- Implementation commit: `d829d5de0b149e72d0bd9de54c9b4d991347617b` (`upgrade root route feed subscriptions`)
- A final doc-closeout commit records the PR URL before callback.

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

Implementation PR is open and ready for orchestrator-owned review handoff after final doc-closeout push.
