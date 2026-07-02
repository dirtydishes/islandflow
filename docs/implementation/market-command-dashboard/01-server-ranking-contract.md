# Phase 01: Server Ranking Contract

Canonical Beads issue: `islandflow-mcmd.1`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Add the shared market-command ticker rail contract, pure ranking module, and REST endpoint that returns pinned and important-now ticker rail items for the current or most recent regular market session.

## Scope

Allowed:

- Add `packages/types/src/market-command.ts` and export it from `packages/types/src/index.ts`.
- Define `MarketCommandTickerReason`, `MarketCommandTickerRailItem`, and `MarketCommandTickerRailResponse`.
- Add `services/api/src/market-command-tickers.ts` as a pure ranking module.
- Add `GET /market-command/tickers`.
- Validate `watchlist` and `limit`.
- Use live cache plus bounded current-session ClickHouse reads for alerts, smart-flow projections, option prints, flow packets, equities, and news.
- Return degraded useful data when ClickHouse is unavailable but live cache/watchlist data exists.
- Categorize the route as ordinary REST for rate limiting, not lookup.
- Add focused type/API/ranking tests.

Out of scope:

- Ticker rail UI.
- Board focus helpers.
- Route subscription changes.
- Dashboard layout replacement.
- User-editable watchlist persistence.
- Exchange holiday calendar integration.

## Inputs

- `packages/types/src/index.ts`
- `services/api/src/index.ts`
- `services/api/src/live-state.ts`
- `services/api/src/durable-rows.ts`
- `services/api/tests/`
- Storage APIs for alerts, smart-flow projections, option prints, flow packets, equity prints, and news.
- Plan endpoint: `GET /market-command/tickers?watchlist=SPY,QQQ,NVDA,TSLA,AAPL,MSFT,META,AMZN&limit=16`

## Implementation Notes

- Normalize watchlist symbols to uppercase and cap at 32.
- Cap `limit` at 32 and default it to 16.
- Response always includes pinned symbols in requested order.
- Important list excludes duplicate pinned symbols.
- Pinned items can use `source: "both"` when important-now reasons also exist.
- Current session starts at 9:30 AM America/New_York. Before open or on weekends, use the most recent regular session.
- Ranking is evidence-first:

```ts
const WEIGHTS = {
  smartFlowAlert: 50,
  smartFlowProjection: 35,
  flowPacket: 22,
  optionPremium: 18,
  optionPrintCount: 8,
  equityMove: 12,
  news: 10,
  watchlistBoost: 4
};
```

- Non-abstained smart-flow alerts should outrank pure price movers.
- Non-abstained smart-flow projections are second strongest.
- Equity move and news boost interest but should not outrank strong flow evidence alone.
- Event contribution decays by recency with a 45-minute half-life, with a reduced current-session floor.
- Keep the top three contributors per symbol in `reasons`.
- Price/change should compare latest equity print against first current-session print; fall back to latest two prints; return `null` when unavailable.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.1`
- Depends on: None
- Parallel-safe: No. This phase establishes the public contract and endpoint used by later phases.

## Expected Files Or Areas

- `packages/types/src/market-command.ts`
- `packages/types/src/index.ts`
- `services/api/src/market-command-tickers.ts`
- `services/api/src/index.ts`
- `services/api/tests/`
- `packages/types/tests/`

## Suggested Swarms

- Contract scout: verify existing type export patterns and schema test style.
- API route scout: locate route registration, validation helpers, and rate-limit categorization.
- Live/cache scout: identify safe `LiveStateManager` accessors for equities, alerts, flow, and news.
- ClickHouse scout: identify bounded current-session storage reads and query limits.
- Ranking test scout: generate edge cases for evidence-first ordering, pinned stability, and degraded fallback.
- Session-window scout: check existing timezone/session helpers before adding a new heuristic.

## Quality Gates

```bash
bun test packages/types
bun test services/api/tests
bun test
```

If full `bun test` is blocked by unrelated local failures, document exact failures and run the focused type/API gates.

## Completion Criteria

- Endpoint returns the pinned core eight in order for the default watchlist.
- Important list ranks evidence-first.
- Duplicates do not appear in both pinned and important lists.
- Degraded responses still produce useful rail data.
- `limit` and watchlist size are capped.
- Current-session filters exclude prior-session rows.
- Before-open/weekend window resolves to the most recent regular session.
- Phase turn doc records implementation, review, CI/gates, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for editable watchlists, richer holiday calendars, new websocket channels, or ranking policy calibration.
