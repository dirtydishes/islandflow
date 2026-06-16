# Smart-Flow Phase 05: API/UI Explainability

## Purpose

Expose evidence-backed smart-flow outputs through API, websocket, and UI surfaces that make evidence quality, confidence, conviction, alternatives, and abstention understandable.

## Why this phase comes now

The presentation layer should wait until contracts, evidence, scoring, and replay evaluation are stable. Otherwise the UI will harden old overconfident language or teach users to trust unvalidated outputs.

## Source documents

- Architecture plan: [`docs/plans/smart-flow-architecture-review.md`](../../plans/smart-flow-architecture-review.md)
- Research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../../research-docs/smart-flow-market-mechanics.md)
- Research architecture review copy: [`docs/research-docs/smart-flow-architecture-review.md`](../../research-docs/smart-flow-architecture-review.md)

These documents are rationale, not added scope. This phase implements only API, websocket, and UI explainability surfaces for validated outputs.

## Research basis

- Users need to see evidence quality, confidence versus conviction, alternatives, and abstention instead of a single certainty label.
- The research supports cautious smart-flow insight projections, not canonical "smart money" facts.
- Why-not and penalty context are part of the product surface because false positives are central to the domain.

## Deferred research ideas

- Advanced explanatory analytics, learned confidence calibration, and broad catalyst intelligence should wait for future scoped work.

## Dependencies on earlier phases

- `islandflow-zxh.1` - Smart-flow contracts and vocabulary
- `islandflow-zxh.2` - Evidence clustering and features
- `islandflow-zxh.3` - Hypothesis scoring and abstention
- `islandflow-zxh.4` - Replay evaluation and golden tests
- `islandflow-259.5` - Synthetic demo and load profiles

## Likely files/modules touched

- `services/api/src/`
- Websocket payload types and channel names
- `apps/web/`
- Shared UI/domain types in `packages/types/`
- API and UI tests

## In-scope work

- Add or alias API/WS surfaces for evidence, hypotheses, insights, alternatives, and abstention.
- Keep legacy smart-money endpoints as aliases where needed, not canonical contracts.
- Rework UI surfaces around evidence quality, confidence versus conviction, alternatives, abstention, and why-not context.
- Ensure named deterministic demos can display stable explainability examples.
- Keep replay/golden validation tied to changed projections.

## Explicitly out-of-scope work

- Rewriting scoring policy.
- Adding new synthetic foundations.
- Historical calibration.
- Claiming participant identity.
- UI copy that implies certainty where the model only has evidence-backed hypotheses.

## Acceptance criteria

- API/WS payloads expose evidence refs, hypotheses, insights, alternatives, abstention reasons, and version fields.
- UI distinguishes evidence quality, confidence, conviction, and why-not signals.
- Legacy smart-money surfaces remain compatibility aliases where required.
- Replay/golden checks support changed projection behavior.
- Explainability copy avoids overconfident certainty claims.

## Test strategy

Use API contract tests, websocket payload tests, and focused UI tests for evidence/abstention rendering. Validate with deterministic demo runs from synthetic phase 05. Manual visual review should supplement, not replace, replay/golden validation.

## Risks / design traps

- UI can accidentally reintroduce "smart money" certainty.
- API aliases can become de facto canonical if not documented.
- Too many fields without hierarchy will make explainability harder to scan.
- Building UI before replay validation can make demos persuasive but untrustworthy.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/smart-money/05-api-ui-explainability.md for Beads issue islandflow-zxh.5. Use split issues islandflow-zxh.5.1 and islandflow-zxh.5.2 for PR-sized work. Expose evidence-backed API/WS/UI explainability after replay/golden validation. Do not change core scoring or add calibration.
```

## Matching Beads issue title/id

- `islandflow-zxh.5` - Smart-flow phase 05: API/UI explainability
- PR split: `islandflow-zxh.5.1` - Split smart-flow phase 05a: evidence API and websocket surfaces
- PR split: `islandflow-zxh.5.2` - Split smart-flow phase 05b: UI explainability surfaces
