# Phase 05: Hover Readout, Rounded Bars, and Visual Hardening

Beads issue: `islandflow-mloi.5`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Finish the chart as a production-quality evidence surface. Hovering a candle should expose the relevant price, volume, and flow context in one dense readout, and the default lower-pane bars should be visually polished while preserving accessibility and performance.

## Scope

- Add crosshair hover readout.
- Aggregate candle-bucket statistics for:
  - OHLC.
  - Equity volume.
  - Equity trade count.
  - Option print total notional by direction.
  - Smart-flow or smart-money direction.
  - Evidence quality, confidence, abstention, and why-not summary when available.
- Add rounded-top lower-pane bars.
- Harden responsive behavior across dashboard and alternate embed sizes.
- Verify contrast, reduced motion, and red/green semantics.

## Hover Readout Content

Readout should be compact and information-dense:

| Field | Source | Notes |
| --- | --- | --- |
| Time | candle bucket | Include interval label. |
| OHLC | candle | Use mono numeric formatting. |
| Volume | candle volume | Plain share volume. |
| Trades | candle trade count | Show when available. |
| Bullish option notional | option prints or flow packets | Direction from NBBO side or smart-flow adapter. |
| Bearish option notional | option prints or flow packets | Same bucket as candle. |
| Neutral/unknown notional | option prints or flow packets | Do not hide uncertainty. |
| Flow direction | smart-flow projection or smart-money fallback | Label as hypothesis/compatibility where appropriate. |
| Evidence quality | smart-flow projection | Use existing labels such as strong, usable, thin, poor. |
| Why-not | smart-flow projection | Surface abstention or top penalty. |

The readout should also support extension-owned rows. Core rows render first in a stable order; extension rows append under a labelled group so future overlays or lower panes can expose their own values without replacing the tooltip component.

## Rounded Bar Strategy

Preferred implementation after `lightweight-charts` 5.x:

- Use a custom series/plugin for rounded directional bars, or an overlay canvas that is owned by the chart controller.
- Keep bar geometry tied to the chart time scale.
- Support positive and negative directional values.
- Preserve hover hit testing through the chart bucket model even if the visual renderer is custom.

Fallback:

- Use native histogram bars without rounded tops and document why the custom renderer was deferred.
- File a follow-up Beads issue before closing the phase if the fallback ships.

## Visual Requirements

- Bars use semantic green/red with explicit direction labels in readout and legends.
- Neutral/unknown flow uses a dim neutral or info tone.
- Lower pane remains dense and legible at compact heights.
- Tooltip/readout does not cover the active candle when avoidable.
- No flashing or layout shift during live updates.
- Respect reduced motion preferences.

## Separate Work

Split if large:

- Hover aggregation and tests.
- Custom rounded bar renderer.
- Visual QA and accessibility hardening.

## Parallel Work

Can parallelize after Phase 04:

- Hover aggregation tests.
- Renderer experiment.
- Browser visual QA.
- Accessibility/copy audit.

Keep serial:

- Final renderer choice.
- Final hover readout layout.
- Dashboard integration.

## Subagent Delegation Guidance

Appropriate subagent tasks:

- Build fixture matrices for hover aggregation edge cases.
- Compare custom series versus overlay canvas tradeoffs.
- Run browser screenshots at desktop, tablet, and mobile widths.
- Audit contrast and red/green-only meaning.

Main agent must own:

- Renderer implementation.
- Final tooltip/readout behavior.
- Any performance tradeoff.

## Acceptance Gates

- Hovering a candle shows OHLC, volume, trade count, and directional option notional.
- Smart-flow context is shown when available and falls back safely when not.
- Default lower-pane bars have rounded tops, or a documented fallback issue exists.
- Readout remains readable at dashboard and compact sizes.
- No toolbar or tooltip text overflow on mobile.
- Visual checks pass for dashboard desktop and mobile.
- Focused aggregation tests pass.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## PR Guidance

Prefer one PR after settings. Split the custom renderer if it requires meaningful experimentation or if it destabilizes otherwise reviewable hover work.
