/* ProofReader — backend bootstrap: real Google auth + session, on top of the
 * local mock in auth.js. Loads AFTER supabase-js, config.js and auth.js.
 *
 * Modes:
 *   'cloud'   — a session exists → real identity + cloud store.
 *   'pending' — just returned from Google (OAuth hash/code present) → show a
 *               "Signing you in…" splash, resolve the session, then reload.
 *   'demo'    — user chose demo mode → keep the local mock (auth.js/store.js).
 *   'signin'  — no session, no choice → show the sign-in overlay.
 *
 * Robustness: the synchronous boot decision reads OUR OWN session cache
 * (proofreader:session), written whenever Supabase reports a session. This is
 * decoupled from supabase-js's internal storage format, which removes the
 * "logged in but bounced back to Continue" race. Supabase still owns the real
 * token used for authorized queries; our cache only drives the boot UI.
 */
(function () {
  'use strict';
  var cfg = window.PR_CONFIG;
  if (!cfg || !window.supabase) { console.warn('[PR] backend disabled — config or supabase-js missing'); return; }

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
  window.PR_SB = sb;

  var PALETTE = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626'];
  function colorFor(id) { var h = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }

  function userFromSession(s) {
    if (!s || !s.user) return null;
    var u = s.user, m = u.user_metadata || {};
    return {
      id: u.id, email: u.email || '',
      name: m.full_name || m.name || (u.email ? u.email.split('@')[0] : 'You'),
      avatar: m.avatar_url || m.picture || '',
      color: colorFor(u.id), plan: 'free'
    };
  }

  /* ---- our own session cache (decoupled from supabase internals) ---- */
  var SESSION_KEY = 'proofreader:session';
  function readMyUser() { try { var o = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return (o && o.user && o.user.id) ? o.user : null; } catch (e) { return null; } }
  function writeMyUser(user) { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user: user, at: Date.now() })); } catch (e) { } }
  function clearMyUser() { try { localStorage.removeItem(SESSION_KEY); } catch (e) { } }

  // Self-heal: make sure my profile row exists (covers any account whose
  // sign-up trigger didn't create one). Allowed by insert_own_profile +
  // write_own_profile RLS (id must equal auth.uid()).
  function ensureProfile(u) {
    if (!u || !u.id) return;
    sb.from('profiles').upsert({ id: u.id, email: u.email, name: u.name, avatar_url: u.avatar }, { onConflict: 'id' })
      .then(function (r) { if (r && r.error) console.warn('[PR] profile upsert:', r.error.message); })
      .catch(function () { });
  }

  /* ---- detect a return from the OAuth provider ---- */
  function oauthError() {
    var h = location.hash || '', q = location.search || '';
    var m = /[#&?]error=([^&]+)/.exec(h) || /[#&?]error=([^&]+)/.exec(q);
    if (!m) return null;
    var dm = /error_description=([^&]+)/.exec(h) || /error_description=([^&]+)/.exec(q);
    try { return decodeURIComponent((dm ? dm[1] : m[1]).replace(/\+/g, ' ')); } catch (e) { return m[1]; }
  }
  function hasOAuthReturn() {
    return /[#&](access_token|provider_token|refresh_token)=/.test(location.hash || '')
      || (/[?&]code=/.test(location.search || '') && !/[?&]error=/.test(location.search || ''));
  }

  var MODE_KEY = 'proofreader:mode';
  var authErr = oauthError();
  var savedUser = readMyUser();
  var chosenDemo = localStorage.getItem(MODE_KEY) === 'demo';
  var returning = hasOAuthReturn() || !!authErr;
  var mode = savedUser ? 'cloud'
    : (returning ? 'pending'
      : (chosenDemo ? 'demo' : 'signin'));
  var me = savedUser || null;

  // profile cache (sync lookups for collaborators); seed with myself
  var PROFILES = {};
  if (me) PROFILES[me.id] = me;
  (function seedProfiles() { try { var c = JSON.parse(localStorage.getItem('proofreader:profiles') || '{}'); Object.keys(c).forEach(function (k) { if (!PROFILES[k]) PROFILES[k] = c[k]; }); } catch (e) { } })();
  function cacheProfiles() { try { localStorage.setItem('proofreader:profiles', JSON.stringify(PROFILES)); } catch (e) { } }

  function cleanUrl() { return location.href.split('#')[0].split('?')[0]; }
  function rebootInto(url) { if (sessionStorage.getItem('pr_reboot') === '2') return; sessionStorage.setItem('pr_reboot', '2'); location.replace(url || cleanUrl()); }

  function signInWithGoogle() {
    localStorage.removeItem(MODE_KEY);
    sessionStorage.removeItem('pr_reboot');
    return sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: cleanUrl() } });
  }
  function chooseDemo() { localStorage.setItem(MODE_KEY, 'demo'); removeOverlay(); removeSplash(); }
  function signOut() {
    localStorage.removeItem(MODE_KEY);
    clearMyUser();
    sb.auth.signOut().then(function () { location.replace(cleanUrl()); }).catch(function () { location.replace(cleanUrl()); });
  }

  var BE = window.PR_BACKEND = {
    sb: sb, mode: mode, user: me, colorFor: colorFor,
    profiles: PROFILES, cacheProfiles: cacheProfiles,
    signInWithGoogle: signInWithGoogle, chooseDemo: chooseDemo, signOut: signOut,
    ready: Promise.resolve()
  };

  /* ---- cloud identity overrides PRAuth ---- */
  if (mode === 'cloud') {
    var realPresence = function (projectId, userId) {
      var listeners = [], live = [];
      var ch = sb.channel('presence:' + projectId, { config: { presence: { key: String(userId) } } });
      function emit() {
        var st = ch.presenceState(); live = [];
        Object.keys(st).forEach(function (k) { if (k !== String(userId)) (st[k] || []).forEach(function (mt) { live.push({ userId: k, projectId: projectId, at: Date.now(), name: mt.name, color: mt.color, cursor: mt.cursor }); }); });
        listeners.forEach(function (cb) { cb(live); });
      }
      ch.on('presence', { event: 'sync' }, emit);
      ch.subscribe(function (status) { if (status === 'SUBSCRIBED') ch.track({ userId: userId, name: me && me.name, color: me && me.color, at: Date.now() }); });
      return {
        on: function (cb) { listeners.push(cb); cb(live); },
        update: function (cursor) { try { ch.track({ userId: userId, name: me && me.name, color: me && me.color, cursor: cursor, at: Date.now() }); } catch (e) { } },
        stop: function () { try { ch.untrack(); sb.removeChannel(ch); } catch (e) { } }
      };
    };
    window.PRAuth = {
      current: function () { return me; },
      byId: function (id) { return PROFILES[id] || (id === (me && me.id) ? me : null); },
      byEmail: function (email) { var e = String(email || '').toLowerCase(); return Object.keys(PROFILES).map(function (k) { return PROFILES[k]; }).filter(function (u) { return (u.email || '').toLowerCase() === e; })[0] || null; },
      users: function () { return Object.keys(PROFILES).map(function (k) { return PROFILES[k]; }); },
      signIn: function () { return signInWithGoogle(); },
      signOut: signOut,
      initials: initials,
      startPresence: realPresence,
      SEED: []
    };
  }

  /* ---- async reconciliation ---- */
  sb.auth.getSession().then(function (res) {
    var s = res && res.data && res.data.session;
    if (s) {
      var u = userFromSession(s); if (u) writeMyUser(u);
      if (mode !== 'cloud') { rebootInto(cleanUrl()); return; }   // pending/signin → become cloud
      sessionStorage.removeItem('pr_reboot');
      if (u && me) { me = Object.assign(me, u); PROFILES[me.id] = me; }
      ensureProfile(me);
      sb.from('profiles').select('plan,name,avatar_url,color').eq('id', me.id).maybeSingle().then(function (r) {
        if (r && r.data) { me.plan = r.data.plan || 'free'; if (r.data.color) me.color = r.data.color; PROFILES[me.id] = me; cacheProfiles(); if (window.PRStore && window.PRStore._notify) window.PRStore._notify(); }
      }).catch(function () { });
    } else {
      // no real session
      if (mode === 'cloud') { clearMyUser(); rebootInto(cleanUrl()); return; }   // stale cache → sign out
      if (mode === 'pending') { showSigninError(authErr || 'Sign-in didn’t complete. Please try again.'); }
    }
  }).catch(function (e) {
    if (mode === 'pending') showSigninError('Could not reach the sign-in service. Check your connection and try again.');
  });

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_IN' && session) { writeMyUser(userFromSession(session)); if (mode !== 'cloud') rebootInto(cleanUrl()); }
    if (event === 'SIGNED_OUT') { clearMyUser(); }
  });

  // Safety net: if pending hangs (no session, no error) let the user retry.
  if (mode === 'pending') { setTimeout(function () { if (!readMyUser() && document.getElementById('pr-splash')) showSigninError(authErr || 'Sign-in is taking too long. Please try again.'); }, 7000); }

  /* ---- shared overlay styles ---- */
  function injectCss() {
    if (document.getElementById('pr-auth-css')) return;
    var css = '#pr-signin,#pr-splash{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 120% at 50% 0%,#f4f5fb 0%,#eceef1 60%);font-family:"IBM Plex Sans",system-ui,sans-serif}'
      + '.pr-card{width:380px;max-width:calc(100% - 32px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(20,24,40,.18);padding:38px 34px;text-align:center}'
      + '.pr-mk{width:54px;height:54px;border-radius:15px;margin:0 auto 16px;display:grid;place-items:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 6px 16px rgba(79,70,229,.4)}'
      + '.pr-mk span{width:23px;height:23px;border-radius:50%;border:3.5px solid #fff;border-right-color:transparent;transform:rotate(-20deg)}'
      + '.pr-mk.spin span{animation:pr-spin .8s linear infinite}@keyframes pr-spin{to{transform:rotate(340deg)}}'
      + '.pr-card h1{font-size:21px;margin:0 0 4px;letter-spacing:-.3px;color:#1d2430}'
      + '.pr-card p{font-size:13.5px;color:#5b6473;margin:0 0 24px;line-height:1.5}'
      + '.pr-g{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:46px;border:1px solid #dadce0;border-radius:11px;background:#fff;color:#1d2430;font-size:14.5px;font-weight:600;cursor:pointer}'
      + '.pr-g:hover{background:#f7f8fc;border-color:#c7cad1}'
      + '.pr-demo{margin-top:14px;border:0;background:transparent;color:#6b7280;font-size:12.5px;font-weight:600;cursor:pointer}'
      + '.pr-demo:hover{color:#4f46e5}'
      + '.pr-sep{margin:22px 0 4px;border-top:1px solid #eceef1}'
      + '.pr-note{font-size:11px;color:#9aa1ac;margin-top:18px;line-height:1.5}'
      + '.pr-err{font-size:12.5px;color:#b42318;background:#fdeef0;border:1px solid #fbd5d5;border-radius:9px;padding:9px 11px;margin:0 0 18px;line-height:1.45;word-break:break-word}';
    var st = document.createElement('style'); st.id = 'pr-auth-css'; st.textContent = css; document.head.appendChild(st);
  }
  var GBTN = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.3 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.5 6.9l7 5.4C43.2 37.5 46.1 31.6 46.1 24.5z"/><path fill="#FBBC05" d="M10.5 28.3c-.5-1.4-.7-2.9-.7-4.3s.3-3 .7-4.3l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.4l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7-5.4c-2 1.3-4.5 2.1-8.3 2.1-6.3 0-11.6-3.8-13.5-9.2l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

  /* ---- "Signing you in…" splash (pending) ---- */
  function removeSplash() { var el = document.getElementById('pr-splash'); if (el) el.remove(); }
  function showSplash() {
    if (document.getElementById('pr-splash')) return; injectCss();
    var d = document.createElement('div'); d.id = 'pr-splash';
    d.innerHTML = '<div class="pr-card"><div class="pr-mk spin"><span></span></div>'
      + '<h1>Signing you in…</h1><p>Connecting your Google account. This only takes a moment.</p></div>';
    (document.body || document.documentElement).appendChild(d);
  }

  /* ---- sign-in overlay ---- */
  function removeOverlay() { var el = document.getElementById('pr-signin'); if (el) el.remove(); }
  function showOverlay(errMsg) {
    removeSplash();
    if (document.getElementById('pr-signin')) { if (errMsg) { var ex = document.querySelector('#pr-signin .pr-err'); if (ex) ex.textContent = errMsg; } return; }
    injectCss();
    var d = document.createElement('div'); d.id = 'pr-signin';
    d.innerHTML = '<div class="pr-card"><div class="pr-mk"><span></span></div>'
      + '<h1>Sign in to ProofReader</h1><p>Your projects sync to the cloud and stay safe across devices.</p>'
      + (errMsg ? '<div class="pr-err">' + errMsg + '</div>' : '')
      + '<button class="pr-g" id="pr-google">' + GBTN + 'Continue with Google</button>'
      + '<div class="pr-sep"></div>'
      + '<button class="pr-demo" id="pr-demo">Continue in demo mode (this browser only)</button>'
      + '<div class="pr-note">Demo mode keeps everything in this browser, like before. Sign in to save to the cloud.</div></div>';
    (document.body || document.documentElement).appendChild(d);
    document.getElementById('pr-google').onclick = function () { this.textContent = 'Redirecting…'; signInWithGoogle(); };
    document.getElementById('pr-demo').onclick = chooseDemo;
  }
  function showSigninError(msg) { console.warn('[PR] sign-in error:', msg); try { history.replaceState(null, '', cleanUrl()); } catch (e) { } showOverlay(msg); }

  // initial paint
  function paint() { if (mode === 'pending') showSplash(); else if (mode === 'signin') showOverlay(authErr || null); }
  if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint);
})();
