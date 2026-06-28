# Phase 05 Turn Doc: More-Info Triage Workspace

Beads issue: `islandflow-j06e.5`

Phase doc: `docs/implementation/options-smart-flow-support-triage/05-more-info-triage-workspace.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected after `islandflow-j06e.4` completed and the orchestrator assigned
implementation on branch:

`lavender/islandflow-j06e-5-more-info-triage`

## Scope

Implemented Phase 05 only:

- Rows with matched smart-flow support now expose a compact more-info
  affordance in the options tape.
- Activating more-info opens a dense operational triage surface without making
  detail the default tape view.
- Detail payloads load only on user intent through `/options/smart-flow-detail`.
- Detail shows packet summary, hypothesis type, direction, confidence,
  conviction, alternatives, penalties, abstention or why-not context, packet
  member prints, and exact-contract context when those fields exist in API data.
- Packet member and exact-contract rows are server-composed, bounded, and
  cursor-shaped for future pagination.
- The detail surface supports keyboard focus, Escape close, retry after failed
  detail loads, reduced-motion loading behavior, responsive/mobile layout, and
  explicit exits to packet scope, contract scope, or the prior tape state.

Out of scope and not changed:

- No smart-flow scoring, calibration, or tint policy changes.
- No alert UI migration.
- No replay redesign.
- No default tape replacement by the triage workspace.
- No unbounded browser hydration of evidence or member rows.
- No client-side smart-flow inference when explainability data is absent.

## Implementation Log

- Added shared `OptionsSmartFlowTriageDetail` schemas and bounded row-page
  types in `packages/types`.
- Exported durable option-row composition from the API row module so detail
  responses reuse the same server-composed row contract as durable tape history.
- Added `services/api/src/options-smart-flow-detail.ts` with query parsing,
  compact support resolution, projection selection, selected-print lookup,
  packet-member lookup, exact-contract lookup, NBBO hydration, and bounded row
  composition.
- Registered GET `/options/smart-flow-detail` and assigned it to the API lookup
  rate-limit bucket.
- Added web detail loading helpers that build the endpoint URL and parse the
  shared response schema.
- Added `OptionsTapeSmartFlowDetailSurface` for the dense detail workspace:
  packet/hypothesis/scores sections, alternatives, penalties or why-not copy,
  packet member rows, exact-contract rows, loading state, error retry, focus on
  open, Escape close, and action buttons for packet scope, contract scope, and
  back to tape.
- Added an `info` column to options tape templates/settings and kept it visible
  across responsive templates so the affordance remains reachable on small
  widths.
- Wired options tape state so detail requests are started only from the
  more-info button, stale in-flight detail responses are ignored after close or
  row activation, and row activation continues to open packet/contract scope as
  before.
- Added focused web and API tests for detail URL construction, settings/template
  preservation, query parsing, response composition, and rate-limit
  classification.

## Subagent Swarms

None. Implementation stayed inside the assigned worktree/branch.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Reviewer closeout status: `repaired`.

Reviewer findings:

- Forgejo CI was failing on PR tasks `#420` and `#421` during
  `bun run typecheck`. The logged TypeScript blocker was
  `TS4104` in `services/api/src/options-smart-flow-detail.ts`, where readonly
  packet/projection arrays were passed into mutable resolver input fields.
- The more-info detail API already exposed bounded `next_before` cursors for
  packet-member and exact-contract rows, but the browser surface did not expose
  any way to request those older server-composed rows. That left a phase-scope
  gap for paginated packet prints and exact-contract context.

Repairs:

- Changed `SmartFlowSupportResolverInput` to accept readonly trace, packet, and
  projection arrays, matching how the resolver consumes hot context and fixing
  the Forgejo typecheck failure.
- Added independent packet-member and exact-contract "older rows" controls to
  the detail surface. The controls pass server cursors back to
  `/options/smart-flow-detail`, append deduped rows in place, keep page errors
  local to the detail drawer, and preserve stale-response guards after close or
  row changes.
- Kept the base detail request stable while paging so packet and contract
  cursors do not bleed into each other.
- Extended web/API tests for cursor serialization and parsing.

Remaining findings: none.

## CI And Gates

CI owner: implementation worker for local gates; orchestrator/reviewer for
Forgejo CI and closeout.

Current CI state: `reviewer-local-gates-passed-awaiting-forgejo-rerun`

Pre-repair Forgejo CI evidence:

- `fj actions tasks -R forgejo --page 1` showed PR tasks `#420` and `#421`
  failing on implementation heads `3aa651bf0a` and `aba015b77d`.
- Forgejo action logs for those tasks failed in `bun run typecheck` with
  `TS4104` readonly-array assignment errors in
  `services/api/src/options-smart-flow-detail.ts`.

Evidence:

- `bun run fmt:check` - passed, 360 files checked.
- `git diff --check` - passed.
- `bun run lint` - passed, 360 files checked.
- `bun run typecheck` - passed.
- `bun test apps/web/features/options-tape` - passed, 25 tests, 107 assertions.
- `bun test services/api/tests` - passed, 74 tests, 277 assertions.
- `bun --cwd=apps/web run build` - passed with Next 16.2.6 production build.
- Browser verification used system Chromium at `/usr/bin/chromium` against a
  temporary local harness under `apps/web/.tmp/options-more-info-harness`, then
  removed the harness after success.
- Reviewer browser probe passed with desktop `detailRequests:6`,
  `packetFocuses:1`, and mobile `mobileOverflow:0`. It covered:
  - no detail request before user intent;
  - keyboard focus on the more-info affordance;
  - opening ready detail on desktop;
  - packet-member older-row pagination using `packet_before_ts` /
    `packet_before_seq`;
  - exact-contract older-row pagination using `contract_before_ts` /
    `contract_before_seq`;
  - packet scope navigation from detail;
  - closing detail back to tape;
  - slow detail loading state dismissed before resolution, with stale response
    ignored;
  - unavailable detail error state and retry recovery;
  - mobile detail open without horizontal overflow;
  - Escape close on mobile.

## PR And Commits

- Forgejo PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/98`
- Branch: `lavender/islandflow-j06e-5-more-info-triage`
- Implementation commit: `3aa651b` - `add options smart-flow more info`
- Publication doc commit: `aba015b` - PR turn-doc update after PR creation.
- Reviewer repair commit: `c2b1ff9` - `fix more-info triage ci and paging`.

## Beads Updates

No Beads state was mutated by this worker. The issue remains orchestrator-owned
for closeout.

## Follow-Ups Filed

None.

## Context To Keep

- More-info explains why the system interpreted the print or packet that way.
- Detail payloads load on intent and stay bounded/server-composed.
- Packet member rows come from packet membership, not visible-row
  reconstruction.
- Exact-contract context is separate from packet scope and uses normalized
  `option_contract_id`.
- Detail packet-member and exact-contract pagination are independent browser
  actions backed by server cursors.
- Missing API explainability remains an API/data follow-up, not a reason for
  client-side smart-flow inference.
- Stale detail responses are intentionally ignored after close, filter apply,
  or row activation.

## Closeout

Implementation, reviewer repair, local verification, Forgejo PR update, and
turn-doc update are complete from this branch. The orchestrator owns Beads
closeout, merge, and next-phase selection.
