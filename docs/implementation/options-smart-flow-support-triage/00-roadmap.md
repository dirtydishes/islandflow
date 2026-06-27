# Options Smart-Flow Support And Triage Roadmap

Canonical tracker: Beads epic `islandflow-j06e`

Workflow: `orchestrator-callback`

## Plan Source

Recovered planning conversation from 2026-06-27, aligned against the existing durable tapes, options tape, and smart-flow row tinting implementation docs.

## Outcome

Options rows should carry real, compact smart-flow support whenever the canonical pipeline can link a row to a non-abstained projection. The browser should render that support cheaply through existing virtual table paths. Packet scope, contract scope, diagnostics, settings, and the later triage workspace should build on the same server-composed row model.

## Phase Sequence

1. `islandflow-j06e.1` - Server-side smart-flow support resolver.
2. `islandflow-j06e.2` - Row support rendering and tint parity.
3. `islandflow-j06e.3` - Packet and contract scope interactions.
4. `islandflow-j06e.4` - QA diagnostics and module settings.
5. `islandflow-j06e.5` - More-info triage workspace.

## Dependencies

The phases are serial. Resolver semantics must land before frontend parity, frontend support parity must land before packet scope, packet scope must land before QA/settings polish, and the richer triage workspace should wait until packet and settings behavior is stable.

The orchestrator selects one phase from Beads, creates a visible implementation thread for that phase, waits for the implementation callback, creates a visible review thread, waits for review and CI callback, then updates Beads and loop state before selecting the next phase.

The closed row-tinting stream remains predecessor context:

- `docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md`
- `islandflow-xcdn`

## Risks

- Request storms if support lookup becomes per-row or per-render.
- Browser slowdown if the frontend reconstructs packet/projection/evidence relationships.
- Oversized row payloads if packet detail or evidence arrays are shipped on every row.
- False confidence if `/qa` fabricates healthy support instead of exposing real unavailable states.
- Scope creep into smart-flow scoring, calibration, replay, or broad dashboard redesign.
- Settings and column rearrangement can become a layout project if not kept to the reusable module contract.

## Quality Gates

Common gates:

```bash
bun test services/api/tests
bun test apps/web/features/terminal/hydration-scheduler.test.ts apps/web/features/options-tape
bun test apps/web/features/durable-tape apps/web/features/options-tape
bun --cwd=apps/web run build
```

Use browser verification for user-facing UI phases. Use focused API/storage tests for resolver and pagination phases. Full `bun test` is desirable when shared contracts or storage behavior changes.

## Closeout

The final closeout artifact is:

`docs/implementation/options-smart-flow-support-triage/storyboard-post-run-06-27-2026.html`

Closeout must verify all Beads phase issues are closed, every phase has a Markdown turn doc, and storyboard diffs use `@pierre/diffs/ssr`.
