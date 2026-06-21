# Phase 03: State and Shell

Beads issue: `islandflow-e30y.3`

Full plan: [`00-roadmap.md`](./00-roadmap.md)

## Purpose

Extract the terminal state module and shared app shell after data hooks are no longer local to `terminal.tsx`.

## Scope

- Move `useTerminalState`, `TerminalContext`, and `useTerminal` into terminal state modules.
- Move `TerminalAppShell`, `TerminalChrome`, nav drawer, topbar ticker controls, mode switch, and shell metrics into shell modules.
- Move `SyntheticControlDock` with the shell only if its imports are already clean after Phase 02.
- Keep `TerminalAppShell` exported from `apps/web/app/terminal.tsx`.
- Preserve the mock-route bypass for `/mock*` unless the mock routes are removed in a separate cleanup decision.

## Dependencies

- Depends on: `islandflow-e30y.2`.
- Blocks: `islandflow-e30y.4`.

## Parallel Work

Do not parallelize this phase. The state/context interface is the main seam for later UI extraction and should land in one reviewable change.

## Acceptance Gates

- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`
- `apps/web/app/layout.tsx` can still import `TerminalAppShell` from `./terminal`.
- The state module exposes a small interface: route containers and panes should consume terminal state through the shared hook/context, not by recreating live subscriptions.
