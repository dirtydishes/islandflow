# Synthetic Market-Data Phase 05: Demo and Load Profiles

## Purpose

Expose deterministic synthetic runs as named demo and load profiles after the generation, manifest, scenario, and replay foundations are in place.

## Why this phase comes now

Demos are useful only after the underlying data can be trusted. This phase deliberately waits until replay and golden evaluation prove the event semantics, so hosted controls do not become a front door to ambient randomness.

## Source documents

- Architecture plan: [`docs/plans/synthetic-market-data-architecture-review.md`](../../plans/synthetic-market-data-architecture-review.md)
- Research report: [`docs/research-docs/synthetic-market-data-generation.md`](../../research-docs/synthetic-market-data-generation.md)
- Research architecture review copy: [`docs/research-docs/synthetic-data-architecture-review.md`](../../research-docs/synthetic-data-architecture-review.md)

These documents are rationale, not added scope. This phase implements only named deterministic demo and load profiles.

## Research basis

- Demo streams should use named, seeded profiles so product behavior is reproducible.
- Load profiles should scale rate or volume without changing event semantics.
- Realism should come from the generator and scenarios, not hidden UI knobs or wall-clock randomness.

## Deferred research ideas

- Historically bootstrapped demo streams, learned realism upgrades, and full LOB-style demos stay future work.

## Dependencies on earlier phases

- `islandflow-259.1` - Synthetic deterministic spine
- `islandflow-259.2` - Manifests, fixtures, and CLI
- `islandflow-259.3` - Scenarios, labels, and expected outputs
- `islandflow-259.4` - Replay integration
- `islandflow-zxh.4` - Smart-flow replay evaluation and golden tests

## Likely files/modules touched

- Thin synthetic emitters in `services/ingest-options/` and `services/ingest-equities/`
- Demo/run selection API surfaces in `services/api/`
- Web demo controls in `apps/web/`
- Load profile definitions in the synthetic package
- Tests for profile selection and rate scaling

## In-scope work

- Add named `DemoProfile` and `LoadProfile` definitions.
- Make live/demo emitters thin consumers of deterministic synthetic runs.
- Let demo controls select named runs/scenarios rather than changing hidden random behavior.
- Ensure load profiles scale event rates without changing event semantics.
- Document local demo usage once implemented.

## Explicitly out-of-scope work

- Foundation generator work.
- New smart-flow scoring policy.
- Replacing replay evaluation with UI-only checks.
- Historical calibration.
- Production provider configuration decisions.

## Acceptance criteria

- Demo profiles are deterministic and named.
- Load profiles scale rate or volume without mutating scenario semantics.
- Hosted or local controls select known runs/scenarios.
- Live/demo emitters remain thin and do not own generator policy.
- The UI does not expose synthetic controls before the backing deterministic runs exist.

## Test strategy

Use unit tests for profile parsing, profile selection, and rate-scaling semantics. Add replay-driven smoke checks for named demo runs. Manual UI validation is appropriate only after automated replay/golden checks pass.

## Risks / design traps

- Demo controls can pressure the codebase back into wall-clock randomness.
- Load profiles may accidentally change business semantics while changing only rate was intended.
- UI-first implementation can hide missing run provenance.
- Reusing production config for synthetic demos can make operator behavior ambiguous.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/synthetic-market-data/05-demo-load-profiles.md for Beads issue islandflow-259.5. Add named deterministic demo/load profiles and thin emitter/control integration only after replay validation exists. Do not implement historical calibration or change production provider policy.
```

## Matching Beads issue title/id

- `islandflow-259.5` - Synthetic market-data phase 05: demo and load profiles
