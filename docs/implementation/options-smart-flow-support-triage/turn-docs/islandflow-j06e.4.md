# Phase 04 Turn Doc: QA Diagnostics And Module Settings

Beads issue: `islandflow-j06e.4`

Phase doc: `docs/implementation/options-smart-flow-support-triage/04-qa-diagnostics-module-settings.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected after `islandflow-j06e.3` completed and the orchestrator assigned
implementation on branch:

`lavender/islandflow-j06e-4-qa-diagnostics-settings`

## Scope

Implemented Phase 04 only:

- `/qa` now exposes real options support-state diagnostics sourced from the
  current durable option row view models.
- Product durable option rows no longer include a default `SUPPORT` diagnostic
  column.
- Options tape now has a `?` help affordance that explains smart-flow tinting,
  non-abstained tint eligibility, packet/contract scope, and QA diagnostic
  visibility.
- Options tape settings now include filter controls, smart-flow-only filtering,
  ETF/security type filtering, side/rating presets, premium filters, column
  visibility, and keyboard-accessible column reordering.
- Filter and settings drafts use an explicit `Apply refresh` action before
  replacing the active source filters/settings.
- Settings serialization, reset behavior, persistence, smart-flow filtering,
  diagnostic template defaults, and responsive template derivation are covered
  by focused tests.

Out of scope and not changed:

- No fabricated healthy QA support state.
- No more-info triage workspace.
- No global module chrome rewrite.
- No scoring or calibration changes.
- No unbounded historical filtering beyond the existing source APIs.

## Implementation Log

- Added a versioned options tape settings module for default settings,
  localStorage serialization, reducer actions, visible-column derivation,
  responsive row templates, and smart-flow-only row filtering.
- Extended options filter presets with A-only and B-only side/rating shortcuts
  while preserving the existing AA, BB, ask, mid, and bid presets.
- Added an options tape source wrapper that filters snapshots, listener
  updates, and history pages without changing the underlying API contract.
- Reworked the options tape settings popover into a draft/apply surface with
  reset, smart-flow-only, view, side, option type, security type, premium,
  column visibility, and keyboard Up/Down ordering controls.
- Added the module help popover and wired the active row template to the saved
  column settings.
- Split durable option row templates into product-default and diagnostic
  variants so `SUPPORT STATE` remains QA-only by default.
- Added QA support diagnostics summarizing server row counts, durable row feed
  status, support-state counts, and sample row support states.
- Added route import coverage for `/qa` and other app route modules.

## Subagent Swarms

None. Implementation stayed inside the assigned worktree/branch.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Reviewer pass completed on the PR branch.

Findings repaired:

- The PR pushed `apps/web/features/options-tape/OptionsTape.tsx` from 824
  lines to 1,094 lines by embedding the help and settings popovers directly in
  the tape orchestration component. The review treated this as a structural
  blocker under the thermo-nuclear 1k-line rule. Repair extracted the reusable
  help/settings controls into `apps/web/features/options-tape/settings-controls.tsx`
  and brought `OptionsTape.tsx` back down to 680 lines.
- The settings preset controls used tuple mapping plus `as never` casts in the
  UI layer. Repair replaced that with typed preset arrays in the extracted
  settings controls module.
- Browser verification exposed a Next dev overlay caused by unhandled
  `source.loadOlder` rejections when the local API origin was unavailable.
  Repair added a generation-aware catch in `DurableTape` history loading that
  logs the failure, clears the cursor, and marks history exhausted so the live
  or empty tape stays rendered without an unhandled rejection.

Findings remaining:

- None blocking. The API-down QA candle bootstrap still logs a handled warning
  when the local API is unavailable; it does not surface a dev overlay after
  the durable history repair.

## CI And Gates

CI owner: implementation worker for initial local gates, reviewer for repaired
local gates and Forgejo CI.

Current CI state: `forgejo-code-head-green`

Evidence:

- `bun install --frozen-lockfile` - passed after the prepared worktree was
  missing `node_modules`.
- `bun test apps/web/features/options-tape` - passed, 24 tests.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts` -
  passed, 91 tests.
- Reviewer reproduced Forgejo PR failures locally with `bun run fmt:check`;
  Biome reported formatting failures in 7 files, matching the fast failing
  Forgejo validation tasks.
- `bun run fmt:check` - passed after reviewer repair.
- `bun run lint` - passed after reviewer repair.
- `bun run typecheck` - passed after reviewer repair.
- `bun test apps/web/features/durable-tape apps/web/features/options-tape apps/web/app/terminal.test.ts apps/web/app/routes.test.ts` -
  passed, 156 tests, after reviewer repair.
- `bun test` - passed after reviewer repair, 513 tests.
- `bun run check:public-api-routes` - failed as expected without
  `DEPLOY_PUBLIC_APP_URL` and printed
  `DEPLOY_PUBLIC_APP_URL=<production-app-origin>`.
- `bun run check:docker-workspace` - passed.
- `bun --cwd=apps/web run build` - passed after reviewer repair.
- Browser verification used system Chromium at `/usr/bin/chromium` against
  local Next dev on `http://127.0.0.1:3002`.
- Browser desktop and mobile probes passed for `/options` default module
  behavior and `/qa` diagnostics, with no sampled overflow, no default
  `SUPPORT` column on `/options`, opened help/settings popovers, and no Next
  dev overlay:
  - `/tmp/islandflow-j06e-4-browser-after-guard/options-desktop.png`
  - `/tmp/islandflow-j06e-4-browser-after-guard/options-mobile.png`
  - `/tmp/islandflow-j06e-4-browser-after-guard/options-mobile-settings.png`
  - `/tmp/islandflow-j06e-4-browser-after-guard/qa-desktop.png`
  - `/tmp/islandflow-j06e-4-browser-after-guard/qa-mobile.png`
- Forgejo task `#414` on repair head `5ba84405a9` passed `Validate` in
  1m19s.

## PR And Commits

- Forgejo PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/97`
- Branch: `lavender/islandflow-j06e-4-qa-diagnostics-settings`
- Implementation commit: `7d76c7f` - `add options tape diagnostics settings`
- Publication doc commit: `3d71df4` - `document qa settings publication`
- Reviewer repair commit: `5ba8440` - `repair options tape review findings`

## Beads Updates

- `islandflow-j06e.4` remains open for orchestrator-owned closeout.
- Filed follow-up `islandflow-j06e.6` for graceful handling of options QA
  history/bootstrap fetch failures when the local API is unavailable.
- Reviewer did not close Beads; orchestrator owns closeout.

## Follow-Ups Filed

- `islandflow-j06e.6` - Handle options QA history/bootstrap fetch failures
  gracefully.

## Context To Keep

- `/qa` can show diagnostics; product modules should not show diagnostic support by default.
- Help and settings controls should stay module-owned and reusable.
- Settings that reload data need an explicit apply/refresh affordance.
- Smart-flow-only filtering is module-local and runs after support hydration;
  it does not introduce a new unbounded historical server query.
- ETF/security and side/rating controls are bounded to the existing options
  filter data model.
- The support column is now `SUPPORT STATE` and uses the diagnostic row
  template, not the product default option row template.

## Closeout

Implementation, local verification, `bd dolt push`, branch publication, and
Forgejo PR creation are complete. Reviewer repairs and local verification are
complete. The orchestrator owns Beads closeout, merge, and next-phase
selection.
