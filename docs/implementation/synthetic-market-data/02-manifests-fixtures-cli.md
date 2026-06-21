# Synthetic Market-Data Phase 02: Manifests, Fixtures, and CLI

## Purpose

Turn the deterministic generator into reusable artifacts: fixture files, run manifests, and a CLI that can produce repeatable synthetic runs for tests, replay, demos, and later evaluation.

## Why this phase comes now

The deterministic spine gives the repo stable raw events. The next step is to make those events durable and addressable so downstream phases can reference exact generated runs instead of recreating ad hoc local randomness.

## Source documents

- Architecture plan: [`docs/plans/synthetic-market-data-architecture-review.md`](../../plans/synthetic-market-data-architecture-review.md)
- Research report: [`docs/research-docs/synthetic-market-data-generation.md`](../../research-docs/synthetic-market-data-generation.md)
- Research architecture review copy: [`docs/research-docs/synthetic-data-architecture-review.md`](../../research-docs/synthetic-data-architecture-review.md)

These documents are rationale, not added scope. This phase implements only manifests, fixtures, and CLI support.

## Research basis

- Deterministic replay and reviewable artifacts are necessary for synthetic data to be useful as validation data, not just demo data.
- Expected-output manifests should pin seed, profile, generator version, event hashes, and replay ordering.
- Hidden labels must stay separate from market events so tests do not leak ground truth into production-like paths.

## Deferred research ideas

- Empirical residual resampling and historical-window bootstrapping are future artifact sources, not this CLI's first requirement.

## Dependencies on earlier phases

- `islandflow-259.1` - Synthetic deterministic spine
- `islandflow-zxh.1` - Smart-flow contracts and vocabulary, so manifest expectations can align with the emerging evidence/hypothesis language

## Likely files/modules touched

- Future `packages/synthetic-market/` CLI entrypoints
- Fixture directories under a package or service test area
- Manifest schemas, likely JSON or YAML
- `package.json` scripts if a repo command is added
- Tests for manifest parsing and fixture generation

## In-scope work

- Define `ExpectedOutputManifest`, `ReplayPlan`, and generated fixture artifact layout.
- Add a CLI command that accepts seed bundle, profile, scenario/run name, output directory, and deterministic generation options.
- Write manifests that pin generator version, seed bundle, parameter snapshot hash, generated event hashes, replay ordering, and run metadata.
- Add fixture helpers for tests to load generated batches without infrastructure.
- Keep labels as separate records or future manifest sections, not market-event fields.

## Explicitly out-of-scope work

- Full scenario catalog authoring.
- Smart-flow expected output comparisons.
- Replay service source selection.
- ClickHouse fixture materialization.
- UI demo selection.
- Historical calibration.

## Acceptance criteria

- A CLI can generate repeatable fixtures and manifests from fixed inputs.
- Manifests include generator version, seed/profile identity, parameter hash, event hashes, and replay ordering.
- Fixture helpers can load generated event batches in infra-free tests.
- Generated artifacts do not embed hidden labels into canonical market events.
- Re-running generation with the same inputs produces stable manifests or an intentional diff.

## Test strategy

Use plain Bun tests for CLI argument parsing, manifest schema parsing, deterministic fixture output, and fixture-loader helpers. Golden files should be small and intentionally reviewed. Do not require Docker, ClickHouse, NATS, or Redis.

## Risks / design traps

- Manifests that omit generator version or parameter hashes will become hard to audit.
- Large generated fixtures can create noisy reviews; keep early fixtures tiny.
- A CLI that silently uses defaults will make tests look deterministic while hiding input drift.
- Mixing expected smart-flow outputs too early can couple this phase to unfinished classifier changes.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/synthetic-market-data/02-manifests-fixtures-cli.md for Beads issue islandflow-259.2. Build manifest, fixture, and CLI support on top of the deterministic spine. Keep tests infra-free and do not implement scenario labels, replay integration, demo profiles, or historical calibration.
```

## Matching Beads issue title/id

- `islandflow-259.2` - Synthetic market-data phase 02: manifests, fixtures, and CLI
