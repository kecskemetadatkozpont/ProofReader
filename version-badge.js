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
    '.pr-ver-txt{white-space:nowrap;}'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  var chip = document.createElement('div'); chip.className = 'pr-ver';
  var dot = document.createElement('span'); dot.className = 'pr-ver-dot';
  var txt = document.createElement('span'); txt.className = 'pr-ver-txt';
  chip.appendChild(dot); chip.appendChild(txt);

  function plain() { chip.classList.remove('stale'); txt.textContent = 'v ' + (B.built || 'dev'); chip.title = 'Running build ' + B.build + ' (' + (B.built || 'dev') + ')'; }
  function ok() { plain(); chip.title = 'Latest version ✓ — build ' + B.build + ' (' + (B.built || 'dev') + ')'; }
  function stale(v) {
    chip.classList.add('stale'); txt.textContent = 'Új verzió elérhető — kattints a frissítéshez';
    chip.title = 'Deployed: ' + (v && v.built) + '\nYou are seeing (cached): ' + (B.built || 'dev') + '\nClick to hard-refresh.';
  }
  plain();
  chip.addEventListener('click', function () { if (chip.classList.contains('stale')) { try { location.reload(true); } catch (e) { location.reload(); } } });

  function mount() { if (document.body && !chip.parentNode) document.body.appendChild(chip); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function check() {
    fetch('version.json?cb=' + (new Date()).getTime(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v && typeof v.build === 'number' && B.build && v.build > B.build) stale(v); else ok(); })
      .catch(function () { });
  }
  check();
  setInterval(check, 300000); // re-check every 5 min so a long-open tab notices a new deploy
})();
