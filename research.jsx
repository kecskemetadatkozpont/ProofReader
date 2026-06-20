/* Publify — Research Management (R0 Foundation).
 * Research projects + stage pipeline + research log + tasks, on Supabase (RLS-scoped to owner,
 * the linked PhD student's supervisor(s), and admin). Mirrors phd.jsx patterns incl. admin View-as. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect;
  var BE = window.PR_BACKEND;
  var sb = BE && BE.sb;

  var STAGES = ['Setup', 'Idea', 'Literature', 'Protocol', 'Data', 'Compute', 'Analysis', 'Writing', 'Submission'];
  var LOG_TYPES = ['NOTE', 'DECISION', 'RESULT', 'ARTIFACT', 'MILESTONE', 'TASK'];
  var STATUS_LABEL = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };

  function adminTargetUser() {
    try {
      if (!/[?&]adminView=1/.test(location.search)) return null;
      if (!(BE && BE.user)) return null;
      var t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
      return t && t.id ? t : null;
    } catch (e) { return null; }
  }

  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  var PALETTE = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626'];
  function colorFor(id) { var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[x % PALETTE.length]; }
  function Avatar(props) {
    var u = props.u || {}, s = props.size || 36;
    var st = { width: s, height: s, fontSize: Math.round(s * 0.36) };
    if (u.avatar_url) { st.backgroundImage = 'url(' + u.avatar_url + ')'; return h('div', { className: 'av', style: st }); }
    st.background = colorFor(u.id || u.name);
    return h('div', { className: 'av', style: st }, initials(u.name));
  }

  function whenStr(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = BE && BE._now ? BE._now : null;
    var s = d.toISOString().slice(0, 10);
    var t = d.toTimeString().slice(0, 5);
    return s + ' ' + t;
  }

  // ---------- New project ----------
  function NewProjectModal(props) {
    var f = useState({ title: '', field: '', keywords: '', goal: '' }), form = f[0], setForm = f[1];
    var s = useState(false), saving = s[0], setSaving = s[1];
    function up(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!form.title.trim()) return;
      setSaving(true);
      sb.from('research_projects').insert({
        owner_id: props.ownerId, title: form.title.trim(), field: form.field.trim() || null,
        keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
        goal: form.goal.trim() || null, stage: 0, status: 'active'
      }).select().maybeSingle().then(function (r) {
        setSaving(false);
        if (r && r.error) { alert('Could not create: ' + r.error.message); return; }
        props.onSaved(r && r.data);
      });
    }
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'New research project'), h('button', { className: 'x', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); }, placeholder: 'e.g. Fisher fusion for LiDAR OOD detection' })),
          h('div', { className: 'field' }, h('label', null, 'Field'), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, 'Keywords (comma-separated)'), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, 'Goal / expected output'), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); }, placeholder: 'What does success look like? (paper, thesis chapter, …)' }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Creating…' : 'Create project'))
      )
    );
  }

  // ---------- Stage stepper ----------
  function Stepper(props) {
    var cur = props.stage || 0;
    var kids = [];
    STAGES.forEach(function (name, i) {
      if (i > 0) kids.push(h('div', { className: 'step-sep', key: 'sep' + i }));
      var cls = 'step' + (i === cur ? ' cur' : (i < cur ? ' done' : ''));
      kids.push(h('button', {
        key: i, className: cls, disabled: !props.canEdit,
        title: props.canEdit ? 'Set stage to ' + name : name,
        onClick: function () { if (props.canEdit && i !== cur) props.onSet(i); }
      }, h('span', { className: 'dot' }, i < cur ? '✓' : (i + 1)), name));
    });
    return h('div', { className: 'stepper' }, kids);
  }

  // ---------- Research log ----------
  function LogPanel(props) {
    var t = useState('NOTE'), type = t[0], setType = t[1];
    var x = useState(''), text = x[0], setText = x[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    function add() {
      if (!text.trim()) return;
      setBusy(true);
      sb.from('research_log').insert({ project_id: props.projectId, profile_id: props.authorId, type: type, summary: text.trim() }).then(function (r) {
        setBusy(false);
        if (r && r.error) { alert(r.error.message); return; }
        setText(''); props.onChanged();
      });
    }
    function del(e) { sb.from('research_log').delete().eq('id', e.id).then(props.onChanged); }
    var entries = props.entries || [];
    return h('div', { className: 'panel' },
      h('h3', null, 'Research log', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, entries.length + ' entries')),
      props.canEdit ? h('div', { className: 'addrow', style: { marginTop: 0, marginBottom: 6 } },
        h('select', { value: type, onChange: function (e) { setType(e.target.value); } }, LOG_TYPES.map(function (lt) { return h('option', { key: lt, value: lt }, lt); })),
        h('input', { className: 'grow', value: text, placeholder: 'What did you do / decide / find?', onChange: function (e) { setText(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') add(); } }),
        h('button', { className: 'btn pri', disabled: busy, onClick: add }, 'Log')
      ) : null,
      entries.length ? entries.map(function (e) {
        var who = (e.profiles && e.profiles.name) || '';
        return h('div', { className: 'log-entry', key: e.id },
          h('span', { className: 'chip ' + (e.type === 'RESULT' || e.type === 'MILESTONE' ? 'c-ok' : (e.type === 'DECISION' ? 'c-acc' : 'c-grey')) }, e.type),
          h('div', { className: 'lt' }, h('p', null, e.summary), h('span', null, whenStr(e.ts) + (who ? ' · ' + who : ''))),
          props.canEdit ? h('button', { className: 'icon-x', onClick: function () { del(e); } }, '✕') : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No log entries yet.')
    );
  }

  // ---------- Tasks ----------
  function TasksPanel(props) {
    var x = useState(''), text = x[0], setText = x[1];
    function add() { if (!text.trim()) return; sb.from('research_tasks').insert({ project_id: props.projectId, title: text.trim(), status: 'todo' }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } setText(''); props.onChanged(); }); }
    function setStatus(tk, st) { sb.from('research_tasks').update({ status: st }).eq('id', tk.id).then(props.onChanged); }
    function del(tk) { sb.from('research_tasks').delete().eq('id', tk.id).then(props.onChanged); }
    var tasks = props.tasks || [];
    var open = tasks.filter(function (t) { return t.status !== 'done'; }).length;
    return h('div', { className: 'panel' },
      h('h3', null, 'Tasks', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, open + ' open')),
      props.canEdit ? h('div', { className: 'addrow', style: { marginTop: 0, marginBottom: 6 } },
        h('input', { className: 'grow', value: text, placeholder: 'New task…', onChange: function (e) { setText(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') add(); } }),
        h('button', { className: 'btn pri', onClick: add }, 'Add')
      ) : null,
      tasks.length ? tasks.map(function (tk) {
        return h('div', { className: 'trow', key: tk.id },
          h('div', { className: 'tt' + (tk.status === 'done' ? ' done' : '') }, tk.title),
          props.canEdit ? h('div', { className: 'seg' }, ['todo', 'doing', 'done'].map(function (st) {
            return h('button', { key: st, className: tk.status === st ? 'on' : '', onClick: function () { setStatus(tk, st); } }, st);
          })) : h('span', { className: 'chip ' + (tk.status === 'done' ? 'c-ok' : (tk.status === 'doing' ? 'c-warn' : 'c-grey')) }, tk.status),
          props.canEdit ? h('button', { className: 'icon-x', onClick: function () { del(tk); } }, '✕') : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No tasks yet.')
    );
  }

  // ---------- Project detail ----------
  function ProjectDetail(props) {
    var p = props.project;
    function setStage(i) { sb.from('research_projects').update({ stage: i }).eq('id', p.id).then(props.onChanged); }
    function setStatus(e) { sb.from('research_projects').update({ status: e.target.value }).eq('id', p.id).then(props.onChanged); }
    return h('div', null,
      h('button', { className: 'back-btn', onClick: props.onBack }, '← All projects'),
      h('div', { className: 'dhead' },
        h('div', { className: 'dt' }, h('h1', null, p.title), h('p', null, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : ''))),
        props.canEdit
          ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, STATUS_LABEL[k]); }))
          : h('span', { className: 'chip c-grey' }, STATUS_LABEL[p.status] || p.status)
      ),
      h(Stepper, { stage: p.stage, canEdit: props.canEdit, onSet: setStage }),
      p.goal ? h('div', { className: 'panel' }, h('h3', null, 'Goal'), h('div', { style: { fontSize: 13.5 } }, p.goal)) : null,
      h(LogPanel, { projectId: p.id, authorId: props.authorId, entries: props.log, canEdit: props.canEdit, onChanged: props.onChanged }),
      h(TasksPanel, { projectId: p.id, tasks: props.tasks, canEdit: props.canEdit, onChanged: props.onChanged })
    );
  }

  // ---------- Project card ----------
  function ProjectCard(props) {
    var p = props.project;
    var openTasks = p._openTasks;
    return h('div', { className: 'card', onClick: function () { props.onOpen(p); } },
      h('div', { className: 'ch' }, h('div', null, h('b', null, p.title), h('span', null, p.field || '—'))),
      p.keywords && p.keywords.length ? h('div', { className: 'tags' }, p.keywords.slice(0, 4).map(function (k, i) { return h('span', { className: 'tag', key: i }, k); })) : null,
      h('div', { className: 'meter' }, h('i', { style: { width: Math.round((p.stage / (STAGES.length - 1)) * 100) + '%' } })),
      h('div', { className: 'kv' }, h('span', null, 'Stage: ' + STAGES[p.stage || 0]), h('span', { className: 'chip ' + (p.status === 'active' ? 'c-ok' : 'c-grey') }, STATUS_LABEL[p.status] || p.status))
    );
  }

  // ---------- App ----------
  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var pjS = useState([]), projects = pjS[0], setProjects = pjS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var dS = useState({ log: [], tasks: [] }), detail = dS[0], setDetail = dS[1];

    useEffect(function () { boot(); }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      var target = adminTargetUser();
      var pid = target ? target.id : BE.user.id;
      sb.from('profiles').select('role,name').eq('id', pid).maybeSingle().then(function (r) {
        var p = (r && r.data) || {};
        setMe({ id: pid, name: p.name || (target && target.name) || BE.user.name, role: p.role, _preview: !!target });
        loadProjects(pid, !!target, function () { setPhase('ready'); });
      }, function () { setMe({ id: pid, name: (target && target.name) || BE.user.name, _preview: !!target }); setPhase('ready'); });
    }
    function loadProjects(pid, preview, done) {
      sb.from('research_projects').select('id,owner_id,student_id,title,field,keywords,stage,status,goal,updated_at').order('updated_at', { ascending: false }).then(function (r) {
        var list = (r && r.data) || [];
        if (preview) list = list.filter(function (x) { return x.owner_id === pid; });
        setProjects(list);
        setSel(function (cur) { return cur ? (list.filter(function (x) { return x.id === cur.id; })[0] || null) : null; });
        if (done) done();
      });
    }
    function reloadProjects() { loadProjects(me.id, !!me._preview); }
    function loadDetail(projectId) {
      Promise.all([
        sb.from('research_log').select('id,type,summary,ts,profile_id,profiles(name)').eq('project_id', projectId).order('ts', { ascending: false }),
        sb.from('research_tasks').select('id,title,status,stage,due').eq('project_id', projectId).order('sort', { ascending: true })
      ]).then(function (res) {
        setDetail({ log: (res[0] && res[0].data) || [], tasks: (res[1] && res[1].data) || [] });
      });
    }
    function openProject(p) { setSel(p); loadDetail(p.id); }
    function refreshAll() { reloadProjects(); if (sel) loadDetail(sel.id); }

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Research'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Research'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return null;
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in to Research'), h('p', null, 'The research workspace needs your account.'), h('button', { className: 'btn pri', onClick: function () { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); } }, 'Sign in')));

    var preview = !!me._preview;
    var isAdmin = me.role === 'admin';
    var authorId = (BE.user && BE.user.id) || me.id;   // RLS ties a log author to the real session user
    function canEdit(p) { return !!(p && (isAdmin || p.owner_id === me.id)); }

    return h(AppShell, {
      me: me, preview: preview, projects: projects, sel: sel,
      openProject: openProject, onBack: function () { setSel(null); },
      detail: detail, canEdit: canEdit, authorId: authorId, refreshAll: refreshAll, reloadProjects: reloadProjects
    });
  }

  // shell split out so "new project" modal state is local & simple
  function AppShell(props) {
    var a = useState(false), adding = a[0], setAdding = a[1];
    var me = props.me, sel = props.sel;
    var roleLabel = me.role === 'admin' ? 'Administrator' : 'Researcher';
    var sub = sel ? STAGES[sel.stage || 0] + ' stage' : (props.projects.length + ' project' + (props.projects.length === 1 ? '' : 's'));

    var body;
    if (sel) {
      body = h(ProjectDetail, { project: sel, log: props.detail.log, tasks: props.detail.tasks, canEdit: props.canEdit(sel), authorId: props.authorId, onBack: props.onBack, onChanged: props.refreshAll });
    } else if (!props.projects.length) {
      body = h('div', { className: 'soon' }, h('b', null, 'No research projects yet. '), 'Create one to start tracking a study from idea to submission.', h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project')));
    } else {
      body = h('div', { className: 'grid' }, props.projects.map(function (p) { return h(ProjectCard, { key: p.id, project: p, onOpen: props.openProject }); }));
    }

    return h('div', { className: 'app' },
      h('div', { className: 'side' },
        h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Research'))),
        h('nav', { className: 'nav' },
          h('button', { className: 'on', onClick: props.onBack }, ICp, h('span', null, 'Projects'))
        ),
        h('div', { className: 'side-foot' }, h(Avatar, { u: me, size: 32 }), h('div', { className: 'who' }, h('b', null, me.name), h('span', null, roleLabel)), h('a', { className: 'exit', href: 'Projects.html', title: 'Back to Publify' }, '←'))
      ),
      h('div', { className: 'main' },
        props.preview ? h('div', { className: 'preview-banner' }, '👁 Admin preview — viewing ', h('b', null, me.name), '’s Research. ', h('a', { href: 'PhD.html?adminView=1' }, 'Doctoral School'), ' · ', h('a', { href: 'Profile.html?adminView=1' }, 'Profile'), ' · ', h('a', { href: 'Admin.html' }, '← Back to admin')) : null,
        h('div', { className: 'head' },
          h('div', null, h('h1', null, sel ? 'Project' : 'Research projects'), h('div', { className: 'sub' }, sub)),
          sel ? null : h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project')
        ),
        body,
        adding ? h(NewProjectModal, { ownerId: me.id, onClose: function () { setAdding(false); }, onSaved: function (created) { setAdding(false); props.reloadProjects(); if (created) props.openProject(created); } }) : null
      )
    );
  }

  var ICp = h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3H7l1.5 1.5h4A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z' }));

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
