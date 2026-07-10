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

  function proxy(body, binary) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/pdf-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) })
        .then(function (r) { return binary ? (r.ok ? r.arrayBuffer() : r.json().then(function (e) { throw new Error((e && e.error) || 'fetch failed'); })) : r.json(); });
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
  var S = { papers: [], figs: [], byPaper: {}, urls: {}, view: { x: 40, y: 24, k: 0.9 }, group: 'paper', showHidden: false, curFig: null, curPaper: null, hiddenCount: 0 };
  function uid() { return 'n' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function toast(msg, ok) { var t = el('div', 'fb-toast' + (ok === false ? ' err' : '')); t.textContent = msg; document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add('show'); }); setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }, 2400); }
  function load() {
    var pid = projId(); if (!pid) return Promise.reject('no project');
    var figQ = sb.from('research_figures').select('*').eq('project_id', pid).order('ord', { ascending: true });
    if (!S.showHidden) figQ = figQ.eq('hidden', false);
    return Promise.all([
      sb.from('research_sources').select('id,project_id,title,authors,year,doi,url,venue').eq('project_id', pid).order('year', { ascending: false, nullsFirst: false }),
      figQ,
      sb.from('research_figures').select('id', { count: 'exact', head: true }).eq('project_id', pid).eq('hidden', true)
    ]).then(function (r) {
      S.papers = (r[0] && r[0].data) || [];
      S.figs = (r[1] && r[1].data) || [];
      S.hiddenCount = (r[2] && r[2].count) || 0;
      S.byPaper = {}; S.figs.forEach(function (f) { (S.byPaper[f.source_id] = S.byPaper[f.source_id] || []).push(f); });
      return signUrls();
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
  var EMPTY = '<div class="cluster" style="left:40px;top:40px;width:440px;padding:26px 24px"><b style="font-size:14px">No figures yet</b><div style="font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.5">Hit <b>Extract figures from Library</b> on the left. Publify finds each paper’s open-access PDF and pulls its figures onto this board.</div></div>';
  var thumb = function (f) { var u = S.urls[f.storage_path]; return '<div class="thumb">' + (u ? '<img src="' + u + '" alt="' + esc(f.fig_label) + '" loading="lazy">' : '<div class="ph">…</div>') + '</div>'; };
  var activeReflow = function () { }, reflowT;
  function scheduleReflow() { if (reflowT) clearTimeout(reflowT); reflowT = setTimeout(function () { activeReflow(); }, 60); }
  function wireCards(sel) {
    world.querySelectorAll(sel).forEach(function (f) { f.onclick = function () { openFig(f.dataset.pid, +f.dataset.i); }; });
    world.querySelectorAll('.cl-pin').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); pinFigs(S.byPaper[b.dataset.pid] || [], (b.dataset.title || '').slice(0, 40)); }; });
    world.querySelectorAll('img').forEach(function (im) { im.addEventListener('load', scheduleReflow); im.addEventListener('error', scheduleReflow); });
  }
  function render() { if (S.group === 'all') layoutGallery(); else layout(); }

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
    var withFigs = S.papers.filter(function (p) { return (S.byPaper[p.id] || []).length; });
    world.innerHTML = '';
    if (!withFigs.length) { world.innerHTML = EMPTY; apply(); return; }
    withFigs.forEach(function (p) {
      var figs = S.byPaper[p.id] || [];
      var c = el('div', 'cluster'); c.dataset.pid = p.id;
      var thumbs = figs.map(function (f, i) {
        return '<div class="fig' + (f.hidden ? ' dim' : '') + '" data-pid="' + p.id + '" data-i="' + i + '">' + thumb(f)
          + '<div class="cap"><span class="pg">p.' + (f.page || '?') + ' · ' + esc(f.fig_label || 'Figure') + (f.hidden ? ' · hidden' : '') + '</span><br>' + esc((f.caption || '').replace(/^Fig(ure|\.)?\s*\d+[\.:\s]*/i, '')) + '</div></div>';
      }).join('');
      c.innerHTML = '<div class="cl-head"><div style="min-width:0"><b>' + esc(p.title || 'Untitled') + '</b><span>' + esc(fmtAuthors(p.authors) + (p.year ? ' · ' + p.year : '')) + ' · ' + figs.length + ' fig</span></div>'
        + '<button class="cl-pin" data-pid="' + p.id + '" data-title="' + esc(p.title || '') + '" title="Pin all figures from this paper to the research Canvas">📌 Pin all</button></div>'
        + '<div class="cl-box"><div class="figrow">' + thumbs + '</div></div>';
      world.appendChild(c);
    });
    wireCards('.fig'); reflow(); apply();
  }
  // All-figures gallery: flat masonry of every figure thumbnail.
  function layoutGallery() {
    activeReflow = reflowGallery;
    world.innerHTML = '';
    var all = []; S.papers.forEach(function (p) { (S.byPaper[p.id] || []).forEach(function (f, i) { all.push({ p: p, f: f, i: i }); }); });
    if (!all.length) { world.innerHTML = EMPTY; apply(); return; }
    all.forEach(function (o) {
      var f = o.f, p = o.p;
      var c = el('div', 'gcard' + (f.hidden ? ' dim' : '')); c.dataset.pid = p.id; c.dataset.i = o.i;
      c.innerHTML = thumb(f) + '<div class="gcap"><span class="pg">' + esc(f.fig_label || 'Figure') + (f.hidden ? ' · hidden' : '') + '</span> ' + esc((p.title || '').slice(0, 52)) + '</div>';
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
  function apply() { var v = S.view; world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.k + ')'; canvasEl.style.backgroundSize = (26 * v.k) + 'px ' + (26 * v.k) + 'px'; canvasEl.style.backgroundPosition = v.x + 'px ' + v.y + 'px'; document.getElementById('zlvl').textContent = Math.round(v.k * 100) + '%'; }

  function sidebar() {
    var pid = projId();
    var rows = S.papers.map(function (p) {
      var figs = S.byPaper[p.id] || [], n = figs.length, hasDoi = !!p.doi;
      var st = n ? 'ok' : (hasDoi ? 'idle' : 'nodoi'), ico = n ? '✓' : (hasDoi ? '↧' : '–');
      return '<div class="paper" data-pid="' + p.id + '"><span class="st ' + st + '">' + ico + '</span>'
        + '<span class="pt"><b>' + esc(p.title || 'Untitled') + '</b><span>' + esc(fmtAuthors(p.authors)) + (n ? ' · ' + n + ' figures' : hasDoi ? ' · not extracted' : ' · no DOI') + '</span></span></div>';
    }).join('');
    sideEl.innerHTML = '<div class="extract-card"><div class="lead">Pull the figures out of your <b>Library</b> papers. Publify finds each open-access PDF and extracts its figures onto this board.</div>'
      + '<button class="btn pri" id="extract">✨ Extract figures from Library</button><div class="prog" id="prog"></div></div>'
      + '<h2>Library papers (' + S.papers.length + ')</h2>' + rows;
    document.getElementById('extract').onclick = extractAll;
    progEl = document.getElementById('prog');
    sideEl.querySelectorAll('.paper').forEach(function (el2) { el2.onclick = function () { flyTo(el2.dataset.pid); }; });
    var withFigs = S.papers.filter(function (p) { return (S.byPaper[p.id] || []).length; }).length;
    var withDoi = S.papers.filter(function (p) { return !!p.doi; }).length;
    statEl.innerHTML = '<span class="dot" style="background:var(--ok)"></span><b>' + withFigs + '</b> papers extracted · <b>' + S.figs.length + '</b> figures · ' + withDoi + ' have a DOI';
    var th = document.getElementById('toghide');
    if (th) { th.classList.toggle('on', S.showHidden); th.textContent = S.showHidden ? 'Hide hidden' : ('Show hidden' + (S.hiddenCount ? ' (' + S.hiddenCount + ')' : '')); th.style.display = (S.showHidden || S.hiddenCount) ? '' : 'none'; }
  }

  var extracting = false;
  function extractAll() {
    if (extracting) return; extracting = true;
    var todo = S.papers.filter(function (p) { return p.doi && !(S.byPaper[p.id] || []).length; });
    if (!todo.length) { progEl.innerHTML = 'All papers with a DOI are already extracted.'; extracting = false; return; }
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
      + (f.caption ? '<div class="dr-cap">' + esc(f.caption) + '</div>' : '')
      + '<div class="kvs"><div class="kv"><span>Page</span><b>' + (f.page || '?') + '</b></div>'
      + (p && p.doi ? '<div class="kv"><span>DOI</span><b class="mono"><a href="https://doi.org/' + esc(bareDoi(p.doi)) + '" target="_blank" rel="noopener">' + esc(bareDoi(p.doi)) + '</a></b></div>' : '')
      + '<div class="kv"><span>Size</span><b>' + f.width + ' × ' + f.height + ' px</b></div></div>'
      + '<div class="dr-actions"><button class="btn pri" id="drpin">📌 Pin to Canvas</button>'
      + '<a class="btn" href="' + (u || '#') + '" download="' + esc((f.fig_label || 'figure').replace(/\s/g, '_')) + '.png" target="_blank">⬇ Download</a>'
      + (p && p.url ? '<a class="btn" href="' + esc(p.url) + '" target="_blank" rel="noopener">↗ Open paper</a>' : '')
      + '<button class="btn ' + (f.hidden ? 'restore' : 'ghost') + '" id="drhide">' + (f.hidden ? '↩ Restore' : '🙈 Hide') + '</button></div>';
    var pinB = document.getElementById('drpin'); if (pinB) pinB.onclick = function () { pinFigs([f], f.fig_label); };
    var hideB = document.getElementById('drhide'); if (hideB) hideB.onclick = function () { closeD(); setHidden(f, !f.hidden); };
    document.getElementById('scrim').classList.add('open'); document.getElementById('drawer').classList.add('open');
  }
  function closeD() { document.getElementById('scrim').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }

  // ---------- shell ----------
  function shell() {
    root.innerHTML = ''
      + '<div class="app"><div class="topbar">'
      + '<a class="brand" href="Research.html?project=' + esc(projId() || '') + '"><span class="mk"><i></i></span><span>Publify<small>Figure Board</small></span></a>'
      + '<span class="tstat" id="stat"></span><span class="spring"></span>'
      + '<div class="seg" id="grpseg"><button data-g="paper" class="on">▦ By paper</button><button data-g="all">▨ All figures</button></div>'
      + '<button class="btn" id="toghide" title="Show figures you have hidden">Show hidden</button>'
      + '<a class="btn" href="Research.html?project=' + esc(projId() || '') + '">← Research</a></div>'
      + '<aside class="side" id="side"></aside>'
      + '<div class="canvas" id="canvas"><div class="world" id="world"></div>'
      + '<div class="hintbar">Drag to pan · scroll to zoom · click a figure</div>'
      + '<div class="zoom"><button id="zin">+</button><div class="lvl" id="zlvl">90%</div><button id="zout">−</button><button id="zfit">⤢</button></div></div></div>'
      + '<div class="scrim" id="scrim"></div><aside class="drawer" id="drawer"><button class="dr-close" id="drclose">✕</button><div class="dr-fig" id="drfig"></div><div class="dr-body" id="drbody"></div></aside>';
    world = document.getElementById('world'); canvasEl = document.getElementById('canvas'); sideEl = document.getElementById('side'); statEl = document.getElementById('stat');
    // pan/zoom
    var drag = false, sx, sy, ox, oy;
    canvasEl.addEventListener('mousedown', function (e) { if (e.target.closest('.fig') || e.target.closest('.zoom')) return; drag = true; canvasEl.classList.add('grab'); sx = e.clientX; sy = e.clientY; ox = S.view.x; oy = S.view.y; });
    window.addEventListener('mousemove', function (e) { if (!drag) return; S.view.x = ox + (e.clientX - sx); S.view.y = oy + (e.clientY - sy); apply(); });
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
    window.addEventListener('resize', scheduleReflow);
  }

  // ---------- boot ----------
  if (!BE || !BE.sb) { root.innerHTML = '<div class="center"><div class="box"><h1>Backend unavailable</h1></div></div>'; return; }
  if (BE.mode !== 'cloud' || !BE.user) { root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>Sign in</h1><p>Open the Figure Board from a project.</p><a class="btn" href="Landing.html">Sign in</a></div></div>'; return; }
  if (!projId()) { root.innerHTML = '<div class="center"><div class="box"><h1>No project</h1><p>Open the Figure Board from Research → a project → Literature.</p><a class="btn" href="Research.html">← Research</a></div></div>'; return; }
  shell();
  progEl = null;
  load().then(function () { sidebar(); render(); }, function () { root.innerHTML = '<div class="center"><div class="box"><h1>Could not load</h1><p>This project may not exist or you may not have access.</p><a class="btn" href="Research.html">← Research</a></div></div>'; });
})();
