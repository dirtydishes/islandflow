# Synthetic Market-Data Phase 03: Scenarios, Labels, and Expected Outputs

## Purpose

Author named deterministic scenarios, separate ground-truth labels, and expected-output manifests that downstream smart-flow logic can use for positive, negative, abstention, and false-positive validation.

## Why this phase comes now

The generator and manifest layers should exist before scenario authoring. Smart-flow evidence clustering should also define enough vocabulary for expected outputs to describe evidence requirements without leaking labels into emitted market events.

## Source documents

- Architecture plan: [`docs/plans/synthetic-market-data-architecture-review.md`](../../plans/synthetic-market-data-architecture-review.md)
- Research report: [`docs/research-docs/synthetic-market-data-generation.md`](../../research-docs/synthetic-market-data-generation.md)
- Smart-flow research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../../research-docs/smart-flow-market-mechanics.md)

These documents are rationale, not added scope. This phase implements only named scenarios, separate labels, and expected-output contracts.

## Research basis

- Scenario injection into a realistic synthetic background is mandatory for labeled, replayable alert tests.
- Negative, noisy, stale, wide-market, and event-context cases matter as much as positive "should detect" scenarios.
- Labels and expected outputs need required evidence, forbidden evidence, confidence bands, and false-positive penalties.

## Deferred research ideas

- Empirical tuning of scenario frequencies, full historical replay-plus-mutation, and learned scenario generation belong after the MVP scenario catalog is stable.

## Dependencies on earlier phases

- `islandflow-259.1` - Synthetic deterministic spine
- `islandflow-zxh.1` - Smart-flow contracts and vocabulary
- `islandflow-259.2` - Manifests, fixtures, and CLI
- `islandflow-zxh.2` - Evidence clustering and features

## Likely files/modules touched

- Future scenario catalog files under `packages/synthetic-market/`
- Label schema definitions
- Manifest expected-output sections
- Fixture generation tests
- Smart-flow fixture expectations in compute test areas, once available

## In-scope work

- Define `ScenarioInjection` and `GroundTruthLabel` records.
- Add named scenario profiles for institutional directional flow, retail-attention flow, event/noise flow, volatility-seller behavior, hedge-reactive flow, arbitrage-like structure, and no-alert negatives.
- Keep labels keyed by `run_id`, `scenario_id`, event IDs or trace IDs, expected class, expected direction, confidence band, required evidence, forbidden evidence, and false-positive penalties.
- Extend manifests with expected derived events, alert/no-alert expectations, and evidence requirements.
- Make generated scenario outputs reviewable and deterministic.

## Explicitly out-of-scope work

- Emitting labels on market events.
- Building a live synthetic service.
- Adding UI scenario controls.
- Implementing historical calibration.
- Rewriting smart-flow scoring behavior beyond what is needed to express expected outputs.

## Acceptance criteria

- Scenario fixtures are named, deterministic, and small enough for review.
- Labels remain separate from emitted market events.
- Expected-output manifests include positive expectations, no-alert expectations, evidence requirements, forbidden evidence, and false-positive penalties.
- The phase can test both "should detect" and "should abstain or suppress" cases.
- Existing issue `islandflow-9dz` is treated as related scenario-tuning context, not as the broad phase tracker.

## Test strategy

Use fixture-generation and manifest-validation tests first. Add focused golden comparisons only where the smart-flow contract is ready. Keep the default test path infra-free. Optional service-backed scenario loading can wait for a later integration phase.

## Risks / design traps

- Labels leaking into canonical event payloads will invalidate evaluation.
- Only authoring positive scenarios will make the classifier overfit demos.
- Broad scenario catalogs can become too large for one PR.
- Expected outputs that name legacy "smart money" certainty can undermine the new evidence/hypothesis model.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/synthetic-market-data/03-scenarios-labels-expected-outputs.md for Beads issue islandflow-259.3. Split the work using islandflow-259.3.1 and islandflow-259.3.2 if needed. Keep labels separate from emitted events, include negative/no-alert expectations, and avoid demos or live service work.
```

## Matching Beads issue title/id

- `islandflow-259.3` - Synthetic market-data phase 03: scenarios, labels, and expected outputs
- PR split: `islandflow-259.3.1` - Split synthetic phase 03a: scenario catalog and labels
- PR split: `islandflow-259.3.2` - Split synthetic phase 03b: expected-output manifests
