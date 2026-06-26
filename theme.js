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

  // 2. inject the dark palette: re-point every shared variable to a dark value
  var css = [
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
    '@media (pointer: coarse) { button, [role="button"], a.btn, summary, .seg > button { min-height: 38px; } input[type="checkbox"], input[type="radio"] { min-width: 20px; min-height: 20px; } }'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'pr-theme-style'; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  // 3. public API — used by the nav drawer's dark-mode switch
  function set(t) { apply(t); try { localStorage.setItem(KEY, t); } catch (e) { } window.dispatchEvent(new CustomEvent('pr-theme', { detail: { dark: isDark() } })); }
  window.PRTheme = { isDark: isDark, set: set, toggle: function () { set(isDark() ? 'light' : 'dark'); } };
})();
