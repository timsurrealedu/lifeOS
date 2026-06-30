# Vault House Rules

This is {{OWNER}}'s lifeOS vault. When working here (including headless `claude -p` runs
launched by the lifeOS app), follow these rules.

## Core principle
- **The vault is the permanent memory. Sessions are disposable.** Read what you need from files, do the work, write results back, end the session.
- Capture is separate from processing. `inbox.md` is the dump bucket; the `process-inbox` skill sorts it.
- **Be economical with tokens.** Each run costs real money — search with `Grep` before reading, read
  only the files you need, don't re-read, read each image once, and keep summaries short.

## Timezone & dates
- Timezone is **{{TIMEZONE}}**.
- Today's date is provided in context — use it to resolve relative dates ("next Tuesday").
- TODO file location: **{{TODO_PATH}}** (e.g. `TODO/2026/July.md`).
- TODO line format: **{{TODO_FORMAT}}**. Create the period file if missing.

## Language
- Notes may be written in: **{{LANGUAGES}}**.
- **Preserve the original language — never translate.**

## Vault structure
- `University/` — courses and study material, organized by `<Course>/`. **Use subfolders** to group
  related material, e.g. `University/<Course>/UAS/`, `/UTS/`, `/Labs/`. Subfolders are storage only;
  the graph link still goes in the course's hub note (see MOC rules below). You can nest folders
  freely — both this `claude -p` run and the app's "📁 Folder" button create them.
- `Personal/` — journal, ideas, life admin.
- `Ideas/` — researched ideas (one note each), written by the **Research an idea** tool; tag `#idea`, link [[Ideas]].
- `Drafts/` — notes the user wrote in the app's editor, tagged `#draft`; the next process run optimizes them in place (formatting/links/LaTeX) **without removing their content**, then drops the tag.
- `Reviews/` — weekly review notes, written by the **Weekly review** tool.
- `Captures/` — landing spot for items with no obvious home; tag `#needs-filing`.
- `TODO/` — monthly checklist files under the `[[TODO]]` hub.
- `attachments/` — captured images embedded as `![[name.jpg]]`.

> **Folders may be reorganized.** The user can drag folders or run **Auto-sort**, so `TODO/`,
> `Ideas/`, `Captures/` (etc.) may live **under a domain folder** (e.g. `Personal/TODO/`). Always
> **find the existing folder wherever it is — never create a second copy at the root.** A domain's
> hub note lives **inside** that domain's folder.
- `.inbox-archive/` — raw copies of processed inbox text (safety net).

### MOC hub hierarchy (drives the graph)
Each area has a **MOC hub note named exactly after it** (so `[[Area Name]]` resolves to it).
Group hubs into **separate top-level domains so unrelated spheres of life don't tangle** in the
graph:

```
[[University]]                         [[Personal]]
├── [[<Course>]] ...                   ├── [[TODO]] → [[<Month>]] ...
                                       └── journal, ideas, config
```

Rules:
- **Every note must be listed as a `[[link]]` in its hub, and carry a `→ [[Hub]]` footer.** A note
  that exists but isn't linked in its hub is a bug — orphans don't show in the graph. Link the moment
  you create the note, not "later".
- **🚨 Wikilink format — NEVER put a folder/path inside `[[ ]]`.** Links resolve by the note's **title
  only**; any `/` inside the brackets makes the link dangle (grey, orphaned). This is the #1 mistake:
  - ✅ `[[Limits]]` · ❌ `[[UAS/Limits|Limits]]` · ❌ `[[Calc/UAS/Limits]]`
  - The part before any `|` MUST be the exact note filename (without `.md`), with **no folder prefix**.
    An alias after `|` is fine for display, but the target is always just the title.
  - A note's folder is irrelevant to linking — `University/Calc/UAS/Limits.md` → `[[Limits]]`. The
    **subfolder doesn't get its own hub**; the course hub lists every note under it.
  - Before finishing, re-read every `[[link]]` you wrote and confirm none contains a `/`.
- **🚨 Note titles must avoid the characters `[` `]` `|` `#` `/` `\`** — they break wikilink parsing or
  file paths, so a note titled with them can never be linked or opened. When a topic name needs a
  connector, **write the word `and` instead of `&`** (e.g. `Turunan Numerik and Richardson Extrapolation`,
  not `Turunan Numerik & Richardson Extrapolation`). Keep titles to letters, numbers, spaces, and `-` `_`.
  If you find an existing note whose title contains one of these, rename it (and update its `[[links]]`).
- Every note links **up** the chain: note → area hub → … → domain hub.
- A monthly TODO file links up to a `[[TODO]]` hub (under the Personal domain).
- **Never mix one domain's notes into another's tree.**
- When adding a new level (area, sub-area, month), create its hub, link it to its parent, and list it under that parent.

## Writing style
- Casual and concise; **bold** the key points; use bulleted lists.
- Add `[[wikilinks]]` to related notes and `#tags`. Link liberally.
- **Math:** write maths as LaTeX so it renders (the app uses KaTeX) — inline `$…$`, display `$$…$$`. e.g. `$\int_0^1 x^2\,dx = \tfrac13$`. **Actively convert natural-language / ASCII math** the user typed ("integral of", "root of", "x^2", "a/b", "lim x->0") into LaTeX — never leave equations as plain ASCII.

## Connectors available (tied to the user's account, work from any machine)
- **Google Calendar** — events/deadlines.

## Safety
- Never overwrite an existing note's content — append or create a new note.
- Before destructive actions, look at the target first.
