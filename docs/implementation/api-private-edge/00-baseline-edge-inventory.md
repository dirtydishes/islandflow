# Phase 00: Baseline API Edge Exposure

## Intent

Record the current exposure and deployment facts before changing behavior. This phase is read-only/probe-only and should produce a durable baseline that later workers can trust.

## Required Work

- Inspect the live server through SSH and record redacted facts about the web process, API process, Nginx Proxy Manager route state, relevant env keys, and direct port reachability.
- Inventory active checked-in references to concrete production domains, hosted API defaults, public API probes, and CORS defaults.
- Probe the app-origin API route coverage using placeholders for the public app and raw API origins.
- Check whether the production web bundle advertises the raw API origin.
- Identify route prefixes missing from the same-origin proxy matcher.

## Acceptance Criteria

- A baseline note or phase turn document records the current live posture without secrets.
- The baseline distinguishes same-origin app routes from raw API host routes.
- The phase identifies the exact active files that Phase 01 and Phase 02 must touch.
- No code, deployment, env, or proxy behavior changes are made in this phase.

## Suggested Checks

```bash
bd show islandflow-hnbk.1
rg -n "NEXT_PUBLIC_API_URL|API_CORS_ORIGINS|DEFAULT_REMOTE_API_URL|DEPLOY_PUBLIC|production api|hosted API" README.md .env.example apps services scripts deployment docs/agents docs/implementation
ssh di 'systemctl list-units --type=service --all --no-pager | grep -Ei "island|flow|nginx|docker|bun" || true'
ssh di 'ss -ltnp 2>/dev/null | grep -E ":(80|443|3000|4000)\\b" || true'
```

Use `<production-app-origin>` and `<raw-api-origin>` variables for public probes. Do not commit concrete production domains while recording the baseline.

## Implementation Subagents

The Phase 00 worker may use several read-only helper subagents because the work is inventory-heavy.

Good helper targets:

- Live server and NPM edge inventory.
- Repo hostname/default inventory.
- Same-origin route coverage audit.
- Bundle and probe exposure checks.

The worker still owns the baseline synthesis, Beads state, turn document, and final callback. Helpers must not change server state, edit files, update Beads, or commit.

## Out Of Scope

- Editing docs or code.
- Changing NPM, DNS, Cloudflare, firewall, or server env.
- Adding rate limits or auth.
