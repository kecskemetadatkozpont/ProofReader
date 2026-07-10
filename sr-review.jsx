/* Publify — Systematic Review results viewer (SRReview.html?job=<elicit_jobs.id>).
 * Tracks a review's PRISMA pipeline live AND renders its results on the page (screening + extraction
 * tables with a per-paper evidence drawer + the report), not just as CSV/XLSX downloads.
 * Data via elicit-proxy: sr.get (the job) + sr.stage_data (a stage CSV parsed + grouped server-side). */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function callElicit(body) {
    var CFG = window.PR_CONFIG || {};
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/elicit-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return { error: 'bad response' }; }); }, function () { return { error: 'network' }; });
    });
  }
  function mdHtml(t) { try { return window.DOMPurify.sanitize(window.marked.parse(t || '')); } catch (e) { return ''; } }
  function jobId() { try { return new URLSearchParams(location.search).get('job'); } catch (e) { return null; } }
  function nfmt(n) { return (n == null) ? '—' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function relTime(ts) { if (!ts) return ''; var t = new Date(ts).getTime(); if (isNaN(t)) return ''; var s = Math.max(0, Math.round((Date.now() - t) / 1000)); if (s < 60) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + ' min ago'; var hh = Math.round(m / 60); if (hh < 24) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; }

  // funnel stages ↔ executionStage
  var STAGES = [{ k: 'search', label: 'Sources', exec: 'gathering_sources', hint: 'retrieved by search' },
  { k: 'screen', label: 'Abstract screen', exec: 'screening_abstract', hint: 'passed abstract criteria' },
  { k: 'fulltext', label: 'Full-text', exec: 'screening_fulltext', hint: 'passed full-text criteria' },
  { k: 'extract', label: 'Extraction', exec: 'extracting_data', hint: 'data extracted' }];
  var EXEC_ORDER = ['gathering_sources', 'screening_abstract', 'screening_fulltext', 'extracting_data', 'generating_report', 'done'];
  function stageReached(job, exec) { // has the pipeline reached/passed this stage?
    if (job.status === 'completed') return true;
    var cur = EXEC_ORDER.indexOf(job.stage || '');
    return cur >= 0 && cur >= EXEC_ORDER.indexOf(exec);
  }
  function metaIdx(cols, kw) { for (var i = 0; i < cols.length; i++) { if (String(cols[i]).toLowerCase().indexOf(kw) >= 0) return i; } return -1; }

  function App() {
    var jS = useState(undefined), job = jS[0], setJob = jS[1];   // undefined=loading · null=not found
    var tS = useState('overview'), tab = tS[0], setTab = tS[1];
    var dS = useState({}), data = dS[0], setData = dS[1];        // { stage: {columns,questions,rows,total,...} | {loading} | {error} }
    var cS = useState({}), counts = cS[0], setCounts = cS[1];    // { stage: total }
    var drS = useState(null), drawer = drS[0], setDrawer = drS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var alive = useRef(true);
    var id = jobId();

    function loadJob() {
      if (!id) { setJob(null); return; }
      callElicit({ action: 'sr.get', job_id: id }).then(function (d) { if (alive.current) setJob((d && d.job) ? d.job : null); });
    }
    useEffect(function () { alive.current = true; loadJob(); return function () { alive.current = false; }; }, []);

    // poll while the review is still running
    useEffect(function () {
      if (!job || job.status === 'completed' || job.status === 'failed') return;
      var iv = setInterval(function () {
        callElicit({ action: 'sr.status', job_id: id }).then(function (d) { if (alive.current && d && d.job) setJob(function (p) { return Object.assign({}, p, d.job); }); });
      }, 20000);
      return function () { clearInterval(iv); };
    }, [job && job.status, job && job.stage]);

    // funnel counts — one lightweight count per stage that has data
    useEffect(function () {
      if (!job || !job.elicit_id) return;
      STAGES.forEach(function (st) {
        if (!stageReached(job, st.exec)) return;
        if (counts[st.k] != null) return;
        callElicit({ action: 'sr.stage_data', job_id: id, stage: st.k, countOnly: true }).then(function (d) {
          if (alive.current && d && !d.error) setCounts(function (p) { var n = Object.assign({}, p); n[st.k] = d.total; return n; });
        });
      });
    }, [job && job.id, job && job.status, job && job.stage]);

    function loadStage(stage) {
      if (data[stage] && !data[stage].error) return;
      setData(function (p) { var n = Object.assign({}, p); n[stage] = { loading: true }; return n; });
      callElicit({ action: 'sr.stage_data', job_id: id, stage: stage }).then(function (d) {
        if (!alive.current) return;
        setData(function (p) {
          var n = Object.assign({}, p);
          n[stage] = (d && !d.error) ? { columns: d.columns || [], questions: d.questions || [], rows: d.rows || [], total: d.total || 0, capped: d.capped, note: d.note } : { error: (d && d.error) || 'Could not load.' };
          return n;
        });
        if (d && !d.error && counts[stage] == null) setCounts(function (p) { var n = Object.assign({}, p); n[stage] = d.total || 0; return n; });
      });
    }
    useEffect(function () { if (job && (tab === 'screen' || tab === 'fulltext' || tab === 'extract')) loadStage(tab); }, [tab, job && job.id]);

    // ---------- render ----------
    if (job === undefined) return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Systematic review'), h('p', null, 'Loading…')));
    if (job === null) return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Not found'), h('p', null, 'This review does not exist or you do not have access.'), h('a', { className: 'btn', href: 'Research.html' }, '← Research')));

    var done = job.status === 'completed', failed = job.status === 'failed', paused = job.status === 'pausedForInsufficientQuota';
    var back = 'Research.html' + (job.project_id ? ('?project=' + encodeURIComponent(job.project_id)) : '');
    var e = job.exports || {};

    function funnel() {
      var curExec = job.stage;
      return h('div', { className: 'funnel' }, STAGES.map(function (st, i) {
        var reached = stageReached(job, st.exec), cur = curExec === st.exec && !done;
        var prev = i > 0 ? counts[STAGES[i - 1].k] : null, c = counts[st.k];
        var drop = (i > 0 && prev != null && c != null && prev >= c) ? (prev - c) : null;
        return h('div', { key: st.k, className: 'fstage' + (cur ? ' cur' : '') },
          h('div', { className: 'fk' }, (reached ? (cur ? '⏳ ' : '✓ ') : '○ ') + st.label),
          h('div', { className: 'fv num' }, c != null ? nfmt(c) : (reached ? '…' : '—')),
          h('div', { className: 'fd' }, st.hint),
          drop ? h('div', { className: 'fdrop' }, '−' + nfmt(drop) + ' excluded') : null);
      }));
    }

    // a data table for a stage (screen/fulltext/extract)
    function stageTable(stage) {
      var d = data[stage];
      if (!d || d.loading) return h('div', { className: 'empty' }, 'Loading ' + stage + ' data…');
      if (d.error) return h('div', { className: 'empty', style: { color: 'var(--danger)' } }, d.error);
      if (!d.rows.length) return h('div', { className: 'empty' }, d.note || 'No data for this stage yet.');
      var cols = d.columns, qs = d.questions;
      var iTitle = metaIdx(cols, 'title'), iAuth = metaIdx(cols, 'author'), iYear = metaIdx(cols, 'year'), iCite = metaIdx(cols, 'citation'), iDoi = metaIdx(cols, 'doi link'), iDecide = metaIdx(cols, 'screening judgement'), iScore = metaIdx(cols, 'screening score'), iExcl = metaIdx(cols, 'exclusion reason');
      var isScreen = iDecide >= 0 || iScore >= 0;
      var ql = q.trim().toLowerCase();
      var rows = d.rows.map(function (r, ri) { return { r: r, ri: ri }; }).filter(function (x) {
        if (!ql) return true;
        var hay = x.r.meta.join(' ') + ' ' + x.r.fields.map(function (f) { return f.answer; }).join(' ');
        return hay.toLowerCase().indexOf(ql) >= 0;
      });
      var head = [h('th', { key: 't' }, 'Paper')];
      if (iAuth >= 0) head.push(h('th', { key: 'a' }, 'Authors'));
      if (iYear >= 0) head.push(h('th', { key: 'y', className: 'num' }, 'Year'));
      if (iCite >= 0) head.push(h('th', { key: 'c', className: 'num' }, 'Cites'));
      if (isScreen) { head.push(h('th', { key: 'de' }, 'Decision')); if (iScore >= 0) head.push(h('th', { key: 'sc', className: 'num' }, 'Score')); }
      qs.forEach(function (qq, k) { head.push(h('th', { key: 'q' + k }, qq)); });
      if (isScreen && iExcl >= 0) head.push(h('th', { key: 'ex' }, 'Exclusion reason'));

      return h('div', null,
        h('div', { className: 'toolbar' },
          h('input', { className: 'srch', placeholder: 'Search ' + nfmt(d.total) + ' papers, authors, values…', value: q, onChange: function (ev) { setQ(ev.target.value); } }),
          h('span', { className: 'cnt' }, h('b', null, nfmt(rows.length)), ' of ' + nfmt(d.total) + (d.capped ? ' (first 2,000 shown)' : '')),
          h('span', { style: { flex: 1 } }),
          h('span', { className: 'hint' }, '↳ click a row for the evidence per column')),
        h('div', { className: 'tbl-wrap' }, h('div', { className: 'tbl-scroll' }, h('table', null,
          h('thead', null, h('tr', null, head)),
          h('tbody', null, rows.map(function (x) {
            var r = x.r;
            var dec = iDecide >= 0 ? String(r.meta[iDecide] || '').toLowerCase() : '';
            var inc = dec.indexOf('include') >= 0 || dec === 'yes' || dec === 'true';
            var cells = [h('td', { key: 't', className: 'c-title' }, (iTitle >= 0 ? r.meta[iTitle] : (r.meta[0] || '(untitled)')), iDoi >= 0 && r.meta[iDoi] ? h('a', { className: 'doi', href: r.meta[iDoi], target: '_blank', rel: 'noopener', onClick: function (ev) { ev.stopPropagation(); } }, 'DOI ↗') : null)];
            if (iAuth >= 0) cells.push(h('td', { key: 'a', className: 'c-auth' }, r.meta[iAuth]));
            if (iYear >= 0) cells.push(h('td', { key: 'y', className: 'num' }, r.meta[iYear]));
            if (iCite >= 0) cells.push(h('td', { key: 'c', className: 'num' }, r.meta[iCite]));
            if (isScreen) {
              cells.push(h('td', { key: 'de' }, dec ? h('span', { className: 'decide ' + (inc ? 'inc' : 'exc') }, inc ? '✓ Include' : '✕ Exclude') : '—'));
              if (iScore >= 0) cells.push(h('td', { key: 'sc', className: 'num' }, r.meta[iScore]));
            }
            r.fields.forEach(function (f, k) { cells.push(h('td', { key: 'q' + k }, h('div', { className: 'ans' }, f.answer || '—'))); });
            if (isScreen && iExcl >= 0) cells.push(h('td', { key: 'ex', className: 'c-excl' }, r.meta[iExcl] || ''));
            return h('tr', { key: x.ri, onClick: function () { setDrawer({ r: r, cols: cols, qs: qs, iTitle: iTitle, iAuth: iAuth, iYear: iYear, iCite: iCite, iDoi: iDoi }); } }, cells);
          }))
        )))
      );
    }

    var panel;
    if (tab === 'overview') {
      panel = h('div', null,
        h('div', { className: 'cards' },
          h('div', { className: 'card' }, h('div', { className: 'ck' }, 'Status'), h('div', { className: 'cv', style: { color: done ? 'var(--ok)' : failed ? 'var(--danger)' : 'var(--accent)' } }, done ? 'Completed' : failed ? 'Failed' : paused ? 'Paused' : 'Running'), h('div', { className: 'cd' }, job.updated_at ? relTime(job.updated_at) : '')),
          h('div', { className: 'card' }, h('div', { className: 'ck' }, 'Extracted'), h('div', { className: 'cv num' }, nfmt(counts.extract != null ? counts.extract : null)), h('div', { className: 'cd' }, 'papers with data')),
          h('div', { className: 'card' }, h('div', { className: 'ck' }, 'Included (abstract)'), h('div', { className: 'cv num' }, nfmt(counts.screen != null ? counts.screen : null)), h('div', { className: 'cd' }, 'passed screening')),
          h('div', { className: 'card' }, h('div', { className: 'ck' }, 'Sources'), h('div', { className: 'cv num' }, nfmt(counts.search != null ? counts.search : null)), h('div', { className: 'cd' }, 'retrieved'))
        ),
        job.result_summary ? h('div', { className: 'prose' }, h('h3', null, 'Executive summary'), h('p', { className: 'lead' }, job.result_summary)) :
          (!done ? h('div', { className: 'prose' }, h('h3', null, 'In progress'), h('p', null, 'This review is still running — the funnel above tracks each stage. Tables and the report appear here as each stage finishes.')) : null)
      );
    } else if (tab === 'report') {
      panel = job.result_body ? h('div', { className: 'prose', dangerouslySetInnerHTML: { __html: mdHtml(job.result_body) } }) : h('div', { className: 'empty' }, done ? 'No report was generated for this review.' : 'The report is written after extraction — not ready yet.');
    } else {
      panel = stageReached(job, STAGES.filter(function (s) { return s.k === tab; })[0].exec) ? stageTable(tab) : h('div', { className: 'empty' }, 'This stage has not run yet.');
    }

    return h('div', null,
      // top bar
      h('div', { className: 'topbar' }, h('div', { className: 'topbar-in' },
        h('a', { className: 'brand', href: back }, h('span', { className: 'mk' }, h('span')), h('span', null, 'Publify', h('small', null, 'Review results'))),
        h('a', { className: 'crumb', href: back }, '← Back to Studies'),
        h('span', { style: { flex: 1 } }),
        e.pdf ? h('a', { className: 'btn', href: e.pdf, target: '_blank' }, 'PDF') : null,
        e.docx ? h('a', { className: 'btn', href: e.docx, target: '_blank' }, 'DOCX') : null
      )),
      h('div', { className: 'wrap' },
        h('header', { className: 'rv' },
          h('div', { className: 'rv-title' },
            h('h1', null, job.result_title || job.research_question || 'Systematic review'),
            h('span', { className: 'pill ' + (done ? 'ok' : failed ? 'bad' : 'run') }, done ? 'Completed' : failed ? 'Failed' : paused ? 'Paused' : 'Running')),
          job.result_title && job.research_question ? h('div', { className: 'rv-q' }, job.research_question) : null,
          h('div', { className: 'rv-meta' },
            h('span', null, h('b', null, 'Started '), job.created_at ? new Date(job.created_at).toLocaleString() : '—'),
            done ? h('span', null, h('b', null, 'Finished '), job.updated_at ? relTime(job.updated_at) : '') : null,
            failed && job.error ? h('span', { style: { color: 'var(--danger)' } }, job.error.message || 'failed') : null),
          funnel()
        ),
        h('div', { className: 'tabs' }, [['overview', 'Overview'], ['screen', 'Abstract screening'], ['fulltext', 'Full-text'], ['extract', 'Extraction'], ['report', 'Report']].map(function (t) {
          var c = t[0] === 'screen' ? counts.screen : t[0] === 'fulltext' ? counts.fulltext : t[0] === 'extract' ? counts.extract : null;
          return h('button', { key: t[0], className: 'tab' + (tab === t[0] ? ' on' : ''), onClick: function () { setQ(''); setTab(t[0]); } }, t[1], (c != null) ? h('span', { className: 'tc num' }, nfmt(c)) : null);
        })),
        h('main', null, panel)
      ),
      // detail drawer
      drawer ? h('div', { className: 'dr-scrim', onClick: function () { setDrawer(null); } }, h('aside', { className: 'drawer', onClick: function (ev) { ev.stopPropagation(); } },
        h('div', { className: 'dr-head' },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('h2', null, drawer.iTitle >= 0 ? drawer.r.meta[drawer.iTitle] : (drawer.r.meta[0] || 'Paper')),
            h('div', { className: 'dr-sub' }, [drawer.iAuth >= 0 ? drawer.r.meta[drawer.iAuth] : '', drawer.iYear >= 0 ? drawer.r.meta[drawer.iYear] : '', drawer.iCite >= 0 ? (drawer.r.meta[drawer.iCite] + ' cites') : ''].filter(Boolean).join(' · '),
              drawer.iDoi >= 0 && drawer.r.meta[drawer.iDoi] ? h('span', null, ' · ', h('a', { href: drawer.r.meta[drawer.iDoi], target: '_blank', rel: 'noopener' }, 'DOI ↗')) : null)),
          h('button', { className: 'dr-x', onClick: function () { setDrawer(null); } }, '✕')),
        h('div', { className: 'dr-body' },
          drawer.r.fields.length ? drawer.r.fields.map(function (f, k) {
            return h('div', { key: k, className: 'qcard' },
              h('div', { className: 'qh' }, '◆ ' + f.name),
              h('div', { className: 'qans' }, f.answer || '—'),
              (f.quotes || f.reasoning || f.tables) ? h('details', { className: 'ev' },
                h('summary', null, 'Evidence & reasoning'),
                f.quotes ? h('div', { className: 'quote' }, f.quotes) : null,
                f.tables ? h('div', { className: 'reason' }, h('b', null, 'Tables: '), f.tables) : null,
                f.reasoning ? h('div', { className: 'reason' }, h('b', null, 'Why: '), f.reasoning) : null) : null);
          }) : h('div', { className: 'empty' }, 'No extracted fields — this is screening/search metadata only.'),
          // any remaining metadata columns
          h('details', { className: 'ev', style: { marginTop: 6 } }, h('summary', null, 'All metadata'),
            drawer.cols.map(function (cn, k) { return (drawer.r.meta[k] && [drawer.iTitle, drawer.iAuth, drawer.iYear, drawer.iCite].indexOf(k) < 0) ? h('div', { key: k, className: 'metarow' }, h('b', null, cn + ': '), drawer.r.meta[k]) : null; })))
      )) : null
    );
  }

  if (BE && BE.sb && BE.mode === 'cloud' && BE.user) ReactDOM.createRoot(document.getElementById('root')).render(h(App));
  else if (BE && BE.sb) ReactDOM.createRoot(document.getElementById('root')).render(h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in'), h('p', null, 'Open this review from your Studies board.'), h('a', { className: 'btn', href: 'Landing.html' }, 'Sign in'))));
  else document.getElementById('root').innerHTML = '<div class="center"><div class="box"><h1>Backend unavailable</h1></div></div>';
})();
