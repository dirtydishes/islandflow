# Loop State

Canonical tracker: Beads epic `islandflow-xcdn`

This file is a compact resume aid only. If this file disagrees with Beads, Beads wins.

Status: complete

Stream: `options-tape-smart-flow-row-tinting`

Workflow: `orchestrator-callback`

Current phase: none

Current Beads issue: none

Current PR: none

Last completed phase: `islandflow-xcdn.3`

Blocked: no

## Decisions

- Beads is canonical for status, ordering, blockers, dependencies, and completion.
- The loop runs as `orchestrator-callback`: orchestrator selects work, creates implementation threads, creates review threads, receives exactly one callback from each, and advances phases.
- Implementation threads own exactly one selected phase and call back with `schemas/implementation-callback.schema.json`.
- Review threads use `thermo-nuclear-code-quality-review`, own CI through completion, repair safe in-scope issues, and call back with `schemas/review-callback.schema.json`.
- Worker/reviewer prompts use repo-relative paths only.
- Docs-only updates to this implementation plan are exempt from turn-document creation under the repo rules.

## Context To Keep

- Phase order is serial: `islandflow-xcdn.1 -> islandflow-xcdn.2 -> islandflow-xcdn.3`.
- The stream implementation epic and all three implementation child issues are closed in Beads.
- The documentation conversion to explicit `orchestrator-callback` artifacts is tracked and closed by `islandflow-udiq`.
- Future run/inspect/closeout work must start from Beads rather than this mirror.

## Phase Ledger

| Phase | Beads Issue | Status | PR | Turn Doc |
|---|---|---|---|---|
| 00 - Roadmap and execution plan | `islandflow-n16t` | closed | none | planning docs only |
| 01 - Durable tape tint foundation | `islandflow-xcdn.1` | closed | Forgejo PR #85 | `docs/implementation/options-tape-smart-flow-row-tinting/turn-docs/2026-06-26-phase-01-durable-tape-tint-foundation.html` |
| 02 - Live smart-flow coloring | `islandflow-xcdn.2` | closed | Forgejo PR #86 | `docs/implementation/options-tape-smart-flow-row-tinting/turn-docs/2026-06-26-phase-02-live-smart-flow-coloring.html` |
| 03 - Strict historical and server-row coverage | `islandflow-xcdn.3` | closed | Forgejo PR #87 | `docs/implementation/options-tape-smart-flow-row-tinting/turn-docs/2026-06-26-phase-03-strict-historical-server-row-coverage.html` |

## Last Coordinator Update

2026-06-27: Converted the loop artifacts to the dirtyloops `orchestrator-callback` workflow shape and added `prompts/run-loop.md`, callback schemas, and this loop-state mirror.
