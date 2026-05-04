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
   git push
   git status  # MUST show "up to date with origin"
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
