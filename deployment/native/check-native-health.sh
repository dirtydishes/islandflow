#!/usr/bin/env bash
set -euo pipefail

scope="${1:-full}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
units=()

case "$scope" in
  full)
    units=(islandflow-web.service islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service)
    ;;
  web)
    units=(islandflow-web.service)
    ;;
  api)
    units=(islandflow-api.service)
    ;;
  services)
    units=(islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service)
    ;;
  workers)
    units=(islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service islandflow-ingest-news.service)
    ;;
  *)
    echo "Unknown scope: $scope" >&2
    echo "Expected one of: full, web, api, services, workers" >&2
    exit 1
    ;;
esac

case "$scope" in
  full|api|services|workers)
    "$repo_root/deployment/native/check-native-infra.sh"
    ;;
esac

for unit in "${units[@]}"; do
  systemctl --user is-active --quiet "$unit"
  echo "ok $unit"
done

if [[ " ${units[*]} " == *" islandflow-api.service "* ]]; then
  curl -fksS http://127.0.0.1:4000/health >/dev/null
  echo "ok api-health"
fi

if [[ " ${units[*]} " == *" islandflow-web.service "* ]]; then
  curl -I -fksS http://127.0.0.1:3000/ >/dev/null
  echo "ok web-health"
fi
