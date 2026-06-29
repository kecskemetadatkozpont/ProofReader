/* Publify — site-wide dark mode (CSS-variable based). Loaded EARLY in <head> on every page so the
 * theme is applied before paint (no flash). Dark mode overrides the shared design-system variables
 * (--ink, --surface, --paper, --pane, --line, status tints, …) — NOT a filter, so fixed-position
 * modals, overlays, drawers and sticky bars keep working. Dark is the DEFAULT for new visitors.
 * window.PRTheme = { isDark(), set(t), toggle() } drives the toggle from the nav drawer. */
(function () {
  'use strict';
  var KEY = 'pr-theme';
  function isDark() { return document.documentElement.classList.contains('dark'); }
  function apply(t) { document.documentElement.classList.toggle('dark', t === 'dark'); }

  // 1. apply the theme immediately — dark is the default when nothing is saved yet
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { }
  apply(saved === null ? 'dark' : saved);

  // 2. inject the dark palette + the Aurora Pro design language
  var css = [
    '@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");',   // must stay first
    'body, button, input, select, textarea, h1, h2, h3, h4, h5 { font-family: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }',
    'html.dark { color-scheme: dark;',
    '  --ink: #e7e9ee; --muted: #a3acbd; --faint: #7b8494; --dim: #8a92a0;',
    '  --reading: #6e5612;',  // read-aloud highlight is a BACKGROUND (amber), not a text colour — keep it dark so light text stays legible
    '  --paper: #1b1e26; --pane: #1b1e26; --paper-bg: #1b1e26;',
    '  --soft: #232733; --softer: #15171c; --bg: #14161c; --app-bg: #0f1115;',
    '  --line: #2c313b;',
    '  --accent: #818cf8; --accent-d: #a5b4fc; --accent-l: #a5b4fc;',
    '  --surface: #1b1e26; --surface-2: #232733; --surface-3: #15171c; --accent-tint: #2a2f52;',
    '  --ok: #4ade80; --ok-bg: #16321f; --warn: #fbbf24; --warn-bg: #352910;',
    '  --danger: #f87171; --danger-bg: #3a1c1e; --green: #4ade80; --green-bg: #16321f;',
    '  --be: #2c313b; --grey-bg: #232733; --shadow: 0 8px 28px rgba(0,0,0,.5); }',
    // shadows read as harsh dark blocks on dark; soften the most common ones
    'html.dark .card:hover, html.dark .stu-row:hover { box-shadow: 0 6px 18px rgba(0,0,0,.4) !important; }',
    // hardcoded light gradient backgrounds the variable pass cannot reach (full-screen scrims first)
    'html.dark #pr-ob, html.dark .signin, html.dark #pr-signin, html.dark #pr-splash { background: radial-gradient(120% 120% at 50% -10%, #1b1d2e 0%, #0f1115 60%) !important; }',
    'html.dark .hero { background: radial-gradient(120% 90% at 80% -10%, #1b1d2e 0%, var(--bg) 70%) !important; }',
    'html.dark .thumb, html.dark .pf-viewer-img { background: var(--surface-2) !important; }',
    // ═══ AURORA PRO — the chosen design language (dark-first) ═══
    // deeper, bluer canvas + the aurora gradient token (overrides the values above)
    'html.dark { --bg: #0a0c12; --app-bg: #090b11; --softer: #0c0e15; --soft: #1a1e2b; --surface: #161a26; --surface-2: #1c2233; --surface-3: #0f131d; --pane: #161a26; --paper: #161a26; --paper-bg: #161a26; --line: #262b3a; --be: #262b3a; --grey-bg: #1c2233; --accent: #8b93f8; --accent-tint: #241c4d; --aurora: linear-gradient(135deg,#6366f1 0%,#a855f7 50%,#22d3ee 100%); --grad: linear-gradient(135deg,#6366f1 0%,#a855f7 50%,#22d3ee 100%); }',
    // ambient aurora glow on the page canvas (fixed so it stays while scrolling)
    'html.dark body { background: radial-gradient(900px 520px at 80% -8%, rgba(168,85,247,.20), transparent 60%), radial-gradient(720px 460px at 10% 2%, rgba(99,102,241,.18), transparent 60%), radial-gradient(820px 600px at 60% 118%, rgba(34,211,238,.10), transparent 62%), var(--app-bg, #090b11) !important; background-attachment: fixed !important; }',
    // primary actions → the aurora gradient + a soft glow
    'html.dark .btn.pri, html.dark .btn-primary, html.dark .btn.primary, html.dark button.pri, html.dark .pri.btn, html.dark .btn--primary { background-image: linear-gradient(135deg,#6366f1,#a855f7,#22d3ee) !important; background-color: transparent !important; border-color: transparent !important; color: #fff !important; box-shadow: 0 8px 22px -8px rgba(129,92,240,.6) !important; }',
    'html.dark .btn.pri:hover, html.dark .btn-primary:hover, html.dark button.pri:hover, html.dark .btn--primary:hover { filter: brightness(1.07); }',
    // active segmented / tab states → gradient accent
    'html.dark .seg button.on, html.dark .seg .on, html.dark .seg button[aria-current], html.dark .seg button[aria-selected="true"] { background-image: linear-gradient(135deg,#6366f1,#a855f7) !important; background-color: transparent !important; color: #fff !important; }',
    // accent-tinted selection chips read better on the deep canvas
    'html.dark ::selection { background: rgba(168,85,247,.32); }',
    // ── Aurora glass (phase 2): translucent panels over the glowing canvas ──
    'html.dark .card, html.dark .panel, html.dark .pf-card, html.dark .pf-panel, html.dark .pf-pub, html.dark .pf-stat, html.dark .mp-card, html.dark .mp-item, html.dark .cm-main, html.dark .cm-side, html.dark .cm-ws-col, html.dark .cm-pdfcol, html.dark .cm-rev, html.dark .cm-audio, html.dark .stat, html.dark .kpi { background: rgba(23,27,40,.66) !important; backdrop-filter: blur(11px) saturate(1.15); -webkit-backdrop-filter: blur(11px) saturate(1.15); border: 1px solid rgba(255,255,255,.085) !important; box-shadow: 0 18px 48px -26px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05) !important; }',
    // overlays / popovers / drawers / dialogs → stronger glass
    'html.dark .modal, html.dark .menu, html.dark .notif-pop, html.dark .voice-pop, html.dark .mention-menu, html.dark .ws-menu, html.dark .ws-add-menu, html.dark .wm-ins-menu, html.dark .up-modal, html.dark .pv-modal, html.dark .fig-modal, html.dark .diag-pop, html.dark .pn-drawer, html.dark .acct-drawer, html.dark .cm-modal, html.dark .cm-note, html.dark .pr-cfm { background: rgba(20,24,36,.84) !important; backdrop-filter: blur(20px) saturate(1.3); -webkit-backdrop-filter: blur(20px) saturate(1.3); border: 1px solid rgba(255,255,255,.10) !important; }',
    // global nav bar → glass
    'html.dark #pubnav { background: rgba(13,16,24,.72) !important; backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); border-bottom: 1px solid rgba(255,255,255,.08) !important; }',
    // inputs: a subtle aurora focus glow (complements the global focus ring)
    'html.dark .field:focus, html.dark input:focus, html.dark textarea:focus, html.dark select:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(124,92,240,.20) !important; }',
    // thin, dark, aurora-tinted scrollbars
    'html.dark { scrollbar-color: #333c52 transparent; scrollbar-width: thin; }',
    'html.dark ::-webkit-scrollbar { width: 11px; height: 11px; }',
    'html.dark ::-webkit-scrollbar-track { background: transparent; }',
    'html.dark ::-webkit-scrollbar-thumb { background: #2e3650; border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }',
    'html.dark ::-webkit-scrollbar-thumb:hover { background: #41496b; border-width: 2px; }',
    // ── Magnetic Ring cursor (desktop/mouse only; the JS that drives it is below) ──
    'html.pr-cursor, html.pr-cursor * { cursor: none !important; }',
    'html.pr-cursor textarea, html.pr-cursor [contenteditable], html.pr-cursor .cm-tex, html.pr-cursor .cm-revtext, html.pr-cursor pre, html.pr-cursor code, html.pr-cursor input:is([type=text],[type=search],[type=email],[type=url],[type=password],[type=number],[type=tel]), html.pr-cursor input:not([type]) { cursor: text !important; }',
    'html.pr-cursor .splitter, html.pr-cursor .splitter *, html.pr-cursor .ws-divider, html.pr-cursor .ws-divider.row, html.pr-cursor .cm-split, html.pr-cursor .cm-split * { cursor: col-resize !important; }',
    'html.pr-cursor .ws-divider.col { cursor: row-resize !important; }',
    'html.pr-cursor .pdf-render-scroll, html.pr-cursor .pdf-render-scroll *, html.pr-cursor .pdf-paper, html.pr-cursor .pdf-paper *, html.pr-cursor .ct-scroll, html.pr-cursor .ct-scroll *, html.pr-cursor .pdf-view, html.pr-cursor .pdf-view *, html.pr-cursor .pdf-view-wrap, html.pr-cursor .pdf-view-wrap * { cursor: auto !important; }',
    '#pr-cur { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; opacity: 1; transition: opacity .2s; }',
    '#pr-cur.hide { opacity: 0; }',
    '#pr-cur .pr-cur-dot { position: fixed; left: 0; top: 0; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #fff; mix-blend-mode: difference; will-change: transform; }',
    '#pr-cur .pr-cur-ring { position: fixed; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 1.6px solid var(--accent, #8b93f8); box-shadow: 0 0 14px -3px rgba(129,92,240,.5); will-change: transform; transition: width .18s, height .18s, margin .18s, border-radius .18s, background .18s, border-color .18s; }',
    '#pr-cur .pr-cur-ring.snap { background: rgba(139,147,248,.12); border-color: #a855f7; }',
    // ── accessibility baseline (both themes) — one canonical keyboard-focus ring app-wide ──
    ':focus-visible { outline: 2px solid var(--accent, #4f46e5) !important; outline-offset: 2px; border-radius: inherit; }',
    'a:focus-visible, button:focus-visible, [role="button"]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent, #4f46e5) !important; outline-offset: 2px; }',
    // respect users who ask for less motion (vestibular safety)
    '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; } }',
    // ── shared skeleton/shimmer primitive (kills the false-empty flash while data loads) ──
    '.pr-skel { position: relative; overflow: hidden; background: var(--surface-2, #eef0f3); border-radius: 8px; }',
    '.pr-skel::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(120,140,180,.18), transparent); animation: pr-shimmer 1.3s infinite; }',
    'html.dark .pr-skel { background: var(--surface-2, #232733); } html.dark .pr-skel::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent); }',
    '@keyframes pr-shimmer { 100% { transform: translateX(100%); } }',
    '.pr-skel-row { height: 14px; margin: 7px 0; border-radius: 6px; }',
    // ── shared determinate progress bar ──
    '.pr-bar { height: 7px; border-radius: 999px; background: var(--surface-2, #e6e8ee); overflow: hidden; }',
    '.pr-bar > i { display: block; height: 100%; background: var(--accent, #4f46e5); border-radius: 999px; transition: width .25s ease; }',
    // ── indeterminate variant: <i> slides back and forth while progress is unknown ──
    '.pr-bar.pr-bar--indet > i { width: 40%; transition: none; animation: pr-indet 1.1s ease-in-out infinite; }',
    '@keyframes pr-indet { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }',
    // ── touch: minimum ~40px tap target on coarse pointers (no effect on mouse/desktop) ──
    '@media (pointer: coarse) { button, [role="button"], a.btn, summary, .seg > button { min-height: 38px; } input[type="checkbox"], input[type="radio"] { min-width: 20px; min-height: 20px; } }',
    // ── shared toast + confirm dialog (window.PRUI) — themed, replaces native alert()/confirm() ──
    '#pr-ui { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 4000; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }',
    '.pr-toast { pointer-events: auto; opacity: 0; transform: translateY(14px); transition: opacity .2s, transform .2s; display: flex; align-items: center; gap: 12px; background: var(--surface, #1b1e26); color: var(--ink, #e7e9ee); border: 1px solid var(--line, #2c313b); border-radius: 11px; padding: 10px 11px 10px 15px; box-shadow: 0 10px 34px rgba(0,0,0,.28); font-size: 13.5px; max-width: min(92vw, 460px); }',
    '.pr-toast.in { opacity: 1; transform: translateY(0); }',
    '.pr-toast.error { border-color: color-mix(in srgb, var(--danger, #dc2626) 60%, var(--line)); }',
    '.pr-toast.ok { border-color: color-mix(in srgb, var(--ok, #16a34a) 55%, var(--line)); }',
    '.pr-toast-act { border: 0; background: var(--accent, #4f46e5); color: #fff; border-radius: 7px; padding: 5px 11px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; flex: none; }',
    '.pr-toast-x { border: 0; background: transparent; color: var(--faint, #8a92a0); cursor: pointer; font-size: 17px; line-height: 1; padding: 0 2px; flex: none; }',
    '.pr-cfm-scrim { position: fixed; inset: 0; z-index: 4100; background: rgba(8,10,16,.5); display: grid; place-items: center; padding: 16px; }',
    '.pr-cfm { background: var(--surface, #1b1e26); color: var(--ink, #e7e9ee); border: 1px solid var(--line, #2c313b); border-radius: 14px; box-shadow: 0 18px 56px rgba(0,0,0,.4); padding: 18px 20px; width: 420px; max-width: 92vw; }',
    '.pr-cfm-t { font-size: 15.5px; font-weight: 700; }',
    '.pr-cfm-b { font-size: 13.5px; color: var(--muted, #a3acbd); margin-top: 7px; line-height: 1.5; white-space: pre-wrap; }',
    '.pr-cfm-row { display: flex; justify-content: flex-end; gap: 9px; margin-top: 17px; }',
    '.pr-cfm-row button { border: 1px solid var(--line, #2c313b); background: var(--surface, #1b1e26); color: var(--ink, #e7e9ee); border-radius: 9px; padding: 8px 16px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }',
    '.pr-cfm-ok { background: var(--accent, #4f46e5) !important; border-color: var(--accent, #4f46e5) !important; color: #fff !important; }',
    '.pr-cfm-ok.danger { background: var(--danger, #dc2626) !important; border-color: var(--danger, #dc2626) !important; }'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'pr-theme-style'; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  // shared, themed toast + confirm — drop-in replacements for native alert()/confirm()
  function uiHost() { var h = document.getElementById('pr-ui'); if (!h) { h = document.createElement('div'); h.id = 'pr-ui'; (document.body || document.documentElement).appendChild(h); } return h; }
  function toast(msg, opts) {
    opts = opts || {};
    var t = document.createElement('div'); t.className = 'pr-toast' + (opts.kind ? ' ' + opts.kind : '');
    t.setAttribute('role', 'status');
    var s = document.createElement('span'); s.textContent = String(msg == null ? '' : msg); t.appendChild(s);
    var dismiss = function () { t.classList.remove('in'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220); };
    if (opts.action && opts.action.label) { var b = document.createElement('button'); b.className = 'pr-toast-act'; b.textContent = opts.action.label; b.onclick = function () { try { opts.action.onClick && opts.action.onClick(); } catch (e) { } dismiss(); }; t.appendChild(b); }
    var x = document.createElement('button'); x.className = 'pr-toast-x'; x.setAttribute('aria-label', 'Dismiss'); x.innerHTML = '&times;'; x.onclick = dismiss; t.appendChild(x);
    uiHost().appendChild(t); requestAnimationFrame(function () { t.classList.add('in'); });
    var dur = opts.duration || (opts.action ? 6500 : 3400); var tm = setTimeout(dismiss, dur);
    t.onmouseenter = function () { clearTimeout(tm); }; t.onmouseleave = function () { tm = setTimeout(dismiss, 1500); };
    return dismiss;
  }
  function confirmDlg(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var scrim = document.createElement('div'); scrim.className = 'pr-cfm-scrim';
      var card = document.createElement('div'); card.className = 'pr-cfm'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
      var t = document.createElement('div'); t.className = 'pr-cfm-t'; t.textContent = opts.title || 'Are you sure?'; card.appendChild(t);
      card.setAttribute('aria-label', opts.title || 'Confirm');
      if (opts.body) { var bd = document.createElement('div'); bd.className = 'pr-cfm-b'; bd.textContent = opts.body; card.appendChild(bd); }
      var row = document.createElement('div'); row.className = 'pr-cfm-row';
      var cancel = document.createElement('button'); cancel.className = 'pr-cfm-cancel'; cancel.textContent = opts.cancelLabel || 'Cancel';
      var ok = document.createElement('button'); ok.className = 'pr-cfm-ok' + (opts.danger ? ' danger' : ''); ok.textContent = opts.confirmLabel || 'OK';
      row.appendChild(cancel); row.appendChild(ok); card.appendChild(row); scrim.appendChild(card);
      (document.body || document.documentElement).appendChild(scrim);
      function close(v) { if (scrim.parentNode) scrim.parentNode.removeChild(scrim); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); }
      scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(false); });
      cancel.onclick = function () { close(false); }; ok.onclick = function () { close(true); };
      document.addEventListener('keydown', onKey); setTimeout(function () { try { ok.focus(); } catch (e) { } }, 30);
    });
  }
  window.PRUI = { toast: toast, confirm: confirmDlg };

  // 3. public API — used by the nav drawer's dark-mode switch
  function set(t) { apply(t); try { localStorage.setItem(KEY, t); } catch (e) { } window.dispatchEvent(new CustomEvent('pr-theme', { detail: { dark: isDark() } })); }
  window.PRTheme = { isDark: isDark, set: set, toggle: function () { set(isDark() ? 'light' : 'dark'); } };

  // ── Magnetic Ring cursor: a precise dot + a spring ring that snaps onto interactive targets ──
  (function () {
    if (window.PR_NO_CURSOR || !window.matchMedia || !matchMedia('(pointer: fine)').matches) return;   // mouse only; opt-out via window.PR_NO_CURSOR
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function start() {
      if (document.getElementById('pr-cur') || !document.body) return;
      var root = document.createElement('div'); root.id = 'pr-cur'; root.className = 'hide';
      var ring = document.createElement('div'); ring.className = 'pr-cur-ring';
      var dot = document.createElement('div'); dot.className = 'pr-cur-dot';
      root.appendChild(ring); root.appendChild(dot); document.body.appendChild(root);
      document.documentElement.classList.add('pr-cursor');
      var mx = window.innerWidth / 2, my = window.innerHeight / 2, rx = mx, ry = my, snap = null, txt = false;
      var HIT = 'a,button,[role="button"],.btn,.seg button,.chip,.tab,.ca,.pc-chip,.pf-pub-files,label,summary,[data-cursor],.cm-rp-item,.cm-li,.cm-saved-li,.pn-nav a';
      var TEXT = 'textarea,[contenteditable],.cm-tex,.cm-revtext,.ct-textlayer,pre,code,input:is([type=text],[type=search],[type=email],[type=url],[type=password],[type=number],[type=tel]),input:not([type])';
      var RESIZE = '.splitter,.ws-divider,.cm-split';   // show the native resize cursor on draggable dividers
      var PDFV = '.pdf-render-scroll,.pdf-paper,.ct-scroll,.pdf-view,.pdf-view-wrap';   // PDF surfaces: native cursor for scroll/zoom/pan
      function lerp(a, b, t) { return a + (b - a) * t; }
      function evalAt(el) {
        if (!el || !el.closest) return;
        var native = (!!el.closest(TEXT) && !el.closest('button,a,[role="button"],.btn')) || !!el.closest(RESIZE) || !!el.closest(PDFV);
        var hit = el.closest(HIT);
        txt = native;
        if (native) { root.classList.add('hide'); snap = null; } else { root.classList.remove('hide'); snap = hit || null; }
      }
      document.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; if (!txt) root.classList.remove('hide'); }, { passive: true });
      document.addEventListener('mouseover', function (e) { evalAt(e.target); }, { passive: true });
      // re-evaluate the snap target during scrolling: the mouse may not move (so mouseover won't fire), and the
      // snapped element scrolls away — re-pick whatever is actually under the cursor so the ring stays consistent.
      document.addEventListener('scroll', function () { evalAt(document.elementFromPoint(mx, my)); }, { passive: true, capture: true });
      document.addEventListener('mouseleave', function () { root.classList.add('hide'); });
      window.addEventListener('blur', function () { root.classList.add('hide'); });
      (function frame() {
        var tx = mx, ty = my;
        if (snap && snap.isConnected) { var r = snap.getBoundingClientRect(); tx = r.left + r.width / 2; ty = r.top + r.height / 2; } else snap = null;
        rx = lerp(rx, tx, reduce ? 1 : 0.22); ry = lerp(ry, ty, reduce ? 1 : 0.22);
        dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
        ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
        if (snap) {
          var rr = snap.getBoundingClientRect(), w = rr.width + 12, hh = rr.height + 12, br = parseFloat(getComputedStyle(snap).borderRadius) || 8;
          ring.style.width = w + 'px'; ring.style.height = hh + 'px'; ring.style.margin = (-hh / 2) + 'px 0 0 ' + (-w / 2) + 'px'; ring.style.borderRadius = Math.min(br + 6, 999) + 'px';
          ring.classList.add('snap');
        } else if (ring.classList.contains('snap')) {
          ring.style.width = ring.style.height = '34px'; ring.style.margin = '-17px 0 0 -17px'; ring.style.borderRadius = '50%'; ring.classList.remove('snap');
        }
        requestAnimationFrame(frame);
      })();
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  })();
})();
