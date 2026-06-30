#!/usr/bin/env bash
#
# lifeOS cloud bootstrap — Ubuntu 22.04/24.04 ARM (Oracle Cloud Ampere A1) or any Debian/Ubuntu box.
#
# Installs the SAME stack you run on Windows: Node 20, the `claude` CLI, Syncthing, Tailscale,
# pm2 (autostart on boot), plus the document-extraction tools process-inbox uses for docx/pptx/pdf.
#
# It does NOT authenticate anything or open ports — those are interactive/secret steps you do by
# hand (see deploy/README.md). Re-running this script is safe (idempotent).
#
# Usage:  bash deploy/setup.sh
#
set -euo pipefail

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Run as your normal user (e.g. ubuntu), not root — the script uses sudo where needed." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
log "Updating apt and installing base packages"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg git ufw \
  pandoc poppler-utils         # pandoc → docx/pptx/odt→text · poppler → pdftotext
# libreoffice is large (~400MB); uncomment if you attach .xlsx a lot and want soffice extraction:
# sudo apt-get install -y libreoffice-calc libreoffice-impress

# ---------------------------------------------------------------------------
# On a small box (e.g. Google Cloud free e2-micro = 1 GB RAM) a `claude` run + Node + Syncthing can
# OOM. Add a 3 GB swapfile when RAM is under ~1.5 GB and we haven't already created one. Idempotent.
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "${RAM_MB:-9999}" -lt 1500 ] && [ ! -f /swapfile ]; then
  log "Low RAM (${RAM_MB} MB) detected — creating a 3 GB swapfile"
  sudo fallocate -l 3G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=3072
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # Favor keeping things in RAM; only swap under real pressure.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-lifeos-swap.conf >/dev/null
  sudo sysctl -w vm.swappiness=10
fi

# ---------------------------------------------------------------------------
if ! have node || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Installing Node.js 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Node $(node -v) already present — skipping"
fi

# ---------------------------------------------------------------------------
log "Installing global npm tools: claude CLI + pm2"
sudo npm install -g @anthropic-ai/claude-code pm2

# ---------------------------------------------------------------------------
if ! have syncthing; then
  log "Installing Syncthing (official apt repo)"
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://syncthing.net/release-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/syncthing.gpg
  echo "deb [signed-by=/etc/apt/keyrings/syncthing.gpg] https://apt.syncthing.net/ syncthing stable" \
    | sudo tee /etc/apt/sources.list.d/syncthing.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y syncthing
else
  log "Syncthing already present — skipping"
fi

log "Enabling Syncthing as a user service (runs as $USER, autostarts on boot)"
sudo loginctl enable-linger "$USER"            # let the user service run without an active login
systemctl --user enable --now syncthing.service 2>/dev/null \
  || sudo systemctl enable --now "syncthing@$USER.service"

# ---------------------------------------------------------------------------
if ! have tailscale; then
  log "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
else
  log "Tailscale already present — skipping"
fi

# ---------------------------------------------------------------------------
log "Installing lifeOS npm dependencies"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
npm ci --omit=dev || npm install --omit=dev

# ---------------------------------------------------------------------------
log "Done installing. Next (interactive) steps — see deploy/README.md:"
cat <<'EOF'

  1. claude login        :  run `claude` once, open the URL it prints, paste the code back
  2. Tailscale           :  sudo tailscale up        (approve the device in the admin console)
  3. Syncthing pairing   :  ssh -L 8384:localhost:8384 <vm>  then open http://localhost:8384
                            add this device to your existing cluster, share the vault folder
  4. config.json         :  cp config.example.json config.json  and set:
                              "vaultPath"  -> absolute path of the synced vault on THIS box
                              "claudePath" -> output of `which claude`
  5. Start under pm2     :  pm2 start ecosystem.config.cjs
                            pm2 save
                            pm2 startup        (run the line it prints, then `pm2 save` again)

  Reach it from your phone at  http://<magicdns-name>:7777  over Tailscale. Keep it Tailscale-only.
EOF
