# Options Overhaul Phase 1: Snapshot Tape Table

## Summary

Convert the Options tape into a dense table where every row is an individual option print with preserved execution context. The print itself becomes the authoritative record for what was known around that trade at the moment it printed: option NBBO, underlying spot, IV, notional, side/classification metadata, and classifier-derived row coloring.

This phase includes backend enrichment, storage/type changes, synthetic IV behavior, and the frontend table redesign together.

## Core Principle

Do not treat NBBO, spot, or IV as live lookups in the table once the print has been recorded.

Each option print should carry a snapshot of its execution context. The UI should prefer those preserved fields and only fall back to current side maps for legacy rows that predate the migration.

## Public Type Changes

Extend `OptionPrintSchema` / `OptionPrint` in `packages/types/src/events.ts`.

Add optional flat fields:

```ts
execution_nbbo_bid?: number;
execution_nbbo_ask?: number;
execution_nbbo_mid?: number;
execution_nbbo_spread?: number;
execution_nbbo_bid_size?: number;
execution_nbbo_ask_size?: number;
execution_nbbo_ts?: number;
execution_nbbo_age_ms?: number;
execution_nbbo_side?: OptionNbboSide;

execution_underlying_spot?: number;
execution_underlying_bid?: number;
execution_underlying_ask?: number;
execution_underlying_mid?: number;
execution_underlying_spread?: number;
execution_underlying_ts?: number;
execution_underlying_age_ms?: number;
execution_underlying_source?: "equity_quote_mid";

execution_iv?: number;
execution_iv_source?: "provider" | "synthetic_pressure_model";
```

Keep existing fields for compatibility:

- `nbbo_side`
- `notional`
- `underlying_id`
- `option_type`
- `signal_*`

Set `nbbo_side` to match `execution_nbbo_side` for new prints so existing filters continue working.

## Storage Changes

Update `packages/storage/src/option-prints.ts`.

Add ClickHouse columns:

```sql
execution_nbbo_bid Nullable(Float64),
execution_nbbo_ask Nullable(Float64),
execution_nbbo_mid Nullable(Float64),
execution_nbbo_spread Nullable(Float64),
execution_nbbo_bid_size Nullable(UInt32),
execution_nbbo_ask_size Nullable(UInt32),
execution_nbbo_ts Nullable(UInt64),
execution_nbbo_age_ms Nullable(Float64),
execution_nbbo_side Nullable(String),

execution_underlying_spot Nullable(Float64),
execution_underlying_bid Nullable(Float64),
execution_underlying_ask Nullable(Float64),
execution_underlying_mid Nullable(Float64),
execution_underlying_spread Nullable(Float64),
execution_underlying_ts Nullable(UInt64),
execution_underlying_age_ms Nullable(Float64),
execution_underlying_source Nullable(String),

execution_iv Nullable(Float64),
execution_iv_source Nullable(String)
```

Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations for all fields.

Update row normalization so missing legacy values parse as `undefined`.

## Ingest Enrichment

Update `services/ingest-options/src/index.ts`.

Maintain caches:

- latest option NBBO by contract
- latest equity quote by underlying
- synthetic/adapter-provided IV by contract when available

When an option trade arrives:

1. Parse raw print.
2. Derive underlying, option type, notional, ETF flag as today.
3. Select latest option NBBO for the contract at or before `print.ts`.
4. Attach preserved NBBO fields:
   - bid, ask, mid, spread
   - bid/ask sizes
   - quote timestamp
   - quote age
   - execution NBBO side
5. Select latest equity quote for the underlying at or before `print.ts`.
6. Attach preserved underlying fields:
   - bid, ask, mid
   - spread
   - quote timestamp
   - quote age
   - `execution_underlying_spot = mid`
   - `execution_underlying_source = "equity_quote_mid"`
7. Attach IV if available.
8. Evaluate signal filters using preserved execution fields.
9. Persist and publish the enriched print.

Important behavior:

- Do not mark these preserved fields stale in the UI.
- Age fields are still stored for auditability.
- If no at-or-before quote exists, leave that context unset.
- Never use a quote after the option print timestamp for preserved execution context.

## Synthetic IV Model

Update `services/ingest-options/src/adapters/synthetic.ts`.

Add persistent contract-level IV state:

```ts
type SyntheticContractIvState = {
  iv: number;
  pressure: number;
  lastTs: number;
};
```

Behavior:

- Initialize IV from a plausible baseline based on DTE and moneyness.
- Maintain IV per contract across bursts.
- Repeated aggressive buying of the same contract raises pressure and IV.
- Aggressive buying means synthetic placement `A` or `AA`.
- `MID` has small/no pressure.
- `B` or `BB` reduces pressure slightly.
- Pressure decays over time after inactivity.
- IV is clamped to a plausible range.

Recommended defaults:

- Baseline IV: `0.18` to `0.65`
- 0DTE contracts start higher than far-dated contracts.
- Out-of-the-money contracts start slightly higher than near-the-money contracts.
- Ask/above-ask print pressure increment: proportional to size and notional.
- Decay half-life: roughly 30-90 seconds in synthetic time.
- Clamp IV to `0.05..2.5`.

Each synthetic `OptionPrint` should include:

```ts
execution_iv
execution_iv_source: "synthetic_pressure_model"
```

Synthetic NBBO and trade price generation should remain coherent:

- As IV rises, option mid/ask should drift higher for that contract.
- Rapid same-contract buying should visibly increase both print price and IV over subsequent prints.
- Bid/ask spread may widen mildly with higher IV.

## Real Adapter IV Behavior

For Alpaca, Databento, and IBKR in Phase 1:

- Preserve NBBO and underlying spot context through ingest enrichment.
- Leave `execution_iv` unset unless the adapter already provides a reliable IV value.
- Do not invent IV for real feeds in Phase 1.

Synthetic is the only source that must generate IV in this phase.

## Frontend Table Redesign

Update `apps/web/app/terminal.tsx` and `apps/web/app/globals.css`.

Each Options row remains an `OptionPrint`.

Default columns:

- `TIME`
- `SYM`
- `EXP`
- `STRIKE`
- `C/P`
- `SPOT`
- `DETAILS`
- `TYPE`
- `VALUE`
- `SIDE`
- `IV`
- `CLASSIFIER`

Column sources:

- `SPOT`: `execution_underlying_spot`, fallback `--`
- `SIDE`: `execution_nbbo_side ?? nbbo_side`
- `IV`: `execution_iv`, formatted as percent, fallback `--`
- `DETAILS`: `{size}@{price}_{side}`
- `VALUE`: `notional ?? price * size * 100`

For legacy rows only:

- If preserved NBBO is missing, fallback to existing frontend NBBO map.
- If preserved spot/IV is missing, render `--`.

## Classifier Row Coloring

Add derived indexes in `TerminalProvider`:

- `classifierHitsByPacketId`
- `packetIdByOptionTraceId`
- `classifierDecorByOptionTraceId`

A print inherits classifier color if its trace ID belongs to a flow packet that produced classifier hits.

Primary hit selection:

1. Highest confidence
2. Newest `source_ts`
3. Highest `seq`

Classifier families:

- `large_bullish_call_sweep`: green
- `large_bearish_put_sweep`: red
- `unusual_contract_spike`: amber
- `large_call_sell_overwrite`: copper
- `large_put_sell_write`: copper
- `straddle` / `strangle`: blue
- `vertical_spread`: teal
- `ladder_accumulation`: yellow-green
- `roll_up_down_out`: violet
- `far_dated_conviction`: cyan
- `zero_dte_gamma_punch`: magenta
- unknown: neutral

Confidence controls row intensity.

## Interaction

Classified rows:

- Click opens existing classifier/alert drawer behavior through `state.openFromClassifierHit(primaryHit)`.
- Keyboard Enter/Space does the same.
- Row remains compact and table-like.

Unclassified rows:

- Hover only.
- No drawer action.

## Live Manifest

Update `/tape` live subscriptions to include classifier hits:

```ts
[
  { channel: "options", filters: flowFilters },
  { channel: "nbbo" },
  { channel: "equities" },
  { channel: "flow", filters: flowFilters },
  { channel: "classifier-hits" }
]
```

The table uses preserved execution context from options first, not these side feeds.

## Tests

Add/update tests for:

- `OptionPrintSchema` accepts preserved execution context fields.
- ClickHouse option print normalization handles missing legacy context fields.
- Ingest enrichment attaches preserved NBBO context.
- Ingest enrichment attaches preserved underlying quote mid as spot.
- Enrichment never uses quotes after the option print timestamp.
- `nbbo_side` mirrors `execution_nbbo_side` for new enriched prints.
- Synthetic IV increases under repeated same-contract ask/above-ask buying.
- Synthetic IV decays after inactivity.
- Synthetic IV remains within clamps.
- Options table renders SPOT from `execution_underlying_spot`.
- Options table renders IV from `execution_iv`.
- Legacy rows render `--` for missing SPOT/IV.
- Classifier family mapping and primary hit selection work.
- Classified row opens existing classifier/alert drawer path.

## Acceptance Criteria

- The Options tape is a dense table, not card rows.
- Every new option print stores preserved execution NBBO context.
- Every new option print stores preserved execution underlying spot when an at-or-before equity quote exists.
- Synthetic option prints store dynamic IV.
- Synthetic repeated buying of the same contract visibly increases IV.
- The table reads NBBO, SPOT, and IV from preserved print fields first.
- Classifier-hit rows are color-coded by classifier family.
- Existing live/replay filters and tape controls still work.
- No context field is visually treated as stale after being attached to the print.
- Legacy data remains readable with graceful fallbacks.

## Assumptions

- Phase 1 uses flat fields for queryability and simple table rendering.
- Underlying spot means equity quote mid at or before the option print timestamp.
- NBBO context means option quote at or before the option print timestamp.
- Preserved age fields are audit metadata, not UI freshness warnings.
- Real-feed IV can remain absent until a reliable provider value is available.
