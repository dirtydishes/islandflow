#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: deployment/native/rollback.sh <git-ref> [full|web|api|services|workers]" >&2
  exit 1
fi

ref="$1"
scope="${2:-services}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$repo_root"

if [[ -n "$(git status --porcelain=v1)" ]]; then
  echo "Refusing rollback with a dirty working tree." >&2
  exit 1
fi

current_ref="$(git rev-parse --short HEAD)"
echo "Rolling back from $current_ref to $ref (scope: $scope)"

git fetch --all --prune
git switch --detach "$ref"
bun install --frozen-lockfile

if [[ "$scope" == "full" || "$scope" == "web" ]]; then
  bun --cwd=apps/web run build
fi

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
    exit 1
    ;;
esac

systemctl --user restart "${units[@]}"
"$repo_root/deployment/native/check-native-health.sh" "$scope"

echo "Rollback complete. Repo is now detached at $(git rev-parse --short HEAD)."
echo "Return to tracked main later with: git switch main && git pull --ff-only <remote> main"
