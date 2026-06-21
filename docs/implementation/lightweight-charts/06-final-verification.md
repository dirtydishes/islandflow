# Phase 06: Final Verification and Publishing

Beads issue: `islandflow-mloi.6`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Close the implementation stream cleanly. This phase does not add feature scope; it verifies behavior, updates tracking, files follow-up issues, and publishes the completed work.

## Scope

- Verify all phase issues are closed or intentionally deferred with follow-up Beads issues.
- Run relevant and broad quality gates.
- Run browser visual checks on all chart embeddings implemented by earlier phases.
- Confirm docs still match the delivered implementation.
- Push Beads and git changes to Forgejo.

## Required Checks

At minimum:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test
bun --cwd=apps/web run build
```

If backend candle service files changed in prior phases, include the relevant service tests:

```bash
bun test services/candles/tests
bun test services/api/tests
```

## Visual Checks

Check at least:

- Dashboard desktop.
- Dashboard mobile.
- Any full-width or alternate-size chart embedding added by implementation.
- Settings menu open state.
- Timeframe dropdown open state.
- Hover readout near chart edges.
- Empty/loading/error chart states.

## Follow-Up Filing

Before closing this phase, create Beads issues for anything deferred:

- Rounded bar fallback if custom renderer did not ship.
- Unsupported timeframe intervals that users should eventually get.
- Any chart page or replay embedding not migrated.
- Known visual QA defects.
- Data contract gaps for smart-flow-only lower-pane values.

## Subagent Delegation Guidance

Appropriate subagent tasks:

- Run a read-only pass comparing docs against implementation.
- Run browser visual QA and report findings.
- Audit test output and summarize failures.

Main agent must own:

- Deciding whether failures block closeout.
- Filing follow-up issues.
- Closing Beads issues.
- `bd dolt push`.
- `git pull --rebase`.
- `git push forgejo <branch>`.

## Acceptance Gates

- All earlier phases are complete or have explicit follow-up issues.
- Required tests and build pass, or failures are documented with blocking issues.
- Visual QA has been performed and blockers are resolved.
- Implementation docs are current.
- Beads workflow is updated.
- `bd dolt push` succeeds.
- `git push forgejo <branch>` succeeds.
- `git status` shows the branch is up to date with `forgejo/<branch>`.

## PR Guidance

Use this phase for final verification and closeout only. If new behavior is discovered, create a new Beads issue instead of expanding this phase.
