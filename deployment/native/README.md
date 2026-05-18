# Native Deployment

This directory documents the host-native Islandflow rollout path used by:

```bash
./deploy main --runtime native
./deploy current-branch --runtime native
```

## Current operating model

Native runtime is now intended for **fast iterative backend deploys first**, while Docker remains the supported public production edge until a deliberate cutover is completed.

Today, the recommended split is:

- **Docker runtime** for the live public `web` + `api` path
- **Native runtime** for worker-only iteration (`compute`, `candles`, `ingest-options`, `ingest-equities`)
- local development stays:
  - Docker infra: `bun run dev:infra`
  - native backend services: `bun run dev:services`
  - native web: `bun run dev:web`

## What native deploy means here

The checked-in `deploy` helper assumes:

- the live repo checkout is `/home/delta/islandflow`
- Bun is installed on the VPS
- app processes are managed by `systemd --user`
- infrastructure services such as NATS, ClickHouse, and Redis are reachable from the host
- the web app runs from `apps/web` and is served with `next start -p 3000`

The deploy script updates the repo checkout, optionally runs `bun install --frozen-lockfile`, optionally rebuilds the web app, restarts the target user units, verifies local health, and then runs public verification when the selected scope includes the public edge.

## Live audit status on 2026-05-18

The plan assumptions were audited on the VPS:

- `bun` is installed and available at `/home/delta/.bun/bin/bun`
- `systemctl --user` is available and the `delta` user has lingering enabled
- `/home/delta/islandflow/.env` exists
- public `https://flow.deltaisland.io/replay/options` routing is healthy again
- the previously reported duplicate `islandflow` compose project is not currently present in `docker compose ls`
- native Islandflow user units were not installed at the start of the audit; this change now provides and installs the checked-in user unit files, but they remain disabled until an operator enables a scope intentionally

That means native worker deploy support is now provisioned on the host, but native runtime should still be enabled scope-by-scope rather than started wholesale.

## Checked-in native ops assets

### User unit templates

Checked-in unit files live under:

- `deployment/native/systemd/user/islandflow-web.service`
- `deployment/native/systemd/user/islandflow-api.service`
- `deployment/native/systemd/user/islandflow-compute.service`
- `deployment/native/systemd/user/islandflow-candles.service`
- `deployment/native/systemd/user/islandflow-ingest-options.service`
- `deployment/native/systemd/user/islandflow-ingest-equities.service`

These are written for the current VPS layout:

- repo root: `/home/delta/islandflow`
- Bun binary: `/home/delta/.bun/bin/bun`
- env file: `/home/delta/islandflow/.env`

### Install the units

```bash
./deployment/native/install-user-units.sh
./deployment/native/install-user-units.sh workers
systemctl --user start islandflow-compute.service
```

Install script behavior:

- copies the checked-in unit files into `~/.config/systemd/user`
- reloads the user systemd daemon
- enables only the scope you explicitly request
- defaults to installing without enabling anything yet

### Smoke test helper

```bash
./deployment/native/check-native-health.sh workers
./deployment/native/check-native-health.sh services
./deployment/native/check-native-health.sh full
```

This validates:

- `systemctl --user is-active` for the selected units
- local API health at `http://127.0.0.1:4000/health` when API scope is included
- local web health at `http://127.0.0.1:3000/` when web scope is included

### Rollback helper

```bash
./deployment/native/rollback.sh <git-ref> workers
./deployment/native/rollback.sh <git-ref> services
```

Rollback helper behavior:

- requires a clean repo state
- fetches refs
- switches the checkout to a detached target ref
- reruns `bun install --frozen-lockfile`
- rebuilds the web app only when web scope is included
- restarts the selected user units
- runs the native smoke checks

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

For the checked-in user units, use:

```bash
export DEPLOY_NATIVE_SYSTEMCTL_PREFIX="systemctl --user"
```

The deploy helper defaults to `sudo -n systemctl`, but that is only appropriate if you intentionally install matching system units.

## Partial native rollouts

Examples:

```bash
./deploy main --runtime native --workers-only
./deploy main --runtime native --fast
./deploy main --runtime native --services-only
./deploy main --runtime native --web-only
./deploy current-branch --runtime native --workers-only --no-build
```

Scope behavior:

- default: restart web + API + worker services
- `--web-only`: rebuild/restart only the web unit
- `--api-only`: restart only the API unit
- `--services-only`: restart API + worker units without touching the web unit
- `--workers-only`: restart only `compute`, `candles`, `ingest-options`, and `ingest-equities`
- `--fast`: when no explicit scope flag is provided, native deploys now default to `--workers-only`
- `--no-build`: skip `bun install --frozen-lockfile` and skip the web build step

## Edge-cutover guardrail

Native deploys that touch the public web or API edge are intentionally blocked unless you acknowledge cutover readiness:

```bash
export DEPLOY_NATIVE_EDGE_READY=1
```

Without that variable, these commands are refused:

- `./deploy main --runtime native`
- `./deploy main --runtime native --web-only`
- `./deploy main --runtime native --api-only`
- `./deploy main --runtime native --services-only`

This keeps the native path focused on safe worker iteration until proxy routing and public unit ownership are switched deliberately.

## Running deploy from the VPS itself

If you run `./deploy` from `/home/delta/islandflow` on the live server, the deploy helper now executes the remote steps locally instead of SSHing back into the same machine.

That means:

- no SSH key is required for on-server deploy execution
- timing and verification behavior stay the same
- you can still force SSH with `DEPLOY_FORCE_SSH=1`
- you can override the SSH key path with `DEPLOY_SSH_KEY_PATH=/path/to/key`

## Validation matrix

| Area | Native workers-only | Native edge cutover |
| --- | --- | --- |
| Bun installed | required | required |
| `systemctl --user` works | required | required |
| Islandflow user units installed | worker units only | all units |
| Host access to NATS/ClickHouse/Redis | required | required |
| Proxy routes updated for `/prints`, `/history`, `/replay`, `/nbbo`, `/ws`, `/flow`, `/candles` | not required | required |
| Public app check | not required | required |
| Public API route suite | not required | required |

## Staged cutover plan

1. **Stage 1: native workers only**
   - install user units
   - validate `./deployment/native/check-native-health.sh workers`
   - use `./deploy main --runtime native --fast`
2. **Stage 2: native API behind local-only verification**
   - start `islandflow-api.service`
   - confirm `curl http://127.0.0.1:4000/health`
   - do not switch public routing yet
3. **Stage 3: deliberate public edge cutover**
   - update proxy routing to native `web`/`api`
   - export `DEPLOY_NATIVE_EDGE_READY=1`
   - run full native deploy
   - validate `bun run scripts/check-public-api-routes.ts https://flow.deltaisland.io`
4. **Stage 4: decide final default runtime**
   - keep Docker as fallback until native edge has proven stable

## Recommended current commands

Fast backend iteration before edge cutover:

```bash
export DEPLOY_NATIVE_SYSTEMCTL_PREFIX="systemctl --user"
./deploy main --runtime native --fast
```

Supported production path today:

```bash
./deploy main --runtime docker
```
