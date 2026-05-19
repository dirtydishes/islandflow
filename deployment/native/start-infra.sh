#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

for unit in redis-server.service nats-server.service clickhouse-server.service; do
  if systemctl list-unit-files "$unit" >/dev/null 2>&1; then
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
  fi
done

systemctl reset-failed islandflow-nats.service islandflow-redis.service islandflow-clickhouse.service || true
systemctl enable --now islandflow-nats.service islandflow-redis.service islandflow-clickhouse.service
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-native-infra.sh"
