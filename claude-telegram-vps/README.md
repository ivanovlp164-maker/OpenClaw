# claude-telegram-vps — Claude Code в Docker, 24/7 в Telegram

Изолированная установка официального Claude Code Telegram-плагина на VPS:
весь рантайм агента живёт **внутри Docker-контейнера** (не на хосте), все
состояния — в именованных Docker-волах. Хост держит только Docker + git + ufw.

Это альтернатива гайду «От OpenClaw к Claude Code», адаптированная под
контейнерную изоляцию, которую запросил владелец.

## Что внутри

| Файл | Назначение |
|---|---|
| `Dockerfile` | Ubuntu 24.04 + Bun + Claude Code (нативный установщик) |
| `docker-compose.yml` | сервис `claude-telegram` с `restart: unless-stopped` и healthcheck |
| `settings.json` | `bypassPermissions` + allowlist инструментов (как шаг 10 гайда) |
| `.env.example` | шаблон секретов |
| `scripts/vps-bootstrap.sh` | one-shot установка Docker + клон репо + сборка образа |
| `scripts/login.sh` | интерактивный `/login` + установка плагина + spaaring |
| `scripts/run-service.sh` | `docker compose up -d` + статус |
| `scripts/status.sh` | быстрый health-check |
| `scripts/update.sh` | git pull + rebuild + restart |

## Quickstart на VPS

```bash
# 1. Bootstrap (как root)
curl -fsSL https://raw.githubusercontent.com/ivanovlp164-maker/OpenClaw/claude/isolated-agent-setup-9yCDm/claude-telegram-vps/scripts/vps-bootstrap.sh | bash

# 2. Заполнить секреты
nano /opt/claude-telegram/claude-telegram-vps/.env

# 3. Логин в Claude + спаривание Telegram (один раз, интерактивно)
cd /opt/claude-telegram/claude-telegram-vps
./scripts/login.sh

# 4. Запустить 24/7
./scripts/run-service.sh
```

## Изоляция

- Контейнер не имеет capabilities кроме дефолтных Docker (можно ужесточить
  через `cap_drop` — добавьте при необходимости).
- Внутри контейнера юзер `agent` (UID 1001), не root. `sudo NOPASSWD` оставлен
  для удобства системного администрирования агентом, но процесс `claude`
  стартует от `agent`.
- `bypassPermissions` действует **только в контейнере** — взлом плагина не даёт
  прямого root на хосте.
- Состояние (`~/.claude`, OAuth-токены, настройки канала) — в именованном
  Docker-воле `claude-config`. Делайте бэкап:
  `docker run --rm -v claude-telegram-vps_claude-config:/src -v $PWD:/dst alpine tar czf /dst/claude-config.tar.gz -C /src .`

## 24/7

`docker compose` с `restart: unless-stopped` сам поднимет контейнер после
ребута VPS (Docker daemon стартует через systemd при загрузке). Доп. systemd
unit не нужен. Healthcheck бьёт `pgrep -f 'claude --channels'` каждые 30 сек.

## Health check

```bash
cd /opt/claude-telegram/claude-telegram-vps
./scripts/status.sh
docker compose logs -f       # live
docker compose exec claude-telegram tail -50 /home/agent/.claude/run.log
```

## Обновление

```bash
cd /opt/claude-telegram/claude-telegram-vps
./scripts/update.sh
```

Состояние (`/home/agent/.claude` внутри контейнера = вол `claude-config` на
хосте) сохраняется между пересборками.
