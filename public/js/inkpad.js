'use strict';
/* InkPad — a full-screen, infinite vector canvas for handwriting & sketching.
   Pan/zoom (pinch + wheel + hand tool), pen colours & sizes, object eraser, ruler (straight
   line with axis snap), shapes (rectangle / ellipse / arrow), undo/redo. Strokes are stored in
   world coordinates so they survive pan/zoom; "Done" rasterises the drawn content (cropped, on a
   white page) to a PNG and hands back `{ blob, strokes }` via the onDone callback — the strokes are
   the editable vector source, saved alongside the PNG so the page can be reopened and edited later.
   open(cb, { strokes }) reloads a saved drawing for re-editing. */
window.InkPad = (function () {
  const COLORS = ['#15171c', '#1f6feb', '#e5484d', '#2a9d5c', '#e2914f', '#8a5cf6'];

  let onDone = null;
  let canvas, ctx, cssW = 0, cssH = 0;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  // view: screen(CSS px) = world * scale + {x,y}
  let view = { scale: 1, x: 0, y: 0 };
  let strokes = [], undoStack = [], redoStack = [];
  let tool = 'pen', color = COLORS[0], size = 5;

  let live = null;                 // stroke being drawn right now
  let panning = false, panLast = null;
  let eraseSnapshot = null;        // strokes before an erase drag (for a single undo entry)
  const pointers = new Map();      // active pointers for multi-touch
  let pinch = null;
  let raf = null, built = false, pushedState = false, manageHistory = true;

  const el = (id) => document.getElementById(id);

  /* ---------- lifecycle ---------- */
  // opts.history:false → caller owns the history stack (e.g. opened over the note editor, whose
  // own overlay entry must not be disturbed). Default true keeps the capture-tab behavior.
  // opts.strokes → reopen an existing drawing for editing (the saved vector strokes); the page
  // starts fitted to that content. Without it, a fresh blank page (the normal capture/embed flow).
  function open(cb, opts = {}) {
    onDone = cb;
    manageHistory = opts.history !== false;
    canvas = el('ink-canvas'); ctx = canvas.getContext('2d');
    if (!built) { build(); built = true; }
    // Fresh page each time Write is tapped (last note was already exported on Done), unless we were
    // handed existing strokes to re-edit — clone them so the caller's copy isn't mutated as we draw.
    strokes = Array.isArray(opts.strokes) ? JSON.parse(JSON.stringify(opts.strokes)) : [];
    undoStack = []; redoStack = []; live = null; pinch = null; panning = false; pointers.clear();
    el('inkpad').hidden = false;
    if (manageHistory && !pushedState) { history.pushState({ inkpad: true }, ''); pushedState = true; }
    resize();
    view = { scale: 1, x: cssW / 2, y: cssH / 2 }; // (0,0) world at mid-screen
    if (strokes.length) fit();                     // reopened drawing → frame it
    render(); updateUI();
  }
  function hide() {
    el('inkpad').hidden = true;
    if (manageHistory && pushedState && history.state && history.state.inkpad) history.back();
    pushedState = false;
  }
  function done() {
    const blob = exportPNG();
    // Hand back the vector strokes too (deep-copied → JSON-safe) so the drawing can be reopened and
    // re-edited later, not just the flattened PNG.
    const inkStrokes = JSON.parse(JSON.stringify(strokes));
    hide();
    if (blob) onDone && onDone({ blob, strokes: inkStrokes });
  }

  window.addEventListener('popstate', () => {
    if (!el('inkpad') || el('inkpad').hidden) { pushedState = false; return; }
    pushedState = false;
    el('inkpad').hidden = true; // back button discards (use Done to keep)
  });

  /* ---------- toolbar ---------- */
  function build() {
    const cwrap = el('ink-colors');
    cwrap.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'ink-c'; b.dataset.color = c; b.style.background = c;
      b.addEventListener('click', () => { color = c; if (tool === 'eraser' || tool === 'pan') tool = 'pen'; updateUI(); });
      cwrap.appendChild(b);
    }
    el('ink-toolset').querySelectorAll('.ink-t').forEach((b) =>
      b.addEventListener('click', () => { tool = b.dataset.tool; updateUI(); }));
    el('ink-sizes').querySelectorAll('.ink-s').forEach((b) =>
      b.addEventListener('click', () => { size = parseFloat(b.dataset.size); if (tool === 'eraser' || tool === 'pan') tool = 'pen'; updateUI(); }));
    el('ink-undo').addEventListener('click', undo);
    el('ink-redo').addEventListener('click', redo);
    el('ink-fit').addEventListener('click', () => { fit(); render(); updateUI(); });
    el('ink-clear').addEventListener('click', () => { if (strokes.length) commit([]); });
    el('ink-close').addEventListener('click', hide);
    el('ink-done').addEventListener('click', done);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      render(); updateUI();
    }, { passive: false });
    window.addEventListener('resize', () => { if (!el('inkpad').hidden) { resize(); render(); } });
  }

  function updateUI() {
    el('ink-toolset').querySelectorAll('.ink-t').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    el('ink-sizes').querySelectorAll('.ink-s').forEach((b) =>
      b.setAttribute('aria-pressed', String(parseFloat(b.dataset.size) === size)));
    el('ink-colors').querySelectorAll('.ink-c').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.color === color)));
    el('ink-undo').disabled = !undoStack.length;
    el('ink-redo').disabled = !redoStack.length;
    el('ink-zoom').textContent = Math.round(view.scale * 100) + '%';
  }

  /* ---------- history ---------- */
  function commit(next) { undoStack.push(strokes); redoStack = []; strokes = next; render(); updateUI(); }
  function undo() { if (!undoStack.length) return; redoStack.push(strokes); strokes = undoStack.pop(); render(); updateUI(); }
  function redo() { if (!redoStack.length) return; undoStack.push(strokes); strokes = redoStack.pop(); render(); updateUI(); }

  /* ---------- geometry ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = r.width; cssH = r.height;
    canvas.width = Math.round(cssW * dpr()); canvas.height = Math.round(cssH * dpr());
  }
  const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });
  function screenPt(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function zoomAt(sx, sy, f) {
    const w = toWorld(sx, sy);
    view.scale = Math.max(0.15, Math.min(8, view.scale * f));
    view.x = sx - w.x * view.scale;
    view.y = sy - w.y * view.scale;
  }

  /* ---------- rendering ---------- */
  function requestRender() { if (!raf) raf = requestAnimationFrame(() => { raf = null; render(); }); }

  function render() {
    const d = dpr();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cssW, cssH); // the infinite page
    ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
    for (const s of strokes) drawStroke(ctx, s);
    if (live) drawStroke(ctx, live);
  }

  // Draw one stroke in the current (world) transform.
  function drawStroke(c, s) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = s.color; c.fillStyle = s.color; c.lineWidth = s.size;
    if (s.tool === 'pen') {
      const p = s.points;
      if (p.length === 1) { c.beginPath(); c.arc(p[0].x, p[0].y, s.size / 2, 0, 7); c.fill(); return; }
      c.beginPath(); c.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y);
      c.stroke();
    } else if (s.tool === 'ruler') {
      c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); c.stroke();
    } else if (s.tool === 'rect') {
      c.strokeRect(s.a.x, s.a.y, s.b.x - s.a.x, s.b.y - s.a.y);
    } else if (s.tool === 'ellipse') {
      const cx = (s.a.x + s.b.x) / 2, cy = (s.a.y + s.b.y) / 2;
      const rx = Math.abs(s.b.x - s.a.x) / 2, ry = Math.abs(s.b.y - s.a.y) / 2;
      c.beginPath(); c.ellipse(cx, cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2); c.stroke();
    } else if (s.tool === 'arrow') {
      c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); c.stroke();
      const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
      const h = Math.max(10, s.size * 3.2);
      c.beginPath();
      c.moveTo(s.b.x, s.b.y);
      c.lineTo(s.b.x - h * Math.cos(ang - 0.4), s.b.y - h * Math.sin(ang - 0.4));
      c.moveTo(s.b.x, s.b.y);
      c.lineTo(s.b.x - h * Math.cos(ang + 0.4), s.b.y - h * Math.sin(ang + 0.4));
      c.stroke();
    }
  }

  // Snap a ruler/line endpoint to horizontal / vertical / 45° when within ~6° (clean axes).
  function snapAxis(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy); if (len < 1) return b;
    let ang = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snapped = Math.round(ang / step) * step;
    if (Math.abs(ang - snapped) < 0.105) ang = snapped; // ~6°
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }

  /* ---------- pointer interaction ---------- */
  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    const p = screenPt(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 2) { // start pinch — abandon any in-progress draw
      live = null; panning = false;
      const pts = [...pointers.values()];
      pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } };
      render();
      return;
    }
    if (pointers.size !== 1) return;

    if (tool === 'pan') { panning = true; panLast = p; return; }
    if (tool === 'eraser') { eraseSnapshot = null; eraseAt(toWorld(p.x, p.y)); return; }

    const w = toWorld(p.x, p.y);
    if (tool === 'pen') live = { tool: 'pen', color, size, points: [w] };
    else live = { tool, color, size, a: w, b: w };
    render();
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = screenPt(e);
    pointers.set(e.pointerId, p);

    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (pinch.dist > 0) zoomAt(mid.x, mid.y, dist / pinch.dist);
      view.x += mid.x - pinch.mid.x; view.y += mid.y - pinch.mid.y; // two-finger pan
      pinch = { dist, mid };
      render(); updateUI();
      return;
    }
    if (panning && panLast) { view.x += p.x - panLast.x; view.y += p.y - panLast.y; panLast = p; render(); updateUI(); return; }
    if (tool === 'eraser' && pointers.size === 1) { eraseAt(toWorld(p.x, p.y)); return; }
    if (!live) return;

    const w = toWorld(p.x, p.y);
    if (live.tool === 'pen') live.points.push(w);
    else if (live.tool === 'ruler' || live.tool === 'arrow') live.b = snapAxis(live.a, w);
    else live.b = w;
    requestRender();
  }

  function onUp(e) {
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      panning = false; panLast = null;
      if (live) {
        const s = live; live = null;
        const empty = s.tool === 'pen' ? s.points.length === 0
          : (Math.abs(s.a.x - s.b.x) < 1.5 && Math.abs(s.a.y - s.b.y) < 1.5);
        if (!empty) commit(strokes.concat([s])); else render();
      }
    }
  }

  // Object eraser: drop any stroke whose geometry passes near the cursor.
  function eraseAt(w) {
    const thresh = Math.max(8, size * 2.2) / view.scale + 2;
    const keep = strokes.filter((s) => !strokeHit(s, w, thresh));
    if (keep.length !== strokes.length) {
      if (!eraseSnapshot) { eraseSnapshot = strokes; undoStack.push(strokes); redoStack = []; }
      strokes = keep; render(); updateUI();
    }
  }

  function strokeHit(s, w, t) {
    const near = (ax, ay, bx, by) => distToSeg(w.x, w.y, ax, ay, bx, by) <= t;
    if (s.tool === 'pen') {
      const p = s.points;
      if (p.length === 1) return Math.hypot(p[0].x - w.x, p[0].y - w.y) <= t;
      for (let i = 1; i < p.length; i++) if (near(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y)) return true;
      return false;
    }
    if (s.tool === 'ruler' || s.tool === 'arrow') return near(s.a.x, s.a.y, s.b.x, s.b.y);
    if (s.tool === 'rect') {
      const { a, b } = s;
      return near(a.x, a.y, b.x, a.y) || near(b.x, a.y, b.x, b.y) ||
        near(b.x, b.y, a.x, b.y) || near(a.x, b.y, a.x, a.y);
    }
    if (s.tool === 'ellipse') {
      const cx = (s.a.x + s.b.x) / 2, cy = (s.a.y + s.b.y) / 2;
      const rx = Math.abs(s.b.x - s.a.x) / 2 || 1, ry = Math.abs(s.b.y - s.a.y) / 2 || 1;
      const v = ((w.x - cx) / rx) ** 2 + ((w.y - cy) / ry) ** 2;
      const band = t / Math.min(rx, ry);
      return v <= (1 + band) ** 2 && v >= (1 - band) ** 2;
    }
    return false;
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let tt = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy));
  }

  /* ---------- fit / export ---------- */
  function contentBounds(pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y, m) => { minX = Math.min(minX, x - m); minY = Math.min(minY, y - m); maxX = Math.max(maxX, x + m); maxY = Math.max(maxY, y + m); };
    for (const s of strokes) {
      const m = s.size / 2 + (pad || 0);
      if (s.tool === 'pen') for (const p of s.points) add(p.x, p.y, m);
      else { add(s.a.x, s.a.y, m); add(s.b.x, s.b.y, m); }
    }
    return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  function fit() {
    const b = contentBounds(20);
    if (!b) { view = { scale: 1, x: cssW / 2, y: cssH / 2 }; return; }
    const spanX = Math.max(b.maxX - b.minX, 1), spanY = Math.max(b.maxY - b.minY, 1);
    view.scale = Math.max(0.15, Math.min(4, Math.min(cssW / spanX, cssH / spanY) * 0.92));
    view.x = cssW / 2 - ((b.minX + b.maxX) / 2) * view.scale;
    view.y = cssH / 2 - ((b.minY + b.maxY) / 2) * view.scale;
  }

  function exportPNG() {
    const b = contentBounds(28);
    if (!b) return null; // nothing drawn
    const spanX = b.maxX - b.minX, spanY = b.maxY - b.minY;
    const scale = Math.max(1, Math.min(2.5, 1600 / Math.max(spanX, spanY)));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(spanX * scale));
    out.height = Math.max(1, Math.round(spanY * scale));
    const c = out.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, out.width, out.height);
    c.setTransform(scale, 0, 0, scale, -b.minX * scale, -b.minY * scale);
    for (const s of strokes) drawStroke(c, s);
    let blob = null;
    // toDataURL is synchronous, which keeps the export simple within this call.
    const data = out.toDataURL('image/png');
    const bin = atob(data.split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blob = new Blob([arr], { type: 'image/png' });
    return blob;
  }

  return { open };
})();
