#!/usr/bin/env bash
# Interactive one-shot:
#   1) /login (browser-OAuth into Claude Pro)
#   2) install telegram plugin
#   3) /telegram:access pair <code> + /telegram:access policy allowlist
# State persists in the claude-config Docker volume.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env missing — run vps-bootstrap.sh first or copy from .env.example"; exit 1; }
grep -q '^TELEGRAM_BOT_TOKEN=.\+' .env || { echo "TELEGRAM_BOT_TOKEN empty in .env"; exit 1; }

echo "Stopping background service (if any)…"
docker compose down 2>/dev/null || true

cat <<'TXT'

Step 1/2: opening interactive Claude shell.
Inside, run in order:

   /login
   /plugin marketplace add claude-plugins-official
   /plugin install telegram@claude-plugins-official
   /exit

TXT
read -rp "Press ENTER to enter the container…" _
docker compose run --rm claude-telegram bash -lc 'claude'

cat <<'TXT'

Step 2/2: starting Claude with the Telegram channel attached.
Inside, do:

   1) Open Telegram, send any message to your bot
   2) The bot replies with a 6-char pairing code
   3) /telegram:access pair <code>
   4) /telegram:access policy allowlist
   5) /telegram:access list      (verify your ID is there)
   6) /exit

TXT
read -rp "Press ENTER to continue…" _
docker compose run --rm claude-telegram bash -lc \
  'claude --channels plugin:telegram@claude-plugins-official'

echo
echo "Login + pairing done. Start the 24/7 service with:"
echo "   ./scripts/run-service.sh"
