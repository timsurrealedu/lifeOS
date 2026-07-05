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

const state = { inbox: [], notes: [], folders: null, systemFolders: [], stagingFolders: [], showStaging: false, view: 'capture', pendingPhoto: null, pendingPhotoKind: null, pendingStrokes: null, pendingDoc: null, graph: null, expandedFolders: new Set(), readerPath: null, readerContent: '', chat: [], chatBusy: false, noteChat: [], noteChatBusy: false, planView: 'list', calMonth: null };

/* ---------- Preferences (theme + editor) — persisted locally ---------- */
const THEMES = ['dark', 'light', 'netrunner'];
const THEME_BG = { dark: '#15110d', light: '#f7f4ee', netrunner: '#07090d' };
const WIDTHS = ['narrow', 'default', 'wide', 'full'];
const WIDTH_PX = { narrow: '560px', default: 'var(--max)', wide: '960px', full: 'none' };
const prefs = {
  get theme() { return localStorage.getItem('lifeos.theme') || 'light'; },
  get vim() { return localStorage.getItem('lifeos.vim') === '1'; },
  get lineno() { return localStorage.getItem('lifeos.lineno') === '1'; },
  get livepreview() { return localStorage.getItem('lifeos.livepreview') !== '0'; }, // default on
  get noteWidth() { return localStorage.getItem('lifeos.noteWidth') || 'default'; },
  get codeWidth() { return localStorage.getItem('lifeos.codeWidth') || 'full'; },
  get manualProvider() { return localStorage.getItem('lifeos.manualProvider') || 'default'; },
  set(key, val) { localStorage.setItem('lifeos.' + key, val); },
};
function applyTheme(name) {
  if (name === 'cyberpunk' || name === 'silverhand' || name === 'arasaka') name = 'netrunner'; // migrate old values
  if (!THEMES.includes(name)) name = 'dark';
  prefs.set('theme', name);
  const root = document.documentElement;
  if (name === 'dark') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', name);
  const meta = $('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', THEME_BG[name]);
  $$('#theme-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.themeOpt === name));
}
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
  applyTheme(next);
  toast('Theme: ' + next[0].toUpperCase() + next.slice(1));
}
function applyWidth(kind, name) {
  if (!WIDTHS.includes(name)) name = kind === 'code' ? 'full' : 'default';
  prefs.set(kind + 'Width', name);
  document.documentElement.style.setProperty('--' + kind + '-w', WIDTH_PX[name]);
  $$('#' + kind + '-width-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.widthOpt === name));
}

/* ---------- Navigation ----------
   Bottom tabs map to internal views. "browse" is the merged Notes+Graph view.
   New notes are created from Browse's "+ New" or the reader sidebar. */
const TAB_VIEW = { inbox: 'capture', browse: 'notes', plan: 'plan' };
function show(tab) {
  if (tab !== 'code') state.prevTab = tab;                   // Code is full-screen; Back returns here
  const view = TAB_VIEW[tab] || tab;                         // 'discover' passes through
  state.view = view;
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  if (view === 'capture') renderInbox();
  if (view === 'discover') loadDiscover();
  if (view === 'notes') loadNotes();
  if (view === 'plan') loadPlan();
  if (view === 'code') loadCode();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));

// Inbox ⇄ Chat toggle (one view, like Browse's Files/Graph).
$('#capture-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  const chat = b.dataset.cap === 'chat';
  $$('#capture-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('.view[data-view="capture"]').classList.toggle('chat-mode', chat);  // fills the scroll area → input bar pins above the tab bar
  $('#capture-main').hidden = chat;
  $('#capture-chat-panel').hidden = !chat;
  $('#capture-title').textContent = chat ? 'Chat' : 'Inbox';
  if (chat) { $('#cap-crumb').textContent = 'Advisor'; renderChat(); }
  else if (window._capTick) window._capTick(); // repaint day/date now, not after the next 15s tick
});

// Browse: Files ⇄ Graph toggle (same page, like the mockup).
$('#browse-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  const g = b.dataset.browse === 'graph';
  $$('#browse-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('#browse-files').hidden = g;
  $('#browse-graph').hidden = !g;
  $('#btn-new-note').hidden = g;
  $('#browse-nodes').hidden = !g;
  $('#browse-title').textContent = g ? 'Graph' : 'Browse';
  $('#browse-crumb').textContent = g ? 'Vault · Graph' : ('Vault · ' + state.notes.length + ' notes');
  if (g) loadGraph();
});

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

/* ---------- In-app confirm/prompt (replaces window.confirm()/prompt() with the app's own chrome) ---------- */
const appDialog = $('#app-dialog');
const appDialogMsg = $('#app-dialog-msg');
const appDialogInput = $('#app-dialog-input');
const appDialogOk = $('#app-dialog-ok');
appDialog.addEventListener('click', (e) => { if (e.target === appDialog) appDialog.close(); }); // click backdrop → cancel
$('#app-dialog-cancel').addEventListener('click', () => appDialog.close());
function showAppDialog(message, { input = false, value = '', okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    appDialog.returnValue = '';  // dialog.close() with no arg keeps the LAST returnValue otherwise —
                                 // without this reset, Cancel/Esc after a prior "ok" would resolve true.
    appDialogMsg.textContent = message;
    appDialogInput.hidden = !input;
    appDialogInput.value = value;
    appDialogOk.textContent = okLabel;
    appDialogOk.classList.toggle('danger', danger);
    appDialog.addEventListener('close', function onClose() {
      appDialog.removeEventListener('close', onClose);
      const ok = appDialog.returnValue === 'ok';
      resolve(input ? (ok ? appDialogInput.value.trim() : null) : ok);
    }, { once: true });
    appDialog.showModal();
    if (input) { appDialogInput.focus(); appDialogInput.select(); }
    else appDialogOk.focus();
  });
}
const appConfirm = (message, opts) => showAppDialog(message, opts);
const appPrompt = (message, value = '') => showAppDialog(message, { input: true, value });
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'close-sheet') closeSheets();
  if (act === 'close-camera') closeCamera();
  if (act === 'open-log') openLog();
  if (act === 'open-settings') openSettings();
  if (act === 'cycle-theme') cycleTheme();
  if (act === 'open-discover') show('discover');
  if (act === 'open-inbox') show('inbox');
});

// Theme picker inside Settings.
$('#theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  applyTheme(b.dataset.themeOpt);
});
// Reading/writing width pickers inside Settings.
$('#note-width-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  applyWidth('note', b.dataset.widthOpt);
});
$('#code-width-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  applyWidth('code', b.dataset.widthOpt);
});

/* ---------- Capture ---------- */
const textEl = $('#capture-text');

// Grow the dump box to fit its content (new lines push it taller, up to the CSS max-height).
// `input` covers typing/paste; programmatic changes (voice, clearing) call it directly.
function autoGrow() { textEl.style.height = 'auto'; textEl.style.height = textEl.scrollHeight + 'px'; }
textEl.addEventListener('input', autoGrow);

// Draft persistence: an interrupted capture (app backgrounded/reloaded mid-type) shouldn't lose the
// text — the whole point of the inbox is that capturing never costs a second thought.
const DRAFT_KEY = 'lifeos.captureDraft';
textEl.value = localStorage.getItem(DRAFT_KEY) || '';
if (textEl.value) autoGrow();
textEl.addEventListener('input', () => {
  if (textEl.value) localStorage.setItem(DRAFT_KEY, textEl.value);
  else localStorage.removeItem(DRAFT_KEY);
});
function clearCaptureText() { textEl.value = ''; autoGrow(); localStorage.removeItem(DRAFT_KEY); }

// Preview helpers (shared by photo / camera / recording)
function resetCapture() {
  state.pendingPhoto = null; state.pendingPhotoKind = null; state.pendingStrokes = null; state.pendingDoc = null;
  for (const id of ['#photo-preview', '#doc-preview']) { const p = $(id); p.classList.add('hidden'); p.innerHTML = ''; }
  $('#attach-input').value = '';
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
}
const fmtBytes = (n) => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const docEmoji = (name) => /\.pdf$/i.test(name) ? '📕'
  : /\.(ppt|pptx|key)$/i.test(name) ? '📙'
  : /\.(doc|docx|odt)$/i.test(name) ? '📘'
  : /\.(xls|xlsx|csv|ods)$/i.test(name) ? '📗' : '📄';
function showDocPreview(file) {
  state.pendingDoc = file;
  const pv = $('#doc-preview'); pv.innerHTML = '';
  const chip = document.createElement('div'); chip.className = 'doc-chip';
  chip.innerHTML = `<span class="doc-ico">${docEmoji(file.name)}</span>
    <span class="doc-name">${esc(file.name)}</span>
    <span class="doc-size">${fmtBytes(file.size)}</span>`;
  pv.append(chip, discardBtn());
  pv.classList.remove('hidden');
}

$('#btn-add').addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (state.pendingPhoto) { await uploadPhoto(text); return; }
  if (state.pendingDoc) { await uploadDocument(text); return; }
  if (!text) { toast('Nothing to add'); return; }
  try {
    const { items } = await api('/api/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    state.inbox = items; clearCaptureText(); updateInboxCount(); renderInbox();
    toast('Added to inbox');
  } catch (e) { toast(e.message); }
});

// Attach (one picker for existing files — images ride the photo path, docs the document path).
$('#attach-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if ((file.type || '').startsWith('image/')) {
    showPhotoPreview(file);
    toast('Photo ready — add a hint above (optional)');
    return;
  }
  if (file.size > 25 * 1024 * 1024) { toast('File too large (max 25 MB)'); $('#attach-input').value = ''; return; }
  showDocPreview(file);
  toast('File ready — add a hint above (optional)');
});
async function uploadDocument(hint) {
  const file = state.pendingDoc;
  const fd = new FormData();
  fd.append('document', file, file.name);
  if (hint) fd.append('hint', hint);
  try {
    const { items } = await api('/api/capture/document', { method: 'POST', body: fd });
    state.inbox = items; updateInboxCount(); renderInbox(); clearCaptureText();
    resetCapture();
    toast('File added to inbox');
  } catch (e) { toast(e.message); }
}

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
  if (handwriting && state.pendingStrokes) fd.append('strokes', JSON.stringify(state.pendingStrokes)); // re-edit sidecar
  try {
    const { items } = await api(url, { method: 'POST', body: fd });
    state.inbox = items; updateInboxCount(); renderInbox(); clearCaptureText();
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
  window.InkPad.open(({ blob, strokes }) => {
    showPhotoPreview(blob);
    state.pendingPhotoKind = 'handwriting';
    state.pendingStrokes = strokes;           // saved alongside the PNG so the page stays re-editable
    toast('Handwriting ready — add a hint (optional)');
  });
});

/* ---------- Claude runs (SSE) ---------- */
// Settings has one shared "run manually via" provider picker (Claude/Qwen/DeepSeek) that every
// manual trigger below (Process inbox, Weekly review, Refresh home, Auto-sort, Calendar sync) reads
// before starting — so testing/forcing a fallback doesn't need a separate button per job.
const manualProvider = () => { const v = $('#cfg-manual-provider')?.value; return v && v !== 'default' ? v : undefined; };
const withProvider = (url) => { const p = manualProvider(); return p ? url + '?provider=' + encodeURIComponent(p) : url; };
$('#btn-process').addEventListener('click', () => startProcess(manualProvider()));

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
    else if (d.state === 'fallback-retry' || d.state === 'fallback') append('⤷ ' + (d.message || `via ${d.provider || 'fallback'}${d.model ? ' · ' + d.model : ''}`), 'info');
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

// provider (optional, 'Qwen'/'DeepSeek') → force the run through that fallback to test it.
function startProcess(provider) {
  const url = '/api/process/stream' + (provider ? '?provider=' + encodeURIComponent(provider) : '');
  startStream(url, { title: provider ? `Testing ${provider}…` : 'Processing inbox…', onDone: (_out, _code, info) => afterProcess(info) });
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

// Find = AI semantic search. Describe what you want ("that note about tax deadlines"), and the model
// greps/reads the vault and returns the notes that match the *meaning*. (Plain text search now lives
// in the Notes tab.) Hits POST /api/ai-search, which validates the returned paths against the vault.
$('#btn-find').addEventListener('click', runFind);
$('#find-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runFind(); });
async function runFind() {
  const q = $('#find-input').value.trim();
  const ul = $('#find-results');
  const btn = $('#btn-find');
  if (!q) { ul.innerHTML = ''; toast('Describe what you’re looking for'); return; }
  ul.innerHTML = '<li class="empty small">🔮 Searching your vault…</li>';
  btn.disabled = true;
  try {
    const { results } = await api('/api/ai-search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }),
    });
    ul.innerHTML = '';
    if (!results.length) { ul.innerHTML = '<li class="empty small">No relevant notes found.</li>'; return; }
    for (const n of results) {
      const li = document.createElement('li');
      li.className = 'list-item';
      const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join(' / ') : '·';
      li.innerHTML = `<span class="li-emoji">📄</span>
        <div class="li-main"><div class="li-title">${esc(n.name)}</div>
        <div class="li-sub">${esc(folder)}</div>
        ${n.reason ? `<div class="li-snip">${esc(n.reason)}</div>` : ''}</div>`;
      li.addEventListener('click', () => openNote(n.path, n.name));
      ul.appendChild(li);
    }
  } catch (e) { ul.innerHTML = ''; toast(e.message); }
  finally { btn.disabled = false; }
}

$('#btn-weekly').addEventListener('click', () =>
  startStream(withProvider('/api/review/stream'), { title: 'Weekly review…', onDone: () => { state.notes = []; } }));
$('#btn-home').addEventListener('click', () =>
  startStream(withProvider('/api/home/stream'), { title: 'Refreshing Home note…', onDone: () => { state.notes = []; } }));

async function loadDiscover() {
  try {
    const [needs, ideas] = await Promise.all([api('/api/needs-filing'), api('/api/ideas')]);
    state.ideas = ideas.items || [];
    state.needs = needs.items || [];
    const ni = state.needs.length;
    $('#needs-sub').textContent = `${ni} note${ni === 1 ? '' : 's'} tagged #needs-filing await a home`;
    const latest = state.ideas[0];
    $('#ideas-sub').textContent = `Ideas/ · ${state.ideas.length} note${state.ideas.length === 1 ? '' : 's'}`
      + (latest ? ` · latest: “${latest.name}”` : '');
  } catch (e) { toast(e.message); }
}
// Idea bank → open the latest idea. Needs filing → Browse filtered to the #needs-filing tag.
$('#tile-ideas').addEventListener('click', () => {
  const latest = (state.ideas || [])[0];
  if (latest) openNote(latest.path, latest.name); else toast('No ideas yet — research one above');
});
$('#tile-needs').addEventListener('click', () => searchByTag('needs-filing'));
// Playground → JupyterLab, running on the same box over Tailscale (port 8888). New tab, not iframed
// (Jupyter sets X-Frame-Options and the SW would fight it). ponytail: link out, don't embed.
$('#tile-playground').addEventListener('click', () => {
  window.open(`${location.protocol}//${location.hostname}:8888`, '_blank');
});
// Editor → LazyVim (Neovim) served by ttyd on the same box over Tailscale (port 7681). New tab.
$('#tile-editor').addEventListener('click', () => {
  window.open(`${location.protocol}//${location.hostname}:7681`, '_blank');
});

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
  if (/#document|!\[\[[^\]]+\.(pdf|docx?|pptx?|xlsx?|csv|txt)\]\]/i.test(item)) return '📎';
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
    const [{ notes }, { folders, systemFolders, stagingFolders }] = await Promise.all([api('/api/notes'), api('/api/folders')]);
    state.notes = notes; state.folders = folders; state.systemFolders = systemFolders || []; state.stagingFolders = stagingFolders || []; renderNotes();
  } catch (e) { toast(e.message); }
}

async function deleteNotePath(path, name) {
  if (!(await appConfirm(`Delete note "${name}"? This can't be undone.`, { okLabel: 'Delete', danger: true }))) return;
  try {
    await api('/api/note?path=' + encodeURIComponent(path), { method: 'DELETE' });
    state.notes = []; await loadNotes(true);
    toast('Note deleted');
  } catch (e) { toast(e.message); }
}

async function deleteFolderPath(path, count) {
  const warn = count > 0 ? `\n\nThis folder has ${count} note${count > 1 ? 's' : ''} — they'll be deleted too.` : '';
  if (!(await appConfirm(`Delete folder "${path}"?${warn}\nThis can't be undone.`, { okLabel: 'Delete', danger: true }))) return;
  try {
    await api('/api/folder?path=' + encodeURIComponent(path), { method: 'DELETE' });
    state.expandedFolders.delete(path);
    state.notes = []; state.folders = null; await loadNotes(true);
    toast('Folder deleted');
  } catch (e) { toast(e.message); }
}
function renderNotes() {
  if (!$('#browse-graph') || $('#browse-graph').hidden) $('#browse-crumb').textContent = 'Vault · ' + state.notes.length + ' notes';
  const q = $('#notes-search').value.toLowerCase().trim();
  const ul = $('#notes-list'); ul.innerHTML = '';
  $('#notes-empty').hidden = state.notes.length > 0;

  // Searching → flat, filtered list (with the folder path so cross-folder hits make sense).
  // A leading `#` searches tags only; otherwise we match name, path AND tags.
  if (q) {
    ul.className = 'list';
    const tagOnly = q.startsWith('#');
    const needle = tagOnly ? q.slice(1) : q;
    const list = state.notes.filter((n) => {
      const tags = (n.tags || []).map((t) => t.toLowerCase());
      if (tagOnly) return tags.some((t) => t.includes(needle));
      return n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || tags.some((t) => t.includes(q));
    });
    for (const n of list) {
      const li = document.createElement('li');
      li.className = 'list-item';
      const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join(' / ') : '·';
      const tagStr = (n.tags || []).length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : '';
      li.innerHTML = `<span class="li-emoji">📄</span>
        <div class="li-main"><div class="li-title">${esc(n.name)}</div><div class="li-sub">${esc(folder)} · ${timeAgo(n.mtime)}${esc(tagStr)}</div></div>`;
      li.addEventListener('click', () => openNote(n.path, n.name));
      ul.appendChild(li);
    }
    return;
  }

  // Default → collapsible folder tree, so courses/areas stay grouped.
  ul.className = 'tree';
  renderTreeInto(buildTree(state.notes, state.folders || []), 0, ul);
}

// AI-only staging folders (Captures, Drafts) are hidden from the tree unless state.showStaging —
// they're processing scratch space, not content the user browses (see the toggle in the Browse
// actions row). Matched on the top-level segment only.
function buildTree(notes, folders = []) {
  const hidden = state.showStaging ? new Set() : new Set(state.stagingFolders);
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
  for (const f of folders) { if (hidden.has(f.split('/')[0])) continue; ensureDir(f.split('/')); }
  for (const n of notes) {
    const parts = n.path.split('/');
    parts.pop(); // filename
    if (hidden.has(parts[0])) continue;
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
    const isSystem = state.systemFolders.includes(d.name);
    const li = document.createElement('li');
    li.className = 'tree-row tree-folder' + (isSystem ? ' tree-system' : '');
    li.style.paddingLeft = pad + 'px';
    li.dataset.path = d.path; li.dataset.type = 'folder'; li.dataset.name = d.name;
    // System folders get a lock + "system" tag and no delete button (lifeOS relies on them).
    li.innerHTML = `<span class="tw-caret">${open ? '▾' : '▸'}</span>
      <span class="li-emoji">${open ? '📂' : '📁'}</span>
      <div class="li-main"><div class="li-title">${esc(d.name)}${isSystem ? '<span class="sys-tag">🔒 system</span>' : ''}</div></div>
      <button class="tw-add" aria-label="new note or subfolder here" title="New note / subfolder here">＋</button>
      <span class="tw-count">${countFiles(d)}</span>
      ${isSystem ? '' : '<button class="tw-del" aria-label="delete folder" title="Delete folder">✕</button>'}`;
    li.addEventListener('click', () => {
      if (open) state.expandedFolders.delete(d.path); else state.expandedFolders.add(d.path);
      renderNotes();
    });
    li.querySelector('.tw-add').addEventListener('click', (e) => { e.stopPropagation(); createInFolder(d.path); });
    const del = li.querySelector('.tw-del');
    if (del) del.addEventListener('click', (e) => { e.stopPropagation(); deleteFolderPath(d.path, countFiles(d)); });
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
// Notes search is now full-text (same server search the old Discover "Find" used): empty → folder
// tree, `#tag` → instant client-side tag filter, anything else → debounced server content search.
let notesSearchTimer, notesSearchSeq = 0;
function onNotesSearchInput() {
  const q = $('#notes-search').value.trim();
  clearTimeout(notesSearchTimer);
  if (!q || q.startsWith('#')) { renderNotes(); return; }
  notesSearchTimer = setTimeout(() => runNotesTextSearch(q), 220);
}
async function runNotesTextSearch(q) {
  const ul = $('#notes-list');
  const seq = ++notesSearchSeq;
  ul.className = 'list';
  $('#notes-empty').hidden = true;
  ul.innerHTML = '<li class="empty small">Searching…</li>';
  try {
    const { results } = await api('/api/search?q=' + encodeURIComponent(q));
    if (seq !== notesSearchSeq) return;                       // a newer keystroke already fired
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
  } catch (e) { if (seq === notesSearchSeq) { ul.innerHTML = ''; toast(e.message); } }
}
$('#notes-search').addEventListener('input', onNotesSearchInput);

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
  window.removeEventListener('touchmove', onDragTouchMove, { passive: false });
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
  if (e.target.closest('.tw-del') || e.target.closest('.tw-add')) return; // row action buttons, not a drag
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
  window.addEventListener('touchmove', onDragTouchMove, { passive: false });
}
// Once a row is picked up, stop the page/list from scrolling — otherwise the browser hijacks the
// gesture and fires pointercancel, dropping the drag ("lets go itself" on touch). touch-action:none
// can't do this once the gesture has started, so we preventDefault the touchmove instead.
function onDragTouchMove(e) { if (dragS && dragS.started) e.preventDefault(); }
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

// Toggle visibility of AI-only staging folders (Captures, Drafts) in the Browse tree — see buildTree().
$('#btn-toggle-staging').addEventListener('click', (e) => {
  state.showStaging = !state.showStaging;
  e.currentTarget.textContent = state.showStaging ? '🙉' : '🙈';
  e.currentTarget.title = state.showStaging ? 'Hide AI staging folders' : 'Show AI staging folders (Captures, Drafts)';
  renderNotes();
});

// Create a folder (or nested subfolders via `Parent/Child`). Shows up in the tree immediately.
$('#btn-new-folder').addEventListener('click', async () => {
  const name = await appPrompt('New folder — use / for subfolders, e.g. University/Scientific Computing/UAS');
  if (!name) return;
  try {
    const { path } = await api('/api/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: name }),
    });
    // Expand the whole new chain so the user sees where it landed.
    let acc = '';
    for (const p of path.split('/')) { acc = acc ? acc + '/' + p : p; state.expandedFolders.add(acc); }
    state.notes = []; state.folders = null;
    await loadNotes(true);
    toast('Folder created');
  } catch (e) { toast(e.message); }
});

// Create a note or subfolder INSIDE a specific folder (the tree's ＋). A trailing / makes a subfolder;
// otherwise it opens the editor pre-targeted to that folder so you can write the note straight away.
async function createInFolder(folderPath) {
  const name = await appPrompt(`New in "${folderPath}" — type a note title.\nEnd with / to make a subfolder instead (e.g. "Week 1/").`);
  if (!name) return;
  const v = name;
  if (v.endsWith('/')) {
    const sub = v.replace(/\/+$/, '').trim();
    if (!sub) return;
    try {
      const { path } = await api('/api/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath + '/' + sub }),
      });
      let acc = '';
      for (const p of path.split('/')) { acc = acc ? acc + '/' + p : p; state.expandedFolders.add(acc); }
      state.notes = []; state.folders = null;
      await loadNotes(true);
      toast('Folder created');
    } catch (e) { toast(e.message); }
  } else {
    state.expandedFolders.add(folderPath);
    openEditorInFolder(v, folderPath);
  }
}

/* ---------- Auto-sort (AI proposes → preview → apply) ---------- */
$('#btn-autosort').addEventListener('click', () => {
  startStream(withProvider('/api/autosort/stream'), {
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
  $('#reader-chat').hidden = !path;
  // New note open → drop any prior tutor conversation and collapse the dock.
  state.noteChat = []; closeNoteChat();
  renderReaderProps(path ? state.readerContent : '');
  const body = $('#reader-body');
  body.innerHTML = html;
  bindWikilinks(body); bindImages(body);
  const firstOpen = !readerOpen;
  if (firstOpen) { history.pushState({ reader: true }, ''); readerOpen = true; }
  $('#reader').hidden = false;
  $('#reader-scroll').scrollTop = 0;
  setupReaderSidebar(firstOpen);
}

/* ---- Reader file sidebar (Obsidian-style): switch notes without leaving the reader ---- */
// Renders the same folder tree as the Notes tab into the reader's left dock; clicking a note swaps
// the reader content in place, with the open note highlighted.
function renderReaderTree() {
  const ul = $('#reader-tree'); if (!ul) return;
  ul.innerHTML = '';
  if (!state.notes.length) return;
  renderReaderTreeInto(buildTree(state.notes, state.folders || []), 0, ul);
}
function renderReaderTreeInto(node, depth, ul) {
  const pad = depth * 14 + 10;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const open = state.expandedFolders.has(d.path);
    const li = document.createElement('li');
    li.className = 'tree-row tree-folder';
    li.style.paddingLeft = pad + 'px';
    li.innerHTML = `<span class="tw-caret">${open ? '▾' : '▸'}</span>
      <span class="li-emoji">${open ? '📂' : '📁'}</span>
      <div class="li-main"><div class="li-title">${esc(d.name)}</div></div>
      <button class="tw-add" title="New note / subfolder here" aria-label="New here">＋</button>
      <button class="tw-ren" title="Rename folder" aria-label="Rename folder">✎</button>
      <button class="tw-del" title="Delete folder" aria-label="Delete folder">✕</button>`;
    li.addEventListener('click', () => {
      if (open) state.expandedFolders.delete(d.path); else state.expandedFolders.add(d.path);
      renderReaderTree();
    });
    li.querySelector('.tw-add').addEventListener('click', stop(() => createInFolder(d.path)));
    li.querySelector('.tw-ren').addEventListener('click', stop(() => renameFolderFlow(d.path, d.name)));
    const nested = state.notes.filter((n) => String(n.path).startsWith(d.path + '/')).length;
    li.querySelector('.tw-del').addEventListener('click', stop(() => deleteFolderPath(d.path, nested)));
    ul.appendChild(li);
    if (open) renderReaderTreeInto(d, depth + 1, ul);
  }
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const n of files) {
    const li = document.createElement('li');
    li.className = 'tree-row tree-note' + (n.path === state.readerPath ? ' active' : '');
    li.style.paddingLeft = pad + 'px';
    li.innerHTML = `<span class="tw-caret"></span>
      <span class="li-emoji">📄</span>
      <div class="li-main"><div class="li-title">${esc(n.name)}</div></div>
      <button class="tw-ren" title="Rename note" aria-label="Rename note">✎</button>
      <button class="tw-del" title="Delete note" aria-label="Delete note">✕</button>`;
    li.addEventListener('click', () => {
      openNote(n.path, n.name);
      if (!window.matchMedia('(min-width: 760px)').matches) $('#reader').classList.remove('sidebar-open');
    });
    li.querySelector('.tw-ren').addEventListener('click', stop(() => renameNoteFlow(n.path, n.name)));
    li.querySelector('.tw-del').addEventListener('click', stop(() => deleteNotePath(n.path, n.name)));
    ul.appendChild(li);
  }
}

// Rename flows (used by the reader sidebar tree). Notes reuse /api/note/rename (renames file + H1);
// folders use the new /api/folder/rename. Both refresh the tree and keep the open note in sync.
async function renameNoteFlow(path, curName) {
  const v = await appPrompt('Rename note', curName);
  if (v == null || !v || v === curName) return;
  try {
    const { path: np } = await api('/api/note/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, title: v }),
    });
    if (state.readerPath === path) { state.readerPath = np; $('#reader-title').textContent = v; }
    state.notes = []; await loadNotes(true); renderReaderTree();
    toast('Renamed');
  } catch (e) { toast(e.message); }
}
async function renameFolderFlow(path, curName) {
  const v = await appPrompt('Rename folder', curName);
  if (v == null || !v || v === curName) return;
  try {
    await api('/api/folder/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, name: v }),
    });
    state.notes = []; state.folders = null; await loadNotes(true); renderReaderTree();
    toast('Folder renamed');
  } catch (e) { toast(e.message); }
}
// Apply the sidebar's open/collapsed state and (re)fill its tree. On first open we honour the saved
// desktop-collapse preference and start the mobile drawer closed; switching notes just refreshes it.
function setupReaderSidebar(firstOpen) {
  const reader = $('#reader');
  const desktop = window.matchMedia('(min-width: 760px)').matches;
  if (firstOpen) {
    reader.classList.remove('sidebar-open');
    reader.classList.toggle('sidebar-hidden', desktop && localStorage.getItem('lifeos.readerSidebarHidden') === '1');
  }
  if (state.notes.length) renderReaderTree();
  else loadNotes().then(renderReaderTree).catch(() => {});
}
function toggleReaderSidebar() {
  const reader = $('#reader');
  if (window.matchMedia('(min-width: 760px)').matches) {
    const hidden = reader.classList.toggle('sidebar-hidden');     // collapse → full-screen reading
    localStorage.setItem('lifeos.readerSidebarHidden', hidden ? '1' : '0');
  } else {
    reader.classList.toggle('sidebar-open');                      // mobile drawer
  }
}
$('#reader-sidebar-toggle').addEventListener('click', toggleReaderSidebar);
$('#reader-sidebar-collapse').addEventListener('click', toggleReaderSidebar);

// New note / folder straight from the reader sidebar.
$('#reader-new-note').addEventListener('click', () => openEditor());
$('#reader-new-folder').addEventListener('click', async () => {
  const name = await appPrompt('New folder — use / for subfolders, e.g. University/UAS');
  if (!name) return;
  try {
    const { path } = await api('/api/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name }),
    });
    let acc = '';
    for (const p of path.split('/')) { acc = acc ? acc + '/' + p : p; state.expandedFolders.add(acc); }
    state.notes = []; state.folders = null; await loadNotes(true); renderReaderTree();
    toast('Folder created');
  } catch (e) { toast(e.message); }
});

// Drag the sidebar's right edge to resize; width persists (desktop only). Sets a CSS var the
// sidebar reads, so reader-main (flex:1) reflows to fill the rest.
(function setupReaderSidebarResize() {
  const handle = $('#reader-sidebar-resize'), sidebar = $('#reader-sidebar');
  if (!handle) return;
  const saved = localStorage.getItem('lifeos.readerSidebarW');
  if (saved) document.documentElement.style.setProperty('--reader-sidebar-w', saved + 'px');
  let startX = 0, startW = 0, dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    let w = startW + (e.clientX - startX);
    w = Math.max(180, Math.min(w, 560, window.innerWidth - 300));
    document.documentElement.style.setProperty('--reader-sidebar-w', Math.round(w) + 'px');
  };
  const end = () => {
    if (!dragging) return;
    dragging = false; sidebar.classList.remove('resizing');
    const w = document.documentElement.style.getPropertyValue('--reader-sidebar-w').replace('px', '').trim();
    if (w) localStorage.setItem('lifeos.readerSidebarW', Math.round(parseFloat(w)));
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', end);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (!window.matchMedia('(min-width: 760px)').matches) return;
    dragging = true; startX = e.clientX; startW = sidebar.getBoundingClientRect().width;
    sidebar.classList.add('resizing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', end);
    e.preventDefault();
  });
})();
// Mobile: swipe right (from a generous left-edge zone) opens the file drawer; swipe left closes it.
// Live (Obsidian-style): the drawer tracks the finger frame by frame during the drag, then snaps
// open/closed at release based on how far it got dragged — rather than a fixed gesture that only
// fires once, all-or-nothing, at touchend. (The AI tutor opens only via its 💬 button, not a swipe.)
// Tapping the note area while the drawer is open also closes it (tap-to-dismiss).
(function setupReaderSwipe() {
  const reader = $('#reader');
  const fileDrawer = $('#reader-sidebar');
  const isMobile = () => !window.matchMedia('(min-width: 760px)').matches;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let sx = 0, sy = 0, live = false, mode = null, w = 0;

  function lockIn(m) {
    mode = m;
    w = fileDrawer.offsetWidth;
    fileDrawer.classList.add('dragging');
  }
  function drag(dx) {
    if (mode === 'file-open') fileDrawer.style.transform = `translateX(${clamp(-w + dx, -w, 0)}px)`;
    else if (mode === 'file-close') fileDrawer.style.transform = `translateX(${clamp(dx, -w, 0)}px)`;
  }
  function settle(dx) {
    fileDrawer.classList.remove('dragging'); fileDrawer.style.transform = '';
    if (mode === 'file-open') reader.classList.toggle('sidebar-open', dx > w * 0.35);
    else if (mode === 'file-close') reader.classList.toggle('sidebar-open', dx > -w * 0.35);
    mode = null;
  }

  reader.addEventListener('touchstart', (e) => {
    if (!isMobile() || e.touches.length !== 1) { live = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; live = true; mode = null;
  }, { passive: true });
  reader.addEventListener('touchmove', (e) => {
    if (!live || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!mode) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;  // not a clear horizontal drag yet
      const fileOpen = reader.classList.contains('sidebar-open');
      if (fileOpen && dx < 0) lockIn('file-close');
      else if (!fileOpen && dx > 0 && sx < 120) lockIn('file-open');       // wide left-edge zone
      else { live = false; return; }
    }
    e.preventDefault();
    drag(dx);
  }, { passive: false });
  reader.addEventListener('touchend', (e) => {
    if (!live) return; live = false;
    if (!mode) return;
    settle(e.changedTouches[0].clientX - sx);
  }, { passive: true });
  // Tap the exposed note (outside the drawer) to slide back to it. Capture phase + stop so the
  // dismissing tap doesn't also fire a wikilink/note click underneath.
  reader.addEventListener('click', (e) => {
    if (window.matchMedia('(min-width: 760px)').matches) return;
    if (!reader.classList.contains('sidebar-open')) return;
    if (e.target.closest('.reader-sidebar')) return;                       // taps inside the drawer act normally
    reader.classList.remove('sidebar-open');
    e.stopPropagation(); e.preventDefault();
  }, true);
})();

/* ---- Reader properties / tags header (Obsidian-style) ---- */
// Frontmatter helpers (mirror the server) — notes may declare tags in YAML `tags:` and/or inline #tags.
const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
function splitFM(text) {
  const m = String(text || '').match(FM_RE);
  if (!m) return { fm: '', body: String(text || ''), matched: '' };
  return { fm: m[1], body: String(text).slice(m[0].length), matched: m[0] };
}
function buildFM(fm, body) { return '---\n' + fm.replace(/\n+$/, '') + '\n---\n' + body.replace(/^\n/, ''); }
function fmTags(fm) {
  if (!fm) return [];
  const norm = (s) => String(s).trim().replace(/^["']|["']$/g, '').replace(/^#/, '');
  const out = []; let inTags = false;
  for (const line of fm.split('\n')) {
    const head = line.match(/^([ \t]*)([\w-]+):[ \t]*(.*)$/);
    if (head) {
      inTags = /^tags?$/i.test(head[2]);
      if (inTags && head[3].trim()) {
        let v = head[3].trim(); if (v.startsWith('[')) v = v.replace(/^\[|\]$/g, '');
        v.split(',').map(norm).filter(Boolean).forEach((t) => out.push(t));
        inTags = false;
      }
      continue;
    }
    if (inTags) { const li = line.match(/^[ \t]*-[ \t]*(.+)$/); if (li) { const t = norm(li[1]); if (t) out.push(t); } else if (line.trim()) inTags = false; }
  }
  return out;
}
// All tags on a note — frontmatter `tags:` plus inline #tags (deduped, ordered).
function noteTags(text) {
  const { fm, body } = splitFM(text);
  const out = []; const seen = new Set();
  for (const t of fmTags(fm)) if (!seen.has(t)) { seen.add(t); out.push(t); }
  const clean = body.replace(/```[\s\S]*?```/g, '');
  for (const line of clean.split('\n')) {
    if (/^#{1,6}\s/.test(line)) continue;
    for (const m of line.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}
// Strip a tag wherever it lives (frontmatter array/list/inline value, or an inline body #tag).
function removeTagFromContent(content, tag) {
  const norm = (s) => String(s).trim().replace(/^["']|["']$/g, '').replace(/^#/, '');
  const { fm, body, matched } = splitFM(content);
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const newBody = body.replace(new RegExp('[ \\t]?#' + esc + '(?![\\w/-])', 'g'), '');
  if (!matched) return newBody;
  let inTags = false;
  const fmLines = [];
  for (const line of fm.split('\n')) {
    const head = line.match(/^([ \t]*)([\w-]+):[ \t]*(.*)$/);
    if (head) {
      inTags = /^tags?$/i.test(head[2]);
      if (inTags && head[3].trim()) {
        let v = head[3].trim(); const arr = v.startsWith('[');
        if (arr) v = v.replace(/^\[|\]$/g, '');
        const items = v.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => norm(s) !== tag);
        fmLines.push(`${head[1]}${head[2]}: ${arr ? '[' + items.join(', ') + ']' : items.join(', ')}`);
        inTags = false; continue;
      }
      fmLines.push(line); continue;
    }
    if (inTags) {
      const li = line.match(/^[ \t]*-[ \t]*(.+)$/);
      if (li && norm(li[1]) === tag) continue;       // drop this tag list item
      if (!/^[ \t]*-/.test(line) && line.trim()) inTags = false;
    }
    fmLines.push(line);
  }
  return buildFM(fmLines.join('\n'), newBody);
}
// Strip a `![[ref]]` embed (used when deleting a handwriting attachment) — drops the whole line if
// the embed was the only thing on it, else just removes the embed text inline.
function removeEmbedFromContent(content, ref) {
  const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const embedRe = new RegExp('!\\[\\[' + esc + '(?:\\|[^\\]]*)?\\]\\]');
  const lines = content.split('\n').filter((line) => {
    if (!embedRe.test(line)) return true;
    return line.replace(new RegExp(embedRe.source, 'g'), '').trim() !== '';
  });
  return lines.join('\n').replace(new RegExp(embedRe.source, 'g'), '');
}
// Add a tag — into frontmatter `tags:` when the note has frontmatter, else as an inline #tag.
function addTagToContent(content, tag) {
  const { fm, body, matched } = splitFM(content);
  if (matched) {
    let nf;
    const m = fm.match(/^tags?:[ \t]*(.*)$/im);
    if (m && m[1].trim()) {
      // Inline value: `tags: [a, b]` or `tags: a, b`.
      nf = fm.replace(/^(tags?:[ \t]*)(.*)$/im, (mm, k, v) => {
        v = v.trim();
        if (v.startsWith('[')) { const inner = v.replace(/^\[|\]$/g, '').trim(); return k + '[' + (inner ? inner + ', ' : '') + tag + ']'; }
        return k + v + ', ' + tag;
      });
    } else if (m) {
      // Block-list form: `tags:` followed by `- a` lines → append a matching `- tag` item.
      nf = fm.replace(/^(tags?:[ \t]*\r?\n)((?:[ \t]*-[ \t]*.*\r?\n?)*)/im, (mm, k, items) => {
        const ind = (items.match(/^([ \t]*-[ \t]*)/) || [, '  - '])[1];
        return k + items.replace(/\n+$/, '') + (items.trim() ? '\n' : '') + ind + tag + '\n';
      });
      if (nf === fm) nf = fm.replace(/^(tags?:[ \t]*)$/im, `$1\n  - ${tag}`);
    } else {
      nf = fm.replace(/\n+$/, '') + `\ntags: [${tag}]`;
    }
    return buildFM(nf, body);
  }
  const sep = /\n$/.test(content) ? '' : '\n';
  return content + sep + '\n#' + tag + '\n';
}
function renderReaderProps(content) {
  const props = $('#reader-props');
  if (!state.readerPath) { props.hidden = true; return; }
  props.hidden = false;
  props.classList.toggle('collapsed', localStorage.getItem('lifeos.propsCollapsed') === '1');
  $('#props-toggle').setAttribute('aria-expanded', String(!props.classList.contains('collapsed')));
  const box = $('#reader-tags'); box.innerHTML = '';
  const tags = noteTags(content);
  if (!tags.length) { const s = document.createElement('span'); s.className = 'none'; s.textContent = 'No tags'; box.appendChild(s); }
  for (const t of tags) {
    const pill = document.createElement('span'); pill.className = 'prop-tag';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = '#' + t;
    name.title = 'Search notes tagged #' + t;
    name.addEventListener('click', () => searchByTag(t));
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '✕'; x.title = 'Remove tag';
    x.addEventListener('click', () => removeReaderTag(t));
    pill.append(name, x); box.appendChild(pill);
  }
  const add = document.createElement('button'); add.className = 'prop-add'; add.type = 'button'; add.textContent = '+ Add tag';
  add.addEventListener('click', addReaderTag);
  box.appendChild(add);
}
$('#props-toggle').addEventListener('click', () => {
  const props = $('#reader-props');
  const collapsed = props.classList.toggle('collapsed');
  localStorage.setItem('lifeos.propsCollapsed', collapsed ? '1' : '0');
  $('#props-toggle').setAttribute('aria-expanded', String(!collapsed));
});
// Jump to the Notes view filtered to a tag.
function searchByTag(tag) {
  closeReader();
  show('browse');
  const s = $('#notes-search'); s.value = '#' + tag; renderNotes();
}
// Persist an edited note body, refresh the open reader + tag header.
async function saveReaderContent(newContent, msg) {
  try {
    await api('/api/note/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.readerPath, content: newContent }),
    });
    state.readerContent = newContent;
    const body = $('#reader-body'); body.innerHTML = mdToHtml(newContent); bindWikilinks(body); bindImages(body);
    renderReaderProps(newContent);
    state.notes = []; // tags changed → notes list is stale
    if (msg) toast(msg);
  } catch (e) { toast(e.message); }
}
function removeReaderTag(tag) {
  saveReaderContent(removeTagFromContent(state.readerContent, tag), 'Removed #' + tag);
}
async function addReaderTag() {
  let tag = await appPrompt('Add a tag (without #):');
  if (tag == null) return;
  tag = tag.replace(/^#/, '').replace(/[^\w/-]/g, '');
  if (!tag) return;
  if (noteTags(state.readerContent).includes(tag)) { toast('Already tagged #' + tag); return; }
  saveReaderContent(addTagToContent(state.readerContent, tag), 'Added #' + tag);
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
/* ---------- Per-note tutor chat (read-only) + ➕ add-to-note ---------- */
// On mobile the chat panel is 90vw, leaving a reader sliver visible — tapping it closes the chat.
function noteChatOutsideClose(e) {
  if (window.innerWidth >= 760) return;
  if (e.target.closest('#note-chat') || e.target.closest('#reader-chat')) return;
  closeNoteChat();
}
function closeNoteChat() {
  $('#reader').classList.remove('chat-open');
  $('#note-chat').hidden = true;
  document.removeEventListener('click', noteChatOutsideClose, true);
}
function openNoteChat() {
  if (!state.readerPath) return;
  $('#reader').classList.add('chat-open');
  $('#note-chat').hidden = false;
  document.addEventListener('click', noteChatOutsideClose, true);
  renderNoteChat();
  setTimeout(() => $('#note-chat-input').focus(), 50);
}
$('#reader-chat').addEventListener('click', () => {
  if ($('#note-chat').hidden) openNoteChat(); else closeNoteChat();
});
$('#note-chat-close').addEventListener('click', closeNoteChat);
$('#note-chat-clear').addEventListener('click', () => { state.noteChat = []; renderNoteChat(); });

// Drag a dock's left edge to widen it; the chosen width persists (shared by the note + code tutors).
(function setupChatDocks() {
  const saved = parseInt(localStorage.getItem('noteChatW') || '', 10);
  if (saved) document.documentElement.style.setProperty('--note-chat-w', saved + 'px');
  const clamp = (w) => Math.min(Math.max(w, 300), Math.min(window.innerWidth - 40, 900));
  const bind = (handle, dock) => {
    if (!handle || !dock) return;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); handle.setPointerCapture(e.pointerId); dock.classList.add('resizing');
      const move = (ev) => document.documentElement.style.setProperty('--note-chat-w', clamp(window.innerWidth - ev.clientX) + 'px');
      const up = (ev) => {
        handle.releasePointerCapture(ev.pointerId); dock.classList.remove('resizing');
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        localStorage.setItem('noteChatW', String(clamp(window.innerWidth - ev.clientX)));
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  };
  bind($('#note-chat-resize'), $('#note-chat'));
  bind($('#code-chat-resize'), $('#code-chat'));
})();

function renderNoteChat() {
  const thread = $('#note-chat-thread');
  $('#note-chat-intro').hidden = state.noteChat.length > 0;
  thread.querySelectorAll('.bubble, .bubble-wrap').forEach((b) => b.remove());
  state.noteChat.forEach((m, i) => {
    if (m.role === 'user') {
      const b = document.createElement('div');
      b.className = 'bubble me';
      b.innerHTML = esc(m.text).replace(/\n/g, '<br>');
      thread.appendChild(b);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';
    const b = document.createElement('div');
    b.className = 'bubble ai';
    b.innerHTML = m.text ? mdToHtml(m.text) : '<span class="typing">…</span>';
    bindWikilinks(b);
    wrap.appendChild(b);
    // Once an answer is in (and nothing's streaming), offer to save it into the note. The topic is
    // the question that prompted this answer.
    if (m.text && !state.noteChatBusy) {
      const prev = state.noteChat[i - 1];
      const q = prev && prev.role === 'user' ? prev.text : '';
      const add = document.createElement('button');
      add.className = 'add-to-note'; add.type = 'button';
      add.textContent = '➕ Add to note';
      add.addEventListener('click', () => augmentNote(q, m.text, add));
      wrap.appendChild(add);
    }
    thread.appendChild(wrap);
  });
  thread.scrollTop = thread.scrollHeight;
}

async function sendNoteChat(text) {
  const q = (text || '').trim();
  if (!q || state.noteChatBusy || !state.readerPath) return;
  state.noteChat.push({ role: 'user', text: q });
  const ai = { role: 'ai', text: '' };
  state.noteChat.push(ai);
  state.noteChatBusy = true;
  $('#note-chat-input').value = '';
  $('#note-chat-send').disabled = true;
  renderNoteChat();
  try {
    const resp = await fetch('/api/note/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: state.readerPath,
        messages: state.noteChat.filter((m) => m.text || m.role === 'user').map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
      }),
    });
    if (!resp.ok || !resp.body) throw new Error('chat failed (' + resp.status + ')');
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ai.text += dec.decode(value, { stream: true });
      renderNoteChat();
    }
    if (!ai.text.trim()) ai.text = '_(no answer)_';
  } catch (e) {
    ai.text = '⚠️ ' + e.message;
  } finally {
    state.noteChatBusy = false;
    $('#note-chat-send').disabled = false;
    renderNoteChat();
    $('#note-chat-input').focus();
  }
}
$('#note-chat-bar').addEventListener('submit', (e) => { e.preventDefault(); sendNoteChat($('#note-chat-input').value); });

// Ask the AI to write an overview of `topic` into the open note, then reload it in place.
// POSTs (not EventSource) because the tutor `context` is dense LaTeX that overruns a GET URL; the
// server streams SSE events back over the fetch body, which we parse for status/done/error.
// Progress shows on the button itself and the note refreshes under the chat dock when done.
async function augmentNote(topic, context, btn) {
  if (!state.readerPath || !topic) { toast('Ask a question first'); return; }
  const path = state.readerPath;
  if (btn) { btn.disabled = true; btn.textContent = '✍️ Adding…'; }
  const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '➕ Add to note'; } };
  try {
    const resp = await fetch('/api/note/augment/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, topic, context: (context || '').slice(0, 4000) }),
    });
    if (!resp.ok || !resp.body) throw new Error('Add failed (' + resp.status + ')');
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', code = null, errMsg = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const evMatch = /(?:^|\n)event: (.+)/.exec(block);
        const dataMatch = /(?:^|\n)data: (.+)/.exec(block);
        if (!evMatch) continue;                       // skip `: ping` heartbeat comments
        const type = evMatch[1].trim();
        let data = {}; if (dataMatch) { try { data = JSON.parse(dataMatch[1]); } catch {} }
        if (type === 'status' && data.state === 'fallback-retry') toast('Primary hit a limit — trying fallback…');
        else if (type === 'done') code = (data.code != null ? data.code : 0);
        else if (type === 'error') errMsg = data.message || 'Add failed';
      }
    }
    if (errMsg) { reset(); toast(errMsg); return; }
    if (code !== 0) { reset(); toast('Could not add to note'); return; }
    if (btn) { btn.disabled = false; btn.textContent = '✓ Added'; }
    const { content } = await api('/api/note?path=' + encodeURIComponent(path));
    if (state.readerPath === path) { const body = $('#reader-body'); body.innerHTML = mdToHtml(content); bindWikilinks(body); bindImages(body); }
    state.notes = []; loadNotes(true);
    toast('Overview added ✓');
  } catch (err) { reset(); toast(err.message); }
}

// Mirrors the server's protected list so we don't offer a delete that will just error.
const RESERVED_DIRS = new Set(['.claude', '.git', '.obsidian', '.inbox-archive', 'node_modules', '.cache', 'attachments']);
function isProtectedPath(path) {
  const base = path.split('/').pop();
  if (['CLAUDE.md', 'inbox.md', 'inbox.lock'].includes(base)) return true;
  return RESERVED_DIRS.has(path.split('/')[0]);
}
// One handler closes only the topmost overlay (image viewer sits above editor sits above reader).
window.addEventListener('popstate', () => {
  const iv = $('#imgview');
  if (iv && !iv.hidden) { iv.hidden = true; $('#imgview-img').src = ''; return; }
  if (editorOpen) { editorOpen = false; $('#editor').hidden = true; }
  else if (readerOpen) { readerOpen = false; closeNoteChat(); $('#reader').hidden = true; }
  else if (codeOpen) codeClose();
});

async function openNote(path, name) {
  try {
    const { content } = await api('/api/note?path=' + encodeURIComponent(path));
    state.readerContent = content;
    showReader(name, mdToHtml(content), path);
  } catch (e) { toast(e.message); }
}

/* ---------- Note editor (write your own note) ---------- */
const edTitle = $('#editor-title');
const edBody = $('#editor-body');
let editorOpen = false, edPreviewing = false;
let edMode = 'create', edPath = null; // 'create' → POST new note; 'edit' → overwrite edPath
let edOrigName = '';                  // title at open (edit mode) → detect renames on save
let edOrigContent = '';                // content at open (edit mode) → detect a pure append on save

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
// Wrap the current line in a `<div align="…">` (Obsidian renders it too). Re-clicking the same
// alignment clears it; switching alignment replaces it.
function edAlign(dir) {
  const v = edBody.value, s = edBody.selectionStart;
  const start = v.lastIndexOf('\n', s - 1) + 1;
  let end = v.indexOf('\n', s); if (end === -1) end = v.length;
  const line = v.slice(start, end);
  const had = line.match(/^<div align="(left|center|right)">([\s\S]*)<\/div>$/i);
  const inner = had ? had[2] : line;
  const next = (had && had[1].toLowerCase() === dir) ? inner : `<div align="${dir}">${inner}</div>`;
  edBody.value = v.slice(0, start) + next + v.slice(end);
  const caret = start + next.length;
  edBody.focus(); edBody.setSelectionRange(caret, caret);
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
  alignleft: () => edAlign('left'),
  aligncenter: () => edAlign('center'),
  alignright: () => edAlign('right'),
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
  window.InkPad.open(async ({ blob, strokes }) => {
    try {
      const fd = new FormData();
      fd.append('photo', blob, 'handwriting.png');
      fd.append('strokes', JSON.stringify(strokes || [])); // sidecar → re-editable later
      const { ref } = await api('/api/upload/handwriting', { method: 'POST', body: fd });
      edInsertAtCursor(`\n\n![[${ref}]]\n\n`);
      toast('Handwriting added');
    } catch (e) { toast(e.message); }
  }, { history: false });
}

// Attach an image: pick a file, upload it, embed at the caret. Same upload → ![[ref]] pattern as handwriting.
async function edInsertImageFile(file) {
  if (!file) return;
  try {
    const fd = new FormData();
    fd.append('photo', file);
    const { ref } = await api('/api/upload/image', { method: 'POST', body: fd });
    edInsertAtCursor(`\n\n![[${ref}]]\n\n`);
    toast('Image added');
  } catch (e) { toast(e.message); }
}

// mousedown-preventDefault keeps the textarea selection alive when a toolbar button is tapped.
$('#editor-toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('.fmt')) e.preventDefault(); });
$('#editor-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('.fmt'); if (!b) return;
  if (b.dataset.fmt === 'ink') { edInsertHandwriting(); return; }
  if (b.dataset.fmt === 'img') { $('#editor-img-input').click(); return; }
  (edFmt[b.dataset.fmt] || (() => {}))();
});
$('#editor-img-input').addEventListener('change', (e) => {
  edInsertImageFile(e.target.files[0]);
  e.target.value = ''; // allow picking the same file again
});

// What gets previewed/saved. In edit mode the body is the full note (H1 included), so use it
// verbatim; in create mode the title becomes the H1 when the body has no heading yet.
function editorMarkdown() {
  const body = edBody.value;
  if (edMode === 'edit') return body;
  const title = edTitle.value.trim();
  return (title && !/^#\s/.test(body.trim())) ? `# ${title}\n\n${body}` : body;
}
/* ---- Editor surfaces: 'live' (Obsidian-style block render) ↔ 'source' (raw textarea) ---- */
// edBody (the textarea) stays the single source of truth — Live renders from it and writes back to it.
let edSurface = 'source';
let lpActiveIdx = -1; // index of the block currently open for source editing (-1 = none)

// Split markdown into editable blocks: blank-line-separated groups, with headings and fenced
// code each kept whole. Mirrors how a block renders so indices line up with the rendered DOM.
function splitBlocks(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const blocks = []; let cur = []; let inFence = false;
  const flush = () => { if (cur.length) { blocks.push(cur.join('\n')); cur = []; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { if (!inFence) { flush(); inFence = true; cur.push(line); } else { cur.push(line); inFence = false; flush(); } continue; }
    if (inFence) { cur.push(line); continue; }
    if (line.trim() === '') { flush(); continue; }
    if (/^#{1,6}\s/.test(line)) { flush(); blocks.push(line); continue; } // headings are their own block
    cur.push(line);
  }
  flush();
  return blocks;
}
const lpHost = () => $('#lp-editor');
function autosizeTA(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

// Pick the edit field's styling so revealing a block's source keeps the rendered look (a heading
// stays big & bold, a quote stays muted) instead of collapsing to plain text. Math/code/frontmatter
// stay monospace — raw syntax is what you edit there.
function editClassFor(block) {
  const b = String(block || ''), first = b.replace(/^\s+/, '');
  const h = first.match(/^(#{1,6})\s/);
  if (h) return 'lp-edit-h' + Math.min(h[1].length, 3);
  if (/^---\r?\n[\s\S]*\n---\s*$/.test(b) || /^\s*```/.test(first) || /^\s*\$\$/.test(first)) return 'lp-edit-mono';
  if (/^>\s?/.test(first)) return 'lp-edit-quote';
  return 'lp-edit-prose';
}

// Render every block as formatted HTML (themed). Clicking a block opens its source (see delegation).
function renderLive() {
  lpActiveIdx = -1;
  const host = lpHost(); host.innerHTML = '';
  const blocks = splitBlocks(edBody.value);
  if (!blocks.length) blocks.push('');
  blocks.forEach((b, i) => {
    const div = document.createElement('div');
    div.className = 'lp-block'; div.dataset.i = i;
    const isFm = /^---\r?\n[\s\S]*\n---\s*$/.test(b);
    if (isFm) {
      const tags = noteTags(b + '\n');
      div.innerHTML = `<p class="lp-empty">🏷 ${tags.length ? tags.map((t) => '#' + esc(t)).join(' ') : 'properties'} — click to edit</p>`;
    } else {
      div.innerHTML = b.trim() ? mdToHtml(b) : '<p class="lp-empty">Empty line — click to write…</p>';
    }
    host.appendChild(div);
  });
}
// Commit the block being edited back into edBody, then re-render.
function commitLiveEdit() {
  const div = lpHost().querySelector('.lp-block.editing');
  if (!div || lpActiveIdx < 0) { lpActiveIdx = -1; return; }
  const ta = div.querySelector('.lp-edit');
  const blocks = splitBlocks(edBody.value);
  if (lpActiveIdx < blocks.length) blocks[lpActiveIdx] = ta.value; else blocks.push(ta.value);
  edBody.value = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  lpActiveIdx = -1;
  renderLive();
}
// Open one block for raw-source editing (commits any other open block first).
function enterBlockEdit(idx) {
  commitLiveEdit();
  const blocks = splitBlocks(edBody.value);
  if (!blocks.length) blocks.push('');
  idx = Math.max(0, Math.min(idx, blocks.length - 1));
  const div = lpHost().querySelector(`.lp-block[data-i="${idx}"]`);
  if (!div) return;
  lpActiveIdx = idx;
  const ta = document.createElement('textarea');
  ta.className = 'lp-edit ' + editClassFor(blocks[idx]); ta.value = blocks[idx];
  div.innerHTML = ''; div.classList.add('editing'); div.appendChild(ta);
  autosizeTA(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', () => autosizeTA(ta));
  ta.addEventListener('blur', commitLiveEdit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); ta.blur(); } });
}
// Click a rendered block to edit its source. (When another block is mid-edit, its blur fires first
// and commits + re-renders; this click then lands on the fresh DOM and reads the right index.)
// preventDefault keeps embedded links/wikilinks from navigating away inside the editor.
lpHost().addEventListener('click', (e) => {
  const blk = e.target.closest('.lp-block');
  if (!blk || blk.classList.contains('editing')) return;
  e.preventDefault();
  enterBlockEdit(+blk.dataset.i);
});

// Switch editing surface. Live = formatted blocks; Source = raw textarea (with vim/line numbers).
function setEditorSurface(surface) {
  if (surface === 'source') commitLiveEdit(); // flush any pending live edit into edBody first
  edSurface = surface;
  const live = surface === 'live';
  lpHost().hidden = !live;
  $('#editor-area').hidden = live;
  $('#editor-preview').hidden = true;
  $('#editor-toolbar').hidden = live;                 // toolbar is for source mode; type markdown in live
  $('#vim-status').hidden = live || !prefs.vim;
  $('#editor-preview-toggle').querySelector('span').textContent = live ? 'Source' : 'Live';
  if (live) renderLive(); else { edBody.focus(); if (prefs.lineno) renderGutter(); }
}
$('#editor-preview-toggle').addEventListener('click', () => setEditorSurface(edSurface === 'live' ? 'source' : 'live'));

// Edit mode hides the folder picker (path is fixed). The title stays editable so it can be
// renamed; on save we rename the file when it changed.
function setEditorMode(mode) {
  edMode = mode;
  const editing = mode === 'edit';
  edTitle.readOnly = false;
  edTitle.placeholder = editing ? 'Note title (rename)' : 'Note title';
  $('.editor-folder-label').hidden = editing;
  // Same checkbox, different scope: creating tags the whole note; editing tags only a pure append
  // (nothing before the cursor touched) — a mid-note edit just saves normally either way.
  $('#editor-draft-label').title = editing
    ? 'If you only added text at the end, mark that new part so the AI polishes it on the next Process Inbox run'
    : 'AI polishes this note (links, formatting, LaTeX) on the next Process Inbox run';
}
function showEditor() {
  if (!editorOpen) { history.pushState({ editor: true }, ''); editorOpen = true; }
  $('#editor').hidden = false;
  applyEditorPrefs();
  setEditorSurface(prefs.livepreview ? 'live' : 'source');
}

// New note (create mode).
async function openEditor() {
  setEditorMode('create'); edPath = null;
  edTitle.value = ''; edBody.value = ''; $('#editor-folder').value = 'Drafts'; $('#editor-draft').checked = true;
  try {
    const { folders } = await api('/api/folders');
    $('#editor-folders').innerHTML = folders.map((f) => `<option value="${esc(f)}">`).join('');
  } catch {}
  showEditor();
  edTitle.focus();
}

// New note pre-targeted to a folder (from the tree's ＋). Opens the create editor with the folder
// filled in and the title seeded, ready to write; saving creates the file inside that folder.
async function openEditorInFolder(title, folder) {
  setEditorMode('create'); edPath = null;
  edTitle.value = title || ''; edBody.value = ''; $('#editor-draft').checked = true;
  try {
    const { folders } = await api('/api/folders');
    $('#editor-folders').innerHTML = folders.map((f) => `<option value="${esc(f)}">`).join('');
  } catch {}
  $('#editor-folder').value = folder || 'Drafts';
  showEditor();
  edBody.focus();
}

// Edit an existing note in place (edit mode).
async function openEditorFor(path, name) {
  try {
    const { content } = await api('/api/note?path=' + encodeURIComponent(path));
    setEditorMode('edit'); edPath = path;
    edTitle.value = name || path.split('/').pop().replace(/\.md$/, '');
    edOrigName = edTitle.value;
    edOrigContent = content.replace(/\r/g, '');
    edBody.value = edOrigContent;
    $('#editor-draft').checked = true;
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
  if (edSurface === 'live') commitLiveEdit(); // flush the block being edited into edBody
  if (!edBody.value.trim()) { toast('Write something first'); return; }
  try {
    let path, name, hub;
    if (edMode === 'edit') {
      let toSave = edBody.value;
      // Pure append (everything before the cursor is untouched) + draft checked → wrap just the new
      // tail in draft markers, so process-inbox polishes only what's new, not the whole note.
      if ($('#editor-draft').checked && toSave.startsWith(edOrigContent)) {
        const added = toSave.slice(edOrigContent.length).trim();
        if (added) toSave = edOrigContent.replace(/\s+$/, '') + `\n\n<!-- #draft:start -->\n${added}\n<!-- #draft:end -->\n`;
      }
      ({ path } = await api('/api/note/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: edPath, content: toSave }),
      }));
      name = edTitle.value.trim() || path.split('/').pop().replace(/\.md$/, '');
      // Title changed → rename the underlying file too.
      if (name && name !== edOrigName) {
        try { ({ path } = await api('/api/note/rename', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, title: name }),
        })); } catch (err) { toast(err.message); }
      }
    } else {
      const title = edTitle.value.trim();
      if (!title) { toast('Add a title'); edTitle.focus(); return; }
      ({ path, hub } = await api('/api/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, folder: $('#editor-folder').value.trim() || 'Drafts', content: edBody.value,
          draft: $('#editor-draft').checked,
        }),
      }));
      name = title;
    }
    // Hide without history.back() — we're about to (re)open the reader; a deferred popstate would
    // otherwise race its pushState. (Any stray history entry is harmless.)
    $('#editor').hidden = true; editorOpen = false;
    state.notes = []; state.graph = null; await loadNotes(true);
    toast(edMode === 'edit' ? 'Note updated' : (hub ? `Saved · linked in ${hub}` : 'Note saved'));
    openNote(path, name);
  } catch (e) { toast(e.message); }
});

/* ---------- Editor extras: line numbers + Vim ---------- */
const edGutter = $('#editor-gutter');
const edGutterInner = $('#editor-gutter-inner');
const editorEl = $('#editor');

// Repaint the line-number gutter (count rows, widen the gutter for the digit count).
function renderGutter() {
  if (!prefs.lineno) return;
  const n = edBody.value.split('\n').length || 1;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  edGutterInner.textContent = s;
  editorEl.style.setProperty('--gutter-w', String(String(n).length));
  syncGutterScroll();
}
function syncGutterScroll() {
  if (prefs.lineno) edGutterInner.style.transform = `translateY(${-edBody.scrollTop}px)`;
}
edBody.addEventListener('scroll', syncGutterScroll);

// Vim controller (attached once; toggled via prefs).
const editorVim = window.LifeVim.attach(edBody, {
  onMode: (mode, pending) => {
    const bar = $('#vim-status');
    if (!mode) { bar.hidden = true; return; }
    bar.hidden = false; bar.dataset.mode = mode;
    bar.querySelector('.mode').textContent = mode;
    $('#vim-pending').textContent = pending || '';
  },
});

// Apply the current editor prefs to the open editor (line numbers + vim on/off).
function applyEditorPrefs() {
  editorEl.classList.toggle('lineno', prefs.lineno);
  if (prefs.lineno) renderGutter(); else edGutterInner.textContent = '';
  editorVim.setEnabled(prefs.vim);
  $('#vim-status').hidden = (edSurface === 'live') || !prefs.vim; // vim/line-numbers are source-mode only
}
edBody.addEventListener('input', () => { if (prefs.lineno) renderGutter(); });

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

// One reusable task row that toggles its checkbox and reloads; the ✎ button opens the edit sheet.
function taskRow(t) {
  const overdue = !t.done && t.date && t.date < todayStr();
  const el = document.createElement('div');
  el.className = 'task' + (t.done ? ' done' : '') + (overdue ? ' overdue' : '');
  el.innerHTML = `<div class="box">${t.done ? '✓' : ''}</div>
    <div class="t-main"><div class="t-desc">${esc(t.desc)}</div>${t.date ? `<div class="t-meta">${fmtDate(t.date)}</div>` : ''}</div>
    <button class="t-edit" type="button" aria-label="Edit task" title="Edit">✎</button>`;
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
  el.querySelector('.t-edit').addEventListener('click', (e) => { e.stopPropagation(); openTaskEdit(t); });
  return el;
}

// ---- Edit task (desc + date) — writes back in the same "DD Mon DESC" line format the
// process-inbox AI reads/writes, so a manual edit stays compatible with the next automated run.
// Editing across a year boundary moves the line to the right TODO/{year}/{month}.md file (the line
// itself never stores a year — it's inferred from the file path — so this keeps that correct).
let editingTask = null;
function openTaskEdit(t) {
  editingTask = t;
  $('#task-edit-desc').value = t.desc;
  $('#task-edit-date').value = t.date || '';
  openSheet('sheet-task-edit');
  $('#task-edit-desc').focus();
}
async function saveTaskEdit(date) {
  if (!editingTask) return;
  const desc = $('#task-edit-desc').value.trim();
  if (!desc) { toast('Description required'); return; }
  try {
    await api('/api/tasks/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: editingTask.file, line: editingTask.line, desc, date: date ?? $('#task-edit-date').value }),
    });
    closeSheets();
    await loadPlan();
    toast('Task updated');
  } catch (e) { toast(e.message); }
}
$('#task-edit-save').addEventListener('click', () => saveTaskEdit());
$('#task-edit-clear-date').addEventListener('click', () => saveTaskEdit(''));

function renderPlanList(tasks) {
  const wrap = $('#plan-groups'); wrap.innerHTML = '';
  const open = tasks.filter((t) => !t.done).length;
  $('#plan-crumb').textContent = open + ' open task' + (open === 1 ? '' : 's');
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
  startStream(withProvider('/api/calsync/stream'), {
    title: 'Syncing Google Calendar…',
    onDone: async (_out, code) => { if (code === 0) { const { events } = await api('/api/calendar'); state.events = events || []; renderCalendar(); toast('Calendar synced'); } },
  });
});

/* ---------- Chat (read-only advisor — its own tab) ---------- */
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
    $('#browse-nodes').textContent = data.nodes.length + ' nodes';
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
    const { config, vaultDir, docTools } = await api('/api/config');
    $('#cfg-vaultPath').value = config.vaultPath;
    $('#cfg-timezone').value = config.timezone;
    $('#cfg-languages').value = config.languages;
    $('#cfg-claudePath').value = config.claudePath;
    const qw = config.qwen || {};
    $('#cfg-qw-baseUrl').value = qw.baseUrl || '';
    $('#cfg-qw-apiKey').value = qw.apiKey || '';
    $('#cfg-qw-model').value = qw.model || '';
    const fb = config.fallback || {};
    $('#cfg-fb-baseUrl').value = fb.baseUrl || '';
    $('#cfg-fb-apiKey').value = fb.apiKey || '';
    $('#cfg-fb-model').value = fb.model || '';
    const gm = config.gemini || {};
    $('#cfg-gem-apiKey').value = gm.apiKey || '';
    $('#cfg-gem-model').value = gm.model || '';
    $('#cfg-vaultdir').textContent = '→ ' + vaultDir;
    renderDocTools(docTools || []);
    // Appearance / editor prefs (client-side, localStorage).
    applyTheme(prefs.theme);
    applyWidth('note', prefs.noteWidth);
    applyWidth('code', prefs.codeWidth);
    $('#cfg-livepreview').checked = prefs.livepreview;
    $('#cfg-vim').checked = prefs.vim;
    $('#cfg-lineno').checked = prefs.lineno;
    $('#cfg-manual-provider').value = prefs.manualProvider;
    openSheet('sheet-settings');
  } catch (e) { toast(e.message); }
}
// Editor preference toggles (live — apply to the editor immediately if it's open).
$('#cfg-livepreview').addEventListener('change', (e) => { prefs.set('livepreview', e.target.checked ? '1' : '0'); if (editorOpen) setEditorSurface(e.target.checked ? 'live' : 'source'); });
$('#cfg-vim').addEventListener('change', (e) => { prefs.set('vim', e.target.checked ? '1' : '0'); if (editorOpen) applyEditorPrefs(); if (codeVim) codeVim.setEnabled(prefs.vim); });
$('#cfg-lineno').addEventListener('change', (e) => { prefs.set('lineno', e.target.checked ? '1' : '0'); if (editorOpen) applyEditorPrefs(); });
$('#cfg-manual-provider').addEventListener('change', (e) => { prefs.set('manualProvider', e.target.value); });
// Document-extraction tooling health (powers processing of attached docx/pptx/xlsx).
function renderDocTools(tools) {
  const box = $('#cfg-doctools'); if (!box) return;
  const anyOffice = tools.some((t) => t.found && t.cmd !== 'pdftotext');
  const rows = tools.map((t) =>
    `<div class="doctool-row"><span>${t.found ? '✅' : '⬜'}</span>
      <code>${esc(t.label)}</code><span class="hint">${esc(t.handles)}</span></div>`).join('');
  box.innerHTML = rows
    + `<p class="hint">${anyOffice
      ? 'Attached Office files (.docx/.pptx/.xlsx) can be extracted and summarized on processing.'
      : '⚠ No Office-extraction tool found. PDFs still process (read natively); .docx/.pptx/.xlsx get parked <code>#needs-extraction</code> until you install one (e.g. <code>pandoc</code>).'}</p>`;
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
        qwen: {
          baseUrl: $('#cfg-qw-baseUrl').value.trim(),
          apiKey: $('#cfg-qw-apiKey').value.trim(),
          model: $('#cfg-qw-model').value.trim(),
        },
        fallback: {
          baseUrl: $('#cfg-fb-baseUrl').value.trim(),
          apiKey: $('#cfg-fb-apiKey').value.trim(),
          model: $('#cfg-fb-model').value.trim(),
        },
        gemini: {
          apiKey: $('#cfg-gem-apiKey').value.trim(),
          model: $('#cfg-gem-model').value.trim() || 'gemini-2.5-flash',
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
  md = splitFM(md).body; // hide YAML frontmatter from the rendered note (shown in Properties instead)
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
      if (/\.(webm|m4a|mp3|wav|ogg)$/i.test(ref)) return `<audio controls src="${src}"></audio>`;
      if (/\.(pdf|docx?|pptx?|xlsx?|csv|txt|odt|ods|key)$/i.test(ref)) {
        const fname = ref.split('/').pop();
        return `<a class="doc-link" href="${src}" target="_blank" rel="noopener">📎 ${fname}</a>`;
      }
      return `<img class="md-img" src="${src}" alt="${ref}" onerror="this.style.display='none'">`;
    })
    // `name`/`label` are already HTML-escaped by the outer esc(t) above — do NOT escape again, or an
    // `&` in a title becomes `&amp;amp;` and the data-link stops matching the note (breaking the click).
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, name, label) => `<span class="wikilink" data-link="${name.trim()}">${label || name}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)(#[A-Za-z][\w-]*)/g, '$1<span class="tag">$2</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  // GFM table helpers. Inline math/code with `|` was already stashed as @@n@@ tokens above, so
  // splitting cells on `|` here is safe from absolute-value bars etc.
  const isDelimRow = (l) => { const t = (l || '').trim(); return t.includes('|') && t.includes('-') && /^[\s:|-]+$/.test(t); };
  const cellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Table: a `|`-row immediately followed by a delimiter row (`|---|:--:|`), then data rows.
    if (line.includes('|') && isDelimRow(lines[i + 1])) {
      closeList();
      const head = cellsOf(line);
      let k = i + 2, body = '';
      while (k < lines.length && lines[k].includes('|') && lines[k].trim() && !/^#{1,6}\s/.test(lines[k])) {
        const cs = cellsOf(lines[k]);
        body += '<tr>' + head.map((_, ci) => `<td>${inline(cs[ci] || '')}</td>`).join('') + '</tr>';
        k++;
      }
      html += '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + `</tr></thead><tbody>${body}</tbody></table>`;
      i = k - 1;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) { closeList(); const lvl = line.match(/^#+/)[0].length; html += `<h${lvl}>${inline(line.replace(/^#+\s/, ''))}</h${lvl}>`; }
    else if (/^\s*[-*]\s\[[ xX]\]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } const done = /\[[xX]\]/.test(line); html += `<li>${done ? '☑' : '☐'} ${inline(line.replace(/^\s*[-*]\s\[[ xX]\]\s/, ''))}</li>`; }
    else if (/^\s*[-*]\s/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s/, ''))}</li>`; }
    else if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; }
    else if (line.trim() === '---') { closeList(); html += '<hr>'; }
    else if (line.trim() === '') { closeList(); }
    else if (/^<div align="(?:left|center|right)">.*<\/div>\s*$/i.test(line)) {
      closeList();
      const al = line.match(/^<div align="(left|center|right)">(.*)<\/div>\s*$/i);
      html += `<p style="text-align:${al[1]}">${inline(al[2])}</p>`;
    }
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
// Make embedded images (incl. handwritten ink pages) tap-to-expand: opens the zoom/pan viewer.
function bindImages(root) {
  $$('.md-img', root).forEach((im) => {
    im.addEventListener('click', () => window.openImageViewer(im.currentSrc || im.src, im.alt));
  });
}

/* ---- Full-screen image viewer (zoom + pan, like Flexcil) ---- */
(function setupImageViewer() {
  const view = $('#imgview'), img = $('#imgview-img');
  let s = 1, tx = 0, ty = 0, drag = false, lx = 0, ly = 0, pinch = null;
  const clampS = (v) => Math.min(8, Math.max(1, v));
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; };
  const reset = () => { s = 1; tx = 0; ty = 0; apply(); };
  // Zoom about a screen point, keeping that point fixed (transform-origin is the image's top-left).
  const zoomAt = (cx, cy, ns) => {
    ns = clampS(ns);
    const r = img.getBoundingClientRect(), k = ns / s;
    tx += (cx - r.left) * (1 - k); ty += (cy - r.top) * (1 - k);
    s = ns; if (s === 1) { tx = 0; ty = 0; } apply();
  };
  const editBtn = $('#imgview-edit');
  const delBtn = $('#imgview-del');
  window.openImageViewer = (src, alt) => {
    if (!src) return;
    img.src = src; img.alt = alt || 'Embedded image, expanded'; reset(); view.hidden = false;
    history.pushState({ imgview: true }, '');
    // Offer "Edit ink" only for handwriting images that have a saved stroke sidecar (re-editable);
    // "Delete" is offered for any handwriting image, sidecar or not.
    editBtn.hidden = true; delBtn.hidden = true;
    const u = new URL(src, location.href);
    if (/\/vault-files\/attachments\/handwriting\/.+\.png$/i.test(u.pathname)) {
      const ref = decodeURIComponent(u.pathname.replace('/vault-files/', ''));
      delBtn.hidden = false;
      delBtn.onclick = () => deleteHandwritingNote(ref);
      fetch(u.pathname.replace(/\.png$/i, '.ink.json'))
        .then((r) => (r.ok ? r.json() : null))
        .then((strokes) => {
          if (Array.isArray(strokes) && strokes.length) {
            editBtn.hidden = false;
            editBtn.onclick = () => editHandwriting(ref, strokes);
          }
        })
        .catch(() => {});
    }
  };
  // Delete a handwritten note: removes the PNG + its .ink.json sidecar from disk (not just the
  // ![[…]] embed — that alone leaves the canvas file orphaned), then strips the embed line from the
  // currently open note, if any.
  async function deleteHandwritingNote(ref) {
    if (!(await appConfirm('Delete this handwritten note? The canvas file and its embed in this note will be removed. This can\'t be undone.', { okLabel: 'Delete', danger: true }))) return;
    try {
      await api('/api/handwriting?ref=' + encodeURIComponent(ref), { method: 'DELETE' });
      close();
      if (state.readerPath) await saveReaderContent(removeEmbedFromContent(state.readerContent, ref), 'Handwriting deleted');
      else toast('Handwriting deleted');
    } catch (e) { toast(e.message); }
  }
  // Reopen a handwriting page in the ink canvas (over the viewer), then overwrite it in place.
  function editHandwriting(ref, strokes) {
    window.InkPad.open(({ blob, strokes: out }) => saveHandwritingEdit(ref, blob, out), { history: false, strokes });
  }
  async function saveHandwritingEdit(ref, blob, strokes) {
    try {
      const fd = new FormData();
      fd.append('photo', blob, 'handwriting.png');
      fd.append('ref', ref);
      fd.append('strokes', JSON.stringify(strokes || []));
      await api('/api/handwriting/update', { method: 'POST', body: fd });
      close();                                   // back to the note
      bustHandwritingImg(ref);                   // force the (same-URL) image to reload
      toast('Handwriting updated ✓');
    } catch (e) { toast(e.message); }
  }
  // The overwritten PNG keeps its filename, so the browser would show the cached old one — re-fetch.
  function bustHandwritingImg(ref) {
    const file = ref.split('/').pop();
    const base = '/vault-files/' + ref.split('/').map(encodeURIComponent).join('/');
    $$('#reader-body img.md-img').forEach((im) => {
      try { if (new URL(im.src, location.href).pathname.endsWith('/' + file)) im.src = base + '?t=' + Date.now(); } catch {}
    });
  }
  const close = () => {
    if (view.hidden) return;
    if (history.state && history.state.imgview) history.back();   // popstate hides it (closes topmost)
    else { view.hidden = true; img.src = ''; }
  };
  $('#imgview-close').addEventListener('click', close);
  view.addEventListener('click', (e) => { if (e.target === view) close(); });   // tap the backdrop
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !view.hidden) close(); });
  view.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });
  img.addEventListener('dblclick', (e) => { if (s > 1) reset(); else zoomAt(e.clientX, e.clientY, 2.4); });
  // mouse drag to pan
  img.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; drag = true; lx = e.clientX; ly = e.clientY; view.classList.add('grabbing'); try { img.setPointerCapture(e.pointerId); } catch {} });
  img.addEventListener('pointermove', (e) => { if (!drag) return; tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; apply(); });
  const endDrag = () => { drag = false; view.classList.remove('grabbing'); };
  img.addEventListener('pointerup', endDrag); img.addEventListener('pointercancel', endDrag);
  // touch: pinch-zoom + one-finger pan (when zoomed in)
  const tdist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const tmid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  view.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = { d: tdist(e.touches), s0: s };
    else if (e.touches.length === 1 && s > 1) { drag = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY; }
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinch) { const m = tmid(e.touches); zoomAt(m.x, m.y, pinch.s0 * tdist(e.touches) / pinch.d); }
    else if (drag && e.touches.length === 1) { const t = e.touches[0]; tx += t.clientX - lx; ty += t.clientY - ly; lx = t.clientX; ly = t.clientY; apply(); }
  }, { passive: true });
  view.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; if (e.touches.length === 0) { drag = false; if (s === 1) reset(); } });
})();

/* ---------- Code tab: phone-first editor (Scratchpad or Saved files over run.dir) ----------
   Transparent textarea over a highlight.js layer + an on-screen symbol bar (keys a phone keyboard
   hides), anchored above the soft keyboard. Two modes: Scratch (ephemeral, per-language buffers) and
   Saved (real files in run.dir = Syncthing-synced ~/mycode, browsable in a swipe-in project tree).
   Auto-indent + auto-closing brackets make typing on a touch keyboard bearable. Runs via /api/run. */
const CODE_LS = 'lifeos.code';
const codeState = {
  mode: 'scratch', scratchLang: 'python', scratchBuffers: {},
  file: { name: '', content: '', dirty: false },
  langs: [], codeDir: null, files: [], expanded: new Set(),
  running: false, inited: false,
};

// Symbol keys. `v` inserts at caret; `close` = auto-closing pair (tap → pair, hold → just the closer,
// so we only ever show the opener). Priority openers first: ( { [ " ;  Arrows live in a fixed cluster.
const CODE_KEYS = [
  { t: '(', v: '(', close: ')' }, { t: '{', v: '{', close: '}' }, { t: '[', v: '[', close: ']' },
  { t: '"', v: '"', close: '"' }, { t: ';', v: ';' },
  { t: ':', v: ':' }, { t: '=', v: '=' }, { t: '.', v: '.' }, { t: ',', v: ',' },
  { t: "'", v: "'", close: "'" }, { t: '`', v: '`', close: '`' }, { t: '<', v: '<' }, { t: '>', v: '>' },
  { t: '+', v: '+' }, { t: '-', v: '-' }, { t: '*', v: '*' }, { t: '/', v: '/' },
  { t: '%', v: '%' }, { t: '&', v: '&' }, { t: '|', v: '|' }, { t: '!', v: '!' },
  { t: '#', v: '#' }, { t: '_', v: '_' }, { t: '\\', v: '\\' }, { t: '$', v: '$' }, { t: '@', v: '@' },
  { t: 'Tab', v: '    ', wide: true },
];
const CODE_EXT_LANG = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', java: 'java', go: 'go', rs: 'rust', sh: 'bash', bash: 'bash',
};
const codeLangOf = (name) => CODE_EXT_LANG[(name || '').split('.').pop().toLowerCase()] || null;
const CODE_STARTER = 'print("hello")\n';
const CODE_PAIRS = { '(': ')', '{': '}', '[': ']', '"': '"', "'": "'", '`': '`' };
const CODE_CLOSERS = new Set([')', ']', '}', '"', "'", '`']);
// Active language for run + highlight: Saved → the file's extension; Scratch → the picker.
const codeCurLang = () => (codeState.mode === 'saved' ? codeLangOf(codeState.file.name) : codeState.scratchLang);
const codeTA = () => $('#code-body');

// Does the program read stdin (scanf/cin/input/…)? If so we auto-reveal the input box on Run.
const CODE_INPUT_RE = {
  c: /\b(scanf|fscanf|gets|fgets|getchar|getline)\s*\(/,
  cpp: /\bcin\b|\b(scanf|getline)\s*\(/,
  python: /\binput\s*\(|\bsys\.stdin\b/,
  java: /\bScanner\b|\bBufferedReader\b|\bSystem\.in\b/,
  go: /\bfmt\.Scan|\bbufio\.NewReader\b|\bos\.Stdin\b/,
  javascript: /\breadline\b|\bprocess\.stdin\b/,
  bash: /\bread\b|\$\(<\s*\/dev\/stdin/,
};
const codeReadsInput = (code, lang) => { const re = CODE_INPUT_RE[lang]; return !!(re && re.test(code)); };

function codeLoadLS() { try { return JSON.parse(localStorage.getItem(CODE_LS) || '{}'); } catch { return {}; } }
function codeSaveLS() {
  try {
    localStorage.setItem(CODE_LS, JSON.stringify({
      mode: codeState.mode, scratchLang: codeState.scratchLang, scratchBuffers: codeState.scratchBuffers,
      file: codeState.file, expanded: [...codeState.expanded],
    }));
  } catch { /* quota */ }
}

// ---- editing primitives (formatting) ----
function codeReplaceRange(s, e, text, caret) {
  const ta = codeTA();
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = caret === undefined ? s + text.length : caret;
  ta.focus(); codeOnInput();
}
function codeInsert(text) { const ta = codeTA(); codeReplaceRange(ta.selectionStart, ta.selectionEnd, text); }
function codeInsertPair(open, close) {
  const ta = codeTA(), s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  codeReplaceRange(s, e, open + sel + close, s + open.length + sel.length); // wraps a selection, else caret between
}
function codeMoveCaret(dir) {
  const ta = codeTA(), val = ta.value, p = ta.selectionStart;
  if (dir === 'left' || dir === 'right') {
    ta.selectionStart = ta.selectionEnd = Math.max(0, Math.min(val.length, p + (dir === 'left' ? -1 : 1)));
  } else {                                    // up/down: keep the column, clamp to the target line
    const ls = val.lastIndexOf('\n', p - 1) + 1, col = p - ls;
    if (dir === 'up') {
      if (ls === 0) { ta.focus(); return; }
      const ps = val.lastIndexOf('\n', ls - 2) + 1;
      ta.selectionStart = ta.selectionEnd = ps + Math.min(col, ls - 1 - ps);
    } else {
      const ne = val.indexOf('\n', p);
      if (ne < 0) { ta.focus(); return; }
      const ns = ne + 1; let nn = val.indexOf('\n', ns); if (nn < 0) nn = val.length;
      ta.selectionStart = ta.selectionEnd = ns + Math.min(col, nn - ns);
    }
  }
  ta.focus();
}
// Enter: keep the line's indent, add a level after a trailing opener, and expand {|} into a block.
function codeEnter() {
  const ta = codeTA(), val = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = val.lastIndexOf('\n', s - 1) + 1;
  const indent = (val.slice(lineStart, s).match(/^[\t ]*/) || [''])[0];
  // Expand a block ONLY when the caret sits between a real pair, e.g. {|}. (Guard against
  // CODE_PAIRS[nonOpener] === val[s] both being undefined at end-of-file — that used to indent includes.)
  if (CODE_PAIRS[val[s - 1]] && CODE_PAIRS[val[s - 1]] === val[s]) {
    const mid = '\n' + indent + '    ';
    codeReplaceRange(s, e, mid + '\n' + indent, s + mid.length);
  } else {
    const opens = /[[({:]$/.test(val.slice(lineStart, s).replace(/\s+$/, ''));
    codeReplaceRange(s, e, '\n' + indent + (opens ? '    ' : ''));
  }
}
// Vim on the code editor (attached lazily; toggled by prefs.vim). While vim owns the keys in
// normal/visual mode, skip the auto-indent/bracket-pair handling below — those are insert-time helpers.
let codeVim = null, codeVimMode = '', codeOpen = false;
// Code is a full-screen overlay reached from a bottom tab. Push a history entry on entry so the
// phone's Back button (and #code-back) return to the previous tab instead of closing the app.
function codeClose() {
  if (!codeOpen) return;
  codeOpen = false; codeViewportReset(); codeToggleSidebar(false); closeCodeChat(); show(state.prevTab || 'discover');
}
function codeKeydown(ev) {
  if (codeVim && codeVim.isEnabled() && codeVimMode && codeVimMode !== 'INSERT') return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? codeRedo() : codeUndo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); codeRedo(); return; }
  if (ev.key === 'Enter') { ev.preventDefault(); codeEnter(); return; }
  if (ev.key === 'Tab') { ev.preventDefault(); codeInsert('    '); return; }
  const ta = codeTA(), s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
  if (s === e && CODE_CLOSERS.has(ev.key) && val[s] === ev.key) { ev.preventDefault(); ta.selectionStart = ta.selectionEnd = s + 1; return; } // type over
  if (CODE_PAIRS[ev.key]) { ev.preventDefault(); codeInsertPair(ev.key, CODE_PAIRS[ev.key]); return; }
  if (ev.key === 'Backspace' && s === e && CODE_PAIRS[val[s - 1]] && CODE_PAIRS[val[s - 1]] === val[s]) { ev.preventDefault(); codeReplaceRange(s - 1, s + 1, ''); } // delete empty pair
}
// Bind one key: pointerdown keeps the textarea focused; the bar scrolls via touch-action:pan-x, so we
// tell a tap from a scroll by movement (act only on a still pointerup). Hold a pair key → its closer.
function codeBindKey(b, k) {
  let sx = 0, sy = 0, moved = false, held = false, lp = null;
  const clear = () => { clearTimeout(lp); lp = null; };
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); sx = ev.clientX; sy = ev.clientY; moved = false; held = false;
    if (k.close) lp = setTimeout(() => { held = true; codeInsert(k.close); }, 340);
  });
  b.addEventListener('pointermove', (ev) => { if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { moved = true; clear(); } });
  b.addEventListener('pointerup', (ev) => {
    clear(); if (moved || held) return;                 // scrolled, or hold already inserted the closer
    ev.preventDefault();
    if (k.close) codeInsertPair(k.v, k.close);
    else codeInsert(k.v);
  });
  b.addEventListener('pointercancel', clear);
}
// Directional pad in place of four arrow keys — one cell wide. Press/slide toward a direction to move
// the caret; hold to repeat; slide across zones without lifting for a joystick feel.
function codeBuildJoystick() {
  const pad = $('#code-joy'); let rep = null, dir = null;
  const dirAt = (ev) => {
    const r = pad.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 6) return null;            // center deadzone
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  };
  const stop = () => { clearInterval(rep); rep = null; dir = null; };
  pad.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); pad.setPointerCapture?.(ev.pointerId);
    dir = dirAt(ev); if (dir) codeMoveCaret(dir);
    clearInterval(rep); rep = setInterval(() => { if (dir) codeMoveCaret(dir); }, 110);
  });
  pad.addEventListener('pointermove', (ev) => { if (rep) dir = dirAt(ev) || dir; });
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointercancel', stop);
}
function codeBuildSymbols() {
  const bar = $('#code-symbols'); bar.innerHTML = '';
  for (const k of CODE_KEYS) {
    const b = document.createElement('button');
    b.className = 'sym' + (k.wide ? ' sym-wide' : '') + (k.close ? ' sym-pair' : '');
    b.textContent = k.t; b.type = 'button';
    if (k.close) b.dataset.close = k.close;             // shown in the corner only while held
    codeBindKey(b, k); bar.appendChild(b);
  }
  codeBuildJoystick();
}
function codeMarkDirty(d) { codeState.file.dirty = d; $('#code-save').classList.toggle('dirty', d); }

// ---- Undo/redo ----
// Symbol keys, bracket auto-pairing, and Tab/Enter auto-indent all write ta.value directly, which
// clears a textarea's native undo history — so native ctrl+Z can't be trusted here. This is a manual
// stack instead. Rapid typing coalesces into one step (edits <600ms apart merge), so undo doesn't
// just erase a single keystroke. ponytail: linear stack of full-buffer snapshots, not a diff — fine
// at code-buffer sizes, revisit if this needs to hold huge files.
const codeHist = { stack: [''], idx: 0, last: 0 };
function codeHistButtons() {
  $('#code-undo').disabled = codeHist.idx <= 0;
  $('#code-redo').disabled = codeHist.idx >= codeHist.stack.length - 1;
}
function codeHistReset() {
  codeHist.stack = [codeTA().value]; codeHist.idx = 0; codeHist.last = 0;
  codeHistButtons();
}
function codeHistPush() {
  const v = codeTA().value;
  if (v === codeHist.stack[codeHist.idx]) return;
  const now = Date.now(), atTip = codeHist.idx === codeHist.stack.length - 1;
  if (atTip && now - codeHist.last < 600) { codeHist.stack[codeHist.idx] = v; }
  else {
    codeHist.stack = codeHist.stack.slice(0, codeHist.idx + 1);
    codeHist.stack.push(v); codeHist.idx++;
    if (codeHist.stack.length > 200) { codeHist.stack.shift(); codeHist.idx--; }
  }
  codeHist.last = now;
  codeHistButtons();
}
function codeHistNav(dir) {
  const next = codeHist.idx + dir;
  if (next < 0 || next >= codeHist.stack.length) return;
  codeHist.idx = next; codeHist.last = 0;
  codeSetContent(codeHist.stack[codeHist.idx]);
  if (codeState.mode === 'saved') { codeState.file.content = codeTA().value; codeMarkDirty(true); }
  else codeState.scratchBuffers[codeState.scratchLang] = codeTA().value;
  codeSaveLS(); codeTA().focus(); codeHistButtons();
}
const codeUndo = () => codeHistNav(-1);
const codeRedo = () => codeHistNav(1);

function codeOnInput() {
  const v = codeTA().value;
  if (codeState.mode === 'saved') { codeState.file.content = v; codeMarkDirty(true); }
  else codeState.scratchBuffers[codeState.scratchLang] = v;
  codeSaveLS(); codeRenderGutter(); codeHighlight(); codeSyncScroll(); codeHistPush();
}
function codeStash() { const v = codeTA().value; if (codeState.mode === 'saved') codeState.file.content = v; else codeState.scratchBuffers[codeState.scratchLang] = v; }
function codeSetContent(text) { codeTA().value = text; codeRenderGutter(); codeHighlight(); codeSyncScroll(); }
function codeRenderGutter() {
  const inner = $('#code-gutter-inner');
  const n = codeTA().value.split('\n').length;
  if (inner._n !== n) { inner.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); inner._n = n; }
}
function codeSyncScroll() {
  const ta = codeTA();
  const c = $('#code-hl-code'); if (c) c.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  $('#code-gutter-inner').style.transform = `translateY(${-ta.scrollTop}px)`;
}
function codeHighlight() {
  const codeEl = $('#code-hl-code');
  if (!window.hljs) return; // plain mode (textarea shows its own text)
  const lang = codeCurLang() || 'plaintext';
  const text = codeTA().value;
  try { codeEl.innerHTML = window.hljs.highlight(text, { language: lang, ignoreIllegal: true }).value; }
  catch { codeEl.textContent = text; }
}
function codeApplyHljsMode() {
  const on = !!window.hljs;
  codeTA().classList.toggle('plain', !on);
  $('.code-hl').style.display = on ? '' : 'none';
}
function codeLoadHljs() {
  if (window.hljs) { codeApplyHljsMode(); codeHighlight(); return; }
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/hljs/theme.css'; document.head.appendChild(l);
  const s = document.createElement('script'); s.src = '/vendor/hljs/highlight.min.js';
  s.onload = () => { codeApplyHljsMode(); codeHighlight(); };
  s.onerror = () => codeApplyHljsMode(); // load failed → stay in plain mode
  document.head.appendChild(s);
}

// Pin the fixed Code view to the visual viewport so the symbol bar sits above the keyboard (iOS
// fallback; Android gets it from interactive-widget=resizes-content).
function codeViewportFit() {
  const vv = window.visualViewport, view = $('.view[data-view="code"]');
  if (!vv || !view || view.hidden) return;
  view.style.height = vv.height + 'px'; view.style.top = vv.offsetTop + 'px';
}
function codeViewportReset() { const v = $('.view[data-view="code"]'); if (v) { v.style.height = ''; v.style.top = ''; } }

// ---- mode (Scratch / Saved) ----
function codeApplyMode() {
  const view = $('.view[data-view="code"]');
  view.classList.toggle('mode-saved', codeState.mode === 'saved');
  view.classList.toggle('mode-scratch', codeState.mode !== 'saved');
  $$('#code-mode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === codeState.mode));
  if (codeState.mode !== 'saved') codeToggleSidebar(false);
}
function codeLoadBuffer() {
  if (codeState.mode === 'saved') {
    codeSetContent(codeState.file.content); $('#code-filename').value = codeState.file.name; codeMarkDirty(codeState.file.dirty);
  } else {
    codeSetContent(codeState.scratchBuffers[codeState.scratchLang] ?? CODE_STARTER); $('#code-lang').value = codeState.scratchLang;
  }
  codeHighlight(); codeHistReset();
}
function codeSetMode(mode) { codeStash(); codeState.mode = mode; codeApplyMode(); codeLoadBuffer(); codeSaveLS(); codeTA().focus(); }
function codeSetScratchLang(lang) {
  codeStash(); codeState.scratchLang = lang; $('#code-lang').value = lang;
  codeSetContent(codeState.scratchBuffers[lang] ?? CODE_STARTER); codeHighlight(); codeSaveLS(); codeHistReset();
}
async function codeLoadLangs() {
  try { const j = await api('/api/run/langs'); codeState.langs = (j.langs || []).filter((l) => l.found); }
  catch { codeState.langs = []; }
  const list = codeState.langs.length ? codeState.langs : [{ id: 'python', name: 'Python' }];
  const sel = $('#code-lang'); sel.innerHTML = '';
  for (const l of list) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; sel.appendChild(o); }
  if (!list.find((l) => l.id === codeState.scratchLang)) codeState.scratchLang = list[0].id;
  sel.value = codeState.scratchLang;
}

// ---- Saved files: project tree in the swipe-in sidebar ----
async function codeRefreshFiles() {
  try { const j = await api('/api/code/files'); codeState.codeDir = j.dir; codeState.files = j.files || []; }
  catch { codeState.codeDir = null; codeState.files = []; }
  $('#code-sidebar-title').textContent = codeState.codeDir ? codeState.codeDir.split(/[\\/]/).pop() : 'files';
  $('#code-save').disabled = !codeState.codeDir;
  codeRenderTree();
}
function codeBuildTree() {
  const root = { dirs: new Map(), files: [] };
  for (const f of codeState.files) {
    const parts = f.path.split('/'); let node = root;
    for (let i = 0; i < parts.length - 1; i++) { const d = parts[i]; if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] }); node = node.dirs.get(d); }
    node.files.push(f);
  }
  return root;
}
function codeRenderTree() {
  const el = $('#code-tree'); el.innerHTML = '';
  const empty = (t) => { const p = document.createElement('div'); p.className = 'code-file-empty'; p.textContent = t; el.appendChild(p); };
  if (!codeState.codeDir) return empty('Set run.dir in config.json to browse files.');
  if (!codeState.files.length) return empty('No code files yet — write one in Saved mode and Save.');
  const render = (node, prefix, depth) => {
    for (const d of [...node.dirs.keys()].sort()) {
      const path = prefix ? prefix + '/' + d : d, open = codeState.expanded.has(path);
      const row = document.createElement('button'); row.type = 'button'; row.className = 'code-tree-dir';
      row.style.paddingLeft = (8 + depth * 14) + 'px'; row.textContent = (open ? '▾ ' : '▸ ') + d;
      row.addEventListener('click', () => { open ? codeState.expanded.delete(path) : codeState.expanded.add(path); codeSaveLS(); codeRenderTree(); });
      el.appendChild(row);
      if (open) render(node.dirs.get(d), path, depth + 1);
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = document.createElement('button'); row.type = 'button';
      row.className = 'code-tree-file' + (codeState.mode === 'saved' && f.path === codeState.file.name ? ' active' : '');
      row.style.paddingLeft = (8 + depth * 14 + 14) + 'px'; row.textContent = f.name;
      row.addEventListener('click', () => codeOpenFile(f.path));
      el.appendChild(row);
    }
  };
  render(codeBuildTree(), '', 0);
}
// Mobile drawer open/close (transient overlay). Harmless no-op on desktop — `sidebar-open` isn't
// styled there; the persistent desktop dock is controlled separately by codeSidebarToggle().
function codeToggleSidebar(force) {
  const view = $('.view[data-view="code"]');
  const openIt = force !== undefined ? force : !view.classList.contains('sidebar-open');
  view.classList.toggle('sidebar-open', openIt);
  if (openIt) codeRefreshFiles();
}
// Desktop: toggle the persistent collapsible dock (mirrors toggleReaderSidebar), remembered across
// sessions. Mobile: same as the drawer toggle above. Bound to #code-files (☰, always visible in
// Saved mode, so it doubles as the "bring it back" control) and the in-sidebar ✕.
function codeSidebarToggle() {
  const view = $('.view[data-view="code"]');
  if (window.matchMedia('(min-width: 760px)').matches) {
    const hidden = view.classList.toggle('sidebar-hidden');
    localStorage.setItem('lifeos.codeSidebarHidden', hidden ? '1' : '0');
    if (!hidden) codeRefreshFiles();
  } else {
    codeToggleSidebar();
  }
}
async function codeOpenFile(rel) {
  let j; try { j = await api('/api/code/file?path=' + encodeURIComponent(rel)); } catch (e) { toast(e.message); return; }
  codeState.mode = 'saved'; codeState.file = { name: j.path, content: j.content, dirty: false };
  codeApplyMode(); codeLoadBuffer(); codeSaveLS();
  // Only auto-close the mobile drawer — the desktop dock stays put, like picking a note in Notes.
  if (!window.matchMedia('(min-width: 760px)').matches) codeToggleSidebar(false);
  codeTA().focus();
}
function codeNewFile() {
  codeState.mode = 'saved'; codeState.file = { name: 'untitled.py', content: CODE_STARTER, dirty: false };
  codeApplyMode(); codeLoadBuffer(); codeSaveLS();
  if (!window.matchMedia('(min-width: 760px)').matches) codeToggleSidebar(false);
  const fn = $('#code-filename'); fn.focus(); fn.select();
}
async function codeSave() {
  const name = $('#code-filename').value.trim();
  if (!name) { toast('Name the file first (e.g. hello.py)'); $('#code-filename').focus(); return; }
  if (!codeState.codeDir) { toast('No synced folder configured (run.dir)'); return; }
  try {
    const j = await api('/api/code/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name, content: codeTA().value }) });
    codeState.file.name = j.path; codeMarkDirty(false); codeSaveLS();
    toast('Saved · ' + j.path); codeRefreshFiles();
  } catch (e) { toast(e.message); }
}
// Live (Obsidian-style), same as the notes file drawer: tracks the finger frame by frame during the
// drag, then snaps open/closed at release based on how far it got dragged.
function codeSetupSwipe() {
  const view = $('.view[data-view="code"]');
  const drawer = $('#code-sidebar');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let sx = 0, sy = 0, live = false, mode = null, w = 0;

  function lockIn(m) { mode = m; w = drawer.offsetWidth; drawer.classList.add('dragging'); }
  function drag(dx) {
    if (mode === 'open') drawer.style.transform = `translateX(${clamp(-w + dx, -w, 0)}px)`;
    else if (mode === 'close') drawer.style.transform = `translateX(${clamp(dx, -w, 0)}px)`;
  }
  function settle(dx) {
    drawer.classList.remove('dragging'); drawer.style.transform = '';
    if (mode === 'open') codeToggleSidebar(dx > w * 0.35);
    else if (mode === 'close') codeToggleSidebar(dx > -w * 0.35);
    mode = null;
  }

  view.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { live = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; live = true; mode = null;
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (!live || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!mode) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;  // not a clear horizontal drag yet
      const open = view.classList.contains('sidebar-open');
      if (open && dx < 0) lockIn('close');
      else if (!open && dx > 0 && sx < 120 && codeState.mode === 'saved') lockIn('open'); // wide left-edge zone, Saved mode only
      else { live = false; return; }
    }
    e.preventDefault();
    drag(dx);
  }, { passive: false });
  view.addEventListener('touchend', (e) => {
    if (!live) return; live = false;
    if (!mode) return;
    settle(e.changedTouches[0].clientX - sx);
  }, { passive: true });
  // tap outside the drawer while open → close it
  view.addEventListener('pointerdown', (e) => {
    if (view.classList.contains('sidebar-open') && !e.target.closest('.code-sidebar') && !e.target.closest('#code-files')) codeToggleSidebar(false);
  }, true);
}
// Drag the sidebar's right edge to resize; width persists (desktop only), mirroring the notes file
// sidebar. Sets a CSS var the sidebar reads, so code-main (flex:1) reflows to fill the rest.
function setupCodeSidebarResize() {
  const handle = $('#code-sidebar-resize'), sidebar = $('#code-sidebar');
  if (!handle) return;
  const saved = localStorage.getItem('lifeos.codeSidebarW');
  if (saved) document.documentElement.style.setProperty('--code-sidebar-w', saved + 'px');
  let startX = 0, startW = 0, dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    let w = startW + (e.clientX - startX);
    w = Math.max(180, Math.min(w, 560, window.innerWidth - 300));
    document.documentElement.style.setProperty('--code-sidebar-w', Math.round(w) + 'px');
  };
  const end = () => {
    if (!dragging) return;
    dragging = false; sidebar.classList.remove('resizing');
    const w = document.documentElement.style.getPropertyValue('--code-sidebar-w').replace('px', '').trim();
    if (w) localStorage.setItem('lifeos.codeSidebarW', Math.round(parseFloat(w)));
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', end);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (!window.matchMedia('(min-width: 760px)').matches) return;
    dragging = true; startX = e.clientX; startW = sidebar.getBoundingClientRect().width;
    sidebar.classList.add('resizing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', end);
    e.preventDefault();
  });
}
function codeShowStatus(t, cls) { const el = $('#code-status'); el.textContent = t; el.className = 'code-status' + (cls ? ' ' + cls : ''); }
function codeSetOut(parts) {
  const body = $('#code-out-body'); body.innerHTML = '';
  for (const p of parts) { const span = document.createElement('span'); if (p.cls) span.className = p.cls; span.textContent = p.text; body.appendChild(span); }
}
function codeRenderOutput(r) {
  $('#code-output').hidden = false;
  const parts = [];
  if (r.stdout) parts.push({ text: r.stdout });
  if (r.stderr) parts.push({ cls: 'oe', text: r.stderr });
  if (!r.stdout && !r.stderr) parts.push({ cls: 'muted', text: r.timedOut ? '(killed — timed out)' : '(no output)' });
  codeSetOut(parts);
  const secs = (r.durationMs / 1000).toFixed(r.durationMs < 1000 ? 2 : 1);
  if (r.timedOut) codeShowStatus(`timed out · ${secs}s`, 'err');
  else if (r.phase === 'compile' && r.exitCode !== 0) codeShowStatus(`compile error · ${r.durationMs}ms`, 'err');
  else if (r.exitCode === 0) codeShowStatus(`exit 0 · ${r.durationMs}ms`, 'ok');
  else codeShowStatus(`exit ${r.exitCode} · ${r.durationMs}ms`, 'err');
}
async function codeRun() {
  if (codeState.running) return;
  const lang = codeCurLang();
  if (!lang) { toast('Pick a language / add a file extension to run'); return; }
  const src = codeTA().value;
  // scanf/cin/input(): surface the stdin box so the user can supply input (then re-run).
  if (codeReadsInput(src, lang) && $('#code-stdin-wrap').hidden) {
    $('#code-stdin-wrap').hidden = false; $('#code-stdin-toggle').classList.add('on');
    if (!$('#code-stdin').value.trim()) toast('Reads input — type it in the box above, then Run again');
  }
  codeState.running = true;
  const btn = $('#code-run'); btn.classList.add('running'); btn.disabled = true;
  codeShowStatus('running…', ''); $('#code-output').hidden = false; codeSetOut([{ cls: 'muted', text: '…' }]);
  try {
    const stdin = $('#code-stdin-wrap').hidden ? '' : $('#code-stdin').value;
    const { result } = await api('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, code: codeTA().value, stdin }),
    });
    codeRenderOutput(result);
  } catch (e) { codeShowStatus('error', 'err'); codeSetOut([{ cls: 'oe', text: e.message }]); toast(e.message); }
  finally { codeState.running = false; btn.classList.remove('running'); btn.disabled = false; }
}

/* ---- Code tutor: read-only chat scoped to the current buffer (same mechanics as the note tutor) ---- */
const codeChat = { msgs: [], busy: false };
function codeChatOutsideClose(e) {
  if (window.innerWidth >= 760) return;                 // desktop: dock sits beside, no tap-away needed
  if (e.target.closest('#code-chat') || e.target.closest('#code-chat-toggle')) return;
  closeCodeChat();
}
function closeCodeChat() {
  $('#code-chat').hidden = true;
  document.removeEventListener('click', codeChatOutsideClose, true);
}
function openCodeChat() {
  $('#code-chat').hidden = false;
  document.addEventListener('click', codeChatOutsideClose, true);
  renderCodeChat();
  setTimeout(() => $('#code-chat-input').focus(), 50);
}
function renderCodeChat() {
  const thread = $('#code-chat-thread');
  $('#code-chat-intro').hidden = codeChat.msgs.length > 0;
  thread.querySelectorAll('.bubble, .bubble-wrap').forEach((b) => b.remove());
  for (const m of codeChat.msgs) {
    if (m.role === 'user') {
      const b = document.createElement('div');
      b.className = 'bubble me'; b.innerHTML = esc(m.text).replace(/\n/g, '<br>');
      thread.appendChild(b); continue;
    }
    const b = document.createElement('div');
    b.className = 'bubble ai';
    b.innerHTML = m.text ? mdToHtml(m.text) : '<span class="typing">…</span>';
    thread.appendChild(b);
  }
  thread.scrollTop = thread.scrollHeight;
}
async function sendCodeChat(text) {
  const q = (text || '').trim();
  if (!q || codeChat.busy) return;
  const code = codeTA().value;
  if (!code.trim()) { toast('Write some code first'); return; }
  codeChat.msgs.push({ role: 'user', text: q });
  const ai = { role: 'ai', text: '' }; codeChat.msgs.push(ai);
  codeChat.busy = true;
  $('#code-chat-input').value = ''; $('#code-chat-send').disabled = true;
  renderCodeChat();
  try {
    const name = codeState.mode === 'saved' ? codeState.file.name : (codeState.scratchLang + ' · scratch');
    const resp = await fetch('/api/code/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, lang: codeCurLang() || '', code,
        messages: codeChat.msgs.filter((m) => m.text || m.role === 'user').map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text })),
      }),
    });
    if (!resp.ok || !resp.body) throw new Error('chat failed (' + resp.status + ')');
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ai.text += dec.decode(value, { stream: true }); renderCodeChat();
    }
    if (!ai.text.trim()) ai.text = '_(no answer)_';
  } catch (e) { ai.text = '⚠️ ' + e.message; }
  finally { codeChat.busy = false; $('#code-chat-send').disabled = false; renderCodeChat(); $('#code-chat-input').focus(); }
}

function codeInitOnce() {
  codeBuildSymbols(); codeSetupSwipe();
  $('#code-chat-toggle').addEventListener('click', () => { $('#code-chat').hidden ? openCodeChat() : closeCodeChat(); });
  $('#code-chat-close').addEventListener('click', closeCodeChat);
  $('#code-chat-clear').addEventListener('click', () => { codeChat.msgs = []; renderCodeChat(); });
  $('#code-chat-bar').addEventListener('submit', (e) => { e.preventDefault(); sendCodeChat($('#code-chat-input').value); });
  const ta = codeTA();
  ta.addEventListener('input', codeOnInput);
  ta.addEventListener('scroll', codeSyncScroll);
  ta.addEventListener('focus', codeViewportFit);
  ta.addEventListener('blur', codeViewportReset);
  ta.addEventListener('keydown', codeKeydown);
  codeVim = window.LifeVim.attach(ta, {
    onMode: (mode, pending) => {
      codeVimMode = mode;
      const bar = $('#code-vim-status');
      if (!mode) { bar.hidden = true; return; }
      bar.hidden = false; bar.dataset.mode = mode;
      bar.querySelector('.mode').textContent = mode;
      $('#code-vim-pending').textContent = pending || '';
    },
  });
  $$('#code-mode .seg-btn').forEach((b) => b.addEventListener('click', () => codeSetMode(b.dataset.mode)));
  $('#code-lang').addEventListener('change', (e) => codeSetScratchLang(e.target.value));
  $('#code-filename').addEventListener('input', () => { codeState.file.name = $('#code-filename').value; codeMarkDirty(true); codeSaveLS(); codeHighlight(); });
  $('#code-files').addEventListener('click', codeSidebarToggle);
  $('#code-sidebar-new').addEventListener('click', codeNewFile);
  $('#code-sidebar-close').addEventListener('click', codeSidebarToggle);
  setupCodeSidebarResize();
  // Desktop-only collapse preference, restored on first init (mirrors the notes file sidebar).
  if (window.matchMedia('(min-width: 760px)').matches) {
    $('.view[data-view="code"]').classList.toggle('sidebar-hidden', localStorage.getItem('lifeos.codeSidebarHidden') === '1');
  }
  $('#code-save').addEventListener('click', codeSave);
  $('#code-undo').addEventListener('click', codeUndo);
  $('#code-redo').addEventListener('click', codeRedo);
  $('#code-run').addEventListener('click', codeRun);
  $('#code-stdin-toggle').addEventListener('click', () => { const w = $('#code-stdin-wrap'); w.hidden = !w.hidden; $('#code-stdin-toggle').classList.toggle('on', !w.hidden); });
  $('#code-output-close').addEventListener('click', () => { $('#code-output').hidden = true; });
  $('#code-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#code-out-body').textContent); toast('Output copied'); } catch { toast('Copy failed'); } });
  $('#code-back').addEventListener('click', () => { codeOpen ? history.back() : codeClose(); });
  $('#code-output-collapse').addEventListener('click', () => {
    const p = $('#code-output'), c = p.classList.toggle('collapsed');
    $('#code-output-collapse').textContent = c ? '▸' : '▾';
  });
  if (window.visualViewport) { visualViewport.addEventListener('resize', codeViewportFit); visualViewport.addEventListener('scroll', codeViewportFit); }
  codeLoadHljs();
}
async function loadCode() {
  if (!codeState.inited) { codeInitOnce(); codeState.inited = true; }
  if (!codeOpen) { history.pushState({ code: true }, ''); codeOpen = true; }
  const d = codeLoadLS();
  if (d.mode === 'saved' || d.mode === 'scratch') codeState.mode = d.mode;
  if (d.scratchLang) codeState.scratchLang = d.scratchLang;
  if (d.scratchBuffers && typeof d.scratchBuffers === 'object') codeState.scratchBuffers = d.scratchBuffers;
  if (d.file && typeof d.file === 'object') codeState.file = { name: d.file.name || '', content: d.file.content || '', dirty: !!d.file.dirty };
  if (Array.isArray(d.expanded)) codeState.expanded = new Set(d.expanded);
  await codeLoadLangs();
  await codeRefreshFiles();
  codeApplyMode(); codeLoadBuffer();
  if (codeVim) codeVim.setEnabled(prefs.vim);
  codeViewportFit();
}

/* ---------- Boot ---------- */
(async function boot() {
  applyTheme(prefs.theme);
  applyWidth('note', prefs.noteWidth);
  applyWidth('code', prefs.codeWidth);
  $('#cfg-manual-provider').value = prefs.manualProvider;
  await refreshInbox();
  await loadNotes(true);
  show('inbox');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
