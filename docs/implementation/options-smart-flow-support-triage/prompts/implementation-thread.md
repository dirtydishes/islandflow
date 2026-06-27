# Implementation Thread Prompt

You are the implementation thread for Beads issue `{{PHASE_ISSUE_ID}}` in the options smart-flow support and triage loop.

Callback target:

`{{ORCHESTRATOR_THREAD_ID}}`

## Inputs

- Beads epic: `islandflow-j06e`
- Beads issue: `{{PHASE_ISSUE_ID}}`
- Phase doc: `{{PHASE_DOC}}`
- Implementation index: `docs/implementation/options-smart-flow-support-triage/IMPLEMENT.md`
- Turn doc: `{{TURN_DOC}}`
- Branch/worktree instructions: `{{BRANCH_WORKTREE_INSTRUCTIONS}}`

## Thread Contract

- Run as a visible project-scoped Islandflow thread using regular `xhigh` reasoning.
- Do not use projectless/local threads or fast-mode/model overrides.
- Implement exactly the selected phase.
- Do not widen scope.
- Use bounded scout/helper subagents when useful.
- Own the assigned branch/worktree and Forgejo PR.
- Update the existing Markdown turn doc.
- Run local gates before PR when feasible.
- Do not create the review thread.
- Call back exactly once to the orchestrator.

## Callback States

Call back only when:

- PR is open and ready for review.
- The task is complete but PR cannot be created, with exact blocker.
- The thread is genuinely blocked.

Use `docs/implementation/options-smart-flow-support-triage/schemas/implementation-callback.schema.json`.

## Scope Guard

Preserve the performance rule: smart-flow support hydration must be server-side, batched, cached, and window-scoped. It must not add browser-side joins or block virtual row rendering.
