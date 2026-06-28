import express from 'express';
import multer from 'multer';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { mkdirSync } from 'node:fs';
import { loadConfig, saveConfig, vaultDir, PROJECT_ROOT } from './config.js';
import {
  ensureVault, readInboxItems, addInboxItem, removeInboxItem, addPhotoItem, addAudioItem,
  listNotes, readNote, buildGraph, listTasks, readLog,
} from './vault.js';
import { runProcessInbox, isRunning } from './process.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
ensureVault(cfg);

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

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, err, code = 400) => res.status(code).json({ ok: false, error: String(err.message || err) });

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

app.post('/api/capture/audio', uploadAudio.single('audio'), (req, res) => {
  try {
    if (!req.file) throw new Error('no file');
    ok(res, { items: addAudioItem(req.file.filename, (req.body.hint || '').trim()), filename: req.file.filename });
  } catch (e) { fail(res, e); }
});

app.delete('/api/inbox/:index', (req, res) => {
  try { ok(res, { items: removeInboxItem(Number(req.params.index)) }); } catch (e) { fail(res, e); }
});

// ---- Process (SSE stream) ----
app.get('/api/process/status', (_req, res) => ok(res, { running: isRunning() }));

app.get('/api/process/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const kill = runProcessInbox((type, data) => {
    send(type, data);
    if (type === 'done' || type === 'error') res.end();
  });
  req.on('close', () => kill());
});

// ---- Notes ----
app.get('/api/notes', (_req, res) => ok(res, { notes: listNotes() }));
app.get('/api/note', (req, res) => {
  try { ok(res, { path: req.query.path, content: readNote(String(req.query.path)) }); }
  catch (e) { fail(res, e, 404); }
});

// ---- Graph / Calendar / Log ----
app.get('/api/graph', (_req, res) => ok(res, buildGraph()));
app.get('/api/tasks', (_req, res) => ok(res, { tasks: listTasks() }));
app.get('/api/log', (_req, res) => ok(res, { log: readLog() }));

// ---- Config ----
app.get('/api/config', (_req, res) => {
  const c = loadConfig();
  ok(res, { config: c, vaultDir: vaultDir(c) });
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

const { port, host } = cfg;
app.listen(port, host, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`\n  lifeOS running`);
  console.log(`  • local:   http://localhost:${port}`);
  for (const ip of lan) console.log(`  • network: http://${ip}:${port}   (open this on your phone)`);
  console.log(`  • vault:   ${vaultDir(cfg)}\n`);
});
