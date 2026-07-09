# Phase 08: Deterministic Drawer Browser Fixture

Canonical Beads issue: `islandflow-mcmd.8`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Add a deterministic browser verification fixture or harness for Market Command drawer interactions so browser QA can exercise detail paths without depending on the deployment-host live API or sockets.

## Scope

Allowed:

- Add a deterministic browser fixture, harness, or test support path that seeds Market Command data for `/`.
- Seed durable alert rows, news stories, option rows, flow packets, smart-flow markers, and inferred-dark markers.
- Verify durable alert row, news row, smart-flow marker, inferred-dark marker, option row, and flow packet interactions.
- Verify drawer open and close behavior.
- Verify no page-level horizontal overflow during the seeded browser probe.
- Keep the fixture clearly test-only or development-only.
- Add focused tests or scripts needed to make the browser probe repeatable.

Out of scope:

- Production ranking policy changes.
- New product surfaces.
- New websocket channels.
- Broad dashboard redesign.
- Replacing the existing live API integration.

## Inputs

- `docs/implementation/market-command-dashboard/05-hybrid-detail-model.md`
- `docs/implementation/market-command-dashboard/07-polish-performance-visual-qa.md`
- `apps/web/features/market-command/`
- Existing Phase 07 browser QA evidence and temporary fixture notes.

## Implementation Notes

- The fixture should make drawer interaction evidence repeatable when the live API is unavailable.
- Prefer a narrow browser-test harness over production code paths that alter live behavior.
- Any seeded data path must be explicit and must not mask real endpoint failures in normal dashboard use.
- Use existing Market Command components and state contracts where possible.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.8`
- Discovered from: `islandflow-mcmd.5`
- Parallel-safe: No. This follows final dashboard completion.

## Expected Files Or Areas

- `apps/web/features/market-command/`
- Browser QA scripts or fixtures if the repo has a local convention.
- `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.8.md`

## Suggested Swarms

- Fixture scout: identify the narrowest existing route, mock, or test harness hook for seeded dashboard data.
- Browser automation scout: map the click targets and assertions for all required drawer paths.
- Safety scout: verify seeded fixture behavior cannot affect production dashboard behavior.

## Quality Gates

```bash
bun test apps/web
bun --cwd=apps/web run build
```

Browser verification must use real Chromium and prove the seeded fixture can open `/`, click durable alert rows, news rows, smart-flow markers, inferred-dark markers, option rows, and flow packet rows, verify drawer close behavior, and verify no horizontal overflow.

## Completion Criteria

- A deterministic browser probe can exercise all required drawer interactions without relying on the production-like live API.
- The probe verifies drawer close behavior.
- The probe verifies no page-level horizontal overflow.
- Normal dashboard fallback behavior remains visible when the real endpoint is unavailable.
- Phase turn doc records implementation, review, CI/gates, browser evidence, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for broader browser automation infrastructure, richer synthetic market-data fixtures, or future dashboard interactions.
