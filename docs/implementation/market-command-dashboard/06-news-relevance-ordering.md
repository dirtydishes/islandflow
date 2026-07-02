# Phase 06: News Relevance Ordering

Canonical Beads issue: `islandflow-mcmd.6`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Order the full-width News Wire so focused ticker stories appear first when board focus is active, while broader market stories remain visible below.

## Scope

Allowed:

- Add focused-plus-market news ordering for the Market Command dashboard.
- Promote focused symbol stories when board focus is active.
- Keep broader market stories visible below focused stories.
- Label focused and broader market stories clearly without creating separate routes.
- Preserve global wire when focused news is empty.
- Make news story details open in the shared drawer from phase 05.
- Add focused tests for ordering and empty focused state.

Out of scope:

- New news ingestion or enrichment.
- New websocket channels.
- User-configurable news filters.
- Ranking endpoint changes.
- Layout changes not required for the labeled ordering.

## Inputs

- `docs/implementation/market-command-dashboard/05-hybrid-detail-model.md`
- Existing `NewsWire` implementation.
- Board focus state from phase 02.
- News data available to root `/` from phase 03.

## Implementation Notes

- Focused stories should appear first only when board focus is active.
- Focused stories and global stories should be visibly distinguished with labels in the same News Wire surface.
- Empty focused state should be compact and must not hide global stories.
- Avoid route forks or duplicate News Wire implementations if a prop-level extension is enough.
- News detail should use the shared drawer and not a competing large inline panel.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.6`
- Depends on: `islandflow-mcmd.5`
- Parallel-safe: No. News detail behavior depends on the shared drawer.

## Expected Files Or Areas

- Existing `NewsWire` component files.
- `apps/web/features/market-command/MarketCommandRoute.tsx`
- `apps/web/features/market-command/`
- `apps/web/app/globals.css`
- News-related tests under `apps/web/`

## Suggested Swarms

- News data scout: identify story-symbol mapping and fallback/global behavior.
- Component scout: determine whether `NewsWire` should accept ordering/label props or use a wrapper.
- State scout: verify board focus state is available without coupling News Wire to route internals.
- Test scout: add focused/no-focused/global-preserved cases.
- Browser scout: check full-width news height and labels on desktop/mobile.

## Quality Gates

```bash
bun test apps/web
bun --cwd=apps/web run build
```

UI verification should cover a focused ticker with mapped news and a focused ticker without mapped news.

## Completion Criteria

- Focused ticker stories appear first when board focus is active.
- Focused ticker with no mapped news still shows the market wire.
- Focused and global stories are visibly distinguished.
- News story detail opens in the shared drawer.
- Phase turn doc records implementation, review, CI/gates, browser evidence, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for news relevance scoring, source controls, or additional symbol matching heuristics.
