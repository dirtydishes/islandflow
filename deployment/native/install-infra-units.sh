#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
system_unit_source_dir="$repo_root/deployment/native/systemd/system"
config_source_dir="$repo_root/deployment/native/config"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

resolve_binary() {
  local name="$1"
  local path=""

  path="$(command -v "$name" 2>/dev/null || true)"
  if [[ -n "$path" ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  for candidate in "/usr/bin/$name" "/usr/sbin/$name" "/usr/local/bin/$name" "/usr/local/sbin/$name"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

missing=()
for command in nats-server redis-server clickhouse-server; do
  if ! resolve_binary "$command" >/dev/null; then
    missing+=("$command")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing native infra binaries: ${missing[*]}" >&2
  echo "Install NATS Server, Redis Server, and ClickHouse Server before bootstrapping native infra." >&2
  echo "On Debian, Redis is usually available as redis-server; ClickHouse and NATS may require their vendor repositories or packaged binaries." >&2
  exit 1
fi

ensure_system_user() {
  local name="$1"
  local home="$2"

  getent group "$name" >/dev/null || groupadd --system "$name"
  getent passwd "$name" >/dev/null || useradd --system --gid "$name" --home-dir "$home" --shell /usr/sbin/nologin "$name"
}

ensure_system_user nats /var/lib/islandflow/nats
ensure_system_user redis /var/lib/islandflow/redis
ensure_system_user clickhouse /var/lib/islandflow/clickhouse

install -d -m 0755 /etc/islandflow
install -m 0644 "$config_source_dir/redis.conf" /etc/islandflow/redis.conf
install -d -m 0755 /etc/clickhouse-server/config.d
install -m 0644 "$config_source_dir/clickhouse-listen.xml" /etc/clickhouse-server/config.d/islandflow-listen.xml

install -d -o nats -g nats -m 0750 /var/lib/islandflow/nats
install -d -o redis -g redis -m 0750 /var/lib/islandflow/redis
install -d -o clickhouse -g clickhouse -m 0750 /var/lib/islandflow/clickhouse

install -m 0644 "$system_unit_source_dir"/islandflow-*.service /etc/systemd/system/
systemctl daemon-reload

echo "Installed native infra system units and config."
echo "Start infra with: sudo deployment/native/start-infra.sh"
