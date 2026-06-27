# Phase 02: Live Smart-Flow Coloring

## Intent

Wire live smart-flow projections into `OptionsTape` so current live rows can display smart-flow hypothesis tinting from direct print refs and packet-member expansion.

## Required Work

- Add `smartFlowProjections` support to `OptionsTape` or an equivalent typed prop that keeps projection-to-row mapping inside the options-tape domain.
- Derive hypothesis decor from smart-flow evidence refs:
  - direct option-print refs color those prints.
  - packet refs expand through known `FlowPacket.members`.
  - hypothesis type controls hue.
  - direction modifies treatment.
  - policy confidence controls intensity.
  - abstention lowers intensity and labels the row context explicitly.
- Split route features so `/options` subscribes to `smart-flow` without enabling unrelated legacy smart-money UI.
- Pass smart-flow projections into `/options`, dashboard options modules, and durable-tapes options panes where `OptionsTape` is used.
- Update hover and packet-focus scope band to show hypothesis label, direction, confidence, and abstention state when smart-flow decor is present.
- Keep legacy classifier/compatibility decor behavior where a surface still depends on it, but prefer smart-flow decoration when both are available for the same row.

## Architecture Constraints

- Do not overload the existing `smartMoney` route feature flag to mean "subscribe to modern smart-flow projections."
- Keep legacy smart-money compatibility separate from canonical smart-flow presentation.
- Keep projection-to-print expansion deterministic and local to the options-tape/terminal composition path.
- Do not scatter ad-hoc smart-flow checks across unrelated route code. If the route feature model needs a new field, add the field explicitly.
- Do not claim historical completeness in this phase. Loaded older rows are Phase 03.

## Likely Files

- `apps/web/features/options-tape/OptionsTape.tsx`
- `apps/web/features/options-tape/types.ts`
- `apps/web/features/options-tape/options-tape.test.ts`
- `apps/web/features/terminal/routes.ts`
- `apps/web/features/terminal/state.tsx`
- `apps/web/features/terminal/evidence.ts`
- `apps/web/app/terminal.tsx`
- route/subscription tests in `apps/web/app/terminal.test.ts`

## Acceptance Criteria

- `/options` includes a live `smart-flow` subscription without enabling unrelated legacy smart-money UI panes.
- `OptionsTape` receives smart-flow projections in every live options surface where row tinting should apply.
- Direct smart-flow option-print refs decorate matching option rows.
- Smart-flow packet refs decorate the known member prints of matching `FlowPacket.members`.
- Hover detail and packet/contract scope context show hypothesis label, direction, confidence, and abstention state.
- Smart-flow decoration takes precedence over legacy smart-money decor where both describe the same row.
- Release notes or callback language explicitly state that historical completeness follows in Phase 03.

## Suggested Checks

```bash
bd show islandflow-xcdn.2
bun test apps/web/app/terminal.test.ts apps/web/features/options-tape
```

Add focused component or selector tests for packet-member expansion and live projection mapping.

## Implementation Subagents

Run this phase through the full topology in `IMPLEMENT.md` when useful: selector agent, 6-10 read-only scout agents, one implementation worker, 3-8 review agents, and one lead reviewer.

Every review agent and the lead reviewer must use the `thermo-nuclear-code-quality-review` skill before reviewing this phase.

The Phase 02 worker may use helper subagents for:

- Smart-flow evidence-ref expansion through direct refs and packet refs.
- Route manifest and feature-flag split review.
- OptionsTape call-site inventory.
- Hover/scope-band UX and accessibility review.
- Focused route/component test mapping.

Helpers may propose specific edits or tests, but the worker owns the route-feature contract, options-tape decor model, branch, Beads updates, commit, PR state, and final callback.

## Out Of Scope

- Hydration scheduler support for `smart_flow`.
- Historical loaded-row tinting.
- Server-composed durable option row payload changes.
- API/storage changes except test fixtures needed for existing live data types.
- Smart-flow scoring, calibration, or model changes.

## Suggested Future Codex Implementation Prompt

```text
Run under docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md using the orchestrator-callback workflow. Implement docs/implementation/options-tape-smart-flow-row-tinting/02-live-smart-flow-coloring.md for Beads issue islandflow-xcdn.2 after Phase 01 is merged. Subscribe /options to smart-flow without enabling unrelated legacy smart-money UI, pass smart-flow projections into OptionsTape call sites, and tint live rows through direct print refs and FlowPacket.members expansion. Do not claim historical/server-row completeness; that belongs to Phase 03. Open a Forgejo PR when ready and call back to the orchestrator exactly once using docs/implementation/options-tape-smart-flow-row-tinting/schemas/implementation-callback.schema.json. Do not create the reviewer thread.
```

## Matching Beads Issue

- `islandflow-xcdn.2` - Phase 02: live smart-flow coloring
