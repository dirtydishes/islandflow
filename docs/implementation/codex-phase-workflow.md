# Codex Phase Implementation Workflow

This workflow lets one Codex thread act as the phase orchestrator while separate
threads implement and review each phase-sized Beads task.

The orchestrator should stay small and procedural: select the next task, launch
the implementation thread, launch the review thread after a PR exists, merge only
after review and validation pass, then repeat selection from the current Beads
state.

## Source of Truth

Use this precedence order for every loop:

1. Current Beads issue state.
2. `docs/implementation/README.md`.
3. The phase document referenced by the Beads issue `spec_id`.
4. The stream roadmap under `docs/implementation/*/00-roadmap.md`.
5. Background plans and research docs.

Do not choose work from an architecture review unless that work is already pulled
into a phase document and Beads issue.

## Orchestrator Loop

Run these steps from the orchestration thread before launching any worker thread:

```bash
git switch main
git pull --rebase forgejo main
bd dolt pull
bd ready
```

Then select the next phase task:

1. Read the dependency table in `docs/implementation/README.md`.
2. Ignore future calibration phases unless the MVP chain is complete or the user
   explicitly asks for future work.
3. Prefer the earliest open issue in dependency order whose dependencies are
   closed and which appears in `bd ready`.
4. If the phase has PR-sized child issues in the relevant roadmap, prefer the
   first ready child over the broad parent.
5. Run `bd show <issue-id>` and read its `spec_id` document before launching an
   implementation thread.
6. If another thread or branch is already working on that issue, inspect that
   work instead of launching a duplicate.

As of 2026-06-18, the next derived phase is:

```text
islandflow-259.4
docs/implementation/synthetic-market-data/04-replay-integration.md
```

Recalculate this each time the loop restarts.

## Implementation Thread

Create a new Codex project worktree thread from the current `main` with model
`gpt-5.5` and reasoning `xhigh`. Use a branch name derived from the Beads issue,
for example:

```text
lavender/synthetic-replay-integration
```

Use this prompt template:

```text
You are implementing the next Islandflow phase task.

Repository: /Users/kell/dev/islandflow
Beads issue: <issue-id>
Phase spec: <spec-path>

Before editing, read AGENTS.md, run `bd prime`, run `bd show <issue-id>`, and
read `docs/implementation/README.md` plus the phase spec. Follow the phase scope
strictly. If the phase is too broad for one reviewable PR, create or select the
next PR-sized Beads child issue before implementation continues.

Claim the Beads issue, create a `lavender/<short-task-name>` branch, implement
only the phase-bounded work, add focused tests, and keep the fast path
infra-free unless the phase explicitly says otherwise.

Before handing back, run the relevant quality gates, create the required
repository turn document unless the repo instructions exempt the change, close
or update the Beads issue, commit, run `bd dolt push`, push with
`git push forgejo <branch>`, and file a Forgejo PR with `fj`.

Report back with the branch, commit, PR URL, validation performed, any skipped
checks, and any follow-up Beads issues created.
```

The implementation thread owns code changes and the PR branch. It does not merge
the PR.

## Review Thread

After the implementation thread reports a PR URL, create a second Codex worktree
thread for review with model `gpt-5.5` and reasoning `xhigh`. It should inspect
the PR branch and either make required changes on that branch or report that the
PR is ready to merge.

Use this prompt template:

```text
Review this Islandflow PR as a code reviewer and fixer.

PR URL: <pr-url>
Beads issue: <issue-id>
Phase spec: <spec-path>

Read AGENTS.md, run `bd prime`, inspect the PR diff and the phase spec, and take
a code-review stance: prioritize bugs, regressions, scope creep, missing tests,
and validation gaps. If you find required fixes, apply them directly on the PR
branch, run the relevant quality gates, commit, run `bd dolt push` if Beads state
changed, and push the PR branch back to Forgejo.

Do not merge the PR. Report whether the PR is ready to merge, which checks you
ran, what you changed, and any residual risks.
```

The review thread should avoid unrelated refactors. If it finds scope that
belongs to a later phase, it should file or update a Beads follow-up instead of
expanding the PR.

## Merge Gate

The orchestration thread is the only thread that merges. Merge only after:

1. The implementation thread has filed a Forgejo PR.
2. The review thread says the PR is ready or has pushed required fixes.
3. CI is passing, or any missing CI signal has been manually replaced by local
   quality gates documented in the PR and turn document.
4. The PR still matches the selected Beads issue and phase spec.
5. Required turn documentation exists for substantive repository changes.

Before merging, the orchestration thread should refresh state:

```bash
git fetch forgejo
git switch main
git pull --rebase forgejo main
bd dolt pull
```

Then inspect and merge with Forgejo tooling:

```bash
fj pr view <pr-number-or-url>
fj pr merge <pr-number-or-url>
fj pr view <pr-number-or-url>
git pull --rebase forgejo main
bd dolt pull
git status
```

If `fj` cannot merge because of conflicts, stale CI, or branch protection, send
the PR back to a worker thread with the exact blocker.

Do not select or launch the next implementation task while the reviewed PR is
still open. The PR must be merged, or explicitly closed as rejected, before the
orchestration loop restarts.

## Loop Restart

After a merge lands or the reviewed PR is otherwise closed:

1. Confirm the reviewed PR is closed on Forgejo.
2. Confirm `git status` shows `main` up to date with `forgejo/main`.
3. Confirm Beads state is synced with `bd dolt push` when local Beads state
   changed.
4. Run `bd ready`.
5. Re-read the dependency table in `docs/implementation/README.md`.
6. Select the next ready phase or PR-sized child issue.
7. Launch the next implementation thread with model `gpt-5.5`, reasoning
   `xhigh`, and the implementation prompt.

Stop the loop when there is no ready MVP phase, when the next ready issue is
outside the implementation README dependency chain, or when a human decision is
needed.

## Failure Handling

If the implementation thread stalls, the orchestration thread should inspect the
thread status, ask once for a concise blocker report, and either continue that
thread or launch a replacement only after confirming the first thread did not
push reusable work.

If the review thread makes changes, it must push them to the same PR branch and
report the new commit. The orchestration thread should not merge a review-fixed
PR until it has rechecked CI or local validation.

If Beads and Git disagree, fix the disagreement before launching another worker.
The next task is chosen from current Beads state, not from memory of the previous
loop.
