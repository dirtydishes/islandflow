# Implementing Durable-Tapes Performance Hardening

This directory is the active implementation guide for making `/durable-tapes` viable on low-power client devices.

Readable plan: [`plan.html`](./plan.html).

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Only work on a phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-ze79` - Durable-tapes performance hardening

Phase issues:

| Phase | Beads issue | Phase doc | Depends on | PR posture |
| --- | --- | --- | --- | --- |
| 00 - Perf probe and budgets | `islandflow-ze79.1` | [`00-perf-probe-guardrail.md`](./00-perf-probe-guardrail.md) | None | One focused probe/docs PR. No product behavior changes. |
| 01 - Hydration scheduler and caches | `islandflow-ze79.2` | [`01-hydration-scheduler-cache.md`](./01-hydration-scheduler-cache.md) | `islandflow-ze79.1` | Urgent frontend stabilization PR. Keep rendering semantics unchanged. |
| 02 - Bound by-trace lookup | `islandflow-ze79.3` | [`02-option-prints-lookup-bounds.md`](./02-option-prints-lookup-bounds.md) | `islandflow-ze79.1` | Urgent API/storage safety PR. Can run after Phase 00 and parallel with Phase 01 if workers coordinate probe expectations. |
| 03 - Pane-scoped live state | `islandflow-ze79.4` | [`03-pane-scoped-live-state.md`](./03-pane-scoped-live-state.md) | `islandflow-ze79.2`, `islandflow-ze79.3` | One state architecture PR. Avoid UI redesign and server view-model work. |
| 04 - Incremental live buffers | `islandflow-ze79.5` | [`04-incremental-live-buffers.md`](./04-incremental-live-buffers.md) | `islandflow-ze79.4` | One mechanics PR. Keep ordering and eviction semantics test-first. |
| 05 - Server-composed view models | `islandflow-ze79.6` | [`05-server-composed-view-models.md`](./05-server-composed-view-models.md) | `islandflow-ze79.3`, `islandflow-ze79.5` | Larger architecture PR or split into API and frontend child issues if it grows. |
| 06 - Production hardening and closeout | `islandflow-ze79.7` | [`06-production-hardening-closeout.md`](./06-production-hardening-closeout.md) | `islandflow-ze79.6` | Final verification, smoke checks, and observability PR. |

The original diagnosis bug is `islandflow-ba9q` and is linked as discovered context for this epic. Keep it open until the request storm and API hang are actually fixed in production.

## How To Pick Up Work

1. Run `bd prime`.
2. Run `bd ready`.
3. Pick the next ready `islandflow-ze79.*` issue.
4. Run `bd show <issue-id>` and read its `spec_id`.
5. Read this `IMPLEMENT.md`.
6. Read the linked phase document.
7. Claim the issue with `bd update <issue-id> --claim`.
8. Implement only that phase unless the phase doc explicitly names a split.

## Orchestrator Thread Loop

When this stream is run from an orchestrator thread, the orchestrator should not hand-pick work from memory or from chat summaries.

Loop:

1. Read this `IMPLEMENT.md`.
2. Start with a narrow selector subagent.
3. The selector must run `bd prime`, `bd ready`, filter for `islandflow-ze79.*`, run `bd show <issue-id>`, read the linked `spec_id`, and report the next ready task, dependency state, safe parallelism, and any blocking contracts.
4. The orchestrator creates an implementation worker thread only for selector-approved ready work.
5. The worker receives this `IMPLEMENT.md`, the full linked phase document, the Beads issue ID, relevant quality gates, branch and PR posture from the phase table, turn-doc location, and the orchestrator thread ID.
6. The worker follows repo branch rules. Do not create a branch unless the orchestrator explicitly assigns one.
7. The worker keeps the PR phase-bounded and does not create the reviewer thread.
8. The worker messages the orchestrator thread exactly once when the assigned task is complete, PR-ready, or genuinely blocked.
9. The callback includes changed files, commit/PR state, tests/builds/browser probes, Beads updates, `bd dolt push` status, git push status, follow-up issue IDs, and known risks.

Reviewer handoff:

- Create a separate reviewer thread after the worker reports completion or opens the assigned PR.
- Pass the reviewer the full phase doc, this `IMPLEMENT.md`, PR URL, branch, worker callback summary, orchestrator thread ID, and existing turn-doc path.
- The reviewer uses a real code-review stance: findings first, ordered by severity, with file/line references.
- The reviewer owns CI verification, including after reviewer repair commits.
- If repair is safe and in scope, the reviewer may repair on the same branch/PR.
- If a real issue is out of scope, the reviewer files a focused follow-up Beads issue instead of widening the PR.
- The reviewer updates the existing phase turn document under `docs/implementation/durable-tapes-performance/turn-docs/`; do not create a separate reviewer turn doc.
- The reviewer messages back only when review, repair, CI/local gate state, Beads updates, and push state are resolved.

Closeout:

1. Read the reviewer callback.
2. If review is blocked, route the blocker to the correct worker/resolver and do not merge.
3. If review is complete and CI is green, merge or close out according to Forgejo workflow.
4. Sync Beads state with `bd dolt push`.
5. Push code to Forgejo and verify `git status --short --branch` is clean and up to date.
6. Rerun selector for the next ready phase.

Keep one active implementation PR at a time unless this file or the phase doc explicitly allows parallelism. The only early parallelism allowed here is Phase 01 and Phase 02 after Phase 00 lands.

## Current Diagnosis

The raw websocket feed is not large enough to explain the user-visible meltdown by itself. The known load multipliers are:

- Browser support hydration repeatedly requests `/lookup/options-support`.
- Alert and evidence decoration repeatedly requests `/option-prints/by-trace`.
- Many requests are aborted because React effects are keyed to changing live arrays, resolved maps, visible alert arrays, or newly created `Set` values.
- The frontend can ask for the same missing trace IDs across modules and across time without sharing in-flight work or recent misses.
- A direct `/option-prints/by-trace` miss path can hang long enough to hit request timeouts.
- The durable-tapes route composes several busy panes through shared terminal state, so unrelated panes and derived maps can wake up on each live message.
- Hot live windows still rely on whole-window merge/dedupe/sort/slice mechanics in some paths.

The immediate target is not a Rust rewrite. The first target is to stop multiplying work per live event.

## Target Module Direction

Prefer deeper modules with small interfaces and hidden complexity.

Near-term frontend module:

```ts
type HydrationScheduler = {
  requestOptionSupport(input: OptionSupportRequest): Promise<OptionSupportResult>;
  requestOptionPrints(traceIds: string[]): Promise<OptionPrintLookupResult>;
  invalidate(keys: HydrationInvalidationKey[]): void;
};
```

The interface should hide batching, dedupe, in-flight reuse, negative caching, request timing, and route-specific call sites. Callers should provide missing IDs and consume results. They should not know how requests are grouped.

Mid-term live state direction:

```text
options pane -> options slice
alerts pane -> alerts slice + shared hydration cache
flow pane -> flow slice
equities pane -> equities slice
news pane -> news slice
```

Long-term server direction:

```text
raw events + storage joins + classifier/NBBO/evidence context
  -> durable-tape row view model or coarse decorated delta
  -> frontend inserts/updates ready-to-render rows
```

## Quality Gates

Use phase-specific gates first. Common gates:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test apps/web/features/terminal apps/web/features/durable-tape
bun test services/api/tests packages/storage/tests
bun --cwd=apps/web run build
```

Browser/perf phases should run the Phase 00 probe against local web with the local API unless the phase says otherwise:

```bash
bun run dev:web
bun run scripts/probes/durable-tapes-perf.ts \
  --target=http://localhost:3000/durable-tapes \
  --warmup=30s \
  --duration=180s \
  --output=docs/implementation/durable-tapes-performance/baselines/<phase>-local-api.json
```

Production verification must use the native deployed route only when explicitly required by the phase and must not mutate production except through the assigned deploy step.

The Phase 00 baseline and budget profile are recorded in [`00-perf-probe-guardrail.md`](./00-perf-probe-guardrail.md). Omit `--no-fail-on-budget` for gate runs; include it only when intentionally recording a red baseline without failing the shell session.

## PR Guidance

- Keep PRs phase-bounded.
- Phase 00 must not smuggle runtime behavior changes into the probe.
- Phase 01 must not redesign pane state or server contracts; it should stop request storms with the existing data model.
- Phase 02 must not change frontend rendering except where a client test is needed to prove endpoint behavior.
- Phase 03 must not introduce server-composed row models.
- Phase 04 must preserve ordering, dedupe, and eviction semantics exactly.
- Phase 05 can split into API/storage and frontend child issues if the row-model contract is too large for one review.
- Phase 06 is closeout, smoke, fallback, and observability only.
- File follow-up Beads issues for adjacent cleanup instead of widening phase scope.

## Subagent Delegation

Subagents are useful for bounded, read-heavy or verification-heavy tasks. The main agent remains responsible for reading required skill docs, final interface decisions, edits, Beads state, commits, and pushes.

Good delegation targets:

- Inventory all current support/evidence lookup call sites and dependencies.
- Review storage/API tests for `/option-prints/by-trace` hit and miss coverage.
- Run the perf probe on a completed branch and summarize request counts and CDP metrics.
- Audit pane subscriptions to prove which panes wake up on options, alerts, flow, equities, or news updates.
- Review server row-model contracts against existing options, alerts, flow, NBBO, and classifier semantics.

Do not delegate:

- Deciding the public hydration scheduler interface.
- Deciding the server-composed row model contract.
- Changing Beads dependencies.
- Creating branches or pull requests.
- Committing, pushing, merging, or closing issues.
- Reading or interpreting skill instructions.

## Turn Documents

Repository implementation turn docs for this stream belong under:

```text
docs/implementation/durable-tapes-performance/turn-docs/
```

Use one canonical turn document per phase. Reviewers update the existing phase turn doc instead of creating a separate reviewer document.

Docs-only planning changes that only create or update this implementation plan are exempt from turn-document creation under the repo's minor/trivial documentation rule.
