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

## Implementation Phase Plans

Before beginning synthetic market-data or smart-money/smart-flow implementation work, read `docs/implementation/README.md` and the specific phase file linked from the active Beads issue. Treat `docs/plans/*architecture-review.md` files as background guidance only; the current phase document and Beads issue define the active scope. Keep PRs phase-bounded and reviewable, split smaller Beads child issues when a phase is too large, and add/update Beads dependencies when one phase blocks another.

## Forgejo Is Canonical

This repository's primary home is Forgejo:

- URL: `https://git.dirtydishes.dev/dirtydishes/islandflow`
- Git remote: `forgejo`
- Push target: `forgejo` (not GitHub)

Agent expectations:

- Prefer `git push forgejo <branch>` when publishing work.
- Treat GitHub as a mirror unless explicitly instructed otherwise.
- Use `fj` for Forgejo pull request workflows (create/view/update PRs).
- When sharing PR links in handoff, use the Forgejo PR URL.

## Required Turn Documentation

Follow the global turn-documentation rules in `~/.codex/AGENTS.md` for repository implementation tasks, plan documents, and non-repo computer tasks.

For this repository, the repo-specific requirements are:

- Save repository implementation turn documents in `docs/turns/`.
- Use the `impeccable` skill to structure and style repository implementation turn documents when available.
- Render "Relevant Diff Snippets" with `@pierre/diffs/ssr`; use https://diffs.com/docs as the SSR reference.
- For minor updates to a previous change, update the existing turn document instead of creating a new one.
- The minor/trivial exemptions below override the general documentation requirement for this repository.

### No turn document for minor/trivial checklist matches

Do not create a turn document when the change is minor/trivial and cleanly matches one of these categories:

- `AGENTS.md` changes or other documentation-only changes
- Syntax-only fixes
- Refactor-only changes with no behavior change
- PR/conflict reconciliation work
- Issue-tracker-only updates such as `beads/issues.json`
- Support-file changes that only accompany one of the exempt categories above (for example lockfile or manifest updates required for docs-workflow changes)

If a change does not cleanly fit either exempt or substantive buckets, ask the user before creating a turn document.

### Completion Rule

For repository implementation tasks that require turn documentation, the task is not complete until:

1. The Beads workflow is updated
2. The turn document is created in `docs/turns`
3. Relevant quality gates have passed or failures are documented
4. Changes are committed
5. `bd dolt push` succeeds
6. `git push forgejo <branch>` succeeds
7. `git status` shows the branch is up to date with `forgejo/<branch>`
