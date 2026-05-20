#!/usr/bin/env bash
set -euo pipefail

scope="${1:-full}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

case "$scope" in
  full|services|workers|api|web)
    ;;
  *)
    echo "Usage: deployment/native/cutover.sh [full|services|workers|api|web]" >&2
    exit 1
    ;;
esac

echo "Stopping Docker-owned Islandflow app services before native ownership starts."
(
  cd "$repo_root/deployment/docker"
  docker compose stop web api compute candles ingest-options ingest-equities ingest-news
)

if [[ "$scope" == "full" || "$scope" == "services" || "$scope" == "api" || "$scope" == "web" ]]; then
  "$repo_root/deployment/native/check-native-infra.sh"
fi

systemctl --user restart $(case "$scope" in
  full) echo islandflow-web.service islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service ;;
  services) echo islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service ;;
  workers) echo islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service ;;
  api) echo islandflow-api.service ;;
  web) echo islandflow-web.service ;;
esac)

"$repo_root/deployment/native/check-native-health.sh" "$scope"
