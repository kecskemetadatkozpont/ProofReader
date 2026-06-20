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
    { key: 'phd', label: 'Doctoral School', href: 'PhD.html' },
    { key: 'publications', label: 'Publications', href: 'Projects.html' },
    { key: 'admin', label: 'Admin', href: 'Admin.html', adminOnly: true }
  ];
  function pageKey() {
    var p = (location.pathname.split('/').pop() || '').toLowerCase();
    if (p.indexOf('profile') === 0) return 'profile';
    if (p.indexOf('research') === 0) return 'research';
    if (p.indexOf('phd') === 0) return 'phd';
    if (p.indexOf('projects') === 0) return 'publications';
    if (p.indexOf('admin') === 0) return 'admin';
    if (p.indexOf('proofreader') === 0) return 'editor';
    return '';
  }
  var PAGE_NAME = { profile: 'Profile', research: 'Research', phd: 'Doctoral School', publications: 'Publications', admin: 'Admin', editor: 'Editor' };
  function initials(name, email) {
    var s = (name || email || '?').trim();
    var parts = s.split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function curUser() {
    try { if (window.PRAuth && PRAuth.current()) return PRAuth.current(); } catch (e) { }
    return (window.PR_BACKEND && window.PR_BACKEND.user) || null;
  }
  function isAdmin() { return !!(window.PR_BACKEND && window.PR_BACKEND.user && window.PR_BACKEND.user.role === 'admin'); }

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
    // --- consolidation: the global bar owns branding + profile, so hide each page\'s duplicate chrome ---
    '.side-brand { display: none !important; }',                                          // Research / Doctoral School sidebar brand
    'html.pn-research .side .nav, html.pn-phd .side .nav { padding-top: 12px; }',
    'html.pn-publications .topbar > .brand, html.pn-publications .topbar .acct { display: none !important; }',
    'html.pn-publications .topbar { justify-content: flex-end !important; }',
    'html.pn-admin .topbar > .brand { display: none !important; }',
    // editor: keep the back button + document title, drop the redundant logo, tagline and account mini
    'html.pn-editor .topbar .brand .brand-mark, html.pn-editor .topbar .brand .brand-text i, html.pn-editor .acct-mini { display: none !important; }'
  ].join('\n');

  function svg(d) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  var ICONS = {
    profile: svg('<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13c.6-2.4 2.5-3.6 5-3.6S12.4 10.6 13 13"/>'),
    research: svg('<path d="M6 2v4.5L3 12.5A1 1 0 0 0 4 14h8a1 1 0 0 0 .9-1.5L10 6.5V2"/><path d="M5 2h6"/>'),
    phd: svg('<path d="M8 2L1.5 5.5 8 9l6.5-3.5z"/><path d="M4 7v3.2c0 .9 1.8 1.8 4 1.8s4-.9 4-1.8V7"/>'),
    publications: svg('<path d="M3 2.5h7l3 3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M5 7h6M5 9.5h6"/>'),
    admin: svg('<path d="M8 1.8l5 1.9v3.6c0 3-2.1 5.2-5 6.1-2.9-.9-5-3.1-5-6.1V3.7z"/><path d="M5.8 8l1.6 1.6L10.4 6.5"/>')
  };

  function build() {
    if (document.getElementById('pubnav') || !document.body) return;
    var u = curUser(), here = pageKey(), admin = isAdmin();

    if (here) document.documentElement.classList.add('pn-' + here);
    var bar = document.createElement('header'); bar.id = 'pubnav';
    bar.innerHTML = '<div class="pn-left"><a class="pn-brand" href="Profile.html"><span class="pn-mk"><i></i></span>Publify</a>'
      + (PAGE_NAME[here] ? '<span class="pn-page">' + PAGE_NAME[here] + '</span>' : '') + '</div>'
      + '<button class="pn-prof" id="pn-prof" aria-label="Open menu"></button>';

    var scrim = document.createElement('div'); scrim.id = 'pn-scrim';
    var drawer = document.createElement('aside'); drawer.id = 'pn-drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Navigation');

    function avHtml(big) {
      var col = (u && u.color) || '#4f46e5';
      var st = u && u.avatar ? 'background-image:url(' + u.avatar + ')' : 'background:' + col;
      return '<span class="pn-av" style="' + st + '">' + (u && u.avatar ? '' : initials(u && u.name, u && u.email)) + '</span>';
    }
    function render() {
      u = curUser(); admin = isAdmin();
      document.getElementById('pn-prof').innerHTML = avHtml() + '<span class="pn-nm">' + ((u && u.name) || 'Menu') + '</span><span class="pn-cv">▾</span>';
      var links = LINKS.filter(function (l) { return !l.adminOnly || admin; }).map(function (l) {
        return '<a href="' + l.href + '"' + (l.key === here ? ' class="on"' : '') + '>' + (ICONS[l.key] || '') + l.label + '</a>';
      }).join('');
      var dark = window.PRTheme ? window.PRTheme.isDark() : document.documentElement.classList.contains('dark');
      drawer.innerHTML = '<div class="pnd-head">' + avHtml(true)
        + '<div style="min-width:0"><b>' + ((u && u.name) || 'Not signed in') + '</b><span>' + ((u && u.email) || '') + '</span></div>'
        + '<button class="pnd-x" id="pn-close" aria-label="Close">×</button></div>'
        + '<nav class="pnd-nav">' + links + '</nav>'
        + '<div class="pnd-foot"><div class="pnd-theme">Dark mode<button class="pnd-sw' + (dark ? ' on' : '') + '" id="pn-theme" role="switch" aria-checked="' + dark + '"><i></i></button></div>'
        + '<button class="pnd-signout" id="pn-signout">Sign out</button></div>';
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
  }

  var st = document.createElement('style'); st.id = 'pn-style'; st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
