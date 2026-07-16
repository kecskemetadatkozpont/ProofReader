/* Publify — Figure Board (FigureBoard.html?project=<id>).
 * Extracts figures from the OA PDFs of the project's Library papers (research_sources) and lays them on an
 * infinite pan-zoom canvas, clustered per paper. Extraction is client-side: resolve OA PDF (pdf-proxy) →
 * fetch bytes past CORS → pdf.js renders each page + finds "Figure N" captions → crop the region above each
 * caption (catches vector + raster figures) → upload to research-data → research_figures. Plain DOM (no React). */
(function () {
  'use strict';
  var BE = window.PR_BACKEND, sb = BE && BE.sb, CFG = window.PR_CONFIG || {};
  var root = document.getElementById('root');
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]; }); }
  function projId() { try { return new URLSearchParams(location.search).get('project'); } catch (e) { return null; } }
  function bareDoi(d) { return String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, ''); }
  // only http(s) links may become an href — blocks javascript:/data: schemes from user-supplied source URLs
  function safeHref(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }

  function proxy(body, binary) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/pdf-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) })
        .then(function (r) { return binary ? (r.ok ? r.arrayBuffer() : r.json().then(function (e) { throw new Error((e && e.error) || 'fetch failed'); })) : r.json(); });
    });
  }
  function callFn(fn, body) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
    });
  }

  // ---------- pdf.js extraction ----------
  function ensurePdfjs() { if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; return Promise.resolve(window.pdfjsLib); } return Promise.reject(new Error('pdf.js not loaded')); }

  // find "Figure N" captions on a page → their rendered-px position (top-origin) + first-line text
  function findCaptions(items, viewport) {
    var U = window.pdfjsLib.Util, lines = {};
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var t = U.transform(viewport.transform, it.transform), y = t[5], x = t[4];
      var key = Math.round(y / 4) * 4;
      (lines[key] = lines[key] || []).push({ x: x, y: y, s: it.str, h: Math.hypot(t[2], t[3]) || 12 });
    });
    var caps = [];
    Object.keys(lines).forEach(function (k) {
      var line = lines[k].sort(function (a, b) { return a.x - b.x; });
      var text = line.map(function (w) { return w.s; }).join('').replace(/\s+/g, ' ').trim();
      var m = text.match(/^(Fig(?:ure|\.)?)\s*(\d+)[\.:\s]/i);
      if (!m) return;
      var y = line[0].y, h = line[0].h;
      caps.push({ y: y, top: y - h, bottom: y + h * 0.6, label: 'Figure ' + m[2], text: text.slice(0, 320) });
    });
    caps.sort(function (a, b) { return a.y - b.y; });
    return caps;
  }

  function extractPaper(p, onProg) {
    return proxy({ action: 'resolve', doi: bareDoi(p.doi) }, false).then(function (res) {
      if (!res || !res.pdf_url) return { status: 'no_oa', figs: 0 };
      onProg && onProg('Downloading PDF…');
      return proxy({ action: 'fetch', url: res.pdf_url }, true).then(function (buf) {
        return ensurePdfjs().then(function (pdfjs) { return pdfjs.getDocument({ data: buf }).promise; }).then(function (pdf) {
          var out = [], ord = 0, chain = Promise.resolve();
          var maxPages = Math.min(pdf.numPages, 30);
          for (var pn = 1; pn <= maxPages; pn++) (function (pnum) {
            chain = chain.then(function () {
              onProg && onProg('Reading page ' + pnum + '/' + maxPages + '…');
              return pdf.getPage(pnum).then(function (page) {
                var vp = page.getViewport({ scale: 2 });
                var cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
                var ctx = cv.getContext('2d');
                return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return page.getTextContent(); }).then(function (tc) {
                  var caps = findCaptions(tc.items, vp);
                  var pchain = Promise.resolve();
                  caps.forEach(function (cap, ci) {
                    pchain = pchain.then(function () {
                      var topBound = (ci > 0) ? caps[ci - 1].bottom + 8 : Math.max(0, cap.top - vp.height * 0.55);
                      var cropTop = Math.max(0, Math.min(topBound, cap.top - 16));
                      var cropBottom = Math.min(cv.height, cap.bottom + 6);
                      var cropH = Math.round(cropBottom - cropTop);
                      if (cropH < 90) return;
                      var fc = document.createElement('canvas'); fc.width = cv.width; fc.height = cropH;
                      fc.getContext('2d').drawImage(cv, 0, cropTop, cv.width, cropH, 0, 0, cv.width, cropH);
                      var myOrd = ord++;
                      // NB: research-data bucket RLS keys on the FIRST path segment = project_id (migration-15)
                      var path = p.project_id + '/figures/' + p.id + '/' + myOrd + '.png';
                      return new Promise(function (r) { fc.toBlob(r, 'image/png', 0.92); }).then(function (blob) {
                        if (!blob) return;
                        return sb.storage.from('research-data').upload(path, blob, { upsert: true, contentType: 'image/png' }).then(function () {
                          out.push({ project_id: p.project_id, source_id: p.id, page: pnum, ord: myOrd, fig_label: cap.label, caption: cap.text, storage_path: path, width: fc.width, height: fc.height });
                        });
                      });
                    });
                  });
                  return pchain;
                });
              });
            });
          })(pn);
          return chain.then(function () {
            if (!out.length) return { status: 'no_figs', figs: 0 };
            return sb.from('research_figures').upsert(out, { onConflict: 'source_id,ord' }).then(function () { return { status: 'ok', figs: out.length }; });
          });
        });
      });
    }).catch(function (e) { return { status: 'error', figs: 0, msg: (e && e.message) || 'failed' }; });
  }

  // ---------- data ----------
  var S = { papers: [], figs: [], byPaper: {}, urls: {}, view: { x: 40, y: 24, k: 0.9 }, group: 'paper', showHidden: false, curFig: null, curPaper: null, hiddenCount: 0, moved: false, sort: 'cites', pro: false, scope: 'all', studies: [], studyOfSource: {} };
  function nd() { return !!(window.PRDesign && window.PRDesign.isNew()); }   // "New design" flag
  function uid() { return 'n' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function toast(msg, ok) { var t = el('div', 'fb-toast' + (ok === false ? ' err' : '')); t.textContent = msg; document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add('show'); }); setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }, 2400); }
  function load() {
    var pid = projId(); if (!pid) return Promise.reject('no project');
    var figQ = sb.from('research_figures').select('*').eq('project_id', pid).order('ord', { ascending: true });
    if (!S.showHidden) figQ = figQ.eq('hidden', false);
    return Promise.all([
      sb.from('research_sources').select('*').eq('project_id', pid).order('year', { ascending: false, nullsFirst: false }),
      figQ,
      sb.from('research_figures').select('id', { count: 'exact', head: true }).eq('project_id', pid).eq('hidden', true),
      sb.from('research_studies').select('id,title').eq('project_id', pid).order('created_at', { ascending: false })
    ]).then(function (r) {
      S.papers = (r[0] && r[0].data) || [];
      S.figs = (r[1] && r[1].data) || [];
      S.hiddenCount = (r[2] && r[2].count) || 0;
      S.studies = (r[3] && r[3].data) || [];
      // a scope pointing at a study that no longer exists (deleted elsewhere) → fall back to All, so the select value
      // and S.scope agree and the list/stats/extract aren't silently stuck on an empty scope.
      if (S.scope && S.scope.indexOf('study:') === 0 && !S.studies.some(function (s) { return 'study:' + s.id === S.scope; })) S.scope = 'all';
      S.byPaper = {}; S.figs.forEach(function (f) { (S.byPaper[f.source_id] = S.byPaper[f.source_id] || []).push(f); });
      // map each source → the study run(s) it belongs to (research_study_papers has no project_id → query by study ids),
      // so the extraction-scope selector can restrict to one study, all included, or the whole Library.
      var sids = S.studies.map(function (s) { return s.id; });
      if (!sids.length) { S.studyOfSource = {}; return signUrls(); }
      return sb.from('research_study_papers').select('source_id,study_id').in('study_id', sids).then(function (rr) {
        S.studyOfSource = {};
        ((rr && rr.data) || []).forEach(function (x) { if (!x.source_id) return; var a = (S.studyOfSource[x.source_id] = S.studyOfSource[x.source_id] || []); if (a.indexOf(x.study_id) < 0) a.push(x.study_id); });
        return signUrls();
      }, function () { S.studyOfSource = {}; return signUrls(); });
    });
  }
  function signUrls() {
    var paths = S.figs.map(function (f) { return f.storage_path; }).filter(function (p) { return !S.urls[p]; });
    if (!paths.length) return Promise.resolve();
    return sb.storage.from('research-data').createSignedUrls(paths, 3600).then(function (r) {
      ((r && r.data) || []).forEach(function (x) { if (x && x.signedUrl && x.path) S.urls[x.path] = x.signedUrl; });
    });
  }

  // ---------- curate: pin to research Canvas + hide/unhide ----------
  // Appends image nodes to the project's research_canvas blob (migration-21). Read-modify-write:
  // the canvas is a single jsonb doc, so a concurrently-open Canvas tab could clobber; we re-read
  // immediately before writing to keep that window small.
  function pinToCanvas(figs) {
    var pid = projId(); if (!figs || !figs.length) return Promise.resolve(0);
    return sb.from('research_canvas').select('data').eq('project_id', pid).maybeSingle().then(function (r) {
      var d = (r && r.data && r.data.data) || {};
      var nodes = Array.isArray(d.nodes) ? d.nodes : [], edges = Array.isArray(d.edges) ? d.edges : [], view = d.view || {};
      var maxX = 40; nodes.forEach(function (n) { if (typeof n.x === 'number') maxX = Math.max(maxX, n.x + (n.w || 200)); });
      var baseX = nodes.length ? maxX + 80 : 80, baseY = 80, COLS = 4, GAP = 26, W = 260, added = [];
      figs.forEach(function (f, i) {
        var col = i % COLS, row = Math.floor(i / COLS);
        var aspect = (f.width && f.height) ? (f.height / f.width) : 0.7;
        var hgt = Math.round(Math.min(300, Math.max(120, W * aspect)));
        added.push({ id: uid(), type: 'image', x: baseX + col * (W + GAP), y: baseY + row * (300 + GAP), w: W, h: hgt, path: f.storage_path, name: f.fig_label || 'Figure', mime: 'image/png' });
      });
      var out = { nodes: nodes.concat(added), edges: edges, view: view };
      return sb.from('research_canvas').upsert({ project_id: pid, data: out, updated_at: new Date().toISOString(), updated_by: (BE.user && BE.user.id) || null }, { onConflict: 'project_id' }).then(function (rr) {
        if (rr && rr.error) throw new Error(rr.error.message);
        return added.length;
      });
    });
  }
  function pinFigs(figs, label) {
    pinToCanvas(figs).then(function (n) {
      toast('📌 Pinned ' + n + ' figure' + (n === 1 ? '' : 's') + ' to the research Canvas' + (label ? ' — ' + label : ''));
    }, function (e) { toast('Could not pin: ' + ((e && e.message) || 'failed'), false); });
  }
  function setHidden(f, hidden) {
    return sb.from('research_figures').update({ hidden: hidden }).eq('id', f.id).then(function (r) {
      if (r && r.error) { toast(r.error.message, false); return; }
      toast(hidden ? '🙈 Figure hidden' : '↩ Figure restored');
      return load().then(function () { sidebar(); render(); });
    });
  }

  // ---------- render ----------
  var world, canvasEl, sideEl, statEl, extractBtn, progEl;
  function fmtAuthors(a) { return (a && a.length) ? (a[0] + (a.length > 1 ? ' et al.' : '')) : ''; }
  // Scopus quartile (SCImago) from research_sources.issn — same logic + map as research.jsx.
  var SCIMAGO = {};
  function loadScimago() { return fetch('scimago-scopus.json').then(function (r) { return r.ok ? r.json() : {}; }).then(function (m) { SCIMAGO = m || {}; }, function () { SCIMAGO = {}; }); }
  function quartileOf(p) {
    var issn = p && p.issn; if (!issn) return null;
    var parts = String(issn).split(',');
    for (var i = 0; i < parts.length; i++) { var n = parts[i].replace(/[^0-9Xx]/g, '').toUpperCase(); if (n && SCIMAGO[n]) return SCIMAGO[n]; }
    return null;
  }
  // metric badges (journal · Q · citations) as an HTML string; compact drops the journal name
  function metricRow(p, compact) {
    if (!p) return '';
    var t = [], q = quartileOf(p);
    if (!compact && p.venue) t.push('<span class="mtag jrnl" title="Journal / venue">' + esc(String(p.venue).slice(0, 44)) + '</span>');
    if (q) t.push('<span class="mtag q q' + esc(String(q)) + '" title="Scopus quartile (SCImago Journal Rank) — Q1 is the top 25% by SJR in its field">Q' + esc(String(q)) + '</span>');
    if (p.cited_by != null) t.push('<span class="mtag cite" title="Citation count">' + (+p.cited_by) + ' cites</span>');
    return t.length ? '<div class="mrow">' + t.join('') + '</div>' : '';
  }
  // the papers currently IN SCOPE (extraction source): whole Library, only included, or one study run
  function scopedPapers() {
    if (!S.scope || S.scope === 'all') return S.papers;
    if (S.scope === 'included') return S.papers.filter(function (p) { return p.screening === 'include'; });
    if (S.scope.indexOf('study:') === 0) { var sid = S.scope.slice(6); return S.papers.filter(function (p) { return (S.studyOfSource[p.id] || []).indexOf(sid) >= 0; }); }
    return S.papers;
  }
  function scopeCount(scope) {
    if (scope === 'all') return S.papers.length;
    if (scope === 'included') return S.papers.filter(function (p) { return p.screening === 'include'; }).length;
    var sid = scope.slice(6); return S.papers.filter(function (p) { return (S.studyOfSource[p.id] || []).indexOf(sid) >= 0; }).length;
  }
  // order the papers by the current sort key (applied to both the sidebar list and the canvas layout)
  function ordered(list) {
    var arr = (list || S.papers).slice(), by = S.sort;
    arr.sort(function (a, b) {
      if (by === 'cites') return (b.cited_by || 0) - (a.cited_by || 0);
      if (by === 'q') return (quartileOf(a) || 9) - (quartileOf(b) || 9);
      if (by === 'figs') return ((S.byPaper[b.id] || []).length) - ((S.byPaper[a.id] || []).length);
      if (by === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      return (b.year || 0) - (a.year || 0);  // 'year'
    });
    return arr;
  }
  // Abstracts are often missing (e.g. SR-imported sources). Reconstruct from OpenAlex on demand by DOI,
  // then backfill research_sources.abstract so it persists for next time + the rest of the app.
  function abstractFromInverted(inv) {
    if (!inv) return '';
    var words = [], max = 0;
    Object.keys(inv).forEach(function (w) { (inv[w] || []).forEach(function (pos) { words[pos] = w; if (pos > max) max = pos; }); });
    var out = []; for (var i = 0; i <= max; i++) out.push(words[i] || '');
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  function fetchAbstract(p) {
    var d = bareDoi(p && p.doi); if (!d) return Promise.resolve('');
    return fetch('https://api.openalex.org/works/doi:' + encodeURIComponent(d) + '?mailto=kecskemet.adatkozpont@gmail.com')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (w) { return (w && abstractFromInverted(w.abstract_inverted_index)) || ''; }, function () { return ''; });
  }
  function persistAbstract(p, txt) { try { sb.from('research_sources').update({ abstract: String(txt).slice(0, 20000) }).eq('id', p.id).then(function () { }, function () { }); } catch (e) { } }
  var EMPTY = '<div class="cluster" style="left:40px;top:40px;width:440px;padding:26px 24px"><b style="font-size:14px">No figures yet</b><div style="font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.5">Hit <b>Extract figures from Library</b> on the left. Publify finds each paper’s open-access PDF and pulls its figures onto this board.</div></div>';
  // New-design onboarding: a guided first-run panel instead of the terse empty state
  function onboardHTML() {
    var scoped = scopedPapers();   // honor the active extraction scope, so the CTA copy/counts match what the button does
    var withDoi = scoped.filter(function (p) { return !!p.doi; }).length;
    var scopeActive = !!(S.scope && S.scope !== 'all');
    return '<div class="fb-onboard"><div class="ob-badge">Figure Board</div>'
      + '<h1>Every figure from your papers, on one canvas</h1>'
      + '<p>Publify opens each open-access PDF in your Library and pulls out its figures — grouped by paper, with citations, a relevance note and the abstract, ready to pin into your writing.</p>'
      + '<div class="ob-steps">'
      + '<div class="ob-step"><span class="obn">1</span><div><b>Extract</b><i>from your ' + withDoi + ' paper' + (withDoi === 1 ? '' : 's') + ' with a DOI</i></div></div>'
      + '<div class="ob-step"><span class="obn">2</span><div><b>Browse</b><i>by paper — see why each figure is relevant</i></div></div>'
      + '<div class="ob-step"><span class="obn">3</span><div><b>Pin</b><i>the best ones into your research Canvas</i></div></div></div>'
      + '<button class="btn pri ob-cta" id="ob-extract">✨ Extract figures' + (scopeActive ? '' : ' from Library') + '</button>'
      + '<div class="ob-hint">' + scoped.length + ' paper' + (scoped.length === 1 ? '' : 's') + ' in ' + (scopeActive ? 'this scope' : 'your Library') + ' · ' + withDoi + ' can be extracted right now</div></div>';
  }
  function renderEmpty() {
    world.innerHTML = '';
    var prev = canvasEl.querySelector('.fb-ob-wrap'); if (prev) prev.remove();
    if (nd()) { var ov = el('div', 'fb-ob-wrap', onboardHTML()); canvasEl.appendChild(ov); var b = ov.querySelector('#ob-extract'); if (b) b.onclick = extractAll; }
    else { world.innerHTML = EMPTY; }
    apply();
  }
  var thumb = function (f) { var u = S.urls[f.storage_path]; return '<div class="thumb">' + (u ? '<img src="' + u + '" alt="' + esc(f.fig_label) + '" loading="lazy">' : '<div class="ph">…</div>') + '</div>'; };
  var activeReflow = function () { }, reflowT;
  function scheduleReflow() { if (reflowT) clearTimeout(reflowT); reflowT = setTimeout(function () { activeReflow(); }, 60); }
  function wireCards(sel) {
    world.querySelectorAll(sel).forEach(function (f) { f.onclick = function () { if (S.moved) return; openFig(f.dataset.pid, +f.dataset.i); }; });
    world.querySelectorAll('.cl-pin').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); if (S.moved) return; pinFigs(S.byPaper[b.dataset.pid] || [], (b.dataset.title || '').slice(0, 40)); }; });
    world.querySelectorAll('img').forEach(function (im) { im.addEventListener('load', scheduleReflow); im.addEventListener('error', scheduleReflow); });
  }
  function render() { var ob = canvasEl.querySelector('.fb-ob-wrap'); if (ob) ob.remove(); if (S.group === 'all') layoutGallery(); else layout(); }

  // shortest-column masonry over the actual (post-image-load) cluster heights → no overlap
  function reflow() {
    var COLW = 620, cx = 40, colH = [30, 30];
    world.querySelectorAll('.cluster').forEach(function (c) {
      var ci = colH[0] <= colH[1] ? 0 : 1;
      c.style.left = (cx + ci * COLW) + 'px'; c.style.top = colH[ci] + 'px';
      colH[ci] += c.offsetHeight + 40;
    });
  }
  // By-paper view: one card per paper, its figures in a row.
  function layout() {
    activeReflow = reflow;
    var withFigs = ordered(scopedPapers()).filter(function (p) { return (S.byPaper[p.id] || []).length; });
    world.innerHTML = '';
    if (!withFigs.length) { renderEmpty(); return; }
    withFigs.forEach(function (p) {
      var figs = S.byPaper[p.id] || [];
      var c = el('div', 'cluster'); c.dataset.pid = p.id;
      var thumbs = figs.map(function (f, i) {
        return '<div class="fig' + (f.hidden ? ' dim' : '') + '" data-pid="' + p.id + '" data-i="' + i + '">' + thumb(f)
          + '<div class="cap"><span class="pg">p.' + (f.page || '?') + ' · ' + esc(f.fig_label || 'Figure') + (f.hidden ? ' · hidden' : '') + '</span><br>' + esc((f.caption || '').replace(/^Fig(ure|\.)?\s*\d+[\.:\s]*/i, '')) + '</div></div>';
      }).join('');
      c.innerHTML = '<div class="cl-head"><div style="min-width:0"><b>' + esc(p.title || 'Untitled') + '</b><span>' + esc(fmtAuthors(p.authors) + (p.year ? ' · ' + p.year : '')) + ' · ' + figs.length + ' fig</span>' + metricRow(p) + '</div>'
        + '<button class="cl-pin" data-pid="' + p.id + '" data-title="' + esc(p.title || '') + '" title="Pin all figures from this paper to the research Canvas">📌 Pin all</button></div>'
        + '<div class="cl-box">'
        + (p.relevance ? '<div class="relbox"><span class="rk">✨ Why relevant</span>' + esc(p.relevance) + '</div>' : '')
        + ((p.abstract || p.doi) ? '<details class="abs" data-pid="' + p.id + '"><summary>📄 Abstract</summary><div class="abs-body">' + (p.abstract ? esc(p.abstract) : '<span class="abs-load">Click to load the abstract…</span>') + '</div></details>' : '')
        + '<div class="figrow">' + thumbs + '</div></div>';
      world.appendChild(c);
    });
    wireCards('.fig');
    world.querySelectorAll('details.abs').forEach(function (d) { d.addEventListener('toggle', function () { onAbstractToggle(d); }); });
    reflow(); apply();
  }
  // All-figures gallery: flat masonry of every figure thumbnail.
  function layoutGallery() {
    activeReflow = reflowGallery;
    world.innerHTML = '';
    var all = []; ordered(scopedPapers()).forEach(function (p) { (S.byPaper[p.id] || []).forEach(function (f, i) { all.push({ p: p, f: f, i: i }); }); });
    if (!all.length) { renderEmpty(); return; }
    all.forEach(function (o) {
      var f = o.f, p = o.p;
      var c = el('div', 'gcard' + (f.hidden ? ' dim' : '')); c.dataset.pid = p.id; c.dataset.i = o.i;
      c.innerHTML = thumb(f) + '<div class="gcap"><span class="pg">' + esc(f.fig_label || 'Figure') + (f.hidden ? ' · hidden' : '') + '</span> ' + esc((p.title || '').slice(0, 52)) + metricRow(p, true) + '</div>';
      world.appendChild(c);
    });
    wireCards('.gcard'); reflowGallery(); apply();
  }
  function reflowGallery() {
    var COLW = 284, cols = 4, colH = []; for (var i = 0; i < cols; i++) colH.push(30);
    world.querySelectorAll('.gcard').forEach(function (c) {
      var ci = 0; for (var j = 1; j < cols; j++) if (colH[j] < colH[ci]) ci = j;
      c.style.left = (40 + ci * COLW) + 'px'; c.style.top = colH[ci] + 'px'; colH[ci] += c.offsetHeight + 22;
    });
  }
  // lazy-load a cluster's abstract from OpenAlex on first open (many sources have none stored)
  function onAbstractToggle(d) {
    scheduleReflow();
    if (!d.open || d.dataset.loaded) return;
    var pid = d.dataset.pid, p = S.papers.filter(function (x) { return x.id === pid; })[0];
    if (!p || p.abstract) return;
    d.dataset.loaded = '1';
    var body = d.querySelector('.abs-body');
    if (body) body.innerHTML = '<span class="abs-load">Loading abstract…</span>';
    fetchAbstract(p).then(function (txt) {
      if (txt) { p.abstract = txt; if (body) body.textContent = txt; persistAbstract(p, txt); }
      else if (body) body.innerHTML = '<span class="abs-load">No abstract available for this paper.</span>';
      scheduleReflow();
    });
  }
  function apply() { var v = S.view; world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.k + ')'; canvasEl.style.backgroundSize = (26 * v.k) + 'px ' + (26 * v.k) + 'px'; canvasEl.style.backgroundPosition = v.x + 'px ' + v.y + 'px'; document.getElementById('zlvl').textContent = Math.round(v.k * 100) + '%'; }

  // one-shot per session: generate the "why relevant" blurbs for papers that don't have one yet
  var relevanceTried = false;
  function ensureRelevance() {
    if (relevanceTried) return;
    if (!S.papers.some(function (p) { return !p.relevance; })) return;
    relevanceTried = true;
    callFn('research-study', { action: 'relevance_batch', project_id: projId() }).then(function (res) {
      if (!res || !res.relevance) return;
      var any = false;
      S.papers.forEach(function (p) { if (res.relevance[p.id]) { p.relevance = res.relevance[p.id]; any = true; } });
      if (any) { sidebar(); render(); toast('✨ Added a relevance note to ' + res.generated + ' paper' + (res.generated === 1 ? '' : 's')); }
    }, function () { });
  }

  var SORTS = [['cites', 'Most cited'], ['year', 'Newest'], ['figs', 'Most figures'], ['q', 'Best quartile'], ['title', 'Title A–Z']];
  function sidebar() {
    var pid = projId();
    var scoped = scopedPapers();
    var rows = ordered(scoped).map(function (p) {
      var figs = S.byPaper[p.id] || [], n = figs.length, hasDoi = !!p.doi;
      var st = n ? 'ok' : (hasDoi ? 'idle' : 'nodoi'), ico = n ? '✓' : (hasDoi ? '↧' : '–');
      return '<div class="paper" data-pid="' + p.id + '"><span class="st ' + st + '">' + ico + '</span>'
        + '<span class="pt"><b>' + esc(p.title || 'Untitled') + '</b><span>' + esc(fmtAuthors(p.authors)) + (n ? ' · ' + n + ' figures' : hasDoi ? ' · not extracted' : ' · no DOI') + '</span>' + metricRow(p, true) + '</span></div>';
    }).join('');
    var sortOpts = SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (S.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    // extraction SCOPE: whole Library, only the included sources, or one specific study run
    var scopeOpts = '<option value="all"' + (S.scope === 'all' ? ' selected' : '') + '>📚 All Library (' + S.papers.length + ')</option>'
      + '<option value="included"' + (S.scope === 'included' ? ' selected' : '') + '>✓ Included only (' + scopeCount('included') + ')</option>'
      + S.studies.map(function (st) { var v = 'study:' + st.id; return '<option value="' + v + '"' + (S.scope === v ? ' selected' : '') + '>🔎 ' + esc((st.title || 'Study').slice(0, 46)) + ' (' + scopeCount(v) + ')</option>'; }).join('');
    var scopedDoi = scoped.filter(function (p) { return !!p.doi; }).length;
    sideEl.innerHTML = '<div class="extract-card"><div class="lead">Pull the figures out of your <b>Library</b> papers. Publify finds each open-access PDF and extracts its figures onto this board.</div>'
      + '<label class="fb-scope"><span class="fb-scope-k">Extract from</span><select class="sortsel" id="scopesel" title="Which publications to extract figures from">' + scopeOpts + '</select></label>'
      + '<button class="btn pri" id="extract">✨ Extract figures (' + scopedDoi + ' paper' + (scopedDoi === 1 ? '' : 's') + ')</button><div class="prog" id="prog"></div></div>'
      + '<div class="side-head"><h2>' + (S.scope === 'all' ? 'Library papers' : 'Papers in scope') + ' (' + scoped.length + ')</h2><select class="sortsel adv" id="sortsel" title="Sort the list">' + sortOpts + '</select></div>' + rows;
    document.getElementById('extract').onclick = extractAll;
    document.getElementById('sortsel').onchange = function (e) { S.sort = e.target.value; sidebar(); render(); };
    var scEl = document.getElementById('scopesel'); if (scEl) scEl.onchange = function (e) { S.scope = e.target.value; sidebar(); render(); };
    progEl = document.getElementById('prog');
    sideEl.querySelectorAll('.paper').forEach(function (el2) { el2.onclick = function () { flyTo(el2.dataset.pid); }; });
    var withFigs = scoped.filter(function (p) { return (S.byPaper[p.id] || []).length; }).length;
    var withDoi = scoped.filter(function (p) { return !!p.doi; }).length;
    var scopedFigs = scoped.reduce(function (a, p) { return a + (S.byPaper[p.id] || []).length; }, 0);
    statEl.innerHTML = '<span class="dot" style="background:var(--ok)"></span><b>' + withFigs + '</b> papers extracted · <b>' + scopedFigs + '</b> figures · ' + withDoi + ' have a DOI';
    var th = document.getElementById('toghide');
    if (th) { th.classList.toggle('on', S.showHidden); th.textContent = S.showHidden ? 'Hide hidden' : ('Show hidden' + (S.hiddenCount ? ' (' + S.hiddenCount + ')' : '')); th.style.display = (S.showHidden || S.hiddenCount) ? '' : 'none'; }
  }

  var extracting = false;
  function figTerminal(st) { return st === 'ok' || st === 'no_oa' || st === 'no_figs'; }   // attempted with a terminal result → skip (migration-64)
  function extractAll() {
    if (extracting) return; extracting = true;
    var todo = scopedPapers().filter(function (p) { return p.doi && !(S.byPaper[p.id] || []).length && !figTerminal(p.fig_status); });
    if (!todo.length) { progEl.innerHTML = 'All papers with a DOI in this scope are already extracted.'; extracting = false; return; }
    var i = 0, added = 0;
    function next() {
      if (i >= todo.length) {
        progEl.innerHTML = '✓ Done — ' + added + ' figures across ' + todo.length + ' papers.';
        extracting = false;
        load().then(function () { sidebar(); render(); });
        return;
      }
      var p = todo[i];
      progEl.innerHTML = '<div class="pbar"><i style="width:' + Math.round(i / todo.length * 100) + '%"></i></div><div class="prow"><span>' + esc((p.title || '').slice(0, 34)) + '…</span><span>' + (i + 1) + '/' + todo.length + '</span></div>';
      extractPaper(p, function (msg) { var pr = progEl.querySelector('.prow span'); if (pr) pr.textContent = msg; }).then(function (r) {
        // mark "attempted, produced nothing" so future runs skip it (migration-64; no-ops silently if the column is absent)
        if (r && (r.status === 'no_oa' || r.status === 'no_figs')) { try { sb.from('research_sources').update({ fig_status: r.status }).eq('id', p.id).then(function () { }, function () { }); } catch (e) { } }
        added += (r.figs || 0); i++; next();
      });
    }
    next();
  }

  function flyTo(pid) {
    var c = world.querySelector('.cluster[data-pid="' + pid + '"]') || world.querySelector('.gcard[data-pid="' + pid + '"]');
    if (!c) return;
    var r = canvasEl.getBoundingClientRect(); S.view.k = 0.85;
    S.view.x = r.width / 2 - (c.offsetLeft + c.offsetWidth / 2) * S.view.k;
    S.view.y = 120 - c.offsetTop * S.view.k; apply();
  }

  // ---------- drawer ----------
  function openFig(pid, i) {
    var f = (S.byPaper[pid] || [])[i], p = S.papers.filter(function (x) { return x.id === pid; })[0]; if (!f) return;
    S.curFig = f; S.curPaper = p;
    var u = S.urls[f.storage_path];
    document.getElementById('drfig').innerHTML = u ? '<img src="' + u + '">' : '';
    document.getElementById('drbody').innerHTML = '<div class="tag ok">◆ Extracted from OA PDF</div>'
      + '<h3>' + esc(f.fig_label || 'Figure') + '</h3><div class="dr-src">from <b>' + esc(p ? p.title : '') + '</b><br>' + esc(fmtAuthors(p && p.authors)) + (p && p.venue ? ' · ' + esc(p.venue) : '') + '</div>'
      + metricRow(p)
      + (p && p.relevance ? '<div class="relbox"><span class="rk">✨ Why relevant</span>' + esc(p.relevance) + '</div>' : '')
      + (f.caption ? '<div class="dr-cap">' + esc(f.caption) + '</div>' : '')
      + '<div class="kvs"><div class="kv"><span>Page</span><b>' + (f.page || '?') + '</b></div>'
      + (p && p.doi ? '<div class="kv"><span>DOI</span><b class="mono"><a href="https://doi.org/' + esc(bareDoi(p.doi)) + '" target="_blank" rel="noopener">' + esc(bareDoi(p.doi)) + '</a></b></div>' : '')
      + '<div class="kv"><span>Size</span><b>' + f.width + ' × ' + f.height + ' px</b></div></div>'
      + '<div class="dr-actions"><button class="btn pri" id="drpin">📌 Pin to Canvas</button>'
      + '<a class="btn" href="' + esc(u || '#') + '" download="' + esc((f.fig_label || 'figure').replace(/\s/g, '_')) + '.png" target="_blank">⬇ Download</a>'
      + (p && safeHref(p.url) ? '<a class="btn" href="' + esc(safeHref(p.url)) + '" target="_blank" rel="noopener">↗ Open paper</a>' : '')
      + '<button class="btn ' + (f.hidden ? 'restore' : 'ghost') + '" id="drhide">' + (f.hidden ? '↩ Restore' : '🙈 Hide') + '</button></div>';
    var pinB = document.getElementById('drpin'); if (pinB) pinB.onclick = function () { pinFigs([f], f.fig_label); };
    var hideB = document.getElementById('drhide'); if (hideB) hideB.onclick = function () { closeD(); setHidden(f, !f.hidden); };
    document.getElementById('scrim').classList.add('open'); document.getElementById('drawer').classList.add('open');
  }
  function closeD() { document.getElementById('scrim').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }

  // ---------- shell ----------
  function shell() {
    var NEW = nd();
    root.innerHTML = ''
      + '<div class="app' + (NEW ? ' newdesign ' + (S.pro ? 'pro' : 'simple') : '') + '"><div class="topbar">'
      + '<a class="brand" href="Research.html?project=' + esc(projId() || '') + '"><span class="mk"><i></i></span><span>Publify<small>Figure Board</small></span></a>'
      + (NEW ? '<span class="crumb">Figure Board</span>' : '')
      + '<span class="tstat" id="stat"></span><span class="spring"></span>'
      + (NEW ? '<div class="seg mode" id="modeseg" title="Simple shows the essentials; Pro reveals sorting, the gallery, hidden figures and bulk actions"><button data-m="simple"' + (S.pro ? '' : ' class="on"') + '>Simple</button><button data-m="pro"' + (S.pro ? ' class="on"' : '') + '>Pro</button></div>' : '')
      + '<div class="seg adv" id="grpseg"><button data-g="paper"' + (S.group === 'paper' ? ' class="on"' : '') + '>▦ By paper</button><button data-g="all"' + (S.group === 'all' ? ' class="on"' : '') + '>▨ All figures</button></div>'
      + '<button class="btn adv" id="toghide" title="Show figures you have hidden">Show hidden</button>'
      + '<button class="btn ic" id="fb-dark" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button>'
      + '<button class="btn ic' + (nd() ? ' on' : '') + '" id="fb-design" title="Toggle the new design (beta)" aria-label="Toggle the new design">✨</button>'
      + '<a class="btn" href="Research.html?project=' + esc(projId() || '') + '">← Research</a></div>'
      + '<aside class="side" id="side"></aside>'
      + '<div class="canvas" id="canvas"><div class="world" id="world"></div>'
      + '<div class="hintbar">Drag to pan · scroll to zoom · click a figure</div>'
      + '<div class="zoom"><button id="zin">+</button><div class="lvl" id="zlvl">90%</div><button id="zout">−</button><button id="zfit">⤢</button></div></div></div>'
      + '<div class="scrim" id="scrim"></div><aside class="drawer" id="drawer"><button class="dr-close" id="drclose">✕</button><div class="dr-fig" id="drfig"></div><div class="dr-body" id="drbody"></div></aside>';
    world = document.getElementById('world'); canvasEl = document.getElementById('canvas'); sideEl = document.getElementById('side'); statEl = document.getElementById('stat');
    // pan/zoom — a movement threshold distinguishes a click (opens a figure) from a drag (pans the board),
    // so panning can start anywhere, including on a figure card, without spuriously opening its drawer.
    var drag = false, sx, sy, ox, oy;
    canvasEl.addEventListener('mousedown', function (e) { if (e.button !== 0 || e.target.closest('.zoom')) return; drag = true; S.moved = false; sx = e.clientX; sy = e.clientY; ox = S.view.x; oy = S.view.y; });
    window.addEventListener('mousemove', function (e) { if (!drag) return; var dx = e.clientX - sx, dy = e.clientY - sy; if (!S.moved && (dx * dx + dy * dy) > 16) { S.moved = true; canvasEl.classList.add('grab'); } if (!S.moved) return; S.view.x = ox + dx; S.view.y = oy + dy; apply(); });
    window.addEventListener('mouseup', function () { drag = false; canvasEl.classList.remove('grab'); });
    canvasEl.addEventListener('wheel', function (e) { e.preventDefault(); var r = canvasEl.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0016), nk = Math.max(0.22, Math.min(2.6, S.view.k * f)), s = nk / S.view.k; S.view.x = mx - (mx - S.view.x) * s; S.view.y = my - (my - S.view.y) * s; S.view.k = nk; apply(); }, { passive: false });
    function zoomBy(f) { var r = canvasEl.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2, nk = Math.max(0.22, Math.min(2.6, S.view.k * f)), s = nk / S.view.k; S.view.x = mx - (mx - S.view.x) * s; S.view.y = my - (my - S.view.y) * s; S.view.k = nk; apply(); }
    document.getElementById('zin').onclick = function () { zoomBy(1.2); }; document.getElementById('zout').onclick = function () { zoomBy(1 / 1.2); };
    document.getElementById('zfit').onclick = function () { S.view = { x: 40, y: 24, k: 0.6 }; apply(); };
    document.getElementById('scrim').onclick = closeD; document.getElementById('drclose').onclick = closeD;
    addEventListener('keydown', function (e) { if (e.key === 'Escape') closeD(); });
    // group segmented control
    document.getElementById('grpseg').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        if (S.group === b.dataset.g) return;
        S.group = b.dataset.g;
        document.getElementById('grpseg').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.g === S.group); });
        render();
      };
    });
    // show/hide hidden figures
    var th = document.getElementById('toghide');
    th.onclick = function () {
      S.showHidden = !S.showHidden;
      th.classList.toggle('on', S.showHidden);
      th.textContent = S.showHidden ? 'Hide hidden' : 'Show hidden';
      load().then(function () { sidebar(); render(); });
    };
    // theme + design toggles (this standalone page has no nav drawer, so expose them here)
    var fbd = document.getElementById('fb-dark'); if (fbd) fbd.onclick = function () { if (window.PRTheme) window.PRTheme.toggle(); };
    var fbg = document.getElementById('fb-design'); if (fbg) fbg.onclick = function () { if (window.PRDesign) window.PRDesign.toggle(); };
    // Simple ⇄ Pro (new design) — progressive disclosure of the advanced controls
    var ms = document.getElementById('modeseg');
    if (ms) ms.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        var pro = b.dataset.m === 'pro'; if (pro === S.pro) return;
        S.pro = pro; var app = document.querySelector('.app'); app.classList.toggle('pro', pro); app.classList.toggle('simple', !pro);
        ms.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', (x.dataset.m === 'pro') === pro); });
        if (!pro) {
          // entering Simple → snap back to the essentials so no advanced-only state is left stranded
          S.group = 'paper';
          var gs = document.getElementById('grpseg'); if (gs) gs.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.g === 'paper'); });
          if (S.showHidden) { S.showHidden = false; load().then(function () { sidebar(); render(); }); return; }
        }
        sidebar(); render();
      };
    });
    window.addEventListener('resize', scheduleReflow);
  }

  // ---------- boot ----------
  if (!BE || !BE.sb) { root.innerHTML = '<div class="center"><div class="box"><h1>Backend unavailable</h1></div></div>'; return; }
  if (BE.mode !== 'cloud' || !BE.user) { root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>Sign in</h1><p>Open the Figure Board from a project.</p><a class="btn" href="Landing.html">Sign in</a></div></div>'; return; }
  if (!projId()) { root.innerHTML = '<div class="center"><div class="box"><h1>No project</h1><p>Open the Figure Board from Research → a project → Literature.</p><a class="btn" href="Research.html">← Research</a></div></div>'; return; }
  window.addEventListener('pr-design', function () { location.reload(); });   // re-init cleanly when the New-design flag flips
  shell();
  progEl = null;
  Promise.all([load(), loadScimago()]).then(function () { sidebar(); render(); ensureRelevance(); }, function () { root.innerHTML = '<div class="center"><div class="box"><h1>Could not load</h1><p>This project may not exist or you may not have access.</p><a class="btn" href="Research.html">← Research</a></div></div>'; });
})();
