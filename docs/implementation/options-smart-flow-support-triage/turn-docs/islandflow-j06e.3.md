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

Reviewer closeout status: repaired locally; Forgejo publication and final PR CI
verification are owned by the reviewer thread before callback.

Findings repaired:

- Packet scope was still applying exact-contract client filtering whenever
  `optionContractId` was present. That hid legitimate cross-contract packet
  members returned by the authoritative packet API scope. Repair: packet scopes
  now strip broad filters whenever `flow_packet_id` is active and skip
  contract-only client filtering while `packetId` is present.
- Non-smart-flow packet support was hydrated into the scheduler but dropped by
  the options tape state because only matched smart-flow support was retained.
  That made packet-backed non-smart-flow rows fall through to contract focus.
  Repair: the tape now retains explicit unavailable support and merges packets
  carried by support resolutions into the hydrated packet maps without changing
  tint eligibility.
- Internal packet/contract scope could be cleared or superseded by terminal
  parent focus bookkeeping during the same activation. Repair: external clear
  handling now only reacts to an actual focused-contract-to-null transition, and
  row activation applies the in-place scope after parent focus callbacks.

Findings remaining:

None.

## CI And Gates

CI owner: reviewer/verification agents

Current CI state: `local-gates-passed-after-review-repair`

Evidence:

- `bun test apps/web/features/options-tape` - passed after review repair,
  20 tests, 76 assertions.
- `bun test services/api/tests` - passed after review repair, 72 tests,
  262 assertions.
- `bun --cwd=apps/web run build` - passed after review repair.
- `git diff --check` - passed after review repair.
- Browser verification: `/options` desktop and mobile packet-scope interaction
  passed against local Next dev on `http://127.0.0.1:3101` with intercepted
  branch-shaped API responses. The probe verified:
  - non-smart-flow packet-backed row opens `Packet prints`;
  - packet history is requested with `flow_packet_id` and `pinned_trace_id`;
  - cross-contract packet member rows remain visible from the server response;
  - clicked print receives `options-tape-row-selected-print`;
  - `Show contract` widens to exact `option_contract_id`;
  - `Back to tape` returns to the prior global signal tape.
- Forgejo PR status evidence before repair push:
  - `fj pr status 96 --wait` is unavailable because Forgejo returns
    `/dirtydishes/islandflow/actions/runs/403/jobs/0`, which this `fj` build
    rejects as an invalid relative URL.
  - `fj actions tasks -R forgejo --page 1` showed pull-request tasks `#402`
    and `#403` failing on implementation commits `0331e79` and `9b2fe0c`.
    Final repaired-head CI verification is performed after the reviewer push.

## PR And Commits

- Forgejo PR: `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/96`
- Branch: `lavender/islandflow-j06e-3-packet-contract-scope`
- Implementation commit: `0331e79` - `add packet-backed options scope`
- Implementation doc commit: `9b2fe0c` - `document packet scope publication`
- Reviewer repair commit: `a72199a` - `repair packet scope review findings`

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

Review repairs are complete locally. Reviewer publication, `bd dolt push`, and
final Forgejo CI verification remain before callback.
