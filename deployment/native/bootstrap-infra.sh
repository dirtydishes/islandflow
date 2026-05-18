#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${EUID}" -eq 0 ]]; then
  "$repo_root/deployment/native/install-infra-units.sh"
else
  sudo "$repo_root/deployment/native/install-infra-units.sh"
fi

echo "Stopping Docker Islandflow services before native infra opens durable data."
(
  cd "$repo_root/deployment/docker"
  docker compose stop web api compute candles ingest-options ingest-equities nats redis clickhouse
)

if [[ "${EUID}" -eq 0 ]]; then
  "$repo_root/deployment/native/start-infra.sh"
else
  sudo "$repo_root/deployment/native/start-infra.sh"
fi

"$repo_root/deployment/native/check-native-infra.sh"
