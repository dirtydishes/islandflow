# Phase 01: Shared Durable Tape Foundation

Beads issue: `islandflow-h9c0.3`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Extract the reusable mechanics behind the existing terminal tapes into `apps/web/features/durable-tape/`. This phase creates the module every domain tape will use without changing the product semantics of options, flow, news, equities, or alerts.

## Current State

- `apps/web/features/terminal/scroll.ts` already wraps `@tanstack/react-virtual`.
- `apps/web/features/terminal/tape.ts` already has row-key, hot-window, history-tail, scroll-hold, and composition helpers.
- `apps/web/features/terminal/live.ts` already knows how to subscribe to `/ws/live` and load `/history/*` endpoints by cursor.
- These capabilities are coupled to terminal state and terminal-specific tape shapes.

## Scope

- Create `apps/web/features/durable-tape/`.
- Move or wrap pure helpers for row keys, cursor extraction, sorted merge, dedupe, and history tail append.
- Create a generic scroll-hold controller that queues incoming rows while the user is away from the live head.
- Create a reusable TanStack virtual table shell.
- Create a feature flag resolver with the `default` expansion and left-to-right overrides.
- Create responsive template selection based on container width.
- Create settings and hover/focus primitives that render outside the virtualized scroll container.
- Keep terminal components working through compatibility adapters.

## Target Files

```text
apps/web/features/durable-tape/
  index.ts
  types.ts
  feature-flags.ts
  templates.ts
  columns.ts
  keys.ts
  history.ts
  scroll-hold.ts
  virtual.ts
  components/DurableTape.tsx
  components/DurableTapeHeader.tsx
  components/DurableTapeSettingsPopover.tsx
  components/DurableTapeHoverSurface.tsx
  components/DurableTapeJumpToLive.tsx
```

## Public Interface

The shared interface should be small and behavioral:

```ts
export type DurableTapeSource<TItem, TScope, TFilters> = {
  subscribe: (input: DurableTapeQuery<TScope, TFilters>) => DurableTapeSubscription<TItem>;
  loadOlder: (cursor: DurableTapeCursor, input: DurableTapeQuery<TScope, TFilters>) => Promise<DurableTapeHistoryPage<TItem>>;
};
```

Domain modules should usually not expose this interface directly. They should expose domain components that configure it.

## Feature Resolution

`default` expands to:

- `liveHotHead`
- `clickhouseHistory`
- `scrollGate`
- `scrollHold`
- `jumpToLive`
- `newItemCount`
- `hoverDetails`
- `keyboardInspect`
- `responsiveTemplates`
- `rowTinting`
- `settingsGear`
- `noHorizontalScroll`

Resolver behavior:

- Accept strings and structured overrides.
- Expand `default` in place.
- Apply overrides left to right.
- Return a complete normalized feature object.
- Keep the resolver pure and covered by tests.

## Scroll Hold Behavior

- At the live head, incoming rows insert normally.
- Away from the live head, incoming rows queue and the visible row stack remains stable.
- History can load below without moving the anchor row.
- Jump-to-live flushes queued rows in one batch and scrolls to top.
- Manual return to top resumes and flushes.
- New item count caps at `999+`.
- Reduced motion users should get instant state changes.

## Template Behavior

The table must not require horizontal scroll in production templates. A domain template provides ordered columns with minimum widths. The foundation measures container width and selects the largest safe template unless the caller pins a template.

If no template fits, the module uses `micro` and truncates inside cells rather than overflowing.

## Styling Requirements

- Flat terminal sections with top/bottom rules.
- No card framing.
- Dense mono numeric cells.
- Stable row heights.
- Header sticks inside the module.
- Focus visible state must be clear.
- Settings popout uses the existing terminal overlay vocabulary.

## Tests

- Feature resolver behavior.
- Template fallback behavior.
- Hot/history merge and dedupe.
- Scroll-hold queue and flush behavior.
- Cursor selection for older history.
- Virtual row key stability.

## Parallel Work

Can parallelize:

- Inventory reusable helpers in `terminal/tape.ts`, `terminal/scroll.ts`, and `terminal/live.ts`.
- Draft pure tests for feature resolution, template fallback, and scroll-hold state.
- Prototype type names and folder exports for review.

Keep serial:

- Final public interface shape.
- Moving shared code out of terminal helpers.
- React component extraction.
- Any change that affects existing `/options`, `/news`, or dashboard rendering.

## Stacking Guidance

Do not stack domain module PRs until Phase 01 has a stable exported interface. A follow-up domain PR can be opened while Phase 01 is in review only if it imports finalized types and does not force foundation API churn.

## Subagent Guidance

Good subagent tasks:

- Inventory every current use of `useTapeVirtualList`, `useVirtualHistoryGate`, `usePausableTapeView`, and `composeTapeItems`.
- Compare existing scroll-hold behavior across options, flow, news, and equities.
- Draft a test matrix for scroll hold, jump-to-live, and history paging.

Main agent must own:

- The `durable-tape` public interface.
- Any code movement from terminal helpers.
- Compatibility decisions for existing terminal routes.

## Acceptance Gates

- `apps/web/features/durable-tape/` exists with typed exports.
- Existing terminal panes can still render through old paths or adapters.
- No domain module imports terminal state through the shared foundation.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## Out Of Scope

- Rebuilding `/options`.
- Changing filter semantics.
- Creating the alerts detail module.
- Changing API storage contracts.
