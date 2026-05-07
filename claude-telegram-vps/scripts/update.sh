#!/usr/bin/env bash
# git pull + rebuild image + restart container. Volumes (.claude state) are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
