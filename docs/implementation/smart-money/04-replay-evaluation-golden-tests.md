# Smart-Flow Phase 04: Replay Evaluation and Golden Tests

## Purpose

Make deterministic replay and golden output comparison the acceptance gate for smart-flow behavior changes.

## Why this phase comes now

Replay evaluation should come after synthetic replay can select stable runs and after hypothesis scoring has outputs worth validating. This phase turns architecture discipline into a repeatable test path.

## Dependencies on earlier phases

- `islandflow-zxh.1` - Smart-flow contracts and vocabulary
- `islandflow-zxh.2` - Evidence clustering and features
- `islandflow-zxh.3` - Hypothesis scoring and abstention
- `islandflow-259.4` - Synthetic replay integration

## Likely files/modules touched

- `services/replay/src/`
- `services/compute/tests/`
- Synthetic fixture and manifest comparison helpers
- Golden fixture directories
- Optional service-container integration config if added later

## In-scope work

- Recompute derived evidence/hypothesis outputs from raw synthetic streams.
- Compare stable output signatures with expected manifests.
- Include positive, abstention, false-positive, and noisy scenarios.
- Make replay/golden tests deterministic and infra-free by default.
- Gate optional ClickHouse/NATS/Redis tests outside the default path.

## Explicitly out-of-scope work

- New scoring policy beyond fixes needed for deterministic evaluation.
- UI explainability.
- Historical calibration.
- Large generated fixture dumps.
- Making Docker-backed tests mandatory.

## Acceptance criteria

- Replay recomputes derived smart-flow outputs from raw fixtures.
- Golden signatures cover positive, abstain, false-positive, and noisy scenarios.
- Default tests are deterministic and infra-free.
- Optional service-backed tests are clearly gated.
- Failures show concise, reviewable diffs or signature mismatches.

## Test strategy

Use fixture-backed replay and compact golden signatures first. Add a small number of representative scenarios rather than broad generated dumps. If service-backed tests are added, mark them optional and document their dependencies.

## Risks / design traps

- Golden files that are too large will become rubber-stamped.
- Full payload comparisons may break on harmless metadata changes.
- Optional infra tests can accidentally become required in CI.
- Replay that starts from derived events instead of raw fixtures will miss pipeline regressions.

## Suggested future Codex implementation prompt

```text
Implement docs/implementation/smart-money/04-replay-evaluation-golden-tests.md for Beads issue islandflow-zxh.4. Build deterministic replay/golden validation from raw synthetic fixtures. Keep default tests infra-free, compare stable signatures, and do not add UI explainability or historical calibration.
```

## Matching Beads issue title/id

- `islandflow-zxh.4` - Smart-flow phase 04: replay evaluation and golden tests
