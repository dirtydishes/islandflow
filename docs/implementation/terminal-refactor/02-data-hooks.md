# Phase 02: Data Hooks

Beads issue: `islandflow-e30y.2`

Full plan: [`00-roadmap.md`](./00-roadmap.md)

## Purpose

Move data movement and list-behavior hooks out of the route/component file after pure helpers have stable module homes.

## Scope

- Extract scroll and virtual-list hooks: `useListScroll`, `useScrollAnchor`, `useVirtualHistoryGate`, and `useTapeVirtualList`.
- Extract tape/session hooks: `useTape`, `usePausableTapeView`, `useLiveStream`, `useFlowStream`, `getLiveManifest`, and `useLiveSession`.
- Keep URL builders, websocket config, retention caps, and live-history endpoint mapping in shared non-UI modules.
- Avoid imports from panes, route containers, drawers, or shell modules.

## Dependencies

- Depends on: `islandflow-e30y.1`.
- Blocks: `islandflow-e30y.3`.

## Parallel Work

This phase can split into two lanes once Phase 01 is complete:

- Scroll and virtualization hooks.
- Live, replay, history, and websocket session hooks.

Both lanes should converge through shared config and pure tape helpers, not through UI modules.

## Acceptance Gates

- `bun test apps/web/app/terminal.test.ts`
- `bun --cwd=apps/web run build`
- `apps/web/app/terminal.tsx` still re-exports helper functions used by existing tests.
- No route, shell, or pane JSX is moved in this phase unless it is required to type-check extracted hooks.
