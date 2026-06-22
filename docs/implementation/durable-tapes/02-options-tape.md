# Phase 02: Options Tape Module

Beads issue: `islandflow-h9c0.1`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Extract a durable `OptionsTape` module and make it the primary `/options` surface. This is the first domain module and should prove the shared foundation against the most demanding tape.

## Product Behavior

The options tape is signal-first by default. It should make current flow readable without forcing users into horizontal scrolling or permanent side panels.

Default view:

- `view: "signal"`
- default side filter includes `AA`, `A`, and `MID`
- default option types include calls and puts
- default security type is stock unless the user changes it
- filters live behind a gear popout

## Scope

- Create `apps/web/features/options-tape/`.
- Move options row normalization, contract display, column templates, filters, and hover content into the module.
- Use the shared durable foundation for virtual rows, hot head, ClickHouse history, scroll hold, and jump-to-live.
- Replace `/options` with a tape-first route.
- Keep the existing `/tape -> /options` behavior.
- Emit callbacks instead of opening legacy terminal drawers.

## Contract Display

The primary contract text must be instantly readable.

Preferred format:

```text
SPY 0DTE 555C
NVDA 6/28 145P
TSLA 7/19 320C
```

Inside a row, root and strike/right are the fastest scan targets. DTE or expiry is secondary. Raw OCC/canonical IDs appear in hover/detail, not as the primary label.

## Row Click Behavior

Row click changes scope:

- Normal print row: focus/filter the contract.
- Signal or hypothesis row: focus the contract and show only that flow packet's prints in the same table.
- Packet focus shows a subtle `show all` control to expand to all prints for that contract.
- A clear control returns to the global signal tape.

Scope stack:

```text
Signal tape
SPY 0DTE 555C / packet prints
SPY 0DTE 555C / all contract prints
Signal tape
```

## Dynamic Columns

The table shifts columns by mode and container size.

Global signal template:

```text
TIME | CONTRACT | PX | SIZE | PREMIUM | SIDE | IV
```

Packet-focused template:

```text
DT | TIME | PX | SIZE | PREMIUM | SIDE | SPOT
```

Contract-focused template:

```text
TIME | PX | SIZE | PREMIUM | NBBO | SIDE | EXCH | IV
```

The full column registry may include NBBO bid/ask, quote age, spread, conditions, exchange, trace ID, IV source, signal profile, and packet metadata. Those are hover/detail fields by default.

## Settings Gear

The tape header includes a small gear. The popout supports:

- View: Signal prints, All prints
- Side presets: Default, AA only, Ask side, Mid, Bid side, BB only, Custom
- Type: Calls, Puts, Calls + Puts
- Security: Stocks, ETFs, All
- Premium: min notional presets and custom value
- Reset: default signal view

Filter changes reset to the live head, clear queued counts, and reload the subscription/history for the new result set.

## Row Treatment

Signal and hypothesis state should not be a default column.

- Row tint maps to packet or hypothesis family.
- Intensity maps to strength or confidence.
- Side remains text because direction cannot be color-only.
- Hover/focus exposes packet links, hypothesis labels, confidence, reasons, related prints, trace ID, exchange, conditions, NBBO details, spot context, and IV source.

## Interaction States

- `live-at-top`: compact chrome, rows update normally.
- `scroll-held`: row stack freezes, jump-to-live count is emphasized.
- `loading-history`: bottom gate shows loading state.
- `packet-focus`: packet summary band appears above the table.
- `contract-focus`: contract scope band appears above the table.
- `hover`: detail surface shows omitted fields without changing layout.
- `narrow-container`: module steps down templates.

## Parallel Work

Can parallelize after Phase 01:

- Contract-display formatting and tests.
- Column template matrix and responsive breakpoint tests.
- Settings preset model and filter serialization tests.
- Hover/detail content inventory.

Keep serial:

- `/options` route replacement.
- Row-click scope transitions.
- Packet-focus behavior.
- Any callback contract shared with Phase 03.

## Stacking Guidance

This can stack on Phase 01 once the shared foundation exports are stable. If settings popout work becomes large, split it behind the core options tape PR. Do not stack packet-focus behavior unless Phase 03 has agreed on packet event types.

## Subagent Guidance

Good subagent tasks:

- Inventory all fields available on `OptionPrint`, support lookup payloads, and flow packet member refs.
- Draft no-horizontal-scroll templates for `full`, `twoThirds`, `half`, `oneThird`, and `micro`.
- Review existing tests around `/history/options`, raw versus signal view, and filter params.
- Browser-check contract readability across route width and one-third embed width after implementation.

Main agent must own:

- Row-click scope semantics.
- Settings preset semantics.
- `/options` route integration.
- Any change to subscription filters or history queries.

## Acceptance Gates

- `OptionsTape` is exported from `apps/web/features/options-tape/`.
- `/options` uses `OptionsTape` as the primary surface.
- Default view is signal.
- No production template needs horizontal scrolling.
- Row click focuses contract or packet prints according to row context.
- `show all` expands packet scope to all contract prints.
- Settings gear supports the required filter presets.
- Hover/focus surfaces expose omitted context.
- Existing durable options hot/history behavior remains intact.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun test services/api/tests/live.test.ts packages/storage/tests/option-prints.test.ts`
- `bun --cwd=apps/web run build`

## Out Of Scope

- Rebuilding alerts.
- Replacing the flow packets module.
- Adding new classifier or hypothesis semantics.
- Changing ingestion or ClickHouse schemas unless a missing field blocks the UI contract.
