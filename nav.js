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
    { key: 'course', label: 'Kurzus', href: 'Course.html' },
    { key: 'autopilot', label: 'Autopilot', href: 'Autopilot.html', newOnly: true },
    { key: 'kanban', label: 'My tasks', href: 'Kanban.html' },
    { key: 'memory', label: 'Memory', href: 'Memory.html' },
    { key: 'submissions', label: 'Érkeztető', href: 'Submissions.html' },
    { key: 'session', label: 'Publify Chat', href: 'Session.html' },
    { key: 'media', label: 'Media player', href: 'Media.html' },
    { key: 'compare', label: 'Version comparison', href: 'Compare.html' },
    { key: 'phd', label: 'Doctoral School', href: 'PhD.html' },
    { key: 'publications', label: 'Publications', href: 'Projects.html' },
    { key: 'admin', label: 'Admin', href: 'Admin.html', adminOnly: true }
  ];
  // nav key → feature_catalog key (migration-49). A nav item is hidden if the user isn't entitled.
  // COSMETIC ONLY: the server enforces enforced=true features regardless. Fail-open when unloaded.
  var FEATURE_OF = {
    research: 'page_research', course: 'page_course', kanban: 'page_kanban', memory: 'page_memory', submissions: 'page_submissions',
    session: 'page_session', media: 'page_media', compare: 'page_compare', phd: 'page_phd', publications: 'page_publications'
  };
  function linkVisible(l, admin) {
    if (l.adminOnly && !admin) return false;
    if (admin) return true;                              // admins see everything
    var fk = FEATURE_OF[l.key];
    if (fk && window.PREnt && window.PREnt.loaded() && !window.PREnt.can(fk)) return false;
    return true;
  }
  // Block the WHOLE current page (not just the nav link) if the user isn't entitled to it — so a
  // revoked menu item can't be reached by URL either. Admins (incl. view-as) are never blocked.
  // Client-side gate: the AI/data behind these pages is additionally server-enforced (edge fns + RLS).
  function guardCurrentPage(admin) {
    if (admin || adminView()) return;
    if (!window.PREnt || !window.PREnt.loaded()) return;
    var here = pageKey();
    var fk = FEATURE_OF[here];
    if (!fk || window.PREnt.can(fk)) return;
    var lk = null; for (var i = 0; i < LINKS.length; i++) { if (LINKS[i].key === here) { lk = LINKS[i]; break; } }
    window.PREnt.showBlock(lk ? lk.label : 'ez a');
  }
  // load the entitlement cache once a user + backend are available, then re-render
  var entTried = false;
  function ensureEnt(cb) {
    if (entTried || !window.PREnt) return;
    var BE = window.PR_BACKEND, u = (BE && BE.user) || null;
    if (!BE || !BE.sb || !u || !u.id) return;           // wait until the session is up
    entTried = true;
    window.PREnt.load(BE.sb, u.id).then(function () { if (cb) cb(); });
  }
  function pageKey() {
    var p = (location.pathname.split('/').pop() || '').toLowerCase();
    if (p.indexOf('profile') === 0) return 'profile';
    if (p.indexOf('autopilot') === 0) return 'autopilot';
    if (p.indexOf('research') === 0) return 'research';
    if (p.indexOf('course') === 0 && p.indexOf('coursecanvas') !== 0) return 'course';
    if (p.indexOf('kanban') === 0) return 'kanban';
    if (p.indexOf('memory') === 0) return 'memory';
    if (p.indexOf('submissions') === 0) return 'submissions';
    if (p.indexOf('session') === 0) return 'session';
    if (p.indexOf('media') === 0) return 'media';
    if (p.indexOf('compare') === 0) return 'compare';
    if (p.indexOf('phd') === 0) return 'phd';
    if (p.indexOf('projects') === 0) return 'publications';
    if (p.indexOf('admin') === 0) return 'admin';
    if (p.indexOf('proofreader') === 0) return 'editor';
    return '';
  }
  var PAGE_NAME = { profile: 'Profile', research: 'Research', course: 'Kurzus', autopilot: 'Autopilot', kanban: 'My tasks', memory: 'Memory', submissions: 'Érkeztető', session: 'Publify Chat', phd: 'Doctoral School', publications: 'Publications', admin: 'Admin', editor: 'Editor' };
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
  // keep Tab focus inside an open dialog (drawer / bug modal) instead of escaping to the page behind
  function trapFocus(el, e) {
    if (e.key !== 'Tab') return;
    var f = [].slice.call(el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (n) { return n.offsetParent !== null; });
    if (!f.length) return; var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

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
    '#pubnav .pn-right { display: flex; align-items: center; gap: 10px; min-width: 0; }',
    '#pubnav .pn-nav { display: flex; align-items: center; gap: 2px; }',
    '#pubnav .pn-nav a { padding: 7px 12px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted, #5b6473); text-decoration: none; white-space: nowrap; transition: color .15s, background .15s; }',
    '#pubnav .pn-nav a:hover { color: var(--ink, #1a2030); background: color-mix(in srgb, var(--ink, #1a2030) 7%, transparent); }',
    '#pubnav .pn-nav a.on { color: var(--ink, #1a2030); background: var(--accent-tint, #eef0ff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #4f46e5) 30%, transparent); }',
    'html.dark #pubnav .pn-nav a.on { color: #fff; background: linear-gradient(135deg, rgba(99,102,241,.22), rgba(168,85,247,.20), rgba(34,211,238,.18)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }',
    '#pubnav .pn-iconbtn { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; border: 1px solid var(--line, #e6e8ee); background: var(--surface, #fff); color: var(--muted, #5b6473); cursor: pointer; font-size: 15px; line-height: 1; flex: none; }',
    '#pubnav .pn-iconbtn:hover { color: var(--ink, #1a2030); border-color: var(--accent, #4f46e5); }',
    '@media (max-width: 1080px) { #pubnav .pn-nav { display: none; } }',   // narrow screens fall back to the drawer nav
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
    '.pnd-beta { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--accent, #4f46e5); background: var(--accent-tint, #eef0ff); padding: 1px 6px; border-radius: 999px; margin-left: 6px; vertical-align: middle; }',
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
    autopilot: svg('<path d="M8.5 1.5 3 8.8h3.4L7 14.5 12.5 7H9z"/>'),
    kanban: svg('<rect x="2.2" y="2.8" width="3.4" height="10.4" rx="1"/><rect x="6.6" y="2.8" width="3.4" height="7" rx="1"/><rect x="11" y="2.8" width="2.8" height="4.4" rx="1"/>'),
    memory: svg('<circle cx="4" cy="4" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="6.5" cy="11.5" r="1.6"/><circle cx="11.5" cy="11" r="1.6"/><path d="M5.4 4.6 10.6 4.8M5.2 5.3 6.2 10M11.7 6.5 11.6 9.6M7.9 11.3 10 11.1"/>'),
    submissions: svg('<path d="M2 8.5 4.5 8.5 6 10.5 10 10.5 11.5 8.5 14 8.5"/><path d="M2.6 8.5 4 3.4A1 1 0 0 1 5 2.7h6a1 1 0 0 1 1 .7l1.4 5.1V12a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z"/>'),
    phd: svg('<path d="M8 2L1.5 5.5 8 9l6.5-3.5z"/><path d="M4 7v3.2c0 .9 1.8 1.8 4 1.8s4-.9 4-1.8V7"/>'),
    publications: svg('<path d="M3 2.5h7l3 3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M5 7h6M5 9.5h6"/>'),
    admin: svg('<path d="M8 1.8l5 1.9v3.6c0 3-2.1 5.2-5 6.1-2.9-.9-5-3.1-5-6.1V3.7z"/><path d="M5.8 8l1.6 1.6L10.4 6.5"/>')
  };

  function build() {
    if (document.getElementById('pubnav') || !document.body) return;
    // barless mode (e.g. the editor, which has its own full top bar): keep ONLY the bug/feedback widget, no second bar
    if (window.PR_NAV_BARLESS) { buildBugWidget(); buildDMWidget(); return; }
    var here = pageKey();

    if (here) document.documentElement.classList.add('pn-' + here);
    var bar = document.createElement('header'); bar.id = 'pubnav';
    bar.innerHTML = '<div class="pn-left" id="pn-left"></div>'
      + '<div class="pn-right"><nav class="pn-nav" id="pn-nav" aria-label="Primary navigation"></nav>'
      + '<button class="pn-iconbtn" id="pn-dm" aria-label="Üzenetek" title="Üzenetek" style="position:relative">💬<span id="pn-dm-badge"></span></button>'
      + '<button class="pn-iconbtn" id="pn-theme-top" aria-label="Toggle dark mode" aria-pressed="false" title="Toggle dark mode">◐</button>'
      + '<button class="pn-iconbtn" id="pn-menu" aria-label="Open menu" aria-haspopup="dialog" aria-expanded="false" title="Menu">☰</button>'
      + '<button class="pn-prof" id="pn-prof" aria-label="Open your profile" title="Open your profile"></button></div>';

    var scrim = document.createElement('div'); scrim.id = 'pn-scrim';
    var drawer = document.createElement('aside'); drawer.id = 'pn-drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', 'Navigation');

    function avHtml(user) {
      var col = (user && user.color) || '#4f46e5';
      var img = user && (user.avatar || user.avatar_url);
      var st = img ? 'background-image:url(' + img + ')' : 'background:' + col;
      return '<span class="pn-av" style="' + st + '">' + (img ? '' : initials(user && user.name, user && user.email)) + '</span>';
    }
    function render() {
      var av = adminView();
      var du = av || curUser(), admin = isAdmin();
      var newd = window.PRDesign ? window.PRDesign.isNew() : document.documentElement.classList.contains('newdesign');   // Autopilot (newOnly) surfaces only in New design
      ensureEnt(function () { render(); guardCurrentPage(isAdmin()); });   // load entitlements, then re-render + guard the page
      if (window.PREnt && window.PREnt.loaded()) guardCurrentPage(admin);  // already loaded → guard now (idempotent)
      document.documentElement.classList.toggle('pn-adminview', !!av);
      document.getElementById('pn-left').innerHTML = '<a class="pn-brand" href="' + withAv('Profile.html') + '" title="Open your profile"><span class="pn-mk"><i></i></span>Publify</a>'
        + (av ? '<span class="pn-as">👁 ' + esc(av.name || av.email || '') + '</span>' : '');
      var SHORT = { profile: 'Profile', research: 'Research', course: 'Kurzus', autopilot: 'Autopilot', kanban: 'Tasks', memory: 'Memory', session: 'Chat', media: 'Media', compare: 'Compare', phd: 'Doctoral', publications: 'Publications', admin: 'Admin' };
      var barNav = LINKS.filter(function (l) { return linkVisible(l, admin) && (!l.newOnly || newd); }).map(function (l) {
        return '<a href="' + withAv(l.href) + '"' + (l.key === here ? ' class="on" aria-current="page"' : '') + '>' + esc(SHORT[l.key] || l.label) + '</a>';
      }).join('');
      var pnNav = document.getElementById('pn-nav'); if (pnNav) pnNav.innerHTML = barNav;
      document.getElementById('pn-prof').innerHTML = avHtml(du) + '<span class="pn-nm">' + esc((du && du.name) || 'Profile') + '</span>' + (av ? '<span class="pn-cv" aria-hidden="true">👁</span>' : '');
      var links = LINKS.filter(function (l) { return linkVisible(l, admin) && (!l.newOnly || newd); }).map(function (l) {
        return '<a href="' + withAv(l.href) + '"' + (l.key === here ? ' class="on" aria-current="page"' : '') + '>' + (ICONS[l.key] || '') + esc(l.label) + '</a>';
      }).join('');
      var dark = window.PRTheme ? window.PRTheme.isDark() : document.documentElement.classList.contains('dark');
      var tt = document.getElementById('pn-theme-top'); if (tt) tt.setAttribute('aria-pressed', dark ? 'true' : 'false');
      drawer.innerHTML = '<div class="pnd-head">' + avHtml(du)
        + '<div style="min-width:0"><b>' + esc((du && du.name) || 'Not signed in') + '</b><span>' + esc((du && du.email) || '') + '</span></div>'
        + '<button class="pnd-x" id="pn-close" aria-label="Close">×</button></div>'
        + (av ? '<div class="pnd-asbar">👁 Admin view — browsing this researcher’s workspace read-only</div>' : '')
        + '<nav class="pnd-nav">' + links + '</nav>'
        + '<div class="pnd-foot"><div class="pnd-theme">Dark mode<button class="pnd-sw' + (dark ? ' on' : '') + '" id="pn-theme" role="switch" aria-checked="' + dark + '"><i></i></button></div>'
        + '<div class="pnd-theme"><span>New design <span class="pnd-beta">beta</span></span><button class="pnd-sw' + (newd ? ' on' : '') + '" id="pn-design" role="switch" aria-checked="' + newd + '" title="Preview the new visual language across the app"><i></i></button></div>'
        + (av ? '<a class="pnd-backadmin" href="Admin.html">← Back to admin</a>' : '<button class="pnd-signout" id="pn-signout">Sign out</button>') + '</div>';
      wire();
    }
    var lastFocus = null;
    function onDrawerKey(e) { if (e.key === 'Escape') { close(); return; } trapFocus(drawer, e); }
    function open() { lastFocus = document.activeElement; scrim.classList.add('on'); drawer.classList.add('on'); document.addEventListener('keydown', onDrawerKey); var pf = document.getElementById('pn-menu'); if (pf) pf.setAttribute('aria-expanded', 'true'); var c = document.getElementById('pn-close'); if (c) c.focus(); }
    function close() { scrim.classList.remove('on'); drawer.classList.remove('on'); document.removeEventListener('keydown', onDrawerKey); var pf = document.getElementById('pn-menu'); if (pf) pf.setAttribute('aria-expanded', 'false'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    function wire() {
      var t = document.getElementById('pn-theme');
      if (t) t.onclick = function () { if (window.PRTheme) window.PRTheme.toggle(); render(); };
      var dg = document.getElementById('pn-design');
      if (dg) dg.onclick = function () { if (window.PRDesign) window.PRDesign.toggle(); render(); };
      var c = document.getElementById('pn-close'); if (c) c.onclick = close;
      var so = document.getElementById('pn-signout');
      if (so) so.onclick = function () {
        try { if (window.PR_BACKEND && window.PR_BACKEND.signOut) { window.PR_BACKEND.signOut(); } else if (window.PRAuth) { PRAuth.signOut(); } } catch (e) { }
        location.replace('Landing.html');
      };
    }

    document.body.appendChild(bar); document.body.appendChild(scrim); document.body.appendChild(drawer);
    render();
    document.getElementById('pn-prof').onclick = function () { location.href = withAv('Profile.html'); };   // avatar → profile
    var pm = document.getElementById('pn-menu'); if (pm) pm.onclick = open;                                   // ☰ → drawer (nav + sign out)
    var ptt = document.getElementById('pn-theme-top'); if (ptt) ptt.onclick = function () { if (window.PRTheme) window.PRTheme.toggle(); render(); };
    scrim.onclick = close;
    window.addEventListener('pr-theme', render);
    window.addEventListener('pr-design', render);
    window.addEventListener('pr-profile', render);
    // user/admin may resolve after auth loads — refresh a few times
    var tries = 0; var iv = setInterval(function () { tries++; render(); if (tries > 12 || (curUser() && curUser().name)) clearInterval(iv); }, 700);
    buildBugWidget();
    buildDMWidget();
  }

  // #13 — in-app bug / feature reports: floating button + modal with a category, a (client-resized)
  // screenshot, and a "my reports" list showing status + the admin's reply. Isolated from the nav DOM.
  function buildBugWidget() {
    if (document.getElementById('pn-bug-btn')) return;
    var category = 'bug', imageData = null;
    var btn = document.createElement('button');
    btn.id = 'pn-bug-btn'; btn.title = 'Bug report / feedback'; btn.setAttribute('aria-label', 'Report a bug or feedback'); btn.textContent = '🐞';
    btn.setAttribute('style', 'position:fixed;right:16px;bottom:16px;z-index:90;width:42px;height:42px;border-radius:50%;border:1px solid var(--line,#e4e7ec);background:var(--pane,#fff);box-shadow:0 4px 14px rgba(20,24,40,.18);font-size:18px;cursor:pointer;line-height:1;padding:0');
    var modal = document.createElement('div');
    modal.id = 'pn-bug-modal';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Feedback');
    modal.setAttribute('style', 'position:fixed;inset:0;z-index:95;background:rgba(15,20,40,.4);display:none;align-items:center;justify-content:center');
    var card = document.createElement('div');
    card.setAttribute('style', 'background:var(--pane,#fff);color:var(--ink,#111);width:min(480px,94vw);max-height:90vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(15,20,40,.35);padding:16px 18px');
    var iSt = 'width:100%;box-sizing:border-box;border:1px solid var(--line,#e4e7ec);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--app-bg,#fff);color:inherit';
    var catSt = 'flex:1;border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;border-radius:8px;padding:7px 8px;font-size:12.5px;cursor:pointer';
    card.innerHTML = '<div style="font-weight:700;font-size:15px;margin-bottom:8px"><span aria-hidden="true">🐞</span> Feedback</div>'
      + '<div id="pn-bug-cats" style="display:flex;gap:6px;margin-bottom:10px"><button data-cat="bug" aria-label="Bug" style="' + catSt + '"><span aria-hidden="true">🐞</span> Bug</button><button data-cat="feature" aria-label="Feature request" style="' + catSt + '"><span aria-hidden="true">💡</span> Feature request</button></div>'
      + '<input id="pn-bug-title" placeholder="Short title (optional)" style="' + iSt + ';margin-bottom:8px">'
      + '<textarea id="pn-bug-body" rows="5" placeholder="What did you experience? (the page and version are recorded automatically)" style="' + iSt + ';font-family:inherit;resize:vertical"></textarea>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><button id="pn-bug-img-btn" aria-label="Attach image" style="border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer"><span aria-hidden="true">📎</span> Attach image</button><span id="pn-bug-img-name" style="font-size:12px;color:var(--muted,#667)"></span><input id="pn-bug-img" type="file" accept="image/*" style="display:none"></div>'
      + '<div id="pn-bug-img-prev" style="margin-top:8px"></div>'
      + '<div id="pn-bug-msg" style="font-size:12px;margin-top:6px;min-height:16px"></div>'
      + '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:8px"><button id="pn-bug-mine" style="border:0;background:transparent;color:var(--accent,#4f46e5);font-size:12.5px;cursor:pointer;padding:6px 0">My previous reports ▾</button><div style="display:flex;gap:8px"><button id="pn-bug-cancel" aria-label="Close" style="border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer">Cancel</button><button id="pn-bug-send" aria-label="Send" style="border:0;background:var(--accent,#4f46e5);color:#fff;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer">Send</button></div></div>'
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

    var lastBugFocus = null;
    function onBugKey(e) { if (e.key === 'Escape') { hide(); return; } trapFocus(card, e); }
    function show() { lastBugFocus = document.activeElement; var m = document.getElementById('pn-bug-msg'); if (m) m.textContent = '';   /* clear a stale "elküldve" message from a previous submit */ modal.style.display = 'flex'; document.addEventListener('keydown', onBugKey); var t = document.getElementById('pn-bug-body'); if (t) t.focus(); }
    function hide() { modal.style.display = 'none'; document.removeEventListener('keydown', onBugKey); if (lastBugFocus && lastBugFocus.focus) lastBugFocus.focus(); }
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
      listEl.style.display = 'block'; listEl.innerHTML = '<div style="font-size:12px;color:var(--muted,#667)">Loading…</div>';
      var BE = window.PR_BACKEND, u = curUser();
      if (!(BE && BE.sb && u)) { listEl.innerHTML = '<div style="font-size:12px;color:var(--muted,#667)">Sign-in required.</div>'; return; }
      BE.sb.from('bug_reports').select('id,category,title,body,status,reply,created_at').eq('reporter_id', u.id).order('created_at', { ascending: false }).then(function (r) {
        if (r && r.error) { listEl.innerHTML = '<div style="font-size:12px;color:var(--danger,#b42318)">' + esc(r.error.message) + '</div>'; return; }
        var rows = (r && r.data) || [];
        if (!rows.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--muted,#667)">You have no reports yet.</div>'; return; }
        listEl.innerHTML = rows.map(function (b) {
          var stColor = b.status === 'fixed' ? '#0f766e' : (b.status === 'wontfix' ? '#b42318' : 'var(--muted,#667)');
          return '<div style="border:1px solid var(--line,#e4e7ec);border-radius:8px;padding:8px 10px;margin-bottom:6px">'
            + '<div style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted,#667)"><span>' + (b.category === 'feature' ? '💡 Feature' : '🐞 Bug') + '</span><span style="margin-left:auto;font-weight:700;color:' + stColor + '">' + esc(b.status || 'open') + '</span></div>'
            + (b.title ? '<div style="font-weight:600;font-size:12.5px;margin-top:2px">' + esc(b.title) + '</div>' : '')
            + '<div style="font-size:12px;margin-top:2px;white-space:pre-wrap">' + esc((b.body || '').slice(0, 240)) + '</div>'
            + (b.reply ? '<div style="font-size:12px;margin-top:6px;padding:6px 8px;background:var(--app-bg,#f7f8fa);border-radius:6px"><b>Reply:</b> ' + esc(b.reply) + '</div>' : '')
            + '</div>';
        }).join('');
      });
    };

    document.getElementById('pn-bug-send').onclick = function () {
      var msg = document.getElementById('pn-bug-msg');
      var body = (document.getElementById('pn-bug-body').value || '').trim();
      var title = (document.getElementById('pn-bug-title').value || '').trim();
      if (!body) { msg.style.color = 'var(--danger,#b42318)'; msg.textContent = 'Please describe it briefly.'; return; }
      var BE = window.PR_BACKEND, u = curUser();
      if (!(BE && BE.sb && u)) { msg.style.color = 'var(--danger,#b42318)'; msg.textContent = 'Sign-in required to send.'; return; }
      var ver = ''; try { ver = (document.getElementById('pr-ver-slot') && document.getElementById('pr-ver-slot').textContent) || ''; } catch (e) { }
      msg.style.color = 'var(--muted,#667)'; msg.textContent = 'Sending…';
      BE.sb.from('bug_reports').insert({ reporter_id: u.id, category: category, title: title || null, body: body, image_data: imageData || null, page: location.pathname, app_version: String(ver || '').slice(0, 60) }).then(function (r) {
        if (r && r.error) { msg.style.color = 'var(--danger,#b42318)'; msg.textContent = 'Error: ' + r.error.message; return; }
        msg.style.color = 'var(--accent,#4f46e5)'; msg.textContent = '✓ Thank you! Sent.';
        document.getElementById('pn-bug-body').value = ''; document.getElementById('pn-bug-title').value = '';
        imageData = null; document.getElementById('pn-bug-img-name').textContent = ''; document.getElementById('pn-bug-img-prev').innerHTML = '';
        setTimeout(hide, 1100);
      });
    };
  }

  // ---- Person-to-person messaging (DM): global launcher + right drawer, reachable on every page. ----
  //      1:1 messages + entity references (idea/source/study/figure/file → rich card → deep-link). Backed by
  //      migration-94 (dm_threads/dm_messages/dm_reads + dm_start_dm/pr_notify_dm). window.PRDM = { open, openWith }.
  var REF_ICON = { idea: '💡', source: '📄', study: '🔬', figure: '🖼', file: '📎', project: '📁', gap: '🕳', node: '📍' };
  var REF_LBL = { idea: 'Ötlet', source: 'Forrás', study: 'Study', figure: 'Ábra', file: 'Fájl', project: 'Projekt', gap: 'Rés', node: 'Kártya' };
  var REF_FOCUS = { idea: 'focusIdeaId', source: 'focusSourceId', file: 'focusFileId', figure: 'focusFigureId', gap: 'focusGapId', chat: 'focusChatId' };
  var DM_PAL = ['#e11d48', '#0891b2', '#7c3aed', '#ca8a04', '#059669', '#db2777', '#2563eb', '#ea580c'];
  function dmColor(id, canon) { if (canon) return canon; var s = String(id || ''), h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return DM_PAL[h % DM_PAL.length]; }
  function dmMono(nm) { var a = String(nm || '').trim().split(/\s+/).filter(Boolean); if (!a.length) return '?'; return (a.length === 1 ? a[0].slice(0, 2) : (a[0].charAt(0) + a[a.length - 1].charAt(0))).toUpperCase(); }
  function dmRel(ts) { if (!ts) return ''; var d = (Date.now() - new Date(ts).getTime()) / 1000; if (d < 60) return 'most'; if (d < 3600) return Math.round(d / 60) + 'p'; if (d < 86400) return Math.round(d / 3600) + 'ó'; if (d < 172800) return 'tegnap'; return Math.round(d / 86400) + 'n'; }
  function refLink(ref) { if (!ref) return '#'; var q = 'Research.html?'; if (ref.project_id) q += 'project=' + encodeURIComponent(ref.project_id); var fp = REF_FOCUS[ref.kind]; if (fp && ref.id) q += (ref.project_id ? '&' : '') + fp + '=' + encodeURIComponent(ref.id); return q; }

  function buildDMWidget() {
    if (window.__pndm) return; window.__pndm = 1;
    var BE = window.PR_BACKEND;
    var css = document.createElement('style'); css.id = 'pndm-css';
    css.textContent = [
      '#pndm-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(15,20,40,.35);opacity:0;pointer-events:none;transition:opacity .18s}',
      '#pndm-scrim.on{opacity:1;pointer-events:auto}',
      '#pndm{position:fixed;top:0;right:0;bottom:0;z-index:2147483001;width:min(392px,96vw);background:var(--pane,#fff);color:var(--ink,#111);border-left:1px solid var(--line,#e4e7ec);box-shadow:-14px 0 44px rgba(15,20,40,.20);transform:translateX(102%);transition:transform .2s ease;display:flex;flex-direction:column;font-size:13px}',
      '#pndm.on{transform:none}',
      '.pndm-h{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--line,#e4e7ec);flex:none}',
      '.pndm-h b{font-size:15px}',
      '.pndm-ic{width:28px;height:28px;border-radius:8px;border:1px solid var(--line,#e4e7ec);background:var(--app-bg,#f7f8fa);color:inherit;display:grid;place-items:center;cursor:pointer;font-size:13px;padding:0}',
      '.pndm-ic:hover{border-color:var(--accent,#4f46e5);color:var(--accent,#4f46e5)}',
      '.pndm-body{flex:1;overflow-y:auto;padding:8px;min-height:0}',
      '.pndm-conv{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:10px;cursor:pointer}',
      '.pndm-conv:hover{background:var(--app-bg,#f7f8fa)}',
      '.pndm-av{width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:700;font-size:12px;overflow:hidden}',
      '.pndm-av img{width:100%;height:100%;object-fit:cover}',
      '.pndm-nm{font-size:13px;font-weight:600;line-height:1.2}',
      '.pndm-pv{font-size:11.5px;color:var(--muted,#667);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pndm-unread{background:var(--accent,#4f46e5);color:#fff;border-radius:999px;font-size:10px;font-weight:700;min-width:17px;height:17px;padding:0 5px;display:grid;place-items:center;flex:none}',
      '.pndm-msg{max-width:82%;padding:8px 11px;border-radius:13px;font-size:13px;line-height:1.45;margin-bottom:8px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
      '.pndm-msg.me{margin-left:auto;background:var(--accent,#4f46e5);color:#fff;border-bottom-right-radius:4px}',
      '.pndm-msg.them{background:var(--app-bg,#f7f8fa);border:1px solid var(--line,#e4e7ec);border-bottom-left-radius:4px}',
      '.pndm-eref{display:flex;gap:8px;align-items:center;border:1px solid var(--line,#e4e7ec);border-left:3px solid var(--accent,#4f46e5);border-radius:9px;padding:6px 9px;background:var(--pane,#fff);margin:4px 0;cursor:pointer;text-decoration:none;color:inherit}',
      '.pndm-msg.me .pndm-eref{background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);border-left-color:#fff;color:#fff}',
      '.pndm-ei{width:24px;height:24px;border-radius:7px;flex:none;display:grid;place-items:center;font-size:12px;background:var(--app-bg,#f1f2f6)}',
      '.pndm-msg.me .pndm-ei{background:rgba(255,255,255,.22)}',
      '.pndm-foot{border-top:1px solid var(--line,#e4e7ec);padding:8px 10px;flex:none}',
      '.pndm-chip{display:flex;gap:7px;align-items:center;border:1px solid var(--accent,#4f46e5);background:var(--accent-tint,rgba(79,70,229,.08));border-radius:9px;padding:5px 8px;margin-bottom:6px;font-size:11.5px}',
      '.pndm-in{display:flex;gap:6px;align-items:flex-end}',
      '.pndm-in textarea{flex:1;resize:none;border:1px solid var(--line,#e4e7ec);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px;background:var(--app-bg,#fff);color:inherit;max-height:100px;min-height:20px}',
      '.pndm-send{border:0;background:var(--accent,#4f46e5);color:#fff;border-radius:9px;width:34px;height:34px;font-size:15px;cursor:pointer;flex:none}',
      '.pndm-send:disabled{opacity:.5;cursor:default}',
      '.pndm-search{width:100%;box-sizing:border-box;border:1px solid var(--line,#e4e7ec);border-radius:9px;padding:8px 10px;font:inherit;font-size:13px;background:var(--app-bg,#fff);color:inherit;margin-bottom:8px}',
      '.pndm-empty{font-size:12.5px;color:var(--muted,#667);text-align:center;padding:22px 12px;line-height:1.5}',
      '.pndm-seclbl{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#667);padding:8px 8px 5px}',
      '.pndm-msg .who{font-size:9px;font-weight:700;opacity:.72;margin-bottom:1px}',
      '#pndm-winlayer{position:fixed;inset:0;z-index:2147482500;pointer-events:none}',
      '.pndm-win{position:fixed;pointer-events:auto;background:var(--pane,#fff);color:var(--ink,#111);border:1px solid var(--line,#e4e7ec);border-radius:12px;box-shadow:0 14px 44px rgba(15,20,40,.30);display:flex;flex-direction:column;overflow:hidden;min-width:240px;min-height:200px}',
      '.pndm-wbar{display:flex;align-items:center;gap:6px;padding:7px 9px;color:#fff;cursor:grab;user-select:none;touch-action:none}',
      '.pndm-wbar.drag{cursor:grabbing}',
      '.pndm-wbar b{font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.pndm-wbar .wa{background:transparent;border:0;color:#fff;cursor:pointer;opacity:.9;font-size:12px;padding:0 3px;line-height:1}',
      '.pndm-wbody{flex:1;overflow-y:auto;padding:8px 9px;min-height:0}',
      '.pndm-wfoot{border-top:1px solid var(--line,#e4e7ec);padding:6px 8px}',
      '.pndm-wta{width:100%;box-sizing:border-box;resize:none;border:1px solid var(--line,#e4e7ec);border-radius:9px;padding:6px 9px;font:inherit;font-size:12.5px;background:var(--app-bg,#fff);color:inherit;max-height:90px}',
      '.pndm-in{display:flex;gap:5px;align-items:flex-end}',
      '.pndm-rz{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;color:var(--muted,#889);touch-action:none}',
      '#pndm-heads{position:fixed;right:16px;bottom:120px;z-index:2147482400;display:flex;flex-direction:column;gap:9px;align-items:center;pointer-events:none}',
      '.pndm-head{pointer-events:auto;width:44px;height:44px;border-radius:50%;border:2px solid var(--pane,#fff);box-shadow:0 6px 18px rgba(20,24,40,.28);display:grid;place-items:center;color:#fff;font-weight:700;font-size:13px;cursor:pointer;position:relative}',
      '.pndm-head .b{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:#e5484d;color:#fff;font-size:8.5px;font-weight:700;display:grid;place-items:center;border:1.5px solid var(--pane,#fff)}',
      '@media(max-width:640px){.pndm-win{left:0!important;top:26px!important;width:100vw!important;height:calc(100% - 26px)!important;border-radius:0}.pndm-rz{display:none}}',
      '#pn-dm-badge{position:absolute;top:-4px;right:-4px;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:#e5484d;color:#fff;font-size:9px;font-weight:700;display:none;place-items:center;border:1.5px solid var(--pane,#fff)}',
      '#pn-dm-badge.on{display:grid}'
    ].join('');
    (document.head || document.documentElement).appendChild(css);

    var scrim = document.createElement('div'); scrim.id = 'pndm-scrim';
    var panel = document.createElement('aside'); panel.id = 'pndm'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Üzenetek');
    panel.innerHTML = '<div class="pndm-h"><button class="pndm-ic" id="pndm-back" title="Vissza" style="display:none">‹</button><b id="pndm-title">Üzenetek</b><span style="flex:1"></span><button id="pndm-new" title="Új beszélgetés indítása egy kollégával" style="border:1px solid var(--accent,#4f46e5);background:var(--accent,#4f46e5);color:#fff;border-radius:8px;padding:6px 11px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;flex:none">✏️ Új</button><button class="pndm-ic" id="pndm-close" title="Bezárás">✕</button></div><div class="pndm-body" id="pndm-body"></div><div class="pndm-foot" id="pndm-foot" style="display:none"></div>';
    document.body.appendChild(scrim); document.body.appendChild(panel);

    var me = null, convos = [], people = {}, curThread = null, msgs = [], pendingRef = null, ch = null, loaded = false, view = 'list';
    var windows = {}, zTop = 30, POS = (function () { try { return JSON.parse(localStorage.getItem('pndm-pos') || '{}') || {}; } catch (e) { return {}; } })();
    var winLayer = document.createElement('div'); winLayer.id = 'pndm-winlayer'; document.body.appendChild(winLayer);
    var headsTray = document.createElement('div'); headsTray.id = 'pndm-heads'; document.body.appendChild(headsTray);
    var body = panel.querySelector('#pndm-body'), foot = panel.querySelector('#pndm-foot'), titleEl = panel.querySelector('#pndm-title'), backBtn = panel.querySelector('#pndm-back');
    function nameOf(uid) { if (uid && me && uid === me.id) return 'Te'; return (people[uid] && people[uid].name) || 'Kolléga'; }
    function colOf(uid) { return (people[uid] && people[uid].color) || dmColor(uid); }
    function avHtml(uid, size) { var s = size || 34, p = people[uid] || {}; var st = 'width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.36) + 'px'; return p.avatar ? '<span class="pndm-av" style="' + st + '"><img src="' + esc(p.avatar) + '" alt=""></span>' : '<span class="pndm-av" style="' + st + ';background:' + colOf(uid) + '">' + esc(dmMono(nameOf(uid))) + '</span>'; }
    function erefHtml(ref) { var ic = REF_ICON[ref.kind] || '🔗', lb = REF_LBL[ref.kind] || 'Hivatkozás'; return '<a class="pndm-eref" href="' + esc(refLink(ref)) + '"><span class="pndm-ei">' + ic + '</span><span style="min-width:0;flex:1"><span style="display:block;font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;opacity:.75">' + esc(lb) + '</span><span style="display:block;font-size:12px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(ref.label || '(megnyitás)') + '</span></span><span style="opacity:.7">→</span></a>'; }

    function updateBadge() { var n = convos.reduce(function (a, c) { return a + (c.unread || 0); }, 0); var t = n > 9 ? '9+' : String(n); var b = document.getElementById('pn-dm-badge'); if (b) { b.textContent = t; b.classList.toggle('on', n > 0); } var fb = document.getElementById('pndm-fab-badge'); if (fb) { fb.textContent = t; fb.style.display = n > 0 ? 'grid' : 'none'; } }
    var reloadT = null;
    function loadConvos(cb) {
      var u = curUser(); if (!(BE && BE.sb && u && u.id)) { if (cb) cb(); return; } me = u; loaded = true;
      BE.sb.from('dm_threads').select('id,kind,title,entity,updated_at').order('updated_at', { ascending: false }).then(function (r) {
        var threads = (r && r.data) || [], ids = threads.map(function (t) { return t.id; });
        if (!ids.length) { convos = []; if (!curThread) renderList(); updateBadge(); if (cb) cb(); return; }
        Promise.all([
          BE.sb.from('dm_thread_members').select('thread_id,user_id').in('thread_id', ids),
          BE.sb.from('dm_messages').select('thread_id,sender_id,body,refs,created_at').in('thread_id', ids).order('created_at', { ascending: false }).limit(400),
          BE.sb.from('dm_reads').select('thread_id,last_read_at').eq('user_id', u.id)
        ]).then(function (res) {
          var mem = (res[0] && res[0].data) || [], last = (res[1] && res[1].data) || [], reads = (res[2] && res[2].data) || [];
          var byMem = {}; mem.forEach(function (m) { (byMem[m.thread_id] = byMem[m.thread_id] || []).push(m.user_id); });
          var lastBy = {}, allBy = {}; last.forEach(function (m) { if (!lastBy[m.thread_id]) lastBy[m.thread_id] = m; (allBy[m.thread_id] = allBy[m.thread_id] || []).push(m); });
          var readBy = {}; reads.forEach(function (x) { readBy[x.thread_id] = x.last_read_at; });
          var oids = {}; threads.forEach(function (t) { (byMem[t.id] || []).forEach(function (uid) { if (uid !== u.id) oids[uid] = 1; }); });
          var oidl = Object.keys(oids).filter(function (id) { return !people[id]; });
          function finish() {
            convos = threads.map(function (t) {
              var others = (byMem[t.id] || []).filter(function (x) { return x !== u.id; }), lm = lastBy[t.id], lr = readBy[t.id];
              var un = (allBy[t.id] || []).filter(function (m) { return m.sender_id !== u.id && (!lr || m.created_at > lr); }).length;
              var title = t.kind === 'dm' ? (others[0] ? nameOf(others[0]) : 'Beszélgetés') : (t.title || (t.entity && t.entity.label) || 'Csoport');
              return { id: t.id, kind: t.kind, entity: t.entity, others: others, title: title, last: lm, unread: un };
            });
            if (view === 'list') renderList(); updateBadge(); if (cb) cb();
          }
          if (oidl.length) BE.sb.from('profiles_public').select('id,name,avatar_url,color').in('id', oidl).then(function (pr) { ((pr && pr.data) || []).forEach(function (p) { people[p.id] = { name: p.name, avatar: p.avatar_url, color: p.color }; }); finish(); });
          else finish();
        });
      });
    }
    function scheduleReload() { if (reloadT) return; reloadT = setTimeout(function () { reloadT = null; loadConvos(); if (curThread) refreshThread(); }, 350); }

    function renderList() {
      view = 'list'; curThread = null; backBtn.style.display = 'none'; titleEl.textContent = 'Üzenetek'; foot.style.display = 'none';
      if (!loaded) { body.innerHTML = '<div class="pndm-empty">Betöltés…</div>'; return; }
      if (!(curUser() && curUser().id)) { body.innerHTML = '<div class="pndm-empty">Jelentkezz be az üzenetekhez.</div>'; return; }
      if (!convos.length) { newConvoView(true); return; }   // no conversations yet → default to your contacts (shared projects), no blank search
      body.innerHTML = convos.map(function (c, i) {
        var uid = c.others[0], pv = c.last ? ((c.last.sender_id === me.id ? 'Te: ' : '') + (c.last.body ? c.last.body : (c.last.refs && c.last.refs.length ? (REF_ICON[c.last.refs[0].kind] || '🔗') + ' hivatkozás' : ''))) : 'Nincs üzenet';
        var ava = c.kind === 'dm' ? avHtml(uid, 34) : '<span class="pndm-av" style="background:linear-gradient(135deg,#7c6cf0,#e08b00)">' + (c.entity ? (REF_ICON[c.entity.kind] || '👥') : '👥') + '</span>';
        return '<div class="pndm-conv" data-i="' + i + '">' + ava + '<span style="min-width:0;flex:1"><span class="pndm-nm">' + esc(c.title) + '</span><span class="pndm-pv">' + esc(pv) + '</span></span>' + (c.unread ? '<span class="pndm-unread">' + c.unread + '</span>' : (c.last ? '<span style="font-size:10px;color:var(--muted,#667)">' + dmRel(c.last.created_at) + '</span>' : '')) + '</div>';
      }).join('');
      [].forEach.call(body.querySelectorAll('.pndm-conv'), function (el) { el.onclick = function () { openThread(convos[+el.getAttribute('data-i')]); }; });
    }

    function renderFoot() {
      foot.style.display = 'block';
      foot.innerHTML = (pendingRef ? '<div class="pndm-chip"><span>' + (REF_ICON[pendingRef.kind] || '🔗') + '</span><span style="min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(pendingRef.label || REF_LBL[pendingRef.kind] || 'hivatkozás') + '</span><button class="pndm-ic" id="pndm-ref-x" title="Eltávolítás" style="width:20px;height:20px;font-size:11px">✕</button></div>' : '')
        + '<div class="pndm-in"><textarea id="pndm-ta" rows="1" placeholder="Írj üzenetet…"></textarea><button class="pndm-send" id="pndm-sendbtn" title="Küldés">➤</button></div>';
      var ta = foot.querySelector('#pndm-ta'); ta.oninput = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'; };
      ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } };
      foot.querySelector('#pndm-sendbtn').onclick = doSend;
      var rx = foot.querySelector('#pndm-ref-x'); if (rx) rx.onclick = function () { pendingRef = null; renderFoot(); ta2focus(); };
      setTimeout(function () { ta.focus(); }, 30);
    }
    function ta2focus() { var ta = foot.querySelector('#pndm-ta'); if (ta) ta.focus(); }
    function renderThread() {
      body.innerHTML = msgs.map(function (m) {
        var mine = m.sender_id === me.id;
        var refs = (m.refs || []).map(erefHtml).join('');
        return '<div class="pndm-msg ' + (mine ? 'me' : 'them') + '">' + (mine ? '' : '') + (m.body ? esc(m.body) : '') + refs + '</div>';
      }).join('') || '<div class="pndm-empty">Írj elsőként — ' + esc(curThread.title) + ' megkapja.</div>';
      body.scrollTop = body.scrollHeight;
    }
    function refreshThread() { if (!curThread) return; BE.sb.from('dm_messages').select('id,sender_id,body,refs,attachments,created_at').eq('thread_id', curThread.id).order('created_at', { ascending: true }).then(function (r) { if (r && r.data) { msgs = r.data; renderThread(); markRead(); } }); }
    function openThread(c) { close(); openWindow(c, pendingRef); pendingRef = null; }   // Messenger-mode: open a floating window, not the drawer
    function markRead() { var u = curUser(); if (!curThread || !u) return; BE.sb.from('dm_reads').upsert({ thread_id: curThread.id, user_id: u.id, last_read_at: new Date().toISOString() }, { onConflict: 'thread_id,user_id' }).then(function () { var c = convos.filter(function (x) { return x.id === curThread.id; })[0]; if (c) { c.unread = 0; updateBadge(); } }); }
    function doSend() {
      var ta = foot.querySelector('#pndm-ta'); if (!ta || !curThread) return; var txt = (ta.value || '').trim(); var ref = pendingRef;
      if (!txt && !ref) return; var u = curUser(); if (!u) return;
      ta.value = ''; ta.style.height = 'auto'; pendingRef = null; renderFoot();
      var row = { thread_id: curThread.id, sender_id: u.id, body: txt }; if (ref) row.refs = [ref];
      BE.sb.from('dm_messages').insert(row).select('id,sender_id,body,refs,created_at').maybeSingle().then(function (r) {
        if (r && r.error) { window.PRUI && window.PRUI.toast ? window.PRUI.toast(r.error.message, { kind: 'error' }) : alert(r.error.message); return; }
        if (r && r.data) { msgs.push(r.data); renderThread(); }
        (curThread.others || []).forEach(function (oid) { BE.sb.rpc('pr_notify_dm', { p_recipient: oid, p_thread: curThread.id, p_excerpt: txt || 'hivatkozást küldött' }).then(function () { }, function () { }); });
      });
    }

    // people you already have a relationship with: everyone who shares a research project with you
    // (owner or accepted member of a project you can see — RLS-scoped). Shown by default so you don't have to search.
    function loadContacts(cb) {
      var u = curUser(); if (!(BE && BE.sb && u && u.id)) { cb([]); return; }
      Promise.all([
        BE.sb.from('research_projects').select('id,owner_id'),
        BE.sb.from('research_project_members').select('user_id')
      ]).then(function (res) {
        var projs = (res[0] && res[0].data) || [], mems = (res[1] && res[1].data) || [], ids = {};
        projs.forEach(function (p) { if (p.owner_id && p.owner_id !== u.id) ids[p.owner_id] = 1; });
        mems.forEach(function (m) { if (m.user_id && m.user_id !== u.id) ids[m.user_id] = 1; });
        var idl = Object.keys(ids); if (!idl.length) { cb([]); return; }
        BE.sb.from('profiles_public').select('id,name,avatar_url,color').in('id', idl).then(function (pr) {
          var rows = (pr && pr.data) || []; rows.forEach(function (p) { people[p.id] = { name: p.name, avatar: p.avatar_url, color: p.color }; });
          rows.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }); cb(rows);
        }, function () { cb([]); });
      }, function () { cb([]); });
    }
    function convItemHtml(p) { return '<div class="pndm-conv" data-uid="' + esc(p.id) + '">' + avHtml(p.id, 30) + '<span class="pndm-nm">' + esc(p.name || 'Kolléga') + '</span></div>'; }
    function newConvoView(isDefault) {
      view = 'picker'; curThread = null; foot.style.display = 'none';
      backBtn.style.display = isDefault ? 'none' : 'grid'; titleEl.textContent = isDefault ? 'Üzenetek' : 'Új beszélgetés';
      body.innerHTML = '<input class="pndm-search" id="pndm-search" placeholder="Kolléga keresése név / e-mail…" autocomplete="off"><div id="pndm-res"><div class="pndm-empty" style="padding:12px">Betöltés…</div></div>';
      var inp = body.querySelector('#pndm-search'), res = body.querySelector('#pndm-res'), t = null, contacts = [];
      function wire(c) { [].forEach.call(c.querySelectorAll('.pndm-conv'), function (el) { el.onclick = function () { startDM(el.getAttribute('data-uid')); }; }); }
      function showContacts() { res.innerHTML = contacts.length ? ('<div class="pndm-seclbl">Kapcsolataid · közös projektekből</div>' + contacts.map(convItemHtml).join('')) : '<div class="pndm-empty" style="padding:14px">Nincs még közös projekted mással.<br>Keress rá egy kollégára fent név vagy e-mail alapján.</div>'; wire(res); }
      loadContacts(function (rows) { contacts = rows; if (view === 'picker' && inp.value.trim().length < 2) showContacts(); });
      inp.oninput = function () { if (t) clearTimeout(t); var q = inp.value.trim(); if (q.length < 2) { showContacts(); return; } t = setTimeout(function () {
        BE.sb.rpc('pr_search_users', { q: q }).then(function (r) { var rows = (r && r.data) || [], u = curUser(); rows = rows.filter(function (x) { return x.id !== (u && u.id); }); rows.forEach(function (p) { people[p.id] = { name: p.name, avatar: p.avatar_url, color: p.color }; });
          res.innerHTML = rows.length ? rows.map(convItemHtml).join('') : '<div class="pndm-empty" style="padding:14px">Nincs találat.</div>'; wire(res); }); }, 300); };
      setTimeout(function () { inp.focus(); }, 30);
    }
    function startDM(otherId) {
      if (!otherId) return; BE.sb.rpc('dm_start_dm', { p_other: otherId }).then(function (r) {
        if (r && r.error) { alert(r.error.message); return; } var tid = r && r.data; if (!tid) return;
        loadConvos(function () { var c = convos.filter(function (x) { return x.id === tid; })[0] || { id: tid, kind: 'dm', others: [otherId], title: nameOf(otherId), unread: 0 }; openThread(c); });
      });
    }

    // ---------- floating window manager (Messenger-mode): each thread is a draggable + resizable window ----------
    function clampN(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function headColor(th) { var o = th.others || []; return (th.kind !== 'dm' && o.length > 1) ? ('linear-gradient(135deg,' + colOf(o[0]) + ',' + colOf(o[1] || o[0]) + ')') : colOf(o[0]); }
    function winTitle(th) { var o = th.others || []; var av = (th.kind !== 'dm' && o.length > 1) ? ('<span style="display:flex;margin-right:2px">' + o.slice(0, 2).map(function (u, i) { return '<span class="pndm-av sm" style="' + (i ? 'margin-left:-7px;' : '') + 'border:1.5px solid rgba(255,255,255,.55);background:' + colOf(u) + '">' + esc(dmMono(nameOf(u))) + '</span>'; }).join('') + '</span>') : avHtml(o[0], 22); return av + '<b>' + esc(th.title || 'Beszélgetés') + '</b>'; }
    function savePos() { try { var out = {}; Object.keys(windows).forEach(function (id) { var W = windows[id], e = W.el; out[id] = { x: parseFloat(e.style.left) || 0, y: parseFloat(e.style.top) || 0, w: parseFloat(e.style.width) || 300, h: parseFloat(e.style.height) || 384, min: !!W.minimized }; }); localStorage.setItem('pndm-pos', JSON.stringify(out)); } catch (e) { } }
    function focusWindow(id) { var W = windows[id]; if (W) W.el.style.zIndex = (++zTop); }
    function renderHeads() {
      var mins = Object.keys(windows).filter(function (id) { return windows[id].minimized; });
      headsTray.innerHTML = mins.map(function (id) { var W = windows[id], o = W.thread.others || []; return '<div class="pndm-head" data-id="' + esc(id) + '" style="background:' + headColor(W.thread) + '" title="' + esc(W.thread.title || '') + '">' + esc(dmMono(o[0] ? nameOf(o[0]) : (W.thread.title || '?'))) + (W.unread ? '<span class="b">' + (W.unread > 9 ? '9+' : W.unread) + '</span>' : '') + '</div>'; }).join('');
      [].forEach.call(headsTray.querySelectorAll('.pndm-head'), function (el) { el.onclick = function () { restoreWindow(el.getAttribute('data-id')); }; });
    }
    function minimizeWindow(id) { var W = windows[id]; if (!W) return; W.minimized = true; W.el.style.display = 'none'; renderHeads(); savePos(); }
    function restoreWindow(id) { var W = windows[id]; if (!W) return; W.minimized = false; W.unread = 0; W.el.style.display = 'flex'; focusWindow(id); renderHeads(); loadWinMsgs(id); }
    function closeWindow(id) { var W = windows[id]; if (!W) return; try { W.el.remove(); } catch (e) { } delete windows[id]; renderHeads(); savePos(); }
    function startDrag(id, e) {
      var W = windows[id]; if (!W) return; var bar = W.el.querySelector('.pndm-wbar'); bar.classList.add('drag');
      var sx = e.clientX, sy = e.clientY, ox = parseFloat(W.el.style.left) || 0, oy = parseFloat(W.el.style.top) || 0;
      try { bar.setPointerCapture(e.pointerId); } catch (_) { }
      function mv(ev) { W.el.style.left = clampN(ox + (ev.clientX - sx), 0, window.innerWidth - W.el.offsetWidth) + 'px'; W.el.style.top = clampN(oy + (ev.clientY - sy), 26, window.innerHeight - 34) + 'px'; }
      function up(ev) { bar.classList.remove('drag'); bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); try { bar.releasePointerCapture(ev.pointerId); } catch (_) { } savePos(); }
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
    }
    function startResize(id, e) {
      var W = windows[id]; if (!W) return; e.preventDefault(); e.stopPropagation(); var rz = W.el.querySelector('.pndm-rz');
      var sx = e.clientX, sy = e.clientY, ow = W.el.offsetWidth, oh = W.el.offsetHeight;
      try { rz.setPointerCapture(e.pointerId); } catch (_) { }
      function mv(ev) { W.el.style.width = clampN(ow + (ev.clientX - sx), 240, window.innerWidth - 8) + 'px'; W.el.style.height = clampN(oh + (ev.clientY - sy), 200, window.innerHeight - 30) + 'px'; }
      function up(ev) { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); try { rz.releasePointerCapture(ev.pointerId); } catch (_) { } savePos(); }
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
    }
    function loadWinMsgs(id) { var W = windows[id]; if (!W) return; BE.sb.from('dm_messages').select('id,sender_id,body,refs,created_at').eq('thread_id', id).order('created_at', { ascending: true }).then(function (r) { if (!windows[id]) return; if (r && r.data) { W.msgs = r.data; renderWinMsgs(id); markReadWin(id); } }); }
    function renderWinMsgs(id) { var W = windows[id]; if (!W) return; var u = curUser(); var grp = (W.thread.kind !== 'dm') || ((W.thread.others || []).length > 1);
      W.bodyEl.innerHTML = W.msgs.map(function (m) { var mine = m.sender_id === (u && u.id); var refs = (m.refs || []).map(erefHtml).join(''); return '<div class="pndm-msg ' + (mine ? 'me' : 'them') + '">' + ((grp && !mine) ? ('<div class="who">' + esc(nameOf(m.sender_id)) + '</div>') : '') + (m.body ? esc(m.body) : '') + refs + '</div>'; }).join('') || '<div class="pndm-empty" style="padding:10px">Írj elsőként.</div>';
      W.bodyEl.scrollTop = W.bodyEl.scrollHeight; }
    function markReadWin(id) { var u = curUser(); if (!u) return; BE.sb.from('dm_reads').upsert({ thread_id: id, user_id: u.id, last_read_at: new Date().toISOString() }, { onConflict: 'thread_id,user_id' }).then(function () { var c = convos.filter(function (x) { return x.id === id; })[0]; if (c) { c.unread = 0; updateBadge(); } }); }
    function renderFootW(id) { var W = windows[id]; if (!W) return;
      W.footEl.innerHTML = (W.ref ? ('<div class="pndm-chip"><span>' + (REF_ICON[W.ref.kind] || '🔗') + '</span><span style="min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(W.ref.label || REF_LBL[W.ref.kind] || 'hivatkozás') + '</span><button class="wa" data-a="refx" style="color:var(--muted,#889);border:0;background:transparent;cursor:pointer">✕</button></div>') : '')
        + '<div class="pndm-in"><textarea class="pndm-wta" rows="1" placeholder="Üzenet…"></textarea><button class="pndm-send pndm-wsend" title="Küldés">➤</button></div>';
      var ta = W.footEl.querySelector('.pndm-wta'); ta.oninput = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 90) + 'px'; };
      ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWin(id); } };
      W.footEl.querySelector('.pndm-wsend').onclick = function () { sendWin(id); };
      var rx = W.footEl.querySelector('[data-a="refx"]'); if (rx) rx.onclick = function () { W.ref = null; renderFootW(id); };
      setTimeout(function () { try { ta.focus(); } catch (e) { } }, 20); }
    function sendWin(id) { var W = windows[id]; if (!W) return; var ta = W.footEl.querySelector('.pndm-wta'); var txt = (ta.value || '').trim(); var ref = W.ref; if (!txt && !ref) return; var u = curUser(); if (!u) return;
      ta.value = ''; ta.style.height = 'auto'; W.ref = null; renderFootW(id);
      var row = { thread_id: id, sender_id: u.id, body: txt }; if (ref) row.refs = [ref];
      BE.sb.from('dm_messages').insert(row).select('id,sender_id,body,refs,created_at').maybeSingle().then(function (r) { if (r && r.error) { alert(r.error.message); return; } if (r && r.data && windows[id]) { W.msgs.push(r.data); renderWinMsgs(id); }
        (W.thread.others || []).forEach(function (oid) { BE.sb.rpc('pr_notify_dm', { p_recipient: oid, p_thread: id, p_excerpt: txt || 'hivatkozást küldött' }).then(function () { }, function () { }); }); }); }
    function openWindow(thread, ref) {
      var id = thread.id;
      if (windows[id]) { var Ex = windows[id]; if (ref) { Ex.ref = ref; renderFootW(id); } if (Ex.minimized) restoreWindow(id); focusWindow(id); return; }
      var s = POS[id] || {};
      var w = clampN(s.w || 300, 240, window.innerWidth - 8), h = clampN(s.h || 384, 200, window.innerHeight - 40);
      var idx = Object.keys(windows).length;
      var x = (s.x != null) ? clampN(s.x, 0, window.innerWidth - w) : Math.max(8, window.innerWidth - w - 20 - (idx * 28) % 190);
      var y = (s.y != null) ? clampN(s.y, 28, window.innerHeight - h) : Math.max(30, window.innerHeight - h - 14);
      var el = document.createElement('div'); el.className = 'pndm-win'; el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.zIndex = (++zTop);
      el.innerHTML = '<div class="pndm-wbar" style="background:' + headColor(thread) + '">' + winTitle(thread) + '<span style="flex:1"></span><button class="wa" data-a="min" title="Kis méret">▁</button><button class="wa" data-a="close" title="Bezárás">✕</button></div><div class="pndm-wbody"></div><div class="pndm-wfoot"></div><div class="pndm-rz"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 6 L6 14 M14 10 L10 14"/></svg></div>';
      winLayer.appendChild(el);
      var W = windows[id] = { thread: thread, el: el, bodyEl: el.querySelector('.pndm-wbody'), footEl: el.querySelector('.pndm-wfoot'), msgs: [], ref: ref || null, minimized: false, unread: 0 };
      el.addEventListener('pointerdown', function () { focusWindow(id); }, true);
      var bar = el.querySelector('.pndm-wbar'); bar.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('.wa')) return; startDrag(id, e); });
      el.querySelector('.pndm-rz').addEventListener('pointerdown', function (e) { startResize(id, e); });
      el.querySelector('[data-a="min"]').onclick = function () { minimizeWindow(id); };
      el.querySelector('[data-a="close"]').onclick = function () { closeWindow(id); };
      W.bodyEl.innerHTML = '<div class="pndm-empty" style="padding:10px">Betöltés…</div>';
      renderFootW(id); loadWinMsgs(id); savePos();
      if (s.min) minimizeWindow(id);
    }

    function open() { scrim.classList.add('on'); panel.classList.add('on'); loadConvos(); ensureRealtime(); }
    function close() { scrim.classList.remove('on'); panel.classList.remove('on'); }
    function ensureRealtime() {
      var u = curUser(); if (ch || !(BE && BE.sb && u && u.id)) return;
      ch = BE.sb.channel('pndm:' + u.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, function (p) {
        var m = p && p.new; if (!m) return; var W = windows[m.thread_id]; var meId = curUser() && curUser().id;
        if (W && !W.msgs.some(function (x) { return x.id === m.id; })) {
          W.msgs.push(m);
          if (!W.minimized) { renderWinMsgs(m.thread_id); if (m.sender_id !== meId) markReadWin(m.thread_id); }
          else if (m.sender_id !== meId) { W.unread = (W.unread || 0) + 1; renderHeads(); }
        }
        scheduleReload();
      }).subscribe();
    }

    panel.querySelector('#pndm-close').onclick = close;
    panel.querySelector('#pndm-new').onclick = function () { newConvoView(); };
    backBtn.onclick = function () { renderList(); };
    scrim.onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('on')) close(); });

    // public API for entity "💬 Vélemény kérése" buttons across the app
    window.PRDM = {
      open: function () { open(); renderList(); },
      openWith: function (ref, otherId) { pendingRef = ref || null; if (otherId) { startDM(otherId); } else { open(); newConvoView(); } }
    };

    // launchers: the topbar icon (where the global bar shows) AND an always-visible floating button
    // (the reliable entry on app pages like Research where the fixed topbar is covered by the app chrome).
    function openMsg() { open(); renderList(); }
    var topL = document.getElementById('pn-dm'); if (topL) topL.onclick = openMsg;
    var fab = document.createElement('button'); fab.id = 'pndm-fab'; fab.title = 'Üzenetek'; fab.setAttribute('aria-label', 'Üzenetek — kollégák chat');
    fab.setAttribute('style', 'position:fixed;right:16px;bottom:66px;z-index:2147482000;width:46px;height:46px;border-radius:50%;border:0;background:var(--accent,#4f46e5);color:#fff;box-shadow:0 6px 18px rgba(20,24,40,.30);font-size:20px;cursor:pointer;line-height:1;padding:0');
    fab.innerHTML = '💬<span id="pndm-fab-badge" style="position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#e5484d;color:#fff;font-size:9px;font-weight:700;display:none;place-items:center;border:2px solid var(--app-bg,#fff)"></span>';
    fab.onclick = openMsg; document.body.appendChild(fab);
    setTimeout(function () { loadConvos(); ensureRealtime(); }, 1400);
    setInterval(function () { if (!panel.classList.contains('on')) loadConvos(); }, 45000);
  }

  if (!window.PR_NAV_BARLESS) {   // skip the bar/drawer CSS (incl. body padding-top) when only the bug widget is wanted
    var st = document.createElement('style'); st.id = 'pn-style'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
