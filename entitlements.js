/* Publify — frontend entitlement cache (migration-49). COSMETIC ONLY.
 * Hides/disables UI a user isn't entitled to. It is NOT a security boundary — the
 * server (_shared/entitlement.ts in every AI edge fn) is authoritative. For UI-only
 * (enforced=false) features there is, by design, no boundary; fail-open is fine there.
 *
 * Load with a plain <script src="entitlements.js"> AFTER backend.js and BEFORE page JSX.
 * Usage:  await window.PREnt.load(sb, uid);  then  PREnt.can('literature_study'). */
(function () {
  'use strict';
  var cache = null;
  var inflight = null;

  function load(sb, uid) {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    if (!sb || !uid) return Promise.resolve(null);
    inflight = Promise.all([
      sb.from('profiles').select('status,features,model_allowlist,ai_model,can_workflows,can_figures').eq('id', uid).maybeSingle(),
      sb.from('feature_catalog').select('key,default_on,enforced')
    ]).then(function (res) {
      var prof = (res[0] && res[0].data) || {};
      var defs = {}, enf = {};
      ((res[1] && res[1].data) || []).forEach(function (r) { defs[r.key] = r.default_on; enf[r.key] = r.enforced; });
      cache = { prof: prof, defaults: defs, enforced: enf };
      inflight = null;
      return cache;
    }, function () { inflight = null; return null; });
    return inflight;
  }

  window.PREnt = {
    load: load,
    loaded: function () { return !!cache; },
    // cosmetic gate — fail-open when unloaded (the server backstops enforced features)
    can: function (key) {
      if (!cache) return true;
      if (key === 'session_workflow_mode') return !!cache.prof.can_workflows;
      if (key === 'paper_figure') return !!cache.prof.can_figures;
      var f = cache.prof.features || {};
      if (Object.prototype.hasOwnProperty.call(f, key)) return !!f[key];
      return cache.defaults[key] !== false;   // catalog default (unknown key → treated as on cosmetically)
    },
    enforced: function (key) { return !!(cache && cache.enforced[key]); },
    active: function () { return !!(cache && cache.prof.status === 'approved'); },
    modelAllowlist: function () { return cache ? (cache.prof.model_allowlist || null) : null; },
    // full-screen "no access" block for a whole page/menu-item (idempotent). Callers decide WHEN to block
    // (nav.js guards the current page after load; admins bypass). Data pages stay RLS-isolated regardless.
    showBlock: function (label) {
      if (document.getElementById('pr-ent-block')) return;
      var el = document.createElement('div');
      el.id = 'pr-ent-block';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--softer,#fafbfc);color:var(--ink,#1a2030);font-family:\'IBM Plex Sans\',system-ui,-apple-system,sans-serif';
      el.innerHTML = '<div style="max-width:440px;text-align:center">'
        + '<div style="font-size:46px;margin-bottom:14px">🔒</div>'
        + '<h1 style="font-size:21px;margin:0 0 8px;letter-spacing:-.2px">Ehhez a funkcióhoz nincs hozzáférésed</h1>'
        + '<p style="font-size:14px;color:var(--muted,#5b6473);line-height:1.55;margin:0 0 22px">A(z) <b>' + (label || 'ez a') + '</b> funkciót az adminisztrátorod nem engedélyezte a fiókodhoz. Ha szükséged van rá, kérd tőle.</p>'
        + '<a href="Profile.html" style="display:inline-block;background:var(--accent,#4f46e5);color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:600;font-size:13.5px">Vissza a profilomhoz</a>'
        + '</div>';
      (document.body || document.documentElement).appendChild(el);
      try { document.documentElement.style.overflow = 'hidden'; } catch (e) { }
    }
  };
})();
