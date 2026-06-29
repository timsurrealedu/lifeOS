# Vault House Rules

This is {{OWNER}}'s lifeOS vault. When working here (including headless `claude -p` runs
launched by the lifeOS app), follow these rules.

## Core principle
- **The vault is the permanent memory. Sessions are disposable.** Read what you need from files, do the work, write results back, end the session.
- Capture is separate from processing. `inbox.md` is the dump bucket; the `process-inbox` skill sorts it.

## Timezone & dates
- Timezone is **{{TIMEZONE}}**.
- Today's date is provided in context — use it to resolve relative dates ("next Tuesday").
- TODO file location: **{{TODO_PATH}}** (e.g. `TODO/2026/July.md`).
- TODO line format: **{{TODO_FORMAT}}**. Create the period file if missing.

## Language
- Notes may be written in: **{{LANGUAGES}}**.
- **Preserve the original language — never translate.**

## Vault structure
- `University/` — courses and study material, organized by `<Course>/` with class notes, labs, exams.
- `Personal/` — journal, ideas, life admin.
- `Ideas/` — researched ideas (one note each), written by the **Research an idea** tool; tag `#idea`, link [[Ideas]].
- `Reviews/` — weekly review notes, written by the **Weekly review** tool.
- `Captures/` — landing spot for items with no obvious home; tag `#needs-filing`.
- `TODO/` — monthly checklist files under the `[[TODO]]` hub.
- `attachments/` — captured images embedded as `![[name.jpg]]`.
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
- Every note links **up** the chain: note → area hub → … → domain hub.
- A monthly TODO file links up to a `[[TODO]]` hub (under the Personal domain).
- **Never mix one domain's notes into another's tree.**
- When adding a new level (area, sub-area, month), create its hub, link it to its parent, and list it under that parent.

## Writing style
- Casual and concise; **bold** the key points; use bulleted lists.
- Add `[[wikilinks]]` to related notes and `#tags`. Link liberally.
- **Math:** write maths as LaTeX so it renders (the app uses KaTeX) — inline `$…$`, display `$$…$$`. e.g. `$\int_0^1 x^2\,dx = \tfrac13$`. Never leave equations as plain ASCII.

## Connectors available (tied to the user's account, work from any machine)
- **Google Calendar** — events/deadlines.

## Safety
- Never overwrite an existing note's content — append or create a new note.
- Before destructive actions, look at the target first.
