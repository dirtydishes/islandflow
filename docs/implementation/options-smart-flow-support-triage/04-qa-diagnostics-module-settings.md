# Phase 04: QA Diagnostics And Module Settings

Canonical Beads issue: `islandflow-miqb.4`

Epic: `islandflow-miqb`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Expose real diagnostics and reusable options module settings without turning QA-only support state into default product UI.

## Scope

Allowed:

- `/qa` can show a clearer diagnostic support-state column.
- Default product modules should not show a `SUPPORT` column.
- Add a `?` help affordance explaining color-coding, non-abstained tinting, packet scope, and triage basics.
- Add a gear settings surface for common options tape filters.
- Include smart-flow only filtering.
- Include ETF on/off or security type filtering where supported by the current data model.
- Include side/rating-style filters such as AA only, A only, BB, B, ask/mid/bid presets if supported by row fields.
- Include column visibility controls and drag/drop or keyboard-accessible reordering.
- If setting changes require reloading data, show an apply action with refresh affordance.
- Add tests for settings serialization, reset, persistence if present, and responsive layout.

Out of scope:

- Fabricating healthy QA support.
- More-info triage workspace.
- Rewriting all module chrome.
- New scoring or calibration behavior.
- Unbounded historical filtering without server support.

## Inputs

- Phase 02 support rendering.
- Phase 03 packet scope.
- `docs/implementation/durable-tapes/02-options-tape.md`
- `apps/web/features/options-tape/`
- `/qa` route or module integration files.
- Existing filter serialization and column template code.

## Implementation Notes

- Diagnostic support-state language should be clearer than `SUPPORT` when possible, for example `Flow Context` or `Support State`.
- Diagnostic states should distinguish attached smart-flow, no matching projection, packet unavailable, and smart-flow unavailable where those distinctions are available.
- Product modules should rely on row treatment and detail/hover by default.
- Settings should use standard controls: checkboxes/toggles for binary filters, segmented controls for modes, menus for option sets, and drag handles or keyboard controls for reorder.
- Do not let the settings surface trigger client-side scans over large historical data. Filters that need server support should reload through the normal API paths.

## Beads

- Epic: `islandflow-miqb`
- Issue: `islandflow-miqb.4`
- Depends on: `islandflow-miqb.3`
- Parallel-safe: No. This depends on stable row support and scope semantics.

## Expected Files Or Areas

- `apps/web/features/options-tape/`
- `apps/web/app/qa/` or QA route files.
- Reusable module settings, column registry, and filter serialization files.
- Tests near options tape and route integration.

## Suggested Swarms

- UI inventory scout: current settings and column registry.
- QA route scout: existing diagnostic surface and support-state display.
- Accessibility scout: settings popout, focus order, and keyboard reorder.
- Performance scout: filters that can reload server data versus client-only filters.
- Test scout: serialization, reset, persistence, and responsive behavior.

## Quality Gates

```bash
bun test apps/web/features/options-tape
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun --cwd=apps/web run build
```

Browser verification should cover `/qa` diagnostics and `/options` default module behavior at desktop and mobile widths.

## Completion Criteria

- `/qa` exposes real support diagnostics without fake tinting.
- Default product modules do not show diagnostic support as a normal column.
- Help and settings affordances are present and tested.
- Smart-flow only, ETF/security type, side/preset, and column visibility/reorder controls are available where data support exists.
- Reload-required settings are explicit.
- Layout remains stable with no text overflow.
- The phase turn doc records implementation, review, CI/gates, Beads updates, and any follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for unsupported filters or broader design changes.
