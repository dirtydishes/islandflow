# Phase 03: Derived Hypothesis Alerts

## Intent

Add canonical smart-flow alert contracts and delivery surfaces. A smart-flow alert is a derived triage event from a non-abstained smart-flow projection.

## Required Work

- Add a canonical `SmartFlowAlertEvent` contract under smart-flow types, preferably in `packages/types/src/smart-flow-alerts.ts` and exported from `packages/types/src/index.ts`.
- Include these fields at minimum:
  - event metadata
  - `schema_version`
  - `alert_id`
  - `hypothesis_id`
  - `insight_id`
  - `underlying_id`
  - `hypothesis_type`
  - `direction`
  - `policy_confidence`
  - `evidence_quality`
  - `trigger.kind = "non_abstained_hypothesis"`
  - `projection`
  - `evidence_refs`
- Do not include legacy `score`, `severity`, or classifier `hits`.
- Add a canonical subject, stream, live channel, and API surfaces:
  - `flow.smart_flow_alerts`
  - `SMART_FLOW_ALERTS`
  - `smart-flow-alerts`
  - `/flow/smart-flow-alerts`
  - `/history/smart-flow-alerts`
  - `/replay/smart-flow-alerts`
  - `/ws/smart-flow-alerts`
- Derive alerts only when `projection.abstention.abstained === false`.
- Persist smart-flow alerts and add live-cache support.

## Architecture Constraints

- Alert derivation must be a projection from smart-flow, not a second classifier.
- Alert priority is visual and UI-derived from shared smart-flow tint metadata, not a stored legacy score.
- Keep abstentions out of alert emission. Abstentions remain smart-flow explainability and why-not context.
- Do not flip UI consumers in this phase.
- Do not delete old alert routes yet.

## Acceptance Criteria

- `SmartFlowAlertEvent` schema rejects legacy score/severity/hits-shaped payloads.
- Non-abstained smart-flow projections emit smart-flow alerts.
- Abstained projections do not emit smart-flow alerts.
- API/history/replay/WS/live surfaces return smart-flow alert payloads.
- Live-cache limits and cursors work the same way as other live channels.
- Tests cover positive, abstained, and malformed legacy payload cases.

## Suggested Checks

```bash
bd show islandflow-ghce.3
bun test packages/types
bun test services/compute/tests
bun test services/api/tests/live.test.ts services/api/tests/smart-flow.test.ts
```

## Out Of Scope

- UI migration.
- Legacy route deletion.
- Backfilling legacy derived alert history.
- Historical calibration.

## Suggested Future Codex Implementation Prompt

```text
Implement docs/implementation/smart-flow-alerts/03-derived-hypothesis-alerts.md for Beads issue islandflow-ghce.3. Add SmartFlowAlertEvent contracts and smart-flow-alerts storage/API/WS/live support derived only from non-abstained smart-flow projections. Do not migrate AlertsModule or delete legacy paths in this phase.
```
