# Run Loop: Market Command Dashboard Replacement

Workflow: `orchestrator-callback`

Canonical tracker: Beads epic `islandflow-mcmd`

Start from:

- Beads epic: `islandflow-mcmd`
- Implementation index: `docs/implementation/market-command-dashboard/IMPLEMENT.md`
- Resume aid: `docs/implementation/market-command-dashboard/loop-state.md`

## Rules

- Beads is canonical.
- Select exactly one next ready Beads child issue.
- Read the linked phase doc before editing.
- Keep one active implementation PR at a time unless Beads and the phase doc explicitly allow parallel work.
- Use large bounded subagent swarms when useful.
- Reviewer agents must use `thermo-nuclear-code-quality-review`.
- Reviewer and CI verification agents own CI.
- Update the existing Markdown turn doc.
- Update Beads first, then update `loop-state.md`.
- Do not widen the selected phase.
- Do not create a branch unless the user explicitly assigns one in the current conversation.

## Workflow Addendum

Use the orchestrator-callback topology:

```text
orchestrator thread
  -> selector subagent chooses the next ready Beads child issue
  -> orchestrator creates one visible implementation thread
  -> implementation thread may use scout/helper subagents
  -> implementation thread opens or updates one Forgejo PR
  -> implementation thread calls back exactly once
  -> orchestrator creates one visible review thread
  -> review thread uses thermo-nuclear-code-quality-review
  -> review thread owns CI, safe repairs, reruns, and evidence
  -> review thread calls back exactly once
  -> orchestrator updates Beads and loop state
  -> orchestrator selects the next phase or stops with a concrete state
```

The orchestrator owns Beads state, phase selection, visible project-scoped thread creation, callback routing, phase closeout, and stream closeout. It does not implement phase code.

Implementation threads own exactly one selected Beads issue, the assigned branch/worktree, implementation, local gates before PR when feasible, Forgejo PR creation, the existing phase turn doc, and the implementation callback. Implementation threads do not create review threads.

Review threads own the thermo-nuclear review, reviewer/CI verification swarms, CI diagnosis, safe in-scope repairs, reruns, evidence, the existing phase turn doc, and the review callback. Review threads do not create follow-up implementation threads or close Beads issues.

Worker and reviewer threads should be visible project-scoped Islandflow threads using regular `xhigh` reasoning. Do not use projectless/local threads or fast-mode/model overrides.

Before launching a worker or reviewer, replace `ORCHESTRATOR_THREAD_ID_REQUIRED` in the delegated prompt with the literal thread id of this orchestrator. Do not send delegated prompts with a prose callback target.

Callbacks are single-shot. Use the schemas in `docs/implementation/market-command-dashboard/schemas/`.

## Stream Completion

When the Beads epic is complete:

1. Verify every phase has a Markdown turn doc.
2. Generate `docs/implementation/market-command-dashboard/storyboard-post-run-07-01-2026.html`.
3. Use `impeccable` when present. If missing, continue and note that it was skipped.
4. Install `@pierre/diffs` in the target repo if missing, then render every diff with `@pierre/diffs/ssr`.
5. Verify the storyboard.

## Start Prompt

```text
Run the dirtyloops orchestrator-callback loop for Beads epic islandflow-mcmd.

Read docs/implementation/market-command-dashboard/IMPLEMENT.md and docs/implementation/market-command-dashboard/loop-state.md.

Run bd prime, bd ready, bd show islandflow-mcmd --children, and bd dep list islandflow-mcmd.1 islandflow-mcmd.2 islandflow-mcmd.3 islandflow-mcmd.4 islandflow-mcmd.5 islandflow-mcmd.6 islandflow-mcmd.7. Select exactly one next ready or already in-progress islandflow-mcmd.* phase from Beads, then read its linked phase doc and docs/implementation/market-command-dashboard/turn-docs/<issue-id>.md.

Keep this thread as orchestrator-only. Do not implement product code in this thread. Capture the literal thread id for this orchestrator before launching any delegated thread.

Before launching an implementation thread, assign an explicit phase branch and prepared worktree. Follow repo branch policy: do not let workers invent branches, and use Forgejo as the canonical remote.

Launch one visible project-scoped Islandflow implementation thread for the selected phase with regular xhigh reasoning and no fast-mode/model override. Use docs/implementation/market-command-dashboard/prompts/implementation-thread.md, replacing ORCHESTRATOR_THREAD_ID_REQUIRED with the literal orchestrator thread id before sending. The implementation thread owns the assigned branch/worktree, implementation, local gates, Forgejo PR, the existing phase turn doc, and exactly one implementation callback.

After the implementation callback is pr-ready, launch one visible project-scoped Islandflow review thread with regular xhigh reasoning and no fast-mode/model override. Use docs/implementation/market-command-dashboard/prompts/review-thread.md, replacing ORCHESTRATOR_THREAD_ID_REQUIRED with the same literal orchestrator thread id before sending. The review thread must use thermo-nuclear-code-quality-review and owns CI, safe in-scope repairs, reruns, evidence, the existing phase turn doc, and exactly one review callback.

The orchestrator alone updates Beads, updates docs/implementation/market-command-dashboard/loop-state.md, closes phase issues, merges only when explicitly allowed, selects the next phase, and performs stream closeout. Unknown CI is not approval.

Do not widen the selected phase. File Beads follow-ups for adjacent discoveries. Preserve the locked route decision: replace / directly, keep the nav label Dashboard, and do not create a hidden v2 route.

For UI phases, require real Chromium browser verification at desktop and mobile widths. Include degraded ranking fallback, reduced motion, overlay-free rendering, and no horizontal overflow when relevant.
```
