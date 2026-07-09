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
    modelAllowlist: function () { return cache ? (cache.prof.model_allowlist || null) : null; }
  };
})();
