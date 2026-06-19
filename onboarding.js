/* Aloud — registration onboarding + approval gate.
 * Loads AFTER universities.js, backend.js and store-cloud.js.
 * Cloud mode only. Reads the signed-in user's profile and either:
 *   - approved   → no gate (admins get a floating Admin button)
 *   - incomplete → onboarding form (affiliation + optional MTMT/ORCID) → pending
 *   - pending    → "awaiting approval" screen
 *   - rejected   → "not approved" screen
 *   - suspended  → "suspended" screen
 * Gate screens fully cover the app until the account is approved. */
(function () {
  'use strict';
  var BE = window.PR_BACKEND;
  if (!BE || BE.mode !== 'cloud') return;
  var sb = BE.sb, me = BE.user;
  if (!sb || !me) return;

  var ADMIN_URL = 'Admin.html';
  var UNIS = window.PR_UNIVERSITIES || [];

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('pr-ob-css')) return;
    var s = document.createElement('style'); s.id = 'pr-ob-css';
    s.textContent =
      '#pr-ob{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;'
      + 'background:radial-gradient(120% 120% at 50% -10%,#f1f0fe 0%,#eceef1 60%);font-family:"IBM Plex Sans",system-ui,sans-serif;overflow:auto}'
      + '#pr-ob .card{width:480px;max-width:100%;background:#fff;border-radius:18px;box-shadow:0 24px 64px rgba(20,24,40,.2);padding:34px 34px 28px;margin:auto}'
      + '#pr-ob .mk{width:50px;height:50px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#6366f1,#d946ef);box-shadow:0 6px 16px rgba(79,70,229,.4);margin-bottom:18px}'
      + '#pr-ob .mk span{width:17px;height:17px;border:0;border-top:3.2px solid #fff;border-left:3.2px solid #fff;border-radius:3px 0 0 0;transform:rotate(45deg);margin-top:4px}'
      + '#pr-ob h1{font-size:22px;margin:0 0 6px;letter-spacing:-.3px;color:#1a2030}'
      + '#pr-ob p.sub{font-size:14px;color:#5b6473;margin:0 0 22px;line-height:1.55}'
      + '#pr-ob .who{display:flex;align-items:center;gap:11px;background:#f5f6f9;border:1px solid #e6e8ee;border-radius:12px;padding:10px 13px;margin-bottom:20px}'
      + '#pr-ob .who .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:14px;flex:none;background-size:cover}'
      + '#pr-ob .who b{font-size:14px;display:block} #pr-ob .who span{font-size:12.5px;color:#5b6473}'
      + '#pr-ob label{display:block;font-size:12.5px;font-weight:700;color:#3a4250;margin:0 0 6px}'
      + '#pr-ob .opt{font-weight:500;color:#8a92a0}'
      + '#pr-ob .field{margin-bottom:16px;position:relative}'
      + '#pr-ob input{width:100%;height:42px;border:1px solid #d9dce3;border-radius:10px;padding:0 13px;font-family:inherit;font-size:14px;color:#1a2030;background:#fff}'
      + '#pr-ob input:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.14)}'
      + '#pr-ob input.bad{border-color:#d92d20;box-shadow:0 0 0 3px rgba(217,45,32,.12)}'
      + '#pr-ob .hint{font-size:11.5px;color:#8a92a0;margin-top:5px}'
      + '#pr-ob .err{font-size:11.5px;color:#b42318;margin-top:5px;display:none}'
      + '#pr-ob .err.on{display:block}'
      + '#pr-ob .menu{position:absolute;left:0;right:0;top:70px;z-index:5;background:#fff;border:1px solid #e6e8ee;border-radius:11px;box-shadow:0 12px 32px rgba(16,24,40,.14);max-height:230px;overflow:auto;display:none}'
      + '#pr-ob .menu.on{display:block}'
      + '#pr-ob .menu .it{padding:9px 13px;font-size:13.5px;color:#2a3140;cursor:pointer;border-bottom:1px solid #f1f2f5}'
      + '#pr-ob .menu .it:last-child{border-bottom:0}'
      + '#pr-ob .menu .it:hover,#pr-ob .menu .it.on{background:#ecebfd;color:#4338ca}'
      + '#pr-ob .menu .add{color:#4f46e5;font-weight:600}'
      + '#pr-ob .btn{width:100%;height:46px;border:0;border-radius:11px;background:#4f46e5;color:#fff;font-family:inherit;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(79,70,229,.3)}'
      + '#pr-ob .btn:hover{background:#4338ca} #pr-ob .btn:disabled{opacity:.55;cursor:default;box-shadow:none}'
      + '#pr-ob .ghost{display:block;margin:14px auto 0;border:0;background:none;color:#8a92a0;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer}'
      + '#pr-ob .ghost:hover{color:#4f46e5}'
      + '#pr-ob .status-ic{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;margin:0 auto 18px}'
      + '#pr-ob .status-ic svg{width:30px;height:30px}'
      + '#pr-ob.center .card{text-align:center}'
      + '#pr-ob .pill{display:inline-block;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:14px}'
      + '#pr-ob-admin{position:fixed;right:18px;bottom:18px;z-index:900;display:inline-flex;align-items:center;gap:8px;background:#1a2030;color:#fff;border:0;border-radius:11px;padding:11px 16px;font-family:"IBM Plex Sans",sans-serif;font-size:13.5px;font-weight:600;cursor:pointer;box-shadow:0 8px 22px rgba(16,20,40,.3);text-decoration:none}'
      + '#pr-ob-admin:hover{background:#2a3344}';
    document.head.appendChild(s);
  }

  function avatar() {
    if (me.avatar) return '<span class="av" style="background-image:url(' + me.avatar + ')"></span>';
    var init = (me.name || 'U').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    return '<span class="av" style="background:' + (me.color || '#4f46e5') + '">' + init + '</span>';
  }
  function mount(html, center) {
    css();
    var prev = document.getElementById('pr-ob'); if (prev) prev.remove();
    var d = document.createElement('div'); d.id = 'pr-ob'; if (center) d.className = 'center';
    d.innerHTML = '<div class="card">' + html + '</div>';
    (document.body || document.documentElement).appendChild(d);
    return d;
  }
  function unmount() { var d = document.getElementById('pr-ob'); if (d) d.remove(); }
  function whoBlock() { return '<div class="who">' + avatar() + '<div><b>' + esc(me.name || 'You') + '</b><span>' + esc(me.email || '') + '</span></div></div>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function signOutBtn() {
    var b = document.getElementById('pr-ob-signout');
    if (b) b.onclick = function () { BE.signOut(); };
  }

  /* ---------- splash while we check ---------- */
  function splash() { mount('<div class="mk"><span></span></div><h1>Checking your access…</h1><p class="sub">One moment while we load your account.</p>'); }

  /* ---------- onboarding form ---------- */
  function form() {
    var html = ''
      + '<div class="mk"><span></span></div>'
      + '<h1>Welcome to Publify</h1>'
      + '<p class="sub">Publify is free for academic research. Tell us where you work so an administrator can approve your account.</p>'
      + whoBlock()
      + '<div class="field">'
      + '  <label for="ob-aff">University / institution</label>'
      + '  <input id="ob-aff" autocomplete="off" placeholder="Start typing to search…" />'
      + '  <div class="menu" id="ob-menu"></div>'
      + '  <div class="err" id="ob-aff-err">Please select or enter your institution.</div>'
      + '</div>'
      + '<div class="field">'
      + '  <label for="ob-mtmt">MTMT identifier <span class="opt">— optional</span></label>'
      + '  <input id="ob-mtmt" inputmode="numeric" placeholder="e.g. 10012345" />'
      + '  <div class="err" id="ob-mtmt-err">MTMT ID should be digits only.</div>'
      + '</div>'
      + '<div class="field">'
      + '  <label for="ob-orcid">ORCID iD <span class="opt">— optional</span></label>'
      + '  <input id="ob-orcid" placeholder="0000-0000-0000-0000" maxlength="19" />'
      + '  <div class="hint">Format: 0000-0000-0000-0000 (last character may be X).</div>'
      + '  <div class="err" id="ob-orcid-err">Enter a valid ORCID (0000-0000-0000-000X).</div>'
      + '</div>'
      + '<button class="btn" id="ob-submit">Submit for approval</button>'
      + '<button class="ghost" id="pr-ob-signout">Sign out</button>';
    mount(html);
    signOutBtn();

    var aff = document.getElementById('ob-aff'), menu = document.getElementById('ob-menu');
    var affErr = document.getElementById('ob-aff-err');
    function render(q) {
      var ql = q.trim().toLowerCase();
      var list = ql ? UNIS.filter(function (u) { return u.toLowerCase().indexOf(ql) >= 0; }).slice(0, 8) : UNIS.slice(0, 8);
      var h = list.map(function (u) { return '<div class="it" data-v="' + esc(u) + '">' + esc(u) + '</div>'; }).join('');
      if (ql && !UNIS.some(function (u) { return u.toLowerCase() === ql; })) {
        h += '<div class="it add" data-v="' + esc(q.trim()) + '">Use “' + esc(q.trim()) + '”</div>';
      }
      menu.innerHTML = h; menu.classList.toggle('on', !!h);
    }
    aff.addEventListener('focus', function () { render(aff.value); });
    aff.addEventListener('input', function () { aff.classList.remove('bad'); affErr.classList.remove('on'); render(aff.value); });
    menu.addEventListener('mousedown', function (e) {
      var it = e.target.closest('.it'); if (!it) return; e.preventDefault();
      aff.value = it.getAttribute('data-v'); menu.classList.remove('on');
    });
    document.addEventListener('mousedown', function (e) { if (!menu.contains(e.target) && e.target !== aff) menu.classList.remove('on'); });

    var orcid = document.getElementById('ob-orcid');
    orcid.addEventListener('input', function () {
      var v = orcid.value.replace(/[^0-9X]/gi, '').toUpperCase().slice(0, 16);
      var out = ''; for (var i = 0; i < v.length; i++) { if (i && i % 4 === 0) out += '-'; out += v[i]; }
      orcid.value = out; orcid.classList.remove('bad'); document.getElementById('ob-orcid-err').classList.remove('on');
    });

    document.getElementById('ob-submit').addEventListener('click', submit);
  }

  function submit() {
    var aff = document.getElementById('ob-aff'), mtmt = document.getElementById('ob-mtmt'), orcid = document.getElementById('ob-orcid');
    var btn = document.getElementById('ob-submit');
    var ok = true;
    if (!aff.value.trim()) { aff.classList.add('bad'); document.getElementById('ob-aff-err').classList.add('on'); ok = false; }
    if (mtmt.value.trim() && !/^\d+$/.test(mtmt.value.trim())) { mtmt.classList.add('bad'); document.getElementById('ob-mtmt-err').classList.add('on'); ok = false; }
    var orc = orcid.value.trim();
    if (orc && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orc)) { orcid.classList.add('bad'); document.getElementById('ob-orcid-err').classList.add('on'); ok = false; }
    if (!ok) return;
    btn.disabled = true; btn.textContent = 'Submitting…';
    sb.from('profiles').update({
      affiliation: aff.value.trim(),
      mtmt_id: mtmt.value.trim() || null,
      orcid: orc || null,
      status: 'pending'
    }).eq('id', me.id).then(function (r) {
      if (r && r.error) { btn.disabled = false; btn.textContent = 'Submit for approval'; alert('Could not save: ' + r.error.message); return; }
      me.status = 'pending'; pending();
    }, function () { btn.disabled = false; btn.textContent = 'Submit for approval'; });
  }

  /* ---------- status screens ---------- */
  function statusScreen(opts) {
    var html = ''
      + '<div class="status-ic" style="background:' + opts.bg + '">' + opts.icon + '</div>'
      + '<div style="text-align:center"><span class="pill" style="color:' + opts.fg + ';background:' + opts.bg + '">' + opts.tag + '</span></div>'
      + '<h1 style="text-align:center">' + opts.title + '</h1>'
      + '<p class="sub" style="text-align:center">' + opts.body + '</p>'
      + whoBlock()
      + '<button class="ghost" id="pr-ob-signout">Sign out</button>';
    mount(html, true); signOutBtn();
  }
  var icCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="#1f8a5b" stroke-width="2"><path d="M5 12.5l4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var icClock = '<svg viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var icX = '<svg viewBox="0 0 24 24" fill="none" stroke="#b42318" stroke-width="2"><path d="M7 7l10 10M17 7L7 17" stroke-linecap="round"/></svg>';
  var icPause = '<svg viewBox="0 0 24 24" fill="none" stroke="#5b6473" stroke-width="2"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

  function pending() {
    statusScreen({ tag: 'Awaiting approval', fg: '#b45309', bg: '#fdf6e3', icon: icClock,
      title: "You're all set — pending approval",
      body: 'Thanks! Your details were submitted. An administrator will review your account shortly. You\u2019ll get access as soon as it\u2019s approved.' });
  }
  function rejected() {
    statusScreen({ tag: 'Not approved', fg: '#b42318', bg: '#fdeef0', icon: icX,
      title: 'Your account wasn\u2019t approved',
      body: 'An administrator did not approve this account for Publify. If you think this is a mistake, please contact your administrator.' });
  }
  function suspended() {
    statusScreen({ tag: 'Suspended', fg: '#5b6473', bg: '#eef0f3', icon: icPause,
      title: 'Your account is suspended',
      body: 'Access to Publify has been paused for this account. Please contact your administrator to restore it.' });
  }

  /* ---------- admin launcher (approved admins) ---------- */
  function adminButton() {
    if (document.getElementById('pr-ob-admin')) return;
    css();
    var a = document.createElement('a'); a.id = 'pr-ob-admin'; a.href = ADMIN_URL;
    a.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 1.7l5.5 2.4V8c0 3.4-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.4 2.5 8V4.1z"/><path d="M5.8 8l1.6 1.6 3-3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Admin';
    document.body.appendChild(a);
  }

  /* ---------- route by status ---------- */
  function route(status, role, affiliation) {
    // Admin access now lives in the React top bar (app.jsx / dashboard.jsx), gated on role,
    // so we no longer add the floating bottom-right button that overlapped the tweaks gear.
    if (status === 'approved') { unmount(); return; }
    if (status === 'pending') return pending();
    if (status === 'rejected') return rejected();
    if (status === 'suspended') return suspended();
    // incomplete / unknown → onboarding (skip form if affiliation already set yet status missing)
    return form();
  }

  function check() {
    sb.from('profiles').select('status,role,affiliation').eq('id', me.id).maybeSingle().then(function (r) {
      var d = (r && r.data) || {};
      var status = d.status || 'incomplete';
      me.status = status; me.role = d.role || 'user'; me.affiliation = d.affiliation || '';
      route(status, me.role, me.affiliation);
    }, function () {
      // network hiccup: don't lock the user out hard — show onboarding which will retry on submit
      route('incomplete');
    });
  }

  // cover immediately so a non-approved user never sees the app flash
  if (document.body) splash(); else document.addEventListener('DOMContentLoaded', splash);
  // also react to the profile event backend.js dispatches (keeps in sync)
  window.addEventListener('pr-profile', function (e) {
    var d = e.detail || {}; if (d.status) route(d.status, d.role, d.affiliation);
  });
  // run the check (small delay lets supabase session settle)
  setTimeout(check, 60);
})();
