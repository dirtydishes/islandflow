# Phase 06 Turn Doc: QA History Bootstrap Failure Handling

Beads issue: `islandflow-j06e.6`

Phase doc: `docs/implementation/options-smart-flow-support-triage/06-qa-history-bootstrap-failure-handling.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected after `islandflow-j06e.5` closed because this follow-up remains an open child of the epic.

## Scope

Handle options history and QA bootstrap API failures without unhandled browser rejections while preserving successful loading behavior.

## Implementation Log

- Added retryable degraded history metadata to durable tape history pages.
- Changed options history loading so fetch rejection and non-OK history responses return a bounded unavailable page instead of rejecting through the route render path.
- Surfaced durable tape history failures in the tape header as `Options history unavailable` with a user-initiated `Retry history` action.
- Extracted QA candle bootstrap URL/fetch/status helpers and made the QA route catch bootstrap failures locally.
- Added a QA-only candle bootstrap unavailable notice with a bounded retry action.
- Kept successful options history and QA candle loading behavior unchanged.

## Subagent Swarms

None.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Completed.

Verdict: approved, no reviewer code repairs needed.

Findings:

- The diff stays phase-bounded to unavailable history/bootstrap handling for
  `/options` and `/qa`.
- Options history failure handling is local to the options source and durable
  tape history metadata. It does not add global error swallowing or API routing
  changes.
- QA candle bootstrap failures are caught inside the QA route hook, surfaced by
  a QA-only notice, and retried only by user action with a fixed retry limit.
- Existing parser/schema failures still flow through the durable tape component
  catch path instead of being silently normalized at the source boundary.
- No file crosses the 1k-line review threshold because of this PR. The options
  tape test file is close at 990 lines, but the added cases are focused and do
  not justify a phase-expanding test split here.

Repairs: none.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `ci-green`

Evidence:

- Forgejo CI: `fj actions tasks -R forgejo --page 1` showed task `#429`
  `success` on PR head `c4b8a41a9c` for `document qa history failure pr`.
- Dependency link: `bun install --frozen-lockfile` - pass in the reviewer
  worktree before rerunning gates.
- `bun test apps/web/features/options-tape` - pass, 27 tests.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts` - pass,
  94 tests.
- `bun --cwd=apps/web run build` - pass.
- Reviewer browser verification with temporary dev server:
  - Server: `WEB_DEV_PORT=3216 NEXT_PUBLIC_API_URL=http://127.0.0.1:49999 bun --cwd=apps/web run dev`
  - Browser: `/usr/bin/chromium` headless via CDP
  - `/options`, 1440x1000: degraded text rendered, one dead API request
    failed, no error overlay, no runtime exceptions, no unhandled rejections,
    no window errors, no console error/warning signal, no horizontal overflow.
  - `/options`, 390x844: degraded text rendered, one dead API request failed,
    no error overlay, no runtime exceptions, no unhandled rejections, no window
    errors, no console error/warning signal, no horizontal overflow.
  - `/qa`, 1440x1000: degraded text rendered, one dead API request failed, no
    error overlay, no runtime exceptions, no unhandled rejections, no window
    errors, no console error/warning signal, no horizontal overflow.
  - `/qa`, 390x844: degraded text rendered, one dead API request failed, no
    error overlay, no runtime exceptions, no unhandled rejections, no window
    errors, no console error/warning signal, no horizontal overflow.
  - Browser report:
    `/tmp/islandflow-j06e6-review/report-verified.json`.
  - Screenshots saved under `/tmp/islandflow-j06e6-review/`.

## PR And Commits

- Branch: `lavender/islandflow-j06e-6-qa-history-failures`
- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/99`
- Commits:
  - `63de914027cb8e6ea422c11a6e1361fdcdd056ff` - handle options and qa history failures
  - `c4b8a41a9c46425323e9840faf354fad067a734f` - document qa history failure pr
  - reviewer closeout turn-doc update

## Beads Updates

No Beads mutation by the implementation worker or reviewer. Issue remains
`in_progress`; orchestrator owns closeout.

## Follow-Ups Filed

None.

## Context To Keep

- The bug is about unavailable API/history/bootstrap failure handling, not adding new diagnostics.
- Existing successful API behavior must remain unchanged.
- Avoid global error swallowing or unbounded retries.
- Browser API failures are handled locally at the options history source and QA bootstrap hook; schema/parser failures still surface through the component catch path.

## Closeout

Implementation complete and PR published. Orchestrator owns review-thread creation, Beads closeout, merge, and epic closeout.
