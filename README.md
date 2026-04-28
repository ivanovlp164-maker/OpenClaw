# OpenClaw on VPS — IaC

[OpenClaw](https://openclaw.ai) gateway running on a VPS, controlled from
iPhone via Telegram. This repo is the only source of truth: every change goes
through `git push`, GitHub Actions ships it.

## Architecture

```
iPhone ── Termius ───────► VPS  (paste-once bootstrap)
iPhone ── Telegram ──────► OpenClaw Gateway  (daily use)
iPhone ── Tailscale app ─► VPS:18789 Control UI  (rare admin)
iPhone ── GitHub app ────► repo ──Actions──ssh──► VPS  (every change)
```

- **Image:** `ghcr.io/openclaw/openclaw:2026.4.26` (pinned, bump in PRs).
- **Network:** UFW allows SSH(22) only on public IP; gateway port 18789 reachable only via Tailscale.
- **Secrets:** none in repo. `.env` lives on the VPS only; LLM/Telegram keys held in GitHub Actions secrets + on-disk `.env`.
- **DM safety:** OpenClaw default `dmPolicy="pairing"` — unknown senders get a pairing code, you approve from CLI.

## First-time install (paste once on a fresh VPS)

SSH from iPhone (Termius/Blink) as root, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/ivanovlp164-maker/OpenClaw/main/bootstrap.sh | bash
```

The script prints **NEXT STEPS** at the end. Follow them in order:

1. Sign in to Tailscale (URL printed by bootstrap → open in iPhone Safari).
2. Add the printed deploy key to **GitHub repo → Settings → Deploy keys** (write access).
3. Add **Actions secrets** (`VPS_SSH_PRIVATE_KEY`, `VPS_TAILSCALE_HOSTNAME`, `VPS_DEPLOY_USER`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, plus `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET` for the GHA Tailscale connector).
4. On the VPS, run:
   - `./scripts/set-anthropic-key.sh`
   - `./scripts/onboard-telegram.sh`
5. From iPhone, message your Telegram bot. Approve the pairing code on the VPS:
   `docker compose run --rm openclaw-cli pairing approve telegram <code>`

## Day-to-day (mobile)

| What you want         | How                                                                |
| --------------------- | ------------------------------------------------------------------ |
| Talk to assistant     | Open Telegram, message your bot                                    |
| Bump image version    | Edit `.env.example` `OPENCLAW_IMAGE=…` in Working Copy → push      |
| Apply changes         | Auto via `deploy` workflow on push, or run `restart` workflow      |
| See if it's alive     | `healthcheck` workflow runs every 15 min; alerts to Telegram       |
| Manual restart        | GitHub mobile → Actions → "restart" → Run workflow                 |
| View logs             | SSH (Termius) → `/opt/openclaw/scripts/logs.sh`                    |
| Open Control UI       | Tailscale app on → Safari → `http://<ts-name>:18789/`              |

## Files

```
bootstrap.sh                    # paste-once installer (idempotent)
docker-compose.yml              # gateway + cli services (ghcr.io image)
.env.example                    # env template (no secrets)
scripts/
  status.sh                     # docker ps + /healthz
  logs.sh                       # tail logs
  update.sh                     # pull repo + image, restart
  set-anthropic-key.sh          # set ANTHROPIC_API_KEY
  onboard-telegram.sh           # add Telegram channel
  backup.sh                     # snapshot ./state/
.github/workflows/
  deploy.yml                    # on push to main → ssh+update
  restart.yml                   # manual: ssh+restart
  healthcheck.yml               # cron: /healthz, alert on fail
docs/
  RUNBOOK.md                    # troubleshooting from a phone
```

See `docs/RUNBOOK.md` for incident playbook.
