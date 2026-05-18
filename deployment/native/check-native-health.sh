#!/usr/bin/env bash
set -euo pipefail

scope="${1:-full}"
units=()

case "$scope" in
  full)
    units=(islandflow-web.service islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service)
    ;;
  web)
    units=(islandflow-web.service)
    ;;
  api)
    units=(islandflow-api.service)
    ;;
  services)
    units=(islandflow-api.service islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service)
    ;;
  workers)
    units=(islandflow-compute.service islandflow-candles.service islandflow-ingest-options.service islandflow-ingest-equities.service)
    ;;
  *)
    echo "Unknown scope: $scope" >&2
    echo "Expected one of: full, web, api, services, workers" >&2
    exit 1
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
