# Phase 06: Final Verification and Publish

Beads issue: `islandflow-e30y.6`

Full plan: [`00-roadmap.md`](./00-roadmap.md)

## Purpose

Finish the staged refactor with repo-level verification, documentation, Beads updates, commit, sync, and Forgejo push.

## Scope

- Run final quality gates.
- Create or update required turn documentation if the implementation work is substantive and not exempt.
- Close completed phase issues and update any follow-up Beads issues.
- Sync Beads with Dolt.
- Commit and push the branch to Forgejo.

## Dependencies

- Depends on: `islandflow-e30y.5`.
- Blocks: none.

## Parallel Work

Do not parallelize this phase. It is the serial closeout gate for the full staged refactor.

## Acceptance Gates

- `bun test`
- `bun --cwd=apps/web run build`
- Any test/build failures are fixed or documented in Beads with follow-up issues if they are unrelated.
- Required turn documentation exists in `docs/turns/`, or an exemption is clearly stated.
- `bd dolt push` succeeds.
- `git push forgejo <branch>` succeeds.
- `git status` shows the branch is up to date with `forgejo/<branch>`.
