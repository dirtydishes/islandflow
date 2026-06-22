# Phase 00: Durable Tape Roadmap

Beads issue: `islandflow-h9c0.2`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`PLAN.html`](./PLAN.html)

## Purpose

Create the durable implementation surface for reusable tape modules before code moves. This phase records the module boundaries, UI rules, phase order, Beads graph, and user-facing plan for options, flow packets, news, equities, and alerts.

## Product Goal

Islandflow should have a family of durable, resizable tape modules that can be placed on any route without rebuilding live/history behavior each time. The modules should feel like dense instruments, not dashboard cards.

## Current State

- Options, flow packets, and news already use TanStack virtual rows through terminal-era pane components.
- Options already has hot-cache plus ClickHouse history behavior: live head capped at 100 rows, older rows loaded through `/history/options`, and execution context such as NBBO, spot, and IV preserved.
- Flow and news have history endpoints and virtual rendering, but they are still terminal pane components.
- Equities tape behavior is available in state and APIs, but it is not yet a reusable tape module.
- Alerts are tightly attached to terminal drawers and evidence prefetching, and need a separate module rebuild.
- Shared scroll, row key, hot/history merge, and pause behavior exists in terminal helpers, but it is not yet a clean product module.

## Architecture Direction

Create one shared `durable-tape` foundation, then domain modules:

```text
features/durable-tape/
features/options-tape/
features/flow-packets/
features/news-wire/
features/equities-tape/
features/alerts/
```

The shared foundation handles mechanics: virtualization, hot head, history paging, scroll hold, feature flags, templates, settings surfaces, hover shells, and keyboard affordances.

Domain modules handle meaning: columns, filters, row emphasis, detail content, and callbacks.

Routes handle composition: `/options`, `/news`, dashboard modules, and future `/flow`, `/equities`, and `/alerts` pages.

## Phase Order

| Phase | Issue | Output | Dependency posture |
| --- | --- | --- | --- |
| 00 | `islandflow-h9c0.2` | Planning docs and consolidated `PLAN.html` | Start here. |
| 01 | `islandflow-h9c0.3` | Shared durable tape foundation | Blocks every domain module. |
| 02 | `islandflow-h9c0.1` | Options tape module | First domain extraction and primary `/options` consumer. |
| 03 | `islandflow-h9c0.4` | Flow packets module | Can run after foundation, coordinates with options packet focus. |
| 04 | `islandflow-h9c0.8` | News wire module | Can run after foundation. |
| 05 | `islandflow-h9c0.5` | Equities tape module | Can run after foundation. |
| 06 | `islandflow-h9c0.7` | Alerts module | Waits on options and flow packet contracts. |
| 07 | `islandflow-h9c0.6` | Route composition, cleanup, verification | Final integration only. |

## UX Rules

Use `$impeccable` for UI and UX work.

- No cards in the primary tape surface.
- No horizontal scroll in production templates.
- Default templates show only the columns users need for scan speed.
- Hover and keyboard focus expose omitted context.
- Row color/tone can encode signal or hypothesis family, but visible text must still carry meaning.
- Scroll hold keeps the visible tape stable while ingestion continues.
- Jump-to-live shows an icon plus queued item count.
- Settings use a small gear and popout, not a permanent control wall.
- Dynamic emphasis is state-driven and anchor-safe. Do not move the row the user is reading.

## Shared Feature Flag Contract

The `default` feature flag expands to the normal feature set. Later entries override earlier entries.

```ts
features={[
  "default",
  { key: "template", value: "oneThird" },
  { key: "settingsGear", enabled: false }
]}
```

The foundation must expose a resolver that can be unit-tested without React.

## Template Contract

Templates are width-aware and domain-owned.

Required names:

- `full`
- `twoThirds`
- `half`
- `oneThird`
- `micro`

The shared module chooses the largest safe template for its container when `template="auto"`.

## Acceptance Gates

- `IMPLEMENT.md` exists and names the Beads graph.
- Phase docs `00` through `07` exist.
- `PLAN.html` exists and is readable as a consolidated user-facing plan.
- The docs record the no-horizontal-scroll, signal-default, scroll-hold, hover-detail, and separate-module decisions.
- Beads issues exist for every phase and dependencies are wired.

## Out Of Scope

- Runtime code changes.
- Moving terminal files.
- Adding new API endpoints.
- Browser QA against runtime pages.
