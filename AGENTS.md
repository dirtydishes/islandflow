<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push forgejo <branch>
   git status  # MUST show "up to date with forgejo/<branch>"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

## Minimal Repo Operating Instructions

This is a Bun + TypeScript monorepo for an event-sourced market-data pipeline:
- Flow: ingest services publish to NATS/JetStream, compute/candles derive events, API serves REST/WS, web consumes live/replay streams.
- Main folders: `services/*` (runtime services), `packages/*` (shared libs/types/storage), `apps/web` (Next.js UI).
- Infra dependency: local dev assumes Docker services (NATS, ClickHouse, Redis) are available.

Use these repo-specific commands:
- Install deps: `bun install`
- Start full stack: `bun run dev`
- Start infra only: `bun run dev:infra`
- Start backend services only: `bun run dev:services`
- Start web only: `bun run dev:web`

Testing and validation in this repo are Bun-first:
- Run tests: `bun test`
- Run scoped tests: `bun test services/compute/tests` (or another package/service path)
- Validate web production build when UI code changes: `bun --cwd=apps/web run build`

Working style that avoids common problems here:
- Prefer editing in the touched workspace (`services/<name>`, `packages/<name>`, `apps/web`) and keep shared contract changes in `packages/types`.
- Keep `.env` aligned with `.env.example`; adapters default to synthetic modes for local development.
- Dev runners persist child PID state in `.tmp/`; if a previous run crashed, restart via the standard `bun run dev*` commands so stale processes are cleaned up.

## Forgejo Is Canonical

This repository's primary home is Forgejo:

- URL: `https://git.deltaisland.io/dirtydishes/islandflow`
- Git remote: `forgejo`
- Push target: `forgejo` (not GitHub)

Agent expectations:

- Prefer `git push forgejo <branch>` when publishing work.
- Treat GitHub as a mirror unless explicitly instructed otherwise.
- Use `fj` for Forgejo pull request workflows (create/view/update PRs).
- When sharing PR links in handoff, use the Forgejo PR URL.

## Required Turn Documentation

At the end of every completed implementation task, before final handoff, create a user-readable HTML document describing the work.

This documentation is mandatory whenever code, configuration, tests, or project files were changed.

For diff content in turn documentation (including "Code diffs" and "Relevant Diff Snippets"), use `@pierre/diffs` output by default. If `@pierre/diffs` is unavailable because of a real tool or blocking error, use a clearly labeled plain diff/code block fallback and note why.

### Do not produce this for minor or trivial changes, including but not limited to:

- Syntax fixes
- Code refactoring
- Documentation updates
- Reconciling PRs
- Updating AGENTS.md or other documentation

**Feel free to use your own judgement and always prompt the user if you are unsure if this change requires documentation or not.**

### When making a minor update to a previous change, update the existing documentation instead of creating a new file. Use the following format:

**"New Changes as of {time and date at which the change was made}"**
- **Summary of changes**
- **Why this change was made**
- **Code diffs** (use `@pierre/diffs` output by default; if unavailable, include a clearly labeled plain diff/code block and note why)
- **Related issues or PRs**

Additionally, add a note to each section explaining why the changes were made.

### Location

Save the document in:

```text
docs/turns/
```

Use a clear timestamped filename:

```text
docs/turns/YYYY-MM-DD-short-task-name.html
```

Example:

```text
docs/turns/2026-05-14-add-market-replay-controls.html
```

### Format

Use the `impeccable` skill to structure and style the document as clean, readable HTML.

For this repository, `impeccable` is the styling and layout authority for turn documents when available. Do not apply global non-repo computer-task house styling to repository turn documents.

If the `impeccable` skill is unavailable or blocked by an actual tool/file error, still create a well-structured standalone HTML file with:

- A concise summary at the top
- A detailed explanation of what changed
- Relevant context or background
- Specific code snippets or examples when helpful
- Issues, limitations, tradeoffs, or mitigations
- Validation performed, including tests, builds, linters, or manual checks
- Any remaining follow-up work, with corresponding Beads issue IDs when applicable

### Required Sections

Each turn document must include these sections:

1. **Summary**
2. **Changes Made**
3. **Context**
4. **Important Implementation Details**
5. **Relevant Diff Snippets** (render with `@pierre/diffs` output by default; if unavailable, include a clearly labeled plain diff/code block and note why)
6. **Expected Impact for End-Users**
7. **Validation**
8. **Issues, Limitations, and Mitigations**
9. **Follow-up Work**

### Completion Rule

A task is not complete until:

1. The Beads workflow is updated
2. The turn document is created in `docs/turns`
3. Relevant quality gates have passed or failures are documented
4. Changes are committed
5. `bd dolt push` succeeds
6. `git push forgejo <branch>` succeeds
7. `git status` shows the branch is up to date with `forgejo/<branch>`

For trivial changes, the document may be brief, but it must still exist and clearly explain what changed and how it was validated.

## Plan Mode Documentation

When working in plan mode, do not modify implementation files.

At the end of plan mode, provide a concise summary of the plan and ask the user whether they want to proceed with implementation.

If the user asks to save the plan, create a user-readable HTML plan document in:

```text
docs/plans/
```

Use a clear timestamped filename:

```text
docs/plans/YYYY-MM-DD-short-plan-name.html
```

The plan document should be labeled clearly as a plan and should include:

1. **Plan Summary**
2. **Goals**
3. **Proposed Changes**
4. **Relevant Context**
5. **Implementation Steps**
6. **Risks, Limitations, and Mitigations**
7. **Open Questions**

Always do the following when you finish a task, finish the beads workflow and and make a commit:
- Document the changes in a user-readable format
- Use the impeccable skill to structure the document as HTML 
- Create a clear, concise summary of the changes at the top, followed by a detailed description of the changes, including any relevant context or background as well as specific code snippets or examples.
- Note any relevant issues or limitations that were addressed or mitigated by the changes.
- The HTML file should be stored in the `docs/turns` directory. It should include the current date and time, as well as a brief explanation of changes. e.g. docs/turns/YYYY-MM-DD-{description}.html
