# Options Overhaul Phase 1: Snapshot Tape Table

Implemented Phase 1 snapshot semantics for the Options tape.

## Completed

- Added flat execution snapshot fields to `OptionPrintSchema` / `OptionPrint`.
- Added ClickHouse columns and migrations for execution NBBO, underlying spot, and IV context.
- Added ingest enrichment that selects option NBBO and equity quote context at or before the option print timestamp.
- New enriched prints mirror `nbbo_side` from `execution_nbbo_side`.
- Added synthetic per-contract IV state with pressure, decay, and clamps.
- Redesigned the Options pane as a dense table using preserved spot/IV/NBBO side first.
- Added classifier-hit row color mapping and click/keyboard drawer interaction for classified rows.
- Updated `/tape` live subscriptions to include `classifier-hits`.
- Added focused tests for schema, storage, enrichment, synthetic IV, and frontend table/classifier helpers.

## Verification

- `bun test packages/types/tests/events.test.ts packages/storage/tests/option-prints.test.ts services/ingest-options/tests/enrichment.test.ts services/ingest-options/tests/synthetic.test.ts apps/web/app/terminal.test.ts`
- `bun run build` from `apps/web`
