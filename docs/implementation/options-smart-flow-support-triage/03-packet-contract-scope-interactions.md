# Phase 03: Packet And Contract Scope Interactions

Canonical Beads issue: `islandflow-j06e.3`

Epic: `islandflow-j06e`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Implement the core row-click scope workflow for packet-backed rows using authoritative server-composed rows.

## Scope

Allowed:

- Clicking a packet-backed row opens an in-place packet scope.
- Packet scope fetches packet summary and paginated member print rows from the API.
- The clicked print is pinned or highlighted inside packet rows.
- A visible control widens from packet prints to all prints for the exact normalized OCC contract.
- The user can return to the prior global signal tape.
- Packet-backed but non-smart-flow rows can open packet scope. They simply do not get smart-flow tint unless they have non-abstained support.
- Add tests for scope transitions, pagination, clicked-row highlighting, and empty/error states.

Out of scope:

- The richer more-info triage workspace.
- Settings popout work.
- QA diagnostic support columns.
- Broad dashboard route redesign.
- Client-side reconstruction of packet membership from visible rows.

## Inputs

- Phase 01 support resolver.
- Phase 02 rendering parity.
- `docs/implementation/durable-tapes/02-options-tape.md`
- `apps/web/features/options-tape/`
- API routes or handlers for packet and contract row queries.
- Storage APIs for packet member rows and exact-contract option prints.

## Implementation Notes

- Packet scope is still a tape view. It answers which prints are in this packet.
- Contract scope means exact normalized OCC contract, not all expirations or strikes for the ticker.
- The frontend may use already visible rows for instant optimistic display, but authoritative rows must come from the server.
- Any packet or contract result beyond the small visible head should be paginated or loaded by scroll.
- Keep the packet summary band dense and operational. Avoid permanent side panels in this phase.

## Beads

- Epic: `islandflow-j06e`
- Issue: `islandflow-j06e.3`
- Depends on: `islandflow-j06e.2`
- Parallel-safe: No. This phase depends on support parity and row identifiers.

## Expected Files Or Areas

- `apps/web/features/options-tape/`
- `apps/web/app/options/` or route integration files.
- `services/api/src/index.ts`
- `services/api/tests/`
- Storage package files for packet and contract row pagination.

## Suggested Swarms

- Interaction scout: current row click and scope stack behavior.
- API scout: packet detail and exact-contract query availability.
- Virtualization scout: scroll hold, jump-to-live, and pagination edge cases.
- Test scout: packet scope, contract scope, and selected row highlighting.
- Accessibility scout: keyboard and focus behavior for scope controls.

## Quality Gates

```bash
bun test apps/web/features/options-tape
bun test services/api/tests
bun --cwd=apps/web run build
```

Browser verification should cover `/options` packet scope and contract scope at desktop and mobile widths.

## Completion Criteria

- Packet-backed row click opens packet scope in place.
- Packet rows are authoritative server-composed rows.
- Clicked print is pinned or highlighted.
- `show all contract prints` widens to exact normalized OCC contract rows.
- Global signal tape return is clear.
- Large packet or contract result sets do not load unbounded rows.
- The phase turn doc records implementation, review, CI/gates, Beads updates, and any follow-ups.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for adjacent discoveries.
