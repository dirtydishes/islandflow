# Loop State

Canonical tracker: Beads epic `islandflow-miqb`

This file is a compact resume aid only. If this file disagrees with Beads, Beads wins.

Status: active

Stream: `options-smart-flow-support-triage`

Workflow: `single-thread-subagent`

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
| 01 - Server-side smart-flow support resolver | `islandflow-miqb.1` | Open | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-miqb.1.md` |
| 02 - Row support rendering and tint parity | `islandflow-miqb.2` | Blocked on `islandflow-miqb.1` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-miqb.2.md` |
| 03 - Packet and contract scope interactions | `islandflow-miqb.3` | Blocked on `islandflow-miqb.2` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-miqb.3.md` |
| 04 - QA diagnostics and module settings | `islandflow-miqb.4` | Blocked on `islandflow-miqb.3` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-miqb.4.md` |
| 05 - More-info triage workspace | `islandflow-miqb.5` | Blocked on `islandflow-miqb.4` | None | `docs/implementation/options-smart-flow-support-triage/turn-docs/islandflow-miqb.5.md` |

## Last Coordinator Update

Loop created from the aligned 2026-06-27 plan. Implementation has not started.
