# Phase 00: Durable-Tapes Perf Probe And Budgets

Beads issue: `islandflow-ze79.1`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Create the tight feedback loop for the `/durable-tapes` performance bug before changing behavior. Every later phase must be able to prove whether it reduced user-facing load.

## Problem

The current evidence shows a frontend request storm, high script time, and heap growth on the deployed route. The measurements were gathered manually. That is enough for diagnosis, but not enough for a safe multi-PR repair stream.

## Scope

- Add or document one repeatable browser/CDP probe for `/durable-tapes`.
- Record baseline metrics for local web against hosted API and for deployed native web when appropriate.
- Define budgets that fail on the known bad behavior.
- Keep the probe agent-runnable.
- Add row/pane sanity checks so the probe cannot pass on a blank or broken page.

## Required Metrics

The probe must capture:

- total network request count
- `/lookup/options-support` request count
- `/option-prints/by-trace` request count
- aborted request count
- response status distribution for support/evidence endpoints
- websocket frame count and bytes
- CDP `TaskDuration`
- CDP `ScriptDuration`
- CDP `JSHeapUsedSize` delta
- DOM node count
- visible durable pane count
- visible row count or equivalent page sanity signal

## Budget Direction

Initial budgets should be strict enough to catch the known bug but loose enough for live market variability.

Recommended starting budgets for a 3-minute run:

- support/evidence lookups are bounded and do not scale linearly with websocket messages
- aborted support/evidence fetches are near zero after warmup
- script/task time is materially lower than the diagnosed meltdown baseline
- heap growth does not continue unbounded
- all five durable panes still render live rows when data is available

Do not tune budgets to pass a broken page.

## Implementation Notes

Prefer a small script under an existing scripts/test location rather than an ad hoc notebook. Use Chrome/Playwright/CDP or the existing browser tooling. If a local browser binary is required, document the fallback clearly.

The probe should accept:

- target URL
- duration
- optional warmup
- output JSON path

## Quality Gates

Minimum gates:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun --cwd=apps/web run build
```

Probe gate:

```bash
WEB_DEV_PORT=3100 NEXT_PUBLIC_API_URL=https://api.flow.deltaisland.io bun run dev:web
```

Then run the new probe against `http://localhost:3100/durable-tapes`.

## Acceptance Criteria

- A repeatable probe exists and is documented.
- The probe is red-capable for the known request storm.
- Probe output includes the required metrics.
- The phase records an initial baseline.
- No runtime behavior changes are included.

## PR Guidance

One focused PR. This phase should be easy to review. If adding the probe requires a new package, justify it in the PR and keep it dev-only.

## Good Subagent Tasks

- Compare Playwright/CDP metric options and recommend the least invasive probe shape.
- Run the probe twice and compare variance.
- Inspect the output JSON for enough detail to debug failures without opening DevTools.
