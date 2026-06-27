# Run Loop: Options Smart-Flow Support And Triage

Workflow: `orchestrator-callback`

Canonical tracker: Beads epic `islandflow-j06e`

Start from:

- Beads epic: `islandflow-j06e`
- Implementation index: `docs/implementation/options-smart-flow-support-triage/IMPLEMENT.md`
- Resume aid: `docs/implementation/options-smart-flow-support-triage/loop-state.md`

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

Callbacks are single-shot. Use the schemas in `docs/implementation/options-smart-flow-support-triage/schemas/`.

## Stream Completion

When the Beads epic is complete:

1. Verify every phase has a Markdown turn doc.
2. Generate `docs/implementation/options-smart-flow-support-triage/storyboard-post-run-06-27-2026.html`.
3. Use `impeccable` when present. If missing, continue and note that it was skipped.
4. Install `@pierre/diffs` in the target repo if missing, then render every storyboard diff with `@pierre/diffs/ssr`.
5. Verify the storyboard.

## Start Prompt

```text
Run the dirtyloops orchestrator-callback loop for Beads epic islandflow-j06e.

Read docs/implementation/options-smart-flow-support-triage/IMPLEMENT.md and docs/implementation/options-smart-flow-support-triage/loop-state.md.

Run bd prime, bd ready, and bd show for Beads epic islandflow-j06e. Select exactly one next ready or already in-progress islandflow-j06e.* phase from Beads, then read its linked phase doc and docs/implementation/options-smart-flow-support-triage/turn-docs/<issue-id>.md.

Keep this thread as the orchestrator. Launch one visible project-scoped Islandflow implementation thread for the selected phase with regular xhigh reasoning and no fast-mode/model override. Pass the orchestrator thread id as the callback target and use docs/implementation/options-smart-flow-support-triage/prompts/implementation-thread.md. The implementation thread owns the assigned branch/worktree, implementation, local gates, Forgejo PR, the existing phase turn doc, and exactly one implementation callback.

After the implementation callback is pr-ready, launch one visible project-scoped Islandflow review thread with regular xhigh reasoning and no fast-mode/model override. Pass the orchestrator thread id as the callback target and use docs/implementation/options-smart-flow-support-triage/prompts/review-thread.md. The review thread must use thermo-nuclear-code-quality-review and owns CI, safe in-scope repairs, reruns, evidence, the existing phase turn doc, and exactly one review callback.

The orchestrator alone updates Beads, updates docs/implementation/options-smart-flow-support-triage/loop-state.md, closes phase issues, merges only when explicitly allowed, selects the next phase, and performs stream closeout. Unknown CI is not approval.

Do not widen the selected phase. File Beads follow-ups for adjacent discoveries. Preserve the performance rule: smart-flow support hydration must be server-side, batched, cached, and window-scoped. It must not add browser-side joins or block virtual row rendering.

Follow repo branch policy. Do not let worker threads invent branches; assign an explicit branch/worktree before implementation starts. Use Forgejo, not GitHub, for PR publication when a branch is assigned.
```
