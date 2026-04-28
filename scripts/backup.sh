#!/usr/bin/env bash
# Snapshot OpenClaw state (config + workspace) to ./backups/.
set -euo pipefail
cd "$(dirname "$0")/.."

ts="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
out="backups/openclaw-state-${ts}.tar.zst"

# zstd if available, gzip fallback.
if command -v zstd >/dev/null; then
  tar --use-compress-program='zstd -19 -T0' -cf "$out" state/
else
  out="${out%.zst}.gz"
  tar -czf "$out" state/
fi
echo "[ok] backup: $out ($(du -h "$out" | cut -f1))"
