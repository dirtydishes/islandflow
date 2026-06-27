# Options Smart-Flow Support And Triage Loop

Workflow: `orchestrator-callback`

Canonical tracker: Beads epic `islandflow-j06e`

This stream is driven by Beads. These docs are execution context and resume aids. If Beads and these docs disagree, Beads wins.

## Goal

Make options tape smart-flow support accurate, reusable, and cheap for the browser. The server should compose real support from direct option-print refs and flow-packet membership, the browser should render compact support payloads without reconstructing intelligence, and packet/detail interactions should remain phase-bounded.

## Sources Of Truth

- Beads epic: `islandflow-j06e`
- Roadmap: `docs/implementation/options-smart-flow-support-triage/00-roadmap.md`
- Loop state mirror: `docs/implementation/options-smart-flow-support-triage/loop-state.md`
- Run prompt: `docs/implementation/options-smart-flow-support-triage/prompts/run-loop.md`
- Implementation thread prompt: `docs/implementation/options-smart-flow-support-triage/prompts/implementation-thread.md`
- Review thread prompt: `docs/implementation/options-smart-flow-support-triage/prompts/review-thread.md`
- Phase docs linked from Beads child issues
- Turn docs: `docs/implementation/options-smart-flow-support-triage/turn-docs/`
- Callback schemas: `docs/implementation/options-smart-flow-support-triage/schemas/`
- Predecessor stream: `docs/implementation/options-tape-smart-flow-row-tinting/IMPLEMENT.md`
- Durable tapes module plan: `docs/implementation/durable-tapes/02-options-tape.md`
- Performance predecessor: `docs/implementation/durable-tapes-performance/05-server-composed-view-models.md`

## Current Alignment

- `support.smart_flow` means a real canonical smart-flow projection matched by direct option print ref or by flow-packet membership.
- Direct print refs can attach support even when no packet is known.
- If a row has only an option print `trace_id`, the API should hydrate packet membership by trace id in bounded batches.
- Hot cache is preferred, but ClickHouse or durable storage fallback is allowed for scroll/detail bounded requests.
- If multiple projections match, choose the highest-confidence non-abstained projection.
- Abstained or `unclear` outputs remain explainability or why-not context. They do not produce signal tint by default.
- The browser must not join packets, scan projection refs, or reconstruct evidence locally.
- `/qa` is a proving and diagnostic surface, not a fake data facade.
- Replay is out of scope for this stream.

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

`docs/implementation/options-smart-flow-support-triage/turn-docs/<phase-id>.md`

Implementation, review, CI, repairs, PR state, Beads updates, follow-ups, and closeout all go into the same doc.

## Storyboard

When the epic is complete, generate:

`docs/implementation/options-smart-flow-support-triage/storyboard-post-run-06-27-2026.html`

Use `impeccable` when present. If missing, continue without it and note that it was skipped.

Install `@pierre/diffs` in the target repo if missing. Every storyboard diff must use `@pierre/diffs/ssr`.

## Phase Ledger

| Beads Issue | Phase | Phase Doc | Depends On | Status |
|---|---|---|---|---|
| `islandflow-j06e.1` | 01 - Server-side smart-flow support resolver | `docs/implementation/options-smart-flow-support-triage/01-server-side-support-resolver.md` | None | Open |
| `islandflow-j06e.2` | 02 - Row support rendering and tint parity | `docs/implementation/options-smart-flow-support-triage/02-row-support-rendering-tint-parity.md` | `islandflow-j06e.1` | Open, blocked |
| `islandflow-j06e.3` | 03 - Packet and contract scope interactions | `docs/implementation/options-smart-flow-support-triage/03-packet-contract-scope-interactions.md` | `islandflow-j06e.2` | Open, blocked |
| `islandflow-j06e.4` | 04 - QA diagnostics and module settings | `docs/implementation/options-smart-flow-support-triage/04-qa-diagnostics-module-settings.md` | `islandflow-j06e.3` | Open, blocked |
| `islandflow-j06e.5` | 05 - More-info triage workspace | `docs/implementation/options-smart-flow-support-triage/05-more-info-triage-workspace.md` | `islandflow-j06e.4` | Open, blocked |

## Quality Gates

Use phase-specific gates first. Common gates:

```bash
bun test services/api/tests
bun test apps/web/features/terminal/hydration-scheduler.test.ts apps/web/features/options-tape
bun test apps/web/features/durable-tape apps/web/features/options-tape
bun --cwd=apps/web run build
```

UI phases also require browser verification for `/options` and `/qa` at desktop and mobile widths. Packet/detail phases must prove that scroll-bounded pagination does not load unbounded rows or evidence payloads.

## Branch And PR Policy

- Follow repo instructions in `AGENTS.md`.
- Do not create a new git branch automatically. If already on `main`, stay on `main` unless the user explicitly asks for a branch.
- If the current checkout is detached or has no publishable branch, stop before implementation edits and ask for an explicit branch or publish target.
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

The orchestrator owns Beads state, phase selection, thread creation, callback routing, phase closeout, and stream closeout. It does not implement phase code.

Implementation threads own exactly one selected Beads issue, the assigned branch/worktree, implementation, local gates before PR when feasible, Forgejo PR creation, the existing phase turn doc, and the implementation callback. Implementation threads do not create review threads.

Review threads own the thermo-nuclear review, reviewer/CI verification swarms, CI diagnosis, safe in-scope repairs, reruns, evidence, the existing phase turn doc, and the review callback. Review threads do not create follow-up implementation threads or close Beads issues.

Worker and reviewer threads should be visible project-scoped Islandflow threads using regular `xhigh` reasoning. Do not use projectless/local threads or fast-mode/model overrides.

Callbacks are single-shot. Use the schemas in `docs/implementation/options-smart-flow-support-triage/schemas/`.
