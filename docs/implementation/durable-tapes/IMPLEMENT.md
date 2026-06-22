# Implementing Durable Tape Modules

This directory is the active implementation guide for durable, reusable tape modules across Islandflow market-data surfaces.

Readable plan: [`PLAN.html`](./PLAN.html).

## Beads Workflow

Use Beads as the source of truth for execution order.

```bash
bd ready
bd show <issue-id>
bd update <issue-id> --claim
```

Only work on a phase when `bd ready` shows it as unblocked. The epic is:

- `islandflow-h9c0` - Plan durable reusable tape modules

Phase issues:

| Phase | Beads issue | Phase doc | Depends on | PR posture |
| --- | --- | --- | --- | --- |
| 00 - Planning docs | `islandflow-h9c0.2` | [`00-roadmap.md`](./00-roadmap.md) | None | Docs-only planning commit. No runtime changes. |
| 01 - Shared durable tape foundation | `islandflow-h9c0.3` | [`01-shared-foundation.md`](./01-shared-foundation.md) | `islandflow-h9c0.2` | One focused foundation PR. No domain redesign beyond compatibility adapters. |
| 02 - Options tape module | `islandflow-h9c0.1` | [`02-options-tape.md`](./02-options-tape.md) | `islandflow-h9c0.3` | First domain extraction. Keep `/options` tape-first and phase-bounded. |
| 03 - Flow packets module | `islandflow-h9c0.4` | [`03-flow-packets.md`](./03-flow-packets.md) | `islandflow-h9c0.3` | Can run after foundation. Coordinate packet callbacks with Phase 02. |
| 04 - News wire module | `islandflow-h9c0.8` | [`04-news-wire.md`](./04-news-wire.md) | `islandflow-h9c0.3` | Can run after foundation. Keep news live-first. |
| 05 - Equities tape module | `islandflow-h9c0.5` | [`05-equities-tape.md`](./05-equities-tape.md) | `islandflow-h9c0.3` | Can run after foundation. Do not mix chart work into the tape module. |
| 06 - Alerts module | `islandflow-h9c0.7` | [`06-alerts-module.md`](./06-alerts-module.md) | `islandflow-h9c0.3`, `islandflow-h9c0.1`, `islandflow-h9c0.4` | Rebuild alerts separately after packet/options event contracts exist. |
| 07 - Route composition and closeout | `islandflow-h9c0.6` | [`07-route-composition-closeout.md`](./07-route-composition-closeout.md) | `islandflow-h9c0.1`, `.4`, `.8`, `.5`, `.7` | Integration and cleanup only. Avoid adding new domain behavior. |

## How To Pick Up Work

1. Run `bd ready`.
2. Pick the next ready `islandflow-h9c0.*` issue.
3. Run `bd show <issue-id>` and read its `spec_id`.
4. Read this `IMPLEMENT.md`.
5. Read the linked phase document.
6. Claim the issue with `bd update <issue-id> --claim`.
7. Implement only that phase unless the phase doc explicitly names a separable lane.

## Product And UX Rules

Use the repo-local `$impeccable` skill for all UI/UX work in this stream.

The durable tape family is product UI for serious traders and researchers. It must stay dense, flat, restrained, and evidence-first.

Non-negotiable rules:

- No cards in the primary tape surface.
- No horizontal scrolling in production tape templates.
- Tables are dense, resizable, and stable inside any parent container.
- Extra data belongs in hover, focus, settings, or detail surfaces before it becomes a visible column.
- Red and green never carry direction alone. Include text, shape, position, or explicit labels.
- Signal and hypothesis membership is row treatment plus hover/detail context, not a default column.
- Scrolling away from the live head pauses visible insertion, not ingestion.
- Jump-to-live shows an icon and a count of new prints or stories since scroll hold began.
- UI emphasis may change by state, but the row stack must not shift while the user is reading.
- Settings popouts must render outside virtualized scroll containers to avoid clipping.

## Target Module Stack

```text
apps/web/features/durable-tape/
  index.ts
  types.ts
  feature-flags.ts
  templates.ts
  columns.ts
  keys.ts
  history.ts
  scroll-hold.ts
  hover.ts
  components/
    DurableTape.tsx
    DurableTapeHeader.tsx
    DurableTapeSettingsPopover.tsx
    DurableTapeHoverSurface.tsx
    DurableTapeJumpToLive.tsx

apps/web/features/options-tape/
apps/web/features/flow-packets/
apps/web/features/news-wire/
apps/web/features/equities-tape/
apps/web/features/alerts/
```

The shared foundation owns mechanics. Domain modules own meaning. Routes compose modules.

## Shared Interface Direction

The shared module should make common behavior available through a small interface:

```ts
export type DurableTapeProps<TItem, TScope, TFilters> = {
  scope?: TScope;
  filters?: TFilters;
  features?: DurableTapeFeatureInput[];
  template?: DurableTapeTemplateId | "auto";
  columns?: DurableTapeColumnOverride<TItem>[];
  getRowKey: (item: TItem) => string;
  getCursor: (item: TItem) => { ts: number; seq: number };
  source: DurableTapeSource<TItem, TScope, TFilters>;
  renderRow: DurableTapeRowRenderer<TItem>;
  renderHover?: DurableTapeHoverRenderer<TItem>;
  onFocus?: (event: DurableTapeFocusEvent<TItem>) => void;
};
```

Domain modules should hide this complexity behind simpler exported components such as `OptionsTape`, `FlowPacketsTape`, `NewsWire`, `EquitiesTape`, and `AlertsModule`.

## Default Feature Pack

`default` is a feature flag that expands to the normal tape behavior. Later feature entries override earlier ones.

```ts
features={[
  "default",
  { key: "template", value: "twoThirds" },
  { key: "settingsGear", enabled: false }
]}
```

Default expands to:

- live hot head
- ClickHouse history
- scroll gate
- scroll hold
- jump-to-live
- new item count
- hover details
- keyboard inspect
- responsive templates
- row tinting
- settings gear
- no horizontal scroll

## Column Template Discipline

The registry can contain many columns. Visible templates must remain small.

Template names:

- `full`: largest route-owned surface
- `twoThirds`: about two thirds of a page
- `half`: split-pane or dashboard module
- `oneThird`: narrow rail or compact module
- `micro`: tiny embedded feed

If a container is narrower than the selected template can support, the module steps down automatically unless the caller explicitly pins the template.

## Required Gates

Each phase lists focused gates. Keep these commands in mind:

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test services/api/tests/live.test.ts
bun test packages/storage/tests/option-prints.test.ts
bun --cwd=apps/web run build
```

UI phases require browser verification at desktop and mobile widths before closeout.

## Parallelization And Stacking

The Beads graph is intentionally conservative. Parallel work is allowed only where this section and the phase docs name a safe lane.

Safe parallel lanes after Phase 01 lands:

- Phase 02 options and Phase 03 flow packets can run in parallel if they agree on the packet-focus event contract before either PR opens.
- Phase 04 news wire can run in parallel with options, flow packets, or equities because it shares mechanics but does not share domain callbacks.
- Phase 05 equities can run in parallel with news and flow packets after the shared foundation is stable.
- Phase 06 alerts should wait for Phase 02 and Phase 03 because alerts must link to options prints and flow packets without owning their UI.
- Phase 07 is serial closeout.

Stacked PR posture:

- Stack small domain modules on Phase 01 only after the foundation PR is open and stable enough that its exported types are unlikely to churn.
- Do not stack two PRs that both change `apps/web/features/durable-tape/` public interfaces.
- Do not stack Phase 06 alerts behind an unmerged options or flow PR unless the callback contracts are already reviewed.
- Do not stack Phase 07. It is integration cleanup and should run after the domain PRs are merged.
- If a phase discovers missing storage or API semantics, split that into its own Beads child issue instead of widening the UI module PR.

Recommended PR groupings:

| Work | PR posture |
| --- | --- |
| Phase 01 foundation | One focused PR. |
| Phase 02 options | One PR after foundation. Split settings popout only if the row/scope behavior is already large. |
| Phase 03 flow packets | Can stack after foundation or run parallel with options after event contract agreement. |
| Phase 04 news wire | Good parallel candidate after foundation. |
| Phase 05 equities | Good parallel candidate after foundation. |
| Phase 06 alerts | Separate PR after options and flow packet contracts exist. |
| Phase 07 route composition | Final serial PR or closeout PR only. |

## Subagent Delegation

Subagents are useful for bounded inventory, test design, and visual QA. The main agent remains responsible for reading required skill docs, final interface decisions, edits, Beads status, commits, and pushes.

Good delegation targets:

- Inventory current terminal pane dependencies for a specific domain.
- Draft column-template matrices for one module against the no-horizontal-scroll rule.
- Review existing API and storage tests for a phase's live/history coverage.
- Run browser QA on a completed module at desktop and mobile widths.
- Audit hover/detail content for omitted fields and red/green-only meaning.

Do not delegate:

- Reading or interpreting `$impeccable` instructions.
- Deciding the shared `durable-tape` public interface.
- Changing Beads dependencies.
- Committing, pushing, or closing issues.
- Resolving cross-phase callback contracts without main-agent review.

## Reviewer Thread Standard

Reviewer threads for this stream should be ambitious. Do not stop at minor cleanup comments or "this could be a bit cleaner."

Reviewers should actively look for a code-judo move: a reorganization that uses the existing architecture more effectively and makes the implementation feel inevitable in hindsight.

Push hard for changes that delete complexity:

- Remove whole branches, helpers, modes, conditionals, or layers when the design makes them unnecessary.
- Prefer one deeper module over several pass-through modules.
- Prefer domain callbacks and route composition over shared global state.
- Prefer a simpler data contract over UI branching that compensates for ambiguous data.
- Prefer one scroll/history mechanic in `features/durable-tape/` over per-domain clones.
- Prefer template stepping and hover detail over column proliferation.
- Prefer deleting legacy terminal drawer/pane coupling over wrapping it in another adapter layer.

Reviewer output should lead with behavioral or architectural risk, then name the simpler shape. If the best finding is "this entire helper/layer can disappear," say that directly and explain the replacement.

## Scope Discipline

- Do not build five separate table implementations.
- Do not attach alerts, news, or packet details to the options tape module.
- Do not make ClickHouse rows look stale or secondary just because they are historical.
- Do not grow default columns to satisfy rare inspection needs.
- Do not let route-specific terminal state leak into shared domain modules.
- Do not replace semantic fixes with visual treatment.
