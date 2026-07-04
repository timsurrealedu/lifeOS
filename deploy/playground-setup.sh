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
sudo apt-get update -y
sudo apt-get install -y gcc default-jdk pipx unzip curl git ttyd tmux ripgrep fd-find build-essential

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
python3 "$tmp/install.py" --user
rm -rf "$tmp"

echo
echo "== set a Jupyter password (you'll type it into the Playground once, then it's remembered) =="
jupyter lab password

# ---------------------------------------------------------------- Neovim + LazyVim (Editor, :7681)
echo "== Neovim (official build — apt's is too old for LazyVim) =="
case "$(uname -m)" in
  aarch64|arm64) NVIM_ARCH=arm64 ;;
  x86_64)        NVIM_ARCH=x86_64 ;;
  *) echo "unknown arch $(uname -m)"; exit 1 ;;
esac
tmp="$(mktemp -d)"
curl -fL -o "$tmp/nvim.tar.gz" \
  "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-${NVIM_ARCH}.tar.gz"
sudo rm -rf /opt/nvim
sudo tar -C /opt -xzf "$tmp/nvim.tar.gz"
sudo ln -sf "/opt/nvim-linux-${NVIM_ARCH}/bin/nvim" /usr/local/bin/nvim
rm -rf "$tmp"

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
