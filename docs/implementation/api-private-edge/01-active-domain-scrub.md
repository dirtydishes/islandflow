# Phase 01: Active Domain Scrub

## Intent

Stop active repo surfaces from teaching agents, developers, tests, or probes to hit the hosted API by default.

## Required Work

- Replace active command examples and env defaults that point to production domains with local defaults or placeholders.
- Remove the local web dev fallback to the hosted API. Local dev should default to the local API, and nonlocal API use should be explicit.
- Update active tests and probe defaults so they do not encode concrete production domains unless the value is a real product constant.
- Keep historical turn docs, old baselines, and generated desktop output out of scope unless they are linked as current instructions.
- Update `docs/implementation/README.md` if the Beads map or active planning index needs this stream listed.

## Acceptance Criteria

- `.env.example`, active README sections, active agent prompts, dev scripts, tests, and production probes no longer use concrete production API domains as defaults.
- Placeholder examples clearly distinguish local dev, deployed app-origin access, and optional explicit external API origins.
- Product constants that must remain concrete are documented as constants, not as API defaults or public usage instructions.
- Scoped tests cover the new local-default behavior.

## Suggested Checks

```bash
bd show islandflow-hnbk.2
rg -n "NEXT_PUBLIC_API_URL|API_CORS_ORIGINS|DEFAULT_REMOTE_API_URL|DEPLOY_PUBLIC|hosted API|production API" README.md .env.example apps services scripts deployment docs/agents docs/implementation
bun test apps/web/scripts/dev-config.test.ts services/api/tests/cors.test.ts
```

## Implementation Subagents

Run this phase through the full topology in `IMPLEMENT.md` when useful: selector agent, 6-10 read-only scout agents, one implementation worker, 3-6 review agents, and one lead reviewer. Use scouts to divide discovery before edits; keep one worker responsible for every scrubbed reference.

Every review agent and the lead reviewer must use the `thermo-nuclear-code-quality-review` skill before reviewing this phase.

The Phase 01 worker may use helper subagents to divide the scrub safely before editing.

Good helper targets:

- Active docs and agent-prompt references.
- Env examples and deployment docs.
- Web/dev scripts and probe defaults.
- Tests and product-constant exceptions.

Helpers return candidate paths, rationale, and risk notes. The worker owns all edits, decides which references are active versus historical, updates Beads, and performs the final callback.

## Out Of Scope

- Changing production transport behavior.
- Closing the raw API host.
- Rewriting historical turn documents or generated artifacts.
