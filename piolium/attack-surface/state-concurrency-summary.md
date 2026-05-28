# State Machine & Concurrency Summary

Stage 06 reviewed the Phase 3 KB, CodeQL structural artifacts, ClickHouse DDL/model files, NATS/JetStream consumers, Redis/cache usage, and admin state paths.

## State-holding entities catalogued

1. `synthetic_control.global` (NATS KV) — `SyntheticControlState` fields: `preset_id`, `coverage_assist`, `coverage_window_minutes`, `shared_seed`, `profile_weights`, `updated_at`, `updated_by`.
2. `flow_packets` — append-only derived event state; deterministic `id`/`trace_id`; `MergeTree ORDER BY (source_ts, seq)`.
3. `smart_money_events` — append-only derived event state; `event_id`; `MergeTree ORDER BY (source_ts, seq)`.
4. `classifier_hits` — append-only derived classifier state; `trace_id`; `MergeTree ORDER BY (source_ts, seq)`.
5. `alerts` — append-only alert state; `trace_id`, `severity`; `MergeTree ORDER BY (source_ts, seq)`.
6. `equity_candles` — aggregate/counter-like fields: `volume`, `notional`, `trade_count`; `MergeTree ORDER BY (underlying_id, interval_ms, ts)`.
7. `news` — lifecycle/revision-like fields: `published_ts`, `updated_ts`; uses `ReplacingMergeTree(updated_ts)`.
8. `option_prints`, `option_nbbo`, `equity_prints`, `equity_quotes`, `equity_print_joins`, `inferred_dark` — append-only event stores with timestamps/sequence cursors.

No balance/credit/payment/quota inventory was found. No payments/webhooks were identified.

## Concurrency primitives observed

- Language-level locks/mutexes: none in application services.
- Database transactions / `SELECT FOR UPDATE` / advisory locks: none found.
- Distributed locks / Redis `SETNX` / Redlock: none found.
- JetStream manual acknowledgement is used (`buildDurableConsumer` sets `manualAck()` / `ackExplicit()`), making idempotent consumers important.
- NATS KV is used for synthetic control state, but updates use unconditional `kv.put` rather than a revision/CAS update.

## Idempotency infrastructure

- Present only as in-memory/UI dedupe and short-lived compute dedupe maps (`recentStructureEmits`, client-side/live dedupe). This does not survive restarts or JetStream redelivery.
- No persisted `idempotency_key`, `processed_events`, request log, replay store, Redis idempotency key, or durable event-processing ledger was found.

## Drafts filed

- `p6-001-jetstream-redelivery-duplicates-derived-events.md` — idempotency gap on JetStream redelivery and append-only ClickHouse derived tables (HIGH).
- `p6-002-synthetic-control-lost-update.md` — stale-read/lost-update in full-object synthetic control writes without revision checks (MEDIUM).

Split by class: idempotency: 1; stale-read: 1.
