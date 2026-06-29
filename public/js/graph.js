'use strict';
/* Dependency-free force-directed graph on canvas, with pan / zoom / tap. */
window.LifeGraph = (function () {
  let raf = null;

  function render(canvas, data, { onSelect, onOpen } = {}) {
    if (raf) cancelAnimationFrame(raf);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const nodes = data.nodes.map((n) => ({
      ...n, x: Math.random() * 400 - 200, y: Math.random() * 400 - 200, vx: 0, vy: 0,
      r: 4 + Math.min(n.degree, 12) * 1.6,
    }));
    const byId = new Map(nodes.map((n) => [n.id.toLowerCase(), n]));
    const links = data.links
      .map((l) => ({ s: byId.get(l.source.toLowerCase()), t: byId.get(l.target.toLowerCase()) }))
      .filter((l) => l.s && l.t);

    const view = { scale: 1, ox: 0, oy: 0 };
    let selected = null;
    // Declared up here (not with the other interaction vars below) because tick()
    // reads dragNode and loop() runs synchronously before that block — a `let` there
    // would put dragNode in the temporal dead zone and throw on the first frame.
    let dragNode = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
      view.ox = canvas.width / 2; view.oy = canvas.height / 2;
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    // physics
    let alpha = 1;
    function tick() {
      alpha *= 0.985;
      const k = alpha;
      // repulsion (O(n^2) — fine for personal vaults)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy || 0.01;
          const f = (900 * k) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      // springs
      for (const l of links) {
        let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = ((d - 70) * 0.04) * k;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
      }
      // centering + integrate
      for (const n of nodes) {
        n.vx -= n.x * 0.002 * k; n.vy -= n.y * 0.002 * k;
        n.vx *= 0.85; n.vy *= 0.85;
        if (n !== dragNode) { n.x += n.vx; n.y += n.vy; }
      }
    }

    const tx = (x) => x * view.scale + view.ox + view.panx;
    const ty = (y) => y * view.scale + view.oy + view.pany;
    view.panx = 0; view.pany = 0;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = 'rgba(226,145,79,0.20)';
      for (const l of links) {
        ctx.beginPath();
        ctx.moveTo(tx(l.s.x), ty(l.s.y));
        ctx.lineTo(tx(l.t.x), ty(l.t.y));
        ctx.stroke();
      }
      for (const n of nodes) {
        const X = tx(n.x), Y = ty(n.y), R = n.r * dpr * view.scale;
        const isSel = n === selected;
        ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2);
        ctx.fillStyle = n.exists
          ? (n.degree > 4 ? '#e2914f' : '#c97f44')
          : '#4a3d30';
        if (isSel) ctx.fillStyle = '#9bb273';
        ctx.fill();
        if (isSel) { ctx.strokeStyle = '#9bb273'; ctx.lineWidth = 2 * dpr; ctx.stroke(); }
        // labels for big nodes / selected
        if (n.degree >= 3 || isSel || view.scale > 1.4) {
          ctx.fillStyle = isSel ? '#eafce0' : 'rgba(243,235,223,0.72)';
          ctx.font = `${11 * dpr}px -apple-system, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.id, X, Y + R + 12 * dpr);
        }
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
      for (const n of nodes) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < bd && d < (n.r + 10) ** 2) { bd = d; best = n; }
      }
      return best;
    }

    function down(cx, cy) {
      const n = pick(cx, cy);
      last = { cx, cy };
      if (n) { dragNode = n; selected = n; alpha = Math.max(alpha, 0.3); onSelect && onSelect(n.id, n.exists); }
      else { dragging = true; }
    }
    function move(cx, cy) {
      if (dragNode) { const { x, y } = toLocal(cx, cy); dragNode.x = x; dragNode.y = y; }
      else if (dragging && last) { view.panx += (cx - last.cx) * dpr; view.pany += (cy - last.cy) * dpr; last = { cx, cy }; }
    }
    let downAt = 0;
    function up(cx, cy) {
      if (dragNode && Date.now() - downAt < 250) onOpen && onOpen(dragNode.id);
      dragNode = null; dragging = false; last = null;
    }

    canvas.addEventListener('mousedown', (e) => { downAt = Date.now(); down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', (e) => up(e.clientX, e.clientY));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.1 : 0.9;
      view.scale = Math.max(0.3, Math.min(4, view.scale * f));
    }, { passive: false });

    canvas.addEventListener('touchstart', (e) => {
      downAt = Date.now();
      if (e.touches.length === 2) { pinchDist = dist2(e.touches); }
      else down(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchDist) {
        const d = dist2(e.touches); view.scale = Math.max(0.3, Math.min(4, view.scale * (d / pinchDist))); pinchDist = d;
      } else move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => { pinchDist = null; up(); });

    function dist2(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  }

  return { render };
})();
