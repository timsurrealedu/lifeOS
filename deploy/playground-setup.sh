#!/usr/bin/env bash
# deploy/playground-setup.sh — install the lifeOS code Playground on the Oracle A1 box.
#
# Run ONCE, on the box:   bash deploy/playground-setup.sh
# Then start it:          pm2 start deploy/playground.ecosystem.cjs && pm2 save
#
# Two tools, both reachable ONLY over Tailscale (like lifeOS on 7777):
#   Playground (JupyterLab, :8888) — Python + .ipynb real cell-by-cell kernel, Java (IJava), C (!gcc cell), + vim keys
#   Editor     (LazyVim in ttyd, :7681) — real Neovim/LazyVim in the browser; edit + compile/run C/Java/Python
# ponytail: JupyterLab IS the notebook kernel and ttyd+Neovim IS LazyVim — nothing hand-rolled, just install + run.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

echo "== apt: compilers, JDK, terminal, tools =="
# NOTE: ttyd + pipx are NOT in apt on Ubuntu 20.04 (focal) — installed separately below so this works
# on both focal and newer. apt-get install is atomic, so keep only packages that exist everywhere here.
sudo apt-get update -y
sudo apt-get install -y gcc default-jdk python3-pip python3-venv unzip curl git tmux ripgrep fd-find build-essential

echo "== pipx (via pip — focal has no apt pipx) =="
python3 -m pip install --user -U pipx
export PATH="$HOME/.local/bin:$PATH"

echo "== ttyd (static binary — not in apt on focal) =="
case "$(uname -m)" in
  aarch64|arm64) TTYD_ARCH=aarch64 ;;
  x86_64)        TTYD_ARCH=x86_64 ;;
  *) echo "unknown arch $(uname -m)"; exit 1 ;;
esac
sudo curl -fL -o /usr/local/bin/ttyd \
  "https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}"
sudo chmod +x /usr/local/bin/ttyd

# ---------------------------------------------------------------- JupyterLab (Playground, :8888)
echo "== JupyterLab + vim keybindings (isolated venv via pipx) =="
pipx ensurepath
pipx install jupyterlab || pipx upgrade jupyterlab
pipx inject jupyterlab jupyterlab-vim   # vim motions inside notebook cells

echo "== IJava kernel (Java cells) =="
IJAVA_VER=1.3.0
tmp="$(mktemp -d)"
curl -fL -o "$tmp/ijava.zip" \
  "https://github.com/SpencerPark/IJava/releases/download/v${IJAVA_VER}/ijava-${IJAVA_VER}.zip"
unzip -oq "$tmp/ijava.zip" -d "$tmp"
# Run install.py with JupyterLab's own venv python — it has jupyter_client; the system python doesn't.
# --user drops the kernelspec in ~/.local/share/jupyter, which JupyterLab searches regardless of venv.
"$HOME/.local/share/pipx/venvs/jupyterlab/bin/python" "$tmp/install.py" --user
rm -rf "$tmp"

echo
if [ -n "${JUPYTER_PASSWORD:-}" ]; then
  echo "== setting Jupyter password non-interactively (from \$JUPYTER_PASSWORD) =="
  JUPYTER_PASSWORD="$JUPYTER_PASSWORD" python3 - <<'PY'
import json, os
from jupyter_server.auth import passwd
cfgdir = os.path.expanduser("~/.jupyter"); os.makedirs(cfgdir, exist_ok=True)
path = os.path.join(cfgdir, "jupyter_server_config.json")
cfg = json.load(open(path)) if os.path.exists(path) else {}
cfg.setdefault("IdentityProvider", {})["hashed_password"] = passwd(os.environ["JUPYTER_PASSWORD"])
json.dump(cfg, open(path, "w"), indent=2)
print("wrote", path)
PY
else
  echo "== set a Jupyter password (you'll type it into the Playground once, then it's remembered) =="
  jupyter lab password
fi

# ---------------------------------------------------------------- Neovim + LazyVim (Editor, :7681)
echo "== Neovim (snap — distro/glibc-agnostic; apt's is too old for LazyVim, official tarball wants newer glibc than focal's) =="
sudo snap install nvim --classic
sudo ln -sf /snap/bin/nvim /usr/local/bin/nvim

echo "== LazyVim starter =="
if [ ! -d "$HOME/.config/nvim" ]; then
  git clone https://github.com/LazyVim/starter "$HOME/.config/nvim"
  rm -rf "$HOME/.config/nvim/.git"
fi
echo "== bootstrap plugins (headless, so first open is instant) =="
nvim --headless "+Lazy! sync" +qa || true

echo
echo "Done."
echo "  Start:  pm2 start deploy/playground.ecosystem.cjs && pm2 save"
echo "  Open:   the 'Playground' and 'Editor' tiles in lifeOS -> Discover  (or :8888 / :7681 over Tailscale)"
echo "  In LazyVim, enable C/Java/Python LSP+tools once:  run  :LazyExtras  -> toggle lang.clangd, lang.java, lang.python"
echo "  Compile/run inside nvim:  :!gcc % -o out && ./out   (or open a tmux split and use gcc/javac/python directly)"
