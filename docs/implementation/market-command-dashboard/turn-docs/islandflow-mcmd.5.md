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

2026-07-02 reviewer pass:

- Reviewed the Phase 05 diff against `docs/implementation/market-command-dashboard/05-hybrid-detail-model.md` and PR #106 scope.
- No structural maintainability blockers found. The shared drawer is isolated in `MarketCommandDetailDrawer`, the route-level state remains bounded, inline durable alert behavior stays the default, and no touched file crosses the 1k-line threshold.
- No code repairs were required. `OptionsTape` smart-flow detail suppression is scoped to Market Command fallback usage; row activation still focuses packet/contract context instead of opening a competing panel.
- Residual risk is limited to durable automation: the reviewer used a temporary local fixture for Chromium interaction proof. Follow-up `islandflow-mcmd.8` remains the right place to add a committed fixture that also covers chart marker clicks in browser automation.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `ci-green`

Evidence:

- `bun install --frozen-lockfile` passed after the prepared worktree initially lacked installed dependencies.
- Reviewer reran `bun test apps/web/features/durable-tape`: passed, 41 tests.
- Reviewer reran `bun test apps/web/features/market-command`: passed, 9 tests.
- Reviewer reran `bun test apps/web/features/options-tape`: passed, 27 tests.
- Reviewer reran `bun test apps/web/features/news-wire`: passed, 8 tests.
- Reviewer reran `bun test apps/web/features/terminal/live-session-state.test.ts apps/web/features/api-transport.test.ts`: passed, 11 tests.
- Reviewer reran `bunx biome check` for touched code files: passed.
- Reviewer reran `bun --cwd=apps/web run build`: passed. Build-generated `apps/web/next-env.d.ts` drift was restored to the pre-build dev metadata path.
- Reviewer reran `git diff --check`: passed.
- Forgejo Actions task #452 passed `Validate` for PR head `e577245439416625e64d9e08c2651db5a340f480`.
- `git merge-tree --write-tree HEAD forgejo/dashboard-v2` succeeded, producing tree `e0124a7ae3aa78a71eb34a9d3ebff957a92690d4`; PR #106 is merge-clean against current `dashboard-v2`.

Browser evidence:

- Started the worktree web app on `http://localhost:3105` first; confirmed desktop `/` renders the replacement dashboard with no drawer open, local fallback ranking visible, desktop overflow `-15`, and mobile 390px overflow `0` with reduced motion emulation active.
- Restarted the worktree web app on `http://localhost:3100` with `NEXT_PUBLIC_API_URL=http://172.18.0.1:4000`. A populated Chromium snapshot of `/` showed 261 alert rows, 203 news rows, 100 option rows, 430 flow rows, desktop overflow `-15`, and mobile 390px overflow `0`.
- Follow-up interaction probes could not be completed reliably because the deployment-host API at `172.18.0.1:4000` later timed out even on `/health`, and fresh Chromium pages remained in `Connecting` with no live rows. The code paths are covered by the focused component tests above; a deterministic browser fixture follow-up was filed as `islandflow-mcmd.8`.
- Reviewer confirmed the deployment-host API was still unhealthy during review: `curl --max-time 3 http://172.18.0.1:4000/health` timed out while the API port was listening.
- Reviewer started a temporary local API/WebSocket fixture on `127.0.0.1:4106` and the worktree web app on `http://localhost:3106` for deterministic Chromium interaction evidence without restarting production-like services.
- Chromium desktop 1440x1000 with reduced motion rendered `/` with local fallback ranking, 1 alert row, 1 news row, 1 option row, no overlays, and horizontal overflow `0`.
- Desktop alert-row click opened the shared drawer with durable alert text, selected exactly one alert row, kept `alerts-module-detail` absent, kept the alerts pane at 454x560 and the alerts tape at 454x552 before and after selection, and left horizontal overflow `0`.
- Desktop Escape closed the drawer and cleared selected alert styling. A separate outside `mousedown` probe also closed the drawer and cleared selected alert styling.
- Chromium mobile 390x844 with reduced motion rendered `/` with local fallback ranking, 1 alert row, 1 news row, 1 option row, no overlays, and horizontal overflow `0`.
- Mobile alert-row click opened the shared drawer within the viewport at 370px wide, selected exactly one alert row, kept `alerts-module-detail` absent, kept the alerts pane at 374x520 and the alerts tape at 374x512 before and after selection, and left horizontal overflow `0`.
- News-row click opened the shared drawer with news detail text, left inline `.news-wire-detail` absent, and kept horizontal overflow `0`.

## PR And Commits

- PR: https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/106
- `a6bb311` — add market command shared detail drawer
- `e577245` — record market command phase 5 pr state
- `c36f89c` — record market command phase 5 review evidence
- `48b50b0` — merge commit into `dashboard-v2`

## Beads Updates

- Created phase issue `islandflow-mcmd.5`.
- Blocked by `islandflow-mcmd.4`.
- Orchestrator claimed `islandflow-mcmd.5` after Phase 04 closeout and assigned branch `lavender/islandflow-mcmd-5-hybrid-detail-model`.
- Implementation filed follow-up `islandflow-mcmd.8` for deterministic browser fixtures because live API/socket availability blocked repeatable drawer interaction probes.
- Orchestrator closed `islandflow-mcmd.5` after PR #106 merged into `dashboard-v2` with Forgejo Actions task `#453` green.

## Follow-Ups Filed

- `islandflow-mcmd.8` — Add deterministic Market Command drawer browser fixture.

## Context To Keep

- `detailMode="external"` must not consume alert pane height.
- Hover previews remain inline.
- Shared drawer handles alerts, smart-flow markers, inferred-dark markers, and news stories.
- Reviewer found no code-quality blockers and made no code repairs.
- Final callback should include the reviewer documentation commit's pushed CI evidence to avoid self-referential CI churn in this turn doc.

## Closeout

Implementation and thermo-nuclear review are complete. PR #106 merged into `dashboard-v2` with merge commit `48b50b0` after Forgejo Actions task `#453` passed for reviewer head `c36f89cd97`. Beads issue `islandflow-mcmd.5` is closed by the orchestrator.
