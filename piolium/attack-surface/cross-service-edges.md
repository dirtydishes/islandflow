# Cross-Service Edges

Multi-service topology confirmed from `services/*`, `apps/*`, shared `packages/*`, and `deployment/docker/docker-compose.yml`.

| Edge | Channel | Producer | Consumer | Data shape | Boundary notes |
|---|---|---|---|---|---|
| E001 | http | web `apps/web/app/api/admin/synthetic/shared.ts:51` | api `services/api/src/index.ts:1364` | admin synthetic JSON | web injects admin bearer token; see p5 authz finding |
| E002 | queue `options.prints` | ingest-options `services/ingest-options/src/index.ts:430` | unmatched/external | `OptionPrint` | schema parse before publish; no message auth observed |
| E003 | queue `options.prints.signal` | ingest-options `services/ingest-options/src/index.ts:432` | compute `services/compute/src/index.ts:1501` | signal `OptionPrint` | signal flag trusted across NATS |
| E004 | queue `options.prints.signal` | ingest-options/replay `services/replay/src/index.ts:407` | api `services/api/src/index.ts:945` | live option print | schema parse in API; no message auth observed |
| E005 | queue `options.nbbo` | ingest-options `services/ingest-options/src/index.ts:460` | compute `services/compute/src/index.ts:1537` | `OptionNBBO` | schema parse; no message auth observed |
| E006 | queue `equities.prints` | ingest-equities `services/ingest-equities/src/index.ts:266` | compute `services/compute/src/index.ts:1573` | `EquityPrint` | schema parse; no message auth observed |
| E007 | queue `equities.prints` | ingest-equities `services/ingest-equities/src/index.ts:266` | candles `services/candles/src/index.ts:341` | `EquityPrint` | schema parse; no message auth observed |
| E008 | queue `equities.quotes` | ingest-equities `services/ingest-equities/src/index.ts:292` | ingest-options `services/ingest-options/src/index.ts:476` | `EquityQuote` | used as enrichment context |
| E009 | queue `equities.candles` | candles `services/candles/src/index.ts:188` | api `services/api/src/index.ts:963` | `EquityCandle` | live fanout and storage path |
| E010 | queue `flow.packets` | compute `services/compute/src/index.ts:574` | api `services/api/src/index.ts:987` | `FlowPacket` | derived analytics live/storage path |
| E011 | queue `flow.smart_money` | compute `services/compute/src/index.ts:1083` | api `services/api/src/index.ts:993` | `SmartMoneyEvent` | derived analytics live/storage path |
| E012 | queue `flow.classifier_hits` | compute `services/compute/src/index.ts:1114` | api `services/api/src/index.ts:999` | `ClassifierHitEvent` | derived analytics live/storage path |
| E013 | queue `flow.alerts` | compute `services/compute/src/index.ts:1151` | api `services/api/src/index.ts:1005` | `AlertEvent` | broadcast/fanout path |
| E014 | queue `flow.news` | ingest-news `services/ingest-news/src/index.ts:158` | api `services/api/src/index.ts:1281` | `NewsStory` | API persists and fans out news; no NATS auth/ACL in compose |
| E015 | db table `news` | api `services/api/src/index.ts:1281` | API/web via storage `packages/storage/src/clickhouse.ts:1289` | persisted news | durable dataflow through ClickHouse |

## Coverage gaps

- Provider HTTP calls are external (`Alpaca`/market data) and were not treated as internal service edges.
- Raw `options.prints` has a producer but no in-repo durable consumer identified in this pass.
- NATS is configured in compose as `nats -js -sd /data` with no auth/ACL/TLS flags; queue source identity is therefore a cross-service trust assumption.
