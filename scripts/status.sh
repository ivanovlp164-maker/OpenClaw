#!/usr/bin/env bash
# Quick status check.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── docker compose ps ─────────────────────────"
docker compose --env-file .env ps
echo
echo "── /healthz ──────────────────────────────────"
PORT="$(grep '^OPENCLAW_GATEWAY_PORT=' .env | cut -d= -f2-)"
if curl -fsS "http://127.0.0.1:${PORT:-18789}/healthz"; then
  echo
  echo "[ok] healthy"
else
  echo "[x]  unhealthy"
  exit 1
fi
