# Issue Tracker: Beads

Issues and implementation tasks for this repo live in Beads (`bd`). Treat Beads as authoritative for task state, assignment, dependencies, and follow-up work.

## Core workflow

- Run `bd prime` at session start or after context recovery.
- Use `bd ready` to find available work.
- Use `bd show <id>` to inspect an issue before starting.
- Use `bd update <id> --claim` when starting work.
- Use `bd create --title="..." --description="..." --type=task|bug|feature --priority=2` for follow-up work.
- Use `bd close <id>` when the work is complete.

## Session close

Before handoff, update Beads state and publish Beads data:

```bash
bd dolt push
```

The repo's normal session completion rules still apply: commit changed files, push the git branch to `forgejo`, and verify the branch is up to date with its Forgejo upstream.

## Forgejo issues

Forgejo is the canonical git host for this repo, but Beads remains the authoritative implementation issue tracker. Use `fj issue` only to inspect, comment on, or open Forgejo-hosted visibility context when the user explicitly asks for it or when Beads points to an external Forgejo issue.
