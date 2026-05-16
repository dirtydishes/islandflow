# Native Deployment

This directory documents the experimental host-native Islandflow rollout path used by:

```bash
./deploy main --runtime native
./deploy current-branch --runtime native
```

This runtime is intended for faster server iteration during the transition away from Docker-only app rollouts. It is not the recommended path for the current production VPS, which still uses Nginx Proxy Manager to reach the Docker `web` and `api` containers by container name on the shared Docker network. Local development should still prefer:

- Docker for infra (`bun run dev:infra`)
- native Bun services (`bun run dev:services`)
- native Next.js web (`bun run dev:web`)

## What native deploy means here

The checked-in `deploy` helper assumes:

- the live repo checkout is still `/home/delta/islandflow`
- Bun is installed on the VPS
- app processes are managed by `systemd`
- infrastructure services such as NATS, ClickHouse, and Redis are already reachable from the host
- the web app runs from `apps/web` and is served with `next start -p 3000`

The deploy script updates the repo checkout, optionally runs `bun install --frozen-lockfile`, optionally rebuilds the web app, restarts the target systemd units, and then verifies the services locally on the VPS plus through the public app URL.

## Expected unit names

Default unit names used by `scripts/deploy.ts`:

- `islandflow-web`
- `islandflow-api`
- `islandflow-compute`
- `islandflow-candles`
- `islandflow-ingest-options`
- `islandflow-ingest-equities`

Override them from your local shell before running `./deploy` if the server uses different names:

```bash
export DEPLOY_NATIVE_WEB_UNIT=my-web-unit
export DEPLOY_NATIVE_API_UNIT=my-api-unit
```

Available overrides:

- `DEPLOY_NATIVE_WEB_UNIT`
- `DEPLOY_NATIVE_API_UNIT`
- `DEPLOY_NATIVE_COMPUTE_UNIT`
- `DEPLOY_NATIVE_CANDLES_UNIT`
- `DEPLOY_NATIVE_INGEST_OPTIONS_UNIT`
- `DEPLOY_NATIVE_INGEST_EQUITIES_UNIT`

## systemctl invocation

By default the deploy helper uses:

```bash
sudo -n systemctl
```

If the server uses user units or another wrapper, override it locally before invoking `./deploy`:

```bash
export DEPLOY_NATIVE_SYSTEMCTL_PREFIX="systemctl --user"
./deploy main --runtime native
```

## Partial native rollouts

Examples:

```bash
./deploy main --runtime native --web-only
./deploy main --runtime native --api-only
./deploy current-branch --runtime native --services-only
./deploy main --runtime native --web-only --no-build
```

Scope behavior:

- default: restart web + API + backend services
- `--web-only`: rebuild/restart only the web unit
- `--api-only`: restart only the API unit
- `--services-only`: restart API + backend units without touching the web unit
- `--no-build`: skip `bun install --frozen-lockfile` and skip the web build step

## Current status

On the current live VPS, native deploys should be treated as opt-in infrastructure work, not the default rollout path. Before a native deploy can succeed there, all of the following must be true at the same time:

- Bun is installed on the host.
- The selected `systemctl` command works non-interactively.
- Islandflow systemd units exist for the requested scope.
- Host-native services can reach the intended NATS, ClickHouse, and Redis endpoints.
- If `web` or `api` move native, the reverse proxy topology is updated deliberately.

Until that is prepared intentionally, prefer:

```bash
./deploy main --runtime docker
./deploy current-branch --runtime docker
```

## Server preparation checklist

Before the first native rollout, ensure the VPS has:

1. Bun installed and on `PATH`
2. a working `/home/delta/islandflow/.env` (or unit-managed equivalent env source)
3. systemd units for each target service
4. the web unit configured to serve the built app on port `3000`
5. the API unit configured to serve health checks on port `4000`
6. infrastructure endpoints configured so the native services can reach NATS, ClickHouse, and Redis

## Verification

Native deploys verify:

- target units are active via `systemctl`
- recent unit status and journal output can be collected
- local `http://127.0.0.1:4000/health` when API scope is included
- local `http://127.0.0.1:3000/` when web scope is included
- the public app URL from the local machine after the rollout finishes

## Rollback

Rollback remains manual for now:

1. switch the server checkout back to the last known-good branch or commit
2. rerun the appropriate native deploy command
3. if needed, restart only the affected units with `systemctl`

Docker remains the fallback and currently recommended runtime during the transition:

```bash
./deploy main --runtime docker
```
