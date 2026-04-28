#!/usr/bin/env bash
# Tail gateway logs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose --env-file .env logs -f --tail=200 "${1:-openclaw-gateway}"
