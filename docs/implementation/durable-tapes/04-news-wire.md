# Phase 04: News Wire Module

Beads issue: `islandflow-h9c0.8`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Extract the current news wire into a reusable durable module that can live on `/news`, dashboards, or symbol-focused pages without terminal state.

## Current State

`NewsPane` already uses virtual rows, source/symbol labels, and `/history/news`. It needs a domain module boundary and a cleaner detail surface.

## Scope

- Create `apps/web/features/news-wire/`.
- Extract news row formatting, symbol labels, status state, source filters, and detail content.
- Use the shared durable foundation for virtual rows, scroll hold, jump-to-live, and history.
- Keep news live-first. Replay can remain disabled unless a phase explicitly adds durable replay support.
- Replace terminal-coupled news drawer behavior with module callbacks or module-owned detail.

## Default Columns

Full template:

```text
TIME | SOURCE | SYMBOLS | HEADLINE
```

Two-thirds template:

```text
TIME | SYMBOLS | HEADLINE
```

One-third template:

```text
TIME | HEADLINE
```

Summary, provider metadata, content HTML, updated state, and raw mapped symbols belong in hover/detail by default.

## Settings

The settings gear can support:

- source filters
- symbol filters
- mapped/unmapped state
- updated-only toggle
- reset filters

Do not create a permanent filter rail unless a route explicitly opts into it.

## Parallel Work

Can parallelize after Phase 01:

- News field inventory and decode/sanitize review.
- Source and symbol filter model.
- Column template matrix.
- Hover/detail content design.

Keep serial:

- `/news` route replacement.
- Detail surface ownership.
- Any behavior around replay-disabled state.

## Stacking Guidance

This is the safest domain module to stack after Phase 01 because it has few shared callbacks. It can run in parallel with options, flow, or equities. Do not block Phase 04 on alert redesign.

## Subagent Guidance

Good subagent tasks:

- Inventory `NewsPane`, `NewsControlRails`, and `NewsDrawer` responsibilities.
- Audit headline and summary truncation at mobile widths.
- Review `/history/news` coverage and live-only copy.

Main agent must own:

- Module public props.
- Detail surface behavior.
- `/news` route integration.

## Acceptance Gates

- `NewsWire` is exported from `apps/web/features/news-wire/`.
- `/news` can render through the new module or compatibility adapter.
- Live history scroll gate still works.
- Replay-disabled state remains clear if replay is not implemented.
- No default template needs horizontal scrolling.
- `bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts`
- `bun --cwd=apps/web run build`

## Out Of Scope

- News ingestion changes.
- New symbol-resolution logic.
- Alert generation from news.
