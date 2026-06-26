# Smart-Flow Alerts And Legacy Removal Roadmap

This roadmap turns `islandflow-ghce` into the execution stream for replacing legacy smart-money, classifier-hit, and legacy-alert paths with canonical smart-flow hypothesis alerts.

## Product Decision

The final pipeline is:

```text
observations -> evidence clusters -> hypotheses -> insights -> hypothesis alerts
```

Alerts remain a first-class presentation and delivery channel, but they are derived from smart-flow outputs. They do not own a separate scoring policy, classifier taxonomy, or hidden participant claim.

## Core Constraints

- Emit smart-flow alerts only from non-abstained smart-flow projections.
- Do not preserve legacy `score`, `severity`, or classifier `hits` in the canonical alert contract.
- Use shared smart-flow tint semantics for row hue and intensity.
- Prefer new canonical surfaces first, then flip consumers, then delete legacy paths.
- Drop old derived smart-money, classifier-hit, and legacy-alert history at final cutover. Do not backfill it.
- Keep raw observations, flow packets, canonical smart-flow outputs, and canonical smart-flow-alert outputs.

## Phase Sequence

| Phase | Beads issue | Purpose |
| --- | --- | --- |
| 01 - Shared smart-flow tint foundation | `islandflow-ghce.1` | Extract reusable frontend tint semantics from Options Tape so alerts and other surfaces share one visual policy. |
| 02 - Native smart-flow runtime | `islandflow-ghce.2` | Make runtime smart-flow outputs canonical instead of API projections from stored smart-money rows. |
| 03 - Derived hypothesis alerts | `islandflow-ghce.3` | Add `SmartFlowAlertEvent` contracts, storage, bus, live cache, and API surfaces. |
| 04 - Alerts UI migration | `islandflow-ghce.4` | Move `AlertsModule` to hypothesis-alert rows, fast triage detail, and shared tinting. |
| 05 - Consumer cutover | `islandflow-ghce.5` | Move terminal, durable-tapes, dashboard, and chart consumers off legacy smart-money/classifier/alert feeds. |
| 06 - Legacy deletion and history drop | `islandflow-ghce.6` | Delete legacy emitters, routes, live channels, UI state, storage helpers, and old derived tables/history. |

## Dependency Policy

Run the phases serially. Read-only scouts and review swarms can run inside a phase, but implementation phases must not overlap because each phase changes the contract the next phase consumes.

```text
islandflow-ghce.1 -> islandflow-ghce.2 -> islandflow-ghce.3 -> islandflow-ghce.4 -> islandflow-ghce.5 -> islandflow-ghce.6
```

## Matching Beads Epic

- `islandflow-ghce` - Smart-flow hypothesis alerts and legacy path removal
