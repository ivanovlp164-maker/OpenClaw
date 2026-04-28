# Runbook (mobile-first)

All commands assume you're SSH-ed to the VPS as `openclaw` (or root) and
`cd /opt/openclaw`. From iPhone use Termius or Blink.

## Health

```bash
./scripts/status.sh           # docker ps + /healthz
./scripts/logs.sh             # tail gateway logs
./scripts/logs.sh openclaw-cli  # tail cli container if running
docker stats --no-stream
```

## Pairing a new sender (Telegram)

```bash
docker compose run --rm openclaw-cli pairing list
docker compose run --rm openclaw-cli pairing approve telegram <code>
```

## Rotate Telegram bot token

```bash
TELEGRAM_BOT_TOKEN=<new> ./scripts/onboard-telegram.sh
```

## Rotate Anthropic key

```bash
ANTHROPIC_API_KEY=<new> ./scripts/set-anthropic-key.sh
```

## Bump OpenClaw version

1. From iPhone in Working Copy: edit `.env.example`, change
   `OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:<new-version>`.
2. Commit + push to a branch, open PR.
3. Merge to `main` → `deploy` workflow runs → image pulled, gateway
   restarted, `/healthz` re-checked.

If you need to bump locally on the VPS without git push:

```bash
sed -i 's|^OPENCLAW_IMAGE=.*|OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:<ver>|' .env
./scripts/update.sh
```

## Rollback

```bash
sed -i 's|^OPENCLAW_IMAGE=.*|OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:<previous>|' .env
./scripts/update.sh
```

State volumes (`state/config`, `state/workspace`) are not touched by image
changes — config survives rollback.

## Backup before risky changes

```bash
./scripts/backup.sh   # writes ./backups/openclaw-state-*.tar.zst
```

Optional: `rclone copy backups/ <remote>:openclaw-backups/`.

## Restore from backup

```bash
docker compose --env-file .env down
rm -rf state/
tar -xf backups/openclaw-state-<timestamp>.tar.zst    # zst — uses zstd
docker compose --env-file .env up -d
```

## "Gateway is unhealthy" (healthcheck workflow alerted)

1. `./scripts/logs.sh` → look for the most recent stack trace.
2. `docker compose --env-file .env restart`
3. Still bad? `./scripts/status.sh` and inspect `docker compose ps`.
4. Container won't start? `docker compose --env-file .env up` (foreground) to
   see the error.
5. Out of disk? `df -h /` and `docker system prune -af --volumes` (this drops
   unused images and **unused** named volumes — your state volume is mounted
   by name and stays).

## "Telegram bot doesn't reply"

Three usual causes, in order of likelihood:

1. Pairing not approved →
   `docker compose run --rm openclaw-cli pairing list`.
2. Wrong token → `grep TELEGRAM_BOT_TOKEN .env`. Re-run
   `./scripts/onboard-telegram.sh`.
3. Anthropic key missing/expired → `./scripts/set-anthropic-key.sh`.

## Lock down SSH (recommended after first verified deploy)

```bash
# Make sure your deploy key works AS OPENCLAW USER first:
#   ssh -i /home/openclaw/.ssh/deploy openclaw@<ts-host> 'echo ok'

# Then disable password auth + root login over SSH:
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh
```

## Tailscale-only gateway port (defense in depth)

By default UFW already blocks 18789 on the public IP. To make extra-sure,
set `OPENCLAW_GATEWAY_BIND=localhost` in `.env` and rely on Tailscale SSH or
`ssh -L` tunnel from iPhone.

## Check exposed surface from outside

From any laptop or use [https://shodan.io] / portchecker.io for your VPS IP.
Only port 22 should answer. Tailscale uses UDP 41641 — that's expected.

## Useful `openclaw-cli` commands

```bash
docker compose run --rm openclaw-cli doctor
docker compose run --rm openclaw-cli channels list
docker compose run --rm openclaw-cli sessions list
docker compose run --rm openclaw-cli config get gateway
```
