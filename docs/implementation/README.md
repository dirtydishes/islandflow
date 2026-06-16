# Implementation Phase Plans

This directory is the active planning layer for the synthetic market-data and smart-money/smart-flow architecture work.

The architecture reviews in `docs/plans/` are background guidance. Future implementation work should use the current phase document and matching Beads issue as the active scope. If a phase document and an older architecture review disagree, pause and update the phase document or Beads issue before writing code.

## Source Plans

- `docs/plans/synthetic-market-data-architecture-review.md`
- `docs/plans/smart-flow-architecture-review.md`

## Planning Rules

- Prefer small, reviewable PRs.
- Do not implement an entire architecture plan at once.
- Use Beads issues for execution tracking and dependency management.
- Keep durable architecture and phase detail in these docs, not in long Beads descriptions.
- Synthetic data must emit canonical market event types, not synthetic-only pipeline event types.
- Synthetic labels must remain separate from emitted market events.
- Smart-flow logic must distinguish facts, evidence, hypotheses, confidence, and abstention.
- Historical calibration is future work, not an MVP dependency.
- Early synthetic tests must not require Docker, ClickHouse, NATS, or Redis.
- Synthetic foundations should come before demos, UI controls, or live service work.

## Beads Map

| Stream | Epic | Roadmap |
| --- | --- | --- |
| Synthetic market data | `islandflow-259` - Plan synthetic market-data implementation phases | `docs/implementation/synthetic-market-data/00-roadmap.md` |
| Smart money / smart flow | `islandflow-zxh` - Plan smart-money to smart-flow implementation phases | `docs/implementation/smart-money/00-roadmap.md` |

## Dependency Order

This is the intended MVP ordering. Future calibration phases sit after the MVP chain and should not block it.

| Order | Phase | Beads issue | Blocks next because |
| ---: | --- | --- | --- |
| 1 | Synthetic deterministic spine | `islandflow-259.1` | The smart-flow vocabulary needs stable raw event/provenance assumptions. |
| 2 | Smart-flow contracts and vocabulary | `islandflow-zxh.1` | Synthetic manifests should target the eventual evidence/hypothesis language. |
| 3 | Synthetic manifests, fixtures, and CLI | `islandflow-259.2` | Evidence clustering needs deterministic fixtures before broad behavior changes. |
| 4 | Smart-flow evidence clustering and features | `islandflow-zxh.2` | Scenario labels need the evidence vocabulary they are expected to exercise. |
| 5 | Synthetic scenarios, labels, and expected outputs | `islandflow-259.3` | Hypothesis scoring needs labeled positive, negative, and abstention cases. |
| 6 | Smart-flow hypothesis scoring and abstention | `islandflow-zxh.3` | Synthetic replay integration should validate the derived hypothesis pipeline. |
| 7 | Synthetic replay integration | `islandflow-259.4` | Smart-flow golden tests need replayable synthetic runs. |
| 8 | Smart-flow replay evaluation and golden tests | `islandflow-zxh.4` | Demos should wait until replay proves the semantics. |
| 9 | Synthetic demo and load profiles | `islandflow-259.5` | API/UI explainability should show stable, named, deterministic runs. |
| 10 | Smart-flow API/UI explainability | `islandflow-zxh.5` | This is the final MVP presentation layer after the evidence pipeline is validated. |

## Future Work

| Future phase | Beads issue | Notes |
| --- | --- | --- |
| Synthetic historical calibration | `islandflow-259.6` | Depends on synthetic phase 05, but is not required for MVP. |
| Smart-flow calibration | `islandflow-zxh.6` | Depends on smart-flow phase 05 and synthetic future calibration, but is not required for MVP. |

## Existing Related Issue

`islandflow-9dz` already tracks tuning synthetic smart-money scenario coverage. It is narrower than these phase plans and was already in progress before this split. Treat it as related context for `docs/implementation/synthetic-market-data/03-scenarios-labels-expected-outputs.md`, not as the phase-level tracker.
