# Docker Deployment

This directory contains a VPS-oriented Docker deployment for the full Islandflow stack.

It is separate from the repo-root `docker-compose.yml`, which is still the lightweight local infra stack for development.

## What this stack does

- Runs the core app behind a single public port on `80`.
- Proxies the UI to the Next.js web app.
- Proxies REST and websocket traffic to the API service.
- Runs ClickHouse, Redis, and NATS JetStream with persistent Docker volumes.
- Runs the core runtime services: `ingest-options`, `ingest-equities`, `compute`, `candles`, `api`, and `web`.
- Keeps `replay` opt-in through a Compose profile, because the current replay service starts immediately when the container is enabled.

## Files

- `deployment/docker/docker-compose.yml`: production-style stack for a single VPS
- `deployment/docker/Dockerfile.service`: shared Bun runtime image for most services
- `deployment/docker/Dockerfile.ingest-options`: Bun runtime plus Python dependencies for Databento and IBKR adapters
- `deployment/docker/Dockerfile.web`: multi-stage build for the Next.js web app
- `deployment/docker/nginx.conf`: reverse proxy that routes `/ws/*` and API paths to the API container and everything else to the web container
- `deployment/docker/.env.example`: container-oriented environment template

## Prerequisites

- A Linux VPS with Docker Engine and Docker Compose v2 installed
- Enough RAM for ClickHouse plus the Bun services
- Port `80/tcp` open on the VPS firewall

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
- Leave `NEXT_PUBLIC_API_URL` blank if you want the browser to use the same public host as the UI. That is the default layout this stack is configured for.

3. Build and start the stack:

```bash
docker compose up -d --build
```

4. Confirm the containers are healthy:

```bash
docker compose ps
docker compose logs -f api web compute candles ingest-options ingest-equities
```

5. Open the app:

- `http://<your-vps-ip>/`
- Health check: `http://<your-vps-ip>/health`

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

## Public routing

The reverse proxy sends these requests to the API container:

- `/health`
- `/prints/*`
- `/nbbo/*`
- `/quotes/*`
- `/candles/*`
- `/joins/*`
- `/dark/*`
- `/flow/*`
- `/replay/*`
- `/ws/*`

Everything else is sent to the Next.js web app.

That routing matters because the web client falls back to same-host API requests when `NEXT_PUBLIC_API_URL` is unset.

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
docker compose up -d web proxy
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
- This stack exposes plain HTTP on port `80`. If you want TLS termination on the box, put Caddy, Nginx, Traefik, or a cloud load balancer in front of it, or replace the bundled Nginx config with your preferred HTTPS setup.
- The stack assumes a single-node VPS deployment. If you later split infra or add external managed services, update the three core connection URLs in `.env`.
