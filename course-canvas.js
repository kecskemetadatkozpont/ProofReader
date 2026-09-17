/* Publify — Course Canvas (CourseCanvas.html?course=<id>).
 * The shared class canvas ("évfolyam-vászon") of the Course module: every student's generated
 * artefact (image / video / audio / text / link) is a card on an infinite pan-zoom board — the
 * engine is forked from figure-board.js. One tab per lecture (course_lectures) + a whole-semester
 * view. Card front = media + author (anonymity-aware canvas_author RPC) + reactions; clicking a
 * card flips it to its provenance back (full prompt, model, params, mcp_call_log id). Own items
 * are draggable (position persisted on drag-end, figure-board threshold pattern); instructors
 * moderate via the context menu (pin / hide) and run in-class polls (course_polls +
 * course_poll_votes, migration-68): members vote on each other's work (never their own), live
 * counts via the poll_results RPC + Realtime, medals for the top 3 once the poll closes.
 * Voters stay anonymous to peers (aggregate counts only); instructors can list them.
 * Plain DOM (no React); Realtime subscription pattern follows autopilot.js. UI copy is Hungarian. */
(function () {
  'use strict';
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var root = document.getElementById('root');
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]; }); }
  function courseId() { try { return new URLSearchParams(location.search).get('course'); } catch (e) { return null; } }
  // only http(s) links may become an href/src — blocks javascript:/data: schemes from user-supplied media URLs
  function safeHref(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  function hhmm(ts) { var d = ts ? new Date(ts) : new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function toast(msg, ok) { var t = el('div', 'cc-toast' + (ok === false ? ' err' : '')); t.textContent = msg; document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add('show'); }); setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }, 2400); }

  // ---------- state ----------
  var cid = courseId();
  var me = (BE && BE.user && BE.user.id) || null;
  var S = {
    course: null, lectures: [], items: [], polls: [],
    authors: {},            // item_id -> {display_name, avatar_url} (canvas_author RPC, anonymity-aware)
    urls: {},               // storage path -> signed URL (course-media)
    rxCount: {}, rxMine: {},// reactions: 'item|emoji' -> count / mine flag
    results: {}, myVotes: [], voteSig: '',   // poll: item_id -> votes, my voted item ids
    flipped: {}, fresh: {}, // card UI state survives re-render
    view: { x: 40, y: 24, k: 0.9 }, lecture: 'all', isInstructor: false, moved: false
  };
  var RX = ['❤️', '💡'];
  var AV = ['linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#22d3ee,#3b82f6)',
    'linear-gradient(135deg,#a855f7,#ec4899)', 'linear-gradient(135deg,#10b981,#84cc16)', 'linear-gradient(135deg,#6366f1,#d946ef)'];
  function avStyle(name) {
    if (name === 'Anonim hallgató') return 'background:var(--surface-3);border:1px solid var(--line)';
    var h = 0, s2 = String(name || '?'); for (var i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) & 0xffff;
    return 'background:' + AV[h % AV.length];
  }

  // ---------- data ----------
  function load() {
    return Promise.all([
      sb.from('courses').select('id,title').eq('id', cid).maybeSingle(),
      sb.from('course_lectures').select('id,ord,title,visible').eq('course_id', cid).order('ord', { ascending: true }),
      sb.from('course_canvas_items').select('*').eq('course_id', cid).order('created_at', { ascending: true }),
      sb.from('course_polls').select('*').eq('course_id', cid).order('created_at', { ascending: false })
    ]).then(function (r) {
      S.course = (r[0] && r[0].data) || null;
      S.lectures = (r[1] && r[1].data) || [];
      S.items = (r[2] && r[2].data) || [];
      S.polls = (r[3] && r[3].data) || [];
      return Promise.all([signUrls(), fetchAuthors(S.items), loadReactions()]);
    });
  }
  // signed URLs for the private course-media bucket (figure-board createSignedUrls pattern)
  function signUrls() {
    var paths = [];
    S.items.forEach(function (it) {
      if (it.media_path && !S.urls[it.media_path]) paths.push(it.media_path);
      if (it.thumb_path && !S.urls[it.thumb_path]) paths.push(it.thumb_path);
    });
    if (!paths.length) return Promise.resolve();
    return sb.storage.from('course-media').createSignedUrls(paths, 3600).then(function (r) {
      ((r && r.data) || []).forEach(function (x) { if (x && x.signedUrl && x.path) S.urls[x.path] = x.signedUrl; });
    }, function () { });
  }
  // author display via the SECURITY DEFINER canvas_author RPC — the server decides anonymity, not the client
  function fetchAuthors(items) {
    var todo = (items || []).filter(function (it) { return !S.authors[it.id]; });
    if (!todo.length) return Promise.resolve();
    return Promise.all(todo.map(function (it) {
      return sb.rpc('canvas_author', { item: it.id }).then(function (r) {
        var row = (r && r.data && r.data[0]) || null;
        S.authors[it.id] = row || { display_name: 'Hallgató', avatar_url: null };
      }, function () { S.authors[it.id] = { display_name: 'Hallgató', avatar_url: null }; });
    }));
  }
  function loadReactions() {
    var ids = S.items.map(function (it) { return it.id; });
    if (!ids.length) { S.rxCount = {}; S.rxMine = {}; return Promise.resolve(); }
    return sb.from('course_canvas_reactions').select('item_id,user_id,emoji').in('item_id', ids).then(function (r) {
      var cnt = {}, mine = {};
      ((r && r.data) || []).forEach(function (x) {
        var k = x.item_id + '|' + x.emoji;
        cnt[k] = (cnt[k] || 0) + 1;
        if (x.user_id === me) mine[k] = true;
      });
      S.rxCount = cnt; S.rxMine = mine;
    }, function () { });
  }

  // ---------- lecture scope ----------
  function ordOf(lid) { for (var i = 0; i < S.lectures.length; i++) if (S.lectures[i].id === lid) return S.lectures[i].ord; return null; }
  function itemsInScope() { return S.lecture === 'all' ? S.items : S.items.filter(function (it) { return it.lecture_id === S.lecture; }); }

  // ---------- polls (migration-68: course_polls + course_poll_votes + cast_vote/retract_vote/poll_results) ----------
  function pollMatchesScope(p) { return S.lecture === 'all' || !p.lecture_id || p.lecture_id === S.lecture; }
  function openPollFor() { for (var i = 0; i < S.polls.length; i++) if (S.polls[i].status === 'open' && pollMatchesScope(S.polls[i])) return S.polls[i]; return null; }
  function closedPollFor() { for (var i = 0; i < S.polls.length; i++) if (S.polls[i].status === 'closed' && pollMatchesScope(S.polls[i])) return S.polls[i]; return null; }
  function visiblePoll() { return openPollFor() || closedPollFor(); }
  function loadVotes(p) {
    if (!p) { S.results = {}; S.myVotes = []; S.voteSig = ''; return Promise.resolve(false); }
    return Promise.all([
      sb.rpc('poll_results', { p_poll: p.id }),
      sb.from('course_poll_votes').select('item_id').eq('poll_id', p.id).eq('voter_id', me)
    ]).then(function (r) {
      var res = {};
      ((r[0] && r[0].data) || []).forEach(function (row) { if (row && row.item_id) res[row.item_id] = +(row.votes || 0); });
      var mv = ((r[1] && r[1].data) || []).map(function (x) { return x.item_id; });
      var sig = JSON.stringify([res, mv, p.id, p.status]);
      var changed = sig !== S.voteSig;
      S.results = res; S.myVotes = mv; S.voteSig = sig;
      return changed;
    }, function () { return false; });
  }
  // top-3 medals once the poll is closed
  function medals() {
    var p = visiblePoll();
    if (!p || p.status !== 'closed') return {};
    var ranked = Object.keys(S.results).filter(function (id) { return S.results[id] > 0; })
      .sort(function (a, b) { return S.results[b] - S.results[a]; });
    var m = {}, ico = ['🥇', '🥈', '🥉'];
    ranked.slice(0, 3).forEach(function (id, i) { m[id] = ico[i]; });
    return m;
  }
  function castVote(it) {
    var p = openPollFor(); if (!p) return;
    if (it.author_id === me) { toast('Saját munkára nem szavazhatsz', false); return; }
    var max = +(p.max_votes_per_voter || 3);
    var voted = S.myVotes.indexOf(it.id) >= 0;
    if (voted) {
      sb.rpc('retract_vote', { p_poll: p.id, p_item: it.id }).then(function (r) {
        if (r && r.error) { toast(r.error.message, false); return; }
        S.myVotes = S.myVotes.filter(function (x) { return x !== it.id; });
        S.results[it.id] = Math.max(0, (S.results[it.id] || 1) - 1);
        toast('↩ Szavazat visszavonva');
        pollbar(); render();
        loadVotes(p).then(function (ch) { if (ch) { pollbar(); render(); } });
      });
      return;
    }
    if (S.myVotes.length >= max) { toast('Nincs több szavazatod ebben a szavazásban (' + max + '/' + max + ')', false); return; }
    sb.rpc('cast_vote', { p_poll: p.id, p_item: it.id }).then(function (r) {
      if (r && r.error) { toast(r.error.message, false); return; }
      S.myVotes.push(it.id);
      S.results[it.id] = (S.results[it.id] || 0) + 1;
      toast('🏆 Szavazat leadva');
      pollbar(); render();
      loadVotes(p).then(function (ch) { if (ch) { pollbar(); render(); } });
    });
  }
  function reloadPolls() {
    return sb.from('course_polls').select('*').eq('course_id', cid).order('created_at', { ascending: false }).then(function (r) {
      var list = (r && r.data) || [];
      var pollsChanged = JSON.stringify(list) !== JSON.stringify(S.polls);
      S.polls = list;
      var p = visiblePoll();
      subscribeVotes(p);
      return loadVotes(p).then(function (votesChanged) { if (pollsChanged || votesChanged) { pollbar(); render(); } });
    });
  }

  // ---------- moderation + own delete ----------
  function modItem(it, patch, msg) {
    sb.from('course_canvas_items').update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq('id', it.id).then(function (r) {
      if (r && r.error) { toast(r.error.message, false); return; }
      Object.assign(it, patch);
      toast(msg);
      render();
    });
  }
  function delItem(it) {
    if (!window.confirm('Biztosan törlöd a saját elemedet a vászonról? Ez nem vonható vissza.')) return;
    sb.from('course_canvas_items').delete().eq('id', it.id).then(function (r) {
      if (r && r.error) { toast(r.error.message, false); return; }
      S.items = S.items.filter(function (x) { return x.id !== it.id; });
      toast('🗑 Elem törölve');
      render();
    });
  }

  // ---------- render: shell ----------
  var world, canvasEl, statEl;
  function shell() {
    root.innerHTML = ''
      + '<div class="app"><div class="topbar">'
      + '<a class="brand" href="Course.html?course=' + esc(cid || '') + '"><span class="mk"><i></i></span><span>Publify<small>Évfolyam-vászon</small></span></a>'
      + '<span class="crumb" id="crumb"></span>'
      + '<span class="tstat" id="stat"></span><span class="spring"></span>'
      + '<a class="btn pri" href="Course.html?course=' + esc(cid || '') + '" title="Új munkát a laborfüzet MCP-paneljéből tehetsz ki (Vászonra teszem)">＋ Saját munka (laborfüzet)</a>'
      + '<button class="btn ic" id="cc-dark" title="Sötét mód váltása" aria-label="Sötét mód váltása">◐</button>'
      + '<a class="btn" href="Course.html?course=' + esc(cid || '') + '">← Kurzus</a></div>'
      + '<div class="cvtop"><div class="lect-tabs" id="lecttabs" aria-label="Előadás-lapok"></div></div>'
      + '<div class="pollbar off" id="pollbar"></div>'
      + '<div class="canvas" id="canvas"><div class="world" id="world"></div>'
      + '<div class="hintbar">Húzás = mozgás · görgetés = zoom · kattintás = prompt-hátlap · a saját kártyád áthelyezhető</div>'
      + '<div class="zoom"><button id="zin">+</button><div class="lvl" id="zlvl">90%</div><button id="zout">−</button><button id="zfit" title="Nézet visszaállítása">⤢</button></div></div>'
      + '<aside class="livefeed" aria-label="Élő aktivitás"><div class="lf-h"><span class="live"></span>Élő vászon</div><div class="lf-b" id="lfb"></div></aside></div>';
    world = document.getElementById('world'); canvasEl = document.getElementById('canvas'); statEl = document.getElementById('stat');

    // pan/zoom — figure-board engine: a movement threshold distinguishes a click (flips a card)
    // from a drag (pans the board), so panning can start anywhere, including on a card.
    var drag = false, sx, sy, ox, oy;
    canvasEl.addEventListener('mousedown', function (e) { if (e.button !== 0 || e.target.closest('.zoom')) return; drag = true; S.moved = false; sx = e.clientX; sy = e.clientY; ox = S.view.x; oy = S.view.y; });
    window.addEventListener('mousemove', function (e) {
      if (idrag) { moveItemDrag(e); return; }
      if (!drag) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!S.moved && (dx * dx + dy * dy) > 16) { S.moved = true; canvasEl.classList.add('grab'); }
      if (!S.moved) return;
      S.view.x = ox + dx; S.view.y = oy + dy; apply();
    });
    window.addEventListener('mouseup', function () { drag = false; canvasEl.classList.remove('grab'); endItemDrag(); });
    canvasEl.addEventListener('wheel', function (e) { e.preventDefault(); var r = canvasEl.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0016), nk = Math.max(0.22, Math.min(2.6, S.view.k * f)), s = nk / S.view.k; S.view.x = mx - (mx - S.view.x) * s; S.view.y = my - (my - S.view.y) * s; S.view.k = nk; apply(); }, { passive: false });
    function zoomBy(f) { var r = canvasEl.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2, nk = Math.max(0.22, Math.min(2.6, S.view.k * f)), s = nk / S.view.k; S.view.x = mx - (mx - S.view.x) * s; S.view.y = my - (my - S.view.y) * s; S.view.k = nk; apply(); }
    document.getElementById('zin').onclick = function () { zoomBy(1.2); };
    document.getElementById('zout').onclick = function () { zoomBy(1 / 1.2); };
    document.getElementById('zfit').onclick = function () { S.view = { x: 40, y: 24, k: 0.7 }; apply(); };
    var dk = document.getElementById('cc-dark'); if (dk) dk.onclick = function () { if (window.PRTheme) window.PRTheme.toggle(); };
    addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenu(); closeDlg(); } });
  }
  function apply() { var v = S.view; world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.k + ')'; canvasEl.style.backgroundSize = (26 * v.k) + 'px ' + (26 * v.k) + 'px'; canvasEl.style.backgroundPosition = v.x + 'px ' + v.y + 'px'; var z = document.getElementById('zlvl'); if (z) z.textContent = Math.round(v.k * 100) + '%'; }

  // ---------- render: lecture tabs + stat ----------
  function tabsBar() {
    var box = document.getElementById('lecttabs'); if (!box) return;
    var html = S.lectures.map(function (l) {
      var on = S.lecture === l.id;
      var label = on ? (l.ord + ' · ' + esc(String(l.title || '').slice(0, 26))) : String(l.ord);
      return '<span data-lid="' + l.id + '"' + (on ? ' class="on"' : '') + ' title="' + esc(l.title || '') + '">' + label + '</span>';
    }).join('');
    html += '<span data-lid="all"' + (S.lecture === 'all' ? ' class="on"' : '') + '>Teljes félév</span>';
    box.innerHTML = html;
    box.querySelectorAll('span').forEach(function (t) {
      t.onclick = function () {
        if (S.lecture === t.dataset.lid) return;
        S.lecture = t.dataset.lid;
        tabsBar();
        var p = visiblePoll();
        subscribeVotes(p);
        loadVotes(p).then(function () { pollbar(); render(); });
      };
    });
  }
  function stat() {
    var scoped = itemsInScope();
    var authors = {}; scoped.forEach(function (it) { authors[it.author_id] = 1; });
    statEl.innerHTML = '<span class="dot" style="background:var(--ok)"></span><b>' + scoped.length + '</b> munka · <b>' + Object.keys(authors).length + '</b> szerző';
    var cr = document.getElementById('crumb'); if (cr) cr.textContent = (S.course && S.course.title) || '';
  }

  // ---------- render: poll bar ----------
  function pollbar() {
    var bar = document.getElementById('pollbar'); if (!bar) return;
    var op = openPollFor(), cl = op ? null : closedPollFor(), html = '';
    if (op) {
      var max = +(op.max_votes_per_voter || 3), left = Math.max(0, max - S.myVotes.length);
      html = '<span class="pb-ico">🏆</span><span class="pb-t"><b>' + esc(op.title || 'Szavazás') + '</b>'
        + (op.category ? ' <span class="pchip">' + esc(op.category) + '</span>' : '')
        + ' — <b>' + left + '</b>/' + max + ' szavazatod maradt · kattints a kártyák 🏆 gombjára (a szavazók a társak felé anonimek)</span>'
        + '<span class="spring"></span>'
        + (S.isInstructor ? '<button class="btn sm" id="pb-close">⏹ Szavazás lezárása</button>' : '');
    } else if (cl) {
      html = '<span class="pb-ico">🏁</span><span class="pb-t"><b>' + esc(cl.title || 'Szavazás') + '</b> — lezárva · a top-3 munka érmet kapott a vásznon</span>'
        + '<span class="spring"></span><button class="btn sm" id="pb-res">🏆 Eredménylista</button>'
        + (S.isInstructor ? '<button class="btn sm" id="pb-new">＋ Új szavazás</button>' : '');
    } else if (S.isInstructor) {
      html = '<span class="pb-ico">🏆</span><span class="pb-t">Nincs aktív szavazás ezen a lapon — indíts egyet (pl. prompt-bajnokság)</span>'
        + '<span class="spring"></span><button class="btn sm pri" id="pb-new">＋ Szavazás indítása</button>';
    }
    bar.innerHTML = html; bar.classList.toggle('off', !html);
    var bC = document.getElementById('pb-close'); if (bC) bC.onclick = function () { closePoll(op); };
    var bR = document.getElementById('pb-res'); if (bR) bR.onclick = function () { showResults(cl); };
    var bN = document.getElementById('pb-new'); if (bN) bN.onclick = openPollDlg;
  }
  function closePoll(p) {
    if (!p || !window.confirm('Lezárod a szavazást? Utána már nem lehet szavazni, és a top-3 érmet kap.')) return;
    sb.from('course_polls').update({ status: 'closed' }).eq('id', p.id).then(function (r) {
      if (r && r.error) { toast(r.error.message, false); return; }
      feed('🏁 <b>Szavazás lezárva:</b> ' + esc(p.title || ''));
      reloadPolls();
    });
  }

  // ---------- poll create dialog + results panel ----------
  var dlgEl = null;
  function closeDlg() { if (dlgEl && dlgEl.parentNode) dlgEl.parentNode.removeChild(dlgEl); dlgEl = null; }
  function openDlg(inner) {
    closeDlg();
    dlgEl = el('div', 'cc-scrim');
    var d = el('div', 'cc-dlg', inner);
    dlgEl.appendChild(d);
    dlgEl.addEventListener('mousedown', function (e) { if (e.target === dlgEl) closeDlg(); });
    document.body.appendChild(dlgEl);
    return d;
  }
  function openPollDlg() {
    var lecOpt = S.lecture !== 'all'
      ? '<option value="' + esc(S.lecture) + '">Csak ez a lap (' + esc(String(ordOf(S.lecture) || '')) + '. előadás)</option><option value="">Teljes kurzus</option>'
      : '<option value="">Teljes kurzus</option>';
    var d = openDlg('<h3>🏆 Új szavazás</h3>'
      + '<label for="pd-title">Cím</label><input id="pd-title" placeholder="pl. 7. heti prompt-bajnokság">'
      + '<label for="pd-cat">Kategória (opcionális)</label><input id="pd-cat" placeholder="pl. legjobb iteráció / legszebb plakát">'
      + '<label for="pd-max">Szavazat / fő</label><input id="pd-max" type="number" min="1" max="10" value="3">'
      + '<label for="pd-scope">Hatókör</label><select id="pd-scope">' + lecOpt + '</select>'
      + '<div class="row"><button class="btn" id="pd-cancel">Mégse</button><button class="btn pri" id="pd-ok">Indítás</button></div>');
    d.querySelector('#pd-cancel').onclick = closeDlg;
    d.querySelector('#pd-ok').onclick = function () {
      var title = d.querySelector('#pd-title').value.trim();
      if (!title) { toast('Adj címet a szavazásnak', false); return; }
      var row = {
        course_id: cid,
        lecture_id: d.querySelector('#pd-scope').value || null,
        title: title,
        category: d.querySelector('#pd-cat').value.trim() || null,
        max_votes_per_voter: Math.max(1, Math.min(10, +(d.querySelector('#pd-max').value || 3))),
        status: 'open'
      };
      sb.from('course_polls').insert(row).then(function (r) {
        if (r && r.error) { toast(r.error.message, false); return; }
        closeDlg();
        toast('🏆 Szavazás elindítva');
        feed('🏆 <b>Új szavazás:</b> ' + esc(title));
        reloadPolls();
      });
    };
    d.querySelector('#pd-title').focus();
  }
  function showResults(p) {
    if (!p) return;
    loadVotes(p).then(function () {
      var ranked = S.items.filter(function (it) { return (S.results[it.id] || 0) > 0; })
        .sort(function (a, b) { return (S.results[b.id] || 0) - (S.results[a.id] || 0); }).slice(0, 10);
      var ico = ['🥇', '🥈', '🥉'];
      var rows = ranked.map(function (it, i) {
        var a = S.authors[it.id] || {};
        return '<div class="resrow"><span class="rk">' + (ico[i] || (i + 1) + '.') + '</span>'
          + '<span class="ri"><b>' + esc(a.display_name || 'Hallgató') + '</b><span>' + esc((it.title || it.prompt || '').slice(0, 60)) + '</span>'
          + '<span class="vt" data-item="' + it.id + '"></span></span>'
          + '<span class="vn">' + (S.results[it.id] || 0) + ' 🏆</span></div>';
      }).join('') || '<div class="resrow"><span class="ri">Erre a szavazásra nem érkezett szavazat.</span></div>';
      var d = openDlg('<h3>🏆 ' + esc(p.title || 'Szavazás') + ' — eredmény</h3>' + rows
        + '<div class="row"><button class="btn" id="rs-close">Bezárás</button></div>');
      d.querySelector('#rs-close').onclick = closeDlg;
      // instructors may see WHO voted (peers only ever see aggregates — RLS keeps it that way)
      if (S.isInstructor) fetchVoters(p, d);
    });
  }
  function fetchVoters(p, dlg) {
    sb.from('course_poll_votes').select('item_id,voter_id').eq('poll_id', p.id).then(function (r) {
      var rows = (r && r.data) || []; if (!rows.length) return;
      var ids = []; rows.forEach(function (x) { if (ids.indexOf(x.voter_id) < 0) ids.push(x.voter_id); });
      sb.from('profiles_public').select('id,name').in('id', ids).then(function (rr) {
        var nm = {}; ((rr && rr.data) || []).forEach(function (x) { nm[x.id] = x.name; });
        var per = {}; rows.forEach(function (x) { (per[x.item_id] = per[x.item_id] || []).push(nm[x.voter_id] || 'ismeretlen'); });
        dlg.querySelectorAll('.vt').forEach(function (v) {
          var list = per[v.dataset.item];
          if (list && list.length) v.innerHTML = '<i>szavazók: ' + esc(list.join(', ')) + '</i>';
        });
      }, function () { });
    }, function () { });
  }

  // ---------- render: cards ----------
  var EMPTY = '<div class="cc-empty"><b>Még üres ez a lap</b><div>A laborfüzet MCP-paneljéből tedd ki az első munkádat — <i>„🖼 Vászonra teszem"</i> — és itt azonnal megjelenik mindenkinek.</div></div>';
  function wave(id) {
    var bars = '', s2 = String(id || 'x');
    for (var i = 0; i < 14; i++) { var h = 25 + (s2.charCodeAt(i % s2.length) * (i + 3)) % 66; bars += '<i style="height:' + h + '%"></i>'; }
    return '<span class="wave">' + bars + '</span>';
  }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return String(u || '').slice(0, 40); } }
  function thumbHTML(it, thumbH) {
    var media = it.media_path ? (S.urls[it.media_path] || '') : safeHref(it.media_url);
    var poster = it.thumb_path ? (S.urls[it.thumb_path] || '') : '';
    var st = ' style="height:' + thumbH + 'px"';
    if (it.kind === 'audio') return '<div class="cv-thumb gaudio"' + st + '>' + wave(it.id) + (media ? '<button class="playb" data-act="play" title="Lejátszás">▶</button>' : '') + '</div>';
    if (it.kind === 'video') return '<div class="cv-thumb"' + st + '>' + (media ? '<video src="' + esc(media) + '"' + (poster ? ' poster="' + esc(poster) + '"' : '') + ' preload="metadata" muted playsinline></video><button class="playb" data-act="play" title="Lejátszás">▶</button>' : '<div class="ph">🎬</div>') + '</div>';
    if (it.kind === 'link') return '<div class="cv-thumb txt"' + st + '><span class="big">🔗</span><span class="sm">' + esc(hostOf(it.media_url)) + '</span>' + (safeHref(it.media_url) ? '<a class="openl" data-act="open" href="' + esc(safeHref(it.media_url)) + '" target="_blank" rel="noopener">↗ megnyitás</a>' : '') + '</div>';
    if (it.kind === 'text') return '<div class="cv-thumb txt"' + st + '><span class="big">📝</span><span class="sm">' + esc(String(it.title || it.prompt || '').slice(0, 90)) + '</span></div>';
    var src = poster || media;
    return '<div class="cv-thumb"' + st + '>' + (src ? '<img src="' + esc(src) + '" alt="' + esc(it.title || 'Generált kép') + '" loading="lazy">' : '<div class="ph">…</div>') + '</div>';
  }
  function paramChips(it) {
    var p = it.params || {}, out = [], keys = Object.keys(p);
    if (p.seed != null) out.push('<span class="pchip">seed ' + esc(String(p.seed)) + '</span>');
    for (var i = 0; i < keys.length && out.length < 3; i++) {
      var k = keys[i], v = p[k];
      if (k === 'seed' || v == null || typeof v === 'object') continue;
      out.push('<span class="pchip">' + esc(k + ': ' + String(v).slice(0, 22)) + '</span>');
    }
    return out.join('');
  }
  function card(it, idx, med) {
    var w = +it.w || 320, h = +it.h || 240, thumbH = Math.max(90, h - 64);
    // items posted without a position (x=y=0) get a deterministic grid slot until first dragged
    var px = +it.x || 0, py = +it.y || 0;
    if (!px && !py) { px = 60 + (idx % 5) * (w + 44); py = 60 + Math.floor(idx / 5) * (h + 70); }
    var a = S.authors[it.id] || { display_name: '…', avatar_url: null };
    var lo = ordOf(it.lecture_id);
    var op = openPollFor(), cl2 = op ? null : closedPollFor();
    var c = el('div', 'cv-card' + (it.pinned ? ' pinned' : '') + (it.hidden ? ' dim' : '') + (S.flipped[it.id] ? ' flip' : '') + (S.fresh[it.id] ? ' new' : ''));
    c.style.left = px + 'px'; c.style.top = py + 'px'; c.style.width = w + 'px';
    c.dataset.id = it.id; c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', (a.display_name || 'Hallgató') + ' munkája — kattints a prompt-provenance hátlaphoz');

    var rx = RX.map(function (e2) {
      var k = it.id + '|' + e2, n = S.rxCount[k] || 0;
      return '<button class="rxb' + (S.rxMine[k] ? ' on' : '') + '" data-act="rx" data-e="' + e2 + '" title="Reakció">' + e2 + (n ? ' ' + n : '') + '</button>';
    }).join('');
    var vote = '';
    if (op) {
      var n2 = S.results[it.id] || 0, mineV = S.myVotes.indexOf(it.id) >= 0, own = it.author_id === me;
      vote = '<button class="vbtn' + (mineV ? ' on' : '') + (own ? ' off' : '') + '" data-act="vote"'
        + (own ? ' disabled title="Saját munkára nem szavazhatsz"' : ' title="' + (mineV ? 'Szavazat visszavonása' : 'Szavazok erre a munkára') + '"')
        + '>🏆 ' + n2 + '</button>';
    } else if (cl2 && (S.results[it.id] || 0) > 0) {
      vote = '<span class="vbtn done" title="Végeredmény">🏆 ' + S.results[it.id] + '</span>';
    }
    var avatar = a.avatar_url
      ? '<img class="cv-av" src="' + esc(safeHref(a.avatar_url)) + '" alt="">'
      : '<span class="cv-av" style="' + avStyle(a.display_name) + '"></span>';
    var hideTag = it.hidden ? '<span class="hidetag">🙈 ' + (it.author_id === me && !S.isInstructor ? 'az oktató elrejtette' : 'rejtett') + '</span>' : '';

    c.innerHTML = '<div class="inner">'
      + '<div class="cv-face front">'
      + thumbHTML(it, thumbH)
      + (med[it.id] ? '<span class="medal">' + med[it.id] + '</span>' : '')
      + (it.pinned ? '<span class="cv-pin">★ kiemelve</span>' : '')
      + hideTag
      + '<div class="cv-meta">'
      + '<div class="who">' + avatar + '<span class="nm">' + esc(a.display_name || 'Hallgató') + '</span>'
      + '<span class="lchip">' + (lo ? '#L' + lo : '#félév') + (it.kind !== 'image' ? ' · ' + esc(it.kind) : '') + '</span></div>'
      + '<div class="sub"><span class="mdl">' + esc(String(it.model || '').slice(0, 24)) + '</span><span class="rxrow">' + rx + vote + '</span></div>'
      + '</div></div>'
      + '<div class="cv-face back">'
      + '<div class="bh">Prompt-provenance</div>'
      + '<div class="bp">' + esc(it.prompt || '') + (it.neg_prompt ? '<br><span class="neg">— negatív: ' + esc(it.neg_prompt) + '</span>' : '') + '</div>'
      + '<div class="bm"><span class="pchip">' + esc(it.model || '?') + '</span><span class="pchip">' + esc(it.provider || '?') + '</span>' + paramChips(it)
      + (it.call_log_id ? '<span class="pchip acc">call_log #' + (+it.call_log_id) + '</span>' : '<span class="pchip warn">nincs platform-napló</span>')
      + '</div></div></div>';
    wireCard(c, it);
    return c;
  }
  function wireCard(c, it) {
    c.onclick = function (e) {
      if (S.moved) return;
      var b = e.target.closest('[data-act]');
      if (b) { e.stopPropagation(); if (b.dataset.act !== 'open') e.preventDefault(); handleAct(b, it, c); return; }
      S.flipped[it.id] = !S.flipped[it.id];
      c.classList.toggle('flip', !!S.flipped[it.id]);
    };
    c.onkeydown = function (e) { if (e.key === 'Enter') { S.flipped[it.id] = !S.flipped[it.id]; c.classList.toggle('flip', !!S.flipped[it.id]); } };
    c.oncontextmenu = function (e) {
      if (!S.isInstructor && it.author_id !== me) return;   // others' cards: browser menu
      e.preventDefault(); e.stopPropagation();
      openMenu(e, it);
    };
    // own card (or instructor) → drag moves the ITEM; anyone else's card bubbles up and pans the board
    c.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('[data-act]')) return;
      if (it.author_id !== me && !S.isInstructor) return;
      e.stopPropagation(); S.moved = false;
      idrag = { it: it, el: c, sx: e.clientX, sy: e.clientY, ox: c.offsetLeft, oy: c.offsetTop, moved: false };
    });
  }
  function handleAct(b, it, c) {
    if (b.dataset.act === 'rx') toggleRx(it, b.dataset.e);
    else if (b.dataset.act === 'vote') castVote(it);
    else if (b.dataset.act === 'play') togglePlay(it, b, c);
    // 'open' → plain <a href>, let it navigate
  }
  function toggleRx(it, emoji) {
    var k = it.id + '|' + emoji;
    if (S.rxMine[k]) {
      sb.from('course_canvas_reactions').delete().match({ item_id: it.id, user_id: me, emoji: emoji }).then(function (r) {
        if (r && r.error) { toast(r.error.message, false); return; }
        delete S.rxMine[k]; S.rxCount[k] = Math.max(0, (S.rxCount[k] || 1) - 1); render();
      });
    } else {
      sb.from('course_canvas_reactions').insert({ item_id: it.id, emoji: emoji }).then(function (r) {
        if (r && r.error) { toast(r.error.message, false); return; }
        S.rxMine[k] = true; S.rxCount[k] = (S.rxCount[k] || 0) + 1; render();
      });
    }
  }
  // one shared audio player; video plays inline in its own card
  var player = null, playingId = null;
  function togglePlay(it, btn, c) {
    if (it.kind === 'video') {
      var v = c.querySelector('video'); if (!v) return;
      if (v.paused) { v.muted = false; v.play(); btn.textContent = '⏸'; } else { v.pause(); btn.textContent = '▶'; }
      return;
    }
    var u = it.media_path ? S.urls[it.media_path] : safeHref(it.media_url); if (!u) return;
    if (player && playingId === it.id && !player.paused) { player.pause(); btn.textContent = '▶'; return; }
    if (player) { try { player.pause(); } catch (e) { } }
    player = new Audio(u); playingId = it.id;
    player.play(); btn.textContent = '⏸';
    player.onended = function () { btn.textContent = '▶'; };
  }
  function render() {
    if (!world) return;
    world.innerHTML = '';
    var scoped = itemsInScope();
    if (!scoped.length) { world.innerHTML = EMPTY; apply(); stat(); return; }
    var med = medals();
    scoped.forEach(function (it, idx) { world.appendChild(card(it, idx, med)); });
    apply(); stat();
  }

  // ---------- item drag (own / instructor) — position persisted on drag-END, not per move ----------
  var idrag = null;
  function moveItemDrag(e) {
    var dx = (e.clientX - idrag.sx) / S.view.k, dy = (e.clientY - idrag.sy) / S.view.k;
    if (!idrag.moved && (dx * dx + dy * dy) > 9) { idrag.moved = true; S.moved = true; idrag.el.classList.add('dragging'); }
    if (!idrag.moved) return;
    idrag.el.style.left = (idrag.ox + dx) + 'px';
    idrag.el.style.top = (idrag.oy + dy) + 'px';
  }
  function endItemDrag() {
    if (!idrag) return;
    var d = idrag; idrag = null;
    d.el.classList.remove('dragging');
    if (!d.moved) return;
    var nx = Math.round(d.el.offsetLeft), ny = Math.round(d.el.offsetTop);
    d.it.x = nx; d.it.y = ny;
    sb.from('course_canvas_items').update({ x: nx, y: ny, updated_at: new Date().toISOString() }).eq('id', d.it.id).then(function (r) {
      if (r && r.error) toast('Nem sikerült menteni a pozíciót: ' + r.error.message, false);
    });
  }

  // ---------- context menu (instructor: pin/hide · author: delete) ----------
  var menuEl = null;
  function closeMenu() { if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; }
  function openMenu(e, it) {
    closeMenu();
    var btns = [];
    if (S.isInstructor) {
      btns.push({ ico: it.pinned ? '☆' : '⭐', label: it.pinned ? 'Kiemelés törlése' : 'Kiemelés (galéria-séta)', fn: function () { modItem(it, { pinned: !it.pinned }, it.pinned ? '☆ Kiemelés törölve' : '⭐ Kiemelve'); } });
      btns.push({ ico: it.hidden ? '↩' : '🙈', label: it.hidden ? 'Visszaállítás' : 'Elrejtés (moderálás)', fn: function () { modItem(it, { hidden: !it.hidden }, it.hidden ? '↩ Visszaállítva' : '🙈 Elrejtve — a szerző látja, hogy moderálva lett'); } });
    }
    if (it.author_id === me) btns.push({ ico: '🗑', label: 'Saját elem törlése', fn: function () { delItem(it); }, danger: true });
    if (!btns.length) return;
    menuEl = el('div', 'cmenu', btns.map(function (b, i) {
      return '<button data-i="' + i + '"' + (b.danger ? ' class="danger"' : '') + '>' + b.ico + ' ' + esc(b.label) + '</button>';
    }).join(''));
    document.body.appendChild(menuEl);
    var mw = menuEl.offsetWidth || 220, mh = menuEl.offsetHeight || 90;
    menuEl.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
    menuEl.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
    menuEl.querySelectorAll('button').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); closeMenu(); btns[+b.dataset.i].fn(); }; });
    setTimeout(function () { document.addEventListener('mousedown', function once(ev) { document.removeEventListener('mousedown', once); if (menuEl && !menuEl.contains(ev.target)) closeMenu(); }); }, 0);
  }

  // ---------- live feed (session-local, fed by Realtime events) ----------
  function feed(html, ts) {
    var b = document.getElementById('lfb'); if (!b) return;
    var d = el('div', 'lf-i new', '<span class="t">' + hhmm(ts) + '</span><span>' + html + '</span>');
    b.insertBefore(d, b.firstChild);
    while (b.children.length > 40) b.removeChild(b.lastChild);
  }
  function seedFeed() {
    S.items.slice(-5).reverse().forEach(function (it) {
      var a = S.authors[it.id] || {};
      feed('<b>' + esc(a.display_name || 'Hallgató') + '</b> munkája a vásznon' + (ordOf(it.lecture_id) ? ' (#L' + ordOf(it.lecture_id) + ')' : ''), it.created_at);
    });
  }

  // ---------- Realtime (autopilot.js postgres_changes pattern; RLS applies on the socket too) ----------
  var voteCh = null, votePollId = null;
  function subscribe() {
    sb.channel('ccv:' + cid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'course_canvas_items', filter: 'course_id=eq.' + cid }, onItemInsert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'course_canvas_items', filter: 'course_id=eq.' + cid }, onItemUpdate)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'course_canvas_items' }, onItemDelete)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_canvas_reactions' }, onReaction)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_polls', filter: 'course_id=eq.' + cid }, function () { reloadPolls(); })
      .subscribe();
  }
  // votes get their own channel keyed to the visible poll (re-subscribed on tab/poll change)
  function subscribeVotes(p) {
    var pid = (p && p.id) || null;
    if (votePollId === pid) return;
    if (voteCh) { try { sb.removeChannel(voteCh); } catch (e) { } voteCh = null; }
    votePollId = pid;
    if (!pid) return;
    voteCh = sb.channel('ccv-votes:' + pid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_poll_votes', filter: 'poll_id=eq.' + pid }, onVoteEvent)
      .subscribe();
  }
  function onItemInsert(p) {
    var it = p && p.new; if (!it || S.items.some(function (x) { return x.id === it.id; })) return;
    S.items.push(it);
    S.fresh[it.id] = true;
    setTimeout(function () { delete S.fresh[it.id]; }, 4000);
    Promise.all([fetchAuthors([it]), signUrls()]).then(function () {
      var a = S.authors[it.id] || {};
      feed('🆕 <b>' + esc(a.display_name || 'Hallgató') + '</b> új munkát tett a vászonra' + (ordOf(it.lecture_id) ? ' (#L' + ordOf(it.lecture_id) + ')' : ''));
      render();
    });
  }
  function onItemUpdate(p) {
    var n = p && p.new; if (!n) return;
    for (var i = 0; i < S.items.length; i++) {
      if (S.items[i].id !== n.id) continue;
      var old = S.items[i]; S.items[i] = n;
      var a = S.authors[n.id] || {};
      if (!old.pinned && n.pinned) feed('⭐ Az oktató kiemelte <b>' + esc(a.display_name || 'egy hallgató') + '</b> munkáját');
      if (!old.hidden && n.hidden) feed('🙈 Egy elem moderálásra került');
      if (idrag && idrag.it.id === n.id) return;   // don't re-render under an active drag
      render();
      return;
    }
    onItemInsert({ new: n });   // update for a row we never saw (e.g. un-hidden for us) → treat as insert
  }
  function onItemDelete(p) {
    var id = p && p.old && p.old.id; if (!id) return;
    var before = S.items.length;
    S.items = S.items.filter(function (x) { return x.id !== id; });
    if (S.items.length !== before) render();
  }
  var refreshRx = debounce(function () {
    var sig = JSON.stringify(S.rxCount);
    loadReactions().then(function () { if (JSON.stringify(S.rxCount) !== sig) render(); });
  }, 400);
  function onReaction(p) {
    var iid = (p && p.new && p.new.item_id) || (p && p.old && p.old.item_id);
    if (!iid || !S.items.some(function (x) { return x.id === iid; })) return;
    refreshRx();
  }
  var refreshVotes = debounce(function () {
    var p = visiblePoll(); if (!p) return;
    loadVotes(p).then(function (changed) { if (changed) { pollbar(); render(); } });
  }, 400);
  function onVoteEvent() { refreshVotes(); }

  // ---------- boot ----------
  function centerBox(h1, p, linkHref, linkLabel) {
    root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>' + h1 + '</h1><p>' + p + '</p>'
      + (linkHref ? '<a class="btn" href="' + linkHref + '">' + linkLabel + '</a>' : '') + '</div></div>';
  }
  if (!BE || !sb) { centerBox('A backend nem elérhető', 'Próbáld újratölteni az oldalt.'); return; }
  if (BE.mode !== 'cloud' || !BE.user) { centerBox('Bejelentkezés szükséges', 'Az évfolyam-vászonhoz jelentkezz be, és nyisd meg a Kurzus oldalról.', 'Landing.html', 'Bejelentkezés'); return; }
  if (!cid) { centerBox('Nincs kurzus megadva', 'Nyisd meg a vásznat a Kurzus oldalról (CourseCanvas.html?course=…).', 'Course.html', '← Kurzus'); return; }

  sb.rpc('course_is_member', { cid: cid }).then(function (r) {
    if (r && r.error) { centerBox('Nem sikerült betölteni', 'A kurzus-modul nem elérhető (hiányzó migráció vagy jogosultság): ' + esc(r.error.message), 'Course.html', '← Kurzus'); return; }
    if (!r || r.data !== true) { centerBox('Nem vagy tagja ennek a kurzusnak', 'Kérj kurzuskódot az oktatótól, és csatlakozz a Kurzus oldalon — utána itt látod az évfolyam munkáit.', 'Course.html?course=' + esc(cid), '← Kurzus'); return; }
    sb.rpc('course_is_instructor', { cid: cid }).then(function (ri) {
      S.isInstructor = !!(ri && ri.data === true);
      shell();
      load().then(function () {
        // live-class shortcut: if an open poll is lecture-scoped, jump straight onto that lecture tab
        var op0 = null;
        for (var i = 0; i < S.polls.length; i++) if (S.polls[i].status === 'open') { op0 = S.polls[i]; break; }
        if (op0 && op0.lecture_id && S.lectures.some(function (l) { return l.id === op0.lecture_id; })) S.lecture = op0.lecture_id;
        tabsBar();
        var p = visiblePoll();
        subscribeVotes(p);
        loadVotes(p).then(function () {
          pollbar(); render(); seedFeed(); subscribe();
          // safety net: Realtime on course_poll_votes is RLS-filtered (students only see their own
          // rows), so peers' votes may not stream — a slow poll keeps counts live, and reloadPolls
          // also discovers new/closed polls if the course_polls Realtime event was missed.
          setInterval(function () {
            if (idrag) return;
            reloadPolls();   // change-detected: only re-renders when polls or vote counts changed
          }, 15000);
        });
      }, function () {
        centerBox('Nem sikerült betölteni', 'A kurzus nem létezik, vagy nincs hozzáférésed.', 'Course.html', '← Kurzus');
      });
    });
  });
})();
