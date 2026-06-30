# lifeOS

A mobile-first **superapp** for the *capture-once / process-in-batches* workflow. One app does
the whole loop that used to be a skill + vault + cron glue:

- **Capture** — type, 🎤 dictate, 📸 take a photo (or 🖼️ attach one), ✍️ handwrite on an ink canvas,
  or 🔴 record audio into one inbox. Instant, no organizing. Items queue up; process the whole batch
  in one run.
- **Process** — one tap runs `claude -p "process inbox"` live in your vault: it reads photos with
  vision, **transcribes recordings**, files notes by area, pushes deadlines to **Google Calendar**,
  adds TODOs, `[[links]]` and `#tags`, and maintains the **MOC hub graph**. Output streams as it works.
- **Write** — author notes directly in an Obsidian-style editor: formatting toolbar, live
  Markdown/KaTeX preview, `[[wikilinks]]`, and an **✍️ ink canvas you can embed mid-note** (math by
  hand, practice problems). Edit any existing note in place. New notes are tagged `#draft` and get
  **auto-polished on the next Process run** — without ever deleting what you wrote.
- **Browse** — read your notes, create/delete folders and notes, and explore the interactive wikilink
  **graph** — all from your phone. The graph also **auto-links every note to its folder's MOC hub**
  (the note named after the folder), so a note shows up under its course/area even if its own text has
  no `[[links]]` yet — nothing floats disconnected.
- **Plan** — your tasks two ways: a **List** (grouped Overdue / Today / Upcoming, soonest deadline
  first) and a friendly **Calendar** month view built from your dated tasks. A **🔄 Sync** button pulls
  your real Google Calendar events in on demand; the connector that *creates* events during Process
  stays as-is.
- **Chat** — a read-only AI advisor with your whole vault (+ calendar) as context: "what should I
  focus on today?", "review today's diary", "how should I approach this assignment given the
  lecturer?". It reads and cites your notes but never changes them.
- **Discover** — a deck of tools over the vault: **Research an idea** (`claude -p` web-searches
  demand/competition/feasibility and writes a full note to `Ideas/`), **Find** (instant plain-text
  search across your notes — no AI, no tokens), the **Idea bank** (`Ideas/`), a **Needs filing** list
  (`#needs-filing`), plus **Weekly review** and **Refresh Home note**.

It is a thin, friendly front-end over your Obsidian vault. The **vault stays the source of
truth** (still opens in Obsidian, still syncs); lifeOS is a second way in. The processing brain —
the `process-inbox` skill — is the **obsidianAutomation** engine, vendored here (kept in sync via
that repo's `sync-skill.sh`); lifeOS is the capture/browse front-end over it.

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

## Write & edit notes

Capture is for fast dumps; the **note editor** is for sitting down and writing — class notes,
summaries, math practice. In the **Notes** tab tap **✎ New note**:

- **Title** + **folder** picker (autocompletes existing vault folders; defaults to `Drafts/`).
- A **formatting toolbar** (H1/H2, bold, italic, bullet/checkbox lists, quote, code, `[[wikilink]]`,
  math `$…$`, `==highlight==`) that wraps the current selection.
- **👁 Preview** toggle — renders Markdown + KaTeX exactly like the reader.
- **✍️ Handwrite** — opens the ink canvas *inside the editor*; on **Done** the drawing is stored in
  `attachments/handwriting/` and embedded at the cursor as `![[…]]`. Mix typed text, LaTeX and
  hand-drawn working in one note.

**Editing** — open any note and tap **✎ Edit** in the reader; saving overwrites that file in place
(never renames or moves it).

**Folders** — the Notes tab has a **📁 Folder** button to create folders and subfolders (type
`Parent/Child` to nest); empty folders show in the tree. The editor's folder picker also accepts a
nested path, so saving a note can create its folder on the fly.

**Deleting** — hover/tap the **✕** on any folder or note row in the Notes tree, or the **🗑** in the
reader, to delete it (with a confirm; folder delete is recursive). The files that keep the system
running are **refused server-side** and never get a delete button: `CLAUDE.md`, `inbox.md`, locks, and
the infra dirs `.claude/ .git/ .obsidian/ .inbox-archive/ .cache/ attachments/`.

**Moving (drag & drop)** — **long-press** a note or folder in the Notes tree to pick it up, then drag
it onto another folder (or drop on empty space = vault root) to move it. Works with touch and mouse.
Moves never break `[[wikilinks]]` (links resolve by title), and the graph's folder-hub links recompute
to the new home. Infra dirs are refused. Endpoint: `POST /api/move {src,dest}`.

**Auto-sort** — the **✨ Auto-sort** button runs a small AI pass that *proposes* tidying loose
top-level folders into their domain (e.g. `TODO/`, `stateofmymind/` → `Personal/`, matching the MOC),
writing the plan to `.cache/autosort.json`. You get a **preview**; **Apply** performs the moves
server-side (instant, no tokens, reversible by dragging back). lifeOS reads (`TODO`, `Ideas`,
`Captures`) are **location-independent**, so a reorg never breaks Plan/Calendar or spawns duplicates.
Endpoints: `GET /api/autosort/stream` (propose), `GET /api/autosort/plan`, `POST /api/move/batch` (apply).

**Auto-polish (`#draft`).** New notes are saved tagged `#draft`. On the next **Process** run the
engine optimizes each draft *in place* — formatting, LaTeX, `[[links]]`, `#tags`, MOC-hub wiring,
and an optional move into the right folder — but it **only adds/restructures and never removes your
content**, then drops the `#draft` tag. This step runs even when the inbox is empty, so
"write a note → Process" is a complete loop. Delete the `#draft` tag to opt a note out.

Endpoints behind this: `POST /api/notes` (create), `POST /api/note/save` (edit),
`DELETE /api/note` / `DELETE /api/folder` (delete, guarded), `GET /api/folders` (picker) /
`POST /api/folders` (create folder), `GET /api/search` (plain-text Find),
`POST /api/upload/handwriting` (embed a drawing, no inbox item). Chat: `POST /api/chat` (streams a
read-only answer). Calendar: `GET /api/calendar` (cached events) / `GET /api/calsync/stream` (pull from
Google Calendar into `.cache/calendar.json`).

## Recordings & transcription

🔴 **Record** captures audio (lecture/meeting) to `attachments/recordings/` and drops a
`![[…]] #recording` line in the inbox. On the next **Process** run the engine transcribes it with
a local speech-to-text CLI (tries `whisper-ctranslate2`, `whisper`, `whisper-cpp`,
`faster-whisper`), then summarizes the transcript into a note and keeps the audio as the source.
Fully local — no audio leaves the machine. If no transcriber is installed it degrades gracefully:
the note embeds the audio and is tagged `#needs-transcription`.

Install one (recommended, light, CPU-friendly):

```bash
pipx install whisper-ctranslate2
```

## Handwriting & math

✍️ **Write** opens a full-screen **infinite canvas** for handwriting and sketching — pan & zoom
(pinch / wheel / hand tool), pen in several **colours and sizes**, an **object eraser**, a **ruler**
(straight lines that snap to clean horizontals / verticals / 45°), **shapes** (rectangle, ellipse,
arrow), and undo / redo. It's vector under the hood, so strokes stay crisp at any zoom.

The same canvas is reachable two ways:
- **Capture tab → ✍️ Write:** on **Done** the drawing is cropped to a PNG in
  `attachments/handwriting/` and dropped in the inbox tagged `#handwriting`. On the next **Process**
  run the engine *reads the handwriting with vision and transcribes it into a clean typed note*
  (your spelling tidied, never translated), keeping the original ink page embedded under a
  **Handwritten source** heading.
- **Note editor → ✍️ button:** the drawing is embedded directly into the note you're writing as
  `![[…]]` (no inbox round-trip, no auto-transcription) — for keeping math working or practice
  problems as ink alongside typed text.

Any math — from handwriting, a whiteboard/slide photo, or typed/dictated text — is written as
**LaTeX** (`$…$` inline, `$$…$$` display), so notes render real symbols: integrals, fractions,
`x_i`, Greek letters, etc. The reader renders it with **KaTeX**, vendored offline under
`public/vendor/katex/` (no CDN, no new npm dependency). A hand-drawn `∫₀¹ x² dx` comes back as
$\int_0^1 x^2\,dx$.

The `process-inbox` skill is the brain for both. It's a managed file: lifeOS now re-syncs it into
your vault's `.claude/` whenever the bundled copy changes, so engine updates like this reach
existing vaults automatically (it only overwrites that one generated skill file — never your notes).

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
| `models` | per-task model so cheap runs don't burn a premium one: `{ "process": "sonnet", "research": "sonnet", "review": "haiku", "home": "haiku" }`. Omit a key → CLI default. |
| `maxTurns` | cap on agent turns per run (runaway-loop guard, default `40`; `0` = no cap) |
| `qwen` / `gemini` / `fallback` | the fallback chain (in order) used **only** when the primary run hits a usage/rate limit. Empty `apiKey` = that link disabled. See **Fallback chain** below. |

### Token efficiency

The app keeps `claude -p` token spend down several ways:
- **Find is AI-free** — plain server-side text search (`/api/search`), no run at all.
- **Skip-when-idle** — pressing *Process* with an empty inbox and no `#draft` notes returns instantly
  without spawning a run (saves a whole run on idle nightly schedules).
- **Per-task models** — Weekly Review / Refresh Home default to Haiku, Process / Research to Sonnet
  (see `models` above).
- **Photo downscale** — captures are resized to ~1568px before upload, cutting vision tokens.
- **`maxTurns`** caps worst-case loops; the `process-inbox` skill is told to grep before reading,
  avoid re-reads, and keep summaries short.

### Fallback chain (Qwen → Gemini → DeepSeek)

When a primary `claude` run dies with a usage/rate-limit error, lifeOS automatically retries the
same prompt down a chain of fallback providers, in priority order, and notes which one answered in
the run log. Configure them in **⚙ Settings → Fallback AI** (or in `config.json`). Leave any link's
`apiKey` empty to skip it.

1. **Qwen** (Alibaba DashScope) — Anthropic-compatible, drives the same `claude` CLI + skills, so it
   covers **every** AI feature including write jobs (capture / Process inbox, Research, etc.).
2. **Gemini** (Google AI Studio) — REST-only, so it covers the **read-only** features (vault chat,
   per-note tutor, ➕ Add to note) but **not** write jobs. On a write job it's skipped and the chain
   there is Qwen → DeepSeek.
3. **DeepSeek / GLM** — Anthropic-compatible like Qwen, so it also covers every feature, write jobs
   included.

```jsonc
// 1. Qwen (Alibaba DashScope)
"qwen":     { "baseUrl": "https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy", "apiKey": "sk-…", "model": "qwen3-coder-plus" }
// 2. Gemini (Google AI Studio — free key at aistudio.google.com/apikey)
"gemini":   { "apiKey": "AIza…", "model": "gemini-2.5-flash" }
// 3a. DeepSeek (V4 native ids: deepseek-v4-pro = strongest, deepseek-v4-flash = cheap/fast)
"fallback": { "baseUrl": "https://api.deepseek.com/anthropic", "apiKey": "sk-…", "model": "deepseek-v4-pro" }
// 3b. GLM (Z.ai) — alternative for the `fallback` slot
"fallback": { "baseUrl": "https://api.z.ai/api/anthropic",     "apiKey": "…",    "model": "glm-4.6" }
```

`config.json` is gitignored, so the keys stay local. Tool-use quality on these providers is below
Claude — treat the chain as a safety net, not the default path.

## Layout

```
server/
  index.js     Express API + SSE + static host
  vault.js     scaffold + inbox/notes/graph/tasks logic
  process.js   spawns & streams claude runs (process / research / review / home / chat / calsync / autosort)
  config.js    config load/save
  templates/   CLAUDE.md + process-inbox SKILL.md seeded into new vaults
public/        mobile-first PWA (vanilla JS, no build step)
vault/         the test vault (created on first run)
```

No build step, three small dependencies (`express`, `multer`, `cross-spawn` — the last only so the
`claude` CLI launches correctly on Windows). Everything else is the standard library.
