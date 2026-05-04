# Server-Backed Persistent History

## Summary

Make live mode server-authoritative across refreshes, sessions, and devices. The browser will not own data persistence. On load, the app will hydrate from ClickHouse-backed server history, then layer live WebSocket updates on top. Users will immediately see a substantial recent persisted window, with older records available through history pagination.

## Chosen Defaults

- Source of truth: ClickHouse on the server.
- Browser persistence: UI preferences only, no market-data cache.
- Initial load: recent persisted window per active channel.
- Older data: fetched on demand using cursor pagination.
- Scope: every channel the server handles, including options, NBBO, equities, equity quotes, equity joins, flow packets, classifier hits, alerts, inferred dark events, candles, and chart overlays.
- Freshness: freshness affects status labels only; it must not hide persisted history from a refreshed browser.

## Current State To Change

- `LiveStateManager` hydrates from Redis or ClickHouse, but freshness gates currently suppress stale options, NBBO, equities, and flow snapshots.
- The unified `/ws/live` protocol supports snapshots and `next_before`, but the frontend does not retain/use per-channel history cursors for live-mode pagination.
- Some channels have REST history endpoints, but `equity-quotes` is not fully represented in the unified live protocol/history API.
- Charts already query ClickHouse for candle and overlay ranges, but should be treated as part of the same server-history model.

## Public Interfaces And Types

Update `packages/types/src/live.ts`:

- Add `"equity-quotes"` to:
  - `LiveGenericChannelSchema`
  - `LiveChannelSchema`
  - `LiveSubscriptionSchema`
  - `livePayloadSchemas`
- Preserve existing `FeedSnapshot` shape:
  - `items`
  - `watermark`
  - `next_before`

Update API routes in `services/api/src/index.ts`:

- Add `GET /history/equity-quotes?before_ts=&before_seq=&limit=`.
- Include `equity-quotes` in `/ws/live` subscriptions and fanout.
- Keep existing recent/replay endpoints compatible.

Update storage in `packages/storage/src/clickhouse.ts`:

- Add `fetchEquityQuotesBefore`.
- Reuse existing `(ts, seq)` cursor ordering.
- Keep limits clamped consistently with other history endpoints.

## Server Implementation

In `services/api/src/live.ts`:

1. Add generic config for `equity-quotes`:
   - Redis key: `live:equity-quotes`
   - cursor field: `equity-quotes`
   - parser: `EquityQuoteSchema`
   - cursor: `{ ts, seq }`
   - fetchRecent: `fetchRecentEquityQuotes`
2. Stop filtering historical snapshots by freshness:
   - Remove `filterFreshGenericItems` from snapshot construction.
   - Keep `isLiveItemFresh` available for UI status/fanout behavior if needed.
   - Do not reject persisted ClickHouse rows just because market timestamps are older than 15s/30s.
3. Stop rejecting stale ingests inside `LiveStateManager.ingest`.
   - The manager should store valid events it receives.
   - Event fanout can still choose how to label status, but should not silently lose durable cache state.
4. Preserve Redis as a hot cache:
   - Redis remains an optimization.
   - ClickHouse remains the fallback and source of truth.
   - API startup should hydrate from Redis if present, otherwise from ClickHouse.

In `services/api/src/index.ts`:

1. Include `equity-quotes` in `consumerBindings`.
2. Pump `EquityQuoteSchema` payloads into:
   - legacy `/ws/equity-quotes`
   - unified `/ws/live`
   - `LiveStateManager`
3. Add `/history/equity-quotes`.
4. Keep durable consumer defaults unchanged unless a test proves old events are skipped in a live-running API scenario. ClickHouse hydration handles restart and refresh persistence.

## Frontend Implementation

In `apps/web/app/terminal.tsx`:

1. Extend `LiveSessionState` with:
   - per-subscription `next_before` cursors
   - per-subscription loading/error state for older history
   - equity quotes if exposed in UI state
2. When handling `snapshot` messages:
   - Replace the channel's current items with snapshot items when non-empty.
   - Store `snapshot.next_before`.
   - Do not discard stale-but-persisted rows.
   - Continue deduping by `trace_id/seq` or `id`.
3. Add a generic live-history loader:
   - Map subscription channel to history endpoint:
     - `options` -> `/history/options`
     - `nbbo` -> `/history/nbbo`
     - `equities` -> `/history/equities`
     - `equity-quotes` -> `/history/equity-quotes`
     - `equity-joins` -> `/history/equity-joins`
     - `flow` -> `/history/flow`
     - `classifier-hits` -> `/history/classifier-hits`
     - `alerts` -> `/history/alerts`
     - `inferred-dark` -> `/history/inferred-dark`
   - Carry option/flow filters into options history queries.
   - Merge older results into existing channel state.
   - Advance `next_before` from the response.
   - Stop when `next_before` is null or the response is empty.
4. UI behavior:
   - Add a compact "Load older" control at the bottom of each applicable tape/list.
   - Disable it while loading.
   - Hide it when no more history exists.
   - Keep existing pause/jump controls unchanged.
   - Do not add browser market-data storage.
5. Chart behavior:
   - Keep candles loading from `/candles/equities`.
   - Keep overlay loading from `/prints/equities/range`.
   - Ensure refresh and device changes show the same server data for the same ticker/window.

## Config And Deployment

Update `.env.example`:

- Add `LIVE_LIMIT_EQUITY_QUOTES=10000`.
- Document that `LIVE_LIMIT_*` controls initial server snapshot/hot-cache depth, not total persisted history.

Update README if needed:

- Clarify persistence model:
  - ClickHouse is durable history.
  - Redis is hot cache.
  - Browser is not a market-data database.
  - All devices connected to the same API see the same server-seen data.

Docker volumes already persist ClickHouse/Redis/NATS data locally and in deployment compose, so no migration is needed for volume-backed persistence.

## Tests

API tests in `services/api/tests/live.test.ts`:

- Snapshot hydration returns stale historical options/NBBO/equities/flow instead of filtering them out.
- `LiveStateManager.ingest` stores older valid events.
- `equity-quotes` hydrates from Redis.
- `equity-quotes` hydrates from ClickHouse when Redis is empty.
- `next_before` is set from the oldest item in returned snapshot.
- Redis hot cache persists hydrated ClickHouse data.

Storage tests:

- Add `fetchEquityQuotesBefore` coverage using the existing storage test style.

Frontend tests in `apps/web/app/terminal.test.ts`:

- Live snapshot with older persisted rows populates visible rows.
- Empty snapshot does not wipe existing visible rows only when preserving an already visible channel during reconnect.
- Older-history merge dedupes existing items.
- History cursor advances after loading older rows.
- "No more history" state is reached when `next_before` is null.
- Live status can be stale while items remain visible.

## Acceptance Criteria

- Refreshing the app shows persisted data immediately, even when no new live events arrive after page load.
- Opening the app on another device connected to the same API shows the same server-backed recent history.
- Stale market timestamps do not cause persisted history to disappear.
- Users can load older data beyond the initial recent window.
- Live WebSocket updates still appear without requiring refresh.
- Redis loss does not lose history; API falls back to ClickHouse.
- Browser cache deletion does not lose market data.
- `bun test services/api/tests/live.test.ts apps/web/app/terminal.test.ts packages/storage/tests/*.test.ts` passes, or any unavailable test target is documented.
