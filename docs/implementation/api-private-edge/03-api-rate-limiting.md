# Phase 03: API Rate Limiting

## Intent

Keep the hosted UI public while bounding obvious scraping and request storms through API-side throttling and observable rejections.

## Required Work

- Add env-gated API rate limiting before route handling.
- Use forwarded client IP headers when present; fall back safely when absent.
- Exempt `/health`.
- Provide separate buckets for ordinary REST reads, support/evidence lookup routes, and websocket upgrades.
- Return JSON `429` responses for rejected HTTP requests.
- Emit metrics/logs by coarse route category without full query strings.
- Document production-safe starting limits in env examples and deployment docs.

## Acceptance Criteria

- Rate limiting is disabled or conservative by default for local dev and explicitly enabled for production rollout.
- Tests cover allowed requests, rejected requests, `/health` exemption, forwarded IP parsing, lookup route limits, and websocket upgrade limits.
- Existing synthetic admin bearer auth behavior is unchanged.
- Operators can tune limits through env without code changes.

## Suggested Env Shape

```text
API_RATE_LIMIT_ENABLED=1
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_REST_MAX=1200
API_RATE_LIMIT_LOOKUP_MAX=120
API_RATE_LIMIT_WS_MAX=120
```

## Suggested Checks

```bash
bd show islandflow-hnbk.4
bun test services/api/tests
```

## Out Of Scope

- Full login/session auth.
- External API customer keys or quotas.
- Closing the raw API host.
