#!/usr/bin/env bash
# Configure Anthropic as the LLM provider.
# Idempotent: re-run to rotate the key.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  read -rsp "Anthropic API key (input hidden): " ANTHROPIC_API_KEY
  echo
fi
[[ -n "$ANTHROPIC_API_KEY" ]] || { echo "[x] empty key"; exit 1; }

# Persist in .env so the gateway container picks it up via env on restart.
if grep -q '^ANTHROPIC_API_KEY=' .env; then
  sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}|" .env
else
  printf '\nANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" >> .env
fi
chmod 600 .env

# Use the official non-interactive onboarding to wire Anthropic into the
# config (auth profile + default model). Reference:
#   docs/start/wizard-cli-automation.md
#   docs/providers/anthropic.md
docker compose --env-file .env run --rm --no-deps openclaw-cli onboard \
  --non-interactive \
  --mode local \
  --auth-choice apiKey \
  --anthropic-api-key "$ANTHROPIC_API_KEY" \
  --secret-input-mode plaintext \
  --gateway-port 18789 \
  --gateway-bind lan \
  --skip-bootstrap \
  --skip-skills \
  --skip-health \
  --accept-risk

# Restart gateway so the new config is picked up.
docker compose --env-file .env up -d --force-recreate openclaw-gateway

# Quick sanity check.
docker compose --env-file .env run --rm --no-deps openclaw-cli \
  models list --provider anthropic 2>&1 | head -20 || true

echo "[ok] Anthropic configured; gateway restarted."
