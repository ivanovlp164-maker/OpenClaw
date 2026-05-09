#!/bin/sh
# Materialize the Telegram plugin .env from the container env so the plugin
# picks up the bot token. Also symlink ~/.claude.json into the persisted
# claude-config volume — without this the OAuth/session state lives in the
# container's writable layer and disappears on every container recreation.
set -e

CLAUDE_DIR=/home/agent/.claude
mkdir -p "$CLAUDE_DIR"

# Persist ~/.claude.json across container recreations.
if [ ! -L /home/agent/.claude.json ]; then
  if [ -f /home/agent/.claude.json ] && [ ! -e "$CLAUDE_DIR/.claude.json" ]; then
    mv /home/agent/.claude.json "$CLAUDE_DIR/.claude.json"
  fi
  rm -f /home/agent/.claude.json
  ln -s "$CLAUDE_DIR/.claude.json" /home/agent/.claude.json
fi

CHANNEL_ENV="$CLAUDE_DIR/channels/telegram/.env"
mkdir -p "$(dirname "$CHANNEL_ENV")"

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  umask 077
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" > "$CHANNEL_ENV"
fi

exec "$@"
