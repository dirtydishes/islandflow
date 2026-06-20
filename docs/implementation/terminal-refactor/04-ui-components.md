# Phase 04: UI Components

Beads issue: `islandflow-e30y.4`

Full plan: [`00-roadmap.md`](./00-roadmap.md)

## Purpose

Move rendered terminal UI into focused component groups after the shared state and shell seam is stable.

## Scope

- Extract primitives: `PageFrame`, `Pane`, `TapeStatus`, `TapeControls`, and `FlowFilterPopover`.
- Extract OPRA modules: `OptionsPane`, `FlowPane`, and `OpraIntakeRail`.
- Extract News modules: `NewsPane`, news row helpers, and `NewsControlRails`.
- Extract Dashboard/Chart modules: market command deck components, `CandleChart`, and `ChartPane`.
- Extract drawer modules: alert, news, classifier hit, smart-flow, smart-money, and dark-event drawers if still reachable.
- Keep route exports in `apps/web/app/terminal.tsx` until the facade is intentionally narrowed later.

## Dependencies

- Depends on: `islandflow-e30y.3`.
- Blocks: `islandflow-e30y.5`.

## Parallel Work

This phase can split after Phase 03:

- OPRA group.
- News group.
- Dashboard and chart group.
- Drawer and overlay group.

Each lane should extract mechanically first. Narrow props only where the call sites and tests make the behavior obvious.

## Acceptance Gates

- `bun test apps/web/app/terminal.test.ts`
- `bun --cwd=apps/web run build`
- `apps/web/app/terminal.tsx` is primarily a facade plus any intentionally deferred compatibility code.
- The extracted UI preserves dense terminal styling and existing class names unless the phase explicitly includes a visual adjustment.
