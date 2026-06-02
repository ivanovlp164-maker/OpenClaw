# Telegram userbot exporter (read-only)

Connects to **your own** Telegram account, reads all personal chats, and dumps
them to JSON so the agent can mine contacts for opportunities (see the
`contact-miner` skill). **Read-only — it never sends anything.**

## ⚠️ Read this first

- Automating a personal account is **against Telegram's ToS** and can get the
  account **limited or banned**. Your main account is a business asset — decide
  with that in mind. Lower-risk alternative: Telegram Desktop → Settings →
  Advanced → **Export Telegram Data** (JSON) gives the same data with zero ban
  risk; this script's output feeds `contact-miner` identically.
- Keep it **one-shot and read-only**. Do not add outbound messaging — writing to
  contacts automatically is what triggers bans and damages reputation. You send
  the messages yourself, after reviewing the agent's drafts.
- The `.session` file **is a login to your account**. Never commit or share it.
  (It's gitignored.)

## Steps (simplest path)

1. **Get API credentials** (once): open https://my.telegram.org → *API
   development tools* → create an app → copy **api_id** and **api_hash**.

2. **Configure:**
   ```bash
   cd tools/telegram-userbot
   cp .env.example .env
   # edit .env: paste TG_API_ID and TG_API_HASH
   ```

3. **Install & run:**
   ```bash
   python3 -m venv .venv && . .venv/bin/activate
   pip install -r requirements.txt
   set -a; . ./.env; set +a
   python export_chats.py
   ```
   First run asks for your **phone number** and the **login code** Telegram
   sends you (and 2FA password if you have one — entered locally, not stored by
   the script). After that the `.session` file is reused.

4. **Output:** `export/telegram_dump.json` — all personal chats (gitignored).

5. **Analyze:** give that JSON to the agent and say:
   > Прогони этот дамп через contact-miner: собери карту «контакт →
   > возможность», отсортируй по деньгам и тёплости, дай топ-10 с черновиками
   > первых сообщений в моём голосе. Никому не пиши — только список.

   Then **you** send the messages you approve.

## Tuning
- `TG_PER_CHAT_LIMIT` — messages per chat (default 300).
- `TG_USERS_ONLY=0` — also include groups/channels.

## Where to run
Run on a machine you trust (your laptop or the VPS). If on the VPS, keep the
dump and `.session` inside the gitignored paths — never in the repo.
