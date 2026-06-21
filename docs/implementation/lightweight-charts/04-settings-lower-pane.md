# Phase 04: Settings Menu and Lower-Pane Modes

Beads issue: `islandflow-mloi.4`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Add user-customizable chart settings while keeping the default display useful without configuration. The module should support separate settings for the price chart and the lower pane so it can adapt to dashboard, replay, and future full-chart surfaces.

## Default Configuration

- Price pane: standard candlesticks.
- Lower pane: smart-flow or smart-money directional notional bars.
- Default timeframe favorites: `1m`, `5m`, `15m`.
- Off-exchange overlay: enabled only where the embedding passes overlay data.
- Smart-flow markers: enabled.
- Inferred dark markers: enabled where data is available.

## Scope

- Add `MarketChartSettings` popover or dialog.
- Add a settings state reducer and persistence strategy.
- Separate settings sections:
  - Price chart.
  - Lower chart.
  - Timeframes.
  - Display.
- Add price chart mode support:
  - Standard candles.
  - Heikin Ashi.
  - Optional line/bar modes only if they fit the phase budget.
- Add lower-pane source modes:
  - Smart money direction: smart-flow projections first, legacy smart-money fallback second.
  - All flow: aggregate flow packet or option print notional by bucket.
  - Plain volume: candle volume.
- Apply settings immediately without reloading the page.
- Keep settings section registration extensible so future chart layers can contribute controls without editing the core settings menu structure.

## Interaction Model

- Settings trigger lives in the chart toolbar.
- Use a popover or dialog that escapes overflow clipping.
- Escape closes the menu.
- Outside click closes the menu.
- Reset action restores defaults.
- Controls use standard affordances:
  - segmented controls for modes
  - checkboxes/toggles for binary options
  - menu rows for timeframe favorites

## Data Transform Requirements

Keep transforms pure and tested:

- `toHeikinAshiCandles(candles)`
- `buildSmartDirectionBars(projections, smartMoneyEvents, buckets)`
- `buildAllFlowBars(flowPackets, optionPrints, buckets)`
- `buildVolumeBars(candles)`
- `resolveLowerPaneMode(settings, availableData)`

Smart-flow language must remain cautious. The UI can say "directional hypothesis" or "flow direction"; do not present smart money as a canonical participant identity.

## Extensibility Requirements

- Lower-pane mode definitions should live in a registry with label, availability, transform, formatter, and default renderer metadata.
- Price chart modes should use the same pattern where practical.
- Settings persistence should ignore unknown namespaced keys instead of failing.
- Unsupported extension settings should be preserved only when the owning extension is still known.
- The dashboard should be able to hide or disable extension settings by capability.

## Separate Work

Split if large:

- Heikin Ashi transform tests can land with settings reducer tests.
- Lower-pane data aggregation can land before settings UI if it is unused but fully tested.
- New local storage helper should be separate if it is shared beyond chart settings.

## Parallel Work

Can parallelize after Phase 03:

- Pure transforms and tests.
- Settings popover UI.
- Copy and accessibility audit.

Keep serial:

- Final settings state shape.
- Persistence key/version.
- Integration into dashboard toolbar.

## Subagent Delegation Guidance

Appropriate subagent tasks:

- Draft transform test fixtures for Heikin Ashi and lower-pane modes.
- Audit settings labels for clarity and smart-flow certainty language.
- Inspect whether existing popover patterns can be reused without clipping.

Main agent must own:

- Reducer and persistence design.
- Final settings menu behavior.
- Integration with `MarketChart`.

## Acceptance Gates

- Users can switch price chart type.
- Users can switch lower pane between smart direction, all flow, and plain volume.
- Settings are applied immediately.
- Persisted settings recover safely from malformed storage.
- Default settings match the requested default display.
- Popover/dialog works inside dashboard overflow constraints.
- Red/green direction is paired with text, position, or labels.
- Focused transform and reducer tests pass.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## PR Guidance

This can be stacked after Phase 03. If review size grows, split pure transforms into one PR and settings UI into the next.
