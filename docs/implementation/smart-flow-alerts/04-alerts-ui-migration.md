# Phase 04: Alerts UI Migration

## Intent

Move the alerts UI from legacy `AlertEvent` rows to canonical smart-flow hypothesis alerts with fast triage detail and shared smart-flow tinting.

## Required Work

- Update `AlertsModule` to consume `SmartFlowAlertEvent`.
- Replace alert row columns with:
  - time
  - symbol
  - hypothesis
  - direction
  - confidence/evidence
- Apply shared smart-flow tint metadata to alert rows.
- Remove score/severity presentation from the canonical alert UI.
- Keep alert module ownership of detail and evidence hydration.
- Lead the detail drawer with fast triage:
  - symbol
  - hypothesis
  - direction
  - trigger reason
  - confidence and evidence quality
  - primary packet or option refs
- Put alternatives, why-not context, penalties, and model/policy versions below the triage section.
- Preserve typed packet, contract, and equity focus callbacks.

## Architecture Constraints

- Do not reintroduce "smart money" hidden participant copy.
- Do not compute row tint ad hoc inside alert components. Use the shared smart-flow tint module.
- Keep terminal transport/state thin; `AlertsModule` owns alert presentation.
- Do not read legacy alert/classifier hits for normal rendering.
- Keep accessibility behavior from the durable tape module intact.

## Acceptance Criteria

- `AlertsModule` renders canonical smart-flow alerts without legacy `AlertEvent`.
- Alert rows use shared smart-flow tint class/style output.
- Fast-triage drawer copy uses hypothesis-alert language.
- Packet, contract, and equity focus actions still work from alert evidence.
- UI tests cover row columns, tint application, detail order, and focus callbacks.
- Browser QA verifies alert-bearing surfaces at desktop and mobile widths without text overlap or horizontal overflow.

## Suggested Checks

```bash
bd show islandflow-ghce.4
bun test apps/web/features/alerts
bun test apps/web/app/terminal.test.ts apps/web/features/terminal
bun --cwd=apps/web run build
```

Use local web-only browser QA when needed:

```bash
WEB_DEV_PORT=3100 NEXT_PUBLIC_API_URL=https://api.flow.deltaisland.io bun run dev:web
```

## Out Of Scope

- Deleting legacy API routes.
- Dropping legacy derived history.
- Changing smart-flow scoring policy.

## Suggested Future Codex Implementation Prompt

```text
Implement docs/implementation/smart-flow-alerts/04-alerts-ui-migration.md for Beads issue islandflow-ghce.4. Move AlertsModule to SmartFlowAlertEvent rows, use shared smart-flow tinting, replace score/severity UI with hypothesis/confidence/evidence triage, and preserve alert-owned evidence detail and focus callbacks. Do not delete legacy API/storage paths in this phase.
```
