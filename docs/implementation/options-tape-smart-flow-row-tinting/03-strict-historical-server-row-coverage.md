# Phase 03: Strict Historical And Server-Row Coverage

## Intent

Complete strict coverage so loaded historical options rows and server-composed durable option rows use the same smart-flow tint semantics as live rows.

## Required Work

- Wire existing `/lookup/options-support.smart_flow` through the frontend hydration scheduler result/cache.
- Move or add support hydration inside the reusable options tape path so visible live and loaded history rows can request packet and smart-flow support.
- Ensure older `/history/options` rows tint after support hydration when their packet or hypothesis context is discoverable.
- Extend durable row view-model support with `support.smart_flow`.
- Make `DurableTapeOptionRowsPane` use the same tint helper/rules as `OptionsTape`.
- Add or adjust API tests for `smart_flow` in options support and durable option rows.
- Prove repeated requests, misses, and cache behavior stay bounded.

## Architecture Constraints

- Keep one canonical smart-flow tint helper for options rows. Do not fork the rules between `OptionsTape` and durable option row panes.
- Preserve the hydration scheduler's batching, in-flight reuse, and miss caching behavior.
- Do not turn support hydration into a per-render or per-row request storm.
- Keep durable row server payloads explicit; do not hide smart-flow support in an untyped catch-all object.
- Avoid sequential orchestration where independent support requests can stay batched or parallel without making the code harder to reason about.
- Do not widen this phase into smart-flow scoring, calibration, or broad explainability redesign.

## Likely Files

- `apps/web/features/terminal/hydration-scheduler.ts`
- `apps/web/features/terminal/hydration-scheduler.test.ts`
- `apps/web/features/options-tape/`
- `apps/web/features/durable-tape/row-view-models.tsx`
- `packages/types/src/durable-tapes.ts`
- `services/api/src/index.ts`
- `services/api/src/durable-rows.ts`
- `services/api/tests/`

## Acceptance Criteria

- `OptionSupportResult` exposes smart-flow projections from `/lookup/options-support`.
- Hydration caches smart-flow support without duplicating request storms or breaking existing packet, classifier, smart-money, and NBBO support.
- Loaded older `/history/options` rows can tint after hydration when packet/hypothesis context is discoverable.
- Durable option row payloads include typed `support.smart_flow` where context exists.
- `DurableTapeOptionRowsPane` uses the same smart-flow tint rules as `OptionsTape`.
- API tests cover `smart_flow` in `/lookup/options-support` and durable option rows.
- A focused integration or end-to-end UI test proves historical rows tint after loading older pages.

## Suggested Checks

```bash
bd show islandflow-xcdn.3
bun test apps/web/features/terminal/hydration-scheduler.test.ts apps/web/features/options-tape
bun test services/api/tests
bun test
bun --cwd=apps/web run build
```

If browser QA is needed, start only the required local component and assume the hosted backend unless the phase worker is explicitly told otherwise:

```bash
bun run dev:web
```

## Implementation Subagents

Run this phase through the full topology in `IMPLEMENT.md` when useful: selector agent, 6-10 read-only scout agents, one implementation worker, 3-8 review agents, and one lead reviewer.

Every review agent and the lead reviewer must use the `thermo-nuclear-code-quality-review` skill before reviewing this phase.

The Phase 03 worker may use helper subagents for:

- Hydration scheduler typing, cache, miss, and repeated-request review.
- API support payload and durable-row contract review.
- OptionsTape versus durable option row tint-rule parity audit.
- Historical row integration test design.
- Final gate and browser-QA checklist.

Helpers may propose specific edits or tests, but the worker owns the hydration/server-row contract, branch, Beads updates, commit, PR state, and final callback.

## Out Of Scope

- Changing smart-flow scoring policy.
- Adding calibration data.
- Broad server-composed row rewrites beyond the smart-flow support field.
- Dashboard redesign.
- New public API surfaces not needed for support hydration or durable rows.

## Suggested Future Codex Implementation Prompt

```text
Run under docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md using the orchestrator-callback workflow. Implement docs/implementation/options-tape-smart-flow-row-tinting/03-strict-historical-server-row-coverage.md for Beads issue islandflow-xcdn.3 after Phase 02 is merged. Expose smart_flow through hydration results/cache, tint loaded historical options rows after support hydration, add typed durable option row support.smart_flow coverage, and keep OptionsTape and DurableTapeOptionRowsPane on the same tint helper. Run full final gates including bun test and bun --cwd=apps/web run build. Open a Forgejo PR when ready and call back to the orchestrator exactly once using docs/implementation/options-tape-smart-flow-row-tinting/schemas/implementation-callback.schema.json. Do not create the reviewer thread.
```

## Matching Beads Issue

- `islandflow-xcdn.3` - Phase 03: strict historical and server-row coverage
