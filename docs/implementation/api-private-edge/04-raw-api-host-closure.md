# Phase 04: Raw API Host Closure

## Intent

Stop the raw public API host from serving direct unauthenticated API traffic after same-origin app routes and rate limits are ready.

## Required Work

- Make the raw API host closed or 404-style through durable Nginx Proxy Manager state, deployment helpers, or both.
- Avoid hand-editing generated NPM config as the only source of truth.
- Preserve same-origin app-origin API and websocket routing.
- Keep operational API access through SSH/VPN/server-local paths.
- Document rollback behavior for temporarily reopening the raw API host if same-origin routing fails.

## Acceptance Criteria

- Public requests to the raw API host no longer return market-data JSON or websocket upgrades.
- App-origin REST and websocket probes still pass.
- Deploy helpers do not accidentally reopen the raw API host on future native or Docker edge switches.
- Rollback instructions are explicit and require an intentional operator action.

## Suggested Checks

```bash
bd show islandflow-hnbk.5
ssh di 'python3 - <<PY
print("inspect NPM database and generated proxy host state without secrets")
PY'
curl -sS -o /dev/null -w "%{http_code}\\n" --max-time 5 <production-app-origin>/health
curl -sS -o /dev/null -w "%{http_code}\\n" --max-time 5 <raw-api-origin>/health
```

Use shell variables for origins during live checks. Do not commit concrete production domains into docs or scripts.

## Implementation Subagents

The Phase 04 worker may use helper subagents for edge durability and rollback review.

Good helper targets:

- NPM database state and helper-script behavior.
- Generated config regeneration risks.
- Same-origin app route preservation.
- Rollback and reopen procedure audit.

Helpers may inspect and propose. The worker owns any deployment-helper edits, live-change sequencing, Beads state, and the final callback.

## Out Of Scope

- DNS provider changes unless raw-host closure cannot be made durable at NPM.
- User login/session auth.
- New product-facing API documentation.
