# Phase 05: Consumer Cutover

## Intent

Move normal product consumers to canonical smart-flow and smart-flow-alert surfaces, leaving legacy paths unused by public runtime UI.

## Required Work

- Update route feature manifests and live subscriptions to use `smart-flow` and `smart-flow-alerts`.
- Remove normal UI subscriptions to:
  - `smart-money`
  - `classifier-hits`
  - legacy `alerts`
- Update terminal, durable-tapes, dashboard, and chart-facing consumers that still read legacy smart-money, classifier hits, or legacy alerts.
- Replace legacy fallback behavior with explicit missing-canonical-data empty states or diagnostics.
- Keep temporary old route aliases only if required for transition, and make them return canonical payloads or clearly documented deprecation responses.
- Add search/deletion inventory checks for remaining imports and subscriptions.

## Architecture Constraints

- Do not keep smart-money or classifier-hit endpoints as indefinite aliases.
- Do not let chart marker or row-tint fallback silently prefer legacy data.
- Keep old derived history unavailable through normal product surfaces after cutover.
- File focused follow-up issues for any debug-only tooling that truly needs old data before Phase 06.

## Acceptance Criteria

- Public product routes no longer subscribe to legacy `smart-money`, `classifier-hits`, or legacy `alerts`.
- Terminal and durable-tapes surfaces render smart-flow alerts from canonical live/history paths.
- Chart marker and lower-pane behavior use canonical smart-flow only.
- No normal UI imports of legacy smart-money/classifier/alert event types remain.
- Temporary aliases are explicitly documented as transition-only and are not schema compatibility promises.
- Browser QA verifies `/durable-tapes` and alert-bearing terminal surfaces with canonical feeds.

## Suggested Checks

```bash
bd show islandflow-ghce.5
bun test apps/web/app/terminal.test.ts apps/web/features/terminal
bun test apps/web/features/alerts apps/web/features/options-tape apps/web/features/market-chart
bun test services/api/tests
bun --cwd=apps/web run build
```

## Out Of Scope

- Dropping ClickHouse tables.
- Deleting every legacy storage helper.
- Removing transition aliases before Phase 06.

## Suggested Future Codex Implementation Prompt

```text
Implement docs/implementation/smart-flow-alerts/05-consumer-cutover.md for Beads issue islandflow-ghce.5. Move normal UI/API consumers to canonical smart-flow and smart-flow-alerts, remove runtime subscriptions to smart-money/classifier-hits/legacy alerts, and leave only explicitly transition-only aliases for Phase 06 deletion.
```
