import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync,
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

const IGNORE_DIRS = new Set(['.claude', '.inbox-archive', '.git', '.obsidian', 'node_modules']);
// Infrastructure markdown that isn't a "note" (excluded from the notes list + graph).
const IGNORE_FILES = new Set(['CLAUDE.md', 'inbox.md']);

/** Create the vault scaffold on first run (idempotent — never clobbers existing files). */
export function ensureVault(cfg = loadConfig()) {
  const root = vaultDir(cfg);
  mkdirSync(root, { recursive: true });
  for (const d of ['Captures', '.inbox-archive', 'attachments', join('attachments', 'recordings'),
    'University', 'Personal', 'Ideas', 'Reviews', 'TODO', join('.claude', 'skills', 'process-inbox')]) {
    mkdirSync(join(root, d), { recursive: true });
  }

  writeIfMissing(join(root, 'inbox.md'), INBOX_EMPTY);
  writeIfMissing(
    join(root, 'CLAUDE.md'),
    fill(readFileSync(join(TEMPLATES, 'CLAUDE.md'), 'utf8'), cfg),
  );
  // The skill the headless `claude -p` run will load.
  const skillDst = join(root, '.claude', 'skills', 'process-inbox', 'SKILL.md');
  if (!existsSync(skillDst)) copyFileSync(join(TEMPLATES, 'SKILL.md'), skillDst);

  // Starter MOC hubs so the graph isn't empty and the skill has anchors to link into.
  writeIfMissing(join(root, 'University.md'),
    '# University\n\nTop-level hub for courses and study material.\n\n## Areas\n\n');
  writeIfMissing(join(root, 'Personal.md'),
    '# Personal\n\nTop-level hub for life, journal and ideas.\n\n## Areas\n\n- [[TODO]]\n- [[Ideas]]\n');
  writeIfMissing(join(root, 'TODO.md'),
    '# TODO\n\nHub for monthly checklists.\n\n→ [[Personal]]\n\n## Months\n\n');
  writeIfMissing(join(root, 'Ideas.md'),
    '# Ideas\n\nHub for researched ideas. The **Research an idea** tool writes full notes here.\n\n→ [[Personal]]\n\n## Bank\n\n');
  writeIfMissing(join(root, 'Home.md'),
    '# Home\n\nDashboard MOC. Use **Refresh Home note** to regenerate this from the current vault.\n\n## Hubs\n\n- [[University]]\n- [[Personal]]\n- [[TODO]]\n- [[Ideas]]\n');
  writeIfMissing(join(root, 'Welcome.md'),
    '# Welcome to lifeOS\n\nCapture anything into the inbox; press **Process** and a Claude run files it into notes, '
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

export function listNotes() {
  const root = vaultDir();
  if (!existsSync(root)) return [];
  return walk(root, root, []).sort((a, b) => b.mtime - a.mtime);
}

/** Notes living under the Ideas/ folder, newest first (the "Idea Bank"). */
export function listIdeas() {
  const root = vaultDir();
  const dir = join(root, 'Ideas');
  if (!existsSync(dir)) return [];
  return walk(dir, root, []).sort((a, b) => b.mtime - a.mtime);
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

// ---------- Graph (wikilinks) ----------

export function buildGraph() {
  const root = vaultDir();
  if (!existsSync(root)) return { nodes: [], links: [] };
  const notes = walk(root, root, []);
  const idByName = new Map();
  for (const n of notes) idByName.set(n.name.toLowerCase(), n.name);

  const degree = new Map();
  const links = [];
  const seen = new Set();
  for (const n of notes) {
    const text = readFileSync(join(root, n.path), 'utf8');
    const matches = text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g);
    for (const m of matches) {
      const target = m[1].trim();
      const key = n.name.toLowerCase() + '→' + target.toLowerCase();
      if (target.toLowerCase() === n.name.toLowerCase() || seen.has(key)) continue;
      seen.add(key);
      links.push({ source: n.name, target });
      degree.set(n.name, (degree.get(n.name) || 0) + 1);
      degree.set(target, (degree.get(target) || 0) + 1);
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
  const todoDir = join(root, 'TODO');
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
  const path = join(vaultDir(), 'Captures', 'Inbox Log.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
