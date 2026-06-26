# Phase 00: Options Tape Smart-Flow Row Tinting Roadmap

Beads issue: `islandflow-n16t`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Create the durable execution surface for adding smart-flow hypothesis tinting to options tape rows. This phase records the scope split, Beads graph, thread orchestration model, review requirements, and closeout rules before runtime code changes begin.

## Product Goal

Options tape rows should make smart-flow hypothesis context scannable without turning the tape into a slow or noisy dashboard. Live prints, loaded historical prints, and server-composed durable option rows should eventually use the same subtle tint semantics for hypothesis type, direction, confidence, and abstention.

## Current State

- `OptionsTape` already owns option-print row context and is reused on `/options`, dashboard options modules, and durable-tapes-adjacent surfaces.
- `DurableTape` already has a `rowTinting` feature flag but no row class/style hook API.
- Existing decor is mostly classifier or legacy smart-money driven and is keyed through `decorByTraceId`.
- `/options` currently avoids the legacy smart-money UI by setting `smartMoney: false`, which also prevents subscribing to `smart-flow`.
- `/lookup/options-support` already includes `smart_flow` in its response, but frontend support hydration does not expose it to options rows.
- Durable option row view models are a separate path that must be brought into parity in the strict coverage phase.

## Architecture Direction

Add the tinting capability in the layer that owns the relevant concept:

```text
apps/web/features/durable-tape/
  shared row hook API, feature flag behavior, and base row mechanics

apps/web/features/options-tape/
  smart-flow tint helper, row context, hover/scope display, and OptionsTape props

apps/web/features/terminal/
  route subscription split, projection-to-print/packet mapping, hydration scheduler support

services/api/src/ and packages/types/
  only the strict support/durable-row payload changes needed for historical coverage
```

The smart-flow domain model remains canonical in `packages/types/src/smart-flow.ts`. Tinting is a presentation projection, not a new scoring policy.

## Phase Order

| Phase | Issue | Output | Dependency posture |
| --- | --- | --- | --- |
| 00 | `islandflow-n16t` | Planning docs and Beads graph | Start here. |
| 01 | `islandflow-xcdn.1` | Durable row hook foundation and reusable options-tint helper | Blocks all visible tint work. |
| 02 | `islandflow-xcdn.2` | Live smart-flow coloring for options tape consumers | Depends on Phase 01. Does not claim historical completeness. |
| 03 | `islandflow-xcdn.3` | Strict historical and server-row coverage | Depends on Phase 02. Final coverage phase. |

## Phase Boundaries

- Phase 01 adds capability but does not change live subscriptions or API payload handling.
- Phase 02 wires live smart-flow projections into options tape rows but does not claim older history/server rows are complete.
- Phase 3 makes support hydration, historical rows, and server-composed durable rows strict and consistent.

## UX Rules

Use `$impeccable` for UI/UX work.

- Row tint must be subtle and full-row, not a new dense column by default.
- Red/green cannot carry meaning alone; hover and packet-focus context must expose labels.
- Abstention should be low-intensity and explicitly labeled, not visually treated like a confident hypothesis.
- Direction can modify border/tone but should not override hypothesis family.
- Hover/focus states must remain readable over tinted rows.
- Tints must not change row height, grid sizing, virtualization measurements, or scroll stability.

## Acceptance Gates

- `IMPLEMENT.md` exists and names the Beads graph.
- Phase docs `00` through `03` exist.
- Orchestrator thread creation guidance includes the orchestrator thread ID callback contract.
- Large-swarm scout/review topology and worker helper delegation rules are documented.
- Review threads are required to use `thermo-nuclear-code-quality-review`.
- Beads issues exist for every implementation phase and dependencies are wired.

## Out Of Scope

- Runtime code changes.
- Smart-flow scoring or calibration changes.
- New synthetic data or replay semantics.
- A new visible smart-flow column as the default presentation.
- Production deployment or browser QA.
