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

Not started by this worker. The orchestrator owns review-thread creation and
Beads closeout after the implementation callback.

## CI And Gates

CI owner: implementation worker for local gates, reviewer/orchestrator for
Forgejo CI.

Current CI state: `local-gates-passed`

Evidence:

- `bun install --frozen-lockfile` - passed after the prepared worktree was
  missing `node_modules`.
- `bun test apps/web/features/options-tape` - passed, 24 tests.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts` -
  passed, 91 tests.
- `bun --cwd=apps/web run build` - passed.
- Browser verification used system Chromium at `/usr/bin/chromium` against
  local Next dev on `http://127.0.0.1:3001`.
- Browser desktop and mobile probes passed for `/options` default module
  behavior and `/qa` diagnostics, with no sampled overflow:
  - `/tmp/islandflow-j06e4-options-desktop.png`
  - `/tmp/islandflow-j06e4-qa-desktop.png`
  - `/tmp/islandflow-j06e4-options-mobile.png`
  - `/tmp/islandflow-j06e4-qa-mobile.png`
- Browser logs showed existing API-down history/bootstrap fetch warnings when
  the local API at `http://127.0.0.1:4000` was unavailable. The UI still
  rendered and the diagnostics/settings probes passed; a follow-up bug was
  filed for graceful handling.

## PR And Commits

Pending publication.

## Beads Updates

- `islandflow-j06e.4` remains open for orchestrator-owned closeout.
- Filed follow-up `islandflow-j06e.6` for graceful handling of options QA
  history/bootstrap fetch failures when the local API is unavailable.

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

Implementation and local verification are complete. Publication, Forgejo PR
creation, and the final callback remain.
