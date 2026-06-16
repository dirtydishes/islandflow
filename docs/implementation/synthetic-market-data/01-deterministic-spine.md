# Synthetic Market-Data Phase 01: Deterministic Spine

## Purpose

Create the reusable deterministic foundation for synthetic market data. This phase should define the package/API shape for seeded generation, stable run identity, profile inputs, canonical event outputs, and provenance metadata.

## Why this phase comes now

Everything else depends on reproducible raw events. Manifests, labels, replay, demos, and smart-flow tests are only trustworthy if the same seed/profile bundle produces the same canonical market event stream every time.

## Source documents

- Architecture plan: [`docs/plans/synthetic-market-data-architecture-review.md`](../../plans/synthetic-market-data-architecture-review.md)
- Research report: [`docs/research-docs/synthetic-market-data-generation.md`](../../research-docs/synthetic-market-data-generation.md)
- Research architecture review copy: [`docs/research-docs/synthetic-data-architecture-review.md`](../../research-docs/synthetic-data-architecture-review.md)

These documents are rationale, not added scope. This phase implements only the deterministic spine described below.

## Research basis

- The research recommends a no-history-first, transparent, deterministic generator rather than historical replay as an MVP prerequisite.
- The generator needs core market realism handles from the start: discrete ticks, varying spreads, clustered arrivals, heterogeneous sizes, quote/trade separation, and options-chain sparsity.
- Full agent-based, limit-order-book, and generative-ML simulation are too heavy for the first foundation.

## Deferred research ideas

- Full LOB simulation, agent-based simulation, generative ML, and empirical calibration stay out of this phase.

## Dependencies on earlier phases

None. This is the first synthetic phase.

## Likely files/modules touched

- Future `packages/synthetic-market/` workspace or equivalent package boundary
- `packages/types/src/events.ts`
- Synthetic logic currently embedded in `services/ingest-options/` and `services/ingest-equities/`
- Shared package manifests such as `package.json`, `bunfig.toml`, or workspace config if a new package is added
- Infra-free unit tests under the new package or nearby package test folders

## In-scope work

- Define `SyntheticRun`, `SeedBundle`, `ParameterSnapshot`, `SymbolProfile`, `LiquidityProfile`, `VolatilityRegime`, `OptionChainProfile`, and `GeneratedEventBatch` shapes.
- Pick and wrap a deterministic PRNG so fixed inputs produce stable output.
- Emit canonical `OptionPrint`, `OptionNBBO`, `EquityPrint`, and `EquityQuote` events.
- Attach provenance such as `source_kind`, `run_id`, `parameter_snapshot_hash`, and optional `scenario_id`.
- Preserve compatibility with the existing pipeline's raw market event contracts.
- Add fast deterministic tests that run in plain `bun test`.

## Explicitly out-of-scope work

- Scenario catalogs and ground-truth label records.
- Manifest generation and CLI workflows.
- Replay service integration.
- Hosted demo controls or live synthetic emitters.
- Historical calibration from real market data.
- Docker, ClickHouse, NATS, or Redis integration tests.

## Acceptance criteria

- A fixed seed/profile bundle produces byte-stable or hash-stable event output.
- Generated events use canonical market event contracts, not synthetic-only pipeline event types.
- Hidden labels are not embedded in emitted market events.
- Provenance metadata is available for downstream filtering and auditing.
- Tests cover determinism, tick validity, quote/trade invariants, and basic profile normalization without requiring infrastructure.

## Test strategy

Use infra-free Bun tests. Cover PRNG repeatability, profile parsing, event ordering within generated batches, option quote/print validity, equity quote/print validity, and provenance field stability. Avoid any test that needs Docker, ClickHouse, NATS, or Redis.

## Risks / design traps

- Hiding wall-clock timers or random calls inside the generator will break determinism.
- Creating synthetic-only market event types will fork the pipeline contract.
- Embedding labels directly on market events will leak ground truth into production-like paths.
- Over-designing a full market simulator now will slow down the MVP.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/synthetic-market-data/01-deterministic-spine.md for Beads issue islandflow-259.1. Stay inside the deterministic synthetic market-data foundation only. Do not add scenario labels, manifests, replay integration, demos, or historical calibration. Emit canonical market event types and keep early tests infra-free.
```

## Matching Beads issue title/id

- `islandflow-259.1` - Synthetic market-data phase 01: deterministic spine
