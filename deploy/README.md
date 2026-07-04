# Running lifeOS on a free Oracle Cloud VM

This mirrors your Windows setup (Syncthing-synced vault + Tailscale + pm2 autostart) onto an
always-on Linux box, so capture / process / chat work 24/7 from your phone even when the PC is off.

> **Security:** the lifeOS server has **no login of its own** — it binds `0.0.0.0:7777` with full
> read/write/delete on the vault. Tailscale is the only thing protecting it. **Never** open port 7777
> publicly or use Tailscale Funnel without adding an auth layer first.

---

## 1. Create the Oracle Cloud Always Free VM

The **Ampere A1 (ARM)** instance is the host: genuinely free forever, up to 4 OCPU / 24 GB RAM. With
that much RAM the installer's swap step won't trigger (you don't need it).

> **Signup tip (you've confirmed this works):** keep **Tailscale OFF** during signup — a VPN/exit-node
> IP reads as "masking location" and triggers the rejection. Use a real debit/credit card with a
> billing address that matches the bank exactly. If you've had failed attempts, give it a day so the
> multi-account flag cools off.

1. After signup completes, pick a **Home Region close to you** — it's permanent and is where your free
   ARM capacity lives.
2. Console → **Compute → Instances → Create instance**.
   - **Image:** Canonical Ubuntu 24.04 (or 22.04).
   - **Shape:** *Change shape → Ampere → VM.Standard.A1.Flex*. Set **2 OCPU / 12 GB** (within the free
     4 OCPU / 24 GB ceiling; leaves headroom for a second instance later).
   - **Networking:** keep "Assign a public IPv4 address" — used once for setup, then access is via
     Tailscale.
   - **SSH keys:** "Generate a key pair for me" → **download the private key** (or paste your own
     public key).
   - Create, wait for **Running**, note the **public IP**.
   - *"Out of host capacity"?* Transient ARM scarcity — retry the create every few hours, or switch
     Availability Domain within the same region.

## 2. SSH in

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC_IP>
```

(Oracle's Ubuntu image logs you in as **`ubuntu`**, so the `/home/ubuntu/...` paths below are correct
as written.)

## 3. Get the code onto the box and run the installer

```bash
# Option A: clone from your GitHub remote
git clone <your-lifeOS-repo-url> ~/lifeOS && cd ~/lifeOS

# Option B: if the repo is private and not pushed, copy from your PC instead:
#   scp -i key -r "C:/Users/timsurreal/Documents/lifeOS" ubuntu@<PUBLIC_IP>:~/lifeOS

bash deploy/setup.sh
```

This installs Node 20, the `claude` CLI, Syncthing, Tailscale, pm2, and the doc tools. It does not
touch any secrets or open ports — those are the next steps.

## 4. Authenticate the `claude` CLI (rides your existing plan — no API bill)

```bash
claude            # prints a URL; open it in your laptop browser, approve, paste the code back
# verify:
claude -p "say hi" --model haiku
which claude      # note this absolute path for step 6
```

Auth persists in `~/.claude`, so pm2 runs use the same login.

## 5. Join Tailscale and Syncthing

```bash
sudo tailscale up           # opens a login URL; approve the device in the Tailscale admin console
tailscale ip -4             # your tailnet IP
tailscale status            # find this box's MagicDNS name (e.g. lifeos-vm.tailXXXX.ts.net)
```

Syncthing's web UI binds to `127.0.0.1:8384` on the VM, so reach it through an SSH tunnel from your
laptop:

```bash
ssh -i ~/Downloads/ssh-key-*.key -L 8384:localhost:8384 ubuntu@<PUBLIC_IP>
# then open http://localhost:8384 in your browser
```

In that UI:
- **Actions → Show ID**, copy this VM's device ID.
- On your Windows Syncthing, **Add Remote Device** → paste the VM's ID; on the VM accept the pairing.
- **Share the Obsidian vault folder** with the VM. On the VM, set its folder path to something like
  `/home/ubuntu/Obsidian Vault` and let it sync down. Wait until it shows **Up to Date**.

## 6. Configure and launch lifeOS

```bash
cd ~/lifeOS
cp config.linux.example.json config.json
nano config.json
#   "vaultPath"  -> the synced vault path, e.g. "/home/ubuntu/Obsidian Vault"
#   "claudePath" -> the absolute path from `which claude` (safest under pm2's minimal PATH)

pm2 start ecosystem.config.cjs
pm2 logs lifeOS            # confirm it prints "lifeOS running" with no claude/vault errors
pm2 save
pm2 startup               # prints a `sudo env PATH=... pm2 startup systemd -u ...` line — run it,
pm2 save                  # then save again so it resurrects on reboot
```

## 7. Open it from your phone

With Tailscale running on your phone, visit:

```
http://<vm-magicdns-name>:7777      e.g. http://lifeos-vm.tailXXXX.ts.net:7777
```

Because both devices are on your tailnet, nothing is exposed to the public internet. The vault stays
consistent everywhere — PC, Android, Arch, and this VM are all just Syncthing peers.

## 8. (Optional) Re-auth the Google Calendar MCP

The `calsync` / chat runs use the Google Calendar MCP. It's a **Claude.ai account connector**, so once
you've logged `claude` in with the same subscription it appears automatically — usually already
connected (`claude mcp list`). If it shows `! Needs authentication`, run `claude`, type `/mcp`, pick
Google Calendar, and authenticate via the printed URL. Until then, calendar features sit idle but
nothing else is affected.

## 9. Updating later — `git pull`, no re-setup

The environment (Node, the `claude` login, Tailscale, Syncthing, pm2) and your `config.json` all live
**outside git** (or are gitignored), so pulling new code never disturbs them. Once `~/lifeOS` is a git
checkout, every future change is just:

```bash
cd ~/lifeOS
git pull
npm install            # only if package.json changed
pm2 restart lifeOS     # also re-syncs the bundled process-inbox SKILL into the vault
```

`config.json` (your box paths) and the vault are gitignored, so they're preserved on every pull. You
**never** redo Tailscale / Syncthing / the claude login again.

**One-time conversion** (the box was deployed from a tarball, so it isn't a git repo yet):
```bash
cd ~/lifeOS
git init
git remote add origin git@github.com:timsurrealedu/lifeOS.git
git fetch origin
git reset --hard origin/main   # config.json, vault, node_modules are gitignored → untouched
npm install
pm2 restart lifeOS
```
This needs **GitHub auth on the box** for the private repo — either an SSH key on the box added to
GitHub (Settings → SSH keys, or a repo deploy key), or an HTTPS personal-access-token in the remote URL.

---

### Code Playground

Run/compile code from your phone or tablet. Two tools on the box, both reachable **only over Tailscale**
(same protection as lifeOS on 7777 — no sandbox, they run arbitrary code on your box, so never expose
the ports publicly):

- **Playground** — JupyterLab on **:8888**. Python + `.ipynb` real cell-by-cell kernel, Java (IJava
  kernel), C (a `%%writefile p.c` cell then `!gcc p.c -o p && ./p`). Vim keybindings inside cells. Password-protected.
- **Editor** — real **LazyVim** (Neovim) in the browser via `ttyd` on **:7681**. Edit + compile/run
  C/Java/Python with full vim keybindings, over a persistent `tmux` that survives mobile disconnects.

```bash
bash deploy/playground-setup.sh                        # one-time: JupyterLab+IJava+gcc+jdk + Neovim+LazyVim+ttyd
pm2 start deploy/playground.ecosystem.cjs && pm2 save  # run 24/7 + survive reboots
```

Open via the **Playground** / **Editor** tiles in lifeOS → Discover (or `http://<box>:8888` / `:7681`).
In LazyVim, enable language tooling once: `:LazyExtras` → toggle `lang.clangd`, `lang.java`, `lang.python`.
Compile inside nvim with `:!gcc % -o out && ./out`, or use a tmux split.

| Editor tips / gotchas | On a phone, a Bluetooth keyboard makes vim usable (soft keyboards lack Esc). Some LazyVim icons show as boxes unless the browser has a Nerd Font — cosmetic only. `:7681` gives a raw shell over the web; add `-c user:pass` to the ttyd args in `playground.ecosystem.cjs` to layer a login on top of Tailscale. |
| Can't reach `:8888` / `:7681` | Tailscale must be up. `pm2 status` should show `lifeOS-playground` and `lifeOS-editor` online. Do **not** open the ports publicly. |

---

### Troubleshooting

| Symptom | Fix |
|---|---|
| pm2 log: `Failed to launch claude` | Set `claudePath` to the absolute `which claude` path in `config.json`, `pm2 restart lifeOS`. |
| Runs fail right after reboot | `claude` auth or PATH not visible to systemd → absolute `claudePath` fixes both; confirm `~/.claude` exists. |
| Vault empty / notes missing | Syncthing folder not **Up to Date** yet, or `vaultPath` points at the wrong dir. |
| Can't reach `:7777` from phone | Tailscale not up on phone or VM; check `tailscale status` on both. Do **not** "fix" it by opening the port. |
| docx/pptx parked `#needs-extraction` | `pandoc` missing — `sudo apt-get install -y pandoc` (the installer does this already). |
