# Nginx Proxy Manager

This stack runs Nginx Proxy Manager separately from the Nextcloud stack while preserving the existing proxy host database and certificates.

## Layout

- `docker-compose.yml` defines the standalone NPM service.
- `.env` holds only stack-local settings like `TZ` and the admin bind IP.
- Runtime state lives in:
  - `./data`
  - `./letsencrypt`

## Networks

This stack joins the same external Docker networks that the current proxy hosts depend on:

- `nextcloud_edge` for `nextcloud-app` and `portainer`
- `npm-shared` for Islandflow services like `web` and `api`

Because the container name stays `nginx-proxy-manager`, the existing `proxy.deltaisland.io -> nginx-proxy-manager:81` host continues to work after migration.

### Upstream alias collisions

This NPM instance is attached to multiple Docker networks. If two stacks both expose a generic alias like `api` or `web`, Nginx can resolve the wrong upstream.

For Islandflow hosts, prefer explicit upstream hostnames in NPM:

- `islandflow-vps-web-1` on port `3000`
- `islandflow-vps-api-1` on port `4000`

This avoids routing Islandflow traffic to similarly named containers from other stacks.

## Migration

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Stop the old NPM service from `/home/delta/nextcloud`.
3. Copy the existing state directories into this stack:

```bash
cp -rf /home/delta/nextcloud/npm/data /home/delta/islandflow/deployment/npm/
cp -rf /home/delta/nextcloud/npm/letsencrypt /home/delta/islandflow/deployment/npm/
```

4. Start the new stack:

```bash
docker compose up -d
```

5. Verify the expected hosts still load:

- `https://proxy.deltaisland.io`
- `https://portainer.deltaisland.io`
- `https://cloud.dpdrm.com`

## Current Live Proxy Hosts

- `cloud.dpdrm.com` -> `nextcloud-app:80`
- `portainer.deltaisland.io` -> `portainer:9000`
- `proxy.deltaisland.io` -> `nginx-proxy-manager:81`

Islandflow-specific host mapping should use explicit upstream container names whenever possible:

- `flow.deltaisland.io` -> `islandflow-vps-web-1:3000`
- `api.flow.deltaisland.io` -> `islandflow-vps-api-1:4000`
