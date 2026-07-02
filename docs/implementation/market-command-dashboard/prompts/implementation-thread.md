# Implementation Thread Prompt: Market Command Dashboard Replacement

Use this prompt only after the orchestrator has selected one Beads phase, assigned a branch, assigned a prepared worktree, and replaced `ORCHESTRATOR_THREAD_ID_REQUIRED` with the literal orchestrator thread id.

## Required Inputs From Orchestrator

- Phase issue id: `REPLACE_WITH_PHASE_ISSUE_ID`
- Phase doc: `REPLACE_WITH_PHASE_DOC`
- Assigned branch: `REPLACE_WITH_BRANCH`
- Assigned worktree: `REPLACE_WITH_REPO_RELATIVE_OR_EXPLICIT_WORKTREE`
- Callback target thread id: `ORCHESTRATOR_THREAD_ID_REQUIRED`

If the callback target is not a literal thread id, stop and ask the orchestrator to resend the prompt. Do not callback to a prose target.

## Mission

Implement exactly the selected Market Command dashboard phase.

Start by running:

```bash
bd prime
bd show REPLACE_WITH_PHASE_ISSUE_ID
```

Read:

- `docs/implementation/market-command-dashboard/IMPLEMENT.md`
- `docs/implementation/market-command-dashboard/loop-state.md`
- `REPLACE_WITH_PHASE_DOC`
- `docs/implementation/market-command-dashboard/turn-docs/REPLACE_WITH_PHASE_ISSUE_ID.md`

## Rules

- Work only in the assigned branch/worktree.
- Keep the phase bounded. Do not implement later phases early.
- File Beads follow-ups for adjacent discoveries instead of widening scope.
- Use bounded scout/helper subagents when the phase surface is broad.
- Update the existing phase turn doc. Do not create a second phase turn doc.
- Run phase-specific quality gates before opening the PR when feasible.
- Push the assigned branch to `forgejo`.
- Open or update one Forgejo PR against `main`.
- Do not create review threads.
- Do not close the Beads phase issue.

## Callback Contract

Callback exactly once to thread id `ORCHESTRATOR_THREAD_ID_REQUIRED` after the PR is ready or the task is genuinely blocked.

The callback must validate against:

`docs/implementation/market-command-dashboard/schemas/implementation-callback.schema.json`

Payload shape:

```json
{
  "type": "implementation-callback",
  "phase_issue_id": "REPLACE_WITH_PHASE_ISSUE_ID",
  "status": "pr-ready",
  "branch": "REPLACE_WITH_BRANCH",
  "pr": "https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/REPLACE_WITH_PR",
  "commits": [],
  "turn_doc": "docs/implementation/market-command-dashboard/turn-docs/REPLACE_WITH_PHASE_ISSUE_ID.md",
  "local_gates": [],
  "changed_files": [],
  "blockers": [],
  "context_to_keep": []
}
```

Use `"status": "blocked"` only when meaningful progress is blocked. Include exact blockers and any partial branch/commit state.
