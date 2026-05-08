#!/usr/bin/env bash
set -euo pipefail

git fetch
git pull
docker compose up -d --build --force-recreate
