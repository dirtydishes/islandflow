# Loop State

Canonical tracker: Beads epic `islandflow-j06e`

This file is a compact resume aid only. If this file disagrees with Beads, Beads wins.

Status: active

Stream: `options-smart-flow-support-triage`

Workflow: `orchestrator-callback`

Current phase: none

Current Beads issue: none

Current PR: none

Last completed phase: none

Blocked: no

## Decisions

- Server composes smart-flow support; browser renders compact support payloads.
- Hydrate missing flow-packet membership by option trace id in bounded batches.
- Hot cache first, durable storage fallback second.
- Select highest-confidence non-abstained projection.
- Direct print refs can attach support without packet context.
- `unclear` and abstained outputs do not produce signal tint by default.
- `/qa` is diagnostic only and must not fabricate healthy support.
- Replay is out of scope.

## Context To Keep

- Predecessor tinting stream `islandflow-xcdn` is closed and should be treated as context, not the active tracker.
- Packet scope is a tape view: it shows prints in a packet.
- More-info triage is a separate investigation state: it explains why the system interpreted the flow.
- `show all contract prints` means exact normalized OCC contract.
- Browser performance is a hard constraint: no client-side packet/projection/evidence reconstruction.

## Phase Ledger

| Phase | Beads Issue | Status | PR | Turn Doc |
|---|---|---|---|---|
| 01 - Server-side smart-flow support resolver | `islandflow-j06e.1` | Open | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-j06e.1.md` |
| 02 - Row support rendering and tint parity | `islandflow-j06e.2` | Blocked on `islandflow-j06e.1` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-j06e.2.md` |
| 03 - Packet and contract scope interactions | `islandflow-j06e.3` | Blocked on `islandflow-j06e.2` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-j06e.3.md` |
| 04 - QA diagnostics and module settings | `islandflow-j06e.4` | Blocked on `islandflow-j06e.3` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-j06e.4.md` |
| 05 - More-info triage workspace | `islandflow-j06e.5` | Blocked on `islandflow-j06e.4` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-j06e.5.md` |

## Last Coordinator Update

2026-06-27: Workflow corrected to `orchestrator-callback`, canonical Beads epic corrected to `islandflow-j06e`, and phase IDs mirrored from Beads.

2026-06-27: All Beads child issues under `islandflow-j06e` were reset to `open`; no current phase or PR is recorded in this loop state.
