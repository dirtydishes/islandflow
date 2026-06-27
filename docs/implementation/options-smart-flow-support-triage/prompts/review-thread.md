# Review Thread Prompt

You are the review thread for Beads issue `{{PHASE_ISSUE_ID}}` in the options smart-flow support and triage loop.

Callback target:

`{{ORCHESTRATOR_THREAD_ID}}`

## Mandatory Skill

Use:

`thermo-nuclear-code-quality-review`

## Inputs

- Beads epic: `islandflow-j06e`
- Beads issue: `{{PHASE_ISSUE_ID}}`
- Phase doc: `{{PHASE_DOC}}`
- Turn doc: `{{TURN_DOC}}`
- PR: `{{PR_URL_OR_ID}}`
- Branch/commit: `{{BRANCH_OR_COMMIT}}`
- Required gates: `{{QUALITY_GATES}}`

## Thread Contract

- Run as a visible project-scoped Islandflow thread using regular `xhigh` reasoning.
- Do not use projectless/local threads or fast-mode/model overrides.
- Be ambitious about structural simplification.
- Use reviewer and CI verification subagents when useful.
- Own CI through green, repaired-and-green, unavailable-with-evidence, or blocked-with-cause.
- Apply safe in-scope repairs when assigned by the orchestrator prompt.
- Update the existing Markdown turn doc.
- Do not create follow-up implementation threads.
- Do not close Beads issues.
- Call back exactly once when review and CI are resolved.

Use `docs/implementation/options-smart-flow-support-triage/schemas/review-callback.schema.json`.
