# Phase 01: Durable Tape Tint Foundation

## Intent

Add the generic durable-tape row tint API and reusable options-tape tint helpers without changing live subscriptions, API behavior, or route composition.

## Required Work

- Add row hooks to `DurableTape`:
  - `getRowClassName`
  - `getRowStyle`
  - optional `onItemsChange` only if the implementation needs a clean item-observation hook for downstream visible-row hydration.
- Make the existing `rowTinting` feature flag control whether row tint hooks apply.
- Keep the default feature-pack behavior stable except for making the existing tint flag meaningful.
- Add reusable options-tape tint helpers that map smart-flow hypothesis metadata into row decoration metadata:
  - `hypothesis_type`
  - direction
  - policy confidence
  - evidence quality where useful
  - abstention state and source reasons
- Add CSS for subtle full-row tint, direction outline/tone, low-intensity abstention, hover states, and keyboard focus states.
- Keep all tint helper logic pure and unit-testable.

## Architecture Constraints

- `DurableTape` owns row mechanics; `OptionsTape` owns option-print meaning.
- Do not put smart-flow domain logic inside the shared durable-tape foundation.
- Do not add a generic magical styling layer that hides simple row metadata. Prefer a small typed hook contract.
- Do not push `DurableTape.tsx` past 1000 lines; extract helpers or types first if the implementation starts to sprawl.
- Do not add ad-hoc special cases to row rendering. The row hooks should compose cleanly with virtualization, hover, focus, and activation.

## Likely Files

- `apps/web/features/durable-tape/types.ts`
- `apps/web/features/durable-tape/components/DurableTape.tsx`
- `apps/web/features/durable-tape/feature-flags.ts`
- `apps/web/features/durable-tape/feature-flags.test.ts`
- `apps/web/features/options-tape/`
- global or feature CSS used by durable/options tape rows

## Acceptance Criteria

- `DurableTapeProps` exposes row class/style hooks with typed inputs containing item, row key, and index.
- Row hooks are ignored when `rowTinting` resolves to `false`.
- Row hooks apply without changing row size, virtual positioning, hover behavior, keyboard focus, or activation.
- Options tint helper tests cover all current hypothesis types, direction states, confidence bands, and abstention.
- CSS keeps tinted row hover/focus states readable.

## Suggested Checks

```bash
bd show islandflow-xcdn.1
bun test apps/web/features/durable-tape apps/web/features/options-tape
```

Run broader checks only if the implementation touches shared route or terminal code.

## Implementation Subagents

Run this phase through the full topology in `IMPLEMENT.md` when useful: selector agent, 6-10 read-only scout agents, one implementation worker, 3-8 review agents, and one lead reviewer.

Every review agent and the lead reviewer must use the `thermo-nuclear-code-quality-review` skill before reviewing this phase.

The Phase 01 worker may use helper subagents for:

- Durable row API surface review.
- Feature flag precedence and default-pack behavior.
- Options-tint helper matrix design.
- CSS hover/focus/readability inspection.
- Focused test inventory.

Helpers may propose specific edits or tests, but the worker owns the hook contract, branch, Beads updates, commit, PR state, and final callback.

## Out Of Scope

- Subscribing `/options` to `smart-flow`.
- Passing smart-flow projections into `OptionsTape`.
- Hydration scheduler or API payload changes.
- Durable option row view-model changes.
- Smart-flow scoring, calibration, or model changes.

## Suggested Future Codex Implementation Prompt

```text
Run under docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md using the orchestrator-callback workflow. Implement docs/implementation/options-tape-smart-flow-row-tinting/01-durable-tape-tint-foundation.md for Beads issue islandflow-xcdn.1. Add the shared DurableTape row hook foundation and pure options-tint helpers only. Do not change live subscriptions, API payloads, or historical hydration behavior. Open a Forgejo PR when ready and call back to the orchestrator exactly once using docs/implementation/options-tape-smart-flow-row-tinting/schemas/implementation-callback.schema.json. Do not create the reviewer thread.
```

## Matching Beads Issue

- `islandflow-xcdn.1` - Phase 01: durable tape tint foundation
