# Docker Deployment

This directory contains a VPS-oriented Docker deployment for the full Islandflow stack.

It is separate from the repo-root `docker-compose.yml`, which is still the lightweight local infra stack for development.

## What this stack does

- Assumes Nginx Proxy Manager is the edge proxy and runs on a shared user-defined Docker network.
- Keeps `web` and `api` internal to the Docker network instead of publishing host ports.
- Targets a two-subdomain routing model by default:
  - `app.<domain>` -> `web:3000`
  - `api.<domain>` -> `api:4000`
- Runs ClickHouse, Redis, and NATS JetStream with persistent Docker volumes.
- Runs the core runtime services: `ingest-options`, `ingest-equities`, `compute`, `candles`, `api`, and `web`.
- Keeps `replay` opt-in through a Compose profile, because the current replay service starts immediately when the container is enabled.

## Files

- `deployment/docker/docker-compose.yml`: production-style stack for a single VPS
- `deployment/docker/Dockerfile.service`: shared Bun runtime image for most services
- `deployment/docker/Dockerfile.ingest-options`: Bun runtime plus Python dependencies for Databento and IBKR adapters
- `deployment/docker/Dockerfile.web`: multi-stage build for the Next.js web app
- `deployment/docker/clickhouse/listen.xml`: forces ClickHouse to listen on IPv4 for other containers on the Docker network
- `deployment/docker/.env.example`: container-oriented environment template

## Prerequisites

- A Linux VPS with Docker Engine and Docker Compose v2 installed
- Enough RAM for ClickHouse plus the Bun services
- Nginx Proxy Manager running in Docker on the same host
- A shared user-defined Docker network for NPM and this stack

Optional:

- A DNS record pointed at the VPS
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
- `OPTIONS_INGEST_ADAPTER=synthetic` and `EQUITIES_INGEST_ADAPTER=synthetic` are the safest first boot settings.
- `NPM_SHARED_NETWORK=npm-shared` is the recommended external Docker network name for NPM and this stack.
- `NEXT_PUBLIC_API_URL=https://api.example.com` uses a two-subdomain setup (`app` + `api`).
- `NEXT_PUBLIC_API_URL=` (empty) uses same-origin mode where the app host also proxies API paths to `api:4000`.

3. Build and start the stack:

If you have not created the shared Docker network yet, do that once first:

```bash
docker network create npm-shared
```

Then make sure `.env` keeps `NPM_SHARED_NETWORK=npm-shared`, or set it to whatever user-defined network you want to share with NPM.

Now build and start the stack:

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

5. Make sure NPM can reach the stack network.

This deployment attaches `web` and `api` to the external Docker network named by `NPM_SHARED_NETWORK`, in addition to the stack-local network.

If your NPM container is not already attached to that network, connect it once:

```bash
docker network connect npm-shared <npm-container-name>
```

If you want to use a different network name, set `NPM_SHARED_NETWORK` in `.env` and make sure that external Docker network already exists. The important part is that NPM, `web`, and `api` all share the same user-defined Docker network.

6. Create these NPM proxy hosts:

- `app.example.com` -> forward to `web` (or `islandflow-vps-web-1`), port `3000`
- `api.example.com` -> forward to `api` (or `islandflow-vps-api-1`), port `4000`

For the API host, enable websocket support.

If NPM is attached to multiple Docker networks and another stack also has an `api` container alias, prefer the explicit container name (`islandflow-vps-api-1`) to avoid DNS collisions.

7. Open the app:

- `https://app.example.com/`
- Health check: `https://api.example.com/health`

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

## NPM routing

The Islandflow stack expects an external NPM instance on the shared Docker network. The dedicated NPM stack now lives in `../npm`.

Supported routing modes:

1. Two-subdomain mode
   - `app.<domain>` -> `web:3000`
   - `api.<domain>` -> `api:4000`
   - Build web with `NEXT_PUBLIC_API_URL=https://api.<domain>`.

2. Same-origin fallback mode
   - Build web with `NEXT_PUBLIC_API_URL=` (empty).
   - Keep `app.<domain>` -> web.
   - Add path-based proxy rules on `app.<domain>` for API routes to `api:4000`:
     - `/ws/*`, `/replay/*`, `/prints/*`, `/joins/*`, `/nbbo/*`, `/dark/*`, `/flow/*`, `/candles/*`

Use websocket support on whichever host serves `/ws/*`.

If NPM is on multiple networks and names collide (for example another stack also exposes `api`), target explicit container names (`islandflow-vps-api-1`, `islandflow-vps-web-1`) instead of generic aliases.

## Updating the deployment

When you pull new code:

```bash
cd deployment/docker
docker compose up -d --build
```

If you changed only env values for the Bun services:

```bash
docker compose up -d
```

If you changed `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_NBBO_MAX_AGE_MS`, rebuild the web image because those are public Next.js build-time values:

```bash
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
- This stack does not publish `web` or `api` to host ports. NPM must be able to resolve `web` and `api` over the shared user-defined network from `NPM_SHARED_NETWORK`.
- If NPM is attached to more than one application network, generic upstream aliases like `api` can resolve to the wrong stack. Prefer explicit container names in NPM upstream settings.
- Some hosts disable IPv6 inside containers; the bundled ClickHouse config pins `listen_host` to `0.0.0.0` so the API can reach ClickHouse reliably over Docker networking.
- The stack assumes a single-node VPS deployment. If you later split infra or add external managed services, update the three core connection URLs in `.env`.

## Smoke checks

After NPM is wired up:

- `https://app.<domain>/` should load the UI.
- In two-subdomain mode, browser requests should target `https://api.<domain>/...` and live feeds should use `wss://api.<domain>/ws/...`.
- In same-origin mode, browser requests should target `https://app.<domain>/...` for API paths and live feeds should use `wss://app.<domain>/ws/...`.
- `docker compose ps` should show no service publishing host port `80`.
