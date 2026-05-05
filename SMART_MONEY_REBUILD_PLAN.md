# Smart Money Rebuild Plan

Living implementation tracker for the rules-first smart-money rebuild. Issue tracking remains in `bd`; this file records migration state, acceptance criteria, and handoff notes.

## Phase Checklists

### Phase 1: Contracts and Storage
- [x] Add `SmartMoneyEvent` contract in `packages/types`.
- [x] Add typed features, profile scores, abstention, and suppression metadata.
- [x] Extend `AlertEvent` with optional profile metadata.
- [x] Add `smart_money_events` ClickHouse storage helpers.
- [x] Add bus/live channel names for smart-money events.

Acceptance: smart-money events round-trip through schema/storage helpers and alerts remain backward-compatible.

### Phase 2: Parent-Event Reconstruction
- [x] Add `services/compute/src/parent-events.ts`.
- [x] Convert existing `FlowPacket` clusters and structure packets into deterministic parent events.
- [x] Emit deterministic event IDs from packet identity.
- [x] Preserve bridge semantics while `FlowPacket` remains an intermediate artifact.

Acceptance: live and replay produce the same event ID for the same packet.

### Phase 3: Feature Engineering
- [x] Build typed features for aggressor mix, spread/quote quality, timing, strike concentration, DTE, moneyness, structure markers, and event alignment fields.
- [x] Keep batch-only validation fields out of live scoring.
- [x] Connect an external event-calendar feed through `services/refdata`.

Acceptance: missing event-calendar fields produce neutral `null` feature values and do not block scoring.

### Phase 4: Rules Engine
- [x] Score the six primary profiles.
- [x] Return probabilities, confidence bands, directions, reason codes, and suppression reasons.
- [x] Add false-positive guards for stale quotes, complex/special prints, retail-frenzy directional suppression, hedge-reactive 0-2 DTE ATM contexts, and arbitrage symmetry.

Acceptance: abstained events do not emit legacy classifier hits.

### Phase 5: Synthetic Market Redesign
- [x] Rework synthetic options adapter around labeled parent-event templates.
- [x] Add deterministic scenario families for all six profiles.
- [x] Add test/demo operating modes with hidden labels.

Acceptance: scenario tests assert intended profile wins and wrong nearby profiles remain below threshold.

### Phase 6: Compute, API, and UI Rollout
- [x] Emit `SmartMoneyEvent` first in compute.
- [x] Derive compatibility `ClassifierHitEvent` and `AlertEvent`.
- [x] Add REST/history/replay/ws/live support for smart-money events.
- [x] Migrate terminal UI to profile-aware display.

Acceptance: old classifier and alert endpoints still work while `/flow/smart-money`, `/history/smart-money`, `/replay/smart-money`, and `/ws/smart-money` expose the new model.

### Phase 7: Evaluation and Replay
- [x] Add deterministic unit tests for parent-event scoring and storage.
- [ ] Add replay-style live-vs-batch consistency tests.
- [ ] Add evaluation utilities for calibration, abstention rate, and economic sanity checks.

## Migration Notes

- `FlowPacket` remains the packet/cluster bridge and is no longer the final semantic alert object.
- `ClassifierHitEvent` is now a compatibility surface derived from `SmartMoneyEvent.primary_profile_id`.
- `AlertEvent` keeps existing fields and may include `primary_profile_id` plus `profile_scores`.
- Existing structure labels such as vertical, straddle, roll, and 0DTE gamma are evidence/reason concepts rather than final business-facing profile IDs.
