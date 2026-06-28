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

Not started.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `local-gates-passed`

Evidence:

- `bun install` (fresh worktree dependency link)
- `bun test apps/web/features/options-tape` - pass, 27 tests
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts` - pass, 94 tests
- `bun --cwd=apps/web run build` - pass
- Browser verification with temporary dev server:
  - Server: `WEB_DEV_PORT=3216 NEXT_PUBLIC_API_URL=http://127.0.0.1:49999 bun --cwd=apps/web run dev`
  - Browser: `/usr/bin/chromium` headless via CDP
  - `/options`, 1440x1000: degraded text rendered, one dead API request failed, no overlay, no runtime exceptions, no unhandled-console signal
  - `/options`, 390x844: degraded text rendered, one dead API request failed, no overlay, no runtime exceptions, no unhandled-console signal
  - `/qa`, 1440x1000: degraded text rendered, one dead API request failed, no overlay, no runtime exceptions, no unhandled-console signal
  - `/qa`, 390x844: degraded text rendered, one dead API request failed, no overlay, no runtime exceptions, no unhandled-console signal
  - Screenshots saved during verification under `/tmp/islandflow-j06e6-*.png`.

## PR And Commits

- Branch: `lavender/islandflow-j06e-6-qa-history-failures`
- PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/99`
- Commits:
  - `63de914027cb8e6ea422c11a6e1361fdcdd056ff` - handle options and qa history failures
  - final turn-doc publication update

## Beads Updates

No Beads mutation by the implementation worker. Issue remains `in_progress`; orchestrator owns closeout.

## Follow-Ups Filed

None.

## Context To Keep

- The bug is about unavailable API/history/bootstrap failure handling, not adding new diagnostics.
- Existing successful API behavior must remain unchanged.
- Avoid global error swallowing or unbounded retries.
- Browser API failures are handled locally at the options history source and QA bootstrap hook; schema/parser failures still surface through the component catch path.

## Closeout

Implementation complete and PR published. Orchestrator owns review-thread creation, Beads closeout, merge, and epic closeout.
