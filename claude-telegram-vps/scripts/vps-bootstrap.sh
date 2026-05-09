#!/usr/bin/env bash
# Run on a fresh Ubuntu 22.04+/Debian 12+ VPS as root.
# Installs Docker + clones this repo + builds image (does NOT start service yet).
# Idempotent: safe to re-run.
set -euo pipefail

REPO_URL="${CLAUDE_TG_REPO_URL:-https://github.com/ivanovlp164-maker/OpenClaw.git}"
REPO_BRANCH="${CLAUDE_TG_REPO_BRANCH:-claude/isolated-agent-setup-9yCDm}"
INSTALL_DIR="${CLAUDE_TG_INSTALL_DIR:-/opt/claude-telegram}"

c_g=$'\033[1;32m'; c_b=$'\033[1;36m'; c_y=$'\033[1;33m'; c_r=$'\033[1;31m'; c_x=$'\033[0m'
log() { printf '%s[+]%s %s\n' "$c_b" "$c_x" "$*"; }
ok()  { printf '%s[ok]%s %s\n' "$c_g" "$c_x" "$*"; }
warn(){ printf '%s[!]%s %s\n' "$c_y" "$c_x" "$*" >&2; }
die() { printf '%s[x]%s %s\n' "$c_r" "$c_x" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root."
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) die "Need Ubuntu/Debian, got '${ID:-?}'." ;; esac
log "OS: ${PRETTY_NAME}"

export DEBIAN_FRONTEND=noninteractive
log "Installing base packages…"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release git ufw

if ! command -v docker >/dev/null; then
  log "Installing Docker Engine…"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} $(lsb_release -cs) stable
EOF
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log "Cloning $REPO_URL ($REPO_BRANCH) → $INSTALL_DIR"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  log "Updating $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --quiet origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" checkout --quiet "$REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only --quiet origin "$REPO_BRANCH"
fi

WORK="$INSTALL_DIR/claude-telegram-vps"
[[ -d "$WORK" ]] || die "Expected $WORK, not found."

if [[ ! -f "$WORK/.env" ]]; then
  log "Creating $WORK/.env from template — fill in TELEGRAM_BOT_TOKEN before running login.sh"
  cp "$WORK/.env.example" "$WORK/.env"
  chmod 600 "$WORK/.env"
fi

log "Configuring UFW…"
ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null
ok "UFW: $(ufw status | head -1)"

log "Building Docker image (first build takes ~3–5 min)…"
cd "$WORK"
docker compose build

ok "Bootstrap finished."
cat <<EOF

${c_g}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c_x}
${c_g}  Image built, but NOT started yet.${c_x}
${c_g}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c_x}

Next:

 1. Edit $WORK/.env — set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID
        nano $WORK/.env

 2. One-shot login + pairing (interactive):
        cd $WORK && ./scripts/login.sh

 3. Start 24/7 service:
        cd $WORK && ./scripts/run-service.sh
EOF
