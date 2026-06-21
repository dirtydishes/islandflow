# Phase 01: Chart Foundation and Dependency Upgrade

Beads issue: `islandflow-mloi.1`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Create the durable chart module boundary before adding new chart behavior. The current `CandleChart` owns too many responsibilities: chart lifecycle, live data setup, REST fetching, overlay drawing, marker mapping, pane chrome, and terminal callbacks. This phase separates reusable chart rendering from terminal-specific data wiring.

## Current State

- `apps/web/package.json` already depends on `lightweight-charts`.
- The current chart component lives in `apps/web/features/terminal/components/charts.tsx`.
- Chart helpers live in `apps/web/features/terminal/components/ui-helpers.ts`.
- Dashboard uses `ChartPane` through `apps/web/app/terminal.tsx`.
- The current package version is `^4.2.0`; current library docs include pane APIs that are better suited for the desired price pane plus lower flow/volume pane.

## Scope

- Create `apps/web/features/market-chart/`.
- Define reusable chart input types that do not mention terminal state.
- Move chart time conversion, interval labels, candle transforms, and chart theme defaults into the new module.
- Add a chart lifecycle hook that owns `createChart`, series creation, resize handling, crosshair subscription, and cleanup.
- Decide the dependency strategy:
  - Preferred: upgrade `lightweight-charts` to the current 5.x line and use pane support.
  - Fallback: keep 4.2 and build two synced chart instances only if the upgrade is too risky for a phase-sized PR.
- Preserve the existing dashboard chart behavior until Phase 03 swaps the rendering path.

## Target Module API

The module should expose controlled, reusable components:

```ts
export type MarketChartProps = {
  symbol: string;
  intervalMs: number;
  candles: MarketChartCandle[];
  lowerSeries?: MarketChartLowerSeries;
  markers?: MarketChartMarker[];
  overlays?: MarketChartOverlay[];
  settings: MarketChartSettingsState;
  status?: MarketChartStatus;
  replayTime?: number | null;
  onVisibleRangeChange?: (range: MarketChartRange | null) => void;
  onMarkerClick?: (marker: MarketChartMarker) => void;
  onCrosshairChange?: (snapshot: MarketChartHoverSnapshot | null) => void;
};
```

Keep transport and fetching out of this API. The terminal adapter can fetch candles and prepare data before passing props.

## Extensibility Requirements

Phase 01 should establish the extension shape even if later phases fill in the first full set of extensions.

Required foundations:

- A normalized `MarketChartCandle` type that can drive multiple price renderers.
- A lower-pane data layer type that can represent volume, notional, signed direction, and future indicator values.
- A marker type that carries display fields plus an opaque payload for adapter callbacks.
- A hover snapshot model that can accept appended rows from overlays or lower-pane layers.
- A settings state shape that can grow through namespaced sections.
- A layout preset type for dashboard, full, compact, and embedded chart use.
- Theme defaults expressed as tokens or options, not hard-coded throughout components.

Avoid making every future idea generic on day one. The goal is clear module seams and typed extension points, not a speculative framework.

## Proposed Files

```text
apps/web/features/market-chart/
  index.ts
  types.ts
  defaults.ts
  transforms/candles.ts
  transforms/time.ts
  transforms/lower-pane.ts
  hooks/useMarketChartController.ts
  hooks/useChartCrosshair.ts
  components/MarketChart.tsx
  components/MarketChartSection.tsx
```

`MarketChartSection` is an optional flat shell that matches Islandflow terminal styling. It must not use card framing or decorative shadow.

## Design Requirements

- Default background matches existing terminal pane surfaces.
- Default chart grid is low contrast and operational.
- Candles use semantic green/red but tooltips and labels carry direction text.
- The module supports dense sizes without text overflow.
- The chart can be embedded in dashboard, full-width chart page, replay context, or compact symbol module.

## Separate Work

Keep these separate from Phase 01 unless they are required to keep the app compiling:

- Dashboard replacement.
- Timeframe favorites.
- Settings popover.
- Rounded lower-pane bars.
- Hover readout content beyond basic crosshair plumbing.

## Parallel Work

Can parallelize:

- Read-only inventory of current chart consumers.
- API-delta research for `lightweight-charts` v4 to v5.
- Drafting pure type and transform tests.

Keep serial:

- Actual dependency upgrade.
- Chart lifecycle implementation.
- Public module API decisions.

## Subagent Delegation Guidance

Appropriate subagent tasks:

- Inventory current imports of `CandleChart`, `ChartPane`, `formatIntervalLabel`, and chart helpers.
- Compare v4 and v5 chart APIs used by this repo: candlesticks, markers, histogram or pane APIs, crosshair subscription, resize behavior.
- Draft a short risk list for dependency upgrade fallout.

Main agent must own:

- Final API shape.
- Dependency upgrade edits.
- Test and build fixes.

## Acceptance Gates

- Reusable module folder exists and exports typed chart primitives.
- Module types include extension points for price renderers, lower panes, overlays, markers, hover rows, settings sections, and layout presets.
- Existing dashboard behavior still works through the current path or a compatibility wrapper.
- `lightweight-charts` 5.x upgrade is complete, or the fallback decision is documented in this file and in Beads.
- No terminal-specific state imports exist inside `apps/web/features/market-chart/`.
- Focused tests cover any moved pure transforms.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## PR Guidance

Prefer one focused PR for this phase. If the dependency upgrade creates broad type churn, split the upgrade into its own PR and stack the module extraction after it.
