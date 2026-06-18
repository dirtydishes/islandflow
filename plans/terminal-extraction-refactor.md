# Terminal Extraction Plan

## Summary

Refactor [`apps/web/app/terminal.tsx`](/Users/kell/Cloud/dev/islandflow/apps/web/app/terminal.tsx:1) from a single 7,974-line client module into a feature folder at `apps/web/terminal/*`, while keeping `apps/web/app/terminal.tsx` as a temporary compatibility facade in the first pass.

This first extraction is a medium-scope, behavior-preserving refactor:
- no product behavior changes
- no route behavior changes
- no visual redesign
- no data model changes
- no immediate deletion of the old import surface

Current baseline is healthy and must remain healthy after the refactor:
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts` passes
- `bun --cwd=apps/web run build` passes

## Target Structure

Create this feature layout:

```text
apps/web/terminal/
  index.ts
  state.tsx
  shell.tsx
  routes.tsx
  core/
    format.ts
    filters.ts
    route-config.ts
    tape-data.ts
    signals.ts
    live-manifest.ts
  hooks/
    use-tape-data.ts
    use-live-session.ts
    use-virtual-tape.ts
  components/
    chrome.tsx
    chart.tsx
    drawers.tsx
    panes.tsx
  tests/
    core.test.ts
    live-manifest.test.ts
    signals.test.ts
    tape-data.test.ts
```

Keep this file in place for the first pass:
- `apps/web/app/terminal.tsx`

Its final first-pass role is:
- `"use client"` entrypoint
- thin re-export facade only
- no business logic
- no React state
- no websocket/session logic
- no chart implementation
- target size: under 120 lines

## Dependency Rules

Use this dependency direction and do not violate it:
- `core/*` may depend only on shared types and other `core/*`
- `hooks/*` may depend on `core/*`
- `components/*` may depend on `core/*` and `hooks/*`
- `state.tsx` may depend on `core/*`, `hooks/*`, and `components/*` types only as needed
- `shell.tsx` and `routes.tsx` may depend on `state.tsx` and `components/*`
- `index.ts` re-exports public feature symbols
- `app/terminal.tsx` re-exports from `apps/web/terminal/index.ts`

Do not allow circular imports.

## Module Mapping

Move code out of `terminal.tsx` in this order.

### 1. Pure helpers first

Move non-React helpers into `apps/web/terminal/core/*`:

- `core/route-config.ts`
  - `getRouteFeatures`
  - `getTapeVirtualConfig`
  - `shouldIncludeEquitiesForDarkUnderlyingFallback`

- `core/live-manifest.ts`
  - `getLiveManifest`
  - `getLiveHistoryRetentionCap`
  - `getScopedLiveAutoHydrationChannels`
  - `getLiveFeedStatus`
  - `getHotChannelFeedStatus`

- `core/tape-data.ts`
  - `mergeNewestWithOverflow`
  - `composeTapeItems`
  - `reducePausableTapeData`
  - `flushPausableTapeData`
  - `appendHistoryTail`
  - `projectPausableTapeState`
  - `findAnchorRestoreIndex`
  - `shouldRetainLiveSnapshotHistory`
  - `shouldShowEquitiesSilentFeedWarning`
  - tape/history support types used only by these helpers

- `core/format.ts`
  - `formatCompactUsd`
  - `formatOptionContractLabel`
  - `getOptionTableSnapshot`
  - price/size/time/date/contract formatting helpers that support UI rendering

- `core/signals.ts`
  - `normalizeAlertSeverity`
  - `deriveAlertDirection`
  - `getAlertWindowAnchorTs`
  - `selectPrimaryClassifierHit`
  - `classifierToneForFamily`
  - `smartMoneyToneForProfile`
  - `smartMoneyProfileLabel`

- `core/filters.ts`
  - `buildDefaultFlowFilters`
  - `countActiveFlowFilterGroups`
  - `toggleFilterValue`
  - `nextFlowFilterPopoverState`

These files must not include `"use client"`.

### 2. Extract hooks and session logic

Move React hooks into `apps/web/terminal/hooks/*`:

- `hooks/use-virtual-tape.ts`
  - `useListScroll`
  - `useScrollAnchor`
  - `useVirtualHistoryGate`
  - `useTapeVirtualList`

- `hooks/use-tape-data.ts`
  - `useTape`
  - `usePausableTapeView`
  - `useLiveStream`
  - `useFlowStream`
  - `statusLabel`
  - internal tape state types

- `hooks/use-live-session.ts`
  - `useLiveSession`
  - live history endpoint constants
  - live history query builders
  - subscription dedupe helpers
  - session-local types

Keep signatures stable unless a change is required to break a circular dependency. If a signature changes, update all callers in the same PR.

### 3. Extract UI components

Move rendering code into `apps/web/terminal/components/*`:

- `components/chrome.tsx`
  - `TapeStatus`
  - `TapeControls`
  - `PageFrame`
  - `Pane`
  - `ShellMetricStrip`
  - `FlowFilterPopover`
  - local filter UI helpers

- `components/chart.tsx`
  - `CandleChart`
  - chart-only local types and overlay helpers
  - isolate `lightweight-charts` usage here

- `components/drawers.tsx`
  - `AlertSeverityStrip`
  - `AlertDrawer`
  - `ClassifierHitDrawer`
  - `SmartMoneyDrawer`
  - `DarkDrawer`

- `components/panes.tsx`
  - `OptionsPane`
  - `EquitiesPane`
  - `FlowPane`
  - `AlertsPane`
  - `ClassifierPane`
  - `DarkPane`
  - `ChartPane`
  - `FocusPane`
  - `ReplayConsole`

### 4. Extract state orchestration

Create `apps/web/terminal/state.tsx` for:
- `useTerminalState`
- `TerminalContext`
- `useTerminal`

This file owns:
- route-aware feature selection
- filter input state
- selected entity/drawer state
- scroll-anchor wiring
- assembly of hook outputs into the single terminal state object

Keep `useTerminalState` internal. Do not export it from the feature barrel.

### 5. Extract shell and routes

Create:
- `apps/web/terminal/shell.tsx`
  - `TerminalAppShell`

- `apps/web/terminal/routes.tsx`
  - `NAV_ITEMS`
  - `OverviewRoute`
  - `TapeRoute`
  - `SignalsRoute`
  - `ChartsRoute`
  - `ReplayRoute`

Important first-pass rule:
- keep existing route behavior exactly as-is
- [app/page.tsx](/Users/kell/Cloud/dev/islandflow/apps/web/app/page.tsx:1), [app/layout.tsx](/Users/kell/Cloud/dev/islandflow/apps/web/app/layout.tsx:4), and [app/tape/page.tsx](/Users/kell/Cloud/dev/islandflow/apps/web/app/tape/page.tsx:1) may continue importing from `./terminal` / `../terminal`
- [app/signals/page.tsx](/Users/kell/Cloud/dev/islandflow/apps/web/app/signals/page.tsx:1), [app/charts/page.tsx](/Users/kell/Cloud/dev/islandflow/apps/web/app/charts/page.tsx:1), and [app/replay/page.tsx](/Users/kell/Cloud/dev/islandflow/apps/web/app/replay/page.tsx:1) must remain redirect pages in this pass

## Facade Contract

Replace `apps/web/app/terminal.tsx` with a facade that re-exports from `apps/web/terminal/index.ts`.

The facade must continue exporting these symbols in the first pass:

- `getTapeVirtualConfig`
- `shouldIncludeEquitiesForDarkUnderlyingFallback`
- `getRouteFeatures`
- `mergeNewestWithOverflow`
- `composeTapeItems`
- `reducePausableTapeData`
- `flushPausableTapeData`
- `appendHistoryTail`
- `getLiveHistoryRetentionCap`
- `getScopedLiveAutoHydrationChannels`
- `getLiveFeedStatus`
- `getHotChannelFeedStatus`
- `findAnchorRestoreIndex`
- `formatCompactUsd`
- `formatOptionContractLabel`
- `normalizeAlertSeverity`
- `deriveAlertDirection`
- `getAlertWindowAnchorTs`
- `buildDefaultFlowFilters`
- `countActiveFlowFilterGroups`
- `toggleFilterValue`
- `nextFlowFilterPopoverState`
- `projectPausableTapeState`
- `shouldShowEquitiesSilentFeedWarning`
- `shouldRetainLiveSnapshotHistory`
- `selectPrimaryClassifierHit`
- `classifierToneForFamily`
- `smartMoneyToneForProfile`
- `smartMoneyProfileLabel`
- `getOptionTableSnapshot`
- `statusLabel`
- `getLiveManifest`
- `NAV_ITEMS`
- `FlowFilterPopover`
- `TerminalAppShell`
- `OverviewRoute`
- `TapeRoute`
- `SignalsRoute`
- `ChartsRoute`
- `ReplayRoute`

Do not add new facade-only exports.

## Test Plan

Restructure tests so pure logic is tested from its final home instead of through the facade.

### Keep
- `apps/web/app/routes.test.ts`
  - still verifies redirect behavior for `/signals`, `/charts`, `/replay`

### Split `app/terminal.test.ts` into feature tests
- `apps/web/terminal/tests/live-manifest.test.ts`
  - route feature mapping
  - manifest composition
  - nav items if still treated as route metadata

- `apps/web/terminal/tests/tape-data.test.ts`
  - merge/dedupe logic
  - pausable tape behavior
  - history seam behavior
  - anchor restore behavior
  - retention cap behavior
  - scoped history behavior

- `apps/web/terminal/tests/core.test.ts`
  - option contract formatting
  - compact USD formatting
  - option table snapshot formatting
  - flow filter helpers

- `apps/web/terminal/tests/signals.test.ts`
  - alert severity normalization
  - direction derivation
  - alert window anchor
  - classifier/smart-money label and tone helpers
  - live status labeling if kept outside tape-data tests

Optional and recommended:
- add one tiny `apps/web/app/terminal-facade.test.ts` that imports the facade and asserts a few critical exports exist, so we notice accidental facade breakage during the transition

## Validation Gates

Implementation is not complete unless all of these pass:

1. `bun test apps/web/terminal/tests apps/web/app/routes.test.ts`
2. `bun --cwd=apps/web run build`
3. Existing behavior smoke check:
   - `/` still renders the shell and overview
   - `/tape` still renders shell and tape panes
   - `/signals`, `/charts`, `/replay` still redirect to `/`
4. `apps/web/app/terminal.tsx` is a facade only and contains no moved logic
5. No extracted pure helper file contains React imports
6. No new circular imports are introduced

## Non-Goals For This Pass

Do not do these in the first extraction:
- redesign panes or drawers
- change websocket or replay behavior
- change route inventory
- remove unused legacy route exports
- change CSS structure beyond import fixes
- optimize bundle size as a separate objective
- rewrite tests to different testing tools

## Beads Follow-Up Issues To File

Create these `bd` issues during implementation if they do not already exist:

1. `task`, priority `2`
   Title: `Remove temporary apps/web/app/terminal.tsx facade after terminal imports are migrated`
   Description: track deletion of the compatibility facade once route/layout/test imports point at final `apps/web/terminal/*` modules

2. `task`, priority `3`
   Title: `Audit and remove dead terminal route exports no longer used by app redirects`
   Description: verify whether `SignalsRoute`, `ChartsRoute`, and `ReplayRoute` should be deleted since App Router pages now redirect to `/`

If additional cleanup is discovered during extraction, create linked `bd` tasks with `discovered-from` dependencies rather than expanding this refactor mid-flight.

## Acceptance Criteria

The first extraction is successful when:
- terminal logic is split into the target `apps/web/terminal/*` structure
- `apps/web/app/terminal.tsx` remains only as a thin compatibility layer
- app entrypoints continue to work without behavior changes
- tests target the new module homes for pure logic
- build and tests pass
- follow-up `bd` issues exist for facade removal and dead-export cleanup

## Assumptions And Defaults

- Chosen scope: medium slice, not full architectural rewrite
- Chosen transition: keep `apps/web/app/terminal.tsx` as a temporary facade
- Chosen module home: `apps/web/terminal/*`, not `apps/web/app/terminal/*`
- Default behavior requirement: strict behavioral parity
- Default testing approach: split existing monolithic helper tests by concern and colocate them under `apps/web/terminal/tests`
- Default routing approach: keep redirect pages untouched in the first pass
