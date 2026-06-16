# Synthetic Market-Data Phase 04: Replay Integration

## Purpose

Make replay consume synthetic runs deterministically, either directly from generated fixtures or from materialized storage rows, while preserving the same ordering semantics the real replay path uses.

## Why this phase comes now

Replay should not be wired to synthetic data until the generator, manifests, labels, and smart-flow hypothesis pipeline have stable semantics. At this point, replay can become a serious acceptance gate instead of a demo convenience.

## Dependencies on earlier phases

- `islandflow-259.1` - Synthetic deterministic spine
- `islandflow-259.2` - Manifests, fixtures, and CLI
- `islandflow-259.3` - Scenarios, labels, and expected outputs
- `islandflow-zxh.3` - Hypothesis scoring and abstention

## Likely files/modules touched

- `services/replay/src/`
- API replay routes in `services/api/`
- Replay-related shared types in `packages/types/`
- Optional fixture materialization helpers in `packages/storage/`
- Replay tests or golden comparison helpers

## In-scope work

- Add replay source/run selectors for synthetic runs.
- Support fixture-backed replay without infrastructure where practical.
- Preserve ordering by event time, ingest time, sequence, and stable event ID.
- Compare replayed derived outputs against manifest signatures or expected-output sections.
- Keep optional ClickHouse/NATS materialized replay tests behind non-default gates.

## Explicitly out-of-scope work

- Building new scenario labels.
- Reworking smart-flow scoring policy.
- Demo profile controls.
- Load testing.
- Historical calibration.

## Acceptance criteria

- Replay can select a synthetic source and `run_id`.
- Fixture-backed replay respects manifest ordering.
- Derived output signatures can be compared with expected manifests.
- Fast replay tests remain infra-free by default.
- Optional infra-backed tests are clearly named and gated.

## Test strategy

Start with fixture-backed replay ordering tests and manifest-signature comparisons. Add optional service-container or ClickHouse materialization tests only after the fast path is stable, and do not make those tests part of the default `bun test` requirement.

## Risks / design traps

- Creating a synthetic-only replay path with different ordering will hide bugs.
- Letting optional infra tests become default will slow or destabilize CI.
- Comparing full raw payloads everywhere may make tests brittle; use stable signatures where better.
- Replay selectors that are not run-scoped can mix synthetic and live data.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/synthetic-market-data/04-replay-integration.md for Beads issue islandflow-259.4. Add synthetic source/run replay support with stable ordering and manifest comparison. Do not add demo controls, load profiles, or historical calibration, and keep the fast test path infra-free.
```

## Matching Beads issue title/id

- `islandflow-259.4` - Synthetic market-data phase 04: replay integration
