#!/usr/bin/env bash
# Start the container detached and tail the logs once.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d
echo
echo "Service started. Status:"
docker compose ps
echo
echo "Recent logs (last 40 lines):"
docker compose logs --tail=40
echo
echo "Tail logs live with:  docker compose logs -f"
