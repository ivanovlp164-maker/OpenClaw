#!/usr/bin/env bash
# Pull latest repo + image, restart gateway. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet origin
git pull --ff-only --quiet origin "$(git rev-parse --abbrev-ref HEAD)"

docker compose --env-file .env pull
docker compose --env-file .env up -d --remove-orphans
docker image prune -f >/dev/null

./scripts/status.sh
