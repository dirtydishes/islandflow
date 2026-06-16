# Smart-Flow Phase 02: Evidence Clustering and Features

## Purpose

Make evidence extraction, eligibility, quote/context joins, clustering, and feature construction explicit and traceable before hypothesis scoring changes.

## Why this phase comes now

Contracts alone do not change behavior. This phase gives the system a clean evidence layer so later scoring can reason from auditable facts instead of a generic feature bag or overconfident classifier labels.

## Source documents

- Architecture plan: [`docs/plans/smart-flow-architecture-review.md`](../../plans/smart-flow-architecture-review.md)
- Research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../../research-docs/smart-flow-market-mechanics.md)

These documents are rationale, not added scope. This phase implements only eligibility, evidence facts, clustering, and traceable features.

## Research basis

- Trade signing, quote context, sale conditions, stale quotes, wide markets, and event context all affect whether a print is usable evidence.
- Evidence should preserve raw refs, eligibility decisions, quality signals, and negative context before any hypothesis is scored.
- Ingest should normalize observations; signal policy belongs in explicit evidence/scoring stages.

## Deferred research ideas

- Full IV-surface modeling, broad news/FDA event feeds, and deep historical baselines can be added later when scoped.

## Dependencies on earlier phases

- `islandflow-zxh.1` - Smart-flow contracts and vocabulary
- `islandflow-259.2` - Synthetic manifests, fixtures, and CLI

## Likely files/modules touched

- `services/compute/src/`
- `packages/types/src/events.ts`
- `packages/storage/src/` for typed evidence storage planning or implementation
- Tests under `services/compute/tests/`
- Fixture helpers from the synthetic package

## In-scope work

- Represent direct observations, quote joins, execution context, and eligibility decisions as evidence facts.
- Build deterministic evidence clusters with traceable source refs.
- Compute feature vectors from evidence while preserving whether a value is observed, derived, or inferred.
- Carry evidence quality, stale quote, wide spread, odd lot, complex spread, and noisy context signals.
- Move toward ingest-as-normalization, not ingest-as-signal-policy.

## Explicitly out-of-scope work

- Final hypothesis score policy.
- API and UI explainability.
- Historical calibration.
- Claiming participant identity.
- Replacing all storage tables in the same PR.

## Acceptance criteria

- Eligibility decisions have explicit accept, reject, or down-weight reasons.
- Evidence clusters have deterministic keys/windows and preserve raw refs.
- Feature values trace back to evidence refs.
- Stale, wide, noisy, or ambiguous conditions can be represented without pretending to know intent.
- The phase is split into PR-sized children when implementation starts.

## Test strategy

Use deterministic fixtures from synthetic phase 02 where available. Add focused tests for quote joining, eligibility rejection, cluster key stability, feature derivation, and trace refs. Keep tests infra-free unless a later optional storage integration explicitly needs services.

## Risks / design traps

- Recreating the old `FlowPacket` as a renamed generic feature bag.
- Letting ingest services make signal-policy decisions.
- Losing evidence refs during aggregation.
- Treating cluster features as hypotheses before the scoring phase.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/smart-money/02-evidence-clustering-features.md for Beads issue islandflow-zxh.2. Use split issues islandflow-zxh.2.1 and islandflow-zxh.2.2 for PR-sized work. Focus on evidence facts, eligibility, clustering, and traceable features. Do not implement final scoring, API/UI explainability, or calibration.
```

## Matching Beads issue title/id

- `islandflow-zxh.2` - Smart-flow phase 02: evidence clustering and features
- PR split: `islandflow-zxh.2.1` - Split smart-flow phase 02a: eligibility and evidence facts
- PR split: `islandflow-zxh.2.2` - Split smart-flow phase 02b: clustering and feature vectors
