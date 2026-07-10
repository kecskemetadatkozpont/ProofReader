/* Aloud — Admin dashboard. Loads in Admin.html after React, Babel, supabase-js,
 * config.js and engine.js. Admin-only (profiles.role === 'admin'). */
(function () {
  'use strict';
  var cfg = window.PR_CONFIG;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo;

  /* ---------- helpers ---------- */
  function bytesOf(data) { try { return new Blob([JSON.stringify(data || {})]).size; } catch (e) { return JSON.stringify(data || {}).length; } }
  function fmtBytes(n) { if (!n) return '0 KB'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
  function credits(chars) { return Math.ceil((chars || 0) / 1000); }
  function fmtDate(s) { if (!s) return '—'; var d = new Date(s); var now = Date.now(), diff = (now - d.getTime()) / 1000; if (diff < 60) return 'just now'; if (diff < 3600) return Math.floor(diff / 60) + 'm ago'; if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'; if (diff < 604800) return Math.floor(diff / 86400) + 'd ago'; return d.toLocaleDateString(); }
  function initials(n) { return String(n || 'U').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  // canonical university for grouping — collapses the common Hungarian name variants (e.g. "Neumann János
  // Egyetem" + "John von Neumann University" → one group); unknown affiliations keep their raw value.
  function canonAff(a) {
    var s = String(a == null ? '' : a).trim();
    if (!s) return '— Not provided —';
    var l = s.toLowerCase();
    if (/neumann/.test(l)) return 'John von Neumann University';
    if (/sz[eé]chenyi/.test(l)) return 'Széchenyi István University';
    if (/\bbme\b|budapesti m[űu]szaki/.test(l)) return 'Budapesti Műszaki Egyetem (BME)';
    if (/\belte\b|e[öo]tv[öo]s lor/.test(l)) return 'Eötvös Loránd Tudományegyetem (ELTE)';
    if (/debrecen/.test(l)) return 'Debreceni Egyetem';
    if (/szeged/.test(l)) return 'Szegedi Tudományegyetem';
    if (/p[eé]cs/.test(l)) return 'Pécsi Tudományegyetem';
    if (/corvinus/.test(l)) return 'Budapesti Corvinus Egyetem';
    if (/semmelweis/.test(l)) return 'Semmelweis Egyetem';
    return s;
  }
  function colorFor(id) { var p = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626']; var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return p[x % p.length]; }
  // models an admin can assign per user (profiles.ai_model); '' = system default. Must match the Edge whitelist.
  var AI_MODELS = [['', 'Default (system setting)'], ['claude-opus-4-8', 'Opus 4.8 — best quality'], ['claude-sonnet-4-6', 'Sonnet 4.6 — balanced'], ['claude-haiku-4-5-20251001', 'Haiku 4.5 — fastest / cheapest']];
  function Avatar(props) {
    var u = props.u, sz = props.size || 32;
    var st = { width: sz, height: sz, fontSize: sz * 0.38 };
    if (u.avatar_url) return h('span', { className: 'av', style: Object.assign({ backgroundImage: 'url(' + u.avatar_url + ')' }, st) });
    return h('span', { className: 'av', style: Object.assign({ background: u.color || colorFor(u.id) }, st) }, initials(u.name || u.email));
  }
  function Badge(props) { var s = props.s || 'incomplete'; return h('span', { className: 'badge b-' + s }, s); }

  /* ---------- Task board (Kanban) helpers — same (assignee, status) → column mapping as research.jsx ---------- */
  var BOARD_COLS = [
    { key: 'todo-human', title: 'ToDo — Human', who: 'human' },
    { key: 'todo-ai', title: 'ToDo — AI', who: 'ai' },
    { key: 'prog-ai', title: 'In progress — AI', who: 'ai' },
    { key: 'prog-human', title: 'In progress — Human', who: 'human' },
    { key: 'blocked', title: 'Blocked / Needs approval', who: 'any' },
    { key: 'done-ai', title: 'Done by AI', who: 'ai' },
    { key: 'done-human', title: 'Done by Human', who: 'human' }
  ];
  var BCOL_IC = { 'todo-human': '📋', 'todo-ai': '📋', 'prog-ai': '⚙️', 'prog-human': '✋', 'blocked': '⏸', 'done-ai': '✅', 'done-human': '✅' };
  var STEP_ICON = { data: '🗄️', preprocess: '🧹', train: '🏋️', eval: '📊', analysis: '🔬', figure: '📈', writeup: '✍️', custom: '•' };
  function assigneeOf(s) { return s.assignee === 'human' ? 'human' : 'ai'; }
  function stepCol(s) {
    var a = assigneeOf(s), st = s.status;
    if (st === 'done') return a === 'human' ? 'done-human' : 'done-ai';
    if (st === 'running') return a === 'human' ? 'prog-human' : 'prog-ai';
    if (st === 'blocked' || st === 'failed' || (s.needs_approval && (st === 'todo' || st === 'queued'))) return 'blocked';
    return a === 'human' ? 'todo-human' : 'todo-ai';
  }
  function acOf(s) {
    var r = s.result && s.result.acceptance_check; if (!r || typeof r !== 'object') return null;
    var keys = Object.keys(r); if (!keys.length) return null;
    var pass = keys.filter(function (k) { return String(r[k]).indexOf('PASS') === 0; }).length;
    return { total: keys.length, pass: pass };
  }
  // Research studies (elicit_jobs: systematic reviews + reports) — read-only AI cards on the board.
  var ELICIT_KIND = { sysreview: '🔬 Systematic Review', report: '📄 Report' };
  function elicitCol(j) {
    if (j.status === 'completed') return 'done-ai';
    if (j.status === 'failed' || j.status === 'pausedForInsufficientQuota') return 'blocked';
    return 'prog-ai';   // processing | unknown → in progress
  }
  function elicitStatusLbl(j) {
    return j.status === 'completed' ? 'Completed' : j.status === 'failed' ? 'Failed'
      : j.status === 'pausedForInsufficientQuota' ? 'Paused (quota)' : (j.stage ? 'Running' : 'Starting');
  }

  /* ---------- Admin global Task board: every user's every research project's tasks, in one Kanban ----------
   * Read-only monitoring view (admin does not edit others' tasks here). Filter by user, by project, by
   * assignee, and by text. Clicking a card opens that user's Research read-only ("view as"). */
  function GlobalTaskBoard(props) {
    var profiles = props.profiles || [];
    var ownerById = {}; profiles.forEach(function (u) { ownerById[u.id] = u; });
    var opS = useState(true), open = opS[0], setOpen = opS[1];
    var ldS = useState(false), loading = ldS[0], setLoading = ldS[1];
    var lddS = useState(false), loaded = lddS[0], setLoaded = lddS[1];
    var spS = useState([]), steps = spS[0], setSteps = spS[1];         // steps enriched with _proj / _prot / _owner
    var ejS = useState([]), ejobs = ejS[0], setEjobs = ejS[1];         // research studies (elicit_jobs) enriched with _proj / _owner
    var suS = useState(null), selUid = suS[0], setSelUid = suS[1];     // isolate one user (null = all)
    var fpS = useState(null), selPid = fpS[0], setSelPid = fpS[1];     // isolate one project (null = all)
    var fwS = useState('all'), who = fwS[0], setWho = fwS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];

    function load() {
      setLoading(true);
      Promise.all([
        sb.from('research_projects').select('id,owner_id,title'),
        sb.from('research_protocols').select('id,project_id,title,status').neq('status', 'archived'),
        sb.from('research_protocol_steps').select('id,protocol_id,ord,title,kind,status,assignee,needs_approval,depends_on,spec,result'),
        sb.from('elicit_jobs').select('id,user_id,project_id,kind,status,stage,research_question,result_title,url,created_at')
      ]).then(function (res) {
        var projById = {}; ((res[0] && res[0].data) || []).forEach(function (p) { projById[p.id] = p; });
        var protById = {}; ((res[1] && res[1].data) || []).forEach(function (p) { protById[p.id] = p; });
        var rows = (res[2] && res[2].data) || [];
        rows.forEach(function (s) {
          var pr = protById[s.protocol_id]; s._prot = pr;
          var pj = pr ? projById[pr.project_id] : null; s._proj = pj;
          s._owner = pj ? (ownerById[pj.owner_id] || { id: pj.owner_id, name: 'User ' + String(pj.owner_id).slice(0, 6) }) : null;
        });
        // keep only steps we could resolve to a project (defensive against RLS gaps)
        setSteps(rows.filter(function (s) { return s._proj; }));
        var ej = (res[3] && res[3].data) || [];
        ej.forEach(function (j) {
          var pj = j.project_id ? projById[j.project_id] : null; j._proj = pj;
          j._owner = ownerById[j.user_id] || (pj ? ownerById[pj.owner_id] : null) || { id: j.user_id, name: 'User ' + String(j.user_id).slice(0, 6) };
        });
        setEjobs(ej);
        setLoading(false); setLoaded(true);
      }, function () { setLoading(false); setLoaded(true); });
    }
    useEffect(function () { if (open && !loaded) load(); }, [open]); // eslint-disable-line

    function viewAsResearch(o) {
      if (!o) return;
      try { localStorage.setItem('pr-admin-view', JSON.stringify({ id: o.id, name: o.name, email: o.email, avatar_url: o.avatar_url, color: o.color, role: 'researcher', plan: 'pro' })); } catch (e) { }
      window.open('Research.html?adminView=1', '_blank');
    }

    // filter derivations (steps + research studies share the owner/project chips)
    var ownersWithTasks = [], oseen = {}, ownerCount = {};
    function bumpOwner(o) { if (o) { ownerCount[o.id] = (ownerCount[o.id] || 0) + 1; if (!oseen[o.id]) { oseen[o.id] = 1; ownersWithTasks.push(o); } } }
    steps.forEach(function (s) { bumpOwner(s._owner); });
    ejobs.forEach(function (j) { bumpOwner(j._owner); });
    ownersWithTasks.sort(function (a, b) { return (ownerCount[b.id] || 0) - (ownerCount[a.id] || 0); });
    function ownerOK(s) { return !selUid || (s._owner && s._owner.id === selUid); }
    var projList = [], pseen = {}, projCount = {};
    function bumpProj(pj) { if (pj) { projCount[pj.id] = (projCount[pj.id] || 0) + 1; if (!pseen[pj.id]) { pseen[pj.id] = 1; projList.push(pj); } } }
    steps.forEach(function (s) { if (ownerOK(s)) bumpProj(s._proj); });
    ejobs.forEach(function (j) { if (ownerOK(j)) bumpProj(j._proj); });
    var visiblePids = {}; projList.forEach(function (p) { visiblePids[p.id] = 1; });
    var effPid = (selPid && visiblePids[selPid]) ? selPid : null;
    function pidOn(pid) { return !effPid || effPid === pid; }
    var qq = q.trim().toLowerCase();
    var shown = steps.filter(function (s) {
      if (!ownerOK(s)) return false;
      if (!s._proj || !pidOn(s._proj.id)) return false;
      if (who !== 'all' && assigneeOf(s) !== who) return false;
      if (qq && (s.title || '').toLowerCase().indexOf(qq) < 0 && (s._proj.title || '').toLowerCase().indexOf(qq) < 0 && ((s._owner && s._owner.name || '').toLowerCase().indexOf(qq) < 0)) return false;
      return true;
    });
    var shownE = ejobs.filter(function (j) {
      if (!ownerOK(j)) return false;
      if (j._proj ? !pidOn(j._proj.id) : !!effPid) return false;   // project-less studies show only when no project is selected
      if (who !== 'all' && who !== 'ai') return false;             // studies are AI-run
      if (qq && (j.result_title || '').toLowerCase().indexOf(qq) < 0 && (j.research_question || '').toLowerCase().indexOf(qq) < 0 && ((j._proj && j._proj.title || '').toLowerCase().indexOf(qq) < 0) && ((j._owner && j._owner.name || '').toLowerCase().indexOf(qq) < 0)) return false;
      return true;
    });

    function card(s) {
      var a = assigneeOf(s), sx = s.spec || {}, proj = s._proj, o = s._owner, ac = acOf(s);
      var figs = (s.result && s.result.figures) || [];
      var chips = [];
      if (sx.est_minutes) chips.push(h('span', { key: 'e', className: 'bchip' }, '⏱ ' + sx.est_minutes + 'p'));
      if ((sx.attachments || []).length) chips.push(h('span', { key: 'a', className: 'bchip' }, '📎 ' + sx.attachments.length));
      if ((s.depends_on || []).length) chips.push(h('span', { key: 'd', className: 'bchip' }, '⛓ ' + s.depends_on.join(',')));
      if (figs.length) chips.push(h('span', { key: 'f', className: 'bchip' }, '📈 ' + figs.length));
      if (s.needs_approval && s.status !== 'done') chips.push(h('span', { key: 'p', className: 'bchip warn' }, '⏸ approval'));
      return h('div', { key: s.id, className: 'bcard ' + (a === 'human' ? 'hu' : 'ai'), onClick: function () { viewAsResearch(o); }, title: o ? 'Open ' + o.name + '’s Research (view as)' : 'Open Research' },
        h('div', { className: 'gb-owner' }, h(Avatar, { u: o || {}, size: 16 }), h('span', { className: 'gb-onm' }, (o && o.name) || '—')),
        proj ? h('div', { className: 'gb-proj' }, h('i', { style: { background: colorFor(proj.id) } }), h('span', null, proj.title)) : null,
        h('div', { className: 'bcard-top' }, h('span', { 'aria-hidden': 'true' }, STEP_ICON[s.kind] || '•'),
          h('span', { className: 'bchip who ' + (a === 'human' ? 'hu' : 'ai') }, a === 'human' ? 'HUMAN' : 'AI'),
          ac ? h('span', { className: 'bchip ' + (ac.pass === ac.total ? 'ok' : 'fail') }, ac.pass + '/' + ac.total + ' ✓') : null),
        h('div', { className: 'bcard-t' }, h('span', { style: { color: 'var(--faint)' } }, s.ord + '. '), s.title),
        chips.length ? h('div', { className: 'bcard-m' }, chips) : null
      );
    }

    function elicitCard(j) {
      var o = j._owner, proj = j._proj, kindLbl = ELICIT_KIND[j.kind] || '🔎 Study';
      return h('div', { key: 'e-' + j.id, className: 'bcard ai', onClick: function () { viewAsResearch(o); }, title: o ? 'Open ' + o.name + '’s Research (view as)' : 'Open Research' },
        h('div', { className: 'gb-owner' }, h(Avatar, { u: o || {}, size: 16 }), h('span', { className: 'gb-onm' }, (o && o.name) || '—')),
        proj ? h('div', { className: 'gb-proj' }, h('i', { style: { background: colorFor(proj.id) } }), h('span', null, proj.title)) : null,
        h('div', { className: 'bcard-top' }, h('span', { 'aria-hidden': 'true' }, j.kind === 'sysreview' ? '🔬' : '📄'),
          h('span', { className: 'bchip who ai' }, 'STUDY'),
          h('span', { className: 'bchip' }, elicitStatusLbl(j))),
        h('div', { className: 'bcard-t' }, j.result_title || j.research_question || 'Research study')
      );
    }

    var seg = h('div', { className: 'gb-seg', role: 'group', 'aria-label': 'Assignee filter' },
      [['all', 'All'], ['human', '👤 Human'], ['ai', '🤖 AI']].map(function (o) {
        return h('button', { key: o[0], className: who === o[0] ? 'on' : '', onClick: function () { setWho(o[0]); } }, o[1]);
      }));

    return h('div', { className: 'gb-wrap' },
      h('button', { className: 'gb-head', onClick: function () { setOpen(!open); } },
        h('span', { style: { width: 12, color: 'var(--muted)' } }, open ? '▾' : '▸'),
        h('span', { style: { fontWeight: 700, fontSize: 14 } }, '🗂️ Global task board'),
        h('span', { style: { fontSize: 12, color: 'var(--muted)', fontWeight: 500 } }, 'every user’s research tasks in one Kanban'),
        loaded ? h('span', { style: { marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' } }, (steps.length + ejobs.length) + ' item' + ((steps.length + ejobs.length) === 1 ? '' : 's') + ' · ' + ownersWithTasks.length + ' user' + (ownersWithTasks.length === 1 ? '' : 's')) : null
      ),
      open ? h('div', { className: 'gb-body' },
        loading ? h('div', { className: 'empty', style: { padding: 24 } }, 'Loading every project’s tasks…')
          : (!steps.length && !ejobs.length) ? h('div', { className: 'empty', style: { padding: 24 } }, 'No tasks or studies across the platform yet.')
            : h('div', null,
              h('div', { className: 'gb-bar' },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 } },
                  h('div', { className: 'gb-chips' },
                    h('button', { className: 'gb-chip' + (!selUid ? ' on' : ''), onClick: function () { setSelUid(null); setSelPid(null); } }, '👥 All users ', h('span', { className: 'gb-c' }, steps.length + ejobs.length)),
                    ownersWithTasks.map(function (o) {
                      return h('button', { key: o.id, className: 'gb-chip' + (selUid === o.id ? ' on' : ''), title: o.email || o.name, onClick: function () { var v = selUid === o.id ? null : o.id; setSelUid(v); setSelPid(null); } },
                        h(Avatar, { u: o, size: 14 }), h('span', { className: 'gb-nm' }, o.name), h('span', { className: 'gb-c' }, ownerCount[o.id] || 0));
                    })
                  ),
                  h('div', { className: 'gb-chips' },
                    h('button', { className: 'gb-chip' + (!effPid ? ' on' : ''), onClick: function () { setSelPid(null); } }, '🗂️ All projects'),
                    projList.map(function (p) {
                      return h('button', { key: p.id, className: 'gb-chip' + (effPid === p.id ? ' on' : ''), title: p.title, onClick: function () { setSelPid(effPid === p.id ? null : p.id); } },
                        h('i', { className: 'gb-dot', style: { background: colorFor(p.id) } }), h('span', { className: 'gb-nm' }, p.title), h('span', { className: 'gb-c' }, projCount[p.id] || 0));
                    })
                  )
                ),
                h('div', { className: 'gb-tools' }, seg,
                  h('input', { className: 'gb-q', value: q, placeholder: '🔍 Filter…', onChange: function (e) { setQ(e.target.value); } }),
                  h('button', { className: 'btn', onClick: load, title: 'Reload' }, '↻'))
              ),
              h('div', { style: { fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 8px' } }, (shown.length + shownE.length) + ' shown · click a card to open that researcher’s board (view as)'),
              h('div', { className: 'bwrap' }, BOARD_COLS.map(function (col) {
                var cards = shown.filter(function (s) { return stepCol(s) === col.key; });
                var ecards = shownE.filter(function (j) { return elicitCol(j) === col.key; });
                var n = cards.length + ecards.length;
                return h('div', { key: col.key, className: 'bcol cap-' + (col.who === 'human' ? 'hu' : col.who === 'ai' ? 'ai' : 'bk') },
                  h('div', { className: 'bcol-h' }, h('span', null, BCOL_IC[col.key]), h('span', { className: 'bcol-t' }, col.title), h('span', { className: 'bcol-n' }, n + '')),
                  h('div', { className: 'bcol-b' }, n ? cards.map(card).concat(ecards.map(elicitCard)) : h('div', { className: 'bcol-empty' }, '—'))
                );
              }))
            )
      ) : null
    );
  }

  /* ---------- researchers (MTMT-sourced profiles, bundled in publications.js) ---------- */
  function Researchers() {
    var oS = useState(null), open = oS[0], setOpen = oS[1];
    if (!window.PRPubs || !window.PRPubs.data) return null;
    var data = window.PRPubs.data;
    var list = Object.keys(data).map(function (email) {
      var r = data[email]; var pubs = r.publications || [];
      return { email: email, name: r.name, mtmtId: r.mtmtId, orcid: r.orcid, pubCount: r.pubCount || pubs.length,
        cites: pubs.reduce(function (a, p) { return a + (p.citations || 0); }, 0), withDoi: pubs.filter(function (p) { return p.doi; }).length, pubs: pubs };
    });
    if (!list.length) return null;
    list.sort(function (a, b) { return b.pubCount - a.pubCount; });
    var totalPubs = list.reduce(function (s, r) { return s + r.pubCount; }, 0);
    function openProfile(email) { try { var u = window.PRAuth && window.PRAuth.byEmail(email); if (u) window.PRAuth.signIn(u.id); } catch (e) { } location.href = 'Profile.html'; }
    var head = h('tr', null, ['Researcher', 'Email', 'MTMT', 'ORCID', 'Publications', 'Citations', ''].map(function (t) { return h('th', { key: t }, t); }));
    return h('div', { className: 'wrap', style: { paddingTop: 0 } },
      h('div', { className: 'sec-h' }, h('h2', null, 'Researchers (MTMT publications)'), h('span', { className: 'count' }, list.length + ' profiles · ' + totalPubs + ' publications')),
      h('div', { className: 'panel' },
        h('table', null, h('thead', null, head), h('tbody', null, list.map(function (r) {
          var rows = [h('tr', { key: r.email, className: 'clickable', onClick: function () { setOpen(open === r.email ? null : r.email); } },
            h('td', null, h('div', { className: 'u' }, h(Avatar, { u: { name: r.name, id: r.email } }), h('div', null, h('b', null, r.name), h('span', null, (open === r.email ? '▴ hide' : '▾ show') + ' publications')))),
            h('td', null, r.email),
            h('td', { className: 'mono' }, h('a', { className: 'ext', href: 'https://m2.mtmt.hu/gui2/?mode=browse&params=author;' + r.mtmtId, target: '_blank', onClick: function (e) { e.stopPropagation(); } }, r.mtmtId)),
            h('td', null, r.orcid ? h('a', { className: 'ext', href: 'https://orcid.org/' + r.orcid, target: '_blank', onClick: function (e) { e.stopPropagation(); } }, r.orcid) : '—'),
            h('td', null, r.pubCount, h('span', { style: { color: 'var(--muted)', fontSize: 11 } }, ' (' + r.withDoi + ' DOI)')),
            h('td', null, r.cites),
            h('td', { onClick: function (e) { e.stopPropagation(); } }, h('button', { className: 'btn', onClick: function () { openProfile(r.email); } }, 'Open profile'))
          )];
          if (open === r.email) rows.push(h('tr', { key: r.email + '-x' }, h('td', { colSpan: 7, style: { background: 'var(--surface-3)' } },
            h('div', { className: 'pub-rows' }, r.pubs.map(function (p) {
              return h('div', { className: 'pub-row', key: p.mtid },
                h('span', { className: 'py' }, p.year || '—'),
                h('span', { className: 'pt' }, p.title || '(untitled)'),
                p.doi ? h('a', { className: 'ext', href: 'https://doi.org/' + p.doi, target: '_blank' }, 'DOI') : null,
                p.citations ? h('span', { className: 'pc' }, p.citations + ' cit.') : null
              );
            }))
          )));
          return rows;
        })))
      )
    );
  }

  /* ---------- project preview ---------- */
  function ProjectPreview(props) {
    var project = props.project, onClose = props.onClose;
    var data = project.data || {};
    var files = data.files || {};
    var order = (data.order && data.order.length) ? data.order : Object.keys(files);
    var firstTex = order.filter(function (p) { return files[p] && files[p].type === 'tex'; })[0] || order[0];
    var st = useState(firstTex), active = st[0], setActive = st[1];
    var f = files[active] || {};
    var rendered = useMemo(function () {
      if (f.type === 'tex' && window.LatexEngine) { try { return window.LatexEngine.process(f.content || '', files).html; } catch (e) { return '<p style="color:#b42318">Render error</p>'; } }
      return null;
    }, [active]);
    useEffect(function () { var onKey = function (e) { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return function () { window.removeEventListener('keydown', onKey); }; }, []);
    return h('div', { className: 'pv-scrim on', onMouseDown: onClose },
      h('div', { className: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': project.title || 'Project preview', onMouseDown: function (e) { e.stopPropagation(); } },
        h('div', { className: 'pvh' },
          h('b', null, project.title || 'Untitled project'),
          h('span', { className: 'mono', style: { color: 'var(--muted)' } }, fmtBytes(bytesOf(data))),
          h('button', { className: 'x', 'aria-label': 'Close', onClick: onClose }, '✕')
        ),
        h('div', { className: 'pvb' },
          h('div', { className: 'files' }, order.map(function (p) {
            return h('div', { key: p, className: 'f' + (p === active ? ' on' : ''), onClick: function () { setActive(p); } }, p);
          })),
          f.type === 'tex'
            ? h('div', { className: 'render', dangerouslySetInnerHTML: { __html: rendered || '' } })
            : (f.type === 'image' && (f.src || f.dataURL))
              ? h('div', { className: 'render' }, h('img', { src: f.dataURL || f.src, alt: active }))
              : h('div', { className: 'src' }, f.content || '(binary or empty file — ' + (f.type || 'unknown') + ')')
        )
      )
    );
  }

  /* ---------- user drawer ---------- */
  function UserDrawer(props) {
    var u = props.user, agg = props.agg, onClose = props.onClose, onPreview = props.onPreview, onAction = props.onAction, onSetModel = props.onSetModel, onSetWorkflows = props.onSetWorkflows, onSetFigures = props.onSetFigures;
    var onSetFeature = props.onSetFeature, onSetAllowlist = props.onSetAllowlist, catalog = props.catalog || [];
    var open = !!u;
    useEffect(function () { if (!open) return; var onKey = function (e) { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return function () { window.removeEventListener('keydown', onKey); }; }, [open]);
    return h(React.Fragment, null,
      h('div', { className: 'scrim' + (open ? ' on' : ''), onClick: onClose }),
      h('div', { className: 'drawer' + (open ? ' on' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': (u && (u.name || u.email)) || 'User details' },
        u && h(React.Fragment, null,
          h('div', { className: 'dh' },
            h(Avatar, { u: u, size: 40 }),
            h('div', null, h('div', { style: { fontWeight: 700, fontSize: 15 } }, u.name || '—'), h('div', { style: { fontSize: 12.5, color: 'var(--muted)' } }, u.email)),
            h('button', { className: 'x', 'aria-label': 'Close', onClick: onClose }, '✕')
          ),
          h('div', { className: 'db' },
            h('div', { style: { marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h(Badge, { s: u.status }), u.role === 'admin' && h('span', { className: 'badge b-admin' }, 'admin'),
              u.status === 'pending' && h('button', { className: 'btn ok', onClick: function () { onAction(u.id, 'approved'); } }, 'Approve'),
              u.status === 'pending' && h('button', { className: 'btn dng', onClick: function () { onAction(u.id, 'rejected'); } }, 'Reject'),
              (u.status === 'approved') && u.role !== 'admin' && h('button', { className: 'btn', onClick: function () { onAction(u.id, 'suspended'); } }, 'Suspend'),
              (u.status === 'suspended' || u.status === 'rejected') && h('button', { className: 'btn ok', onClick: function () { onAction(u.id, 'approved'); } }, 'Reactivate')
            ),
            h('div', { style: { marginBottom: 16 } },
              h('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 5 } }, 'Active AI model — research chat + analysis'),
              h('select', { value: u.ai_model || '', onChange: function (e) { onSetModel(u.id, e.target.value); }, style: { width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)', color: 'inherit' } },
                AI_MODELS.filter(function (m) { var al = u.model_allowlist || null; return m[0] === '' || al === null || al.indexOf(m[0]) >= 0; })
                  .map(function (m) { return h('option', { key: m[0], value: m[0] }, m[0] === '' ? 'Default (cheapest allowed)' : m[1]); }))
            ),
            h('div', { style: { marginBottom: 16 } },
              h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: !!u.can_workflows, style: { marginTop: 2 }, onChange: function (e) { onSetWorkflows(u.id, e.target.checked); } }),
                h('span', null, h('b', null, 'Run Publify Workflows'), h('span', { style: { display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 1 } }, 'Allows the user to run multi-step Publify workflows in the session.')))
            ),
            h('div', { style: { marginBottom: 16 } },
              h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: !!u.can_figures, style: { marginTop: 2 }, onChange: function (e) { onSetFigures(u.id, e.target.checked); } }),
                h('span', null, h('b', null, 'Figure generation (PaperBanana)'), h('span', { style: { display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 1 } }, 'Allows the user to generate publication figures with AI in the LaTeX editor.')))
            ),
            // ---- allowed cloud models (multi-select) — migration-49 ----
            h('div', { style: { marginBottom: 16 } },
              h('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 5 } }, 'Allowed cloud models'),
              AI_MODELS.filter(function (m) { return m[0] !== ''; }).map(function (m) {
                var cur = u.model_allowlist || null;
                var on = cur === null ? true : cur.indexOf(m[0]) >= 0;
                return h('label', { key: m[0], style: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer', padding: '2px 0' } },
                  h('input', { type: 'checkbox', checked: on, onChange: function (e) {
                    var all = AI_MODELS.filter(function (x) { return x[0] !== ''; }).map(function (x) { return x[0]; });
                    var base = cur === null ? all.slice() : cur.slice();
                    var next = e.target.checked ? base.concat([m[0]]).filter(function (v, i, a) { return a.indexOf(v) === i; }) : base.filter(function (x) { return x !== m[0]; });
                    onSetAllowlist(u.id, next);
                  } }),
                  h('span', null, m[1]));
              }),
              h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 3 } }, 'All boxes checked (or all unchecked) = system default — every model allowed.')),
            // ---- feature access matrix — migration-49 (empty until the migration is applied) ----
            catalog.length ? h('div', { style: { marginBottom: 16 } },
              h('h3', { className: 'dsub' }, 'Feature access'),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 9, marginTop: 8 } },
                catalog.filter(function (f) { return f.key !== 'session_workflow_mode' && f.key !== 'paper_figure'; }).map(function (f) {
                  var explicit = u.features && Object.prototype.hasOwnProperty.call(u.features, f.key);
                  var on = explicit ? !!u.features[f.key] : !!f.default_on;
                  return h('label', { key: f.key, style: { display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' } },
                    h('input', { type: 'checkbox', checked: on, style: { marginTop: 2 }, onChange: function (e) { onSetFeature(u.id, f.key, e.target.checked); } }),
                    h('span', null,
                      h('b', null, f.label),
                      (f.category === 'page'
                        ? h('span', { style: { marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: 'var(--accent, #4f46e5)', border: '1px solid var(--line)', borderRadius: 5, padding: '0 5px', verticalAlign: 'middle' } }, 'PAGE ACCESS')
                        : (!f.enforced ? h('span', { style: { marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: 'var(--warn, #b26b00)', border: '1px solid var(--line)', borderRadius: 5, padding: '0 5px', verticalAlign: 'middle' } }, 'UI ONLY') : null)),
                      h('span', { style: { display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 1 } },
                        (f.category === 'page'
                          ? (f.enforced ? 'Blocks the page + server-enforced actions' : 'Blocks the page for this user (data stays isolated)')
                          : (f.enforced ? 'Server-enforced' : 'Hides UI only'))
                        + (explicit ? '' : ' · default ' + (f.default_on ? 'on' : 'off')))));
                }))) : null,
            h('div', { className: 'kv' },
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'Projects'), h('div', { className: 'v' }, agg.projCount), agg.researchCount ? h('div', { className: 's' }, agg.projects.length + ' LaTeX + ' + agg.researchCount + ' research') : null),
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'Storage'), h('div', { className: 'v' }, fmtBytes(agg.storage))),
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'Credits used'), h('div', { className: 'v' }, credits(agg.chars)), h('div', { className: 's' }, '1 credit = 1,000 chars')),
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'AI voice'), h('div', { className: 'v' }, (agg.chars || 0).toLocaleString()), h('div', { className: 's' }, (agg.requests || 0) + ' requests · chars'))
            ),
            h('div', { className: 'meta-line' }, h('b', null, 'Affiliation: '), u.affiliation || '—'),
            h('div', { className: 'meta-line' }, h('b', null, 'MTMT: '), u.mtmt_id || '—', '   ', h('b', null, 'ORCID: '), u.orcid ? h('a', { className: 'ext', href: 'https://orcid.org/' + u.orcid, target: '_blank' }, u.orcid) : '—'),
            h('div', { className: 'meta-line' }, h('b', null, 'Last active: '), fmtDate(u.last_active_at), '   ', h('b', null, 'Joined: '), u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'),
            h('h3', { className: 'dsub' }, 'LaTeX projects (' + agg.projects.length + ')'),
            agg.projects.length === 0 && h('div', { style: { fontSize: 13, color: 'var(--muted)' } }, 'No LaTeX projects yet.'),
            agg.projects.map(function (p) {
              var fc = p.data && p.data.files ? Object.keys(p.data.files).length : 0;
              return h('div', { className: 'proj', key: p.id },
                h('div', { className: 'pt' }, h('b', null, p.title || 'Untitled'), h('span', null, fc + ' files · ' + fmtBytes(bytesOf(p.data)) + ' · updated ' + fmtDate(p.updated_at))),
                h('button', { className: 'btn', onClick: function () { onPreview(p); } }, 'View'),
                h('a', { className: 'btn pri', href: 'ProofReader.html?p=' + p.id, target: '_blank', style: { textDecoration: 'none' } }, 'Open')
              );
            })
          )
        )
      )
    );
  }

  /* ---------- main ---------- */
  // #13 — admin bug / feature-request console: see every report, set status, reply to the reporter
  function BugReports() {
    var lS = useState(null), rows = lS[0], setRows = lS[1];
    var rpS = useState({}), replies = rpS[0], setReplies = rpS[1];
    var imS = useState(null), imgOpen = imS[0], setImgOpen = imS[1];
    var repS = useState({}), reporters = repS[0], setReporters = repS[1];   // reporter_id → {name,email,avatar_url}
    function load() {
      sb.from('bug_reports').select('*').order('created_at', { ascending: false }).then(function (r) {
        var data = (r && r.data) || []; setRows(data);
        var ids = []; data.forEach(function (b) { if (b.reporter_id && ids.indexOf(b.reporter_id) < 0) ids.push(b.reporter_id); });
        if (ids.length) sb.from('profiles').select('id,name,email,avatar_url').in('id', ids).then(function (p) {
          var m = {}; ((p && p.data) || []).forEach(function (u) { m[u.id] = u; }); setReporters(m);
        });
      });
    }
    useEffect(function () { load(); }, []);
    useEffect(function () { if (!imgOpen) return; var onKey = function (e) { if (e.key === 'Escape') setImgOpen(null); }; window.addEventListener('keydown', onKey); return function () { window.removeEventListener('keydown', onKey); }; }, [imgOpen]);
    function setStatus(b, st) { sb.from('bug_reports').update({ status: st }).eq('id', b.id).then(load); }
    function sendReply(b) {
      var txt = String(replies[b.id] != null ? replies[b.id] : (b.reply || '')).trim();
      sb.auth.getUser().then(function (u) {
        var uid = u && u.data && u.data.user && u.data.user.id;
        sb.from('bug_reports').update({ reply: txt || null, replied_at: new Date().toISOString(), replied_by: uid || null }).eq('id', b.id).then(load);
      });
    }
    if (rows === null) return h('div', { className: 'panel' }, h('div', { style: { padding: 12, color: 'var(--muted)' } }, 'Loading reports…'));
    var open = rows.filter(function (b) { return b.status !== 'fixed' && b.status !== 'wontfix'; });
    return h(React.Fragment, null,
      h('div', { className: 'sec-h' }, h('h2', null, 'Bug reports & feature requests'), h('span', { className: 'count' }, rows.length + ' total · ' + open.length + ' open')),
      h('div', { className: 'panel' },
        rows.length === 0 ? h('div', { className: 'empty' }, 'No reports yet.') :
          rows.map(function (b) {
            var draft = replies[b.id] != null ? replies[b.id] : (b.reply || '');
            return h('div', { key: b.id, style: { borderBottom: '1px solid var(--line)', padding: '12px 14px' } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { className: 'badge', style: { background: b.category === 'feature' ? '#eef2ff' : '#fef3e6', color: b.category === 'feature' ? '#4f46e5' : '#b4530f' } }, b.category === 'feature' ? '💡 Feature' : '🐞 Bug'),
                b.title ? h('b', null, b.title) : h('span', { style: { color: 'var(--muted)' } }, '(no title)'),
                (function () {
                  var rep = reporters[b.reporter_id];
                  var lbl = rep ? (rep.name || rep.email) : (b.reporter_id ? b.reporter_id.slice(0, 8) + '…' : 'unknown');
                  return h('span', { className: 'u', title: rep ? (rep.email || rep.name) : (b.reporter_id || 'unknown'), style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink)' } },
                    h(Avatar, { u: rep || { name: lbl, id: b.reporter_id || 'x' }, size: 20 }),
                    h('span', null, lbl),
                    (rep && rep.name && rep.email) ? h('span', { style: { color: 'var(--muted)' } }, '· ' + rep.email) : null);
                })(),
                h('span', { style: { marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' } }, fmtDate(b.created_at) + (b.page ? ' · ' + b.page : '') + (b.app_version ? ' · v' + b.app_version : '')),
                h('select', { className: 'btn', 'aria-label': 'Report status', value: b.status, onChange: function (e) { setStatus(b, e.target.value); } }, ['open', 'triaged', 'fixed', 'wontfix'].map(function (s) { return h('option', { key: s, value: s }, s); }))
              ),
              h('div', { style: { fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' } }, b.body),
              b.image_data ? h('img', { src: b.image_data, alt: 'screenshot', style: { maxWidth: 300, maxHeight: 190, borderRadius: 8, border: '1px solid var(--line)', marginTop: 8, cursor: 'zoom-in' }, onClick: function () { setImgOpen(b.image_data); } }) : null,
              h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                h('textarea', { rows: 2, value: draft, placeholder: 'Reply to the user (the reporter sees it under “My previous reports”)…', style: { flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 9px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }, onChange: function (e) { var v = e.target.value; setReplies(function (p) { var n = Object.assign({}, p); n[b.id] = v; return n; }); } }),
                h('button', { className: 'btn pri', style: { flex: 'none' }, onClick: function () { sendReply(b); } }, b.reply ? 'Update reply' : 'Reply')
              ),
              b.replied_at ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 4 } }, '✓ Replied · ' + fmtDate(b.replied_at)) : null
            );
          })
      ),
      imgOpen ? h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Screenshot', onClick: function () { setImgOpen(null); }, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' } }, h('img', { src: imgOpen, style: { maxWidth: '92%', maxHeight: '92%', borderRadius: 8 } })) : null
    );
  }

  // ---------- Elicit MCP (org-level OAuth connection) ----------
  function callOAuth(action) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || cfg.supabaseAnonKey;
      return fetch(cfg.supabaseUrl + '/functions/v1/elicit-oauth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ action: action }) }).then(function (r) { return r.json().catch(function () { return { error: 'bad response' }; }); }, function () { return { error: 'network' }; });
    });
  }
  function ElicitMcpPanel() {
    var stS = useState(null), st = stS[0], setSt = stS[1];
    var buS = useState(false), busy = buS[0], setBusy = buS[1];
    var msgS = useState(''), msg = msgS[0], setMsg = msgS[1];
    function refresh() { callOAuth('status').then(function (d) { setSt((d && !d.error) ? d : { connected: false, error: d && d.error }); }); }
    useEffect(function () { refresh(); }, []);
    function connect() {
      setBusy(true); setMsg('');
      callOAuth('start').then(function (d) {
        setBusy(false);
        if (!d || d.error || !d.authorize_url) { setMsg('Could not start: ' + ((d && d.error) || 'no authorize URL')); return; }
        window.open(d.authorize_url, '_blank', 'width=560,height=760');
        setMsg('Authorize the connection in the opened window, then click “Refresh status”.');
      });
    }
    function disconnect() { setBusy(true); callOAuth('disconnect').then(function () { setBusy(false); refresh(); }); }
    var connected = st && st.connected;
    return h('div', { className: 'perm-wrap', style: { marginBottom: 22 } },
      h('div', { className: 'perm-head', style: { cursor: 'default' } },
        h('span', { className: 'perm-ic', 'aria-hidden': 'true' }, '🔌'),
        h('span', { className: 'perm-t' }, 'Research tools in Chat (MCP)'),
        h('span', { className: 'perm-sub' }, connected ? ('Connected' + (st.expires_at ? ' · token expires ' + new Date(st.expires_at).toLocaleString() : '')) : 'Not connected'),
        h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 8 } },
          h('button', { className: 'btn', onClick: refresh }, 'Refresh'),
          connected ? h('button', { className: 'btn dng', disabled: busy, onClick: disconnect }, 'Disconnect')
            : h('button', { className: 'btn pri', disabled: busy, onClick: connect }, busy ? '…' : 'Connect'))),
      h('div', { style: { padding: '0 18px 14px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 } },
        'Connect the organization’s research account once (OAuth). Then grant “Research tools in Chat (MCP)” to users below — in Publify Chat workflow mode Claude can call the research tools directly. (Requires a Pro+ research account.)',
        msg ? h('div', { style: { marginTop: 6, color: 'var(--accent, #4f46e5)' } }, msg) : null,
        (st && st.error) ? h('div', { style: { marginTop: 6, color: 'var(--danger, #b42318)' } }, 'Status: ' + st.error) : null)
    );
  }

  // ---------- Feature permissions (dedicated sub-section) ----------
  // One place to toggle every feature per user with buttons. Legacy keys route to their
  // own columns (session_workflow_mode→can_workflows, paper_figure→can_figures); the rest
  // write the profiles.features jsonb via onSetFeature. Admins are excluded (they bypass gates).
  function PermissionsPanel(props) {
    var catalog = props.catalog || [];
    var all = (props.profiles || []).filter(function (u) { return u.role !== 'admin'; });
    var oS = useState(false), open = oS[0], setOpen = oS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    if (!catalog.length) return null;   // migration-49 not applied yet → nothing to toggle
    var qq = q.trim().toLowerCase();
    var users = all.filter(function (u) { return !qq || ((u.name || '') + ' ' + (u.email || '')).toLowerCase().indexOf(qq) >= 0; });
    function featOn(u, f) {
      if (f.key === 'session_workflow_mode') return !!u.can_workflows;
      if (f.key === 'paper_figure') return !!u.can_figures;
      if (u.features && Object.prototype.hasOwnProperty.call(u.features, f.key)) return !!u.features[f.key];
      return !!f.default_on;
    }
    function toggle(u, f) {
      var on = !featOn(u, f);
      if (f.key === 'session_workflow_mode') return props.onSetWorkflows(u.id, on);
      if (f.key === 'paper_figure') return props.onSetFigures(u.id, on);
      props.onSetFeature(u.id, f.key, on);
    }
    return h('div', { className: 'perm-wrap' },
      h('button', { className: 'perm-head', onClick: function () { setOpen(!open); }, 'aria-expanded': open ? 'true' : 'false' },
        h('span', { className: 'perm-ic', 'aria-hidden': 'true' }, '🔐'),
        h('span', { className: 'perm-t' }, 'Feature permissions'),
        h('span', { className: 'perm-sub' }, all.length + ' user' + (all.length === 1 ? '' : 's') + ' · click a button to turn a feature on/off'),
        h('span', { className: 'perm-cv', 'aria-hidden': 'true' }, open ? '▾' : '▸')
      ),
      open ? h('div', { className: 'perm-body' },
        h('input', { className: 'perm-q', value: q, placeholder: '🔍 Filter users…', onChange: function (e) { setQ(e.target.value); } }),
        h('div', { className: 'perm-legend' }, h('span', { className: 'perm-pill on', style: { pointerEvents: 'none' } }, h('span', { className: 'perm-dot' }), 'enabled'), h('span', { className: 'perm-pill', style: { pointerEvents: 'none' } }, h('span', { className: 'perm-dot' }), 'disabled'), h('span', { style: { fontSize: 11.5, color: 'var(--faint)' } }, 'Pages block the whole menu item; AI features are server-enforced.')),
        users.length === 0 ? h('div', { className: 'empty', style: { padding: 20 } }, 'No users match.')
          : h('div', { className: 'perm-list' }, users.map(function (u) {
            return h('div', { className: 'perm-user', key: u.id },
              h('div', { className: 'perm-uhead' },
                h(Avatar, { u: u, size: 30 }),
                h('div', { className: 'perm-uinfo' }, h('b', null, u.name || '—'), h('span', null, u.email)),
                h('span', { className: 'perm-ustatus' }, h(Badge, { s: u.status }))
              ),
              h('div', { className: 'perm-pills' }, catalog.map(function (f) {
                var on = featOn(u, f);
                return h('button', {
                  key: f.key, className: 'perm-pill' + (on ? ' on' : '') + (f.category === 'page' ? ' page' : ''),
                  onClick: function () { toggle(u, f); },
                  title: (f.category === 'page' ? 'Page access' : 'AI feature') + ' — ' + (on ? 'ON (click to disable)' : 'OFF (click to enable)')
                }, h('span', { className: 'perm-dot', 'aria-hidden': 'true' }), f.label);
              }))
            );
          }))
      ) : null
    );
  }

  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var pS = useState([]), profiles = pS[0], setProfiles = pS[1];
    var prS = useState([]), projects = prS[0], setProjects = prS[1];
    var rprS = useState([]), rprojects = rprS[0], setRprojects = rprS[1];   // research_projects (also counted)
    var uS = useState([]), usage = uS[0], setUsage = uS[1];
    var selS = useState(null), selUser = selS[0], setSelUser = selS[1];
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];
    var errS = useState(''), errMsg = errS[0], setErr = errS[1];
    var exS = useState(null), expanded = exS[0], setExpanded = exS[1];
    var pcS = useState({}), pubsCache = pcS[0], setPubsCache = pcS[1];
    var ogS = useState({}), openGroups = ogS[0], setOpenGroups = ogS[1];   // expanded affiliation groups
    var fcS = useState([]), catalog = fcS[0], setCatalog = fcS[1];   // feature_catalog (migration-49) drives the permission matrix
    function toggleGroup(k) { setOpenGroups(function (m) { var n = Object.assign({}, m); n[k] = !n[k]; return n; }); }

    useEffect(function () { boot(); }, []);
    function boot() {
      sb.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        if (!s) { setPhase('signin'); return; }
        var uid = s.user.id;
        sb.from('profiles').select('role,name,email,avatar_url').eq('id', uid).maybeSingle().then(function (pr) {
          var prof = pr && pr.data;
          if (!prof || prof.role !== 'admin') { setMe(prof || { email: s.user.email }); setPhase('denied'); return; }
          var meObj = Object.assign({ id: uid }, prof);
          window.PRNavUser = meObj;   // let the shared nav bar show the real admin (Admin.html has no PR_BACKEND)
          try { window.dispatchEvent(new CustomEvent('pr-profile', { detail: { role: prof.role } })); } catch (e) { }
          setMe(meObj);
          loadData();
        });
      });
    }
    function loadData() {
      Promise.all([
        sb.from('profiles').select('*, publications(count)'),
        sb.from('projects').select('id,owner_id,title,data,created_at,updated_at,deleted_at'),
        sb.from('usage_meters').select('*'),
        sb.from('research_projects').select('id,owner_id'),
        sb.from('feature_catalog').select('key,label,category,default_on,enforced,sort').order('sort')
      ]).then(function (res) {
        if (res[0].error) { setErr(res[0].error.message); setPhase('error'); return; }
        setProfiles(res[0].data || []);
        setProjects((res[1].data || []).filter(function (p) { return !p.deleted_at; }));
        setUsage(res[2].data || []);
        setRprojects((res[3] && res[3].data) || []);
        setCatalog((res[4] && res[4].data) || []);   // empty until migration-49 is applied → matrix simply hides
        setPhase('ready');
      }).catch(function (e) { setErr(String(e)); setPhase('error'); });
    }
    function aggFor(uid) {
      var ps = projects.filter(function (p) { return p.owner_id === uid; });
      var rps = rprojects.filter(function (p) { return p.owner_id === uid; });   // research projects
      var storage = ps.reduce(function (s, p) { return s + bytesOf(p.data); }, 0);
      var us = usage.filter(function (u) { return u.user_id === uid; });
      var chars = us.reduce(function (s, u) { return s + (u.tts_chars || 0); }, 0);
      var requests = us.reduce(function (s, u) { return s + (u.tts_requests || 0); }, 0);
      return { projects: ps, researchCount: rps.length, projCount: ps.length + rps.length, storage: storage, chars: chars, requests: requests };
    }
    function setStatus(uid, status) {
      setProfiles(function (list) { return list.map(function (u) { return u.id === uid ? Object.assign({}, u, { status: status }) : u; }); });
      setSelUser(function (u) { return u && u.id === uid ? Object.assign({}, u, { status: status }) : u; });
      sb.from('profiles').update({ status: status }).eq('id', uid).then(function (r) {
        if (r && r.error) { window.PRUI.toast('Update failed: ' + r.error.message, { kind: 'error' }); loadData(); }
      });
    }
    function setModel(uid, model) {
      var m = model || null;
      setProfiles(function (list) { return list.map(function (u) { return u.id === uid ? Object.assign({}, u, { ai_model: m }) : u; }); });
      setSelUser(function (u) { return u && u.id === uid ? Object.assign({}, u, { ai_model: m }) : u; });
      sb.from('profiles').update({ ai_model: m }).eq('id', uid).then(function (r) { if (r && r.error) { window.PRUI.toast('Model update failed: ' + r.error.message, { kind: 'error' }); loadData(); } });
    }
    function setWorkflows(uid, on) {
      setProfiles(function (list) { return list.map(function (u) { return u.id === uid ? Object.assign({}, u, { can_workflows: on }) : u; }); });
      setSelUser(function (u) { return u && u.id === uid ? Object.assign({}, u, { can_workflows: on }) : u; });
      sb.from('profiles').update({ can_workflows: on }).eq('id', uid).then(function (r) { if (r && r.error) { window.PRUI.toast('Update failed: ' + r.error.message, { kind: 'error' }); loadData(); } });
    }
    function setFigures(uid, on) {
      setProfiles(function (list) { return list.map(function (u) { return u.id === uid ? Object.assign({}, u, { can_figures: on }) : u; }); });
      setSelUser(function (u) { return u && u.id === uid ? Object.assign({}, u, { can_figures: on }) : u; });
      sb.from('profiles').update({ can_figures: on }).eq('id', uid).then(function (r) { if (r && r.error) { window.PRUI.toast('Update failed: ' + r.error.message, { kind: 'error' }); loadData(); } });
    }
    // per-user feature grant (migration-49). JSONB is replaced wholesale, so send the full merged map.
    function setFeature(uid, key, on) {
      var cur = null;
      setProfiles(function (list) { return list.map(function (u) { if (u.id !== uid) return u; cur = Object.assign({}, u.features || {}); cur[key] = on; return Object.assign({}, u, { features: cur }); }); });
      setSelUser(function (u) { if (!u || u.id !== uid) return u; var f = Object.assign({}, u.features || {}); f[key] = on; return Object.assign({}, u, { features: f }); });
      var full = Object.assign({}, cur || {}); full[key] = on;
      sb.from('profiles').update({ features: full }).eq('id', uid).then(function (r) { if (r && r.error) { window.PRUI.toast('Feature update failed: ' + r.error.message, { kind: 'error' }); loadData(); } });
    }
    // per-user model allowlist (migration-49). [] → null = all system models. A trigger evicts a now-invalid ai_model.
    function setAllowlist(uid, arr) {
      var v = (arr && arr.length) ? arr : null;
      setProfiles(function (list) { return list.map(function (u) { return u.id === uid ? Object.assign({}, u, { model_allowlist: v }) : u; }); });
      setSelUser(function (u) { return u && u.id === uid ? Object.assign({}, u, { model_allowlist: v }) : u; });
      sb.from('profiles').update({ model_allowlist: v }).eq('id', uid).then(function (r) { if (r && r.error) { window.PRUI.toast('Allowlist update failed: ' + r.error.message, { kind: 'error' }); loadData(); } else { loadData(); } });
    }
    function loadPubs(uid) {
      if (pubsCache[uid] !== undefined) return;
      sb.from('publications').select('mtid,title,year,doi,citations').eq('researcher_id', uid).order('year', { ascending: false })
        .then(function (r) { setPubsCache(function (m) { var n = Object.assign({}, m); n[uid] = (r && r.data) || []; return n; }); },
              function () { setPubsCache(function (m) { var n = Object.assign({}, m); n[uid] = []; return n; }); });
    }
    function toggleExpand(uid) { if (expanded === uid) { setExpanded(null); return; } setExpanded(uid); loadPubs(uid); }
    function viewAs(u) {
      try { localStorage.setItem('pr-admin-view', JSON.stringify({ id: u.id, name: u.name, email: u.email, affiliation: u.affiliation, mtmt_id: u.mtmt_id, orcid: u.orcid, plan: u.plan || 'pro', role: u.role, color: u.color, avatar_url: u.avatar_url })); } catch (e) { }
      window.open('Profile.html?adminView=1', '_blank');
    }
    function signOut() { sb.auth.signOut().then(function () { location.reload(); }); }

    /* phases */
    if (phase === 'loading') return h('div', { className: 'center-msg spin' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Loading admin…'));
    if (phase === 'signin') return h(React.Fragment, null, h('div', { className: 'center-msg' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Admin sign-in'), h('p', null, 'Sign in with the administrator Google account to manage users. The researcher profiles below are available without sign-in.'), h('button', { className: 'btn pri', onClick: function () { sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0].split('?')[0] } }); } }, 'Continue with Google')), h(Researchers));
    if (phase === 'denied') return h(React.Fragment, null, h('div', { className: 'center-msg' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Access denied'), h('p', null, 'Full user management is for administrators only.' + (me && me.email ? ' Signed in as ' + me.email + '.' : '')), h('div', { style: { display: 'flex', gap: 10 } }, h('a', { className: 'btn', href: 'ProofReader.html' }, 'Back to Publify'), h('button', { className: 'btn', onClick: signOut }, 'Sign out'))), h(Researchers));
    if (phase === 'error') return h('div', { className: 'center-msg' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Something went wrong'), h('p', null, errMsg || 'Could not load admin data.'), h('button', { className: 'btn pri', onClick: function () { setPhase('loading'); boot(); } }, 'Retry'));

    /* ready */
    var pending = profiles.filter(function (u) { return u.status === 'pending'; });
    var totalStorage = projects.reduce(function (s, p) { return s + bytesOf(p.data); }, 0);
    var totalChars = usage.reduce(function (s, u) { return s + (u.tts_chars || 0); }, 0);
    var sorted = profiles.slice().sort(function (a, b) {
      var rank = { pending: 0, approved: 1, suspended: 2, rejected: 3, incomplete: 4 };
      var d = (rank[a.status] || 5) - (rank[b.status] || 5); if (d) return d;
      return (b.last_active_at || '').localeCompare(a.last_active_at || '');
    });

    function userRow(u, withApprove) {
      var ag = aggFor(u.id);
      var pubCount = (u.publications && u.publications[0] && u.publications[0].count) || 0;
      var isResearcher = u.is_researcher || pubCount > 0;
      var isExp = expanded === u.id;
      var main = h('tr', { key: u.id, className: 'clickable', tabIndex: 0, role: 'button', 'aria-label': 'Open ' + (u.name || u.email || 'user'), onClick: function () { setSelUser(u); }, onKeyDown: function (e) { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelUser(u); } } },
        h('td', null, h('div', { className: 'u' }, h(Avatar, { u: u }), h('div', null,
          h('b', null, u.name || '—'),
          h('span', null, u.email),
          isResearcher ? h('span', { onClick: function (e) { e.stopPropagation(); toggleExpand(u.id); }, style: { display: 'block', marginTop: 3, fontSize: 11.5, color: '#6366f1', cursor: 'pointer', fontWeight: 600 } },
            (u.mtmt_id ? 'MTMT ' + u.mtmt_id + ' · ' : '') + pubCount + ' publication' + (pubCount === 1 ? '' : 's') + ' ' + (isExp ? '▴ hide' : '▾ show')) : null
        ))),
        h('td', null, u.affiliation || h('span', { style: { color: 'var(--muted)' } }, '—')),
        h('td', null, h(Badge, { s: u.status }), u.role === 'admin' && h('span', { className: 'badge b-admin' }, 'admin'),
          u.is_researcher && h('span', { className: 'badge', style: { background: 'var(--ok-bg)', color: '#0f766e' } }, 'researcher')),
        h('td', null, ag.projCount, ag.researchCount ? h('span', { style: { color: 'var(--muted)', fontSize: 11 } }, ' (' + ag.projects.length + ' LaTeX + ' + ag.researchCount + ' research)') : null),
        h('td', null, fmtBytes(ag.storage)),
        h('td', null, credits(ag.chars), h('span', { style: { color: 'var(--muted)', fontSize: 11 } }, ' (' + (ag.chars || 0).toLocaleString() + ' ch)')),
        h('td', { className: 'mono' }, fmtDate(u.last_active_at)),
        h('td', { onClick: function (e) { e.stopPropagation(); } }, h('div', { className: 'acts' },
          withApprove && h('button', { className: 'btn ok', onClick: function () { setStatus(u.id, 'approved'); } }, 'Approve'),
          withApprove && h('button', { className: 'btn dng', onClick: function () { setStatus(u.id, 'rejected'); } }, 'Reject'),
          !withApprove && u.status === 'approved' && u.role !== 'admin' && h('button', { className: 'btn', onClick: function () { setStatus(u.id, 'suspended'); } }, 'Suspend'),
          !withApprove && (u.status === 'suspended' || u.status === 'rejected') && h('button', { className: 'btn ok', onClick: function () { setStatus(u.id, 'approved'); } }, 'Reactivate'),
          h('button', { className: 'btn pri', onClick: function (e) { e.stopPropagation(); viewAs(u); } }, 'View as'),
          h('button', { className: 'btn', onClick: function () { setSelUser(u); } }, 'Details')
        ))
      );
      if (!isExp) return main;
      var pubs = pubsCache[u.id];
      var exp = h('tr', { key: u.id + '-x' }, h('td', { colSpan: 8, style: { background: 'var(--surface-3)' } },
        pubs === undefined ? h('div', { style: { padding: '10px 12px', color: 'var(--muted)', fontSize: 13 } }, 'Loading publications…')
          : pubs.length === 0 ? h('div', { style: { padding: '10px 12px', color: 'var(--muted)', fontSize: 13 } }, 'No publications in the database for this user.')
            : h('div', { className: 'pub-rows' }, pubs.map(function (p) {
              return h('div', { className: 'pub-row', key: p.mtid },
                h('span', { className: 'py' }, p.year || '—'),
                h('span', { className: 'pt' }, p.title || '(untitled)'),
                p.doi ? h('a', { className: 'ext', href: 'https://doi.org/' + p.doi, target: '_blank' }, 'DOI') : null,
                p.citations ? h('span', { className: 'pc' }, p.citations + ' cit.') : null
              );
            }))
      ));
      return [main, exp];
    }

    var tableHead = h('tr', null, ['User', 'Affiliation', 'Status', 'Projects', 'Storage', 'Credits', 'Last active', 'Actions'].map(function (t) { return h('th', { key: t }, t); }));
    // group the user list by (canonical) affiliation; "no affiliation" sorts last, else by size desc
    var affGroups = {};
    sorted.forEach(function (u) { var k = canonAff(u.affiliation); (affGroups[k] || (affGroups[k] = [])).push(u); });
    var affKeys = Object.keys(affGroups).sort(function (a, b) {
      var na = a[0] === '—', nb = b[0] === '—'; if (na !== nb) return na ? 1 : -1;
      return affGroups[b].length - affGroups[a].length || a.localeCompare(b, 'hu');
    });

    return h(React.Fragment, null,
      h('div', { className: 'topbar' },
        h('div', { className: 'brand' }, h('span', { className: 'mk' }, h('span')), 'Publify', h('span', { className: 'tag' }, 'ADMIN')),
        h('div', { className: 'sp' }),
        h('a', { className: 'back', href: 'PhD.html', style: { marginRight: 14 } }, 'Doctoral School →'),
        h('a', { className: 'back', href: 'Research.html', style: { marginRight: 14 } }, 'Research →'),
        h('a', { className: 'back', href: 'ProofReader.html' }, '← Back to app'),
        me && h('div', { className: 'me' }, h(Avatar, { u: me, size: 28 }), h('span', { className: 'nm' }, me.name || me.email)),
        h('button', { className: 'so', onClick: signOut }, 'Sign out')
      ),
      h('div', { className: 'wrap' },
        h('div', { className: 'stats' },
          h('div', { className: 'stat' }, h('div', { className: 'n' }, profiles.length), h('div', { className: 'l' }, 'Registered users')),
          h('div', { className: 'stat' + (pending.length ? ' alert' : '') }, h('div', { className: 'n' }, pending.length), h('div', { className: 'l' }, 'Pending approval')),
          h('div', { className: 'stat' }, h('div', { className: 'n' }, profiles.filter(function (u) { return u.status === 'approved'; }).length), h('div', { className: 'l' }, 'Approved')),
          h('div', { className: 'stat' }, h('div', { className: 'n' }, projects.length + rprojects.length), h('div', { className: 'l' }, 'Total projects')),
          h('div', { className: 'stat' }, h('div', { className: 'n' }, fmtBytes(totalStorage)), h('div', { className: 'l' }, 'Total storage · ' + credits(totalChars) + ' credits'))
        ),

        h(GlobalTaskBoard, { profiles: profiles }),

        h(ElicitMcpPanel, null),

        h(PermissionsPanel, { profiles: profiles, catalog: catalog, onSetFeature: setFeature, onSetWorkflows: setWorkflows, onSetFigures: setFigures }),

        pending.length > 0 && h(React.Fragment, null,
          h('div', { className: 'sec-h' }, h('h2', null, 'Pending registrations'), h('span', { className: 'count' }, pending.length + ' waiting')),
          h('div', { className: 'panel' }, h('table', null, h('thead', null, tableHead), h('tbody', null, pending.map(function (u) { return userRow(u, true); }))))
        ),

        h('div', { className: 'sec-h' }, h('h2', null, 'Users by affiliation'),
          h('span', { className: 'count' }, profiles.length + ' users · ' + affKeys.length + ' affiliations · ' + profiles.filter(function (u) { return u.is_researcher; }).length + ' researchers'),
          h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 8 } },
            h('button', { className: 'btn', onClick: function () { var m = {}; affKeys.forEach(function (k) { m[k] = true; }); setOpenGroups(m); } }, 'Expand all'),
            h('button', { className: 'btn', onClick: function () { setOpenGroups({}); } }, 'Collapse all'))
        ),
        h('div', { className: 'panel' },
          profiles.length === 0
            ? h('div', { className: 'empty' }, 'No users yet.')
            : affKeys.map(function (k) {
              var us = affGroups[k];
              var researchers = us.filter(function (u) { return u.is_researcher; }).length;
              var pendingN = us.filter(function (u) { return u.status === 'pending'; }).length;
              var on = !!openGroups[k];
              return h('div', { key: k },
                h('button', { onClick: function () { toggleGroup(k); }, style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'var(--surface-2, #f6f7f9)', border: 0, borderTop: '1px solid var(--line)', padding: '11px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' } },
                  h('span', { style: { width: 12, color: 'var(--muted)' } }, on ? '▾' : '▸'),
                  h('span', { style: { fontWeight: 700, fontSize: 13.5 } }, k),
                  h('span', { style: { marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' } }, us.length + ' user' + (us.length === 1 ? '' : 's') + (researchers ? ' · ' + researchers + ' researcher' + (researchers === 1 ? '' : 's') : '') + (pendingN ? ' · ' + pendingN + ' pending' : ''))
                ),
                on ? h('table', null, h('thead', null, tableHead), h('tbody', null, us.map(function (u) { return userRow(u, false); }))) : null
              );
            })
        ),
        h(BugReports)
      ),
      h(UserDrawer, { user: selUser, agg: selUser ? aggFor(selUser.id) : { projects: [], storage: 0, chars: 0, requests: 0 }, onClose: function () { setSelUser(null); }, onPreview: function (p) { setPreview(p); }, onAction: setStatus, onSetModel: setModel, onSetWorkflows: setWorkflows, onSetFigures: setFigures, onSetFeature: setFeature, onSetAllowlist: setAllowlist, catalog: catalog }),
      preview && h(ProjectPreview, { project: preview, onClose: function () { setPreview(null); } })
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
