# Smart-Flow Phase 99: Future Calibration

## Purpose

Plan future calibration of smart-flow confidence, policy thresholds, penalties, and abstention behavior after the MVP evidence/hypothesis pipeline is working and replay-validated.

## Why this phase comes now

The architecture should leave room for calibration, but calibration should not block the MVP. The system first needs clean facts, evidence, hypotheses, and replayable evaluation before tuning can be meaningful.

## Source documents

- Architecture plan: [`docs/plans/smart-flow-architecture-review.md`](../../plans/smart-flow-architecture-review.md)
- Research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../../research-docs/smart-flow-market-mechanics.md)

These documents are rationale, not added scope. This future phase is the place to turn research ideas into scoped calibration work after MVP.

## Research basis

- Historical validation should be time-of-day aware and avoid lookahead bias.
- Baselines for "unusual" should account for ticker, tenor bucket, regime, and event-day exclusions.
- Confidence, penalties, abstention, and alternatives need versioned policy outputs so calibration stays auditable.

## Deferred research ideas

- ML scoring, learned calibration, richer catalyst feeds, and large historical benchmark suites require separate future Beads scope.

## Dependencies on earlier phases

- `islandflow-zxh.5` - Smart-flow API/UI explainability
- `islandflow-259.6` - Future synthetic historical calibration

## Likely files/modules touched

- Future calibration tooling in `services/compute/` or a research package
- Policy/model version registry
- Evaluation reports or benchmark datasets
- Storage/query helpers for historical derived outputs
- Documentation for metrics and calibration governance

## In-scope work

- Define calibration datasets and evaluation metrics.
- Specify how confidence, conviction, penalties, abstention, and alternatives are tuned.
- Preserve policy/model versioning and replayability.
- Document what makes a calibration dataset acceptable.
- Keep user-facing confidence semantics auditable.

## Explicitly out-of-scope work

- MVP contracts and scoring foundations.
- API/UI explainability for the initial pipeline.
- Treating historical calibration as proof of participant identity.
- Using private or licensed data in committed fixtures without approval.

## Acceptance criteria

- Calibration remains outside the MVP blocker chain.
- Dataset provenance, metrics, and policy versioning are documented before implementation.
- Confidence and abstention semantics remain explainable after tuning.
- Replay can compare calibrated policy versions without losing auditability.

## Test strategy

When implemented, use replayed benchmark datasets with versioned policy outputs. Track false positives, abstentions, precision-like metrics, and scenario-specific regressions. Keep calibration tests separate from the early deterministic fixture tests.

## Risks / design traps

- Treating calibrated confidence as objective truth.
- Tuning to demos instead of representative market regimes.
- Losing policy version lineage.
- Committing restricted data or large generated benchmark artifacts.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/smart-money/99-future-calibration.md for Beads issue islandflow-zxh.6 only after the MVP smart-flow phases are complete. Define calibration datasets, metrics, policy versioning, and replay comparison. Do not make calibration a prerequisite for earlier evidence, scoring, or UI work.
```

## Matching Beads issue title/id

- `islandflow-zxh.6` - Future smart-flow phase 99: calibration
