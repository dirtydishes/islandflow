# Synthetic Market-Data Architecture Review

## Summary
- Target file: `docs/plans/synthetic-market-data-architecture-review.md`. No files were changed in this Plan Mode pass.
- Recommendation: **Option B — Refactor**. Conservative work would trap determinism inside ingest adapters; full redesign is premature. Refactor makes synthetic generation first-class while keeping the useful NATS, ClickHouse, compute, API, and web stack.
- Core direction: build a no-history, seeded, manifest-driven synthetic event engine with canonical real event types, separate labels/manifests, deterministic replay, fixture generation, load profiles, and demo scenarios.

## Source Documents

- Research report: [`docs/research-docs/synthetic-market-data-generation.md`](../research-docs/synthetic-market-data-generation.md)
- Research architecture review copy: [`docs/research-docs/synthetic-data-architecture-review.md`](../research-docs/synthetic-data-architecture-review.md)

These research documents explain the rationale. They are background, not implementation scope; execution scope lives in the Beads issue and the relevant phase document.

## Direct Answers
1. Synthetic generation should be a **combination**: a reusable `@islandflow/synthetic-market` package, a CLI for fixture/run generation, replay-source integration, test fixture helpers, and demo presets. A service should be only a thin live/demo emitter.
2. Synthetic events should map to existing canonical event types: `OptionPrint`, `OptionNBBO`, `EquityPrint`, and `EquityQuote`. Do not create parallel synthetic-only market event types for the main pipeline.
3. Use **metadata plus isolation**, not permanent separate business schemas. Add provenance such as `source_kind`, `run_id`, `parameter_snapshot_hash`, and optional `scenario_id`; use run-scoped subjects/databases for tests and load runs when isolation matters.
4. Ground-truth labels should be separate label records keyed by `run_id`, `scenario_id`, event IDs/trace IDs, expected class, expected direction, confidence band, required/forbidden evidence, and false-positive penalties. Do not expose hidden labels on emitted market events.
5. Expected-output manifests should be versioned JSON/YAML artifacts produced by the CLI. They should pin seed bundle, generator version, parameter snapshot hash, generated event hashes, replay ordering, expected derived events, alert/no-alert expectations, and evidence requirements.
6. Deterministic replay should consume either generated fixture files directly or materialized ClickHouse rows through the same replay ordering: event time, ingest time, seq, stable event ID. Replay should support a `synthetic` source/run selector.
7. Tests should use synthetic data at three levels: pure package invariants, small golden manifests through compute batch logic, and optional infra-backed NATS/ClickHouse integration tests. `bun test` should not require Docker.
8. Demos should use named demo runs/scenarios, not ambient live randomness. Keep the hosted synthetic control drawer for live demo tuning, but add deterministic demo run selection/replay.
9. First-class domain objects: `SyntheticRun`, `SeedBundle`, `ParameterSnapshot`, `SymbolProfile`, `LiquidityProfile`, `VolatilityRegime`, `OptionChainProfile`, `ScenarioInjection`, `GroundTruthLabel`, `ExpectedOutputManifest`, `GeneratedEventBatch`, `ReplayPlan`, `LoadProfile`, and `DemoProfile`.
10. Implementation details: PRNG algorithm internals, sampling formulas, placement heuristics, adapter timers, NATS consumer names, Redis rolling windows, ClickHouse loader mechanics, UI labels, and cache policy.

## Area Classification
- Existing replay architecture: **refactor**. Keep event-time merge and stream publishing; add generated-stream sources, run IDs, manifests, and deterministic output comparison.
- Event schemas: **refactor**. Keep canonical raw/derived event shapes; add provenance metadata and separate label/manifest schemas.
- Service boundaries: **refactor**. Move generator logic out of ingest adapters into a package; adapters become thin emitters.
- Test structure: **redesign**. Current tests are unit-heavy and adapter-local; add fixture manifests, golden outputs, and batch replay checks.
- ClickHouse fixture strategy: **refactor**. Keep storage helpers; add run-scoped fixture loaders and optional run metadata, not permanent synthetic clone tables.
- NATS/JetStream: **keep/refactor**. Keep canonical subjects for production behavior; support isolated subject prefixes or disposable streams for tests/load.
- Redis baseline interaction: **refactor**. Keep Redis for live rolling state; golden tests should use in-memory/resettable baselines.
- UI/demo needs: **refactor**. Keep replay UI and synthetic admin rail; add named deterministic demo modes and scenario selectors.
- CI feasibility: **keep/refactor**. Keep fast Bun CI; make synthetic package/golden tests infra-free and defer Docker integration to a separate job.

## Option A — Conservative
- Summary: wrap the current synthetic ingest adapters with minimal metadata, a small fixture CLI, and a few golden tests.
- Pros: fastest, least migration, preserves current demos.
- Cons: determinism remains mixed with wall-clock timers and live adapter behavior; labels/manifests stay bolted on.
- Complexity: low to medium. Migration risk: low.
- Better: quick smoke fixtures, basic provenance, modest replay demos.
- Worse: long-term generator quality, test reliability, scenario authoring.
- Kept: current ingest adapters, bus/storage/API/web mostly unchanged.
- Rewritten: small parts of synthetic adapters and tests.
- Deleted/deferred: deep replay refactor, new package boundary, batch harness.
- PR sequence: add metadata schemas; add CLI wrapper; add fixture files; add basic replay filters; add initial golden tests.

## Option B — Refactor
- Summary: create `@islandflow/synthetic-market` as the deterministic engine; make adapters, CLI, replay, tests, and demos consume it.
- Pros: deterministic by design, reusable, testable, demo-friendly, preserves the working stack.
- Cons: more up-front movement; current adapter logic must be untangled.
- Complexity: medium. Migration risk: medium-low.
- Better: seeded runs, profiles, labels, manifests, replay, golden tests, load profiles.
- Worse: short-term churn and some duplicated paths during migration.
- Kept: canonical event schemas, NATS subjects, ClickHouse helpers, compute classifiers, API replay endpoints, web replay shell.
- Rewritten: synthetic options/equities adapters, synthetic control state, replay source abstraction, tests around synthetic scenarios.
- Deleted/deferred: adapter-local scenario catalog after migration; full LOB/agent/ML simulation.
- PR sequence: add package and schemas; move current generators behind deterministic API; add CLI manifest generation; refactor adapters to consume package; add replay synthetic source/run filters; add golden fixture tests; add demo selector.

## Option C — Redesign
- Summary: rebuild around a unified deterministic event-log architecture where generation, replay, live demo, storage, and tests all consume run-partitioned event logs.
- Pros: cleanest long-term model; excellent determinism, provenance, and replay semantics.
- Cons: too much rebuild for pre-alpha; delays product learning.
- Complexity: high. Migration risk: high.
- Better: architecture purity, reproducible environments, run isolation.
- Worse: delivery speed, disruption, operational risk.
- Kept: some compute/classifier/domain logic and UI concepts.
- Rewritten: replay, ingest, storage partitioning, bus topology, fixture/test harness.
- Deleted/deferred: current synthetic adapters, current replay service shape, much of current live/demo plumbing.
- PR sequence: define event log/envelope; implement generator; rebuild replay; rebuild storage materialization; port compute; port API/UI; retire old ingest paths.

## Recommendation
Choose **Option B**. Bluntly: Option A is a patch, and it will keep producing impressive-looking but untrustworthy demos. Option C is architecture vanity for a pre-alpha product. Option B is the grown-up move: extract the generator into a deterministic package, keep the useful event pipeline, and make replay/tests/demos consume the same generated runs.

## Test Plan
- Unit: PRNG determinism, profile normalization, tick validity, quote/trade invariants, option chain sparsity, label/manifest schema parsing.
- Golden: fixed seed plus manifest produces byte/hash-stable raw events and stable smart-money/alert signatures.
- Replay: synthetic source ordering matches manifest; derived outputs match expected-output manifest.
- Integration: optional NATS/ClickHouse run-scoped fixture test behind a non-default CI job.
- Demo/load: named demo profiles render in replay UI; load profile scales rates without changing event semantics.

## Assumptions
- MVP remains no-history-first.
- Canonical real event schemas remain the pipeline contract.
- Hidden labels are never embedded directly in market events.
- Infra-backed tests are useful, but the first synthetic quality gate must pass in plain `bun test`.
