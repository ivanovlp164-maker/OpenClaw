#!/usr/bin/env bash
# Interactive one-shot:
#   1) /login (browser-OAuth into Claude Pro)
#   2) install telegram plugin
#   3) /telegram:access pair <code> + /telegram:access policy allowlist
# All state persists in the claude-config volume.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env missing — run vps-bootstrap.sh first or copy .env.example"; exit 1; }
grep -q '^TELEGRAM_BOT_TOKEN=.\+' .env || { echo "TELEGRAM_BOT_TOKEN empty in .env"; exit 1; }

echo "Stopping background service (if any)…"
docker compose down 2>/dev/null || true

echo
echo "Starting interactive Claude Code shell inside the container."
echo "Inside the shell run, in order:"
echo
echo "   /login"
echo "   /plugin marketplace add claude-plugins-official"
echo "   /plugin install telegram@claude-plugins-official"
echo "   /exit"
echo
echo "Then this script will restart Claude with the Telegram channel attached"
echo "so you can pair the bot."
echo
read -rp "Press ENTER to enter the container…" _

docker compose run --rm --service-ports --entrypoint /bin/bash claude-telegram \
  -lc 'claude'

echo
echo "Now starting Claude with --channels for pairing."
echo "Inside, do:"
echo "   1) Open Telegram, send any message to @<your-bot>"
echo "   2) The bot replies with a 6-char pairing code"
echo "   3) Type:  /telegram:access pair <code>"
echo "   4) Type:  /telegram:access policy allowlist"
echo "   5) Type:  /telegram:access list   (verify your ID is there)"
echo "   6) Type:  /exit"
echo
read -rp "Press ENTER to continue…" _

docker compose run --rm --service-ports --entrypoint /bin/bash claude-telegram \
  -lc 'claude --channels plugin:telegram@claude-plugins-official'

echo
echo "Login + pairing done. Start the 24/7 service with:"
echo "   ./scripts/run-service.sh"
