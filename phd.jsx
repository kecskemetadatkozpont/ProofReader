/* Publify — Doctoral School manager (ported from doktori-iskola-menedzser). Loads in PhD.html after
 * React, Babel, supabase-js, config.js, auth.js, backend.js, publications.js. Shared Publify login
 * (PR_BACKEND) + Supabase. Phases 2–3: role-based shell, Supervisors directory, Students + detail
 * (milestones / credits / degree requirements / tasks), Topics. h = React.createElement. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect;
  var BE = window.PR_BACKEND, PUBS = window.PRPubs;
  var sb = BE && BE.sb;

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

  // status → chip colour class
  function stCls(s) {
    s = String(s || '');
    if (/Teljes|APPROVED|DONE|Aktív|ACHIEVED|COMPLETED|ELIGIBLE/.test(s)) return 'c-ok';
    if (/Folyamat|PENDING|IN_PROGRESS|Passzív|SCHEDULED|PLANNED|Tervezett/.test(s)) return 'c-warn';
    if (/Sikertelen|REJECTED|Lemorzsol|NOT_ELIGIBLE/.test(s)) return 'c-danger';
    return 'c-grey';
  }
  var MS_CYCLE = ['Tervezett', 'Folyamatban', 'Teljesítve'];
  var TASK_CYCLE = ['TODO', 'IN_PROGRESS', 'DONE'];
  function nextIn(arr, cur) { var i = arr.indexOf(cur); return arr[(i + 1) % arr.length]; }
  function CreditBar(p) {
    var pct = p.req ? Math.min(100, Math.round(p.val / p.req * 100)) : 0;
    return h('div', null,
      h('div', { className: 'kv', style: { marginTop: 0 } }, h('span', null, p.label || 'Credits'), h('span', null, p.val + ' / ' + p.req + ' (' + pct + '%)')),
      h('div', { className: 'meter' }, h('i', { style: { width: pct + '%', background: pct >= 100 ? 'var(--ok)' : 'var(--accent)' } }))
    );
  }

  // ---------- Supervisors ----------
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

  // ---------- Students ----------
  function AddStudentModal(props) {
    var f = useState({ name: '', email: '', enrollment_year: '', topic: '', supervisor_id: props.defaultSup || '', required_credits: 240 }), form = f[0], setForm = f[1];
    var busy = useState(false), saving = busy[0], setSaving = busy[1];
    function set(k, v) { setForm(Object.assign({}, form, k.constructor === Object ? k : (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!form.name.trim()) return;
      setSaving(true);
      sb.from('phd_students').insert({
        name: form.name.trim(), email: form.email.trim() || null, topic: form.topic.trim() || null,
        enrollment_year: form.enrollment_year ? Number(form.enrollment_year) : null,
        supervisor_id: form.supervisor_id || props.me.id, required_credits: Number(form.required_credits) || 240, status: 'Aktív'
      }).select().maybeSingle().then(function (r) { setSaving(false); if (r && r.error) { alert('Could not add: ' + r.error.message); return; } props.onSaved(); });
    }
    return h('div', { className: 'scrim', onMouseDown: props.onClose },
      h('div', { className: 'modal', onMouseDown: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', { style: { fontSize: 16 } }, 'New PhD student'), h('button', { className: 'x', onClick: props.onClose }, '✕')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Name *'), h('input', { value: form.name, onChange: function (e) { set('name', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Email'), h('input', { value: form.email, onChange: function (e) { set('email', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Research topic'), h('input', { value: form.topic, onChange: function (e) { set('topic', e.target.value); } })),
          h('div', { style: { display: 'flex', gap: 12 } },
            h('div', { className: 'field', style: { flex: 1 } }, h('label', null, 'Enrollment year'), h('input', { type: 'number', value: form.enrollment_year, placeholder: '2024', onChange: function (e) { set('enrollment_year', e.target.value); } })),
            h('div', { className: 'field', style: { flex: 1 } }, h('label', null, 'Required credits'), h('input', { type: 'number', value: form.required_credits, onChange: function (e) { set('required_credits', e.target.value); } }))
          ),
          props.isAdmin ? h('div', { className: 'field' }, h('label', null, 'Supervisor'),
            h('select', { value: form.supervisor_id, onChange: function (e) { set('supervisor_id', e.target.value); } },
              h('option', { value: '' }, '— select —'),
              props.sups.map(function (s) { return h('option', { value: s.id, key: s.id }, s.name); }))) : null
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Adding…' : 'Add student'))
      )
    );
  }

  function StudentList(props) {
    var q = useState(''), query = q[0], setQuery = q[1];
    var add = useState(false), adding = add[0], setAdding = add[1];
    var list = props.students.filter(function (s) { var t = (s.name + ' ' + (s.topic || '')).toLowerCase(); return t.indexOf(query.toLowerCase()) >= 0; });
    return h(React.Fragment, null,
      h('div', { className: 'toolbar' },
        h('input', { className: 'search', placeholder: 'Search students…', value: query, onChange: function (e) { setQuery(e.target.value); } }),
        props.canAdd ? h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New student') : null
      ),
      list.length ? list.map(function (s) {
        var sup = props.sups.filter(function (x) { return x.id === s.supervisor_id; })[0];
        var pct = s.required_credits ? Math.round((s.total_credits || 0) / s.required_credits * 100) : 0;
        return h('div', { className: 'stu-row', key: s.id, onClick: function () { props.onOpen(s); } },
          h(Avatar, { u: s, size: 38 }),
          h('div', { className: 'stu-main' }, h('b', null, s.name), h('span', null, (s.topic || 'No topic') + (sup ? ' · ' + sup.name : ''))),
          h('span', { className: 'chip ' + stCls(s.status) }, s.status),
          h('div', { className: 'stu-cred' }, h('div', { className: 'meter' }, h('i', { style: { width: Math.min(100, pct) + '%', background: pct >= 100 ? 'var(--ok)' : 'var(--accent)' } })), h('div', { style: { fontSize: 11, color: 'var(--muted)', marginTop: 3 } }, (s.total_credits || 0) + '/' + s.required_credits + ' cr'))
        );
      }) : h('div', { className: 'empty' }, query ? 'No students match.' : 'No students yet — add one to get started.'),
      adding ? h(AddStudentModal, { sups: props.sups, me: props.me, isAdmin: props.isAdmin, defaultSup: props.isAdmin ? '' : props.me.id, onClose: function () { setAdding(false); }, onSaved: function () { setAdding(false); props.onChanged(); } }) : null
    );
  }

  var STU_STATUS = ['Aktív', 'Passzív', 'Abszolutórium', 'Fokozatot szerzett', 'Lemorzsolódott'];
  var ETHICS = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'];
  var MS_TYPES = ['Publikáció', 'Tanegység', 'Vizsga', 'Oktatás', 'Disszertáció'];

  function StudentDetail(props) {
    var st0 = props.student, canEdit = props.canEdit;
    var s2 = useState(st0), stu = s2[0], setStu = s2[1];
    var ms = useState([]), mil = ms[0], setMil = ms[1];
    var rs = useState([]), req = rs[0], setReq = rs[1];
    var ts = useState([]), task = ts[0], setTask = ts[1];
    var nt = useState(''), newTask = nt[0], setNewTask = nt[1];
    var nm = useState({ title: '', type: 'Publikáció', credits: 0, deadline: '' }), newMil = nm[0], setNewMil = nm[1];

    useEffect(function () { load(); }, [st0.id]);
    function load() {
      Promise.all([
        sb.from('phd_milestones').select('*').eq('student_id', st0.id).order('deadline', { ascending: true }),
        sb.from('phd_degree_requirements').select('*').eq('student_id', st0.id),
        sb.from('phd_tasks').select('*').eq('student_id', st0.id).order('created_at', { ascending: true })
      ]).then(function (r) { setMil((r[0] && r[0].data) || []); setReq((r[1] && r[1].data) || []); setTask((r[2] && r[2].data) || []); });
    }
    function setField(field, val) { var p = {}; p[field] = val; setStu(Object.assign({}, stu, p)); sb.from('phd_students').update(p).eq('id', stu.id).then(function () { props.onChanged && props.onChanged(); }); }
    function cycleMs(m) { if (!canEdit) return; sb.from('phd_milestones').update({ status: nextIn(MS_CYCLE, m.status) }).eq('id', m.id).then(load); }
    function cycleTask(t) { if (!canEdit) return; sb.from('phd_tasks').update({ status: nextIn(TASK_CYCLE, t.status) }).eq('id', t.id).then(load); }
    function addTask() { if (!newTask.trim()) return; sb.from('phd_tasks').insert({ student_id: stu.id, title: newTask.trim(), status: 'TODO', priority: 'MEDIUM' }).then(function () { setNewTask(''); load(); }); }
    function delTask(t) { sb.from('phd_tasks').delete().eq('id', t.id).then(load); }
    function addMil() { if (!newMil.title.trim()) return; sb.from('phd_milestones').insert({ student_id: stu.id, title: newMil.title.trim(), type: newMil.type, credits: Number(newMil.credits) || 0, deadline: newMil.deadline || null, status: 'Tervezett' }).then(function () { setNewMil({ title: '', type: 'Publikáció', credits: 0, deadline: '' }); load(); }); }
    function delMil(m) { sb.from('phd_milestones').delete().eq('id', m.id).then(load); }
    function setReqVal(r, delta) { var v = Math.max(0, Number(r.current_value || 0) + delta); sb.from('phd_degree_requirements').update({ current_value: v }).eq('id', r.id).then(load); }

    var sup = props.sups.filter(function (x) { return x.id === stu.supervisor_id; })[0];
    var ce = stu.complex_exam || {};
    return h('div', null,
      h('button', { className: 'back-btn', onClick: props.onBack }, '← Students'),
      h('div', { className: 'dhead' },
        h(Avatar, { u: stu, size: 52 }),
        h('div', { className: 'dt' }, h('h1', null, stu.name), h('p', null, (stu.topic || 'No topic set') + (sup ? ' · ' + sup.name : '') + (stu.enrollment_year ? ' · enrolled ' + stu.enrollment_year : ''))),
        canEdit ? h('select', { className: 'mini', style: { height: 30 }, value: stu.status, onChange: function (e) { setField('status', e.target.value); } }, STU_STATUS.map(function (s) { return h('option', { key: s, value: s }, s); })) : h('span', { className: 'chip ' + stCls(stu.status) }, stu.status)
      ),
      // credits + exam + ethics
      h('div', { className: 'panel' },
        h(CreditBar, { label: 'Credit progress', val: stu.total_credits || 0, req: stu.required_credits || 240 }),
        h('div', { className: 'kv', style: { marginTop: 14 } },
          h('span', null, 'Complex exam: ', h('b', { style: { color: 'var(--ink)' } }, ce.status || 'NOT_ELIGIBLE')),
          h('span', null, 'Ethics: ', canEdit
            ? h('select', { className: 'mini', value: stu.ethics_status || 'NONE', onChange: function (e) { setField('ethics_status', e.target.value); } }, ETHICS.map(function (s) { return h('option', { key: s, value: s }, s); }))
            : h('b', { style: { color: 'var(--ink)' } }, stu.ethics_status || 'NONE'))
        )
      ),
      // degree requirements
      req.length ? h('div', { className: 'panel' },
        h('h3', null, 'Degree requirements'),
        req.map(function (r) {
          var pct = r.target_value ? Math.min(100, Math.round(r.current_value / r.target_value * 100)) : 0;
          return h('div', { className: 'req', key: r.id },
            h('div', { className: 'req-h' }, h('b', null, r.title, ' ', h('span', { className: 'chip c-grey', style: { marginLeft: 4 } }, r.category)), h('span', null,
              canEdit && !r.is_auto ? h('button', { className: 'icon-x', style: { color: 'var(--accent)' }, onClick: function () { setReqVal(r, -1); } }, '−') : null,
              ' ' + (r.current_value || 0) + ' / ' + r.target_value + ' ' + (r.unit || ''),
              canEdit && !r.is_auto ? h('button', { className: 'icon-x', style: { color: 'var(--accent)' }, onClick: function () { setReqVal(r, 1); } }, '+') : null)),
            h('div', { className: 'meter' }, h('i', { style: { width: pct + '%', background: pct >= 100 ? 'var(--ok)' : 'var(--accent)' } }))
          );
        })
      ) : null,
      // milestones
      h('div', { className: 'panel' },
        h('h3', null, 'Milestones', h('span', { style: { color: 'var(--muted)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 } }, mil.length + ' total')),
        mil.length ? mil.map(function (m) {
          return h('div', { className: 'ms', key: m.id },
            h('div', { className: 'mt' }, h('b', null, m.title), h('span', null, [m.type, m.credits ? m.credits + ' cr' : null, m.deadline].filter(Boolean).join(' · '))),
            canEdit ? h('button', { className: 'chip ' + stCls(m.status), title: 'Click to advance', onClick: function () { cycleMs(m); } }, m.status) : h('span', { className: 'chip ' + stCls(m.status) }, m.status),
            canEdit ? h('button', { className: 'icon-x', onClick: function () { delMil(m); } }, '✕') : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No milestones yet.'),
        canEdit ? h('div', { className: 'addrow' },
          h('input', { className: 'grow', placeholder: 'New milestone…', value: newMil.title, onChange: function (e) { setNewMil(Object.assign({}, newMil, { title: e.target.value })); } }),
          h('select', { value: newMil.type, onChange: function (e) { setNewMil(Object.assign({}, newMil, { type: e.target.value })); } }, MS_TYPES.map(function (t) { return h('option', { key: t, value: t }, t); })),
          h('input', { type: 'number', style: { width: 70 }, placeholder: 'cr', value: newMil.credits, onChange: function (e) { setNewMil(Object.assign({}, newMil, { credits: e.target.value })); } }),
          h('input', { type: 'date', value: newMil.deadline, onChange: function (e) { setNewMil(Object.assign({}, newMil, { deadline: e.target.value })); } }),
          h('button', { className: 'btn pri', onClick: addMil }, 'Add')
        ) : null
      ),
      // tasks
      h('div', { className: 'panel' },
        h('h3', null, 'Tasks'),
        task.length ? task.map(function (t) {
          return h('div', { className: 'ms', key: t.id },
            canEdit ? h('button', { className: 'chip ' + stCls(t.status), title: 'Click to advance', onClick: function () { cycleTask(t); } }, t.status.replace('_', ' ')) : h('span', { className: 'chip ' + stCls(t.status) }, t.status.replace('_', ' ')),
            h('div', { className: 'mt' }, h('b', { style: { textDecoration: t.status === 'DONE' ? 'line-through' : 'none', color: t.status === 'DONE' ? 'var(--muted)' : 'inherit' } }, t.title), t.due_date ? h('span', null, 'due ' + t.due_date) : null),
            h('span', { className: 'chip c-grey' }, t.priority),
            canEdit ? h('button', { className: 'icon-x', onClick: function () { delTask(t); } }, '✕') : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No tasks yet.'),
        canEdit ? h('div', { className: 'addrow' },
          h('input', { className: 'grow', placeholder: 'New task… (Enter)', value: newTask, onChange: function (e) { setNewTask(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') addTask(); } }),
          h('button', { className: 'btn pri', onClick: addTask }, 'Add task')
        ) : null
      )
    );
  }

  // ---------- Topics ----------
  function AddTopicModal(props) {
    var f = useState({ title: '', description: '', tags: '', supervisor_id: props.isAdmin ? '' : props.me.id }), form = f[0], setForm = f[1];
    var busy = useState(false), saving = busy[0], setSaving = busy[1];
    function set(k, v) { var o = {}; o[k] = v; setForm(Object.assign({}, form, o)); }
    function save() {
      if (!form.title.trim()) return; setSaving(true);
      sb.from('phd_topics').insert({ title: form.title.trim(), description: form.description.trim() || null, tags: form.tags ? form.tags.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null, supervisor_id: form.supervisor_id || props.me.id, status: 'OPEN' }).select().maybeSingle().then(function (r) { setSaving(false); if (r && r.error) { alert('Could not add: ' + r.error.message); return; } props.onSaved(); });
    }
    return h('div', { className: 'scrim', onMouseDown: props.onClose },
      h('div', { className: 'modal', onMouseDown: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', { style: { fontSize: 16 } }, 'New research topic'), h('button', { className: 'x', onClick: props.onClose }, '✕')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { set('title', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Description'), h('input', { value: form.description, onChange: function (e) { set('description', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Tags (comma-separated)'), h('input', { placeholder: 'IoT, Security, …', value: form.tags, onChange: function (e) { set('tags', e.target.value); } })),
          props.isAdmin ? h('div', { className: 'field' }, h('label', null, 'Supervisor'), h('select', { value: form.supervisor_id, onChange: function (e) { set('supervisor_id', e.target.value); } }, h('option', { value: '' }, '— select —'), props.sups.map(function (s) { return h('option', { value: s.id, key: s.id }, s.name); }))) : null
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Posting…' : 'Post topic'))
      )
    );
  }
  function Topics(props) {
    var add = useState(false), adding = add[0], setAdding = add[1];
    function toggle(t) { sb.from('phd_topics').update({ status: t.status === 'OPEN' ? 'CLOSED' : 'OPEN' }).eq('id', t.id).then(props.onChanged); }
    function del(t) { if (!window.confirm('Delete this topic?')) return; sb.from('phd_topics').delete().eq('id', t.id).then(props.onChanged); }
    return h(React.Fragment, null,
      props.canPost ? h('div', { className: 'toolbar' }, h('div', { style: { flex: 1 } }), h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New topic')) : null,
      props.topics.length ? h('div', { className: 'grid' }, props.topics.map(function (t) {
        var sup = props.sups.filter(function (s) { return s.id === t.supervisor_id; })[0];
        var mine = props.isAdmin || t.supervisor_id === props.me.id;
        return h('div', { className: 'card', key: t.id, style: { cursor: 'default' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } }, h('b', { style: { fontSize: 14.5 } }, t.title), h('span', { className: 'badge', style: t.status === 'OPEN' ? { background: 'var(--ok-bg)', color: 'var(--ok)' } : {} }, t.status)),
          h('div', { style: { fontSize: 12.5, color: 'var(--muted)', margin: '7px 0' } }, t.description || ''),
          (t.tags && t.tags.length) ? h('div', { className: 'tags' }, t.tags.map(function (x, i) { return h('span', { className: 'tag', key: i }, x); })) : null,
          h('div', { className: 'kv' }, h('span', null, sup ? sup.name : '—'), h('span', null, '')),
          mine ? h('div', { className: 'topic-foot' }, h('button', { onClick: function () { toggle(t); } }, t.status === 'OPEN' ? 'Close' : 'Reopen'), h('button', { className: 'del', onClick: function () { del(t); } }, 'Delete')) : null
        );
      })) : h('div', { className: 'empty' }, 'No research topics yet.'),
      adding ? h(AddTopicModal, { sups: props.sups, me: props.me, isAdmin: props.isAdmin, onClose: function () { setAdding(false); }, onSaved: function () { setAdding(false); props.onChanged(); } }) : null
    );
  }

  // ---------- Dashboard ----------
  function Dashboard(props) {
    var students = props.students, ms = props.milestones, byId = {};
    students.forEach(function (s) { byId[s.id] = s; });
    var total = students.length;
    var active = students.filter(function (s) { return s.status === 'Aktív'; }).length;
    var grad = students.filter(function (s) { return s.status === 'Fokozatot szerzett'; }).length;
    var drop = students.filter(function (s) { return s.status === 'Lemorzsolódott'; }).length;
    var avgProg = total ? Math.round(students.reduce(function (a, s) { return a + (s.required_credits ? Math.min(1, (s.total_credits || 0) / s.required_credits) : 0); }, 0) / total * 100) : 0;
    var openTopics = props.topics.filter(function (t) { return t.status === 'OPEN'; }).length;
    var yNow = 2026;
    var atRisk = students.filter(function (s) { return s.status === 'Aktív' && s.enrollment_year && (yNow - s.enrollment_year) >= 3 && (s.required_credits ? (s.total_credits || 0) / s.required_credits : 0) < 0.6; }).length;
    var STAT = ['Aktív', 'Passzív', 'Abszolutórium', 'Fokozatot szerzett', 'Lemorzsolódott'];
    var statColor = { 'Aktív': 'var(--ok)', 'Passzív': 'var(--warn)', 'Abszolutórium': '#0891b2', 'Fokozatot szerzett': 'var(--accent)', 'Lemorzsolódott': 'var(--danger)' };
    var maxStat = Math.max(1, STAT.reduce(function (m, st) { return Math.max(m, students.filter(function (x) { return x.status === st; }).length); }, 0));
    var today = '2026-06-20';
    var upcoming = ms.filter(function (m) { return m.deadline && m.status !== 'Teljesítve' && m.status !== 'Sikertelen'; }).sort(function (a, b) { return (a.deadline || '').localeCompare(b.deadline || ''); }).slice(0, 7);
    function days(d) { try { return Math.round((new Date(d) - new Date(today)) / 86400000); } catch (e) { return null; } }

    return h(React.Fragment, null,
      h('div', { className: 'kpis' },
        h('div', { className: 'kpi' }, h('div', { className: 'n' }, active), h('div', { className: 'l' }, 'Active students'), h('div', { className: 's' }, total + ' total')),
        h('div', { className: 'kpi' }, h('div', { className: 'n' }, avgProg + '%'), h('div', { className: 'l' }, 'Avg credit progress')),
        h('div', { className: 'kpi' }, h('div', { className: 'n' }, grad), h('div', { className: 'l' }, 'Graduated')),
        h('div', { className: 'kpi' + (total && drop / total > 0.15 ? ' alert' : '') }, h('div', { className: 'n' }, (total ? Math.round(drop / total * 100) : 0) + '%'), h('div', { className: 'l' }, 'Dropout rate'), h('div', { className: 's' }, drop + ' dropped out')),
        h('div', { className: 'kpi' + (atRisk ? ' alert' : '') }, h('div', { className: 'n' }, atRisk), h('div', { className: 'l' }, 'At risk'), h('div', { className: 's' }, '3+ yrs & < 60% credits')),
        h('div', { className: 'kpi' }, h('div', { className: 'n' }, openTopics), h('div', { className: 'l' }, 'Open topics'))
      ),
      h('div', { className: 'panels2' },
        h('div', { className: 'panel' }, h('h3', null, 'Students by status'),
          total ? STAT.map(function (st) {
            var c = students.filter(function (x) { return x.status === st; }).length;
            return h('div', { className: 'barrow', key: st }, h('span', { className: 'bl' }, st), h('span', { className: 'bt' }, h('i', { style: { width: (c / maxStat * 100) + '%', background: statColor[st] } })), h('span', { className: 'bv' }, c));
          }) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No students yet.')
        ),
        h('div', { className: 'panel' }, h('h3', null, 'Upcoming milestone deadlines'),
          upcoming.length ? upcoming.map(function (m) {
            var st = byId[m.student_id], d = days(m.deadline);
            return h('div', { className: 'dl', key: m.id }, h('div', { className: 'dd' }, h('b', null, m.title), h('span', null, (st ? st.name : '—') + ' · ' + (m.type || ''))), h('span', { className: 'when', style: { color: d != null && d < 0 ? 'var(--danger)' : (d != null && d < 30 ? 'var(--warn)' : 'var(--muted)') } }, d == null ? m.deadline : (d < 0 ? Math.abs(d) + 'd overdue' : 'in ' + d + 'd')));
          }) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No upcoming deadlines.')
        )
      )
    );
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
    var dS = useState({ sups: [], students: [], topics: [], milestones: [] }), data = dS[0], setData = dS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];   // selected student (detail)

    useEffect(function () { boot(); }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      sb.from('profiles').select('role,is_supervisor,is_student,name').eq('id', BE.user.id).maybeSingle().then(function (r) {
        var p = (r && r.data) || {};
        setMe({ id: BE.user.id, name: p.name || BE.user.name, role: p.role, is_supervisor: p.is_supervisor, is_student: p.is_student });
        loadData(function () { setPhase('ready'); });
      }, function () { setMe({ id: BE.user.id, name: BE.user.name }); setPhase('ready'); });
    }
    function loadData(done) {
      Promise.all([
        sb.from('profiles').select('id,name,email,department,capacity_max,research_interests,avatar_url,mtmt_id').eq('is_supervisor', true).order('name'),
        sb.from('phd_students').select('id,name,email,supervisor_id,topic,status,total_credits,required_credits,enrollment_year,ethics_status,complex_exam,avatar_url'),
        sb.from('phd_topics').select('id,supervisor_id,title,description,tags,status').order('created_at', { ascending: false }),
        sb.from('phd_milestones').select('id,student_id,title,deadline,status,type').order('deadline', { ascending: true })
      ]).then(function (res) {
        var nd = { sups: (res[0] && res[0].data) || [], students: (res[1] && res[1].data) || [], topics: (res[2] && res[2].data) || [], milestones: (res[3] && res[3].data) || [] };
        setData(nd);
        setSel(function (cur) { return cur ? (nd.students.filter(function (s) { return s.id === cur.id; })[0] || null) : null; });
        if (done) done();
      });
    }
    function signIn() { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); }

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Doctoral School'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Doctoral School'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return null;
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in to the Doctoral School'), h('p', null, 'The doctoral manager needs your account (email + password or Google).'), h('button', { className: 'btn pri', onClick: signIn }, 'Sign in')));

    var isAdmin = me && me.role === 'admin';
    var isSup = me && (isAdmin || me.is_supervisor);
    var roleLabel = isAdmin ? 'Administrator' : (me && me.is_supervisor ? 'Supervisor' : (me && me.is_student ? 'Student' : 'Member'));
    var NAV = [];
    if (isSup) { NAV.push(['dashboard', 'Dashboard']); NAV.push(['students', 'Students']); }
    NAV.push(['supervisors', 'Supervisors']); NAV.push(['topics', 'Research topics']);
    var allowed = NAV.map(function (x) { return x[0]; });
    var cur = allowed.indexOf(view) >= 0 ? view : 'supervisors';
    var nStu = data.students.length;
    var titles = { dashboard: 'Dashboard', students: 'Students', supervisors: 'Supervisors', topics: 'Research topics' };
    var subs = { supervisors: data.sups.length + ' supervisors · ' + nStu + ' student' + (nStu === 1 ? '' : 's'), topics: data.topics.length + ' topics', students: nStu + ' student' + (nStu === 1 ? '' : 's'), dashboard: (isAdmin ? 'Institution-wide' : 'Your students') + ' · ' + nStu + ' student' + (nStu === 1 ? '' : 's') };
    function canEditStudent(s) { return isAdmin || (s && s.supervisor_id === me.id); }

    var body;
    if (cur === 'dashboard') body = h(Dashboard, { students: data.students, milestones: data.milestones, topics: data.topics, me: me, isAdmin: isAdmin });
    else if (cur === 'supervisors') body = h(Supervisors, { sups: data.sups, students: data.students });
    else if (cur === 'topics') body = h(Topics, { topics: data.topics, sups: data.sups, me: me, isAdmin: isAdmin, canPost: isSup, onChanged: function () { loadData(); } });
    else if (cur === 'students') {
      body = sel
        ? h(StudentDetail, { student: sel, sups: data.sups, canEdit: canEditStudent(sel), onBack: function () { setSel(null); }, onChanged: function () { loadData(); } })
        : h(StudentList, { students: data.students, sups: data.sups, me: me, isAdmin: isAdmin, canAdd: isSup, onOpen: function (s) { setSel(s); }, onChanged: function () { loadData(); } });
    } else body = h('div', { className: 'soon' }, titles[cur] + ' — coming in the next phase.');

    return h('div', { className: 'app' },
      h('div', { className: 'side' },
        h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Doctoral School'))),
        h('nav', { className: 'nav' }, NAV.map(function (it) { return h('button', { key: it[0], className: cur === it[0] ? 'on' : '', onClick: function () { setSel(null); setView(it[0]); } }, IC[it[0]], h('span', null, it[1])); })),
        h('div', { className: 'side-foot' }, h(Avatar, { u: me, size: 32 }), h('div', { className: 'who' }, h('b', null, me.name), h('span', null, roleLabel)), h('a', { className: 'exit', href: 'Projects.html', title: 'Back to Publify' }, '←'))
      ),
      h('div', { className: 'main' },
        (cur === 'students' && sel) ? null : h('div', { className: 'head' }, h('div', null, h('h1', null, titles[cur]), h('div', { className: 'sub' }, subs[cur] || '')), isAdmin ? h('span', { className: 'badge role' }, 'admin view') : null),
        body
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
