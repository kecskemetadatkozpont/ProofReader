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
  function colorFor(id) { var p = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626']; var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return p[x % p.length]; }
  function Avatar(props) {
    var u = props.u, sz = props.size || 32;
    var st = { width: sz, height: sz, fontSize: sz * 0.38 };
    if (u.avatar_url) return h('span', { className: 'av', style: Object.assign({ backgroundImage: 'url(' + u.avatar_url + ')' }, st) });
    return h('span', { className: 'av', style: Object.assign({ background: u.color || colorFor(u.id) }, st) }, initials(u.name || u.email));
  }
  function Badge(props) { var s = props.s || 'incomplete'; return h('span', { className: 'badge b-' + s }, s); }

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
    return h('div', { className: 'pv-scrim on', onMouseDown: onClose },
      h('div', { className: 'pv', onMouseDown: function (e) { e.stopPropagation(); } },
        h('div', { className: 'pvh' },
          h('b', null, project.title || 'Untitled project'),
          h('span', { className: 'mono', style: { color: 'var(--muted)' } }, fmtBytes(bytesOf(data))),
          h('button', { className: 'x', onClick: onClose }, '✕')
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
    var u = props.user, agg = props.agg, onClose = props.onClose, onPreview = props.onPreview, onAction = props.onAction;
    var open = !!u;
    return h(React.Fragment, null,
      h('div', { className: 'scrim' + (open ? ' on' : ''), onClick: onClose }),
      h('div', { className: 'drawer' + (open ? ' on' : '') },
        u && h(React.Fragment, null,
          h('div', { className: 'dh' },
            h(Avatar, { u: u, size: 40 }),
            h('div', null, h('div', { style: { fontWeight: 700, fontSize: 15 } }, u.name || '—'), h('div', { style: { fontSize: 12.5, color: 'var(--muted)' } }, u.email)),
            h('button', { className: 'x', onClick: onClose }, '✕')
          ),
          h('div', { className: 'db' },
            h('div', { style: { marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h(Badge, { s: u.status }), u.role === 'admin' && h('span', { className: 'badge b-admin' }, 'admin'),
              u.status === 'pending' && h('button', { className: 'btn ok', onClick: function () { onAction(u.id, 'approved'); } }, 'Approve'),
              u.status === 'pending' && h('button', { className: 'btn dng', onClick: function () { onAction(u.id, 'rejected'); } }, 'Reject'),
              (u.status === 'approved') && u.role !== 'admin' && h('button', { className: 'btn', onClick: function () { onAction(u.id, 'suspended'); } }, 'Suspend'),
              (u.status === 'suspended' || u.status === 'rejected') && h('button', { className: 'btn ok', onClick: function () { onAction(u.id, 'approved'); } }, 'Reactivate')
            ),
            h('div', { className: 'kv' },
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'Projects'), h('div', { className: 'v' }, agg.projects.length)),
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'Storage'), h('div', { className: 'v' }, fmtBytes(agg.storage))),
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'Credits used'), h('div', { className: 'v' }, credits(agg.chars)), h('div', { className: 's' }, '1 credit = 1,000 chars')),
              h('div', { className: 'c' }, h('div', { className: 'l' }, 'AI voice'), h('div', { className: 'v' }, (agg.chars || 0).toLocaleString()), h('div', { className: 's' }, (agg.requests || 0) + ' requests · chars'))
            ),
            h('div', { className: 'meta-line' }, h('b', null, 'Affiliation: '), u.affiliation || '—'),
            h('div', { className: 'meta-line' }, h('b', null, 'MTMT: '), u.mtmt_id || '—', '   ', h('b', null, 'ORCID: '), u.orcid ? h('a', { className: 'ext', href: 'https://orcid.org/' + u.orcid, target: '_blank' }, u.orcid) : '—'),
            h('div', { className: 'meta-line' }, h('b', null, 'Last active: '), fmtDate(u.last_active_at), '   ', h('b', null, 'Joined: '), u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'),
            h('h3', { className: 'dsub' }, 'Projects (' + agg.projects.length + ')'),
            agg.projects.length === 0 && h('div', { style: { fontSize: 13, color: 'var(--muted)' } }, 'No projects yet.'),
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
  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var pS = useState([]), profiles = pS[0], setProfiles = pS[1];
    var prS = useState([]), projects = prS[0], setProjects = prS[1];
    var uS = useState([]), usage = uS[0], setUsage = uS[1];
    var selS = useState(null), selUser = selS[0], setSelUser = selS[1];
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];
    var errS = useState(''), errMsg = errS[0], setErr = errS[1];
    var exS = useState(null), expanded = exS[0], setExpanded = exS[1];
    var pcS = useState({}), pubsCache = pcS[0], setPubsCache = pcS[1];

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
        sb.from('usage_meters').select('*')
      ]).then(function (res) {
        if (res[0].error) { setErr(res[0].error.message); setPhase('error'); return; }
        setProfiles(res[0].data || []);
        setProjects((res[1].data || []).filter(function (p) { return !p.deleted_at; }));
        setUsage(res[2].data || []);
        setPhase('ready');
      }).catch(function (e) { setErr(String(e)); setPhase('error'); });
    }
    function aggFor(uid) {
      var ps = projects.filter(function (p) { return p.owner_id === uid; });
      var storage = ps.reduce(function (s, p) { return s + bytesOf(p.data); }, 0);
      var us = usage.filter(function (u) { return u.user_id === uid; });
      var chars = us.reduce(function (s, u) { return s + (u.tts_chars || 0); }, 0);
      var requests = us.reduce(function (s, u) { return s + (u.tts_requests || 0); }, 0);
      return { projects: ps, storage: storage, chars: chars, requests: requests };
    }
    function setStatus(uid, status) {
      setProfiles(function (list) { return list.map(function (u) { return u.id === uid ? Object.assign({}, u, { status: status }) : u; }); });
      setSelUser(function (u) { return u && u.id === uid ? Object.assign({}, u, { status: status }) : u; });
      sb.from('profiles').update({ status: status }).eq('id', uid).then(function (r) {
        if (r && r.error) { alert('Update failed: ' + r.error.message); loadData(); }
      });
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
      var main = h('tr', { key: u.id, className: 'clickable', onClick: function () { setSelUser(u); } },
        h('td', null, h('div', { className: 'u' }, h(Avatar, { u: u }), h('div', null,
          h('b', null, u.name || '—'),
          h('span', null, u.email),
          isResearcher ? h('span', { onClick: function (e) { e.stopPropagation(); toggleExpand(u.id); }, style: { display: 'block', marginTop: 3, fontSize: 11.5, color: '#6366f1', cursor: 'pointer', fontWeight: 600 } },
            (u.mtmt_id ? 'MTMT ' + u.mtmt_id + ' · ' : '') + pubCount + ' publication' + (pubCount === 1 ? '' : 's') + ' ' + (isExp ? '▴ hide' : '▾ show')) : null
        ))),
        h('td', null, u.affiliation || h('span', { style: { color: 'var(--muted)' } }, '—')),
        h('td', null, h(Badge, { s: u.status }), u.role === 'admin' && h('span', { className: 'badge b-admin' }, 'admin'),
          u.is_researcher && h('span', { className: 'badge', style: { background: 'var(--ok-bg)', color: '#0f766e' } }, 'researcher')),
        h('td', null, ag.projects.length),
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
          h('div', { className: 'stat' }, h('div', { className: 'n' }, projects.length), h('div', { className: 'l' }, 'Total projects')),
          h('div', { className: 'stat' }, h('div', { className: 'n' }, fmtBytes(totalStorage)), h('div', { className: 'l' }, 'Total storage · ' + credits(totalChars) + ' credits'))
        ),

        pending.length > 0 && h(React.Fragment, null,
          h('div', { className: 'sec-h' }, h('h2', null, 'Pending registrations'), h('span', { className: 'count' }, pending.length + ' waiting')),
          h('div', { className: 'panel' }, h('table', null, h('thead', null, tableHead), h('tbody', null, pending.map(function (u) { return userRow(u, true); }))))
        ),

        h('div', { className: 'sec-h' }, h('h2', null, 'All users'), h('span', { className: 'count' }, profiles.length + ' users · ' + profiles.filter(function (u) { return u.is_researcher; }).length + ' researchers (expand a row for their publications)')),
        h('div', { className: 'panel' },
          profiles.length === 0
            ? h('div', { className: 'empty' }, 'No users yet.')
            : h('table', null, h('thead', null, tableHead), h('tbody', null, sorted.map(function (u) { return userRow(u, false); })))
        )
      ),
      h(UserDrawer, { user: selUser, agg: selUser ? aggFor(selUser.id) : { projects: [], storage: 0, chars: 0, requests: 0 }, onClose: function () { setSelUser(null); }, onPreview: function (p) { setPreview(p); }, onAction: setStatus }),
      preview && h(ProjectPreview, { project: preview, onClose: function () { setPreview(null); } })
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
