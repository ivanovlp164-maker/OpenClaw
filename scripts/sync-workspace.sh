#!/usr/bin/env bash
# Sync the git-managed agent workspace (personality, skills, memory seeds)
# from the repo into the live OpenClaw workspace on the VPS.
#
# The repo is PUBLIC, so it holds only a DE-IDENTIFIED baseline. The real
# per-user profile, persona tuning and memory live ONLY on the VPS, never git.
#
# Source of truth split:
#   - Skills (skills/) — OVERWRITTEN on every sync (capability updates).
#   - Persona/profile (IDENTITY/SOUL/USER/AGENTS/HEARTBEAT/TOOLS) and memory
#     (memory/*.md, MEMORY.md) — SEED ONLY: copied if absent, NEVER clobbered.
#     This protects a live, tuned VPS setup and its private memory.
#
# Idempotent. Safe to run on every deploy (called by scripts/update.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="workspace"
WS="$(grep '^OPENCLAW_WORKSPACE_DIR=' .env | cut -d= -f2-)"
[[ -n "${WS:-}" ]] || { echo "[x] OPENCLAW_WORKSPACE_DIR not set in .env"; exit 1; }
[[ -d "$SRC" ]] || { echo "[i] no $SRC/ in repo, nothing to sync"; exit 0; }

mkdir -p "$WS" "$WS/memory" "$WS/skills"

# 1. Persona / profile config — SEED ONLY (copy if absent). These are the
#    files a user tunes per-install on the VPS; the git versions are just a
#    de-identified baseline for fresh installs. We never clobber a live setup.
for f in IDENTITY.md SOUL.md USER.md AGENTS.md HEARTBEAT.md TOOLS.md; do
  if [[ -f "$SRC/$f" && ! -f "$WS/$f" ]]; then
    cp "$SRC/$f" "$WS/$f"
    echo "[+] seeded $f"
  fi
done

# 2. Skills — overwrite tree (capability updates are safe & desirable), but
#    don't delete user-added skills.
if [[ -d "$SRC/skills" ]]; then
  cp -a "$SRC/skills/." "$WS/skills/"
fi

# 3. Memory — seed only when absent; never overwrite runtime memory.
if [[ -f "$SRC/MEMORY.md" && ! -f "$WS/MEMORY.md" ]]; then
  cp "$SRC/MEMORY.md" "$WS/MEMORY.md"
  echo "[+] seeded MEMORY.md"
fi
if [[ -d "$SRC/memory" ]]; then
  for m in "$SRC"/memory/*; do
    [[ -e "$m" ]] || continue
    base="$(basename "$m")"
    if [[ ! -e "$WS/memory/$base" ]]; then
      cp "$m" "$WS/memory/$base"
      echo "[+] seeded memory/$base"
    fi
  done
fi

# 4. Align ownership with the container's runtime UID/GID so the in-container
#    node user can read config and write memory. Mirrors bootstrap.sh: chown
#    runs inside a one-shot root container against the bind-mounted workspace,
#    so this works without host root.
NODE_UID="$(docker compose --env-file .env run --rm --no-deps --entrypoint id openclaw-gateway -u 2>/dev/null | tr -d '\r\n' || true)"
NODE_GID="$(docker compose --env-file .env run --rm --no-deps --entrypoint id openclaw-gateway -g 2>/dev/null | tr -d '\r\n' || true)"
if [[ -n "$NODE_UID" && -n "$NODE_GID" ]]; then
  docker compose --env-file .env run --rm --user 0:0 --no-deps \
    --entrypoint chown openclaw-gateway \
    -R "${NODE_UID}:${NODE_GID}" /home/node/.openclaw/workspace \
    >/dev/null 2>&1 \
    || echo "[!] workspace chown failed; agent may hit permission errors"
else
  echo "[!] could not detect container UID/GID; skipped chown"
fi

echo "[ok] workspace synced -> $WS"
