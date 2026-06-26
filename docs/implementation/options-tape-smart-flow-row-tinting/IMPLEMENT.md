# Implementing Options Tape Smart-Flow Row Tinting

This directory is the active implementation guide for adding smart-flow hypothesis-aware row tinting to the reusable options tape.

Source plan: `/Users/kell/Downloads/PLAN (1).md`.

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd prime
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Only work on a phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-xcdn` - Options tape smart-flow row tinting

Phase issues:

| Phase | Beads issue | Phase doc | Depends on | PR posture |
| --- | --- | --- | --- | --- |
| 00 - Roadmap and execution plan | `islandflow-n16t` | [`00-roadmap.md`](./00-roadmap.md) | None | Docs-only planning commit. No runtime behavior changes. |
| 01 - Durable tape tint foundation | `islandflow-xcdn.1` | [`01-durable-tape-tint-foundation.md`](./01-durable-tape-tint-foundation.md) | None | One focused foundation PR. No live subscription or API behavior changes. |
| 02 - Live smart-flow coloring | `islandflow-xcdn.2` | [`02-live-smart-flow-coloring.md`](./02-live-smart-flow-coloring.md) | `islandflow-xcdn.1` | One live UI/data wiring PR. Do not claim historical completeness yet. |
| 03 - Strict historical and server-row coverage | `islandflow-xcdn.3` | [`03-strict-historical-server-row-coverage.md`](./03-strict-historical-server-row-coverage.md) | `islandflow-xcdn.2` | Final strict-coverage PR. Must cover hydration, API payloads, and durable option rows. |

## Current Implementation Facts

- `apps/web/features/durable-tape/types.ts` already has a `rowTinting` feature key.
- `DurableTape` currently renders rows with a fixed `durable-tape-row` class and does not accept row class/style hooks.
- `OptionsTape` already centralizes options print context through `OptionsTapeRowContext`.
- `/options` currently sets route feature `smartMoney: false`, which also prevents the live `smart-flow` subscription.
- `/lookup/options-support` already returns `smart_flow: projectSmartFlowExplainability(smartMoney)`, but the frontend hydration scheduler does not expose that result yet.
- `DurableTapeOptionRowsPane` is a separate durable-row path and must not diverge from the `OptionsTape` tint semantics in Phase 03.

## How To Pick Up Work

1. Run `bd prime`.
2. Run `bd ready`.
3. Pick the next ready `islandflow-xcdn.*` issue.
4. Run `bd show <issue-id>` and read its `spec_id`.
5. Read this `IMPLEMENT.md`.
6. Read the linked phase document.
7. Claim the issue with `bd update <issue-id> --claim`.
8. Implement only that phase unless the phase doc explicitly says to split child issues.

## Orchestrator Thread Creation Loop

When this stream is run from an orchestrator thread, the orchestrator owns selection, thread creation, review creation, and final closeout. Helpers should not invent scope, create extra reviewer threads, or choose work from memory alone.

The orchestrator must know and pass its own thread ID to every worker and reviewer it creates. Use a literal line in each prompt:

```text
Orchestrator thread ID: <current-orchestrator-thread-id>
Callback target: message only that thread exactly once when your assigned work is PR-ready, complete, or genuinely blocked.
```

Loop:

1. Read this `IMPLEMENT.md`.
2. Start with a narrow selector subagent using `xhigh` reasoning unless the user says otherwise.
3. The selector must run `bd prime`, `bd ready`, filter for `islandflow-xcdn.*`, run `bd show <issue-id>`, read the linked `spec_id`, and report the next ready task, dependency state, safe parallelism, and blocking contracts.
4. The orchestrator creates an implementation worker thread only for selector-approved ready work.
5. The worker receives this `IMPLEMENT.md`, the full linked phase document, the Beads issue ID, relevant quality gates, branch and PR posture from the phase table, turn-doc location, and the orchestrator thread ID.
6. The worker follows repo branch rules. Do not create a branch unless the orchestrator explicitly assigns one.
7. The worker keeps the PR phase-bounded and does not create the reviewer thread.
8. The worker messages the orchestrator thread exactly once when the assigned task is complete, PR-ready, or genuinely blocked.
9. The callback includes changed files, commit/PR state, tests/builds/browser probes, Beads updates, `bd dolt push` status, git push status, follow-up issue IDs, and known risks.

Selector prompt skeleton:

```text
Use docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md to select the next ready phase.
Run bd prime, bd ready, bd show for candidate islandflow-xcdn.* issues, and read the linked spec_id.
Report the next ready issue, dependency state, safe parallelism, required phase doc, and any blockers.
Do not edit files, update Beads, create branches, commit, push, or create implementation/reviewer threads.
Orchestrator thread ID: <current-orchestrator-thread-id>
```

Worker prompt skeleton:

```text
Implement <phase-doc> for Beads issue <issue-id>.
Read docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md and the full linked phase document before editing.
Use the phase-specific gates and keep the PR phase-bounded.
Follow repo branch rules; do not create a branch unless explicitly assigned.
Do not create the reviewer thread.
Call back exactly once when PR-ready, complete, or genuinely blocked.
Orchestrator thread ID: <current-orchestrator-thread-id>
```

Reviewer prompt skeleton:

```text
Review <PR-or-branch> for <issue-id> against <phase-doc>.
Read docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md, the full phase doc, and /Users/kell/.agents/skills/thermo-nuclear-code-quality-review/SKILL.md before reviewing.
Use the thermo-nuclear code quality bar: findings first, structural simplification first, no rubber-stamp approvals.
If repair is safe and in scope, repair on the same branch and rerun required gates.
Call back exactly once after review, repairs, CI/local gate state, Beads updates, and push state are resolved.
Orchestrator thread ID: <current-orchestrator-thread-id>
```

## Reviewer Handoff

Create a separate reviewer thread after the worker reports completion or opens the assigned PR.

- Use `xhigh` reasoning for the reviewer unless the orchestrator says otherwise.
- Pass the reviewer the full phase doc, this `IMPLEMENT.md`, PR URL, branch, worker callback summary, orchestrator thread ID, existing turn-doc path, and the required `thermo-nuclear-code-quality-review` skill.
- The reviewer must read and apply `thermo-nuclear-code-quality-review` before reviewing. In this environment the skill lives at `/Users/kell/.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`.
- The reviewer uses a thermo-nuclear code-review stance: findings first, ordered by severity, with file/line references, and a structural simplification bar instead of rubber-stamp approval.
- Treat structural maintainability regressions, missed code-judo simplifications, spaghetti branching, unjustified file-size growth, wrong-layer logic, and unnecessary wrappers/casts as presumptive blockers unless clearly justified.
- The reviewer owns CI verification, including after reviewer repair commits.
- If repair is safe and in scope, the reviewer may repair on the same branch/PR.
- If a real issue is out of scope, the reviewer files a focused follow-up Beads issue instead of widening the PR.
- The reviewer updates the existing phase turn document under `docs/implementation/options-tape-smart-flow-row-tinting/turn-docs/`; do not create a separate reviewer turn doc.
- The reviewer messages back only when review, repair, CI/local gate state, Beads updates, and push state are resolved.

## Implementation Swarm Topology

Use this topology when the orchestrator wants broad inspection and review coverage. The numbers are target ranges for large phases, not quotas for narrow edits.

1. Selector agent: picks the next ready `islandflow-xcdn.*` issue.
2. Scout swarm, 6-10 read-only agents: inspect different slices in parallel and report findings before implementation begins.
3. Single implementation worker: owns the branch, edits, tests, commit, PR, Beads state, and callback. It uses scout outputs as inputs.
4. Review swarm, 3-8 agents: run bounded review after the PR or worker completion callback.
5. One lead reviewer: consolidates findings, performs safe repairs, waits for CI/local gates, updates the phase turn doc, and calls back once.

Scout swarm slices:

- Durable tape row API and feature-flag contract.
- Options tape row context and decor mapping.
- Smart-flow projection refs, labels, direction, confidence, and abstention fields.
- Route subscription and terminal feature split.
- Hydration scheduler support result/caching behavior.
- API `/lookup/options-support` and durable-row payload behavior.
- CSS row-state, hover, focus, and accessibility behavior.
- Existing focused tests and missing regression coverage.

Review swarm roles:

- Durable tape API reviewer.
- Options tape component reviewer.
- Smart-flow domain contract reviewer.
- Route/live-subscription reviewer.
- Hydration/API reviewer.
- CSS/accessibility reviewer.
- Tests/build reviewer.
- Docs/Beads reviewer.

Every review-swarm member and the lead reviewer must use the `thermo-nuclear-code-quality-review` skill. The lead reviewer enforces the skill's approval bar before calling back: no clear structural regression, no obvious missed simplification, no unjustified 1k-line file crossing, no avoidable spaghetti branching, no wrong-layer leakage, and no unnecessary abstraction or cast churn.

Scout and review helpers must remain bounded. They may inspect, summarize, review, and propose; they do not mutate tracked files, update Beads, create or switch branches, commit, push, open PRs, contact the orchestrator independently, or make final scope decisions.

## Implementation Worker Subagents

Implementation workers may use bounded helper subagents when a phase benefits from parallel inspection, test mapping, or specialized review. This is optional, not a quota. Do not spawn helpers just to make a narrow phase look busy.

Worker-owned fanout model:

1. One implementation owner remains accountable for the phase.
2. The worker may launch bounded helper subagents when useful.
3. Helpers may inspect, inventory, test, review, model risk, and propose patches or follow-ups.
4. Helpers must not mutate tracked files, update Beads, create or switch branches, commit, push, create PRs, contact the orchestrator, or make final scope decisions.

Good implementation helper targets:

- Phase 01: durable row API surface, rowTinting feature precedence, options-tint helper matrix, CSS interaction states, focused test coverage.
- Phase 02: smart-flow refs expansion, route manifest split, OptionsTape call sites, hover/scope copy, live packet-member regressions.
- Phase 03: hydration scheduler payload typing, support cache semantics, `/lookup/options-support` tests, durable-row view-model contract, end-to-end historical tint proof.

Do not delegate:

- Reading or interpreting required skill instructions.
- Deciding the durable tape public API.
- Deciding the smart-flow tint semantics.
- Owning the implementation branch or PR.
- Closing phase issues or the epic.
- Final deployment decisions.

## Parallelism Rules

Keep implementation phases serial:

```text
islandflow-xcdn.1 -> islandflow-xcdn.2 -> islandflow-xcdn.3
```

Parallelism is allowed inside a phase for read-only scouts, implementation helper subagents, and review agents. Do not run Phase 02 in parallel with Phase 01 because the live coloring API depends on the row hook contract. Do not run Phase 03 in parallel with Phase 02 because strict historical coverage depends on the live tint semantics.

If a phase grows too large, split focused Beads child issues under that phase instead of widening the PR.

## Quality Gates

Use phase-specific gates first. Common gates:

```bash
bun test apps/web/features/durable-tape apps/web/features/options-tape
bun test apps/web/app/terminal.test.ts apps/web/features/terminal
bun test services/api/tests
bun --cwd=apps/web run build
```

UI phases require browser verification for `/options` and the dashboard options module at desktop and mobile widths before closeout. Phase 03 also requires proof that older loaded history rows and durable option rows share the same tint rules.

## Closeout

1. Read the reviewer callback.
2. If review is blocked, route the blocker to the correct worker/resolver and do not merge.
3. If review is complete and CI is green, merge or close out according to Forgejo workflow.
4. File follow-up Beads issues for remaining out-of-scope work.
5. Sync Beads state with `bd dolt push`.
6. Push code to Forgejo and verify `git status --short --branch` is clean and up to date.
7. Rerun selector for the next ready phase.

## Turn Documents

Repository implementation turn docs for this stream belong under:

```text
docs/implementation/options-tape-smart-flow-row-tinting/turn-docs/
```

Use one canonical turn document per phase. Reviewers update the existing phase turn doc instead of creating a separate reviewer document.

Docs-only planning changes that only create or update this implementation plan are exempt from turn-document creation under the repo's minor/trivial documentation rule.
