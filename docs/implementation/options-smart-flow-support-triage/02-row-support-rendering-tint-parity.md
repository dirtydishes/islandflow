# Phase 02: Row Support Rendering And Tint Parity

Canonical Beads issue: `islandflow-j06e.2`

Epic: `islandflow-j06e`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Make live options rows, loaded historical rows, and server-composed durable option rows consume the same smart-flow support contract and tint through one canonical helper.

## Scope

Allowed:

- Wire Phase 01 support into the frontend hydration/cache path.
- Ensure durable option row panes and `OptionsTape` use the same tint helper and support shape.
- Apply tint only for non-abstained support.
- Treat `unclear` and abstained outputs as explainability context, not signal tint.
- Keep client work to cheap row rendering and existing virtual table class/style hooks.
- Add focused tests for live, loaded history, and durable row rendering parity.

Out of scope:

- Packet-scope click behavior beyond preserving existing callbacks.
- Settings popout redesign.
- QA diagnostic columns.
- More-info triage workspace.
- Smart-flow scoring or label policy changes.

## Inputs

- Phase 01 resolver output.
- `apps/web/features/terminal/hydration-scheduler.ts`
- `apps/web/features/terminal/hydration-scheduler.test.ts`
- `apps/web/features/options-tape/`
- `apps/web/features/durable-tape/`
- `apps/web/features/durable-tape/row-view-models.tsx`
- `packages/types/src/durable-tapes.ts`

## Implementation Notes

- Browser-side code should not scan smart-flow projection arrays to infer support.
- Hydration may request support for visible rows in batches, but should reuse in-flight work and cache misses.
- Durable row panes should read `row.support.smart_flow` when present.
- If support is unavailable, render the row normally and expose clear diagnostic state only where a diagnostic surface asks for it.
- Do not fork hypothesis tone, confidence band, or abstention logic.

## Beads

- Epic: `islandflow-j06e`
- Issue: `islandflow-j06e.2`
- Depends on: `islandflow-j06e.1`
- Parallel-safe: No. This depends on the server support contract.

## Expected Files Or Areas

- `apps/web/features/terminal/hydration-scheduler.ts`
- `apps/web/features/terminal/hydration-scheduler.test.ts`
- `apps/web/features/options-tape/`
- `apps/web/features/durable-tape/`
- `apps/web/features/durable-tape/row-view-models.tsx`
- `packages/types/src/durable-tapes.ts`

## Suggested Swarms

- Hydration scheduler scout: batching, in-flight reuse, miss caching.
- Tint parity scout: all tint helper call sites and duplicate logic.
- Durable row scout: row view model support shape and feature flags.
- Options tape scout: live and historical row state behavior.
- Test scout: rendering parity and regression coverage.

## Quality Gates

```bash
bun test apps/web/features/terminal/hydration-scheduler.test.ts apps/web/features/options-tape
bun test apps/web/features/durable-tape apps/web/features/options-tape
bun --cwd=apps/web run build
```

Run API tests again if frontend changes expose gaps in Phase 01 support payloads.

## Completion Criteria

- Live, loaded historical, and durable row surfaces consume the same support semantics.
- Only non-abstained support produces row tint.
- `unclear` and abstained support do not create signal tint.
- No browser-side packet/projection/evidence reconstruction is added.
- Focused tests prove parity.
- The phase turn doc records implementation, review, CI/gates, Beads updates, and any follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for adjacent discoveries.
