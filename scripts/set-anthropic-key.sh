#!/usr/bin/env bash
# Set ANTHROPIC_API_KEY in .env and restart gateway.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  read -rsp "Anthropic API key (input hidden): " ANTHROPIC_API_KEY
  echo
fi
[[ -n "$ANTHROPIC_API_KEY" ]] || { echo "[x] empty key"; exit 1; }

# Replace or append in .env
if grep -q '^ANTHROPIC_API_KEY=' .env; then
  sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}|" .env
else
  printf '\nANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" >> .env
fi
chmod 600 .env

# Tell OpenClaw which provider/model is primary.
docker compose --env-file .env run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js config set --batch-json \
  '[{"path":"providers.anthropic.apiKey","value":"'"${ANTHROPIC_API_KEY}"'"},
    {"path":"agents.defaults.provider","value":"anthropic"}]'

docker compose --env-file .env up -d
echo "[ok] Anthropic key applied; gateway restarted."
