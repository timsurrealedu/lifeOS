import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync,
  unlinkSync, rmSync, renameSync,
} from 'node:fs';
import { join, dirname, relative, sep, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, vaultDir } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(__dirname, 'templates');

const INBOX_EMPTY = `# 📥 Inbox

Dump anything here, fast. Don't organize — lifeOS sorts it later.
Text, dictated voice, or photos (\`![[image.jpg]]\`). One thing per line.

When processed, lines are moved out and this list is cleared.

---

## Unprocessed

-
`;

const IGNORE_DIRS = new Set(['.claude', '.inbox-archive', '.git', '.obsidian', 'node_modules', '.cache']);
// Infrastructure markdown that isn't a "note" (excluded from the notes list + graph).
const IGNORE_FILES = new Set(['CLAUDE.md', 'inbox.md']);

// Things the in-app delete must NEVER remove — they keep the system working.
const PROTECTED_FILES = new Set(['CLAUDE.md', 'inbox.md', 'inbox.lock']);
const RESERVED_DIRS = new Set([
  '.claude', '.git', '.obsidian', '.inbox-archive', 'node_modules', '.cache', 'attachments',
]);
// Content folders lifeOS scaffolds and depends on (Idea bank, tasks, drafts, reviews, inbox log,
// domain hubs). Matched by basename so a moved folder (e.g. Personal/TODO) stays protected. The UI
// marks these so the user doesn't delete them, and deleteFolder refuses them as a backstop.
export const SYSTEM_FOLDER_NAMES = [
  'Captures', 'University', 'Personal', 'Ideas', 'Drafts', 'Reviews', 'TODO',
];
const SYSTEM_FOLDERS = new Set(SYSTEM_FOLDER_NAMES);

/**
 * First folder with this basename **anywhere** under the vault (slash-joined relative path), or null.
 * Lets reads stay correct after the user moves a folder (e.g. `TODO/` → `Personal/TODO/`).
 */
function findDir(name, dir = vaultDir(), root = vaultDir()) {
  let entries;
  try { entries = readdirSync(dir); } catch { return null; }
  for (const n of entries) {
    if (IGNORE_DIRS.has(n) || n === 'attachments') continue;
    const full = join(dir, n);
    let st; try { st = statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (n === name) return relative(root, full).split(sep).join('/');
    const sub = findDir(name, full, root);
    if (sub) return sub;
  }
  return null;
}

/** Absolute path to a vault folder wherever it lives (falls back to the root location). */
function dirPath(name) {
  const rel = findDir(name);
  return rel ? join(vaultDir(), rel) : join(vaultDir(), name);
}

/** True if a note with this basename exists anywhere (so we don't re-scaffold a moved hub note). */
function noteExists(name) {
  const root = vaultDir();
  if (!existsSync(root)) return false;
  return walk(root, root, []).some((n) => n.name.toLowerCase() === name.toLowerCase());
}

/** Create the vault scaffold on first run (idempotent — never clobbers existing files). */
export function ensureVault(cfg = loadConfig()) {
  const root = vaultDir(cfg);
  mkdirSync(root, { recursive: true });
  // Infra dirs always live at the vault root (never moved).
  for (const d of ['.inbox-archive', 'attachments', join('attachments', 'recordings'),
    join('attachments', 'handwriting'), join('.claude', 'skills', 'process-inbox')]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  // Content/domain folders: only scaffold at root if they don't already exist *somewhere* — the user
  // may have moved them under a domain (e.g. Personal/TODO), and we must not duplicate them.
  for (const d of ['Captures', 'University', 'Personal', 'Ideas', 'Drafts', 'Reviews', 'TODO']) {
    if (!findDir(d, root, root)) mkdirSync(join(root, d), { recursive: true });
  }

  writeIfMissing(join(root, 'inbox.md'), INBOX_EMPTY);
  writeIfMissing(
    join(root, 'CLAUDE.md'),
    fill(readFileSync(join(TEMPLATES, 'CLAUDE.md'), 'utf8'), cfg),
  );
  // The skill the headless `claude -p` run will load. Re-sync it whenever the bundled copy
  // differs — it's a generated/managed file (not a user note), so engine updates (e.g. new
  // handwriting/math handling) reach existing vaults instead of being stuck at first-copy.
  const skillDst = join(root, '.claude', 'skills', 'process-inbox', 'SKILL.md');
  const skillSrc = join(TEMPLATES, 'SKILL.md');
  if (!existsSync(skillDst) || readFileSync(skillDst, 'utf8') !== readFileSync(skillSrc, 'utf8')) {
    copyFileSync(skillSrc, skillDst);
  }

  // Starter MOC hubs so the graph isn't empty and the skill has anchors to link into. Only create a
  // hub if a note of that name doesn't already exist anywhere (it may have been moved into a folder).
  const hub = (name, body) => { if (!noteExists(name)) writeIfMissing(join(root, `${name}.md`), body); };
  hub('University', '# University\n\nTop-level hub for courses and study material.\n\n## Areas\n\n');
  hub('Personal', '# Personal\n\nTop-level hub for life, journal and ideas.\n\n## Areas\n\n- [[TODO]]\n- [[Ideas]]\n');
  hub('TODO', '# TODO\n\nHub for monthly checklists.\n\n→ [[Personal]]\n\n## Months\n\n');
  hub('Ideas', '# Ideas\n\nHub for researched ideas. The **Research an idea** tool writes full notes here.\n\n→ [[Personal]]\n\n## Bank\n\n');
  hub('Home', '# Home\n\nDashboard MOC. Use **Refresh Home note** to regenerate this from the current vault.\n\n## Hubs\n\n- [[University]]\n- [[Personal]]\n- [[TODO]]\n- [[Ideas]]\n');
  hub('Welcome', '# Welcome to lifeOS\n\nCapture anything into the inbox; press **Process** and a Claude run files it into notes, '
    + 'Google Calendar, TODOs and the graph.\n\n#meta → [[Personal]]\n');
  return root;
}

function writeIfMissing(path, content) {
  if (!existsSync(path)) writeFileSync(path, content);
}

function fill(tpl, cfg) {
  return tpl
    .replaceAll('{{OWNER}}', cfg.ownerName)
    .replaceAll('{{TIMEZONE}}', cfg.timezone)
    .replaceAll('{{LANGUAGES}}', cfg.languages)
    .replaceAll('{{TODO_PATH}}', cfg.todoPath)
    .replaceAll('{{TODO_FORMAT}}', cfg.todoFormat);
}

// ---------- Inbox ----------

const UNPROCESSED_RE = /(^|\n)## Unprocessed\s*\n([\s\S]*?)(\n## |\n# |$)/;

export function readInboxItems() {
  const path = join(vaultDir(), 'inbox.md');
  if (!existsSync(path)) return [];
  const m = readFileSync(path, 'utf8').match(UNPROCESSED_RE);
  if (!m) return [];
  return m[2]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s?/, '').trim())
    .filter((l, i, arr) => l.length > 0 || (arr.length === 0))
    .filter((l) => l.length > 0);
}

function writeInboxItems(items) {
  const path = join(vaultDir(), 'inbox.md');
  let text = existsSync(path) ? readFileSync(path, 'utf8') : INBOX_EMPTY;
  const body = items.length
    ? items.map((i) => `- ${i}`).join('\n') + '\n'
    : '- \n';
  if (UNPROCESSED_RE.test(text)) {
    text = text.replace(UNPROCESSED_RE, (full, pre, _mid, post) =>
      `${pre}## Unprocessed\n\n${body}${post.startsWith('\n#') ? post : ''}`);
  } else {
    text = INBOX_EMPTY.replace('- \n', body);
  }
  writeFileSync(path, text);
}

export function addInboxItem(text) {
  const clean = String(text).replace(/\r/g, '').trim();
  if (!clean) throw new Error('empty item');
  const items = readInboxItems();
  // support multi-line paste → one item per non-empty line
  for (const line of clean.split('\n').map((l) => l.trim()).filter(Boolean)) items.push(line);
  writeInboxItems(items);
  return readInboxItems();
}

export function removeInboxItem(index) {
  const items = readInboxItems();
  if (index < 0 || index >= items.length) throw new Error('bad index');
  items.splice(index, 1);
  writeInboxItems(items);
  return readInboxItems();
}

export function addPhotoItem(filename, hint) {
  const embed = `![[${filename}]]`;
  return addInboxItem(hint ? `${hint} ${embed}` : embed);
}

export function addAudioItem(filename, hint) {
  const embed = `![[attachments/recordings/${filename}]]`;
  return addInboxItem([hint, embed, '#recording'].filter(Boolean).join(' '));
}

export function addHandwritingItem(filename, hint) {
  const embed = `![[attachments/handwriting/${filename}]]`;
  return addInboxItem([hint, embed, '#handwriting'].filter(Boolean).join(' '));
}

export function addDocumentItem(filename, hint) {
  const embed = `![[${filename}]]`;
  return addInboxItem([hint, embed, '#document'].filter(Boolean).join(' '));
}

// ---------- Notes ----------

function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name) || name === 'attachments') continue;
      walk(full, root, out);
    } else if (extname(name) === '.md' && !IGNORE_FILES.has(name)) {
      out.push({
        path: relative(root, full).split(sep).join('/'),
        name: basename(name, '.md'),
        size: st.size,
        mtime: st.mtimeMs,
      });
    }
  }
  return out;
}

/** Split a leading YAML frontmatter block (`---\n…\n---`) off the body. */
export function parseFrontmatter(text) {
  const m = String(text || '').match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: '', body: String(text || ''), matched: '' };
  return { fm: m[1], body: String(text).slice(m[0].length), matched: m[0] };
}
/** Tags declared in frontmatter — `tags: [a, b]`, `tags: a, b`, or a `- ` block list. */
function frontmatterTags(fm) {
  if (!fm) return [];
  const norm = (s) => String(s).trim().replace(/^["']|["']$/g, '').replace(/^#/, '');
  const out = [];
  const lines = fm.split('\n');
  let inTags = false;
  for (const line of lines) {
    const head = line.match(/^([ \t]*)([\w-]+):[ \t]*(.*)$/);
    if (head) {
      inTags = /^tags?$/i.test(head[2]);
      if (inTags && head[3].trim()) {
        let v = head[3].trim();
        if (v.startsWith('[')) v = v.replace(/^\[|\]$/g, '');
        v.split(',').map(norm).filter(Boolean).forEach((t) => out.push(t));
        inTags = false;
      }
      continue;
    }
    if (inTags) {
      const li = line.match(/^[ \t]*-[ \t]*(.+)$/);
      if (li) { const t = norm(li[1]); if (t) out.push(t); }
      else if (line.trim()) inTags = false;
    }
  }
  return out;
}

/** Pull tag names out of a note — frontmatter `tags:` plus inline `#tags` (skips code/headings). */
export function extractTags(text) {
  const { fm, body } = parseFrontmatter(text);
  const out = new Set(frontmatterTags(fm));
  const clean = body.replace(/```[\s\S]*?```/g, ''); // ignore code fences
  for (const line of clean.split('\n')) {
    if (/^#{1,6}\s/.test(line)) continue; // markdown heading, not a tag
    for (const m of line.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) out.add(m[1]);
  }
  return [...out];
}

export function listNotes() {
  const root = vaultDir();
  if (!existsSync(root)) return [];
  const notes = walk(root, root, []).sort((a, b) => b.mtime - a.mtime);
  // Attach each note's tags so the UI can search and display them (cheap for a personal vault).
  for (const n of notes) {
    try { n.tags = extractTags(readFileSync(join(root, n.path), 'utf8')); }
    catch { n.tags = []; }
  }
  return notes;
}

/** Notes living under the Ideas/ folder, newest first (the "Idea Bank"). */
export function listIdeas() {
  const root = vaultDir();
  const dir = dirPath('Ideas'); // wherever the Ideas/ folder lives
  if (!existsSync(dir)) return [];
  return walk(dir, root, []).sort((a, b) => b.mtime - a.mtime);
}

/** True if any note still carries a #draft tag (work for process-inbox to optimize). */
export function hasDrafts() {
  const root = vaultDir();
  if (!existsSync(root)) return false;
  return walk(root, root, [])
    .some((n) => /(^|\s)#draft\b/.test(readFileSync(join(root, n.path), 'utf8')));
}

/** Notes tagged #needs-filing — captures the process run parked without a home. */
export function listNeedsFiling() {
  const root = vaultDir();
  if (!existsSync(root)) return [];
  return walk(root, root, [])
    .filter((n) => /(^|\s)#needs-filing\b/.test(readFileSync(join(root, n.path), 'utf8')))
    .sort((a, b) => b.mtime - a.mtime);
}

export function readNote(relPath) {
  const root = vaultDir();
  const full = join(root, relPath);
  // path-traversal guard
  if (!full.startsWith(root) || !existsSync(full)) throw new Error('not found');
  return readFileSync(full, 'utf8');
}

// ---- inbox.lock (process-inbox's cross-machine guard) ----
// The skill is supposed to delete inbox.lock when it finishes, but a run that's force-stopped
// (max-turns kill, crash, server restart) skips that — orphaning the lock so the next run refuses
// to start. These give the server a backstop so a stuck lock never blocks processing.

/** Delete inbox.lock unconditionally. Called when a process-inbox run ends, however it ended. */
export function clearInboxLock() {
  const lock = join(vaultDir(), 'inbox.lock');
  try { if (existsSync(lock)) { unlinkSync(lock); return true; } } catch { /* noop */ }
  return false;
}

/** On boot, drop an inbox.lock older than `maxAgeMs` (default 30 min) — a run can't outlive that,
 *  so anything older is a leftover from a crash/restart. Recent locks are left alone in case a
 *  genuine run on another (Syncthing-synced) machine still holds it. Returns true if removed. */
export function clearStaleInboxLock(maxAgeMs = 30 * 60 * 1000) {
  const lock = join(vaultDir(), 'inbox.lock');
  try {
    if (!existsSync(lock)) return false;
    if (Date.now() - statSync(lock).mtimeMs < maxAgeMs) return false;
    unlinkSync(lock);
    return true;
  } catch { return false; }
}

/**
 * Create an (empty) folder, with subfolders via `/` (e.g.
 * `University/Scientific Computing/UAS`). Path-guarded and idempotent (mkdir recursive),
 * so it doubles as "ensure this nested path exists". Strips characters illegal in
 * filenames per segment. Returns the cleaned relative path.
 */
export function createFolder(relPath) {
  const root = vaultDir();
  const clean = String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/[<>:"|?*]/g, '').trim())
    .filter(Boolean)
    .join('/');
  if (!clean) throw new Error('folder name required');
  const dir = join(root, clean);
  if (!dir.startsWith(root)) throw new Error('bad folder'); // path-traversal guard
  mkdirSync(dir, { recursive: true });
  return clean;
}

/**
 * Plain-text search across the vault's notes — **no AI, no tokens.** Splits the query
 * into terms, ranks each note by how many terms hit (title matches weighted heavily),
 * and returns a snippet around the first body match. Powers the in-app "Find" tool.
 */
export function searchNotes(query, limit = 40) {
  const root = vaultDir();
  if (!existsSync(root)) return [];
  const terms = String(query || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!terms.length) return [];
  const out = [];
  for (const n of walk(root, root, [])) {
    const text = readFileSync(join(root, n.path), 'utf8');
    const hay = text.toLowerCase();
    const nameHay = n.name.toLowerCase();
    let score = 0, hits = 0;
    for (const t of terms) {
      if (nameHay.includes(t)) score += 5;
      const c = hay.split(t).length - 1;
      if (c > 0) { hits++; score += Math.min(c, 5); } // diminishing returns per term
    }
    if (score === 0) continue;
    score += hits * 2; // reward notes that match more distinct terms
    out.push({ ...n, score, snippet: makeSnippet(text, terms) });
  }
  out.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return out.slice(0, limit);
}

/** A ~180-char excerpt around the earliest matching term, for search result previews. */
function makeSnippet(text, terms) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const low = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, 160);
  const start = Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + flat.slice(start, start + 180).trim() + '…';
}

/** Every folder in the vault (relative, slash-joined) for the editor's folder picker. */
export function listFolders() {
  const root = vaultDir();
  if (!existsSync(root)) return [];
  const out = new Set();
  const recurse = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || IGNORE_DIRS.has(name) || name === 'attachments') continue;
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      out.add(relative(root, full).split(sep).join('/'));
      recurse(full);
    }
  };
  recurse(root);
  return [...out].sort();
}

/**
 * The MOC hub note for a folder: the note named like the folder (ignoring case/spaces/punct),
 * walking up to the nearest ancestor folder that has one, then falling back to a root-level hub
 * named after the top segment (e.g. `University.md` for `University/...`). Returns {name,path} or null.
 * Mirrors the implicit-MOC logic in buildGraph so the file edits match what the graph already implies.
 */
function findHubForFolder(notes, folderRel) {
  if (!folderRel) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hubByFolder = new Map();
  for (const n of notes) {
    const parts = n.path.split('/');
    if (parts.length < 2) continue;
    const folder = parts.slice(0, -1).join('/');
    if (norm(n.name) === norm(parts[parts.length - 2])) hubByFolder.set(folder, { name: n.name, path: n.path });
  }
  const segs = folderRel.split('/');
  for (let i = segs.length; i >= 1; i--) {
    const hit = hubByFolder.get(segs.slice(0, i).join('/'));
    if (hit) return hit;
  }
  // Top-level folder whose hub note lives at the vault root (e.g. University/ ↔ University.md).
  const rootHub = notes.find((n) => !n.path.includes('/') && norm(n.name) === norm(segs[0]));
  return rootHub ? { name: rootHub.name, path: rootHub.path } : null;
}

/**
 * Add `- [[title]]` to a hub note (idempotent). Inserts under an existing "…Notes" heading if the
 * hub has one, otherwise appends a managed `## Notes` section — always above a trailing `→ [[Parent]]`
 * footer so the hub's own backlink stays last. Returns true if it changed the file.
 */
function linkNoteInHub(hubPath, title) {
  const full = join(vaultDir(), hubPath);
  if (!existsSync(full)) return false;
  let text = readFileSync(full, 'utf8').replace(/\r/g, '');
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp('\\[\\[\\s*' + esc + '\\s*(?:\\||\\]\\])', 'i').test(text)) return false; // already linked
  const bullet = `- [[${title}]]`;

  // Peel a trailing "→ [[Hub]]" footer so the new link lands above it.
  let footer = '';
  const fm = text.match(/(?:^|\n)((?:→[^\n]*\n?)+)\s*$/);
  if (fm) { footer = fm[1].trim(); text = text.slice(0, fm.index); }
  text = text.replace(/\s+$/, '');

  const lines = text.split('\n');
  const hIdx = lines.findIndex((l) => /^#{2,6}\s.*\bnotes?\b/i.test(l));
  if (hIdx >= 0) {
    let insertAt = hIdx + 1;
    for (let j = hIdx + 1; j < lines.length; j++) {
      if (/^#{1,6}\s/.test(lines[j])) break;            // next heading ends the section
      if (lines[j].trim() !== '') insertAt = j + 1;     // place after the section's last content line
    }
    lines.splice(insertAt, 0, bullet);
    text = lines.join('\n');
  } else {
    text += `\n\n## Notes\n\n${bullet}`;
  }
  text += '\n' + (footer ? `\n${footer}\n` : '');
  writeFileSync(full, text);
  return true;
}

/** Give a freshly-created note a `→ [[Hub]]` footer (skips if it already has any such footer). */
function addHubFooter(fullPath, hubName) {
  let t = readFileSync(fullPath, 'utf8');
  if (/→\s*\[\[/.test(t)) return;
  writeFileSync(fullPath, t.replace(/\s+$/, '') + `\n\n→ [[${hubName}]]\n`);
}

/**
 * Deterministically link a new note into its folder's MOC hub — no AI, no tokens. Best-effort:
 * never let MOC bookkeeping fail note creation. Returns the hub note's name if it linked one.
 */
function autolinkHub(relPath, title) {
  try {
    const folderRel = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
    if (!folderRel) return null;
    const root = vaultDir();
    const hub = findHubForFolder(walk(root, root, []), folderRel);
    if (!hub || hub.name.toLowerCase() === title.toLowerCase()) return null; // no hub, or note IS the hub
    const linked = linkNoteInHub(hub.path, title);
    addHubFooter(join(root, relPath), hub.name);
    return linked ? hub.name : null;
  } catch { return null; }
}

/**
 * Write a user-authored note into the vault (the in-app "write your own note" editor).
 * Saved into `folder` (default `Drafts/`), tagged `#draft` so the next process-inbox run
 * optimizes it in place. Never overwrites — auto-suffixes the filename if it's taken.
 * If the folder has a MOC hub, the note is linked into it automatically (no AI). Returns
 * `{ path, hub }` where `hub` is the hub note it linked into (or null).
 */
export function createNote({ title, folder, content } = {}) {
  const root = vaultDir();
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('title required');

  const relFolder = String(folder || 'Drafts').trim().replace(/^[/\\]+|[/\\]+$/g, '') || 'Drafts';
  const dir = join(root, relFolder);
  if (!dir.startsWith(root)) throw new Error('bad folder'); // path-traversal guard
  mkdirSync(dir, { recursive: true });

  // Safe filename from the title; auto-suffix so we never clobber an existing note.
  const base = cleanTitle.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
  let name = base, full = join(dir, `${name}.md`), i = 2;
  while (existsSync(full)) { name = `${base} ${i++}`; full = join(dir, `${name}.md`); }

  let body = String(content || '').replace(/\r/g, '').trim();
  if (!/^#\s/.test(body)) body = `# ${cleanTitle}\n\n${body}`;       // ensure an H1
  if (!/(^|\s)#draft\b/.test(body)) body += '\n\n#draft';            // optimize-me marker
  writeFileSync(full, `${body}\n`);

  const relPath = relative(root, full).split(sep).join('/');
  const hub = autolinkHub(relPath, name); // link by the actual note name (handles collision suffixes); no AI
  return { path: relPath, hub };
}

/**
 * Overwrite an existing note with edited content (the in-app editor's "edit" mode).
 * Path-guarded and limited to existing `.md` files — this is a deliberate user save,
 * so overwriting the same file is the intent.
 */
/**
 * Insert an AI-generated overview `body` into a note at a contextual spot — strictly additive, the
 * existing content is never altered. `anchor` is the verbatim text of an existing heading to place
 * it after (its whole section), or `START` (top of the body, below any frontmatter + H1 title) or
 * `END`. An anchor that doesn't match falls back to END. Returns the note's new content.
 */
export function placeOverview(content, anchor, body) {
  const insert = String(body || '').replace(/\r/g, '').trim();
  if (!insert) return content;
  const lines = String(content).replace(/\r/g, '').split('\n');
  const level = (i) => { const m = /^(#{1,6})\s+/.exec(lines[i] || ''); return m ? m[1].length : 0; };
  const a = String(anchor || 'END').trim();

  let at; // index in `lines` to splice the block in at
  if (!a || /^end$/i.test(a)) {
    at = lines.length;
  } else if (/^start$/i.test(a)) {
    let i = 0;
    if (lines[0] && lines[0].trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; } // skip frontmatter
    while (i < lines.length && lines[i].trim() === '') i++;
    if (level(i) === 1) { i++; }                       // step past the H1 title so we land in the body
    at = i;
  } else {
    const norm = (s) => s.replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(a);
    let idx = lines.findIndex((l, i) => level(i) > 0 && norm(l) === target);
    if (idx < 0) idx = lines.findIndex((l) => l.trim() === a);       // exact-line fallback
    if (idx < 0) { at = lines.length; }                              // not found → end
    else { const lvl = level(idx); let j = idx + 1; while (j < lines.length && !(level(j) > 0 && level(j) <= lvl)) j++; at = j; }
  }

  const before = lines.slice(0, at);
  while (before.length && before[before.length - 1].trim() === '') before.pop();   // collapse trailing blanks
  const after = lines.slice(at);
  let k = 0; while (k < after.length && after[k].trim() === '') k++;               // drop leading blanks
  const out = [...before];
  if (before.length) out.push('');                       // one blank line before the block
  out.push(...insert.split('\n'));
  if (k < after.length) { out.push(''); out.push(...after.slice(k)); }             // one blank line after
  return out.join('\n').replace(/\s*$/, '') + '\n';
}

/** Read a note, insert the overview at the chosen anchor, write it back. Returns the new content. */
export function augmentNoteFile(relPath, anchor, body) {
  const content = readNote(relPath);
  const next = placeOverview(content, anchor, body);
  updateNote(relPath, next);
  return next;
}

export function updateNote(relPath, content) {
  const root = vaultDir();
  const full = join(root, String(relPath || ''));
  if (!full.startsWith(root) || extname(full) !== '.md' || !existsSync(full)) throw new Error('not found');
  const body = String(content).replace(/\r/g, '').replace(/\s*$/, '') + '\n';
  writeFileSync(full, body);
  return relative(root, full).split(sep).join('/');
}

/**
 * Rename a note (change its title). Renames the `.md` file to the new title within the same folder,
 * and — if the first line is an H1 matching the old title — rewrites that heading too, so the note's
 * displayed title and filename stay in sync. Path-guarded; auto-suffixes on collision. Wikilinks are
 * by title, so this can change what links resolve — that's the intended "rename" behaviour.
 * Returns the new relative path.
 */
export function renameNote(relPath, newTitle) {
  const root = vaultDir();
  const full = join(root, String(relPath || ''));
  if (!full.startsWith(root) || extname(full) !== '.md' || !existsSync(full)) throw new Error('not found');
  if (PROTECTED_FILES.has(basename(full)) || RESERVED_DIRS.has(topSegment(relPath))) {
    throw new Error('that file is protected');
  }
  const clean = String(newTitle || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('title required');
  const oldName = basename(full, '.md');
  const dir = dirname(full);

  // Sync the leading H1 if it still mirrors the old filename.
  let text = readFileSync(full, 'utf8');
  const lines = text.split('\n');
  if (lines.length && /^#\s/.test(lines[0]) && lines[0].replace(/^#\s+/, '').trim() === oldName) {
    lines[0] = `# ${clean}`;
    text = lines.join('\n');
  }

  // Same name (only casing/heading change) → just rewrite in place.
  if (clean === oldName) { writeFileSync(full, text); return relPath; }

  let target = join(dir, `${clean}.md`), i = 2;
  while (existsSync(target)) { target = join(dir, `${clean} ${i++}.md`); }
  writeFileSync(full, text);
  renameSync(full, target);
  return relative(root, target).split(sep).join('/');
}

/** Rename a folder in place (basename only). Guards reserved infra + lifeOS system folders; links are
 *  title-based so `[[wikilinks]]` survive. Collisions auto-suffix. Returns the new relative path. */
export function renameFolder(relPath, newName) {
  const root = vaultDir();
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean) throw new Error('bad folder');
  const dir = join(root, clean);
  if (!dir.startsWith(root) || dir === root) throw new Error('bad folder');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('not found');
  if (RESERVED_DIRS.has(topSegment(clean))) throw new Error('that folder is protected');
  if (SYSTEM_FOLDERS.has(basename(clean))) throw new Error('that folder is part of lifeOS and can\'t be renamed');
  const name = String(newName || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('name required');
  const parent = dirname(dir);
  let target = join(parent, name), i = 2;
  if (target === dir) return clean;
  while (existsSync(target)) { target = join(parent, `${name} ${i++}`); }
  renameSync(dir, target);
  return relative(root, target).split(sep).join('/');
}

/** First path segment (e.g. ".claude" from ".claude/skills/x.md"), for the reserved-dir guard. */
function topSegment(relPath) {
  return String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean)[0] || '';
}

/**
 * Delete a single note. Refuses anything that keeps the system running — the protected files
 * (`CLAUDE.md`, `inbox.md`, locks) and anything inside a reserved infra dir (`.claude`, attachments…).
 */
export function deleteNote(relPath) {
  const root = vaultDir();
  const full = join(root, String(relPath || ''));
  if (!full.startsWith(root) || extname(full) !== '.md' || !existsSync(full)) throw new Error('not found');
  if (PROTECTED_FILES.has(basename(full)) || RESERVED_DIRS.has(topSegment(relPath))) {
    throw new Error('that file is protected');
  }
  unlinkSync(full);
  return relative(root, full).split(sep).join('/');
}

/**
 * Delete a folder and everything under it. Refuses the vault root, reserved infra dirs, and (as a
 * safety net) any folder that still contains a protected file somewhere inside it.
 */
export function deleteFolder(relPath) {
  const root = vaultDir();
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean) throw new Error('bad folder');
  const dir = join(root, clean);
  if (!dir.startsWith(root) || dir === root) throw new Error('bad folder');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('not found');
  if (RESERVED_DIRS.has(topSegment(clean))) throw new Error('that folder is protected');
  if (SYSTEM_FOLDERS.has(basename(clean))) throw new Error('that folder is part of lifeOS and can\'t be deleted');
  // Don't let a delete take out a protected file that somehow lives under here.
  for (const n of walk(dir, root, [])) {
    if (PROTECTED_FILES.has(basename(n.path))) throw new Error('folder contains a protected file');
  }
  rmSync(dir, { recursive: true, force: true });
  return clean;
}

/**
 * Move a note or folder into `destFolder` (`''` = vault root). Used by drag-to-move and the auto-sort
 * apply step. Refuses protected files / reserved infra dirs (as src or dest), and won't drop a folder
 * into itself or a descendant. Collisions auto-suffix the basename so nothing is clobbered. Links are
 * by title, so a move never breaks `[[wikilinks]]`. Returns the new relative path.
 */
export function moveEntry(src, destFolder) {
  const root = vaultDir();
  const srcRel = String(src || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const destRel = String(destFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!srcRel) throw new Error('bad source');
  const srcAbs = join(root, srcRel);
  if (!srcAbs.startsWith(root) || srcAbs === root || !existsSync(srcAbs)) throw new Error('source not found');

  const name = basename(srcAbs);
  const isDir = statSync(srcAbs).isDirectory();
  // Guard the source: protected files, and reserved infra dirs (by their top segment).
  if (!isDir && PROTECTED_FILES.has(name)) throw new Error('that file is protected');
  if (RESERVED_DIRS.has(topSegment(srcRel))) throw new Error('that item is protected');

  const destAbs = destRel ? join(root, destRel) : root;
  if (!destAbs.startsWith(root)) throw new Error('bad destination');
  if (destRel && RESERVED_DIRS.has(topSegment(destRel))) throw new Error('destination is protected');
  // Can't move a folder into itself or one of its own descendants.
  if (isDir && (destAbs === srcAbs || (destAbs + sep).startsWith(srcAbs + sep))) {
    throw new Error("can't move a folder into itself");
  }
  if (join(srcAbs, '..') === destAbs) return srcRel; // already there → no-op

  mkdirSync(destAbs, { recursive: true });
  // Auto-suffix on collision so we never clobber an existing note/folder.
  const ext = isDir ? '' : extname(name);
  const base = isDir ? name : basename(name, ext);
  let target = join(destAbs, name), i = 2;
  while (existsSync(target)) { target = join(destAbs, `${base} ${i++}${ext}`); }
  renameSync(srcAbs, target);
  return relative(root, target).split(sep).join('/');
}

// ---------- Graph (wikilinks) ----------

export function buildGraph() {
  const root = vaultDir();
  if (!existsSync(root)) return { nodes: [], links: [] };
  const notes = walk(root, root, []);
  const idByName = new Map();
  for (const n of notes) idByName.set(n.name.toLowerCase(), n.name);

  // A folder's "hub" is the note sitting directly inside it whose name matches the folder name,
  // ignoring spaces/case/punctuation — so `…/ComputerNetwork/Computer Network.md` is the hub of the
  // `ComputerNetwork` folder, and `…/SEM2/SEM 2.md` is the hub of `SEM2`. Subfolders without such a
  // note (e.g. `Kelas/`, `UAS/`) simply have no hub and are skipped.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hubByFolder = new Map();
  for (const n of notes) {
    const parts = n.path.split('/');
    if (parts.length < 2) continue;
    const folder = parts.slice(0, -1).join('/');
    const folderName = parts[parts.length - 2];
    if (norm(n.name) === norm(folderName)) hubByFolder.set(folder, n.name);
  }

  const degree = new Map();
  const links = [];
  const seen = new Set();
  const addLink = (source, target, implicit = false) => {
    const key = source.toLowerCase() + '→' + target.toLowerCase();
    if (source.toLowerCase() === target.toLowerCase() || seen.has(key)) return;
    seen.add(key);
    links.push(implicit ? { source, target, implicit: true } : { source, target });
    degree.set(source, (degree.get(source) || 0) + 1);
    degree.set(target, (degree.get(target) || 0) + 1);
  };

  for (const n of notes) {
    const text = readFileSync(join(root, n.path), 'utf8');
    for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) addLink(n.name, m[1].trim());

    // Implicit MOC link: connect every note to the hub of its **nearest ancestor folder that has
    // one** — so a note appears under its course/area in the graph even when its own text has no
    // wikilinks (garbage content) or it was never listed in the hub. E.g. a note in
    // `BINUS/SEM2/ComputerNetwork/Kelas/Session 2.md` links to the `Computer Network` hub.
    const parts = n.path.split('/');
    for (let i = parts.length - 2; i >= 0; i--) {
      const hub = hubByFolder.get(parts.slice(0, i + 1).join('/'));
      if (hub && hub.toLowerCase() !== n.name.toLowerCase()) { addLink(n.name, hub, true); break; }
    }
  }
  // include link targets that have no file yet (dangling)
  const nodeNames = new Set(notes.map((n) => n.name));
  for (const l of links) { nodeNames.add(l.source); nodeNames.add(l.target); }

  const nodes = [...nodeNames].map((name) => ({
    id: name,
    degree: degree.get(name) || 0,
    exists: idByName.has(name.toLowerCase()),
  }));
  return { nodes, links };
}

// ---------- Calendar / TODOs ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse all checkbox lines from TODO/ files into structured tasks. */
export function listTasks() {
  const root = vaultDir();
  const todoDir = dirPath('TODO'); // wherever the TODO/ folder lives (e.g. Personal/TODO)
  const out = [];
  if (!existsSync(todoDir)) return out;
  const files = walk(todoDir, root, []);
  for (const f of files) {
    const lines = readFileSync(join(root, f.path), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
      if (!m) continue;
      const done = m[1].toLowerCase() === 'x';
      let desc = m[2].trim();
      // try to pull a "DD Mon" date prefix
      const dm = desc.match(/^(\d{1,2})\s+([A-Za-z]{3,})/);
      let date = null;
      if (dm) {
        const mon = MONTHS.findIndex((mo) => dm[2].toLowerCase().startsWith(mo.toLowerCase()));
        if (mon >= 0) {
          const year = (f.path.match(/(\d{4})/) || [])[1] || String(new Date().getFullYear());
          date = `${year}-${String(mon + 1).padStart(2, '0')}-${String(+dm[1]).padStart(2, '0')}`;
        }
      }
      // `line` lets the UI toggle the exact checkbox in its source file.
      out.push({ done, desc, date, file: f.path, line: i });
    }
  }
  out.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return out;
}

/** Flip a single checkbox `[ ]`↔`[x]` at file:line and write it back. */
export function toggleTask(relPath, line) {
  const root = vaultDir();
  const full = join(root, relPath);
  if (!full.startsWith(root) || extname(full) !== '.md' || !existsSync(full)) throw new Error('not found');
  const lines = readFileSync(full, 'utf8').split('\n');
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) throw new Error('bad line');
  const m = lines[line].match(/^(\s*-\s*\[)([ xX])(\].*)$/);
  if (!m) throw new Error('not a task line');
  lines[line] = m[1] + (m[2].toLowerCase() === 'x' ? ' ' : 'x') + m[3];
  writeFileSync(full, lines.join('\n'));
  return listTasks();
}

// ---------- Log ----------

export function readLog() {
  const path = join(dirPath('Captures'), 'Inbox Log.md'); // wherever Captures/ lives
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// ---------- Calendar cache ----------

/** Events pulled from Google Calendar by the `calsync` run (written to `.cache/calendar.json`). */
export function readCalendarCache() {
  const path = join(vaultDir(), '.cache', 'calendar.json');
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
  } catch { return []; }
}

/** Move proposal written by the `autosort` run (`.cache/autosort.json`). Validated: src must exist. */
export function readAutosortPlan() {
  const root = vaultDir();
  const path = join(root, '.cache', 'autosort.json');
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const arr = Array.isArray(data) ? data : (Array.isArray(data.moves) ? data.moves : []);
    return arr
      .filter((m) => m && typeof m.src === 'string' && typeof m.dest === 'string')
      .map((m) => ({ src: m.src.replace(/^\/+|\/+$/g, ''), dest: m.dest.replace(/^\/+|\/+$/g, ''), reason: m.reason || '' }))
      .filter((m) => m.src && existsSync(join(root, m.src)));
  } catch { return []; }
}
