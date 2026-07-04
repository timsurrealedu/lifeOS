// deploy/playground.config.cjs — the lifeOS code Playground. LINUX BOX ONLY (not the Windows laptop).
// Kept separate from ecosystem.config.cjs so it never runs / restart-loops on the dev machine.
//
//   bash deploy/playground-setup.sh                        # one-time install (see that file)
//   pm2 start deploy/playground.config.cjs && pm2 save  # run 24/7 + survive reboots
//
// Both bind 0.0.0.0 -> reachable ONLY over Tailscale, exactly like lifeOS on 7777.
//   :8888  JupyterLab  — protected by the password set during setup
//   :7681  ttyd+nvim   — a raw shell over the web; Tailscale is the only guard (add `-c user:pass` to args to layer basic auth)
const HOME = process.env.HOME || '/home/ubuntu';
module.exports = {
  apps: [
    {
      name: 'lifeOS-playground', // JupyterLab
      // pipx exposes `jupyter-lab` (not a bare `jupyter`); use the venv binary directly — its shebang
      // pins the right python, so PATH/reboot env doesn't matter.
      script: `${HOME}/.local/share/pipx/venvs/jupyterlab/bin/jupyter-lab`,
      args: `--no-browser --ip=0.0.0.0 --port=8888 --ServerApp.root_dir=${HOME}`,
      interpreter: 'none',
      cwd: HOME,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      time: true,
    },
    {
      name: 'lifeOS-editor', // LazyVim in the browser via ttyd -> persistent tmux (survives mobile disconnects)
      script: '/usr/local/bin/ttyd',
      args: '-W -p 7681 -i 0.0.0.0 tmux new -A -s main',
      interpreter: 'none',
      cwd: HOME,
      autorestart: true,
      watch: false,
      time: true,
    },
  ],
};
