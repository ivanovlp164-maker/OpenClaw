#!/usr/bin/env bash
# OpenClaw VPS bootstrap.
# Run ONCE on a fresh Ubuntu 22.04+/Debian 12+ VPS as root.
# Idempotent: safe to re-run.
#
# Paste-once command (from iPhone Termius):
#   curl -fsSL https://raw.githubusercontent.com/ivanovlp164-maker/OpenClaw/main/bootstrap.sh | bash
#
# After bootstrap completes, follow the printed NEXT STEPS.

set -euo pipefail

REPO_URL="${OPENCLAW_REPO_URL:-https://github.com/ivanovlp164-maker/OpenClaw.git}"
REPO_BRANCH="${OPENCLAW_REPO_BRANCH:-main}"
INSTALL_DIR="${OPENCLAW_INSTALL_DIR:-/opt/openclaw}"
DEPLOY_USER="${OPENCLAW_DEPLOY_USER:-openclaw}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
TS_HOSTNAME="${OPENCLAW_TS_HOSTNAME:-openclaw-vps}"

c_blue=$'\033[1;36m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'; c_green=$'\033[1;32m'; c_reset=$'\033[0m'
log()  { printf '%s[+]%s %s\n' "$c_blue"  "$c_reset" "$*"; }
warn() { printf '%s[!]%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
ok()   { printf '%s[ok]%s %s\n' "$c_green" "$c_reset" "$*"; }
die()  { printf '%s[x]%s %s\n' "$c_red"   "$c_reset" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo -i, then re-run."

# ── 1. OS check ────────────────────────────────────────────────────────────
[[ -r /etc/os-release ]] || die "Missing /etc/os-release."
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) die "Unsupported OS '${ID:-?}'. Need Ubuntu 20.04+ or Debian 11+." ;;
esac
log "OS: ${PRETTY_NAME:-$ID}"

# ── 2. Base packages ──────────────────────────────────────────────────────
log "Installing base packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release ufw git jq sudo openssl unzip

# ── 3. Tailscale ──────────────────────────────────────────────────────────
if ! command -v tailscale >/dev/null; then
  log "Installing Tailscale…"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# ── 4. Docker Engine ──────────────────────────────────────────────────────
if ! command -v docker >/dev/null; then
  log "Installing Docker Engine…"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} $(lsb_release -cs) stable
EOF
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 5. Deploy user ────────────────────────────────────────────────────────
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Creating user '$DEPLOY_USER'…"
  useradd -m -s /bin/bash -G docker "$DEPLOY_USER"
fi
# Ensure docker group membership (idempotent)
usermod -aG docker "$DEPLOY_USER"

# ── 6. Deploy SSH key for GitHub Actions ──────────────────────────────────
SSH_DIR="/home/${DEPLOY_USER}/.ssh"
DEPLOY_KEY="${SSH_DIR}/deploy"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
if [[ ! -f "$DEPLOY_KEY" ]]; then
  log "Generating GitHub Actions deploy SSH key…"
  ssh-keygen -t ed25519 -N '' -C "github-actions@openclaw" -f "$DEPLOY_KEY"
fi
# Authorize the deploy key for the deploy user
touch "${SSH_DIR}/authorized_keys"
chmod 600 "${SSH_DIR}/authorized_keys"
if ! grep -qF "$(cat "${DEPLOY_KEY}.pub")" "${SSH_DIR}/authorized_keys"; then
  cat "${DEPLOY_KEY}.pub" >> "${SSH_DIR}/authorized_keys"
fi
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$SSH_DIR"

# ── 7. Repo clone ─────────────────────────────────────────────────────────
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log "Cloning ${REPO_URL} (${REPO_BRANCH}) → ${INSTALL_DIR}"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  log "Updating existing checkout in ${INSTALL_DIR}"
  git -C "$INSTALL_DIR" fetch --quiet origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" checkout --quiet "$REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only --quiet origin "$REPO_BRANCH"
fi
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$INSTALL_DIR"

# ── 8. .env (gateway token + secret slots) ────────────────────────────────
ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating ${ENV_FILE}…"
  cp "${INSTALL_DIR}/.env.example" "$ENV_FILE"
  GATEWAY_TOKEN="$(openssl rand -hex 32)"
  sed -i "s|__REPLACE_TOKEN__|${GATEWAY_TOKEN}|" "$ENV_FILE"
  # Provide config + workspace directories (created next).
  CONFIG_DIR="${INSTALL_DIR}/state/config"
  WORK_DIR="${INSTALL_DIR}/state/workspace"
  sed -i "s|__REPLACE_CONFIG_DIR__|${CONFIG_DIR}|" "$ENV_FILE"
  sed -i "s|__REPLACE_WORKSPACE_DIR__|${WORK_DIR}|" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "$ENV_FILE"

# State dirs (config + workspace volumes).
# Ownership is set AFTER the image is pulled (we need the container's
# node-user UID/GID to match the bind-mount), see step 11.
mkdir -p "${INSTALL_DIR}/state/config" "${INSTALL_DIR}/state/workspace"

# ── 9. UFW (firewall) ─────────────────────────────────────────────────────
log "Configuring firewall (UFW)…"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
# Allow everything in over the Tailscale interface (gateway access).
ufw allow in on tailscale0 comment 'Tailscale mesh'
ufw --force enable >/dev/null
ok "UFW: $(ufw status | head -1)"

# ── 10. Tailscale up (interactive auth) ───────────────────────────────────
if ! tailscale status --self=true >/dev/null 2>&1 \
   || [[ "$(tailscale status --json 2>/dev/null | jq -r '.BackendState // empty')" != "Running" ]]; then
  warn "Tailscale needs auth. Open the URL below on your iPhone."
  warn "After approving, this script will continue."
  tailscale up --ssh --hostname "$TS_HOSTNAME" --accept-routes
fi
TS_IP4="$(tailscale ip -4 2>/dev/null | head -1 || echo '')"
TS_NAME="$(tailscale status --json 2>/dev/null | jq -r '.Self.HostName // empty')"
ok "Tailscale: ${TS_NAME:-?} @ ${TS_IP4:-?}"

# ── 11. Pull image, align bind-mount ownership, start gateway ────────────
log "Pulling OpenClaw image…"
sudo -u "$DEPLOY_USER" -H bash -lc "cd '$INSTALL_DIR' && docker compose --env-file .env pull"

# Detect the container's runtime UID/GID. Some VPS images ship with a
# default user at UID 1000, pushing our 'openclaw' to 1001 — that breaks
# the bind-mounted /home/node/.openclaw. Chown the bind targets to whatever
# UID:GID the gateway image actually runs as.
log "Aligning state ownership with container UID…"
NODE_UID="$(sudo -u "$DEPLOY_USER" -H bash -lc \
  "cd '$INSTALL_DIR' && docker compose --env-file .env run --rm --no-deps --entrypoint id openclaw-gateway -u" \
  | tr -d '\r\n')"
NODE_GID="$(sudo -u "$DEPLOY_USER" -H bash -lc \
  "cd '$INSTALL_DIR' && docker compose --env-file .env run --rm --no-deps --entrypoint id openclaw-gateway -g" \
  | tr -d '\r\n')"
ok "Container UID:GID = ${NODE_UID}:${NODE_GID}"
chown -R "${NODE_UID}:${NODE_GID}" "${INSTALL_DIR}/state"
# Repo + .env stay owned by the deploy user.
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${INSTALL_DIR}/.git" "${INSTALL_DIR}/scripts" 2>/dev/null || true
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${ENV_FILE}"

# Run the official non-interactive onboarding to seed config (Anthropic
# key + provider keys can be added later via ./scripts/set-anthropic-key.sh
# or onboard-telegram.sh; here we just make sure gateway has a valid
# minimal config so it doesn't crash-loop on 'Missing config').
log "Running initial onboarding (no provider yet)…"
sudo -u "$DEPLOY_USER" -H bash -lc "cd '$INSTALL_DIR' && \
  docker compose --env-file .env run --rm --no-deps --entrypoint node openclaw-gateway \
    dist/index.js onboard --non-interactive --mode local --auth-choice skip \
    --gateway-port 18789 --gateway-bind lan --gateway-auth token \
    --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN \
    --skip-bootstrap --skip-skills --skip-health --accept-risk" || \
  warn "Initial onboarding skipped/failed — re-run ./scripts/set-anthropic-key.sh after bootstrap."

log "Starting OpenClaw gateway…"
sudo -u "$DEPLOY_USER" -H bash -lc "cd '$INSTALL_DIR' && docker compose --env-file .env up -d"

# ── 12. Wait for healthz ──────────────────────────────────────────────────
log "Waiting for /healthz…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/healthz" >/dev/null 2>&1; then
    ok "Gateway healthy on :${GATEWAY_PORT}"
    break
  fi
  sleep 2
  [[ $i -eq 60 ]] && warn "Gateway didn't respond to /healthz in 120s. Check 'docker compose logs'."
done

# ── 13. Summary + next steps ──────────────────────────────────────────────
PUB_KEY_CONTENT="$(cat "${DEPLOY_KEY}.pub")"
PRIV_KEY_PATH="$DEPLOY_KEY"
GW_TOKEN="$(grep '^OPENCLAW_GATEWAY_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"

cat <<EOF

${c_green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c_reset}
${c_green}  OpenClaw bootstrap complete on $(hostname)${c_reset}
${c_green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c_reset}

Tailscale name : ${TS_NAME:-?}
Tailscale IP   : ${TS_IP4:-?}
Gateway URL    : http://${TS_IP4:-127.0.0.1}:${GATEWAY_PORT}/   (open via Tailscale on iPhone)
Gateway token  : ${GW_TOKEN}

NEXT STEPS (do these on iPhone):

 1. Install Tailscale on iPhone, sign in same account, approve this node.
    https://apps.apple.com/app/tailscale/id1470499037

 2. In GitHub mobile app → ivanovlp164-maker/OpenClaw → Settings →
    "Deploy keys" → "Add deploy key" → ALLOW WRITE ACCESS, paste:

${c_yellow}${PUB_KEY_CONTENT}${c_reset}

 3. In the same repo → Settings → Secrets and variables → Actions → "New":
      VPS_SSH_PRIVATE_KEY    →  contents of ${PRIV_KEY_PATH} on this VPS
      VPS_TAILSCALE_HOSTNAME →  ${TS_NAME:-${TS_HOSTNAME}}
      VPS_DEPLOY_USER        →  ${DEPLOY_USER}
      ANTHROPIC_API_KEY      →  your Anthropic API key
      TELEGRAM_BOT_TOKEN     →  from @BotFather

    To copy the private key on this VPS, run:
      cat ${PRIV_KEY_PATH}

 4. Set the Anthropic key + Telegram channel from this VPS:
      cd ${INSTALL_DIR}
      ./scripts/set-anthropic-key.sh   # paste key when asked
      ./scripts/onboard-telegram.sh    # paste bot token when asked

 5. From iPhone: open your Telegram bot, send "/start". OpenClaw will reply
    with a pairing code; approve it from this VPS:
      cd ${INSTALL_DIR}
      docker compose run --rm openclaw-cli pairing approve telegram <code>

After step 3, every 'git push' to main triggers .github/workflows/deploy.yml
which redeploys via SSH+Tailscale. No more manual SSH needed.

${c_green}Done.${c_reset}
EOF
