# Market Command Dashboard Replacement Roadmap

Canonical tracker: Beads epic `islandflow-mcmd`

## Plan Source

This roadmap is normalized from the Market Command Dashboard Replacement Plan supplied in the dirtyloops create request on 2026-07-01.

## Outcome

Replace the root `/` Market Command dashboard outright with a production command surface that uses server-ranked ticker focus and existing durable modules. The new page keeps the `Dashboard` navigation label, avoids a hidden v2 route, stacks responsively, and keeps module panes independently scrollable.

## Phase Sequence

1. `islandflow-mcmd.1` - Server ranking contract
2. `islandflow-mcmd.2` - Ticker rail and board focus model
3. `islandflow-mcmd.3` - Root route feature upgrade
4. `islandflow-mcmd.4` - Dashboard layout replacement
5. `islandflow-mcmd.5` - Hybrid detail drawer model
6. `islandflow-mcmd.6` - News relevance ordering
7. `islandflow-mcmd.7` - Polish, performance, and visual QA

## Dependencies

The phases run serially. Ranking precedes the rail. Rail focus precedes route feature changes. Route feature changes precede layout replacement. Layout replacement precedes shared drawer behavior. Drawer behavior precedes final news ordering and polish.

## Locked Decisions

- Replace `/`; do not create a hidden v2 route.
- Keep `NAV_ITEMS` label as `Dashboard`.
- Use durable modules wherever possible.
- Use a scrollable page with independent pane scrolling.
- Use subtle ticker rail auto-loop only when rail content overflows.
- Pause rail motion on hover/focus and disable it for reduced motion.
- Use server-derived important-now ranking, polled every 30 seconds.
- Use current or most recent regular market session from 9:30 AM America/New_York.
- Use evidence-first ranking with pinned watchlist fallback.
- Keep hover/compact previews inline and deeper evidence in one shared drawer.
- Default pinned watchlist: `SPY`, `QQQ`, `NVDA`, `TSLA`, `AAPL`, `MSFT`, `META`, `AMZN`.

## Risks

- Ranking can become slow if ClickHouse reads are not bounded to current session and limited symbol windows.
- UI phases can accidentally add client-side joins or local evidence reconstruction; keep heavy joins server-side.
- The route can regress `/qa`, `/options`, or `/news` subscriptions if feature updates are too broad.
- Detail drawer work can grow into a large state refactor; file follow-ups instead of widening the phase.
- Ticker rail animation can create layout shift or accessibility regressions if overflow and reduced-motion paths are not tested.

## Quality Gates

Common gates:

```bash
bun test
bun --cwd=apps/web run build
```

Phase-specific gates are listed in each phase doc. UI phases require browser QA for desktop and mobile viewports, reduced motion, no horizontal overflow, and degraded ranking fallback when relevant.

## Closeout

The final closeout artifact is:

`docs/implementation/market-command-dashboard/storyboard-post-run-07-01-2026.html`
