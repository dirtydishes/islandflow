# Smart-Flow Phase 03: Hypothesis Scoring and Abstention

## Purpose

Convert evidence clusters into cautious flow hypotheses with explicit score vectors, alternatives, penalties, confidence, conviction, and abstention reasons.

## Why this phase comes now

Scoring should wait until the system can represent evidence clearly and synthetic scenarios can describe expected positive, negative, and abstention cases. This phase is where the product stops acting like every signal is a confident "smart money" claim.

## Source documents

- Architecture plan: [`docs/plans/smart-flow-architecture-review.md`](../../plans/smart-flow-architecture-review.md)
- Research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../../research-docs/smart-flow-market-mechanics.md)

These documents are rationale, not added scope. This phase implements only cautious hypothesis scoring, alternatives, penalties, and abstention.

## Research basis

- Premium concentration, sweep-like activity, IV movement, and equity confirmation support hypotheses only when evidence quality and context agree.
- False positives from deep-ITM stock replacement, spreads/hedges, stale quotes, and event-driven flow need explicit penalties or abstention.
- Confidence should reflect policy confidence in the evidence, not a claim of hidden participant identity.

## Deferred research ideas

- Empirical threshold tuning, historical calibration, and ML-based scoring stay future work until replay/golden validation exists.

## Dependencies on earlier phases

- `islandflow-zxh.1` - Smart-flow contracts and vocabulary
- `islandflow-zxh.2` - Evidence clustering and features
- `islandflow-259.3` - Synthetic scenarios, labels, and expected outputs

## Likely files/modules touched

- `services/compute/src/`
- `packages/types/src/events.ts`
- `packages/storage/src/smart-money-events.ts` or successor storage modules
- Compute tests and fixture/golden comparison helpers
- Compatibility projection code for legacy alerts or classifier hits

## In-scope work

- Define score vectors for hypothesis type, direction, evidence strength, confidence, conviction, and penalties.
- Preserve alternative explanations and negative evidence.
- Make abstention a first-class output with reasons.
- Add policy/model version fields.
- Derive compatibility `SmartFlowInsight` or legacy projections from canonical hypothesis events.

## Explicitly out-of-scope work

- UI presentation overhaul.
- API endpoint expansion.
- Historical calibration.
- Participant identity claims.
- Tuning all thresholds against live historical data.

## Acceptance criteria

- Hypothesis scores separate evidence strength, confidence, conviction, and penalties.
- Abstention outputs include machine-readable and user-readable reasons.
- Alternative explanations are preserved.
- Compatibility projections do not become the canonical domain model.
- Score policy changes are deterministic against synthetic fixtures.

## Test strategy

Use synthetic scenario fixtures and expected-output manifests. Cover positive hypotheses, abstentions, false-positive suppressions, alternative explanations, and noisy scenarios. Keep output comparisons stable and focused on score signatures rather than brittle full payload dumps.

## Risks / design traps

- Rebranding old classifier hits as hypotheses without changing semantics.
- Treating confidence as probability when it is only policy confidence.
- Hiding abstention in logs instead of output events.
- Letting compatibility alert projections dictate canonical scoring design.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/smart-money/03-hypothesis-scoring-abstention.md for Beads issue islandflow-zxh.3. Use split issues islandflow-zxh.3.1 and islandflow-zxh.3.2 for PR-sized work. Build cautious hypothesis scoring, alternatives, and abstention from evidence clusters. Do not add API/UI explainability or historical calibration.
```

## Matching Beads issue title/id

- `islandflow-zxh.3` - Smart-flow phase 03: hypothesis scoring and abstention
- PR split: `islandflow-zxh.3.1` - Split smart-flow phase 03a: hypothesis score vectors
- PR split: `islandflow-zxh.3.2` - Split smart-flow phase 03b: abstention and insight projection
