# Phase 03: Flow Packets Module

Beads issue: `islandflow-h9c0.4`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Create a durable `FlowPacketsTape` module that owns packet summaries, packet focus, packet detail, and packet callbacks. Options and alerts can link to flow packets, but they should not own the packet UI.

## Current State

The current `FlowPane` is virtualized and has useful packet columns, but it is still coupled to terminal state and route-specific pane chrome.

## Scope

- Create `apps/web/features/flow-packets/`.
- Extract packet row formatting and packet summary logic.
- Use the shared durable foundation for live/head, ClickHouse history, scroll hold, and templates.
- Support packet focus callbacks for options and alerts.
- Provide packet hover/detail content without depending on terminal drawers.

## Default Columns

Full template:

```text
TIME | CONTRACT | PRINTS | PREMIUM | WINDOW | SIDE | QUALITY
```

Two-thirds template:

```text
TIME | CONTRACT | PRINTS | PREMIUM | SIDE
```

One-third template:

```text
CONTRACT | PRINTS | PREMIUM
```

## Detail Surface

Hover/focus should include:

- packet ID
- member print count
- total size
- total premium/notional
- window start/end
- structure type
- NBBO coverage
- aggressive buy/sell ratios
- stale or missing quote state
- links or callbacks to inspect packet member prints

## Integration With Options

The options tape can pass `onPacketFocus` and use packet member refs to show packet prints in the same options table. That interaction belongs to the options module, but the packet summary and packet inspect surface belong here.

## Parallel Work

Can parallelize after Phase 01:

- Packet feature inventory and formatting helpers.
- Column template design.
- Packet hover/detail content.
- Existing flow history test review.

Keep serial:

- Packet focus callback contract.
- Module export shape.
- Integration with options or alerts.

## Stacking Guidance

This can stack after Phase 01 or run in parallel with Phase 02 only after the options and flow implementers agree on packet-focus callback payloads. Avoid a stack where both PRs redefine packet member semantics.

## Subagent Guidance

Good subagent tasks:

- Inventory current `FlowPane` features and packet fields.
- Draft packet quality labels that avoid red/green-only meaning.
- Review `/history/flow` and flow packet storage tests for coverage gaps.

Main agent must own:

- Packet event contract.
- Any shared callback type consumed by options or alerts.
- Route integration decisions.

## Acceptance Gates

- `FlowPacketsTape` is exported from `apps/web/features/flow-packets/`.
- Existing flow packet view can be rendered through the new module or a compatibility adapter.
- Packet rows use shared scroll hold and history behavior.
- Packet callbacks do not import terminal state.
- No default template needs horizontal scrolling.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## Out Of Scope

- Options packet-print table behavior.
- Alert evidence hydration.
- New packet scoring or classifier policy.
