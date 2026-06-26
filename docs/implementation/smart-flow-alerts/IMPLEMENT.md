# Implementing Smart-Flow Alerts And Legacy Removal

This directory tracks the completed migration to canonical smart-flow hypothesis alerts and records the final path-removal phases.

Human-readable plan: [`plan.html`](./plan.html).

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd prime
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

If the shell cannot find `bd` locally, use `/opt/homebrew/bin/bd`.

Only work on a phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-ghce` - Smart-flow hypothesis alerts and legacy path removal

Phase issues:

| Phase | Beads issue | Phase doc | Depends on | PR posture |
| --- | --- | --- | --- | --- |
| 01 - Shared smart-flow tint foundation | `islandflow-ghce.1` | [`01-shared-smart-flow-tint-foundation.md`](./01-shared-smart-flow-tint-foundation.md) | None | Refactor-only foundation PR. No alert/runtime behavior changes. |
| 02 - Native smart-flow runtime | `islandflow-ghce.2` | [`02-native-smart-flow-runtime.md`](./02-native-smart-flow-runtime.md) | `islandflow-ghce.1` | Runtime smart-flow PR. Keep legacy emitters temporarily. |
| 03 - Derived hypothesis alerts | `islandflow-ghce.3` | [`03-derived-hypothesis-alerts.md`](./03-derived-hypothesis-alerts.md) | `islandflow-ghce.2` | New contracts/API/storage/live PR. Do not migrate UI yet. |
| 04 - Alerts UI migration | `islandflow-ghce.4` | [`04-alerts-ui-migration.md`](./04-alerts-ui-migration.md) | `islandflow-ghce.3` | UI migration PR. Do not delete legacy API/storage yet. |
| 05 - Consumer cutover | `islandflow-ghce.5` | [`05-consumer-cutover.md`](./05-consumer-cutover.md) | `islandflow-ghce.4` | Product-consumer cutover PR. Leave only temporary transition aliases. |
| 06 - Legacy deletion and history drop | `islandflow-ghce.6` | [`06-legacy-deletion-history-drop.md`](./06-legacy-deletion-history-drop.md) | `islandflow-ghce.5` | Final deletion PR. Drop old derived history without backfill. |

## Current Implementation Facts

- Smart-flow contracts, scoring, replay evaluation, UI explainability, and shared tint foundations exist.
- Runtime API smart-flow fetchers read canonical smart-flow projection storage.
- Compute emits canonical smart-flow projections and smart-flow alerts.
- `AlertsModule`, durable tapes, terminal state, and live transport consume canonical `SmartFlowAlertEvent` rows.
- Legacy derived history is intentionally dropped at final cutover instead of backfilled.

## How To Pick Up Work

1. Run `bd prime`.
2. Run `bd ready`.
3. Pick the next ready `islandflow-ghce.*` issue.
4. Run `bd show <issue-id>` and read its `spec_id`.
5. Read this `IMPLEMENT.md`.
6. Read the linked phase document in full.
7. Claim the issue with `bd update <issue-id> --claim`.
8. Implement only that phase unless the phase doc explicitly says to split child issues.

## Orchestrator Loop

The orchestrator owns selection, worker/reviewer thread creation, and final closeout. The orchestrator does not own implementation edits or reviewer CI repair.

Loop:

1. Read this `IMPLEMENT.md`.
2. Start with a selector subagent using `xhigh` reasoning unless the user says otherwise.
3. The selector runs `bd prime`, `bd ready`, filters for `islandflow-ghce.*`, runs `bd show <issue-id>`, reads the linked `spec_id`, and reports the next ready task.
4. The orchestrator creates exactly one implementation worker thread for the selector-approved ready phase.
5. The worker receives this `IMPLEMENT.md`, the full phase doc, the Beads issue ID, quality gates, branch/PR posture, and the orchestrator thread ID.
6. The worker follows repo branch rules. Do not create a branch unless the orchestrator explicitly assigns one.
7. The worker may use bounded helper subagents, but owns edits, tests, Beads updates, commit, push, PR, and callback.
8. The worker messages the orchestrator exactly once when the assigned task is PR-ready, complete, or genuinely blocked.
9. The orchestrator then creates a separate reviewer thread.
10. The reviewer owns review, safe repairs, local gates, Forgejo CI, Beads updates, final push, and callback.
11. The orchestrator closes out only after reviewer callback says review is complete and CI is green.

## Callback Contract

Every worker and reviewer prompt must include:

```text
Orchestrator thread ID: <current-orchestrator-thread-id>
Callback target: message only that thread exactly once when your assigned work is PR-ready, complete, or genuinely blocked.
```

Worker callback must include changed files, commit/PR state, tests/builds/browser probes, Beads updates, `bd dolt push` status, git push status, follow-up issue IDs, and known risks.

Reviewer callback must include findings, repair commits if any, local gate state, Forgejo CI state, Beads updates, `bd dolt push` status, git push status, merge readiness, and residual risks.

## Subagent Delegation Topology

Use up to 20 subagents per phase when the phase is broad enough. This is a maximum, not a quota.

| Slot | Count | Role |
| --- | ---: | --- |
| Selector | 1 | Pick the next ready Beads issue and dependency state. |
| Read-only scouts | Up to 8 | Inspect contracts, storage, API, UI, tests, docs, migration risks, and deletion inventory. |
| Worker helper subagents | Up to 4 | Assist the implementation worker with bounded inspection, test mapping, and proposed patches. |
| Review swarm | Up to 6 | Run focused review slices after the worker PR/callback. |
| Lead reviewer | 1 | Consolidate review, repair in scope, own CI, update Beads/docs, and callback once. |

Subagents may inspect, summarize, review, and propose. Only the implementation worker mutates the implementation branch before review. Only the lead reviewer mutates the branch during review repairs.

## Scout Slices

Use these slices as needed:

- Smart-flow contract and schema ownership.
- Compute runtime path from flow packets to evidence clusters to hypotheses.
- Storage and ClickHouse read/write model.
- API, websocket, replay, and live-cache surfaces.
- AlertsModule and durable-row presentation.
- Shared smart-flow tint module and CSS behavior.
- Terminal route feature and subscription model.
- Chart marker and lower-pane consumer inventory.
- Hydration scheduler and support payload inventory.
- Legacy deletion grep/audit inventory.
- Replay/golden fixture coverage.
- Browser QA and accessibility risks.

## Reviewer Requirements

Every review-swarm subagent and the lead reviewer must read and apply:

```text
/Users/kell/.agents/skills/thermo-nuclear-code-quality-review/SKILL.md
```

Reviewer stance:

- Findings first, ordered by severity.
- Be ambitious about structural simplification.
- Look for code-judo moves that delete complexity.
- Treat wrong-layer logic, duplicated tint/scoring policy, file-size sprawl, casts, optionality churn, and scattered legacy fallbacks as blockers unless clearly justified.
- Repair safe in-scope issues on the same branch.
- File focused follow-up Beads issues for real out-of-scope work instead of widening the PR.
- Reviewer threads own CI. They must inspect Forgejo CI, repair in-scope failures, rerun gates, push repairs, and wait for CI green before callback.
- If CI cannot be made green, callback must be explicitly blocked and not merge-ready, with exact CI state and next action.

## Selector Prompt Skeleton

```text
Use docs/implementation/smart-flow-alerts/IMPLEMENT.md to select the next ready phase.
Run bd prime, bd ready, bd show for candidate islandflow-ghce.* issues, and read the linked spec_id.
Report the next ready issue, dependency state, safe parallelism, required phase doc, and any blockers.
Do not edit files, update Beads, create branches, commit, push, or create implementation/reviewer threads.
Orchestrator thread ID: <current-orchestrator-thread-id>
```

## Worker Prompt Skeleton

```text
Implement <phase-doc> for Beads issue <issue-id>.
Read docs/implementation/smart-flow-alerts/IMPLEMENT.md and the full linked phase document before editing.
Use the phase-specific gates and keep the PR phase-bounded.
Follow repo branch rules; do not create a branch unless explicitly assigned.
You may use up to 4 bounded helper subagents for inspection/test mapping/proposed patches, but you own all edits, Beads updates, commit, push, and PR state.
Do not create the reviewer thread.
Call back exactly once when PR-ready, complete, or genuinely blocked.
Orchestrator thread ID: <current-orchestrator-thread-id>
```

## Reviewer Prompt Skeleton

```text
Review <PR-or-branch> for <issue-id> against <phase-doc>.
Read docs/implementation/smart-flow-alerts/IMPLEMENT.md, the full phase doc, and /Users/kell/.agents/skills/thermo-nuclear-code-quality-review/SKILL.md before reviewing.
Use the thermo-nuclear code quality bar: findings first, structural simplification first, no rubber-stamp approvals.
You may use up to 6 bounded review subagents for focused review slices.
If repair is safe and in scope, repair on the same branch and rerun required gates.
You own Forgejo CI. Do not callback merge-ready while CI is pending or red.
Call back exactly once after review, repairs, CI/local gate state, Beads updates, and push state are resolved.
Orchestrator thread ID: <current-orchestrator-thread-id>
```

## Parallelism Rules

Keep implementation phases serial:

```text
islandflow-ghce.1 -> islandflow-ghce.2 -> islandflow-ghce.3 -> islandflow-ghce.4 -> islandflow-ghce.5 -> islandflow-ghce.6
```

Parallelism is allowed inside a phase for read-only scouts, implementation helpers, and reviewers. Do not run implementation phases in parallel because each phase changes the contract the next phase consumes.

If a phase grows too large, split focused Beads child issues under that phase instead of widening the PR.

## Quality Gates

Use phase-specific gates first. Common gates:

```bash
bun test packages/types
bun test services/compute/tests
bun test services/api/tests
bun test apps/web/features/alerts apps/web/features/options-tape apps/web/features/terminal
bun test apps/web/app/terminal.test.ts
bun --cwd=apps/web run build
```

UI phases require browser verification on `/durable-tapes` and alert-bearing terminal surfaces at desktop and mobile widths. The browser run should use only the required local component unless the phase explicitly says otherwise.

## Closeout

1. Read the reviewer callback.
2. If review is blocked or CI is not green, route the blocker back to a resolver and do not merge.
3. If review is complete and CI is green, merge or close out according to Forgejo workflow.
4. File follow-up Beads issues for remaining out-of-scope work.
5. Sync Beads with `bd dolt push`.
6. Push code to Forgejo and verify `git status --short --branch` is clean and up to date.
7. Rerun selector for the next ready phase.

## Turn Documents

Repository implementation turn docs for this stream belong under:

```text
docs/turns/
```

Docs-only planning changes that only create or update this implementation plan are exempt from turn-document creation under the repo's minor/trivial documentation rule.
