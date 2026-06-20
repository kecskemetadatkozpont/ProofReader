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
    '  --ink: #e7e9ee; --muted: #a3acbd; --faint: #7b8494; --dim: #8a92a0; --reading: #e7e9ee;',
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
    'html.dark .thumb, html.dark .pf-viewer-img { background: var(--surface-2) !important; }'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'pr-theme-style'; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  // 3. public API — used by the nav drawer's dark-mode switch
  function set(t) { apply(t); try { localStorage.setItem(KEY, t); } catch (e) { } window.dispatchEvent(new CustomEvent('pr-theme', { detail: { dark: isDark() } })); }
  window.PRTheme = { isDark: isDark, set: set, toggle: function () { set(isDark() ? 'light' : 'dark'); } };
})();
