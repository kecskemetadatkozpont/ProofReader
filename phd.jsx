/* Publify — Doctoral School manager (ported from doktori-iskola-menedzser). Loads in PhD.html after
 * React, Babel, supabase-js, config.js, auth.js, backend.js, publications.js. Uses the shared
 * Publify login (PR_BACKEND) + Supabase. Phase 2: role-based shell + Supervisors directory + Topics.
 * Uses h = React.createElement (no JSX build step needed for plain elements). */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect;
  var BE = window.PR_BACKEND;
  var PUBS = window.PRPubs;

  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  var PALETTE = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626'];
  function colorFor(id) { var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[x % PALETTE.length]; }
  function Avatar(p) {
    var u = p.u || {}, sz = p.size || 36, st = { width: sz, height: sz, fontSize: sz * 0.36 };
    if (u.avatar_url) return h('span', { className: 'av', style: Object.assign({ backgroundImage: 'url(' + u.avatar_url + ')' }, st) });
    return h('span', { className: 'av', style: Object.assign({ background: u.color || colorFor(u.id || u.name) }, st) }, initials(u.name || u.email));
  }
  function pubRec(email) { try { return (PUBS && PUBS.forEmail && PUBS.forEmail(email)) || null; } catch (e) { return null; } }
  function pubCount(email) { var r = pubRec(email); return r ? (r.pubCount || (r.publications || []).length) : 0; }

  function SupervisorModal(props) {
    var s = props.sup, students = props.students.filter(function (x) { return x.supervisor_id === s.id; }), rec = pubRec(s.email);
    return h('div', { className: 'scrim', onMouseDown: props.onClose },
      h('div', { className: 'modal', onMouseDown: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h(Avatar, { u: s, size: 44 }), h('div', null, h('b', { style: { fontSize: 16 } }, s.name), h('div', { style: { fontSize: 12.5, color: 'var(--muted)' } }, s.department || '—')), h('button', { className: 'x', onClick: props.onClose }, '✕')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'sec-t' }, 'Research interests'),
          (s.research_interests && s.research_interests.length) ? h('div', { className: 'tags' }, s.research_interests.map(function (t, i) { return h('span', { className: 'tag', key: i }, t); })) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'None listed yet.'),
          h('div', { className: 'sec-t' }, 'Capacity'),
          h('div', { style: { fontSize: 13 } }, students.length + ' / ' + (s.capacity_max || '—') + ' students'),
          h('div', { className: 'sec-t' }, 'Students (' + students.length + ')'),
          students.length ? students.map(function (st) { return h('div', { className: 'row', key: st.id }, h(Avatar, { u: st, size: 26 }), h('div', { style: { flex: 1 } }, h('b', null, st.name), h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, st.topic || '—')), h('span', { className: 'badge' }, st.status)); }) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No students assigned.'),
          h('div', { className: 'sec-t' }, 'Publications (MTMT)'),
          rec ? h('div', { style: { fontSize: 13 } }, h('b', null, rec.pubCount), ' publications · ', h('a', { href: 'https://m2.mtmt.hu/gui2/?mode=browse&params=author;' + rec.mtmtId, target: '_blank' }, 'MTMT')) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No publication record.')
        )
      )
    );
  }

  function Supervisors(props) {
    var sel = useState(null), open = sel[0], setOpen = sel[1];
    if (!props.sups.length) return h('div', { className: 'empty' }, 'No supervisors yet.');
    return h(React.Fragment, null,
      h('div', { className: 'grid' }, props.sups.map(function (s) {
        var n = props.students.filter(function (x) { return x.supervisor_id === s.id; }).length, cap = s.capacity_max || 0;
        return h('div', { className: 'card', key: s.id, onClick: function () { setOpen(s); } },
          h('div', { className: 'ch' }, h(Avatar, { u: s }), h('div', null, h('b', null, s.name), h('span', null, s.department || '—'))),
          (s.research_interests && s.research_interests.length) ? h('div', { className: 'tags' }, s.research_interests.slice(0, 3).map(function (t, i) { return h('span', { className: 'tag', key: i }, t); })) : null,
          h('div', { className: 'kv' }, h('span', null, 'Capacity'), h('span', null, n + ' / ' + (cap || '—'))),
          h('div', { className: 'meter' }, h('i', { style: { width: (cap ? Math.min(100, n / cap * 100) : 0) + '%', background: (cap && n >= cap) ? 'var(--danger)' : 'var(--accent)' } })),
          h('div', { className: 'kv' }, h('span', null, pubCount(s.email) + ' publications'), h('span', null, n ? n + ' student' + (n === 1 ? '' : 's') : 'open'))
        );
      })),
      open ? h(SupervisorModal, { sup: open, students: props.students, onClose: function () { setOpen(null); } }) : null
    );
  }

  function Topics(props) {
    if (!props.topics.length) return h('div', { className: 'empty' }, 'No open research topics yet.');
    return h('div', { className: 'grid' }, props.topics.map(function (t) {
      var sup = props.sups.filter(function (s) { return s.id === t.supervisor_id; })[0];
      return h('div', { className: 'card', key: t.id, style: { cursor: 'default' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } }, h('b', { style: { fontSize: 14.5 } }, t.title), h('span', { className: 'badge', style: t.status === 'OPEN' ? { background: 'var(--ok-bg)', color: 'var(--ok)' } : {} }, t.status)),
        h('div', { style: { fontSize: 12.5, color: 'var(--muted)', margin: '7px 0' } }, t.description || ''),
        (t.tags && t.tags.length) ? h('div', { className: 'tags' }, t.tags.map(function (x, i) { return h('span', { className: 'tag', key: i }, x); })) : null,
        h('div', { className: 'kv' }, h('span', null, sup ? sup.name : '—'), h('span', null, ''))
      );
    }));
  }

  var IC = {
    dashboard: h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('rect', { x: 2, y: 2, width: 5, height: 5, rx: 1 }), h('rect', { x: 9, y: 2, width: 5, height: 5, rx: 1 }), h('rect', { x: 2, y: 9, width: 5, height: 5, rx: 1 }), h('rect', { x: 9, y: 9, width: 5, height: 5, rx: 1 })),
    students: h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('circle', { cx: 8, cy: 5, r: 2.4 }), h('path', { d: 'M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4', strokeLinecap: 'round' })),
    supervisors: h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('circle', { cx: 5.5, cy: 5, r: 2 }), h('circle', { cx: 11, cy: 6, r: 1.6 }), h('path', { d: 'M1.5 13c0-2 1.8-3.2 4-3.2s4 1.2 4 3.2M9.5 12.5c.2-1.5 1.4-2.4 3-2.4s2 .7 2 1.6', strokeLinecap: 'round' })),
    topics: h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('rect', { x: 2, y: 2.5, width: 12, height: 11, rx: 2 }), h('path', { d: 'M5 6h6M5 9h4', strokeLinecap: 'round' }))
  };

  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var vS = useState('supervisors'), view = vS[0], setView = vS[1];
    var dS = useState({ sups: [], students: [], topics: [] }), data = dS[0], setData = dS[1];

    useEffect(function () { boot(); }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      var sb = BE.sb;
      sb.from('profiles').select('role,is_supervisor,is_student,name').eq('id', BE.user.id).maybeSingle().then(function (r) {
        var p = (r && r.data) || {};
        setMe({ id: BE.user.id, name: p.name || BE.user.name, role: p.role, is_supervisor: p.is_supervisor, is_student: p.is_student });
        Promise.all([
          sb.from('profiles').select('id,name,email,department,capacity_max,research_interests,avatar_url,mtmt_id').eq('is_supervisor', true).order('name'),
          sb.from('phd_students').select('id,name,supervisor_id,topic,status,total_credits,required_credits,enrollment_year,avatar_url'),
          sb.from('phd_topics').select('id,supervisor_id,title,description,tags,status').order('created_at', { ascending: false })
        ]).then(function (res) {
          setData({ sups: (res[0] && res[0].data) || [], students: (res[1] && res[1].data) || [], topics: (res[2] && res[2].data) || [] });
          setPhase('ready');
        }, function () { setPhase('ready'); });
      }, function () { setMe({ id: BE.user.id, name: BE.user.name }); setPhase('ready'); });
    }
    function signIn() { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); }

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Doctoral School'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Doctoral School'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return null;   // backend.js paints its own sign-in overlay
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in to the Doctoral School'), h('p', null, 'The doctoral manager needs your account (email + password or Google).'), h('button', { className: 'btn pri', onClick: signIn }, 'Sign in')));

    var isSup = me && (me.role === 'admin' || me.is_supervisor);
    var roleLabel = me && me.role === 'admin' ? 'Administrator' : (me && me.is_supervisor ? 'Supervisor' : (me && me.is_student ? 'Student' : 'Member'));
    var NAV = [];
    if (isSup) { NAV.push(['dashboard', 'Dashboard']); NAV.push(['students', 'Students']); }
    NAV.push(['supervisors', 'Supervisors']); NAV.push(['topics', 'Research topics']);
    var allowed = NAV.map(function (x) { return x[0]; });
    var cur = allowed.indexOf(view) >= 0 ? view : 'supervisors';
    var titles = { dashboard: 'Dashboard', students: 'Students', supervisors: 'Supervisors', topics: 'Research topics' };
    var nStu = data.students.length;
    var subs = { supervisors: data.sups.length + ' supervisors · ' + nStu + ' student' + (nStu === 1 ? '' : 's'), topics: data.topics.length + ' open topics', students: 'student list + progress detail — next phase', dashboard: 'KPIs + charts — next phase' };

    var body;
    if (cur === 'supervisors') body = h(Supervisors, { sups: data.sups, students: data.students });
    else if (cur === 'topics') body = h(Topics, { topics: data.topics, sups: data.sups });
    else body = h('div', { className: 'soon' }, titles[cur] + ' — coming in the next phase.');

    return h('div', { className: 'app' },
      h('div', { className: 'side' },
        h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Doctoral School'))),
        h('nav', { className: 'nav' }, NAV.map(function (it) { return h('button', { key: it[0], className: cur === it[0] ? 'on' : '', onClick: function () { setView(it[0]); } }, IC[it[0]], h('span', null, it[1])); })),
        h('div', { className: 'side-foot' }, h(Avatar, { u: me, size: 32 }), h('div', { className: 'who' }, h('b', null, me.name), h('span', null, roleLabel)), h('a', { className: 'exit', href: 'Projects.html', title: 'Back to Publify' }, '←'))
      ),
      h('div', { className: 'main' },
        h('div', { className: 'head' }, h('div', null, h('h1', null, titles[cur]), h('div', { className: 'sub' }, subs[cur] || '')), me.role === 'admin' ? h('span', { className: 'badge role' }, 'admin view') : null),
        body
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
