# Phase 05: Equities Tape Module

Beads issue: `islandflow-h9c0.5`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Build a reusable durable equities tape for equity prints. This module should support ticker-scoped live/history inspection without being tied to the chart module.

## Current State

Equity print data already flows through terminal state and storage APIs:

- `/prints/equities`
- `/prints/equities/range`
- `/history/equities`
- `/ws/live` equity subscriptions

The UI does not yet expose equities as a standalone durable tape module.

## Scope

- Create `apps/web/features/equities-tape/`.
- Use the shared durable foundation for virtual rows, live/head, ClickHouse history, scroll hold, and templates.
- Support ticker scope and optional venue/off-exchange filters.
- Expose callbacks for ticker focus and print inspect.
- Keep chart overlays and candle rendering outside this module.

## Default Columns

Full template:

```text
TIME | TICKER | PX | SIZE | NOTIONAL | VENUE
```

Two-thirds template:

```text
TIME | TICKER | PX | SIZE
```

One-third template:

```text
TICKER | PX | SIZE
```

Off-exchange context can tint or badge rows, but hover/detail carries the full evidence.

## Detail Surface

Hover/focus should include:

- timestamp with milliseconds
- trace ID
- exchange
- off-exchange flag
- price
- size
- notional
- linked join or dark context if available through callbacks

## Parallel Work

Can parallelize after Phase 01:

- Equity print field inventory.
- Venue/off-exchange display rules.
- Column template matrix.
- Review existing equity history and range APIs.

Keep serial:

- Ticker focus contract.
- Any callback to chart or dark-context modules.
- Route or dashboard integration.

## Stacking Guidance

This can stack after Phase 01 and can run in parallel with Phase 04 or Phase 03. Do not stack it with chart-module changes unless the PR only passes callbacks to an already-merged chart interface.

## Subagent Guidance

Good subagent tasks:

- Inventory equity print, quote, join, and inferred-dark dependencies in terminal state.
- Draft accessible treatment for off-exchange and venue context.
- Check whether existing storage tests cover `/history/equities` filters.

Main agent must own:

- Keeping chart work out of the tape module.
- Ticker focus semantics.
- Any callback contract shared with chart or alerts.

## Acceptance Gates

- `EquitiesTape` is exported from `apps/web/features/equities-tape/`.
- The module supports live and historical equity prints.
- It can be embedded in dashboard-sized and route-sized parents.
- It does not import market-chart internals.
- No default template needs horizontal scrolling.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## Out Of Scope

- Candle chart changes.
- Dark inference algorithm changes.
- Equity quote module extraction.
