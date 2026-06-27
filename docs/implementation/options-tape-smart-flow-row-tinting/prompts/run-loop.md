# Run Loop: Options Tape Smart-Flow Row Tinting

Workflow: `orchestrator-callback`

Canonical tracker: Beads epic `islandflow-xcdn`

Start from:

- Beads epic: `islandflow-xcdn`
- Implementation index: `docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md`
- Resume aid: `docs/implementation/options-tape-smart-flow-row-tinting/loop-state.md`
- Callback schemas: `docs/implementation/options-tape-smart-flow-row-tinting/schemas/`

## Rules

- Beads is canonical.
- Select exactly one next ready Beads child issue.
- Read the linked phase doc before editing.
- Keep one active implementation PR at a time unless Beads and the phase doc explicitly allow parallel work.
- Use regular `xhigh` reasoning for selector, worker, and reviewer threads unless the user says otherwise.
- Create visible project-scoped Codex implementation and review threads for this Islandflow repo.
- Use large bounded subagent swarms when useful.
- Reviewer agents must use `thermo-nuclear-code-quality-review`.
- Reviewer and CI verification agents own CI through completion.
- Update the existing phase turn doc.
- Update Beads first, then update `docs/implementation/options-tape-smart-flow-row-tinting/loop-state.md`.
- Do not widen the selected phase.

## Workflow Addendum

Topology:

```text
orchestrator thread
  -> selector subagent chooses next ready Beads phase
  -> orchestrator creates implementation thread
  -> implementation thread may use helper subagents
  -> implementation thread opens PR and calls back once
  -> orchestrator creates review thread
  -> review thread uses thermo-nuclear-code-quality-review
  -> review thread owns CI, safe repairs, reruns, and evidence
  -> review thread calls back once after review and CI are resolved
  -> orchestrator updates Beads and loop-state.md
  -> orchestrator launches the next selector or closes the stream
```

Implementation callback schema:

`docs/implementation/options-tape-smart-flow-row-tinting/schemas/implementation-callback.schema.json`

Review callback schema:

`docs/implementation/options-tape-smart-flow-row-tinting/schemas/review-callback.schema.json`

Only the orchestrator creates implementation and review threads. Implementation threads do not create review threads. Review threads do not create follow-up implementation threads. Selector subagents never mutate state. The orchestrator is the only actor that advances phases.

Prefer callback-driven coordination. Use a lightweight heartbeat around 30 minutes for long-running worker or reviewer threads.

## Stream Completion

When the Beads epic is complete:

1. Verify every phase has one turn document under `docs/implementation/options-tape-smart-flow-row-tinting/turn-docs/`.
2. Generate `docs/implementation/options-tape-smart-flow-row-tinting/storyboard-post-run-mm-dd-yyyy.html`.
3. Use `impeccable` when present. If missing, continue and note that it was skipped.
4. Install `@pierre/diffs` in the target repo if missing, then render every diff with `@pierre/diffs/ssr`.
5. Verify the storyboard.

## Start Prompt

```text
Run the options tape smart-flow row tinting dirtyloop using the orchestrator-callback workflow.

Start by reading:
- docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md
- docs/implementation/options-tape-smart-flow-row-tinting/loop-state.md

Run:
- bd prime
- bd ready
- bd show islandflow-xcdn --children

Use a selector subagent with regular xhigh reasoning to choose the next ready islandflow-xcdn.* phase from Beads. The selector must read the linked spec_id and report the next issue, dependency state, safe parallelism, required phase doc, and blockers. The selector must not edit files, update Beads, create branches, commit, push, open PRs, or create threads.

If no islandflow-xcdn.* child issue is ready because the epic is complete, report the completed state and do not launch worker or reviewer threads.

For a ready phase, the orchestrator creates one visible project-scoped Islandflow implementation thread. Pass the worker:
- Orchestrator thread ID: <current-orchestrator-thread-id>
- Callback target: message only that thread exactly once when PR-ready or genuinely blocked.
- docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md
- the full linked phase document
- the Beads issue ID
- the assigned branch/worktree
- the phase quality gates
- the existing turn-doc path
- docs/implementation/options-tape-smart-flow-row-tinting/schemas/implementation-callback.schema.json

The worker opens a Forgejo PR against main when ready and sends exactly one implementation callback matching the schema.

After a PR-ready callback, the orchestrator creates one visible project-scoped Islandflow review thread. Pass the reviewer:
- Orchestrator thread ID: <current-orchestrator-thread-id>
- Callback target: message only that thread exactly once when review and CI are resolved or concretely blocked.
- PR URL and branch
- worker callback summary
- docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md
- the full linked phase document
- existing turn-doc path
- the thermo-nuclear-code-quality-review skill requirement
- docs/implementation/options-tape-smart-flow-row-tinting/schemas/review-callback.schema.json

The reviewer must use thermo-nuclear-code-quality-review, own CI through completion, repair safe in-scope issues on the same branch, update the existing turn doc, push any repairs, wait for CI resolution, and send exactly one review callback matching the schema.

The orchestrator validates callbacks, updates Beads first, mirrors compact state into docs/implementation/options-tape-smart-flow-row-tinting/loop-state.md, syncs Beads with bd dolt push during closeout, pushes code to forgejo, verifies git status is up to date, and then launches the next selector or closes the stream.
```
