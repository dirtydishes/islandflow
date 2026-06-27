# Phase 01: Server-Side Smart-Flow Support Resolver

Canonical Beads issue: `islandflow-miqb.1`

Epic: `islandflow-miqb`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Build the authoritative API resolver that attaches compact, typed `support.smart_flow` to option rows when real non-abstained smart-flow support exists, without requiring browser-side joins.

## Scope

Allowed:

- Define the exact compact row support shape for smart-flow support.
- Resolve direct option-print refs from smart-flow projections.
- Resolve packet-backed support by expanding `FlowPacket.members`.
- Hydrate missing packet membership by option print `trace_id` in bounded batches.
- Prefer hot cache or in-memory/live context, then fall back to durable storage for scroll/detail bounded requests.
- Select the highest-confidence non-abstained projection when multiple projections match.
- Cache hits and misses to prevent repeated request storms.
- Preserve explicit unavailable states for packet unavailable, smart-flow unavailable, and no matching projection.
- Add focused API/storage tests.

Out of scope:

- Smart-flow scoring, calibration, and policy changes.
- Frontend settings, packet UI, or triage workspace.
- Replay behavior.
- Shipping full evidence, alternatives, or packet-member arrays on every row.

## Inputs

- `docs/implementation/options-tape-smart-flow-row-tinting/03-strict-historical-server-row-coverage.md`
- `docs/implementation/durable-tapes-performance/05-server-composed-view-models.md`
- `docs/implementation/durable-tapes/02-options-tape.md`
- `services/api/src/index.ts`
- `services/api/src/durable-rows.ts`
- `services/api/tests/`
- Storage APIs for option prints, flow packets, and smart-flow projections.

## Implementation Notes

- The resolver should be window-scoped. It should take a bounded set of option trace IDs and optional known packet IDs.
- Request flow should be cache first, storage second.
- Independent lookups should remain batched or parallel where practical.
- Row payload should stay compact: projection id, optional packet id, hypothesis type, direction, confidence, abstention flag, and summary counts are reasonable. Full evidence belongs in detail endpoints.
- Direct print support remains valid even without packet support.
- Non-abstained support is tint eligible. Abstained or unclear support may be returned for detail context only if the row contract names that state clearly and the frontend does not tint it by default.

## Beads

- Epic: `islandflow-miqb`
- Issue: `islandflow-miqb.1`
- Depends on: None
- Parallel-safe: No. This phase establishes the support contract used by later phases.

## Expected Files Or Areas

- `packages/types/src/durable-tapes.ts`
- `services/api/src/index.ts`
- `services/api/src/durable-rows.ts`
- `services/api/tests/`
- Storage package files that expose packet/projection lookup helpers.

## Suggested Swarms

- API resolver scout: existing lookup/options-support and durable-row composition.
- Storage scout: flow packet member lookup and smart-flow projection lookup limits.
- Contract scout: row payload type shape and compatibility with existing frontend types.
- Performance scout: cache keys, miss caching, and request batching risks.
- Test scout: focused API/storage coverage gaps.

## Quality Gates

```bash
bun test services/api/tests
bun test packages/storage
bun test
```

If full `bun test` is blocked by known unrelated local issues, document the exact failure and run the focused API/storage gates.

## Completion Criteria

- `support.smart_flow` is attached by direct print refs and packet member refs.
- Missing packet membership can be resolved by option `trace_id`.
- Durable storage fallback is bounded and cache protected.
- Multiple matches choose highest-confidence non-abstained support.
- Negative and positive caches prevent repeated storms.
- Tests cover direct refs, packet refs, missing packet hydration, fallback, selection policy, misses, and limits.
- The phase turn doc records implementation, review, CI/gates, Beads updates, and any follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for adjacent discoveries.
