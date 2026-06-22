# Phase 06: Alerts Module

Beads issue: `islandflow-h9c0.7`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Rebuild alerts as their own durable module instead of keeping them attached to terminal drawers. Alerts should present alert rows, alert detail, and evidence hydration while linking to options, flow packets, and equities through callbacks.

## Current State

Alert details live in `apps/web/features/terminal/components/drawers.tsx`, and evidence hydration is mixed into terminal state. This makes alerts difficult to reuse and keeps options/flow/news concepts attached to one route shell.

## Dependencies

This phase waits on:

- Shared durable tape foundation.
- Options tape module, for print and contract focus events.
- Flow packets module, for packet focus and packet detail contracts.

## Scope

- Create `apps/web/features/alerts/`.
- Extract alert list rendering, alert detail rendering, and evidence hydration.
- Use shared durable tape mechanics for alert rows where appropriate.
- Link to options, flow packet, and equities modules via typed callbacks.
- Remove alert assumptions from the options tape.
- Preserve existing alert evidence behavior while making data loading module-owned.

## Default Columns

Full template:

```text
TIME | SYMBOL | KIND | SCORE | STATE
```

Two-thirds template:

```text
TIME | SYMBOL | KIND | SCORE
```

One-third template:

```text
TIME | SYMBOL | STATE
```

Classifier explanations, packet refs, evidence prints, missing refs, and trace IDs belong in alert detail.

## Alert Detail

Detail should show:

- alert name or classifier family
- severity and direction with text
- score
- source time
- classifier hits
- linked flow packet summary
- evidence prints
- unresolved refs
- actions to focus packet, contract, or equity context

The detail surface can be a route pane or drawer-like overlay, but it belongs to the alerts module.

## Parallel Work

Can parallelize after dependencies land:

- Alert drawer responsibility inventory.
- Evidence hydration test design.
- Alert column template matrix.
- Detail content audit for classifier and packet evidence.

Keep serial:

- Evidence hydration ownership.
- Links to options, flow, and equities modules.
- Removal of legacy terminal drawer state.

## Stacking Guidance

Do not start this as a stacked implementation behind unreviewed options and flow packet PRs unless their callback contracts are finalized. Alerts can have a planning or inventory branch in parallel, but runtime code should wait for the module interfaces it links to.

## Subagent Guidance

Good subagent tasks:

- Inventory all `selectedAlert`, `selectedAlertContextStatus`, and pinned evidence paths in terminal state.
- Map alert evidence refs to options, flow packet, and equity module callbacks.
- Draft detail content hierarchy with `$impeccable` product rules in mind.

Main agent must own:

- Evidence hydration ownership.
- Removing or preserving legacy drawer compatibility.
- Cross-module callback wiring.

## Acceptance Gates

- `AlertsModule` is exported from `apps/web/features/alerts/`.
- Alert evidence loading no longer requires terminal global drawer state.
- Alerts can invoke packet/options/equity focus through callbacks.
- Existing dashboard alert affordances still work through adapter wiring.
- No default template needs horizontal scrolling.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## Out Of Scope

- New alert scoring policy.
- New classifier behavior.
- News-to-alert inference.
