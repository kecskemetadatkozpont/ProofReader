/* Aloud — number/claims consistency scan (window.PRConsistency).
 *
 * Groups metric-like decimal values by their label (AUROC, FPR95, CiteScore, ρ, …) and surfaces the
 * cases where the SAME metric appears with DIFFERENT values across the manuscript — the most common
 * integrity defect in a results-heavy thesis (e.g. the same headline AUROC quoted as 0.801 and 0.924).
 * Heuristic + navigable: it flags candidates for the author to check, it does not auto-edit.
 */
window.PRConsistency = (function () {
  'use strict';
  function stripComments(s) { return s.replace(/(^|[^\\])%.*$/gm, '$1'); }
  function lineAt(s, off) { var n = 1; for (var i = 0; i < off && i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; }
  function snippet(s, off) { var a = Math.max(0, off - 32), b = Math.min(s.length, off + 14); return s.slice(a, b).replace(/\s+/g, ' ').trim(); }

  // known metric tokens (case-insensitive) + Greek macros
  var METRIC = /^(auroc|aupr|aurc|fpr|fpr95|tpr|fnr|tnr|tpr95|citescore|sjr|jif|jci|snip|map|miou|iou|dice|psnr|ssim|lpips|bleu|rouge|cider|rmse|mae|mse|acc|accuracy|f1|ece|nll|ppl|recall|precision|auc|ap|r2|rho|tau|sigma|delta|mu|kappa|alpha|beta|lambda|logit|energy|msp|mahalanobis|knn|react|ash|odin|gen|vim)$/i;
  // a usable label = a known metric, an ALL-CAPS acronym (>=2), or a Capitalised name (method names like
  // Mahalanobis/Logit/ODIN) — this excludes lowercase Hungarian/English filler words next to a number.
  function isLabel(label) {
    var n = label.replace(/^\\/, '');
    return METRIC.test(n) || /^[A-ZÁÉÍÓÖŐÚÜŰ][A-Za-z0-9ÁÉÍÓÖŐÚÜŰáéíóöőúüű]{1,}$/.test(n);
  }

  function scan(src) {
    if (!src) return [];
    var s = stripComments(src), groups = {};
    var re = /(\d+[.,]\d+)\s*(%?)/g, m;
    while ((m = re.exec(s)) !== null) {
      var off = m.index, raw = m[1], pct = m[2];
      // strip LaTeX markup from the look-behind window so a table-cell method label or a metric token is
      // found even across \textbf{…}, &, $…$ etc., then take the nearest alpha token as the label
      var preRaw = s.slice(Math.max(0, off - 40), off);
      var preClean = preRaw.replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}$&~\\]/g, ' ');
      var lm = preClean.match(/([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű][A-Za-z0-9ÁÉÍÓÖŐÚÜŰáéíóöőúüű]{1,})\s*(?:[=:~]|\b(?:of|is|was|volt|lett|el[eé]rt)\b)?\s*$/);
      if (!lm) continue;
      var label = lm[1];
      if (!isLabel(label)) continue;
      var val = parseFloat(raw.replace(',', '.')); if (isNaN(val)) continue;
      var ln = label.replace(/^\\/, '');
      if (/^(doi|isbn|issn|arxiv|vol|no|pp|fig|figure|table|tab|chapter|section|eq|equation)$/i.test(ln)) continue; // identifiers / cross-refs, not metrics
      if (/^10\.\d{4,}/.test(raw) || /^(19|20)\d\d$/.test(raw.replace(/[.,].*$/, ''))) continue; // DOI prefix / years
      var key = ln.toUpperCase() + (pct ? '%' : '');
      var g = groups[key] || (groups[key] = { label: label.replace(/^\\/, ''), pct: !!pct, byVal: {} });
      var vk = val.toFixed(4);
      var bv = g.byVal[vk] || (g.byVal[vk] = { value: val, raw: raw + pct, count: 0, occ: [] });
      bv.count++;
      if (bv.occ.length < 10) bv.occ.push({ off: off, line: lineAt(s, off), snippet: snippet(s, off) });
    }
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var values = Object.keys(g.byVal).map(function (vk) { return g.byVal[vk]; }).sort(function (a, b) { return a.value - b.value; });
      var total = values.reduce(function (a, b) { return a + b.count; }, 0);
      var spread = values.length > 1 ? (values[values.length - 1].value - values[0].value) : 0;
      out.push({ label: g.label, pct: g.pct, distinct: values.length, total: total, spread: spread, values: values });
    });
    // most-varying first (the strongest inconsistency candidates)
    out.sort(function (a, b) { return (b.distinct - a.distinct) || (b.spread - a.spread) || (b.total - a.total); });
    return out;
  }
  // number of metrics that appear with >1 distinct value (the badge count)
  function conflicts(list) { return (list || []).filter(function (g) { return g.distinct > 1; }).length; }

  return { scan: scan, conflicts: conflicts };
})();
