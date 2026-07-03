---
name: process-inbox
description: Sort everything dumped into the vault's inbox.md — photos, dictated/typed notes, dates, and fleeting thoughts — into proper Obsidian notes, push deadlines/events to Google Calendar, add links/tags, then clear the inbox. Use when the user says "process inbox", "sort my inbox", "process my notes", or on a scheduled nightly run.
---
<!-- MANAGED FILE — this is the source of truth at server/templates/SKILL.md. ensureVault() copies
     it into each vault's .claude/skills/process-inbox/SKILL.md on server start (re-syncing when it
     differs), so edits here reach existing vaults. Don't hand-edit the copy inside a vault. -->
<!-- (Find is a plain local text search now — it does not run this or any skill.) -->

# Process Inbox

Turn the raw dump in `inbox.md` into an organized vault + up-to-date calendar.
Read `CLAUDE.md` in the vault root first — it defines this user's timezone, language(s),
folder structure, TODO format, and any **current term / active period** that new material
defaults into. Follow those, not any examples baked in here.

## Token economy (this run costs the user money — be lean)
Do the job fully, but don't waste reads/turns:
- **Search before you read.** Use `Grep` with specific terms (and scope to the relevant area folder)
  to find the few notes you need — don't `Read` whole folders or files you don't need.
- **Resolve the area with the cheapest signal first:** an explicit hint in the inbox line, then the
  filename, then a quick targeted grep — only skim note contents if those don't settle it.
- **Don't re-read** a file you already read this run; remember what you saw.
- **Read each image once.** Extract everything you need from a photo/handwriting in one pass.
- **Touch only what you must** — open a hub to add a link, don't re-read the whole vault to "check".
- Keep the **final summary to a few lines** (item count, calendar, notes created + their hubs,
  anything `#needs-filing`). No essays.

## 0. Lock (prevent double-processing across machines)
1. Check for `inbox.lock` in the vault root. If it exists and is newer than ~30 min, **stop** and tell the user another run may be in progress.
2. Otherwise create `inbox.lock` containing the current timestamp + machine hostname.
3. Always delete `inbox.lock` at the very end (even on early exit).

## 1. Read the inbox
- Read `inbox.md`. The capturable items are the bullet lines under `## Unprocessed`.
- If there's nothing but the empty `- ` placeholder, the inbox is empty — **skip §2–§4's item handling but still run §1b** to optimize any user-written drafts. If there are also no `#draft` notes, report "nothing to do" and stop (after releasing the lock).
- Copy the raw unprocessed text into `.inbox-archive/<YYYY-MM-DD>.md` (append if it exists) **before** changing anything — this is the safety net.

## 1b. Optimize user-written drafts (`#draft`)
Notes the user wrote in the app's own editor are saved tagged **`#draft`** (usually under `Drafts/`) — a **whole-note** draft. Appending to an *existing* note through the editor instead wraps just the newly-added text in a **partial-draft** marker pair: `<!-- #draft:start -->` … `<!-- #draft:end -->` (the note itself may have no other draft tag at all — everything outside the markers is pre-existing, already-settled content). On **every** run, find both kinds (e.g. grep the vault for `#draft`) and polish each in place:

**Whole-note drafts (`#draft` tag, no markers):**
- **Never remove or rewrite away the user's content.** This is *their* writing, not a slide to summarize. Keep every fact, sentence, list item, and their original language(s) — never translate, never delete, never editorialize. You may only **add** and **restructure**.
- Improve **formatting** toward the vault's writing style: clear headings, **bold** the key points, tidy bullet lists, fix obvious typos/spacing. Don't change meaning.
- Convert any **math to LaTeX** so it renders — inline `$…$`, display `$$…$$` (see "Math formatting").
- Add `[[wikilinks]]` to related notes and `#tags`, link it under the correct **MOC hub**, and add a `→ [[Hub]]` footer (see §3).
- If the note clearly belongs to a known area, you **may** move it out of `Drafts/` into that area's folder and update its links (per the filing rules); if unsure, leave it in place.
- When finished, **remove its `#draft` tag** so it isn't re-optimized on the next run.

**Partial drafts (`<!-- #draft:start -->…<!-- #draft:end -->` markers):**
- The note already exists and is presumably already filed/linked — **touch only the text between the markers.** Do not reformat, re-link, or otherwise edit anything outside them, even if it looks improvable; that's a separate concern for a separate run.
- Apply the same polish rules as above (formatting, LaTeX, typos) to *just* that span. Add a `[[wikilink]]` or `#tag` inside the marked span itself if it genuinely helps, but don't touch the note's existing links/footer/hub placement.
- When finished, **remove both marker comments**, leaving the polished text in place (unwrapped) exactly where it was.

List each optimized note (and which kind) in the report. If there are no `#draft` notes of either kind, skip this step.

## 2. Classify each item
Go line by line. An item is one of:

**A) Event / deadline / date** — contains a date, time, or scheduling words (exam, deadline, due, meeting, a day name, etc., in any of the user's languages).
  → Create a **Google Calendar** event using the timezone from `CLAUDE.md`. Use the stated time, or an all-day event if only a date is given. Title = the short description; extra detail → event description.
  → **Also** add a checkbox to the user's TODO file (format defined in `CLAUDE.md`). **Find the existing `TODO/` folder wherever it lives** (it may have been moved under a domain, e.g. `Personal/TODO/`) and write into that one — **never create a second `TODO/` at the root.** If the period/month file doesn't exist, create it inside the existing `TODO/`, add `→ [[TODO]]` at the bottom, and list it under the `[[TODO]]` hub.
  → **If the event names a known area** (per `CLAUDE.md`), also associate it with that area — see "Area keywords always win" in §3: a brief note in the area's folder **plus** a `[[link]]` under that area's hub.
  → Resolve relative dates against today's date from context.

**B) Media embed** — a line with `![[…]]` (photo, handwriting, audio, or document).
  *Photo* (`.jpg/.png/…`): Resolve and **read the image** (whiteboard/slide/screenshot). Summarize into clean notes following the vault's writing style from `CLAUDE.md`. If it's a screenshot of a chat mentioning a date, treat that date like case A instead.
  *Handwriting* (image embedded from `attachments/handwriting/`, tagged `#handwriting` — written in the app's ink canvas):
    → **Read the handwriting and turn it into a clean, readable note built as an OUTLINE** — a short H1 title, then the page's content as headings + bullet lists (key points, definitions, steps, formulas), not a flat wall of text. This is the user's own notes, not a slide to summarize: capture everything on the page, keep their structure, tidy spelling/legibility, don't editorialize. Preserve the original language(s); never translate.
    → **Format every bit of math as LaTeX so it renders** (see "Math formatting" below): inline `$…$`, display `$$…$$`. e.g. a hand-drawn integral becomes `$\int_0^1 x^2\,dx$`.
    → Infer the course/area exactly as for photos (rules below); file per-topic the same way.
    → **Keep the source page:** embed the original image with `![[…]]` under a **Handwritten source** heading at the bottom of the note, so the ink page is preserved next to its outline. (In the app the user can tap that image to expand and zoom it.)
  *Audio recording* (`.webm/.m4a/.mp3/.wav/.ogg`, usually tagged `#recording`, embedded from `attachments/recordings/`):
    → **Transcribe it first** via Bash using whatever local speech-to-text CLI is installed (try in order: `whisper-ctranslate2`, `whisper`, `whisper-cpp`, `faster-whisper`) on the embedded file. These write a transcript file (e.g. `--output_format txt`); read that. Preserve the spoken language(s); never translate.
    → Then summarize the transcript into a note like a lecture/meeting note (per-topic; apply area inference + the "Area keywords always win" rule; add MOC links). Keep the source: embed the audio with `![[…]]` under a **Recording** heading at the bottom of the note.
    → **If no transcription tool is available**, do not discard it — create the note (or a `Captures/` entry) that embeds the audio, tag it `#needs-transcription`, and say so in the report. Never fail the whole run over one audio file.
  *Document* (`.pdf/.docx/.pptx/.xlsx/.txt/.md/…`, usually tagged `#document`, embedded from `attachments/`):
    → **Read its text first.** PDFs: open with the `Read` tool (it reads PDF pages). Office files (`.docx/.pptx/.xlsx`) and others the Read tool can't parse: extract text via Bash using whatever's installed — try in order `pandoc <file> -t plain`, `pdftotext` (PDFs), `libreoffice --headless --convert-to txt`, or unzip + read the XML (`.docx`→`word/document.xml`, `.pptx`→`ppt/slides/*.xml`) — then read the extracted text.
    → Then summarize it into clean notes like a lecture/reading/slide deck: **one note per topic** (a long deck or paper usually splits into several), apply area inference + the "Area keywords always win" rule, format math as **LaTeX**, and add MOC links. This is reference material to digest, not the user's own words — summarize, don't transcribe verbatim.
    → **Keep the source:** embed the original file with `![[…]]` under a **Source document** heading at the bottom of each note it fed, so the file is preserved next to its summary. Preserve the original language(s); never translate.
    → **If no extraction tool works**, don't discard it — create a `Captures/` note that embeds the file, tag it `#needs-extraction`, and say so in the report. Never fail the whole run over one document.

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
  - **Subfolders are allowed and encouraged** to group related material — e.g. an exam's notes go in
    `University/<Course>/UAS/` (or `/UTS/`, `/Labs/`). Create the subfolder by just writing the note
    at that path. The subfolder is storage only; linking still happens in the **course** hub (§3).
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

### Math formatting — convert ALL math to LaTeX (do this aggressively)
Rendered math is far easier to read, so **actively rewrite any mathematical content as LaTeX** (the app
uses KaTeX) — inline `$…$` inside a sentence, display `$$…$$` for a standalone equation. This applies to
math from handwriting, a whiteboard/slide photo, dictation, **and plain typed text** (drafts + inbox
thoughts) — the user often just types the math in words or loose ASCII and expects you to format it.

**Translate natural-language and ASCII math into proper LaTeX.** Examples:
- "integral of x squared dx from 0 to 1" → `$\int_0^1 x^2\,dx$`
- "root of x" / "sqrt(x)" / "square root of x" → `$\sqrt{x}$`   ·   "nth root of x" → `$\sqrt[n]{x}$`
- "x^2" / "x squared" → `$x^2$`   ·   "x sub i" / "x_i" → `$x_i$`   ·   "e to the x" → `$e^{x}$`
- "sum of i from 1 to n" → `$\sum_{i=1}^{n}$`   ·   "product of …" → `$\prod$`
- "limit as x goes to 0" / "lim x->0" → `$\lim_{x\to 0}$`   ·   "derivative of f" / "df/dx" → `$\frac{df}{dx}$`
- "a over b" / "a/b" (a fraction) → `$\frac{a}{b}$`   ·   "pi", "theta", "alpha" → `$\pi$`, `$\theta$`, `$\alpha$`
- "<=", ">=", "!=", "->", "infinity", "+/-" → `$\le$`, `$\ge$`, `$\ne$`, `$\to$`, `$\infty$`, `$\pm$`
- Use the right commands: `\int \sum \prod \frac{}{} \sqrt{} \lim \partial \nabla \vec{} \hat{} \cdot \times` … and proper sub/superscripts.

**Never leave math as plain ASCII** like `integral of x dx`, `x^2`, `sqrt(x)`, or `a/b` sitting outside
`$…$`. Keep ordinary prose as normal Markdown, and do **not** turn plain numbers, dates, money (`$5`),
percentages, or version strings into math.

### Area keywords always win
If a captured item mentions a **known area** (the areas defined in `CLAUDE.md`, e.g. a club/org and its divisions, or a course), that is an **explicit hint** (highest priority) — always file/link it under that area regardless of item type (event, photo, or note): a note in the area's folder **and** a `[[link]]` under the area's hub. **Never** send an area-tagged item to `Captures/`.

### Maintain the MOC (Map of Content) hub hierarchy
Each area has a hub note **named exactly after the area** (so `[[Area Name]]` resolves to it) that
drives the graph view. Hubs can nest into a tree (see the structure described in `CLAUDE.md`),
e.g. `note → course hub → semester/parent hub → top-level hub`.

**Linking is not optional and not "for later" — do it for every note the moment you write it.**
The #1 failure on past runs was creating notes (e.g. a `Kisi-kisi`/overview note and per-topic
notes like *Turunan Numerik*) but leaving them **orphaned** — not listed in their hub. Do not let
that happen. For **each** note you create or update:

1. **Edit the hub note and add a `[[Note Name]]` bullet** under the right section. Append to the list;
   don't reorder existing entries. If the right section doesn't exist, add a `## ` heading.
   - **🚨 NEVER put a folder/path inside `[[ ]]`.** Links resolve by the note's **title only**; a `/`
     inside the brackets makes the link dangle (grey, orphaned). This is the most common bug — the part
     before any `|` MUST be the exact note filename without `.md` and without any folder prefix:
     ✅ `[[Session 2]]`, `[[Kisi-kisi UAS]]`, `[[19 des 2025|19 Des 2025]]` (alias OK) —
     ❌ `[[Kelas/Session 2|Session 2]]`, ❌ `[[UAS/Kisi-kisi UAS]]`, ❌ `[[RAJUM/19 des 2025]]`.
2. **Add a back-link footer** to the note itself: `→ [[Area Name]]` on its own last line.
3. **Repair the chain going up:** if a hub at any level is missing, create it (named exactly after
   that level), list its children in it, give it its own `→ [[Parent]]` footer, and add it under the
   parent hub. Top-level domain hubs have no parent.
4. A **subfolder does not change linking.** If you file topic notes under
   `University/<Course>/UAS/`, they are still listed in the **course** hub `[[<Course>]]` (the hub
   lives at the course level, not per-folder) — the folder is just storage, the hub is the graph.

**Worked example** — overview + per-topic notes for one course's exam:
```
University/Scientific Computing.md          ← the hub, named exactly "Scientific Computing"
  # Scientific Computing
  ## UAS
  - [[Kisi-kisi UAS]]
  - [[Turunan Numerik & Richardson]]
  - [[Integral Simpson]]
  - [[PDB Euler (RK1)]]
  → [[University]]

University/Scientific Computing/UAS/Turunan Numerik & Richardson.md
  # Turunan Numerik & Richardson
  …content…
  → [[Scientific Computing]]
```
Every per-topic note appears **both** as a `[[link]]` in the hub **and** carries a `→ [[hub]]`
footer. An overview/`Kisi-kisi` note is linked the same way — it is never left unlinked.

## 3b. Link audit (do this before clearing the inbox)
Before you log or clear anything, **verify every note you touched this run is wired into the graph** —
this is what was getting skipped:
1. Make a list of every note you created or updated.
2. For each, confirm **both**: (a) it has a `→ [[Hub]]` footer, and (b) its **exact title appears as a
   `[[link]]` in that hub note** (grep the hub for the title). If either is missing, fix it now.
3. **Grep every note you touched (and the hubs) for `[[` containing a `/`** — e.g. `grep -n "\[\[[^]]*/" <file>`.
   A slash inside a wikilink is always a bug: strip everything up to and including the last `/` so the
   target is the bare note title (keep any `|alias`). `[[Kelas/Session 2|Session 2]]` → `[[Session 2]]`.
4. Confirm each hub you linked into actually **exists as a file** (or you created it this run) so the
   links aren't dangling, and that every hub chains up to its top-level domain.
Only once every new note resolves up to a top-level hub — with no `/` inside any `[[link]]` — do you move on.

## 4. Log + clear
- Append a one-line summary per item to `Captures/Inbox Log.md` under a `## <YYYY-MM-DD>` heading.
  Each line should name the note(s) created **and the hub they were linked under**, so the log is
  auditable (e.g. `Turunan Numerik & Richardson → linked under [[Scientific Computing]] › UAS`).
- Reset `inbox.md` to its empty template (header + an empty `- ` under `## Unprocessed`).

## 5. Release lock + report
- Delete `inbox.lock`.
- Give a concise summary: item count, what went to the calendar, notes created/updated, and anything `#needs-filing`.

## Notes
- **Preserve the user's original language(s) — never translate.**
- Never overwrite an existing note; append or create.
- Calendar events use the user's connected Google account and work from any machine.
