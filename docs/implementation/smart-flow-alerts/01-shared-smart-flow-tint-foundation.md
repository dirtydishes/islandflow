# Phase 01: Shared Smart-Flow Tint Foundation

## Intent

Extract the reusable smart-flow tint semantics from Options Tape into a shared frontend module so alerts, options, durable rows, and later smart-flow UI surfaces use one visual policy.

## Required Work

- Create a shared module under `apps/web/features/smart-flow/`.
- Move generic tint logic out of `apps/web/features/options-tape/tinting.ts`:
  - hypothesis type to tone mapping
  - direction normalization
  - policy confidence bands
  - evidence quality bands
  - abstention low-intensity behavior
  - `--classifier-intensity` style generation
  - hypothesis summary labels
- Keep Options Tape ownership of option-specific mapping:
  - direct option-print refs
  - flow-packet member expansion
  - direct-print versus packet-member precedence
  - options-tape CSS class prefixes
- Export stable shared types for future consumers:
  - `SmartFlowTint`
  - `SmartFlowTintMetadata`
  - `SmartFlowTintTone`
  - `SmartFlowTintDirection`
  - `SmartFlowSummary`
- Keep this phase behavior-preserving for Options Tape.

## Architecture Constraints

- The shared module must not import Options Tape types.
- The shared module must not know about alert rows, option rows, or durable-row view models.
- Do not move this UI tint module into `packages/types`; it is frontend presentation policy, not a wire contract.
- Do not change scoring, API payloads, live subscriptions, storage, or alert behavior.
- If class names change, preserve visual behavior and update tests intentionally. Prefer keeping options-tape wrapper classes stable.

## Acceptance Criteria

- Options Tape imports the shared smart-flow tint module and preserves current tint behavior.
- Generic tint matrix tests live with the shared module.
- Options Tape tests still cover row mapping, packet-member expansion, and options-specific classes.
- No alert runtime behavior changes.
- No new copy of hypothesis-tone, confidence-band, or abstention-intensity logic remains in Options Tape.

## Suggested Checks

```bash
bd show islandflow-ghce.1
bun test apps/web/features/options-tape
bun test apps/web/features/durable-tape
bun --cwd=apps/web run build
```

## Out Of Scope

- Adding smart-flow alert contracts.
- Moving alerts to smart-flow.
- Changing durable-row schemas.
- Removing legacy smart-money/classifier paths.

## Suggested Future Codex Implementation Prompt

```text
Implement docs/implementation/smart-flow-alerts/01-shared-smart-flow-tint-foundation.md for Beads issue islandflow-ghce.1. Extract reusable smart-flow tint semantics into apps/web/features/smart-flow, keep Options Tape behavior stable, and do not change alert behavior or API/storage contracts. Use the required thermo-nuclear reviewer thread after implementation.
```
