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

## Implemented Guardrails

- Browser/CDP probe reports now include support/evidence origin distribution, content-type distribution, HTML/non-JSON response counts, endpoint latency summaries, and options/alerts pane row sanity budgets.
- Production smoke treats browser REST routing as valid only when the deployed bundle contains the intended API origin or both same-origin support and by-trace proxy endpoints return bounded JSON responses.
- Production smoke command:

```bash
bun run scripts/probes/durable-tapes-production-smoke.ts \
  --output=docs/implementation/durable-tapes-performance/baselines/phase-06-production-smoke.json
```

- Durable-tapes raw options/alerts fallback is disabled by default. Set `NEXT_PUBLIC_DURABLE_TAPES_RAW_FALLBACK=1` only when an incident requires reverting to the raw options/alerts channels while server-composed durable rows are unavailable.
- API latency visibility now includes `api.lookup.options_support_ms` for `/lookup/options-support`, matching the existing `/option-prints/by-trace` timing coverage.

## 2026-06-24 Production Evidence

Saved evidence:

- `baselines/phase-06-production-smoke.json`
- `baselines/phase-06-deployed-native-web.json`
- `turn-docs/2026-06-24-phase-06-production-hardening-closeout.html`

Current deployed native evidence is good enough for Phase 06 review:

- Native web/API were redeployed from `lavender/ze79-phase-06-production-hardening-closeout` with the narrow `web,api` native scope.
- Production smoke passes native web route, browser API-origin routing, API health, durable-row websocket snapshot, `/lookup/options-support` latency, and `/option-prints/by-trace` miss latency.
- The durable-row websocket check against `<raw-api-origin>/ws/live` returned a 10-row snapshot.
- The 30s warmup plus 180s deployed CDP probe passes request, script/task, heap, DOM, pane, options-row, and alerts-row budgets: 0 total measured network requests, 0 support/evidence requests, 0 aborted requests, 15.25s task duration, 11.24s script duration, 68 visible rows, 20 options rows, and 13 alerts rows.
- Explicit public support/evidence endpoint checks returned JSON from the raw API origin.

Deployment blocker `islandflow-ze79.11` is resolved by the saved smoke/probe evidence. `islandflow-ze79.7` is ready for review. Close `islandflow-ba9q` only with the same production evidence attached, and close `islandflow-ze79` after Phase 06 review/merge confirms the epic closeout state.

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
