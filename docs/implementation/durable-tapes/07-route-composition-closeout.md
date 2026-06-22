# Phase 07: Route Composition And Closeout

Beads issue: `islandflow-h9c0.6`

Index: [`IMPLEMENT.md`](./IMPLEMENT.md)

## Purpose

Compose the durable modules into production routes, retire legacy terminal attachments, and verify the module family as one coherent product surface.

## Scope

- Make `/options` tape-first using the extracted options module.
- Keep `/tape` redirecting to `/options`.
- Keep `/news` using the extracted news module.
- Add or prepare route composition points for flow packets, equities, and alerts.
- Update dashboard modules to consume compact templates instead of terminal-specific panes where appropriate.
- Retire dead terminal pane/drawer code after reachability is proven.
- Update docs and tests to reflect the new module boundaries.

## Route Composition Rules

- Routes compose modules.
- Domain modules own domain UI and detail surfaces.
- Shared durable foundation owns mechanics.
- Legacy terminal state should become adapter glue only.
- Do not let one module own another module's details.

## Parallel Work

Can parallelize:

- Browser QA matrix execution across routes.
- Dead-code reachability audit.
- Documentation updates for completed modules.

Keep serial:

- Removing terminal compatibility code.
- Route-level composition edits.
- Final Beads and release closeout.

## Stacking Guidance

Do not stack Phase 07. This phase should run after the domain PRs merge so cleanup is based on actual reachability, not predicted reachability.

## Subagent Guidance

Good subagent tasks:

- Run visual QA for one route and report screenshots/findings.
- Audit imports for retired terminal pane or drawer code.
- Verify no production tape template needs horizontal scroll at selected viewport widths.

Main agent must own:

- Final cleanup decisions.
- Full verification command selection.
- Beads closeout, commit, push, and handoff.

## Verification Matrix

Verify at least:

| Surface | Desktop | Narrow/mobile | Live head | Scroll held | History gate | Hover/detail |
| --- | --- | --- | --- | --- | --- | --- |
| Options | Required | Required | Required | Required | Required | Required |
| Flow packets | Required | Required | Required | Required | Required | Required |
| News | Required | Required | Required | Required | Required | Required |
| Equities | Required | Required | Required | Required | Required | Required |
| Alerts | Required | Required | Required | N/A if not stream-held | Required if paged | Required |

## Required Gates

```bash
bun test apps/web/app/terminal.test.ts apps/web/app/routes.test.ts
bun test services/api/tests/live.test.ts
bun test
bun --cwd=apps/web run build
```

Run browser checks for `/options`, `/news`, and any new route surfaced by the phase.

## Acceptance Gates

- Durable modules are route-composable and documented.
- Legacy terminal pane/drawer code is removed or clearly left as compatibility glue.
- `/options`, `/news`, and dashboard route behavior is preserved.
- No production tape template requires horizontal scrolling.
- Scroll hold and jump-to-live work consistently.
- Settings popouts are not clipped by virtual scroll containers.
- Final docs name any remaining follow-up work.

## Out Of Scope

- New market-data semantics.
- New scoring policy.
- New synthetic market scenarios.
