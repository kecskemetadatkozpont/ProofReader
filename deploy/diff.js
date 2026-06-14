/* Lightweight diff for ProofReader version compare (LCS over words / lines). */
(function () {
  'use strict';
  function lcs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ t: 'eq', s: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', s: a[i] }); i++; }
      else { ops.push({ t: 'add', s: b[j] }); j++; }
    }
    while (i < n) { ops.push({ t: 'del', s: a[i] }); i++; }
    while (j < m) { ops.push({ t: 'add', s: b[j] }); j++; }
    return ops;
  }
  function tokWords(s) { return (s || '').split(/(\s+)/).filter((x) => x.length); }
  function tokLines(s) { return (s || '').split('\n'); }
  function coalesce(ops) {
    const out = [];
    for (const o of ops) {
      const last = out[out.length - 1];
      if (last && last.t === o.t) last.s += o.s; else out.push({ t: o.t, s: o.s });
    }
    return out;
  }
  window.PRDiff = {
    words: function (a, b) { return coalesce(lcs(tokWords(a), tokWords(b))); },
    lines: function (a, b) {
      const ops = lcs(tokLines(a), tokLines(b));
      // group into rows for split view
      return ops;
    },
    stats: function (a, b) {
      let add = 0, del = 0;
      coalesce(lcs(tokWords(a), tokWords(b))).forEach((o) => { if (o.t === 'add') add += o.s.trim() ? o.s.split(/\s+/).length : 0; if (o.t === 'del') del += o.s.trim() ? o.s.split(/\s+/).length : 0; });
      return { add: add, del: del };
    }
  };
})();
