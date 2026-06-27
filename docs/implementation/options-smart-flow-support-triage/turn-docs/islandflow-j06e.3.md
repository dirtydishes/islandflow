# Phase 03 Turn Doc: Packet And Contract Scope Interactions

Beads issue: `islandflow-j06e.3`

Phase doc: `docs/implementation/options-smart-flow-support-triage/03-packet-contract-scope-interactions.md`

This is the single Markdown turn doc for the phase.

## Phase Selection

Selected after Phase 02 was completed and the orchestrator assigned implementation on branch:

`lavender/islandflow-j06e-3-packet-contract-scope`

## Scope

Implemented Phase 03 only:

- Packet-backed option rows open an in-place packet scope.
- Packet scope requests authoritative packet summary and member rows from `/history/options`.
- The clicked print is pinned/highlighted in packet rows.
- Packet scope exposes a visible `Show contract` control that widens to the exact normalized OCC contract.
- `Back to tape` clears the scoped tape and returns to the global signal tape path.
- Packet-backed rows without tint-eligible smart-flow support can still open packet scope; row tinting remains gated by support eligibility.
- Packet and contract scope history requests bypass live-head rows and use bounded API history pages.

Out of scope and not changed:

- More-info triage workspace.
- Settings popout.
- QA diagnostic support columns.
- Broad dashboard redesign.
- Client-side packet membership reconstruction from visible rows.

## Implementation Log

- Added packet-scope query parsing for `flow_packet_id` and `pinned_trace_id`, with broad option-flow filters stripped from packet and contract storage scopes.
- Added storage support for packet member option rows through `fetchOptionPrintsForFlowPacketBefore`.
- Kept packet membership server-composed by querying the latest stored packet row, deduping to one option print per member trace ID, then applying cursor/limit pagination outside the deduped set.
- Added API response fields `packet` and `pinned` for packet scope history pages.
- Updated options tape source requests to send packet and pinned trace params, parse packet metadata, prepend the pinned print once, and hydrate packet maps from API responses.
- Changed packet and contract scopes to bypass live snapshots so scoped views start from API history rather than reconstructing from visible rows.
- Added a packet scope band with packet/member count, selected-print highlight, `Show contract`, and `Back to tape`.
- Added focused web and API tests for packet query params, packet API hydration, clicked-print pinning, and packet member SQL shape.

## Subagent Swarms

None. Implementation stayed inside the assigned worktree/branch.

## Review

Reviewer skill:

`thermo-nuclear-code-quality-review`

Not started by this worker. The orchestrator owns review-thread creation.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `local-gates-passed`

Evidence:

- `bun test apps/web/features/options-tape` - passed, 20 tests.
- `bun test services/api/tests` - passed, 72 tests.
- `bun --cwd=apps/web run build` - passed.
- `git diff --check` - passed.
- Browser verification: `/options` desktop and mobile packet-scope interaction passed with a temporary Playwright spec against local Next dev on `http://127.0.0.1:3100`.
- Browser screenshots captured under `/tmp/islandflow-j06e3-browser/`: `desktop-packet.png`, `desktop-contract.png`, `desktop-after-return.png`, `mobile-packet.png`, `mobile-contract.png`, `mobile-after-return.png`.
- API-path verification note: starting a second full API service would reuse production-like JetStream durable names, so I used a temporary local REST proxy on `127.0.0.1:4103` for direct branch `/history/options` checks. The proxy verified the branch packet endpoint returned one deduped option-print row per packet member and the pinned clicked trace before the browser UI pass was rerun against the host API.

## PR And Commits

- Forgejo PR: pending publication.
- Branch: `lavender/islandflow-j06e-3-packet-contract-scope`
- Commits: pending publication.

## Beads Updates

No Beads state was mutated by this worker. The issue remains orchestrator-owned for closeout.

## Follow-Ups Filed

None.

## Context To Keep

- Packet scope is API-backed by `flow_packet_id`; do not reconstruct packet membership from visible rows.
- `pinned_trace_id` is only a visual pin/highlight request; packet rows still come from server-composed membership.
- Exact contract widening is `option_contract_id` without `flow_packet_id`.
- Packet scope history is deduped to one latest option print per packet member trace ID before pagination.
- Smart-flow tint is unchanged: packet support alone does not tint a row unless compact support is tint eligible.

## Closeout

Local implementation complete; publication and review are pending.
