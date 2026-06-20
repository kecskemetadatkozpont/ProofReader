/* Publify — site-wide dark mode. Load EARLY in <head> on every page so the saved theme is applied
 * before paint (no flash). A tuned `invert + hue-rotate(180)` flips lightness while preserving hues,
 * so the whole site goes dark without re-theming each page's colors; media is re-inverted so images,
 * avatars, PDFs and the logo stay normal. A floating toggle (bottom-left) persists the choice. */
(function () {
  'use strict';
  var KEY = 'pr-theme';
  function isDark() { return document.documentElement.classList.contains('dark'); }
  function apply(t) { document.documentElement.classList.toggle('dark', t === 'dark'); }

  // 1. apply the saved theme immediately (runs in <head>, before the body paints)
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { }
  apply(saved);

  // 2. inject the dark stylesheet
  var css = [
    'html.dark { color-scheme: dark; }',
    'html.dark body { background-color: #0e0f13; filter: invert(1) hue-rotate(180deg); }',
    // re-invert media + colourful chrome so they look normal under the global invert
    'html.dark img, html.dark video, html.dark canvas, html.dark iframe, html.dark embed, html.dark object,',
    'html.dark .av, html.dark .mk, html.dark .pf-avatar, html.dark .avatar,',
    'html.dark [style*="background-image"], html.dark [style*="url("] { filter: invert(1) hue-rotate(180deg); }',
    // the toggle lives in <body>; re-invert it so its own colours read correctly
    'html.dark #pr-theme-toggle { filter: invert(1) hue-rotate(180deg); }',
    '#pr-theme-toggle { position: fixed; left: 14px; bottom: 14px; z-index: 2147483646; width: 40px; height: 40px;',
    '  border-radius: 50%; border: 1px solid rgba(120,120,135,.35); background: rgba(127,127,140,.12);',
    '  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); cursor: pointer; font-size: 17px;',
    '  display: grid; place-items: center; line-height: 1; padding: 0; box-shadow: 0 4px 14px rgba(0,0,0,.18); }',
    '#pr-theme-toggle:hover { border-color: #6366f1; }'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'pr-theme-style'; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  // 3. floating toggle
  function addToggle() {
    if (document.getElementById('pr-theme-toggle') || !document.body) return;
    var b = document.createElement('button'); b.id = 'pr-theme-toggle'; b.type = 'button'; b.setAttribute('aria-label', 'Toggle dark mode');
    function sync() { b.textContent = isDark() ? '☀️' : '🌙'; b.title = isDark() ? 'Switch to light mode' : 'Switch to dark mode'; }
    sync();
    b.addEventListener('click', function () { var d = !isDark(); apply(d ? 'dark' : 'light'); try { localStorage.setItem(KEY, d ? 'dark' : 'light'); } catch (e) { } sync(); });
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle); else addToggle();
})();
