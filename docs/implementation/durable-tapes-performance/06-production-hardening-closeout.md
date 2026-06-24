# Phase 06: Production Perf Hardening And Closeout

Beads issue: `islandflow-ze79.7`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Add production guardrails so `/durable-tapes` cannot silently regress into high client load after the repair stream closes.

## Problem

The original incident included a deployment env mismatch and frontend request storms that were visible only after using a browser/network probe. Production needs smoke checks and counters that catch this class of problem earlier.

## Scope

- Add a deploy or smoke check that verifies public browser REST routing uses the intended API host or valid same-origin proxy.
- Add request-rate counters or browser-probe output suitable for regression checks.
- Add API latency visibility for support/evidence lookup endpoints.
- Add a feature flag or runtime kill switch for expensive decoration during incidents.
- Run final before/after probes.
- Update docs and close the Beads epic when production evidence is good.

## Guardrail Direction

At minimum, production checks should catch:

- missing or wrong `NEXT_PUBLIC_API_URL` in the web bundle
- `/lookup/options-support` returning web-host 404 HTML
- `/option-prints/by-trace` timing out on misses
- support/evidence request counts above budget
- excessive browser script/task time over the fixed probe window

## Quality Gates

Minimum gates:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test services/api/tests packages/storage/tests
bun --cwd=apps/web run build
```

Production verification:

- Run the Phase 00 probe against the deployed native route.
- Verify native web/API health checks.
- Verify support/evidence endpoints respond from the expected host.
- Record final numbers in the phase turn document and Beads closeout.

## Acceptance Criteria

- Production smoke catches bad public API routing.
- Lookup latency and request budget regressions have a repeatable check.
- A fallback flag can disable or reduce expensive decoration during incidents.
- Final deployed probe passes the agreed budgets.
- `islandflow-ba9q` is closed only after the user-facing meltdown is fixed.
- `islandflow-ze79` and all children are closed with before/after evidence.

## PR Guidance

This is a hardening and closeout phase. Do not use it to sneak in large architectural changes. File follow-ups for remaining architecture debt.

## Good Subagent Tasks

- Verify deployed native bundle/API routing without exposing secrets.
- Run final browser probe on desktop and constrained/mobile viewport.
- Audit docs and Beads closeout for enough evidence to resume later.
