# Phase 04: Incremental Live Buffers

Beads issue: `islandflow-ze79.5`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Replace repeated whole-window merge/dedupe/sort/slice work in hot live paths with keyed incremental buffers.

## Problem

Some live/history helpers combine new items with an existing bounded window, dedupe, sort the full set, and slice back to the limit. That is simple and correct, but expensive when it runs frequently across multiple channels.

## Scope

- Identify hot paths that perform whole-window merge/sort per message or small batch.
- Introduce a keyed incremental buffer module for bounded live windows.
- Preserve current ordering, dedupe, cursor, and eviction semantics.
- Add unit tests that compare incremental behavior to the old merge semantics.
- Roll out to durable-tapes hot channels only after tests prove parity.

## Target Interface

The interface can differ, but should keep callers simple:

```ts
type LiveWindowBuffer<T> = {
  upsertMany(items: T[]): LiveWindowSnapshot<T>;
  reset(items: T[]): LiveWindowSnapshot<T>;
  getSnapshot(): LiveWindowSnapshot<T>;
};
```

The implementation hides keyed maps, ordered IDs, sorting strategy, duplicate handling, and eviction.

## Design Constraints

- Preserve stable ordering by timestamp/sequence.
- Handle duplicate updates by key.
- Keep memory bounded.
- Avoid in-place mutations that break React snapshot expectations.
- Prove parity before replacing shared helpers.

## Quality Gates

Minimum gates:

```bash
bun test apps/web/features/durable-tape apps/web/features/terminal
bun test apps/web/app/terminal.test.ts
bun --cwd=apps/web run build
```

Probe gates:

- Run the Phase 00 probe before and after replacing the hot path.
- Compare script/task duration and heap growth.

## Acceptance Criteria

- Incremental buffer tests cover insertion, duplicate update, out-of-order item, reset, and eviction.
- Durable-tapes panes preserve visible order and row stability.
- Whole-window sorting is removed from the identified render-hot live path.
- Probe evidence shows lower per-message work or no regression.

## PR Guidance

Keep this a mechanics PR. Do not combine with server view-model work. If several channels need migration, migrate one shared path first and add follow-up child issues for domain-specific rollout only if the PR grows too large.

## Good Subagent Tasks

- Find every caller of the existing merge/sort helpers and classify hot vs cold paths.
- Review parity tests against known ordering/cursor edge cases.
- Run browser probe and compare CPU/heap deltas.
