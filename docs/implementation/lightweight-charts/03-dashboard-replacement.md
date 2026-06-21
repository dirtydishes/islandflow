# Phase 03: Dashboard Replacement and Terminal Adapter

Beads issue: `islandflow-mloi.3`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Replace the dashboard chart with the reusable market-chart module while preserving the Market Command workflow. The dashboard should no longer depend on a chart component that owns terminal-specific rendering, controls, and data concerns.

## Current State

- `OverviewRoute` renders `ChartPane state={state} title="Chart Context"`.
- `ChartPane` wraps `CandleChart` in terminal `Pane` chrome.
- `CandleChart` fetches, subscribes, draws overlays, maps markers, and renders controls.
- Existing dashboard layout assigns the chart area through `.market-command-grid > :nth-child(2)`.

## Scope

- Create `apps/web/features/terminal/chart-adapter.tsx`.
- Map `TerminalState` into market-chart props:
  - Symbol.
  - Interval.
  - Live and replay candles.
  - Equity overlay prints.
  - Smart-flow projections.
  - Legacy smart-money fallback events.
  - Inferred dark events.
  - Marker click callbacks.
  - Status and last-update metadata.
- Replace `ChartPane` usage in `OverviewRoute` with the reusable `MarketChartSection` or a terminal adapter component.
- Preserve live and replay behavior.
- Preserve marker click behavior for smart-flow, smart-money fallback, and inferred dark events.
- Replace nth-child chart grid targeting with a stable class such as `.market-command-chart`.

## Visual Requirements

- The chart module is not a card.
- Use flat terminal section styling:
  - no decorative shadow
  - radius `0`
  - top and bottom rules
  - restrained grid
  - dense toolbar
- Default chart background should match `bg-pane-2` or the existing chart surface tone.
- The toolbar should fit in desktop dashboard and mobile stacked layouts.
- Avoid visible instructional copy. Controls should be self-explanatory through labels and tooltips.

## Adapter Contract

The adapter is allowed to import terminal state and formatters. The reusable chart module is not.

```text
TerminalState -> terminal/chart-adapter.tsx -> MarketChartProps
```

If a field cannot be represented cleanly, add a typed adapter transform instead of leaking terminal state into the chart module.

## Separate Work

Keep separate:

- Settings menu.
- Additional lower-pane modes.
- Heikin Ashi.
- Rounded custom bar renderer.
- Full chart route creation.

## Parallel Work

This phase should stay mostly serial. Small parallel lanes are acceptable for:

- CSS class inventory and responsive layout checks.
- Adapter transform test drafts.
- Visual QA after the implementation is running.

## Subagent Delegation Guidance

Appropriate subagent tasks:

- Inventory CSS selectors that target `.chart-panel`, `.chart-surface`, `.chart-controls`, and dashboard chart placement.
- Draft adapter test cases for smart-flow-first and smart-money-fallback marker mapping.
- Run a browser screenshot pass after the main implementation.

Main agent must own:

- The dashboard replacement.
- Adapter boundaries.
- Any behavior changes to live/replay chart data.

## Acceptance Gates

- Dashboard uses the reusable market-chart module.
- `features/market-chart` still has no terminal imports.
- Marker callbacks still open the correct drawers or evidence surfaces.
- Live mode shows current candle data.
- Replay mode respects replay time.
- Dashboard layout remains dense and uncarded.
- Mobile layout does not overflow toolbar controls.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`
- Browser visual check on dashboard desktop and mobile.

## PR Guidance

Prefer one integration PR. Do not include settings, Heikin Ashi, or hover readout polish unless the replacement cannot be reviewed without a small supporting piece.
