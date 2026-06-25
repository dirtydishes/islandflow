# Phase 02: Bound Option-Prints By-Trace Lookup

Beads issue: `islandflow-ze79.3`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Make `/option-prints/by-trace` safe for hits and misses so a single missing trace ID cannot hang the API or amplify frontend churn.

## Problem

Direct probing showed a miss on `/option-prints/by-trace?trace_id=...` can time out locally on the VPS. Even after frontend dedupe, the endpoint must be bounded because any remaining miss or incident path can still consume server and browser resources.

## Scope

- Validate and cap trace ID batches.
- Return quickly for empty or invalid input.
- Bound the ClickHouse query with timeout or equivalent safeguards.
- Improve query shape, projection, or lookup storage if required.
- Add tests for empty input, hits, misses, large batches, and timeout-safe behavior.
- Add lightweight latency visibility if the repo has a local metric pattern.

## Storage Direction

Start with the smallest safe fix:

1. Confirm the current query plan and table order.
2. Add request and query caps.
3. Add query timeout/settings if supported by the ClickHouse client.
4. If misses still scan too much, add a projection/materialized lookup table or equivalent trace-id optimized path.

Do not guess. Measure the query.

## API Contract

The endpoint should behave like this:

- no IDs: `200 { "data": [] }`
- invalid oversized request: `400`
- valid missing IDs: quick `200 { "data": [] }`
- valid hits: `200 { "data": [...] }`
- server/query failure: bounded error, not a long hang

## Quality Gates

Minimum gates:

```bash
bun test services/api/tests packages/storage/tests
bun test packages/storage/tests/option-prints.test.ts
bun --cwd=apps/web run build
```

Manual/API probes:

```bash
curl -sS -m 5 "http://127.0.0.1:4000/option-prints/by-trace?trace_id=missing-probe"
curl -sS -m 5 "<raw-api-origin>/option-prints/by-trace?trace_id=missing-probe"
```

Use deployed probes only when the phase explicitly reaches deployment verification.

## Acceptance Criteria

- Empty and missing lookups return quickly.
- Oversized batches are rejected or capped intentionally.
- Storage tests cover hits and misses.
- API tests cover HTTP behavior.
- The Phase 00 probe no longer shows long-running by-trace requests once Phase 01 and Phase 02 are both present.

## PR Guidance

This PR should stay in API/storage. Frontend changes belong in Phase 01 unless a shared type or test fixture needs a small adjustment.

## Good Subagent Tasks

- Inspect ClickHouse table definitions and query plan for trace-id lookup suitability.
- Review storage tests for realistic miss and batch coverage.
- Run local API probes repeatedly and summarize latency distribution.
