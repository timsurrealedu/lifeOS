'use strict';
/* ============ lifeOS frontend ============ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = async (path, opts) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  let r;
  try {
    r = await fetch(path, { ...opts, signal: ctl.signal });
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  }
  clearTimeout(t);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
  return j;
};
const toast = (msg) => {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  t.classList.remove('toast-out'); t.classList.add('toast-in');
  clearTimeout(toast._t); toast._t = setTimeout(() => {
    t.classList.remove('toast-in'); t.classList.add('toast-out');
    setTimeout(() => { t.hidden = true; t.classList.remove('toast-out'); }, 300);
  }, 2600);
};


/* ---------- Animation utilities ---------- */
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(selector, animationClass, duration = 400) {
  if (prefersReduced()) return;
  const els = typeof selector === 'string' ? $$(selector) : [selector];
  els.forEach((el) => { el.classList.add(animationClass); setTimeout(() => el.classList.remove(animationClass), duration); });
}
function staggerChildren(parent, childSelector, animationClass = 'stagger-in', staggerMs = 50, delayMs = 0) {
  if (prefersReduced()) return;
  const container = typeof parent === 'string' ? $(parent) : parent;
  if (!container) return;
  const children = [...container.querySelectorAll(childSelector || ':scope > *')];
  children.forEach((c, i) => { c.style.animationDelay = `${delayMs + i * staggerMs}ms`; c.classList.add(animationClass); setTimeout(() => { c.classList.remove(animationClass); c.style.animationDelay = ''; }, delayMs + i * staggerMs + 600); });
}
function fadeIn(el, duration = 400) {
  if (prefersReduced()) { el.style.opacity = '1'; return; }
  el.style.opacity = '0'; el.style.transition = `opacity ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`; requestAnimationFrame(() => { el.style.opacity = '1'; }); setTimeout(() => { el.style.transition = ''; }, duration);
}
function slideUp(el, duration = 500) {
  if (prefersReduced()) { el.style.opacity = '1'; el.style.transform = ''; return; }
  el.style.opacity = '0'; el.style.transform = 'translateY(20px)'; el.style.transition = `opacity ${duration}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`;
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, duration);
}
function hideLoader() {
  const l = $('#app-loader'); if (!l) return;
  l.style.transition = 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1)';
  l.style.opacity = '0'; setTimeout(() => { l.hidden = true; l.style.transition = ''; l.style.opacity = '1'; }, 600);
}
function showSkeleton(container) {
  const c = typeof container === 'string' ? $(container) : container;
  if (!c) return;
  const s = document.createElement('div');
  s.className = 'skeleton skeleton-card'; s.innerHTML = '<div class="skeleton-text"></div><div class="skeleton-text" style="width:70%"></div>';
  c.appendChild(s);
  return s;
}
function hideSkeleton(container) {
  const c = typeof container === 'string' ? $(container) : container;
  if (!c) return;
  const s = c.querySelector('.skeleton');
  if (s) { s.style.transition = 'opacity 300ms ease'; s.style.opacity = '0'; setTimeout(() => s.remove(), 300); }
}
function observeAnimations() {
  if (prefersReduced()) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('enter-slide-up'); io.unobserve(e.target); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  $$('.view').forEach((v) => {
    const targets = v.querySelectorAll('.list-item, .tree-row, .task, .plan-group, .sv-metric, .sv-card, .sv-bar, .cal-cell, .bubble, .code-tree-file, .code-tree-dir');
    targets.forEach((t) => { t.classList.add('will-animate'); io.observe(t); });
  });
}
function initSpotlight() {
  if (prefersReduced() || window.matchMedia('(pointer: coarse)').matches) return;
  const hero = $('.hero') || $('.view[data-view="home"]');
  if (!hero) return;
  let sp = hero.querySelector('.spotlight');
  if (!sp) { sp = document.createElement('div'); sp.className = 'spotlight'; sp.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;opacity:0;transition:opacity 400ms ease'; hero.style.position = 'relative'; hero.appendChild(sp); }
  hero.addEventListener('mousemove', (e) => {
    const r = hero.getBoundingClientRect();
    sp.style.background = `radial-gradient(600px circle at ${e.clientX - r.left}px ${e.clientY - r.top}px, rgba(139,92,246,0.08), transparent 60%)`;
    sp.style.opacity = '1';
  });
  hero.addEventListener('mouseleave', () => { sp.style.opacity = '0'; });
}
function initGlassHeader() {
  const topbar = $('.topbar');
  const views = $('#views');
  if (!topbar || !views) return;
  const onScroll = () => { topbar.classList.toggle('glass', views.scrollTop > 8); };
  views.addEventListener('scroll', onScroll, { passive: true }); onScroll();
}
const state = { inbox: [], notes: [], folders: null, systemFolders: [], stagingFolders: [], showStaging: false, view: 'home', pendingPhoto: null, pendingPhotoKind: null, pendingStrokes: null, pendingDoc: null, graph: null, expandedFolders: new Set(), readerPath: null, readerContent: '', chat: [], chatBusy: false, noteChat: [], noteChatBusy: false, planView: 'list', calMonth: null };
state._firstRender = { home: true, vault: true, plan: true, calendar: true, tools: true, code: true, stewie: true };
state._shownViews = new Set();
let stewieVideos = [], pegilagiVideos = [], stewieVideoStats = null, stewieOpen = false, studioPipeline = 'stewie';

/* ---------- Preferences (theme + editor) — persisted locally ---------- */
const THEMES = ['dark', 'light', 'netrunner'];
const THEME_BG = { dark: '#0a0a0f', light: '#fafafa', netrunner: '#030508' };
const WIDTHS = ['narrow', 'default', 'wide', 'full'];
const WIDTH_PX = { narrow: '560px', default: 'var(--max)', wide: '960px', full: 'none' };
const prefs = {
  get theme() { return localStorage.getItem('lifeos.theme') || 'light'; },
  get vim() { return localStorage.getItem('lifeos.vim') === '1'; },
  get lineno() { return localStorage.getItem('lifeos.lineno') === '1'; },
  get livepreview() { return localStorage.getItem('lifeos.livepreview') !== '0'; }, // default on
  get noteWidth() { return localStorage.getItem('lifeos.noteWidth') || 'default'; },
  get codeWidth() { return localStorage.getItem('lifeos.codeWidth') || 'full'; },
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
const TAB_VIEW = { home: 'home', vault: 'vault', plan: 'plan' };
function show(tab) {
  if (tab !== 'code') state.prevTab = tab;                   // Code is full-screen; Back returns here
  const view = TAB_VIEW[tab] || tab;                         // fallback for tabs not in TAB_VIEW
  const views = $('#views');
  if (views) views.scrollTop = 0;
  document.scrollingElement?.scrollTo?.(0, 0);
  const isFirstTime = !state._shownViews.has(view);
  state._shownViews.add(view);
  if (isFirstTime) state._firstRender[view] = true;
  state.view = view;
  const prev = document.querySelector('.view:not([hidden])');
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.sidenav-item').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const next = document.querySelector('.view[data-view="' + view + '"]');
  if (prev && next && prev !== next) {
    if (isFirstTime) { fadeIn(next, 300); }
  }
  if (view === 'home') { renderInbox(); renderHomeAnalytics(); }
  if (view === 'tools' || view === 'email') loadDiscover();
  if (view === 'vault') loadNotes();
  if (view === 'plan') loadPlan();
  if (view === 'code') loadCode();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
$$('.sidenav-item').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));

// Inbox ⇄ Chat toggle (one view, like Browse's Files/Graph).
function setCaptureMode(chat) {
  $$('#capture-seg .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.cap === (chat ? 'chat' : 'inbox')));
  // CSS drives show/hide per breakpoint off .chat on the layout (mobile swaps columns,
  // desktop keeps the inbox and swaps only the side panel). No dead `.hidden` juggling.
  $('.dashboard-layout').classList.toggle('chat', chat);
  $('.view[data-view="home"]').classList.toggle('chat-mode', chat);
  $('#capture-title').textContent = chat ? 'Chat' : 'Inbox';
  if (chat) { $('#cap-crumb').textContent = 'Advisor'; renderChat(); }
  else if (window._capTick) window._capTick(); // repaint day/date now, not after the next 15s tick
}
$('#capture-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  setCaptureMode(b.dataset.cap === 'chat');
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
  const bd = $('#backdrop'); const sh = $('#' + id);
  bd.hidden = false; sh.hidden = false;
  bd.classList.add('backdrop-fade');
  sh.classList.add('sheet-up');
  setTimeout(() => { bd.classList.remove('backdrop-fade'); sh.classList.remove('sheet-up'); }, 450);
}
function closeSheets() {
  stopCam();
  const bd = $('#backdrop');
  $$('.sheet').forEach((s) => { if (!s.hidden) { s.classList.add('sheet-down'); s.style.transform = 'translateY(100%)'; s.style.transition = 'transform 350ms cubic-bezier(0.7, 0, 0.84, 0)'; setTimeout(() => { s.hidden = true; s.classList.remove('sheet-down'); s.style.transform = ''; s.style.transition = ''; }, 350); } });
  bd.style.transition = 'opacity 300ms cubic-bezier(0.7, 0, 0.84, 0)'; bd.style.opacity = '0';
  setTimeout(() => { bd.hidden = true; bd.style.opacity = '1'; bd.style.transition = ''; }, 300);
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
  if (act === 'open-tools') show('tools');
  if (act === 'open-email-manager') openEmailManager();
  if (act === 'open-home') show('home');
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
// Settings has one shared "default AI provider" picker (Claude/Kimi/DeepSeek) that every
// manual trigger below (Process inbox, Weekly review, Refresh home, Auto-sort, Calendar sync) reads
// before starting — so testing/forcing a fallback doesn't need a separate button per job.
const manualProvider = () => { const v = $('#cfg-default-provider')?.value; return v && v !== 'claude' ? v : undefined; };
const withProvider = (url) => {
  const p = manualProvider();
  if (!p) return url;
  return url + (url.includes('?') ? '&' : '?') + 'provider=' + encodeURIComponent(p);
};
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

// provider (optional, 'Kimi'/'DeepSeek') → force the run through that fallback to test it.
function startProcess(provider) {
  const url = '/api/process/stream' + (provider ? '?provider=' + encodeURIComponent(provider) : '');
  startStream(url, { title: provider ? `Testing ${provider}…` : 'Processing inbox…', onDone: (_out, _code, info) => afterProcess(info) });
}

async function afterProcess(info) {
  await refreshInbox();
  state.notes = []; // force reload next visit
  if (state.view === 'tools') loadDiscover();
  toast(info && info.skipped ? 'Nothing to process' : 'Inbox processed');
}

/* ---------- Discover (research / find / lists / more) ---------- */
$('#btn-research').addEventListener('click', () => {
  const idea = $('#research-input').value.trim();
  if (!idea) { toast('Type an idea first'); return; }
  startStream(withProvider('/api/research/stream?idea=' + encodeURIComponent(idea)), {
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

const WORK_CHANNEL_STATUSES = ['Live', 'Building', 'Planned'];
const WORK_CHANNEL_FOLDER = 'Work/Channels';
const WORK_OUTREACH_FOLDER = 'Work/Outreach';
state.workFilter = 'all';
state.work = normalizeWorkState(null);
state.trading = null;
let workLoaded = false;
let workLiveAnalytics = null;

function normalizeWorkState(raw) {
  const out = raw && typeof raw === 'object' ? raw : {};
  return {
    channels: Array.isArray(out.channels) ? out.channels.map((channel) => ({
      id: channel?.id || ('ch-' + Math.random().toString(36).slice(2, 9)),
      name: channel?.name || 'Untitled channel',
      platform: channel?.platform || 'YouTube',
      niche: channel?.niche || channel?.format || '',
      status: channel?.status || 'Planned',
      cadence: channel?.cadence || '',
      revenue: channel?.revenue || '',
      notePath: channel?.notePath || '',
      snapshots: Array.isArray(channel?.snapshots) ? channel.snapshots.map((snap) => ({
        id: snap?.id || ('chsnap-' + Math.random().toString(36).slice(2, 9)),
        date: snap?.date || todayStr(),
        followers: Number(snap?.followers) || 0,
        views: Number(snap?.views) || 0,
        posts: Number(snap?.posts) || 0,
        revenue: Number(snap?.revenue) || 0,
      })) : [],
    })) : [],
    bot: {
      snapshots: Array.isArray(out.bot?.snapshots) ? out.bot.snapshots : [],
      positions: Array.isArray(out.bot?.positions) ? out.bot.positions : [],
    },
    outreach: {
      leads: Array.isArray(out.outreach?.leads) ? out.outreach.leads.map((lead) => ({
        id: lead?.id || ('lead-' + Math.random().toString(36).slice(2, 9)),
        business: lead?.business || 'Untitled lead',
        contact: lead?.contact || '',
        email: lead?.email || '',
        website: lead?.website || '',
        offer: lead?.offer || '',
        status: lead?.status === 'New' ? 'Review' : (lead?.status || 'Review'),
        lastContact: lead?.lastContact || '',
        followUp: lead?.followUp || '',
        notePath: lead?.notePath || '',
        responseSummary: lead?.responseSummary || '',
      })) : [],
    },
  };
}
async function loadWorkState(force) {
  if (workLoaded && !force) return state.work;
  const { state: saved } = await api('/api/work');
  state.work = normalizeWorkState(saved);
  workLoaded = true;
  return state.work;
}
function fallbackTrading() {
  return { status: 'saved', snapshots: state.work.bot.snapshots || [], positions: state.work.bot.positions || [] };
}
function currentTrading() {
  return state.trading || fallbackTrading();
}
async function refreshTradingSummary(silent = true) {
  try {
    const { summary } = await api('/api/trading/summary');
    state.trading = {
      ...summary,
      snapshots: Array.isArray(summary?.snapshots) ? summary.snapshots : [],
      positions: Array.isArray(summary?.positions) ? summary.positions : [],
    };
    renderWorkDashboard();
    return state.trading;
  } catch (e) {
    state.trading = null;
    renderWorkDashboard();
    if (!silent) toast(e.message);
    return null;
  }
}
async function refreshStudioSummary() {
  try {
    const [stewie, pegilagi] = await Promise.allSettled([
      Promise.all([api('/api/stewie/analytics'), api('/api/stewie/videos')]),
      api('/api/pegilagi/videos'),
    ]);
    if (stewie.status === 'fulfilled') {
      const [{ analytics }, { videos }] = stewie.value;
      workLiveAnalytics = (analytics && analytics.now) || workLiveAnalytics;
      stewieVideos = Array.isArray(videos) ? videos : stewieVideos;
    }
    if (pegilagi.status === 'fulfilled') {
      pegilagiVideos = Array.isArray(pegilagi.value.items) ? pegilagi.value.items : pegilagiVideos;
    }
  } catch {}
}
async function saveWorkState() {
  const { state: saved } = await api('/api/work', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: state.work }),
  });
  state.work = normalizeWorkState(saved);
}
function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}
function shiftDate(delta) {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
function fmtMoney(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(Number(n) || 0);
}
function channelSnapshots(channel) {
  return [...(Array.isArray(channel?.snapshots) ? channel.snapshots : [])].sort((a, b) => a.date.localeCompare(b.date));
}
function latestChannelSnapshot(channel) {
  return channelSnapshots(channel).at(-1) || null;
}
function platformAudienceLabel(platform) {
  return platform === 'YouTube' ? 'Subscribers' : 'Followers';
}
function buildLeadAutomation(lead) {
  const contact = lead.contact || 'there';
  const site = lead.website || 'their current site';
  const fitSummary = `${lead.business} fits the outreach list because the offer maps directly to ${site} and can improve ${lead.offer.toLowerCase()}.`;
  const openerSubject = `Quick website idea for ${lead.business}`;
  const openerBody = `Hi ${contact},

I had a quick look at ${lead.business} and saw a clear opportunity around ${lead.offer.toLowerCase()}.

I can put together a focused website update plan with practical fixes that should make the site convert better without a full rebuild.

If you're open to it, I can send a short teardown with concrete ideas.

Best,`;
  const replySubject = `Re: website ideas for ${lead.business}`;
  const replyBody = `Hi ${contact},

Thanks for the reply.

Based on what you shared${lead.responseSummary ? ` about "${lead.responseSummary}"` : ''}, I’d suggest we focus first on ${lead.offer.toLowerCase()} so the site has one clear conversion path before anything broader.

If helpful, I can send a quick action plan with the first changes I’d make and the rough scope to build it.

Best,`;
  return {
    fitSummary,
    openerSubject,
    openerBody,
    replySubject,
    replyBody,
    recommendedAction: lead.responseSummary ? 'Reply draft ready for review.' : 'Initial outreach draft ready for review.',
  };
}
function composeLeadDraft(lead, kind = 'opener') {
  const ai = buildLeadAutomation(lead);
  const subject = kind === 'reply' ? ai.replySubject : ai.openerSubject;
  const body = kind === 'reply' ? ai.replyBody : ai.openerBody;
  window.location.href = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function remapWorkPath(path) {
  const p = String(path || '');
  if (p.startsWith('Ideas/Channels/')) return WORK_CHANNEL_FOLDER + '/' + p.slice('Ideas/Channels/'.length);
  if (p.startsWith('Personal/Outreach/')) return WORK_OUTREACH_FOLDER + '/' + p.slice('Personal/Outreach/'.length);
  return p;
}
async function migrateWorkFolders() {
  let changed = false;
  const noteSet = new Set(state.notes.map((n) => n.path));
  const migrateEntry = async (entry, targetFolder) => {
    if (!entry?.notePath) return;
    const nextPath = remapWorkPath(entry.notePath);
    if (nextPath === entry.notePath) return;
    if (noteSet.has(entry.notePath)) {
      const { path } = await api('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: entry.notePath, dest: targetFolder }),
      });
      entry.notePath = path;
    } else {
      entry.notePath = nextPath;
    }
    changed = true;
  };
  for (const channel of state.work.channels) await migrateEntry(channel, WORK_CHANNEL_FOLDER);
  for (const lead of state.work.outreach.leads) await migrateEntry(lead, WORK_OUTREACH_FOLDER);
  if (!changed) return;
  await saveWorkState();
  state.notes = [];
  await loadNotes(true);
}
async function refreshWorkDependencies() {
  await Promise.all([
    loadWorkState(),
    state.notes.length ? Promise.resolve() : loadNotes(true),
    refreshTradingSummary(),
    refreshStudioSummary(),
  ]);
  await migrateWorkFolders();
}
async function createWorkNote({ title, folder, lines }) {
  const { path } = await api('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, folder, content: lines.filter(Boolean).join('\n'), draft: false }),
  });
  state.notes = [];
  await loadNotes(true);
  return path;
}
async function scheduleWorkTask(desc, date) {
  await api('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ desc, date }),
  });
}
function workSpark(values, stroke = 'var(--accent)') {
  if (values.length < 2) return '<div class="work-chart-empty">Add more snapshots to draw the curve.</div>';
  const w = 320, h = 120, pad = 8;
  const max = Math.max(...values), min = Math.min(...values), range = (max - min) || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), h - pad - ((v - min) / range) * (h - pad * 2)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Balance trend">
    <defs><linearGradient id="work-balance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity=".28"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#work-balance-fill)"></polygon>
    <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${stroke}"></circle>
  </svg>`;
}
function renderWorkDashboard() {
  if (!$('#ops-lanes')) return;
  renderOpsLanes();
  renderWorkStudio();
  renderWorkChannels();
  renderWorkBot();
  renderWorkOutreach();
  renderHomeAutomation();
}
function renderOpsLanes() {
  const channels = state.work.channels;
  const live = Math.max(channels.filter((c) => c.status === 'Live').length, workLiveAnalytics?.title ? 1 : 0);
  const stewieQueue = stewieVideos.filter((v) => v.status === 'pending' || v.status === 'approved').length;
  const pegilagiQueue = pegilagiVideos.filter((v) => v.status === 'needs_approval' || v.status === 'render_pending').length;
  const queue = stewieQueue + pegilagiQueue;
  const trading = currentTrading();
  const latest = [...(trading.snapshots || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).at(-1);
  const active = state.work.outreach.leads.filter((l) => l.status !== 'Archived');
  const review = active.filter((l) => l.status === 'Review').length;
  const due = active.filter((l) => l.followUp && l.followUp <= todayStr() && l.status !== 'Responded').length;
  if ($('#ops-channel-value')) $('#ops-channel-value').textContent = `${live} live`;
  if ($('#ops-channel-sub')) $('#ops-channel-sub').textContent = `${channels.length} lanes tracked · ${queue} in studio queue`;
  if ($('#ops-trading-value')) $('#ops-trading-value').textContent = latest ? fmtMoney(latest.balance) : 'No snapshot';
  if ($('#ops-trading-sub')) $('#ops-trading-sub').textContent = latest ? `${latest.pnl > 0 ? '+' : ''}${Number(latest.pnl).toFixed(2)}% · ${(trading.positions || []).length} positions · ${trading.status || 'saved'}` : 'Freqtrade waiting for data';
  if ($('#ops-outreach-value')) $('#ops-outreach-value').textContent = `${review} to review`;
  if ($('#ops-outreach-sub')) $('#ops-outreach-sub').textContent = `${active.length} active leads · ${due} due today`;
}
function renderWorkStudio() {
  const liveChannels = state.work.channels.filter((c) => c.status === 'Live');
  const queue = stewieVideos.filter((v) => v.status === 'pending' || v.status === 'approved').length
    + pegilagiVideos.filter((v) => v.status === 'needs_approval' || v.status === 'render_pending').length;
  const approved = stewieVideos.filter((v) => v.status === 'approved').length;
  const laneList = state.work.channels.length
    ? [...state.work.channels].sort((a, b) => WORK_CHANNEL_STATUSES.indexOf(a.status) - WORK_CHANNEL_STATUSES.indexOf(b.status))
    : (workLiveAnalytics?.title ? [{
      id: 'stewie-live',
      name: workLiveAnalytics.title,
      platform: 'YouTube',
      status: 'Live',
      niche: 'Connected via Stewie',
      cadence: `${Number(workLiveAnalytics.videos || 0).toLocaleString()} videos`,
      revenue: `${Number(workLiveAnalytics.views || 0).toLocaleString()} views`,
      snapshots: [{
        id: 'stewie-live-snap',
        date: todayStr(),
        followers: Number(workLiveAnalytics.subs || 0),
        views: Number(workLiveAnalytics.views || 0),
        posts: Number(workLiveAnalytics.videos || 0),
        revenue: 0,
      }],
    }] : []);
  $('#work-studio-metrics').innerHTML = [
    ['Live lanes', Math.max(liveChannels.length, workLiveAnalytics?.title ? 1 : 0), 'channels publishing now'],
    ['Render queue', queue, stewieVideos.length || pegilagiVideos.length ? 'connected renderers' : 'refresh to sync'],
    ['Approved', approved, 'Stewie ready to upload'],
    ['Platforms', new Set([...state.work.channels.map((c) => c.platform), ...(pegilagiVideos.length ? ['TikTok', 'Instagram', 'YouTube'] : [])]).size, 'distribution surfaces'],
  ].map(([label, value, sub]) => `<div class="work-mini-card"><span class="work-mini-label">${esc(label)}</span><span class="work-mini-value tabular">${esc(String(value))}</span><span class="work-mini-sub">${esc(sub)}</span></div>`).join('');
  $('#work-channel-brief').innerHTML = laneList.length
    ? laneList.map((c) => {
      const snap = latestChannelSnapshot(c);
      return `<div class="work-item"><div class="work-item-head"><span class="work-item-title">${esc(c.name)}</span><span class="work-pill ${slug(c.status)}">${esc(c.status)}</span><span class="work-pill">${esc(c.platform)}</span></div><div class="work-item-meta"><span>${esc(c.niche || 'Format pending')}</span><span>•</span><span>${esc(c.cadence || 'Cadence TBD')}</span><span>•</span><span>${snap ? `${(Number(snap.followers) || 0).toLocaleString()} ${platformAudienceLabel(c.platform).toLowerCase()}` : 'No analytics logged yet'}</span></div></div>`;
    }).join('')
    : '<div class="work-item"><div class="work-note">Open Studio to review publishing lanes and queue stats.</div></div>';
}
function renderWorkChannels() {
  const metricWrap = $('#work-channel-metrics');
  const list = $('#work-channel-list');
  const select = $('#work-channel-snapshot-id');
  if (!metricWrap || !list) return;
  list.innerHTML = '';
  if (select) {
    select.innerHTML = state.work.channels.length
      ? state.work.channels.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.platform)}</option>`).join('')
      : '<option value="">Add a channel first</option>';
    select.disabled = !state.work.channels.length;
  }
  const channels = [...state.work.channels].sort((a, b) => WORK_CHANNEL_STATUSES.indexOf(a.status) - WORK_CHANNEL_STATUSES.indexOf(b.status));
  const latestSnaps = channels.map((channel) => latestChannelSnapshot(channel)).filter(Boolean);
  metricWrap.innerHTML = [
    ['Tracked lanes', channels.length, 'across platforms'],
    ['Audience', latestSnaps.reduce((sum, snap) => sum + (Number(snap.followers) || 0), 0).toLocaleString(), 'latest combined'],
    ['Views', latestSnaps.reduce((sum, snap) => sum + (Number(snap.views) || 0), 0).toLocaleString(), 'latest combined'],
    ['Revenue', fmtMoney(latestSnaps.reduce((sum, snap) => sum + (Number(snap.revenue) || 0), 0)), 'latest combined'],
  ].map(([label, value, sub]) => `<div class="work-mini-card"><span class="work-mini-label">${esc(label)}</span><span class="work-mini-value tabular">${esc(String(value))}</span><span class="work-mini-sub">${esc(sub)}</span></div>`).join('');
  channels.forEach((c) => {
    const snap = latestChannelSnapshot(c);
    const item = document.createElement('div');
    item.className = 'work-item';
    item.innerHTML = `<div class="work-item-head"><span class="work-item-title">${esc(c.name)}</span><span class="work-pill ${slug(c.status)}">${esc(c.status)}</span></div>
      <div class="work-item-meta"><span>${esc(c.platform)}</span><span>•</span><span>${esc(c.niche)}</span><span>•</span><span>${esc(c.cadence || 'Cadence TBD')}</span></div>
      <div class="work-item-stats">
        <div class="work-stat"><span class="work-stat-label">${esc(platformAudienceLabel(c.platform))}</span><span class="work-stat-value tabular">${snap ? Number(snap.followers).toLocaleString() : '—'}</span></div>
        <div class="work-stat"><span class="work-stat-label">Views</span><span class="work-stat-value tabular">${snap ? Number(snap.views).toLocaleString() : '—'}</span></div>
        <div class="work-stat"><span class="work-stat-label">Posts</span><span class="work-stat-value tabular">${snap ? Number(snap.posts).toLocaleString() : '—'}</span></div>
        <div class="work-stat"><span class="work-stat-label">Revenue</span><span class="work-stat-value tabular">${snap ? fmtMoney(snap.revenue) : '—'}</span></div>
      </div>
      <div class="work-note">${esc(c.revenue || 'Revenue model not set yet.')}</div>
      <div class="work-item-actions">
        ${c.notePath ? `<button class="chip" data-work-channel-open="${esc(c.id)}">Open note</button>` : ''}
        <button class="chip" data-work-channel-status="${esc(c.id)}">Advance stage</button>
        <button class="chip" data-work-channel-delete="${esc(c.id)}">Remove</button>
      </div>`;
    list.appendChild(item);
  });
}
function renderWorkBot() {
  const trading = currentTrading();
  const snaps = [...(trading.snapshots || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const positions = trading.positions || [];
  const latest = snaps.at(-1);
  $('#work-bot-metrics').innerHTML = latest ? [
    ['Balance', fmtMoney(latest.balance), latest.date],
    ['Total P&L', `${latest.pnl > 0 ? '+' : ''}${Number(latest.pnl).toFixed(2)}%`, 'overall'],
    ['Win rate', `${Number(latest.winRate).toFixed(1)}%`, trading.status === 'live' ? 'Freqtrade live' : 'saved snapshot'],
    ['Open trades', latest.openTrades, `${positions.length} open positions`],
  ].map(([label, value, sub]) => `<div class="work-mini-card"><span class="work-mini-label">${esc(label)}</span><span class="work-mini-value tabular">${esc(String(value))}</span><span class="work-mini-sub">${esc(String(sub))}</span></div>`).join('')
  : [
    ['Balance', '—', 'Freqtrade unavailable'],
    ['Total P&L', '—', 'waiting for bot'],
    ['Win rate', '—', 'waiting for bot'],
    ['Open trades', 0, 'no open positions'],
  ].map(([label, value, sub]) => `<div class="work-mini-card"><span class="work-mini-label">${esc(label)}</span><span class="work-mini-value tabular">${esc(String(value))}</span><span class="work-mini-sub">${esc(String(sub))}</span></div>`).join('');
  $('#work-bot-chart').innerHTML = workSpark(snaps.map((s) => Number(s.balance) || 0), '#3B82F6');
  const posWrap = $('#work-position-list');
  posWrap.innerHTML = positions.length
    ? positions.map((p) => `<div class="work-item"><div class="work-item-head"><span class="work-item-title">${esc(p.pair)}</span><span class="work-pill ${slug(p.side)}">${esc(p.side)}</span><span class="tabular ${Number(p.pnl) >= 0 ? 'up' : 'down'}">${Number(p.pnl) >= 0 ? '+' : ''}${Number(p.pnl).toFixed(2)}%</span></div><div class="work-item-meta"><span>${esc(p.openDate ? fmtDate(String(p.openDate).slice(0, 10)) : 'Open position')}</span><span>·</span><span>${p.openRate ? esc('Open ' + Number(p.openRate).toLocaleString()) : 'Freqtrade'}</span></div></div>`).join('')
    : '<div class="work-item"><div class="work-note">No open Freqtrade positions.</div></div>';
}
function renderWorkOutreach() {
  const leads = state.work.outreach.leads;
  const active = leads.filter((l) => l.status !== 'Archived');
  const due = active.filter((l) => l.followUp && l.followUp <= todayStr() && l.status !== 'Responded');
  const responded = active.filter((l) => l.status === 'Responded').length;
  const waiting = active.filter((l) => l.status === 'Waiting').length;
  const metrics = $('#work-outreach-metrics');
  if (metrics) metrics.innerHTML = [
    ['Queued', active.filter((l) => l.status === 'Review').length, 'ready for review'],
    ['Waiting', waiting, 'awaiting reply'],
    ['Replied', responded, 'reply draft available'],
    ['Due today', due.length, 'needs follow-up'],
  ].map(([label, value, sub]) => `<div class="work-mini-card"><span class="work-mini-label">${esc(label)}</span><span class="work-mini-value tabular">${esc(String(value))}</span><span class="work-mini-sub">${esc(sub)}</span></div>`).join('');
  $$('#work-lead-filters .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.workFilter === state.workFilter));
  const list = $('#work-lead-list');
  if (!list) return;
  const filtered = active.filter((lead) => {
    if (state.workFilter === 'all') return true;
    if (state.workFilter === 'active') return lead.status === 'Review' || lead.status === 'Waiting';
    if (state.workFilter === 'followup') return !!lead.followUp && lead.followUp <= todayStr() && lead.status !== 'Responded';
    if (state.workFilter === 'responded') return lead.status === 'Responded';
    return true;
  });
  list.innerHTML = filtered.length ? filtered.map((l) => {
    const ai = buildLeadAutomation(l);
    const follow = l.followUp ? fmtDate(l.followUp) : 'No follow-up set';
    const isReply = !!l.responseSummary;
    return `<div class="work-item">
      <div class="work-item-head"><span class="work-item-title">${esc(l.business)}</span><span class="work-pill ${slug(l.status)}">${esc(l.status)}</span></div>
      <div class="work-item-meta"><span>${esc(l.contact || 'No contact name')}</span><span>•</span><span>${esc(l.email)}</span><span>•</span><span>${esc(l.website || 'No site captured')}</span></div>
      <div class="work-note">${esc(l.offer)}</div>
      <div class="work-ai-block"><span class="work-ai-label">AI target report</span><p class="work-ai-copy">${esc(ai.fitSummary)}</p><p class="work-card-note">${esc(ai.recommendedAction)}</p></div>
      <div class="work-ai-block"><span class="work-ai-label">${isReply ? 'Suggested reply' : 'Suggested opener'}</span><p class="work-ai-copy">${esc((isReply ? ai.replyBody : ai.openerBody).split('\n\n').slice(0, 2).join(' '))}</p></div>
      <div class="work-item-meta"><span>Last contact: ${esc(l.lastContact ? fmtDate(l.lastContact) : 'Not sent')}</span><span>•</span><span>Follow-up: ${esc(follow)}</span></div>
      <div class="work-item-actions">
        ${l.notePath ? `<button class="chip" data-work-lead-open="${esc(l.id)}">Open note</button>` : ''}
        <button class="chip" data-work-lead-review="${esc(l.id)}">${isReply ? 'Review reply' : 'Review draft'}</button>
        <button class="chip" data-work-lead-send="${esc(l.id)}">Approve send</button>
        <button class="chip" data-work-lead-responded="${esc(l.id)}">Log reply</button>
        <button class="chip" data-work-lead-followup="${esc(l.id)}">+3d follow-up</button>
        <button class="chip" data-work-lead-delete="${esc(l.id)}">Remove</button>
      </div>
    </div>`;
  }).join('') : '<div class="work-item"><div class="work-note">No leads in this filter.</div></div>';
}
function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
$('#work-channel-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const channel = {
    id: uid('ch'),
    name: $('#work-channel-name').value.trim(),
    platform: $('#work-channel-platform').value,
    niche: $('#work-channel-niche').value.trim(),
    status: $('#work-channel-status').value,
    cadence: $('#work-channel-cadence').value.trim(),
    revenue: $('#work-channel-revenue').value.trim(),
    notePath: '',
    snapshots: [],
  };
  try {
    channel.notePath = await createWorkNote({
      title: `${channel.name} channel`,
      folder: WORK_CHANNEL_FOLDER,
      lines: [
        `# ${channel.name}`,
        '',
        `- Platform: ${channel.platform}`,
        `- Status: ${channel.status}`,
        `- Niche: ${channel.niche}`,
        `- Cadence: ${channel.cadence || 'TBD'}`,
        `- Revenue model: ${channel.revenue || 'TBD'}`,
      ],
    });
    state.work.channels.unshift(channel);
    await saveWorkState();
    e.target.reset();
    renderWorkDashboard();
    toast('Channel saved');
  } catch (err) { toast(err.message); }
});
$('#work-channel-snapshot-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const channel = state.work.channels.find((entry) => entry.id === $('#work-channel-snapshot-id').value);
  if (!channel) return toast('Add a channel first');
  channel.snapshots.push({
    id: uid('chsnap'),
    date: todayStr(),
    followers: Number($('#work-channel-followers').value),
    views: Number($('#work-channel-views').value),
    posts: Number($('#work-channel-posts').value),
    revenue: Number($('#work-channel-revenue-value').value),
  });
  channel.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  try { await saveWorkState(); e.target.reset(); renderWorkDashboard(); toast('Snapshot saved'); } catch (err) { toast(err.message); }
});
$('#work-channel-list')?.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-work-channel-delete]');
  const advance = e.target.closest('[data-work-channel-status]');
  const open = e.target.closest('[data-work-channel-open]');
  if (open) {
    const ch = state.work.channels.find((c) => c.id === open.dataset.workChannelOpen);
    if (ch?.notePath) openNote(ch.notePath, ch.name);
    return;
  }
  if (del) {
    state.work.channels = state.work.channels.filter((c) => c.id !== del.dataset.workChannelDelete);
  } else if (advance) {
    const ch = state.work.channels.find((c) => c.id === advance.dataset.workChannelStatus);
    if (!ch) return;
    ch.status = WORK_CHANNEL_STATUSES[(WORK_CHANNEL_STATUSES.indexOf(ch.status) + 1) % WORK_CHANNEL_STATUSES.length];
  } else return;
  try { await saveWorkState(); renderWorkDashboard(); } catch (err) { toast(err.message); }
});
$('#work-lead-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-work-filter]');
  if (!btn) return;
  state.workFilter = btn.dataset.workFilter;
  renderWorkOutreach();
});
$('#work-lead-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const lead = {
    id: uid('lead'),
    business: $('#work-lead-business').value.trim(),
    contact: $('#work-lead-contact').value.trim(),
    email: $('#work-lead-email').value.trim(),
    website: $('#work-lead-website').value.trim(),
    offer: $('#work-lead-offer').value.trim(),
    status: $('#work-lead-response').value.trim() ? 'Responded' : 'Review',
    lastContact: '',
    followUp: '',
    notePath: '',
    responseSummary: $('#work-lead-response').value.trim(),
  };
  const ai = buildLeadAutomation(lead);
  try {
    lead.notePath = await createWorkNote({
      title: lead.business,
      folder: WORK_OUTREACH_FOLDER,
      lines: [
        `# ${lead.business}`,
        '',
        `- Contact: ${lead.contact || 'TBD'}`,
        `- Email: ${lead.email}`,
        `- Website: ${lead.website || 'TBD'}`,
        `- Offer: ${lead.offer}`,
        `- AI target brief: ${ai.fitSummary}`,
        `- Suggested action: ${ai.recommendedAction}`,
        lead.responseSummary ? `- Reply summary: ${lead.responseSummary}` : '',
        '',
        '## Suggested opener',
        '',
        ai.openerBody,
      ],
    });
    state.work.outreach.leads.unshift(lead);
    await saveWorkState();
    e.target.reset();
    renderWorkDashboard();
    toast('Lead saved');
  } catch (err) { toast(err.message); }
});
$('#work-lead-list')?.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-work-lead-open],[data-work-lead-review],[data-work-lead-send],[data-work-lead-responded],[data-work-lead-followup],[data-work-lead-delete]');
  if (!target) return;
  const id = target.dataset.workLeadOpen || target.dataset.workLeadReview || target.dataset.workLeadSend || target.dataset.workLeadResponded || target.dataset.workLeadFollowup || target.dataset.workLeadDelete;
  const lead = state.work.outreach.leads.find((l) => l.id === id);
  if (!lead) return;
  try {
    if (target.dataset.workLeadOpen) {
      if (lead.notePath) openNote(lead.notePath, lead.business);
      return;
    }
    if (target.dataset.workLeadReview) composeLeadDraft(lead, lead.responseSummary ? 'reply' : 'opener');
    else if (target.dataset.workLeadSend) {
      composeLeadDraft(lead, lead.responseSummary ? 'reply' : 'opener');
      lead.status = 'Waiting'; lead.lastContact = todayStr(); lead.followUp = shiftDate(3);
      await scheduleWorkTask(`Follow up ${lead.business} about website proposal`, lead.followUp);
    } else if (target.dataset.workLeadResponded) {
      const summary = await appPrompt(`Reply summary from ${lead.business}`, lead.responseSummary || 'Interested, but needs a sharper conversion path and scope estimate.');
      if (summary == null) return;
      lead.responseSummary = summary.trim();
      lead.status = 'Responded';
      lead.lastContact = todayStr();
    } else if (target.dataset.workLeadFollowup) {
      lead.status = 'Follow up'; lead.followUp = shiftDate(3);
      await scheduleWorkTask(`Follow up ${lead.business} about website proposal`, lead.followUp);
    } else if (target.dataset.workLeadDelete) {
      state.work.outreach.leads = state.work.outreach.leads.filter((l) => l.id !== id);
    }
    await saveWorkState();
    renderWorkDashboard();
  } catch (err) { toast(err.message); return; }
});
$('#work-open-studio')?.addEventListener('click', openStewie);
$('#work-open-studio-tile')?.addEventListener('click', openStewie);
$('#ops-channel-lane')?.addEventListener('click', openStewie);
$('#ops-trading-lane')?.addEventListener('click', () => $('#work-bot-metrics')?.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'center' }));
$('#ops-outreach-lane')?.addEventListener('click', openEmailManager);

function openEmailManager() {
  show('email');
}

async function loadDiscover() {
  const toolsView = $('.view[data-view="tools"]');
  if (toolsView && state._firstRender.tools) {
    staggerChildren(toolsView, '.ops-lane, .work-panel, .tool-tile, .tool-panel', 'enter-scale', 60, 40);
    state._firstRender.tools = false;
  }
  try {
    await refreshWorkDependencies();
    if (!state.folders) {
      const { folders } = await api('/api/folders');
      state.folders = folders;
    }
  } catch (e) {}
  renderToolRecent();
  renderToolStats();
  renderWorkDashboard();
}
function renderToolRecent() {
  const ul = $('#tool-recent'); if (!ul) return;
  const recent = [...state.notes].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 6);
  ul.innerHTML = '';
  if (!recent.length) { ul.innerHTML = '<li class="empty small">No notes yet.</li>'; return; }
  recent.forEach((n) => {
    const li = document.createElement('li');
    li.className = 'rn';
    li.innerHTML = `<span class="rn-name">${esc(n.name)}</span><span class="rn-time tabular">${timeAgo(n.mtime)}</span>`;
    li.addEventListener('click', () => openNote(n.path, n.name));
    ul.appendChild(li);
  });
}
async function renderToolStats() {
  const el = $('#tool-stats'); if (!el) return;
  const notes = state.notes.length;
  const folders = (state.folders || []).length;
  const ideas = state.notes.filter((n) => /^Ideas\//.test(n.path)).length;
  let open = '—';
  try { const { tasks } = await api('/api/tasks'); open = tasks.filter((t) => !t.done).length; } catch (e) {}
  el.innerHTML = [
    ['Notes', notes], ['Folders', folders], ['Open tasks', open], ['Ideas', ideas],
  ].map(([lbl, val]) => `<div class="tool-stat"><span class="tool-stat-val tabular">${val}</span><span class="tool-stat-lbl">${lbl}</span></div>`).join('');
}
// Tidy vault → runs the same auto-sort preview flow as the Vault ✨ button.
$('#tile-tidy').addEventListener('click', () => $('#btn-autosort').click());
// Playground → JupyterLab, running on the same box over Tailscale (port 8888). New tab, not iframed
// (Jupyter sets X-Frame-Options and the SW would fight it). ponytail: link out, don't embed.
$('#tile-playground')?.addEventListener('click', () => {
  window.open(`${location.protocol}//${location.hostname}:8888`, '_blank');
});
$('#tile-stewie')?.addEventListener('click', openStewie);

/* ---------- Stewie Studio (video pipeline on the Oracle box) ----------
   Its own full-screen view (opened from the Discover tile) so the queue never
   clutters Discover. Queue tab = filterable/capped list; Stats tab = channel graph. */
const STATUS_ICON = { pending: '🕓', approved: '✅', uploaded: '🚀', rejected: '🚫' };
const STEWIE_CAP = 40;   // list never renders more than this — filter to find the rest
const STUDIO_PIPELINES = {
  stewie: {
    title: 'Stewie Studio',
    desc: 'One production queue, multiple future publishing lanes. Stewie is the first connected renderer.',
    live: 'box online',
    renderToast: 'Render started on the box (~3 min) — hit ↻ later',
  },
  pegilagi: {
    title: 'Pegilagi Studio',
    desc: 'Marketing shorts for Pegilagi across TikTok, Reels, and YouTube Shorts.',
    live: 'marketing box online',
    renderToast: 'Pegilagi render started on the box — hit ↻ later',
  },
};
function setStewieLive(on, label) {
  const el = $('#stewie-live');
  el.hidden = false; el.textContent = label; el.classList.toggle('off', !on);
}
function openStewie() {
  if (state.view !== 'tools') show('tools');
  if (!stewieOpen) { history.pushState({ stewie: true }, ''); stewieOpen = true; }
  state.stewieFilter = 'all';
  $('#stewie-view').hidden = false;
  setStudioPipeline(studioPipeline || 'stewie', false);
  stewieTab('queue');
  loadStudio();
}
function closeStewie() {
  if (!stewieOpen) return;
  $('#stewie-view').hidden = true;
  stewieOpen = false;
  if (history.state && history.state.stewie) history.back();
}
function stewieTab(which) {
  $$('#stewie-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.sv === which));
  $('#sv-queue').hidden = which !== 'queue';
  $('#sv-stats').hidden = which !== 'stats';
  if (which === 'stats') loadStewieStats();
}
function setStudioPipeline(which, refresh = true) {
  studioPipeline = STUDIO_PIPELINES[which] ? which : 'stewie';
  const cfg = STUDIO_PIPELINES[studioPipeline];
  $('#stewie-title').textContent = cfg.title;
  $('#studio-desc').textContent = cfg.desc;
  $$('#studio-pipeline-tabs [data-pipeline]').forEach((b) => b.classList.toggle('active', b.dataset.pipeline === studioPipeline));
  $('#btn-stewie-upload').hidden = studioPipeline !== 'stewie';
  $('#stewie-tabs [data-sv="stats"]').hidden = studioPipeline !== 'stewie';
  if (studioPipeline !== 'stewie') stewieTab('queue');
  if (refresh) loadStudio();
}
$('#stewie-back').addEventListener('click', closeStewie);
$('#stewie-tabs').addEventListener('click', (e) => { const b = e.target.closest('.seg-btn'); if (b) stewieTab(b.dataset.sv); });
$('#studio-pipeline-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pipeline]');
  if (b) setStudioPipeline(b.dataset.pipeline);
});

function loadStudio() {
  return studioPipeline === 'pegilagi' ? loadPegilagi() : loadStewie();
}

async function loadStewie() {
  const stats = $('#stewie-stats');
  try {
    const { videos } = await api('/api/stewie/videos');
    stewieVideos = videos; stewieVideoStats = null;
    setStewieLive(true, 'box online');
    const counts = videos.reduce((m, v) => ((m[v.status] = (m[v.status] || 0) + 1), m), {});
    const pillDefs = [['all', videos.length], ['pending', counts.pending || 0], ['approved', counts.approved || 0], ['uploaded', counts.uploaded || 0]];
    if (counts.rejected) pillDefs.push(['rejected', counts.rejected]);
    stats.hidden = false;
    stats.innerHTML = pillDefs.map(([k, n]) =>
      `<button class="stewie-pill st-${k}" data-filter="${k}"><b>${n}</b> ${k === 'all' ? 'all' : k}</button>`).join('');
    renderStewieQueue();
    renderStewieLanes();
    renderWorkDashboard();
    // per-video views ride in lazily — the box asks YouTube, which can be slow / unconfigured
    api('/api/stewie/stats').then(({ stats }) => { stewieVideoStats = stats; applyVideoStats(); }).catch(() => {});
  } catch (e) {
    setStewieLive(false, 'box unreachable');
    stats.hidden = true; $('#stewie-list').innerHTML = ''; $('#stewie-listfoot').hidden = true;
    renderStewieLanes();
    renderWorkDashboard();
    toast('Stewie: ' + e.message);
  }
}
async function loadPegilagi() {
  const stats = $('#stewie-stats');
  try {
    const data = await api('/api/pegilagi/videos');
    pegilagiVideos = Array.isArray(data.items) ? data.items : [];
    stewieVideoStats = null;
    setStewieLive(true, STUDIO_PIPELINES.pegilagi.live);
    const counts = pegilagiVideos.reduce((m, v) => ((m[v.status] = (m[v.status] || 0) + 1), m), {});
    const rendered = pegilagiVideos.filter((v) => v.hasVideo).length;
    const pillDefs = [['all', pegilagiVideos.length], ['needs_approval', counts.needs_approval || 0], ['rendered', rendered]];
    if (counts.rendered_needs_approval) pillDefs.push(['rendered_needs_approval', counts.rendered_needs_approval]);
    stats.hidden = false;
    stats.innerHTML = pillDefs.map(([k, n]) =>
      `<button class="stewie-pill st-${k}" data-filter="${k}"><b>${n}</b> ${k === 'all' ? 'all' : k.replaceAll('_', ' ')}</button>`).join('');
    renderStewieQueue();
    renderStewieLanes();
    renderWorkDashboard();
  } catch (e) {
    setStewieLive(false, 'marketing box unreachable');
    stats.hidden = true; $('#stewie-list').innerHTML = ''; $('#stewie-listfoot').hidden = true;
    renderStewieLanes();
    renderWorkDashboard();
    toast('Pegilagi: ' + e.message);
  }
}
function renderStewieLanes() {
  const wrap = $('#stewie-lanes');
  if (!wrap) return;
  if (studioPipeline === 'pegilagi') {
    const pending = pegilagiVideos.filter((v) => v.status === 'needs_approval' || v.status === 'render_pending').length;
    const rendered = pegilagiVideos.filter((v) => v.hasVideo).length;
    const platforms = ['TikTok', 'Instagram Reels', 'YouTube Shorts'];
    wrap.innerHTML = `<div class="work-item"><div class="work-item-head"><span class="work-item-title">Pegilagi marketing</span><span class="work-pill">Shorts</span></div><div class="work-item-meta"><span>${pending} queued</span><span>•</span><span>${rendered} rendered</span></div><div class="work-card-note">${platforms.join(' · ')}</div></div>`;
    return;
  }
  const channels = state.work.channels.length ? [...state.work.channels] : (workLiveAnalytics?.title ? [{
    id: 'stewie-live',
    name: workLiveAnalytics.title,
    platform: 'YouTube',
    status: 'Live',
    niche: 'Connected via Stewie',
    cadence: `${Number(workLiveAnalytics.videos || 0).toLocaleString()} videos published`,
    snapshots: [{
      id: 'stewie-live-snap',
      date: todayStr(),
      followers: Number(workLiveAnalytics.subs || 0),
      views: Number(workLiveAnalytics.views || 0),
      posts: Number(workLiveAnalytics.videos || 0),
      revenue: 0,
    }],
  }] : []);
  wrap.innerHTML = channels.length
    ? channels.map((channel) => {
      const snap = latestChannelSnapshot(channel);
      const connected = channel.platform === 'YouTube' && (channel.status === 'Live' || channel.name === workLiveAnalytics?.title);
      return `<div class="work-item"><div class="work-item-head"><span class="work-item-title">${esc(channel.name)}</span><span class="work-pill">${esc(channel.platform)}</span></div><div class="work-item-meta"><span>${esc(channel.status)}</span><span>•</span><span>${connected ? 'Connected renderer' : 'Lane ready'}</span></div><div class="work-card-note">${snap ? `${Number(snap.followers).toLocaleString()} ${platformAudienceLabel(channel.platform).toLowerCase()} · ${Number(snap.views).toLocaleString()} views` : 'No analytics logged yet.'}</div></div>`;
    }).join('')
    : '<div class="work-item"><div class="work-note">No lanes yet. Add channels from Tools to make studio routing multi-channel.</div></div>';
}
function stewieVideoLi(v) {
  const li = document.createElement('li');
  li.className = 'list-item';
  if (studioPipeline === 'pegilagi') return pegilagiVideoLi(v, li);
  const s = esc(v.stamp), notFinal = v.status === 'pending' || v.status === 'approved';
  const yt = v.youtube_id
    ? ` · <a href="https://youtu.be/${esc(v.youtube_id)}" target="_blank">youtube</a><span data-yt="${esc(v.youtube_id)}"></span>` : '';
  const actions = [
    !v.local_deleted ? `<button class="crumb-btn" data-watch="${s}">▶</button>` : '',
    v.status === 'pending' ? `<button class="crumb-btn" data-approve="${s}">Approve</button>` : '',
    notFinal ? `<button class="crumb-btn danger" data-reject="${s}">Reject</button>` : '',
    !v.local_deleted ? `<button class="crumb-btn danger" data-del="${s}" title="Delete local file to free storage">🗑</button>` : '',
  ].join(' ');
  li.innerHTML = `<span class="li-emoji">${STATUS_ICON[v.status] || '🎞'}</span>
    <div class="li-main"><div class="li-title">${esc(v.title || v.topic || v.stamp)}</div>
    <div class="li-sub">${s} · ${esc(v.status)}${v.local_deleted ? ' · file removed' : ''}${yt}</div></div>
    <span class="crumb-r">${actions}</span>`;
  return li;
}
function pegilagiVideoLi(v, li = document.createElement('li')) {
  li.className = 'list-item';
  const id = esc(v.id || v.stamp);
  const platforms = Array.isArray(v.channels) ? v.channels.map((c) => c.replace(/_/g, ' ')).join(' · ') : '';
  const actions = [
    v.hasStoryboard ? `<button class="crumb-btn" data-storyboard="${id}">Storyboard</button>` : '',
    v.hasVideo ? `<button class="crumb-btn" data-pegi-watch="${id}">▶</button>` : '',
  ].join(' ');
  li.innerHTML = `<span class="li-emoji">${v.hasVideo ? '✅' : '🎬'}</span>
    <div class="li-main"><div class="li-title">${esc(v.title || v.id)}</div>
    <div class="li-sub">${id} · ${esc((v.status || '').replaceAll('_', ' '))}${platforms ? ' · ' + esc(platforms) : ''}${v.renderedAt ? ' · rendered' : ''}</div></div>
    <span class="crumb-r">${actions}</span>`;
  return li;
}
function renderStewieQueue() {
  const ul = $('#stewie-list'), foot = $('#stewie-listfoot'), f = state.stewieFilter || 'all';
  $$('#stewie-stats [data-filter]').forEach((p) => p.classList.toggle('active', p.dataset.filter === f));
  const source = studioPipeline === 'pegilagi' ? pegilagiVideos : stewieVideos;
  const list = f === 'all' ? source : source.filter((v) => f === 'rendered' ? v.hasVideo : v.status === f);
  ul.innerHTML = '';
  for (const v of list.slice(0, STEWIE_CAP)) ul.appendChild(stewieVideoLi(v));
  foot.hidden = list.length <= STEWIE_CAP;
  if (!foot.hidden) foot.textContent = `showing ${STEWIE_CAP} of ${list.length} — filter to narrow`;
  applyVideoStats();
  if (state._firstRender.stewie) {
    staggerChildren(ul, '.list-item', 'stagger-in', 40, 40);
    state._firstRender.stewie = false;
  }
}
function applyVideoStats() {
  if (!stewieVideoStats) return;
  for (const el of $$('#stewie-list [data-yt]')) {
    const d = stewieVideoStats[el.dataset.yt];
    if (d) el.textContent = ` · ${Number(d.viewCount || 0).toLocaleString()} views · ${d.likeCount || 0} 👍`;
  }
}
$('#stewie-stats').addEventListener('click', (e) => {
  const p = e.target.closest('[data-filter]'); if (!p) return;
  state.stewieFilter = p.dataset.filter; renderStewieQueue();
});
async function stewieAct(btn, url, stamp, okMsg) {
  btn.disabled = true;
  try {
    await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stamps: [stamp] }) });
    toast(okMsg); loadStewie();
  } catch (err) { toast(err.message); btn.disabled = false; }
}
$('#stewie-list').addEventListener('click', async (e) => {
  const w = e.target.closest('[data-watch]'), a = e.target.closest('[data-approve]'),
        r = e.target.closest('[data-reject]'), d = e.target.closest('[data-del]'),
        pw = e.target.closest('[data-pegi-watch]'), ps = e.target.closest('[data-storyboard]');
  if (w) window.open('/api/stewie/video/' + w.dataset.watch, '_blank');
  else if (pw) window.open('/api/pegilagi/video/' + pw.dataset.pegiWatch, '_blank');
  else if (ps) window.open('/api/pegilagi/storyboard/' + ps.dataset.storyboard, '_blank');
  else if (a) stewieAct(a, '/api/stewie/approve', a.dataset.approve, 'Approved');
  else if (r) stewieAct(r, '/api/stewie/reject', r.dataset.reject, 'Rejected — won’t upload');
  else if (d) {
    if (!(await appConfirm('Delete the local video file to free storage? The record stays but the mp4 is gone for good.', { okLabel: 'Delete', danger: true }))) return;
    stewieAct(d, '/api/stewie/delete', d.dataset.del, 'Local file deleted');
  }
});
$('#btn-stewie-refresh').addEventListener('click', () => { loadStudio(); showStewieLog(); });
$('#btn-stewie-render').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    await api(studioPipeline === 'pegilagi' ? '/api/pegilagi/render' : '/api/stewie/render', { method: 'POST' });
    toast(STUDIO_PIPELINES[studioPipeline].renderToast);
  }
  catch (err) { toast(err.message); }
  finally { e.target.disabled = false; }
});
$('#btn-stewie-upload').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = '⬆ Uploading…';
  try { const { out } = await api('/api/stewie/upload', { method: 'POST' }); toast(out.trim().split('\n').pop() || 'Done'); loadStewie(); }
  catch (err) { toast(err.message); }
  finally { e.target.disabled = false; e.target.textContent = '⬆ Upload approved'; }
});
$('#btn-stewie-log').addEventListener('click', showStewieLog);
async function showStewieLog() {
  try {
    const { log } = await api(studioPipeline === 'pegilagi' ? '/api/pegilagi/log' : '/api/stewie/log');
    const pre = $('#stewie-log'); pre.textContent = log; pre.hidden = false;
  } catch {}
}

/* ---- Stats tab: channel growth (daily snapshots) + monetization path ---- */
// Tiny inline SVG line chart — no library. Sparse data is fine; <2 points shows an empty state.
function growthChart(label, values, color) {
  if (values.length < 2) return '<div class="sv-spark-empty muted-sm">collecting daily — the line fills in from here</div>';
  const w = 300, h = 68, pad = 6, max = Math.max(...values), min = Math.min(...values), range = (max - min) || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - 2 * pad), h - pad - ((v - min) / range) * (h - 2 * pad)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="sv-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${label} over time">
    <polygon points="${pad},${h - pad} ${line} ${w - pad},${h - pad}" fill="${color}" opacity=".13"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${color}"/></svg>`;
}
function metricCard(label, series, color) {
  const cur = series[series.length - 1] || 0, first = series[0] || 0, delta = cur - first;
  const deltaTag = series.length > 1
    ? `<span class="sv-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta.toLocaleString()}</span>` : '';
  return `<div class="sv-metric">
    <div class="sv-metric-top"><span class="sv-metric-label">${label}</span>${deltaTag}</div>
    <div class="sv-metric-val">${Number(cur).toLocaleString()}</div>
    ${growthChart(label, series, color)}</div>`;
}
async function loadStewieStats() {
  const wrap = $('#stewie-analytics');
  wrap.innerHTML = '<p class="muted-sm">Loading channel stats…</p>';
  try {
    const [{ analytics }, { videos }, { stats }] = await Promise.all([
      api('/api/stewie/analytics'), api('/api/stewie/videos'), api('/api/stewie/stats'),
    ]);
    const now = analytics.now || {}, H = analytics.history || [];
    if (!H.length && !now.subs && now.subs !== 0) {
      wrap.innerHTML = `<p class="muted-sm">Channel stats unavailable — ${esc(analytics.error || 'box or YouTube creds offline')}.</p>`;
      return;
    }
    const subs = now.subs || 0, GOAL = 1000, pct = Math.min(100, subs / GOAL * 100);
    const top = videos.filter((v) => v.youtube_id)
      .map((v) => ({ title: v.title || v.stamp, views: Number((stats[v.youtube_id] || {}).viewCount || 0) }))
      .sort((a, b) => b.views - a.views).slice(0, 5);
    const maxV = Math.max(...top.map((t) => t.views), 1);
    wrap.innerHTML = `
      ${now.title ? `<div class="sv-channel">${esc(now.title)}</div>` : ''}
      <div class="sv-card"><p class="muted-sm">Connected analytics feed: ${esc(now.title || 'Stewie YouTube')}. Additional channels can still be tracked from Tools even before their platform integrations are live.</p></div>
      <div class="sv-metrics">
        ${metricCard('Subscribers', H.map((r) => r.subs), 'var(--accent)')}
        ${metricCard('Total views', H.map((r) => r.views), 'var(--sage)')}
        ${metricCard('Videos', H.map((r) => r.videos), 'var(--cyan, var(--accent))')}
      </div>
      <div class="sv-card">
        <div class="sv-card-h">Path to monetization</div>
        <div class="sv-prog"><div class="sv-prog-fill" style="width:${pct}%"></div></div>
        <p class="muted-sm">${subs.toLocaleString()} / ${GOAL.toLocaleString()} subscribers. The Partner Program also needs ~4,000 watch-hours; revenue tracking turns on once the channel is monetized.</p>
      </div>
      <div class="sv-card">
        <div class="sv-card-h">Top videos by views</div>
        ${top.length && maxV > 1 ? top.map((t) => `<div class="sv-bar">
          <div class="sv-bar-label">${esc(t.title)}</div>
          <div class="sv-bar-track"><div class="sv-bar-fill" style="width:${(t.views / maxV * 100).toFixed(1)}%"></div></div>
          <div class="sv-bar-val">${t.views.toLocaleString()}</div></div>`).join('')
        : `<p class="muted-sm">No views yet on your uploaded videos.</p>`}
      </div>
      <p class="muted-sm sv-note">Growth is snapshotted once a day — the graphs fill in over time. ${H.length} day${H.length === 1 ? '' : 's'} recorded so far.</p>`;
  } catch (e) { wrap.innerHTML = `<p class="muted-sm">Stats unavailable — ${esc(e.message)}</p>`; }
  staggerChildren(wrap, '.sv-metric, .sv-card, .sv-bar', 'enter-slide-up', 50, 40);
}

/* ---------- Inbox ---------- */
async function refreshInbox() {
  try { const { items } = await api('/api/inbox'); state.inbox = items; updateInboxCount(); if (state.view === 'home') renderInbox(); }
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
  if (state._firstRender.home) {
    staggerChildren('#inbox-list', '.list-item', 'stagger-in', 50, 100);
    state._firstRender.home = false;
  }
  renderGlance();
}

// Desktop Home side panel: greeting, live counts, and the next few scheduled tasks.
// Counts come from cheap existing endpoints; failures are silent (panel just shows 0).
async function renderGlance() {
  const g = $('#home-glance'); if (!g) return;
  const d = new Date(), hr = d.getHours();
  $('#glance-greet').textContent = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  $('#glance-date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#glance-inbox').textContent = state.inbox.length;
  try { if (!state.notes.length) { const { notes } = await api('/api/notes'); state.notes = notes; } } catch (e) {}
  $('#glance-notes').textContent = state.notes.length;
  try {
    const { tasks } = await api('/api/tasks'); state.tasks = tasks;
    const open = tasks.filter((t) => !t.done);
    $('#glance-tasks').textContent = open.length;
    const soon = open.filter((t) => t.date)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 3);
    const ul = $('#glance-upnext'); ul.innerHTML = '';
    if (!soon.length) { ul.innerHTML = '<li class="glance-none">Nothing scheduled ✦</li>'; return; }
    soon.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'glance-item' + (t.date < todayStr() ? ' overdue' : '');
      li.innerHTML = `<span class="glance-item-desc">${esc(t.desc)}</span>
        <span class="glance-item-date tabular">${esc(fmtDate(t.date))}${t.time ? ' · ' + esc(t.time) : ''}</span>`;
      li.addEventListener('click', () => show('plan'));
      ul.appendChild(li);
    });
  } catch (e) {}
}
$('#glance-stat-inbox').addEventListener('click', () => setCaptureMode(false));
$('#glance-stat-tasks').addEventListener('click', () => show('plan'));
$('#glance-stat-notes').addEventListener('click', () => show('vault'));
$('#glance-new-note').addEventListener('click', openEditor);
$('#glance-ask').addEventListener('click', () => setCaptureMode(true));

// Home eagle-eye analytics (desktop only): pulls live YouTube numbers from the Stewie box.
// Instagram/TikTok are placeholders until wired. Crypto card stays a static placeholder.
function renderHomeAutomation() {
  const trading = currentTrading();
  const snaps = [...(trading.snapshots || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const positions = trading.positions || [];
  const latest = snaps.at(-1);
  if ($('#home-bot-balance')) $('#home-bot-balance').textContent = latest ? fmtMoney(latest.balance) : '—';
  if ($('#home-bot-pnl')) {
    $('#home-bot-pnl').textContent = latest ? `${latest.pnl > 0 ? '+' : ''}${Number(latest.pnl).toFixed(2)}%` : '—';
    $('#home-bot-pnl').classList.toggle('up', !!latest && Number(latest.pnl) >= 0);
    $('#home-bot-pnl').classList.toggle('down', !!latest && Number(latest.pnl) < 0);
  }
  if ($('#home-bot-trades')) $('#home-bot-trades').textContent = latest ? latest.openTrades : positions.length;
  if ($('#home-bot-winrate')) $('#home-bot-winrate').textContent = latest ? `${Number(latest.winRate).toFixed(1)}%` : '—';
  if ($('#home-bot-chart')) $('#home-bot-chart').innerHTML = workSpark(snaps.map((s) => Number(s.balance) || 0), 'var(--accent)');
  if ($('#home-bot-positions')) {
    $('#home-bot-positions').innerHTML = positions.length
      ? positions.slice(0, 3).map((p) => `<div class="trading-position"><span class="sym">${esc(p.pair)}</span><span class="side ${slug(p.side)}">${esc(p.side)}</span><span class="pnl ${Number(p.pnl) >= 0 ? 'up' : 'down'} tabular">${Number(p.pnl) >= 0 ? '+' : ''}${Number(p.pnl).toFixed(2)}%</span></div>`).join('')
      : '<div class="trading-position"><span class="sym">No open Freqtrade positions.</span></div>';
  }
  if ($('#home-bot-status')) {
    $('#home-bot-status').textContent = trading.status === 'live' ? 'Live' : latest ? 'Saved' : 'Offline';
    $('#home-bot-status').className = 'trading-status' + (trading.status === 'live' ? '' : ' paused');
  }

  const active = state.work.outreach.leads.filter((l) => l.status !== 'Archived');
  const review = active.filter((l) => l.status === 'Review');
  const waiting = active.filter((l) => l.status === 'Waiting');
  const due = active.filter((l) => l.followUp && l.followUp <= todayStr() && l.status !== 'Responded');
  if ($('#home-leads-review')) $('#home-leads-review').textContent = review.length;
  if ($('#home-leads-waiting')) $('#home-leads-waiting').textContent = waiting.length;
  if ($('#home-leads-due')) $('#home-leads-due').textContent = due.length;
  if ($('#home-outreach-status')) {
    $('#home-outreach-status').textContent = due.length ? 'action due' : active.length ? 'active' : 'prototype';
    $('#home-outreach-status').className = 'an-status' + (due.length ? ' off' : active.length ? ' live' : '');
  }
  if ($('#home-lead-brief')) {
    const leadList = (due.length ? due : review.length ? review : active).slice(0, 2);
    $('#home-lead-brief').innerHTML = leadList.length
      ? leadList.map((l) => `<div class="work-item"><div class="work-item-head"><span class="work-item-title">${esc(l.business)}</span><span class="work-pill ${slug(l.status)}">${esc(l.status)}</span></div><div class="work-item-meta"><span>${esc(l.email)}</span><span>·</span><span>${esc(l.followUp ? 'Follow-up ' + fmtDate(l.followUp) : 'No follow-up set')}</span></div></div>`).join('')
      : '<div class="work-item"><div class="work-note">No leads queued yet. Add targets from Tools.</div></div>';
  }
}
let _homeAnalyticsLoaded = false;
async function renderHomeAnalytics(force) {
  if (!$('#home-analytics')) return;
  if (!window.matchMedia('(min-width:960px)').matches) return;   // desktop-only, don't hit the box on phones
  try { await Promise.all([loadWorkState(), refreshTradingSummary()]); renderHomeAutomation(); } catch (e) {}
  if (_homeAnalyticsLoaded && !force) return;
  _homeAnalyticsLoaded = true;
  const status = $('#home-stewie-status');
  try {
    const [{ analytics }, { videos }] = await Promise.all([api('/api/stewie/analytics'), api('/api/stewie/videos')]);
    const now = (analytics && analytics.now) || {};
    workLiveAnalytics = now;
    const hasData = now.subs != null || (analytics && analytics.history && analytics.history.length);
    if (!hasData) { status.textContent = 'offline'; status.className = 'an-status off'; return; }
    status.textContent = 'live'; status.className = 'an-status live';
    const subs = now.subs || 0, GOAL = 1000;
    $('#home-yt-subs').textContent = subs.toLocaleString();
    $('#home-yt-videos').textContent = (now.videos || 0).toLocaleString();
    $('#home-yt-views').textContent = (now.views || 0).toLocaleString();
    $('#home-yt-queue').textContent = videos.filter((v) => v.status === 'pending' || v.status === 'approved').length;
    $('#home-yt-goal').textContent = subs.toLocaleString() + ' / ' + GOAL.toLocaleString();
    $('#home-yt-progress').style.width = Math.min(100, subs / GOAL * 100) + '%';
  } catch (e) {
    workLiveAnalytics = null;
    status.textContent = 'offline'; status.className = 'an-status off';
    _homeAnalyticsLoaded = false;                                  // let a later visit retry
  }
  renderWorkDashboard();
}
$('#home-open-studio')?.addEventListener('click', openStewie);

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
    if (state._firstRender.vault) {
      staggerChildren(ul, '.list-item', 'stagger-in', 50, 40);
      state._firstRender.vault = false;
    }
    return;
  }

  // Default → collapsible folder tree, so courses/areas stay grouped.
  ul.className = 'tree';
  renderTreeInto(buildTree(state.notes, state.folders || []), 0, ul);
  if (state._firstRender.vault) {
    staggerChildren(ul, '.tree-row', 'stagger-in', 40, 40);
    state._firstRender.vault = false;
  }
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
    staggerChildren(ul, '.list-item', 'stagger-in', 50, 40);
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
  $('#reader-share').hidden = !path;
  // New note open → drop any prior tutor conversation and collapse the dock.
  state.noteChat = []; closeNoteChat();
  renderReaderProps(path ? state.readerContent : '');
  const body = $('#reader-body');
  body.innerHTML = html;
  bindWikilinks(body); bindImages(body);
  const firstOpen = !readerOpen;
  if (firstOpen) { history.pushState({ reader: true }, ''); readerOpen = true; }
  const reader = $('#reader'); reader.hidden = false;
  slideUp(reader, 400);
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
// Share the note as text — on mobile this opens the native sheet (WhatsApp, etc.);
// on desktop (no Web Share API) fall back to copying the markdown to the clipboard.
$('#reader-share').addEventListener('click', async () => {
  const title = $('#reader-title').textContent;
  const text = splitFM(state.readerContent).body.trim();
  try {
    if (navigator.share) await navigator.share({ title, text });
    else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  } catch (e) { if (e.name !== 'AbortError') toast('Share failed: ' + e.message); }
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
  staggerChildren(thread, '.bubble-wrap, .bubble.me', 'stagger-in', 60, 40);
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
  else if (stewieOpen) { stewieOpen = false; $('#stewie-view').hidden = true; show('tools'); }
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
  const ed = $('#editor'); ed.hidden = false;
  slideUp(ed, 400);
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
$('#btn-trading-report')?.addEventListener('click', async () => {
  try { if (!state.notes.length) { const { notes } = await api('/api/notes'); state.notes = notes; } } catch (e) {}
  const reports = state.notes.filter((n) => /^Trading\//.test(n.path));
  if (!reports.length) { toast('No report yet — the bot writes weekly into Trading/'); return; }
  const latest = reports.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  openNote(latest.path, latest.name);
});
$('#btn-trading-refresh')?.addEventListener('click', async () => {
  await refreshTradingSummary(false);
  toast(state.trading ? 'Trading data refreshed' : 'Trading bot unavailable');
});
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
    const { tasks } = await api('/api/tasks');
    state.tasks = tasks;
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
    <div class="t-main"><div class="t-desc">${esc(t.desc)}</div>${t.date ? `<div class="t-meta">${fmtDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}</div>` : ''}</div>
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
  $('#task-edit-time').value = t.time || '';
  $('#task-edit-remind').value = t.reminderMinutes != null ? String(t.reminderMinutes) : '';
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
      body: JSON.stringify({
        file: editingTask.file, line: editingTask.line, desc,
        date: date ?? $('#task-edit-date').value,
        time: $('#task-edit-time').value,
        reminderMinutes: $('#task-edit-remind').value || null,
      }),
    });
    closeSheets();
    await loadPlan();
    toast('Task updated');
  } catch (e) { toast(e.message); }
}
$('#task-edit-save').addEventListener('click', () => saveTaskEdit());
$('#task-edit-clear-date').addEventListener('click', () => saveTaskEdit(''));

// ---- Add task (Plan tab "+ Add") — manual add, independent of inbox capture/process-inbox.
function openTaskNew(date) {
  $('#task-new-desc').value = '';
  $('#task-new-date').value = date || todayStr();
  $('#task-new-time').value = '';
  $('#task-new-remind').value = '';
  $('#task-new-repeat').value = 'none';
  $('#task-new-until').value = '';
  $('#task-new-until-row').hidden = true;
  openSheet('sheet-task-new');
  $('#task-new-desc').focus();
}
$('#btn-new-task').addEventListener('click', () => openTaskNew(state.planView === 'calendar' ? state.calSelected : ''));
$('#task-new-repeat').addEventListener('change', (e) => {
  $('#task-new-until-row').hidden = e.target.value === 'none';
  if (e.target.value !== 'none' && !$('#task-new-until').value) {
    const d = new Date($('#task-new-date').value || todayStr());
    d.setMonth(d.getMonth() + 3);
    $('#task-new-until').value = ymd(d);
  }
});
$('#task-new-save').addEventListener('click', async () => {
  const desc = $('#task-new-desc').value.trim();
  const date = $('#task-new-date').value;
  if (!desc) { toast('Description required'); return; }
  if (!date) { toast('Date required'); return; }
  try {
    await api('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        desc, date, time: $('#task-new-time').value, reminderMinutes: $('#task-new-remind').value || null,
        repeat: $('#task-new-repeat').value, until: $('#task-new-until').value,
      }),
    });
    closeSheets();
    await loadPlan();
    toast('Added');
  } catch (e) { toast(e.message); }
});

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
  if (state._firstRender.plan) {
    staggerChildren(wrap, '.plan-group', 'enter-slide-up', 60, 40);
    staggerChildren(wrap, '.task', 'stagger-in', 40, 80);
    state._firstRender.plan = false;
  }
}

/* ----- Calendar grid ----- */
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function renderCalendar() {
  if (!state.calMonth) { const n = new Date(); state.calMonth = { y: n.getFullYear(), m: n.getMonth() }; }
  const { y, m } = state.calMonth;
  $('#cal-title').textContent = `${MON[m]} ${y}`;

  // Bucket tasks by date.
  const byDate = {};
  for (const t of (state.tasks || [])) if (t.date) (byDate[t.date] = byDate[t.date] || []).push(t);

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
    const dots = items.slice(0, 3).map((t) => `<i class="cal-dot ${t.done ? 'done' : 'tk'}"></i>`).join('');
    cell.innerHTML = `<span class="cal-num">${d.getDate()}</span><span class="cal-dots">${dots}</span>`;
    cell.addEventListener('click', () => { state.calSelected = ds; renderCalendar(); });
    grid.appendChild(cell);
  }
  if (state._firstRender.calendar) {
    staggerChildren(grid, '.cal-cell', 'enter-scale', 30, 20);
    state._firstRender.calendar = false;
  }
  renderAgenda(byDate[state.calSelected] || [], state.calSelected);
}

function renderAgenda(tasks, date) {
  const wrap = $('#cal-agenda'); wrap.innerHTML = '';
  if (!date) { wrap.innerHTML = '<p class="hint">Tap a day to see what\'s on.</p>'; return; }
  const h = document.createElement('h3'); h.className = 'cal-agenda-h'; h.textContent = fmtDate(date);
  wrap.appendChild(h);
  if (!tasks.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Nothing scheduled.'; wrap.appendChild(p); return; }
  for (const t of tasks) wrap.appendChild(taskRow(t));
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
/* ---------- Plan reminders (Web Push — local, independent of Google Calendar) ---------- */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function syncNotifyButton() {
  const btn = $('#btn-plan-notify');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { btn.hidden = true; return; }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  btn.textContent = sub ? '🔕' : '🔔';
  btn.title = sub ? 'Turn off reminders on this device' : 'Enable reminders on this device';
}
$('#btn-plan-notify').addEventListener('click', async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('Push not supported on this browser'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await api('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) });
      await existing.unsubscribe();
      toast('Reminders off on this device');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications permission denied'); return; }
      const { publicKey } = await api('/api/push/public-key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      toast('Reminders on for this device');
    }
  } catch (e) { toast(e.message); }
  syncNotifyButton();
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
  staggerChildren(thread, '.bubble', 'stagger-in', 60, 40);
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
$('#chat-clear')?.addEventListener('click', () => { state.chat = []; renderChat(); });
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
    const canvas = $('#graph-canvas');
    const render = () => window.LifeGraph.render(canvas, data, {
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
    fadeIn(canvas, 500);
    requestAnimationFrame(() => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) render();
      else setTimeout(render, 80);
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
    const qw = config.kimi || {};
    $('#cfg-qw-baseUrl').value = qw.baseUrl || '';
    $('#cfg-qw-apiKey').value = qw.apiKey || '';
    $('#cfg-qw-model').value = qw.model || '';
    renderKeySavedStatus('#cfg-qw-status', 'Kimi', qw);
    const oai = config.openai || {};
    $('#cfg-openai-apiKey').value = oai.apiKey || '';
    $('#cfg-openai-model').value = oai.model || 'gpt-5.5';
    const qwen = config.qwen || {};
    $('#cfg-qwen-baseUrl').value = qwen.baseUrl || '';
    $('#cfg-qwen-apiKey').value = qwen.apiKey || '';
    $('#cfg-qwen-model').value = qwen.model || 'claude-sonnet-5';
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
    $('#cfg-default-provider').value = config.defaultProvider || 'claude';
    openSheet('sheet-settings');
  } catch (e) { toast(e.message); }
}
function renderKeySavedStatus(sel, label, provider) {
  const el = $(sel); if (!el) return;
  const saved = !!(provider && provider.apiKey);
  const model = provider && provider.model ? ` · model: ${provider.model}` : '';
  el.className = `settings-key-status ${saved ? 'ok' : 'warn'}`;
  el.textContent = saved
    ? `${label} key saved on this device${model}`
    : `${label} key is not saved on this device yet`;
}
// Editor preference toggles (live — apply to the editor immediately if it's open).
$('#cfg-livepreview').addEventListener('change', (e) => { prefs.set('livepreview', e.target.checked ? '1' : '0'); if (editorOpen) setEditorSurface(e.target.checked ? 'live' : 'source'); });
$('#cfg-vim').addEventListener('change', (e) => { prefs.set('vim', e.target.checked ? '1' : '0'); if (editorOpen) applyEditorPrefs(); if (codeVim) codeVim.setEnabled(prefs.vim); });
$('#cfg-lineno').addEventListener('change', (e) => { prefs.set('lineno', e.target.checked ? '1' : '0'); if (editorOpen) applyEditorPrefs(); });
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
    const { vaultDir, config } = await api('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaultPath: $('#cfg-vaultPath').value.trim(),
        timezone: $('#cfg-timezone').value.trim(),
        languages: $('#cfg-languages').value.trim(),
        claudePath: $('#cfg-claudePath').value.trim(),
        defaultProvider: $('#cfg-default-provider').value,
        kimi: {
          baseUrl: $('#cfg-qw-baseUrl').value.trim(),
          apiKey: $('#cfg-qw-apiKey').value.trim(),
          model: $('#cfg-qw-model').value.trim(),
        },
        openai: {
          apiKey: $('#cfg-openai-apiKey').value.trim(),
          model: $('#cfg-openai-model').value.trim() || 'gpt-5.5',
        },
        qwen: {
          baseUrl: $('#cfg-qwen-baseUrl').value.trim(),
          apiKey: $('#cfg-qwen-apiKey').value.trim(),
          model: $('#cfg-qwen-model').value.trim() || 'claude-sonnet-5',
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
    const qw = config.kimi || {};
    $('#cfg-qw-apiKey').value = qw.apiKey || '';
    renderKeySavedStatus('#cfg-qw-status', 'Kimi', qw);
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
const CODE_FALLBACK_LANGS = [
  { id: 'python', name: 'Python' }, { id: 'javascript', name: 'JavaScript' }, { id: 'c', name: 'C' },
  { id: 'cpp', name: 'C++' }, { id: 'java', name: 'Java' }, { id: 'go', name: 'Go' },
  { id: 'rust', name: 'Rust' }, { id: 'bash', name: 'Bash' },
];
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
  codeOpen = false; codeViewportReset(); codeToggleSidebar(false); closeCodeChat(); show(state.prevTab || 'tools');
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
  if (!window.hljs) { if (codeEl) codeEl.textContent = codeTA().value; return; } // plain mode shows textarea text
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
  codeApplyHljsMode();
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
  view.style.height = vv.height + 'px';
  view.style.transform = `translateY(${vv.offsetTop}px)`;
}
function codeViewportReset() { const v = $('.view[data-view="code"]'); if (v) { v.style.height = ''; v.style.transform = ''; } }

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
  const sel = $('#code-lang'); sel.innerHTML = '';
  const fill = (langs, { preserve = true } = {}) => {
    const seen = new Set();
    const list = [...(langs.length ? langs : CODE_FALLBACK_LANGS), ...CODE_FALLBACK_LANGS]
      .filter((l) => l && l.id && !seen.has(l.id) && seen.add(l.id));
    sel.innerHTML = '';
    for (const l of list) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; sel.appendChild(o); }
    if (!preserve && !list.find((l) => l.id === codeState.scratchLang)) codeState.scratchLang = list[0].id;
    sel.value = codeState.scratchLang;
  };
  fill([]);
  try { const j = await api('/api/run/langs'); codeState.langs = j.langs || []; }
  catch { codeState.langs = []; }
  fill(codeState.langs);
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
  $('#code-back').onclick = () => {
    if (codeOpen && history.state && history.state.code) history.back();
    else codeClose();
  };
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
  if (window.LifeVim) {
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
  }
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
  codeApplyMode(); codeLoadBuffer();
  if (codeVim) codeVim.setEnabled(prefs.vim);
  codeViewportFit();
  const langBefore = codeState.scratchLang;
  const bufferBefore = codeTA().value;
  codeLoadLangs().then(() => {
    if (codeState.mode === 'scratch' && codeState.scratchLang !== langBefore && codeTA().value === bufferBefore) {
      codeSetContent(codeState.scratchBuffers[codeState.scratchLang] ?? CODE_STARTER);
      codeHistReset();
    }
  });
  codeRefreshFiles();
}

/* ---------- Boot ---------- */
(async function boot() {
  try {
    applyTheme(prefs.theme);
    applyWidth('note', prefs.noteWidth);
    applyWidth('code', prefs.codeWidth);
    show('home');
    window.__lifeosBooted = true;
    hideLoader();
    const ls = $('#loading-screen'); if (ls) ls.classList.add('hidden');
    refreshInbox();
    loadNotes(true);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => syncNotifyButton()).catch(() => {});
  } catch (e) {
    console.error('lifeOS boot failed:', e);
    window.__lifeosDismissLoaders?.();
    toast(e?.message || 'lifeOS failed to boot');
    return;
  }
})();

/* ---------- Animation init ---------- */
observeAnimations();
initGlassHeader();
// initSpotlight() removed: the mouse-follow glow was clipped at the view's top edge (hard cutoff).
