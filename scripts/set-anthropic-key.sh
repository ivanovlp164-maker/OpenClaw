#!/usr/bin/env bash
# Configure Anthropic as the LLM provider.
# Idempotent: re-run to rotate the key or re-seed the config.
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

# Run the official non-interactive onboarding via a one-shot ephemeral
# gateway-image container (mirrors upstream scripts/docker/setup.sh). Uses
# the gateway service definition because openclaw-cli's network_mode joins
# the gateway namespace, which doesn't exist when config is missing.
# Refs: docs/install/docker.md, docs/start/wizard-cli-automation.md,
#       docs/providers/anthropic.md
docker compose --env-file .env run --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard \
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

# Force-recreate the gateway with the freshly written config.
docker compose --env-file .env up -d --force-recreate openclaw-gateway

# Wait for /healthz before declaring success.
echo -n "[+] waiting for gateway /healthz "
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 2
  if [[ $i -eq 60 ]]; then
    echo
    echo "[!] /healthz didn't respond in 120s"
    echo "    last logs:"
    docker compose --env-file .env logs --tail=30 openclaw-gateway
    exit 1
  fi
done

# Sanity check: list anthropic models via cli (gateway is healthy now).
docker compose --env-file .env run --rm --no-deps openclaw-cli \
  models list --provider anthropic 2>&1 | head -20 || true

echo "[ok] Anthropic configured; gateway healthy."
