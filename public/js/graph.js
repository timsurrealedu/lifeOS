'use strict';
/* Dependency-free force-directed graph on canvas, with pan / zoom / tap.
   The layout is pre-warmed off-screen and fitted before the first paint, so the graph
   appears already settled instead of exploding across the screen and snapping back. */
window.LifeGraph = (function () {
  let raf = null;

  function render(canvas, data, { onSelect, onOpen } = {}) {
    if (raf) cancelAnimationFrame(raf);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Pull colours from the active theme so the graph matches dark / light / cyberpunk.
    const css = getComputedStyle(canvas);
    const cv = (name, fb) => (css.getPropertyValue(name).trim() || fb);
    const C = {
      accent: cv('--accent', '#e2914f'),
      hub: cv('--accent', '#e2914f'),
      leaf: cv('--faint', '#8a7c66'),
      dangling: cv('--border', '#3b3025'),
      text: cv('--text', '#f3ebdf'),
      hi: cv('--sage', '#9bb273'),
    };

    // Hubs (high-degree "parents") are drawn bigger than leaf notes — but kept fairly compact so
    // they don't dominate the canvas.
    const radius = (degree) => 4.5 + Math.min(degree, 20) * 1.45;
    const n = data.nodes.length || 1;
    // Seed positions on a spread-out spiral (deterministic) so the sim starts untangled
    // and converges gently rather than flinging nodes from a random clump. A wider spread
    // gives the settled layout that roomy, orbit-like feel.
    const spread = 90 + Math.sqrt(n) * 64;
    const nodes = data.nodes.map((nd, i) => {
      const a = i * 2.399963; // golden angle → even angular spread
      const rad = spread * Math.sqrt((i + 0.5) / n);
      return { ...nd, x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0, r: radius(nd.degree) };
    });
    const byId = new Map(nodes.map((nd) => [nd.id.toLowerCase(), nd]));
    const links = data.links
      .map((l) => ({ s: byId.get(l.source.toLowerCase()), t: byId.get(l.target.toLowerCase()) }))
      .filter((l) => l.s && l.t);

    // Adjacency → used to highlight a node's direct connections on hover (Obsidian-style).
    const neighbors = new Map(nodes.map((nd) => [nd, new Set()]));
    for (const l of links) { neighbors.get(l.s).add(l.t); neighbors.get(l.t).add(l.s); }

    const view = { scale: 1, ox: 0, oy: 0, panx: 0, pany: 0 };
    let selected = null;
    let hovered = null;
    // Declared up here (not with the other interaction vars below) because tick()
    // reads dragNode and the loop runs before that block — a `let` there would put
    // dragNode in the temporal dead zone and throw on the first frame.
    let dragNode = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
      view.ox = canvas.width / 2; view.oy = canvas.height / 2;
      fit();
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    // ---- physics ----
    // Stronger repulsion + size-aware spring rest lengths keep the graph spaced out
    // (no painful clumping). Repulsion grows with node size so big hubs clear room.
    // `alpha` is the sim "temperature": it cools toward `alphaTarget` each tick. Normally the
    // target is 0 so the layout settles and freezes. While a node is being dragged we hold the
    // target warm (see down/up) so neighbours keep springing along with it — without this the sim
    // freezes after a second or two and dragged nodes stop dragging their links (the old bug where
    // small balls stuck in place after moving a hub back and forth).
    let alpha = 1, alphaTarget = 0;
    function tick() {
      alpha = alphaTarget + (alpha - alphaTarget) * 0.985;
      const k = alpha;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy || 0.01;
          const f = ((2900 + (a.r + b.r) * 34) * k) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const l of links) {
        let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const rest = 124 + l.s.r + l.t.r;
        const f = ((d - rest) * 0.032) * k;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
      }
      for (const nd of nodes) {
        nd.vx -= nd.x * 0.0013 * k; nd.vy -= nd.y * 0.0013 * k; // weak centering
        nd.vx *= 0.86; nd.vy *= 0.86;
        if (nd !== dragNode) { nd.x += nd.vx; nd.y += nd.vy; }
      }
    }

    // Pre-warm the layout to near-convergence before anyone sees it. alpha decays so by the
    // time the live loop starts there's almost no motion left — the explosion is invisible.
    const warm = Math.min(400, 220 + nodes.length * 2);
    for (let i = 0; i < warm; i++) tick();

    // Fit the settled layout to the canvas and centre it.
    function fit() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const nd of nodes) {
        minX = Math.min(minX, nd.x - nd.r); maxX = Math.max(maxX, nd.x + nd.r);
        minY = Math.min(minY, nd.y - nd.r); maxY = Math.max(maxY, nd.y + nd.r);
      }
      if (!isFinite(minX)) return;
      const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
      const s = Math.min(canvas.width / spanX, canvas.height / spanY) * 0.84;
      view.scale = Math.max(0.2, Math.min(2.2, s));
      const mcx = (minX + maxX) / 2, mcy = (minY + maxY) / 2;
      view.panx = -mcx * view.scale; view.pany = -mcy * view.scale;
    }
    fit();

    const tx = (x) => x * view.scale + view.ox + view.panx;
    const ty = (y) => y * view.scale + view.oy + view.pany;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // The focused node: hover takes priority, else the tapped selection. When set, only it
      // and its direct connections stay lit; everything else fades back (Obsidian-style).
      const active = hovered || selected;
      const lit = active ? new Set([active, ...neighbors.get(active)]) : null;

      ctx.lineWidth = 1 * dpr;
      for (const l of links) {
        const onActive = active && (l.s === active || l.t === active);
        ctx.globalAlpha = active ? (onActive ? 0.7 : 0.04) : 0.18;
        ctx.strokeStyle = onActive ? C.hi : C.accent;
        ctx.lineWidth = (onActive ? 1.6 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(tx(l.s.x), ty(l.s.y));
        ctx.lineTo(tx(l.t.x), ty(l.t.y));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const nd of nodes) {
        const X = tx(nd.x), Y = ty(nd.y), R = nd.r * dpr * view.scale;
        const isSel = nd === selected, isHov = nd === hovered;
        const on = !active || lit.has(nd);
        ctx.globalAlpha = on ? 1 : 0.12;
        ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2);
        ctx.fillStyle = nd.exists ? (nd.degree > 4 ? C.hub : C.leaf) : C.dangling;
        if (isSel || isHov) ctx.fillStyle = C.hi;
        ctx.fill();
        if (isSel || isHov) { ctx.strokeStyle = C.hi; ctx.lineWidth = 2 * dpr; ctx.stroke(); }
        // Labels fade with zoom: hubs (high degree) keep their label when zoomed out; leaf labels
        // fade in only as you zoom in — so zooming out dissolves them from the small balls up to
        // the big ones. The focused node + its neighbours are always labelled.
        const focus = isSel || isHov;
        let labelA;
        if (focus) labelA = 1;
        else {
          const appear = 1.4 - Math.min(nd.degree, 20) * 0.06;          // hubs appear at lower zoom
          labelA = Math.max(0, Math.min(1, (view.scale - appear) / 0.5));
          labelA *= active ? (lit.has(nd) ? 0.85 : 0.22) : 0.85;        // dim non-focused on selection
        }
        if (!on) labelA = Math.min(labelA, 0.12);
        if (labelA > 0.03) {
          ctx.fillStyle = focus ? C.hi : C.text;
          ctx.globalAlpha = labelA;
          const fs = Math.min(15, 10 + nd.degree * 0.3) * dpr;
          ctx.font = `${fs}px -apple-system, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(nd.id, X, Y + R + 12 * dpr);
        }
        ctx.globalAlpha = 1;
      }
    }

    function loop() { tick(); draw(); raf = requestAnimationFrame(loop); }
    loop();

    // ---- interaction ----
    let dragging = false, last = null, pinchDist = null;
    const toLocal = (cx, cy) => {
      const rect = canvas.getBoundingClientRect();
      const px = (cx - rect.left) * dpr, py = (cy - rect.top) * dpr;
      return { px, py, x: (px - view.ox - view.panx) / view.scale, y: (py - view.oy - view.pany) / view.scale };
    };
    function pick(cx, cy) {
      const { x, y } = toLocal(cx, cy);
      let best = null, bd = Infinity;
      for (const nd of nodes) {
        const d = (nd.x - x) ** 2 + (nd.y - y) ** 2;
        if (d < bd && d < (nd.r + 10) ** 2) { bd = d; best = nd; }
      }
      return best;
    }

    function down(cx, cy) {
      const nd = pick(cx, cy);
      last = { cx, cy };
      // Reheat AND hold the sim warm for the whole drag, so links keep pulling neighbours live.
      if (nd) { dragNode = nd; selected = nd; alphaTarget = 0.3; alpha = Math.max(alpha, 0.5); onSelect && onSelect(nd.id, nd.exists); }
      else { dragging = true; }
    }
    function move(cx, cy) {
      if (dragNode) {
        const { x, y } = toLocal(cx, cy);
        dragNode.x = x; dragNode.y = y; dragNode.vx = 0; dragNode.vy = 0; // pin to cursor, no fling on release
        alpha = Math.max(alpha, 0.3);                                     // keep it lively even on slow drags
      } else if (dragging && last) { view.panx += (cx - last.cx) * dpr; view.pany += (cy - last.cy) * dpr; last = { cx, cy }; }
    }
    let downAt = 0;
    function up() {
      if (dragNode && Date.now() - downAt < 250) onOpen && onOpen(dragNode.id);
      dragNode = null; dragging = false; last = null;
      alphaTarget = 0;   // let the layout cool back down and settle
    }

    function zoomAt(cx, cy, f) {
      // keep the point under the cursor fixed while zooming
      const rect = canvas.getBoundingClientRect();
      const px = (cx - rect.left) * dpr, py = (cy - rect.top) * dpr;
      const wx = (px - view.ox - view.panx) / view.scale, wy = (py - view.oy - view.pany) / view.scale;
      view.scale = Math.max(0.15, Math.min(4, view.scale * f));
      view.panx = px - view.ox - wx * view.scale;
      view.pany = py - view.oy - wy * view.scale;
    }

    canvas.addEventListener('mousedown', (e) => { downAt = Date.now(); down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => up());
    // Hover → highlight the node under the cursor and its connections (no drag in progress).
    canvas.addEventListener('mousemove', (e) => {
      if (dragNode || dragging) { hovered = null; canvas.style.cursor = dragging ? 'grabbing' : 'default'; return; }
      const nd = pick(e.clientX, e.clientY);
      hovered = nd || null;
      canvas.style.cursor = nd ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', () => { hovered = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.9);
    }, { passive: false });

    canvas.addEventListener('touchstart', (e) => {
      downAt = Date.now();
      if (e.touches.length === 2) { pinchDist = dist2(e.touches); }
      else down(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchDist) {
        const d = dist2(e.touches);
        const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        zoomAt(mid.x, mid.y, d / pinchDist); pinchDist = d;
      } else move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchend', () => { pinchDist = null; up(); });

    function dist2(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  }

  return { render };
})();
