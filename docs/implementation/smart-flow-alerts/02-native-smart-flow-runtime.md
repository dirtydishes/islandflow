# Phase 02: Native Smart-Flow Runtime

## Intent

Make runtime smart-flow outputs canonical. The API/live smart-flow path should read persisted native smart-flow projections rather than projecting legacy `SmartMoneyEvent` rows.

## Required Work

- Add a canonical runtime subject and stream for smart-flow projections, for example `flow.smart_flow` and `SMART_FLOW`.
- Persist `SmartFlowExplainabilityProjection` as the canonical runtime read model. It already contains the nested hypothesis, insight, evidence, alternatives, penalties, and abstention state.
- Wire compute from `FlowPacket` through existing evidence, clustering, and scoring modules into smart-flow projection publish/persist.
- Update API smart-flow fetchers to read canonical smart-flow storage instead of `fetchRecentSmartMoneyEvents(...)`.
- Update live-cache ingestion so `smart-flow` receives canonical projections directly.
- Keep legacy smart-money, classifier-hit, and legacy-alert emitters temporarily in this phase only for comparison and rollback.
- Add diagnostic counters for native smart-flow projections emitted and abstained.

## Architecture Constraints

- Do not add a second hypothesis scoring policy for alerts.
- Do not rebrand legacy smart-money rows as native smart-flow.
- Do not make API smart-flow projection depend on `SmartMoneyEvent` after this phase.
- Keep the smart-flow module deep: callers should not orchestrate evidence, clusters, scoring, insight projection, and storage one step at a time.
- Preserve replay/golden semantics as the acceptance gate for behavior changes.

## Acceptance Criteria

- `/flow/smart-flow`, `/history/smart-flow`, `/replay/smart-flow`, `/ws/smart-flow`, and live `smart-flow` snapshots use native canonical smart-flow rows.
- Legacy smart-money projection remains available only as temporary compatibility or comparison logic.
- Tests prove native smart-flow fetchers do not require smart-money storage rows.
- Replay/golden signatures still cover positive, noisy, false-positive, and abstention cases.
- Runtime counters expose native smart-flow projection volume and abstention counts.

## Suggested Checks

```bash
bd show islandflow-ghce.2
bun test services/compute/tests/smart-flow-evidence.test.ts services/compute/tests/smart-flow-clusters.test.ts services/compute/tests/smart-flow-scoring.test.ts
bun test services/compute/tests/smart-flow-replay-evaluation.test.ts
bun test services/api/tests/smart-flow.test.ts services/api/tests/live.test.ts
```

## Out Of Scope

- Adding smart-flow alert surfaces.
- Migrating `AlertsModule`.
- Deleting legacy paths.
- Historical calibration.

## Suggested Future Codex Implementation Prompt

```text
Implement docs/implementation/smart-flow-alerts/02-native-smart-flow-runtime.md for Beads issue islandflow-ghce.2. Wire compute and API/live storage to native SmartFlowExplainabilityProjection rows instead of projecting from SmartMoneyEvent. Keep legacy emitters temporarily for comparison and rollback, but do not add alert contracts or delete legacy paths in this phase.
```
