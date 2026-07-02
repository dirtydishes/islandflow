# Phase 04: Dashboard Layout Replacement

Canonical Beads issue: `islandflow-mcmd.4`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Replace the current root `OverviewRoute` body with `MarketCommandRoute` and compose the locked scrollable dashboard layout from durable modules.

## Scope

Allowed:

- Add `apps/web/features/market-command/MarketCommandRoute.tsx`.
- Add `apps/web/features/market-command/MarketCommandChrome.tsx`.
- Update `OverviewRoute` in `apps/web/app/terminal.tsx` to delegate to `MarketCommandRoute`.
- Use `MarketCommandTickerRail` from phase 02.
- Use `TerminalMarketChartSection` for the chart.
- Use `DurableTapeAlertRowsPane` for alerts when `filteredDurableAlertRows` exists.
- Use raw `AlertsModule` only as a fallback when durable alert rows are unavailable.
- Use `FlowPacketsTape` with `template="oneThird"`.
- Use `DurableTapeOptionRowsPane` for options when `filteredDurableOptionRows` exists.
- Use raw `OptionsTape` only as a fallback when durable option rows are unavailable.
- Use `NewsWire` full width.
- Remove old standalone dashboard panes from the root route:
  - `CommandPriorityBoard`
  - `CommandDecisionLevels`
  - `FeedHealthPane`
  - `EventContextPane`
  - `HomeReplayRail`
  - `EquitiesTape`
- Fold status, replay, health, and focus controls into chrome.
- Add responsive CSS and focused layout tests where practical.

Out of scope:

- Alert external detail selection API changes.
- Shared detail drawer.
- News focused-plus-market ordering.
- Ranking algorithm changes.
- Deep replay rework.

## Inputs

- `docs/implementation/market-command-dashboard/03-route-feature-upgrade.md`
- `apps/web/app/terminal.tsx`
- `apps/web/app/globals.css`
- `apps/web/features/terminal/components/charts.tsx`
- Durable tape components under `apps/web/features/durable-tape/`
- Existing `OptionsTape`, `AlertsModule`, `FlowPacketsTape`, and `NewsWire`.

## Implementation Notes

- Desktop:
  - Top chrome sticky under existing app topbar.
  - Chart/alerts row: chart `minmax(0, 2fr)`, alerts `minmax(300px, 1fr)`, min height around `560px`.
  - Flow/options row: flow `minmax(280px, 1fr)`, options `minmax(0, 2fr)`, min height around `360px`.
  - News row full width with min height around `520px`.
- Responsive:
  - Under tablet width, stack chrome, rail, chart, alerts, options, flow, news.
  - On mobile, rail uses manual horizontal scroll.
- Preserve smart-flow and inferred-dark marker click behavior. The drawer behavior lands in phase 05.
- Use existing Islandflow terminal design system:
  - dark, flat, dense
  - border-block sections
  - compact headers
  - no card-grid dashboard treatment
  - amber scarce
  - no page-level horizontal overflow
- Use independent pane scroll regions.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.4`
- Depends on: `islandflow-mcmd.3`
- Parallel-safe: No. This phase changes the main root route surface.

## Expected Files Or Areas

- `apps/web/features/market-command/MarketCommandRoute.tsx`
- `apps/web/features/market-command/MarketCommandChrome.tsx`
- `apps/web/app/terminal.tsx`
- `apps/web/app/globals.css`
- Existing terminal module components consumed by the route.

## Suggested Swarms

- Layout scout: map current root dashboard panes and required removals.
- Durable module scout: identify props for durable option/alert panes and raw fallbacks.
- Chrome scout: locate status, replay, health, and focus controls to preserve compactly.
- Responsive scout: check CSS breakpoints and page overflow patterns.
- Browser scout: prepare desktop/mobile probes for no horizontal overflow and independent scroll regions.

## Quality Gates

```bash
bun test apps/web
bun --cwd=apps/web run build
```

UI verification must include real browser screenshots or probes for desktop and mobile `/` layout.

## Completion Criteria

- Desktop shows the intended 2/3 + 1/3 and 1/3 + 2/3 layout.
- Mobile stacks cleanly.
- No horizontal page overflow.
- Each module has independent scroll behavior.
- Old standalone dashboard panes are no longer standalone grid panes in the route.
- Status, replay, health, and focus controls are available in chrome.
- Phase turn doc records implementation, review, CI/gates, browser evidence, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for detail drawer behavior, news relevance ordering, or deeper replay/product policy decisions.
