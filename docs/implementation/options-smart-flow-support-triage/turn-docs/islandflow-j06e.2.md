# Phase 02 Turn Doc: Row Support Rendering And Tint Parity

Beads issue: `islandflow-j06e.2`

Phase doc: `docs/implementation/options-smart-flow-support-triage/02-row-support-rendering-tint-parity.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected after `islandflow-j06e.1` was closed and merged via Forgejo PR #94.

## Scope

Implemented Phase 02 only:

- Options row support rendering now consumes compact `support_by_trace_id` hydration results instead of smart-flow projection arrays.
- Durable option rows and live/loaded options rows share the same compact `support.smart_flow` adapter and tint helper.
- Row tint is emitted only for tint-eligible, non-abstained, non-`unclear` smart-flow support.
- Abstained and `unclear` support remains available to hover/scope summaries as explainability context without signal tint.
- Packet focus behavior, settings popouts, QA diagnostic columns, replay, and smart-flow scoring policy were not changed.

## Implementation Log

- Added explicit frontend hydration support resolution typing and a `smartFlowSupportByTraceId` cache/result on `HydrationScheduler`.
- Stored Phase 01 `support_by_trace_id` payloads by option trace ID, including direct-print support that has no packet.
- Removed the options tape projection-array support mapper and the `smartFlowProjections` prop from `OptionsTape`.
- Added a single `getOptionsTapeSmartFlowContextFromSupport` adapter for compact support payloads.
- Routed live rows, loaded historical rows, and server-composed durable option rows through the compact support adapter before tinting.
- Kept packet maps for existing packet focus behavior, not for support inference.
- Removed unused projection/evidence reconstruction helpers from the options tape tint module.

## Subagent Swarms

No helper subagents used; implementation was contained to the assigned branch/worktree.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started. The orchestrator will create the review thread after implementation callback.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `local-gates-passed`

Evidence:

- `bunx biome check apps/web/app/terminal.tsx apps/web/features/durable-tape/qa-page.tsx apps/web/features/durable-tape/row-view-models.tsx apps/web/features/options-tape/OptionsTape.tsx apps/web/features/options-tape/options-tape.test.ts apps/web/features/options-tape/support-hydration.ts apps/web/features/options-tape/tinting.ts apps/web/features/options-tape/types.ts apps/web/features/terminal/hydration-scheduler.test.ts apps/web/features/terminal/hydration-scheduler.ts` - passed.
- `bun test apps/web/features/terminal/hydration-scheduler.test.ts apps/web/features/options-tape` - passed, 26 tests.
- `bun test apps/web/features/durable-tape apps/web/features/options-tape` - passed, 59 tests.
- `bun --cwd=apps/web run build` - passed.
- `bun test services/api/tests/options-support.test.ts services/api/tests/smart-flow-support-resolver.test.ts` - passed, 9 tests.
- Note: `bun install --frozen-lockfile` was required in the prepared worktree before running options tape tests because workspace dependency links were not materialized.

## PR And Commits

Pending Forgejo PR creation after commit/push.

## Beads Updates

Issue created under `islandflow-j06e`, depends on `islandflow-j06e.1`, and was already claimed/in progress for this implementation thread. Implementation thread will not close it.

## Follow-Ups Filed

None.

## Context To Keep

- Use one canonical tint helper.
- Only non-abstained support tints rows.
- No browser-side packet or projection reconstruction.
- OptionsTape no longer accepts `smartFlowProjections` for row support.
- Hydration returns compact `smartFlowSupportByTraceId`; direct-print support works without packet context.

## Closeout

Pending commit, push, Forgejo PR, and implementation callback.
