# Phase 05: Production Rollout And Closeout

## Intent

Deploy and prove the final private-API posture end to end.

## Required Work

- Update live env so production web builds do not set `NEXT_PUBLIC_API_URL`.
- Set `ISLANDFLOW_INTERNAL_API_URL` to the server-local or internal API origin.
- Enable Phase 03 rate-limit settings with conservative production values.
- Deploy the web/API pieces needed for the final posture.
- Verify app-origin REST and websocket paths, raw API host closure, and direct port reachability.
- Close completed Beads issues and file focused follow-ups for any adjacent findings.

## Acceptance Criteria

- Hosted UI loads and live data works through same-origin paths.
- Production bundle check does not find the raw API origin.
- Raw API host returns closed or 404-style behavior for public requests.
- Direct public port `4000` remains unreachable.
- Server-local `http://127.0.0.1:4000/health` or the chosen internal API origin works over SSH.
- `bd dolt push`, git push, and final branch status verification succeed.

## Suggested Checks

```bash
bd show islandflow-hnbk.6
bun test services/api/tests
bun test apps/web/features/terminal apps/web/features/news-wire apps/web/app/api/admin/synthetic
bun --cwd=apps/web run build
ssh di 'curl -fsS <internal-api-origin>/health'
```

Use placeholders in committed docs and scripts; use local shell variables for live origins during the rollout.

## Implementation Subagents

The Phase 05 worker may use helper subagents for final verification breadth, but there is still one rollout owner.

Good helper targets:

- Live app-origin REST and websocket verification.
- Raw-host closure and direct-port reachability checks.
- Bundle exposure and docs consistency audit.
- Beads, Forgejo, CI, and final status closeout audit.

Helpers must not perform live mutations independently. The worker owns rollout sequencing, deployment commands, issue closeout, pushes, and the final handoff.

## Out Of Scope

- New authentication product work.
- Unrelated deployment runtime cleanup.
- Large frontend redesigns or endpoint contract changes not required for the private-edge posture.
