# Phase 05: Hybrid Detail Drawer Model

Canonical Beads issue: `islandflow-mcmd.5`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Add the shared dashboard detail drawer and extend durable alert rows so selected alert/chart/news details open externally without shrinking the alerts pane.

## Scope

Allowed:

- Extend `DurableTapeAlertRowsPane` with:
  - `detailMode?: "inline" | "external"`
  - `selectedRowId?: string | null`
  - `onSelectRow?: (row: DurableTapeAlertRowViewModel) => void`
- Keep alert hover preview inline.
- Use `detailMode="external"` in `MarketCommandRoute`.
- Add a shared Market Command detail drawer for:
  - durable alert rows
  - smart-flow chart markers
  - inferred-dark markers
  - news stories
- Make chart marker clicks open the drawer and focus the relevant ticker.
- Make news story details open in the drawer.
- Make Escape and outside click close consistently.
- Ensure packet and option row actions focus the relevant ticker/contract instead of opening competing large inline panels.
- Add focused component/state tests.

Out of scope:

- News focused-plus-market ordering.
- Ranking algorithm changes.
- Full details API expansion beyond what existing modules already expose.
- Large state refactors not needed for the shared drawer.

## Inputs

- `docs/implementation/market-command-dashboard/04-dashboard-layout-replacement.md`
- `apps/web/features/durable-tape/`
- `apps/web/features/market-command/MarketCommandRoute.tsx`
- `apps/web/features/terminal/components/charts.tsx`
- Existing news detail behavior.
- Existing smart-flow and inferred-dark marker click behavior.

## Implementation Notes

- `detailMode="inline"` must preserve existing behavior for current durable alert pane users.
- `detailMode="external"` should call `onSelectRow` and avoid rendering the large inline selected detail in the 1/3 pane.
- Hover preview remains inline in both modes.
- The drawer should be the only deep detail surface for this dashboard.
- Drawer state should clear when `focusTickerSymbol` or `clearBoardFocus` requires it.
- The drawer should not steal scroll ownership from pane bodies.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.5`
- Depends on: `islandflow-mcmd.4`
- Parallel-safe: No. The drawer depends on the composed route.

## Expected Files Or Areas

- `apps/web/features/durable-tape/`
- `apps/web/features/market-command/MarketCommandRoute.tsx`
- `apps/web/features/market-command/`
- `apps/web/features/terminal/components/charts.tsx`
- `apps/web/app/globals.css`

## Suggested Swarms

- Durable alert scout: map selected-row and hover-preview code paths.
- Drawer state scout: identify existing drawer/modal primitives and focus handling.
- Chart marker scout: verify smart-flow and inferred-dark marker payloads include symbol/detail refs.
- News detail scout: identify current story detail data and callbacks.
- Accessibility scout: verify Escape, outside click, focus trap/return behavior, and keyboard selection.
- Test scout: assert external alert mode calls callbacks and does not render large inline detail.

## Quality Gates

```bash
bun test apps/web/features/durable-tape
bun test apps/web/features/market-command
bun --cwd=apps/web run build
```

UI verification must include selecting an alert row and confirming the alerts pane height/grid remains stable.

## Completion Criteria

- Selecting an alert opens drawer detail without shrinking the alerts pane.
- Hover previews still work.
- Smart-flow marker clicks open drawer detail and focus the relevant ticker.
- Inferred-dark marker clicks open drawer detail and focus the relevant ticker.
- News story detail opens in the shared drawer.
- Escape/outside click closes drawer consistently.
- Phase turn doc records implementation, review, CI/gates, browser evidence, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for new deep evidence endpoints, richer drawer content, or unrelated modal infrastructure cleanup.
