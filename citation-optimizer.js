/* Publify — Citation Optimizer (CitationOptimizer.html?project=<id>).
 * Drives the citation-optimizer edge function (run → analyze_paper loop → finalize → get) and renders the
 * project-level strategy + the ranked top-10 cards: intent mix, influential ratio, contributions, and the
 * real citation sentences. Plain DOM (no React). */
(function () {
  'use strict';
  var BE = window.PR_BACKEND, sb = BE && BE.sb, CFG = window.PR_CONFIG || {};
  var root = document.getElementById('root');
  var INTENTS = ['method', 'result', 'background', 'data', 'contrast'];
  var INTENT_LBL = { method: 'Method', result: 'Result', background: 'Background', data: 'Data', contrast: 'Contrast' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]; }); }
  function projId() { try { return new URLSearchParams(location.search).get('project'); } catch (e) { return null; } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function bareDoi(d) { return String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, ''); }
  function mdSafe(md) { try { return DOMPurify.sanitize(marked.parse(String(md || ''))); } catch (e) { return esc(md || ''); } }
  function downloadText(name, text) { var b = new Blob([text], { type: 'text/markdown' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); }

  function callFn(fn, body) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }); });
    });
  }
  function co(body) { return callFn('citation-optimizer', body); }

  var S = { report: null, insights: [], busy: null, err: null };

  function load() {
    return co({ action: 'get', project_id: projId() }).then(function (r) {
      if (r && r.ok) { S.report = r.report || null; S.insights = r.insights || []; }
      render();
    });
  }

  // ---- the driven pipeline: run (retry on 503) → analyze each paper (retry on transient) → finalize ----
  var running = false;
  function runAnalysis() {
    if (running) return; running = true; S.err = null;
    setBusy('Selecting your top-cited included papers…', 0, 1);
    (async function () {
      try {
        var r = null;
        for (var a = 0; a < 4; a++) {
          r = await co({ action: 'run', project_id: projId() });
          if (r && r.report_id) break;
          if (r && r.error === 'no_included') { fail('No included papers with a citation count yet. In Literature, mark some high-impact papers as Include, then run this.'); return; }
          if (r && r.retryable) { setBusy('Semantic Scholar is busy — retrying…', 0, 1); await sleep(5000); continue; }
          fail((r && (r.message || r.error)) || 'Could not start the analysis.'); return;
        }
        if (!r || !r.report_id) { fail('Semantic Scholar is rate-limiting right now. Try again in a minute.'); return; }
        var reportId = r.report_id, papers = (r.papers || []);
        var pending = papers.filter(function (p) { return !p.done; });
        for (var i = 0; i < pending.length; i++) {
          var p = pending[i];
          setBusy('Reading citation contexts — ' + (p.title || 'paper').slice(0, 46) + '…', i, pending.length);
          for (var att = 0; att < 3; att++) {
            var ar = await co({ action: 'analyze_paper', report_id: reportId, insight_id: p.id, attempt: att });
            if (ar && ar.retryable) { setBusy('Rate-limited — waiting to retry this paper…', i, pending.length); await sleep(3500); continue; }
            break; // ok / skipped / gave_up → move on
          }
        }
        setBusy('Writing the citation strategy…', pending.length, pending.length);
        await co({ action: 'finalize', report_id: reportId });
        S.busy = null; running = false;
        await load();
      } catch (e) { fail('Something went wrong: ' + ((e && e.message) || e)); }
    })();
  }
  function fail(msg) { running = false; S.busy = null; S.err = msg; render(); }
  function setBusy(msg, done, total) { S.busy = { msg: msg, done: done, total: total }; render(); }

  // ---- render ----
  function shell(contentHTML) {
    root.innerHTML = '<div class="topbar"><div class="topbar-in">'
      + '<a class="brand" href="Research.html?project=' + esc(projId() || '') + '"><span class="mk"><i></i></span><span>Publify<small>Citation Optimizer</small></span></a>'
      + '<span class="spring"></span><a class="btn" href="Research.html?project=' + esc(projId() || '') + '">← Research</a></div></div>'
      + '<div class="wrap" id="wrap">' + contentHTML + '</div>';
  }

  function intentMix(mix) {
    mix = mix || {}; var total = 0; INTENTS.forEach(function (k) { total += (mix[k] || 0); });
    if (!total) return '';
    var segs = INTENTS.filter(function (k) { return mix[k]; }).map(function (k) { return '<i class="' + k + '" style="width:' + (100 * mix[k] / total).toFixed(1) + '%"></i>'; }).join('');
    var keys = INTENTS.filter(function (k) { return mix[k]; }).map(function (k) { return '<span class="k"><i style="background:var(--' + (k === 'background' ? 'backg' : k) + ')"></i>' + INTENT_LBL[k] + ' ' + Math.round(100 * mix[k] / total) + '%</span>'; }).join('');
    return '<div class="mixwrap"><div class="mixbar">' + segs + '</div><div class="mixkey">' + keys + '</div></div>';
  }

  function card(x, i) {
    var mix = x.intent_mix, hasMix = mix && INTENTS.some(function (k) { return mix[k]; });
    var contribs = (x.contributions || []).filter(function (c) { return c && c.label; }).slice(0, 6)
      .map(function (c) { return '<span class="contrib">' + esc(c.label) + (c.count ? '<span class="pc">×' + (+c.count) + '</span>' : '') + '</span>'; }).join('');
    var ctxs = (x.contexts || []).filter(function (c) { return c && c.sentence; });
    var ctxHtml = ctxs.map(function (c) {
      var ic = c.intent && INTENT_LBL[c.intent] ? '<span class="chip ' + c.intent + '">' + INTENT_LBL[c.intent] + '</span>' : '';
      var star = c.influential ? ' <span class="chip influ">Influential</span>' : '';
      return '<div class="ctx"><div class="sent">“' + esc(c.sentence) + '”</div><div class="foot"><span class="who">' + esc(c.citing_title || 'Citing paper') + '</span>' + (c.year ? ' · ' + c.year : '') + ' ' + ic + star + '</div></div>';
    }).join('');
    var citeStr = x.cited_by != null ? '<div class="cites"><div class="big num">' + (+x.cited_by).toLocaleString() + '</div><div class="lbl">citations</div></div>' : '<div class="cites"></div>';
    return '<div class="pcard"><div class="row1"><div class="rank">' + (x.rank || i + 1) + '</div>'
      + '<div class="pmeta"><b>' + esc(x.title || 'Untitled') + '</b><div class="venue">' + esc([x.venue, x.year].filter(Boolean).join(' · ')) + (x.influential ? ' · ' + x.influential + ' influential' : '') + '</div></div>'
      + citeStr + '</div>'
      + (hasMix ? intentMix(mix) : '')
      + (contribs ? '<div class="citedfor"><div class="h">Cited for</div><div class="contribs">' + contribs + '</div></div>' : '')
      + (x.summary ? '<div class="summary"><b>Why it\'s cited:</b> ' + esc(x.summary) + '</div>' : '')
      + (ctxHtml ? '<details class="ctxs"><summary>' + ctxs.length + ' citation sentence' + (ctxs.length === 1 ? '' : 's') + '</summary><div class="ctxlist">' + ctxHtml + '</div></details>' : '')
      + '</div>';
  }

  function render() {
    // busy / progress
    if (S.busy) {
      var b = S.busy, frac = b.total ? Math.round(100 * b.done / b.total) : 0;
      shell('<div class="runbar"><span class="spin"></span><span class="msg">' + esc(b.msg) + '</span><span class="pbar"><i style="width:' + frac + '%"></i></span></div>'
        + '<div class="empty"><p>Analyzing how the field cites your key papers. You can leave this open — it runs a paper at a time so Semantic Scholar isn\'t overloaded.</p></div>');
      return;
    }
    var rep = S.report, done = rep && rep.status === 'done';
    var runBtn = '<button class="btn pri" id="run">' + (rep ? '↻ Re-run analysis' : '✦ Run citation analysis') + '</button>';
    var head = '<header class="rv"><div style="flex:1;min-width:260px"><h1>Citation Optimizer</h1>'
      + '<div class="sub">What your top-cited <b>included</b> papers are actually cited for — so your protocol and paper cite the field the way the field cites itself.</div></div>' + runBtn + '</header>';

    if (S.err) head += '<div class="banner warn">' + esc(S.err) + '</div>';

    if (!rep) { shell(head + '<div class="empty"><h2>No analysis yet</h2><p>Run it once and Publify will pull the citation sentences for your 10 most-cited included papers, classify what each is cited for, and write a citation strategy.</p></div>'); wire(); return; }

    // stats + legend
    var st = rep.stats || {}, tot = rep.intent_totals || {};
    var totSum = INTENTS.reduce(function (a, k) { return a + (tot[k] || 0); }, 0);
    var statsHtml = '<div class="stats">'
      + statBox('Papers analysed', st.resolved != null ? st.resolved : (S.insights.length), 'of top ' + (st.papers || S.insights.length) + ' included')
      + statBox('Citation sentences', (st.contexts != null ? st.contexts : '—'), 'contexts read')
      + statBox('Influential', (st.influential != null ? st.influential : '—'), 'core citations')
      + statBox('Most common intent', topIntent(tot), totSum ? 'across all citations' : '')
      + '</div>';
    var legend = '<div class="legend">'
      + INTENTS.map(function (k) { return '<span class="chip ' + k + '">' + INTENT_LBL[k] + '</span>'; }).join('')
      + '<span class="chip influ">Influential</span></div>';

    var strat = rep.strategy ? '<div class="strategy"><div class="lab">✦ Citation strategy for this topic</div><div class="prose">' + mdSafe(rep.strategy) + '</div>'
      + '<div class="acts"><button class="btn" id="exp">⭳ Export brief</button></div></div>' : '';

    var cards = (S.insights || []).slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); }).map(card).join('');
    shell(head + strat + statsHtml + legend + '<div class="listhd">Top papers — ranked by citations</div>' + (cards || '<div class="empty"><p>No paper insights were produced.</p></div>'));
    wire();
  }
  function statBox(k, v, d) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v num">' + esc(v) + '</div><div class="d">' + esc(d || '') + '</div></div>'; }
  function topIntent(tot) { var best = '', n = -1; INTENTS.forEach(function (k) { if ((tot && tot[k] || 0) > n) { n = tot[k] || 0; best = k; } }); return n > 0 ? INTENT_LBL[best] : '—'; }
  function wire() {
    var rb = document.getElementById('run'); if (rb) rb.onclick = runAnalysis;
    var ex = document.getElementById('exp'); if (ex) ex.onclick = function () { downloadText('citation-strategy.md', (S.report && S.report.strategy) || ''); };
  }

  // ---- boot ----
  if (!BE || !BE.sb) { root.innerHTML = '<div class="center"><div class="box"><h1>Backend unavailable</h1></div></div>'; return; }
  if (BE.mode !== 'cloud' || !BE.user) { root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>Sign in</h1><p>Open the Citation Optimizer from a project.</p><a class="btn" href="Landing.html">Sign in</a></div></div>'; return; }
  if (!projId()) { root.innerHTML = '<div class="center"><div class="box"><h1>No project</h1><p>Open the Citation Optimizer from Research → a project → Literature.</p><a class="btn" href="Research.html">← Research</a></div></div>'; return; }
  shell('<div class="empty"><p>Loading…</p></div>');
  load().catch(function () { root.innerHTML = '<div class="center"><div class="box"><h1>Could not load</h1><p>This project may not exist or you may not have access.</p><a class="btn" href="Research.html">← Research</a></div></div>'; });
})();
