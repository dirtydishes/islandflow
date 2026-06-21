# Implementing the Reusable Lightweight Charts Module

This directory is the active implementation guide for replacing the dashboard chart with a durable `lightweight-charts` module that can be reused across Islandflow surfaces.

Readable plan: [`PLAN.html`](./PLAN.html).

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Only work on a phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-mloi` - Plan reusable lightweight-charts market chart module

Phase issues:

| Phase | Beads issue | Phase doc | Depends on | PR posture |
| --- | --- | --- | --- | --- |
| 01 - Chart foundation and dependency upgrade | `islandflow-mloi.1` | [`01-chart-foundation.md`](./01-chart-foundation.md) | None | One focused PR. Do not stack UI behavior on a dependency upgrade unless the upgrade is trivial. |
| 02 - Timeframes and candle interval support | `islandflow-mloi.2` | [`02-timeframes-candles.md`](./02-timeframes-candles.md) | `islandflow-mloi.1` | Can be a stacked PR after Phase 01. Backend 15m support can split if it touches services heavily. |
| 03 - Dashboard replacement and terminal adapter | `islandflow-mloi.3` | [`03-dashboard-replacement.md`](./03-dashboard-replacement.md) | `islandflow-mloi.1`, `islandflow-mloi.2` | One integration PR. Avoid mixing settings and visual polish here. |
| 04 - Settings menu and lower-pane modes | `islandflow-mloi.4` | [`04-settings-lower-pane.md`](./04-settings-lower-pane.md) | `islandflow-mloi.3` | Stack on Phase 03 only if review latency requires it. Split pure transforms from UI if large. |
| 05 - Hover readout, rounded bars, and visual hardening | `islandflow-mloi.5` | [`05-hover-readout-visual-hardening.md`](./05-hover-readout-visual-hardening.md) | `islandflow-mloi.4` | Prefer one PR after settings. Split custom bar renderer if it becomes complex. |
| 06 - Final verification and publishing | `islandflow-mloi.6` | [`06-final-verification.md`](./06-final-verification.md) | `islandflow-mloi.5` | Final verification PR or closeout commit only. Do not add new feature scope. |

## How To Pick Up Work

1. Run `bd ready`.
2. Pick the next ready `islandflow-mloi.*` issue.
3. Run `bd show <issue-id>` and read its `spec_id`.
4. Read this `IMPLEMENT.md`.
5. Read the linked phase document.
6. Claim the issue with `bd update <issue-id> --claim`.
7. Implement only that phase unless the phase doc explicitly names a separable lane.

## Architecture Goal

The target module is a reusable chart system, not a dashboard component. Terminal state, WebSocket subscriptions, REST fetching, and drawer callbacks stay outside the module in adapters.

Preferred shape:

```text
apps/web/features/market-chart/
  index.ts
  types.ts
  defaults.ts
  transforms/
    candles.ts
    lower-pane.ts
    hover.ts
    timeframes.ts
  hooks/
    useMarketChartController.ts
    useChartCrosshair.ts
    useChartSettings.ts
  components/
    MarketChart.tsx
    MarketChartSection.tsx
    MarketChartToolbar.tsx
    MarketChartSettings.tsx
    MarketChartTooltip.tsx
apps/web/features/terminal/chart-adapter.tsx
```

`features/market-chart` must not import `TerminalState`, terminal transport helpers, route helpers, drawers, or terminal-specific panes. It can accept callbacks and already-normalized data.

## Extensibility Contract

The module should be easy to expand without forking dashboard code. Build explicit extension points, but keep them concrete enough that the first implementation remains understandable.

Required extension points:

- Price renderers: standard candles first, Heikin Ashi next, later bar/line/area modes.
- Lower panes: smart direction, all flow, plain volume first, later IV, volatility, alerts, liquidity, or custom indicators.
- Overlays: off-exchange prints first, later event bands, levels, VWAP, and replay annotations.
- Markers: smart-flow, smart-money fallback, and inferred dark first, later alert or user annotation markers.
- Toolbar actions: timeframe controls and settings first, later compare, detach, screenshot, or reset-view actions.
- Settings sections: price, lower pane, timeframes, display first, later extension-owned sections.
- Hover rows: core OHLC/volume rows first, extension rows appended by registered data layers.
- Layout presets: dashboard, full, compact, sparkline, and replay-context sizing without changing module internals.

Prefer typed registries or config objects over ad hoc prop growth when a capability is expected to recur. Do not introduce a plugin framework until a second real extension needs the same surface.

## PR Guidance

Use one PR at a time when:

- Upgrading `lightweight-charts` or changing chart lifecycle code.
- Replacing dashboard behavior visible to users.
- Touching both visual behavior and live/replay data subscriptions.
- Introducing a custom renderer for rounded lower-pane bars.

Use stacked PRs when:

- Phase 01 is waiting for review and Phase 02 only adds timeframe registry and 15m candle support.
- Phase 03 is waiting for review and Phase 04 starts with pure reducers/transforms.
- Phase 04 is waiting for review and Phase 05 starts with isolated hover aggregation tests.

Build into one PR when:

- The change is a pure docs update.
- The implementation is a tiny follow-up to a just-merged phase.
- A test-only adjustment belongs to the behavior PR it validates.

Split into separate PRs when:

- A backend interval change touches `services/candles`, API live subscriptions, and web UI together.
- A dependency upgrade produces unrelated type or API churn.
- A custom series or canvas renderer needs its own visual review.
- Settings persistence affects shared local storage helpers outside the chart module.

## Parallelization

The Beads graph is conservative. Use these lanes only when the phase doc agrees and the base dependencies are satisfied.

- Phase 01 can parallelize inventory and type design, but one implementer should own the actual dependency upgrade.
- Phase 02 can split backend candle interval support from UI favorite-timeframe controls.
- Phase 03 should stay serial because it replaces the dashboard user path.
- Phase 04 can split pure transforms from settings UI once the settings state shape is agreed.
- Phase 05 can split hover aggregation from visual QA and custom bar rendering.
- Phase 06 is serial.

## Subagent Delegation

Subagents are useful for bounded, read-heavy or test-heavy lanes. The main agent remains responsible for applying repo instructions, reading required skill docs, editing files, and closing the Beads loop.

Good delegation targets:

- Inventory current chart consumers and terminal state dependencies.
- Compare `lightweight-charts` v4 and v5 API deltas.
- Draft pure transform test cases for Heikin Ashi, timeframe favorites, and hover buckets.
- Run visual QA across dashboard sizes and report screenshots or findings.
- Audit copy for smart-flow certainty language and red/green-only meaning.

Do not delegate:

- Reading or interpreting required skill instructions.
- Deciding the final module API.
- Committing, pushing, or updating Beads status.
- Resolving dependency upgrade breakage without main-agent review.

## Required Gates

Each phase lists gates. Keep these commands in mind:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test
bun --cwd=apps/web run build
```

For UI phases, also run a browser visual check on dashboard desktop and mobile sizes before closeout.

## Scope Discipline

- The module must not be a card by default.
- The module must be extensible through typed data layers, settings sections, toolbar slots, and layout presets.
- The default visual lane is dense, flat, restrained, and aligned to the existing terminal interface.
- Red and green never carry direction alone. Include labels, position, or shape.
- Do not claim hidden participant identity. Use smart-flow hypothesis language where canonical data is available.
- Keep legacy smart-money compatibility as an adapter concern until the migration issue `islandflow-ghce` replaces it.
- Do not add historical calibration, new scoring policy, or new synthetic foundations in this implementation stream.

## Source References

- Existing chart implementation: `apps/web/features/terminal/components/charts.tsx`
- Existing terminal facade: `apps/web/app/terminal.tsx`
- Existing chart helpers: `apps/web/features/terminal/components/ui-helpers.ts`
- Current candle interval defaults: `apps/web/features/terminal/config.ts`, `services/candles/src/index.ts`
- Product/design context: `PRODUCT.md`, `DESIGN.md`
- Library docs: <https://tradingview.github.io/lightweight-charts/docs>
