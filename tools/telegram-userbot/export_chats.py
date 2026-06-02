#!/usr/bin/env python3
"""Read-only Telegram account exporter (userbot via MTProto / Telethon).

Connects to YOUR OWN Telegram account, reads dialogs + recent message history,
and writes everything to a single JSON file for analysis (see the
`contact-miner` skill). It then feeds straight into the agent.

READ-ONLY BY DESIGN: this script only *reads*. It never sends a message, joins,
leaves, marks read, or modifies anything. There is intentionally no send/write
call anywhere in this file.

⚠️  Automating a personal account is against Telegram's Terms of Service and can
    get the account limited or banned. Your main account is a business asset —
    use this sparingly, one-shot, read-only, at your own risk. Do NOT turn it
    into an always-on bot, and do NOT add outbound messaging.

Setup & usage: see README.md in this folder.
"""
import os
import sys
import json
import asyncio
import datetime

try:
    from telethon import TelegramClient
except ImportError:
    sys.exit("Telethon not installed. Run: pip install -r requirements.txt")


def _env_int(name: str, default: str) -> int:
    return int(os.environ.get(name, default))


API_ID = os.environ.get("TG_API_ID")
API_HASH = os.environ.get("TG_API_HASH")
SESSION = os.environ.get("TG_SESSION", "tg_userbot")          # -> tg_userbot.session
PER_CHAT_LIMIT = _env_int("TG_PER_CHAT_LIMIT", "300")          # messages per chat
USERS_ONLY = os.environ.get("TG_USERS_ONLY", "1") == "1"      # personal DMs only
OUT = os.environ.get("TG_OUT", "export/telegram_dump.json")

if not API_ID or not API_HASH:
    sys.exit("Set TG_API_ID and TG_API_HASH (see README.md / .env.example).")


async def main() -> None:
    client = TelegramClient(SESSION, int(API_ID), API_HASH)
    # .start() prompts for phone number + login code on first run, then reuses
    # the saved .session file. No password is stored by this script.
    await client.start()
    me = await client.get_me()
    print(f"[+] logged in as @{me.username or me.id} (read-only)")

    data = {
        "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
        "account": {"id": me.id, "username": me.username},
        "dialogs": [],
    }

    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        kind = type(entity).__name__  # User / Chat / Channel
        if USERS_ONLY and kind != "User":
            continue

        chat = {
            "id": dialog.id,
            "name": dialog.name,
            "kind": kind,
            "username": getattr(entity, "username", None),
            "phone": getattr(entity, "phone", None),
            "messages": [],
        }

        async for msg in client.iter_messages(dialog.id, limit=PER_CHAT_LIMIT):
            if not getattr(msg, "message", None):
                continue  # skip media-only / service messages
            chat["messages"].append({
                "date": msg.date.isoformat() if msg.date else None,
                "out": bool(msg.out),          # True = sent by you
                "sender_id": msg.sender_id,
                "text": msg.message,
            })

        data["dialogs"].append(chat)
        print(f"    {dialog.name}: {len(chat['messages'])} msgs")
        await asyncio.sleep(0.5)  # be gentle on the API

    out_dir = os.path.dirname(OUT)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[ok] wrote {OUT} — {len(data['dialogs'])} dialogs")
    print("    Next: feed this file to the agent and run the contact-miner skill.")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
