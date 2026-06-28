# lifeOS

A mobile-first **superapp** for the *capture-once / process-in-batches* workflow. One app does
the whole loop that used to be a skill + vault + cron glue:

- **Capture** — type, 🎤 dictate, or 📷 photograph anything into one inbox. Instant, no organizing.
- **Process** — one tap runs `claude -p "process inbox"` live in your vault: it reads photos with
  vision, files notes by area, pushes deadlines to **Google Calendar**, adds TODOs, `[[links]]`
  and `#tags`, and maintains the **MOC hub graph**. Output streams to the screen as it works.
- **Browse** — read your notes, see tasks grouped (Overdue / Today / Upcoming), and explore the
  interactive wikilink **graph** — all from your phone.

It is a thin, friendly front-end over your Obsidian vault. The **vault stays the source of
truth** (still opens in Obsidian, still syncs); lifeOS is a second way in.

## Run it

```bash
npm install
npm start
```

Then open the printed URLs:
- `http://localhost:7777` on this machine
- `http://<your-LAN-ip>:7777` **on your phone** (same WiFi). Add it to your home screen — it
  installs as a PWA (`Capture` works like a native app).

The first launch scaffolds a safe **test vault** at `./vault` so you can try the full loop without
touching your real notes.

## Going live on your real vault

Open **⚙ Settings** in the app and set **Vault path** to your Obsidian vault, e.g.
`/home/you/Documents/Obsidian Vault` — or edit `config.json`:

```json
{ "vaultPath": "/home/you/Documents/Obsidian Vault" }
```

lifeOS copies the `process-inbox` skill into the vault's `.claude/` on first use, so the headless
run can find it. Your existing notes are never overwritten — the skill only appends or creates.

## How processing works

The **Process** button spawns exactly the proven invocation (same as the old nightly job),
scoped to just the tools the task needs:

```
claude -p "<process-inbox prompt>" \
  --permission-mode acceptEdits \
  --allowedTools Edit Write Read Bash mcp__claude_ai_Google_Calendar__create_event
```

No API key — it reuses your existing Claude login and Google Calendar connector. The run is
tool-scoped on purpose: a captured photo could contain injected text, so it never gets blanket
permissions.

## Hosting on the always-on machine (e.g. Windows)

It's plain cross-platform Node — copy the folder over, `npm install`, `npm start`. Requirements
on the host:
- Node ≥ 20
- the `claude` CLI installed and logged in (set its path in Settings if not on `PATH`)
- access to the vault folder

To reach it from your phone over the internet (not just LAN), put it behind something like
Tailscale or a reverse proxy — don't expose port 7777 directly.

## Configuration (`config.json`)

| key | meaning |
|-----|---------|
| `vaultPath` | vault folder (relative paths resolve from the project root) |
| `claudePath` | path to the `claude` binary (default: `claude` on `PATH`) |
| `port` / `host` | server bind (default `7777` / `0.0.0.0` = LAN-reachable) |
| `timezone`, `languages`, `todoPath`, `todoFormat`, `ownerName` | written into the vault's `CLAUDE.md` house rules |

## Layout

```
server/
  index.js     Express API + SSE + static host
  vault.js     scaffold + inbox/notes/graph/tasks logic
  process.js   spawns & streams the claude run
  config.js    config load/save
  templates/   CLAUDE.md + process-inbox SKILL.md seeded into new vaults
public/        mobile-first PWA (vanilla JS, no build step)
vault/         the test vault (created on first run)
```

No build step, two dependencies (`express`, `multer`). Everything else is the standard library.
