# Docker Deployment

This directory is the supported VPS deployment path for Islandflow.

The repo no longer ships or supports a separate `deployment/npm` stack. Docker Compose is the deployment surface; if you want a reverse proxy, point it at the host ports published by this stack.

It is separate from the repo-root `docker-compose.yml`, which remains the lightweight local infra stack for development.

## What this stack does

- Builds and runs the full Islandflow stack with Docker Compose.
- Publishes `web` and `api` to host ports, bound to loopback by default.
- Runs ClickHouse, Redis, and NATS JetStream with persistent Docker volumes.
- Runs the core runtime services: `ingest-options`, `ingest-equities`, `compute`, `candles`, `api`, and `web`.
- Keeps `replay` opt-in through a Compose profile, because the current replay service starts immediately when the container is enabled.

## Files

- `deployment/docker/docker-compose.yml`: production-style stack for a single VPS
- `deployment/docker/Dockerfile.service`: shared Bun runtime image for most services
- `deployment/docker/Dockerfile.ingest-options`: Bun runtime plus Python dependencies for Databento and IBKR adapters
- `deployment/docker/Dockerfile.web`: multi-stage build for the Next.js web app
- `deployment/docker/workspace-root/`: deployment-specific workspace snapshot (`package.json`, `tsconfig.base.json`, `bun.lock`) used by Docker builds
- `deployment/docker/clickhouse/listen.xml`: forces ClickHouse to listen on IPv4 for other containers on the Docker network
- `deployment/docker/.env.example`: container-oriented environment template

## Prerequisites

- A Linux VPS with Docker Engine and Docker Compose v2 installed
- Enough RAM for ClickHouse plus the Bun services

Optional:

- A DNS record pointed at the VPS
- Any reverse proxy or load balancer you prefer
- Alpaca, Databento, or IBKR credentials if you are not using the synthetic adapters

## First deployment

1. Copy the env template:

```bash
cd deployment/docker
cp .env.example .env
```

2. Edit `.env`.

Important defaults:

- `NATS_URL`, `CLICKHOUSE_URL`, and `REDIS_URL` should stay on the internal container hostnames unless you intentionally split infra out.
- `OPTIONS_INGEST_ADAPTER=synthetic` and `EQUITIES_INGEST_ADAPTER=synthetic` are the safest first-boot settings.
- `WEB_BIND_IP=127.0.0.1` and `API_BIND_IP=127.0.0.1` keep the published ports local to the host by default.
- `WEB_HOST_PORT=3000` and `API_HOST_PORT=4000` control the host-side published ports.
- `NEXT_PUBLIC_API_URL=` (empty, the default in `.env.example`) fits same-origin mode where your edge layer proxies API paths from the app origin to the API host port.
- `NEXT_PUBLIC_API_URL=https://api.example.com` fits a two-origin setup where the browser reaches the API on a separate public origin.

3. Build and start the stack:

```bash
docker compose up -d --build
```

If you are updating an existing deployment that already has failing `api` restart loops, do a full recreate so the ClickHouse config mount and dependency changes are applied cleanly:

```bash
docker compose down
docker compose up -d --build --force-recreate
```

4. Confirm the containers are healthy:

```bash
docker compose ps
docker compose logs -f api web compute candles ingest-options ingest-equities
```

5. Open the app.

With the default loopback binding:

- UI: `http://127.0.0.1:3000/`
- Health check: `http://127.0.0.1:4000/health`

If you want direct remote access without a reverse proxy, change `WEB_BIND_IP` and `API_BIND_IP` to `0.0.0.0` and restrict exposure with your firewall.

## Access patterns

### Direct host-port mode

Use this when you want Docker alone to serve the app:

- set `WEB_BIND_IP=0.0.0.0`
- set `API_BIND_IP=0.0.0.0`
- optionally change `WEB_HOST_PORT` / `API_HOST_PORT`
- point DNS or clients at the host directly

### Reverse proxy mode

If you use Caddy, Nginx, Traefik, a cloud load balancer, or another edge layer, proxy to the published host ports from this stack. The repo does not require or manage any specific proxy anymore.

Supported routing modes:

1. Two-origin mode
   - `app.<domain>` -> host `WEB_HOST_PORT`
   - `api.<domain>` -> host `API_HOST_PORT`
   - Build web with `NEXT_PUBLIC_API_URL=https://api.<domain>`.

2. Same-origin mode
   - Build web with `NEXT_PUBLIC_API_URL=` (empty).
   - Point `app.<domain>` at the web host port.
   - Proxy these API routes from the app origin to the API host port:
     - `/ws/*`, `/replay/*`, `/prints/*`, `/joins/*`, `/nbbo/*`, `/dark/*`, `/flow/*`, `/candles/*`

Enable websocket support on whichever host serves `/ws/*`.

## Replay service

Replay is disabled by default in this stack.

Start it only when you want it:

```bash
docker compose --profile replay up -d replay
```

Stop it again:

```bash
docker compose stop replay
```

## Adapter notes

### Synthetic mode

This is the easiest way to smoke-test the deployment:

- `OPTIONS_INGEST_ADAPTER=synthetic`
- `EQUITIES_INGEST_ADAPTER=synthetic`

### Alpaca mode

Set the adapter values and credentials in `.env`:

- `OPTIONS_INGEST_ADAPTER=alpaca`
- `EQUITIES_INGEST_ADAPTER=alpaca`
- `ALPACA_KEY_ID=...`
- `ALPACA_SECRET_KEY=...`

### Databento mode

The `ingest-options` image in this deployment includes Python plus the repo’s sidecar dependencies, so Databento can run without a custom image. Set the Databento env vars in `.env`, especially:

- `OPTIONS_INGEST_ADAPTER=databento`
- `DATABENTO_API_KEY=...`
- `DATABENTO_START=...`

### IBKR mode

If TWS or IB Gateway is running on the VPS host, the default `.env.example` already points `IBKR_HOST` at `host.docker.internal`, and the Compose stack adds the required host gateway mapping.

If IBKR is running somewhere else, change:

- `IBKR_HOST`
- `IBKR_PORT`

## Updating the deployment

This deployment installs dependencies from `deployment/docker/workspace-root/bun.lock` rather than the repo-root lockfile.

When dependencies change in any workspace used by Docker builds, refresh and validate the deployment snapshot first:

```bash
bun run sync:docker-workspace
bun run check:docker-workspace
```

Then validate the VPS build path:

```bash
cd deployment/docker
docker compose build web
```

## Safe rollouts on `152.53.80.229`

The checked-in deploy helper is meant to run from your local repo checkout, not from the VPS shell. It always targets:

- SSH host: `delta@152.53.80.229`
- SSH key: `~/.ssh/delta_ed25519`
- Live repo checkout: `/home/delta/islandflow`
- Live compose directory: `/home/delta/islandflow/deployment/docker`

It preserves the current Docker Compose project and avoids destructive cleanup on the server.

### Deploy `origin/main`

```bash
./deploy main
```

This flow:

- fetches `origin` locally and shows the local branch state
- checks the server checkout before switching anything
- stops if the server has tracked local modifications
- allows the known untracked tarball at `deployment/docker/signal-cli-0.14.3-Linux-native.tar.gz`
- runs `git switch main`, `git pull --ff-only origin main`, and `docker compose up -d --build`
- verifies the stack with `docker compose ps`, recent service logs, container-local health checks, and public HTTPS checks

### Deploy the current local branch

```bash
./deploy current-branch
```

Alias:

```bash
./deploy current branch
```

This flow:

- requires a clean local working tree so you only deploy committed state
- pushes the current local branch to `origin`
- uses `git push -u origin <branch>` automatically when the branch has no upstream yet
- switches the server checkout to that same branch and keeps it there until you intentionally move it back
- runs the same rebuild and verification steps as `main`

### Escalation path

Use force recreate only when a normal refresh does not update the services cleanly:

```bash
./deploy main --force-recreate
./deploy current-branch --force-recreate
```

### Return the server to `main`

If the live checkout is on a branch deploy and you want normal production tracking again:

```bash
./deploy main
```

The helper always does the final public verification against:

- `https://flow.deltaisland.io`

It also verifies API health from inside the `api` container during the remote verification step.

If you intentionally run a separate public API origin, add an extra public API check by exporting `DEPLOY_PUBLIC_API_HEALTH_URL` before running the deploy:

```bash
DEPLOY_PUBLIC_API_HEALTH_URL=https://api.example.com/health ./deploy main
```

Same-origin deployments should leave that unset unless the edge layer exposes a public API health route on purpose.

## Manual server fallback

If you need to run the rollout steps manually over SSH, use the same live checkout and compose directory. Avoid `git clean -fd`, `git reset --hard`, or other destructive cleanup during normal app rollouts.

Deploy `main` manually:

```bash
ssh -i ~/.ssh/delta_ed25519 -o IdentitiesOnly=yes delta@152.53.80.229
cd /home/delta/islandflow
git fetch origin
git switch main
git pull --ff-only origin main

cd /home/delta/islandflow/deployment/docker
docker compose up -d --build
```

Deploy the current branch manually:

```bash
git push -u origin <current-branch>   # omit -u if upstream already exists

ssh -i ~/.ssh/delta_ed25519 -o IdentitiesOnly=yes delta@152.53.80.229
cd /home/delta/islandflow
git fetch origin
git switch <current-branch> || git switch -c <current-branch> --track origin/<current-branch>
git pull --ff-only origin <current-branch>

cd /home/delta/islandflow/deployment/docker
docker compose up -d --build
```

If you changed only env values for the Bun services on the server:

```bash
cd /home/delta/islandflow/deployment/docker
docker compose up -d
```

If you changed `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_NBBO_MAX_AGE_MS`, rebuild the web image because those are public Next.js build-time values:

```bash
cd /home/delta/islandflow/deployment/docker
docker compose build web
docker compose up -d web
```

## Backups and persistence

Persistent data lives in Docker volumes:

- `clickhouse-data`
- `redis-data`
- `nats-data`

Before destructive maintenance, back up those volumes or the underlying Docker data directory for the host.

## Shutdown

Stop everything while keeping data:

```bash
docker compose down
```

Stop everything and remove volumes too:

```bash
docker compose down -v
```

Only use `-v` if you intentionally want to wipe ClickHouse, Redis, and JetStream state.

## Known caveats

- The root `.env.example` still contains a `REPLAY_ENABLED` comment, but the current replay service does not read that variable. Use the Compose replay profile instead.
- `web` and `api` bind to loopback by default. External access requires changing the bind IPs or placing a reverse proxy in front of the published host ports.
- Some hosts disable IPv6 inside containers; the bundled ClickHouse config pins `listen_host` to `0.0.0.0` so the API can reach ClickHouse reliably over Docker networking.
- The stack assumes a single-node VPS deployment. If you later split infra or add external managed services, update the three core connection URLs in `.env`.

## Smoke checks

After the stack is up:

- `docker compose ps` should show healthy `api`, `web`, `clickhouse`, and `redis` services.
- `curl http://127.0.0.1:4000/health` should return a healthy response on the server.
- `curl -I http://127.0.0.1:3000/` should return a successful HTTP status on the server.
- In two-origin mode, browser requests should target `https://api.<domain>/...` and live feeds should use `wss://api.<domain>/ws/...`.
- In same-origin mode, browser requests should target `https://app.<domain>/...` for API paths and live feeds should use `wss://app.<domain>/ws/...`.
