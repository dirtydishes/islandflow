# Phase 05: Server-Composed Durable-Tape View Models

Beads issue: `islandflow-ze79.6`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

Readable plan: [`plan.html`](./plan.html)

## Purpose

Move expensive options support hydration and alert evidence decoration to the server so clients receive ready-to-render durable-tape rows or coarse decorated deltas.

## Problem

Even after frontend caching, every client still performs market-data joins and decoration work that the backend can do once, cache, and serve in a controlled way. Low-power devices should render rows, not reconstruct packet/NBBO/classifier/evidence relationships on every live update.

## Scope

- Define a durable-tape row view-model contract for the busiest panes.
- Decide whether the first delivery path is REST snapshot, websocket decorated delta, or both.
- Compose option print support data server-side.
- Compose alert evidence summaries server-side.
- Keep drilldown references for details that should remain lazy.
- Migrate frontend normal rendering to use the view model where available.
- Keep fallback behavior during rollout.

## Contract Direction

The exact type belongs in `packages/types` if shared across API/web.

```ts
type DurableTapeRowViewModel = {
  id: string;
  ts: number;
  seq?: number;
  lane: "options" | "alerts" | "flow" | "equities" | "news";
  symbol?: string;
  display: Record<string, string | number | null>;
  badges: Array<{
    kind: string;
    label: string;
    tone?: string;
  }>;
  evidenceSummary?: {
    label: string;
    refs: string[];
  };
  drilldownRefs?: string[];
};
```

This is a direction, not a command to accept a shallow generic blob. The final contract should be specific enough that the UI does not need ambiguous branching to recover semantics.

## Design Constraints

- Do not hide facts, evidence, hypotheses, and confidence in one vague string.
- Keep frontend rows honest and inspectable.
- Preserve route-specific dense tape presentation.
- Cache server composition where possible.
- Bound server work and payload size.
- Keep a rollback/fallback path until production probe passes.

## Split Guidance

Split this phase if needed:

- API/storage row model composition
- websocket or REST delivery path
- frontend adapter and fallback migration
- production probe and rollout flag

If split, create Beads child issues under `islandflow-ze79.6` and wire dependencies before implementation.

## Quality Gates

Minimum gates:

```bash
bun test packages/types services/api/tests packages/storage/tests
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun --cwd=apps/web run build
```

Probe gates:

- Phase 00 probe must show reduced client request and script work.
- Browser QA must confirm all durable panes render expected row semantics.

## Acceptance Criteria

- Backend can produce ready-to-render row view models or coarse decorated deltas for the targeted durable-tapes lanes.
- Frontend normal live rendering uses server-composed rows where available.
- Client-side packet/NBBO/classifier/trace joins are no longer required for normal row rendering.
- Fallback behavior is explicit and bounded.
- Probe evidence confirms reduced client reconciliation.

## PR Guidance

This is the highest-risk phase. Keep the interface small and the implementation deep. If the PR becomes hard to review, split before opening rather than asking reviewers to audit a full-stack rewrite at once.

## Good Subagent Tasks

- Draft alternative row-model contracts and compare semantic honesty, payload size, and UI branching.
- Inventory existing API/storage functions needed for server-side composition.
- Review whether websocket deltas or REST snapshots are the better first delivery seam.
- Browser-verify that the composed rows still expose evidence and drilldown context.
