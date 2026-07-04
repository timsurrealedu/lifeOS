import express from 'express';
import multer from 'multer';
import { join, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { loadConfig, saveConfig, vaultDir, checkDocTools, PROJECT_ROOT } from './config.js';
import {
  ensureVault, readInboxItems, addInboxItem, removeInboxItem, addPhotoItem, addAudioItem,
  addHandwritingItem, addDocumentItem, listNotes, readNote, createNote, updateNote, renameNote, deleteNote, deleteFolder,
  moveEntry, listFolders, createFolder, renameFolder, SYSTEM_FOLDER_NAMES, STAGING_FOLDER_NAMES, searchNotes, buildGraph, listTasks, toggleTask, editTask, readLog,
  listIdeas, listNeedsFiling, hasDrafts, readCalendarCache, readAutosortPlan, augmentNoteFile,
  clearInboxLock, clearStaleInboxLock,
} from './vault.js';
import {
  runProcessInbox, runResearch, runWeeklyReview, runRefreshHome, runChat, runCalSync, runAutosort,
  runNoteChat, runNoteAugment, runAiSearch, isRunning,
} from './process.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
ensureVault(cfg);
// A `pm2 restart` mid-run kills the claude child without cleanup; drop any stale inbox.lock on boot
// so processing isn't blocked by a leftover from before the restart.
if (clearStaleInboxLock()) console.log('  • cleared a stale inbox.lock from a previous run');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(PROJECT_ROOT, 'public')));

// Serve vault images (for previews) — read-only, path-guarded by multer dir.
app.use('/vault-files', express.static(vaultDir(cfg)));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, join(vaultDir(loadConfig()), 'attachments')),
    filename: (_req, file, cb) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${stamp}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Handwritten pages (PNG from the in-app ink canvas) → own subfolder.
const uploadHandwriting = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(vaultDir(loadConfig()), 'attachments', 'handwriting');
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      cb(null, `hw-${stamp}${extname(file.originalname) || '.png'}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Audio recordings can be long (lectures/meetings) → bigger cap, own subfolder.
const uploadAudio = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(vaultDir(loadConfig()), 'attachments', 'recordings');
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      cb(null, `rec-${stamp}${extname(file.originalname) || '.webm'}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// In-memory upload for re-editing a handwriting page in place (we write the buffer to a known path).
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, err, code = 400) => res.status(code).json({ ok: false, error: String(err.message || err) });

// Persist the ink canvas's vector strokes next to a saved handwriting PNG, so the page can be
// reopened and re-edited later. `pngPath` is the absolute PNG path; sidecar is `<base>.ink.json`.
// Only valid JSON is written — a missing/corrupt field is ignored, never failing the upload.
function saveInkSidecar(pngPath, strokesField) {
  if (!pngPath || !strokesField) return;
  try { JSON.parse(strokesField); } catch { return; }
  try { writeFileSync(pngPath.replace(/\.png$/i, '') + '.ink.json', strokesField); } catch { /* noop */ }
}

// ---- Inbox / capture ----
app.get('/api/inbox', (_req, res) => ok(res, { items: readInboxItems() }));

app.post('/api/capture', (req, res) => {
  try { ok(res, { items: addInboxItem(req.body.text || '') }); } catch (e) { fail(res, e); }
});

app.post('/api/capture/photo', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    ok(res, { items: addPhotoItem(req.file.filename, (req.body.hint || '').trim()), filename: req.file.filename });
  } catch (e) { fail(res, e); }
});

// ---- PWA Share Target ----
// Android system share sheet → POST here. Image shares (e.g. a screenshot) render a tiny note page
// (add a spoken/typed note, then Save → inbox). Text-only shares drop straight in. This is the free,
// no-Tasker "Essential Space" path: screenshot → Share → lifeOS → note.
function sharePage(filename, note, msg) {
  const esc = (s) => String(s || '').replace(/[<&"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[c]));
  const head = `<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Capture</title>
<style>body{margin:0;background:#0c0d11;color:#e6e7ea;font:16px/1.4 system-ui,sans-serif;padding:16px}
img{max-width:100%;border-radius:10px;margin-bottom:12px;display:block}
textarea{width:100%;box-sizing:border-box;min-height:96px;background:#16181f;color:#e6e7ea;border:1px solid #2a2d38;border-radius:10px;padding:12px;font:inherit}
.row{display:flex;gap:10px;margin-top:12px}button{flex:1;padding:14px;border:0;border-radius:10px;font:600 16px system-ui;color:#fff}
#mic{background:#2a2d38}#save{background:#3b6ef5}#s{opacity:.7;margin-top:10px}a{color:#7aa2ff}</style></head><body>`;
  if (!filename) return `${head}<p>${esc(msg) || 'Saved ✓'}</p><a href="/">open lifeOS</a></body></html>`;
  return `${head}<img src="/vault-files/attachments/${encodeURIComponent(filename)}" alt="shared">
<textarea id=n autofocus placeholder="add a note… or tap 🎤">${esc(note)}</textarea>
<div class=row><button id=mic type=button>🎤 Speak</button><button id=save type=button>Save to inbox</button></div>
<p id=s></p><script>
var fn=${JSON.stringify(filename)},n=document.getElementById('n'),s=document.getElementById('s');
document.getElementById('mic').onclick=function(){var S=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!S){s.textContent='speech not supported — use keyboard mic';return;}var r=new S();r.lang='en-US';
r.onresult=function(e){n.value=(n.value+' '+e.results[0][0].transcript).trim();};r.onerror=function(){s.textContent='mic error';};r.start();};
document.getElementById('save').onclick=async function(){s.textContent='saving…';
try{var res=await fetch('/share/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:fn,note:n.value})});
var j=await res.json();if(j.ok){s.textContent='Saved ✓';location.href='/';}else s.textContent='error: '+j.error;}catch(e){s.textContent='error: '+e;}};
</script></body></html>`;
}

app.post('/share', upload.single('photo'), (req, res) => {
  try {
    const shared = (req.body.text || req.body.title || '').trim();
    if (!req.file) { if (shared) addInboxItem(shared); return res.send(sharePage(null, '', shared ? 'Saved to inbox ✓' : 'Nothing to capture')); }
    res.send(sharePage(req.file.filename, shared, ''));   // defer inbox item until Save, so the note rides along
  } catch (e) { res.status(400).send('share failed: ' + (e.message || e)); }
});

app.post('/share/save', (req, res) => {
  try {
    const fn = String(req.body.filename || '');
    if (!/^[A-Za-z0-9._-]+$/.test(fn)) throw new Error('bad filename');   // bare basename only — matches multer naming
    ok(res, { items: addPhotoItem(fn, String(req.body.note || '').trim()) });
  } catch (e) { fail(res, e); }
});

// Documents (PDF / PPTX / DOCX / …) ride the same attachments plumbing as photos, but embed
// by bare filename and carry #document so process-inbox extracts & summarizes them.
app.post('/api/capture/document', upload.single('document'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    ok(res, { items: addDocumentItem(req.file.filename, (req.body.hint || '').trim()), filename: req.file.filename });
  } catch (e) { fail(res, e); }
});

app.post('/api/capture/handwriting', uploadHandwriting.single('photo'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    saveInkSidecar(req.file.path, req.body.strokes);   // vector source → re-editable later
    ok(res, { items: addHandwritingItem(req.file.filename, (req.body.hint || '').trim()), filename: req.file.filename });
  } catch (e) { fail(res, e); }
});

// Store a drawing for embedding straight into a note (editor "Write" tool) — no inbox item.
app.post('/api/upload/handwriting', uploadHandwriting.single('photo'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    saveInkSidecar(req.file.path, req.body.strokes);   // vector source → re-editable later
    ok(res, { ref: `attachments/handwriting/${req.file.filename}`, filename: req.file.filename });
  } catch (e) { fail(res, e); }
});

// Store a photo for embedding straight into a note (editor "attach image" tool) — no inbox item.
app.post('/api/upload/image', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    ok(res, { ref: `attachments/${req.file.filename}` });
  } catch (e) { fail(res, e); }
});

// Re-edit: overwrite an existing handwriting page in place (same filename → the note's embed keeps
// resolving), replacing both the PNG and its stroke sidecar with the edited version.
app.post('/api/handwriting/update', uploadMem.single('photo'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    const ref = String(req.body.ref || '');
    // Strict: only a bare filename inside attachments/handwriting (no slashes, no traversal).
    if (!/^attachments\/handwriting\/[A-Za-z0-9._-]+\.png$/.test(ref)) throw new Error('bad ref');
    const dir = vaultDir(loadConfig());
    const hwDir = join(dir, 'attachments', 'handwriting');
    const abs = join(dir, ref);
    if (!abs.startsWith(hwDir + sep)) throw new Error('bad path');
    writeFileSync(abs, req.file.buffer);
    saveInkSidecar(abs, req.body.strokes);
    ok(res, { ref });
  } catch (e) { fail(res, e); }
});

// Delete a handwriting attachment (the ink canvas PNG + its .ink.json sidecar, if any). Removing just
// the note's ![[…]] embed never touched this file — it stayed orphaned on disk; this is that missing half.
app.delete('/api/handwriting', (req, res) => {
  try {
    const ref = String(req.query.ref || '');
    if (!/^attachments\/handwriting\/[A-Za-z0-9._-]+\.png$/.test(ref)) throw new Error('bad ref');
    const dir = vaultDir(loadConfig());
    const hwDir = join(dir, 'attachments', 'handwriting');
    const abs = join(dir, ref);
    if (!abs.startsWith(hwDir + sep) || !existsSync(abs)) throw new Error('not found');
    unlinkSync(abs);
    const sidecar = abs.replace(/\.png$/i, '.ink.json');
    if (existsSync(sidecar)) unlinkSync(sidecar);
    ok(res, { ref });
  } catch (e) { fail(res, e); }
});

app.post('/api/capture/audio', uploadAudio.single('audio'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    ok(res, { items: addAudioItem(req.file.filename, (req.body.hint || '').trim()), filename: req.file.filename });
  } catch (e) { fail(res, e); }
});

app.delete('/api/inbox/:index', (req, res) => {
  try { ok(res, { items: removeInboxItem(Number(req.params.index)) }); } catch (e) { fail(res, e); }
});

// ---- Claude runs (SSE streams) ----
app.get('/api/process/status', (_req, res) => ok(res, { running: isRunning() }));

// Open an SSE channel and pipe a claude run (`start(onEvent)` → kill fn) into it.
function sseRun(req, res, start) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  // Heartbeat: some runs (notably note-augment) go silent for 20-30s while claude reads + edits.
  // An idle proxy/tunnel can buffer or drop a silent SSE stream, so emit a comment ping every 10s
  // to keep bytes flowing until the run settles. Comments (`:` lines) are ignored by EventSource.
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 10000);
  const kill = start((type, data) => {
    send(type, data);
    if (type === 'done' || type === 'error') { clearInterval(ping); res.end(); }
  });
  // Kill the run only if the *client* disconnects before we finish. Must watch the response, not
  // the request: express.json() drains the POST body, which ends the request stream and fires its
  // 'close' immediately — watching req here would kill claude the instant it starts.
  res.on('close', () => { clearInterval(ping); if (!res.writableEnded) kill(); });
}

app.get('/api/process/stream', (req, res) => {
  // ?provider=Qwen|DeepSeek → force the run through that fallback to test it (skips Claude). When
  // testing we don't skip-when-idle: spawning the provider is the point even if the inbox is empty.
  const provider = String(req.query.provider || '').trim();
  // Don't even spawn claude when there's nothing to do — the inbox is empty AND no #draft notes
  // need optimizing. Saves a whole run's context-load tokens (matters on nightly schedules).
  if (!provider && readInboxItems().length === 0 && !hasDrafts()) {
    return sseRun(req, res, (on) => {
      on('status', { state: 'skipped', message: 'Nothing to process — inbox empty, no drafts.' });
      on('done', { code: 0, skipped: true });
      return () => {};
    });
  }
  // Backstop: clear inbox.lock whenever the run settles, however it settled — a force-stopped run
  // (max-turns kill, crash) skips the skill's own lock cleanup and would otherwise strand it.
  sseRun(req, res, (on) => runProcessInbox((type, data) => {
    if (type === 'done' || type === 'error') clearInboxLock();
    on(type, data);
  }, provider || undefined));
});

app.get('/api/research/stream', (req, res) => {
  const idea = String(req.query.idea || '').trim();
  if (!idea) return sseRun(req, res, (on) => { on('error', { message: 'No idea given.' }); return () => {}; });
  sseRun(req, res, (on) => runResearch(idea, on));
});

app.get('/api/review/stream', (req, res) => sseRun(req, res, runWeeklyReview));
app.get('/api/home/stream', (req, res) => sseRun(req, res, runRefreshHome));
app.get('/api/calsync/stream', (req, res) => sseRun(req, res, runCalSync));
app.get('/api/autosort/stream', (req, res) => sseRun(req, res, runAutosort));

// ---- AI Chat (read-only advisor over the vault) ----
// Plain-text streaming (not SSE) so the client can POST the conversation transcript.
app.post('/api/chat', (req, res) => {
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (!messages.length) return fail(res, new Error('no messages'));
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.flushHeaders?.();
  const kill = runChat(messages, (type, data) => {
    if (type === 'log' && data.channel === 'out') res.write(data.line + '\n');
    else if (type === 'error') { res.write('\n[error] ' + data.message); res.end(); }
    else if (type === 'done') res.end();
  });
  // Kill the run only if the *client* disconnects before we finish. Must watch the response, not
  // the request: express.json() drains the POST body, which ends the request stream and fires its
  // 'close' immediately — watching req here would kill claude the instant it starts.
  res.on('close', () => { if (!res.writableEnded) kill(); });
});

// ---- Per-note tutor chat (read-only, scoped to one open note) ----
app.post('/api/note/chat', (req, res) => {
  const path = String(req.body && req.body.path || '').trim();
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (!path || !messages.length) return fail(res, new Error('path and messages required'));
  let content;
  try { content = readNote(path); } catch (e) { return fail(res, e, 404); }
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.flushHeaders?.();
  const kill = runNoteChat(path, content, messages, (type, data) => {
    if (type === 'log' && data.channel === 'out') res.write(data.line + '\n');
    else if (type === 'error') { res.write('\n[error] ' + data.message); res.end(); }
    else if (type === 'done') res.end();
  });
  // Kill the run only if the *client* disconnects before we finish. Must watch the response, not
  // the request: express.json() drains the POST body, which ends the request stream and fires its
  // 'close' immediately — watching req here would kill claude the instant it starts.
  res.on('close', () => { if (!res.writableEnded) kill(); });
});

// ---- Add an overview of a topic INTO an open note ----
// POST (not GET/EventSource): the tutor reply we pass as `context` is dense LaTeX/markdown, which
// balloons when URL-encoded and overruns the request-line/header limit — so it goes in the body.
// The model only *generates* the overview (+ a placement anchor); the server does the insertion,
// so it's strictly additive and can fall back to Gemini/DeepSeek like the chats.
app.post('/api/note/augment/stream', (req, res) => {
  const path = String(req.body && req.body.path || '').trim();
  const topic = String(req.body && req.body.topic || '').trim();
  const context = String(req.body && req.body.context || '').trim();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 10000);
  const finish = () => { clearInterval(ping); if (!res.writableEnded) res.end(); };
  if (!path || !topic) { send('error', { message: 'path and topic required.' }); return finish(); }
  let content;
  try { content = readNote(path); } catch { send('error', { message: 'note not found.' }); return finish(); }

  const kill = runNoteAugment(path, content, topic, context, (type, data) => {
    if (type === 'done') {
      if (data.code !== 0) { send('error', { message: `The AI run didn't finish (exit ${data.code}).` }); return finish(); }
      if (!data.body || !data.body.trim()) { send('error', { message: 'The AI returned nothing to add.' }); return finish(); }
      try { augmentNoteFile(path, data.anchor, data.body); }
      catch (e) { send('error', { message: e.message }); return finish(); }
      send('done', { code: 0, usedFallback: data.usedFallback });
      return finish();
    }
    send(type, data);                                   // status (incl. fallback-retry) + error
    if (type === 'error') finish();
  });
  // Kill the run only if the client disconnects before we finish (watch res, not req — express.json
  // drains the POST body and fires req 'close' immediately).
  res.on('close', () => { clearInterval(ping); if (!res.writableEnded) kill(); });
});

// ---- Notes ----
app.get('/api/notes', (_req, res) => ok(res, { notes: listNotes() }));
app.get('/api/note', (req, res) => {
  try { ok(res, { path: req.query.path, content: readNote(String(req.query.path)) }); }
  catch (e) { fail(res, e, 404); }
});
app.get('/api/folders', (_req, res) => ok(res, { folders: listFolders(), systemFolders: SYSTEM_FOLDER_NAMES, stagingFolders: STAGING_FOLDER_NAMES }));
// Create a folder (supports nested subfolders via `Parent/Child`).
app.post('/api/folders', (req, res) => {
  try { ok(res, { path: createFolder(req.body && req.body.path) }); } catch (e) { fail(res, e); }
});
// Plain-text vault search (no AI) — powers the Notes tab search box.
app.get('/api/search', (req, res) => {
  try { ok(res, { results: searchNotes(String(req.query.q || '')) }); } catch (e) { fail(res, e); }
});

// AI semantic search — "describe what you're looking for" (Discover). Runs the read-only `search`
// claude kind (Gemini/DeepSeek fallback), then validates the returned paths against the real vault so
// a hallucinated path can't leak through. Returns ranked { path, name, reason }.
app.post('/api/ai-search', (req, res) => {
  const q = String(req.body && req.body.q || '').trim();
  if (!q) return fail(res, new Error('describe what to search for'));
  const notes = listNotes();
  const byPath = new Map(notes.map((n) => [n.path.toLowerCase(), n]));
  const byBase = new Map(notes.map((n) => [n.name.toLowerCase(), n])); // fallback: match on title
  const kill = runAiSearch(q, (type, data) => {
    if (type !== 'done') return;                             // (status/error events are internal here)
    if (data.code !== 0 && !data.raw) return fail(res, new Error(`search run didn't finish (exit ${data.code}).`));
    const results = [];
    const seen = new Set();
    for (const line of String(data.raw || '').split('\n')) {
      const s = line.trim();
      if (!s || /^none$/i.test(s)) continue;
      const [rawPath, ...why] = s.split('::');
      let p = rawPath.trim().replace(/\\/g, '/').replace(/[`"'\[\]]/g, '').replace(/^[-*\s]+/, '').replace(/^\.?\//, '');
      let n = byPath.get(p.toLowerCase()) || byBase.get(p.replace(/\.md$/i, '').toLowerCase());
      if (!n || seen.has(n.path)) continue;
      seen.add(n.path);
      results.push({ path: n.path, name: n.name, reason: why.join('::').trim() });
    }
    ok(res, { results });
  });
  res.on('close', () => { if (!res.writableEnded) kill(); });
});
// Write your own note (in-app editor). Tagged #draft so process-inbox optimizes it later.
app.post('/api/notes', (req, res) => {
  try { ok(res, createNote(req.body || {})); } catch (e) { fail(res, e); } // { path, hub }
});
// Save edits to an existing note (in-app editor, edit mode).
app.post('/api/note/save', (req, res) => {
  try { ok(res, { path: updateNote(req.body.path, req.body.content) }); } catch (e) { fail(res, e); }
});
// Rename a note (change its title → renames the file + syncs the H1).
app.post('/api/note/rename', (req, res) => {
  try { ok(res, { path: renameNote(req.body && req.body.path, req.body && req.body.title) }); }
  catch (e) { fail(res, e); }
});
// Rename a folder (basename only; guards reserved/system folders).
app.post('/api/folder/rename', (req, res) => {
  try { ok(res, { path: renameFolder(req.body && req.body.path, req.body && req.body.name) }); }
  catch (e) { fail(res, e); }
});
// Delete a note / a folder (path-guarded; protected system files & infra dirs are refused).
app.delete('/api/note', (req, res) => {
  try { ok(res, { path: deleteNote(String(req.query.path || '')) }); } catch (e) { fail(res, e); }
});
app.delete('/api/folder', (req, res) => {
  try { ok(res, { path: deleteFolder(String(req.query.path || '')) }); } catch (e) { fail(res, e); }
});
// Move a note/folder into another folder (drag-to-move). dest '' = vault root.
app.post('/api/move', (req, res) => {
  try { ok(res, { path: moveEntry(req.body && req.body.src, (req.body && req.body.dest) || '') }); }
  catch (e) { fail(res, e); }
});
// Apply a batch of moves (the auto-sort plan). Returns per-item result; never aborts the whole batch.
app.post('/api/move/batch', (req, res) => {
  const moves = Array.isArray(req.body && req.body.moves) ? req.body.moves : [];
  const results = moves.map((m) => {
    try { return { src: m.src, ok: true, path: moveEntry(m.src, m.dest || '') }; }
    catch (e) { return { src: m.src, ok: false, error: String(e.message || e) }; }
  });
  ok(res, { results, moved: results.filter((r) => r.ok).length });
});
// Auto-sort: AI proposes a tidy-up plan (SSE), then read it back to preview before applying.
app.get('/api/autosort/plan', (_req, res) => ok(res, { moves: readAutosortPlan() }));

// ---- Discover (idea bank / needs filing) ----
app.get('/api/ideas', (_req, res) => ok(res, { items: listIdeas() }));
app.get('/api/needs-filing', (_req, res) => ok(res, { items: listNeedsFiling() }));

// ---- Graph / Calendar / Log ----
app.get('/api/graph', (_req, res) => ok(res, buildGraph()));
app.get('/api/tasks', (_req, res) => ok(res, { tasks: listTasks() }));
app.post('/api/tasks/toggle', (req, res) => {
  try { ok(res, { tasks: toggleTask(String(req.body.file), Number(req.body.line)) }); }
  catch (e) { fail(res, e); }
});
// Edit a task's description/date (Plan tab). May move the line to a different TODO/{year}/{month}.md
// file if the date crosses a year boundary — see editTask()'s doc comment in vault.js.
app.post('/api/tasks/edit', (req, res) => {
  try {
    const { file, line, desc, date } = req.body || {};
    ok(res, { tasks: editTask(String(file), Number(line), { desc, date }) });
  } catch (e) { fail(res, e); }
});
app.get('/api/log', (_req, res) => ok(res, { log: readLog() }));
// Calendar events synced from Google Calendar by the `calsync` run (may be empty until first sync).
app.get('/api/calendar', (_req, res) => ok(res, { events: readCalendarCache() }));

// ---- Config ----
app.get('/api/config', (_req, res) => {
  const c = loadConfig();
  ok(res, { config: c, vaultDir: vaultDir(c), docTools: checkDocTools() });
});
app.post('/api/config', (req, res) => {
  try {
    const c = saveConfig(req.body || {});
    ensureVault(c);
    ok(res, { config: c, vaultDir: vaultDir(c) });
  } catch (e) { fail(res, e); }
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || extname(req.path)) return next();
  res.sendFile(join(PROJECT_ROOT, 'public', 'index.html'));
});

// Env overrides win over config (handy for running a second instance / tests on another port).
const port = Number(process.env.PORT) || cfg.port;
const host = process.env.HOST || cfg.host;
app.listen(port, host, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`\n  lifeOS running`);
  console.log(`  • local:   http://localhost:${port}`);
  for (const ip of lan) console.log(`  • network: http://${ip}:${port}   (open this on your phone)`);
  console.log(`  • vault:   ${vaultDir(cfg)}`);
  // Surface document-extraction tooling so attached docx/pptx don't silently fail to process.
  // PDFs are read natively by the claude Read tool, so only an *Office* tool (pandoc/libreoffice)
  // actually unlocks .docx/.pptx/.xlsx.
  const tools = checkDocTools();
  const office = tools.filter((t) => t.found && t.cmd !== 'pdftotext');
  if (office.length) {
    console.log(`  • docs:    ${office.map((t) => t.label).join(', ')} ready (docx/pptx/xlsx → text)`);
  } else {
    console.log('  • docs:    ⚠ no Office-extraction tool found — PDFs still process (read natively), but');
    console.log('             attached .docx/.pptx/.xlsx will be parked #needs-extraction until you');
    console.log('             install one:  pandoc  ·  libreoffice  (poppler/pdftotext only covers PDFs)');
  }
  console.log('');
});
