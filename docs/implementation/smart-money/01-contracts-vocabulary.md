# Smart-Flow Phase 01: Contracts and Vocabulary

## Purpose

Introduce the domain vocabulary and contracts that distinguish observations, evidence clusters, hypotheses, confidence, abstention, and user-facing insight projections.

## Why this phase comes now

The current system has useful infrastructure but overconfident domain names. Before changing classifier behavior, the codebase needs the language to express what is observed, what is inferred, what is uncertain, and when the system should abstain.

## Source documents

- Architecture plan: [`docs/plans/smart-flow-architecture-review.md`](../../plans/smart-flow-architecture-review.md)
- Research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../../research-docs/smart-flow-market-mechanics.md)

These documents are rationale, not added scope. This phase implements only vocabulary, contracts, versioning, and compatibility notes.

## Research basis

- The research direction is direct observation to inference to hypothesis, with preserved evidence and visible uncertainty.
- "Smart money" should not be modeled as a canonical fact; user-facing insight should be a projection from evidence-backed hypotheses.
- Confidence, conviction, alternatives, and abstention need separate language before behavior changes.

## Deferred research ideas

- Participant identity claims and research-grade calibration stay outside the vocabulary foundation.

## Dependencies on earlier phases

- `islandflow-259.1` - Synthetic deterministic spine, so contract work can align with canonical raw event and provenance assumptions.

## Likely files/modules touched

- `packages/types/src/events.ts`
- Shared type exports in `packages/types/`
- Compatibility type aliases where legacy names are still needed
- Storage schema planning docs or migration notes
- Tests for schema parsing or event compatibility

## In-scope work

- Define or prepare contracts for `FlowEvidenceCluster`, `FlowCandidate`, `FlowHypothesisEvent`, `SmartFlowInsight`, `EvidenceQuality`, `BaselineSnapshot`, and version fields.
- Mark legacy "smart money" naming as compatibility or projection language, not canonical truth.
- Define how facts, evidence, hypotheses, scores, confidence, and abstention differ.
- Preserve compatibility aliases for existing API/UI paths where necessary.
- Add concise migration notes for future phases.

## Explicitly out-of-scope work

- Rewriting classifier scoring.
- Moving ingest policy.
- Adding new API endpoints or UI drawers.
- Building replay golden suites.
- Historical calibration or research-grade model fitting.

## Acceptance criteria

- Contracts distinguish observations, evidence, hypotheses, insight projections, confidence, alternatives, and abstention.
- Legacy naming remains only where compatibility requires it.
- Version fields are included for policy/model evolution.
- Future phases can refer to these contracts without redefining the vocabulary.
- Migration risk and compatibility aliases are documented.

## Test strategy

Use type-level checks and schema/serialization tests where practical. Add compatibility tests only for public contracts that must remain stable. Avoid broad behavior tests until evidence extraction and scoring phases exist.

## Risks / design traps

- Renaming everything without compatibility will break consumers.
- Keeping "smart money" as canonical language will preserve the old overconfidence.
- Mixing facts and hypotheses in one event shape will make replay evaluation weaker.
- Adding too many future fields can make contracts noisy before behavior exists.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/smart-money/01-contracts-vocabulary.md for Beads issue islandflow-zxh.1. Focus on contracts, vocabulary, version fields, and compatibility aliases only. Do not rewrite scoring, API/UI explainability, replay tests, or calibration.
```

## Matching Beads issue title/id

- `islandflow-zxh.1` - Smart-flow phase 01: contracts and vocabulary
