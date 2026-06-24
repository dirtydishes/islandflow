# Implementing API Private Edge Hardening

This directory is the active implementation guide for making the hosted app the only public Islandflow product surface while treating the API host as private infrastructure.

Readable plan: [`plan.html`](./plan.html).

Use placeholders in docs and examples:

- `<production-app-origin>` for the hosted web app
- `<raw-api-origin>` for the direct API host that should not be advertised or used as a default
- `<internal-api-origin>` for SSH/VPN/server-local access to the API

Do not add concrete production domains to active docs, defaults, probes, or examples in this stream.

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Only work on a phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-hnbk` - Make public Islandflow API private behind the hosted UI

Phase issues:

| Phase | Beads issue | Phase doc | Depends on | PR posture |
| --- | --- | --- | --- | --- |
| 00 - Baseline edge exposure | `islandflow-hnbk.1` | [`00-baseline-edge-inventory.md`](./00-baseline-edge-inventory.md) | None | Probe/docs-only PR. No runtime behavior changes. |
| 01 - Active domain scrub | `islandflow-hnbk.2` | [`01-active-domain-scrub.md`](./01-active-domain-scrub.md) | `islandflow-hnbk.1` | Documentation/config hygiene PR. Keep product behavior unchanged. |
| 02 - Same-origin production transport | `islandflow-hnbk.3` | [`02-same-origin-production-transport.md`](./02-same-origin-production-transport.md) | `islandflow-hnbk.2` | Web/API edge contract PR. Do not close the raw API host yet. |
| 03 - API rate limiting | `islandflow-hnbk.4` | [`03-api-rate-limiting.md`](./03-api-rate-limiting.md) | `islandflow-hnbk.3` | API safety PR with focused tests and env-gated rollout. |
| 04 - Raw API host closure | `islandflow-hnbk.5` | [`04-raw-api-host-closure.md`](./04-raw-api-host-closure.md) | `islandflow-hnbk.3`, `islandflow-hnbk.4` | Deployment helper/edge PR. Same-origin app routes must already work. |
| 05 - Production rollout closeout | `islandflow-hnbk.6` | [`05-production-rollout-closeout.md`](./05-production-rollout-closeout.md) | `islandflow-hnbk.5` | Final deployment and verification PR/turn. Do not absorb new architecture work. |

## Current Decisions

- Hosted UI remains public for this stream.
- Browser traffic should use same-origin REST and websocket paths on the app origin.
- Direct public API access should end in a closed or 404-style posture.
- Legitimate direct API access is SSH/VPN/server-local only.
- A browser-shipped API key is not acceptable because it would be public.
- Same-origin public endpoints remain callable by determined clients; Phase 03 adds v1 throttling and observability, not full user authentication.

## How To Pick Up Work

1. Run `bd prime`.
2. Run `bd ready`.
3. Pick the next ready `islandflow-hnbk.*` issue.
4. Run `bd show <issue-id>` and read its `spec_id`.
5. Read this `IMPLEMENT.md`.
6. Read the linked phase document.
7. Claim the issue with `bd update <issue-id> --claim`.
8. Implement only that phase unless the phase doc explicitly says to split or parallelize.

## Orchestrator Thread Loop

When this stream is run from an orchestrator thread, the orchestrator owns selection and closeout. Helpers should not invent scope, create extra reviewer threads, or choose work from memory alone.

Loop:

1. Read this `IMPLEMENT.md`.
2. Start with a narrow selector subagent using `xhigh` reasoning.
3. The selector must run `bd prime`, `bd ready`, filter for `islandflow-hnbk.*`, run `bd show <issue-id>`, read the linked `spec_id`, and report the next ready task, dependency state, safe parallelism, and blocking contracts.
4. The orchestrator creates an implementation worker thread only for selector-approved ready work.
5. The worker receives this `IMPLEMENT.md`, the full linked phase document, the Beads issue ID, relevant quality gates, branch and PR posture from the phase table, turn-doc location, and the orchestrator thread ID.
6. The worker follows repo branch rules. Do not create a branch unless the orchestrator explicitly assigns one.
7. The worker keeps the PR phase-bounded and does not create the reviewer thread.
8. The worker messages the orchestrator thread exactly once when the assigned task is complete, PR-ready, or genuinely blocked.
9. The callback includes changed files, commit/PR state, tests/builds/browser probes, Beads updates, `bd dolt push` status, git push status, follow-up issue IDs, and known risks.

Reviewer handoff:

- Create a separate reviewer thread after the worker reports completion or opens the assigned PR.
- Use `xhigh` reasoning for the reviewer unless the orchestrator says otherwise.
- Pass the reviewer the full phase doc, this `IMPLEMENT.md`, PR URL, branch, worker callback summary, orchestrator thread ID, and existing turn-doc path.
- The reviewer uses a real code-review stance: findings first, ordered by severity, with file/line references.
- The reviewer owns CI verification, including after reviewer repair commits.
- If repair is safe and in scope, the reviewer may repair on the same branch/PR.
- If a real issue is out of scope, the reviewer files a focused follow-up Beads issue instead of widening the PR.
- The reviewer updates the existing phase turn document under `docs/implementation/api-private-edge/turn-docs/`; do not create a separate reviewer turn doc.
- The reviewer messages back only when review, repair, CI/local gate state, Beads updates, and push state are resolved.

Closeout:

1. Read the reviewer callback.
2. If review is blocked, route the blocker to the correct worker/resolver and do not merge.
3. If review is complete and CI is green, merge or close out according to Forgejo workflow.
4. Sync Beads state with `bd dolt push`.
5. Push code to Forgejo and verify `git status --short --branch` is clean and up to date.
6. Rerun selector for the next ready phase.

Keep one active implementation PR at a time unless a phase doc explicitly allows parallelism.

## Implementation Swarm Topology

Use this topology when the orchestrator wants broad inspection and review coverage for a phase. The numbers are target ranges for phases with enough surface area, not quotas for narrow edits.

1. Selector agent: picks the next ready `islandflow-hnbk.*` issue.
2. Scout swarm, 6-10 read-only agents: inspect different slices in parallel and report findings before implementation begins.
3. Single implementation worker: owns the branch, edits, tests, commit, PR, Beads state, and callback. It uses scout outputs as inputs.
4. Review swarm, 3-6 agents: run bounded review after the PR or worker completion callback.
5. One lead reviewer: consolidates findings, performs safe repairs, waits for CI/local gates, updates the phase turn doc, and calls back once.

Scout swarm slices:

- repo hostname/default inventory.
- web transport URL builders.
- API route and websocket inventory.
- NPM/deployment helper behavior.
- live server/env baseline.
- test coverage gaps.
- security/threat-model review.
- docs/probe references.

Review swarm roles:

- Security reviewer.
- Deployment reviewer.
- Frontend transport reviewer.
- API/rate-limit reviewer.
- Docs/Beads reviewer.
- CI/log reviewer.

Scout and review helpers must remain bounded. They may inspect, summarize, review, and propose; they do not mutate tracked files, update Beads, create or switch branches, commit, push, open PRs, contact the orchestrator independently, or make final scope decisions.

## Implementation Worker Subagents

Implementation workers may use bounded helper subagents when a phase benefits from parallel inspection, test mapping, or specialized review. This is optional, not a quota. Do not spawn helpers just to make a narrow phase look busy.

Worker-owned fanout model:

1. One implementation owner remains accountable for the phase.
2. The worker may launch bounded helper subagents when useful.
3. Helpers may inspect, inventory, test, review, model risk, and propose patches or follow-ups.
4. Helpers must not mutate tracked files, update Beads, create or switch branches, commit, push, create PRs, contact the orchestrator, or make final scope decisions.

Fan-in requirements:

- The worker must read every helper result before editing or calling back.
- Conflicting helper findings must be resolved by the worker, not by another helper.
- Helper output should be summarized in the worker callback only when it changed implementation choices, test coverage, or residual risk.
- If helper work exposes out-of-scope defects, the worker files focused follow-up Beads issues instead of widening the phase.

Good implementation helper targets:

- Phase 00: live edge inventory, repo hostname/default inventory, same-origin route coverage, bundle/probe exposure checks.
- Phase 01: active docs/examples inventory, dev-script/default config review, test fixture scan, product-constant exception audit.
- Phase 02: web transport builders, server-only proxy config, deployment route matcher coverage, production smoke probe behavior.
- Phase 03: rate-limit design review, API route categorization, forwarded-IP handling, rejection metrics/logging, focused test gaps.
- Phase 04: NPM database/helper durability, generated-config regeneration behavior, rollback path review, same-origin preservation checks.
- Phase 05: rollout checklist audit, live verification matrix, Beads/Forgejo closeout audit, final docs consistency.

Do not delegate:

- Reading or interpreting required skill instructions.
- Deciding the public/private API posture.
- Owning the implementation branch or PR.
- Closing phase issues or the epic.
- Final deployment decisions.

## Quality Gates

Use phase-specific gates first. Common gates:

```bash
bun test services/api/tests
bun test apps/web/features/terminal apps/web/features/news-wire apps/web/app/api/admin/synthetic
bun --cwd=apps/web run build
```

Production verification must use the deployed app origin only when explicitly required by the phase and must not mutate production except through the assigned deploy step.

## Turn Documents

Repository implementation turn docs for this stream belong under:

```text
docs/implementation/api-private-edge/turn-docs/
```

Use one canonical turn document per phase. Reviewers update the existing phase turn doc instead of creating a separate reviewer document.

Docs-only planning changes that only create or update this implementation plan are exempt from turn-document creation under the repo's minor/trivial documentation rule.
