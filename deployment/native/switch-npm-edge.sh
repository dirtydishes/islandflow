#!/usr/bin/env bash
set -euo pipefail

target="${1:-native}"
raw_api_mode="${ISLANDFLOW_RAW_API_MODE:-closed}"
npm_root="${NPM_ROOT:-/home/delta/nginx-proxy-manager}"
db_path="${NPM_DB_PATH:-$npm_root/data/database.sqlite}"
app_domain="${ISLANDFLOW_APP_DOMAIN:?Set ISLANDFLOW_APP_DOMAIN to the app host, e.g. <production-app-origin-host>}"
api_domain="${ISLANDFLOW_API_DOMAIN:?Set ISLANDFLOW_API_DOMAIN to the API host, e.g. <raw-api-origin-host>}"
native_host="${ISLANDFLOW_NATIVE_HOST:-}"
docker_web_host="${ISLANDFLOW_DOCKER_WEB_HOST:-web}"
docker_api_host="${ISLANDFLOW_DOCKER_API_HOST:-api}"
web_port="${ISLANDFLOW_WEB_PORT:-3000}"
api_port="${ISLANDFLOW_API_PORT:-4000}"
restart_npm="${NPM_RESTART:-1}"
npm_container="${NPM_CONTAINER_NAME:-nginx-proxy-manager}"
sudo_cmd=()

case "$target" in
  native|docker)
    ;;
  *)
    echo "Usage: deployment/native/switch-npm-edge.sh [native|docker] [--raw-api=closed|temporary-open]" >&2
    exit 1
    ;;
esac

for arg in "${@:2}"; do
  case "$arg" in
    --raw-api=closed)
      raw_api_mode="closed"
      ;;
    --raw-api=temporary-open)
      raw_api_mode="temporary-open"
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: deployment/native/switch-npm-edge.sh [native|docker] [--raw-api=closed|temporary-open]" >&2
      exit 1
      ;;
  esac
done

case "$raw_api_mode" in
  closed|temporary-open)
    ;;
  *)
    echo "ISLANDFLOW_RAW_API_MODE must be closed or temporary-open." >&2
    exit 1
    ;;
esac

resolve_native_host() {
  if [[ -n "$native_host" ]]; then
    printf '%s\n' "$native_host"
    return
  fi

  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$npm_container"; then
    native_host="$(docker inspect "$npm_container" --format '{{range .NetworkSettings.Networks}}{{println .Gateway}}{{end}}' | sed '/^$/d' | head -n1)"
    if [[ -n "$native_host" ]]; then
      printf '%s\n' "$native_host"
      return
    fi
  fi

  echo "Unable to determine the native upstream host for NPM." >&2
  echo "Set ISLANDFLOW_NATIVE_HOST explicitly or start the $npm_container container first." >&2
  exit 1
}

if [[ "$target" == "native" ]]; then
  native_host="$(resolve_native_host)"
fi

if [[ ! -w "$db_path" || ! -w "$(dirname "$db_path")" ]]; then
  if [[ "${EUID}" -eq 0 ]]; then
    sudo_cmd=()
  elif command -v sudo >/dev/null 2>&1; then
    sudo_cmd=(sudo)
  else
    echo "NPM database path is not writable and sudo is unavailable: $db_path" >&2
    exit 1
  fi
fi

if [[ ! -f "$db_path" ]]; then
  echo "NPM database not found: $db_path" >&2
  exit 1
fi

backup="$db_path.before-islandflow-$target-$(date +%Y%m%d%H%M%S)"
"${sudo_cmd[@]}" cp "$db_path" "$backup"
echo "Backed up NPM database to $backup"

"${sudo_cmd[@]}" python3 - "$db_path" "$target" "$raw_api_mode" "$app_domain" "$api_domain" "$native_host" "$docker_web_host" "$docker_api_host" "$web_port" "$api_port" <<'PY'
import json
import sqlite3
import sys

db_path, target, raw_api_mode, app_domain, api_domain, native_host, docker_web_host, docker_api_host, web_port, api_port = sys.argv[1:]
web_host = native_host if target == "native" else docker_web_host
api_host = native_host if target == "native" else docker_api_host

advanced_config = f"""location ~ ^/(ws|replay|prints|joins|nbbo|quotes|dark|flow|candles|history|news|lookup|option-prints|equity-joins)(/|$) {{
  set $forward_scheme http;
  set $server         "{api_host}";
  set $port           {api_port};

  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $http_connection;
  proxy_http_version 1.1;

  include conf.d/include/proxy.conf;
}}"""

def has_domain(raw, domain):
    try:
        return domain in json.loads(raw)
    except Exception:
        return domain in raw

con = sqlite3.connect(db_path)
cur = con.cursor()
rows = list(cur.execute("select id, domain_names from proxy_host where is_deleted = 0"))
app_ids = [row_id for row_id, domains in rows if has_domain(domains, app_domain)]
api_ids = [row_id for row_id, domains in rows if has_domain(domains, api_domain)]

if len(app_ids) != 1 or len(api_ids) != 1:
    raise SystemExit(f"Expected one app and one API proxy host, found app={app_ids} api={api_ids}")

cur.execute(
    "update proxy_host set forward_scheme = 'http', forward_host = ?, forward_port = ?, allow_websocket_upgrade = 1, advanced_config = ?, enabled = 1, modified_on = datetime('now') where id = ?",
    (web_host, int(web_port), advanced_config, app_ids[0]),
)

if raw_api_mode == "temporary-open":
    cur.execute(
        "update proxy_host set forward_scheme = 'http', forward_host = ?, forward_port = ?, allow_websocket_upgrade = 1, enabled = 1, modified_on = datetime('now') where id = ?",
        (api_host, int(api_port), api_ids[0]),
    )
else:
    cur.execute(
        "update proxy_host set forward_scheme = 'http', forward_host = '127.0.0.1', forward_port = 9, allow_websocket_upgrade = 0, advanced_config = '', enabled = 0, modified_on = datetime('now') where id = ?",
        (api_ids[0],),
    )
con.commit()
print(f"Updated {app_domain} -> {web_host}:{web_port}")
if raw_api_mode == "temporary-open":
    print(f"Temporarily opened {api_domain} -> {api_host}:{api_port}")
else:
    print(f"Closed {api_domain}; public raw API forwarding is disabled")
PY

if command -v python3 >/dev/null 2>&1; then
  "${sudo_cmd[@]}" python3 - "$npm_root" "$db_path" "$target" "$raw_api_mode" "$app_domain" "$api_domain" "$native_host" "$docker_web_host" "$docker_api_host" "$web_port" "$api_port" <<'PY'
import json
import re
import sqlite3
import sys
from pathlib import Path

(
    npm_root,
    db_path,
    target,
    raw_api_mode,
    app_domain,
    api_domain,
    native_host,
    docker_web_host,
    docker_api_host,
    web_port,
    api_port,
) = sys.argv[1:]

web_host = native_host if target == "native" else docker_web_host
api_host = native_host if target == "native" else docker_api_host

def has_domain(raw, domain):
    try:
        return domain in json.loads(raw)
    except Exception:
        return domain in raw

def replace_nth(text, pattern, replacement, index):
    matches = list(pattern.finditer(text))
    if len(matches) < index:
        raise SystemExit(f"Unable to rewrite generated proxy config; expected match {index} for {pattern.pattern!r}")
    match = matches[index - 1]
    return text[:match.start()] + replacement(match) + text[match.end():]

server_pattern = re.compile(r'^(?P<prefix>\s*set \$server\s+)".*?";\s*$', re.M)
port_pattern = re.compile(r'^(?P<prefix>\s*set \$port\s+)\d+;\s*$', re.M)

def replace_server(text, host, index):
    return replace_nth(text, server_pattern, lambda m: f'{m.group("prefix")}"{host}";', index)

def replace_port(text, port, index):
    return replace_nth(text, port_pattern, lambda m: f'{m.group("prefix")}{port};', index)

def indent_block(text, prefix):
    return "\n".join(f"{prefix}{line}" if line else line for line in text.splitlines())

def replace_api_location(text, advanced_config):
    rendered = indent_block(advanced_config, "  ") + "\n"
    pattern = re.compile(r'^  location ~ \^/\(.*?^  }\n?', re.M | re.S)
    if pattern.search(text):
        return pattern.sub(rendered, text, count=1)
    marker = "  location / {"
    if marker not in text:
        raise SystemExit("Unable to insert generated app proxy config; missing root location marker")
    return text.replace(marker, f"{rendered}\n{marker}", 1)

con = sqlite3.connect(db_path)
rows = list(con.execute("select id, domain_names, advanced_config from proxy_host where is_deleted = 0"))
app_rows = [(row_id, advanced_config) for row_id, domains, advanced_config in rows if has_domain(domains, app_domain)]
api_ids = [row_id for row_id, domains, _ in rows if has_domain(domains, api_domain)]
app_ids = [row_id for row_id, _ in app_rows]
if len(app_ids) != 1 or len(api_ids) != 1:
    raise SystemExit(f"Expected one app and one API proxy host, found app={app_ids} api={api_ids}")
app_advanced_config = app_rows[0][1]

api_conf = Path(npm_root) / "data/nginx/proxy_host" / f"{api_ids[0]}.conf"
app_conf = Path(npm_root) / "data/nginx/proxy_host" / f"{app_ids[0]}.conf"

if api_conf.exists():
    if raw_api_mode == "temporary-open":
        text = api_conf.read_text()
        text = replace_server(text, api_host, 1)
        text = replace_port(text, int(api_port), 1)
        api_conf.write_text(text)
        print(f"Synchronized {api_conf.name} -> {api_host}:{api_port}")
    else:
        api_conf.unlink()
        print(f"Removed generated raw API proxy config {api_conf.name}")

if app_conf.exists():
    text = app_conf.read_text()
    text = replace_server(text, web_host, 1)
    text = replace_port(text, int(web_port), 1)
    text = replace_api_location(text, app_advanced_config)
    app_conf.write_text(text)
    print(f"Synchronized {app_conf.name} -> {web_host}:{web_port} and API matcher -> {api_host}:{api_port}")
PY
fi

if [[ "$restart_npm" == "0" ]]; then
  echo "NPM container restart skipped because NPM_RESTART=0."
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$npm_container"; then
  docker restart "$npm_container" >/dev/null
  echo "Restarted nginx-proxy-manager"
else
  echo "NPM container restart skipped; restart it manually if it is not managed by Docker on this host."
fi

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$npm_container"; then
  "${sudo_cmd[@]}" python3 - "$npm_root" "$db_path" "$target" "$raw_api_mode" "$app_domain" "$api_domain" "$native_host" "$docker_web_host" "$docker_api_host" "$web_port" "$api_port" <<'PY'
import json
import re
import sqlite3
import sys
from pathlib import Path

(
    npm_root,
    db_path,
    target,
    raw_api_mode,
    app_domain,
    api_domain,
    native_host,
    docker_web_host,
    docker_api_host,
    web_port,
    api_port,
) = sys.argv[1:]

web_host = native_host if target == "native" else docker_web_host
api_host = native_host if target == "native" else docker_api_host

def has_domain(raw, domain):
    try:
        return domain in json.loads(raw)
    except Exception:
        return domain in raw

def replace_nth(text, pattern, replacement, index):
    matches = list(pattern.finditer(text))
    if len(matches) < index:
        raise SystemExit(f"Unable to rewrite generated proxy config; expected match {index} for {pattern.pattern!r}")
    match = matches[index - 1]
    return text[:match.start()] + replacement(match) + text[match.end():]

server_pattern = re.compile(r'^(?P<prefix>\s*set \$server\s+)".*?";\s*$', re.M)
port_pattern = re.compile(r'^(?P<prefix>\s*set \$port\s+)\d+;\s*$', re.M)

def replace_server(text, host, index):
    return replace_nth(text, server_pattern, lambda m: f'{m.group("prefix")}"{host}";', index)

def replace_port(text, port, index):
    return replace_nth(text, port_pattern, lambda m: f'{m.group("prefix")}{port};', index)

def indent_block(text, prefix):
    return "\n".join(f"{prefix}{line}" if line else line for line in text.splitlines())

def replace_api_location(text, advanced_config):
    rendered = indent_block(advanced_config, "  ") + "\n"
    pattern = re.compile(r'^  location ~ \^/\(.*?^  }\n?', re.M | re.S)
    if pattern.search(text):
        return pattern.sub(rendered, text, count=1)
    marker = "  location / {"
    if marker not in text:
        raise SystemExit("Unable to insert generated app proxy config; missing root location marker")
    return text.replace(marker, f"{rendered}\n{marker}", 1)

con = sqlite3.connect(db_path)
rows = list(con.execute("select id, domain_names, advanced_config from proxy_host where is_deleted = 0"))
app_rows = [(row_id, advanced_config) for row_id, domains, advanced_config in rows if has_domain(domains, app_domain)]
api_ids = [row_id for row_id, domains, _ in rows if has_domain(domains, api_domain)]
app_ids = [row_id for row_id, _ in app_rows]
if len(app_ids) != 1 or len(api_ids) != 1:
    raise SystemExit(f"Expected one app and one API proxy host, found app={app_ids} api={api_ids}")
app_advanced_config = app_rows[0][1]

api_conf = Path(npm_root) / "data/nginx/proxy_host" / f"{api_ids[0]}.conf"
app_conf = Path(npm_root) / "data/nginx/proxy_host" / f"{app_ids[0]}.conf"

if api_conf.exists():
    if raw_api_mode == "temporary-open":
        text = api_conf.read_text()
        text = replace_server(text, api_host, 1)
        text = replace_port(text, int(api_port), 1)
        api_conf.write_text(text)
    else:
        api_conf.unlink()

if app_conf.exists():
    text = app_conf.read_text()
    text = replace_server(text, web_host, 1)
    text = replace_port(text, int(web_port), 1)
    text = replace_api_location(text, app_advanced_config)
    app_conf.write_text(text)
PY
  reloaded=0
  for _ in 1 2 3 4 5; do
    if docker exec "$npm_container" nginx -s reload >/dev/null 2>&1; then
      reloaded=1
      break
    fi
    sleep 1
  done
  if [[ "$reloaded" == "1" ]]; then
    echo "Reloaded nginx-proxy-manager"
  else
    echo "Warning: nginx-proxy-manager reload did not succeed after restart; verify the container is healthy." >&2
  fi
fi
