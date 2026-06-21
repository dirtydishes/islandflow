# Phase 02: Timeframes and Candle Interval Support

Beads issue: `islandflow-mloi.2`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Make timeframes a first-class chart capability instead of a hard-coded dashboard control. The default toolbar should show `1m`, `5m`, and `15m`; users can favorite and unfavorite intervals, and the selected interval should drive live subscriptions and candle fetching consistently.

## Current State

- Web interval config currently includes `1m` and `5m` only.
- Candle service defaults currently include `60000,300000`.
- API candle endpoints accept `interval_ms`, but the service must emit and cache the intervals users can select.
- Live subscriptions are built from `chartIntervalMs`.

## Scope

- Add a reusable timeframe registry in `apps/web/features/market-chart/transforms/timeframes.ts`.
- Include `1m`, `5m`, and `15m` as default favorites.
- Add a dropdown model for additional intervals.
- Add favorite/unfavorite behavior:
  - Favorited intervals appear on the main toolbar.
  - Unfavoriting removes them from the main toolbar.
  - Current interval remains selectable even when unfavorited.
- Persist favorites in browser storage with a versioned key.
- Add 15m candle support in service defaults and local dev configuration.
- Update live subscription manifest tests so 15m selection is represented correctly.

## Timeframe Registry

Start with a conservative registry:

| Label | Milliseconds | Default favorite | Notes |
| --- | ---: | --- | --- |
| 1m | 60000 | Yes | Existing behavior. |
| 5m | 300000 | Yes | Existing behavior. |
| 15m | 900000 | Yes | New default favorite. |
| 30m | 1800000 | No | Optional if service support is enabled. |
| 1h | 3600000 | No | Optional if service support is enabled. |

Do not expose intervals that the running candle service cannot emit unless the UI clearly marks them unavailable.

## Data and State Rules

- Use a pure reducer for favorite toggles.
- Keep selected interval separate from favorites.
- Clamp malformed localStorage data back to defaults.
- Use the interval registry in both toolbar display and subscription construction.
- Do not create route-specific interval constants in dashboard code.

## Separate Work

Split into a separate PR if backend candle changes touch more than interval defaults:

- Candle aggregator behavior.
- Redis cache keys.
- ClickHouse storage query semantics.
- API endpoint validation.

## Parallel Work

Can parallelize after Phase 01:

- Backend 15m service/default support.
- UI favorite reducer and storage tests.
- Manifest/subscription test updates.

Keep serial:

- Final registry shape.
- Any user-facing toolbar integration that depends on Phase 03 dashboard replacement.

## Subagent Delegation Guidance

Appropriate subagent tasks:

- Inventory every `CANDLE_INTERVALS` and `interval_ms` use.
- Draft tests for favorite toggling, persistence fallback, and default favorites.
- Verify candle service defaults and local env examples that mention intervals.

Main agent must own:

- Final supported interval list.
- Live subscription behavior.
- Any service/API changes.

## Acceptance Gates

- `1m`, `5m`, and `15m` are default favorites.
- Users can favorite and unfavorite toolbar intervals.
- Dropdown exposes supported non-favorite intervals.
- Favorites persist and recover safely from malformed storage.
- Candle service defaults include 15m support.
- Route/live manifest tests cover interval changes.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- Relevant service/API tests if backend files changed.
- `bun --cwd=apps/web run build`

## PR Guidance

This can stack on Phase 01. If backend support is isolated and ready before the UI, it can land as a separate PR with no visible product change.
