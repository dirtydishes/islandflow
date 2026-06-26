# Phase 06: Legacy Deletion And History Drop

## Intent

Finish the migration by deleting legacy smart-money, classifier-hit, and legacy-alert paths. Old derived history is intentionally dropped instead of backfilled.

## Required Work

- Delete legacy emitters for:
  - `SmartMoneyEvent`
  - `ClassifierHitEvent`
  - legacy `AlertEvent`
- Delete old bus subjects, streams, live channels, API routes, WS paths, replay paths, and history paths for those legacy derived event types.
- Delete or retire legacy storage helpers and ClickHouse tables for smart-money events, classifier hits, and legacy alerts.
- Remove UI state, drawers, support hydration payload fields, and compatibility fallbacks that exist only for legacy smart-money/classifier/alert data.
- Remove transition aliases from Phase 05.
- Update documentation and tests to name canonical smart-flow and smart-flow alerts only.
- Add a final grep/import audit that fails the phase if normal runtime code still imports legacy event types.

## Architecture Constraints

- Do not delete raw market data, flow packets, canonical smart-flow projections, or canonical smart-flow-alert history.
- Do not preserve legacy derived history through hidden compatibility endpoints.
- Rollback after this phase is deployment rollback or raw replay, not old derived tables.
- Keep any debug-only exception out of normal product code and track it as a separate Beads issue before final deletion.

## Acceptance Criteria

- No public/runtime code emits, stores, fetches, subscribes to, or renders legacy smart-money, classifier-hit, or legacy-alert events.
- Old derived history is not available through product/API surfaces after cutover.
- Canonical smart-flow and smart-flow-alert history still work.
- Tests and grep audits prove legacy runtime imports are gone.
- Docs describe the final pipeline as observations -> evidence clusters -> hypotheses -> insights -> hypothesis alerts.
- Final browser QA confirms alert-bearing surfaces still populate through canonical paths.

## Suggested Checks

```bash
bd show islandflow-ghce.6
bun test
bun --cwd=apps/web run build
rg "SmartMoneyEvent|ClassifierHitEvent|AlertEvent|smart-money|classifier-hits|/flow/alerts|/history/alerts|/ws/alerts" packages services apps/web
```

Expected grep results should be limited to migration docs, historical release notes, or deliberately non-runtime references.

## Out Of Scope

- Historical calibration.
- Backfilling old derived history.
- Rebuilding raw market data ingestion.

## Suggested Future Codex Implementation Prompt

```text
Implement docs/implementation/smart-flow-alerts/06-legacy-deletion-history-drop.md for Beads issue islandflow-ghce.6. Delete legacy smart-money, classifier-hit, and legacy-alert emit/storage/API/WS/UI paths, drop old derived history without backfill, and prove canonical smart-flow plus smart-flow-alert history still works. Reviewer owns CI through green before callback.
```
