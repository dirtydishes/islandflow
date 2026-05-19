#!/usr/bin/env bash
set -euo pipefail

systemctl is-active --quiet islandflow-nats.service
echo "ok islandflow-nats.service"

systemctl is-active --quiet islandflow-redis.service
echo "ok islandflow-redis.service"

systemctl is-active --quiet islandflow-clickhouse.service
echo "ok islandflow-clickhouse.service"

if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -h 127.0.0.1 -p 6379 ping | grep -q PONG
else
  timeout 2 bash -c '</dev/tcp/127.0.0.1/6379'
fi
echo "ok redis-ping"

curl -fksS http://127.0.0.1:8123/ping | grep -q Ok
echo "ok clickhouse-ping"

timeout 2 bash -c '</dev/tcp/127.0.0.1/4222'
echo "ok nats-port"
