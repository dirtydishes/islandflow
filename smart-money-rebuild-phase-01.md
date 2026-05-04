# Smart Money Rebuild Plan

## Summary
Rebuild the current packet-threshold classifier into a `rules-first`, parent-event, multi-profile system driven by the taxonomy in [smartmoney.md](/Users/kell/Cloud/dev/islandflow/smartmoney.md). The first milestone will ship a new event model, feature pipeline, profile rule engine, event-calendar enrichment, deterministic synthetic scenarios, and a compatibility bridge to current alerts/UI. We will explicitly ignore anything that requires owner/account identity, supervised model training, anomaly detection, or speculative profile claims we cannot support from public-tape-style data.

## Scope In
- Core 6 primary profiles: `institutional_directional`, `retail_whale`, `event_driven`, `vol_seller`, `arbitrage`, `hedge_reactive`
- Parent-event reconstruction from child prints, NBBO context, structure context, and underlying context
- Probabilistic rule scores with reason codes and abstentions
- External corporate-event calendar support via `services/refdata`
- Scenario-driven synthetic options/equity/quote generation for tests, replay, and demos
- Compat bridge from new profile model back to current `ClassifierHitEvent` and `AlertEvent`

## Scope Out
- Supervised model training/inference in v1
- Unsupervised anomaly detection in v1
- `prop/professional customer` as a first-class output
- Claims about beneficial owner, account class, or illegal intent
- Real-time use of next-day open interest
- Rule 606/CAT/private broker data integrations

## Phase 0: Planning Artifact
- Create `SMART_MONEY_REBUILD_PLAN.md` at repo root as the living implementation document.
- Copy this phased plan into that file and add per-phase checklists, acceptance criteria, and migration notes.
- Treat that file as the session handoff and implementation tracker, while still using `bd` for issue tracking.

## Phase 1: Contracts and Storage
- Add a new event contract in `packages/types` for `SmartMoneyEvent` with:
  - `event_id`, `packet_ids`, `member_print_ids`, `underlying_id`, `event_kind`, `event_window_ms`
  - `features` as structured typed fields, not only loose string/number maps
  - `profile_scores: { profile_id, probability, confidence_band, direction, reasons[] }[]`
  - `primary_profile_id`, `primary_direction`, `abstained`, `suppressed_reasons[]`
- Keep `FlowPacket` during bridge, but stop treating it as the final semantic unit.
- Keep `ClassifierHitEvent`, but derive it from `SmartMoneyEvent.primary_profile_id` plus legacy mapping.
- Add storage support in `packages/storage` for `smart_money_events`.
- Extend `AlertEvent` with optional `primary_profile_id` and `profile_scores` while preserving current fields.

## Phase 2: Parent-Event Reconstruction
- Add `services/compute/src/parent-events.ts` to group child prints into parent events.
- Reconstruction key should use: contract, direction proxy, burst gap, venue burst context, and structure linkage.
- Preserve special-print flags from conditions so auctions/crosses/complex-like prints can be suppressed or downweighted.
- Allow two parent paths:
  - `single_leg_event`
  - `multi_leg_event`
- Reuse current structure logic where useful, but move the semantic output to parent events instead of direct classifier hits.
- Emit deterministic event IDs so batch replay and live scoring agree.

## Phase 3: Feature Engineering
- Add typed feature builders for:
  - aggressor mix, spread position, quote age, venue count, inter-fill timing, strike concentration
  - DTE, moneyness, ATM proximity, synthetic IV shock, spread widening, underlying move linkage
  - structure markers, same-size leg symmetry, net directional bias proxies
  - event alignment: days-to-event, expiry-after-event, pre-event concentration
- Build event-calendar ingestion in `services/refdata` for earnings/corporate events from a simple external feed or static importable provider layer.
- Live scoring may use only timestamp-available data; any later validation fields must be batch-only.

## Phase 4: Rules Engine
- Replace `services/compute/src/classifiers.ts` with profile rules centered on the six primary profiles.
- Each rule returns probability, direction, reason codes, suppression reasons, and a confidence band.
- Add explicit false-positive guards from the research doc:
  - special/complex/auction suppression for directional labels
  - retail-frenzy guard on short-dated OTM call bursts
  - hedge-reactive preference for 0-2 DTE ATM/high-gamma/reactive-underlier cases
  - arbitrage requirement for matched-leg symmetry and near-flat directional exposure
- Keep existing structure-specific ideas like straddle/vertical/roll as evidence and reasons, not top-level end states.

## Phase 5: Synthetic Market Redesign
- Rework `services/ingest-options/src/adapters/synthetic.ts` around labeled parent-event templates instead of loose burst presets.
- Add deterministic synthetic scenario families matching the core 6 profiles plus neutral background noise.
- Each scenario must emit a coherent bundle:
  - child option prints
  - contemporaneous NBBO evolution
  - underlying quote path
  - IV response pattern
  - realistic conditions/venues/structure markers
- Add two operating modes:
  - `test`: seeded, deterministic, low-noise, exact expected labels
  - `demo`: seeded, realistic background with controlled noise ratios
- Keep synthetic hidden labels internal to tests/replay harnesses, not public production payloads.

## Phase 6: Compute, API, and UI Rollout
- In `services/compute`, emit `SmartMoneyEvent` first, then derive compat `ClassifierHitEvent` and `AlertEvent`.
- In `services/api`, add read/stream endpoints for `SmartMoneyEvent` while preserving existing endpoints.
- In `apps/web/app/terminal.tsx`, migrate rendering to profile-aware displays:
  - primary profile
  - probability ladder
  - reason codes
  - suppression/abstention state
- During the bridge, old UI elements should continue working from mapped legacy hits.

## Phase 7: Evaluation and Replay
- Add deterministic rule tests per profile and per major false-positive case.
- Add replay-style integration tests for live-vs-batch consistency.
- Add synthetic scenario acceptance tests proving:
  - the intended profile wins
  - nearby wrong profiles stay below a threshold
  - noisy background does not overwhelm expected results
- Add evaluation utilities for parent-event precision/recall, calibration, abstention rate, and economic sanity checks.

## Important API and Type Changes
- New primary stream/table/type: `SmartMoneyEvent`
- `ClassifierHitEvent` becomes a legacy-derived compatibility surface
- `AlertEvent` gains optional profile metadata but keeps existing shape
- `FlowPacket` remains during migration, but becomes an intermediate artifact rather than the final semantic alert object

## Test Cases and Scenarios
- Institutional directional: aggressive concentrated call/put burst with catalyst-aligned expiry
- Retail whale: short-dated OTM attention-name chase with IV pop
- Event-driven: pre-earnings aligned expiry and widening spreads
- Vol seller: sell-side dominant overwrite/put-write/short-vol structure
- Arbitrage: matched multi-leg parity-style event with low net directional bias
- Hedge reactive: short-dated ATM burst tied to underlying move and gamma-sensitive conditions
- False positives: auctions, complex prints, late/stale quote context, illiquid wide spreads, retail frenzy misread as institution, structure trades misread as direction

## Assumptions and Defaults
- Rollout mode: `Compat Bridge`
- First milestone: `Rules-first`
- Primary outputs: `Core 6`
- Event-driven flow uses real external event-calendar enrichment in v1
- `prop/professional customer` remains supporting evidence only
- Existing rule labels like `vertical_spread` and `zero_dte_gamma_punch` become evidence/reason codes, not final business-facing profile IDs
- Synthetic generation is optimized for deterministic realism, not maximum randomness
