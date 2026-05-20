#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Stopping native app services."
systemctl --user stop islandflow-web.service islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service || true

echo "Stopping native infra before Docker reopens durable data."
if [[ "${EUID}" -eq 0 ]]; then
  systemctl stop islandflow-nats.service islandflow-redis.service islandflow-clickhouse.service || true
else
  sudo systemctl stop islandflow-nats.service islandflow-redis.service islandflow-clickhouse.service || true
fi

echo "Switching NPM Islandflow upstreams back to Docker service names."
"$repo_root/deployment/native/switch-npm-edge.sh" docker

echo "Restarting Docker Islandflow runtime."
(
  cd "$repo_root/deployment/docker"
  docker compose up -d web api compute candles ingest-options ingest-equities ingest-news
)

curl -I -fksS "${DEPLOY_PUBLIC_APP_URL:-https://flow.deltaisland.io}" >/dev/null
curl -fksS "${DEPLOY_PUBLIC_API_HEALTH_URL:-https://api.flow.deltaisland.io/health}" >/dev/null
echo "Rollback validation passed."
