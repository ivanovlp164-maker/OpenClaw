#!/usr/bin/env bash
# Add a Telegram channel. Get a bot token from @BotFather first.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  read -rsp "Telegram bot token (from @BotFather, input hidden): " TELEGRAM_BOT_TOKEN
  echo
fi
[[ -n "$TELEGRAM_BOT_TOKEN" ]] || { echo "[x] empty token"; exit 1; }

# Persist in .env so subsequent restarts have it.
if grep -q '^TELEGRAM_BOT_TOKEN=' .env; then
  sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}|" .env
else
  printf '\nTELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" >> .env
fi
chmod 600 .env

# Register the channel in OpenClaw.
docker compose --env-file .env run --rm openclaw-cli \
  channels add --channel telegram --token "$TELEGRAM_BOT_TOKEN"

docker compose --env-file .env up -d
echo "[ok] Telegram channel added."
echo "Now message your bot from iPhone. It will reply with a pairing code,"
echo "then approve from this VPS:"
echo "  docker compose run --rm openclaw-cli pairing approve telegram <code>"
