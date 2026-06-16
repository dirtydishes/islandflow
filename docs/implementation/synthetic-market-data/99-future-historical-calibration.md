# Synthetic Market-Data Phase 99: Future Historical Calibration

## Purpose

Plan future calibration of synthetic generator parameters from historical market data without making historical data a dependency for the MVP generator.

## Why this phase comes now

It is useful to name the future work now so early designs keep calibration hooks in mind. It should not come before deterministic generation, manifests, scenarios, replay, or demo profiles.

## Source documents

- Architecture plan: [`docs/plans/synthetic-market-data-architecture-review.md`](../../plans/synthetic-market-data-architecture-review.md)
- Research report: [`docs/research-docs/synthetic-market-data-generation.md`](../../research-docs/synthetic-market-data-generation.md)

These documents are rationale, not added scope. This future phase is the place to turn research ideas into scoped calibration work after MVP.

## Research basis

- Once historical data exists, calibration should fit arrival curves, spread states, size mixtures, venue shares, and options-chain activity weights.
- Replay-plus-mutation can improve realism while preserving deterministic test intent.
- Calibration should layer onto the deterministic engine rather than replace it wholesale.

## Deferred research ideas

- Generative ML, learned LOB simulators, and agent-based models remain later research tracks unless a future Beads issue scopes them explicitly.

## Dependencies on earlier phases

- `islandflow-259.5` - Synthetic demo and load profiles

## Likely files/modules touched

- Future calibration tools under the synthetic package
- Historical data import or sampling utilities
- Parameter fitting scripts
- Documentation for data provenance and licensing constraints
- Optional research notebooks or reports if the repo later adopts them

## In-scope work

- Define calibration datasets and constraints.
- Specify how historical distributions map to `ParameterSnapshot`, liquidity, volatility, and option-chain profiles.
- Preserve deterministic replay from calibrated parameters.
- Document privacy, licensing, and provenance requirements for historical data.

## Explicitly out-of-scope work

- MVP synthetic generator requirements.
- Early tests and fixture generation.
- Live synthetic demos.
- Smart-flow scoring changes.
- Any assumption that historical data is needed to start implementation.

## Acceptance criteria

- Historical calibration remains outside the MVP blocker chain.
- Calibration inputs and ownership constraints are documented before implementation.
- Fitted parameters can still be pinned into deterministic seed/profile bundles.
- Calibration does not require emitted synthetic events to diverge from canonical market event contracts.

## Test strategy

When this future phase is implemented, use small public or licensed calibration samples with deterministic parameter fitting tests. Add regression checks that calibrated profiles still produce stable manifests. Do not retrofit historical data into earlier infra-free tests.

## Risks / design traps

- Treating calibration as necessary for MVP will delay foundational work.
- Historical data licensing can constrain what can be committed or shared.
- Overfitting synthetic profiles to a tiny period can produce misleading demos.
- Calibration tools can accidentally leak proprietary or sensitive data into fixtures.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/synthetic-market-data/99-future-historical-calibration.md for Beads issue islandflow-259.6 only after MVP synthetic phases are complete. Keep calibration optional, documented, and deterministic. Do not make historical data a dependency for earlier synthetic tests or demos.
```

## Matching Beads issue title/id

- `islandflow-259.6` - Future synthetic market-data phase 99: historical calibration
