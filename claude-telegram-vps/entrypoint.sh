#!/bin/sh
# Materialize the Telegram plugin .env from the container env so the plugin
# picks up the bot token. The file lives in the persisted claude-config volume.
set -e

CHANNEL_ENV=/home/agent/.claude/channels/telegram/.env
mkdir -p "$(dirname "$CHANNEL_ENV")"

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  umask 077
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" > "$CHANNEL_ENV"
fi

exec "$@"
