# ClickHouse Reset Runbook

This runbook is for deliberately wiping durable market-data history from ClickHouse in local development or on the VPS. It is destructive. Do not run these commands from application startup, deployment hooks, or unattended scripts.

## When To Use

Use this only when an operator has decided that existing option, equity, flow, and derived-event history should be discarded and rebuilt from fresh ingest.

Before running a reset:

- Confirm the target environment: local Docker or VPS Docker.
- Confirm there is no active analysis depending on the existing history.
- Take a backup if the data may be needed later.
- Stop ingest and API services so new writes do not race the reset.

## Local Docker Reset

From the repository root:

```bash
bun run dev:infra
docker compose exec clickhouse clickhouse-client --query "SHOW TABLES"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS option_prints"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS option_nbbo"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS equity_prints"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS equity_quotes"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS equity_print_joins"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS flow_packets"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS smart_money_events"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS classifier_hits"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS alerts"
docker compose exec clickhouse clickhouse-client --query "TRUNCATE TABLE IF EXISTS inferred_dark_events"
```

If the local compose project uses `deployment/docker/docker-compose.yml`, run the same commands with `docker compose -f deployment/docker/docker-compose.yml exec clickhouse ...`.

## VPS Docker Reset

On the VPS, first identify the active compose project and ClickHouse service:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
docker compose -f deployment/docker/docker-compose.yml ps
```

Then stop writers and run the same `TRUNCATE TABLE IF EXISTS ...` commands against the active ClickHouse container. Prefer `docker compose exec clickhouse clickhouse-client --query "<query>"` when the compose project is healthy; otherwise use `docker exec <clickhouse-container> clickhouse-client --query "<query>"`.

## Verification

After the reset:

```bash
docker compose exec clickhouse clickhouse-client --query "SELECT count() FROM option_prints"
docker compose exec clickhouse clickhouse-client --query "SELECT count() FROM flow_packets"
```

Restart ingest/API services through the normal dev or deployment path. The options tape should repopulate its 100-row hot head from new signal prints, and older rows should appear only after the scroll gate asks `/history/options` for ClickHouse-backed history.
