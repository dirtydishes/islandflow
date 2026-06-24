# Phase 01: Shared Hydration Scheduler And Caches

Beads issue: `islandflow-ze79.2`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Stop the browser from repeatedly requesting and aborting the same support/evidence lookups while preserving the current durable-tapes behavior.

## Problem

Live updates change arrays, maps, and sets used as React effect dependencies. Effects then rescan visible/live rows, abort in-flight fetches, and start new requests for many of the same missing IDs. Alerts, options, smart-flow, and smart-money can also need overlapping trace IDs without sharing work.

## Scope

- Introduce a shared frontend hydration scheduler/cache for terminal durable-tape support data.
- Batch missing trace IDs.
- Dedupe IDs globally across call sites.
- Reuse in-flight requests.
- Add short negative caches for not-found or empty results.
- Key effects by stable missing-id summaries instead of whole live arrays, maps, or freshly allocated sets.
- Preserve current row content, badges, evidence behavior, and panes.

## Target Interface

The final interface can differ, but it should have this shape:

```ts
type HydrationScheduler = {
  requestOptionSupport(input: OptionSupportRequest): Promise<OptionSupportResult>;
  requestOptionPrints(traceIds: string[]): Promise<OptionPrintLookupResult>;
};
```

Callers should not manage batching, in-flight maps, negative caches, or retry timing directly.

## Design Constraints

- No per-component private caches for the same trace IDs.
- No unbounded maps. Apply TTL and max-size eviction.
- Negative cache entries must expire.
- Aborted render lifecycles should not abort shared fetches that other callers still need.
- Failed endpoint responses should back off instead of spinning.
- Missing IDs should be represented by stable sorted keys for React dependencies.

## Key Call Sites

Review and update the current support/evidence lookup paths in:

- `apps/web/features/terminal/state.tsx`
- options support hydration around `/lookup/options-support`
- selected smart-flow evidence fetches
- selected smart-money evidence fetches
- visible alert evidence prefetches

## Quality Gates

Minimum gates:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test apps/web/features/terminal apps/web/features/durable-tape
bun --cwd=apps/web run build
```

Probe gates:

- Run the Phase 00 probe before and after this change.
- The support/evidence lookup count must drop sharply.
- Aborted support/evidence requests should be near zero after warmup.
- The five durable panes must still populate.

## Acceptance Criteria

- Duplicate missing trace IDs are requested once per scheduler window.
- Identical in-flight lookups are reused.
- Recent misses are not immediately retried on every live update.
- Effects no longer depend on whole live arrays/maps/Sets where a stable missing-id key is sufficient.
- The Phase 00 probe shows the request storm is gone or materially bounded.

## PR Guidance

This is the first urgent product fix. Keep it focused on frontend request behavior. Do not fold in pane subscription refactors, server-composed view models, or endpoint query redesign unless a tiny API contract tweak is required for correctness.

## Good Subagent Tasks

- Inventory every support/evidence fetch call site and its dependency list.
- Review unit tests for missing scheduler behaviors: dedupe, in-flight reuse, negative cache, TTL eviction, and backoff.
- Run the browser probe and compare request counts against Phase 00 baseline.
