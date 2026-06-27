# Phase 05: More-Info Triage Workspace

Canonical Beads issue: `islandflow-j06e.5`

Epic: `islandflow-j06e`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Build the separate more-info investigation state for smart-flow-supported rows: a dense, operational triage workspace with packet, hypothesis, alternatives, evidence, member prints, and exact-contract context loaded on user intent.

## Scope

Allowed:

- Rows with smart-flow support expose a more-info icon.
- Activating more-info opens a dense TUI-style triage state inside the reusable module or an explicit detail surface chosen during implementation.
- Show packet summary when packet context exists.
- Show hypothesis type, direction, confidence, conviction if available, alternatives, penalties, and abstention or why-not context.
- Show packet member prints and exact-contract context with paginated server-composed rows.
- Load evidence and detail only on user intent.
- Add keyboard, focus, reduced-motion, responsive, and data-loading tests.

Out of scope:

- Changing smart-flow scoring or calibration.
- Alert UI migration.
- Replay redesign.
- Making the triage workspace the default tape view.
- Loading unbounded evidence or member rows into the browser.

## Inputs

- Phase 01 support resolver.
- Phase 03 packet and contract scope behavior.
- Phase 04 help/settings affordances.
- `docs/implementation/smart-money/05-api-ui-explainability.md`
- `docs/implementation/smart-flow-alerts/04-alerts-ui-migration.md`
- `apps/web/features/options-tape/`
- API explainability/detail endpoints.

## Implementation Notes

- This phase answers why the system interpreted the packet or print the way it did. It is distinct from packet scope, which answers which prints are in the packet.
- Use compact, stable table-first layout. Avoid marketing-style cards or decorative panels.
- Detail payloads should be summary-first and paginated. Full raw evidence should be requested only when the user asks for deeper detail.
- The workspace should preserve a clear exit back to packet scope or the prior tape scope.
- If API explainability is insufficient, file a Beads follow-up instead of inventing client-side inference.

## Beads

- Epic: `islandflow-j06e`
- Issue: `islandflow-j06e.5`
- Depends on: `islandflow-j06e.4`
- Parallel-safe: No. This phase depends on stable packet scope and module controls.

## Expected Files Or Areas

- `apps/web/features/options-tape/`
- Detail drawer or module detail-surface files if present.
- `services/api/src/index.ts`
- Smart-flow explainability projection and detail endpoint files.
- Tests near options tape and API detail payloads.

## Suggested Swarms

- Explainability API scout: available projection/detail fields.
- UI structure scout: existing detail surfaces, drawers, and dense module patterns.
- Performance scout: detail payload bounds and pagination.
- Accessibility scout: keyboard, focus, reduced-motion, and responsive triage behavior.
- Review scout: duplicate inference risks and wrong-layer logic.

## Quality Gates

```bash
bun test apps/web/features/options-tape
bun test services/api/tests
bun --cwd=apps/web run build
```

Browser verification should cover opening, navigating, and closing more-info at desktop and mobile widths, including slow or unavailable detail data.

## Completion Criteria

- More-info appears only where meaningful support/detail context exists.
- Triage workspace loads detail on intent, not on every row.
- Packet, hypothesis, alternatives, evidence summary, member prints, and exact-contract context are represented where API data exists.
- Large detail sets remain paginated or scroll-bounded.
- No client-side smart-flow inference is introduced.
- The phase turn doc records implementation, review, CI/gates, Beads updates, and any follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for missing API explainability fields, calibration, alert integration, or replay redesign.
