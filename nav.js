/* Publify — shared global navigation. A persistent top bar on every app page; clicking the profile
 * (top-right) opens a right-sliding drawer with cross-page links (Open Profile, Research, Doctoral
 * School, Publications, Admin), the dark-mode switch, and Sign out. Profile is the home base.
 * Pure vanilla + CSS variables, so it themes with the rest of the site. Opt out with window.PR_NO_NAV. */
(function () {
  'use strict';
  if (window.PR_NO_NAV || window.__pubnav) return;
  window.__pubnav = true;
  var BAR = 52;

  // cross-page menu — Profile is home, Publications is the renamed Projects page
  var LINKS = [
    { key: 'profile', label: 'Open Profile', href: 'Profile.html' },
    { key: 'research', label: 'Research', href: 'Research.html' },
    { key: 'session', label: 'Publify Chat', href: 'Session.html' },
    { key: 'media', label: 'Médialejátszó', href: 'Media.html' },
    { key: 'compare', label: 'Verzió-összehasonlítás', href: 'Compare.html' },
    { key: 'phd', label: 'Doctoral School', href: 'PhD.html' },
    { key: 'publications', label: 'Publications', href: 'Projects.html' },
    { key: 'admin', label: 'Admin', href: 'Admin.html', adminOnly: true }
  ];
  function pageKey() {
    var p = (location.pathname.split('/').pop() || '').toLowerCase();
    if (p.indexOf('profile') === 0) return 'profile';
    if (p.indexOf('research') === 0) return 'research';
    if (p.indexOf('session') === 0) return 'session';
    if (p.indexOf('phd') === 0) return 'phd';
    if (p.indexOf('projects') === 0) return 'publications';
    if (p.indexOf('admin') === 0) return 'admin';
    if (p.indexOf('proofreader') === 0) return 'editor';
    return '';
  }
  var PAGE_NAME = { profile: 'Profile', research: 'Research', session: 'Publify Chat', phd: 'Doctoral School', publications: 'Publications', admin: 'Admin', editor: 'Editor' };
  function initials(name, email) {
    var s = (name || email || '?').trim();
    var parts = s.split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  // the live session is authoritative: PR_BACKEND.user (cloud/demo pages) or window.PRNavUser (pages
  // without backend.js, e.g. Admin). PRAuth.current() is only a last resort — it can hold a stale demo
  // identity (the Admin list's "open profile" calls PRAuth.signIn), which must NOT drive the bar.
  function curUser() {
    var BE = window.PR_BACKEND;
    if (BE && BE.user) return BE.user;
    if (window.PRNavUser) return window.PRNavUser;
    // the Admin page publishes its own user (PRNavUser) once authenticated — until then show nothing
    // rather than a stale PRAuth identity, so the bar never flashes the wrong person.
    if (pageKey() === 'admin') return null;
    try { if (window.PRAuth && PRAuth.current()) return PRAuth.current(); } catch (e) { }
    return null;
  }
  // admin role, robust to the async profile load: prefer the live role, fall back to the cached
  // profile (written on a previous session — present whenever the admin came from the Admin page).
  function isAdmin() {
    var BE = window.PR_BACKEND, u = (BE && BE.user) || window.PRNavUser; if (!u) return false;
    if (u.role) return u.role === 'admin';
    var p = BE && BE.profiles && BE.profiles[u.id];
    return !!(p && p.role === 'admin');
  }
  // admin "view as": opened from Admin with ?adminView=1 + a stored target. Gated to admins — a
  // non-admin who forges the localStorage gets nothing (and RLS blocks the data regardless).
  function adminView() {
    try {
      if (!/[?&]adminView=1/.test(location.search)) return null;
      if (!isAdmin()) return null;
      var t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
      return t && t.id ? t : null;
    } catch (e) { return null; }
  }
  function viewUser() { return adminView() || curUser(); }
  function withAv(href) { var av = adminView(); if (!av || href === 'Admin.html') return href; return href + (href.indexOf('?') < 0 ? '?' : '&') + 'adminView=1'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var CSS = [
    'html { --pubnav-h: ' + BAR + 'px; }',
    'body { padding-top: ' + BAR + 'px !important; }',
    // keep sticky page sidebars below the bar
    '.side { top: ' + BAR + 'px !important; height: calc(100vh - ' + BAR + 'px) !important; }',
    '#pubnav { position: fixed; top: 0; left: 0; right: 0; height: ' + BAR + 'px; z-index: 1200;',
    '  display: flex; align-items: center; justify-content: space-between; padding: 0 16px;',
    '  background: var(--surface, #fff); border-bottom: 1px solid var(--line, #e6e8ee);',
    '  font-family: "IBM Plex Sans", system-ui, sans-serif; box-sizing: border-box; }',
    '#pubnav .pn-left { display: flex; align-items: center; gap: 12px; min-width: 0; }',
    '#pubnav .pn-page { font-size: 13px; font-weight: 600; color: var(--muted, #5b6473); padding-left: 12px; border-left: 1px solid var(--line, #e6e8ee); white-space: nowrap; }',
    '#pubnav .pn-as { font-size: 12px; font-weight: 700; color: var(--warn, #b45309); background: var(--warn-bg, #fdf6e3); border: 1px solid var(--warn, #b45309); border-radius: 999px; padding: 3px 10px; white-space: nowrap; }',
    '#pubnav .pn-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink, #1a2030); font-weight: 700; font-size: 15px; letter-spacing: -.2px; }',
    '#pubnav .pn-mk { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: linear-gradient(135deg, #6366f1, #d946ef); box-shadow: 0 3px 10px rgba(79,70,229,.34); }',
    '#pubnav .pn-mk i { width: 10px; height: 10px; border-top: 2.2px solid #fff; border-left: 2.2px solid #fff; border-radius: 2px 0 0 0; transform: rotate(45deg); margin-top: 2px; }',
    '#pubnav .pn-brand i.sub { font-style: normal; font-weight: 500; font-size: 11px; color: var(--faint, #8a92a0); margin-left: -4px; }',
    '#pubnav .pn-prof { display: flex; align-items: center; gap: 9px; border: 1px solid var(--line, #e6e8ee); background: var(--surface-2, #f5f6f9); border-radius: 999px; padding: 4px 12px 4px 4px; cursor: pointer; font-family: inherit; color: var(--ink, #1a2030); }',
    '#pubnav .pn-prof:hover { border-color: var(--accent, #4f46e5); }',
    '.pn-av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 12px; font-weight: 700; background-size: cover; background-position: center; flex: none; }',
    '#pubnav .pn-nm { font-size: 13px; font-weight: 600; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '#pubnav .pn-cv { color: var(--faint, #8a92a0); font-size: 10px; }',
    '#pn-scrim { position: fixed; inset: 0; background: rgba(8,10,16,.5); z-index: 1300; opacity: 0; pointer-events: none; transition: opacity .18s; }',
    '#pn-scrim.on { opacity: 1; pointer-events: auto; }',
    '#pn-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 320px; max-width: 86vw; z-index: 1400;',
    '  background: var(--surface, #fff); border-left: 1px solid var(--line, #e6e8ee); box-shadow: -16px 0 50px rgba(0,0,0,.22);',
    '  transform: translateX(100%); transition: transform .22s cubic-bezier(.4,0,.2,1); display: flex; flex-direction: column;',
    '  font-family: "IBM Plex Sans", system-ui, sans-serif; box-sizing: border-box; }',
    '#pn-drawer.on { transform: translateX(0); }',
    '.pnd-head { display: flex; align-items: center; gap: 12px; padding: 18px 18px 16px; border-bottom: 1px solid var(--line, #e6e8ee); }',
    '.pnd-head .pn-av { width: 42px; height: 42px; font-size: 15px; }',
    '.pnd-head b { font-size: 14.5px; color: var(--ink, #1a2030); display: block; }',
    '.pnd-head span { font-size: 12px; color: var(--muted, #5b6473); display: block; overflow: hidden; text-overflow: ellipsis; }',
    '.pnd-x { margin-left: auto; border: 0; background: transparent; font-size: 20px; color: var(--muted, #5b6473); cursor: pointer; line-height: 1; }',
    '.pnd-nav { padding: 10px; flex: 1; overflow: auto; }',
    '.pnd-nav a { display: flex; align-items: center; gap: 11px; padding: 11px 12px; border-radius: 10px; text-decoration: none; color: var(--ink, #1a2030); font-size: 14px; font-weight: 600; }',
    '.pnd-nav a:hover { background: var(--surface-2, #f5f6f9); }',
    '.pnd-nav a.on { background: var(--accent-tint, #eef0ff); color: var(--accent, #4f46e5); }',
    '.pnd-nav a svg { width: 17px; height: 17px; flex: none; }',
    '.pnd-foot { border-top: 1px solid var(--line, #e6e8ee); padding: 12px; }',
    '.pnd-theme { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; font-size: 14px; font-weight: 600; color: var(--ink, #1a2030); }',
    '.pnd-sw { position: relative; width: 46px; height: 26px; border-radius: 999px; border: 0; cursor: pointer; background: var(--line, #cfd4e6); transition: background .15s; flex: none; }',
    '.pnd-sw.on { background: var(--accent, #4f46e5); }',
    '.pnd-sw i { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }',
    '.pnd-sw.on i { transform: translateX(20px); }',
    '.pnd-signout { width: 100%; margin-top: 4px; padding: 10px; border: 1px solid var(--line, #e6e8ee); background: transparent; border-radius: 10px; color: var(--muted, #5b6473); font-family: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }',
    '.pnd-signout:hover { color: var(--danger, #b42318); border-color: var(--danger, #b42318); }',
    '.pnd-asbar { margin: 0 12px; padding: 9px 12px; border-radius: 10px; background: var(--warn-bg, #fdf6e3); color: var(--warn, #b45309); font-size: 12px; font-weight: 600; line-height: 1.4; }',
    '.pnd-backadmin { display: block; width: 100%; padding: 10px; box-sizing: border-box; text-align: center; border: 1px solid var(--accent, #4f46e5); border-radius: 10px; color: var(--accent, #4f46e5); text-decoration: none; font-size: 13.5px; font-weight: 700; }',
    '.pnd-backadmin:hover { background: var(--accent-tint, #eef0ff); }',
    // --- consolidation: the global bar owns branding + profile, so hide each page\'s duplicate chrome ---
    '.side-brand { display: none !important; }',                                          // Research / Doctoral School sidebar brand
    'html.pn-research .side .nav, html.pn-phd .side .nav { padding-top: 12px; }',
    'html.pn-publications .topbar > .brand, html.pn-publications .topbar .acct { display: none !important; }',
    'html.pn-publications .topbar { justify-content: flex-end !important; }',
    'html.pn-admin .topbar > .brand { display: none !important; }',
    // editor: keep the back button + document title, drop the redundant logo, tagline and account mini
    'html.pn-editor .topbar .brand .brand-mark, html.pn-editor .topbar .brand .brand-text i, html.pn-editor .acct-mini { display: none !important; }',
    // the editor is a full-height flex column (.app: 100vh) — subtract the bar so its bottom transport
    // (the read-aloud controls) stays on screen instead of being pushed below the fold
    'html.pn-editor .app { height: calc(100vh - var(--pubnav-h, 52px)) !important; }'
  ].join('\n');

  function svg(d) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  var ICONS = {
    profile: svg('<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13c.6-2.4 2.5-3.6 5-3.6S12.4 10.6 13 13"/>'),
    session: svg('<path d="M14 8c0 2.5-2.7 4.5-6 4.5-.9 0-1.7-.1-2.5-.4L2 13l.9-2.6C2.3 9.7 2 8.9 2 8c0-2.5 2.7-4.5 6-4.5S14 5.5 14 8z"/>'),
    media: svg('<path d="M3 9V8.2a5 5 0 0 1 10 0V9"/><rect x="2.2" y="9" width="2.9" height="4.2" rx="1.1"/><rect x="10.9" y="9" width="2.9" height="4.2" rx="1.1"/>'),
    compare: svg('<rect x="2" y="2.8" width="4.8" height="10.4" rx="1"/><rect x="9.2" y="2.8" width="4.8" height="10.4" rx="1"/><path d="M8 1.5v13"/>'),
    research: svg('<path d="M6 2v4.5L3 12.5A1 1 0 0 0 4 14h8a1 1 0 0 0 .9-1.5L10 6.5V2"/><path d="M5 2h6"/>'),
    phd: svg('<path d="M8 2L1.5 5.5 8 9l6.5-3.5z"/><path d="M4 7v3.2c0 .9 1.8 1.8 4 1.8s4-.9 4-1.8V7"/>'),
    publications: svg('<path d="M3 2.5h7l3 3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M5 7h6M5 9.5h6"/>'),
    admin: svg('<path d="M8 1.8l5 1.9v3.6c0 3-2.1 5.2-5 6.1-2.9-.9-5-3.1-5-6.1V3.7z"/><path d="M5.8 8l1.6 1.6L10.4 6.5"/>')
  };

  function build() {
    if (document.getElementById('pubnav') || !document.body) return;
    var here = pageKey();

    if (here) document.documentElement.classList.add('pn-' + here);
    var bar = document.createElement('header'); bar.id = 'pubnav';
    bar.innerHTML = '<div class="pn-left" id="pn-left"></div><button class="pn-prof" id="pn-prof" aria-label="Open menu"></button>';

    var scrim = document.createElement('div'); scrim.id = 'pn-scrim';
    var drawer = document.createElement('aside'); drawer.id = 'pn-drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Navigation');

    function avHtml(user) {
      var col = (user && user.color) || '#4f46e5';
      var img = user && (user.avatar || user.avatar_url);
      var st = img ? 'background-image:url(' + img + ')' : 'background:' + col;
      return '<span class="pn-av" style="' + st + '">' + (img ? '' : initials(user && user.name, user && user.email)) + '</span>';
    }
    function render() {
      var av = adminView();
      var du = av || curUser(), admin = isAdmin();
      document.documentElement.classList.toggle('pn-adminview', !!av);
      document.getElementById('pn-left').innerHTML = '<a class="pn-brand" href="' + withAv('Projects.html') + '" title="Főoldal"><span class="pn-mk"><i></i></span>Publify</a>'
        + (PAGE_NAME[here] ? '<span class="pn-page">' + PAGE_NAME[here] + '</span>' : '')
        + (av ? '<span class="pn-as">👁 ' + esc(av.name || av.email || '') + '</span>' : '');
      document.getElementById('pn-prof').innerHTML = avHtml(du) + '<span class="pn-nm">' + esc((du && du.name) || 'Menu') + '</span><span class="pn-cv">' + (av ? '👁' : '▾') + '</span>';
      var links = LINKS.filter(function (l) { return !l.adminOnly || admin; }).map(function (l) {
        return '<a href="' + withAv(l.href) + '"' + (l.key === here ? ' class="on"' : '') + '>' + (ICONS[l.key] || '') + esc(l.label) + '</a>';
      }).join('');
      var dark = window.PRTheme ? window.PRTheme.isDark() : document.documentElement.classList.contains('dark');
      drawer.innerHTML = '<div class="pnd-head">' + avHtml(du)
        + '<div style="min-width:0"><b>' + esc((du && du.name) || 'Not signed in') + '</b><span>' + esc((du && du.email) || '') + '</span></div>'
        + '<button class="pnd-x" id="pn-close" aria-label="Close">×</button></div>'
        + (av ? '<div class="pnd-asbar">👁 Admin view — browsing this researcher’s workspace read-only</div>' : '')
        + '<nav class="pnd-nav">' + links + '</nav>'
        + '<div class="pnd-foot"><div class="pnd-theme">Dark mode<button class="pnd-sw' + (dark ? ' on' : '') + '" id="pn-theme" role="switch" aria-checked="' + dark + '"><i></i></button></div>'
        + (av ? '<a class="pnd-backadmin" href="Admin.html">← Back to admin</a>' : '<button class="pnd-signout" id="pn-signout">Sign out</button>') + '</div>';
      wire();
    }
    function open() { scrim.classList.add('on'); drawer.classList.add('on'); }
    function close() { scrim.classList.remove('on'); drawer.classList.remove('on'); }
    function wire() {
      var t = document.getElementById('pn-theme');
      if (t) t.onclick = function () { if (window.PRTheme) window.PRTheme.toggle(); render(); };
      var c = document.getElementById('pn-close'); if (c) c.onclick = close;
      var so = document.getElementById('pn-signout');
      if (so) so.onclick = function () {
        try { if (window.PR_BACKEND && window.PR_BACKEND.signOut) { window.PR_BACKEND.signOut(); } else if (window.PRAuth) { PRAuth.signOut(); } } catch (e) { }
        location.replace('Landing.html');
      };
    }

    document.body.appendChild(bar); document.body.appendChild(scrim); document.body.appendChild(drawer);
    render();
    document.getElementById('pn-prof').onclick = open;
    scrim.onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('pr-theme', render);
    window.addEventListener('pr-profile', render);
    // user/admin may resolve after auth loads — refresh a few times
    var tries = 0; var iv = setInterval(function () { tries++; render(); if (tries > 12 || (curUser() && curUser().name)) clearInterval(iv); }, 700);
    buildBugWidget();
  }

  // #13 — in-app bug / feature reports: floating button + modal with a category, a (client-resized)
  // screenshot, and a "my reports" list showing status + the admin's reply. Isolated from the nav DOM.
  function buildBugWidget() {
    if (document.getElementById('pn-bug-btn')) return;
    var category = 'bug', imageData = null;
    var btn = document.createElement('button');
    btn.id = 'pn-bug-btn'; btn.title = 'Hibajelentés / visszajelzés'; btn.textContent = '🐞';
    btn.setAttribute('style', 'position:fixed;right:16px;bottom:16px;z-index:90;width:42px;height:42px;border-radius:50%;border:1px solid var(--line,#e4e7ec);background:var(--pane,#fff);box-shadow:0 4px 14px rgba(20,24,40,.18);font-size:18px;cursor:pointer;line-height:1;padding:0');
    var modal = document.createElement('div');
    modal.id = 'pn-bug-modal';
    modal.setAttribute('style', 'position:fixed;inset:0;z-index:95;background:rgba(15,20,40,.4);display:none;align-items:center;justify-content:center');
    var card = document.createElement('div');
    card.setAttribute('style', 'background:var(--pane,#fff);color:var(--ink,#111);width:min(480px,94vw);max-height:90vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(15,20,40,.35);padding:16px 18px');
    var iSt = 'width:100%;box-sizing:border-box;border:1px solid var(--line,#e4e7ec);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--app-bg,#fff);color:inherit';
    var catSt = 'flex:1;border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;border-radius:8px;padding:7px 8px;font-size:12.5px;cursor:pointer';
    card.innerHTML = '<div style="font-weight:700;font-size:15px;margin-bottom:8px">🐞 Visszajelzés</div>'
      + '<div id="pn-bug-cats" style="display:flex;gap:6px;margin-bottom:10px"><button data-cat="bug" style="' + catSt + '">🐞 Hiba</button><button data-cat="feature" style="' + catSt + '">💡 Feature request</button></div>'
      + '<input id="pn-bug-title" placeholder="Rövid cím (opcionális)" style="' + iSt + ';margin-bottom:8px">'
      + '<textarea id="pn-bug-body" rows="5" placeholder="Mit tapasztaltál? (az oldal és a verzió automatikusan rögzül)" style="' + iSt + ';font-family:inherit;resize:vertical"></textarea>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><button id="pn-bug-img-btn" style="border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer">📎 Kép csatolása</button><span id="pn-bug-img-name" style="font-size:12px;color:var(--muted,#667)"></span><input id="pn-bug-img" type="file" accept="image/*" style="display:none"></div>'
      + '<div id="pn-bug-img-prev" style="margin-top:8px"></div>'
      + '<div id="pn-bug-msg" style="font-size:12px;margin-top:6px;min-height:16px"></div>'
      + '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:8px"><button id="pn-bug-mine" style="border:0;background:transparent;color:var(--accent,#4f46e5);font-size:12.5px;cursor:pointer;padding:6px 0">Korábbi jelentéseim ▾</button><div style="display:flex;gap:8px"><button id="pn-bug-cancel" style="border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer">Mégse</button><button id="pn-bug-send" style="border:0;background:var(--accent,#4f46e5);color:#fff;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer">Küldés</button></div></div>'
      + '<div id="pn-bug-list" style="display:none;margin-top:10px;max-height:260px;overflow:auto;border-top:1px solid var(--line,#e4e7ec);padding-top:8px"></div>';
    modal.appendChild(card);
    document.body.appendChild(btn); document.body.appendChild(modal);

    function setCat(c) {
      category = c;
      [].forEach.call(document.querySelectorAll('#pn-bug-cats button'), function (b) {
        var on = b.getAttribute('data-cat') === c;
        b.style.background = on ? 'var(--accent,#4f46e5)' : 'var(--app-bg,#f7f8fa)';
        b.style.color = on ? '#fff' : 'inherit';
        b.style.borderColor = on ? 'var(--accent,#4f46e5)' : 'var(--line,#e4e7ec)';
      });
    }
    [].forEach.call(document.querySelectorAll('#pn-bug-cats button'), function (b) { b.onclick = function () { setCat(b.getAttribute('data-cat')); }; });
    setCat('bug');

    function show() { var m = document.getElementById('pn-bug-msg'); if (m) m.textContent = '';   /* clear a stale "elküldve" message from a previous submit */ modal.style.display = 'flex'; var t = document.getElementById('pn-bug-body'); if (t) t.focus(); }
    function hide() { modal.style.display = 'none'; }
    btn.onclick = show;
    modal.onclick = function (e) { if (e.target === modal) hide(); };
    document.getElementById('pn-bug-cancel').onclick = hide;

    // screenshot → resize client-side to a small JPEG data URL (no separate storage bucket needed)
    var imgInput = document.getElementById('pn-bug-img');
    document.getElementById('pn-bug-img-btn').onclick = function () { imgInput.click(); };
    imgInput.onchange = function () {
      var f = imgInput.files && imgInput.files[0]; if (!f) return;
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var maxDim = 1280, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
        var c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        try { imageData = c.toDataURL('image/jpeg', 0.82); } catch (e) { imageData = null; }
        document.getElementById('pn-bug-img-name').textContent = f.name;
        document.getElementById('pn-bug-img-prev').innerHTML = imageData ? '<img src="' + imageData + '" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--line,#e4e7ec)">' : '';
      };
      img.onerror = function () { URL.revokeObjectURL(url); };
      img.src = url;
    };

    // "my reports": the reporter's own reports with status + the admin's reply
    var listEl = document.getElementById('pn-bug-list');
    document.getElementById('pn-bug-mine').onclick = function () {
      if (listEl.style.display === 'block') { listEl.style.display = 'none'; return; }
      listEl.style.display = 'block'; listEl.innerHTML = '<div style="font-size:12px;color:var(--muted,#667)">Betöltés…</div>';
      var BE = window.PR_BACKEND, u = curUser();
      if (!(BE && BE.sb && u)) { listEl.innerHTML = '<div style="font-size:12px;color:var(--muted,#667)">Bejelentkezés szükséges.</div>'; return; }
      BE.sb.from('bug_reports').select('id,category,title,body,status,reply,created_at').eq('reporter_id', u.id).order('created_at', { ascending: false }).then(function (r) {
        if (r && r.error) { listEl.innerHTML = '<div style="font-size:12px;color:var(--danger,#b42318)">' + esc(r.error.message) + '</div>'; return; }
        var rows = (r && r.data) || [];
        if (!rows.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--muted,#667)">Még nincs jelentésed.</div>'; return; }
        listEl.innerHTML = rows.map(function (b) {
          var stColor = b.status === 'fixed' ? '#0f766e' : (b.status === 'wontfix' ? '#b42318' : 'var(--muted,#667)');
          return '<div style="border:1px solid var(--line,#e4e7ec);border-radius:8px;padding:8px 10px;margin-bottom:6px">'
            + '<div style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted,#667)"><span>' + (b.category === 'feature' ? '💡 Feature' : '🐞 Bug') + '</span><span style="margin-left:auto;font-weight:700;color:' + stColor + '">' + esc(b.status || 'open') + '</span></div>'
            + (b.title ? '<div style="font-weight:600;font-size:12.5px;margin-top:2px">' + esc(b.title) + '</div>' : '')
            + '<div style="font-size:12px;margin-top:2px;white-space:pre-wrap">' + esc((b.body || '').slice(0, 240)) + '</div>'
            + (b.reply ? '<div style="font-size:12px;margin-top:6px;padding:6px 8px;background:var(--app-bg,#f7f8fa);border-radius:6px"><b>Válasz:</b> ' + esc(b.reply) + '</div>' : '')
            + '</div>';
        }).join('');
      });
    };

    document.getElementById('pn-bug-send').onclick = function () {
      var msg = document.getElementById('pn-bug-msg');
      var body = (document.getElementById('pn-bug-body').value || '').trim();
      var title = (document.getElementById('pn-bug-title').value || '').trim();
      if (!body) { msg.style.color = 'var(--danger,#b42318)'; msg.textContent = 'Írd le röviden.'; return; }
      var BE = window.PR_BACKEND, u = curUser();
      if (!(BE && BE.sb && u)) { msg.style.color = 'var(--danger,#b42318)'; msg.textContent = 'Bejelentkezés szükséges a küldéshez.'; return; }
      var ver = ''; try { ver = (document.getElementById('pr-ver-slot') && document.getElementById('pr-ver-slot').textContent) || ''; } catch (e) { }
      msg.style.color = 'var(--muted,#667)'; msg.textContent = 'Küldés…';
      BE.sb.from('bug_reports').insert({ reporter_id: u.id, category: category, title: title || null, body: body, image_data: imageData || null, page: location.pathname, app_version: String(ver || '').slice(0, 60) }).then(function (r) {
        if (r && r.error) { msg.style.color = 'var(--danger,#b42318)'; msg.textContent = 'Hiba: ' + r.error.message; return; }
        msg.style.color = 'var(--accent,#4f46e5)'; msg.textContent = '✓ Köszönjük! Elküldve.';
        document.getElementById('pn-bug-body').value = ''; document.getElementById('pn-bug-title').value = '';
        imageData = null; document.getElementById('pn-bug-img-name').textContent = ''; document.getElementById('pn-bug-img-prev').innerHTML = '';
        setTimeout(hide, 1100);
      });
    };
  }

  var st = document.createElement('style'); st.id = 'pn-style'; st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
