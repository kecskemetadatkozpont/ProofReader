/* ProofReader — backend bootstrap: real Google auth + session, on top of the
 * local mock in auth.js. Loads AFTER supabase-js, config.js and auth.js.
 *
 * Modes:
 *   'cloud'  — a Supabase session exists → real identity + cloud store.
 *   'demo'   — user chose demo mode → keep the local mock (auth.js/store.js).
 *   'signin' — no session, no choice yet → show the sign-in overlay.
 *
 * In cloud mode we OVERRIDE window.PRAuth with a real implementation that keeps
 * the exact surface the app already calls (current/byId/byEmail/users/signIn/
 * signOut/initials/startPresence/SEED). store-cloud.js does the same for PRStore.
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

  function projRef() { try { return cfg.supabaseUrl.match(/https?:\/\/([^.]+)\./)[1]; } catch (e) { return ''; } }
  function readPersistedSession() {
    try {
      var raw = localStorage.getItem('sb-' + projRef() + '-auth-token');
      if (!raw) return null;
      var o = JSON.parse(raw); var s = o && o.currentSession ? o.currentSession : o;
      return (s && s.user) ? s : null;
    } catch (e) { return null; }
  }
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

  var MODE_KEY = 'proofreader:mode';
  var persisted = readPersistedSession();
  var chosenDemo = localStorage.getItem(MODE_KEY) === 'demo';
  var mode = persisted ? 'cloud' : (chosenDemo ? 'demo' : 'signin');
  var me = persisted ? userFromSession(persisted) : null;

  // profile cache (sync lookups for collaborators); seed with myself
  var PROFILES = {};
  if (me) PROFILES[me.id] = me;
  (function seedProfiles() { try { var c = JSON.parse(localStorage.getItem('proofreader:profiles') || '{}'); Object.keys(c).forEach(function (k) { if (!PROFILES[k]) PROFILES[k] = c[k]; }); } catch (e) { } })();
  function cacheProfiles() { try { localStorage.setItem('proofreader:profiles', JSON.stringify(PROFILES)); } catch (e) { } }

  function signInWithGoogle() {
    localStorage.removeItem(MODE_KEY);
    return sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0] } });
  }
  function chooseDemo() { localStorage.setItem(MODE_KEY, 'demo'); removeOverlay(); }
  function signOut() {
    localStorage.removeItem(MODE_KEY);
    sb.auth.signOut().then(function () { location.reload(); }).catch(function () { location.reload(); });
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

  /* ---- async reconciliation: refresh real session + my profile ---- */
  sb.auth.getSession().then(function (res) {
    var s = res && res.data && res.data.session;
    if (s && mode !== 'cloud') {
      // signed in (e.g. just returned from Google) but booted non-cloud → reboot
      if (!sessionStorage.getItem('pr_reboot')) { sessionStorage.setItem('pr_reboot', '1'); location.reload(); }
      return;
    }
    sessionStorage.removeItem('pr_reboot');
    if (s && me) {
      var fresh = userFromSession(s); if (fresh) { me = Object.assign(me, fresh); PROFILES[me.id] = me; }
      // pull my plan/profile row
      sb.from('profiles').select('plan,name,avatar_url,color').eq('id', me.id).maybeSingle().then(function (r) {
        if (r && r.data) { me.plan = r.data.plan || 'free'; if (r.data.color) me.color = r.data.color; PROFILES[me.id] = me; cacheProfiles(); if (window.PRStore && window.PRStore._notify) window.PRStore._notify(); }
      });
    }
  }).catch(function () { });

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' && mode !== 'cloud') { if (!sessionStorage.getItem('pr_reboot')) { sessionStorage.setItem('pr_reboot', '1'); location.reload(); } }
  });

  /* ---- sign-in overlay (only when no session & no demo choice) ---- */
  function removeOverlay() { var el = document.getElementById('pr-signin'); if (el) el.remove(); }
  function showOverlay() {
    if (document.getElementById('pr-signin')) return;
    var css = '#pr-signin{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 120% at 50% 0%,#f4f5fb 0%,#eceef1 60%);font-family:"IBM Plex Sans",system-ui,sans-serif}'
      + '#pr-signin .card{width:380px;max-width:calc(100% - 32px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(20,24,40,.18);padding:38px 34px;text-align:center}'
      + '#pr-signin .mk{width:54px;height:54px;border-radius:15px;margin:0 auto 16px;display:grid;place-items:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 6px 16px rgba(79,70,229,.4)}'
      + '#pr-signin .mk span{width:23px;height:23px;border-radius:50%;border:3.5px solid #fff;border-right-color:transparent;transform:rotate(-20deg)}'
      + '#pr-signin h1{font-size:21px;margin:0 0 4px;letter-spacing:-.3px;color:#1d2430}'
      + '#pr-signin p{font-size:13.5px;color:#5b6473;margin:0 0 24px;line-height:1.5}'
      + '#pr-signin .g{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:46px;border:1px solid #dadce0;border-radius:11px;background:#fff;color:#1d2430;font-size:14.5px;font-weight:600;cursor:pointer}'
      + '#pr-signin .g:hover{background:#f7f8fc;border-color:#c7cad1}'
      + '#pr-signin .demo{margin-top:14px;border:0;background:transparent;color:#6b7280;font-size:12.5px;font-weight:600;cursor:pointer}'
      + '#pr-signin .demo:hover{color:#4f46e5}'
      + '#pr-signin .sep{margin:22px 0 4px;border-top:1px solid #eceef1}'
      + '#pr-signin .note{font-size:11px;color:#9aa1ac;margin-top:18px;line-height:1.5}';
    var g = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.3 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.5 6.9l7 5.4C43.2 37.5 46.1 31.6 46.1 24.5z"/><path fill="#FBBC05" d="M10.5 28.3c-.5-1.4-.7-2.9-.7-4.3s.3-3 .7-4.3l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.4l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7-5.4c-2 1.3-4.5 2.1-8.3 2.1-6.3 0-11.6-3.8-13.5-9.2l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var d = document.createElement('div'); d.id = 'pr-signin';
    d.innerHTML = '<div class="card"><div class="mk"><span></span></div>'
      + '<h1>Sign in to ProofReader</h1><p>Your projects sync to the cloud and stay safe across devices.</p>'
      + '<button class="g" id="pr-google">' + g + 'Continue with Google</button>'
      + '<div class="sep"></div>'
      + '<button class="demo" id="pr-demo">Continue in demo mode (this browser only)</button>'
      + '<div class="note">Demo mode keeps everything in this browser, like before. Sign in to save to the cloud.</div></div>';
    document.body.appendChild(d);
    document.getElementById('pr-google').onclick = function () { this.textContent = 'Redirecting…'; signInWithGoogle(); };
    document.getElementById('pr-demo').onclick = chooseDemo;
  }
  if (mode === 'signin') {
    if (document.body) showOverlay(); else document.addEventListener('DOMContentLoaded', showOverlay);
  }
})();
