---
name: process-inbox
description: Sort everything dumped into the vault's inbox.md — photos, dictated/typed notes, dates, and fleeting thoughts — into proper Obsidian notes, push deadlines/events to Google Calendar, add links/tags, then clear the inbox. Use when the user says "process inbox", "sort my inbox", "process my notes", or on a scheduled nightly run.
---
<!-- GENERATED COPY — do not edit here. Edit obsidianAutomation/skills/process-inbox/SKILL.md, then run sync-skill.sh. -->

# Process Inbox

Turn the raw dump in `inbox.md` into an organized vault + up-to-date calendar.
Read `CLAUDE.md` in the vault root first — it defines this user's timezone, language(s),
folder structure, TODO format, and any **current term / active period** that new material
defaults into. Follow those, not any examples baked in here.

## 0. Lock (prevent double-processing across machines)
1. Check for `inbox.lock` in the vault root. If it exists and is newer than ~30 min, **stop** and tell the user another run may be in progress.
2. Otherwise create `inbox.lock` containing the current timestamp + machine hostname.
3. Always delete `inbox.lock` at the very end (even on early exit).

## 1. Read the inbox
- Read `inbox.md`. The capturable items are the bullet lines under `## Unprocessed`.
- If there's nothing but the empty `- ` placeholder, report "inbox empty, nothing to do" and stop (after releasing the lock).
- Copy the raw unprocessed text into `.inbox-archive/<YYYY-MM-DD>.md` (append if it exists) **before** changing anything — this is the safety net.

## 2. Classify each item
Go line by line. An item is one of:

**A) Event / deadline / date** — contains a date, time, or scheduling words (exam, deadline, due, meeting, a day name, etc., in any of the user's languages).
  → Create a **Google Calendar** event using the timezone from `CLAUDE.md`. Use the stated time, or an all-day event if only a date is given. Title = the short description; extra detail → event description.
  → **Also** add a checkbox to the user's TODO file (path + format defined in `CLAUDE.md`). If the period/month file doesn't exist, create it, add `→ [[TODO]]` at the bottom, and list it under the `[[TODO]]` hub.
  → **If the event names a known area** (per `CLAUDE.md`), also associate it with that area — see "Area keywords always win" in §3: a brief note in the area's folder **plus** a `[[link]]` under that area's hub.
  → Resolve relative dates against today's date from context.

**B) Media embed** — a line with `![[…]]` (photo or audio).
  *Photo* (`.jpg/.png/…`): Resolve and **read the image** (whiteboard/slide/screenshot). Summarize into clean notes following the vault's writing style from `CLAUDE.md`. If it's a screenshot of a chat mentioning a date, treat that date like case A instead.
  *Audio recording* (`.webm/.m4a/.mp3/.wav/.ogg`, usually tagged `#recording`, embedded from `attachments/recordings/`):
    → **Transcribe it first** via Bash using whatever local speech-to-text CLI is installed (try in order: `whisper-ctranslate2`, `whisper`, `whisper-cpp`, `faster-whisper`) on the embedded file. These write a transcript file (e.g. `--output_format txt`); read that. Preserve the spoken language(s); never translate.
    → Then summarize the transcript into a note like a lecture/meeting note (per-topic; apply area inference + the "Area keywords always win" rule; add MOC links). Keep the source: embed the audio with `![[…]]` under a **Recording** heading at the bottom of the note.
    → **If no transcription tool is available**, do not discard it — create the note (or a `Captures/` entry) that embeds the audio, tag it `#needs-transcription`, and say so in the report. Never fail the whole run over one audio file.

  **Inferring which course/area a photo belongs to** (in order, stop at first confident match):
  1. **Explicit hint** — the same line or the line just above names/abbreviates an area. Trust it.
  2. **Visual content** — read text on the board/slide: a title, code, lecturer name, or footer.
  3. **Topic matching** — list the area folders in the vault, skim their recent notes, and match the subject to the area whose notes clearly cover this topic.
  4. **Recency tie-breaker** — if two areas fit, prefer the one with the most recently modified note.

  **Confidence rule:**
  - **Confident** → file into that area's notes folder (per the structure in `CLAUDE.md`) using the **per-topic convention** below. State *why* you chose it in the report.
  - **Unsure** → create `Captures/<YYYY-MM-DD> <short-title>.md`, tag `#needs-filing`, and note your best guess so the user fixes it in one move. Never guess into an area you're not confident about.
  - On a scheduled/automated run, same rule — infer when confident, fall back to `Captures/` when not; do not ask.

  **Note filing convention — ONE NOTE PER TOPIC:**
  - Split by **topic, not by photo or whole session.** Two topics in one class → two notes.
  - **If a note for this topic already exists** in the area, **append** to it (dated sub-heading) — don't duplicate.
  - **Filename:** `Session <N> — <Topic>.md` when the session/sequence number is clearly determinable; if ambiguous, **date-stamp instead**: `Session <YYYY-MM-DD> — <Topic>.md`. Never ask about the number — fall back to the date.
  - Inside: an H1 of the topic, summary in the vault style, footer `→ [[Area]]`. Add the note as a `[[link]]` in the area's MOC.
  - **Splitting is a judgment call.** Default to splitting clearly-distinct topics; keep borderline/related material together. **An explicit user instruction always wins** — if the inbox line or the live user says "keep this as one note", "these are one topic", or "split into X", obey that over auto-splitting.

**C) Thought / idea / note**
  → If actionable ("email X", "buy Y"), add to the TODO file (no date → an "## Undated" section).
  → If a keepable idea tied to a topic, append to the relevant note with a `[[link]]`, or create a short note in `Captures/`.
  → If vague/fleeting, append to `Captures/Fleeting.md` under today's date heading.

**D) Standing rule / config** — a line that sets an *ongoing* instruction rather than content to file. Triggers: starts with "set rule:", "from now on", "going forward", "until further notice", or otherwise tells you how to behave on future runs (e.g. advancing the current term/semester).
  → **Do not file or summarize it as a note**, and don't just obey it for this run and let it vanish when the inbox is cleared.
  → **Persist it into the vault `CLAUDE.md`:** if it changes an existing rule, edit that line; otherwise append it under a `## Standing rules` section (create the section if absent).
  → This is the **only** item type that edits `CLAUDE.md`. Report exactly what rule you set or changed.

When genuinely unsure where something goes:
- **On-demand run (user present):** ask the user.
- **Scheduled/automated run:** file into `Captures/` with `#needs-filing` and move on.

## 3. Enrich
- Add `[[wikilinks]]` to related notes and `#tags`. Link liberally; a link to a not-yet-existing note is fine.

### Area keywords always win
If a captured item mentions a **known area** (the areas defined in `CLAUDE.md`, e.g. a club/org and its divisions, or a course), that is an **explicit hint** (highest priority) — always file/link it under that area regardless of item type (event, photo, or note): a note in the area's folder **and** a `[[link]]` under the area's hub. **Never** send an area-tagged item to `Captures/`.

### Maintain the MOC (Map of Content) hub hierarchy
Each area has a hub note **named exactly after the area** (so `[[Area Name]]` resolves to it) that
drives the graph view. Hubs can nest into a tree (see the structure described in `CLAUDE.md`),
e.g. `note → course hub → semester/parent hub → top-level hub`. Whenever you create/update a note:
1. Add a `[[link]]` to it under the right section of its hub. Append, don't reorder.
2. Make the note link **back** to its hub (footer `→ [[Area Name]]`) so the graph clusters.
3. **Keep the chain intact going up:** if a hub at any level doesn't exist, create it (named after
   that level), link it down to its children and up to its parent (`→ [[Parent]]`), and list it
   under the parent hub. Top-level areas have no parent.
- Always link to hub *names*, never file paths, so links resolve to the hubs.

## 4. Log + clear
- Append a one-line summary per item to `Captures/Inbox Log.md` under a `## <YYYY-MM-DD>` heading.
- Reset `inbox.md` to its empty template (header + an empty `- ` under `## Unprocessed`).

## 5. Release lock + report
- Delete `inbox.lock`.
- Give a concise summary: item count, what went to the calendar, notes created/updated, and anything `#needs-filing`.

## Notes
- **Preserve the user's original language(s) — never translate.**
- Never overwrite an existing note; append or create.
- Calendar events use the user's connected Google account and work from any machine.
