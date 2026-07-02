# Review Thread Prompt: Market Command Dashboard Replacement

Use this prompt only after the orchestrator has received an implementation callback, identified the PR/branch to review, and replaced `ORCHESTRATOR_THREAD_ID_REQUIRED` with the literal orchestrator thread id.

## Required Inputs From Orchestrator

- Phase issue id: `REPLACE_WITH_PHASE_ISSUE_ID`
- Phase doc: `REPLACE_WITH_PHASE_DOC`
- PR: `REPLACE_WITH_FORGEJO_PR`
- Branch/worktree: `REPLACE_WITH_BRANCH_OR_WORKTREE`
- Callback target thread id: `ORCHESTRATOR_THREAD_ID_REQUIRED`

If the callback target is not a literal thread id, stop and ask the orchestrator to resend the prompt. Do not callback to a prose target.

## Mission

Use `thermo-nuclear-code-quality-review` to review the selected phase, own CI through completion, make safe in-scope repairs when needed, and callback exactly once when review and CI are resolved.

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

- Review against the selected phase scope, not the whole future plan.
- Reviewer agents must use `thermo-nuclear-code-quality-review`.
- You own CI inspection, failure diagnosis, safe repairs, reruns, and final evidence.
- Unknown CI is not approval.
- Make safe in-scope repairs on the same branch when needed.
- Update the existing phase turn doc with review, repairs, CI evidence, browser evidence when applicable, and residual risks.
- Push any repair commits to `forgejo`.
- Do not create follow-up implementation threads.
- Do not close the Beads phase issue.

## UI Phase Browser Evidence

For UI phases, verify real Chromium desktop and mobile behavior when applicable. Include degraded ranking fallback, reduced motion, overlay-free rendering, no horizontal overflow, and stable pane/header sizing when relevant to the selected phase.

## Callback Contract

Callback exactly once to thread id `ORCHESTRATOR_THREAD_ID_REQUIRED` after review and CI are resolved.

The callback must validate against:

`docs/implementation/market-command-dashboard/schemas/review-callback.schema.json`

Payload shape:

```json
{
  "type": "review-callback",
  "phase_issue_id": "REPLACE_WITH_PHASE_ISSUE_ID",
  "status": "approved",
  "pr": "REPLACE_WITH_FORGEJO_PR",
  "ci_state": "ci-green",
  "review_skill": "thermo-nuclear-code-quality-review",
  "repairs": [],
  "findings_remaining": [],
  "turn_doc": "docs/implementation/market-command-dashboard/turn-docs/REPLACE_WITH_PHASE_ISSUE_ID.md",
  "context_to_keep": []
}
```

Allowed `ci_state` values:

- `ci-green`
- `ci-repaired-and-green`
- `ci-unavailable-with-evidence`
- `ci-blocked-with-cause`

Use `"status": "blocked"` only when review or CI cannot be resolved. Include exact CI state, evidence, and next action.
