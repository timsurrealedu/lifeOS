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

const state = { inbox: [], notes: [], folders: null, view: 'capture', pendingPhoto: null, pendingPhotoKind: null, pendingAudio: null, graph: null, expandedFolders: new Set(), readerPath: null, chat: [], chatBusy: false, planView: 'list', calMonth: null };

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

// Grow the dump box to fit its content (new lines push it taller, up to the CSS max-height).
// `input` covers typing/paste; programmatic changes (voice, clearing) call it directly.
function autoGrow() { textEl.style.height = 'auto'; textEl.style.height = textEl.scrollHeight + 'px'; }
textEl.addEventListener('input', autoGrow);

// Preview helpers (shared by photo / camera / recording)
function resetCapture() {
  state.pendingPhoto = null; state.pendingPhotoKind = null; state.pendingAudio = null;
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
    state.inbox = items; textEl.value = ''; autoGrow(); updateInboxCount();
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

// Shrink a captured photo to ~maxDim before upload so the later vision read costs far fewer
// tokens (phone photos are often 3000–4000px; Claude downsamples past ~1568px anyway). Handwriting
// is already a small canvas PNG, so it skips this. Falls back to the original on any failure.
async function downscaleImage(blob, maxDim = 1568, quality = 0.85) {
  try {
    if (!blob.type || !blob.type.startsWith('image/')) return blob;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale >= 1) { bmp.close?.(); return blob; } // already small enough
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return (out && out.size < blob.size) ? out : blob;
  } catch { return blob; }
}

async function uploadPhoto(hint) {
  const handwriting = state.pendingPhotoKind === 'handwriting';
  const url = handwriting ? '/api/capture/handwriting' : '/api/capture/photo';
  const photo = handwriting ? state.pendingPhoto : await downscaleImage(state.pendingPhoto);
  const baseName = handwriting ? 'handwriting.png' : (state.pendingPhoto.name || 'camera.jpg');
  // Keep the filename extension honest if we re-encoded to JPEG (so the inbox embed resolves).
  const fname = (!handwriting && photo.type === 'image/jpeg')
    ? baseName.replace(/\.\w+$/, '') + '.jpg'
    : baseName;
  const fd = new FormData();
  fd.append('photo', photo, fname);
  if (hint) fd.append('hint', hint);
  try {
    const { items } = await api(url, { method: 'POST', body: fd });
    state.inbox = items; updateInboxCount(); textEl.value = ''; autoGrow();
    resetCapture();
    toast(handwriting ? 'Handwritten note added' : 'Photo added to inbox');
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

/* ---------- Handwriting (infinite ink canvas → InkPad module) ---------- */
// Opens the full-screen vector canvas. On Done it hands back a cropped PNG of the drawing,
// which rides the normal photo plumbing into the inbox, tagged so the skill transcribes it.
$('#btn-handwrite').addEventListener('click', () => {
  window.InkPad.open((blob) => {
    showPhotoPreview(blob);
    state.pendingPhotoKind = 'handwriting';
    $('#btn-add').textContent = 'Add note to inbox';
    toast('Handwriting ready — add a hint (optional)');
  });
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
      textEl.value = base + txt; autoGrow();
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
    state.inbox = items; updateInboxCount(); textEl.value = ''; autoGrow();
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
    if (d.state === 'starting') append(`▸ claude started · ${d.model || 'default'} · ${d.cwd}`);
    else if (d.state === 'skipped') { append('• ' + (d.message || 'Nothing to do')); $('#process-status').textContent = 'Nothing to do'; }
    else if (d.state === 'fallback-retry' || d.state === 'fallback') append('⤷ ' + (d.message || `switching to fallback (${d.model || ''})`), 'err');
  });
  es.addEventListener('log', (e) => {
    const d = JSON.parse(e.data);
    if (d.channel !== 'err') out += d.line + '\n';
    append(d.line, d.channel === 'err' ? 'err' : '');
  });
  es.addEventListener('done', (e) => {
    const d = JSON.parse(e.data);
    if (d.skipped) { append('\n✓ nothing to do'); $('#process-status').textContent = 'Nothing to do'; }
    else {
      append(`\n✓ finished (exit ${d.code})${d.usedFallback ? ' · via fallback' : ''}`);
      $('#process-status').textContent = d.code === 0 ? (d.usedFallback ? 'Done ✓ (fallback)' : 'Done ✓') : `Exited (${d.code})`;
    }
    es.close();
    onDone && onDone(out.trim(), d.code, d);
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
  startStream('/api/process/stream', { title: 'Processing inbox…', onDone: (_out, _code, info) => afterProcess(info) });
}

async function afterProcess(info) {
  await refreshInbox();
  state.notes = []; // force reload next visit
  if (state.view === 'discover') loadDiscover();
  toast(info && info.skipped ? 'Nothing to process' : 'Inbox processed');
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

// Find = instant local text search (no AI / no tokens). Hits server-side searchNotes.
$('#btn-find').addEventListener('click', runFind);
$('#find-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runFind(); });
async function runFind() {
  const q = $('#find-input').value.trim();
  const ul = $('#find-results');
  if (!q) { ul.innerHTML = ''; toast('Type something to search'); return; }
  ul.innerHTML = '<li class="empty small">Searching…</li>';
  try {
    const { results } = await api('/api/search?q=' + encodeURIComponent(q));
    ul.innerHTML = '';
    if (!results.length) { ul.innerHTML = '<li class="empty small">No notes matched.</li>'; return; }
    for (const n of results) {
      const li = document.createElement('li');
      li.className = 'list-item';
      const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join(' / ') : '·';
      li.innerHTML = `<span class="li-emoji">📄</span>
        <div class="li-main"><div class="li-title">${esc(n.name)}</div>
        <div class="li-sub">${esc(folder)}</div>
        <div class="li-snip">${esc(n.snippet || '')}</div></div>`;
      li.addEventListener('click', () => openNote(n.path, n.name));
      ul.appendChild(li);
    }
  } catch (e) { ul.innerHTML = ''; toast(e.message); }
}

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
  if (/#handwriting|handwriting\//.test(item)) return '✍️';
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
  try {
    const [{ notes }, { folders }] = await Promise.all([api('/api/notes'), api('/api/folders')]);
    state.notes = notes; state.folders = folders; renderNotes();
  } catch (e) { toast(e.message); }
}

async function deleteNotePath(path, name) {
  if (!confirm(`Delete note "${name}"? This can't be undone.`)) return;
  try {
    await api('/api/note?path=' + encodeURIComponent(path), { method: 'DELETE' });
    state.notes = []; await loadNotes(true);
    toast('Note deleted');
  } catch (e) { toast(e.message); }
}

async function deleteFolderPath(path, count) {
  const warn = count > 0 ? `\n\nThis folder has ${count} note${count > 1 ? 's' : ''} — they'll be deleted too.` : '';
  if (!confirm(`Delete folder "${path}"?${warn}\nThis can't be undone.`)) return;
  try {
    await api('/api/folder?path=' + encodeURIComponent(path), { method: 'DELETE' });
    state.expandedFolders.delete(path);
    state.notes = []; state.folders = null; await loadNotes(true);
    toast('Folder deleted');
  } catch (e) { toast(e.message); }
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
  renderTreeInto(buildTree(state.notes, state.folders || []), 0, ul);
}

function buildTree(notes, folders = []) {
  const root = { dirs: new Map(), files: [] };
  const ensureDir = (parts) => {
    let cur = root, acc = '';
    for (const p of parts) {
      if (!p) continue;
      acc = acc ? acc + '/' + p : p;
      if (!cur.dirs.has(p)) cur.dirs.set(p, { name: p, path: acc, dirs: new Map(), files: [] });
      cur = cur.dirs.get(p);
    }
    return cur;
  };
  // Seed every known folder first so empty folders (no notes yet) still appear.
  for (const f of folders) ensureDir(f.split('/'));
  for (const n of notes) {
    const parts = n.path.split('/');
    parts.pop(); // filename
    ensureDir(parts).files.push(n);
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
    li.dataset.path = d.path; li.dataset.type = 'folder'; li.dataset.name = d.name;
    li.innerHTML = `<span class="tw-caret">${open ? '▾' : '▸'}</span>
      <span class="li-emoji">${open ? '📂' : '📁'}</span>
      <div class="li-main"><div class="li-title">${esc(d.name)}</div></div>
      <span class="tw-count">${countFiles(d)}</span>
      <button class="tw-del" aria-label="delete folder" title="Delete folder">✕</button>`;
    li.addEventListener('click', () => {
      if (open) state.expandedFolders.delete(d.path); else state.expandedFolders.add(d.path);
      renderNotes();
    });
    li.querySelector('.tw-del').addEventListener('click', (e) => { e.stopPropagation(); deleteFolderPath(d.path, countFiles(d)); });
    ul.appendChild(li);
    if (open) renderTreeInto(d, depth + 1, ul);
  }
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const n of files) {
    const li = document.createElement('li');
    li.className = 'tree-row tree-note';
    li.style.paddingLeft = pad + 'px';
    li.dataset.path = n.path; li.dataset.type = 'note'; li.dataset.name = n.name;
    li.innerHTML = `<span class="tw-caret"></span>
      <span class="li-emoji">📄</span>
      <div class="li-main"><div class="li-title">${esc(n.name)}</div><div class="li-sub">${timeAgo(n.mtime)}</div></div>
      <button class="tw-del" aria-label="delete note" title="Delete note">✕</button>`;
    li.addEventListener('click', () => openNote(n.path, n.name));
    li.querySelector('.tw-del').addEventListener('click', (e) => { e.stopPropagation(); deleteNotePath(n.path, n.name); });
    ul.appendChild(li);
  }
}
$('#notes-search').addEventListener('input', renderNotes);

/* ---------- Drag-to-move (Obsidian-style, touch + mouse) ---------- */
// Long-press a tree row to pick it up, drag onto a folder (or empty area = vault root) to move it.
let dragS = null;          // active drag state
let suppressTreeClick = false;
const HOLD_MS = 320, MOVE_CANCEL = 12;

function clearDropHints() {
  $$('.tree-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
  const ul = $('#notes-list'); ul.classList.remove('drop-root');
}
function endDrag(commit) {
  if (!dragS) return;
  const s = dragS; dragS = null;
  clearTimeout(s.hold);
  if (s.ghost) s.ghost.remove();
  if (s.row) s.row.classList.remove('drag-source');
  document.body.classList.remove('dragging-tree');
  clearDropHints();
  window.removeEventListener('pointermove', onDragMove, { passive: false });
  window.removeEventListener('pointerup', onDragUp);
  window.removeEventListener('pointercancel', onDragUp);
  if (commit && s.started && s.dest !== null && s.dest !== undefined) {
    const destLabel = s.dest === '' ? 'vault root' : s.dest;
    suppressTreeClick = true;
    moveEntryUI(s.srcPath, s.dest, destLabel);
  }
}
async function moveEntryUI(src, dest, label) {
  // Don't bother if it's already in that folder.
  const curFolder = src.includes('/') ? src.split('/').slice(0, -1).join('/') : '';
  if (curFolder === dest) return;
  try {
    await api('/api/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src, dest }),
    });
    state.notes = []; state.folders = null; state.graph = null;
    if (dest) state.expandedFolders.add(dest);
    await loadNotes(true);
    toast('Moved to ' + label);
  } catch (e) { toast(e.message); }
}
function onDragDown(e) {
  if (e.button != null && e.button !== 0) return; // left/touch only
  if (e.target.closest('.tw-del')) return;        // delete button, not a drag
  const row = e.target.closest('.tree-row[data-path]');
  if (!row) return;
  dragS = {
    row, srcPath: row.dataset.path, srcName: row.dataset.name, type: row.dataset.type,
    x0: e.clientX, y0: e.clientY, started: false, dest: null, ghost: null, hold: null,
  };
  dragS.hold = setTimeout(() => beginDrag(e.clientX, e.clientY), HOLD_MS);
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragUp);
  window.addEventListener('pointercancel', onDragUp);
}
function beginDrag(x, y) {
  if (!dragS) return;
  dragS.started = true;
  dragS.row.classList.add('drag-source');
  document.body.classList.add('dragging-tree');
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.textContent = (dragS.type === 'folder' ? '📁 ' : '📄 ') + dragS.srcName;
  document.body.appendChild(g); dragS.ghost = g;
  positionDrag(x, y);
  if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
}
function positionDrag(x, y) {
  if (dragS.ghost) { dragS.ghost.style.left = x + 'px'; dragS.ghost.style.top = y + 'px'; }
  clearDropHints();
  const el = document.elementFromPoint(x, y);
  const folder = el && el.closest ? el.closest('.tree-folder[data-path]') : null;
  // A folder target — but never the row being dragged, nor a descendant of a dragged folder.
  if (folder && folder !== dragS.row && !isDescPath(folder.dataset.path, dragS.srcPath)) {
    folder.classList.add('drop-target'); dragS.dest = folder.dataset.path;
  } else if (el && el.closest && el.closest('#notes-list')) {
    $('#notes-list').classList.add('drop-root'); dragS.dest = '';
  } else { dragS.dest = null; }
}
// true if `path` is the dragged folder itself or inside it
function isDescPath(path, src) {
  return dragS.type === 'folder' && (path === src || path.startsWith(src + '/'));
}
function onDragMove(e) {
  if (!dragS) return;
  if (!dragS.started) {
    if (Math.hypot(e.clientX - dragS.x0, e.clientY - dragS.y0) > MOVE_CANCEL) endDrag(false); // moved before hold = scroll/tap
    return;
  }
  e.preventDefault(); // stop the page scrolling while dragging
  positionDrag(e.clientX, e.clientY);
}
function onDragUp() { endDrag(true); }
$('#notes-list').addEventListener('pointerdown', onDragDown);
// Swallow the click that follows a completed drag so it doesn't open/toggle the row.
$('#notes-list').addEventListener('click', (e) => {
  if (suppressTreeClick) { suppressTreeClick = false; e.stopPropagation(); e.preventDefault(); }
}, true);

// Create a folder (or nested subfolders via `Parent/Child`). Shows up in the tree immediately.
$('#btn-new-folder').addEventListener('click', async () => {
  const name = prompt('New folder — use / for subfolders, e.g. University/Scientific Computing/UAS');
  if (!name || !name.trim()) return;
  try {
    const { path } = await api('/api/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: name.trim() }),
    });
    // Expand the whole new chain so the user sees where it landed.
    let acc = '';
    for (const p of path.split('/')) { acc = acc ? acc + '/' + p : p; state.expandedFolders.add(acc); }
    state.notes = []; state.folders = null;
    await loadNotes(true);
    toast('Folder created');
  } catch (e) { toast(e.message); }
});

/* ---------- Auto-sort (AI proposes → preview → apply) ---------- */
$('#btn-autosort').addEventListener('click', () => {
  startStream('/api/autosort/stream', {
    title: 'Auto-sort: planning…',
    onDone: async (_out, code) => {
      if (code !== 0) return;
      try {
        const { moves } = await api('/api/autosort/plan');
        if (!moves.length) { closeSheets(); toast('Already tidy — nothing to sort'); return; }
        autosortMoves = moves;
        const ul = $('#autosort-list'); ul.innerHTML = '';
        for (const m of moves) {
          const li = document.createElement('li');
          li.className = 'list-item';
          li.innerHTML = `<span class="li-emoji">📦</span><div class="li-main">
            <div class="li-title">${esc(m.src)} → ${esc(m.dest || 'root')}</div>
            ${m.reason ? `<div class="li-sub">${esc(m.reason)}</div>` : ''}</div>`;
          ul.appendChild(li);
        }
        closeSheets();
        openSheet('sheet-autosort');
      } catch (e) { toast(e.message); }
    },
  });
});
let autosortMoves = [];
$('#btn-autosort-apply').addEventListener('click', async () => {
  if (!autosortMoves.length) { closeSheets(); return; }
  try {
    const { moved } = await api('/api/move/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves: autosortMoves.map((m) => ({ src: m.src, dest: m.dest })) }),
    });
    autosortMoves = [];
    closeSheets();
    state.notes = []; state.folders = null; state.graph = null;
    await loadNotes(true);
    toast(`Sorted · ${moved} moved`);
  } catch (e) { toast(e.message); }
});

/* ---------- Full-page reader ---------- */
let readerOpen = false;
// `path` is the editable source note (null for synthetic content like Find answers → no Edit button).
function showReader(title, html, path = null) {
  $('#reader-title').textContent = title;
  state.readerPath = path;
  $('#reader-edit').hidden = !path;
  $('#reader-del').hidden = !path || isProtectedPath(path);
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
$('#reader-edit').addEventListener('click', () => {
  if (state.readerPath) openEditorFor(state.readerPath, $('#reader-title').textContent);
});
$('#reader-del').addEventListener('click', async () => {
  if (!state.readerPath) return;
  if (!confirm(`Delete "${$('#reader-title').textContent}"? This can't be undone.`)) return;
  try {
    await api('/api/note?path=' + encodeURIComponent(state.readerPath), { method: 'DELETE' });
    closeReader();
    state.notes = []; await loadNotes(true);
    toast('Note deleted');
  } catch (e) { toast(e.message); }
});

// Mirrors the server's protected list so we don't offer a delete that will just error.
const RESERVED_DIRS = new Set(['.claude', '.git', '.obsidian', '.inbox-archive', 'node_modules', '.cache', 'attachments']);
function isProtectedPath(path) {
  const base = path.split('/').pop();
  if (['CLAUDE.md', 'inbox.md', 'inbox.lock'].includes(base)) return true;
  return RESERVED_DIRS.has(path.split('/')[0]);
}
// One handler closes only the topmost overlay (editor sits above reader).
window.addEventListener('popstate', () => {
  if (editorOpen) { editorOpen = false; $('#editor').hidden = true; }
  else if (readerOpen) { readerOpen = false; $('#reader').hidden = true; }
});

async function openNote(path, name) {
  try {
    const { content } = await api('/api/note?path=' + encodeURIComponent(path));
    showReader(name, mdToHtml(content), path);
  } catch (e) { toast(e.message); }
}

/* ---------- Note editor (write your own note) ---------- */
const edTitle = $('#editor-title');
const edBody = $('#editor-body');
let editorOpen = false, edPreviewing = false;
let edMode = 'create', edPath = null; // 'create' → POST new note; 'edit' → overwrite edPath

// Toolbar primitives operating on the textarea selection.
function edSurround(before, after = before, placeholder = '') {
  const v = edBody.value, s = edBody.selectionStart, e = edBody.selectionEnd;
  const sel = v.slice(s, e) || placeholder;
  edBody.value = v.slice(0, s) + before + sel + after + v.slice(e);
  const pos = s + before.length;
  edBody.focus(); edBody.setSelectionRange(pos, pos + sel.length);
}
function edLinePrefix(prefix) {
  const v = edBody.value, s = edBody.selectionStart, e = edBody.selectionEnd;
  const start = v.lastIndexOf('\n', s - 1) + 1;
  let end = v.indexOf('\n', e); if (end === -1) end = v.length;
  const block = v.slice(start, end).split('\n').map((l) => prefix + l).join('\n');
  edBody.value = v.slice(0, start) + block + v.slice(end);
  edBody.focus(); edBody.setSelectionRange(start + prefix.length, start + block.length);
}
const edFmt = {
  h1: () => edLinePrefix('# '),
  h2: () => edLinePrefix('## '),
  bold: () => edSurround('**', '**', 'bold'),
  italic: () => edSurround('*', '*', 'italic'),
  bullet: () => edLinePrefix('- '),
  check: () => edLinePrefix('- [ ] '),
  quote: () => edLinePrefix('> '),
  code: () => edSurround('`', '`', 'code'),
  link: () => edSurround('[[', ']]', 'Note'),
  math: () => edSurround('$', '$', 'x^2'),
  highlight: () => edSurround('==', '==', 'highlight'),
};
// Insert text at the caret (or replacing the selection) — used by the handwriting embed.
function edInsertAtCursor(text) {
  const v = edBody.value, s = edBody.selectionStart, e = edBody.selectionEnd;
  edBody.value = v.slice(0, s) + text + v.slice(e);
  const pos = s + text.length;
  edBody.focus(); edBody.setSelectionRange(pos, pos);
}
// Open the ink canvas (math / practice handwriting); on Done, store the PNG in the vault and
// embed it at the caret. history:false so the InkPad back-handling leaves the editor overlay alone.
function edInsertHandwriting() {
  window.InkPad.open(async (blob) => {
    try {
      const fd = new FormData();
      fd.append('photo', blob, 'handwriting.png');
      const { ref } = await api('/api/upload/handwriting', { method: 'POST', body: fd });
      edInsertAtCursor(`\n\n![[${ref}]]\n\n`);
      toast('Handwriting added');
    } catch (e) { toast(e.message); }
  }, { history: false });
}

// mousedown-preventDefault keeps the textarea selection alive when a toolbar button is tapped.
$('#editor-toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('.fmt')) e.preventDefault(); });
$('#editor-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('.fmt'); if (!b) return;
  if (b.dataset.fmt === 'ink') { edInsertHandwriting(); return; }
  (edFmt[b.dataset.fmt] || (() => {}))();
});

// What gets previewed/saved. In edit mode the body is the full note (H1 included), so use it
// verbatim; in create mode the title becomes the H1 when the body has no heading yet.
function editorMarkdown() {
  const body = edBody.value;
  if (edMode === 'edit') return body;
  const title = edTitle.value.trim();
  return (title && !/^#\s/.test(body.trim())) ? `# ${title}\n\n${body}` : body;
}
function showEditorSource() {
  edPreviewing = false;
  edBody.hidden = false; $('#editor-preview').hidden = true; $('#editor-toolbar').hidden = false;
  $('#editor-preview-toggle').querySelector('span').textContent = 'Preview';
}
function showEditorPreview() {
  edPreviewing = true;
  $('#editor-preview').innerHTML = mdToHtml(editorMarkdown());
  $('#editor-preview').hidden = false; edBody.hidden = true; $('#editor-toolbar').hidden = true;
  $('#editor-preview-toggle').querySelector('span').textContent = 'Edit';
}
$('#editor-preview-toggle').addEventListener('click', () => (edPreviewing ? showEditorSource() : showEditorPreview()));

// Edit mode hides the folder picker (path is fixed) and locks the title (the H1 lives in the body).
function setEditorMode(mode) {
  edMode = mode;
  const editing = mode === 'edit';
  edTitle.readOnly = editing;
  $('.editor-folder-label').hidden = editing;
}
function showEditor() {
  showEditorSource();
  if (!editorOpen) { history.pushState({ editor: true }, ''); editorOpen = true; }
  $('#editor').hidden = false;
}

// New note (create mode).
async function openEditor() {
  setEditorMode('create'); edPath = null;
  edTitle.value = ''; edBody.value = ''; $('#editor-folder').value = 'Drafts';
  try {
    const { folders } = await api('/api/folders');
    $('#editor-folders').innerHTML = folders.map((f) => `<option value="${esc(f)}">`).join('');
  } catch {}
  showEditor();
  edTitle.focus();
}

// Edit an existing note in place (edit mode).
async function openEditorFor(path, name) {
  try {
    const { content } = await api('/api/note?path=' + encodeURIComponent(path));
    setEditorMode('edit'); edPath = path;
    edTitle.value = name || path.split('/').pop().replace(/\.md$/, '');
    edBody.value = content.replace(/\r/g, '');
    showEditor();
    edBody.focus();
  } catch (e) { toast(e.message); }
}

function closeEditor() {
  if (!editorOpen) return;
  // Delegate to the shared popstate handler (closes the topmost overlay only) so cancelling an
  // edit returns to the reader underneath instead of tearing both overlays down.
  if (history.state && history.state.editor) history.back();
  else { editorOpen = false; $('#editor').hidden = true; }
}
$('#btn-new-note').addEventListener('click', openEditor);
$('#editor-cancel').addEventListener('click', closeEditor);

$('#editor-save').addEventListener('click', async () => {
  if (!edBody.value.trim()) { toast('Write something first'); return; }
  try {
    let path, name;
    if (edMode === 'edit') {
      ({ path } = await api('/api/note/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: edPath, content: edBody.value }),
      }));
      name = edTitle.value.trim() || path.split('/').pop().replace(/\.md$/, '');
    } else {
      const title = edTitle.value.trim();
      if (!title) { toast('Add a title'); edTitle.focus(); return; }
      ({ path } = await api('/api/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, folder: $('#editor-folder').value.trim() || 'Drafts', content: edBody.value }),
      }));
      name = title;
    }
    // Hide without history.back() — we're about to (re)open the reader; a deferred popstate would
    // otherwise race its pushState. (Any stray history entry is harmless.)
    $('#editor').hidden = true; editorOpen = false;
    state.notes = []; await loadNotes(true);
    toast(edMode === 'edit' ? 'Note updated' : 'Note saved');
    openNote(path, name);
  } catch (e) { toast(e.message); }
});

/* ---------- Plan (list) + Calendar ---------- */
const todayStr = () => new Date().toISOString().slice(0, 10);

async function loadPlan() {
  $('#plan-list').hidden = state.planView !== 'list';
  $('#plan-calendar').hidden = state.planView !== 'calendar';
  $$('#plan-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.planView === state.planView));
  try {
    const [{ tasks }, cal] = await Promise.all([
      api('/api/tasks'),
      state.planView === 'calendar' ? api('/api/calendar') : Promise.resolve({ events: [] }),
    ]);
    state.tasks = tasks;
    state.events = cal.events || [];
    if (state.planView === 'calendar') renderCalendar();
    else renderPlanList(tasks);
  } catch (e) { toast(e.message); }
}

// One reusable task row that toggles its checkbox and reloads.
function taskRow(t) {
  const overdue = !t.done && t.date && t.date < todayStr();
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
  return el;
}

function renderPlanList(tasks) {
  const wrap = $('#plan-groups'); wrap.innerHTML = '';
  $('#plan-empty').hidden = tasks.length > 0;
  const today = todayStr();
  const groups = { Overdue: [], Today: [], Upcoming: [], Undated: [], Done: [] };
  for (const t of tasks) {
    if (t.done) groups.Done.push(t);
    else if (!t.date) groups.Undated.push(t);
    else if (t.date < today) groups.Overdue.push(t);
    else if (t.date === today) groups.Today.push(t);
    else groups.Upcoming.push(t);
  }
  // Unchecked, not-overdue tasks: soonest deadline first.
  groups.Upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  for (const [name, arr] of Object.entries(groups)) {
    if (!arr.length) continue;
    const g = document.createElement('div'); g.className = 'plan-group';
    g.innerHTML = `<h3>${name} · ${arr.length}</h3>`;
    for (const t of arr) g.appendChild(taskRow(t));
    wrap.appendChild(g);
  }
}

/* ----- Calendar grid ----- */
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function renderCalendar() {
  if (!state.calMonth) { const n = new Date(); state.calMonth = { y: n.getFullYear(), m: n.getMonth() }; }
  const { y, m } = state.calMonth;
  $('#cal-title').textContent = `${MON[m]} ${y}`;

  // Bucket tasks + events by date.
  const byDate = {};
  const add = (date, item) => { (byDate[date] = byDate[date] || []).push(item); };
  for (const t of (state.tasks || [])) if (t.date) add(t.date, { kind: 'task', t });
  for (const e of (state.events || [])) if (e.date) add(e.date, { kind: 'event', e });

  // Grid starts on Monday.
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  const start = new Date(y, m, 1 - startOffset);
  const today = todayStr();
  const grid = $('#cal-grid'); grid.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = ymd(d);
    const items = byDate[ds] || [];
    const cell = document.createElement('button');
    cell.className = 'cal-cell'
      + (d.getMonth() !== m ? ' other' : '')
      + (ds === today ? ' today' : '')
      + ([0, 6].includes(d.getDay()) ? ' weekend' : '')
      + (state.calSelected === ds ? ' sel' : '');
    const dots = items.slice(0, 3).map((it) =>
      `<i class="cal-dot ${it.kind === 'event' ? 'ev' : (it.t.done ? 'done' : 'tk')}"></i>`).join('');
    cell.innerHTML = `<span class="cal-num">${d.getDate()}</span><span class="cal-dots">${dots}</span>`;
    cell.addEventListener('click', () => { state.calSelected = ds; renderCalendar(); });
    grid.appendChild(cell);
  }
  renderAgenda(byDate[state.calSelected] || [], state.calSelected);
}

function renderAgenda(items, date) {
  const wrap = $('#cal-agenda'); wrap.innerHTML = '';
  if (!date) { wrap.innerHTML = '<p class="hint">Tap a day to see what\'s on.</p>'; return; }
  const h = document.createElement('h3'); h.className = 'cal-agenda-h'; h.textContent = fmtDate(date);
  wrap.appendChild(h);
  if (!items.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Nothing scheduled.'; wrap.appendChild(p); return; }
  for (const it of items) {
    if (it.kind === 'task') { wrap.appendChild(taskRow(it.t)); continue; }
    const e = it.e;
    const el = document.createElement('div');
    el.className = 'cal-event';
    el.innerHTML = `<span class="cal-ev-time">${e.time ? esc(e.time) : 'all-day'}</span>
      <div class="cal-ev-title">${esc(e.title || '(untitled)')}</div>`;
    wrap.appendChild(el);
  }
}

// Plan view toggle + calendar nav.
$('#plan-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  state.planView = b.dataset.planView; loadPlan();
});
$('#cal-prev').addEventListener('click', () => { stepMonth(-1); });
$('#cal-next').addEventListener('click', () => { stepMonth(1); });
$('#cal-today').addEventListener('click', () => {
  const n = new Date(); state.calMonth = { y: n.getFullYear(), m: n.getMonth() }; state.calSelected = todayStr(); renderCalendar();
});
function stepMonth(delta) {
  const { y, m } = state.calMonth || { y: new Date().getFullYear(), m: new Date().getMonth() };
  const d = new Date(y, m + delta, 1); state.calMonth = { y: d.getFullYear(), m: d.getMonth() }; renderCalendar();
}
$('#cal-sync').addEventListener('click', () => {
  startStream('/api/calsync/stream', {
    title: 'Syncing Google Calendar…',
    onDone: async (_out, code) => { if (code === 0) { const { events } = await api('/api/calendar'); state.events = events || []; renderCalendar(); toast('Calendar synced'); } },
  });
});

/* ---------- Chat (read-only advisor — lives on the Capture page) ---------- */
// Capture ⇄ Chat toggle.
$('#capture-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  const chat = b.dataset.cap === 'chat';
  $$('#capture-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('#capture-main').hidden = chat;
  $('#capture-chat').hidden = !chat;
  $('#chat-clear').hidden = !chat;
  if (chat) { renderChat(); setTimeout(() => $('#chat-input').focus(), 50); }
});
function renderChat() {
  const thread = $('#chat-thread');
  $('#chat-intro').hidden = state.chat.length > 0;
  // Remove existing bubbles (keep the intro node).
  thread.querySelectorAll('.bubble').forEach((b) => b.remove());
  for (const m of state.chat) {
    const b = document.createElement('div');
    b.className = 'bubble ' + (m.role === 'user' ? 'me' : 'ai');
    b.innerHTML = m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>')
      : (m.text ? mdToHtml(m.text) : '<span class="typing">…</span>');
    if (m.role === 'ai') bindWikilinks(b);
    thread.appendChild(b);
  }
  thread.scrollTop = thread.scrollHeight;
}
async function sendChat(text) {
  const q = (text || '').trim();
  if (!q || state.chatBusy) return;
  state.chat.push({ role: 'user', text: q });
  const ai = { role: 'ai', text: '' };
  state.chat.push(ai);
  state.chatBusy = true;
  $('#chat-input').value = '';
  $('#chat-send').disabled = true;
  renderChat();
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // Send the prior turns + this one (server caps to the last 8).
      body: JSON.stringify({ messages: state.chat.filter((m) => m.text || m.role === 'user').map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })) }),
    });
    if (!resp.ok || !resp.body) throw new Error('chat failed (' + resp.status + ')');
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ai.text += dec.decode(value, { stream: true });
      renderChat();
    }
    if (!ai.text.trim()) ai.text = '_(no answer)_';
  } catch (e) {
    ai.text = '⚠️ ' + e.message;
  } finally {
    state.chatBusy = false;
    $('#chat-send').disabled = false;
    renderChat();
    $('#chat-input').focus();
  }
}
$('#chat-bar').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('#chat-input').value); });
$('#chat-clear').addEventListener('click', () => { state.chat = []; renderChat(); });
// Suggestion chips (delegated; they live inside the intro).
$('#chat-thread').addEventListener('click', (e) => {
  const s = e.target.closest('.suggest');
  if (s) sendChat(s.textContent);
});

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
    const fb = config.fallback || {};
    $('#cfg-fb-baseUrl').value = fb.baseUrl || '';
    $('#cfg-fb-apiKey').value = fb.apiKey || '';
    $('#cfg-fb-model').value = fb.model || '';
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
        fallback: {
          baseUrl: $('#cfg-fb-baseUrl').value.trim(),
          apiKey: $('#cfg-fb-apiKey').value.trim(),
          model: $('#cfg-fb-model').value.trim(),
        },
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

// Render one LaTeX span with KaTeX; degrade to the raw source if KaTeX missing/invalid.
function renderTeX(tex, display) {
  if (window.katex) {
    try { return window.katex.renderToString(tex, { displayMode: display, throwOnError: false }); }
    catch { /* fall through to literal */ }
  }
  const d = display ? '$$' : '$';
  return `<code>${esc(d + tex + d)}</code>`;
}

// Minimal markdown → HTML (headings, bold/italic, code, lists, links, wikilinks, tags, images, math).
// Code and LaTeX math are pulled out into placeholders first so the markdown regexes below can't
// mangle them (a `$x_i$` or `$a*b$` would otherwise trip the italic/bold rules), then restored last.
function mdToHtml(md) {
  md = md.replace(/\r/g, '');
  const slots = [];
  // `@@n@@` token: survives esc() and every markdown regex below, and won't occur in real note text.
  const stash = (html) => `@@${slots.push(html) - 1}@@`;

  // 1) fenced code blocks  2) block math $$…$$ (may span lines)
  md = md.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body) => stash('<pre>' + esc(body.replace(/\n$/, '')) + '</pre>'));
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => stash(renderTeX(tex.trim(), true)));
  // 3) inline code  4) inline math $…$ — heuristics avoid eating currency ($5 … $10)
  md = md.replace(/`([^`]+)`/g, (_m, c) => stash('<code>' + esc(c) + '</code>'));
  md = md.replace(/\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)/g, (_m, tex) => stash(renderTeX(tex.trim(), false)));

  const lines = md.split('\n');
  let html = '', inList = false;
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
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)(#[A-Za-z][\w-]*)/g, '$1<span class="tag">$2</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) { closeList(); const lvl = line.match(/^#+/)[0].length; html += `<h${lvl}>${inline(line.replace(/^#+\s/, ''))}</h${lvl}>`; }
    else if (/^\s*[-*]\s\[[ xX]\]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } const done = /\[[xX]\]/.test(line); html += `<li>${done ? '☑' : '☐'} ${inline(line.replace(/^\s*[-*]\s\[[ xX]\]\s/, ''))}</li>`; }
    else if (/^\s*[-*]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s/, ''))}</li>`; }
    else if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; }
    else if (line.trim() === '---') { closeList(); html += '<hr>'; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html.replace(/@@(\d+)@@/g, (_m, n) => slots[+n]);
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
