# Architecture Review: Evidence-Backed Smart-Flow Detection

## Summary

No source code was modified. The current architecture is **not suitable as-is**, but it is **close enough to refactor, not rewrite**. The stack is right; the domain language and pipeline shape are not.

Research direction: direct observation → inference → hypothesis, with preserved evidence and visible uncertainty.

Key code evidence: `FlowPacket` is a generic feature bag in [events.ts](/Users/kell/dev/islandflow/packages/types/src/events.ts:193), `SmartMoneyEvent` already has useful score/abstention fields in [events.ts](/Users/kell/dev/islandflow/packages/types/src/events.ts:283), compute emits smart-money events then compatibility hits/alerts in [index.ts](/Users/kell/dev/islandflow/services/compute/src/index.ts:1086), storage keeps core hypothesis detail as JSON in [smart-money-events.ts](/Users/kell/dev/islandflow/packages/storage/src/smart-money-events.ts:24), and replay currently replays raw market streams rather than validating the whole derived pipeline in [replay/index.ts](/Users/kell/dev/islandflow/services/replay/src/index.ts:69).

## Source Documents

- Research report: [`docs/research-docs/smart-flow-market-mechanics.md`](../research-docs/smart-flow-market-mechanics.md)
- Research architecture review copy: [`docs/research-docs/smart-flow-architecture-review.md`](../research-docs/smart-flow-architecture-review.md)

These research documents explain the rationale. They are background, not implementation scope; execution scope lives in the Beads issue and the relevant phase document.

## Area Classification

| Area | Call | Architecture Review |
|---|---:|---|
| Domain model | **refactor** | Good bones, wrong center. Make evidence, hypotheses, scores, and alternatives first-class. |
| Event taxonomy | **refactor** | Raw/derived split is good; `smart_money`, `dark.inferred`, and `classifier_hits` leak overconfident product language. |
| Service boundaries | **refactor** | Ingest does too much signal policy; compute is too broad. Split pipeline stages before adding more intelligence. |
| `FlowPacket` | **refactor** | Keep concept, rename/reframe as `FlowEvidenceCluster` or `FlowCandidate`. Not a product domain object. |
| `SmartMoneyEvent` | **redesign** | Replace canonical object with `FlowHypothesisEvent`; use `SmartFlowInsight` only as UI/API projection. |
| Classifier pipeline | **redesign** | Current rules mix evidence extraction, hypothesis scoring, narrative labels, and alerting. Needs staged outputs. |
| ClickHouse/storage | **refactor** | Right datastore; raw tables are decent, derived evidence/hypotheses need typed/queryable columns plus JSON sidecars. |
| Redis baselines/cache | **refactor** | Right hot-state role; wrong as hidden baseline truth. Baselines need replayable snapshots/versioning. |
| NATS/JetStream subjects | **refactor** | Right bus; subjects should express stage/version: observations, evidence, hypotheses, insights. |
| Replay determinism | **redesign** | Present but not central enough. Replay must be the acceptance gate for derived outputs. |
| API/WebSocket | **refactor** | Mechanics are good; public surface should expose evidence bundles and hypotheses, not internal legacy names. |
| UI evidence model | **refactor** | Directionally good, but still foregrounds “profile/probability” over evidence quality, alternatives, and uncertainty. |
| Test strategy | **redesign** | Unit tests are solid scaffolding; needs fixture replay, false-positive suites, calibration, and end-to-end determinism. |

## Direct Answers

1. **Current suitability:** no. Useful infrastructure, but not yet an evidence-backed smart-flow architecture.
2. **`SmartMoneyEvent`:** not a good canonical domain object. Use **`FlowHypothesisEvent`**. `ParticipantHypothesisEvent` implies participant identity too strongly. `SmartFlowInsight` should be a user-facing projection.
3. **`FlowPacket`:** not as named. Keep the abstraction as an internal evidence cluster, rename to `FlowEvidenceCluster` or `FlowCandidate`.
4. **Service boundaries:** not right. Ingest should normalize only; evidence quality, eligibility, clustering, hypothesis scoring, and insight projection should be separate stages.
5. **ClickHouse/Redis/NATS roles:** yes broadly. ClickHouse = authoritative event/audit store. Redis = hot cache only. NATS = transport, not truth. All three need cleaner contracts.
6. **Replay central enough:** no. It should be how every detection change proves itself.
7. **UI uncertainty:** partially. It shows evidence refs, profile ladders, abstention, and suppression, but needs confidence vs conviction, alternative explanations, evidence quality, and “why not” signals.
8. **First-class domain objects:** raw observations, execution context, quote join, eligibility decision, evidence cluster, structure hypothesis, evidence quality score, baseline snapshot, hypothesis score vector, false-positive penalty, catalyst context, flow hypothesis event, smart-flow insight, replay run.
9. **Implementation details:** Redis list layout, durable consumer names, current classifier thresholds, ClickHouse batch writer, adapter internals, legacy `ClassifierHitEvent`, alert severity math, UI cache mechanics.
10. **Delete/defer:** canonical “smart money” naming, real-time dark-pool certainty, standalone whale-premium alerts, trade-level open/close claims, participant identity claims, simplistic premium alert score, ingest-time signal filtering, `retail_whale` as a canonical profile unless reframed as attention/lottery flow.

## Option A — Conservative

Summary: keep current objects and services; add evidence-quality fields, UI copy fixes, and replay tests.

Pros: fastest, lowest migration risk, preserves current endpoints and UI.

Cons: leaves misleading canonical names; makes future research harder; keeps inference tangled inside current compute flow.

Complexity: low. Migration risk: low.

Better: less overconfidence, more visible suppression, quicker validation.

Worse: domain debt remains; `SmartMoneyEvent` becomes harder to undo later.

Likely kept: most code in `services/compute`, `packages/types`, `packages/storage`, API routes, UI panes.

Likely rewritten: alert scoring, UI labels, some profile fields.

Likely deleted: almost nothing.

PR sequence:
1. Rename UI copy from “Smart money” to “Smart flow candidate.”
2. Add evidence-quality and alternative-explanation fields to existing event.
3. Add replay consistency tests around current outputs.
4. Add typed ClickHouse columns for high-value JSON fields.
5. Deprecate, but do not remove, legacy classifier hit display.

## Option B — Refactor

Summary: keep Bun/TS, NATS, ClickHouse, Redis, API/WS, and the terminal UI, but rebuild the domain pipeline around evidence clusters and hypothesis events.

Pros: fixes the product’s epistemic spine without wasting useful infrastructure; best fit for pre-alpha.

Cons: breaking contract migration; touches types, storage, compute, API, UI, and tests.

Complexity: medium-high. Migration risk: medium.

Better: replayability, auditability, naming, evidence display, calibration, and future research velocity.

Worse: more short-term churn; old demos and endpoints need compatibility aliases.

Likely kept: raw market schemas, adapters, NATS/ClickHouse/Redis clients, live socket mechanics, virtualized UI, replay service skeleton, many feature calculations.

Likely rewritten: `SmartMoneyEvent`, `FlowPacket`, classifier pipeline, alert projection, ClickHouse derived schemas, API channel names, UI evidence drawers.

Likely deleted: canonical `smart_money` naming, ingest signal policy, premium-heavy alert scoring, `ClassifierHitEvent` as primary domain surface.

PR sequence:
1. Introduce `FlowEvidenceCluster`, `FlowHypothesisEvent`, `SmartFlowInsight`, `EvidenceQuality`, and version fields; keep aliases for compatibility.
2. Move signal eligibility out of ingest; ingest publishes normalized observations plus execution context only.
3. Split compute internally into evidence join → cluster/structure → hypothesis scoring → insight/alert projection.
4. Replace derived JSON-only storage with typed query columns for evidence quality, hypothesis scores, model version, policy version, and refs.
5. Add replay-run harness that recomputes derived outputs from raw streams and compares signatures.
6. Add `/flow/evidence`, `/flow/hypotheses`, `/flow/insights` plus WS equivalents; keep legacy endpoints as aliases.
7. Rework UI drawers/tables around evidence quality, confidence vs conviction, alternatives, abstention, and catalyst/noise context.
8. Add fixture suites for stale quotes, complex spreads, 0DTE/event noise, deep ITM, wide spreads, and off-exchange ambiguity.

## Option C — Redesign

Summary: if starting over, build an event-sourced evidence engine with raw observations as the only source of truth and every derived artifact generated by versioned, replayable policies.

Pros: cleanest long-term architecture; strongest research discipline; easiest calibration/backtesting story.

Cons: slowest; overkill before product fit; discards too much working terminal and streaming infrastructure.

Complexity: very high. Migration risk: high.

Better: clean contracts, model versioning, deterministic replay, research-grade evidence lineage.

Worse: delivery speed, continuity, and working UI velocity.

Likely kept: market adapters, some schemas, ClickHouse client, NATS helpers, UI visual direction, selected tests.

Likely rewritten: almost all compute, storage schemas, API contracts, replay, UI data model.

Likely deleted: `FlowPacket`, `SmartMoneyEvent`, `ClassifierHitEvent`, `AlertEvent` as currently shaped, current subject hierarchy, current derived tables.

PR sequence:
1. Define new canonical event taxonomy and versioned policy registry.
2. Build raw observation lake and deterministic replay runner first.
3. Build evidence extraction and quote/condition eligibility services.
4. Build cluster and structure hypothesis services.
5. Build hypothesis scoring and calibration services.
6. Build insight projection API.
7. Rebuild terminal against new evidence/hypothesis contracts.
8. Backfill or discard old derived data.

## Recommendation

Choose **Option B**.

Bluntly: Option A is too timid for a pre-alpha product whose current names already fight the research. Option C is intellectually clean but wastes too much working infrastructure. Option B keeps the stack and terminal momentum while fixing the core mistake: treating “smart money” as a thing the system emits, instead of treating smart flow as a cautious, evidence-backed hypothesis with alternatives.

The first implementation move should be the contract/naming PR: introduce `FlowHypothesisEvent` and `FlowEvidenceCluster` with compatibility aliases, then make replay the gate before touching more classifier logic.
