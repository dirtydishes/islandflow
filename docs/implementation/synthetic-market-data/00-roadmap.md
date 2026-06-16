# Synthetic Market-Data Roadmap

This roadmap breaks `docs/plans/synthetic-market-data-architecture-review.md` into implementation-sized phases. The recommended direction is still Option B: extract deterministic synthetic generation into a first-class reusable engine while keeping the useful NATS, ClickHouse, compute, API, replay, and web stack.

## Core Constraints

- Emit canonical market event types: `OptionPrint`, `OptionNBBO`, `EquityPrint`, and `EquityQuote`.
- Do not create synthetic-only market event types for the main pipeline.
- Keep hidden ground-truth labels separate from emitted market events.
- Keep early quality gates infra-free: `bun test` should not require Docker, ClickHouse, NATS, or Redis.
- Build deterministic foundations before demos, UI controls, or live synthetic service behavior.
- Treat historical calibration as future work, not as a dependency for the MVP synthetic generator.

## Phase Sequence

| Phase | Beads issue | Depends on | Purpose |
| --- | --- | --- | --- |
| 01 - Deterministic spine | `islandflow-259.1` | None | Create the seeded generation foundation and canonical event output contract. |
| 02 - Manifests, fixtures, CLI | `islandflow-259.2` | `islandflow-zxh.1` | Turn deterministic generation into durable fixtures and manifests. |
| 03 - Scenarios, labels, expected outputs | `islandflow-259.3` | `islandflow-zxh.2` | Author named scenarios, separate labels, and expected derived outputs. |
| 04 - Replay integration | `islandflow-259.4` | `islandflow-zxh.3` | Make replay consume synthetic runs with stable ordering and output comparison. |
| 05 - Demo and load profiles | `islandflow-259.5` | `islandflow-zxh.4` | Expose named deterministic demo/load profiles after replay validation. |
| 99 - Future historical calibration | `islandflow-259.6` | `islandflow-259.5` | Calibrate parameters from historical data later, after the MVP is stable. |

## PR Split Notes

Most phases are intended to fit in one focused PR. Phase 03 is already split into PR-sized Beads children because scenario authoring and expected-output comparison can grow quickly:

- `islandflow-259.3.1` - Split synthetic phase 03a: scenario catalog and labels
- `islandflow-259.3.2` - Split synthetic phase 03b: expected-output manifests

If any other phase starts touching unrelated service, API, UI, and storage behavior in one PR, split it before implementation continues.

## Matching Beads Epic

- `islandflow-259` - Plan synthetic market-data implementation phases
