# Run Loop: Options Smart-Flow Support And Triage

Workflow: `single-thread-subagent`

Canonical tracker: Beads epic `islandflow-miqb`

Start from:

- Beads epic: `islandflow-miqb`
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

Use the single-thread-subagent topology:

```text
main coordinator thread
  -> selector subagents
  -> scout subagents
  -> implementation in main thread unless explicitly assigned
  -> reviewer subagents
  -> CI verification subagents
  -> coordinator closeout
```

The main coordinator owns branch state, implementation, PR state, Beads updates, and closeout. Subagents inspect, compare, critique, verify, and report. Subagents do not advance loop state.

## Stream Completion

When the Beads epic is complete:

1. Verify every phase has a Markdown turn doc.
2. Generate `docs/implementation/options-smart-flow-support-triage/storyboard-post-run-06-27-2026.html`.
3. Use `impeccable` when present. If missing, continue and note that it was skipped.
4. Install `@pierre/diffs` in the target repo if missing, then render every storyboard diff with `@pierre/diffs/ssr`.
5. Verify the storyboard.

## Start Prompt

```text
Run the dirtyloops single-thread-subagent loop for Beads epic islandflow-miqb.

Read docs/implementation/options-smart-flow-support-triage/IMPLEMENT.md and docs/implementation/options-smart-flow-support-triage/loop-state.md.

Run bd prime, bd ready, and bd show for the next ready islandflow-miqb.* issue. Select exactly one ready phase, read its linked phase doc, claim the issue, and update docs/implementation/options-smart-flow-support-triage/turn-docs/<issue-id>.md as the single turn doc for the phase.

Use bounded scout subagents when useful, but keep Beads, branch state, implementation, PR state, and closeout in this main thread. Reviewer subagents must use thermo-nuclear-code-quality-review, and reviewer/CI verification agents own CI through one of the allowed closeout states: ci-green, ci-repaired-and-green, ci-unavailable-with-evidence, or ci-blocked-with-cause.

Do not widen the selected phase. File Beads follow-ups for adjacent discoveries. Preserve the performance rule: smart-flow support hydration must be server-side, batched, cached, and window-scoped. It must not add browser-side joins or block virtual row rendering.

Follow repo branch policy. Do not create a branch unless explicitly assigned. Use Forgejo, not GitHub, for PR publication when a branch is assigned.
```
