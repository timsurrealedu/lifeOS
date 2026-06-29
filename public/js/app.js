'use strict';
/* ============ lifeOS frontend ============ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
  return j;
};
const toast = (msg) => {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
};

const state = { inbox: [], notes: [], view: 'capture', pendingPhoto: null, pendingAudio: null, graph: null, expandedFolders: new Set() };

/* ---------- Navigation ---------- */
function show(view) {
  state.view = view;
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === view));
  if (view === 'capture') renderInbox();
  if (view === 'discover') loadDiscover();
  if (view === 'notes') loadNotes();
  if (view === 'plan') loadPlan();
  if (view === 'graph') loadGraph();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));

/* ---------- Sheets ---------- */
function openSheet(id) {
  $('#backdrop').hidden = false;
  $('#' + id).hidden = false;
}
function closeSheets() {
  stopCam();
  $('#backdrop').hidden = true;
  $$('.sheet').forEach((s) => (s.hidden = true));
}
$('#backdrop').addEventListener('click', closeSheets);
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'close-sheet') closeSheets();
  if (act === 'close-camera') closeCamera();
  if (act === 'open-log') openLog();
  if (act === 'open-settings') openSettings();
});

/* ---------- Capture ---------- */
const textEl = $('#capture-text');

// Preview helpers (shared by photo / camera / recording)
function resetCapture() {
  state.pendingPhoto = null; state.pendingAudio = null;
  for (const id of ['#photo-preview', '#audio-preview']) { const p = $(id); p.classList.add('hidden'); p.innerHTML = ''; }
  $('#photo-input').value = '';
  $('#btn-add').textContent = 'Add to inbox';
}
function discardBtn() {
  const b = document.createElement('button');
  b.className = 'preview-del'; b.type = 'button'; b.textContent = '✕ Discard';
  b.addEventListener('click', resetCapture);
  return b;
}
function showPhotoPreview(blob) {
  state.pendingPhoto = blob;
  const pv = $('#photo-preview'); pv.innerHTML = '';
  const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.alt = 'preview';
  pv.append(img, discardBtn());
  pv.classList.remove('hidden');
  $('#btn-add').textContent = 'Add photo to inbox';
}
// MediaRecorder webm/ogg blobs carry no duration → the seekbar is dead until we
// force the browser to read to the end once to compute it.
function fixAudioDuration(audio) {
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration === Infinity || Number.isNaN(audio.duration)) {
      audio.currentTime = 1e101;
      audio.addEventListener('timeupdate', function h() { audio.removeEventListener('timeupdate', h); audio.currentTime = 0; });
    }
  });
}
function showAudioPreview(blob, dur) {
  state.pendingAudio = { blob, type: blob.type, dur };
  const pv = $('#audio-preview'); pv.innerHTML = '';
  const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata';
  audio.src = URL.createObjectURL(blob);
  fixAudioDuration(audio);
  const meta = document.createElement('div'); meta.className = 'hint';
  meta.textContent = `Recording · ${fmtElapsed(dur)} — add a hint above (optional)`;
  pv.append(audio, meta, discardBtn());
  pv.classList.remove('hidden');
  $('#btn-add').textContent = 'Add recording to inbox';
}

$('#btn-add').addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (state.pendingPhoto) { await uploadPhoto(text); return; }
  if (state.pendingAudio) { await uploadAudio(text); return; }
  if (!text) { toast('Nothing to add'); return; }
  try {
    const { items } = await api('/api/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    state.inbox = items; textEl.value = ''; updateInboxCount();
    toast('Added to inbox');
  } catch (e) { toast(e.message); }
});

// Photo (pick existing file)
$('#photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showPhotoPreview(file);
  toast('Photo ready — add a hint above (optional)');
});

async function uploadPhoto(hint) {
  const fd = new FormData();
  fd.append('photo', state.pendingPhoto, state.pendingPhoto.name || 'camera.jpg');
  if (hint) fd.append('hint', hint);
  try {
    const { items } = await api('/api/capture/photo', { method: 'POST', body: fd });
    state.inbox = items; updateInboxCount(); textEl.value = '';
    resetCapture();
    toast('Photo added to inbox');
  } catch (e) { toast(e.message); }
}

// In-app camera (take a photo, not pick one)
let camStream = null, camFacing = 'environment';
$('#btn-camera').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Camera not supported here'); return; }
  openSheet('sheet-camera');
  await startCam();
});
async function startCam() {
  stopCam();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camFacing }, audio: false });
    $('#cam-video').srcObject = camStream;
  } catch { toast('Camera permission needed'); closeCamera(); }
}
function stopCam() { if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; } }
function closeCamera() { stopCam(); $('#sheet-camera').hidden = true; $('#backdrop').hidden = true; }
$('#cam-switch').addEventListener('click', async () => {
  camFacing = camFacing === 'environment' ? 'user' : 'environment';
  await startCam();
});
$('#cam-shot').addEventListener('click', () => {
  const v = $('#cam-video');
  if (!v.videoWidth) { toast('Camera not ready'); return; }
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  c.toBlob((blob) => {
    if (!blob) { toast('Capture failed'); return; }
    closeCamera(); showPhotoPreview(blob);
    toast('Captured — add a hint (optional)');
  }, 'image/jpeg', 0.9);
});

// Voice (Web Speech API)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceBtn = $('#btn-voice');
if (SR) {
  let rec = null, listening = false;
  voiceBtn.addEventListener('click', () => {
    if (listening) { rec && rec.stop(); return; }
    rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    let base = textEl.value ? textEl.value + ' ' : '';
    rec.onresult = (ev) => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      textEl.value = base + txt;
    };
    rec.onend = () => { listening = false; voiceBtn.classList.remove('live'); };
    rec.onerror = () => { listening = false; voiceBtn.classList.remove('live'); toast('Mic error'); };
    rec.start(); listening = true; voiceBtn.classList.add('live');
  });
} else {
  voiceBtn.title = 'Use your keyboard mic';
  voiceBtn.addEventListener('click', () => { textEl.focus(); toast('Tap your keyboard 🎤 to dictate'); });
}

// Live recording (MediaRecorder → audio file for later transcription)
const recBtn = $('#btn-record');
let mediaRec = null, recChunks = [], recTimer = null, recStart = 0;
const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
const fmtElapsed = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

recBtn.addEventListener('click', async () => {
  if (!window.MediaRecorder) { toast('Recording not supported here'); return; }
  if (mediaRec && mediaRec.state === 'recording') { mediaRec.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast('Mic permission needed'); return; }
  const mime = recMime();
  recChunks = [];
  mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  mediaRec.onstop = () => {
    clearInterval(recTimer); recTimer = null;
    recBtn.classList.remove('live'); recBtn.innerHTML = '🔴 <span>Record</span>';
    stream.getTracks().forEach((t) => t.stop());
    const type = mediaRec.mimeType || mime || 'audio/webm';
    showAudioPreview(new Blob(recChunks, { type }), Date.now() - recStart);
    toast('Recording ready');
  };
  mediaRec.start();
  recStart = Date.now();
  recBtn.classList.add('live');
  recTimer = setInterval(() => { recBtn.innerHTML = `⏹ <span>${fmtElapsed(Date.now() - recStart)}</span>`; }, 500);
});

async function uploadAudio(hint) {
  const { blob, type } = state.pendingAudio;
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('audio', blob, `recording.${ext}`);
  if (hint) fd.append('hint', hint);
  try {
    const { items } = await api('/api/capture/audio', { method: 'POST', body: fd });
    state.inbox = items; updateInboxCount(); textEl.value = '';
    resetCapture();
    toast('Recording added to inbox');
  } catch (e) { toast(e.message); }
}

/* ---------- Claude runs (SSE) ---------- */
$('#btn-process').addEventListener('click', startProcess);

// Generic streaming-run sheet. Collects stdout and hands it to onDone(text, exitCode).
function startStream(url, { title = 'Working…', onDone } = {}) {
  const con = $('#process-console');
  con.innerHTML = '';
  $('#process-status').textContent = title;
  openSheet('sheet-process');
  let out = '';
  const append = (text, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text + '\n';
    con.appendChild(span); con.scrollTop = con.scrollHeight;
  };
  append('▸ launching claude in the vault…');
  const es = new EventSource(url);
  es.addEventListener('status', (e) => {
    const d = JSON.parse(e.data);
    if (d.state === 'starting') append('▸ claude started · ' + d.cwd);
  });
  es.addEventListener('log', (e) => {
    const d = JSON.parse(e.data);
    if (d.channel !== 'err') out += d.line + '\n';
    append(d.line, d.channel === 'err' ? 'err' : '');
  });
  es.addEventListener('done', (e) => {
    const d = JSON.parse(e.data);
    append(`\n✓ finished (exit ${d.code})`);
    $('#process-status').textContent = d.code === 0 ? 'Done ✓' : `Exited (${d.code})`;
    es.close();
    onDone && onDone(out.trim(), d.code);
  });
  es.addEventListener('error', (e) => {
    let msg = 'stream error';
    try { msg = JSON.parse(e.data).message; } catch {}
    append('✕ ' + msg, 'err');
    $('#process-status').textContent = 'Error';
    es.close();
  });
  return es;
}

function startProcess() {
  startStream('/api/process/stream', { title: 'Processing inbox…', onDone: () => afterProcess() });
}

async function afterProcess() {
  await refreshInbox();
  state.notes = []; // force reload next visit
  if (state.view === 'discover') loadDiscover();
  toast('Inbox processed');
}

/* ---------- Discover (research / find / lists / more) ---------- */
$('#btn-research').addEventListener('click', () => {
  const idea = $('#research-input').value.trim();
  if (!idea) { toast('Type an idea first'); return; }
  startStream('/api/research/stream?idea=' + encodeURIComponent(idea), {
    title: 'Researching idea…',
    onDone: (_out, code) => {
      if (code === 0) { $('#research-input').value = ''; state.notes = []; loadDiscover(); }
    },
  });
});

$('#btn-find').addEventListener('click', () => {
  const q = $('#find-input').value.trim();
  if (!q) { toast('Ask a question first'); return; }
  startStream('/api/find/stream?q=' + encodeURIComponent(q), {
    title: 'Searching vault…',
    onDone: (out, code) => {
      if (code === 0 && out) {
        closeSheets();
        showReader('Answer', mdToHtml(out));
      }
    },
  });
});

$('#btn-weekly').addEventListener('click', () =>
  startStream('/api/review/stream', { title: 'Weekly review…', onDone: () => { state.notes = []; } }));
$('#btn-home').addEventListener('click', () =>
  startStream('/api/home/stream', { title: 'Refreshing Home note…', onDone: () => { state.notes = []; } }));

async function loadDiscover() {
  try {
    const [needs, ideas] = await Promise.all([api('/api/needs-filing'), api('/api/ideas')]);
    renderDiscoverList('#needs-list', '#needs-empty', '#needs-badge', needs.items, '🗂️');
    renderDiscoverList('#ideas-list', '#ideas-empty', '#ideas-badge', ideas.items, '💡');
  } catch (e) { toast(e.message); }
}
function renderDiscoverList(listSel, emptySel, badgeSel, items, emo) {
  const ul = $(listSel); ul.innerHTML = '';
  $(badgeSel).textContent = items.length;
  $(emptySel).hidden = items.length > 0;
  for (const n of items) {
    const li = document.createElement('li');
    li.className = 'list-item';
    const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join(' / ') : '·';
    li.innerHTML = `<span class="li-emoji">${emo}</span>
      <div class="li-main"><div class="li-title">${esc(n.name)}</div><div class="li-sub">${esc(folder)} · ${timeAgo(n.mtime)}</div></div>`;
    li.addEventListener('click', () => openNote(n.path, n.name));
    ul.appendChild(li);
  }
}

/* ---------- Inbox ---------- */
async function refreshInbox() {
  try { const { items } = await api('/api/inbox'); state.inbox = items; updateInboxCount(); if (state.view === 'capture') renderInbox(); }
  catch {}
}
function updateInboxCount() {
  const n = state.inbox.length;
  $('#inbox-count').textContent = n;
  $('#inbox-badge').textContent = n;
  $('#tab-inbox-dot').hidden = n === 0;
}
function emoji(item) {
  if (/#recording|recordings\//.test(item)) return '🎙️';
  if (/!\[\[/.test(item)) return '📷';
  if (/\b(\d{1,2}[:.]\d{2}|\d{1,2}\s?(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|exam|deadline|due|meeting|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(item)) return '📅';
  if (/\b(email|buy|call|send|book|pay|fix|ask)\b/i.test(item)) return '✅';
  return '💭';
}
function renderInbox() {
  const ul = $('#inbox-list'); ul.innerHTML = '';
  $('#inbox-empty').hidden = state.inbox.length > 0;
  state.inbox.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `<span class="li-emoji">${emoji(item)}</span>
      <div class="li-main"><div class="li-title">${esc(item)}</div></div>
      <button class="li-del" aria-label="delete">✕</button>`;
    li.querySelector('.li-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      try { const { items } = await api('/api/inbox/' + i, { method: 'DELETE' }); state.inbox = items; updateInboxCount(); renderInbox(); }
      catch (err) { toast(err.message); }
    });
    ul.appendChild(li);
  });
}

/* ---------- Notes ---------- */
async function loadNotes(force) {
  if (state.notes.length && !force) { renderNotes(); return; }
  try { const { notes } = await api('/api/notes'); state.notes = notes; renderNotes(); }
  catch (e) { toast(e.message); }
}
function renderNotes() {
  const q = $('#notes-search').value.toLowerCase().trim();
  const ul = $('#notes-list'); ul.innerHTML = '';
  $('#notes-empty').hidden = state.notes.length > 0;

  // Searching → flat, filtered list (with the folder path so cross-folder hits make sense).
  if (q) {
    ul.className = 'list';
    const list = state.notes.filter((n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
    for (const n of list) {
      const li = document.createElement('li');
      li.className = 'list-item';
      const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join(' / ') : '·';
      li.innerHTML = `<span class="li-emoji">📄</span>
        <div class="li-main"><div class="li-title">${esc(n.name)}</div><div class="li-sub">${esc(folder)} · ${timeAgo(n.mtime)}</div></div>`;
      li.addEventListener('click', () => openNote(n.path, n.name));
      ul.appendChild(li);
    }
    return;
  }

  // Default → collapsible folder tree, so courses/areas stay grouped.
  ul.className = 'tree';
  renderTreeInto(buildTree(state.notes), 0, ul);
}

function buildTree(notes) {
  const root = { dirs: new Map(), files: [] };
  for (const n of notes) {
    const parts = n.path.split('/');
    parts.pop(); // filename
    let cur = root, acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      if (!cur.dirs.has(p)) cur.dirs.set(p, { name: p, path: acc, dirs: new Map(), files: [] });
      cur = cur.dirs.get(p);
    }
    cur.files.push(n);
  }
  return root;
}
function countFiles(node) {
  let c = node.files.length;
  for (const d of node.dirs.values()) c += countFiles(d);
  return c;
}
function renderTreeInto(node, depth, ul) {
  const pad = depth * 16 + 12;
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const open = state.expandedFolders.has(d.path);
    const li = document.createElement('li');
    li.className = 'tree-row tree-folder';
    li.style.paddingLeft = pad + 'px';
    li.innerHTML = `<span class="tw-caret">${open ? '▾' : '▸'}</span>
      <span class="li-emoji">${open ? '📂' : '📁'}</span>
      <div class="li-main"><div class="li-title">${esc(d.name)}</div></div>
      <span class="tw-count">${countFiles(d)}</span>`;
    li.addEventListener('click', () => {
      if (open) state.expandedFolders.delete(d.path); else state.expandedFolders.add(d.path);
      renderNotes();
    });
    ul.appendChild(li);
    if (open) renderTreeInto(d, depth + 1, ul);
  }
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const n of files) {
    const li = document.createElement('li');
    li.className = 'tree-row tree-note';
    li.style.paddingLeft = pad + 'px';
    li.innerHTML = `<span class="tw-caret"></span>
      <span class="li-emoji">📄</span>
      <div class="li-main"><div class="li-title">${esc(n.name)}</div><div class="li-sub">${timeAgo(n.mtime)}</div></div>`;
    li.addEventListener('click', () => openNote(n.path, n.name));
    ul.appendChild(li);
  }
}
$('#notes-search').addEventListener('input', renderNotes);

/* ---------- Full-page reader ---------- */
let readerOpen = false;
function showReader(title, html) {
  $('#reader-title').textContent = title;
  const body = $('#reader-body');
  body.innerHTML = html;
  bindWikilinks(body);
  if (!readerOpen) { history.pushState({ reader: true }, ''); readerOpen = true; }
  $('#reader').hidden = false;
  body.scrollTop = 0;
}
function closeReader() {
  if (!readerOpen) return;
  $('#reader').hidden = true;
  readerOpen = false;
  if (history.state && history.state.reader) history.back(); // drop the pushed entry
}
$('#reader-back').addEventListener('click', closeReader);
window.addEventListener('popstate', () => {
  if (readerOpen) { readerOpen = false; $('#reader').hidden = true; }
});

async function openNote(path, name) {
  try {
    const { content } = await api('/api/note?path=' + encodeURIComponent(path));
    showReader(name, mdToHtml(content));
  } catch (e) { toast(e.message); }
}

/* ---------- Plan ---------- */
async function loadPlan() {
  try {
    const { tasks } = await api('/api/tasks');
    const wrap = $('#plan-groups'); wrap.innerHTML = '';
    $('#plan-empty').hidden = tasks.length > 0;
    const today = new Date().toISOString().slice(0, 10);
    const groups = { Overdue: [], Today: [], Upcoming: [], Undated: [], Done: [] };
    for (const t of tasks) {
      if (t.done) groups.Done.push(t);
      else if (!t.date) groups.Undated.push(t);
      else if (t.date < today) groups.Overdue.push(t);
      else if (t.date === today) groups.Today.push(t);
      else groups.Upcoming.push(t);
    }
    for (const [name, arr] of Object.entries(groups)) {
      if (!arr.length) continue;
      const g = document.createElement('div'); g.className = 'plan-group';
      g.innerHTML = `<h3>${name} · ${arr.length}</h3>`;
      for (const t of arr) {
        const overdue = name === 'Overdue';
        const el = document.createElement('div');
        el.className = 'task' + (t.done ? ' done' : '') + (overdue ? ' overdue' : '');
        el.innerHTML = `<div class="box">${t.done ? '✓' : ''}</div>
          <div><div class="t-desc">${esc(t.desc)}</div>${t.date ? `<div class="t-meta">${fmtDate(t.date)}</div>` : ''}</div>`;
        el.addEventListener('click', async () => {
          el.classList.add('busy');
          try {
            await api('/api/tasks/toggle', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file: t.file, line: t.line }),
            });
            await loadPlan();
          } catch (err) { el.classList.remove('busy'); toast(err.message); }
        });
        g.appendChild(el);
      }
      wrap.appendChild(g);
    }
  } catch (e) { toast(e.message); }
}

/* ---------- Graph ---------- */
async function loadGraph() {
  try {
    const data = await api('/api/graph');
    $('#graph-stats').textContent = `${data.nodes.length} notes · ${data.links.length} links`;
    state.graph = data;
    window.LifeGraph.render($('#graph-canvas'), data, {
      onSelect: (name, exists) => {
        const lbl = $('#graph-label');
        lbl.textContent = name + (exists ? '' : '  (no note yet)');
        lbl.hidden = false;
      },
      onOpen: (name) => {
        const note = state.notes.find((n) => n.name.toLowerCase() === name.toLowerCase())
          || { path: findNotePath(name), name };
        if (note.path) openNote(note.path, name); else toast('No note for "' + name + '" yet');
      },
    });
  } catch (e) { toast(e.message); }
}
function findNotePath(name) {
  const n = state.notes.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return n ? n.path : null;
}

/* ---------- Log ---------- */
async function openLog() {
  try {
    const { log } = await api('/api/log');
    $('#log-body').innerHTML = log ? mdToHtml(log) : '<p class="hint">No runs logged yet.</p>';
    openSheet('sheet-log');
  } catch (e) { toast(e.message); }
}

/* ---------- Settings ---------- */
async function openSettings() {
  try {
    const { config, vaultDir } = await api('/api/config');
    $('#cfg-vaultPath').value = config.vaultPath;
    $('#cfg-timezone').value = config.timezone;
    $('#cfg-languages').value = config.languages;
    $('#cfg-claudePath').value = config.claudePath;
    $('#cfg-vaultdir').textContent = '→ ' + vaultDir;
    openSheet('sheet-settings');
  } catch (e) { toast(e.message); }
}
$('#btn-save-cfg').addEventListener('click', async () => {
  try {
    const { vaultDir } = await api('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaultPath: $('#cfg-vaultPath').value.trim(),
        timezone: $('#cfg-timezone').value.trim(),
        languages: $('#cfg-languages').value.trim(),
        claudePath: $('#cfg-claudePath').value.trim(),
      }),
    });
    $('#cfg-vaultdir').textContent = '→ ' + vaultDir;
    state.notes = []; state.graph = null;
    await refreshInbox();
    toast('Saved · vault: ' + vaultDir);
  } catch (e) { toast(e.message); }
});

/* ---------- Helpers ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Minimal markdown → HTML (headings, bold/italic, code, lists, links, wikilinks, tags, images)
function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  let html = '', inList = false, inCode = false;
  const inline = (t) => esc(t)
    .replace(/!\[\[([^\]]+?)\]\]/g, (_m, f) => {
      const ref = f.trim();
      const src = '/vault-files/' + (ref.includes('/')
        ? ref.split('/').map(encodeURIComponent).join('/')
        : 'attachments/' + encodeURIComponent(ref));
      return /\.(webm|m4a|mp3|wav|ogg)$/i.test(ref)
        ? `<audio controls src="${src}"></audio>`
        : `<img src="${src}" alt="${esc(ref)}" onerror="this.style.display='none'">`;
    })
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, name, label) => `<span class="wikilink" data-link="${esc(name.trim())}">${esc(label || name)}</span>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)(#[A-Za-z][\w-]*)/g, '$1<span class="tag">$2</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    if (raw.trim().startsWith('```')) { if (inCode) { html += '</pre>'; inCode = false; } else { closeList(); html += '<pre>'; inCode = true; } continue; }
    if (inCode) { html += esc(raw) + '\n'; continue; }
    const line = raw;
    if (/^#{1,6}\s/.test(line)) { closeList(); const lvl = line.match(/^#+/)[0].length; html += `<h${lvl}>${inline(line.replace(/^#+\s/, ''))}</h${lvl}>`; }
    else if (/^\s*[-*]\s\[[ xX]\]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } const done = /\[[xX]\]/.test(line); html += `<li>${done ? '☑' : '☐'} ${inline(line.replace(/^\s*[-*]\s\[[ xX]\]\s/, ''))}</li>`; }
    else if (/^\s*[-*]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s/, ''))}</li>`; }
    else if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; }
    else if (line.trim() === '---') { closeList(); html += '<hr>'; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList(); if (inCode) html += '</pre>';
  return html;
}
function bindWikilinks(root) {
  $$('.wikilink', root).forEach((el) => {
    const name = el.dataset.link;
    const path = findNotePath(name);
    if (!path) el.classList.add('dangling');
    el.addEventListener('click', () => { if (path) openNote(path, name); else toast('No note for "' + name + '" yet'); });
  });
}

/* ---------- Boot ---------- */
(async function boot() {
  await refreshInbox();
  await loadNotes(true);
  show('capture');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
