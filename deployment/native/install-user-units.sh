#!/usr/bin/env bash
set -euo pipefail

scope="${1:-none}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
unit_source_dir="$repo_root/deployment/native/systemd/user"
unit_target_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
units=()

case "$scope" in
  none)
    ;;
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
    echo "Expected one of: none, full, web, api, services, workers" >&2
    exit 1
    ;;
esac

mkdir -p "$unit_target_dir"
cp "$unit_source_dir"/*.service "$unit_target_dir"/

systemctl --user daemon-reload

if [[ ${#units[@]} -gt 0 ]]; then
  systemctl --user enable "${units[@]}"
fi

echo "Installed Islandflow user units into $unit_target_dir"
if [[ ${#units[@]} -gt 0 ]]; then
  echo "Enabled scope: $scope"
else
  echo "No units enabled yet. Pass a scope such as workers when you are ready."
fi
