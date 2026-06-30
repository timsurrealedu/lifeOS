'use strict';
/* ============ lifeOS — pragmatic Vim bindings for a <textarea> ============
   A self-contained, dependency-free subset of Vim aimed at note editing. Supports
   normal / insert / visual modes, the common motions and operators (h j k l w b e 0 ^ $
   gg G, i a o I A O, x r dd dw d$ D cc cw C yy p P u J, counts, and visual d/y/c).
   Attach to a textarea; toggle with setEnabled(). It never blocks normal typing while
   disabled, and in insert mode only Escape is intercepted. */
window.LifeVim = (function () {
  function attach(ta, { onMode } = {}) {
    let enabled = false;
    let mode = 'normal';            // 'normal' | 'insert' | 'visual'
    let count = '';                 // pending count digits
    let pending = '';               // pending operator/prefix: d c y g r
    let vAnchor = 0;                // visual-mode anchor
    let reg = { text: '', line: false };
    const history = [];             // undo snapshots

    const val = () => ta.value;
    const setVal = (v) => { ta.value = v; };
    const lineStart = (p) => val().lastIndexOf('\n', p - 1) + 1;
    const lineEnd = (p) => { const i = val().indexOf('\n', p); return i === -1 ? val().length : i; };
    const firstNonBlank = (p) => {
      const s = lineStart(p), e = lineEnd(p); const m = val().slice(s, e).match(/\S/);
      return m ? s + m.index : s;
    };
    const setCaret = (a, b) => { ta.setSelectionRange(a, b == null ? a : b, b != null && b < a ? 'backward' : 'forward'); };
    const snapshot = () => { history.push({ v: val(), p: ta.selectionStart }); if (history.length > 200) history.shift(); };

    function status(extra) {
      if (!onMode) return;
      onMode(enabled ? mode.toUpperCase() : '', enabled ? (count + pending + (extra || '')) : '');
    }

    function toInsert(at) { mode = 'insert'; pending = ''; count = ''; if (at != null) setCaret(at); ta.classList.remove('vim-block'); status(); }
    function toNormal() {
      mode = 'normal'; pending = ''; count = '';
      // Vim sits the caret on a character, never past the last one of a line.
      const p = ta.selectionStart; const ls = lineStart(p), le = lineEnd(p);
      if (p > ls && p === le && le > ls) setCaret(p - 1);
      else setCaret(p);
      status();
    }
    function toVisual() { mode = 'visual'; vAnchor = ta.selectionStart; pending = ''; count = ''; status(); }

    // ---- motions: given a position, return the destination caret index ----
    function wordFwd(p) {
      const v = val(), n = v.length; let i = p;
      const isW = (c) => /\w/.test(c);
      if (i >= n) return n;
      if (isW(v[i])) { while (i < n && isW(v[i])) i++; }
      else if (!/\s/.test(v[i])) { while (i < n && !isW(v[i]) && !/\s/.test(v[i])) i++; }
      while (i < n && /\s/.test(v[i])) i++;
      return i;
    }
    function wordBack(p) {
      const v = val(); let i = p - 1;
      while (i > 0 && /\s/.test(v[i])) i--;
      if (i > 0) {
        if (/\w/.test(v[i])) { while (i > 0 && /\w/.test(v[i - 1])) i--; }
        else { while (i > 0 && !/\w/.test(v[i - 1]) && !/\s/.test(v[i - 1])) i--; }
      }
      return Math.max(0, i);
    }
    function wordEnd(p) {
      const v = val(), n = v.length; let i = p + 1;
      while (i < n && /\s/.test(v[i])) i++;
      if (i < n) { if (/\w/.test(v[i])) { while (i + 1 < n && /\w/.test(v[i + 1])) i++; } else { while (i + 1 < n && !/\w/.test(v[i + 1]) && !/\s/.test(v[i + 1])) i++; } }
      return Math.min(n, i);
    }
    function vertical(p, dir, times) {
      const col = p - lineStart(p);
      let cur = p;
      for (let k = 0; k < times; k++) {
        if (dir < 0) { const ls = lineStart(cur); if (ls === 0) break; cur = ls - 1; }
        else { const le = lineEnd(cur); if (le >= val().length) break; cur = le + 1; }
      }
      const ls = lineStart(cur), le = lineEnd(cur);
      return Math.min(ls + col, le);
    }

    // Resolve a motion key into { to, line } (line = whole-line/linewise operation).
    function motion(key, times) {
      const p = ta.selectionStart;
      switch (key) {
        case 'h': return { to: Math.max(lineStart(p), p - times) };
        case 'l': return { to: Math.min(lineEnd(p), p + times) };
        case '0': return { to: lineStart(p) };
        case '^': return { to: firstNonBlank(p) };
        case '$': { let t = p; for (let k = 0; k < times; k++) t = lineEnd(t) + (k < times - 1 ? 1 : 0); return { to: lineEnd(p === t ? p : t) }; }
        case 'w': { let t = p; for (let k = 0; k < times; k++) t = wordFwd(t); return { to: t }; }
        case 'b': { let t = p; for (let k = 0; k < times; k++) t = wordBack(t); return { to: t }; }
        case 'e': { let t = p; for (let k = 0; k < times; k++) t = wordEnd(t); return { to: t }; }
        case 'j': return { to: vertical(p, 1, times), line: true };
        case 'k': return { to: vertical(p, -1, times), line: true };
        case 'G': return { to: lineStart(val().length), line: true };
        case 'gg': return { to: 0, line: true };
        default: return null;
      }
    }

    function yankRange(a, b, line) {
      reg = { text: val().slice(a, b), line: !!line };
    }
    // Expand [a,b] to full lines (including trailing newline) for linewise ops.
    function lineSpan(a, b) {
      const s = lineStart(Math.min(a, b));
      let e = lineEnd(Math.max(a, b));
      if (e < val().length) e += 1; // swallow the newline
      else if (s > 0) return { s: s - 1, e }; // last line: take preceding newline
      return { s, e };
    }
    function deleteRange(a, b, line) {
      snapshot();
      let s = Math.min(a, b), e = Math.max(a, b);
      if (line) { const sp = lineSpan(a, b); s = sp.s; e = sp.e; }
      yankRange(s, e, line);
      setVal(val().slice(0, s) + val().slice(e));
      setCaret(line ? firstNonBlankAt(s) : s);
    }
    function firstNonBlankAt(p) { p = Math.min(p, val().length); const s = lineStart(p), e = lineEnd(p); const m = val().slice(s, e).match(/\S/); return m ? s + m.index : s; }

    function paste(after) {
      snapshot();
      const p = ta.selectionStart;
      if (reg.line) {
        let text = reg.text; if (!text.endsWith('\n')) text += '\n';
        const at = after ? lineEnd(p) + (lineEnd(p) < val().length ? 1 : 0) : lineStart(p);
        let ins = text;
        if (after && lineEnd(p) >= val().length) ins = '\n' + text.replace(/\n$/, '');
        setVal(val().slice(0, at) + ins + val().slice(at));
        setCaret(firstNonBlankAt(at + (ins.startsWith('\n') ? 1 : 0)));
      } else {
        const at = after ? Math.min(p + 1, lineEnd(p)) : p;
        setVal(val().slice(0, at) + reg.text + val().slice(at));
        setCaret(at + reg.text.length - 1);
      }
    }

    function openLine(below) {
      snapshot();
      const p = ta.selectionStart;
      if (below) { const e = lineEnd(p); setVal(val().slice(0, e) + '\n' + val().slice(e)); toInsert(e + 1); }
      else { const s = lineStart(p); setVal(val().slice(0, s) + '\n' + val().slice(s)); toInsert(s); }
    }

    function applyOperator(op, a, b, line) {
      if (op === 'y') { let s = Math.min(a, b), e = Math.max(a, b); if (line) { const sp = lineSpan(a, b); s = sp.s; e = sp.e; } yankRange(s, e, line); setCaret(Math.min(a, b)); }
      else if (op === 'd') { deleteRange(a, b, line); }
      else if (op === 'c') {
        if (line) { // change line(s): keep the lines but blank them, enter insert at indent
          snapshot(); const s = lineStart(Math.min(a, b)); const e = lineEnd(Math.max(a, b));
          setVal(val().slice(0, s) + val().slice(e)); toInsert(s);
        } else { deleteRange(a, b, false); mode = 'insert'; ta.classList.remove('vim-block'); status(); }
      }
    }

    function handleNormal(e) {
      const k = e.key;
      if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return;
      const times = Math.max(1, parseInt(count || '1', 10));

      // count digits
      if (/^[1-9]$/.test(k) || (k === '0' && count)) { count += k; e.preventDefault(); status(); return; }

      // pending r{char}: replace
      if (pending === 'r') {
        if (k.length === 1) { snapshot(); const p = ta.selectionStart; if (p < lineEnd(p)) { setVal(val().slice(0, p) + k + val().slice(p + 1)); setCaret(p); } }
        pending = ''; count = ''; e.preventDefault(); status(); return;
      }
      // pending g (gg)
      if (pending === 'g') {
        pending = '';
        if (k === 'g') { const m = motion('gg', times); setCaret(m.to); }
        e.preventDefault(); count = ''; status(); return;
      }
      // pending operator d/c/y awaiting a motion (or doubled: dd/cc/yy)
      if (pending === 'd' || pending === 'c' || pending === 'y') {
        const op = pending; pending = '';
        if (k === op) { // dd / cc / yy → linewise on `times` lines
          const p = ta.selectionStart; let endLine = p; for (let i = 1; i < times; i++) endLine = Math.min(val().length, lineEnd(endLine) + 1);
          applyOperator(op, lineStart(p), lineEnd(endLine), true);
          e.preventDefault(); count = ''; status(); return;
        }
        const mo = motion(k === 'g' ? 'gg' : k, times);
        if (mo) { applyOperator(op, ta.selectionStart, mo.to, mo.line); }
        e.preventDefault(); count = ''; status(); return;
      }

      switch (k) {
        case 'Escape': count = ''; pending = ''; status(); break;
        case 'i': toInsert(); break;
        case 'I': toInsert(firstNonBlank(ta.selectionStart)); break;
        case 'a': { const p = ta.selectionStart; toInsert(Math.min(p + 1, lineEnd(p))); break; }
        case 'A': toInsert(lineEnd(ta.selectionStart)); break;
        case 'o': openLine(true); break;
        case 'O': openLine(false); break;
        case 'v': toVisual(); break;
        case 'x': { snapshot(); const p = ta.selectionStart; const e2 = Math.min(lineEnd(p), p + times); if (e2 > p) { yankRange(p, e2); setVal(val().slice(0, p) + val().slice(e2)); setCaret(Math.min(p, lineEnd(p) - 1 < p ? p : p)); } break; }
        case 'D': { snapshot(); const p = ta.selectionStart; yankRange(p, lineEnd(p)); setVal(val().slice(0, p) + val().slice(lineEnd(p))); setCaret(Math.max(lineStart(p), p - 1)); break; }
        case 'C': { snapshot(); const p = ta.selectionStart; yankRange(p, lineEnd(p)); setVal(val().slice(0, p) + val().slice(lineEnd(p))); toInsert(p); break; }
        case 's': { snapshot(); const p = ta.selectionStart; const e2 = Math.min(lineEnd(p), p + times); setVal(val().slice(0, p) + val().slice(e2)); toInsert(p); break; }
        case 'p': paste(true); break;
        case 'P': paste(false); break;
        case 'u': if (history.length) { const h = history.pop(); setVal(h.v); setCaret(Math.min(h.p, val().length)); } break;
        case 'J': { snapshot(); const p = ta.selectionStart; const e2 = lineEnd(p); if (e2 < val().length) { setVal(val().slice(0, e2) + ' ' + val().slice(e2 + 1).replace(/^\s+/, '')); setCaret(e2); } break; }
        case 'r': pending = 'r'; e.preventDefault(); status(); return;
        case 'd': case 'c': case 'y': pending = k; e.preventDefault(); status(); return;
        case 'g': pending = 'g'; e.preventDefault(); status(); return;
        default: {
          const mo = motion(k, times);
          if (mo) setCaret(mo.to);
          else { return; } // unhandled → let it through (don't preventDefault)
        }
      }
      count = '';
      e.preventDefault();
      status();
    }

    function handleVisual(e) {
      const k = e.key;
      if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return;
      const times = Math.max(1, parseInt(count || '1', 10));
      if (/^[1-9]$/.test(k) || (k === '0' && count)) { count += k; e.preventDefault(); return; }
      const head = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
      const sel = (to) => { if (to >= vAnchor) setCaret(vAnchor, to); else setCaret(to, vAnchor); };
      switch (k) {
        case 'Escape': toNormal(); break;
        case 'g': pending = pending === 'g' ? '' : 'g'; if (pending === '') { sel(0); } e.preventDefault(); return;
        case 'd': case 'x': { const a = ta.selectionStart, b = ta.selectionEnd; deleteRange(a, b, false); toNormal(); break; }
        case 'y': { const a = ta.selectionStart, b = ta.selectionEnd; yankRange(a, b); setCaret(Math.min(a, b)); toNormal(); break; }
        case 'c': { const a = ta.selectionStart, b = ta.selectionEnd; deleteRange(a, b, false); mode = 'insert'; ta.classList.remove('vim-block'); status(); break; }
        default: {
          const mo = motion(pending === 'g' && k === 'g' ? 'gg' : k, times);
          pending = '';
          if (mo) { sel(mo.to); count = ''; e.preventDefault(); return; }
          return;
        }
      }
      count = '';
      e.preventDefault();
    }

    function onKey(e) {
      if (!enabled) return;
      if (mode === 'insert') {
        if (e.key === 'Escape') { e.preventDefault(); toNormal(); }
        return;
      }
      if (e.key === 'Tab') return; // let focus move
      if (mode === 'visual') handleVisual(e);
      else handleNormal(e);
    }
    ta.addEventListener('keydown', onKey);

    return {
      setEnabled(on) {
        enabled = !!on;
        mode = 'normal'; pending = ''; count = '';
        ta.classList.toggle('vim-on', enabled);
        status();
      },
      isEnabled() { return enabled; },
      enterNormal() { if (enabled) toNormal(); },
      detach() { ta.removeEventListener('keydown', onKey); },
    };
  }
  return { attach };
})();
