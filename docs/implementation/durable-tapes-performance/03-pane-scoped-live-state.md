# Phase 03: Pane-Scoped Live State Subscriptions

Beads issue: `islandflow-ze79.4`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Reduce React work by making each durable-tapes pane subscribe to only the live state it actually renders.

## Problem

The durable-tapes route composes options, flow, equities, alerts, and news through shared terminal-era state. A new options print can rebuild shared maps, rerun derived selectors, and wake logic used by other panes. This makes small websocket events create broad page work.

## Scope

- Identify render-hot shared terminal state used by `/durable-tapes`.
- Split live state access into channel/pane slices.
- Keep shared hydration caches outside render-hot pane recomputation.
- Preserve existing route behavior and pane composition.
- Add tests or probe evidence that unrelated panes do not recompute for unrelated channel updates.

## Target Shape

```text
OptionsTape -> options slice + hydration cache
AlertsModule -> alerts slice + hydration cache
FlowPacketsTape -> flow slice
EquitiesTape -> equities slice
NewsWire -> news slice
```

Shared data should be shared through stable stores or selectors, not by forcing all panes through one broad context value that changes on every message.

## Design Constraints

- Keep public domain module interfaces small.
- Do not rewrite UI templates in this phase.
- Do not introduce server-composed row models in this phase.
- Avoid duplicating websocket connections.
- Preserve replay/live mode behavior.
- Preserve scroll hold and live insertion semantics.

## Quality Gates

Minimum gates:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test apps/web/features/terminal apps/web/features/durable-tape
bun --cwd=apps/web run build
```

Probe gates:

- Run the Phase 00 probe after Phase 01 and Phase 02 are included.
- Capture script/task delta before and after the state split.
- Verify all five panes still render correctly.

## Acceptance Criteria

- A new options event does not force unrelated pane selectors/effects to recompute without changed inputs.
- Pane data access is slice-oriented.
- Hydration scheduler state is shared without broad terminal invalidation.
- Performance probe shows reduced script work or render churn compared to the post-Phase-01/02 baseline.

## PR Guidance

This is a state architecture PR. Keep it reviewable by preserving UI output and avoiding server/API redesign. If the split exposes an awkward public interface, prefer one deeper pane store module over several pass-through helpers.

## Good Subagent Tasks

- Inventory current terminal context consumers on `/durable-tapes`.
- Trace which selectors/effects run after an options-only update.
- Review tests for route feature and live/replay mode coverage after the split.
