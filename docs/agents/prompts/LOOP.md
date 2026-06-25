# Codex Orchestrator Loop Prompt

Use this prompt when you want Codex to run a multi-phase implementation loop with worker threads, reviewer threads, callbacks, CI-gated closeout, and minimal polling.

Copy the prompt below into the orchestrator thread and fill the placeholders for the project.

```text
Run an implementation loop for this project.

Project root: [PROJECT_ROOT]
Implementation index: [IMPLEMENT_DOC_PATH]
Beads epic or task stream: [BEADS_EPIC_OR_STREAM_ID_OR_DESCRIPTION]
Canonical git remote: [REMOTE_NAME_AND_HOST]
Branch prefix, if branches are assigned: [BRANCH_PREFIX]
Turn-doc location: [TURN_DOC_DIRECTORY]
Special QA runner notes: [QA_RUNNER_NOTES]

Assume Beads is the tracker for this project. Run `bd prime` before acting, use `bd ready` and `bd show <issue-id>` for selection, `bd update <issue-id> --claim` when starting work, `bd create` for follow-ups, `bd close` for completed work, and `bd dolt push` during closeout.

Use the implementation index as the source of truth. Read it first, then follow it for phase order, scope, dependencies, PR posture, concurrency rules, quality gates, subagent guidance, and closeout rules. If the implementation index conflicts with this prompt, prefer the project-specific implementation index unless I explicitly correct it in this thread.

Run the loop like this:

1. Start with a selector subagent.
   - The selector must read the implementation index.
   - The selector must run `bd prime`, `bd ready`, and `bd show <issue-id>` for candidate ready work.
   - The selector must report the next ready phase or phases, their issue IDs, linked phase docs, dependency state, safe parallelism, and any blocking contracts that must be pinned before worker launch.
   - Do not hand-pick work from memory when Beads state and phase docs exist.

2. Create implementation worker thread(s) only for selector-approved ready work.
   - Pass each worker:
     - project root
     - implementation index path
     - full linked phase doc content
     - issue ID
     - branch/PR posture
     - required quality gates
     - turn-doc requirements
     - subagent guidance
     - orchestrator thread ID for callback
   - Give the worker a precise branch assignment when branch creation is appropriate for this project.
   - Tell the worker to keep the PR phase-bounded.
   - Tell the worker not to create the reviewer thread.
   - Tell the worker to message this orchestrator thread exactly once when the PR is open and local gates are complete, or when genuinely blocked.
   - The worker callback must include changed files, PR/branch/commit state, local tests/builds/QA run, Beads updates, `bd dolt push` status, git push status, follow-up issue IDs, and known risks.

3. Do not constantly monitor worker threads.
   - Workers should call back here when they finish or block.
   - Add or maintain a 30-minute heartbeat fallback for this orchestrator thread.
   - On heartbeat, first act on visible callbacks.
   - If no callback is visible, read each active worker or reviewer thread at most once as a fallback status check.
   - Avoid tight polling.

4. Start reviewer threads only after implementation work is actually ready for review.
   - Do not launch or resume a reviewer for a PR that depends on a repair/resolver thread still in progress.
   - If I stop a reviewer because it started too early, wait for the repair/resolver callback before restarting review.
   - Create a separate reviewer thread per PR.
   - Pass the reviewer:
     - project root
     - implementation index path
     - full phase doc content
     - PR URL and branch
     - worker callback summary
     - orchestrator thread ID for callback
     - existing turn-doc path
     - reviewer standard from this prompt and from the implementation index

5. Reviewers own CI verification.
   - Implementation workers may report local gates and current PR state, but reviewers must verify CI themselves.
   - Reviewers must wait for CI to be green before callback.
   - If a reviewer pushes repair commits, the reviewer must wait for the new CI run to finish green before callback.
   - Reviewers must include exact CI run IDs/statuses or the project equivalent in their callback.

6. Reviewer standard.
   - Review with an ambitious code-review stance.
   - Findings come first, ordered by severity, with concrete file/line references.
   - Focus on behavioral risk, architecture, missing tests, accessibility, data contracts, and scope drift before style.
   - Use subagents where useful for bounded review tasks such as API/storage contract checks, visual QA, accessibility, test coverage, or dependency inventory.
   - Reconcile subagent outputs yourself; do not paste them through unexamined.
   - Prefer changes that delete complexity:
     - remove whole branches, helpers, modes, conditionals, or layers when the design makes them unnecessary
     - prefer one deeper module over pass-through modules
     - prefer domain callbacks and route composition over global state
     - prefer explicit data contracts over UI branching that compensates for ambiguous data
     - prefer shared mechanics over per-domain clones
     - prefer responsive templates and detail surfaces over column or surface proliferation
   - If no issues are found, say that clearly and name residual risk or test gaps.

7. Reviewer repairs and docs.
   - If issues can be repaired safely within scope, reviewers should repair them on the same branch/PR.
   - If an issue is real but out of scope, file a focused follow-up Beads issue instead of widening the PR.
   - Reviewers must update the existing phase turn doc. They must not create a separate reviewer turn doc unless I explicitly request that.
   - Turn docs for this stream belong under [TURN_DOC_DIRECTORY].
   - The turn doc should record review findings, repairs, local/browser QA, CI state, follow-up issues, and final review disposition.

8. QA runner rules.
   - Use the phase docs and project instructions for quality gates.
   - For browser or web-only QA, use [WEB_ONLY_QA_COMMAND] when provided.
   - Do not start the full stack for web-only QA when a hosted or mocked backend runner is explicitly available.
   - If a local port, hosted backend, or external service blocks QA, file or route a focused repair issue and pause dependent reviews/phases until the repair is resolved when the implementation index says it is blocking.

9. Closeout after reviewer callback.
   - Read the reviewer callback carefully.
   - If review is blocked, route the blocker to the correct worker/resolver and do not merge.
   - If review is complete and CI is green, merge or close out the PR according to the project PR workflow.
   - Sync Beads state, `bd dolt push`, git remotes, and docs according to project instructions.
   - Verify the target branch is clean and up to date with the canonical remote.
   - Delete or update obsolete heartbeat automation instructions so they do not keep watching completed work.

10. Repeat.
   - After closeout, run the selector subagent again.
   - Launch only the next ready work allowed by Beads dependencies and implementation-index concurrency rules.
   - If a callback contract must be pinned before parallel phases can start, pin it in each affected worker prompt before launching those workers.
   - Continue selector -> worker -> reviewer -> closeout until the epic or task stream is complete.

Callback requirements for every worker:

- issue ID and phase/task name
- branch name
- PR URL/number, or blocked reason
- changed files
- tests/builds/browser QA run and results
- Beads status and `bd dolt push` status
- git push/status result
- follow-up issue IDs
- CI status if known, while noting that the reviewer must verify CI

Callback requirements for every reviewer:

- PR URL/number and reviewed commits
- findings or explicit no-findings result
- repairs pushed, if any, with commit IDs
- tests/builds/browser QA run and results
- CI run IDs/statuses after any repair commit
- existing turn-doc path updated
- Beads updates and `bd dolt push` status
- git push/status result
- final disposition: ready to merge, blocked, or needs further implementation

Keep the orchestration callback-driven, Beads-driven, and phase-bounded. Do not drift into unrelated work just because it is nearby.
```

## Notes For Islandflow

For Islandflow durable-tapes work, the concrete substitutions are:

- `Project root`: `/Users/kell/dev/islandflow`
- `Implementation index`: `docs/implementation/durable-tapes/IMPLEMENT.md`
- `Beads stream`: durable-tapes epic `islandflow-h9c0`
- `Canonical git remote`: Forgejo remote `forgejo`
- `Branch prefix`: `lavender/` when a branch is explicitly assigned
- `Turn-doc location`: `docs/implementation/durable-tapes/turn-docs/`
- `Web-only QA`: use `bun run dev:web` against the local API by default; use `<raw-api-origin>` only when the phase explicitly requires nonlocal API QA
- Reviewer docs: update the existing phase turn doc under `docs/implementation/durable-tapes/turn-docs/`; do not create a separate reviewer turn doc
- CI ownership: reviewers verify and wait for Forgejo CI, including after reviewer repair commits
