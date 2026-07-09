# Market Command Dashboard Replacement Implementation Loop

Workflow: `orchestrator-callback`

Canonical tracker: Beads epic `islandflow-mcmd`

This stream is driven by Beads. These docs are execution context and resume aids. If Beads and these docs disagree, Beads wins.

## Goal

Replace the current root Market Command dashboard at `/` with a scrollable production command surface built from durable modules already in the repo. The board should use a server-ranked ticker rail, first-class board ticker focus, chart plus smart-flow context, alerts triage, flow packets, options tape, and full-width news without creating a hidden v2 route.

## Sources Of Truth

- Beads epic: `islandflow-mcmd`
- Roadmap: `docs/implementation/market-command-dashboard/00-roadmap.md`
- Loop state mirror: `docs/implementation/market-command-dashboard/loop-state.md`
- Run prompt: `docs/implementation/market-command-dashboard/prompts/run-loop.md`
- Implementation thread prompt: `docs/implementation/market-command-dashboard/prompts/implementation-thread.md`
- Review thread prompt: `docs/implementation/market-command-dashboard/prompts/review-thread.md`
- Phase docs linked from Beads child issues
- Turn docs: `docs/implementation/market-command-dashboard/turn-docs/`
- Callback schemas: `docs/implementation/market-command-dashboard/schemas/`
- Existing root route: `apps/web/app/terminal.tsx`
- Existing terminal state/modules: `apps/web/features/terminal/`
- Existing durable panes and contracts: `apps/web/features/durable-tape/`, `packages/types/src/`

## Locked Product Shape

```text
Top chrome:
  status / replay / health controls
  focus ribbon
  pinned + important-now ticker rail

Main:
  [ 2/3 Chart with smart-flow lower pane ] [ 1/3 Alerts triage ]

Below:
  [ 1/3 Flow Packets ] [ 2/3 Options Tape ]

Bottom:
  [ Full-width News Wire ]
```

Clicking a ticker applies a board-wide filter. Chart, alerts, flow packets, options tape, and news scope to that symbol, with visible clear controls.

## Loop Rules

- Select exactly one next ready Beads child issue.
- Read the linked phase doc before editing.
- Keep one active implementation PR at a time unless Beads and the phase doc explicitly allow parallel work.
- File Beads follow-ups instead of widening the selected phase.
- Update Beads first, then update `loop-state.md`.
- Use bounded subagent swarms when useful.
- Follow repo branch rules. Do not create a branch unless the user explicitly assigns one in the current conversation.
- Forgejo is canonical when a branch and PR are part of the selected phase. Do not use GitHub for this repo.

## Review And CI

Reviewer agents must use:

`thermo-nuclear-code-quality-review`

Reviewer and CI verification agents own CI.

Allowed CI closeout states:

- `ci-green`
- `ci-repaired-and-green`
- `ci-unavailable-with-evidence`
- `ci-blocked-with-cause`

Unknown CI is not approval.

## Turn Docs

Each phase has exactly one Markdown turn doc:

`docs/implementation/market-command-dashboard/turn-docs/<phase-id>.md`

Implementation, review, CI, repairs, PR state, Beads updates, follow-ups, and closeout all go into the same doc.

## Storyboard

When the epic is complete, generate:

`docs/implementation/market-command-dashboard/storyboard-post-run-07-02-2026.html`

Use `impeccable` when present. If missing, continue without it and note that it was skipped.

Install `@pierre/diffs` in the target repo if missing. Every storyboard diff must use `@pierre/diffs/ssr`.

Status: generated and Chromium-verified on 2026-07-02 after Phase 08 closeout.

## Phase Ledger

| Beads Issue | Phase | Phase Doc | Depends On | Status |
|---|---|---|---|---|
| `islandflow-mcmd.1` | 01 - Server ranking contract | `docs/implementation/market-command-dashboard/01-server-ranking-contract.md` | None | Closed, merged via PR #102 |
| `islandflow-mcmd.2` | 02 - Ticker rail and board focus model | `docs/implementation/market-command-dashboard/02-ticker-rail-focus-model.md` | `islandflow-mcmd.1` | Closed, merged via PR #103 |
| `islandflow-mcmd.3` | 03 - Root route feature upgrade | `docs/implementation/market-command-dashboard/03-route-feature-upgrade.md` | `islandflow-mcmd.2` | Closed, merged via PR #104 |
| `islandflow-mcmd.4` | 04 - Dashboard layout replacement | `docs/implementation/market-command-dashboard/04-dashboard-layout-replacement.md` | `islandflow-mcmd.3` | Closed, merged via PR #105 |
| `islandflow-mcmd.5` | 05 - Hybrid detail drawer model | `docs/implementation/market-command-dashboard/05-hybrid-detail-model.md` | `islandflow-mcmd.4` | Closed, merged via PR #106 |
| `islandflow-mcmd.6` | 06 - News relevance ordering | `docs/implementation/market-command-dashboard/06-news-relevance-ordering.md` | `islandflow-mcmd.5` | Closed, merged via PR #107 |
| `islandflow-mcmd.7` | 07 - Polish, performance, and visual QA | `docs/implementation/market-command-dashboard/07-polish-performance-visual-qa.md` | `islandflow-mcmd.6` | Closed, merged via PR #108 |
| `islandflow-mcmd.8` | 08 - Deterministic drawer browser fixture | `docs/implementation/market-command-dashboard/08-deterministic-drawer-browser-fixture.md` | `islandflow-mcmd.5` (discovered from) | Closed, merged via PR #109 |

## Quality Gates

Use phase-specific gates first. Common gates:

```bash
bun test
bun --cwd=apps/web run build
```

UI phases also require real Chromium browser verification for `/` at desktop and mobile widths. Degraded ranking fallback, reduced motion, overlay-free rendering, and no horizontal overflow must be checked before UI phase closeout.

## Branch And PR Policy

- Follow repo instructions in `AGENTS.md`.
- Do not create a new git branch automatically. If already on `main`, stay on `main` unless the user explicitly asks for a branch.
- When running this orchestrator loop, the orchestrator must assign an explicit phase branch and prepared worktree before launching an implementation thread.
- Workers must use only the assigned branch/worktree and must not invent branch names.
- When a branch is assigned, push to `forgejo` and use Forgejo PR workflows.
- Do not merge completed PRs unless the user explicitly asks.

## Orchestrator Callback Workflow

Topology:

```text
orchestrator thread
  -> selector subagent chooses the next ready Beads child issue
  -> orchestrator creates one visible implementation thread
  -> implementation thread may use scout/helper subagents
  -> implementation thread opens or updates one Forgejo PR
  -> implementation thread calls back exactly once
  -> orchestrator creates one visible review thread
  -> review thread uses thermo-nuclear-code-quality-review
  -> review thread owns CI, safe repairs, reruns, and evidence
  -> review thread calls back exactly once
  -> orchestrator updates Beads and loop state
  -> orchestrator selects the next phase or stops with a concrete state
```

The orchestrator owns Beads state, phase selection, visible project-scoped thread creation, callback routing, phase closeout, and stream closeout. It does not implement phase code.

Implementation threads own exactly one selected Beads issue, the assigned branch/worktree, implementation, local gates before PR when feasible, Forgejo PR creation, the existing phase turn doc, and the implementation callback. Implementation threads do not create review threads.

Review threads own the thermo-nuclear review, reviewer/CI verification swarms, CI diagnosis, safe in-scope repairs, reruns, evidence, the existing phase turn doc, and the review callback. Review threads do not create follow-up implementation threads or close Beads issues.

Worker and reviewer threads should be visible project-scoped Islandflow threads using regular `xhigh` reasoning. Do not use projectless/local threads or fast-mode/model overrides.

Before launching a worker or reviewer, capture the literal orchestrator thread id and pass that exact id as the callback target. A delegated prompt that says only "the orchestrator" or "current thread" is invalid.

Callbacks are single-shot. Use the schemas in `docs/implementation/market-command-dashboard/schemas/`.
