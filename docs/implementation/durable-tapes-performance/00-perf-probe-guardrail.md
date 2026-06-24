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

## Probe Command

Phase 00 adds a Bun-run CDP probe at:

```bash
bun run scripts/probes/durable-tapes-perf.ts \
  --target=http://localhost:3100/durable-tapes \
  --warmup=30s \
  --duration=180s \
  --output=docs/implementation/durable-tapes-performance/baselines/phase-00-local-hosted-api.json
```

The script launches a local Chrome/Chromium browser when available. If the agent environment cannot find Chrome, start a browser manually with `--remote-debugging-port=<port>` and pass `--cdp-url=http://127.0.0.1:<port>`. `CHROME_PATH` or `--browser-path` can also point at a specific Chrome/Chromium executable.

The executable entrypoint remains `scripts/probes/durable-tapes-perf.ts`. Supporting modules live under `scripts/probes/durable-tapes-perf/` so CLI parsing, Chrome/CDP lifecycle, metric collection, budget evaluation, and run orchestration stay independently reviewable.

The default `durable-tapes-3m-v1` budget profile is intentionally red-capable for the known storm:

| Metric | 3-minute budget |
| --- | ---: |
| Total network requests | <= 500 |
| `/lookup/options-support` requests, including preflight | <= 150 |
| `/option-prints/by-trace` requests | <= 150 |
| Aborted requests | <= 20 |
| Aborted support/evidence requests | <= 8 |
| Support/evidence 4xx/5xx responses | <= 20 |
| CDP `TaskDuration` delta | <= 45s |
| CDP `ScriptDuration` delta | <= 35s |
| `JSHeapUsedSize` delta | <= 125 MiB |
| DOM node count | <= 35,000 |
| Visible durable pane count | >= 5 |
| Visible durable row count | >= 1 |

For shorter smoke runs, request and CPU budgets scale down from the three-minute profile with conservative minimums. The row sanity check is aggregate by default because a live channel can legitimately be quiet; the JSON report still records row counts for each pane so reviewers can reject a blank or suspicious run.

## Phase 00 Baseline

Baselines were captured with a 30-second warmup and a 180-second measurement window. Both reports kept five visible panes and 70 visible rows, so the failures are load failures rather than blank-page artifacts.

| Target | Budget | Requests | Support | By-trace | Aborts | Endpoint aborts | WS frames / bytes | Task / Script | Heap delta | Pane rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Local web + hosted API (`http://localhost:3100/durable-tapes`) | fail | 9,853 | 3,473 | 1,737 | 8,117 | 3,472 | 2,817 / 1,812,154 | 59.1s / 55.2s | 44.3 MiB | options 20, flow 20, equities 15, alerts 15, news 0 |
| Deployed web (`https://flow.deltaisland.io/durable-tapes`) | fail | 11,162 | 4,250 | 2,125 | 9,036 | 4,248 | 2,732 / 1,676,670 | 27.6s / 24.5s | 26.2 MiB | options 20, flow 20, equities 15, alerts 15, news 0 |

The support/evidence endpoint status distribution did not show endpoint 4xx/5xx responses in these captures. `/lookup/options-support` returned `204` for completed support responses, while the `/option-prints/by-trace` calls were mostly aborted before responses were observed. This points the next phases at client-side request fanout and abort churn, not a blank route or simple status-code failure.

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

Then run the probe against `http://localhost:3100/durable-tapes`. For baseline collection without a nonzero exit code, add `--no-fail-on-budget`; for a real gate, omit that flag so the known storm fails.

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
