# Phase 02: Ticker Rail And Board Focus Model

Canonical Beads issue: `islandflow-mcmd.2`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Add first-class board ticker focus helpers, the ticker rail polling hook, local fallback ranking, and the `MarketCommandTickerRail` component so clicking a rail item scopes the entire board.

## Scope

Allowed:

- Add `apps/web/features/market-command/useMarketCommandTickerRail.ts`.
- Add `apps/web/features/market-command/local-ranking-fallback.ts`.
- Add `apps/web/features/market-command/focus-model.ts`.
- Add `apps/web/features/market-command/MarketCommandTickerRail.tsx`.
- Add terminal state helpers:
  - `focusTickerSymbol(symbol, source)`
  - `clearBoardFocus()`
- Make `focusOptionContract` and `focusFlowPacketRequest` set `filterInput` to the contract underlying.
- Keep clearing contract focus from clearing ticker focus.
- Poll `/market-command/tickers` every 30 seconds.
- Implement local fallback from existing terminal state and visibly mark it as local fallback.
- Implement subtle auto-loop only when rail content overflows.
- Pause rail motion on hover/focus and disable it for reduced motion and mobile.
- Add focused unit/component tests.

Out of scope:

- Route feature subscription changes.
- Full dashboard layout replacement.
- Shared detail drawer.
- News ordering changes.
- User-editable watchlist persistence.

## Inputs

- `docs/implementation/market-command-dashboard/01-server-ranking-contract.md`
- `apps/web/features/terminal/`
- `apps/web/app/terminal.tsx`
- Existing focus/selection state for option contracts, flow packets, chart markers, alerts, and news.
- New shared types from `packages/types/src/market-command.ts`.

## Implementation Notes

- `focusTickerSymbol` uppercases the symbol, sets `filterInput` to that symbol, clears selected drawers, and clears `selectedInstrument`.
- `clearBoardFocus` clears `filterInput`, `selectedInstrument`, and open detail drawers.
- Contract focus keeps the board ticker aligned by using the contract underlying.
- Flow packet activation focuses the related option contract/member prints while also aligning ticker focus.
- Default watchlist: `SPY`, `QQQ`, `NVDA`, `TSLA`, `AAPL`, `MSFT`, `META`, `AMZN`.
- The hook should return enough state for loading, degraded server response, local fallback, stale/error state, and retry timing.
- Rail buttons must be keyboard focusable and usable without animation.
- Avoid layout shift when polling updates reorder important-now items.

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.2`
- Depends on: `islandflow-mcmd.1`
- Parallel-safe: No. This phase depends on the server contract and state semantics that later route/layout phases consume.

## Expected Files Or Areas

- `apps/web/features/market-command/useMarketCommandTickerRail.ts`
- `apps/web/features/market-command/local-ranking-fallback.ts`
- `apps/web/features/market-command/focus-model.ts`
- `apps/web/features/market-command/MarketCommandTickerRail.tsx`
- `apps/web/features/terminal/`
- `apps/web/app/globals.css`
- `apps/web/**/*.test.ts`
- `apps/web/**/*.test.tsx`

## Suggested Swarms

- State scout: find current `filterInput`, drawers, selected instrument, option contract, and flow packet focus code.
- Component scout: find existing terminal button, chip, rail, and reduced-motion CSS patterns.
- Fallback scout: map existing in-memory terminal feeds into local ranking inputs.
- Accessibility scout: verify keyboard, focus, pause-on-focus, and reduced-motion behavior.
- Test scout: add focused tests around state transitions and fallback render paths.

## Quality Gates

```bash
bun test apps/web/features/terminal
bun test apps/web/features/market-command
bun --cwd=apps/web run build
```

If the new feature folder has no separate test glob support, run the closest focused app tests and document the exact command.

## Completion Criteria

- Clicking a rail item scopes the whole board through `filterInput`.
- `focusTickerSymbol("nvda")` sets board focus to `NVDA` and clears drawers.
- Contract and packet focus also set board symbol to the underlying.
- Rail renders pinned, important-now, and local fallback groups.
- Endpoint failure does not blank the rail.
- Rail remains keyboard usable.
- Reduced motion disables auto-loop.
- Phase turn doc records implementation, review, CI/gates, Beads updates, and follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for watchlist editing, persistence, or advanced rail personalization.
