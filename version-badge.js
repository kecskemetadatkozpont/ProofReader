/* Aloud build/version badge.
 *  - window.PR_BUILD (from build.js, baked into the cached app) = the build you are RUNNING.
 *  - version.json (fetched cache-busted) = the build currently DEPLOYED.
 * Shows a small corner chip with the running build; if the deployed build is newer (you are seeing a
 * stale cached copy) it turns into a prominent "new version — refresh" pill. Self-contained, no deps. */
(function () {
  'use strict';
  var B = window.PR_BUILD || { build: 0, built: 'dev' };

  var css = [
    '.pr-ver{position:fixed;left:10px;bottom:52px;z-index:55;display:inline-flex;align-items:center;gap:6px;',
    'padding:3px 9px;border-radius:20px;font:600 10.5px/1 "IBM Plex Sans",system-ui,sans-serif;',
    'background:rgba(40,44,52,.5);color:#e8eaed;border:1px solid rgba(255,255,255,.1);',
    'cursor:default;opacity:.38;transition:opacity .15s,background .15s;backdrop-filter:blur(3px);user-select:none;}',
    '.pr-ver:hover{opacity:1;}',
    '.pr-ver-dot{width:7px;height:7px;border-radius:50%;background:#3fb27f;flex:none;}',
    '.pr-ver.stale{opacity:1;cursor:pointer;background:#b4530f;border-color:#e0801e;color:#fff;padding:6px 12px;box-shadow:0 4px 16px rgba(0,0,0,.3);}',
    '.pr-ver.stale .pr-ver-dot{background:#ffd27a;animation:prVerPulse 1.1s ease-in-out infinite;}',
    '@keyframes prVerPulse{0%,100%{opacity:1;}50%{opacity:.35;}}',
    '.pr-ver-txt{white-space:nowrap;}',
    /* when hosted next to the logo (in #pr-ver-slot) flow inline instead of fixed.
       Colours track the page theme via --ink (the chip lives inside the themed .app
       subtree in the editor and under :root on the dashboard), so it stays readable
       on both the white topbar and the dark "night" topbar. */
    '.pr-ver-slot{display:block;margin-top:3px;}',
    '.pr-ver-slot .pr-ver{position:static;left:auto;bottom:auto;padding:2px 8px;font-size:9.5px;font-weight:700;letter-spacing:.01em;opacity:1;',
    'color:color-mix(in srgb, var(--ink, #1d2430) 82%, transparent);',
    'background:color-mix(in srgb, var(--ink, #1d2430) 7%, transparent);',
    'border:1px solid color-mix(in srgb, var(--ink, #1d2430) 18%, transparent);}',
    '.pr-ver-slot .pr-ver:hover{color:var(--ink, #1d2430);background:color-mix(in srgb, var(--ink, #1d2430) 12%, transparent);}',
    '.pr-ver-slot .pr-ver-dot{box-shadow:0 0 0 2px color-mix(in srgb, #3fb27f 22%, transparent);}',
    '.pr-ver-slot .pr-ver.stale{opacity:1;padding:3px 10px;color:#fff;background:#b4530f;border-color:#e0801e;}'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  var chip = document.createElement('div'); chip.className = 'pr-ver';
  var dot = document.createElement('span'); dot.className = 'pr-ver-dot';
  var txt = document.createElement('span'); txt.className = 'pr-ver-txt';
  chip.appendChild(dot); chip.appendChild(txt);

  function plain() { chip.classList.remove('stale'); txt.textContent = 'v ' + (B.built || 'dev'); chip.title = 'Running build ' + B.build + ' (' + (B.built || 'dev') + ')'; }
  function ok() { plain(); chip.title = 'Latest version ✓ — build ' + B.build + ' (' + (B.built || 'dev') + ')'; }
  function stale(v) {
    chip.classList.add('stale'); txt.textContent = 'New version available — click to refresh';
    chip.title = 'Deployed: ' + (v && v.built) + '\nYou are seeing (cached): ' + (B.built || 'dev') + '\nClick to hard-refresh.';
  }
  plain();
  chip.addEventListener('click', function () { if (chip.classList.contains('stale')) { try { location.reload(true); } catch (e) { location.reload(); } } });

  // prefer a slot next to the top-left logo (#pr-ver-slot, rendered by React); retry briefly, then fall back to fixed
  function mount(tries) {
    tries = tries || 0;
    if (chip.parentNode) return;
    var slot = document.getElementById('pr-ver-slot');
    if (slot) { slot.appendChild(chip); return; }
    if (tries >= 20) { if (document.body) document.body.appendChild(chip); return; } // give up → fixed fallback
    setTimeout(function () { mount(tries + 1); }, 200);
  }
  mount();

  function check() {
    fetch('version.json?cb=' + (new Date()).getTime(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v && typeof v.build === 'number' && B.build && v.build > B.build) stale(v); else ok(); })
      .catch(function () { });
  }
  check();
  setInterval(check, 300000); // re-check every 5 min so a long-open tab notices a new deploy
})();
