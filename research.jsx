/* Publify — Research Management (R0 Foundation).
 * Research projects + stage pipeline + research log + tasks, on Supabase (RLS-scoped to owner,
 * the linked PhD student's supervisor(s), and admin). Mirrors phd.jsx patterns incl. admin View-as. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, PUBS = window.PRPubs;
  var sb = BE && BE.sb;

  // Data / Compute / Analysis are temporarily removed; Journal (publication-venue recommender) added before Submission.
  var STAGES = ['Setup', 'Idea', 'Literature', 'Protocol', 'Journal', 'Writing', 'Submission'];
  // clicking a workflow step opens the matching panel (the old redundant tab row is gone)
  var STAGE_TAB = ['overview', 'ideas', 'literature', 'protocol', 'journal', 'writing', 'submission'];
  function nd() { return !!(window.PRDesign && window.PRDesign.isNew()); }   // "New design" flag → Academic Data-Dense redesign (behind the toggle; reads at render time, flip triggers a reload)
  function svg() { var args = Array.prototype.slice.call(arguments); return h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }, args.map(function (d, i) { return h('path', { key: i, d: d }); })); }
  var STAGE_ICONS = [
    svg('M4 14V2.5', 'M4 3h7l-1.4 2.3L11 7.6H4'),                                         // Setup — flag
    svg('M5.6 9.6A3.5 3.5 0 1 1 10.4 9.6c-.5.5-.8 1-.8 1.6H6.4c0-.6-.3-1.1-.8-1.6Z', 'M6.6 13.2h2.8'), // Idea — bulb
    svg('M8 3.6C6.4 2.7 4.8 2.7 3.2 3.4v8.4c1.6-.7 3.2-.7 4.8.2 1.6-.9 3.2-.9 4.8-.2V3.4C11.2 2.7 9.6 2.7 8 3.6Z', 'M8 3.6v8.6'), // Literature — book
    svg('M5.9 8.2 7.2 9.5 10 6.6', 'M4.5 3.5h7v9.5h-7z', 'M6.2 3.5V2.4h3.6v1.1'),          // Protocol — clipboard check
    svg('M2 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0', 'M5 8a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M7.6 8a.4.4 0 1 0 .8 0a.4.4 0 1 0 -.8 0'), // Journal — target (where to publish)
    svg('M10.8 2.6 13.4 5.2 5.6 13l-3 .6.6-3z', 'M9.8 3.6 12.4 6.2'),                       // Writing — pencil
    svg('M8 10.5V3M5.2 5.8 8 3l2.8 2.8', 'M3.5 13h9')                                       // Submission — upload
  ];
  var LOG_TYPES = ['NOTE', 'DECISION', 'RESULT', 'ARTIFACT', 'MILESTONE', 'TASK'];
  var STATUS_LABEL = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };

  // ---- Task board (Kanban) — shared by the per-protocol board AND the cross-project global board.
  // A step's column is derived from (assignee, status); moving a card writes back the encoded patch. ----
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
  function assigneeOf(s) { return s.assignee === 'human' ? 'human' : 'ai'; }   // legacy steps default to AI
  function stepCol(s) {
    var a = assigneeOf(s), st = s.status;
    if (st === 'done') return a === 'human' ? 'done-human' : 'done-ai';
    if (st === 'running') return a === 'human' ? 'prog-human' : 'prog-ai';
    if (st === 'blocked' || st === 'failed' || (s.needs_approval && (st === 'todo' || st === 'queued'))) return 'blocked';
    return a === 'human' ? 'todo-human' : 'todo-ai';
  }
  // personal ToDo tasks (research_todos, migration-46) render on the same board. Their status vocab is
  // todo|doing|blocked|done, so they need their own column map (mirrors kanban.jsx).
  function todoStepCol(t) {
    var a = t.assignee === 'human' ? 'human' : 'ai', s = t.status;
    if (s === 'done') return a === 'human' ? 'done-human' : 'done-ai';
    if (s === 'doing') return a === 'human' ? 'prog-human' : 'prog-ai';
    if (s === 'blocked') return 'blocked';
    return a === 'human' ? 'todo-human' : 'todo-ai';
  }
  function todoColPatch(key) {
    return key === 'todo-human' ? { assignee: 'human', status: 'todo' }
      : key === 'todo-ai' ? { assignee: 'ai', status: 'todo' }
        : key === 'prog-ai' ? { assignee: 'ai', status: 'doing' }
          : key === 'prog-human' ? { assignee: 'human', status: 'doing' }
            : key === 'blocked' ? { status: 'blocked' }
              : key === 'done-ai' ? { assignee: 'ai', status: 'done' }
                : key === 'done-human' ? { assignee: 'human', status: 'done' } : null;
  }
  var PRIO_META = { low: { l: 'Low', c: '#0e9f6e' }, med: { l: 'Med', c: '#d9760b' }, high: { l: 'High', c: '#dc2626' } };

  // ---- Add/edit a personal ToDo (research_todos) — used by the board "Add task" button ----
  function TodoModal(props) {
    var init = props.todo || {};
    var fS = useState({ title: init.title || '', notes: init.notes || '', assignee: init.assignee || 'human', status: init.status || 'todo', priority: init.priority || '', due: init.due || '' }), f = fS[0], setF = fS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    function up(k, v) { setF(Object.assign({}, f, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!f.title.trim()) return; setBusy(true);
      var row = { title: f.title.trim(), notes: f.notes.trim() || null, assignee: f.assignee, status: f.status, priority: f.priority || null, due: f.due || null, updated_at: new Date().toISOString() };
      var p;
      if (props.todo) p = sb.from('research_todos').update(row).eq('id', props.todo.id);
      else { row.owner_id = props.ownerId; row.created_by = props.ownerId; row.project_id = props.projectId; p = sb.from('research_todos').insert(row); }
      p.then(function (r) { setBusy(false); if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } props.onSaved(); });
    }
    function del() { if (!props.todo) return; window.PRUI.confirm({ title: 'Delete this task?', body: props.todo.title, danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (!ok) return; sb.from('research_todos').delete().eq('id', props.todo.id).then(function () { props.onSaved(); }); }); }
    useEffect(function () { function esc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', esc); return function () { window.removeEventListener('keydown', esc); }; });
    var seg = function (k, opts) { return h('div', { className: 'tm-seg' }, opts.map(function (o) { return h('button', { key: o[0], type: 'button', className: f[k] === o[0] ? 'on' : '', onClick: function () { up(k, o[0]); } }, o[1]); })); };
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, props.todo ? 'Edit task' : 'Add task'), h('button', { className: 'x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { autoFocus: true, value: f.title, onChange: function (e) { up('title', e.target.value); }, placeholder: 'What needs doing?' })),
          h('div', { className: 'field' }, h('label', null, 'Notes'), h('textarea', { rows: 2, value: f.notes, onChange: function (e) { up('notes', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Owner'), seg('assignee', [['human', '👤 Human'], ['ai', '🤖 AI']])),
          h('div', { className: 'field' }, h('label', null, 'Status'), seg('status', [['todo', 'ToDo'], ['doing', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']])),
          h('div', { className: 'field' }, h('label', null, 'Priority'), seg('priority', [['', 'None'], ['low', 'Low'], ['med', 'Med'], ['high', 'High']])),
          h('div', { className: 'field' }, h('label', null, 'Due date'), h('input', { type: 'date', value: f.due || '', onChange: function (e) { up('due', e.target.value); } }))
        ),
        h('div', { className: 'modal-foot' },
          props.todo ? h('button', { className: 'btn', style: { color: 'var(--danger)' }, onClick: del }, 'Delete') : h('span'),
          h('div', { style: { display: 'flex', gap: 8 } }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: busy || !f.title.trim(), onClick: save }, busy ? 'Saving…' : (props.todo ? 'Save' : 'Add task'))))
      )
    );
  }

  // the (assignee, status, needs_approval) patch a column encodes. Writing `assignee` needs migration-44.
  function colPatch(key) {
    return key === 'todo-human' ? { assignee: 'human', status: 'todo', needs_approval: false }
      : key === 'todo-ai' ? { assignee: 'ai', status: 'queued', needs_approval: false }
        : key === 'prog-ai' ? { assignee: 'ai', status: 'running' }
          : key === 'prog-human' ? { assignee: 'human', status: 'running' }
            : key === 'blocked' ? { status: 'blocked' }
              : key === 'done-ai' ? { assignee: 'ai', status: 'done' }
                : key === 'done-human' ? { assignee: 'human', status: 'done' } : null;
  }

  function adminTargetUser() {
    try {
      if (!/[?&]adminView=1/.test(location.search)) return null;
      var u = BE && BE.user; if (!u) return null;
      if (!(u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))) return null; // admin-only
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
      // Stamp student_id when the creator is a PhD student, so the project is visible to (and digestible
      // for) their supervisor. Without this the project stays owner-only and never reaches the supervisor.
      sb.from('phd_students').select('id').eq('profile_id', props.ownerId).maybeSingle().then(function (sr) {
        var sid = sr && sr.data && sr.data.id;
        var payload = {
          owner_id: props.ownerId, title: form.title.trim(), field: form.field.trim() || null,
          keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
          goal: form.goal.trim() || null, stage: 0, status: 'active'
        };
        if (sid) payload.student_id = sid;
        sb.from('research_projects').insert(payload).select().maybeSingle().then(function (r) {
          setSaving(false);
          if (r && r.error) { window.PRUI.toast('Could not create: ' + r.error.message, { kind: 'error' }); return; }
          props.onSaved(r && r.data);
        });
      });
    }
    // #3 — clicking outside the create-project box must not silently discard what you typed
    function dirty() { return !!(form.title.trim() || form.field.trim() || form.keywords.trim() || form.goal.trim()); }
    function tryClose() {
      if (!dirty()) { props.onClose(); return; }
      window.PRUI.confirm({ title: 'Discard the project details you entered?', confirmLabel: 'Discard', danger: true }).then(function (ok) { if (!ok) return; props.onClose(); });
    }
    useEffect(function () { function onEsc(e) { if (e.key === 'Escape') tryClose(); } window.addEventListener('keydown', onEsc); return function () { window.removeEventListener('keydown', onEsc); }; });
    return h('div', { className: 'scrim', onClick: tryClose },
      h('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New research project', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'New research project'), h('button', { className: 'x', 'aria-label': 'Close', onClick: tryClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); }, placeholder: 'e.g. Fisher fusion for LiDAR OOD detection' })),
          h('div', { className: 'field' }, h('label', null, 'Field'), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, 'Keywords (comma-separated)'), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, 'Goal / expected output'), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); }, placeholder: 'What does success look like? (paper, thesis chapter, …)' }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: tryClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Creating…' : 'Create project'))
      )
    );
  }

  // ---------- Edit project base settings (#2) ----------
  function ProjectSettingsModal(props) {
    var p = props.project;
    var f = useState({ title: p.title || '', field: p.field || '', keywords: (p.keywords || []).join(', '), goal: p.goal || '' }), form = f[0], setForm = f[1];
    var s = useState(false), saving = s[0], setSaving = s[1];
    function up(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!form.title.trim()) return;
      setSaving(true);
      sb.from('research_projects').update({
        title: form.title.trim(), field: form.field.trim() || null,
        keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
        goal: form.goal.trim() || null
      }).eq('id', p.id).then(function (r) {
        setSaving(false);
        if (r && r.error) { window.PRUI.toast('Could not save: ' + r.error.message, { kind: 'error' }); return; }
        props.onSaved();
      });
    }
    useEffect(function () { function onEsc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', onEsc); return function () { window.removeEventListener('keydown', onEsc); }; });
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Project settings', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'Project settings'), h('button', { className: 'x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Field'), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, 'Keywords (comma-separated)'), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, 'Goal / expected output'), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); } }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Saving…' : 'Save'))
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
        key: i, className: cls,
        title: name + ' — open',
        // navigation ONLY — clicking to view never advances the recorded stage (that would silently
        // progress the project + spam the supervisor digest). Setting the stage is the explicit Stage control.
        onClick: function () { if (props.onNav) props.onNav(i); }
      }, h('span', { className: 'dot', 'aria-hidden': 'true' }, STAGE_ICONS[i] || (i + 1)), name));
      // intermediate "Studies" funnel between Idea and Literature — opens the study tab (NOT a lifecycle stage,
      // so it never changes the stored project.stage / shifts indices)
      if (i === 1) {
        kids.push(h('div', { className: 'step-sep', key: 'sep-study' }));
        kids.push(h('button', {
          key: 'study', className: 'step step-study' + (props.tab === 'study' ? ' cur' : ''),
          title: 'Studies — the literature-screening funnel between an idea and your literature',
          onClick: function () { if (props.onStudy) props.onStudy(); }
        }, h('span', { className: 'dot', 'aria-hidden': 'true' }, svg('M3 4 13 4 9.2 8.8 9.2 12 6.8 13 6.8 8.8Z')), 'Studies'));
      }
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
        if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
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
          props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Delete log entry', onClick: function () { del(e); } }, '✕') : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No log entries yet.')
    );
  }

  // ---------- Tasks ----------
  function TasksPanel(props) {
    var x = useState(''), text = x[0], setText = x[1];
    // one human-task table: the Tasks subtab now reads/writes research_todos (same as the board + "My tasks")
    function add() { if (!text.trim()) return; sb.from('research_todos').insert({ owner_id: props.authorId, created_by: props.authorId, project_id: props.projectId, title: text.trim(), status: 'todo', assignee: 'human' }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } setText(''); props.onChanged(); }); }
    function setStatus(tk, st) { sb.from('research_todos').update({ status: st, updated_at: new Date().toISOString() }).eq('id', tk.id).then(props.onChanged); }
    function del(tk) { sb.from('research_todos').delete().eq('id', tk.id).then(props.onChanged); }
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
          props.canEdit ? h('div', { className: 'seg', role: 'group', 'aria-label': 'Task status' }, ['todo', 'doing', 'done'].map(function (st) {
            return h('button', { key: st, className: tk.status === st ? 'on' : '', 'aria-pressed': tk.status === st, 'aria-label': st, onClick: function () { setStatus(tk, st); } }, st);
          })) : h('span', { className: 'chip ' + (tk.status === 'done' ? 'c-ok' : (tk.status === 'doing' ? 'c-warn' : 'c-grey')) }, tk.status),
          props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Delete task', onClick: function () { del(tk); } }, '✕') : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No tasks yet.')
    );
  }

  // ---------- Attach to chat (library source / publication file / upload) ----------
  function AttachModal(props) {
    var fS = useState(null), files = fS[0], setFiles = fS[1];
    var pS = useState(null), latexProjects = pS[0], setLatexProjects = pS[1];
    var uS = useState(''), upMsg = uS[0], setUpMsg = uS[1];
    useEffect(function () {
      var owner = props.fileOwnerId || props.authorId;   // whose files to list = the VIEWED user (me.id), not the real session user — matters in admin-preview
      sb.from('publication_files').select('id,name,mime,size,storage_path').eq('owner_id', owner).order('created_at', { ascending: false }).then(function (r) { setFiles((r && r.data) || []); });
      sb.from('projects').select('id,title').eq('owner_id', owner).is('deleted_at', null).order('updated_at', { ascending: false }).then(function (r) { setLatexProjects((r && r.data) || []); });
    }, []);
    useEffect(function () { function onEsc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', onEsc); return function () { window.removeEventListener('keydown', onEsc); }; });
    function onUpload(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      setUpMsg('Uploading…');
      // Office files → extract text and attach THAT (so the AI reads the content, not an opaque binary)
      if (window.PROffice && window.PROffice.isOffice(f.name)) {
        setUpMsg('Processing Office file…');
        window.PROffice.extract(f).then(function (r) {
          var name = f.name.replace(/\.(docx|xlsx|xlsm|xls|pptx)$/i, '') + '.' + (r.ext || 'md');
          var path = props.projectId + '/' + Date.now() + '_' + name.replace(/[^A-Za-z0-9._-]/g, '_');
          sb.storage.from('research-data').upload(path, new Blob([r.text || ''], { type: r.ext === 'csv' ? 'text/csv' : 'text/markdown' })).then(function (res) {
            if (res.error) { setUpMsg('Upload failed: ' + res.error.message); return; }
            props.onPick({ kind: 'file', bucket: 'research-data', path: path, name: name, mime: 'text/markdown', label: name }); props.onClose();
          });
        }, function (er) { setUpMsg('Office processing error: ' + ((er && er.message) || er)); });
        return;
      }
      var path = props.projectId + '/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(path, f).then(function (res) {
        if (res.error) { setUpMsg('Upload failed: ' + res.error.message); return; }
        props.onPick({ kind: 'file', bucket: 'research-data', path: path, name: f.name, mime: f.type || '', label: f.name }); props.onClose();
      });
    }
    var srcs = props.sources || [];
    var row = function (key, title, sub, pick) { return h('div', { className: 'src', key: key }, h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: 13 } }, title), sub ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, sub) : null), h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: pick }, 'Attach')); };
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Attach to the chat', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'Attach to the chat'), h('button', { className: 'x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'sec-t' }, 'Project library'),
          srcs.length ? srcs.map(function (s) { return row('s' + s.id, s.title, [s.year, s.venue].filter(Boolean).join(' · '), function () { props.onPick({ kind: 'source', source_id: s.id, title: s.title, label: s.title }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'No library sources yet — add some on the Literature tab.'),
          h('div', { className: 'sec-t', style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('span', null, 'My publication files'),
            (files && files.length > 1) ? h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 11, marginLeft: 'auto', flex: 'none' }, onClick: function () { files.forEach(function (f) { props.onPick({ kind: 'file', bucket: 'publication-files', path: f.storage_path, name: f.name, mime: f.mime, label: f.name }); }); props.onClose(); } }, '📎 Attach all') : null),
          files === null ? h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Loading…') : (files.length ? files.map(function (f) { return row('f' + f.id, f.name, (f.mime || '') + (f.size ? ' · ' + fmtBytes(f.size) : ''), function () { props.onPick({ kind: 'file', bucket: 'publication-files', path: f.storage_path, name: f.name, mime: f.mime, label: f.name }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'No files uploaded to your profile yet.')),
          h('div', { className: 'sec-t', style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('span', null, 'My LaTeX publications'),
            (latexProjects && latexProjects.length > 1) ? h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 11, marginLeft: 'auto', flex: 'none' }, onClick: function () { latexProjects.forEach(function (p) { props.onPick({ kind: 'project', project_id: p.id, title: p.title, label: p.title || 'LaTeX' }); }); props.onClose(); } }, '📎 Attach all') : null),
          latexProjects === null ? h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Loading…') : (latexProjects.length ? latexProjects.map(function (p) { return row('p' + p.id, p.title || 'Untitled', 'LaTeX project — the full text will be attached', function () { props.onPick({ kind: 'project', project_id: p.id, title: p.title, label: p.title || 'LaTeX' }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'No LaTeX publications (Editor project) yet.')),
          h('div', { className: 'sec-t' }, 'Upload a file'),
          h('div', null, h('input', { type: 'file', onChange: onUpload }), upMsg ? h('span', { style: { marginLeft: 8, fontSize: 12 } }, upMsg) : null)
        )
      )
    );
  }

  // ---------- Chat with Publify (R5b) ----------
  function mdHtml(t) {
    var s = String(t == null ? '' : t);
    try { if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(s, { breaks: true })); } catch (e) { }
    return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/\n/g, '<br>');
  }
  // wrap each rendered code block in a collapsible <details> so the AI's code stays folded until expanded
  function foldCode(html) {
    if (!html) return html;
    return html.replace(/<pre>/g, '<details class="code-fold"><summary>⟨⟩ Code — expand / collapse</summary><pre>').replace(/<\/pre>/g, '</pre></details>');
  }
  // Document-grade markdown render: allows inline data: images (figures) — used by the full-page report reader.
  function mdReport(t) {
    var s = String(t == null ? '' : t);
    try { if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(s, { breaks: false }), { ADD_DATA_URI_TAGS: ['img'] }); } catch (e) { }
    return mdHtml(s);
  }
  // Elicit reports embed {64-hex_N} citation markers and a long per-study table. Strip the markers, collapse
  // the study table (so the report reads as prose, not a wall of every paper), and link each study name.
  function stripCiteMarks(md) { return String(md == null ? '' : md).replace(/\s*\{[0-9a-f]{40,}(?:_\d+)?\}/gi, ''); }
  function enhanceReport(md) {
    var html;
    try { html = window.DOMPurify.sanitize(window.marked.parse(stripCiteMarks(md), { breaks: false })); } catch (e) { return mdHtml(md); }
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      Array.prototype.forEach.call(doc.querySelectorAll('table'), function (tbl) {
        var firstRow = tbl.querySelector('tr');
        var firstHead = (firstRow && firstRow.children[0] && firstRow.children[0].textContent || '').trim().toLowerCase();
        var rows = tbl.querySelectorAll('tbody tr');
        if (!rows.length) rows = Array.prototype.slice.call(tbl.querySelectorAll('tr')).slice(1);
        var n = rows.length;
        if (!(firstHead.indexOf('study') === 0 || n > 8)) return;   // only the long per-study list
        Array.prototype.forEach.call(rows, function (tr) {
          var td = tr.querySelector('td');
          if (!td || td.querySelector('a')) return;
          var name = td.textContent.trim();
          if (name.length < 3) return;
          var a = doc.createElement('a');
          a.setAttribute('href', 'https://scholar.google.com/scholar?q=' + encodeURIComponent(name));
          a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
          a.textContent = name;
          while (td.firstChild) td.removeChild(td.firstChild);
          td.appendChild(a);
        });
        var det = doc.createElement('details'); det.className = 'md-tbl-collapse';
        var sum = doc.createElement('summary'); sum.textContent = n + ' included studies — click to expand';
        tbl.parentNode.insertBefore(det, tbl); det.appendChild(sum); det.appendChild(tbl);
      });
      return doc.body.innerHTML;
    } catch (e) { return html; }
  }
  // Render report markdown, inject heading ids, and collect a table of contents (jump links).
  function buildDoc(md) {
    var html = mdReport(md); var toc = []; var i = 0;
    html = html.replace(/<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/g, function (m, lvl, attrs, inner) {
      var idm = /id="([^"]+)"/.exec(attrs); var id = idm ? idm[1] : 'sec-' + (i++);
      var text = inner.replace(/<[^>]+>/g, '').trim();
      if (text) toc.push({ id: id, level: +lvl, text: text });
      return '<h' + lvl + (idm ? attrs : (attrs + ' id="' + id + '"')) + '>' + inner + '</h' + lvl + '>';
    });
    return { html: html, toc: toc };
  }
  // Full-screen, nicely-formatted markdown report reader (TOC + figures + tables inline). Reusable for any .md report.
  function ReportViewer(props) {
    var doc = buildDoc(props.md);
    var svS = useState(''), saved = svS[0], setSaved = svS[1];
    function dl() {
      var u = URL.createObjectURL(new Blob([props.md || ''], { type: 'text/markdown;charset=utf-8' }));
      var a = document.createElement('a'); a.href = u; a.download = (props.title || 'report').replace(/[^\w.-]+/g, '_') + '.md';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    }
    function jump(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    function save() {
      setSaved('saving');
      Promise.resolve(props.onSave(props.md)).then(function () { setSaved('done'); setTimeout(function () { setSaved(''); }, 2200); },
        function () { setSaved(''); });
    }
    var btnStyle = { padding: '4px 9px', fontSize: 14, lineHeight: 1, flex: 'none' };
    var bar = h('div', { className: 'rv-bar' },
      props.inline ? h('button', { className: 'btn', style: { padding: '4px 11px', fontSize: 12.5, flex: 'none' }, onClick: props.onClose }, '←') : null,
      h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.title || 'Report'),
      props.onSave ? h('button', { className: 'btn', style: btnStyle, disabled: saved === 'saving', 'aria-label': 'Save to files', title: 'Save to project files (Ideas → Files)', onClick: save }, saved === 'done' ? '✓' : (saved === 'saving' ? '…' : '💾')) : null,
      h('button', { className: 'btn', style: btnStyle, 'aria-label': 'Download markdown', title: 'Download .md', onClick: dl }, '⬇'),
      h('button', { className: 'btn', style: btnStyle, 'aria-label': 'Print or save as PDF', title: 'Print / save as PDF', onClick: function () { window.print(); } }, '🖨'),
      h('button', { className: 'icon-x', 'aria-label': 'Close', title: 'Close', onClick: props.onClose }, '✕'));
    var main = h('div', { className: 'rv-main' },
      doc.toc.length > 2 ? h('nav', { className: 'rv-toc' },
        h('div', { className: 'rv-toc-h' }, 'Contents'),
        doc.toc.map(function (t) { return h('button', { key: t.id, className: 'rv-toc-i lvl' + t.level, onClick: function () { jump(t.id); } }, t.text); })) : null,
      h('div', { className: 'rv-body' }, h('article', { className: 'report-doc', dangerouslySetInnerHTML: { __html: doc.html } })));
    if (props.inline) return h('div', { className: 'report-pane' }, bar, main);   // in-flow, slides in from the side
    return ReactDOM.createPortal(h('div', { className: 'rv-scrim', onClick: props.onClose },
      h('div', { className: 'rv-shell', onClick: function (e) { e.stopPropagation(); } }, bar, main)), document.body);
  }
  // ---------- rich file preview + downloads (images / PDF / CSV / JSON / text) ----------
  function fileKind(f) {
    var p = (f.path || '').toLowerCase(), m = (f.mime || '').toLowerCase();
    if (m.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(p)) return 'image';
    if (m === 'application/pdf' || /\.pdf$/.test(p)) return 'pdf';
    if (/\.(csv|tsv)$/.test(p) || m === 'text/csv') return 'csv';
    if (/\.json$/.test(p) || m === 'application/json') return 'json';
    if (/\.(md|markdown)$/.test(p)) return 'md';
    if (f.content != null || /\.(txt|log|tex|bib|py|js|ts|r|yaml|yml|html?|xml|gexf|sh)$/.test(p)) return 'text';
    return 'binary';
  }
  function fileIcon(f) {
    var k = fileKind(f);
    return k === 'image' ? '🖼' : k === 'pdf' ? '📕' : k === 'csv' ? '📊' : k === 'json' ? '◧' : k === 'md' ? '📄' : /\.tex$/i.test(f.path) ? '📐' : /\.bib$/i.test(f.path) ? '📚' : /\.html?$/i.test(f.path) ? '🌐' : /\.gexf$/i.test(f.path) ? '🕸' : k === 'text' ? '📄' : '📎';
  }
  function csvToRows(text) {
    var delim = (text.indexOf('\t') >= 0 && text.indexOf(',') < 0) ? '\t' : ',';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  }
  function csvTable(text) {
    var rows = csvToRows(text || '');
    if (!rows.length) return h('div', { className: 'empty', style: { padding: 24 } }, 'Empty file.');
    var head = rows[0], body = rows.slice(1, 501);
    return h('div', { style: { overflow: 'auto', maxHeight: '70vh' } },
      h('table', { className: 'csvt' },
        h('thead', null, h('tr', null, head.map(function (c, i) { return h('th', { key: i }, c); }))),
        h('tbody', null, body.map(function (r, ri) { return h('tr', { key: ri }, head.map(function (_, ci) { return h('td', { key: ci }, r[ci] != null ? r[ci] : ''); })); }))),
      rows.length > 501 ? h('div', { style: { fontSize: 11, color: 'var(--faint)', padding: '6px 2px' } }, 'Showing first 500 of ' + (rows.length - 1) + ' rows.') : null);
  }
  function downloadBlob(name, blob) {
    var u = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function baseName(p) { return String(p || 'file').split('/').pop(); }
  function downloadFile(f) {
    if (f.content != null) { downloadBlob(baseName(f.path), new Blob([f.content], { type: f.mime || 'text/plain;charset=utf-8' })); return; }
    if (f.storage_path) sb.storage.from('research-data').createSignedUrl(f.storage_path, 3600, { download: baseName(f.path) }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); });
  }
  function zipFiles(files, zipName) {
    if (!window.JSZip) { window.PRUI.toast('Preparing the download failed (library not ready) — try again.', { kind: 'error' }); return Promise.resolve(); }
    var zip = new window.JSZip();
    return Promise.all((files || []).map(function (f) {
      var name = (f.path || 'file').replace(/^\/+/, '');
      if (f.content != null) { zip.file(name, f.content); return Promise.resolve(); }
      if (f.storage_path) return sb.storage.from('research-data').download(f.storage_path).then(function (r) { if (r && r.data) zip.file(name, r.data); }, function () { });
      return Promise.resolve();
    })).then(function () { return zip.generateAsync({ type: 'blob' }); }).then(function (blob) { downloadBlob((zipName || 'deliverables') + '.zip', blob); });
  }
  function ensurePvCss() {
    if (typeof document === 'undefined' || document.getElementById('pv-css')) return;
    var s = document.createElement('style'); s.id = 'pv-css';
    s.textContent = '.pv-shell{width:980px;max-width:100%;max-height:100%;background:var(--surface);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden}'
      + '.pv-body{flex:1;min-height:0;overflow:auto;padding:16px;background:var(--softer)}'
      + '.pv-pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;color:var(--ink)}'
      + '.csvt{border-collapse:collapse;font-size:12px;width:100%;background:var(--surface)}'
      + '.csvt th,.csvt td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}'
      + '.csvt th{background:var(--surface-2);position:sticky;top:0;font-weight:700}';
    document.head.appendChild(s);
  }
  // Modal that renders a file by type: image inline, PDF embedded, CSV as a table, JSON/text as code, MD rendered.
  function FilePreviewModal(props) {
    var f = props.file;
    var uS = useState(null), url = uS[0], setUrl = uS[1];
    var kind = fileKind(f);
    useEffect(function () {
      ensurePvCss();
      if ((kind === 'image' || kind === 'pdf' || kind === 'binary') && f.storage_path && f.content == null) {
        var alive = true;
        sb.storage.from('research-data').createSignedUrl(f.storage_path, 3600).then(function (r) { if (alive && r && r.data) setUrl(r.data.signedUrl); });
        return function () { alive = false; };
      }
    }, [f.id]);
    var body;
    if (kind === 'image') body = url ? h('img', { src: url, alt: f.path, style: { maxWidth: '100%', maxHeight: '74vh', display: 'block', margin: '0 auto', borderRadius: 6 } }) : h('div', { className: 'empty', style: { padding: 30 } }, 'Loading image…');
    else if (kind === 'pdf') body = url ? h('iframe', { src: url, title: f.path, style: { width: '100%', height: '74vh', border: 0, borderRadius: 6, background: '#fff' } }) : h('div', { className: 'empty', style: { padding: 30 } }, 'Loading PDF…');
    else if (kind === 'csv') body = csvTable(f.content || '');
    else if (kind === 'json') { var pj; try { pj = JSON.stringify(JSON.parse(f.content || ''), null, 2); } catch (e) { pj = f.content || ''; } body = h('pre', { className: 'pv-pre' }, pj); }
    else if (kind === 'md') body = h('article', { className: 'report-doc', style: { padding: 4 }, dangerouslySetInnerHTML: { __html: mdReport(f.content || '') } });
    else if (kind === 'text') body = h('pre', { className: 'pv-pre' }, f.content || '');
    else body = h('div', { className: 'empty', style: { padding: 30 } }, 'No inline preview for this file type — use ⬇ to download.');
    return ReactDOM.createPortal(h('div', { className: 'rv-scrim', onClick: props.onClose },
      h('div', { className: 'pv-shell', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'rv-bar' },
          h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fileIcon(f) + ' ' + f.path),
          h('button', { className: 'btn', style: { padding: '4px 9px', fontSize: 13, flex: 'none' }, title: 'Download (native format)', onClick: function () { downloadFile(f); } }, '⬇'),
          h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: props.onClose }, '✕')),
        h('div', { className: 'pv-body' }, body))), document.body);
  }
  // Shared "file intake" modal: after a file is uploaded (Idea or Protocol task), the AI summarizes it and
  // asks 1-2 clarifying questions about what to do with it. onComplete({summary, qa:[{question,answer}]}).
  function FileIntake(props) {
    var stS = useState('loading'), st = stS[0], setSt = stS[1];
    var smS = useState(''), summary = smS[0], setSummary = smS[1];
    var qsS = useState([]), qs = qsS[0], setQs = qsS[1];
    var erS = useState(''), er = erS[0], setEr = erS[1];
    useEffect(function () {
      var alive = true;
      callStudy({ action: 'file_intake', filename: (props.file && props.file.path) || 'file', content: (props.file && props.file.content) || '', context: props.context || '', intent: props.intent || '' }).then(function (d) {
        if (!alive) return;
        if (!d || d.error) { setEr((d && d.error) || 'Could not analyze the file.'); setSt('error'); return; }
        setSummary(d.summary || ''); setQs(((d && d.questions) || []).map(function (q) { return { q: q, a: '' }; })); setSt('ask');
      }, function () { if (alive) { setEr('Analysis failed.'); setSt('error'); } });
      return function () { alive = false; };
    }, []);
    function setA(i, v) { setQs(function (l) { return l.map(function (x, k) { return k === i ? Object.assign({}, x, { a: v }) : x; }); }); }
    function finish(skip) {
      var qa = skip ? [] : qs.filter(function (x) { return (x.a || '').trim(); }).map(function (x) { return { question: x.q, answer: x.a.trim() }; });
      props.onComplete({ summary: summary, qa: qa });
    }
    return ReactDOM.createPortal(h('div', { className: 'scrim', onClick: function () { props.onClose(); } },
      h('div', { className: 'modal', style: { width: 560, maxWidth: '100%' }, onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('h3', { style: { margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '📎 About “' + ((props.file && props.file.path) || 'file') + '”'), h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: props.onClose }, '✕')),
        h('div', { style: { padding: 18 } },
          st === 'loading' ? h(AiThinking, { label: 'Reading the file & preparing a couple of questions', mini: true }) :
            st === 'error' ? h('div', { style: { fontSize: 13, color: 'var(--danger)' } }, er) :
              h('div', null,
                summary ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 } }, summary) : null,
                qs.length ? h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 6 } }, 'A couple of clarifying questions:') : h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 6 } }, 'No clarifying questions — you can continue.'),
                qs.map(function (x, i) {
                  return h('div', { key: i, style: { marginBottom: 10 } },
                    h('div', { style: { fontSize: 12.5, marginBottom: 3 } }, (i + 1) + '. ' + x.q),
                    h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box' }, value: x.a, placeholder: 'Your answer (optional)…', onChange: function (e) { setA(i, e.target.value); } }));
                }),
                h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 } },
                  h('button', { className: 'btn', onClick: function () { finish(true); } }, 'Skip'),
                  h('button', { className: 'btn pri', onClick: function () { finish(false); } }, 'Save answers')))
        ))), document.body);
  }
  // Reusable "the AI is working" indicator: pulsing orb + animated label + indeterminate bar + honest elapsed timer.
  function AiThinking(props) {
    var t = useState(0), sec = t[0], setSec = t[1];
    useEffect(function () {
      var t0 = Date.now(); var iv = setInterval(function () { setSec(Math.max(0, Math.round((Date.now() - t0) / 1000))); }, 250);
      return function () { clearInterval(iv); };
    }, []);
    return h('div', { className: 'ai-think', role: 'status', 'aria-live': 'polite', style: props.mini ? { padding: '7px 10px' } : null },
      h('span', { className: 'ai-orb', 'aria-hidden': 'true' }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { className: 'ai-think-lbl' }, (props.label || 'The AI is thinking'), h('span', { className: 'ai-dots', 'aria-hidden': 'true' })),
        props.mini ? null : h('div', { className: 'ai-ind' }, h('i'))),
      h('span', { className: 'ai-think-sec' }, sec + 's'));
  }
  var CHAT_SUGGEST = ['What are the open problems in this field?', 'Summarize the key methods used so far.', 'Suggest 3 testable research questions for my goal.', 'What evidence would support or refute my hypothesis?'];
  // In a chat reply, the AI saves files via fenced ```file:<path> … ``` blocks. For DISPLAY we collapse
  // those to a compact chip (the full content lives in the file browser, not inline in the chat).
  function stripFiles(text) {
    if (!text) return text;
    return text.replace(/```file:([^\n`]+)\n[\s\S]*?```/g, function (_, p) { return '\n📄 **' + p.trim() + '** _(saved to files)_\n'; });
  }
  function extractFiles(text) {
    var out = [], re = /```file:([^\n`]+)\n([\s\S]*?)```/g, m;
    while ((m = re.exec(text || ''))) { out.push({ path: m[1].trim(), content: m[2].replace(/\n+$/, '') }); }
    return out;
  }

  // #5 — lazy-load mammoth (Word .docx → markdown) only when a user actually imports a Word file
  var _mammothP = null;
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (!_mammothP) _mammothP = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
      s.onload = function () { resolve(window.mammoth); }; s.onerror = reject; document.head.appendChild(s);
    });
    return _mammothP;
  }

  // ---------- Session file browser (Antigravity-style): the project's file tree next to the chat ----------
  function SessionFileBrowser(props) {
    var fS = useState(null), files = fS[0], setFiles = fS[1];
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];
    var rvS = useState(null), rvDoc = rvS[0], setRvDoc = rvS[1];   // open a .md file in the full-page report reader
    var adS = useState(false), added = adS[0], setAdded = adS[1];   // #8: brief "added to ideas" feedback
    var spS = useState(null), selPop = spS[0], setSelPop = spS[1];   // #1: text selection in the MD preview → "add to idea" popup
    var upRef = useRef(null);
    var opS = useState({}), openF = opS[0], setOpenF = opS[1];       // VS-Code-Light (nd()): expanded folders {folderKey: bool}
    var edS2 = useState(null), edit = edS2[0], setEdit = edS2[1];    // inline text/MD editor { id, path, text }
    var dragF = useRef(null);                                        // the file currently being dragged onto a folder
    var skS = useState(null), intake = skS[0], setIntake = skS[1];   // file-intake clarifying questions after an upload
    function intakeDone(result) {
      var it = intake; setIntake(null);
      if (!it || !result || !result.qa || !result.qa.length || !props.onAddIdea) return;
      var note = '📎 File “' + it.path + '”' + (result.summary ? ' — ' + result.summary : '') + '\n' + result.qa.map(function (x) { return '• ' + x.question + '\n  → ' + x.answer; }).join('\n');
      props.onAddIdea(note);
      window.PRUI.toast('Saved your file notes as an idea.', { kind: 'ok' });
    }
    function onPreviewMouseUp() {
      if (!(props.canEdit && props.onAddIdea)) return;
      setTimeout(function () {
        var s = window.getSelection ? window.getSelection() : null;
        var txt = s ? String(s).trim() : '';
        if (txt && txt.length > 3) { try { var r = s.getRangeAt(0).getBoundingClientRect(); setSelPop({ text: txt, x: r.left + r.width / 2, y: r.top }); } catch (e) { setSelPop(null); } }
        else setSelPop(null);
      }, 1);
    }
    function load() { sb.from('research_files').select('id,path,content,storage_path,mime,size,source,updated_at').eq('project_id', props.projectId).order('updated_at', { ascending: false }).then(function (r) { var data = (r && r.data) || []; setFiles(data); setPreview(function (p) { return p ? (data.filter(function (x) { return x.id === p.id; })[0] || null) : null; }); }); }
    useEffect(load, [props.projectId, props.version]);
    function newFile() {
      var name = (window.prompt('New file name:', 'note.md') || '').trim(); if (!name) return;
      sb.from('research_files').upsert({ project_id: props.projectId, path: name, content: '', storage_path: null, mime: 'text/markdown', source: 'manual', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } load(); });
    }
    function onUpload(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      if (upRef.current) upRef.current.value = '';
      if (window.PROffice && window.PROffice.isOffice(f.name)) { importOffice(f); return; }   // Word/Excel/PowerPoint → editable text/markdown
      var taken = (files || []).map(function (x) { return x.path; }), path = f.name;
      if (taken.indexOf(path) >= 0) { var d = path.lastIndexOf('.'), stem = d > 0 ? path.slice(0, d) : path, ext = d > 0 ? path.slice(d) : '', i = 2; while (taken.indexOf(stem + ' (' + i + ')' + ext) >= 0) i++; path = stem + ' (' + i + ')' + ext; }
      var sp = props.projectId + '/files/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(sp, f).then(function (res) {
        if (res && res.error) { window.PRUI.toast(res.error.message, { kind: 'error' }); return; }
        sb.from('research_files').upsert({ project_id: props.projectId, path: path, storage_path: sp, content: null, mime: f.type || 'application/octet-stream', size: f.size, source: 'upload', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (rr) { if (rr && rr.error) { try { sb.storage.from('research-data').remove([sp]); } catch (e) { } window.PRUI.toast(rr.error.message, { kind: 'error' }); return; } load(); if (props.onAddIdea) setIntake({ path: path, content: '' }); });
      });
    }
    // Office (Word/Excel/PowerPoint) → editable markdown/CSV stored as a text file (shared PROffice util)
    function importOffice(f) {
      window.PROffice.extract(f).then(function (r) {
        var name = f.name.replace(/\.(docx|xlsx|xlsm|xls|pptx)$/i, '') + '.' + (r.ext || 'md');
        sb.from('research_files').upsert({ project_id: props.projectId, path: name, content: r.text || '', storage_path: null, mime: r.ext === 'csv' ? 'text/csv' : 'text/markdown', size: (r.text || '').length, source: 'upload', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (rr) { if (rr && rr.error) { window.PRUI.toast(rr.error.message, { kind: 'error' }); return; } load(); if (props.onAddIdea) setIntake({ path: name, content: r.text || '' }); });
      }, function (er) { window.PRUI.toast('Office processing error: ' + ((er && er.message) || er), { kind: 'error' }); });
    }
    function del(f) {
      window.PRUI.confirm({ title: 'Delete “' + f.path + '”?', body: 'This file will be permanently removed.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        sb.from('research_files').delete().eq('id', f.id).then(function () { if (f.storage_path) { try { sb.storage.from('research-data').remove([f.storage_path]); } catch (e) { } } if (preview && preview.id === f.id) setPreview(null); load(); });
      });
    }
    function openSigned(path) { sb.storage.from('research-data').createSignedUrl(path, 3600).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function dlBlob(name, url) { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    function download(f) {   // #1: download a file (inline content as a blob; binary via a forced-download signed URL)
      if (f.content != null) { var u = URL.createObjectURL(new Blob([f.content], { type: 'text/plain;charset=utf-8' })); dlBlob(f.path, u); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
      else if (f.storage_path) { sb.storage.from('research-data').createSignedUrl(f.storage_path, 3600, { download: f.path }).then(function (r) { if (r && r.data && r.data.signedUrl) dlBlob(f.path, r.data.signedUrl); }); }
    }
    function attach(f) { props.onAttach({ kind: f.content != null ? 'projectfile' : 'file', file_id: f.id, bucket: 'research-data', path: f.storage_path, name: f.path, title: f.path, label: f.path }); }
    function icon(f) { var p = (f.path || '').toLowerCase(); if (/\.md$|\.txt$/.test(p)) return '📄'; if (/\.(png|jpe?g|gif|webp|svg)$/.test(p)) return '🖼'; if (/\.pdf$/.test(p)) return '📕'; if (/\.(csv|tsv|xlsx?)$/.test(p)) return '📊'; return '📎'; }
    // ===== VS-Code-Light explorer (New design): folder tree + drag-move + rename + type-aware viewer/editor =====
    function baseName(p) { var i = String(p).lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
    function toggleF(k, cur) { setOpenF(function (o) { var n = Object.assign({}, o); n[k] = !cur; return n; }); }
    function buildTree(fs) {
      var root = { folders: {}, files: [] };
      (fs || []).forEach(function (f) { var parts = String(f.path || '').split('/'); var node = root; for (var i = 0; i < parts.length - 1; i++) { var key = parts.slice(0, i + 1).join('/'); node.folders[key] = node.folders[key] || { name: parts[i], key: key, folders: {}, files: [] }; node = node.folders[key]; } node.files.push(f); });
      return root;
    }
    function moveTo(f, folderKey) {
      var np = (folderKey ? folderKey + '/' : '') + baseName(f.path); if (np === f.path) return;
      sb.from('research_files').update({ path: np, updated_at: new Date().toISOString() }).eq('id', f.id).then(function (r) {
        if (r && r.error) { window.PRUI.toast(/duplicate|unique/i.test(r.error.message) ? 'Már van ilyen nevű fájl a mappában.' : r.error.message, { kind: 'error' }); return; }
        if (folderKey) setOpenF(function (o) { var n = Object.assign({}, o); n[folderKey] = true; return n; }); load();
      });
    }
    function renameFile(f) {
      var np = (window.prompt('Útvonal (mappa/fájlnév — új mappához írj „mappa/" prefixet):', f.path) || '').trim(); if (!np || np === f.path) return;
      sb.from('research_files').update({ path: np, updated_at: new Date().toISOString() }).eq('id', f.id).then(function (r) { if (r && r.error) { window.PRUI.toast(/duplicate|unique/i.test(r.error.message) ? 'Már foglalt útvonal.' : r.error.message, { kind: 'error' }); return; } load(); });
    }
    function saveEdit() {
      if (!edit) return; var e = edit;
      sb.from('research_files').update({ content: e.text, size: (e.text || '').length, updated_at: new Date().toISOString() }).eq('id', e.id).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } setEdit(null); load(); window.PRUI.toast('✓ Mentve', { kind: 'ok' }); });
    }
    function fkind(f) { var p = (f.path || '').toLowerCase(); if (f.content != null) { if (/\.(md|markdown|txt)$/.test(p)) return 'md'; if (/\.csv$/.test(p)) return 'csv'; return 'code'; } return /\.(png|jpe?g|gif|webp|svg|pdf)$/.test(p) ? 'bin' : 'bin'; }
    function fileRow(f, depth) {
      return h('div', { key: 'f' + f.id, className: 'fbx-row fbx-file' + (preview && preview.id === f.id ? ' sel' : ''), style: { paddingLeft: (6 + depth * 13 + 13) + 'px' }, draggable: props.canEdit,
        onDragStart: function () { dragF.current = f; }, onDragEnd: function () { dragF.current = null; }, onClick: function () { setPreview(f); setEdit(null); } },
        h('span', { className: 'fbx-ic' }, icon(f)), h('span', { className: 'fbx-nm', title: f.path }, baseName(f.path)), f.source === 'ai' ? h('span', { className: 'fbx-badge' }, 'AI') : null,
        h('span', { className: 'fbx-acts' },
          props.canEdit ? h('button', { className: 'fb-mini', title: 'Átnevezés / áthelyezés', onClick: function (e) { e.stopPropagation(); renameFile(f); } }, '✎') : null,
          props.canEdit ? h('button', { className: 'fb-mini', title: 'Csatolás a chathez', onClick: function (e) { e.stopPropagation(); attach(f); } }, '📎') : null,
          h('button', { className: 'fb-mini', title: 'Letöltés', onClick: function (e) { e.stopPropagation(); download(f); } }, '⬇'),
          props.canEdit ? h('button', { className: 'fb-mini', title: 'Törlés', onClick: function (e) { e.stopPropagation(); del(f); } }, '×') : null));
    }
    function treeNodes(node, depth) {
      var out = [];
      Object.keys(node.folders).sort().forEach(function (k) {
        var fo = node.folders[k], isOpen = (k in openF) ? openF[k] : (depth === 0);
        out.push(h('div', { key: 'd' + k, className: 'fbx-row fbx-folder' + (isOpen ? ' open' : ''), style: { paddingLeft: (6 + depth * 13) + 'px' },
          onClick: function () { toggleF(k, isOpen); },
          onDragOver: function (e) { if (dragF.current) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
          onDragLeave: function (e) { e.currentTarget.classList.remove('drop'); },
          onDrop: function (e) { e.currentTarget.classList.remove('drop'); if (dragF.current) { e.preventDefault(); moveTo(dragF.current, k); dragF.current = null; } } },
          h('span', { className: 'fbx-chev' }, '▶'), h('span', { className: 'fbx-ic' }, isOpen ? '📂' : '📁'), h('span', { className: 'fbx-nm' }, fo.name)));
        if (isOpen) out = out.concat(treeNodes(fo, depth + 1));   // recursion renders this folder's subfolders AND its own files
      });
      node.files.forEach(function (f) { out.push(fileRow(f, depth)); });   // BUGFIX: render THIS node's files (incl. root files with no '/')
      return out;
    }
    function csvTable(src) {
      var rows = String(src).trim().split('\n').map(function (r) { return r.split(','); });
      return h('div', { className: 'fbx-csvwrap' }, h('table', { className: 'fbx-tbl mono' },
        h('thead', null, h('tr', null, (rows[0] || []).map(function (c, i) { return h('th', { key: i }, c); }))),
        h('tbody', null, rows.slice(1).map(function (r, i) { return h('tr', { key: i }, r.map(function (c, j) { return h('td', { key: j }, c); })); }))));
    }
    function viewerEl() {
      if (!preview) return h('div', { className: 'fbx-noview' }, 'Válassz egy fájlt a fából a megnyitáshoz.');
      var f = preview, k = fkind(f);
      var body;
      if (edit) body = h('textarea', { className: 'fbx-edit mono', value: edit.text, spellCheck: false, onChange: function (e) { var v = e.target.value; setEdit(function (o) { return Object.assign({}, o, { text: v }); }); } });
      else if (k === 'md') body = h('div', { className: 'btxt md fbx-md', onMouseUp: onPreviewMouseUp, onScroll: function () { if (selPop) setSelPop(null); }, dangerouslySetInnerHTML: { __html: mdReport(f.content || '') } });
      else if (k === 'csv') body = csvTable(f.content || '');
      else if (k === 'code') body = h('pre', { className: 'fbx-code mono' }, f.content || '');
      else body = h('div', { className: 'fbx-bin' }, h('div', { style: { fontSize: 40 } }, /\.pdf$/i.test(f.path) ? '📕' : /\.(png|jpe?g|gif|webp|svg)$/i.test(f.path) ? '🖼' : '📎'), h('button', { className: 'btn', style: { fontSize: 12, marginTop: 10 }, onClick: function () { openSigned(f.storage_path); } }, 'Megnyitás / letöltés →'));
      return h('div', { className: 'fbx-viewer' },
        h('div', { className: 'fbx-vh' }, h('span', { className: 'fbx-ic' }, icon(f)), h('span', { className: 'fbx-vt', title: f.path }, f.path),
          (props.canEdit && f.content != null && !edit) ? h('button', { className: 'fb-mini', title: 'Szerkesztés', onClick: function () { setEdit({ id: f.id, path: f.path, text: f.content || '' }); } }, '✎') : null,
          edit ? h('button', { className: 'fb-mini', title: 'Mentés', style: { color: 'var(--accent)' }, onClick: saveEdit } , '💾') : null,
          edit ? h('button', { className: 'fb-mini', title: 'Mégse', onClick: function () { setEdit(null); } }, '↩') : null,
          h('button', { className: 'fb-mini', title: 'Bezárás', onClick: function () { setPreview(null); setEdit(null); } }, '×')),
        h('div', { className: 'fbx-vbody' }, body));
    }
    if (nd()) return h('div', { className: 'filebrowser fbx', style: { width: (props.width || 300) } },
      h('div', { className: 'fb-head' }, h('b', null, '🗂 Files'), h('span', { style: { flex: 1 } }),
        props.canEdit ? h('button', { className: 'fb-mini', title: 'Új fájl (mappához: „mappa/név.md")', onClick: newFile }, '✚') : null,
        props.canEdit ? h('button', { className: 'fb-mini', title: 'Feltöltés', onClick: function () { if (upRef.current) upRef.current.click(); } }, '⤒') : null,
        h('input', { ref: upRef, type: 'file', style: { display: 'none' }, onChange: onUpload })),
      files === null ? h('div', { className: 'fb-empty' }, 'Betöltés…')
        : (files.length ? h('div', { className: 'fbx-tree' }, treeNodes(buildTree(files), 0)) : h('div', { className: 'fb-empty' }, 'Nincs fájl. Húzz be egyet a chatbe, vagy „✚".')),
      viewerEl(),
      selPop ? h('button', { className: 'sel-idea-btn', style: { position: 'fixed', left: selPop.x, top: selPop.y - 40, transform: 'translateX(-50%)', zIndex: 60 }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { props.onAddIdea(selPop.text); setSelPop(null); try { window.getSelection().removeAllRanges(); } catch (e) { } } }, '✚ To idea') : null,
      rvDoc ? h(ReportViewer, { md: rvDoc.content, title: rvDoc.path, onClose: function () { setRvDoc(null); } }) : null,
      intake ? h(FileIntake, { file: intake, context: 'a research idea / literature note in this project', onComplete: intakeDone, onClose: function () { setIntake(null); } }) : null
    );

    return h('div', { className: 'filebrowser', style: { width: (props.width || 256) } },
      h('div', { className: 'fb-head' }, h('b', null, 'Files'), h('span', { style: { flex: 1 } }),
        props.canEdit ? h('button', { className: 'fb-mini', 'aria-label': 'New file', title: 'New file', onClick: newFile }, '+') : null,
        props.canEdit ? h('button', { className: 'fb-mini', 'aria-label': 'Upload', title: 'Upload', onClick: function () { if (upRef.current) upRef.current.click(); } }, '⤒') : null,
        h('input', { ref: upRef, type: 'file', style: { display: 'none' }, onChange: onUpload })
      ),
      files === null ? h('div', { className: 'fb-empty' }, 'Loading…')
        : (files.length ? h('div', { className: 'fb-list' }, files.map(function (f) {
          return h('div', { className: 'fb-item' + (preview && preview.id === f.id ? ' on' : ''), key: f.id },
            h('button', { className: 'fb-name', title: f.path, onClick: function () { setPreview(f); } }, h('span', { className: 'fb-ic' }, icon(f)), h('span', { className: 'fb-lbl' }, f.path), f.source === 'ai' ? h('span', { className: 'fb-tag' }, 'AI') : null),
            h('span', { className: 'fb-acts' },
              (f.content != null && /\.(md|markdown|txt)$/i.test(f.path || '')) ? h('button', { className: 'fb-mini', 'aria-label': 'Open in reader', title: 'Open in formatted reader', onClick: function () { setRvDoc(f); } }, '⤢') : null,
              h('button', { className: 'fb-mini', 'aria-label': 'Download', title: 'Download', onClick: function () { download(f); } }, '⬇'),
              props.canEdit ? h('button', { className: 'fb-mini', 'aria-label': 'Attach to chat', title: 'Attach to chat', onClick: function () { attach(f); } }, '📎') : null,
              props.canEdit ? h('button', { className: 'fb-mini', 'aria-label': 'Delete file', title: 'Delete', onClick: function () { del(f); } }, '×') : null));
        })) : h('div', { className: 'fb-empty' }, 'No files yet. Ask in the chat: “write this to a file…”, or upload one.')),
      preview ? h('div', { className: 'fb-preview' },
        h('div', { className: 'fb-pv-head' }, h('span', { className: 'fb-lbl' }, preview.path),
          (props.canEdit && props.onAddIdea && preview.content != null) ? h('button', { className: 'fb-mini', style: { width: 'auto', padding: '0 7px', fontSize: 11, color: 'var(--accent)' }, title: 'Add the file content as an idea', onClick: function () { props.onAddIdea(preview.content); setAdded(true); setTimeout(function () { setAdded(false); }, 1800); } }, added ? '✓ Added' : '✚ To idea') : null,
          h('button', { className: 'fb-mini', 'aria-label': 'Close preview', onClick: function () { setPreview(null); } }, '×')),
        preview.content != null
          ? h('div', { className: 'btxt md', style: { fontSize: 12.5 }, onMouseUp: onPreviewMouseUp, onScroll: function () { if (selPop) setSelPop(null); }, dangerouslySetInnerHTML: { __html: mdReport(preview.content) } })
          : h('button', { className: 'btn', style: { fontSize: 12 }, onClick: function () { openSigned(preview.storage_path); } }, 'Open / download →')
      ) : null,
      // #1 — floating "add the selected passage to a research idea" button, popped on a text selection in the preview
      selPop ? h('button', { className: 'sel-idea-btn', style: { position: 'fixed', left: selPop.x, top: selPop.y - 40, transform: 'translateX(-50%)', zIndex: 60 }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { props.onAddIdea(selPop.text); setSelPop(null); try { window.getSelection().removeAllRanges(); } catch (e) { } } }, '✚ To idea') : null,
      rvDoc ? h(ReportViewer, { md: rvDoc.content, title: rvDoc.path, onClose: function () { setRvDoc(null); } }) : null,
      intake ? h(FileIntake, { file: intake, context: 'a research idea / literature note in this project', onComplete: intakeDone, onClose: function () { setIntake(null); } }) : null
    );
  }

  function ChatPanel(props) {
    var cS = useState(null), chat = cS[0], setChat = cS[1];
    var mS = useState([]), msgs = mS[0], setMsgs = mS[1];
    var eS = useState({}), evByMsg = eS[0], setEvByMsg = eS[1];
    var iS = useState(''), input = iS[0], setInput = iS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var er = useState(''), err = er[0], setErr = er[1];
    var ty = useState(null), typing = ty[0], setTyping = ty[1];          // { id, len } of the message being typed out (non-stream fallback)
    var stmS = useState(null), streaming = stmS[0], setStreaming = stmS[1];   // { text } while a reply streams in live
    var fvS = useState(0), filesVersion = fvS[0], setFilesVersion = fvS[1];   // bump to refresh the file browser after the AI writes files
    var fbwS = useState(function () { try { return parseInt(localStorage.getItem('pr-fb-width') || '280', 10) || 280; } catch (e) { return 280; } }), fbWidth = fbwS[0], setFbWidth = fbwS[1];   // resizable file-browser width
    var spS = useState(null), selPop = spS[0], setSelPop = spS[1];   // { text, x, y } floating "add selection to ideas" button
    var atS = useState([]), attach = atS[0], setAttach = atS[1];          // pending attachments for the next message
    var ddS = useState(false), dropActive = ddS[0], setDropActive = ddS[1];   // P2: drag files onto the chat → upload to the file manager
    var pkS = useState(false), picker = pkS[0], setPicker = pkS[1];
    var enS = useState(false), enhancing = enS[0], setEnhancing = enS[1];   // #6: prompt enhancement in flight
    var firstLoad = useRef(true), animated = useRef({}), alive = useRef(true), scrollRef = useRef(null), taRef = useRef(null), justStreamed = useRef(false);
    var atBottom = useRef(true);   // only auto-follow the stream while the user is at the bottom; if they scroll up, stay put
    var sgS = useState(''), sgMsg = sgS[0], setSgMsg = sgS[1];
    var sgB = useState(false), sgBusy = sgB[0], setSgBusy = sgB[1];
    useEffect(function () { return function () { alive.current = false; }; }, []);
    // #3 — AI ideas are generated ON DEMAND (button), not continuously: pull NEW research ideas out of the
    // current conversation into the Ideas list as candidates (deduped + capped server-side; user accepts/rejects).
    function suggestIdeas() {
      if (sgBusy) return;
      if (!msgs.length) { setSgMsg('Chat about the project first — I suggest ideas from that.'); setTimeout(function () { setSgMsg(''); }, 3500); return; }
      setSgBusy(true); setSgMsg('Generating ideas from the conversation (AI)…');
      var transcript = msgs.slice(-16).map(function (m) { return (m.role === 'assistant' ? 'AI: ' : 'User: ') + String(m.content || ''); }).join('\n\n').slice(0, 12000);
      sb.functions.invoke('research-ai', { body: { action: 'suggest', project_id: props.projectId, text: transcript } }).then(function (res) {
        setSgBusy(false);
        if (res && res.error) { setSgMsg('AI is not configured (research-ai / ANTHROPIC_API_KEY).'); return; }
        var d = res && res.data;
        if (d && d.count) { setSgMsg('✓ ' + d.count + ' new idea(s) in the Ideas list.'); props.onChanged(); }
        else setSgMsg('No new ideas found in this conversation.');
        setTimeout(function () { setSgMsg(''); }, 4500);
      }, function () { setSgBusy(false); setSgMsg('AI call failed.'); });
    }
    function startTyping(id, full) {
      if (!full) return;
      // reveal word-by-word at a calm, readable pace (each word fades in) — clearly slower than a raw
      // char dump, but the per-token delay scales down for long replies so they never drag.
      var toks = full.split(/(\s+)/);
      var per = Math.max(15, Math.min(48, Math.round(7000 / toks.length)));
      var n = 0;
      setTyping({ id: id, n: 0 });
      (function tick() {
        if (!alive.current) return;
        n += 1;
        if (n >= toks.length) { setTyping(null); return; }
        setTyping({ id: id, n: n });
        setTimeout(tick, per);
      })();
    }
    function loadMsgs(cid) {
      Promise.all([
        sb.from('research_messages').select('id,role,content,created_at').eq('chat_id', cid).order('created_at', { ascending: true }),
        sb.from('research_evidence').select('message_id').eq('chat_id', cid)
      ]).then(function (res) {
        var data = (res[0] && res[0].data) || [];
        setMsgs(data);
        var by = {}; ((res[1] && res[1].data) || []).forEach(function (e) { if (e.message_id) by[e.message_id] = (by[e.message_id] || 0) + 1; });
        setEvByMsg(by);
        if (firstLoad.current) { data.forEach(function (m) { animated.current[m.id] = true; }); firstLoad.current = false; }  // no animation on the initial history load
        else {
          var aMsgs = data.filter(function (m) { return m.role === 'assistant'; });
          var last = aMsgs[aMsgs.length - 1];
          if (last && !animated.current[last.id]) { animated.current[last.id] = true; if (!justStreamed.current) startTyping(last.id, last.content); }  // a streamed reply was already revealed live → no replay
          justStreamed.current = false;
        }
      });
    }
    useEffect(function () {
      sb.from('research_chats').select('id').eq('project_id', props.projectId).order('created_at', { ascending: true }).limit(1).then(function (r) {
        var c = (r && r.data && r.data[0]) || null; setChat(c); if (c) loadMsgs(c.id);
      });
    }, []);
    useEffect(function () { var el = scrollRef.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [msgs.length, typing, streaming]);  // follow the stream ONLY if the user is at the bottom
    function ensureChat() {
      if (chat) return Promise.resolve(chat.id);
      return sb.from('research_chats').insert({ project_id: props.projectId, title: 'Publify chat' }).select('id').maybeSingle().then(function (r) { var c = r && r.data; setChat(c); return c && c.id; });
    }
    // Persist any ```file:…``` blocks the AI emitted into the project's file browser.
    function saveAiFiles(text) {
      var fs = extractFiles(text); if (!fs.length) return;
      Promise.all(fs.map(function (f) {
        return sb.from('research_files').upsert({ project_id: props.projectId, path: f.path, content: f.content, storage_path: null, mime: 'text/markdown', size: (f.content || '').length, source: 'ai', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' });
      })).then(function () { setFilesVersion(function (v) { return v + 1; }); });
    }
    // P2: files dropped on the chat → upload to storage + research_files (uploads/), refresh the file manager, attach to the next message.
    function chatUpload(fileList) {
      setDropActive(false);   // clear FIRST so an empty/aborted drop can't leave the overlay stuck over the chat
      var arr = [].slice.call(fileList || []); if (!arr.length) return;
      function freePath(base, taken) { if (taken.indexOf(base) < 0) return base; var d = base.lastIndexOf('.'); var stem = d > 0 ? base.slice(0, d) : base, ext = d > 0 ? base.slice(d) : ''; var i = 2; while (taken.indexOf(stem + ' (' + i + ')' + ext) >= 0) i++; return stem + ' (' + i + ')' + ext; }
      // fetch existing paths once → version same-name drops instead of silently overwriting (data loss + orphaned blob)
      sb.from('research_files').select('path').eq('project_id', props.projectId).then(function (er) {
        var taken = ((er && er.data) || []).map(function (x) { return x.path; });
        arr.forEach(function (f) {
          if (window.PROffice && window.PROffice.isOffice(f.name)) {
            window.PROffice.extract(f).then(function (r) {
              var path = freePath('uploads/' + f.name.replace(/\.(docx|xlsx|xlsm|xls|pptx)$/i, '') + '.' + (r.ext || 'md'), taken); taken.push(path);
              sb.from('research_files').upsert({ project_id: props.projectId, path: path, content: r.text || '', storage_path: null, mime: r.ext === 'csv' ? 'text/csv' : 'text/markdown', size: (r.text || '').length, source: 'upload', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function () { setFilesVersion(function (v) { return v + 1; }); });
            }, function () { window.PRUI.toast('Office-feldolgozási hiba: ' + f.name, { kind: 'error' }); });
            return;
          }
          var path = freePath('uploads/' + f.name, taken); taken.push(path);
          var sp = props.projectId + '/files/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
          sb.storage.from('research-data').upload(sp, f).then(function (res) {
            if (res && res.error) { window.PRUI.toast(res.error.message, { kind: 'error' }); return; }
            sb.from('research_files').upsert({ project_id: props.projectId, path: path, storage_path: sp, content: null, mime: f.type || 'application/octet-stream', size: f.size, source: 'upload', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (rr) {
              if (rr && rr.error) { try { sb.storage.from('research-data').remove([sp]); } catch (e) { } window.PRUI.toast(rr.error.message, { kind: 'error' }); return; }
              setFilesVersion(function (v) { return v + 1; });
              setAttach(function (p) { return p.concat([{ kind: 'file', bucket: 'research-data', path: sp, name: f.name, mime: f.type, label: f.name }]); });
            });
          });
        });
        window.PRUI.toast(arr.length + ' fájl feltöltve az uploads/ mappába', { kind: 'ok' });
      });
    }
    // safety: reset the chat dropzone overlay on any aborted drag (dragend/drop anywhere) so it can't stay stuck over the chat
    useEffect(function () { if (!dropActive) return; function reset() { setDropActive(false); } window.addEventListener('dragend', reset); window.addEventListener('drop', reset); return function () { window.removeEventListener('dragend', reset); window.removeEventListener('drop', reset); }; }, [dropActive]);
    // Real token streaming: POST to the Edge function and append text deltas to a live bubble as they arrive.
    function streamReply(cid) {
      var CFG = window.PR_CONFIG || {};
      if (!CFG.supabaseUrl) { setBusy(false); setErr('Missing backend config.'); return; }
      sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        fetch(CFG.supabaseUrl + '/functions/v1/research-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ chat_id: cid, stream: true })
        }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { setBusy(false); setErr('AI connection pending — deploy the research-chat Edge function and set ANTHROPIC_API_KEY.'); return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), acc = '';
          setStreaming({ text: '' });
          (function pump() {
            reader.read().then(function (r) {
              if (!alive.current) return;
              if (r.done) { setStreaming(null); setBusy(false); justStreamed.current = true; saveAiFiles(acc); loadMsgs(cid); return; }
              acc += dec.decode(r.value, { stream: true });
              setStreaming({ text: acc });
              pump();
            }, function () { setStreaming(null); setBusy(false); loadMsgs(cid); });
          })();
        }, function () { setBusy(false); setErr('AI connection pending — deploy the research-chat Edge function.'); });
      });
    }
    function sendText(raw) {
      var txt = (raw || '').trim();
      if (!txt || busy) return;
      atBottom.current = true;   // sending → jump back to the live conversation
      var atts = attach;
      setBusy(true); setErr(''); setInput(''); setAttach([]);
      if (taRef.current) taRef.current.style.height = 'auto';
      ensureChat().then(function (cid) {
        if (!cid) { setBusy(false); setErr('Could not start a chat.'); return; }
        var payload = { chat_id: cid, role: 'user', content: txt }; if (atts.length) payload.attachments = atts;   // omit the column when unused (works pre-migration-17)
        sb.from('research_messages').insert(payload).then(function (ins) {
          if (ins && ins.error) { setBusy(false); setErr(atts.length ? 'Attachments need migration-17 + a research-chat redeploy — ' + ins.error.message : ins.error.message); return; }
          loadMsgs(cid);
          streamReply(cid);   // live token stream → persisted + reloaded on completion
        });
      });
    }
    function send() { sendText(input); }
    // #6 — rewrite the current input into a clearer, more specific prompt via research-ai (action: enhance)
    function enhance() {
      var txt = (input || '').trim(); if (!txt || enhancing || busy) return;
      setEnhancing(true); setErr('');
      sb.functions.invoke('research-ai', { body: { action: 'enhance', project_id: props.projectId, text: txt } }).then(function (res) {
        setEnhancing(false);
        if (res && res.error) { setErr('Prompt enhancement is unavailable (research-ai / ANTHROPIC_API_KEY).'); return; }
        var d = res && res.data;
        if (d && d.text) { setInput(d.text); var ta = taRef.current; if (ta) { setTimeout(function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; ta.focus(); }, 0); } }
      }, function () { setEnhancing(false); setErr('Prompt enhancement is unavailable.'); });
    }
    function copy(m) { try { navigator.clipboard.writeText(m.content || ''); } catch (e) { } }
    function onTaKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
    function onTaInput(e) { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }
    function saveIdea(m) { sb.from('research_ideas').insert({ project_id: props.projectId, source: 'consensus', question: (m.content || '').slice(0, 8000), created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } props.onChanged(); }); }
    function saveIdeaText(text) { sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', question: (text || '').slice(0, 8000), created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } props.onChanged(); }); }
    // drag the divider to resize the file browser (the chat takes the rest); persisted in localStorage
    function startResize(e) {
      e.preventDefault();
      var startX = e.clientX, startW = fbWidth, last = startW;
      function move(ev) { last = Math.max(190, Math.min(620, startW + (startX - ev.clientX))); setFbWidth(last); }
      function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; try { localStorage.setItem('pr-fb-width', String(last)); } catch (e2) { } }
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    // a text selection inside a chat bubble pops an "add to ideas" button
    function onChatMouseUp() {
      if (!props.canEdit) return;
      setTimeout(function () {
        var s = window.getSelection ? window.getSelection() : null;
        var txt = s ? String(s).trim() : '';
        if (txt && txt.length > 3) { try { var r = s.getRangeAt(0).getBoundingClientRect(); setSelPop({ text: txt, x: r.left + r.width / 2, y: r.top }); } catch (e) { setSelPop(null); } }
        else setSelPop(null);
      }, 1);
    }
    return h('div', { className: 'panel chatwrap' },
      h('div', { className: 'chat-col', onDragOver: function (e) { if (props.canEdit && e.dataTransfer && [].slice.call(e.dataTransfer.types || []).indexOf('Files') >= 0) { e.preventDefault(); if (!dropActive) setDropActive(true); } } },
      (dropActive && props.canEdit) ? h('div', { className: 'chat-dropzone', onDragOver: function (e) { e.preventDefault(); }, onDragLeave: function () { setDropActive(false); }, onDrop: function (e) { e.preventDefault(); chatUpload(e.dataTransfer.files); } },
        h('div', { className: 'cdz-inner' }, h('div', { style: { fontSize: 30 } }, '📎'), h('b', null, 'Engedd el a fájlokat'), h('span', null, 'Feltöltés az uploads/ mappába + csatolás az üzenethez'))) : null,
      h('h3', null, 'Chat with Publify', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'research assistant')),
      props.canEdit ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
        h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: sgBusy || !msgs.length, title: 'Suggests ideas for the Ideas list from the current conversation (manually, not continuously)', onClick: suggestIdeas }, sgBusy ? '💡 Generating…' : '💡 Generate ideas from the conversation'),
        sgMsg ? h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, sgMsg) : null
      ) : null,
      props.supervised ? h('div', { style: { fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', marginBottom: 10, lineHeight: 1.45 } }, 'ℹ️ Your supervisor may receive a daily summary of your research conversations (what you worked on, what decisions you made).') : null,
      h('div', { className: 'chat-msgs', ref: scrollRef, onMouseUp: onChatMouseUp, onScroll: function () { var el = scrollRef.current; if (el) atBottom.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 64; if (selPop) setSelPop(null); } },
        msgs.length ? msgs.map(function (m) {
          var isTyping = typing && typing.id === m.id;
          var ai = m.role === 'assistant';
          var body;
          if (ai && !isTyping) body = h('div', { className: 'btxt md', dangerouslySetInnerHTML: { __html: foldCode(mdHtml(stripFiles(m.content))) } });
          else if (ai && isTyping) {
            var toks = (m.content || '').split(/(\s+)/), shown = toks.slice(0, typing.n);
            body = h('div', { className: 'btxt' }, shown.slice(0, -1).join(''), h('span', { key: typing.n, className: 'tw-word' }, shown[shown.length - 1] || ''), h('span', { className: 'tw-cursor' }, '▌'));
          } else body = h('div', { className: 'btxt' }, m.content);
          return h('div', { key: m.id, className: 'bubble ' + (ai ? 'ai' : 'user') },
            body,
            (ai && !isTyping) ? h('div', { className: 'bmeta' },
              evByMsg[m.id] ? h('span', null, '📄 ' + evByMsg[m.id] + ' sources') : null,
              h('button', { className: 'copybtn', onClick: function () { copy(m); } }, 'Copy'),
              props.canEdit ? h('button', { className: 'savebtn', onClick: function () { saveIdea(m); } }, '✚ Save as idea') : null
            ) : null
          );
        }) : h('div', null,
          h('div', { className: 'chat-empty' }, 'Ask Publify about your topic — grounded in evidence when Consensus is connected.'),
          props.canEdit ? h('div', { className: 'chat-suggest' }, CHAT_SUGGEST.map(function (s, i) { return h('button', { key: i, onClick: function () { sendText(s); } }, s); })) : null
        ),
        streaming ? h('div', { className: 'bubble ai', key: 'stream' }, h('div', { className: 'btxt' }, streaming.text || '', h('span', { className: 'tw-cursor' }, '▌')))
          : busy ? h('div', { className: 'bubble ai' }, h('div', { className: 'btxt', style: { color: 'var(--faint)' } }, 'Publify is thinking…')) : null
      ),
      err ? h('div', { style: { fontSize: 12.5, color: 'var(--warn)', margin: '6px 0 0' } }, err) : null,
      props.canEdit ? h('div', null,
        attach.length ? h('div', { className: 'attach-chips' }, attach.map(function (a, i) {
          return h('span', { className: 'attach-chip', key: i }, (a.kind === 'source' ? '📄 ' : '📎 ') + (a.label || a.name || a.title || 'attachment'),
            h('button', { 'aria-label': 'Remove attachment', title: 'Remove', onClick: function () { setAttach(attach.filter(function (_, j) { return j !== i; })); } }, '×'));
        })) : null,
        h('div', { className: 'chat-input' },
          h('button', { className: 'attach-btn', 'aria-label': 'Attach a library source, publication or file', title: 'Attach a library source, publication or file', disabled: busy, onClick: function () { setPicker(true); } }, '📎'),
          h('button', { className: 'attach-btn', 'aria-label': 'Enhance the prompt with AI', title: 'Enhance the prompt (AI) — makes the text you entered clearer and more specific', disabled: busy || enhancing || !input.trim(), onClick: enhance }, enhancing ? '⏳' : '✨'),
          h('textarea', { ref: taRef, value: input, rows: 1, placeholder: 'Message Publify…  (Enter to send · Shift+Enter newline)', disabled: busy, onChange: onTaInput, onKeyDown: onTaKey }),
          h('button', { className: 'btn pri', disabled: busy, onClick: send }, 'Send')
        )
      ) : null
      ),
      h('div', { className: 'fb-resizer', onMouseDown: startResize, title: 'Drag to resize the panels' }),
      h(SessionFileBrowser, { projectId: props.projectId, authorId: props.authorId, canEdit: props.canEdit, version: filesVersion, width: fbWidth, onAttach: function (a) { setAttach(function (p) { return p.concat([a]); }); }, onAddIdea: function (text) { saveIdeaText(text); } }),
      selPop ? h('button', { className: 'sel-idea-btn', style: { position: 'fixed', left: selPop.x, top: selPop.y - 40, transform: 'translateX(-50%)', zIndex: 60 }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { saveIdeaText(selPop.text); setSelPop(null); try { window.getSelection().removeAllRanges(); } catch (e) { } } }, '✚ To idea') : null,
      picker ? h(AttachModal, { projectId: props.projectId, authorId: props.authorId, fileOwnerId: props.fileOwnerId, sources: props.sources, onPick: function (a) { setAttach(function (p) { return p.concat([a]); }); }, onClose: function () { setPicker(false); } }) : null
    );
  }

  // ---------- Ideas (R1) ----------
  function IdeasPanel(props) {
    var f = useState({ question: '', hypothesis: '' }), form = f[0], setForm = f[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    var m = useState(''), msg = m[0], setMsg = m[1];
    var exS = useState({}), expanded = exS[0], setExpanded = exS[1];   // #10: per-idea open/closed
    function toggle(id) { setExpanded(function (e) { var n = Object.assign({}, e); n[id] = e[id] === false ? true : false; return n; }); }
    function add() {
      var q = form.question.trim();
      if (!q) { setMsg('Type a research question first.'); return; }
      // #11 — tell the user instead of silently storing a duplicate
      if ((props.ideas || []).some(function (i) { return (i.question || '').trim().toLowerCase() === q.toLowerCase(); })) { setMsg('⚠️ This idea is already in the list.'); return; }
      setMsg('');
      sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', question: q, hypothesis: form.hypothesis.trim() || null, created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { setMsg('Could not add: ' + r.error.message); return; } setForm({ question: '', hypothesis: '' }); setMsg('✓ Idea added.'); setTimeout(function () { setMsg(''); }, 2500); props.onChanged(); });
    }
    function onKey(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } }
    function setStatus(idea, st) { sb.from('research_ideas').update({ status: st }).eq('id', idea.id).then(props.onChanged); }
    function del(idea) { sb.from('research_ideas').delete().eq('id', idea.id).then(props.onChanged); }
    function gap() {
      setBusy(true); setMsg('Running gap analysis (AI)…');
      sb.functions.invoke('research-ai', { body: { action: 'gap', project_id: props.projectId } }).then(function (res) {
        setBusy(false);
        if (res && res.error) { setMsg('AI not configured yet — deploy the research-ai Edge function (supabase/functions/research-ai) and set ANTHROPIC_API_KEY.'); return; }
        setMsg(''); props.onChanged();
      }, function () { setBusy(false); setMsg('AI not configured yet — deploy the research-ai Edge function.'); });
    }
    var ideas = props.ideas || [];
    var selected = ideas.filter(function (i) { return i.status === 'selected'; });
    var rest = ideas.filter(function (i) { return i.status !== 'selected'; });
    // ---- AI-Native Brainstorm (New design flag, direction B): IdeasPanel becomes the right-hand "Shortlist + Study basis" rail beside the chat. Same data + handlers. ----
    function srcLabel(s) { return s === 'chat' ? '💡 AI (chat)' : s === 'gap' ? '💡 AI (gap)' : s === 'own' ? 'own' : (s || 'own'); }
    function railRender() {
      return h('div', { className: 'idb-rail' },
        h('div', { className: 'idb-card' },
          h('div', { className: 'idb-h' }, h('span', null, 'Shortlist'), h('span', { className: 'idb-c' }, String(rest.length)),
            props.canEdit ? h('button', { className: 'idb-gap', disabled: busy, onClick: gap }, '✨ Gap analysis') : null),
          msg ? h('div', { className: 'idb-msg' }, msg) : null,
          props.canEdit ? h('div', { className: 'idb-add' },
            h('textarea', { rows: 2, className: 'idb-in', value: form.question, placeholder: 'A research question…  (⌘/Ctrl+Enter)', onChange: function (e) { setForm(Object.assign({}, form, { question: e.target.value })); }, onKeyDown: onKey }),
            form.question.trim() ? h('textarea', { rows: 2, className: 'idb-in', value: form.hypothesis, placeholder: 'Hypothesis (optional)', onChange: function (e) { setForm(Object.assign({}, form, { hypothesis: e.target.value })); }, onKeyDown: onKey }) : null,
            h('button', { className: 'idb-addbtn', onClick: add }, '+ Add idea')
          ) : null,
          rest.length ? rest.map(function (idea) {
            var rej = idea.status === 'rejected';
            var xp = expanded[idea.id] === true;   // default collapsed (clamped) in the rail; click the question to expand full text (reuses feature #10 state)
            return h('div', { className: 'idb-sl' + (rej ? ' rej' : ''), key: idea.id },
              h('span', { className: 'idb-nd' }),
              h('div', { className: 'idb-body' },
                h('div', { className: 'idb-q' + (xp ? '' : ' clamp'), title: xp ? '' : idea.question, onClick: function () { toggle(idea.id); } }, idea.question),
                idea.hypothesis ? h('div', { className: 'idb-h2' + (xp ? '' : ' clamp') }, idea.hypothesis) : null,
                idea.rationale ? h('div', { className: 'idb-r2' + (xp ? '' : ' clamp') }, idea.rationale) : null,
                h('div', { className: 'idb-meta' }, srcLabel(idea.source), idea.novelty != null ? ' · novelty ' + idea.novelty : '', rej ? h('span', { className: 'idb-rejtag' }, ' · rejected') : ''),
                props.canEdit ? h('div', { className: 'idb-acts' },
                  h('button', { className: 'sel', onClick: function () { setStatus(idea, 'selected'); } }, 'Select'),
                  rej ? h('button', { onClick: function () { setStatus(idea, 'candidate'); } }, 'Reset') : h('button', { onClick: function () { setStatus(idea, 'rejected'); } }, 'Reject'),
                  h('button', { className: 'del', 'aria-label': 'Delete idea', onClick: function () { del(idea); } }, '✕')
                ) : null
              )
            );
          }) : h('div', { className: 'idb-empty' }, 'No ideas yet — brainstorm in the chat, run a gap analysis, or add one above.')
        ),
        h('div', { className: 'idb-card idb-basis' },
          h('div', { className: 'idb-h' }, h('span', null, '📌 Study basis'), h('span', { className: 'idb-c' }, String(selected.length)),
            props.onGoStudy ? h('button', { className: 'idb-studies', onClick: function () { props.onGoStudy(); } }, '📚 Studies →') : null),
          selected.length ? h('div', null,
            h('div', { className: 'idb-bwrap' }, selected.map(function (idea, i) {
              return h('div', { className: 'idb-bitem', key: idea.id },
                h('span', { className: 'idb-bnum' }, String(i + 1)),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { className: 'idb-bq' }, idea.question),
                  idea.hypothesis ? h('div', { className: 'idb-bh' }, idea.hypothesis) : null),
                props.canEdit ? h('button', { className: 'del', 'aria-label': 'Remove from basis', title: 'Remove from basis', onClick: function () { setStatus(idea, 'candidate'); } }, '✕') : null
              );
            })),
            props.onStartStudyMulti ? h('button', { className: 'idb-cta', onClick: function () { props.onStartStudyMulti(selected); } }, '🔬 Start a study from these ideas →') : null
          ) : h('div', { className: 'idb-bempty' }, 'Press “Select” on a shortlisted idea — it becomes the study basis.')
        )
      );
    }
    if (nd()) return railRender();
    return h('div', null,
      // 📌 separate "study basis" window — collects the ideas chosen (Select) as the study's foundation
      h('div', { className: 'panel', style: { marginBottom: 10, border: '1.5px solid var(--accent)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('h3', { style: { margin: 0 } }, '📌 Study basis' + (selected.length ? ' — ' + selected.length + ' idea(s)' : '')),
          props.onGoStudy ? h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '4px 10px', fontSize: 12, flex: 'none' }, title: 'Go to existing studies', onClick: function () { props.onGoStudy(); } }, '📚 Studies →') : null),
        selected.length ? h('div', null,
          selected.map(function (idea) {
            return h('div', { key: idea.id, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--line)' } },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 13, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.question),
                idea.hypothesis ? h('div', { style: { fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.hypothesis) : null
              ),
              props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Remove from basis', title: 'Remove from basis', style: { flex: 'none' }, onClick: function () { setStatus(idea, 'candidate'); } }, '✕') : null
            );
          }),
          props.onStartStudyMulti ? h('div', { style: { marginTop: 10 } }, h('button', { className: 'btn pri', onClick: function () { props.onStartStudyMulti(selected); } }, '🔬 Start a study from these ideas →'),
            h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 5 } }, 'Publify fills in the Step-1 fields (keywords, criteria, filters) based on the ideas — you can edit them afterwards.')) : null
        ) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Still empty. Press the “Select” button on an idea below — it moves here, and these become the study basis.')
      ),
      h('div', { className: 'panel' },
      h('h3', null, 'Research ideas', props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: busy, onClick: gap }, '✨ Gap analysis (AI)') : null),
      msg ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 } }, msg) : null,
      props.canEdit ? h('div', { style: { marginBottom: 10 } },
        h('textarea', { rows: 2, style: { width: '100%', minHeight: 40, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, resize: 'vertical', boxSizing: 'border-box' }, value: form.question, placeholder: 'A research question…  (Ctrl/⌘+Enter = add)', onChange: function (e) { setForm(Object.assign({}, form, { question: e.target.value })); }, onKeyDown: onKey }),
        h('textarea', { rows: 2, style: { width: '100%', minHeight: 40, marginTop: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, resize: 'vertical', boxSizing: 'border-box' }, value: form.hypothesis, placeholder: 'Hypothesis (optional)', onChange: function (e) { setForm(Object.assign({}, form, { hypothesis: e.target.value })); }, onKeyDown: onKey }),
        h('div', { style: { marginTop: 8 } }, h('button', { className: 'btn pri', onClick: add }, 'Add idea'))
      ) : null,
      rest.length ? rest.map(function (idea) {
        var open = expanded[idea.id] !== false;   // #10: default open; click chevron / question to collapse
        return h('div', { className: 'idea', key: idea.id },
          h('div', { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4 } },
            h('button', { className: 'icon-x', 'aria-label': open ? 'Collapse' : 'Expand', 'aria-expanded': open, title: open ? 'Collapse' : 'Expand', style: { marginRight: 1, flex: 'none' }, onClick: function () { toggle(idea.id); } }, open ? '▾' : '▸'),
            h('span', { className: 'chip ' + (idea.source === 'gap' || idea.source === 'chat' ? 'c-acc' : 'c-grey') }, idea.source === 'chat' ? '💡 AI (chat)' : idea.source === 'gap' ? '💡 AI (gap)' : idea.source === 'own' ? 'own' : idea.source),
            idea.novelty != null ? h('span', { className: 'chip c-ok' }, 'novelty ' + idea.novelty) : null,
            h('span', { className: 'chip ' + (idea.status === 'selected' ? 'c-ok' : (idea.status === 'rejected' ? 'c-grey' : 'c-warn')) }, idea.status),
            props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Delete idea', style: { marginLeft: 'auto' }, onClick: function () { del(idea); } }, '✕') : null
          ),
          h('div', { onClick: function () { toggle(idea.id); }, title: open ? '' : idea.question, style: open ? { fontSize: 13.5, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'pointer' } : { fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' } }, idea.question),
          open && idea.hypothesis ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.hypothesis) : null,
          open && idea.rationale ? h('div', { style: { fontSize: 12, color: 'var(--faint)', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.rationale) : null,
          props.canEdit ? h('div', { className: 'idea-foot' },
            h('button', { onClick: function () { setStatus(idea, 'selected'); } }, 'Select'),
            h('button', { onClick: function () { setStatus(idea, 'rejected'); } }, 'Reject'),
            h('button', { onClick: function () { setStatus(idea, 'candidate'); } }, 'Reset')
          ) : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, selected.length ? 'All ideas moved to the study basis — add a new one above.' : 'No ideas yet — add your own or run a gap analysis.')
      )
    );
  }

  // ---------- Literature (R1, OpenAlex) ----------
  function abstractFromInverted(inv) { if (!inv) return null; var w = []; Object.keys(inv).forEach(function (k) { inv[k].forEach(function (p) { w[p] = k; }); }); return w.join(' ').slice(0, 1500); }
  function normWork(w) { var s = (w.primary_location && w.primary_location.source) || {}; return { journal: s.display_name, type: s.type, indexed: !!s.is_core, doaj: !!s.is_in_doaj, oa: !!(w.open_access && w.open_access.is_oa), fwci: w.fwci, year: w.publication_year, date: w.publication_date, cites: w.cited_by_count }; }
  // SCImago (Scopus) quartile map — lazy-loaded once; absent/{} until backend/scimago/build_scimago.py is run
  var _scimago = null, _scimagoP = null;
  function loadScimago() {
    if (_scimago) return Promise.resolve(_scimago);
    if (_scimagoP) return _scimagoP;
    _scimagoP = fetch('scimago-scopus.json').then(function (r) { return r.ok ? r.json() : {}; }).then(function (m) { _scimago = m || {}; return _scimago; }, function () { _scimago = {}; return _scimago; });
    return _scimagoP;
  }
  function scopusQ(map, w) {
    if (!map) return null;
    var s = (w.primary_location && w.primary_location.source) || {}, c = [];
    if (s.issn_l) c.push(s.issn_l);
    if (Array.isArray(s.issn)) c = c.concat(s.issn);
    for (var i = 0; i < c.length; i++) { var n = String(c[i] || '').replace(/[^0-9Xx]/g, '').toUpperCase(); if (n.length === 8 && map[n]) return map[n]; }
    return null;
  }
  // quartile (1–4) from a stored comma-joined ISSN string (research_sources.issn) + the SCImago map
  function quartileFromIssn(map, issnStr) {
    if (!map || !issnStr) return null;
    var parts = String(issnStr).split(',');
    for (var i = 0; i < parts.length; i++) { var n = parts[i].replace(/[^0-9Xx]/g, '').toUpperCase(); if (n && map[n]) return map[n]; }
    return null;
  }
  function metricTags(o) {
    var t = [];
    if (o.journal) t.push(h('span', { className: 'mtag j', key: 'j', title: 'Journal / venue' }, o.journal));
    if (o.scopus) t.push(h('span', { className: 'mtag sc', key: 's', title: 'Scopus quartile (SCImago Journal Rank) — Q1 is the top 25% by SJR in its field' }, 'Scopus Q' + o.scopus));
    if (o.type && o.type !== 'journal') t.push(h('span', { className: 'mtag', key: 't' }, o.type === 'conference' ? 'Conference' : (o.type.charAt(0).toUpperCase() + o.type.slice(1))));
    if (o.date || o.year) t.push(h('span', { className: 'mtag', key: 'y' }, o.date || o.year));
    if (o.cites != null) t.push(h('span', { className: 'mtag', key: 'c' }, o.cites + ' cites'));
    if (o.indexed) t.push(h('span', { className: 'mtag ok', key: 'i', title: 'Indexed core source (OpenAlex) — the open proxy for Scopus / Web of Science indexing' }, '✓ Indexed'));
    if (o.fwci != null) t.push(h('span', { className: 'mtag imp', key: 'f', title: 'Field-Weighted Citation Impact — 1.0 = average for the field; >1 is above-average impact' }, 'FWCI ' + Number(o.fwci).toFixed(1)));
    if (o.oa) t.push(h('span', { className: 'mtag oa', key: 'o', title: o.doaj ? 'Open access (DOAJ journal)' : 'Open access' }, 'OA'));
    return t.length ? h('div', { className: 'mtags' }, t) : null;
  }
  function bibKey(s, used) {
    var first = (s.authors && s.authors[0]) ? String(s.authors[0]).split(/\s+/).pop() : 'ref';
    var base = (first + (s.year || '')).replace(/[^A-Za-z0-9]/g, '') || ('ref' + (s.year || ''));
    var k = base, i = 0; while (used[k]) { k = base + String.fromCharCode(97 + i); i++; } used[k] = true; return k;
  }
  function genBibtex(sources) {
    var used = {};
    return sources.map(function (s) {
      var key = bibKey(s, used), f = [];
      f.push('  title = {' + (s.title || '') + '}');
      if (s.authors && s.authors.length) f.push('  author = {' + s.authors.join(' and ') + '}');
      if (s.year) f.push('  year = {' + s.year + '}');
      if (s.venue) f.push('  journal = {' + s.venue + '}');
      if (s.doi) f.push('  doi = {' + String(s.doi).replace(/^https?:\/\/doi\.org\//, '') + '}');
      if (s.url) f.push('  url = {' + s.url + '}');
      return '@article{' + key + ',\n' + f.join(',\n') + '\n}';
    }).join('\n\n');
  }
  function downloadText(name, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function escapeTex(s) { return String(s == null ? '' : s).replace(/([&%#_$])/g, '\\$1'); }
  function genTexSkeleton(project, idea, sources, doneJobs) {
    var used = {}, keys = (sources || []).map(function (s) { return bibKey(s, used); });
    var cites = keys.length ? '\\cite{' + keys.join(',') + '}' : '';
    var results = (doneJobs || []).map(function (j) { return '\\paragraph{' + escapeTex(j.title || 'Result') + '} ' + (j.result ? escapeTex(JSON.stringify(j.result)) : ''); }).join('\n');
    return [
      '\\documentclass{article}', '\\usepackage{cite}',
      '\\title{' + escapeTex(project.title || '') + '}', '\\begin{document}', '\\maketitle', '',
      '\\begin{abstract}', escapeTex(idea ? (idea.question + (idea.hypothesis ? ' ' + idea.hypothesis : '')) : (project.goal || '')), '\\end{abstract}', '',
      '\\section{Introduction}', escapeTex(project.goal || '% TODO') + ' ' + cites, '',
      '\\section{Related work}', 'We reviewed ' + (sources || []).length + ' relevant works. ' + cites, '',
      '\\section{Method}', idea && idea.hypothesis ? escapeTex(idea.hypothesis) : '% TODO: methodology', '',
      '\\section{Results}', results || '% TODO: results', '',
      '\\bibliographystyle{plain}', '\\bibliography{library}', '\\end{document}'
    ].join('\n');
  }
  // ---------- Add the user's own (MTMT) publications to the library ----------
  function MyPubsModal(props) {
    var pubs = props.pubs || [];
    useEffect(function () { function onEsc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', onEsc); return function () { window.removeEventListener('keydown', onEsc); }; });
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add from my publications', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'Add from my publications'), h('span', { style: { fontSize: 12, color: 'var(--faint)' } }, pubs.length + ' from MTMT'), h('button', { className: 'x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          pubs.length ? pubs.map(function (p) {
            var inLib = props.saved['mtmt:' + p.mtid];
            return h('div', { className: 'src', style: { alignItems: 'flex-start' }, key: p.mtid },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('b', { style: { fontSize: 13 } }, p.title || 'Untitled'),
                h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 1 } }, [p.firstAuthor ? (p.firstAuthor + (p.authorCount > 1 ? ' et al.' : '')) : '', p.year, p.journal].filter(Boolean).join(' · ')),
                metricTags({ journal: p.journal, year: p.year, cites: p.citations })
              ),
              inLib ? h('span', { className: 'chip c-ok' }, 'in library') : h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: function () { props.onAdd(p); } }, 'Add')
            );
          }) : h('div', { className: 'empty' }, 'No publications are linked to your account (MTMT).')
        ),
        h('div', { className: 'modal-foot' },
          h('button', { className: 'btn', onClick: props.onClose }, 'Close'),
          pubs.length ? h('button', { className: 'btn pri', onClick: function () { pubs.forEach(function (p) { if (!props.saved['mtmt:' + p.mtid]) props.onAdd(p); }); } }, 'Add all') : null
        )
      )
    );
  }

  function LiteraturePanel(props) {
    var q = useState(''), query = q[0], setQuery = q[1];
    var pm = useState(false), pubsOpen = pm[0], setPubsOpen = pm[1];
    var myPubs = (PUBS && props.myEmail) ? ((PUBS.forUser({ email: props.myEmail }) || {}).publications || []) : [];
    function addPub(p) { sb.from('research_sources').insert({ project_id: props.projectId, source_api: 'mtmt', ext_id: 'mtmt:' + p.mtid, doi: p.doi || null, title: p.title || 'Untitled', authors: p.firstAuthor ? [p.firstAuthor + (p.authorCount > 1 ? ' et al.' : '')] : null, year: p.year || null, venue: p.journal || null, cited_by: p.citations, url: p.doi ? 'https://doi.org/' + p.doi : p.mtmtUrl, screening: 'unscreened' }).then(function (res) { if (res && res.error) { if (!/duplicate|unique/i.test(res.error.message)) window.PRUI.toast(res.error.message, { kind: 'error' }); return; } props.onChanged(); }); }
    var r = useState(null), results = r[0], setResults = r[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    var fl = useState({ minCites: '', fromYear: '', indexed: false, oa: false, journals: false }), flt = fl[0], setFlt = fl[1];
    var sm = useState(null), scimap = sm[0], setScimap = sm[1];
    var sq = useState(0), scopusMax = sq[0], setScopusMax = sq[1];
    // Redesigned Library (New design flag): sort key/dir + screening/quartile filters for the dense sortable table
    var lsS = useState({ key: 'cites', dir: -1 }), libSort = lsS[0], setLibSort = lsS[1];
    var lfS = useState('all'), libScreen = lfS[0], setLibScreen = lfS[1];   // all|include|maybe|exclude|unscreened
    var lqS = useState(0), libQmax = lqS[0], setLibQmax = lqS[1];           // 0 = any, else max quartile
    useEffect(function () { loadScimago().then(setScimap); }, []);
    // source_ids that were selected in a Study (AI-included in any step, or the user's "Your decision" override) —
    // these float to the top of the Library and are highlighted.
    var siS = useState({}), studyInc = siS[0], setStudyInc = siS[1];   // source_id -> [study titles it was selected in]
    useEffect(function () {
      var ids = (props.studies || []).map(function (s) { return s.id; });
      if (!ids.length) { setStudyInc({}); return; }
      var titleById = {}; (props.studies || []).forEach(function (s) { titleById[s.id] = s.title || 'Untitled study'; });
      sb.from('research_study_papers').select('source_id,study_id,decision,overridden').in('study_id', ids).then(function (r2) {
        var m = {};
        ((r2 && r2.data) || []).forEach(function (p) {
          if (!p.source_id || !(p.decision === 'include' || (p.overridden && p.decision !== 'exclude'))) return;
          var t = titleById[p.study_id] || 'Study';
          if (!m[p.source_id]) m[p.source_id] = [];
          if (m[p.source_id].indexOf(t) < 0) m[p.source_id].push(t);
        });
        setStudyInc(m);
      }, function () { });
    }, [(props.studies || []).map(function (s) { return s.id + ':' + (s.title || ''); }).join('|'), (props.sources || []).length]);
    var saved = {}; (props.sources || []).forEach(function (s) { if (s.ext_id) saved[s.ext_id] = true; });
    function setF(k, v) { var o = {}; o[k] = v; setFlt(Object.assign({}, flt, o)); }
    function buildFilter(f) {
      var p = [];
      var mc = parseInt(f.minCites, 10); if (mc > 0) p.push('cited_by_count:>' + (mc - 1));
      var fy = parseInt(f.fromYear, 10); if (fy > 1800) p.push('from_publication_date:' + fy + '-01-01');
      if (f.indexed) p.push('primary_location.source.is_core:true');
      if (f.oa) p.push('open_access.is_oa:true');
      if (f.journals) p.push('primary_location.source.type:journal');
      return p.join(',');
    }
    function runSearch(f) {
      if (!query.trim()) return;
      setBusy(true); setResults(null);
      var email = (BE.user && BE.user.email) || 'research@publify.app';
      var url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query.trim()) + '&per-page=25&mailto=' + encodeURIComponent(email);
      var fs = buildFilter(f || flt); if (fs) url += '&filter=' + fs.replace(/>/g, '%3E');
      fetch(url).then(function (x) { return x.json(); }).then(function (j) { setBusy(false); setResults((j && j.results) || []); }, function () { setBusy(false); setResults([]); });
    }
    // re-run automatically when a filter changes (only after the first search)
    useEffect(function () { if (results !== null) runSearch(flt); }, [flt.minCites, flt.fromYear, flt.indexed, flt.oa, flt.journals]);
    function venueOf(w) { return (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || ''; }
    function add(w) {
      var authors = (w.authorships || []).slice(0, 8).map(function (a) { return a.author && a.author.display_name; }).filter(Boolean);
      sb.from('research_sources').insert({ project_id: props.projectId, source_api: 'openalex', ext_id: w.id, doi: w.doi || null, title: w.display_name || 'Untitled', authors: authors.length ? authors : null, year: w.publication_year || null, venue: venueOf(w) || null, abstract: abstractFromInverted(w.abstract_inverted_index), cited_by: w.cited_by_count, url: w.doi || w.id, screening: 'unscreened' }).then(function (res) { if (res && res.error) { if (!/duplicate|unique/i.test(res.error.message)) window.PRUI.toast(res.error.message, { kind: 'error' }); return; } props.onChanged(); });
    }
    function setScreen(s, v) { sb.from('research_sources').update({ screening: v }).eq('id', s.id).then(props.onChanged); }
    function del(s) { sb.from('research_sources').delete().eq('id', s.id).then(props.onChanged); }
    var lib = (props.sources || []).slice().sort(function (a, b) { return ((studyInc[b.id] && studyInc[b.id].length) ? 1 : 0) - ((studyInc[a.id] && studyInc[a.id].length) ? 1 : 0); });   // study-selected sources first
    var hasSci = scimap && Object.keys(scimap).length > 0;
    var shown = results ? (scopusMax ? results.filter(function (w) { var qq = scopusQ(scimap, w); return qq != null && qq <= scopusMax; }) : results) : null;
    // ---- Redesigned Library (New design flag): filter sidebar + dense sortable table, wired to the SAME props.sources / setScreen / del ----
    function libScreenOf(s) { return (s.screening === 'include' || s.screening === 'maybe' || s.screening === 'exclude') ? s.screening : 'unscreened'; }
    function libQOf(s) { return quartileFromIssn(scimap, s.issn); }   // 1..4 or null (derived from ISSN via SCImago map)
    function libNewBody() {
      var counts = { all: lib.length, include: 0, maybe: 0, exclude: 0, unscreened: 0 };
      lib.forEach(function (s) { counts[libScreenOf(s)]++; });
      var rows = lib.filter(function (s) {
        if (libScreen !== 'all' && libScreenOf(s) !== libScreen) return false;
        if (libQmax) { var q = libQOf(s); if (!(q && q <= libQmax)) return false; }
        return true;
      });
      var SK = libSort.key, dir = libSort.dir;
      var SORD = { include: 0, maybe: 1, unscreened: 2, exclude: 3 };
      rows = rows.slice().sort(function (a, b) {
        if (SK === 'title') { var at = (a.title || '').toLowerCase(), bt = (b.title || '').toLowerCase(); return (at < bt ? -1 : at > bt ? 1 : 0) * dir; }
        var av, bv;
        if (SK === 'year') { av = a.year || 0; bv = b.year || 0; }
        else if (SK === 'q') { av = libQOf(a) || 9; bv = libQOf(b) || 9; }
        else if (SK === 'screen') { av = SORD[libScreenOf(a)]; bv = SORD[libScreenOf(b)]; }
        else { av = a.cited_by || 0; bv = b.cited_by || 0; }   // 'cites' (default)
        return (av - bv) * dir;
      });
      function sortTh(label, key, align) {
        var on = SK === key;
        return h('th', { className: 'rv-th sortable' + (align === 'r' ? ' r' : align === 'c' ? ' c' : ''), 'aria-sort': on ? (dir < 0 ? 'descending' : 'ascending') : null, onClick: function () { setLibSort(on ? { key: key, dir: -dir } : { key: key, dir: key === 'title' ? 1 : -1 }); } }, label, on ? h('span', { className: 'rv-caret' }, dir < 0 ? ' ▾' : ' ▴') : null);
      }
      var FILTERS = [['all', 'All'], ['include', 'Included'], ['maybe', 'Maybe'], ['exclude', 'Excluded'], ['unscreened', 'Unscreened']];
      return h('div', { className: 'rv-lib' },
        h('aside', { className: 'rv-lib-side' },
          h('div', { className: 'rv-fl' }, 'Filters'),
          h('div', { className: 'rv-fgrp' },
            h('div', { className: 'rv-fk' }, 'Decision'),
            FILTERS.map(function (f) { return h('button', { key: f[0], className: 'rv-chk' + (libScreen === f[0] ? ' on' : ''), 'aria-pressed': libScreen === f[0], onClick: function () { setLibScreen(f[0]); } }, h('span', null, f[1]), h('span', { className: 'n' }, String(counts[f[0]]))); })
          ),
          hasSci ? h('div', { className: 'rv-fgrp' },
            h('div', { className: 'rv-fk' }, 'Journal quartile'),
            [[0, 'Any'], [1, 'Q1'], [2, 'Q1–Q2'], [3, 'Q1–Q3'], [4, 'Q1–Q4']].map(function (o) { return h('button', { key: o[0], className: 'rv-chk' + (libQmax === o[0] ? ' on' : ''), 'aria-pressed': libQmax === o[0], onClick: function () { setLibQmax(o[0]); } }, h('span', null, o[1])); })
          ) : null
        ),
        h('div', { className: 'rv-lib-main' },
          rows.length ? h('div', { className: 'rv-tblwrap' }, h('table', { className: 'rv-ltable' },
            h('thead', null, h('tr', null,
              sortTh('Title', 'title', 'l'),
              h('th', { className: 'rv-th' }, 'Authors'),
              sortTh('Year', 'year', 'r'),
              h('th', { className: 'rv-th' }, 'Venue'),
              sortTh('Cites', 'cites', 'r'),
              hasSci ? sortTh('Q', 'q', 'c') : null,
              sortTh('Decision', 'screen', 'l'),
              props.canEdit ? h('th', { className: 'rv-th' }, '') : null
            )),
            h('tbody', null, rows.map(function (s) {
              var q = libQOf(s);
              return h('tr', { key: s.id, className: studyInc[s.id] ? 'rv-study' : null },
                h('td', { className: 'rv-ti' }, s.url ? h('a', { href: s.url, target: '_blank' }, s.title) : s.title,
                  (studyInc[s.id] && studyInc[s.id].length) ? h('span', { className: 'rv-instudy', title: 'Selected in study: ' + studyInc[s.id].join(', ') }, '★ in study') : null),
                h('td', { className: 'rv-au' }, (s.authors && s.authors.length) ? s.authors.slice(0, 3).join(', ') : '—'),
                h('td', { className: 'rv-n' }, s.year || '—'),
                h('td', { className: 'rv-ve' }, s.venue || '—'),
                h('td', { className: 'rv-n' }, s.cited_by != null ? s.cited_by : '–'),
                hasSci ? h('td', { className: 'rv-qc' }, q ? h('span', { className: 'rv-qb q' + q }, 'Q' + q) : h('span', { className: 'rv-qb q0' }, '–')) : null,
                h('td', null, props.canEdit
                  ? h('div', { className: 'seg rv-seg', role: 'group', 'aria-label': 'Screening decision' }, ['include', 'maybe', 'exclude'].map(function (v) { return h('button', { key: v, className: s.screening === v ? 'on' : '', 'aria-pressed': s.screening === v, 'aria-label': v, onClick: function () { setScreen(s, v); } }, v); }))
                  : h('span', { className: 'chip c-grey' }, s.screening || 'unscreened')),
                props.canEdit ? h('td', null, h('button', { className: 'icon-x', 'aria-label': 'Delete source', onClick: function () { del(s); } }, '✕')) : null
              );
            }))
          )) : h('div', { className: 'rv-empty' }, lib.length ? 'No sources match these filters.' : 'No sources saved yet — search above and Add.')
        )
      );
    }
    return h('div', null,
      h('div', { className: 'panel' },
        h('h3', null, 'Literature search', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'OpenAlex')),
        props.canEdit ? h('div', { className: 'addrow', style: { marginTop: 0 } },
          h('input', { className: 'grow', value: query, placeholder: 'Search papers (e.g. LiDAR out-of-distribution detection)…', onChange: function (e) { setQuery(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') runSearch(); } }),
          h('button', { className: 'btn pri', disabled: busy, onClick: function () { runSearch(); } }, busy ? 'Searching…' : 'Search')
        ) : null,
        props.canEdit ? h('div', { className: 'lfilters' },
          h('span', { className: 'flab' }, 'Min cites'), h('input', { className: 'num', type: 'number', min: 0, value: flt.minCites, onChange: function (e) { setF('minCites', e.target.value); } }),
          h('span', { className: 'flab' }, 'From year'), h('input', { className: 'num', type: 'number', value: flt.fromYear, placeholder: 'YYYY', onChange: function (e) { setF('fromYear', e.target.value); } }),
          h('button', { className: 'lchip' + (flt.indexed ? ' on' : ''), 'aria-pressed': flt.indexed, title: 'Only indexed core sources (Scopus/WoS-level)', onClick: function () { setF('indexed', !flt.indexed); } }, '✓ Indexed'),
          h('button', { className: 'lchip' + (flt.oa ? ' on' : ''), 'aria-pressed': flt.oa, onClick: function () { setF('oa', !flt.oa); } }, 'Open access'),
          h('button', { className: 'lchip' + (flt.journals ? ' on' : ''), 'aria-pressed': flt.journals, onClick: function () { setF('journals', !flt.journals); } }, 'Journals only'),
          hasSci ? h('select', { className: 'num', style: { width: 'auto' }, value: scopusMax, title: 'Scopus quartile (SCImago)', onChange: function (e) { setScopusMax(parseInt(e.target.value, 10)); } }, h('option', { value: 0 }, 'Scopus: any'), h('option', { value: 1 }, 'Scopus Q1'), h('option', { value: 2 }, 'Scopus Q1–Q2'), h('option', { value: 3 }, 'Scopus Q1–Q3')) : null
        ) : null,
        (props.canEdit && myPubs.length) ? h('div', { style: { marginTop: 10, fontSize: 12.5, color: 'var(--muted)' } }, 'Add your own work: ', h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { setPubsOpen(true); } }, '📚 From my publications (' + myPubs.length + ')')) : null,
        results ? (shown.length ? shown.map(function (w) {
          var au = (w.authorships || []).slice(0, 3).map(function (a) { return a.author && a.author.display_name; }).filter(Boolean).join(', ');
          var nw = normWork(w); nw.scopus = scopusQ(scimap, w);
          return h('div', { className: 'src', style: { alignItems: 'flex-start' }, key: w.id },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('b', { style: { fontSize: 13 } }, w.display_name || 'Untitled'),
              au ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 1 } }, au) : null,
              metricTags(nw)
            ),
            saved[w.id] ? h('span', { className: 'chip c-ok' }, 'in library') : (props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: function () { add(w); } }, 'Add') : null)
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, scopusMax ? 'No results match the Scopus filter.' : 'No results.')) : null
      ),
      h('div', { className: 'panel' },
        h('h3', null, 'Library', h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, lib.length + ' source' + (lib.length === 1 ? '' : 's')),
          lib.length ? h('a', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, textDecoration: 'none' }, href: 'FigureBoard.html?project=' + encodeURIComponent(props.projectId), title: 'Extract figures from these papers onto an infinite canvas' }, '🖼 Figure Board') : null,
          lib.length ? h('a', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, textDecoration: 'none' }, href: 'CitationOptimizer.html?project=' + encodeURIComponent(props.projectId), title: 'Analyze what your top-cited included papers are cited FOR' }, '🔗 Citation Optimizer') : null,
          lib.length ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Export included (or all) as BibTeX', onClick: function () { var inc = lib.filter(function (x) { return x.screening === 'include'; }); downloadText('library.bib', genBibtex(inc.length ? inc : lib)); } }, '⬇ BibTeX') : null
        )),
        nd() ? libNewBody() : (lib.length ? lib.map(function (s) {
          return h('div', { className: 'src' + (studyInc[s.id] ? ' src-study' : ''), style: { alignItems: 'flex-start' }, key: s.id },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('b', { style: { fontSize: 13 } }, s.url ? h('a', { href: s.url, target: '_blank' }, s.title) : s.title),
              (studyInc[s.id] && studyInc[s.id].length) ? h('span', { className: 'chip c-acc', style: { marginLeft: 7, fontSize: 10, verticalAlign: 'middle', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }, title: 'Selected in study: ' + studyInc[s.id].join(', ') }, '★ in study: ' + studyInc[s.id].join(', ')) : null,
              (s.authors && s.authors.length) ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 1 } }, s.authors.slice(0, 3).join(', ')) : null,
              metricTags({ journal: s.venue, year: s.year, cites: s.cited_by })
            ),
            props.canEdit ? h('div', { className: 'seg', role: 'group', 'aria-label': 'Screening decision', style: { flex: 'none' } }, ['include', 'maybe', 'exclude'].map(function (v) { return h('button', { key: v, className: s.screening === v ? 'on' : '', 'aria-pressed': s.screening === v, 'aria-label': v, onClick: function () { setScreen(s, v); } }, v); })) : h('span', { className: 'chip c-grey' }, s.screening),
            props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Delete source', style: { flex: 'none' }, onClick: function () { del(s); } }, '✕') : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No sources saved yet — search above and Add.'))
      ),
      pubsOpen ? h(MyPubsModal, { pubs: myPubs, saved: saved, onAdd: addPub, onClose: function () { setPubsOpen(false); } }) : null
    );
  }

  // ---------- Data (R3) ----------
  var DS_SOURCES = ['url', 'upload', 'huggingface', 'kaggle', 'zenodo', 'openml', 'other'];
  function fmtBytes(n) { if (!n) return ''; var u = ['B', 'KB', 'MB', 'GB', 'TB']; var i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i]; }
  function DataPanel(props) {
    var f = useState({ name: '', source: 'url', uri: '', license: '' }), form = f[0], setForm = f[1];
    var u = useState(''), msg = u[0], setMsg = u[1];
    function up(k, v) { var o = {}; o[k] = v; setForm(Object.assign({}, form, o)); }
    function register() {
      if (!form.name.trim()) return;
      sb.from('research_datasets').insert({ project_id: props.projectId, name: form.name.trim(), source: form.source, uri: form.uri.trim() || null, license: form.license.trim() || null, status: 'registered', created_by: props.authorId }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } setForm({ name: '', source: 'url', uri: '', license: '' }); props.onChanged(); });
    }
    function onFile(e) {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      setMsg('Uploading ' + file.name + '…');
      var path = props.projectId + '/' + Date.now() + '_' + file.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(path, file).then(function (res) {
        if (res.error) { setMsg('Upload failed: ' + res.error.message); return; }
        sb.from('research_datasets').insert({ project_id: props.projectId, name: file.name, source: 'upload', uri: path, size_bytes: file.size, status: 'ready', created_by: props.authorId }).then(function (r) { setMsg(''); if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } props.onChanged(); });
      });
    }
    function del(d) { if (d.source === 'upload' && d.uri) sb.storage.from('research-data').remove([d.uri]); sb.from('research_datasets').delete().eq('id', d.id).then(props.onChanged); }
    var ds = props.datasets || [];
    var stCls = { ready: 'c-ok', downloading: 'c-warn', error: 'c-danger', registered: 'c-grey' };
    return h('div', null,
      props.canEdit ? h('div', { className: 'panel' }, h('h3', null, 'Add data'),
        h('div', { className: 'addrow', style: { marginTop: 0 } },
          h('input', { className: 'grow', value: form.name, placeholder: 'Dataset name', onChange: function (e) { up('name', e.target.value); } }),
          h('select', { value: form.source, onChange: function (e) { up('source', e.target.value); } }, DS_SOURCES.map(function (s) { return h('option', { key: s, value: s }, s); })),
          h('input', { className: 'grow', value: form.uri, placeholder: 'URL / identifier (e.g. hf: user/dataset)', onChange: function (e) { up('uri', e.target.value); } }),
          h('input', { value: form.license, placeholder: 'License', style: { width: 110 }, onChange: function (e) { up('license', e.target.value); } }),
          h('button', { className: 'btn pri', onClick: register }, 'Register')
        ),
        h('div', { style: { marginTop: 10, fontSize: 12.5, color: 'var(--muted)' } }, 'Or upload a file: ', h('input', { type: 'file', onChange: onFile }), msg ? h('span', { style: { marginLeft: 8 } }, msg) : null),
        h('div', { style: { marginTop: 6, fontSize: 11.5, color: 'var(--faint)' } }, 'Registered external datasets are fetched by the self-hosted worker (a download job).')
      ) : null,
      h('div', { className: 'panel' }, h('h3', null, 'Datasets', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, ds.length + '')),
        ds.length ? ds.map(function (d) {
          return h('div', { className: 'src', key: d.id },
            h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: 13 } }, d.name), h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, [d.source, d.uri, fmtBytes(d.size_bytes), d.license].filter(Boolean).join(' · '))),
            h('span', { className: 'chip ' + (stCls[d.status] || 'c-grey') }, d.status),
            props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Delete dataset', onClick: function () { del(d); } }, '✕') : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No datasets yet — register a source or upload a file.')
      )
    );
  }

  // ---------- Compute (R4) ----------
  var JOB_TYPES = ['python', 'stats', 'download'];
  function ComputePanel(props) {
    var t = useState('python'), type = t[0], setType = t[1];
    var ti = useState(''), title = ti[0], setTitle = ti[1];
    var c = useState('print(2 + 2)'), code = c[0], setCode = c[1];
    var d = useState(''), datasetId = d[0], setDatasetId = d[1];
    var ex = useState(null), exp = ex[0], setExp = ex[1];
    function submit() {
      var spec = type === 'python' ? { code: code } : { dataset_id: datasetId };
      if (type !== 'python' && !datasetId) { window.PRUI.toast('Pick a dataset.', { kind: 'error' }); return; }
      sb.from('research_jobs').insert({ project_id: props.projectId, type: type, title: title.trim() || (type + ' job'), spec: spec, status: 'queued', created_by: props.authorId }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } setTitle(''); props.onChanged(); });
    }
    function cancel(j) { sb.from('research_jobs').update({ status: 'canceled' }).eq('id', j.id).then(props.onChanged); }
    function del(j) { sb.from('research_jobs').delete().eq('id', j.id).then(props.onChanged); }
    var jobs = props.jobs || [], datasets = props.datasets || [];
    var stCls = { done: 'c-ok', running: 'c-warn', queued: 'c-grey', error: 'c-danger', canceled: 'c-grey' };
    return h('div', null,
      props.canEdit ? h('div', { className: 'panel' }, h('h3', null, 'Submit a compute job', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'self-hosted worker')),
        h('div', { className: 'addrow', style: { marginTop: 0 } },
          h('input', { className: 'grow', value: title, placeholder: 'Job title', onChange: function (e) { setTitle(e.target.value); } }),
          h('select', { value: type, onChange: function (e) { setType(e.target.value); } }, JOB_TYPES.map(function (x) { return h('option', { key: x, value: x }, x); }))
        ),
        type === 'python'
          ? h('textarea', { value: code, onChange: function (e) { setCode(e.target.value); }, rows: 5, style: { width: '100%', marginTop: 8, border: '1px solid var(--line)', borderRadius: 9, padding: '9px 11px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 } })
          : h('select', { value: datasetId, style: { marginTop: 8, width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontFamily: 'inherit' }, onChange: function (e) { setDatasetId(e.target.value); } }, [h('option', { key: '', value: '' }, 'Choose a dataset…')].concat(datasets.map(function (ds) { return h('option', { key: ds.id, value: ds.id }, ds.name); }))),
        h('div', { style: { marginTop: 8 } }, h('button', { className: 'btn pri', onClick: submit }, 'Queue job')),
        h('div', { style: { marginTop: 6, fontSize: 11.5, color: 'var(--faint)' } }, 'Jobs run on your self-hosted worker (worker/README.md). Results return here when done.')
      ) : null,
      h('div', { className: 'panel' }, h('h3', null, 'Jobs', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, jobs.length + '')),
        jobs.length ? jobs.map(function (j) {
          return h('div', { key: j.id, style: { padding: '10px 0', borderBottom: '1px solid var(--soft)' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: 13 } }, j.title), h('span', { style: { fontSize: 11.5, color: 'var(--muted)', marginLeft: 6 } }, j.type)),
              j.status === 'running' && j.progress ? h('span', { style: { fontSize: 11, color: 'var(--muted)' } }, j.progress + '%') : null,
              h('span', { className: 'chip ' + (stCls[j.status] || 'c-grey') }, j.status),
              (j.result || j.logs) ? h('button', { className: 'icon-x', 'aria-label': 'Details', 'aria-expanded': exp === j.id, style: { color: 'var(--muted)' }, title: 'Details', onClick: function () { setExp(exp === j.id ? null : j.id); } }, exp === j.id ? '▾' : '▸') : null,
              props.canEdit && j.status === 'queued' ? h('button', { className: 'chip c-grey', onClick: function () { cancel(j); } }, 'Cancel') : null,
              props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Delete job', onClick: function () { del(j); } }, '✕') : null
            ),
            exp === j.id ? h('pre', { style: { marginTop: 8, background: 'var(--softer)', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 11.5, overflow: 'auto', maxHeight: 220, whiteSpace: 'pre-wrap' } }, (j.result ? JSON.stringify(j.result, null, 2) + '\n\n' : '') + (j.logs || '')) : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No jobs yet — queue one above.')
      )
    );
  }

  // ---------- Writing (R6 bridge) ----------
  function WritingPanel(props) {
    var p = props.project; var pid = p.id; var ce = props.canEdit;
    var inc = (props.sources || []).filter(function (s) { return s.screening === 'include'; });
    var pkS = useState([]), picks = pkS[0], setPicks = pkS[1];
    var jS = useState(''), jid = jS[0], setJid = jS[1];
    var phS = useState(''), phase = phS[0], setPhase = phS[1];      // '', outline, sections, assemble, done
    var pgS = useState(''), prog = pgS[0], setProg = pgS[1];
    var drS = useState(null), draft = drS[0], setDraft = drS[1];
    var busy = phase === 'outline' || phase === 'sections' || phase === 'assemble';
    useEffect(function () {
      sb.from('research_journal_picks').select('id,title,status,npi_level,template').eq('project_id', pid).order('created_at').then(function (r) {
        var d = (r && r.data) || []; setPicks(d); var pick = d.filter(function (x) { return x.status === 'submitted'; })[0] || d[0]; if (pick) setJid(pick.id);
      });
      sb.from('research_drafts').select('id,title,outline,sections,files,created_at').eq('project_id', pid).order('created_at', { ascending: false }).limit(1).then(function (r) { var row = r && r.data && r.data[0]; if (row) setDraft({ id: row.id, outline: row.outline, sections: row.sections, files: row.files, existing: true }); });
    }, [pid]);

    function bibOf(lit) { return (lit || []).map(function (l) { var au = Array.isArray(l.authors) ? l.authors.join(' and ') : (l.authors || ''); return '@article{' + l.key + ',\n  title={' + (l.title || '') + '},\n  author={' + au + '},\n  year={' + (l.year || '') + '},\n  journal={' + (l.venue || '') + '}' + (l.doi ? ',\n  doi={' + l.doi + '}' : '') + '\n}'; }).join('\n\n'); }
    function buildMain(outline, context, drafted, figList) {
      var J = context.journal || {};
      var body = drafted.map(function (s) { return s.latex; }).join('\n\n');
      // safety net: guarantee EVERY figure appears — collect referenced \includegraphics, append any that were missed
      var referenced = {}; var re = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g; var mm;
      while ((mm = re.exec(body))) { var b = mm[1].split('/').pop().replace(/\.[^.]+$/, ''); referenced[b] = 1; }
      var missing = (figList || []).filter(function (f) { return !referenced[f.key]; });
      if (missing.length) body += '\n\n\\section{Additional figures}\n' + missing.map(function (f) { return '\\begin{figure}[htbp]\\centering\\includegraphics[width=\\linewidth]{' + f.key + '.png}\\caption{' + (f.caption || '') + '}\\label{fig:' + f.key + '}\\end{figure}'; }).join('\n');
      // inline bibliography (no natbib / no BibTeX pass needed → compiles standalone in the browser engine)
      function texEsc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}'); }
      var lit = context.literature || [];
      var thebib = lit.length ? ('\\begin{thebibliography}{' + lit.length + '}\n' + lit.map(function (l) {
        var au = Array.isArray(l.authors) ? l.authors.join(', ') : (l.authors || '');
        return '\\bibitem{' + l.key + '} ' + (au ? texEsc(au) + '. ' : '') + (l.title ? texEsc(l.title) + '. ' : '') + (l.venue ? '\\textit{' + texEsc(l.venue) + '}. ' : '') + (l.year ? l.year + '.' : '') + (l.doi ? ' doi:' + texEsc(l.doi) + '.' : '');
      }).join('\n') + '\n\\end{thebibliography}') : '';
      return '% AI-generated draft — VERIFY every claim, number and citation against your real artifacts before use.\n' +
        '% Intended journal: ' + (J.name || '—') + '  (template family: ' + (J.family || 'generic') + '). Written with the best model (Claude Opus).\n' +
        '% To match the journal format, swap \\documentclass to the journal class and add its .cls to this project.\n' +
        '\\documentclass[a4paper,11pt]{article}\n\\usepackage{graphicx,amsmath,amssymb,booktabs,hyperref}\n' +
        '\\title{' + (outline.title || p.title || 'Untitled') + '}\n\\author{[TODO: author names and affiliations]}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n' +
        '\\begin{abstract}\n' + (outline.abstract || '[TODO: abstract]') + '\n\\end{abstract}\n' +
        ((outline.keywords && outline.keywords.length) ? '\\noindent\\textbf{Keywords:} ' + outline.keywords.join(', ') + '\n\n' : '\n') +
        body + '\n\n' + thebib + '\n\\end{document}\n';
    }
    function assemble(outline, context, drafted) {
      sb.from('research_protocols').select('id').eq('project_id', pid).neq('status', 'archived').order('created_at', { ascending: false }).limit(1).then(function (pr) {
        var prot = pr && pr.data && pr.data[0];
        var finish = function (figMap) {
          var figList = (context.figures || []).filter(function (f) { return figMap[f.key] && figMap[f.key].img; });   // deduped figures with images
          if (!figList.length) figList = Object.keys(figMap).map(function (k) { return { key: k, caption: figMap[k].caption }; });
          var files = {}; files['main.tex'] = { type: 'tex', content: buildMain(outline, context, drafted, figList) };
          files['refs.bib'] = { type: 'bib', content: bibOf(context.literature) };
          figList.forEach(function (f) { files[f.key + '.png'] = { type: 'image', content: figMap[f.key].img }; });
          sb.from('research_drafts').insert({ project_id: pid, journal_pick_id: jid || null, title: outline.title, journal: (context.journal && context.journal.name) || null, outline: outline, sections: drafted, files: files, status: 'ready', model: 'claude-opus-4-8', created_by: props.authorId }).select().then(function (r) {
            if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); setPhase(''); return; }
            var row = r && r.data && r.data[0]; setDraft({ id: row && row.id, outline: outline, sections: drafted, files: files }); setPhase('done'); setProg('');
            window.PRUI.toast('Draft ready — open it in the LaTeX editor', { kind: 'ok' });
          });
        };
        if (!prot) return finish({});
        sb.from('research_protocol_steps').select('ord,result').eq('protocol_id', prot.id).order('ord').then(function (sr) {
          var figMap = {}; ((sr && sr.data) || []).forEach(function (s) { ((s.result && s.result.figures) || []).forEach(function (f, i) { if (f.img) figMap['fig_' + s.ord + '_' + (i + 1)] = { img: f.img, caption: f.title || ('Figure from step ' + s.ord) }; }); }); finish(figMap);
        });
      });
    }
    function generate() {
      if (busy) return; setDraft(null); setPhase('outline'); setProg('Planning the outline (best model)…');
      sb.functions.invoke('research-writing', { body: { action: 'outline', project_id: pid, journal_pick_id: jid || null } }).then(function (r) {
        var d = r && r.data; if (!d || d.error) { window.PRUI.toast('Outline failed: ' + ((d && d.error) || (r && r.error && r.error.message) || ''), { kind: 'error' }); setPhase(''); return; }
        var outline = d.outline || {}, context = d.context || {}; var secs = outline.sections || [];
        if (!secs.length) { window.PRUI.toast('No sections planned', { kind: 'error' }); setPhase(''); return; }
        setPhase('sections'); setProg('Drafting ' + secs.length + ' sections with the best model…');
        Promise.all(secs.map(function (s) {
          return sb.functions.invoke('research-writing', { body: { action: 'section', project_id: pid, section: s, context: context } }).then(function (rr) {
            return { key: s.key, heading: s.heading, latex: (rr && rr.data && rr.data.latex) || ('\\section{' + (s.heading || s.key) + '}\n% [generation failed for this section]') };
          }, function () { return { key: s.key, heading: s.heading, latex: '\\section{' + (s.heading || s.key) + '}\n% [generation failed]' }; });
        })).then(function (drafted) { setPhase('assemble'); setProg('Assembling the LaTeX project…'); assemble(outline, context, drafted); });
      }, function (e) { window.PRUI.toast('Outline failed: ' + e, { kind: 'error' }); setPhase(''); });
    }
    function dl(name, content) { var u = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); var a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); }

    var selPick = picks.filter(function (x) { return x.id === jid; })[0];
    var nFig = draft && draft.files ? Object.keys(draft.files).filter(function (k) { return /\.png$/.test(k); }).length : 0;
    return h('div', null,
      h('div', { className: 'panel' },
        h('h3', { style: { marginTop: 0 } }, '✍️ Writing — draft manuscript'),
        h('p', { style: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 } }, 'Assembles a full draft paper from your executed results + the selected journal, with the best model (Claude Opus), grounded only in your real results (no invented numbers). The draft opens as a compilable project in the LaTeX editor.'),
        picks.length ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } },
          h('span', { className: 'field-label', style: { margin: 0 } }, 'Target journal'),
          h('select', { className: 'field', style: { minWidth: 220 }, value: jid, onChange: function (e) { setJid(e.target.value); } },
            picks.map(function (x) { return h('option', { key: x.id, value: x.id }, x.title + (x.status === 'submitted' ? ' ✓' : '')); }))
        ) : h('div', { style: { fontSize: 12.5, color: 'var(--warn)', marginBottom: 8 } }, '⚠ No journal selected yet — pick one on the Journal step first (the draft still generates, but without journal-specific formatting).'),
        h('div', { style: { fontSize: 12, color: 'var(--faint)', marginBottom: 10 } }, 'Inputs: your protocol results & figures, ' + inc.length + ' included reference' + (inc.length === 1 ? '' : 's') + (selPick ? ', journal “' + selPick.title + '”' + (selPick.template && selPick.template.family ? ' (' + selPick.template.family + ')' : '') : '') + '.'),
        ce ? h('button', { className: 'btn pri', disabled: busy, onClick: generate }, busy ? '✨ Working…' : '✨ Generate draft (AutoMode)') : null,
        busy ? h('div', { style: { marginTop: 10 } }, h(AiThinking, { label: prog || 'Writing your manuscript' })) : null
      ),
      draft ? h('div', { className: 'panel' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0, flex: 1, minWidth: 160 } }, '📄 ', (draft.outline && draft.outline.title) || draft.title || 'Draft'),
          draft.id ? h('a', { className: 'btn pri', style: { textDecoration: 'none', padding: '5px 12px' }, href: 'ProofReader.html?draft=' + draft.id }, '📝 Open in LaTeX editor') : null,
          draft.files && draft.files['main.tex'] ? h('button', { className: 'btn', style: { padding: '5px 12px' }, onClick: function () { dl('main.tex', draft.files['main.tex'].content); } }, '⬇ main.tex') : null,
          draft.files && draft.files['refs.bib'] ? h('button', { className: 'btn', style: { padding: '5px 12px' }, onClick: function () { dl('refs.bib', draft.files['refs.bib'].content); } }, '⬇ refs.bib') : null),
        draft.existing ? h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 2 } }, 'Previously generated draft. Re-generate to refresh.') : null,
        (draft.outline && draft.outline.abstract) ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 } }, h('b', null, 'Abstract. '), draft.outline.abstract) : null,
        (draft.sections && draft.sections.length) ? h('div', { style: { marginTop: 10 } }, h('b', { style: { fontSize: 12 } }, 'Sections:'), h('ol', { style: { margin: '4px 0', paddingLeft: 20, fontSize: 12.5 } }, draft.sections.map(function (s, i) { return h('li', { key: i }, s.heading || s.key); }))) : null,
        nFig ? h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 4 } }, nFig + ' figure' + (nFig === 1 ? '' : 's') + ' included.') : null
      ) : null
    );
  }

  // ---------- Literature Study (Elicit-style 4-step funnel) ----------
  var LS_STEPS = [{ step: 1, kind: 'quick', label: '1. Quick' }, { step: 2, kind: 'abstract', label: '2. Abstract' }, { step: 3, kind: 'fulltext', label: '3. Full text' }, { step: 4, kind: 'review', label: '4. Review' }];
  // Mirror of the server's screenSystem() — the exact screening prompt Publify gets for steps 1–3, built from
  // the question + the current keywords/criteria. Lets the user preview (and re-generate after editing) it.
  function buildScreenPrompt(question, cfg, step) {
    cfg = cfg || {}; step = step || 1;
    var kws = (cfg.keywords || []).filter(Boolean);
    var inc = (cfg.include || []).filter(Boolean);
    var exc = (cfg.exclude || []).filter(Boolean);
    var head = 'Research question: ' + (question || '(none given)') + '\n'
      + (kws.length ? 'Keywords: ' + kws.join(', ') + '\n' : '')
      + (inc.length ? 'Inclusion criteria (the paper should plausibly satisfy ALL): ' + inc.join('; ') + '\n' : '')
      + (exc.length ? 'Exclusion criteria (exclude if ANY clearly holds): ' + exc.join('; ') + '\n' : '');
    if (step >= 2) {
      var basis = step === 3 ? 'the FULL TEXT (the attached PDF when present, otherwise the abstract)' : 'the ABSTRACT';
      return 'You are doing RIGOROUS ' + (step === 3 ? 'full-text' : 'abstract') + ' screening for a systematic literature review. This step NARROWS the set — be DISCERNING, not inclusive.\n'
        + head
        + 'Judge each paper strictly from ' + basis + ':\n'
        + '- "include" ONLY if the text gives EXPLICIT evidence it plausibly meets ALL inclusion criteria;\n'
        + '- "exclude" if any exclusion criterion clearly holds, or it does not actually address the research question;\n'
        + '- "maybe" only when the text is genuinely ambiguous (e.g. no abstract is available).\n'
        + 'For each paper return: decision, score, the inclusion criteria it MEETS + any exclusion criteria that APPLY, '
        + 'and a short extract (method, dataset, key finding) from the text, plus a one-line reason. Return ONLY a JSON array.';
    }
    return 'You are screening papers for a systematic literature review.\n'
      + head
      + 'For each paper decide: "include" (relevant to the question and plausibly meets the inclusion criteria), '
      + '"maybe" (relevant but you are genuinely unsure it meets a criterion), or "exclude" (off-topic, or clearly '
      + 'violates an exclusion criterion). This is a screening FUNNEL — be inclusive here; later steps narrow '
      + 'further. Prefer "maybe" over "exclude" when uncertain. Give a one-line reason, a 0..100 relevance score, '
      + 'and detect signals has_github (a public code repo) and has_dataset (a public dataset).\n'
      + 'Return ONLY a JSON array, one object per paper.';
  }
  // criteria editor — each include/exclude criterion is its own small card (add / remove) instead of a lumped
  // textarea. accent = green for inclusion, red for exclusion. To edit a criterion, remove it and add a new one.
  function CritEditor(props) {
    var nS = useState(''), nv = nS[0], setNv = nS[1];
    var items = props.items || [];
    function add() { var v = nv.trim(); if (!v) return; props.onChange(items.concat([v])); setNv(''); }
    function rm(i) { props.onChange(items.filter(function (_, j) { return j !== i; })); }
    return h('div', null,
      items.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 6 } },
        items.map(function (it, i) {
          return h('div', { key: i, style: { display: 'flex', gap: 6, alignItems: 'flex-start', background: 'var(--surface-2)', border: '1px solid var(--line)', borderLeft: '3px solid ' + (props.accent || 'var(--accent)'), borderRadius: 7, padding: '5px 9px' } },
            h('span', { style: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, it),
            props.disabled ? null : h('button', { className: 'icon-x', 'aria-label': 'Delete criterion', style: { flex: 'none' }, title: 'Delete', onClick: function () { rm(i); } }, '✕')
          );
        })
      ) : h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 } }, props.empty || 'No criteria.'),
      props.disabled ? null : h('div', { style: { display: 'flex', gap: 6 } },
        h('input', { className: 'field', style: { flex: 1, minWidth: 0, fontSize: 12.5 }, value: nv, placeholder: props.placeholder, onChange: function (e) { setNv(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } } }),
        h('button', { className: 'btn', style: { flex: 'none', padding: '4px 10px', fontSize: 12 }, onClick: add }, '+ Add')
      )
    );
  }
  function lsDefaultConfig(step, project, idea) {
    if (step !== 1) return { keywords: [], include: [], exclude: [], filters: {}, signals: ['has_github', 'has_dataset'] };
    // seed a natural-language semantic query from the idea (question + hypothesis) → project goal/title
    var sq = (idea && String((idea.question || '') + (idea.hypothesis ? '\n\nHypothesis: ' + idea.hypothesis : '')).trim()) || (project && (project.goal || project.title)) || '';
    return { keywords: (project && project.keywords) || [], include: [], exclude: [], filters: { fromYear: '', minCites: '', oa: false, journals: true }, signals: ['has_github', 'has_dataset'], source_adapter: 'openalex', max_results: 150, semantic_query: String(sq).slice(0, 350) };
  }
  function callStudy(body) {
    var CFG = window.PR_CONFIG || {};
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/research-study', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return { error: 'The server response could not be parsed (possibly a timeout) — try again.' }; }); }, function () { return { error: 'network' }; });
    });
  }
  // ---- Elicit automated reports (Phase 2) — calls the elicit-proxy edge function ----
  function callElicit(body) {
    var CFG = window.PR_CONFIG || {};
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/elicit-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return { error: 'bad response' }; }); }, function () { return { error: 'network' }; });
    });
  }
  var EL_STAGE = { gathering_sources: 'Gathering sources', screening_abstract: 'Screening abstracts', screening_fulltext: 'Screening full text', extracting_data: 'Extracting data', generating_report: 'Writing report', done: 'Finishing' };
  function ElicitReports(props) {
    var canUse = !!(window.PREnt && window.PREnt.loaded() && window.PREnt.can('elicit_reports'));
    var jsS = useState(null), jobs = jsS[0], setJobs = jsS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var buS = useState(false), busy = buS[0], setBusy = buS[1];
    var erS = useState(''), err = erS[0], setErr = erS[1];
    var opS = useState(null), openReport = opS[0], setOpenReport = opS[1];
    var bkS = useState(null), backup = bkS[0], setBackup = bkS[1];   // Claude-backup Study driver state (Elicit quota fallback)
    var ofS = useState(''), offer = ofS[0], setOffer = ofS[1];       // the failed research-question, offered for the backup
    var alive = useRef(true);
    function load() { callElicit({ action: 'report.list', project_id: props.projectId }).then(function (d) { if (alive.current) setJobs((d && d.jobs) || []); }); }
    useEffect(function () { alive.current = true; if (canUse) load(); return function () { alive.current = false; }; }, [canUse]);
    // poll non-terminal jobs every 12s
    useEffect(function () {
      if (!jobs || !jobs.length) return;
      var running = jobs.filter(function (j) { return j.status !== 'completed' && j.status !== 'failed'; });
      if (!running.length) return;
      var iv = setInterval(function () {
        running.forEach(function (j) {
          callElicit({ action: 'job.status', job_id: j.id }).then(function (d) {
            if (!alive.current || !d || !d.job) return;
            setJobs(function (list) { return (list || []).map(function (x) { return x.id === j.id ? Object.assign({}, x, d.job) : x; }); });
          });
        });
      }, 12000);
      return function () { clearInterval(iv); };
    }, [jobs && jobs.map(function (j) { return j.id + j.status; }).join(',')]);
    function create() {
      var rq = q.trim(); if (!rq) return; setBusy(true); setErr(''); setOffer('');
      callElicit({ action: 'report.create', researchQuestion: rq, project_id: props.projectId, title: (props.project && props.project.title) || null }).then(function (d) {
        setBusy(false);
        if (!d || d.error) { var em = (d && d.error) || 'Could not start the report.'; setErr(em); if (/quota|limit|rate|napi|daily|budget/i.test(String(em))) setOffer(rq); return; }
        setQ(''); if (d.deduped) setErr('A report for this question is already in progress.'); load();
      });
    }
    function resume(j) { callElicit({ action: 'job.resume', job_id: j.id }).then(function (d) { if (d && d.error) setErr(d.error); load(); }); }

    // ---- Claude backup: no Elicit quota → run the built-in Claude+OpenAlex Study funnel for the same question ----
    var BK_STAGE = { setup: 'Study előkészítése', s1: 'Keresés + gyors triage (OpenAlex)', s2: 'Absztrakt-szűrés (Claude)', s3: 'Full-text szűrés (Claude)', review: 'Áttekintés írása (Claude)' };
    function runBackup(rq) {
      if (!rq || (backup && /^s|setup|review/.test(backup.stage))) return;
      setOffer(''); setErr(''); setBackup({ stage: 'setup', msg: 'Study létrehozása…' });
      var uid = props.authorId;
      sb.from('research_studies').insert({ project_id: props.projectId, idea_id: null, title: rq.slice(0, 80), question: rq.slice(0, 4000), created_by: uid }).select('id').maybeSingle().then(function (sr) {
        var sid = sr && sr.data && sr.data.id;
        if (!sid) { setBackup({ stage: 'error', msg: 'A study nem jött létre' + (sr && sr.error ? ': ' + sr.error.message : '') }); return; }
        var rows = LS_STEPS.map(function (s) { return { study_id: sid, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, props.project, null) }; });
        sb.from('research_study_steps').insert(rows).then(function (rr) {
          if (rr && rr.error) { setBackup({ stage: 'error', msg: 'study-lépések: ' + rr.error.message, sid: sid }); return; }
          callStudy({ action: 'plan', study_id: sid }).then(function () { driveFunnel(rq, sid, 's1', 0, 0); }, function () { driveFunnel(rq, sid, 's1', 0, 0); });
        });
      });
    }
    function driveFunnel(rq, sid, stage, offset, iter) {
      if (!alive.current) return;
      if (stage === 'review') {
        setBackup({ stage: 'review', msg: BK_STAGE.review + '…', sid: sid });
        callStudy({ action: 'generate_review', study_id: sid }).then(function (d) {
          if (!alive.current) return;
          if (d && d.error) { if (/full-?text|passed|include/i.test(d.error)) setBackup({ stage: 'done', msg: 'A szűrés nem talált full-text included cikket — a részletek a Study fülön.', sid: sid }); else setBackup({ stage: 'error', msg: 'Review: ' + d.error, sid: sid }); return; }
          var fp = d && d.file_path;
          setBackup({ stage: 'done', msg: '✓ Kész' + (d && d.words ? ' — ~' + d.words + ' szó' : ''), sid: sid, filePath: fp });
          if (fp) sb.from('research_files').select('content').eq('project_id', props.projectId).eq('path', fp).maybeSingle().then(function (fr) { var c = fr && fr.data && fr.data.content; if (c && alive.current) setOpenReport({ result_title: 'Claude backup: ' + rq.slice(0, 90), result_body: c }); });
        }, function () { setBackup({ stage: 'error', msg: 'A review-hívás nem sikerült.', sid: sid }); });
        return;
      }
      setBackup({ stage: stage, msg: (BK_STAGE[stage] || stage) + '…', sid: sid });
      var act = stage === 's1' ? { action: 'search_step1', study_id: sid, step: 1, offset: offset } : { action: 'screen_batch', study_id: sid, step: (stage === 's2' ? 2 : 3), offset: offset };
      callStudy(act).then(function (d) {
        if (!alive.current) return;
        if (d && d.error) { setBackup({ stage: 'error', msg: (BK_STAGE[stage] || stage) + ': ' + d.error, sid: sid }); return; }
        var dflt = stage === 's1' ? 20 : (stage === 's2' ? 8 : 3), ni = iter + 1;
        if (d.done || ni > 40) driveFunnel(rq, sid, stage === 's1' ? 's2' : stage === 's2' ? 's3' : 'review', 0, 0);
        else driveFunnel(rq, sid, stage, (d.next_offset != null ? d.next_offset : offset + dflt), ni);
      }, function () { setBackup({ stage: 'error', msg: 'Hálózati hiba a szűrés közben.', sid: sid }); });
    }
    function saveToFiles(j) {
      if (!j.result_body) return;
      var path = 'reports/elicit-' + String(j.id || '').slice(0, 8) + '.md';
      sb.from('research_files').upsert({ project_id: props.projectId, path: path, content: '# ' + (j.result_title || 'Publify report') + '\n\n' + j.result_body, mime: 'text/markdown', size: j.result_body.length, source: 'ai', updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (r) { setErr(r && r.error ? r.error.message : '✓ Saved to project files: ' + path); });
    }
    function card(j) {
      var done = j.status === 'completed', failed = j.status === 'failed', paused = j.status === 'pausedForInsufficientQuota';
      return h('div', { key: j.id, style: { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontWeight: 600, fontSize: 13.5 } }, j.result_title || j.research_question || 'Report'),
            h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 } },
              done ? '✅ Completed' : failed ? ('✗ Failed' + (j.error && j.error.message ? ' — ' + j.error.message : '')) : paused ? '⏸ Paused — out of quota' : ('⏳ ' + (EL_STAGE[j.stage] || 'Processing') + '…')))),
        done && j.result_summary ? h('div', { style: { fontSize: 12.5, marginTop: 6, lineHeight: 1.45 } }, j.result_summary) : null,
        h('div', { style: { display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' } },
          done && j.result_body ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { setOpenReport(j); } }, 'View full report') : null,
          done && j.result_body && props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { saveToFiles(j); } }, '⤓ Save to project files') : null,
          paused ? h('button', { className: 'btn pri', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { resume(j); } }, 'Resume') : null,
          j.pdf_url ? h('a', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, href: j.pdf_url, target: '_blank' }, 'PDF') : null)
      );
    }
    if (!canUse) return null;
    return h('div', { className: 'panel', style: { marginTop: 14 } },
      h('h3', null, '📄 Reports ', h('span', { style: { fontSize: 11.5, color: 'var(--faint)', fontWeight: 400 } }, '· automated literature synthesis (~5–15 min)')),
      h('div', { style: { display: 'flex', gap: 8, margin: '8px 0 4px', flexWrap: 'wrap' } },
        h('input', { className: 'field', style: { flex: 1, minWidth: 220 }, placeholder: 'Research question for the report…', value: q, disabled: !props.canEdit || busy, onChange: function (e) { setQ(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') create(); } }),
        h('button', { className: 'btn pri', disabled: !props.canEdit || busy || !q.trim(), onClick: create }, busy ? '…' : '✨ Generate report')),
      (props.project && props.project.goal) ? h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 } }, h('a', { href: '#', onClick: function (e) { e.preventDefault(); setQ(props.project.goal); } }, 'Use the project goal as the question')) : null,
      err ? h('div', { style: { fontSize: 12.5, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)', margin: '4px 0' } }, err) : null,
      (offer && props.canEdit) ? h('div', { style: { fontSize: 12.5, background: 'var(--warn-bg, #fbf1dd)', border: '1px solid color-mix(in srgb, var(--warn, #8f5407) 30%, transparent)', borderRadius: 10, padding: '10px 12px', margin: '4px 0', lineHeight: 1.5 } },
        '⚡ Elfogyott az Elicit-kvóta. Futtassam a beépített ', h('b', null, 'Claude + OpenAlex Study-motorral'), ' ugyanerre a kérdésre? (keresés → szűrés → Claude-áttekintés)',
        h('div', { style: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { className: 'btn pri', style: { padding: '5px 12px', fontSize: 12.5 }, onClick: function () { runBackup(offer); } }, '⚡ Claude backup Study'),
          h('button', { className: 'btn', style: { padding: '5px 12px', fontSize: 12.5 }, onClick: function () { setOffer(''); } }, 'Mégse'))) : null,
      backup ? h('div', { style: { fontSize: 12.5, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', margin: '4px 0', display: 'flex', alignItems: 'flex-start', gap: 9 } },
        h('span', { style: { fontSize: 15, flex: 'none' } }, backup.stage === 'error' ? '✗' : backup.stage === 'done' ? '✓' : '⏳'),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, 'Claude backup Study'),
          h('div', { style: { color: backup.stage === 'error' ? 'var(--danger, #b42318)' : backup.stage === 'done' ? 'var(--ok, #15803d)' : 'var(--muted)', marginTop: 2 } }, backup.msg),
          (backup.stage === 'done' && backup.sid) ? h('div', { style: { marginTop: 6 } }, h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5 }, onClick: function () { if (props.onGoStudy) props.onGoStudy(); } }, 'Megnyitás a Study fülön →')) : null),
        (backup.stage === 'done' || backup.stage === 'error') ? h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 12, flex: 'none' }, onClick: function () { setBackup(null); } }, '×') : null) : null,
      jobs === null ? h('div', { style: { fontSize: 13, color: 'var(--muted)', padding: '8px 0' } }, 'Loading…')
        : jobs.length === 0 ? h('div', { style: { fontSize: 13, color: 'var(--muted)', padding: '8px 0' } }, 'No reports yet — ask a question above. A report keeps running even if you leave.')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 } }, jobs.map(card)),
      openReport ? h('div', { className: 'scrim', onClick: function () { setOpenReport(null); } }, h('div', { className: 'modal', style: { width: 760 }, onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('h3', { style: { margin: 0, flex: 1 } }, openReport.result_title || 'Report'), h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: function () { setOpenReport(null); } }, '✕')),
        (window.marked && window.DOMPurify)
          ? h('div', { className: 'md-report', style: { padding: 18, maxHeight: '72vh', overflow: 'auto', lineHeight: 1.6, fontSize: 13.5 }, dangerouslySetInnerHTML: { __html: enhanceReport(openReport.result_body || '') } })
          : h('div', { style: { padding: 18, maxHeight: '72vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 } }, openReport.result_body || ''))) : null
    );
  }

  // ---- Elicit Systematic Review (Phase 3) — PRISMA pipeline via elicit-proxy ----
  var SR_STAGES = [['gathering_sources', 'Sources'], ['screening_abstract', 'Abstract'], ['screening_fulltext', 'Full text'], ['extracting_data', 'Extract'], ['generating_report', 'Report'], ['done', 'Done']];
  // one-line "what is happening right now" per Elicit executionStage
  var SR_STAGE_DESC = { gathering_sources: 'Searching the literature and gathering candidate papers…', screening_abstract: 'Reading abstracts and applying your inclusion criteria…', screening_fulltext: 'Screening full texts against your criteria…', extracting_data: 'Extracting data into your review columns…', generating_report: 'Writing the synthesis report…', done: 'Finishing up…' };
  function srStageIdx(stage) { for (var i = 0; i < SR_STAGES.length; i++) { if (SR_STAGES[i][0] === stage) return i; } return -1; }
  function relTime(ts) { if (!ts) return ''; var t = new Date(ts).getTime(); if (isNaN(t)) return ''; var s = Math.max(0, Math.round((Date.now() - t) / 1000)); if (s < 60) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + ' min ago'; var hh = Math.round(m / 60); if (hh < 24) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; }
  function elapsedStr(ts) { if (!ts) return ''; var t = new Date(ts).getTime(); if (isNaN(t)) return ''; var s = Math.max(0, Math.round((Date.now() - t) / 1000)); var m = Math.floor(s / 60); if (m < 1) return '<1 min'; if (m < 60) return m + ' min'; var hh = Math.floor(m / 60); return hh + ' h ' + (m % 60) + ' min'; }
  // pulse a soft ring (box-shadow) around the current step — NOT group opacity, which would fade the
  // accent-on-tint label below WCAG-AA contrast at the trough. Text stays fully opaque.
  function ensureSrCss() { if (typeof document === 'undefined' || document.getElementById('sr-pulse-css')) return; var s = document.createElement('style'); s.id = 'sr-pulse-css'; s.textContent = '@keyframes srPulse{0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0)}50%{box-shadow:0 0 0 3px rgba(99,102,241,.30)}} .sr-cur-pill{animation:srPulse 1.4s ease-in-out infinite} @media (prefers-reduced-motion: reduce){.sr-cur-pill{animation:none}}'; document.head.appendChild(s); }
  function elapsedMin(ts) { if (!ts) return 0; var t = new Date(ts).getTime(); if (isNaN(t)) return 0; return Math.floor((Date.now() - t) / 60000); }
  function ElicitSysReview(props) {
    var canUse = !!(window.PREnt && window.PREnt.loaded() && window.PREnt.can('elicit_sysreview'));
    var jsS = useState(null), jobs = jsS[0], setJobs = jsS[1];
    var sjS = useState(null), selJob = sjS[0], setSelJob = sjS[1];   // selected review in the master-detail workspace (New design, direction B)
    var openFormS = useState(false), openForm = openFormS[0], setOpenForm = openFormS[1];
    var fS = useState({ q: '', protocol: '', abs: [], ft: [], ex: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }), f = fS[0], setF = fS[1];
    var buS = useState(false), busy = buS[0], setBusy = buS[1];
    var erS = useState(''), err = erS[0], setErr = erS[1];
    var opS = useState(null), openR = opS[0], setOpenR = opS[1];
    var caS = useState(null), cands = caS[0], setCands = caS[1];   // SR-question candidates generated from Ideas
    var gnS = useState(false), gen = gnS[0], setGen = gnS[1];
    var ehS = useState(null), enh = ehS[0], setEnh = ehS[1];       // AI-suggested sharper questions (item 4)
    var ebS = useState(false), enhBusy = ebS[0], setEnhBusy = ebS[1];
    var alive = useRef(true);
    function upf(k, v) { setF(function (prev) { var o = Object.assign({}, prev); o[k] = v; return o; }); }
    // Improve the manual question: accepts Hungarian, returns 2-3 sharper English SR questions to pick from.
    function enhanceQ() {
      var q = (f.q || '').trim(); if (!q) { setErr('Type a question first, then Improve.'); return; }
      setEnhBusy(true); setEnh(null); setErr('');
      callStudy({ action: 'sr_enhance', question: q }).then(function (d) {
        if (!alive.current) return; setEnhBusy(false);
        if (!d || d.error) { setErr('Improve: ' + ((d && d.error) || 'failed')); return; }
        setEnh((d.suggestions && d.suggestions.length) ? d.suggestions : []);
      }, function () { if (alive.current) { setEnhBusy(false); setErr('Improve failed.'); } });
    }
    function load() { callElicit({ action: 'sr.list', project_id: props.projectId }).then(function (d) { if (alive.current) setJobs((d && d.jobs) || []); }); }
    function loadCands() { sb.from('research_sr_candidates').select('*').eq('project_id', props.projectId).eq('dismissed', false).order('created_at', { ascending: true }).then(function (r) { if (alive.current) setCands((r && r.data) || []); }); }
    function generate() { setGen(true); setErr(''); callStudy({ action: 'sr_suggest', project_id: props.projectId }).then(function (d) { if (!alive.current) return; setGen(false); if (d && d.error) { setErr('Generate: ' + d.error); return; } loadCands(); if (d && d.created === 0) setErr('No Ideas yet — add Ideas in the Idea stage first, then generate.'); }); }
    function picoText(p) { if (!p) return ''; return [['P', p.population], ['I', p.intervention], ['C', p.comparison], ['O', p.outcome]].filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).join('\n'); }
    function startFromCand(c) { setF({ q: c.question || '', protocol: picoText(c.pico), abs: c.abstract_criteria || [], ft: [], ex: c.extraction_questions || [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); setOpenForm(true); setErr(''); }
    function dismissCand(c) { setCands(function (l) { return (l || []).filter(function (x) { return x.id !== c.id; }); }); sb.from('research_sr_candidates').update({ dismissed: true }).eq('id', c.id); }
    useEffect(function () { alive.current = true; ensureSrCss(); if (canUse) { load(); loadCands(); } return function () { alive.current = false; }; }, [canUse]);
    // one-click from the Ideas "Study basis" (Start a study from these ideas): generate SR-question drafts here in the studio
    useEffect(function () { if (props.autoGenerate && canUse && !gen) { if (props.onAutoGenerated) props.onAutoGenerated(); generate(); } }, [props.autoGenerate, canUse]);
    useEffect(function () {
      if (!jobs || !jobs.length) return;
      var running = jobs.filter(function (j) { return j.status !== 'completed' && j.status !== 'failed'; });
      if (!running.length) return;
      var iv = setInterval(function () {
        running.forEach(function (j) {
          callElicit({ action: 'sr.status', job_id: j.id }).then(function (d) {
            if (!alive.current || !d || !d.job) return;
            setJobs(function (list) { return (list || []).map(function (x) { return x.id === j.id ? Object.assign({}, x, d.job) : x; }); });
          });
        });
      }, 20000);
      return function () { clearInterval(iv); };
    }, [jobs && jobs.map(function (j) { return j.id + j.status + j.stage; }).join(',')]);
    // A review's export URLs (pdf/docx/…) may not have been ready at the completion poll → null exports.
    // Re-fetch once per completed job that has a report but no download links, so they appear for everyone.
    var refreshed = useRef({});
    function refreshJob(j) {
      callElicit({ action: 'sr.status', job_id: j.id, refresh: true }).then(function (d) {
        if (!alive.current || !d || !d.job) return;
        setJobs(function (list) { return (list || []).map(function (x) { return x.id === j.id ? Object.assign({}, x, d.job) : x; }); });
      });
    }
    useEffect(function () {
      (jobs || []).forEach(function (j) {
        if (j.status === 'completed' && j.result_body && !refreshed.current[j.id]) {
          var e = j.exports || {};
          if (!(e.pdf || e.docx || e.bib || e.ris)) { refreshed.current[j.id] = 1; refreshJob(j); }
        }
      });
    }, [jobs && jobs.map(function (j) { return j.id + j.status + ((j.exports && j.exports.pdf) ? '1' : '0'); }).join(',')]);
    function create() {
      var rq = f.q.trim(); if (!rq) return; setBusy(true); setErr('');
      callElicit({ action: 'sr.create', researchQuestion: rq, protocolDetails: f.protocol || null, abstractCriteria: f.abs, fulltextCriteria: f.ft, extractionQuestions: f.ex, generateReport: f.gen, genAbstract: f.genAbs, genExtraction: f.genEx, useFigures: f.useFig, runFullText: f.runFT, maxResults: f.maxResults ? parseInt(f.maxResults, 10) : undefined, project_id: props.projectId, title: (props.project && props.project.title) || null }).then(function (d) {
        setBusy(false);
        if (!d || d.error) { setErr((d && d.error) || 'Could not start the review.'); return; }
        setOpenForm(false); setF({ q: '', protocol: '', abs: [], ft: [], ex: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); if (d.deduped) setErr('A review for this question is already in progress.'); load();
      });
    }
    function resume(j) { callElicit({ action: 'sr.resume', job_id: j.id }).then(function (d) { if (d && d.error) setErr(d.error); load(); }); }
    function tracker(j) {
      var rawIdx = srStageIdx(j.stage);              // -1 when the stage is null/unknown
      var idx = rawIdx < 0 ? 0 : rawIdx;
      if (j.status === 'completed') idx = SR_STAGES.length - 1;
      // pulse ONLY when actively working on a KNOWN stage — don't animate a guessed "Sources" for a null/unknown stage
      var pulse = j.status === 'processing' && rawIdx >= 0;
      return h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', margin: '8px 0' } }, SR_STAGES.map(function (s, i) {
        var dn = (i < idx) || j.status === 'completed', cur = i === idx && j.status !== 'completed';
        return h('span', { key: s[0], className: (cur && pulse) ? 'sr-cur-pill' : undefined, style: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, border: '1px solid ' + (dn ? 'var(--ok, #15803d)' : cur ? 'var(--accent, #4f46e5)' : 'var(--line)'), color: dn ? 'var(--ok, #15803d)' : cur ? 'var(--accent, #4f46e5)' : 'var(--faint)', background: cur ? 'var(--accent-tint, #eef0ff)' : 'transparent' } }, (dn ? '✓ ' : cur ? '⏳ ' : '') + s[1]);
      }));
    }
    function stageLinks(j) {
      var st = j.stages; if (!st) return null;
      var rows = [['search', 'Search'], ['screen', 'Abstract'], ['fulltext', 'Full-text'], ['extract', 'Extract']];
      var links = rows.map(function (r) { var s = st[r[0]]; if (!s || (!s.csv && !s.xlsx)) return null; return h('span', { key: r[0], style: { fontSize: 11.5, marginRight: 12 } }, r[1] + ': ', s.csv ? h('a', { href: s.csv, target: '_blank' }, 'CSV') : null, (s.csv && s.xlsx) ? ' · ' : '', s.xlsx ? h('a', { href: s.xlsx, target: '_blank' }, 'XLSX') : null); }).filter(Boolean);
      return links.length ? h('div', { style: { marginTop: 6 } }, links) : null;
    }
    function statusLine(j) {
      var done = j.status === 'completed', failed = j.status === 'failed', paused = j.status === 'pausedForInsufficientQuota';
      if (done) return h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 } }, '✅ Completed' + (j.updated_at ? ' · ' + relTime(j.updated_at) : ''));
      if (failed) return h('div', { style: { fontSize: 11.5, color: 'var(--danger, #b42318)', marginTop: 2 } }, '✗ Failed' + (j.error && j.error.message ? ' — ' + j.error.message : ''));
      if (paused) return h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 } }, '⏸ Paused — out of quota. Click Resume once it is topped up.');
      var meta = []; var el = elapsedStr(j.created_at); if (el) meta.push('running ' + el);
      if (j.data_freshness) meta.push('updated ' + relTime(j.data_freshness));
      var metaEl = meta.length ? h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 1 } }, meta.join(' · ')) : null;
      // 'unknown' = Elicit can't report progress right now → don't paint it as healthy live progress
      if (j.status === 'unknown') {
        var li = srStageIdx(j.stage);
        return h('div', { style: { marginTop: 2 } },
          h('div', { style: { fontSize: 12, color: 'var(--muted)', fontWeight: 600 } }, '⚠️ Waiting for status…' + (li >= 0 ? ' · last stage: ' + SR_STAGES[li][1] : '')),
          metaEl);
      }
      // running: name the current stage + step-of. When the stage is not yet known, say "Starting…" only
      // early on — a long-running job with a momentarily-null stage should read "Working…", not restart.
      var idx = srStageIdx(j.stage);
      var stepTxt = idx >= 0 ? ('Step ' + (idx + 1) + ' of ' + SR_STAGES.length + ' · ') : '';
      var desc = idx >= 0 ? SR_STAGE_DESC[j.stage] : (elapsedMin(j.created_at) < 2 ? 'Starting the review…' : 'Working…');
      return h('div', { style: { marginTop: 2 } },
        h('div', { style: { fontSize: 12, color: 'var(--accent, #4f46e5)', fontWeight: 600 } }, '⏳ ' + stepTxt + desc),
        metaEl);
    }
    function card(j) {
      var done = j.status === 'completed', failed = j.status === 'failed', paused = j.status === 'pausedForInsufficientQuota';
      var acts = [];
      // dedicated results page: tracks the PRISMA pipeline live + renders screening/extraction tables + report on the web
      acts.push(h('a', { key: 'res', className: 'btn pri', style: { padding: '4px 10px', fontSize: 12, textDecoration: 'none' }, href: 'SRReview.html?job=' + encodeURIComponent(j.id), title: 'Track the pipeline and view the results in Publify' }, (done ? '📊 Open results' : '📊 Track progress')));
      if (done && j.result_body) acts.push(h('button', { key: 'v', className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { setOpenR(j); } }, 'View full report'));
      if (done) acts.push(h('button', { key: 'rf', className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Re-fetch the download links (they expire after 7 days)', onClick: function () { refreshJob(j); } }, '↻ Refresh downloads'));
      if (paused) acts.push(h('button', { key: 'r', className: 'btn pri', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { resume(j); } }, 'Resume'));
      var e = j.exports || {};
      var exps = [['pdf', 'PDF'], ['docx', 'DOCX'], ['bib', 'BibTeX'], ['ris', 'RIS']].map(function (x) { return e[x[0]] ? h('a', { key: x[0], className: 'btn', style: { padding: '4px 9px', fontSize: 12 }, href: e[x[0]], target: '_blank' }, x[1]) : null; }).filter(Boolean);
      return h('div', { key: j.id, style: { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 600, fontSize: 13.5 } }, j.result_title || j.research_question || 'Systematic review'),
            statusLine(j))),
        !failed ? tracker(j) : null,
        (j.warning && j.warning.code === 'all_excluded') ? h('div', { style: { marginTop: 8, fontSize: 12, lineHeight: 1.5, background: 'var(--warn-bg, #fbf1dd)', color: 'var(--warn, #b45309)', border: '1px solid color-mix(in srgb, var(--warn, #b45309) 30%, transparent)', borderRadius: 9, padding: '9px 11px' } },
          h('b', null, '⚠️ Stuck: all ' + j.warning.screened + ' abstracts were excluded.'), ' None passed abstract screening, so the review can’t advance to full-text — Elicit leaves it “processing” indefinitely. Fix: loosen the abstract-screening criteria, broaden the question, or raise “Max papers to search”, then start a new review.') : null,
        stageLinks(j),
        (done && j.result_summary) ? h('div', { style: { fontSize: 12.5, marginTop: 6, lineHeight: 1.45 } }, j.result_summary) : null,
        acts.length ? h('div', { style: { display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' } }, acts) : null,
        exps.length ? h('div', { style: { display: 'flex', gap: 7, marginTop: 6, flexWrap: 'wrap' } }, exps) : null
      );
    }
    function candCard(c) {
      var pico = c.pico || {};
      var hasPico = pico.population || pico.intervention || pico.comparison || pico.outcome;
      return h('div', { key: c.id, style: { border: '1px solid var(--line)', borderLeft: '3px solid var(--accent, #4f46e5)', borderRadius: 11, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 } },
        h('div', { style: { fontSize: 14, fontWeight: 650, lineHeight: 1.35 } }, c.question),
        hasPico ? h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 11.5, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 9px' } },
          h('b', { style: { color: 'var(--accent)' } }, 'P'), h('span', null, pico.population || '—'),
          h('b', { style: { color: 'var(--accent)' } }, 'I'), h('span', null, pico.intervention || '—'),
          h('b', { style: { color: 'var(--accent)' } }, 'C'), h('span', null, pico.comparison || '—'),
          h('b', { style: { color: 'var(--accent)' } }, 'O'), h('span', null, pico.outcome || '—')) : null,
        (c.abstract_criteria && c.abstract_criteria.length) ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, c.abstract_criteria.slice(0, 3).map(function (x, i) { return h('span', { key: i, style: { fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--ok-bg, #e7f6ee)', color: 'var(--ok, #15803d)' } }, '✓ ' + String(x).slice(0, 44)); })) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)' } },
          (c.extraction_questions && c.extraction_questions.length) ? h('span', null, '📋 ' + c.extraction_questions.length + ' extraction') : null,
          c.study_type ? h('span', { style: { fontFamily: 'monospace' } }, c.study_type) : null),
        h('div', { style: { display: 'flex', gap: 7, marginTop: 2 } },
          h('button', { className: 'btn pri', style: { flex: 1, justifyContent: 'center', padding: '6px 10px', fontSize: 12 }, disabled: !props.canEdit, onClick: function () { startFromCand(c); } }, '🔬 Start review'),
          h('button', { className: 'btn', style: { padding: '6px 10px', fontSize: 12 }, disabled: !props.canEdit, title: 'Dismiss', onClick: function () { dismissCand(c); } }, '×'))
      );
    }
    if (!canUse) return null;
    // ---- Review Workspace (New design flag, direction B): master-detail — a rail of reviews + candidates on the left, the selected review's full detail on the right. Reuses card()/SR_STAGES/startFromCand/dismissCand. When creating a review (openForm) we fall back to the classic full-width layout that owns the form. ----
    function railRow(j, selId) {
      var isSel = j.id === selId;
      var st = j.status;
      var stuck = !!(j.warning && j.warning.code === 'all_excluded');   // surface an all-excluded review as Stuck, not "running"
      var cls = stuck ? 'warn' : st === 'completed' ? 'ok' : st === 'failed' ? 'fail' : st === 'pausedForInsufficientQuota' ? 'pause' : 'run';
      var lab = stuck ? '⚠ Stuck' : st === 'completed' ? 'Done' : st === 'failed' ? 'Failed' : st === 'pausedForInsufficientQuota' ? 'Paused' : (function () { var i = srStageIdx(j.stage); return i >= 0 ? 'Step ' + (i + 1) + '/' + SR_STAGES.length : 'Working'; })();
      var idx = st === 'completed' ? SR_STAGES.length - 1 : (srStageIdx(j.stage) < 0 ? 0 : srStageIdx(j.stage));
      return h('button', { key: j.id, className: 'sr-rrow' + (isSel ? ' on' : ''), onClick: function () { setSelJob(j.id); } },
        h('div', { className: 'sr-rrow-t' }, j.result_title || j.research_question || 'Systematic review'),
        h('div', { className: 'sr-rrow-b' },
          h('span', { className: 'sr-rst ' + cls }, lab),
          h('span', { className: 'sr-dots', 'aria-hidden': 'true' }, SR_STAGES.map(function (s, i) { var d = (i < idx) || st === 'completed'; var c = i === idx && st !== 'completed' && st !== 'failed'; return h('i', { key: i, className: 'sr-dot' + (d ? ' d' : '') + (c ? ' c' : '') }); }))
        )
      );
    }
    function railCand(c) {
      var pico = c.pico || {};
      var picoBits = [pico.population, pico.intervention, pico.outcome].filter(Boolean).slice(0, 3).join(' · ');
      var meta = [];
      if (c.study_type) meta.push(c.study_type);
      if (c.abstract_criteria && c.abstract_criteria.length) meta.push('✓ ' + c.abstract_criteria.length + ' criteria');
      if (c.extraction_questions && c.extraction_questions.length) meta.push('📋 ' + c.extraction_questions.length + ' extraction');
      return h('div', { key: c.id, className: 'sr-rcand' },
        h('div', { className: 'sr-rcand-q' }, c.question),
        picoBits ? h('div', { className: 'sr-rcand-pico' }, picoBits) : null,
        meta.length ? h('div', { className: 'sr-rcand-meta' }, meta.join(' · ')) : null,
        h('div', { className: 'sr-rcand-a' },
          h('button', { className: 'sr-rcstart', disabled: !props.canEdit, onClick: function () { startFromCand(c); } }, '🔬 Start review'),
          h('button', { className: 'sr-rcx', disabled: !props.canEdit, title: 'Dismiss', onClick: function () { dismissCand(c); } }, '×'))
      );
    }
    function srWorkspace() {
      // resolve ONE effective selection so the highlighted rail row and the detail pane can never disagree (stale selJob → jobs[0])
      var selId = (jobs && jobs.some(function (x) { return x.id === selJob; })) ? selJob : ((jobs && jobs[0] && jobs[0].id) || null);
      var sel = (jobs && jobs.length) ? (jobs.filter(function (x) { return x.id === selId; })[0] || jobs[0]) : null;
      return h('div', { className: 'panel sr2-panel', style: { marginTop: 14 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0, flex: 1 } }, '🔬 Systematic Review Studio ', h('span', { style: { fontSize: 11.5, color: 'var(--faint)', fontWeight: 400 } }, '· from your Ideas → PRISMA')),
          props.canEdit ? h('button', { className: 'btn pri', style: { padding: '5px 11px', fontSize: 12.5 }, disabled: gen, onClick: generate }, gen ? '✨ Generating…' : '✨ Generate from Ideas') : null,
          props.canEdit ? h('button', { className: 'btn', style: { padding: '5px 11px', fontSize: 12.5 }, onClick: function () { setF({ q: '', protocol: '', abs: [], ft: [], ex: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); setOpenForm(true); } }, '+ Manual review') : null),
        err ? h('div', { style: { fontSize: 12.5, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)', margin: '6px 0' } }, err) : null,
        h('div', { className: 'sr2' },
          h('div', { className: 'sr-rail' },
            (jobs && jobs.length) ? h('div', null,
              h('div', { className: 'sr-rail-hd' }, 'Reviews ', h('span', { className: 'sr-rail-c' }, jobs.length)),
              h('div', { className: 'sr-rlist' }, jobs.map(function (j) { return railRow(j, selId); }))) : (jobs ? h('div', { className: 'sr-rail-empty' }, 'No reviews yet.') : h('div', { className: 'sr-rail-empty' }, 'Loading…')),
            (cands && cands.length) ? h('div', { className: 'sr-rail-sec' },
              h('div', { className: 'sr-rail-hd' }, 'From your Ideas ', h('span', { className: 'sr-rail-c' }, cands.length)),
              cands.map(railCand)) : null
          ),
          h('div', { className: 'sr-detail' },
            sel ? card(sel) :
              (jobs === null) ? h('div', { className: 'sr-detail-empty' }, 'Loading reviews…') :
                (cands && cands.length) ? h('div', { className: 'sr-detail-empty' }, 'Pick a review question on the left and press “🔬 Start review”, or “+ Manual review”.') :
                  h('div', { className: 'sr-detail-empty' }, 'No reviews yet. Click “✨ Generate from Ideas” to draft review questions from your project Ideas, then start one.')
          )
        ),
        openR ? h('div', { className: 'scrim', onClick: function () { setOpenR(null); } }, h('div', { className: 'modal', style: { width: 780 }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'modal-h' }, h('h3', { style: { margin: 0, flex: 1 } }, openR.result_title || 'Systematic review'), h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: function () { setOpenR(null); } }, '✕')),
          (window.marked && window.DOMPurify)
            ? h('div', { className: 'md-report', style: { padding: 18, maxHeight: '72vh', overflow: 'auto', lineHeight: 1.6, fontSize: 13.5 }, dangerouslySetInnerHTML: { __html: enhanceReport(openR.result_body || '') } })
            : h('div', { style: { padding: 18, maxHeight: '72vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 } }, openR.result_body || ''))) : null
      );
    }
    if (nd() && !openForm) return srWorkspace();
    return h('div', { className: 'panel', style: { marginTop: 14 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('h3', { style: { margin: 0, flex: 1 } }, '🔬 Systematic Review Studio ', h('span', { style: { fontSize: 11.5, color: 'var(--faint)', fontWeight: 400 } }, '· from your Ideas → PRISMA')),
        props.canEdit ? h('button', { className: 'btn pri', style: { padding: '5px 11px', fontSize: 12.5 }, disabled: gen, onClick: generate }, gen ? '✨ Generating…' : '✨ Generate from Ideas') : null,
        props.canEdit ? h('button', { className: 'btn', style: { padding: '5px 11px', fontSize: 12.5 }, onClick: function () { if (openForm) { setOpenForm(false); } else { setF({ q: '', protocol: '', abs: [], ft: [], ex: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); setOpenForm(true); } } }, openForm ? 'Cancel' : '+ Manual review') : null),
      err ? h('div', { style: { fontSize: 12.5, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)', margin: '6px 0' } }, err) : null,
      // review-question cards from Ideas
      (cands && cands.length) ? h('div', { style: { marginTop: 4 } },
        h('div', { className: 'field-label' }, 'Review questions from your Ideas'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 6 } }, cands.map(candCard))
      ) : (cands !== null && !openForm) ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', margin: '6px 0' } }, 'No review questions yet — click “✨ Generate from Ideas” to draft systematic-review-ready questions (with PICO + criteria) from your project Ideas, then start one with a click.') : null,
      openForm ? h('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 } },
        h('div', null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('div', { className: 'field-label', style: { flex: 1, margin: 0 } }, 'Research question *'),
            h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, disabled: enhBusy || !f.q.trim(), title: 'Rephrase into sharper questions (you can type in Hungarian)', onClick: enhanceQ }, enhBusy ? '✨ Improving…' : '✨ Improve')),
          h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box', marginTop: 4 }, value: f.q, placeholder: 'The question the review investigates… (Hungarian is fine — use ✨ Improve)', onChange: function (e) { upf('q', e.target.value); } }),
          enh !== null ? h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 } },
            enh.length ? h('div', { style: { fontSize: 11, color: 'var(--faint)' } }, 'Suggested — click to use:') : h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, 'No suggestion — the question looks clear already.'),
            enh.map(function (s, i) { return h('button', { key: i, className: 'btn', style: { textAlign: 'left', padding: '6px 9px', fontSize: 12, lineHeight: 1.35, whiteSpace: 'normal' }, onClick: function () { upf('q', s); setEnh(null); } }, '➕ ' + s); })) : null),
        h('div', null, h('div', { className: 'field-label' }, 'Protocol / PICO (optional)'), h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box' }, value: f.protocol, placeholder: 'Population, Intervention, Comparison, Outcome; inclusion/exclusion rationale…', onChange: function (e) { upf('protocol', e.target.value); } })),
        h('div', null, h('div', { className: 'field-label' }, 'Abstract screening criteria (optional — AI adds more)'), h(CritEditor, { items: f.abs, onChange: function (a) { upf('abs', a); }, placeholder: 'e.g. reports a quantitative outcome', empty: 'Auto-generated if left empty.' })),
        f.runFT ? h('div', null, h('div', { className: 'field-label' }, 'Full-text screening criteria (optional)'), h(CritEditor, { items: f.ft, onChange: function (a) { upf('ft', a); }, placeholder: 'e.g. sample size ≥ 100', empty: 'Reuses the abstract criteria if empty.' })) : null,
        h('div', null, h('div', { className: 'field-label' }, 'Extraction questions (optional)'), h(CritEditor, { items: f.ex, onChange: function (a) { upf('ex', a); }, accent: '#16a34a', placeholder: 'e.g. What was the effect size?', empty: 'Auto-generated if left empty.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Max papers to search (optional)'),
          h('input', { className: 'field', type: 'number', min: 1, max: 10000, step: 100, style: { width: 160, boxSizing: 'border-box' }, value: f.maxResults, placeholder: 'e.g. 1000', onChange: function (e) { upf('maxResults', e.target.value ? Math.min(10000, Math.max(1, parseInt(e.target.value, 10) || 0)) : ''); } }),
          h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 3 } }, 'How many papers Elicit retrieves for the review (up to 10000). Leave it blank and Elicit uses its small default of ~200 — so keep a number here for a broader review. Higher = more comprehensive but slower and more quota.')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8 } },
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.runFT, onChange: function (e) { upf('runFT', e.target.checked); } }), 'Run full-text screening stage ', h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, '(off = abstract-level only, faster)')),
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.genAbs, onChange: function (e) { upf('genAbs', e.target.checked); } }), 'Auto-generate extra abstract-screening criteria'),
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.genEx, onChange: function (e) { upf('genEx', e.target.checked); } }), 'Auto-generate extra extraction columns'),
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.useFig, onChange: function (e) { upf('useFig', e.target.checked); } }), 'Consult figures during extraction ', h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, '(higher quality, slower)'))),
        h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.gen, onChange: function (e) { upf('gen', e.target.checked); } }), 'Generate a full report at the end'),
        h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' } },
          err ? h('div', { style: { flex: 1, minWidth: 0, fontSize: 12, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)' } }, err) : null,
          h('button', { className: 'btn pri', disabled: !props.canEdit || busy || !f.q.trim(), onClick: create }, busy ? 'Starting…' : 'Start review'))
      ) : null,
      (jobs && jobs.length) ? h('div', { style: { marginTop: 14 } },
        h('div', { className: 'field-label' }, 'Reviews (' + jobs.length + ')'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 } }, jobs.map(card))
      ) : null,
      openR ? h('div', { className: 'scrim', onClick: function () { setOpenR(null); } }, h('div', { className: 'modal', style: { width: 780 }, onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('h3', { style: { margin: 0, flex: 1 } }, openR.result_title || 'Systematic review'), h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: function () { setOpenR(null); } }, '✕')),
        (window.marked && window.DOMPurify)
          ? h('div', { className: 'md-report', style: { padding: 18, maxHeight: '72vh', overflow: 'auto', lineHeight: 1.6, fontSize: 13.5 }, dangerouslySetInnerHTML: { __html: enhanceReport(openR.result_body || '') } })
          : h('div', { style: { padding: 18, maxHeight: '72vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 } }, openR.result_body || ''))) : null
    );
  }

  // ---- Elicit clinical-trials search (Phase 1b) ----
  var TRIAL_PHASES = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'];
  var PH_LABEL = { EARLY_PHASE1: 'Early P1', PHASE1: 'P1', PHASE2: 'P2', PHASE3: 'P3', PHASE4: 'P4' };
  var TRIAL_STATUS = [['RECRUITING', 'Recruiting'], ['NOT_YET_RECRUITING', 'Not yet recruiting'], ['ACTIVE_NOT_RECRUITING', 'Active, not recruiting'], ['COMPLETED', 'Completed'], ['TERMINATED', 'Terminated']];
  function ElicitTrials(props) {
    var canUse = !!(window.PREnt && window.PREnt.loaded() && window.PREnt.can('elicit_trials'));
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var phS = useState([]), phase = phS[0], setPhase = phS[1];
    var rsS = useState([]), rstat = rsS[0], setRstat = rsS[1];
    var hrS = useState(false), hasRes = hrS[0], setHasRes = hrS[1];
    var reS = useState(null), res = reS[0], setRes = reS[1];
    var buS = useState(false), busy = buS[0], setBusy = buS[1];
    var erS = useState(''), err = erS[0], setErr = erS[1];
    var alive = useRef(true);
    useEffect(function () { alive.current = true; return function () { alive.current = false; }; }, []);
    function tog(arr, set, v) { set(arr.indexOf(v) >= 0 ? arr.filter(function (x) { return x !== v; }) : arr.concat([v])); }
    function run() {
      var query = q.trim(); if (!query) return; setBusy(true); setErr('');
      callElicit({ action: 'trials.search', query: query, phase: phase, recruitmentStatus: rstat, hasResults: hasRes, maxResults: 50 }).then(function (d) {
        if (!alive.current) return; setBusy(false);
        if (!d || d.error) { setErr((d && d.error) || 'Search failed.'); setRes([]); return; }
        setRes(d.trials || []);
        if (d.rate && d.rate.remaining != null) setErr('Search budget: ' + d.rate.remaining + ' searches left today.');
      });
    }
    function chip(key, label, on, onClick) { return h('button', { key: key, className: 'lchip' + (on ? ' on' : ''), disabled: !props.canEdit, style: { fontSize: 11 }, onClick: onClick }, label); }
    function tcard(t) {
      return h('div', { key: t.nctId || t.title, style: { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
          h('div', { style: { flex: 1, minWidth: 0 } }, t.url ? h('a', { href: t.url, target: '_blank', style: { fontWeight: 600, fontSize: 13.5 } }, t.title) : h('span', { style: { fontWeight: 600, fontSize: 13.5 } }, t.title)),
          t.status ? h('span', { className: 'lchip', style: { fontSize: 10, flex: 'none' } }, t.status) : null),
        h('div', { style: { fontSize: 11, color: 'var(--muted)', marginTop: 3 } }, [t.nctId, (t.phase || []).map(function (p) { return PH_LABEL[p] || p; }).join('/'), t.studyType, (t.enrollment != null ? 'n=' + t.enrollment : null)].filter(Boolean).join(' · ')),
        (t.conditions && t.conditions.length) ? h('div', { style: { fontSize: 11.5, marginTop: 4 } }, h('b', null, 'Conditions: '), t.conditions.join(', ')) : null,
        (t.interventions && t.interventions.length) ? h('div', { style: { fontSize: 11.5, marginTop: 2 } }, h('b', null, 'Interventions: '), t.interventions.join(', ')) : null,
        h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 4 } }, [t.sponsor, (t.startDate ? 'start ' + t.startDate : null), (t.completionDate ? 'end ' + t.completionDate : null), (t.hasResults ? '✓ has results' : null)].filter(Boolean).join(' · '))
      );
    }
    if (!canUse) return null;
    return h('div', { className: 'panel', style: { marginTop: 14 } },
      h('h3', null, '🧪 Clinical trials ', h('span', { style: { fontSize: 11.5, color: 'var(--faint)', fontWeight: 400 } }, '· clinical-trials search')),
      h('div', { style: { display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' } },
        h('input', { className: 'field', style: { flex: 1, minWidth: 220 }, placeholder: 'Search clinical trials…', value: q, disabled: !props.canEdit || busy, onChange: function (e) { setQ(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') run(); } }),
        h('button', { className: 'btn pri', disabled: !props.canEdit || busy || !q.trim(), onClick: run }, busy ? '…' : 'Search')),
      h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 } }, TRIAL_PHASES.map(function (p) { return chip(p, PH_LABEL[p], phase.indexOf(p) >= 0, function () { tog(phase, setPhase, p); }); })),
      h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 } }, TRIAL_STATUS.map(function (s) { return chip(s[0], s[1], rstat.indexOf(s[0]) >= 0, function () { tog(rstat, setRstat, s[0]); }); }).concat([chip('_hr', 'Has results', hasRes, function () { setHasRes(!hasRes); })])),
      err ? h('div', { style: { fontSize: 12, color: /left today/.test(err) ? 'var(--muted)' : 'var(--danger, #b42318)', margin: '4px 0' } }, err) : null,
      res === null ? null : res.length === 0 ? h('div', { style: { fontSize: 13, color: 'var(--muted)', padding: '6px 0' } }, 'No trials found — try different terms or clear filters.')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 } }, res.map(tcard))
    );
  }

  function LiteratureStudy(props) {
    var studies = props.studies || [];
    var seS = useState((studies[0] && studies[0].id) || null), selId = seS[0], setSelId = seS[1];
    var stS = useState([]), steps = stS[0], setSteps = stS[1];
    var paS = useState([]), papers = paS[0], setPapers = paS[1];
    var plpS = useState(true), papersLoading = plpS[0], setPapersLoading = plpS[1];   // #5: true until the study's papers fetch resolves
    var cuS = useState(1), curStep = cuS[0], setCurStep = cuS[1];
    var cfS = useState(lsDefaultConfig(1, props.project)), cfg = cfS[0], setCfg = cfS[1];
    var rnS = useState(false), running = rnS[0], setRunning = rnS[1];
    var pgS = useState(null), prog = pgS[0], setProg = pgS[1];
    var ttS = useState({}), titles = ttS[0], setTitles = ttS[1];
    var erS = useState(''), err = erS[0], setErr = erS[1];
    var plS = useState(false), planning = plS[0], setPlanning = plS[1];   // Publify pre-filling the funnel config
    var ppS = useState(''), promptText = ppS[0], setPromptText = ppS[1];   // previewed screening prompt
    var smS = useState(false), studiesOpen = smS[0], setStudiesOpen = smS[1];   // "Tanulmányok" manage modal
    var rnS = useState(null), renameId = rnS[0], setRenameId = rnS[1];   // study being renamed
    var rvwS = useState(''), review = rvwS[0], setReview = rvwS[1];   // step-4 generated review markdown (rendered in-panel)
    var rvS = useState(''), renameVal = rvS[0], setRenameVal = rvS[1];
    var meS = useState({}), srcMeta = meS[0], setSrcMeta = meS[1];   // source_id -> {title,venue,cited_by,year,issn}
    var scS = useState(null), scimap = scS[0], setScimap = scS[1];   // SCImago ISSN→quartile map (lazy)
    var soS = useState('decision'), sortBy = soS[0], setSortBy = soS[1];   // results sort key
    useEffect(function () { loadScimago().then(setScimap); }, []);
    // Esc closes the studies-manage modal
    useEffect(function () { if (!studiesOpen) return; function onEsc(e) { if (e.key === 'Escape') setStudiesOpen(false); } window.addEventListener('keydown', onEsc); return function () { window.removeEventListener('keydown', onEsc); }; }, [studiesOpen]);
    var alive = useRef(true), stop = useRef(false);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    // #12 — selId is seeded from studies[0] at mount; if the studies list loads AFTER mount it stays null
    // and a step run would POST an empty study_id ("study_id required"). Sync selId once studies arrive.
    // On (re)load restore the LAST-VIEWED study (localStorage) + its furthest step, so a completed run's
    // results are shown again instead of jumping to studies[0]/step 1 and looking like they vanished.
    useEffect(function () {
      if (!selId && studies.length) {
        var saved = null; try { saved = localStorage.getItem('pr-study-' + props.projectId); } catch (e) { }
        var s = (saved && studies.filter(function (x) { return x.id === saved; })[0]) || studies[0];
        setSelId(s.id); if (s.cur_step) setCurStep(s.cur_step);
      }
    }, [studies.length]);
    useEffect(function () { if (selId) { try { localStorage.setItem('pr-study-' + props.projectId, selId); } catch (e) { } } }, [selId]);
    var sel = studies.filter(function (x) { return x.id === selId; })[0];
    var srcMap = {}; (props.sources || []).forEach(function (s) { srcMap[s.id] = s; });

    function loadReview(id) {
      if (!id) { setReview(''); return; }
      sb.from('research_files').select('content').eq('project_id', props.projectId).like('path', 'studies/%-' + String(id).slice(0, 8) + '-review.md').order('updated_at', { ascending: false }).limit(1).then(function (rr) { setReview((rr && rr.data && rr.data[0] && rr.data[0].content) || ''); }, function () { });
    }
    function loadStudy(id) {
      if (!id) { setSteps([]); setPapers([]); setPapersLoading(false); setReview(''); return; }
      loadReview(id);
      Promise.all([
        sb.from('research_study_steps').select('step,kind,config,status,cursor,total,counts').eq('study_id', id).order('step'),
        sb.from('research_study_papers').select('source_id,step,decision,reason,score,signals,overridden').eq('study_id', id)
      ]).then(function (r) {
        var st = (r[0] && r[0].data) || []; var pps = (r[1] && r[1].data) || []; setSteps(st); setPapers(pps); setPapersLoading(false);
        var cs = st.filter(function (x) { return x.step === curStep; })[0]; if (cs && cs.config) setCfg(cs.config);
        // load titles for this study's papers directly, so reloaded results always show a title (even if the
        // source isn't in the project-wide props.sources slice) — the transient run-time `titles` is gone on reload
        var ids = []; var seen = {}; pps.forEach(function (p) { if (p.source_id && !seen[p.source_id]) { seen[p.source_id] = 1; ids.push(p.source_id); } });
        if (ids.length) sb.from('research_sources').select('id,title,venue,cited_by,year,issn,url,doi').in('id', ids).then(function (sr) {
          var mm = {}, tt = {}; ((sr && sr.data) || []).forEach(function (x) { mm[x.id] = x; tt[x.id] = x.title; });
          setSrcMeta(function (prev) { return Object.assign({}, mm, prev); });
          setTitles(function (prev) { return Object.assign({}, tt, prev); });
        });
      });
    }
    useEffect(function () { if (selId) setPapersLoading(true); loadStudy(selId); }, [selId]);
    function stepRow(n) { return steps.filter(function (x) { return x.step === n; })[0]; }
    function viewStep(n) { setCurStep(n); var cs = stepRow(n); setCfg((cs && cs.config) || lsDefaultConfig(n, props.project)); }
    function incCount(n) { return papers.filter(function (p) { return p.step === n && p.decision === 'include'; }).length; }

    // create a study from one OR MORE selected ideas (or empty), then let Publify pre-fill the funnel config
    // one-click from the Ideas "study basis" window: auto-create the study from the selected ideas and let
    // Publify pre-fill step 1 (newStudy = create → plan → load). Consume the signal first so it can't re-fire.
    useEffect(function () {
      if (props.autoCreateFrom && props.autoCreateFrom.length) { var ids = props.autoCreateFrom; if (props.onAutoConsumed) props.onAutoConsumed(); newStudy(ids); }
    }, [props.autoCreateFrom]);
    function newStudy(ideas) {
      var arr = Array.isArray(ideas) ? ideas : (ideas ? [ideas] : []);
      var q = arr.length ? arr.map(function (i) { return i.question + (i.hypothesis ? ' — hypothesis: ' + i.hypothesis : ''); }).join('\n\n') : props.project.title;
      var title = String(arr.length ? (arr.length > 1 ? (props.project.title + ' — ' + arr.length + ' ideas') : arr[0].question) : (props.project.title + ' — literature')).slice(0, 80);
      setErr(''); setPlanning(true);
      sb.from('research_studies').insert({ project_id: props.projectId, idea_id: arr[0] ? arr[0].id : null, title: title, question: String(q).slice(0, 4000), created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
        var id = r && r.data && r.data.id; if (!id) { setPlanning(false); setErr('Could not create the study.'); return; }
        var rows = LS_STEPS.map(function (s) { return { study_id: id, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, props.project, arr[0]) }; });
        sb.from('research_study_steps').insert(rows).then(function () {
          setSelId(id); setCurStep(1); props.onChanged();
          // dynamically pre-fill keywords + criteria + filters with Publify; the user only fine-tunes
          callStudy({ action: 'plan', study_id: id }).then(function (d) { setPlanning(false); loadStudy(id); if (d && d.error) setErr('AI fill-in: ' + d.error); }, function () { setPlanning(false); });
        });
      });
    }
    // re-run the AI pre-fill for the current study (Publify regenerates keywords/criteria/filters)
    function runPlan() {
      if (!selId || planning) return;
      setErr(''); setPlanning(true);
      callStudy({ action: 'plan', study_id: selId }).then(function (d) { setPlanning(false); if (d && d.error) { setErr('AI fill-in: ' + d.error); return; } loadStudy(selId); }, function () { setPlanning(false); setErr('AI fill-in failed.'); });
    }
    // (re)generate the prompt preview from the CURRENT question + criteria (reflects manual edits)
    function genPrompt() { setPromptText(buildScreenPrompt((sel && (sel.question || sel.title)) || '', cfg, curStep)); }
    // delete a whole study (cascades to its steps + papers)
    function delStudy(s) {
      window.PRUI.confirm({ title: 'Delete “' + (s.title || '') + '”?', body: 'This study and all its steps and results will be permanently deleted.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        sb.from('research_studies').delete().eq('id', s.id).then(function (r) {
          if (r && r.error) { setErr('Delete failed: ' + r.error.message); return; }
          if (selId === s.id) { setSelId(null); setSteps([]); setPapers([]); setCurStep(1); }
          props.onChanged();
        });
      });
    }
    // rename a study
    function renameStudy(s) {
      var t = (renameVal || '').trim(); if (!t) { setRenameId(null); return; }
      sb.from('research_studies').update({ title: t.slice(0, 200), updated_at: new Date().toISOString() }).eq('id', s.id).then(function (r) {
        if (r && r.error) { setErr('Rename failed: ' + r.error.message); return; }
        setRenameId(null); props.onChanged();
      });
    }
    function up(k, v) { setCfg(Object.assign({}, cfg, (function () { var o = {}; o[k] = v; return o; })())); }
    function upFilter(k, v) { setCfg(Object.assign({}, cfg, { filters: Object.assign({}, cfg.filters || {}, (function () { var o = {}; o[k] = v; return o; })()) })); }
    var linesToArr = function (s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };

    function runStep(n) {
      if (running) return;
      if (!selId) { setErr('No study selected — choose one from the list.'); return; }   // #12 guard
      setErr(''); stop.current = false; setRunning(true); setProg({ done: 0, total: 0, counts: {} }); setTitles({});
      sb.from('research_study_steps').update({ config: cfg, status: 'running' }).eq('study_id', selId).eq('step', n).then(function () {
        if (n === 4) {
          callStudy({ action: 'generate_review', study_id: selId }).then(function (d) {
            setRunning(false); setProg(null);
            if (!d || d.error) { setErr((d && d.error) || 'Error generating the review.'); return; }
            loadStudy(selId); props.onChanged(); window.PRUI.toast('Review ready: ' + d.file_path + ' (in Files).', { kind: 'ok' });
          });
          return;
        }
        sb.from('research_study_papers').delete().eq('study_id', selId).gte('step', n).eq('overridden', false).then(function () {
          var action = n === 1 ? 'search_step1' : 'screen_batch';
          var srcUsed = 'openalex', rateInfo = null;   // captured from the first batch (source_adapter result)
          (function loop(offset) {
            if (!alive.current || stop.current) { setRunning(false); setProg(null); loadStudy(selId); return; }
            callStudy({ action: action, study_id: selId, step: n, offset: offset }).then(function (d) {
              if (!d || d.error) { setRunning(false); setProg(null); setErr((d && d.error) || 'The step failed.'); loadStudy(selId); return; }
              if (offset === 0) { srcUsed = d.source || 'openalex'; rateInfo = d.elicit_rate || null; }
              setProg({ done: d.next_offset, total: d.total_estimate || d.next_offset, counts: d.counts });
              setTitles(function (t) { var n2 = Object.assign({}, t); (d.results || []).forEach(function (x) { if (x.title) n2[x.source_id] = x.title; }); return n2; });
              loadStudy(selId);
              if (!d.done && alive.current && !stop.current) loop(d.next_offset);
              else { setRunning(false); setProg(null); loadStudy(selId); props.onChanged();
                if (n === 1 && srcUsed === 'elicit') setErr('✓ Searched via Publify (' + ((cfg.source_adapter === 'elicit_keyword') ? 'keyword' : 'semantic') + ').' + (rateInfo && rateInfo.remaining != null ? ' Search budget: ' + rateInfo.remaining + ' searches left today.' : ''));
                else if (n === 1 && String(cfg.source_adapter || '').indexOf('elicit') === 0) setErr('ℹ️ Semantic search was unavailable (rate limit, quota, plan, or not enabled for you) — searched via OpenAlex instead.');
                else if (n === 1 && !(d.total_estimate || d.new_sources || d.fetched)) setErr('0 results on OpenAlex — try broader/different keywords, or looser filters (e.g. clear “From year” or “Journals only”), then run again.');
                else if (n === 1 && d.relaxed) setErr('ℹ️ The keywords/filters you gave were too narrow — I relaxed them automatically (e.g. searched without filters) to find papers. You can refine the keywords/filters and run again.'); }
            });
          })(0);
        });
      });
    }
    function override(p, dec) { sb.from('research_study_papers').update({ decision: dec, overridden: true }).eq('study_id', selId).eq('source_id', p.source_id).eq('step', curStep).then(function () { loadStudy(selId); }); }

    // #5 — until the first fetch resolves, show skeleton rows instead of the "select ideas" empty state,
    // so returning users (who DO have studies) don't see a false-empty flash on (re)open.
    if (props.loading && !studies.length && !planning) {
      return h('div', { className: 'panel' }, h('h3', null, '🔬 Literature study'),
        h('div', { style: { marginTop: 10 } }, [0, 1, 2, 3, 4].map(function (i) {
          return h('div', { key: i, className: 'pr-skel pr-skel-row', style: { width: (90 - i * 8) + '%' } });
        })));
    }
    if (!studies.length) {
      if (planning) return h('div', { className: 'panel' }, h('h3', null, '🔬 Literature study'), h('div', { style: { fontSize: 13, color: 'var(--muted)', padding: '12px 0' } }, '✨ Publify is preparing the study from the selected ideas — one moment, loading the Step-1 data (keywords, criteria, filters)…'));
      var selIdeas = (props.ideas || []).filter(function (i) { return i.status === 'selected'; });
      return h('div', { className: 'panel' }, h('h3', null, '🔬 Literature study'),
        h('p', { style: { fontSize: 13, color: 'var(--muted)' } }, 'Select (Select) the Ideas the study should be based on, then start a 4-step screening: quick screening → abstract → full text → review. Publify pre-fills the steps (keywords, criteria, filters) based on the ideas — you only fine-tune.'),
        props.canEdit ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 } },
          selIdeas.length
            ? h('button', { className: 'btn pri', disabled: planning, onClick: function () { newStudy(selIdeas); } }, planning ? '✨ Publify is planning…' : ('🔬 Study from the selected ' + selIdeas.length + ' idea(s)'))
            : h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, 'Select at least one idea (Select) on the Ideas tab.'),
          h('button', { className: 'btn', disabled: planning, onClick: function () { newStudy(null); } }, '+ Empty study')
        ) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'Read-only view.'),
        err ? h('div', { style: { color: 'var(--danger)', fontSize: 12.5, marginTop: 8 } }, err) : null);
    }

    var stepPapers = papers.filter(function (p) { return p.step === curStep; });
    var grp = { include: [], maybe: [], exclude: [] }; stepPapers.forEach(function (p) { (grp[p.decision] || (grp[p.decision] = [])).push(p); });
    // step-3 full-text download tally (which papers got the PDF vs fell back to the abstract)
    var pdfN = stepPapers.filter(function (p) { return p.signals && p.signals.screened_on === 'pdf'; }).length;
    var absN = stepPapers.filter(function (p) { return p.signals && p.signals.screened_on === 'abstract'; }).length;
    // scientometrics + sorting for the results
    function metaOf(p) { return srcMeta[p.source_id] || srcMap[p.source_id] || {}; }
    function qOf(p) { return quartileFromIssn(scimap, metaOf(p).issn); }
    var DEC_ORDER = { include: 0, maybe: 1, exclude: 2 };
    function sortKey(p) {
      var m = metaOf(p);
      if (sortBy === 'cites') return -(m.cited_by || 0);
      if (sortBy === 'year') return -(m.year || 0);
      if (sortBy === 'q') { var q = qOf(p); return q || 9; }   // Q1 first; unknown last
      if (sortBy === 'decision') return DEC_ORDER[p.decision] != null ? DEC_ORDER[p.decision] : 3;
      return -(p.score || 0);   // relevance
    }
    // secondary sort: keep includes/maybe/exclude grouped, then highest relevance, then most cited
    function sortPapers(arr) { return arr.slice().sort(function (a, b) { return (sortKey(a) - sortKey(b)) || ((DEC_ORDER[a.decision] || 0) - (DEC_ORDER[b.decision] || 0)) || ((b.score || 0) - (a.score || 0)) || ((metaOf(b).cited_by || 0) - (metaOf(a).cited_by || 0)); }); }
    var cur = stepRow(curStep) || {};
    return h('div', null,
      // studies overview — every study with its progress + status; click to open one. Lets you follow several.
      h('div', { style: { marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 } },
          h('div', { style: { fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.04em' } }, 'Studies (' + studies.length + ')'),
          h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setStudiesOpen(true); } }, '📚 View studies')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          studies.map(function (s) {
            var on = s.id === selId;
            var st = s.status === 'done' ? '✓ done' : ('step ' + (s.cur_step || 1) + '/4');
            var editing = renameId === s.id;
            return h('div', { key: s.id, onClick: editing ? null : function () { setSelId(s.id); setCurStep(s.cur_step || 1); }, style: { textAlign: 'left', maxWidth: 260, minWidth: 150, border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--surface-2)' : 'var(--surface)', borderRadius: 8, padding: '6px 10px', cursor: editing ? 'default' : 'pointer' } },
              editing
                ? h('div', { onClick: function (e) { e.stopPropagation(); }, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                    h('input', { className: 'field', autoFocus: true, style: { fontSize: 12.5, width: '100%', boxSizing: 'border-box' }, value: renameVal, placeholder: 'Study name…', onChange: function (e) { setRenameVal(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); renameStudy(s); } else if (e.key === 'Escape') { setRenameId(null); } } }),
                    h('div', { style: { display: 'flex', gap: 4 } },
                      h('button', { className: 'btn pri', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { renameStudy(s); } }, 'Save'),
                      h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { setRenameId(null); } }, 'Cancel')))
                : h('div', null,
                    h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
                      h('div', { style: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title),
                      props.canEdit ? h('button', { className: 'icon-x', 'aria-label': 'Rename study', title: 'Rename', style: { flex: 'none', fontSize: 11 }, onClick: function (e) { e.stopPropagation(); setRenameId(s.id); setRenameVal(s.title || ''); } }, h('span', { 'aria-hidden': 'true' }, '✏️')) : null),
                    h('div', { style: { fontSize: 11, color: (running && on) ? 'var(--accent)' : 'var(--muted)', marginTop: 2 } }, (running && on ? '⏳ running… ' : '') + st))
            );
          }),
          props.canEdit ? h('button', { onClick: function () { newStudy(null); }, style: { border: '1px dashed var(--line)', background: 'transparent', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12.5, color: 'var(--muted)' } }, '+ New study') : null
        )),
      // funnel stepper
      h('div', { className: 'funnel' }, LS_STEPS.map(function (s) {
        return h('button', { key: s.step, 'aria-current': curStep === s.step ? 'step' : null, 'aria-label': s.label, className: 'funnel-step' + (curStep === s.step ? ' on' : '') + (((stepRow(s.step) || {}).status === 'done') ? ' done' : ''), onClick: function () { viewStep(s.step); } },
          h('b', null, s.label), s.step < 4 ? h('span', { className: 'funnel-count' }, incCount(s.step) + ' include') : h('span', { className: 'funnel-count' }, (stepRow(4) || {}).status === 'done' ? 'done' : 'review'));
      })),
      // config panel (steps 1-3) or review panel (step 4)
      curStep < 4 ? h('div', { className: 'panel', style: { marginTop: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('h3', { style: { margin: 0 } }, LS_STEPS[curStep - 1].label + ' — settings'),
          props.canEdit ? h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, marginLeft: 'auto', flex: 'none' }, disabled: planning, title: 'Publify (re)fills the keywords, criteria and filters based on the ideas', onClick: runPlan }, planning ? '✨ Publify is filling…' : '✨ AI fill-in') : null),
        props.canEdit ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 8px', lineHeight: 1.4 } }, planning ? '✨ Publify is filling the fields based on your ideas…' : '✨ The fields were filled by Publify based on your ideas — edit them freely, then run the step.') : null,
        h('div', { className: 'field-label' }, 'Keywords (comma-separated)'),
        h('input', { className: 'field', style: { width: '100%' }, disabled: !props.canEdit, value: (cfg.keywords || []).join(', '), placeholder: 'e.g. out-of-distribution, LiDAR', onChange: function (e) { up('keywords', e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)); } }),
        h('div', { style: { display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' } },
          h('div', { style: { flex: 1, minWidth: 220 } }, h('div', { className: 'field-label' }, '✓ Inclusion criteria'), h(CritEditor, { items: cfg.include || [], onChange: function (a) { up('include', a); }, disabled: !props.canEdit, accent: '#16a34a', placeholder: 'e.g. has a public github repo or dataset', empty: 'No inclusion criteria yet.' })),
          h('div', { style: { flex: 1, minWidth: 220 } }, h('div', { className: 'field-label' }, '✕ Exclusion criteria'), h(CritEditor, { items: cfg.exclude || [], onChange: function (a) { up('exclude', a); }, disabled: !props.canEdit, accent: '#dc2626', placeholder: 'e.g. no quantitative evaluation', empty: 'No exclusion criteria yet.' }))),
        curStep === 1 ? h('div', { className: 'lfilters', style: { marginTop: 8 } },
          // search source — Elicit options appear only when the user is entitled (elicit_search); server enforces + falls back to OpenAlex
          h('select', { className: 'num', style: { width: 'auto', minWidth: 148 }, disabled: !props.canEdit, value: cfg.source_adapter || 'openalex', onChange: function (e) { var v = e.target.value; var isEl = String(v).indexOf('elicit') === 0; setCfg(function (c) { var n = Object.assign({}, c, { source_adapter: v }); if (isEl) n.max_results = Math.min(500, (n.max_results > 200) ? n.max_results : 500); else if (n.max_results > 400) n.max_results = 200; return n; }); }, title: 'Search source' },
            h('option', { value: 'openalex' }, 'Source: OpenAlex'),
            (window.PREnt && window.PREnt.loaded() && window.PREnt.can('elicit_search')) ? h('option', { value: 'elicit' }, 'Source: Publify (semantic)') : null,
            (window.PREnt && window.PREnt.loaded() && window.PREnt.can('elicit_search')) ? h('option', { value: 'elicit_keyword' }, 'Source: Publify (keyword)') : null),
          h('input', { className: 'num', type: 'number', min: 1, max: 500, step: 50, disabled: !props.canEdit, style: { width: 118 }, title: 'Max papers to search' + (String(cfg.source_adapter || '').indexOf('elicit') === 0 ? ' — Publify: up to 500 (your plan’s per-search limit)' : ' — OpenAlex: up to 400 (paginates, slower)'), placeholder: 'Max papers', value: cfg.max_results || '', onChange: function (e) { up('max_results', e.target.value ? Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 0)) : ''); } }),
          (String(cfg.source_adapter || '').indexOf('elicit') === 0) ? h('button', { className: 'lchip' + (cfg.corpus === 'pubmed' ? ' on' : ''), disabled: !props.canEdit, title: 'Restrict search to PubMed', onClick: function () { up('corpus', cfg.corpus === 'pubmed' ? 'elicit' : 'pubmed'); } }, 'PubMed only') : null,
          h('input', { className: 'num', type: 'number', disabled: !props.canEdit, placeholder: 'From year', value: (cfg.filters || {}).fromYear || '', onChange: function (e) { upFilter('fromYear', e.target.value); } }),
          h('input', { className: 'num', type: 'number', disabled: !props.canEdit, placeholder: 'Min. cites', value: (cfg.filters || {}).minCites || '', onChange: function (e) { upFilter('minCites', e.target.value); } }),
          h('button', { className: 'lchip' + ((cfg.filters || {}).oa ? ' on' : ''), disabled: !props.canEdit, onClick: function () { upFilter('oa', !(cfg.filters || {}).oa); } }, 'Open access only'),
          h('button', { className: 'lchip' + ((cfg.filters || {}).journals ? ' on' : ''), disabled: !props.canEdit, onClick: function () { upFilter('journals', !(cfg.filters || {}).journals); } }, 'Journals only')
        ) : null,
        // natural-language query for Elicit SEMANTIC search (not shown for keyword mode — it uses the keyword bag)
        (curStep === 1 && cfg.source_adapter === 'elicit') ? h('div', { style: { marginTop: 8 } },
          h('div', { className: 'field-label' }, 'Search query / description (semantic)'),
          h('textarea', { className: 'field', style: { width: '100%', minHeight: 60, resize: 'vertical', boxSizing: 'border-box' }, disabled: !props.canEdit, maxLength: 350, value: cfg.semantic_query || '', placeholder: (sel && sel.question) ? ('Defaults to the study question: ' + String(sel.question).slice(0, 110)) : 'A full-sentence research question for semantic search…', onChange: function (e) { up('semantic_query', e.target.value); } }),
          h('div', { style: { fontSize: 11, color: 'var(--muted)', marginTop: 3 } }, 'Semantic search uses this natural-language question (max 350 chars). The keywords above still drive OpenAlex; “✨ AI fill-in” regenerates this.')
        ) : null,
        curStep > 1 && incCount(curStep - 1) === 0 ? h('div', { style: { fontSize: 12.5, color: 'var(--warn)', marginTop: 8 } }, 'There is no “include” paper in the previous step yet — run that first.') : null,
        curStep === 3 ? h('div', { style: { fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.45, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px' } }, '📄 Full-text screening runs on step 2’s “include” papers: it downloads the available open access (OA) PDFs and screens on the full text; where no PDF is downloadable, it falls back to the abstract. This is therefore slower (3–4 papers per batch) — in the table below you can see live which paper got “📄 full text” and which got “📝 abstract only”, and the download ratio in the header.') : null,
        props.canEdit ? h('div', { className: 'runbar' },
          h('button', { className: 'btn pri', disabled: running || (curStep > 1 && incCount(curStep - 1) === 0), onClick: function () { runStep(curStep); } }, running ? 'Running…' : ((cur.status === 'done' ? 'Rerun: ' : 'Run: ') + LS_STEPS[curStep - 1].label)),
          running ? h('button', { className: 'btn', onClick: function () { stop.current = true; } }, 'Cancel') : null,
          (cur.status === 'done' && curStep < 4) ? h('span', { style: { fontSize: 11.5, color: 'var(--warn)' } }, 'Rerunning deletes the later steps.') : null,
          prog ? (function () {
            var pct = prog.total ? Math.min(100, Math.round(prog.done / prog.total * 100)) : 0;
            var indet = !prog.total;   // total not known yet → indeterminate slide
            return h('div', { style: { flex: '1 1 240px', minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 } },
              h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 11.5 } },
                h('span', { style: { color: 'var(--ink)', fontWeight: 600 } }, prog.total ? ('Screening paper ' + Math.min(prog.done + 1, prog.total) + ' of ~' + prog.total) : ('Screening paper ' + (prog.done + 1) + '…')),
                h('span', { style: { color: 'var(--muted)' } }, '✓' + ((prog.counts || {}).include || 0) + ' ✗' + ((prog.counts || {}).exclude || 0) + (prog.total ? ' · ' + pct + '%' : ''))),
              h('div', { className: 'pr-bar' + (indet ? ' pr-bar--indet' : ''), role: 'progressbar', 'aria-valuenow': indet ? null : pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Screening progress' },
                h('i', { style: indet ? null : { width: pct + '%' } })));
          })() : null
        ) : null,
        err ? h('div', { style: { color: 'var(--danger)', fontSize: 12.5, marginTop: 6 } }, err) : null,
        // 📝 prompt preview — the exact screening prompt Publify gets, built from the current question + criteria
        props.canEdit ? h('div', { style: { marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, '📝 Publify screening-prompt'),
            h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: genPrompt }, promptText ? '🔄 Regenerate prompt' : '📝 View prompt'),
            promptText ? h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { try { navigator.clipboard.writeText(promptText); } catch (e) { } } }, 'Copy') : null,
            promptText ? h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setPromptText(''); } }, 'Hide') : null),
          promptText ? h('div', { style: { fontSize: 11, color: 'var(--muted)', marginTop: 4 } }, 'This is the system prompt Publify gets when judging each paper (based on the question + keywords + criteria). After changing a keyword/criterion, press “regenerate”.') : null,
          promptText ? h('pre', { style: { marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11.5, lineHeight: 1.45, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', maxHeight: 280, overflow: 'auto', fontFamily: 'ui-monospace, monospace' } }, promptText) : null
        ) : null
      ) : h('div', { className: 'panel', style: { marginTop: 10 } },
        h('h3', null, '4. Review paper'),
        h('p', { style: { fontSize: 13, color: 'var(--muted)' } }, 'We generate a structured review from the ' + incCount(3) + ' paper(s) “include”-d in step 3 (also saved to Files). Consensus grounding if the token is connected.'),
        props.canEdit ? h('div', { className: 'runbar' }, h('button', { className: 'btn pri', disabled: running || incCount(3) === 0, onClick: function () { runStep(4); } }, running ? 'Generating…' : (review ? '🔄 Regenerate review' : 'Generate review')), (stepRow(4) || {}).status === 'done' ? h('span', { className: 'chip c-ok' }, '✓ Done · saved to Files') : null) : null,
        running ? h('div', { style: { marginTop: 10 } }, h(AiThinking, { label: 'Synthesizing the review from the included papers' })) : null,
        err ? h('div', { style: { color: 'var(--danger)', fontSize: 12.5, marginTop: 6 } }, err) : null,
        review ? h('div', { style: { marginTop: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
            h('b', { style: { fontSize: 12.5, flex: 1 } }, '📄 Generated review'),
            h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5 }, onClick: function () { try { var u = URL.createObjectURL(new Blob([review], { type: 'text/markdown' })); var a = document.createElement('a'); a.href = u; a.download = 'literature-review.md'; a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); } catch (e) { } } }, '⬇ .md')),
          h('div', { className: 'report-doc', style: { maxWidth: '100%', maxHeight: 640, overflow: 'auto', padding: '22px 26px' }, dangerouslySetInnerHTML: { __html: mdReport(review) } })
        ) : null
      ),
      // results list (steps 1-3)
      curStep < 4 ? h('div', { className: 'panel', style: { marginTop: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0 } }, 'Results — ' + LS_STEPS[curStep - 1].label + ' (' + stepPapers.length + ' paper(s))'),
          (curStep === 3 && stepPapers.length) ? h('span', { style: { fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }, title: 'How many papers had their full text (PDF) downloaded and analyzed, and how many were left with only the abstract' }, '📄 ' + pdfN + ' full text · 📝 ' + absN + ' abstract') : null,
          stepPapers.length ? h('label', { style: { marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 } }, 'Sort:',
            h('select', { className: 'num', style: { width: 'auto', height: 28 }, value: sortBy, onChange: function (e) { setSortBy(e.target.value); } },
              h('option', { value: 'decision' }, 'By decision'),
              h('option', { value: 'score' }, 'Relevance'),
              h('option', { value: 'cites' }, 'Citations'),
              h('option', { value: 'q' }, 'Quartile (Q1→Q4)'),
              h('option', { value: 'year' }, 'Year (newest first)'))) : null),
        (stepPapers.length === 0 && papersLoading && !running) ? h('div', { style: { marginTop: 8 } }, [0, 1, 2, 3, 4].map(function (i) {
            return h('div', { key: i, className: 'pr-skel pr-skel-row', style: { width: (92 - i * 7) + '%' } });
          })) :
        stepPapers.length === 0 ? h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'No results yet — run the step.') :
          h('div', { style: { overflowX: 'auto', marginTop: 8 } }, h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 } },
            h('thead', null, h('tr', null,
              [['Decision', 'decision', 'left'], ['Paper', null, 'left'], ['Q', 'q', 'center'], ['Cites', 'cites', 'right'], ['Journal', null, 'left'], ['Year', 'year', 'right'], ['Score', 'score', 'right']].map(function (c, i) {
                return h('th', { key: i, onClick: c[1] ? function () { setSortBy(c[1]); } : null, role: c[1] ? 'button' : null, 'aria-label': c[1] ? ('Sort by ' + c[0]) : null, 'aria-sort': (c[1] && sortBy === c[1]) ? 'descending' : null, style: { textAlign: c[2], padding: '6px 8px', borderBottom: '2px solid var(--line)', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', cursor: c[1] ? 'pointer' : 'default', userSelect: 'none' }, title: c[1] ? 'Sort by this' : null }, c[0] + (c[1] && sortBy === c[1] ? ' ▾' : ''));
              }),
              props.canEdit ? h('th', { key: 'act', style: { textAlign: 'center', padding: '6px 8px', borderBottom: '2px solid var(--line)', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }, title: 'Override the AI screening decision' }, 'Your decision') : null)),
            h('tbody', null, sortPapers(stepPapers).map(function (p) {
              var m = metaOf(p); var s = srcMap[p.source_id]; var title = titles[p.source_id] || m.title || (s && s.title) || '(paper)';
              var url = (s && s.url) || m.url || (m.doi || null); var q = qOf(p);
              var b = p.decision === 'include' ? { t: '✅ Included', c: '#15803d', bg: 'rgba(22,163,74,.12)' } : p.decision === 'maybe' ? { t: '🟡 Maybe', c: '#b45309', bg: 'rgba(180,83,9,.1)' } : { t: '❌ Excluded', c: '#b91c1c', bg: 'rgba(220,38,38,.08)' };
              var ex = (p.signals && p.signals.extract) || {}; var cr = (p.signals && p.signals.criteria) || {};
              return h('tr', { key: p.source_id, style: { borderBottom: '1px solid var(--line)', verticalAlign: 'top' } },
                h('td', { style: { padding: '7px 8px', whiteSpace: 'nowrap' } }, h('span', { style: { fontSize: 11, fontWeight: 700, color: b.c, background: b.bg, borderRadius: 6, padding: '2px 6px' } }, b.t), p.overridden ? h('span', { className: 'mtag warn', style: { marginLeft: 4 } }, 'manual') : null),
                h('td', { style: { padding: '7px 8px', minWidth: 240 } },
                  h('div', { style: { fontWeight: 600 } }, url ? h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--ink)' } }, title) : title),
                  p.reason ? h('div', { className: 'result-reason' }, p.reason) : null,
                  (ex.method || ex.finding) ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 } },
                    ex.method ? h('span', { title: 'Method / approach (from the abstract)' }, '🔬 ' + ex.method + '   ') : null,
                    (ex.dataset && !/^none/i.test(ex.dataset)) ? h('span', { title: 'Dataset' }, '📊 ' + ex.dataset + '   ') : null,
                    ex.finding ? h('span', { title: 'Key finding / claim' }, '→ ' + ex.finding) : null) : null,
                  ((cr.inc || []).length || (cr.exc || []).length) ? h('div', { style: { display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' } },
                    (cr.inc || []).map(function (c, ci) { return h('span', { key: 'i' + ci, className: 'mtag', style: { background: 'rgba(22,163,74,.12)', color: '#15803d', border: '1px solid rgba(22,163,74,.35)' }, title: 'Inclusion criterion met' }, '✓ ' + c); }),
                    (cr.exc || []).map(function (c, ci) { return h('span', { key: 'e' + ci, className: 'mtag', style: { background: 'rgba(220,38,38,.1)', color: '#b91c1c', border: '1px solid rgba(220,38,38,.35)' }, title: 'Exclusion criterion that applies' }, '✗ ' + c); })) : null,
                  (p.signals && (p.signals.has_github || p.signals.has_dataset || p.signals.screened_on)) ? h('div', { style: { display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' } },
                    p.signals.has_github ? h('span', { className: 'mtag ok' }, 'github') : null,
                    p.signals.has_dataset ? h('span', { className: 'mtag ok' }, 'dataset') : null,
                    p.signals.screened_on === 'pdf' ? h('span', { className: 'mtag', style: { background: 'rgba(22,163,74,.12)', color: '#15803d', border: '1px solid rgba(22,163,74,.3)' }, title: 'Full text (PDF) downloaded and analyzed' }, '📄 full text')
                      : (p.signals.screened_on === 'abstract' && curStep >= 3) ? h('span', { className: 'mtag', style: { background: 'rgba(180,83,9,.1)', color: '#b45309', border: '1px solid rgba(180,83,9,.3)' }, title: 'The PDF was not available/downloadable → screened on the abstract' }, '📝 abstract only')
                      : (p.signals.screened_on ? h('span', { className: 'mtag' }, p.signals.screened_on) : null)) : null),
                h('td', { style: { padding: '7px 8px', textAlign: 'center' } }, q ? h('span', { style: { fontSize: 11, fontWeight: 700, color: '#fff', background: q <= 1 ? '#16a34a' : q === 2 ? '#65a30d' : q === 3 ? '#b45309' : '#6b7280', borderRadius: 6, padding: '2px 6px' }, title: 'Scopus/SCImago quartile (SJR)' }, 'Q' + q) : h('span', { style: { color: 'var(--faint)' } }, '–')),
                h('td', { style: { padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }, title: 'Citations (OpenAlex — WoS/Scopus proxy)' }, m.cited_by != null ? m.cited_by : '–'),
                h('td', { style: { padding: '7px 8px', maxWidth: 170 } }, m.venue ? h('span', { title: m.venue }, String(m.venue).length > 38 ? String(m.venue).slice(0, 36) + '…' : m.venue) : h('span', { style: { color: 'var(--faint)' } }, '–')),
                h('td', { style: { padding: '7px 8px', textAlign: 'right' } }, m.year || '–'),
                h('td', { style: { padding: '7px 8px', textAlign: 'right' } }, p.score != null ? p.score + '%' : '–'),
                props.canEdit ? h('td', { style: { padding: '7px 8px' } },
                  h('div', { style: { fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginBottom: 3, textAlign: 'center' }, title: 'Click to override the AI decision' }, 'Your decision'),
                  h('div', { className: 'seg', role: 'group', 'aria-label': 'Your decision — override the AI screening', style: { flex: 'none' } }, ['include', 'maybe', 'exclude'].map(function (v) { return h('button', { key: v, className: p.decision === v ? 'on' : '', 'aria-pressed': p.decision === v, 'aria-label': v, title: v, onClick: function () { override(p, v); } }, v === 'include' ? '✓' : v === 'maybe' ? '?' : '✕'); }))) : null);
            }))))
      ) : null,
      // 📚 studies manage modal — view all studies + delete (cascades to steps/papers)
      studiesOpen ? h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflow: 'auto' }, onClick: function () { setStudiesOpen(false); } },
        h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Studies', style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, width: 'min(680px, 100%)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--surface)' } },
            h('h3', { style: { margin: 0 } }, h('span', { 'aria-hidden': 'true' }, '📚 '), 'Studies (' + studies.length + ')'),
            h('button', { className: 'icon-x', 'aria-label': 'Close', style: { marginLeft: 'auto' }, onClick: function () { setStudiesOpen(false); } }, '✕')),
          h('div', { style: { padding: '4px 16px 16px' } },
            studies.length ? studies.map(function (s) {
              return h('div', { key: s.id, style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--line)' } },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontSize: 13.5, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, s.title),
                  s.question ? h('div', { style: { fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 54, overflow: 'hidden' } }, s.question) : null,
                  h('div', { style: { display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' } },
                    h('span', { className: 'chip ' + (s.status === 'done' ? 'c-ok' : 'c-warn') }, s.status === 'done' ? '✓ done' : 'step ' + (s.cur_step || 1) + '/4'),
                    s.id === selId ? h('span', { className: 'chip c-acc' }, 'selected') : null)),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, flex: 'none' } },
                  h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, onClick: function () { setSelId(s.id); setCurStep(s.cur_step || 1); setStudiesOpen(false); } }, 'Open'),
                  props.canEdit ? h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12, color: 'var(--danger)' }, onClick: function () { delStudy(s); } }, '🗑 Delete') : null));
            }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '12px 0' } }, 'No studies yet.')
          )
        )
      ) : null
    );
  }

  // ---------- Task editor (full-field modal for a protocol step; manual + AI-refine) ----------
  var PROT_KINDS = ['data', 'preprocess', 'train', 'eval', 'analysis', 'figure', 'writeup', 'custom'];
  // Shared drag&drop collector: turns a drop event into [{file, relpath}] — folders traversed recursively.
  function walkEntry(entry, prefix) {
    return new Promise(function (resolve) {
      if (entry.isFile) { entry.file(function (f) { resolve([{ file: f, relpath: prefix + entry.name }]); }, function () { resolve([]); }); }
      else if (entry.isDirectory) {
        var reader = entry.createReader(); var all = [];
        (function readBatch() {
          reader.readEntries(function (ents) {
            if (!ents.length) { Promise.all(all.map(function (c) { return walkEntry(c, prefix + entry.name + '/'); })).then(function (a) { resolve(a.reduce(function (x, y) { return x.concat(y); }, [])); }); }
            else { all = all.concat(Array.prototype.slice.call(ents)); readBatch(); }
          }, function () { resolve([]); });
        })();
      } else resolve([]);
    });
  }
  function collectDropped(e) {
    var items = e.dataTransfer && e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      var entries = []; for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) entries.push(en); }
      return Promise.all(entries.map(function (en) { return walkEntry(en, ''); })).then(function (a) { return a.reduce(function (x, y) { return x.concat(y); }, []); });
    }
    return Promise.resolve(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).map(function (f) { return { file: f, relpath: f.name }; }));
  }
  function TaskEditorModal(props) {
    var st = props.step || {}; var sx0 = st.spec || {};
    var tt = useState(st.title || ''), title = tt[0], setTitle = tt[1];
    var kk = useState(st.kind || 'custom'), kind = kk[0], setKind = kk[1];
    var ii = useState(sx0.instruction || ''), instr = ii[0], setInstr = ii[1];
    var ip = useState(sx0.inputs || []), inputs = ip[0], setInputs = ip[1];
    var oo = useState(sx0.expected_outputs || []), outs = oo[0], setOuts = oo[1];
    var aa = useState(sx0.acceptance || []), accept = aa[0], setAccept = aa[1];
    var cc = useState(sx0.command_hint || ''), cmd = cc[0], setCmd = cc[1];
    var ee = useState(sx0.est_minutes != null ? String(sx0.est_minutes) : ''), est = ee[0], setEst = ee[1];
    var dd = useState(st.depends_on || []), deps = dd[0], setDeps = dd[1];
    var nn = useState(!!st.needs_approval), needsApp = nn[0], setNeedsApp = nn[1];
    var rr = useState(false), refining = rr[0], setRefining = rr[1];
    var atA = useState(sx0.attachments || []), att = atA[0], setAtt = atA[1];   // per-task uploaded files/folders
    var ubA = useState(''), upBusy = ubA[0], setUpBusy = ubA[1];
    var dgA = useState(false), dragOver = dgA[0], setDragOver = dgA[1];
    var fileRef = useRef(null), folderRef = useRef(null);
    // ---- task assistant (ephemeral, task-scoped AI chat inside the editor) ----
    var cmS = useState([]), cmsgs = cmS[0], setCmsgs = cmS[1];   // [{role,content,questions?,suggestion?}]
    var ciS = useState(''), cinput = ciS[0], setCinput = ciS[1];
    var cbS = useState(false), cbusy = cbS[0], setCbusy = cbS[1];
    var cscroll = useRef(null);
    useEffect(function () { var el = cscroll.current; if (el) el.scrollTop = el.scrollHeight; }, [cmsgs, cbusy]);
    function applySuggestion(sug, silent) {
      if (!sug) return;
      if (sug.title) setTitle(String(sug.title));
      if (sug.kind && PROT_KINDS.indexOf(sug.kind) >= 0) setKind(sug.kind);
      if (sug.instruction != null) setInstr(String(sug.instruction));
      if (Array.isArray(sug.inputs)) setInputs(sug.inputs.filter(Boolean));
      if (Array.isArray(sug.expected_outputs)) setOuts(sug.expected_outputs.filter(Boolean));
      if (Array.isArray(sug.acceptance)) setAccept(sug.acceptance.filter(Boolean));
      if (sug.command_hint != null) setCmd(String(sug.command_hint));
      if (!silent) window.PRUI.toast('Applied the assistant’s suggestions — review & Save', { kind: 'ok' });
    }
    // send a picked answer to a clarifying question (question kept as context for the AI)
    function answerQuestion(q, opt) { if (cbusy) return; askAssistant('For "' + q + '": ' + opt, { userBubble: opt }); }
    function askAssistant(text, opts) {
      opts = opts || {};
      var files = opts.files || att;
      var bubble = opts.userBubble != null ? opts.userBubble : text;
      var history = cmsgs.map(function (m) { return { role: m.role, content: m.content }; });
      if (bubble) setCmsgs(function (m) { return m.concat([{ role: 'user', content: bubble }]); });
      setCbusy(true);
      var task = { title: title, kind: kind, instruction: instr, inputs: inputs, expected_outputs: outs, acceptance: accept, command_hint: cmd };
      sb.functions.invoke('research-protocol', { body: { action: 'task_assist', project_id: props.projectId, task: task, message: text, history: history, files: files.map(function (a) { return { name: a.name, mime: a.mime, size: a.size, note: a.note }; }) } }).then(function (r) {
        setCbusy(false); var d = r && r.data;
        if (!d || d.error) { setCmsgs(function (m) { return m.concat([{ role: 'assistant', content: 'AI is unavailable' + (d && d.error ? ': ' + d.error : '') + '.' }]); }); return; }
        // auto-fill the task fields as soon as the assistant has enough (no button click needed)
        var applied = '';
        if (d.suggestion) { applySuggestion(d.suggestion, true); applied = sugSummary(d.suggestion).replace(/^Fills: /, ''); }
        setCmsgs(function (m) { return m.concat([{ role: 'assistant', content: d.reply || '…', questions: d.questions || [], applied: applied }]); });
      }, function () { setCbusy(false); setCmsgs(function (m) { return m.concat([{ role: 'assistant', content: 'AI connection failed — is research-protocol deployed?' }]); }); });
    }
    function sendChat() { var t = cinput.trim(); if (!t || cbusy) return; setCinput(''); askAssistant(t); }
    function toggleDep(o) { setDeps(function (d) { return d.indexOf(o) >= 0 ? d.filter(function (x) { return x !== o; }) : d.concat([o]); }); }
    function uploadList(items) {   // items: [{file, relpath}] — shared by the inputs and the drop zone
      if (!items.length) return;
      var batch = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7);
      var added = [], done = 0; setUpBusy('Uploading 0/' + items.length);
      (function next(i) {
        if (i >= items.length) { if (added.length) { setAtt(function (a) { return a.concat(added); }); askAssistant('I just uploaded ' + added.length + ' file(s) for this task: ' + added.map(function (x) { return x.name; }).join(', ') + '. What do you need to know to define the task around this data?', { files: att.concat(added), userBubble: '📎 Uploaded: ' + added.map(function (x) { return x.name; }).join(', ') }); } setUpBusy(''); return; }
        var f = items[i].file; var rel = items[i].relpath || f.name;
        var sp = props.projectId + '/protocol/' + batch + '/' + rel.replace(/[^A-Za-z0-9._\/-]/g, '_');
        sb.storage.from('research-data').upload(sp, f).then(function (res) {
          done++; setUpBusy('Uploading ' + done + '/' + items.length);
          if (res && res.error) window.PRUI.toast(rel + ': ' + res.error.message, { kind: 'error' });
          else added.push({ name: rel, storage_path: sp, mime: f.type || '', size: f.size, note: '' });
          next(i + 1);
        }, function () { done++; next(i + 1); });
      })(0);
    }
    function uploadFiles(e) {
      var fs = Array.prototype.slice.call((e.target && e.target.files) || []); if (e.target) e.target.value = '';
      uploadList(fs.map(function (f) { return { file: f, relpath: f.webkitRelativePath || f.name }; }));
    }
    function onDrop(e) {
      e.preventDefault(); setDragOver(false);
      collectDropped(e).then(uploadList);
    }
    function setNote(i, v) { setAtt(function (x) { return x.map(function (it, j) { return j === i ? Object.assign({}, it, { note: v }) : it; }); }); }
    function removeAtt(i) {
      var a = att[i]; if (a && a.storage_path) { try { sb.storage.from('research-data').remove([a.storage_path]); } catch (e) { } }
      setAtt(function (x) { return x.filter(function (_, j) { return j !== i; }); });
    }
    function dlAtt(a) { sb.storage.from('research-data').createSignedUrl(a.storage_path, 3600, { download: (a.name || '').split('/').pop() }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function save() {
      if (!title.trim()) { window.PRUI.toast('A title is required', { kind: 'error' }); return; }
      props.onSave({ title: title.trim(), kind: kind, spec: { instruction: instr, inputs: inputs, expected_outputs: outs, acceptance: accept, command_hint: cmd, est_minutes: est ? parseInt(est, 10) : null, attachments: att }, depends_on: deps, needs_approval: needsApp });
    }
    function refine() {
      if (!st.id) return; setRefining(true);
      sb.functions.invoke('research-protocol', { body: { action: 'refine_step', project_id: props.projectId, step_id: st.id } }).then(function (r) {
        setRefining(false); var sp = r && r.data && r.data.step;
        if (!sp) { window.PRUI.toast('Refine failed: ' + ((r && r.data && r.data.error) || ''), { kind: 'error' }); return; }
        if (sp.title) setTitle(sp.title); if (sp.kind) setKind(sp.kind);
        if (sp.instruction != null) setInstr(sp.instruction); if (sp.inputs) setInputs(sp.inputs); if (sp.expected_outputs) setOuts(sp.expected_outputs);
        if (sp.acceptance) setAccept(sp.acceptance); if (sp.command_hint != null) setCmd(sp.command_hint); if (sp.est_minutes != null) setEst(String(sp.est_minutes)); if (sp.needs_approval != null) setNeedsApp(!!sp.needs_approval);
        window.PRUI.toast('Refined — review and Save', { kind: 'ok' });
      }, function (e) { setRefining(false); window.PRUI.toast('Refine failed: ' + e, { kind: 'error' }); });
    }
    function sugSummary(s) { var p = []; if (s.title) p.push('title'); if (s.kind) p.push('kind'); if (s.instruction != null) p.push('instruction'); if (s.inputs) p.push('inputs'); if (s.expected_outputs) p.push('outputs'); if (s.acceptance) p.push('acceptance'); if (s.command_hint != null) p.push('command'); return 'Fills: ' + (p.join(', ') || '—'); }
    var msgBubble = function (m, i) {
      var mine = m.role === 'user';
      return h('div', { key: i, style: { display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 } },
        h('div', { style: { maxWidth: '90%' } },
          h('div', { style: { background: mine ? 'var(--accent)' : 'var(--surface)', color: mine ? '#fff' : 'var(--ink)', border: mine ? 'none' : '1px solid var(--line)', borderRadius: 12, padding: '8px 11px', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, m.content),
          (!mine && m.questions && m.questions.length) ? h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 7 } }, m.questions.map(function (qq, qi) {
            var q = typeof qq === 'string' ? qq : ((qq && qq.q) || ''); var opts = (qq && qq.options) || [];
            return h('div', { key: qi, style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: opts.length ? 6 : 2 } }, '❓ ' + q),
              opts.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, opts.map(function (o, oi) {
                return h('button', { key: oi, disabled: cbusy, title: 'Pick this answer — the task auto-fills', style: { fontSize: 11.5, color: 'var(--accent)', background: 'var(--accent-tint)', border: '1px solid color-mix(in srgb,var(--accent) 25%,transparent)', borderRadius: 999, padding: '4px 11px', cursor: cbusy ? 'default' : 'pointer' }, onClick: function () { answerQuestion(q, o); } }, o);
              })) : h('div', { style: { fontSize: 11, color: 'var(--faint)' } }, '↓ Type your answer below'));
          })) : null,
          (!mine && m.applied && m.applied !== '—') ? h('div', { style: { marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 7, background: 'var(--ok-bg)', border: '1px solid color-mix(in srgb,var(--ok) 30%,transparent)', borderRadius: 10, padding: '7px 11px', fontSize: 11.5, color: 'var(--ok)', lineHeight: 1.45 } }, h('span', { style: { flex: 'none' } }, '✓'), h('span', null, 'Auto-filled the task — ' + m.applied + '. Review on the left & Save.')) : null));
    };
    var chatPane = h('div', { style: { flex: '1 1 44%', minWidth: 300, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--softer, #f7f8fb)' } },
      h('div', { style: { padding: '11px 14px', borderBottom: '1px solid var(--line)', flex: 'none' } },
        h('div', { style: { fontWeight: 700, fontSize: 13 } }, '💬 Task assistant'),
        h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 1 } }, 'Answer the questions (pick an option) and the task fills in automatically')),
      h('div', { ref: cscroll, style: { flex: 1, overflow: 'auto', padding: 14, minHeight: 0 } },
        cmsgs.length ? cmsgs.map(msgBubble) : h('div', { style: { fontSize: 12, color: 'var(--faint)', textAlign: 'center', padding: '28px 12px', lineHeight: 1.6 } }, 'Ask me to help define this task — e.g. “what should the acceptance checks be?” — or attach data and I’ll ask what I need to know.'),
        cbusy ? h('div', { style: { fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: '2px 4px' } }, '✨ Assistant is thinking…') : null),
      h('div', { style: { borderTop: '1px solid var(--line)', padding: 10, display: 'flex', gap: 7, alignItems: 'flex-end', flex: 'none' } },
        h('textarea', { className: 'field', rows: 2, style: { flex: 1, boxSizing: 'border-box', fontSize: 12.5, resize: 'none' }, placeholder: 'Message the assistant…  (Enter to send)', value: cinput, disabled: cbusy, onChange: function (e) { setCinput(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } } }),
        h('button', { className: 'btn pri', style: { flex: 'none', height: 34 }, disabled: cbusy || !cinput.trim(), onClick: sendChat }, '➤')));
    return h('div', { className: 'scrim', onClick: props.onClose }, h('div', {
      className: 'modal', style: { width: 'min(1000px, 96vw)' }, onClick: function (e) { e.stopPropagation(); },
      // the WHOLE editor accepts drops (files or folders) — the zone below is just the visual target
      onDragOver: function (e) { e.preventDefault(); if (!dragOver) setDragOver(true); },
      onDragLeave: function (e) { if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; setDragOver(false); },
      onDrop: onDrop
    },
      h('div', { className: 'modal-h' },
        h('h3', { style: { margin: 0, flex: 1 } }, props.isNew ? 'New task' : 'Edit task'),
        st.id ? h('button', { className: 'btn', style: { padding: '4px 9px', fontSize: 12, flex: 'none' }, disabled: refining, title: 'Let Publify improve this step', onClick: refine }, refining ? '✨…' : '✨ Refine') : null,
        h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: props.onClose }, '✕')),
      h('div', { style: { display: 'flex', maxHeight: '74vh', minHeight: 340 } },
        h('div', { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', flex: '1 1 56%', minWidth: 0 } },
        refining ? h(AiThinking, { label: 'Refining this task', mini: true }) : null,
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { className: 'field', style: { flex: 1 }, placeholder: 'Task title', value: title, onChange: function (e) { setTitle(e.target.value); } }),
          h('select', { className: 'field', style: { width: 130, flex: 'none' }, value: kind, onChange: function (e) { setKind(e.target.value); } }, PROT_KINDS.map(function (x) { return h('option', { key: x, value: x }, x); }))),
        h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: needsApp, onChange: function (e) { setNeedsApp(e.target.checked); } }), '⏸ Needs my approval before the runner executes it'),
        h('div', null, h('div', { className: 'field-label' }, 'Instruction'), h('textarea', { className: 'field', rows: 3, style: { width: '100%', boxSizing: 'border-box' }, placeholder: 'Exactly what the agent should do…', value: instr, onChange: function (e) { setInstr(e.target.value); } })),
        h('div', null, h('div', { className: 'field-label' }, 'Inputs'), h(CritEditor, { items: inputs, onChange: setInputs, placeholder: 'a file / dataset / prior-step output', empty: 'No inputs.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Expected outputs'), h(CritEditor, { items: outs, onChange: setOuts, placeholder: 'a file / metric / artifact produced', empty: 'No outputs.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Acceptance — done when…'), h(CritEditor, { items: accept, onChange: setAccept, accent: '#16a34a', placeholder: 'an objective success check', empty: 'No acceptance checks.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Command hint'), h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }, placeholder: 'a likely shell command / script', value: cmd, onChange: function (e) { setCmd(e.target.value); } })),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h('span', { className: 'field-label', style: { margin: 0 } }, 'Est. minutes'), h('input', { className: 'field', type: 'number', min: 0, style: { width: 100 }, value: est, onChange: function (e) { setEst(e.target.value); } })),
        h('div', null,
          h('div', { className: 'field-label' }, 'Attachments — files / folders for this task'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' } },
            h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { if (fileRef.current) fileRef.current.click(); } }, '⤒ Add files'),
            h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Upload a whole folder (structure preserved)', onClick: function () { if (folderRef.current) folderRef.current.click(); } }, '📁 Add folder'),
            upBusy ? h('span', { style: { fontSize: 11.5, color: 'var(--muted)' } }, '⏳ ' + upBusy) : null,
            h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, onChange: uploadFiles }),
            h('input', { ref: function (n) { if (n) { try { n.webkitdirectory = true; n.directory = true; } catch (e) { } } folderRef.current = n; }, type: 'file', multiple: true, style: { display: 'none' }, onChange: uploadFiles })),
          h('div', { className: 'att-drop' + (dragOver ? ' over' : ''), onDragOver: function (e) { e.preventDefault(); if (!dragOver) setDragOver(true); }, onDragLeave: function (e) { e.preventDefault(); setDragOver(false); }, onDrop: onDrop },
            dragOver ? '⤓ Drop to upload' : '⤓ Drag & drop files or a folder here'),
          att.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 } }, att.map(function (a, i) {
            return h('div', { key: i, style: { background: 'var(--soft)', padding: '5px 8px', borderRadius: 6 } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5 } },
                h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.name }, '📎 ' + a.name),
                h('span', { style: { color: 'var(--faint)', flex: 'none' } }, a.size != null ? (Math.max(1, Math.round(a.size / 1024)) + ' KB') : ''),
                h('button', { className: 'fb-mini', 'aria-label': 'Download', title: 'Download', onClick: function () { dlAtt(a); } }, '⬇'),
                h('button', { className: 'fb-mini', 'aria-label': 'Remove', title: 'Remove', onClick: function () { removeAtt(i); } }, '×')),
              h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box', marginTop: 4, fontSize: 11.5, padding: '3px 7px' }, placeholder: '📝 What to do with this file (optional per-file note)…', value: a.note || '', onChange: function (e) { setNote(i, e.target.value); } }));
          })) : h('div', { style: { fontSize: 11.5, color: 'var(--faint)' } }, 'No files yet. Upload files/folders, then say in the Instruction (or per-file note) what the runner should do with them.')),
        (props.allSteps && props.allSteps.filter(function (x) { return x.id !== st.id; }).length) ? h('div', null, h('div', { className: 'field-label' }, 'Depends on (must finish first)'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, props.allSteps.filter(function (x) { return x.id !== st.id; }).map(function (x) {
            return h('button', { key: x.id, className: 'lchip' + (deps.indexOf(x.ord) >= 0 ? ' on' : ''), style: { fontSize: 11 }, onClick: function () { toggleDep(x.ord); } }, x.ord + '. ' + (x.title || '').slice(0, 26));
          }))) : null
        ),
        chatPane
      ),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)' } },
        h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'),
        h('button', { className: 'btn pri', onClick: save }, props.isNew ? 'Add task' : 'Save'))
    ));
  }

  // ---------- Protocol (executable research plan; a Claude agent on a dedicated machine runs the steps) ----------
  function ProtocolPanel(props) {
    var KINDS = PROT_KINDS;
    var PST = { todo: ['c-grey', 'To do'], queued: ['c-acc', 'Queued'], running: ['c-warn', 'Running…'], blocked: ['c-warn', '⏸ Needs approval'], done: ['c-ok', '✓ Done'], failed: ['c-danger', '✗ Failed'], skipped: ['c-grey', 'Skipped'] };
    var PROT_CHIP = { draft: 'c-grey', ready: 'c-acc', running: 'c-warn', paused: 'c-grey', done: 'c-ok', failed: 'c-danger' };
    var lp = useState(null), prot = lp[0], setProt = lp[1];
    var sp = useState([]), steps = sp[0], setSteps = sp[1];
    var ld = useState(true), loading = ld[0], setLoading = ld[1];
    var gg = useState(''), goal = gg[0], setGoal = gg[1];
    var bz = useState(false), busy = bz[0], setBusy = bz[1];
    var ex = useState({}), exp = ex[0], setExp = ex[1];
    var edS = useState(null), editing = edS[0], setEditing = edS[1];   // { step, isNew, after }
    var apS = useState(''), aiPrompt = apS[0], setAiPrompt = apS[1];
    var abS = useState(false), aiBusy = abS[0], setAiBusy = abS[1];
    var afS = useState([]), aiFiles = afS[0], setAiFiles = afS[1];     // data for AI task generation: uploaded {storage_path} or referenced {url}
    var aubS = useState(''), aiUpBusy = aubS[0], setAiUpBusy = aubS[1];   // null | {done,total,name,pct}
    var aiFileRef = useRef(null);
    var lkoS = useState(false), linkOpen = lkoS[0], setLinkOpen = lkoS[1];
    var lkuS = useState(''), linkUrl = lkuS[0], setLinkUrl = lkuS[1];
    var pcmS = useState([]), pcMsgs = pcmS[0], setPcMsgs = pcmS[1];   // protocol-wide chat (ephemeral)
    var pciS = useState(''), pcInput = pciS[0], setPcInput = pciS[1];
    var pcbS = useState(false), pcBusy = pcbS[0], setPcBusy = pcbS[1];
    var pcoS = useState(true), pcOpen = pcoS[0], setPcOpen = pcoS[1];
    var pcScroll = useRef(null);
    var rvS = useState(null), rvMd = rvS[0], setRvMd = rvS[1];   // full-report reader markdown
    var dsS = useState(null), dropStep = dsS[0], setDropStep = dsS[1];   // step id a file is being dragged over
    var usS = useState(null), upStep = usS[0], setUpStep = usS[1];       // { id, msg } while uploading onto a step
    var pvS = useState('overview'), pview = pvS[0], setPview = pvS[1];   // sub-view: 'overview' | 'steps'
    var lbS = useState(null), lb = lbS[0], setLb = lbS[1];               // figure lightbox { src, cap }
    var rfS = useState([]), rfiles = rfS[0], setRfiles = rfS[1];         // project deliverable files
    var pfS = useState(null), prevFile = pfS[0], setPrevFile = pfS[1];   // deliverable open in the rich preview modal
    var zpS = useState(false), zipping = zpS[0], setZipping = zpS[1];    // ZIP-all in progress
    var ikS = useState(null), intake = ikS[0], setIntake = ikS[1];       // file-intake clarifying-questions modal {file, stepId, context}
    function intakeDone(result) {
      var it = intake; setIntake(null);
      var s = it && steps.filter(function (x) { return x.id === it.stepId; })[0];
      if (!s || !result || !result.qa || !result.qa.length) return;   // skipped / no answers → nothing to store
      var note = '\n\n[Uploaded file “' + it.file.path + '”' + (result.summary ? ' — ' + result.summary : '') + ']\n' + result.qa.map(function (x) { return '• ' + x.question + '\n  → ' + x.answer; }).join('\n');
      var sx = Object.assign({}, s.spec || {}); sx.instruction = ((sx.instruction || '') + note).slice(0, 8000);
      patchStep(s, { spec: sx });
      window.PRUI.toast('Saved your file notes to task ' + s.ord + '.', { kind: 'ok' });
    }
    var ntS = useState({}), noteDraft = ntS[0], setNoteDraft = ntS[1];   // per-step composer { <id>: { kind, body } }
    var ndS = useState({}), notesData = ndS[0], setNotesData = ndS[1];   // review notes keyed by step id
    var bdS = useState(null), boardDrag = bdS[0], setBoardDrag = bdS[1];  // task-board drag: 'step:<id>' | 'todo:<id>'
    var bhS = useState(null), boardOver = bhS[0], setBoardOver = bhS[1];  // task-board drop-target column
    var tdS = useState([]), todos = tdS[0], setTodos = tdS[1];            // personal ToDos on this project (research_todos)
    var tmS = useState(null), todoModal = tmS[0], setTodoModal = tmS[1]; // null | {} add | {todo} edit
    var ce = props.canEdit;
    // ---- result helpers (read the runner's structured output) ----
    function acOf(s) {
      var r = s.result && s.result.acceptance_check; if (!r || typeof r !== 'object') return null;
      var items = Object.keys(r).map(function (k) { var v = String(r[k]); var ok = v.indexOf('PASS') === 0; return { crit: k, ok: ok, reason: ok ? '' : v.replace(/^FAIL:?\s*/, '') }; });
      if (!items.length) return null;
      return { total: items.length, pass: items.filter(function (x) { return x.ok; }).length, items: items };
    }
    function devsOf(s) { return (s.result && s.result.deviations) || []; }
    function figsOf(s) { return (s.result && s.result.figures) || []; }
    function notesOf(s) { return notesData[s.id] || []; }
    function protStats() {
      var acP = 0, acT = 0, dv = 0, fg = 0, dn = 0;
      steps.forEach(function (s) { var a = acOf(s); if (a) { acP += a.pass; acT += a.total; } dv += devsOf(s).length; fg += figsOf(s).length; if (s.status === 'done') dn++; });
      return { acPass: acP, acTot: acT, dev: dv, fig: fg, done: dn };
    }
    function loadNotes() {
      if (!prot) return;
      sb.from('research_protocol_notes').select('id,step_id,kind,body,author_id,created_at').eq('protocol_id', prot.id).order('created_at', { ascending: true }).then(function (r) {
        var rows = (r && r.data) || [];
        var ids = rows.map(function (n) { return n.author_id; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
        function finish(names) { var by = {}; rows.forEach(function (n) { n.author_name = names[n.author_id] || 'Member'; (by[n.step_id] = by[n.step_id] || []).push(n); }); setNotesData(by); }
        if (ids.length) sb.from('profiles_public').select('id,name').in('id', ids).then(function (pr) { var m = {}; ((pr && pr.data) || []).forEach(function (x) { m[x.id] = x.name; }); finish(m); }, function () { finish({}); });
        else finish({});
      }, function () { });
    }
    // Post a review note. Any project member may comment (RLS: read-access = member); the runner never overwrites these.
    function addNote(s, kind, body) {
      if (!(body || '').trim() || !prot) return;
      sb.from('research_protocol_notes').insert({ project_id: props.projectId, protocol_id: prot.id, step_id: s.id, author_id: props.authorId, kind: kind, body: body.trim() }).then(function (r) {
        if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        setNoteDraft(function (p) { var n = Object.assign({}, p); delete n[s.id]; return n; });
        loadNotes();
      });
    }
    function spawnFollowup(s, body) {
      var txt = (body || '').trim(); if (!txt) return;
      insertSteps([{ title: txt.slice(0, 120), kind: 'custom', instruction: txt, depends_on: [s.ord], needs_approval: true }], s).then(function () {
        window.PRUI.toast('New task created after step ' + s.ord + ' — review it, then “Send for evaluation”.', { kind: 'ok' });
      });
      setNoteDraft(function (p) { var n = Object.assign({}, p); delete n[s.id]; return n; });
    }
    function sendForEval(s) { patchStep(s, { status: 'queued' }); }
    // drop files/folders straight onto a task row → upload + append to that step's spec.attachments
    function uploadToStep(s, items) {
      if (!items.length) return;
      var batch = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7);
      var added = [], done = 0; setUpStep({ id: s.id, msg: 'Uploading 0/' + items.length });
      (function next(i) {
        if (i >= items.length) {
          setUpStep(null);
          if (added.length) {
            var sx = Object.assign({}, s.spec || {}); sx.attachments = (sx.attachments || []).concat(added);
            patchStep(s, { spec: sx });
            window.PRUI.toast('📎 ' + added.length + ' file(s) attached to task ' + s.ord, { kind: 'ok' });
            // clarify what to do with it: summarize + ask 1-2 questions, saved back into the task instruction
            setIntake({ stepId: s.id, file: { path: added[0].name }, context: 'Protocol task ' + s.ord + ': ' + s.title + ((s.spec && s.spec.instruction) ? ' — ' + String(s.spec.instruction).slice(0, 400) : '') });
          }
          return;
        }
        var f = items[i].file; var rel = items[i].relpath || f.name;
        var sp = props.projectId + '/protocol/' + batch + '/' + rel.replace(/[^A-Za-z0-9._\/-]/g, '_');
        sb.storage.from('research-data').upload(sp, f).then(function (res) {
          done++; setUpStep({ id: s.id, msg: 'Uploading ' + done + '/' + items.length });
          if (res && res.error) window.PRUI.toast(rel + ': ' + res.error.message, { kind: 'error' });
          else added.push({ name: rel, storage_path: sp, mime: f.type || '', size: f.size, note: '' });
          next(i + 1);
        }, function () { done++; next(i + 1); });
      })(0);
    }
    function buildFullReport() {
      var L = ['# ' + (prot.title || 'Protocol') + '\n'];
      if (prot.goal) L.push('> ' + prot.goal + '\n');
      var done = steps.filter(function (s) { return s.status === 'done'; }).length;
      L.push('*' + done + '/' + steps.length + ' steps complete · status: ' + prot.status + '*\n\n---\n');
      steps.forEach(function (s) {
        var r = s.result || {};
        if (r.report) L.push(r.report);
        else L.push('## Step ' + s.ord + ' — ' + s.title + '\n\n*' + (PST[s.status] ? PST[s.status][1] : s.status) + '*' + (r.summary ? '\n\n' + r.summary : ''));
        (r.figures || []).forEach(function (f) { L.push('\n![' + (f.title || '') + '](' + f.img + ')\n'); });
        L.push('\n---\n');
      });
      return L.join('\n');
    }
    function load() {
      sb.from('research_protocols').select('*').eq('project_id', props.projectId).neq('status', 'archived').order('created_at', { ascending: false }).limit(1).then(function (r) {
        var pp = (r && r.data && r.data[0]) || null; setProt(pp); setLoading(false);
        if (pp) sb.from('research_protocol_steps').select('*').eq('protocol_id', pp.id).order('ord', { ascending: true }).then(function (s) { setSteps((s && s.data) || []); });
        else setSteps([]);
      }, function () { setLoading(false); });
    }
    function loadFiles() { sb.from('research_files').select('id,path,content,storage_path,mime,size,updated_at').eq('project_id', props.projectId).order('updated_at', { ascending: false }).then(function (r) { setRfiles((r && r.data) || []); }); }
    function loadTodos() { sb.from('research_todos').select('*').eq('project_id', props.projectId).order('created_at', { ascending: false }).then(function (r) { setTodos((r && r.data) || []); }); }
    function moveTodo(t, key) { if (!ce) return; var p = todoColPatch(key); if (!p) return; setTodos(function (l) { return l.map(function (x) { return x.id === t.id ? Object.assign({}, x, p) : x; }); }); sb.from('research_todos').update(Object.assign({ updated_at: new Date().toISOString() }, p)).eq('id', t.id).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); loadTodos(); } }); }
    useEffect(function () { load(); loadFiles(); loadTodos(); }, [props.projectId]);
    useEffect(function () { loadNotes(); }, [prot && prot.id]);
    useEffect(function () { if (!prot || prot.status !== 'running') return; var t = setInterval(function () { load(); loadFiles(); loadNotes(); }, 5000); return function () { clearInterval(t); }; }, [prot && prot.id, prot && prot.status]);
    function generate() {
      if (busy) return; setBusy(true);
      sb.functions.invoke('research-protocol', { body: { action: 'generate', project_id: props.projectId, goal: goal } }).then(function (r) {
        setBusy(false);
        var err = (r && r.data && r.data.error) || (r && r.error && r.error.message);
        if (err) { window.PRUI.toast('Generation failed: ' + err, { kind: 'error' }); return; }
        setGoal(''); load(); if (props.onChanged) props.onChanged();
      }, function (e) { setBusy(false); window.PRUI.toast('Generation failed: ' + e, { kind: 'error' }); });
    }
    function setPStatus(st) { sb.from('research_protocols').update({ status: st, updated_at: new Date().toISOString() }).eq('id', prot.id).then(load); }
    function setProtField(field, val) { var patch = {}; patch[field] = val; patch.updated_at = new Date().toISOString(); sb.from('research_protocols').update(patch).eq('id', prot.id).then(function () { }); }
    function patchStep(s, patch) { sb.from('research_protocol_steps').update(patch).eq('id', s.id).then(load); }
    // renumber ord 1..N + remap each depends_on (ord-based) — two phases (negative temp ords) to dodge unique(protocol_id,ord)
    function repack(ordered) {
      var map = {}; ordered.forEach(function (s, i) { map[s.ord] = i + 1; });
      return Promise.all(ordered.map(function (s, i) { return sb.from('research_protocol_steps').update({ ord: -(i + 1) }).eq('id', s.id); })).then(function () {
        return Promise.all(ordered.map(function (s, i) {
          var nd = (s.depends_on || []).map(function (o) { return map[o]; }).filter(function (x) { return x && x < i + 1; });
          return sb.from('research_protocol_steps').update({ ord: i + 1, depends_on: nd }).eq('id', s.id);
        }));
      }).then(load);
    }
    function insertSteps(newSpecs, afterStep) {
      var rows = newSpecs.map(function (ns, k) { return { protocol_id: prot.id, ord: 100000 + k, title: (ns.title || 'New step').slice(0, 240), kind: ns.kind || 'custom', spec: ns.spec || { instruction: ns.instruction || '', inputs: ns.inputs || [], expected_outputs: ns.expected_outputs || [], acceptance: ns.acceptance || [], command_hint: ns.command_hint || '', est_minutes: (ns.est_minutes != null ? ns.est_minutes : null) }, depends_on: ns.depends_on || [], needs_approval: !!ns.needs_approval }; });
      return sb.from('research_protocol_steps').insert(rows).select().then(function (r) {
        var created = (r && r.data) || [];
        var base = steps.slice(); var pos = afterStep ? (base.findIndex(function (x) { return x.id === afterStep.id; }) + 1) : base.length;
        return repack(base.slice(0, pos).concat(created).concat(base.slice(pos)));
      });
    }
    function delStep(s) { window.PRUI.confirm({ title: 'Delete task?', body: s.title, danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (!ok) return; sb.from('research_protocol_steps').delete().eq('id', s.id).then(function () { repack(steps.filter(function (x) { return x.id !== s.id; })); }); }); }
    function move(s, dir) { var i = steps.findIndex(function (x) { return x.id === s.id; }); var j = i + dir; if (j < 0 || j >= steps.length) return; var o = steps.slice(); var tmp = o[i]; o[i] = o[j]; o[j] = tmp; repack(o); }
    function duplicate(s) { insertSteps([{ title: s.title + ' (copy)', kind: s.kind, spec: s.spec, depends_on: s.depends_on, needs_approval: s.needs_approval }], s); }
    function saveTask(data) {
      var ed = editing; setEditing(null); if (!ed) return;
      if (ed.isNew) {
        if (ed.after) insertSteps([data], ed.after);
        else { var mx = steps.reduce(function (m, x) { return Math.max(m, x.ord); }, 0); sb.from('research_protocol_steps').insert({ protocol_id: prot.id, ord: mx + 1, title: data.title, kind: data.kind, spec: data.spec, depends_on: data.depends_on || [], needs_approval: !!data.needs_approval }).then(load); }
      } else { sb.from('research_protocol_steps').update({ title: data.title, kind: data.kind, spec: data.spec, depends_on: data.depends_on || [], needs_approval: !!data.needs_approval }).eq('id', ed.step.id).then(load); }
    }
    function aiSplit(s) {
      if (busy) return; setBusy(true);
      sb.functions.invoke('research-protocol', { body: { action: 'split_step', project_id: props.projectId, step_id: s.id } }).then(function (r) {
        setBusy(false); var subs = r && r.data && r.data.steps;
        if (!subs || !subs.length) { window.PRUI.toast('Split failed: ' + ((r && r.data && r.data.error) || ''), { kind: 'error' }); return; }
        var rows = subs.map(function (ns, k) { return { protocol_id: prot.id, ord: 100000 + k, title: (ns.title || 'Sub-step').slice(0, 240), kind: ns.kind || s.kind, spec: { instruction: ns.instruction || '', inputs: ns.inputs || [], expected_outputs: ns.expected_outputs || [], acceptance: ns.acceptance || [], command_hint: ns.command_hint || '', est_minutes: (ns.est_minutes != null ? ns.est_minutes : null) }, depends_on: k === 0 ? (s.depends_on || []) : [100000 + (k - 1)], needs_approval: !!ns.needs_approval }; });
        sb.from('research_protocol_steps').insert(rows).select().then(function (ins) {
          var created = (ins && ins.data) || []; var pos = steps.findIndex(function (x) { return x.id === s.id; }); var base = steps.filter(function (x) { return x.id !== s.id; });
          sb.from('research_protocol_steps').delete().eq('id', s.id).then(function () { repack(base.slice(0, pos).concat(created).concat(base.slice(pos))); });
        });
      }, function (e) { setBusy(false); window.PRUI.toast('Split failed: ' + e, { kind: 'error' }); });
    }
    // resumable (TUS) upload → large files go through, chunked, with real byte progress
    function tusUpload(file, path, token, onProg) {
      return new Promise(function (resolve, reject) {
        var up = new window.tus.Upload(file, {
          endpoint: (window.PR_CONFIG || {}).supabaseUrl + '/storage/v1/upload/resumable',
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: { authorization: 'Bearer ' + token, 'x-upsert': 'true' },
          uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024,
          metadata: { bucketName: 'research-data', objectName: path, contentType: file.type || 'application/octet-stream' },
          onError: reject, onProgress: function (s, t) { onProg(t ? s / t : 0); }, onSuccess: function () { resolve(); }
        });
        up.findPreviousUploads().then(function (prev) { if (prev && prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); }, function () { up.start(); });
      });
    }
    function aiUploadData(fileList) {
      var items = Array.prototype.slice.call(fileList || []); if (!items.length) return;
      var batch = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7);
      var added = [], done = 0, total = items.length, CFG = window.PR_CONFIG || {};
      function endFinish() {
        if (added.length) setAiFiles(function (a) { return a.concat(added); });
        setAiUpBusy(null);
        window.PRUI.toast(added.length < total ? (total - added.length) + ' file(s) failed to upload' : '✓ Uploaded ' + added.length + ' file' + (added.length === 1 ? '' : 's'), { kind: added.length < total ? 'error' : 'ok' });
      }
      sb.auth.getSession().then(function (sess) {
        var token = (sess && sess.data && sess.data.session && sess.data.session.access_token) || CFG.supabaseAnonKey;
        setAiUpBusy({ done: 0, total: total, name: (items[0].webkitRelativePath || items[0].name), pct: 0 });
        (function next(i) {
          if (i >= total) { endFinish(); return; }
          var f = items[i], rel = f.webkitRelativePath || f.name;
          var sp = props.projectId + '/protocol/' + batch + '/' + rel.replace(/[^A-Za-z0-9._\/-]/g, '_');
          setAiUpBusy({ done: done, total: total, name: rel, pct: 0 });
          var ok = function () { done++; added.push({ name: rel, storage_path: sp, mime: f.type || '', size: f.size, note: '' }); setAiUpBusy({ done: done, total: total, name: rel, pct: 0 }); next(i + 1); };
          var fail = function (err) { done++; window.PRUI.toast(rel + ': ' + ((err && err.message) || 'upload failed'), { kind: 'error' }); setAiUpBusy({ done: done, total: total, name: rel, pct: 0 }); next(i + 1); };
          if (f.size > 6 * 1024 * 1024 && window.tus) {
            tusUpload(f, sp, token, function (p) { setAiUpBusy({ done: done, total: total, name: rel, pct: p }); }).then(ok, fail);
          } else {
            sb.storage.from('research-data').upload(sp, f, { upsert: true }).then(function (res) { if (res && res.error) fail(res.error); else ok(); }, fail);
          }
        })(0);
      });
    }
    function addLink() {
      var u = (linkUrl || '').trim(); if (!/^https?:\/\//i.test(u)) { window.PRUI.toast('Paste an http(s) data link', { kind: 'error' }); return; }
      var nm = (decodeURIComponent(u.split('?')[0].split('#')[0].split('/').pop() || '') || u).slice(0, 80);
      setAiFiles(function (a) { return a.concat([{ name: nm, url: u, note: '' }]); });
      setLinkUrl(''); setLinkOpen(false);
    }
    // ---- protocol-wide chat: a live activity feed (from the tasks' state) + a task-aware AI conversation ----
    function pcEvents() {
      var ev = [];
      (steps || []).forEach(function (s) {
        var pst = PST[s.status] || PST.todo, r = s.result || {};
        ev.push({ id: 'st' + s.id + s.status, icon: STEP_ICON[s.kind] || '•', when: s.finished_at || s.started_at || s.created_at, title: 'Task ' + s.ord + ' · ' + s.title, body: 'Status: ' + pst[1] + (s.needs_approval && (s.status === 'todo' || s.status === 'blocked') ? ' — waiting for your approval' : '') });
        if (r.summary) ev.push({ id: 'rs' + s.id, icon: '📋', when: s.finished_at, title: 'Task ' + s.ord + ' — result', body: r.summary });
        if (r.error) ev.push({ id: 'er' + s.id, icon: '⚠️', when: s.finished_at, title: 'Task ' + s.ord + ' — failed', body: r.error });
        if (r.adaptation) ev.push({ id: 'ad' + s.id, icon: '⚙️', when: s.finished_at, title: 'Task ' + s.ord + ' — adaptation', body: r.adaptation });
        (notesOf(s) || []).forEach(function (n) {
          ev.push({ id: 'nt' + n.id, icon: n.author_name === 'Citation Optimizer' ? '🔗' : (n.kind === 'dir' ? '🧭' : n.kind === 'obs' ? '💬' : '⚠'), when: n.created_at, title: (n.author_name || 'Member') + ' → task ' + s.ord, body: n.body });
        });
      });
      ev.sort(function (a, b) { return (a.when ? Date.parse(a.when) : 0) - (b.when ? Date.parse(b.when) : 0); });
      return ev;
    }
    function pcSend() {
      var t = (pcInput || '').trim(); if (!t || pcBusy || !prot) return;
      var history = pcMsgs.map(function (m) { return { role: m.role, content: m.content }; });
      setPcMsgs(function (m) { return m.concat([{ role: 'user', content: t }]); }); setPcInput(''); setPcBusy(true);
      sb.functions.invoke('research-protocol', { body: { action: 'protocol_chat', project_id: props.projectId, protocol_id: prot.id, message: t, history: history } }).then(function (r) {
        setPcBusy(false); var d = r && r.data;
        setPcMsgs(function (m) { return m.concat([{ role: 'assistant', content: (d && d.reply) || ('AI is unavailable' + (d && d.error ? ': ' + d.error : '') + '.') }]); });
      }, function () { setPcBusy(false); setPcMsgs(function (m) { return m.concat([{ role: 'assistant', content: 'AI connection failed — is research-protocol deployed?' }]); }); });
    }
    useEffect(function () { var el = pcScroll.current; if (el) el.scrollTop = el.scrollHeight; }, [pcMsgs, pcBusy]);
    useEffect(function () {   // keep the activity feed fresh while tasks are actually running
      if (!pcOpen || !prot || !(steps || []).some(function (s) { return s.status === 'running' || s.status === 'queued'; })) return;
      var t = setInterval(function () { load(); }, 12000);
      return function () { clearInterval(t); };
    }, [pcOpen, steps, prot]);   // eslint-disable-line
    function removeAiFile(i) { var a = aiFiles[i]; if (a && a.storage_path) { try { sb.storage.from('research-data').remove([a.storage_path]); } catch (e) { } } setAiFiles(function (x) { return x.filter(function (_, j) { return j !== i; }); }); }
    function dlAiFile(a) { if (!a || !a.storage_path) return; sb.storage.from('research-data').createSignedUrl(a.storage_path, 3600, { download: (a.name || '').split('/').pop() }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function aiAppend() {
      var p = aiPrompt.trim(); if ((!p && !aiFiles.length) || aiBusy) return; setAiBusy(true);
      var files = aiFiles;
      sb.functions.invoke('research-protocol', { body: { action: 'append_steps', protocol_id: prot.id, project_id: props.projectId, prompt: p, files: files.map(function (a) { return { name: a.name, mime: a.mime, size: a.size, note: a.note, url: a.url }; }) } }).then(function (r) {
        var subs = r && r.data && r.data.steps;
        if (!subs || !subs.length) { setAiBusy(false); window.PRUI.toast('No tasks suggested: ' + ((r && r.data && r.data.error) || ''), { kind: 'error' }); return; }
        // attach UPLOADED data (not URL references) to the first generated (data-ingest) step so the runner has it
        var upl = files.filter(function (a) { return a.storage_path; });
        if (upl.length && subs[0]) { var s0 = subs[0]; subs[0].spec = { instruction: s0.instruction || '', inputs: s0.inputs || [], expected_outputs: s0.expected_outputs || [], acceptance: s0.acceptance || [], command_hint: s0.command_hint || '', est_minutes: (s0.est_minutes != null ? s0.est_minutes : null), attachments: upl }; }
        insertSteps(subs, null).then(function () { setAiBusy(false); setAiPrompt(''); setAiFiles([]); window.PRUI.toast('Added ' + subs.length + ' task' + (subs.length === 1 ? '' : 's') + (upl.length ? ' — your data is attached to the first' : ''), { kind: 'ok' }); });
      }, function (e) { setAiBusy(false); window.PRUI.toast('Add failed: ' + e, { kind: 'error' }); });
    }

    if (loading) return h('div', { className: 'empty' }, 'Loading protocol…');

    if (!prot) return h('div', { className: 'panel' },
      h('h3', { style: { marginTop: 0 } }, '🧪 Protocol'),
      h('p', { style: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 } }, 'Generate an executable research plan — an ordered ToDo list (data → preprocess → baselines → method → evaluation → figures) built from your idea and the literature you selected in Studies. A Claude agent on your dedicated machine can then run it step by step, with your approval on the expensive ones.'),
      ce ? h('div', null,
        h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box', marginBottom: 8 }, placeholder: 'Optional goal / constraints (e.g. "reproduce the per-class AUROC + Fisher fusion rescue on nuScenes")', value: goal, disabled: busy, onChange: function (e) { setGoal(e.target.value); } }),
        h('button', { className: 'btn pri', disabled: busy, onClick: generate }, busy ? '✨ Working…' : '✨ Generate protocol'),
        busy ? h('div', { style: { marginTop: 10 } }, h(AiThinking, { label: 'Reading your idea & the selected literature, drafting an executable protocol' })) : null
      ) : h('div', { className: 'empty' }, 'No protocol yet.')
    );

    if (rvMd) return h(ReportViewer, {
      md: rvMd, inline: true, title: prot.title + ' — result report', onClose: function () { setRvMd(null); },
      onSave: ce ? function (md) {
        var slug = (prot.title || 'protocol').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'protocol';
        return sb.from('research_files').upsert({ project_id: props.projectId, path: 'protocol/' + slug + '_report.md', content: md, mime: 'text/markdown', source: 'ai', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (r) {
          if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); throw r.error; }
          window.PRUI.toast('Saved to project files (Ideas → Files): protocol/' + slug + '_report.md', { kind: 'ok' });
          if (props.onChanged) props.onChanged();
        });
      } : null
    });

    var done = steps.filter(function (s) { return s.status === 'done'; }).length;
    var pct = steps.length ? Math.round(done / steps.length * 100) : 0;
    var alive = prot.heartbeat_at && (Date.now() - new Date(prot.heartbeat_at).getTime() < 30000);
    var hasResults = steps.some(function (s) { return s.result && (s.result.report || s.result.summary); });
    var stt = protStats();
    // ---- Overview: verdict + status matrix + deliverables + the full report rendered inline ----
    function renderOverview() {
      var allpass = stt.acTot > 0 && stt.acPass === stt.acTot;
      var doc = buildDoc(buildFullReport());
      var deliv = rfiles;   // every project file is a deliverable (text, data, images, PDFs, binaries)
      return h('div', null,
        h('div', { className: 'panel' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 } },
            stt.acTot ? h('span', { className: 'chip ' + (allpass ? 'c-ok' : 'c-warn'), style: { fontSize: 12, padding: '5px 11px' } }, (allpass ? '✓ ' : '⚠ ') + stt.acPass + '/' + stt.acTot + ' acceptance checks passed') : null,
            h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, stt.done + '/' + steps.length + ' tasks complete' + (stt.dev ? ' · ' + stt.dev + ' documented deviations' : '') + (stt.fig ? ' · ' + stt.fig + ' figures' : '')),
            ce ? h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '4px 10px', fontSize: 12, flex: 'none' }, title: 'Add a new task (even after the protocol has finished — use “Re-open & run” to execute it)', onClick: function () { setEditing({ step: {}, isNew: true, after: null }); } }, '+ Add task') : null
          ),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, steps.map(function (s) {
            var a = acOf(s); var bad = a && a.pass < a.total; var col = s.status === 'done' ? (bad ? 'var(--warn)' : 'var(--ok)') : (s.status === 'running' || s.status === 'queued' ? 'var(--accent)' : 'var(--faint)');
            return h('button', { key: s.id, className: 'smx', title: s.title, onClick: function () { setExp(function (p) { var n = Object.assign({}, p); n[s.id] = true; return n; }); setPview('steps'); } },
              h('span', { className: 'smx-dot', style: { background: col } }), h('b', null, s.ord + '.'), ' ' + (s.title.length > 32 ? s.title.slice(0, 32) + '…' : s.title),
              a ? h('span', { style: { marginLeft: 5, color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' } }, a.pass + '/' + a.total) : null);
          }))
        ),
        deliv.length ? h('div', { className: 'panel' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
            h('h3', { style: { margin: 0 } }, '📦 Deliverables', h('span', { style: { fontWeight: 600, color: 'var(--faint)', marginLeft: 6 } }, deliv.length + '')),
            h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '4px 10px', fontSize: 12, flex: 'none' }, disabled: zipping, title: 'Download every deliverable as one ZIP', onClick: function () { setZipping(true); zipFiles(deliv, (prot.title || 'protocol').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'deliverables').then(function () { setZipping(false); }, function () { setZipping(false); window.PRUI.toast('Could not build the ZIP.', { kind: 'error' }); }); } }, zipping ? '⏳ Zipping…' : '⬇ Download all (ZIP)')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } }, deliv.map(function (f) {
            return h('div', { key: f.id, className: 'deliv click', onClick: function () { setPrevFile(f); } },
              h('span', { className: 'deliv-ic' }, fileIcon(f)),
              h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, h('b', { style: { fontSize: 12.5 } }, f.path), f.size ? h('span', { style: { fontSize: 11, color: 'var(--faint)', marginLeft: 6 } }, Math.round(f.size / 1024) + ' KB') : null),
              h('span', { className: 'btn', style: { padding: '2px 9px', fontSize: 11, flex: 'none' }, title: 'Preview' }, '👁 Open'),
              h('span', { className: 'btn', style: { padding: '2px 9px', fontSize: 11, flex: 'none' }, title: 'Download (native format)', onClick: function (e) { e.stopPropagation(); downloadFile(f); } }, '⬇'));
          }))
        ) : null,
        hasResults ? h('div', { className: 'panel' },
          h('h3', null, '📄 Full report',
            h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, flex: 'none' }, title: 'Download the report as PDF (opens the print dialog)', onClick: function () { setRvMd(buildFullReport()); setTimeout(function () { try { window.print(); } catch (e) { } }, 350); } }, '⬇ PDF'),
            h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, title: 'Open full screen', onClick: function () { setRvMd(buildFullReport()); } }, '⛶ Full screen')),
          h('div', { className: 'doc-embed-wrap' }, h('div', { className: 'doc-embed' },
            doc.toc.length > 2 ? h('nav', { className: 'rv-toc doc-embed-toc' }, h('div', { className: 'rv-toc-h' }, 'Contents'), doc.toc.map(function (t) { return h('button', { key: t.id, className: 'rv-toc-i lvl' + t.level, onClick: function () { var el = document.getElementById(t.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t.text); })) : null,
            h('article', { className: 'report-doc', dangerouslySetInnerHTML: { __html: doc.html } })
          ))
        ) : null
      );
    }
    // ---- Execution Dashboard (New design flag, direction A): KPI row + a dense task table replacing the step list. Same steps / acOf / assigneeOf / PST. ----
    function execDashboard() {
      return h('div', null,
        h('div', { className: 'ex-kpi' },
          h('div', { className: 'ex-k' }, h('div', { className: 'ex-kn' }, stt.acTot ? (stt.acPass + '/' + stt.acTot) : '—'), h('div', { className: 'ex-kl' }, 'Acceptance checks')),
          h('div', { className: 'ex-k' }, h('div', { className: 'ex-kn' }, done + '/' + steps.length), h('div', { className: 'ex-kl' }, 'Tasks complete')),
          h('div', { className: 'ex-k' }, h('div', { className: 'ex-kn' }, String(stt.dev)), h('div', { className: 'ex-kl' }, 'Deviations')),
          h('div', { className: 'ex-k' }, h('div', { className: 'ex-kn' }, String(stt.fig)), h('div', { className: 'ex-kl' }, 'Figures'))
        ),
        h('div', { className: 'panel', style: { padding: '12px 14px' } },
          h('div', { className: 'ex-thd' },
            h('h3', { style: { margin: 0 } }, 'Tasks', h('span', { style: { fontWeight: 600, color: 'var(--faint)', marginLeft: 6 } }, steps.length)),
            ce ? h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setEditing({ step: {}, isNew: true, after: null }); } }, '+ Add task') : null),
          steps.length ? h('div', { className: 'ex-tblwrap' }, h('table', { className: 'ex-tbl' },
            h('thead', null, h('tr', null,
              h('th', { className: 'r' }, '#'), h('th', null, 'Task'), h('th', null, 'Owner'), h('th', null, 'Status'), h('th', { className: 'r' }, 'Checks'))),
            h('tbody', null, steps.map(function (s) {
              var open = !!exp[s.id]; var pst = PST[s.status] || PST.todo; var a = acOf(s); var ai = assigneeOf(s) === 'ai'; var sx = s.spec || {};
              var out = [h('tr', { key: s.id, className: 'ex-row', onClick: function () { setExp(function (p) { var n = Object.assign({}, p); n[s.id] = !n[s.id]; return n; }); } },
                h('td', { className: 'r ex-ord' }, s.ord),
                h('td', { className: 'ex-ti' }, h('span', { 'aria-hidden': 'true', style: { marginRight: 6 } }, STEP_ICON[s.kind] || '•'), (open ? '▾ ' : '▸ ') + s.title,
                  s.needs_approval ? h('span', { className: 'chip c-warn', style: { fontSize: 9.5, marginLeft: 6, flex: 'none' } }, '⏸') : null,
                  (sx.origin === 'citation-optimizer') ? h('span', { className: 'chip', style: { fontSize: 9.5, marginLeft: 6, background: 'var(--accent-tint)', color: 'var(--accent)' }, title: 'Added by the Citation Optimizer' }, '🔗') : null,
                  (sx.attachments && sx.attachments.length) ? h('span', { className: 'chip', style: { fontSize: 9.5, marginLeft: 5 }, title: 'Attachments' }, '📎 ' + sx.attachments.length) : null,
                  (s.depends_on && s.depends_on.length) ? h('span', { className: 'ex-dep' }, 'after ' + s.depends_on.join(',')) : null),
                h('td', null, h('span', { className: 'ex-own ' + (ai ? 'ai' : 'hu') }, ai ? 'AI' : 'HUMAN')),
                h('td', null, h('span', { className: 'chip ' + pst[0], style: { fontSize: 10 } }, pst[1])),
                h('td', { className: 'r ex-chk' }, a ? (a.pass + '/' + a.total) : '—')
              )];
              if (open) {
                var res = s.result || {};
                var acFails = (a && a.items) ? a.items.filter(function (it) { return !it.ok; }) : [];
                out.push(h('tr', { key: s.id + '-d', className: 'ex-drow' }, h('td', { colSpan: 5, className: 'ex-detail' },
                  sx.instruction ? h('div', null, sx.instruction) : null,
                  res.summary ? h('div', { style: { marginTop: 6 } }, h('b', null, 'Result: '), res.summary) : null,
                  res.error ? h('div', { className: 'ex-err', style: { marginTop: 6 } }, h('b', null, '✗ Error: '), String(res.error.message || res.error)) : null,
                  acFails.length ? h('div', { style: { marginTop: 6 } }, h('b', { style: { color: 'var(--danger)' } }, 'Failed checks: '), acFails.map(function (it, k) { return h('div', { key: k, className: 'ex-acfail' }, '• ' + it.crit + (it.reason ? ' — ' + it.reason : '')); })) : null,
                  (!sx.instruction && !res.summary && !res.error && !acFails.length) ? h('div', { style: { color: 'var(--faint)' } }, 'No details yet.') : null,
                  ce ? h('div', { className: 'ex-acts' },
                    (s.status === 'blocked' || (s.needs_approval && s.status === 'todo')) ? h('button', { className: 'btn pri', style: { padding: '3px 10px', fontSize: 12 }, title: 'Approve so the runner may execute this step', onClick: function (e) { e.stopPropagation(); patchStep(s, { status: 'queued' }); } }, '✓ Approve to run') : null,
                    h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, onClick: function (e) { e.stopPropagation(); setEditing({ step: s, isNew: false }); } }, '✎ Edit')
                  ) : null
                )));
              }
              return out;
            }))
          )) : h('div', { className: 'ex-empty' }, 'No tasks yet — add one, or generate the protocol.')
        )
      );
    }
    // ---- Task board (Kanban): human↔AI columns via the shared BOARD_COLS / stepCol / colPatch (module scope) ----
    // moving a card to a column encodes (assignee, status) via colPatch(). Writing `assignee` needs migration-44.
    function moveToCol(s, key) { if (!ce) return; var patch = colPatch(key); if (patch) patchStep(s, patch); }
    function boardCard(s) {
      var a = assigneeOf(s), ac = acOf(s), sx = s.spec || {};
      var chips = [];
      if (sx.est_minutes) chips.push(h('span', { className: 'bchip' }, '⏱ ' + sx.est_minutes + 'p'));
      if ((sx.attachments || []).length) chips.push(h('span', { className: 'bchip' }, '📎 ' + sx.attachments.length));
      if ((s.depends_on || []).length) chips.push(h('span', { className: 'bchip' }, '⛓ ' + s.depends_on.join(',')));
      if (notesOf(s).length) chips.push(h('span', { className: 'bchip' }, '💬 ' + notesOf(s).length));
      if (s.needs_approval && s.status !== 'done') chips.push(h('span', { className: 'bchip warn' }, '⏸ approval'));
      if (figsOf(s).length) chips.push(h('span', { className: 'bchip' }, '📈 ' + figsOf(s).length));
      return h('div', {
        key: s.id, className: 'bcard ' + (a === 'human' ? 'hu' : 'ai'), draggable: ce,
        onDragStart: ce ? function (e) { setBoardDrag('step:' + s.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); } catch (x) { } } : null,
        onDragEnd: ce ? function () { setBoardDrag(null); setBoardOver(null); } : null,
        onClick: function () { setPview('steps'); setExp(function (p) { var n = Object.assign({}, p); n[s.id] = true; return n; }); },
        title: 'Open in Tasks & results'
      },
        h('div', { className: 'bcard-top' }, h('span', { 'aria-hidden': 'true' }, STEP_ICON[s.kind] || '•'),
          h('span', { className: 'bchip who ' + (a === 'human' ? 'hu' : 'ai') }, a === 'human' ? 'HUMAN' : 'AI'),
          ac ? h('span', { className: 'bchip ' + (ac.pass === ac.total ? 'ok' : 'fail') }, ac.pass + '/' + ac.total + ' ✓') : null),
        h('div', { className: 'bcard-t' }, h('span', { style: { color: 'var(--faint)' } }, s.ord + '. '), s.title),
        chips.length ? h('div', { className: 'bcard-m' }, chips) : null
      );
    }
    // a personal ToDo card on the protocol board (visually distinct from AI/protocol steps)
    function todoBoardCard(t) {
      var a = t.assignee === 'human' ? 'human' : 'ai', pr = PRIO_META[t.priority];
      var overdue = t.due && t.status !== 'done' && t.due < new Date().toISOString().slice(0, 10);
      var chips = [];
      if (t.due) chips.push(h('span', { key: 'd', className: 'bchip' + (overdue ? ' warn' : '') }, '📅 ' + t.due));
      if (t.notes) chips.push(h('span', { key: 'n', className: 'bchip' }, '📝'));
      return h('div', {
        key: 'todo-' + t.id, className: 'bcard todo ' + (a === 'human' ? 'hu' : 'ai'), draggable: ce,
        onDragStart: ce ? function (e) { setBoardDrag('todo:' + t.id); try { e.dataTransfer.effectAllowed = 'move'; } catch (x) { } } : null,
        onDragEnd: ce ? function () { setBoardDrag(null); setBoardOver(null); } : null,
        onClick: ce ? function () { setTodoModal({ todo: t }); } : null, title: 'Edit task'
      },
        h('div', { className: 'bcard-top' }, h('span', { className: 'bchip todo-tag' }, '📝 ToDo'),
          h('span', { className: 'bchip who ' + (a === 'human' ? 'hu' : 'ai') }, a === 'human' ? 'HUMAN' : 'AI'),
          pr ? h('span', { className: 'bchip', style: { background: 'color-mix(in srgb,' + pr.c + ' 16%, transparent)', color: pr.c } }, pr.l) : null),
        h('div', { className: 'bcard-t' }, t.title),
        chips.length ? h('div', { className: 'bcard-m' }, chips) : null
      );
    }
    function onBoardDrop(col) {
      setBoardOver(null); if (!boardDrag) return; var d = boardDrag; setBoardDrag(null);
      if (d.indexOf('todo:') === 0) { var t = todos.filter(function (x) { return x.id === d.slice(5); })[0]; if (t) moveTodo(t, col.key); }
      else { var s = steps.filter(function (x) { return x.id === d.slice(5); })[0]; if (s) moveToCol(s, col.key); }
    }
    function renderBoard() {
      return h('div', { className: 'panel', style: { overflow: 'hidden' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h('h3', { style: { margin: 0 } }, '🗂️ Task board', h('span', { style: { marginLeft: 10, fontSize: 10.5, color: 'var(--faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 } }, ce ? 'drag cards between columns — owner + status update' : 'read-only view')),
          ce ? h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: function () { setTodoModal({}); } }, '+ Add task') : null),
        h('div', { className: 'bwrap' }, BOARD_COLS.map(function (col) {
          var cards = steps.filter(function (s) { return stepCol(s) === col.key; });
          var tcards = todos.filter(function (t) { return todoStepCol(t) === col.key; });
          var est = cards.reduce(function (a, s) { return a + ((s.spec && s.spec.est_minutes) || 0); }, 0);
          var total = cards.length + tcards.length;
          return h('div', {
            key: col.key, className: 'bcol' + (boardOver === col.key ? ' over' : '') + (' cap-' + (col.who === 'human' ? 'hu' : col.who === 'ai' ? 'ai' : 'bk')),
            onDragOver: ce ? function (e) { e.preventDefault(); if (boardOver !== col.key) setBoardOver(col.key); } : null,
            onDrop: ce ? function (e) { e.preventDefault(); onBoardDrop(col); } : null
          },
            h('div', { className: 'bcol-h' }, h('span', null, BCOL_IC[col.key]), h('span', { className: 'bcol-t' }, col.title), h('span', { className: 'bcol-n' }, total + '')),
            est ? h('div', { className: 'bcol-est' }, '⏱ ~' + est + 'p') : null,
            h('div', { className: 'bcol-b' }, total ? cards.map(boardCard).concat(tcards.map(todoBoardCard)) : h('div', { className: 'bcol-empty' }, '—'))
          );
        })),
        todoModal ? h(TodoModal, { todo: todoModal.todo, projectId: props.projectId, ownerId: props.authorId, onClose: function () { setTodoModal(null); }, onSaved: function () { setTodoModal(null); loadTodos(); } }) : null
      );
    }
    return h('div', null,
      h('div', { className: 'panel' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0, flex: 1, minWidth: 160 } }, '🧪 ', prot.title),
          h('span', { className: 'chip ' + (PROT_CHIP[prot.status] || 'c-grey') }, prot.status),
          steps.some(function (s) { return s.result && (s.result.report || s.result.summary); }) ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, title: 'Open the full formatted result report', onClick: function () { setRvMd(buildFullReport()); } }, '📄 Report') : null,
          ce ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, disabled: busy, title: 'Re-generate (archives the current one)', onClick: generate }, busy ? '✨…' : '↻ Re-generate') : null,
          (ce && (prot.status === 'draft' || prot.status === 'paused')) ? h('button', { className: 'btn pri', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, title: 'Make it claimable by your dedicated runner', onClick: function () { setPStatus('ready'); } }, '▶ Mark ready') : null,
          (ce && (prot.status === 'done' || prot.status === 'failed')) ? h('button', { className: 'btn pri', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, title: 'Re-open this protocol so the runner picks up newly added tasks', onClick: function () { setPStatus('ready'); } }, '▶ Re-open & run') : null,
          (ce && (prot.status === 'ready' || prot.status === 'running')) ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: function () { setPStatus('paused'); } }, '⏸ Pause') : null
        ),
        prot.goal ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 4 } }, prot.goal) : null,
        h('div', { className: 'meter', style: { marginTop: 10 } }, h('i', { style: { width: pct + '%' } })),
        h('div', { style: { display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--muted)', marginTop: 4 } },
          h('span', null, done + '/' + steps.length + ' done · ' + pct + '%'),
          alive ? h('span', { style: { color: 'var(--ok)' } }, '● runner active') : (prot.status === 'ready' ? h('span', null, 'waiting for a runner to claim it…') : null)),
        ce ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 } },
          h('input', { className: 'field', style: { flex: 1, minWidth: 140 }, placeholder: 'Runner ID (dedicated machine)', defaultValue: prot.runner_id || '', onBlur: function (e) { setProtField('runner_id', e.target.value || null); } }),
          h('input', { className: 'field', style: { flex: 2, minWidth: 180 }, placeholder: 'Repo URL (git)', defaultValue: (prot.repo && prot.repo.url) || '', onBlur: function (e) { setProtField('repo', Object.assign({}, prot.repo || {}, { url: e.target.value })); } })
        ) : null,
        busy ? h('div', { style: { marginTop: 10 } }, h(AiThinking, { label: 'The AI is working on this protocol' })) : null,
        hasResults ? h('div', { className: 'ptabs' },
          h('button', { className: 'ptab' + (pview === 'overview' ? ' on' : ''), onClick: function () { setPview('overview'); } }, 'Overview'),
          h('button', { className: 'ptab' + (pview === 'steps' ? ' on' : ''), onClick: function () { setPview('steps'); } }, 'Tasks & results', h('span', { className: 'ptab-c' }, steps.length)),
          h('button', { className: 'ptab' + (pview === 'board' ? ' on' : ''), onClick: function () { setPview('board'); } }, '🗂️ Board')
        ) : null
      ),
      (hasResults && pview === 'overview') ? renderOverview() : null,
      (hasResults && pview === 'board') ? renderBoard() : null,
      (nd() && (!hasResults || pview === 'steps')) ? execDashboard() : null,
      (!nd() && (!hasResults || pview === 'steps')) ? h('div', { className: 'panel' },
        h('h3', null, 'Steps (' + steps.length + ')', ce ? h('span', { style: { marginLeft: 10, fontSize: 10.5, color: 'var(--faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 } }, '⤓ drop files on a task to attach') : null, ce ? h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setEditing({ step: {}, isNew: true, after: null }); } }, '+ Add task') : null),
        steps.length ? steps.map(function (s, i) {
          var open = !!exp[s.id]; var pst = PST[s.status] || PST.todo; var sx = s.spec || {};
          return h('div', {
            key: s.id,
            style: Object.assign({ borderBottom: '1px solid var(--soft)', padding: '8px 0' },
              dropStep === s.id ? { background: 'var(--accent-tint)', outline: '1.5px dashed var(--accent)', outlineOffset: '-2px', borderRadius: 8 } : null),
            onDragOver: ce ? function (e) { e.preventDefault(); e.stopPropagation(); if (dropStep !== s.id) setDropStep(s.id); } : null,
            onDragLeave: ce ? function (e) { if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; setDropStep(null); } : null,
            onDrop: ce ? function (e) { e.preventDefault(); e.stopPropagation(); setDropStep(null); collectDropped(e).then(function (its) { uploadToStep(s, its); }); } : null
          },
            (upStep && upStep.id === s.id) ? h('div', { style: { fontSize: 11.5, color: 'var(--accent)', margin: '0 0 4px 28px' } }, '⏳ ' + upStep.msg) : null,
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { style: { width: 18, textAlign: 'right', color: 'var(--faint)', fontSize: 12, flex: 'none' } }, s.ord),
              h('span', { 'aria-hidden': 'true', title: s.kind, style: { fontSize: 14, flex: 'none' } }, STEP_ICON[s.kind] || '•'),
              h('button', { style: { flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer', color: 'var(--ink)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, onClick: function () { setExp(function (p) { var n = Object.assign({}, p); n[s.id] = !n[s.id]; return n; }); } }, (open ? '▾ ' : '▸ ') + s.title),
              (sx.origin === 'citation-optimizer') ? h('span', { className: 'chip', style: { fontSize: 10, flex: 'none', background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }, title: 'Added by the Citation Optimizer' }, '🔗 Citation') : null,
              (sx.attachments && sx.attachments.length) ? h('span', { className: 'chip', style: { fontSize: 10, flex: 'none' }, title: sx.attachments.map(function (a) { return a.name; }).join(', ') }, '📎 ' + sx.attachments.length) : null,
              s.needs_approval ? h('span', { className: 'chip c-warn', style: { fontSize: 10, flex: 'none' }, title: 'Requires your approval before the runner executes it' }, '⏸') : null,
              (s.depends_on && s.depends_on.length) ? h('span', { style: { fontSize: 10.5, color: 'var(--faint)', flex: 'none' }, title: 'Runs after these steps' }, 'after ' + s.depends_on.join(',')) : null,
              h('span', { className: 'chip ' + pst[0], style: { fontSize: 10, flex: 'none' } }, pst[1])
            ),
            open ? h('div', { style: { margin: '6px 0 2px 28px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 } },
              sx.instruction ? h('div', null, sx.instruction) : null,
              (sx.inputs && sx.inputs.length) ? h('div', { style: { marginTop: 4 } }, h('b', null, 'Inputs: '), sx.inputs.join(', ')) : null,
              (sx.expected_outputs && sx.expected_outputs.length) ? h('div', null, h('b', null, 'Outputs: '), sx.expected_outputs.join(', ')) : null,
              (sx.acceptance && sx.acceptance.length) ? h('div', null, h('b', null, 'Done when: '), sx.acceptance.join('; ')) : null,
              sx.command_hint ? h('div', { style: { marginTop: 4, fontFamily: 'monospace', fontSize: 11.5, background: 'var(--soft)', padding: '4px 7px', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, sx.command_hint) : null,
              sx.est_minutes ? h('span', { style: { fontSize: 11, color: 'var(--faint)' } }, '~' + sx.est_minutes + ' min') : null,
              (sx.attachments && sx.attachments.length) ? h('div', { style: { marginTop: 6 } },
                h('b', { style: { fontSize: 11.5 } }, '📎 Attachments (' + sx.attachments.length + '):'),
                sx.attachments.map(function (a, ai) {
                  return h('div', { key: ai, style: { display: 'flex', gap: 6, alignItems: 'baseline', marginTop: 2 } },
                    h('button', { className: 'lchip', style: { fontSize: 10.5, flex: 'none' }, title: 'Download ' + a.name, onClick: function () { sb.storage.from('research-data').createSignedUrl(a.storage_path, 3600, { download: (a.name || '').split('/').pop() }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); } }, '⬇ ' + ((a.name || '').split('/').pop())),
                    a.note ? h('span', { style: { fontSize: 11, color: 'var(--muted)' } }, '— ' + a.note) : null);
                })) : null,
              (s.result && s.result.report) ? h('div', { className: 'step-report', dangerouslySetInnerHTML: { __html: mdHtml(s.result.report) } }) : null,
              (s.result && s.result.summary && !s.result.report) ? h('div', { style: { marginTop: 6, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 } }, s.result.summary) : null,
              (s.result && s.result.adaptation && !s.result.report) ? h('div', { style: { marginTop: 4, fontSize: 11.5, color: 'var(--warn)' } }, '⚙ ' + s.result.adaptation) : null,
              (s.result && s.result.error) ? h('div', { style: { marginTop: 4, color: 'var(--danger)' } }, '⚠ ' + s.result.error) : null,
              (function () { var a = acOf(s); return a ? h('div', { style: { marginTop: 10 } },
                h('div', { className: 'res-h' }, (a.pass === a.total ? '✓ ' : '⚠ ') + 'Acceptance ' + a.pass + '/' + a.total),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, a.items.map(function (it, k) {
                  return h('div', { key: k, className: 'acc-row' + (it.ok ? '' : ' fail') }, h('span', { className: 'acc-mk' }, it.ok ? '✓' : '✗'), h('span', null, it.crit, it.reason ? h('span', { className: 'acc-rz' }, it.reason) : null));
                }))) : null; })(),
              (function () { var d = devsOf(s); return d.length ? h('div', { style: { marginTop: 10 } },
                h('div', { className: 'res-h' }, '⚙ Deviations from spec (' + d.length + ')'),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } }, d.map(function (x, k) { return h('div', { key: k, className: 'dev-row' }, x); }))) : null; })(),
              (function () { var m = s.result && s.result.metrics; if (!m || typeof m !== 'object') return null; var keys = Object.keys(m).filter(function (k) { var v = m[k]; return v == null || typeof v !== 'object'; }); return keys.length ? h('div', { style: { marginTop: 10 } },
                h('div', { className: 'res-h' }, 'Metrics'),
                h('div', { className: 'metric-wrap' }, h('table', { className: 'metric-t' }, h('tbody', null, keys.map(function (k) { return h('tr', { key: k }, h('td', { className: 'mk' }, k), h('td', { className: 'mv' }, String(m[k]))); })))),
                h('details', { style: { marginTop: 5 } }, h('summary', { style: { fontSize: 11, color: 'var(--muted)', cursor: 'pointer' } }, 'raw JSON'), h('pre', { style: { marginTop: 4, fontFamily: 'monospace', fontSize: 11, background: 'var(--soft)', padding: '6px 8px', borderRadius: 6, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220 } }, JSON.stringify(m, null, 1)))) : null; })(),
              (s.result && s.result.figures && s.result.figures.length) ? h('div', { style: { marginTop: 10 } }, h('div', { className: 'res-h' }, '🖼 Figures (' + s.result.figures.length + ')'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, s.result.figures.map(function (f, fi) { return h('figure', { key: fi, style: { margin: 0, width: 220 } }, h('img', { src: f.img, alt: f.title, loading: 'lazy', style: { width: '100%', borderRadius: 6, border: '1px solid var(--line)', cursor: 'zoom-in' }, onClick: function () { setLb({ src: f.img, cap: f.title || '' }); } }), f.title ? h('figcaption', { style: { fontSize: 10.5, color: 'var(--muted)', marginTop: 2 } }, f.title) : null); }))) : null,
              (s.result && s.result.artifacts && s.result.artifacts.length) ? h('div', { style: { marginTop: 10 } }, h('div', { className: 'res-h' }, '📎 Artifacts'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, s.result.artifacts.map(function (art, k) {
                var m2 = /^([a-z0-9-]+):(.+)$/i.exec(String(art)); var bucket = m2 && ['research-data', 'project-files'].indexOf(m2[1]) >= 0 ? m2[1] : null;
                return bucket ? h('button', { key: k, className: 'art-chip', title: m2[2], onClick: function () { sb.storage.from(bucket).createSignedUrl(m2[2], 3600, { download: m2[2].split('/').pop() }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); } }, '⬇ ' + m2[2].split('/').pop()) : h('span', { key: k, className: 'art-chip', title: String(art) }, String(art).split('/').pop());
              }))) : null,
              (s.result && s.result.runner_note) ? h('div', { style: { marginTop: 8, fontSize: 10.5, color: 'var(--faint)', fontStyle: 'italic' } }, s.result.runner_note) : null,
              (s.result || notesOf(s).length) ? h('div', { className: 'iter-dock' },
                h('div', { className: 'res-h', style: { color: 'var(--accent)' } }, '🧭 Concerns, notes & new directions'),
                notesOf(s).length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 9 } }, notesOf(s).map(function (n, k) {
                  var kl = n.kind === 'obs' ? ['💬', 'note'] : n.kind === 'dir' ? ['🧭', 'direction'] : ['⚠', 'concern'];
                  var isCO = n.author_name === 'Citation Optimizer';
                  return h('div', { key: n.id || k, className: 'note', style: isCO ? { borderLeft: '3px solid var(--accent)', paddingLeft: 9, background: 'var(--accent-tint)', borderRadius: 8 } : null }, h('span', { className: 'note-k' }, isCO ? '🔗' : kl[0]), h('div', { style: { flex: 1 } },
                    h('div', { style: { display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' } }, h('span', { className: 'note-who' }, n.author_name || 'Member'), h('span', { className: 'note-kd' }, isCO ? 'citation strategy' : kl[1]), n.created_at ? h('span', { className: 'note-when' }, new Date(n.created_at).toLocaleDateString()) : null),
                    h('div', { className: 'note-b' }, n.body)));
                })) : null,
                (function () {
                  var nd = noteDraft[s.id] || { kind: 'concern', body: '' };
                  function setND(patch) { setNoteDraft(function (p) { var n = Object.assign({}, p); n[s.id] = Object.assign({}, nd, patch); return n; }); }
                  var canTask = ce && nd.kind === 'dir';
                  return h('div', { className: 'iter-composer' },
                    h('div', { style: { display: 'flex', gap: 5, marginBottom: 7, flexWrap: 'wrap' } }, [['concern', '⚠ Concern'], ['obs', '💬 Note'], ['dir', '🧭 New direction']].map(function (o) { return h('button', { key: o[0], className: 'kbtn' + (nd.kind === o[0] ? ' on' : ''), onClick: function () { setND({ kind: o[0] }); } }, o[1]); })),
                    h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box', fontSize: 12.5 }, placeholder: nd.kind === 'dir' ? 'Describe the new direction / next task…' : 'Raise a concern or note about this result…', value: nd.body, onChange: function (e) { setND({ body: e.target.value }); } }),
                    h('div', { style: { display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' } },
                      h('button', { className: 'btn' + (canTask ? '' : ' pri'), style: { padding: '3px 10px', fontSize: 11.5 }, disabled: !(nd.body || '').trim(), onClick: function () { addNote(s, nd.kind, nd.body); } }, '＋ Post ' + (nd.kind === 'dir' ? 'direction' : nd.kind === 'obs' ? 'note' : 'concern')),
                      canTask ? h('button', { className: 'btn pri', style: { padding: '3px 10px', fontSize: 11.5 }, disabled: !(nd.body || '').trim(), title: 'Also create a runnable task after this step', onClick: function () { spawnFollowup(s, nd.body); } }, '＋ Create follow-up task') : null,
                      h('span', { style: { fontSize: 10.5, color: 'var(--faint)', flex: 1, minWidth: 100 } }, canTask ? 'A follow-up task is created after this step (needs approval); then “Approve to run” sends it for evaluation.' : 'Any project member can post notes here.'))
                  );
                })()
              ) : null,
              ce ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' } },
                h('button', { className: 'btn pri', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { setEditing({ step: s, isNew: false }); } }, '✎ Edit'),
                h('button', { className: 'btn', style: { padding: '2px 7px', fontSize: 11 }, title: 'Add a task right after this one', onClick: function () { setEditing({ step: {}, isNew: true, after: s }); } }, '+ after'),
                h('button', { className: 'btn', style: { padding: '2px 7px', fontSize: 11 }, onClick: function () { duplicate(s); } }, 'Duplicate'),
                h('button', { className: 'btn', style: { padding: '2px 7px', fontSize: 11 }, disabled: busy, title: 'Split into smaller sub-steps (AI)', onClick: function () { aiSplit(s); } }, '✨ Split'),
                h('button', { className: 'btn', style: { padding: '2px 7px', fontSize: 11 }, disabled: i === 0, onClick: function () { move(s, -1); } }, '↑'),
                h('button', { className: 'btn', style: { padding: '2px 7px', fontSize: 11 }, disabled: i === steps.length - 1, onClick: function () { move(s, 1); } }, '↓'),
                (s.status === 'blocked' || (s.needs_approval && s.status === 'todo')) ? h('button', { className: 'btn pri', style: { padding: '2px 7px', fontSize: 11 }, title: 'Approve so the runner may execute this step', onClick: function () { patchStep(s, { status: 'queued' }); } }, '✓ Approve to run') : null,
                h('button', { className: 'btn', style: { padding: '2px 7px', fontSize: 11, color: 'var(--danger)' }, onClick: function () { delStep(s); } }, 'Delete')
              ) : null
            ) : null
          );
        }) : h('div', { className: 'empty' }, 'No steps.'),
        ce ? h('div', { style: { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' } },
          h('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', marginBottom: 2 } }, '✨ Generate tasks with AI'),
          h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginBottom: 7 } }, 'Describe what you need — or attach data and the AI drafts a small pipeline to process it. (For a single task by hand, use “+ Add task” above.)'),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('input', { className: 'field', style: { flex: 1, minWidth: 0 }, placeholder: aiFiles.length ? 'Optional: how to process the attached data…' : 'e.g. "add an ablation comparing fusion variants" or attach a dataset →', value: aiPrompt, disabled: aiBusy, onChange: function (e) { setAiPrompt(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') aiAppend(); } }),
            h('button', { className: 'btn', style: { flex: 'none' }, title: 'Attach data — the AI generates tasks to process it', disabled: aiBusy || !!aiUpBusy, onClick: function () { if (aiFileRef.current) aiFileRef.current.click(); } }, aiUpBusy ? '⤒ …' : '⤒ Data'),
            h('input', { ref: aiFileRef, type: 'file', multiple: true, style: { display: 'none' }, onChange: function (e) { aiUploadData(e.target.files); if (e.target) e.target.value = ''; } }),
            h('button', { className: 'btn' + (linkOpen ? ' pri' : ''), style: { flex: 'none' }, title: 'Reference a dataset by URL instead of uploading (no size limit — best for large data)', disabled: aiBusy || !!aiUpBusy, onClick: function () { setLinkOpen(!linkOpen); } }, '🔗 Link'),
            h('button', { className: 'btn pri', style: { flex: 'none' }, disabled: aiBusy || !!aiUpBusy || (!aiPrompt.trim() && !aiFiles.length), onClick: aiAppend }, aiBusy ? '✨ Working…' : '✨ Generate')),
          linkOpen ? h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            h('input', { className: 'field', style: { flex: 1, minWidth: 0 }, placeholder: 'Paste a data URL (http/https) — a dataset, HuggingFace / Kaggle / Zenodo link…', value: linkUrl, onChange: function (e) { setLinkUrl(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') addLink(); } }),
            h('button', { className: 'btn pri', style: { flex: 'none' }, disabled: !linkUrl.trim(), onClick: addLink }, '＋ Add link')) : null,
          aiUpBusy ? h('div', { style: { marginTop: 8 } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 } },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }, title: aiUpBusy.name }, '⤒ Uploading ' + ((aiUpBusy.name || '').split('/').pop()) + (aiUpBusy.pct ? ' · ' + Math.round(aiUpBusy.pct * 100) + '%' : '')),
              h('span', { style: { flex: 'none', fontVariantNumeric: 'tabular-nums' } }, aiUpBusy.done + ' / ' + aiUpBusy.total)),
            h('div', { style: { height: 6, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' } },
              h('div', { style: { height: '100%', width: (aiUpBusy.total ? Math.round(100 * (aiUpBusy.done + (aiUpBusy.pct || 0)) / aiUpBusy.total) : 0) + '%', background: 'var(--accent)', borderRadius: 999, transition: 'width .2s' } }))) : null,
          aiFiles.length ? h('div', { style: { marginTop: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', background: 'var(--soft)' } },
            h('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 } }, '📎 Data sources (' + aiFiles.length + ') — uploaded files attach to the generated data step; links are passed to the AI'),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, aiFiles.map(function (a, i) {
              var isRef = !!a.url;
              return h('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5 } },
                h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.url || a.name }, (isRef ? '🔗 ' : '📄 ') + (((a.name || '').split('/').pop()) || a.url)),
                h('span', { style: { color: 'var(--faint)', flex: 'none' } }, isRef ? 'link' : ((a.mime ? ((a.mime.split('/').pop() || a.mime) + ' · ') : '') + (a.size != null ? (a.size >= 1048576 ? (Math.round(a.size / 104857.6) / 10 + ' MB') : (Math.max(1, Math.round(a.size / 1024)) + ' KB')) : ''))),
                isRef ? h('a', { className: 'fb-mini', href: a.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open link', title: 'Open' }, '↗') : h('button', { className: 'fb-mini', 'aria-label': 'Download', title: 'Download', onClick: function () { dlAiFile(a); } }, '⬇'),
                h('button', { className: 'fb-mini', 'aria-label': 'Remove', title: 'Remove', onClick: function () { removeAiFile(i); } }, '×'));
            }))) : null,
          aiBusy ? h('div', { style: { marginTop: 8 } }, h(AiThinking, { label: aiFiles.length ? 'Drafting a pipeline to process your data' : 'Drafting new tasks from your prompt' })) : null
        ) : null
      ) : null,
      h('div', { className: 'panel' },
        h('h3', null, '💬 Protocol chat',
          h('span', { style: { marginLeft: 8, fontSize: 10.5, fontWeight: 400, color: 'var(--faint)', textTransform: 'none', letterSpacing: 0 } }, 'a live log of what’s happening + ask about any task'),
          h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setPcOpen(!pcOpen); } }, pcOpen ? '▾ Hide' : '▸ Show')),
        pcOpen ? h('div', { className: 'chat-msgs', ref: pcScroll, style: { maxHeight: 440, minHeight: 160 } },
          pcEvents().map(function (e) {
            return h('div', { key: e.id, style: { display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 2px', borderBottom: '1px solid var(--line)' } },
              h('span', { style: { flex: 'none', fontSize: 13, marginTop: 1 } }, e.icon),
              h('div', { style: { minWidth: 0, flex: 1 } },
                h('div', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' } }, e.title),
                h('div', { style: { fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(e.body || '').slice(0, 600))));
          }),
          pcMsgs.length ? h('div', { style: { height: 1, background: 'var(--line)', margin: '4px 0' } }) : null,
          pcMsgs.map(function (m, i) {
            return h('div', { key: 'pm' + i, className: 'bubble ' + (m.role === 'assistant' ? 'ai' : 'user') },
              (m.role === 'assistant') ? h('div', { className: 'btxt md', dangerouslySetInnerHTML: { __html: mdHtml(m.content || '') } }) : h('div', { className: 'btxt' }, m.content));
          }),
          pcBusy ? h('div', { className: 'bubble ai' }, h('div', { className: 'btxt', style: { color: 'var(--faint)' } }, 'Publify is thinking…')) : null
        ) : null,
        pcOpen ? h('div', { className: 'chat-input', style: { marginTop: 8 } },
          h('textarea', { value: pcInput, rows: 1, placeholder: 'Ask about your tasks — e.g. “what’s waiting for approval?” or “why did task 3 fail?”', disabled: pcBusy, onChange: function (e) { setPcInput(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pcSend(); } } }),
          h('button', { className: 'btn pri', disabled: pcBusy || !pcInput.trim(), onClick: pcSend }, 'Send')) : null),
      lb ? ReactDOM.createPortal(h('div', { className: 'fig-lb', onClick: function () { setLb(null); } },
        h('button', { className: 'fig-lb-x', 'aria-label': 'Close', onClick: function () { setLb(null); } }, '✕'),
        h('img', { src: lb.src, alt: lb.cap || '', onClick: function (e) { e.stopPropagation(); } }),
        lb.cap ? h('div', { className: 'fig-lb-cap' }, lb.cap) : null), document.body) : null,
      editing ? h(TaskEditorModal, { step: editing.step, isNew: editing.isNew, allSteps: steps, projectId: props.projectId, onSave: saveTask, onClose: function () { setEditing(null); } }) : null,
      prevFile ? h(FilePreviewModal, { file: prevFile, onClose: function () { setPrevFile(null); } }) : null,
      intake ? h(FileIntake, { file: intake.file, context: intake.context, onComplete: intakeDone, onClose: function () { setIntake(null); } }) : null
    );
  }

  // ---------- Journal recommender (Norwegian register + Scimago, matched to the research) ----------
  function JournalPanel(props) {
    var ld = useState(true), loading = ld[0], setLoading = ld[1];
    var rc = useState(null), rec = rc[0], setRec = rc[1];
    var bz = useState(false), busy = bz[0], setBusy = bz[1];
    var pk = useState([]), picks = pk[0], setPicks = pk[1];
    var hn = useState(''), hint = hn[0], setHint = hn[1];
    var dvS = useState(null), dv = dvS[0], setDv = dvS[1];       // journal dossier view
    var tref = useRef(null), tfref = useRef(null);              // template file / folder inputs
    var ce = props.canEdit;
    function loadPicks() { sb.from('research_journal_picks').select('*').eq('project_id', props.projectId).order('fit_score', { ascending: false }).then(function (r) { setPicks((r && r.data) || []); setLoading(false); }, function () { setLoading(false); }); }
    useEffect(loadPicks, [props.projectId]);
    function openDossier(j, pick) {
      setDv({ j: j, loading: true });
      sb.functions.invoke('research-journals', { body: { action: 'dossier', project_id: props.projectId, journal_id: j.id } }).then(function (r) {
        var d = r && r.data; if (!d || d.error) { window.PRUI.toast('Dossier failed: ' + ((d && d.error) || (r && r.error && r.error.message) || ''), { kind: 'error' }); setDv(null); return; }
        var ex = pick || picks.filter(function (p) { return p.journal_id === j.id; })[0];
        var det = (ex && ex.details) || {}; var ai = d.ai || {};
        var form = { scope: det.scope || ai.scope || '', peer_review: det.peer_review || ai.peer_review || '', acceptance_rate: det.acceptance_rate || ai.acceptance_rate || '', first_decision: det.first_decision || ai.first_decision || '', apc: det.apc || ai.apc || '', submission_url: det.submission_url || ai.submission_url || '' };
        setDv({ j: j, loading: false, data: d, form: form, tpl: (ex && ex.template && Object.keys(ex.template).length ? ex.template : (ai.template || {})), notes: det.notes || '', pickId: ex && ex.id });
      }, function (e) { window.PRUI.toast('Dossier failed: ' + e, { kind: 'error' }); setDv(null); });
    }
    function dvSet(k, v) { setDv(function (x) { var f = Object.assign({}, x.form); f[k] = v; return Object.assign({}, x, { form: f }); }); }
    function tplUpload(e) {
      var fs = Array.prototype.slice.call((e.target && e.target.files) || []); if (e.target) e.target.value = ''; if (!fs.length) return;
      var batch = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7); var added = [];
      (function next(i) {
        if (i >= fs.length) { setDv(function (x) { var t = Object.assign({}, x.tpl); t.uploads = (t.uploads || []).concat(added); return Object.assign({}, x, { tpl: t }); }); return; }
        var f = fs[i]; var rel = f.webkitRelativePath || f.name;
        var sp = props.projectId + '/journal-templates/' + batch + '/' + rel.replace(/[^A-Za-z0-9._\/-]/g, '_');
        sb.storage.from('research-data').upload(sp, f).then(function (res) { if (!(res && res.error)) added.push({ name: rel, storage_path: sp, size: f.size }); next(i + 1); }, function () { next(i + 1); });
      })(0);
    }
    function tplRemove(i) { setDv(function (x) { var t = Object.assign({}, x.tpl); t.uploads = (t.uploads || []).filter(function (_, j) { return j !== i; }); return Object.assign({}, x, { tpl: t }); }); }
    function tplDl(a) { sb.storage.from('research-data').createSignedUrl(a.storage_path, 3600, { download: (a.name || '').split('/').pop() }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function saveDossier() {
      var x = dv; if (!x) return; var det = Object.assign({}, x.form, { notes: x.notes });
      var base = { project_id: props.projectId, journal_id: x.j.id, title: x.j.title, field: x.j.field, npi_level: x.j.npi_level, sjr_quartile: x.j.sjr_quartile, url: x.j.url, details: det, template: x.tpl || {} };
      var op = x.pickId ? sb.from('research_journal_picks').update({ details: det, template: x.tpl || {} }).eq('id', x.pickId) : sb.from('research_journal_picks').insert(Object.assign({ status: 'shortlisted', created_by: props.authorId }, base));
      op.then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } window.PRUI.toast('Dossier saved to shortlist', { kind: 'ok' }); setDv(function (y) { return Object.assign({}, y, { pickId: y.pickId }); }); loadPicks(); });
    }
    function recommend() {
      if (busy) return; setBusy(true); setRec(null);
      sb.functions.invoke('research-journals', { body: { action: 'recommend', project_id: props.projectId, hint: hint } }).then(function (r) {
        setBusy(false); var d = r && r.data; var err = (d && d.error) || (r && r.error && r.error.message);
        if (err) { window.PRUI.toast('Recommend failed: ' + err, { kind: 'error' }); return; }
        setRec(d);
      }, function (e) { setBusy(false); window.PRUI.toast('Recommend failed: ' + e, { kind: 'error' }); });
    }
    var pickedIds = {}; picks.forEach(function (p) { if (p.journal_id != null) pickedIds[p.journal_id] = p; });
    function shortlist(j) { sb.from('research_journal_picks').insert({ project_id: props.projectId, journal_id: j.id, title: j.title, field: j.field, npi_level: j.npi_level, sjr_quartile: j.sjr_quartile, url: j.url, fit_score: j.fit_score, fit_reason: j.fit_reason, status: 'shortlisted', created_by: props.authorId }).then(function (r) { if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; } window.PRUI.toast('Added to shortlist', { kind: 'ok' }); loadPicks(); }); }
    function setStatus(p, st) { sb.from('research_journal_picks').update({ status: st }).eq('id', p.id).then(loadPicks); }
    function removePick(p) { sb.from('research_journal_picks').delete().eq('id', p.id).then(loadPicks); }
    function levelBadge(lvl) { return lvl === 2 ? h('span', { className: 'jl-lvl lvl2', title: 'Norwegian register level 2 — top tier' }, '◆ Level 2') : h('span', { className: 'jl-lvl lvl1', title: 'Norwegian register level 1 — approved' }, '◇ Level 1'); }
    function quartile(q) { return q ? h('span', { className: 'jl-q q' + String(q).replace(/[^1-4]/g, '') }, q) : null; }
    function dossierPane() {
      var x = dv; var j = x.j;
      var bar = h('div', { className: 'rv-bar' },
        h('button', { className: 'btn', style: { padding: '4px 11px', fontSize: 12.5, flex: 'none' }, onClick: function () { setDv(null); } }, '←'),
        h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, j.title),
        ce ? h('button', { className: 'btn pri', style: { padding: '4px 11px', fontSize: 12.5, flex: 'none' }, onClick: saveDossier }, '💾 Save') : null);
      if (x.loading) return h('div', { className: 'report-pane' }, bar, h('div', { style: { padding: 20 } }, h(AiThinking, { label: 'Gathering KPIs & template for this journal' })));
      var d = x.data || {}; var oa = d.openalex || {}; var jr = d.journal || j; var ai = d.ai || {}; var tpl = x.tpl || {};
      function kv(label, val) { return (val != null && val !== '') ? h('div', { className: 'kpi' }, h('span', { className: 'kpi-k' }, label), h('span', { className: 'kpi-v' }, String(val))) : null; }
      function editRow(label, key, ph) {
        return h('div', { style: { marginTop: 8 } },
          h('div', { className: 'field-label' }, label, h('span', { style: { color: 'var(--faint)', fontWeight: 400 } }, ' · ~estimated, editable')),
          h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box' }, value: x.form[key] || '', placeholder: ph, onChange: function (e) { dvSet(key, e.target.value); } }));
      }
      var verify = x.form.submission_url || oa.homepage_url || jr.url;
      return h('div', { className: 'report-pane' }, bar,
        h('div', { className: 'rv-body' }, h('div', { className: 'report-doc', style: { maxWidth: 820 } },
          h('h2', null, 'Bibliometric KPIs ', h('span', { style: { fontSize: 11, fontWeight: 400, color: 'var(--faint)' } }, '(Norwegian register + OpenAlex — verified)')),
          h('div', { className: 'kpi-grid' },
            kv('Norwegian level', jr.npi_level === 2 ? '2 (top tier)' : (jr.npi_level === 1 ? '1 (approved)' : '—')),
            kv('NPI field', jr.field), kv('Discipline', jr.discipline),
            kv('Scimago quartile', jr.sjr_quartile), kv('SJR', jr.sjr),
            kv('h-index', oa.h_index != null ? oa.h_index : jr.h_index),
            kv('2-yr mean citedness', oa.impact_2yr), kv('i10-index', oa.i10),
            kv('Works (total)', oa.works_count), kv('APC (OpenAlex)', oa.apc_usd != null ? ('$' + oa.apc_usd) : null),
            kv('Open access', (oa.is_oa != null ? (oa.is_oa ? 'yes' : 'no') : jr.open_access) + (oa.is_in_doaj ? ' · DOAJ' : '')),
            kv('Publisher', oa.publisher || jr.publisher), kv('Country', jr.country), kv('Language', jr.language),
            kv('Print ISSN', jr.issn_print), kv('Online ISSN', jr.issn_online)),
          (oa.topics && oa.topics.length) ? h('div', { style: { marginTop: 8, fontSize: 12.5 } }, h('b', null, 'Top topics (OpenAlex): '), oa.topics.join(', ')) : null,
          (oa.homepage_url || jr.url) ? h('div', { style: { marginTop: 6 } }, h('a', { href: oa.homepage_url || jr.url, target: '_blank', rel: 'noopener noreferrer' }, '↗ Journal homepage')) : null,
          h('h2', { style: { marginTop: 22 } }, 'Scope & submission ', h('span', { style: { fontSize: 11, fontWeight: 400, color: 'var(--warn)' } }, '· AI-estimated — verify on the journal site')),
          h('div', { style: { marginTop: 8 } }, h('div', { className: 'field-label' }, 'Aims & scope'), h('textarea', { className: 'field', rows: 3, style: { width: '100%', boxSizing: 'border-box' }, value: x.form.scope || '', onChange: function (e) { dvSet('scope', e.target.value); } })),
          editRow('Acceptance rate', 'acceptance_rate', 'e.g. ~20%'),
          editRow('Time to first decision', 'first_decision', 'e.g. ~8 weeks'),
          editRow('APC (article processing charge)', 'apc', 'e.g. $2500 / hybrid / free'),
          editRow('Peer review', 'peer_review', 'e.g. double-blind'),
          editRow('Submission / author-guidelines URL', 'submission_url', 'https://…'),
          verify ? h('div', { style: { marginTop: 6 } }, h('a', { href: verify, target: '_blank', rel: 'noopener noreferrer' }, '↗ Verify on the journal site')) : null,
          h('h2', { style: { marginTop: 22 } }, 'Template'),
          tpl.family ? h('div', { style: { fontSize: 13 } }, h('b', null, 'Detected: '), tpl.family, tpl.notes ? h('span', { style: { color: 'var(--muted)' } }, ' — ' + tpl.notes) : null) : h('div', { style: { fontSize: 12.5, color: 'var(--muted)' } }, 'No template family detected.'),
          h('div', { style: { display: 'flex', gap: 14, marginTop: 4, fontSize: 12.5 } },
            tpl.official_url ? h('a', { href: tpl.official_url, target: '_blank', rel: 'noopener noreferrer' }, '↗ Official template') : null,
            tpl.overleaf_url ? h('a', { href: tpl.overleaf_url, target: '_blank', rel: 'noopener noreferrer' }, '↗ Overleaf template') : null),
          ce ? h('div', { style: { marginTop: 10 } },
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
              h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { if (tref.current) tref.current.click(); } }, '⤒ Upload template files'),
              h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Upload a whole template folder', onClick: function () { if (tfref.current) tfref.current.click(); } }, '📁 Upload folder'),
              h('input', { ref: tref, type: 'file', multiple: true, style: { display: 'none' }, onChange: tplUpload }),
              h('input', { ref: function (n) { if (n) { try { n.webkitdirectory = true; n.directory = true; } catch (e) { } } tfref.current = n; }, type: 'file', multiple: true, style: { display: 'none' }, onChange: tplUpload })),
            (tpl.uploads && tpl.uploads.length) ? tpl.uploads.map(function (a, i) {
              return h('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, background: 'var(--soft)', padding: '3px 8px', borderRadius: 6, marginTop: 3 } },
                h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '📎 ' + a.name),
                h('button', { className: 'fb-mini', 'aria-label': 'Download', title: 'Download', onClick: function () { tplDl(a); } }, '⬇'),
                h('button', { className: 'fb-mini', 'aria-label': 'Remove', title: 'Remove', onClick: function () { tplRemove(i); } }, '×'));
            }) : h('div', { style: { fontSize: 11.5, color: 'var(--faint)' } }, "Upload the journal's own .cls/.sty/.docx or a template folder you already have.")) : null,
          h('h2', { style: { marginTop: 22 } }, 'Notes'),
          h('textarea', { className: 'field', rows: 3, style: { width: '100%', boxSizing: 'border-box' }, value: x.notes || '', placeholder: 'Your notes on this venue…', onChange: function (e) { setDv(function (y) { return Object.assign({}, y, { notes: e.target.value }); }); } }),
          ce ? h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: saveDossier }, '💾 Save dossier to shortlist')) : null
        )));
    }
    function card(j, picked) {
      return h('div', { className: 'jl-card', key: j.id },
        h('div', { style: { display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('a', { href: j.url || '#', target: '_blank', rel: 'noopener noreferrer', className: 'jl-title' }, j.title),
          levelBadge(j.npi_level), quartile(j.sjr_quartile),
          j.impact != null ? h('span', { className: 'jl-q', style: { background: 'var(--surface-2)', color: 'var(--muted)' }, title: '2-year mean citedness (OpenAlex)' }, '⌀ ' + j.impact) : null,
          j.h_index != null ? h('span', { className: 'jl-q', style: { background: 'var(--surface-2)', color: 'var(--muted)' }, title: 'h-index (OpenAlex)' }, 'h ' + j.h_index) : null,
          j.fit_score != null ? h('span', { className: 'jl-fit' }, j.fit_score + '% fit') : null),
        h('div', { className: 'jl-meta' }, [j.field, j.country, j.open_access ? 'OA: ' + j.open_access : null, j.publisher].filter(Boolean).join(' · ')),
        j.fit_reason ? h('div', { className: 'jl-reason' }, j.fit_reason) : null,
        h('div', { style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' } },
          h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, onClick: function () { openDossier(j); } }, '🔎 Details & template'),
          ce ? (picked ? h('span', { className: 'chip c-ok' }, '★ Shortlisted') : h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, onClick: function () { shortlist(j); } }, '★ Shortlist')) : null));
    }
    // ---- Venue Comparison Table (New design flag, direction A): recommendations as a dense sortable-looking table instead of stacked cards. Same j fields + openDossier/shortlist/levelBadge/quartile. ----
    function journalTable(list) {
      return h('div', { className: 'jt-wrap' }, h('table', { className: 'jt' },
        h('thead', null, h('tr', null,
          h('th', null, 'Journal'),
          h('th', { className: 'jt-r jt-sorted' }, 'Fit ▾'),
          h('th', null, 'Level'),
          h('th', { className: 'jt-c' }, 'Q'),
          h('th', { className: 'jt-r', title: '2-year mean citedness (OpenAlex)' }, '⌀ Impact'),
          h('th', { className: 'jt-r', title: 'h-index (OpenAlex)' }, 'h-index'),
          h('th', null, 'OA'),
          ce ? h('th', { className: 'jt-r' }, '') : null
        )),
        h('tbody', null, list.map(function (j) {
          var picked = !!pickedIds[j.id];
          return h('tr', { key: j.id, className: picked ? 'jt-sel' : null },
            h('td', { className: 'jt-jr' },
              h('a', { href: j.url || '#', target: '_blank', rel: 'noopener noreferrer', className: 'jt-jtitle' }, j.title),
              h('div', { className: 'jt-jmeta' }, [j.field, j.publisher, j.country].filter(Boolean).join(' · ')),
              j.fit_reason ? h('div', { className: 'jt-jreason' }, j.fit_reason) : null),
            h('td', { className: 'jt-r jt-fitcell' }, j.fit_score != null ? h('div', { className: 'jt-fit' }, h('span', { className: 'jt-fitbar' }, h('i', { style: { width: j.fit_score + '%' } })), h('span', { className: 'jt-fitpct' }, j.fit_score + '%')) : h('span', { className: 'jt-dash' }, '–')),
            h('td', null, levelBadge(j.npi_level)),
            h('td', { className: 'jt-c' }, quartile(j.sjr_quartile) || h('span', { className: 'jt-dash' }, '–')),
            h('td', { className: 'jt-r jt-num' }, j.impact != null ? j.impact : '–'),
            h('td', { className: 'jt-r jt-num' }, j.h_index != null ? j.h_index : '–'),
            h('td', null, j.open_access ? h('span', { className: 'jt-oa' }, j.open_access) : h('span', { className: 'jt-dash' }, '–')),
            ce ? h('td', { className: 'jt-r jt-act' },
              h('button', { className: 'btn jt-ib', title: 'Details & template', onClick: function () { openDossier(j); } }, '🔎'),
              picked ? h('span', { className: 'chip c-ok jt-picked', title: 'Shortlisted' }, '★') : h('button', { className: 'btn jt-ib', title: 'Add to shortlist', onClick: function () { shortlist(j); } }, '☆')
            ) : null
          );
        }))
      ));
    }
    if (dv) return dossierPane();
    if (loading) return h('div', { className: 'empty' }, 'Loading…');
    return h('div', null,
      h('div', { className: 'panel' },
        h('h3', { style: { marginTop: 0 } }, '🎯 Journal recommender'),
        h('p', { style: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 } }, 'Suggests where to publish — from the Norwegian publication register (level 1–2 quality) matched to your research questions & results, enriched with OpenAlex impact (2-yr citedness, h-index). 29,685 vetted journals indexed. Scimago SJR/quartile can be folded in from a manual export.'),
        ce ? h('div', null,
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', { className: 'field', style: { flex: 1, minWidth: 180 }, placeholder: 'Optional preference (e.g. "open access", "high impact", "European venue")', value: hint, disabled: busy, onChange: function (e) { setHint(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') recommend(); } }),
            h('button', { className: 'btn pri', style: { flex: 'none' }, disabled: busy, onClick: recommend }, busy ? '✨ Working…' : '✨ Recommend journals')),
          busy ? h('div', { style: { marginTop: 10 } }, h(AiThinking, { label: 'Matching your research to fields, then ranking journals' })) : null
        ) : null),
      rec ? h('div', { className: 'panel' },
        h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 3 } }, h('b', null, 'Matched fields: '), (rec.fields || []).join(', ') || '—'),
        rec.summary ? h('div', { style: { fontSize: 12, color: 'var(--faint)', marginBottom: 10 } }, rec.summary) : null,
        (rec.journals && rec.journals.length) ? (nd() ? journalTable(rec.journals) : rec.journals.map(function (j) { return card(j, !!pickedIds[j.id]); })) : h('div', { className: 'empty' }, rec.note || 'No matching journals found — try a broader preference.')
      ) : null,
      picks.length ? h('div', { className: 'panel' },
        h('h3', null, '★ Shortlist (' + picks.length + ')'),
        picks.map(function (p) {
          return h('div', { className: 'jl-card', key: p.id },
            h('div', { style: { display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' } },
              h('a', { href: p.url || '#', target: '_blank', rel: 'noopener noreferrer', className: 'jl-title' }, p.title),
              p.npi_level ? levelBadge(p.npi_level) : null, quartile(p.sjr_quartile),
              h('span', { className: 'chip ' + (p.status === 'submitted' ? 'c-ok' : 'c-acc') }, p.status),
              p.fit_score != null ? h('span', { className: 'jl-fit' }, p.fit_score + '% fit') : null),
            p.fit_reason ? h('div', { className: 'jl-reason' }, p.fit_reason) : null,
            h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
              p.journal_id != null ? h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { openDossier({ id: p.journal_id, title: p.title, field: p.field, npi_level: p.npi_level, sjr_quartile: p.sjr_quartile, url: p.url }, p); } }, '🔎 Details') : null,
              ce ? (p.status !== 'submitted' ? h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { setStatus(p, 'submitted'); } }, '✓ Mark submitted') : h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { setStatus(p, 'shortlisted'); } }, 'Unmark')) : null,
              ce ? h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11, color: 'var(--danger)' }, onClick: function () { removePick(p); } }, 'Remove') : null));
        })
      ) : null
    );
  }

  // ---------- Project detail ----------
  // ---------- Pipeline Canvas (P1a): auto-materialize the WHOLE pipeline onto one swimlane infinite canvas ----------
  // Reads the project's real tables → typed nodes + provenance edges → 6 swimlanes + pan/zoom + a docked inspector.
  // Read-only view for now (P2 = inline edit + phase actions replacing modals). New-design flag only.
  var RMAP_PHASES = [['ideas', 'Ideas', '💡'], ['literature', 'Literature', '📚'], ['sr', 'Systematic review', '🔬'], ['protocol', 'Protocol', '🧪'], ['journal', 'Journal', '🎯'], ['writing', 'Writing', '✍️']];
  var RMAP_PHASE_IDX = {}; RMAP_PHASES.forEach(function (p, i) { RMAP_PHASE_IDX[p[0]] = i; });
  var RMAP_TYPE = { idea: { ic: '💡', lab: 'Ötlet', tab: 'ideas' }, paper: { ic: '📄', lab: 'Cikk', tab: 'literature' }, study: { ic: '🔎', lab: 'Irodalom', tab: 'literature' }, review: { ic: '📝', lab: 'Áttekintés', tab: 'study' }, step: { ic: '🧪', lab: 'Protokoll-lépés', tab: 'protocol' }, venue: { ic: '🎯', lab: 'Folyóirat', tab: 'journal' }, section: { ic: '✍️', lab: 'Draft-szekció', tab: 'writing' } };
  function PipelineCanvas(props) {
    var dS = useState(null), data = dS[0], setData = dS[1];   // null = loading
    var vS = useState({ tx: 30, ty: 18, k: 1 }), view = vS[0], setView = vS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var edS = useState(null), editing = edS[0], setEditing = edS[1];   // {spec} — the open edit dialog (P2)
    var efS = useState({}), eform = efS[0], setEform = efS[1];
    var bmS = useState(0), bump = bmS[0], setBump = bmS[1];   // reload after a save
    var loS = useState(false), litOpen = loS[0], setLitOpen = loS[1];   // F4: expand the study funnel's paper nodes (collapsed by default)
    var mnS = useState(null), menu = mnS[0], setMenu = mnS[1];   // F1: node "generate from here" context menu {node,x,y}
    var gbS = useState(false), genBusy = gbS[0], setGenBusy = gbS[1];
    var rnS = useState(null), run = rnS[0], setRun = rnS[1];   // P1b: the project's active Autopilot run (live)
    var mdS = useState(function () { try { return localStorage.getItem('pr-rmap-mode') === 'free' ? 'free' : 'lane'; } catch (e) { return 'lane'; } }), mode = mdS[0], setMode = mdS[1];   // 'lane' (swimlane) | 'free' (freeform)
    var drag = useRef(null), stageRef = useRef(null), alive = useRef(true), bumpT = useRef(null), driving = useRef(false), mapDriver = useRef(null);
    if (!mapDriver.current) mapDriver.current = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('00000000-0000-4000-8000-' + String(Date.now()).slice(-12));
    useEffect(function () { return function () { alive.current = false; driving.current = false; if (bumpT.current) clearTimeout(bumpT.current); }; }, []);
    // debounced re-materialize: as the orchestrator writes rows, coalesce rapid events into one reload so nodes grow live
    function bumpSoon() { if (bumpT.current) return; bumpT.current = setTimeout(function () { bumpT.current = null; if (alive.current) setBump(function (x) { return x + 1; }); }, 1400); }
    // P1b+: the Map can itself DRIVE the run (via the shared PRAutopilotCore), not just view it. Same single-driver
    // lease as the dashboard → Map + dashboard never double-drive. Only an editor who is the run OWNER drives.
    function ensureDrive(r) {
      var CORE = window.PRAutopilotCore;
      if (CORE && CORE.apStep && r && r.status === 'running' && props.canEdit && r.owner_id === props.viewerId && !driving.current) { driving.current = true; driveMap(r.id); }
    }
    function driveMap(runId) {
      if (!alive.current || !driving.current) { driving.current = false; return; }
      var CORE = window.PRAutopilotCore, tok = mapDriver.current, stale = new Date(Date.now() - 30000).toISOString();
      sb.from('research_autopilot_runs').update({ driver_token: tok, driver_beat: new Date().toISOString() }).eq('id', runId).eq('status', 'running').or('driver_token.is.null,driver_token.eq.' + tok + ',driver_beat.lt.' + stale).select('*').then(function (rr) {
        var r = rr && rr.data && rr.data[0];
        if (!alive.current || !driving.current) { driving.current = false; return; }
        if (!r) { driving.current = false; return; }   // lost the lease (dashboard/another tab drives) → stay a viewer
        CORE.apStep(r, props.project).then(function (res) {
          if (!alive.current) { driving.current = false; return; }
          var evs = (res.events || []).map(function (e) { return { run_id: r.id, project_id: r.project_id, phase: e.phase || null, level: e.level || 'run', message: String(e.message || '').slice(0, 500) }; });
          (evs.length ? sb.from('research_autopilot_events').insert(evs) : Promise.resolve()).then(function () {
            sb.from('research_autopilot_runs').update(Object.assign({ updated_at: new Date().toISOString(), driver_beat: new Date().toISOString() }, res.patch || {})).eq('id', r.id).eq('driver_token', tok).then(function () { setTimeout(function () { driveMap(runId); }, 950); });
          });
        }, function (err) {
          var pk = (r.phases[r.phase_index] || {}).key;
          sb.from('research_autopilot_events').insert([{ run_id: r.id, project_id: r.project_id, phase: pk, level: 'error', message: 'Hiba: ' + ((err && err.message) || err) }]).then(function () {
            sb.from('research_autopilot_runs').update({ status: 'failed', error: String((err && err.message) || err), updated_at: new Date().toISOString() }).eq('id', r.id).then(function () { driving.current = false; });
          });
        });
      }, function () { driving.current = false; });
    }
    useEffect(function () {
      var pid = props.projectId;
      sb.from('research_autopilot_runs').select('*').eq('project_id', pid).not('status', 'in', '("done","failed","cancelled")').order('updated_at', { ascending: false }).limit(1).maybeSingle().then(function (r) { if (alive.current) { setRun((r && r.data) || null); ensureDrive(r && r.data); } });
      var ch = sb.channel('rmap-ap:' + pid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_autopilot_runs', filter: 'project_id=eq.' + pid }, function (p) { if (alive.current && p.new) { setRun(p.new); ensureDrive(p.new); bumpSoon(); } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'research_autopilot_events', filter: 'project_id=eq.' + pid }, function () { if (alive.current) bumpSoon(); })
        .subscribe();
      return function () { try { sb.removeChannel(ch); } catch (e) { } };
    }, [props.projectId]);
    function approveGate() { if (run) sb.from('research_autopilot_runs').update({ status: 'running', gate: null, updated_at: new Date().toISOString() }).eq('id', run.id); }
    useEffect(function () {
      var pid = props.projectId;
      Promise.all([
        sb.from('research_ideas').select('id,question,hypothesis,rationale,novelty,status').eq('project_id', pid).neq('status', 'rejected').order('created_at', { ascending: true }).limit(24),
        sb.from('research_studies').select('id,idea_id,title,question,status').eq('project_id', pid),
        sb.from('research_sources').select('id,title,venue,cited_by,year,screening,url').eq('project_id', pid).order('cited_by', { ascending: false, nullsFirst: false }).limit(10),
        sb.from('research_sources').select('id', { count: 'exact', head: true }).eq('project_id', pid),
        sb.from('research_sources').select('id', { count: 'exact', head: true }).eq('project_id', pid).eq('screening', 'include'),
        sb.from('research_protocols').select('id,title,status').eq('project_id', pid).neq('status', 'archived').order('created_at', { ascending: false }).limit(1),
        sb.from('research_journal_picks').select('id,title,status,npi_level').eq('project_id', pid),
        sb.from('research_files').select('id,path,size').eq('project_id', pid).or('path.like.writing/%,path.like.studies/%')
      ]).then(function (r) {
        if (!alive.current) return;
        var base = { ideas: (r[0].data) || [], studies: (r[1].data) || [], topSrc: (r[2].data) || [], srcTotal: r[3].count || 0, inclTotal: r[4].count || 0, protocol: (r[5].data && r[5].data[0]) || null, journals: (r[6].data) || [], wfiles: (r[7].data) || [] };
        if (base.protocol) sb.from('research_protocol_steps').select('id,ord,title,kind,status,needs_approval').eq('protocol_id', base.protocol.id).order('ord', { ascending: true }).then(function (sr) { if (alive.current) setData(Object.assign(base, { steps: (sr.data) || [] })); });
        else setData(Object.assign(base, { steps: [] }));
      }, function () { if (alive.current) setData({ ideas: [], studies: [], topSrc: [], srcTotal: 0, inclTotal: 0, protocol: null, journals: [], wfiles: [], steps: [] }); });
    }, [props.projectId, bump]);

    function graph() {
      var d = data, N = [], E = [];
      (d.ideas || []).forEach(function (x) { N.push({ id: 'i' + x.id, t: 'idea', ph: 0, title: x.question || 'Ötlet', m: { Novelty: (x.novelty != null ? x.novelty + ' / 100' : '—'), Hipotézis: x.hypothesis || '—' }, ref: x }); });
      var hasLit = d.srcTotal > 0 || d.studies.length;
      if (hasLit) {
        N.push({ id: 'lit', t: 'study', ph: 1, title: (d.studies[0] && d.studies[0].title) || 'Irodalom', m: { Források: String(d.srcTotal), Included: String(d.inclTotal) }, ref: d.studies[0] || null, pcount: d.topSrc.length });
        if (litOpen) d.topSrc.forEach(function (s) { N.push({ id: 'p' + s.id, t: 'paper', ph: 1, title: s.title || 'Cikk', m: { Venue: s.venue || '—', Év: String(s.year || '—'), Idézettség: String(s.cited_by || 0) }, dec: s.screening, ref: s }); E.push(['lit', 'p' + s.id]); });
        var linked = false;
        d.studies.forEach(function (st) { if (st.idea_id) { E.push(['i' + st.idea_id, 'lit']); linked = true; } });
        if (!linked && d.ideas.length) E.push(['i' + d.ideas[0].id, 'lit']);
      }
      var hasSR = d.studies.length > 0;
      if (hasSR) { N.push({ id: 'sr', t: 'review', ph: 2, title: 'Systematic review', m: { Studies: String(d.studies.length) } }); if (hasLit) E.push(['lit', 'sr']); }
      if (d.protocol && d.steps.length) {
        d.steps.forEach(function (s, i) { N.push({ id: 'r' + s.id, t: 'step', ph: 3, title: s.title || ('Lépés ' + (i + 1)), m: { Kind: s.kind || '—', Státusz: s.status || '—', Jóváhagyás: s.needs_approval ? 'szükséges' : '—' }, st: s.status, gate: !!s.needs_approval, ref: s }); if (i > 0) E.push(['r' + d.steps[i - 1].id, 'r' + s.id]); });
        if (hasSR) E.push(['sr', 'r' + d.steps[0].id]); else if (hasLit) E.push(['lit', 'r' + d.steps[0].id]);
      }
      d.journals.forEach(function (j) { N.push({ id: 'v' + j.id, t: 'venue', ph: 4, title: j.title || 'Folyóirat', m: { NPI: j.npi_level || '—', Státusz: j.status || '—' }, ref: j }); if (hasSR) E.push(['sr', 'v' + j.id]); });
      var lastStep = (d.protocol && d.steps.length) ? ('r' + d.steps[d.steps.length - 1].id) : (hasSR ? 'sr' : null);
      d.wfiles.forEach(function (f) {
        if (/^studies\//.test(f.path)) {   // a generated systematic-review document → a node in the SR lane
          var rnm = String(f.path).replace(/^studies\//, '').replace(/\.(md|tex)$/, '');
          N.push({ id: 'w' + f.id, t: 'review', ph: 2, title: rnm || 'áttekintés', m: { Fájl: f.path, Méret: (f.size || 0) + ' B' }, ref: f });
          if (hasSR) E.push(['sr', 'w' + f.id]); else if (hasLit) E.push(['lit', 'w' + f.id]);
        } else {
          var nm = String(f.path).replace(/^writing\//, '').replace(/\.(md|tex)$/, '');
          N.push({ id: 'w' + f.id, t: 'section', ph: 5, title: nm || 'szekció', m: { Fájl: f.path, Méret: (f.size || 0) + ' B' }, ref: f });
          if (lastStep) E.push([lastStep, 'w' + f.id]);
        }
      });
      var LANEW = 252, ROWH = 104, cnt = {};
      if (mode === 'free') {   // (B) freeform: organic per-phase clusters instead of lanes
        var CEN = [{ x: 40, y: 60 }, { x: 470, y: 240 }, { x: 220, y: 560 }, { x: 860, y: 110 }, { x: 1140, y: 470 }, { x: 780, y: 650 }];
        N.forEach(function (n) { var o = (cnt[n.ph] = (cnt[n.ph] || 0)); var c = CEN[n.ph] || { x: n.ph * 260, y: 80 }; n.x = c.x + (o % 2) * 172; n.y = c.y + Math.floor(o / 2) * 112 + ((o % 2) ? 26 : 0); cnt[n.ph] = o + 1; });
        var mY = 640; N.forEach(function (n) { mY = Math.max(mY, n.y + 120); });
        var byF = {}; N.forEach(function (n) { byF[n.id] = n; });
        return { N: N, E: E, laneW: LANEW, height: mY, by: byF, free: true };
      }
      N.forEach(function (n) { var o = (cnt[n.ph] = (cnt[n.ph] || 0)); n.x = n.ph * LANEW + 22; n.y = 66 + o * ROWH; cnt[n.ph] = o + 1; });
      var maxRows = Math.max.apply(null, [1].concat(Object.keys(cnt).map(function (k) { return cnt[k]; })));
      var by = {}; N.forEach(function (n) { by[n.id] = n; });
      return { N: N, E: E, laneW: LANEW, height: 66 + maxRows * ROWH + 40, by: by };
    }

    function onMove(e) { var dd = drag.current; if (!dd) return; setView(function (v) { return { tx: dd.tx + (e.clientX - dd.sx), ty: dd.ty + (e.clientY - dd.sy), k: v.k }; }); }
    function onUp() { drag.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    function onDown(e) { if (e.target.closest && e.target.closest('.rmap-node')) return; drag.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); }
    function onWheel(e) { e.preventDefault(); var st = stageRef.current; if (!st) return; var r = st.getBoundingClientRect(); var mx = e.clientX - r.left, my = e.clientY - r.top; setView(function (v) { var nk = Math.min(2.2, Math.max(.3, v.k * (e.deltaY < 0 ? 1.12 : 0.89))); return { tx: mx - (mx - v.tx) * (nk / v.k), ty: my - (my - v.ty) * (nk / v.k), k: nk }; }); }
    function zoom(f) { setView(function (v) { var nk = Math.min(2.2, Math.max(.3, v.k * f)); return { tx: v.tx, ty: v.ty, k: nk }; }); }

    // ---- P2: edit any node's real metadata via a dialog (the same columns the phase panels/modals set) ----
    function editSpec(n) {
      var r = n.ref; if (!r || !r.id) return null;
      if (n.t === 'idea') return { table: 'research_ideas', id: r.id, title: 'Ötlet szerkesztése', fields: [{ k: 'question', l: 'Kérdés', ty: 'textarea' }, { k: 'hypothesis', l: 'Hipotézis', ty: 'textarea' }, { k: 'rationale', l: 'Indoklás', ty: 'textarea' }, { k: 'novelty', l: 'Novelty (0–100)', ty: 'number' }, { k: 'status', l: 'Státusz', ty: 'select', o: ['candidate', 'selected', 'rejected'] }] };
      if (n.t === 'paper') return { table: 'research_sources', id: r.id, title: 'Cikk szerkesztése', fields: [{ k: 'title', l: 'Cím', ty: 'text' }, { k: 'venue', l: 'Venue', ty: 'text' }, { k: 'year', l: 'Év', ty: 'number' }, { k: 'screening', l: 'Szűrés', ty: 'select', o: ['unscreened', 'include', 'maybe', 'exclude'] }] };
      if (n.t === 'study') return { table: 'research_studies', id: r.id, title: 'Irodalom-study szerkesztése', fields: [{ k: 'title', l: 'Cím', ty: 'text' }, { k: 'question', l: 'Kérdés', ty: 'textarea' }] };
      if (n.t === 'step') return { table: 'research_protocol_steps', id: r.id, title: 'Protokoll-lépés szerkesztése', fields: [{ k: 'title', l: 'Cím', ty: 'text' }, { k: 'kind', l: 'Típus', ty: 'select', o: PROT_KINDS }, { k: 'status', l: 'Státusz', ty: 'select', o: ['queued', 'running', 'done', 'blocked'] }, { k: 'needs_approval', l: 'Jóváhagyás szükséges', ty: 'checkbox' }] };
      if (n.t === 'venue') return { table: 'research_journal_picks', id: r.id, title: 'Folyóirat szerkesztése', fields: [{ k: 'title', l: 'Cím', ty: 'text' }, { k: 'npi_level', l: 'NPI szint', ty: 'text' }, { k: 'status', l: 'Státusz', ty: 'select', o: ['candidate', 'shortlisted', 'selected'] }] };
      if (n.t === 'section') return { table: 'research_files', id: r.id, title: 'Draft-szekció szerkesztése', fields: [{ k: 'content', l: 'Tartalom (LaTeX / Markdown)', ty: 'bigtext' }] };
      return null;   // review = generated file, no editable metadata here
    }
    function openEdit(n) {
      var sp = editSpec(n); if (!sp) return;
      // section content isn't loaded in the graph query (only path/size) → fetch it so a save can't blank the file
      if (n.t === 'section') { sb.from('research_files').select('content').eq('id', sp.id).maybeSingle().then(function (fr) { setEform({ content: (fr && fr.data && fr.data.content) || '' }); setEditing(sp); }); return; }
      var f = {}; sp.fields.forEach(function (fd) { var v = n.ref[fd.k]; f[fd.k] = fd.ty === 'checkbox' ? !!v : (v == null ? '' : v); });
      setEform(f); setEditing(sp);
    }
    function saveEdit() {
      var sp = editing; if (!sp) return;
      var patch = {};
      sp.fields.forEach(function (fd) {
        var v = eform[fd.k];
        if (fd.ty === 'number') patch[fd.k] = (v === '' || v == null) ? null : (parseFloat(v) || 0);
        else if (fd.ty === 'checkbox') patch[fd.k] = !!v;
        else patch[fd.k] = (typeof v === 'string' && !v.trim()) ? (fd.ty === 'select' ? v : null) : v;
      });
      if (sp.table === 'research_files') { patch.size = (patch.content || '').length; patch.updated_at = new Date().toISOString(); }
      sb.from(sp.table).update(patch).eq('id', sp.id).then(function (r) {
        if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        setEditing(null); setBump(function (x) { return x + 1; }); window.PRUI.toast('✓ Mentve', { kind: 'ok' });
      });
    }

    // F1: generate research artifacts FROM a node — reuses the deployed edges via window.PRAutopilotCore; the materializer re-renders the new nodes + provenance edges.
    function genActions(n) {
      if (!n) return [];
      if (n.t === 'idea') return [['study', '🔎 Study indítása ebből'], ['ideas', '✦ Kapcsolódó ötletek']];
      if (n.t === 'study') return (n.ref && n.ref.id ? [['review', '📝 Áttekintés generálása']] : []).concat([['protocol', '🧪 Protokoll generálása']]);
      if (n.t === 'review') return [['protocol', '🧪 Protokoll generálása'], ['writing', '✍️ Draft-vázlat']];
      if (n.t === 'step') return [['writing', '✍️ Draft-vázlat']];
      if (n.t === 'venue' || n.t === 'section') return [['writing', '✍️ Draft-vázlat'], ['ideas', '✦ Ötletek']];
      return [['ideas', '✦ Ötletek generálása'], ['protocol', '🧪 Protokoll']];
    }
    function runGen(n, act) {
      if (genBusy) return;   // re-entrancy lock: nodes stay clickable during the async call, so guard against a double-fire (double study insert)
      var CORE = window.PRAutopilotCore; if (!CORE || !CORE.callEdge) { window.PRUI.toast('A generátor nem elérhető (autopilot-core).', { kind: 'error' }); return; }
      setMenu(null); setGenBusy(true);
      var pid = props.projectId, proj = props.project;
      function done(msg) { if (!alive.current) return; setGenBusy(false); window.PRUI.toast('✓ ' + (msg || 'Kész'), { kind: 'ok' }); setBump(function (x) { return x + 1; }); }
      function fail(e) { if (!alive.current) return; setGenBusy(false); window.PRUI.toast('Hiba: ' + e, { kind: 'error' }); }
      if (act === 'ideas') CORE.callEdge('research-ai', { action: 'gap', project_id: pid }).then(function (d) { (d && d.error) ? fail(d.error) : done(((d && d.count) || 0) + ' ötlet-jelölt'); }, function () { fail('hálózat'); });
      else if (act === 'study') {
        var idea = (n && n.ref) || null;
        sb.from('research_studies').insert({ project_id: pid, idea_id: idea ? idea.id : null, title: String((idea && idea.question) || proj.title || 'Study').slice(0, 80), question: String((idea && idea.question) || proj.goal || proj.title || '').slice(0, 4000), created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
          if (r && r.error) { fail('study: ' + r.error.message); return; }
          var sid = r && r.data && r.data.id; if (!sid) { fail('a study nem jött létre'); return; }
          var rows = LS_STEPS.map(function (s) { return { study_id: sid, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, proj, idea) }; });
          sb.from('research_study_steps').insert(rows).then(function (rr) { if (rr && rr.error) { fail('study-lépések: ' + rr.error.message); return; } CORE.callEdge('research-study', { action: 'plan', study_id: sid }).then(function () { done('Study létrehozva'); }, function () { done('Study létrehozva'); }); }, function () { fail('study-lépések'); });
        }, function () { fail('study insert'); });
      }
      else if (act === 'review') { var sid = n && n.ref && n.ref.id; if (!sid) { fail('nincs study ehhez a node-hoz'); return; } CORE.callEdge('research-study', { action: 'generate_review', study_id: sid }).then(function (d) { (d && d.error) ? fail(d.error) : done('Áttekintés kész'); }, function () { fail('hálózat'); }); }
      else if (act === 'protocol') CORE.callEdge('research-protocol', { action: 'generate', project_id: pid, goal: proj.goal || proj.title || '' }).then(function (d) { (d && d.error) ? fail(d.error) : done(((d && d.steps) || 0) + ' protokoll-lépés'); }, function () { fail('hálózat'); });
      else if (act === 'writing') CORE.callEdge('research-writing', { action: 'outline', project_id: pid }).then(function (d) {
        if (d && d.error) { fail(d.error); return; }
        var o = d && d.outline; if (!o || !o.sections) { fail('üres vázlat'); return; }
        var md = '# ' + (o.title || proj.title) + '\n\n' + (o.abstract || '') + '\n\n## Szekciók\n' + o.sections.map(function (s) { return '- ' + (s.heading || s.key); }).join('\n');
        CORE.saveFile(pid, 'writing/outline.md', md, 'ai').then(function (sf) { if (sf && sf.error) { fail(sf.error.message || 'mentés'); return; } done('Vázlat kész (' + o.sections.length + ' szekció)'); }, function () { fail('hálózat'); });
      }, function () { fail('hálózat'); });
    }

    if (!data) return h('div', { className: 'rmap-wrap' }, h('div', { className: 'empty' }, 'Térkép betöltése…'));
    var g = graph();
    if (!g.N.length) return h('div', { className: 'rmap-wrap' }, h('div', { className: 'rmap-empty' }, h('div', { style: { fontSize: 30 } }, '🗺️'), h('b', null, 'A térkép a projekt adataiból épül fel'), h('p', null, 'Adj hozzá ötleteket, irodalmat, protokollt — és itt egy összefüggő canvason látod majd az egészet, a provenance-élekkel.')));
    var NW = 204, NH = 74;
    function ctr(id) { var n = g.by[id]; return { x: n.x + NW / 2, y: n.y + NH / 2 }; }
    var svgW = 0; g.N.forEach(function (n) { svgW = Math.max(svgW, n.x + NW + 60); });
    var edgeEls = g.E.map(function (e, i) { var a = g.by[e[0]], b = g.by[e[1]]; if (!a || !b) return null; var ca = ctr(e[0]), cb = ctr(e[1]); var dx = (cb.x - ca.x) * 0.5; var cite = e[2] === 'cite'; return h('path', { key: i, d: 'M' + ca.x + ',' + ca.y + ' C' + (ca.x + dx) + ',' + ca.y + ' ' + (cb.x - dx) + ',' + cb.y + ' ' + cb.x + ',' + cb.y, fill: 'none', stroke: cite ? 'var(--accent-tint)' : 'var(--line-2)', strokeWidth: cite ? 1.5 : 2, strokeDasharray: cite ? '5 5' : null }); });
    function body(n) {
      var k = [h('div', { className: 'rmap-nh', key: 'h' }, h('span', { className: 'rmap-ni' }, RMAP_TYPE[n.t].ic), h('span', { className: 'rmap-nt' }, n.title))];
      if (n.t === 'study') k.push(h('div', { className: 'rmap-nm', key: 'm' }, h('b', null, n.m.Források), ' forrás → ', h('b', null, n.m.Included), ' incl', n.pcount ? h('span', { className: 'rmap-exp' }, (litOpen ? '▾ ' : '▸ ') + n.pcount + ' cikk') : null));
      else if (n.t === 'paper') k.push(h('div', { className: 'rmap-nm', key: 'm' }, (n.m.Venue || '') + ' · ' + n.m.Idézettség + ' cite', n.dec === 'include' ? h('span', { className: 'rmap-chip inc' }, '✓ incl') : null));
      else if (n.t === 'step') k.push(h('div', { className: 'rmap-nm', key: 'm' }, h('span', { className: 'rmap-chip ' + (n.st === 'done' ? 'done' : n.st === 'running' ? 'run' : 'pend') }, n.st || 'vár'), ' ' + (n.m.Kind || ''), n.gate ? h('span', { className: 'rmap-chip gate' }, 'gate') : null));
      else if (n.t === 'venue') k.push(h('div', { className: 'rmap-nm', key: 'm' }, n.m.NPI + ' · ' + n.m.Státusz));
      else if (n.t === 'section') k.push(h('div', { className: 'rmap-nm', key: 'm' }, n.m.Méret));
      else if (n.t === 'idea') k.push(h('div', { className: 'rmap-nm', key: 'm' }, 'novelty ' + n.m.Novelty));
      else if (n.t === 'review') k.push(h('div', { className: 'rmap-nm', key: 'm' }, n.m.Studies + ' study'));
      return k;
    }
    // P1b: overlay the active run's live phase status onto the swimlanes
    var runPhase = {}, activeKey = null, activeLabel = null, runProg = null, runActive = false;
    if (run && run.phases) {
      run.phases.forEach(function (pp) { runPhase[pp.key] = pp.status; });
      var apx = run.phases[run.phase_index]; activeKey = apx && apx.key; activeLabel = (apx && apx.label) || activeKey;
      var en = run.phases.filter(function (pp) { return pp.enabled; }).length || 1;
      var dn = run.phases.filter(function (pp) { return pp.enabled && (pp.status === 'done' || pp.status === 'skipped'); }).length;
      runProg = dn + '/' + en; runActive = ['running', 'awaiting_approval', 'paused', 'queued'].indexOf(run.status) >= 0;
    }
    var LANE_BADGE = { done: '✓', running: '●', gate: '⏸', skipped: '–' };
    var sn = sel ? g.by[sel] : null;
    return h('div', { className: 'rmap-wrap' },
      h('div', { className: 'rmap-stage', ref: stageRef, onMouseDown: onDown, onWheel: onWheel },
        h('div', { className: 'rmap-world', style: { transform: 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.k + ')' } },
          g.free ? null : RMAP_PHASES.map(function (p, i) { var stt = runPhase[p[0]]; return h('div', { className: 'rmap-lane' + (i % 2 ? ' alt' : '') + (activeKey === p[0] ? ' active' : ''), key: p[0], style: { left: (i * g.laneW) + 'px', width: g.laneW + 'px', height: g.height + 'px' } }, h('div', { className: 'rmap-lh' }, p[2] + ' ' + p[1], stt ? h('span', { className: 'rmap-lh-st ' + stt }, LANE_BADGE[stt] || '') : null)); }),
          h('svg', { className: 'rmap-edges', width: svgW, height: g.height }, edgeEls),
          g.N.map(function (n) { return h('div', { key: n.id, className: 'rmap-node t-' + n.t + (sel === n.id ? ' sel' : '') + (activeKey && n.ph === RMAP_PHASE_IDX[activeKey] ? ' inphase' : ''), style: { left: n.x + 'px', top: n.y + 'px' }, onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); setSel(n.id); if (n.id === 'lit') setLitOpen(function (v) { return !v; }); }, onContextMenu: function (e) { e.preventDefault(); e.stopPropagation(); if (props.canEdit) setMenu({ node: n, x: e.clientX, y: e.clientY }); } }, body(n)); })),
        run && runActive ? h('div', { className: 'rmap-runbar' + (run.status === 'awaiting_approval' ? ' gate' : '') },
          h('span', { className: 'rmap-rb-dot' }), h('b', null, '⚡ Autopilot'),
          h('span', { className: 'rmap-rb-st' }, (AP_ST_LABEL[run.status] || run.status) + (activeLabel ? ' · ' + activeLabel : '') + (runProg ? ' · ' + runProg : '')),
          (run.status === 'awaiting_approval' && run.gate && props.canEdit) ? h('button', { className: 'btn pri', style: { padding: '3px 10px', fontSize: 11.5, marginLeft: 4 }, onClick: approveGate }, '✓ ' + (run.gate.title || 'Jóváhagyás')) : null,
          h('a', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5, textDecoration: 'none', marginLeft: 'auto' }, href: 'Autopilot.html?run=' + run.id, target: '_blank', rel: 'noopener' }, 'Dashboard ↗')) : null,
        h('div', { className: 'rmap-zoom' },
          h('button', { title: mode === 'lane' ? 'Szabad elrendezés (B)' : 'Sávos elrendezés', onClick: function () { var nm = mode === 'lane' ? 'free' : 'lane'; setMode(nm); try { localStorage.setItem('pr-rmap-mode', nm); } catch (e) { } } }, mode === 'lane' ? '⊙' : '☰'),
          h('button', { onClick: function () { zoom(1.18); } }, '+'), h('button', { onClick: function () { zoom(0.85); } }, '−')),
        h('div', { className: 'rmap-hint' }, 'Húzd = pan · görgő = zoom · ' + (mode === 'lane' ? 'sávos' : 'szabad') + ' nézet · kattints egy node-ra')),
      sn ? h('div', { className: 'rmap-insp' },
        h('div', { className: 'rmap-insp-h' }, h('span', { className: 'rmap-ni' }, RMAP_TYPE[sn.t].ic), h('div', { style: { minWidth: 0 } }, h('b', null, sn.title), h('div', { className: 'rmap-insp-ty' }, RMAP_TYPE[sn.t].lab)), h('button', { className: 'rmap-insp-x', onClick: function () { setSel(null); } }, '×')),
        h('div', { className: 'rmap-insp-b' },
          h('div', { className: 'rmap-kv' }, Object.keys(sn.m).map(function (kk) { return [h('span', { className: 'k', key: 'k' + kk }, kk), h('span', { className: 'v', key: 'v' + kk }, sn.m[kk])]; })),
          h('div', { className: 'rmap-insp-acts' },
            (props.canEdit && editSpec(sn)) ? h('button', { className: 'btn pri', style: { fontSize: 12 }, onClick: function () { openEdit(sn); } }, '✎ Metaadat szerkesztése') : null,
            h('button', { className: 'btn', style: { fontSize: 12 }, onClick: function () { if (props.onGoTab) props.onGoTab(RMAP_TYPE[sn.t].tab); } }, 'Megnyitás a ' + RMAP_TYPE[sn.t].lab + ' fülön →'),
            (sn.ref && sn.ref.url) ? h('a', { className: 'btn', style: { fontSize: 12, textDecoration: 'none' }, href: sn.ref.url, target: '_blank', rel: 'noopener' }, 'Forrás ↗') : null),
          h('p', { className: 'rmap-insp-note' }, 'A metaadat itt közvetlenül szerkeszthető — ugyanazok az adatok, mint a fázis-paneleken. A canvason maradsz, modal helyett.'))) : null,
      editing ? h('div', { className: 'scrim', onClick: function () { setEditing(null); } },
        h('div', { className: 'modal', style: { width: editing.fields.some(function (f) { return f.ty === 'bigtext'; }) ? 680 : 460 }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'modal-h' }, h('b', null, editing.title), h('button', { className: 'x', 'aria-label': 'Close', onClick: function () { setEditing(null); } }, '×')),
          h('div', { className: 'modal-b' }, editing.fields.map(function (fd) {
            return h('div', { className: 'field', key: fd.k },
              h('label', null, fd.l),
              fd.ty === 'select' ? h('select', { value: eform[fd.k], onChange: function (e) { var v = e.target.value; setEform(function (o) { var n = Object.assign({}, o); n[fd.k] = v; return n; }); } }, fd.o.map(function (op) { return h('option', { key: op, value: op }, op); }))
                : fd.ty === 'checkbox' ? h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 } }, h('input', { type: 'checkbox', checked: !!eform[fd.k], onChange: function (e) { var v = e.target.checked; setEform(function (o) { var n = Object.assign({}, o); n[fd.k] = v; return n; }); } }), 'Igen')
                  : (fd.ty === 'textarea' || fd.ty === 'bigtext') ? h('textarea', { rows: fd.ty === 'bigtext' ? 14 : 3, style: fd.ty === 'bigtext' ? { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12.5 } : null, value: eform[fd.k], onChange: function (e) { var v = e.target.value; setEform(function (o) { var n = Object.assign({}, o); n[fd.k] = v; return n; }); } })
                    : h('input', { type: fd.ty === 'number' ? 'number' : 'text', value: eform[fd.k], onChange: function (e) { var v = e.target.value; setEform(function (o) { var n = Object.assign({}, o); n[fd.k] = v; return n; }); } }));
          })),
          h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: function () { setEditing(null); } }, 'Mégse'), h('button', { className: 'btn pri', onClick: saveEdit }, 'Mentés')))) : null,
      genBusy ? h('div', { className: 'rmap-genbusy' }, '⏳ Generálás…') : null,
      menu ? h('div', { className: 'rmap-menu-scrim', onClick: function () { setMenu(null); }, onContextMenu: function (e) { e.preventDefault(); setMenu(null); } },
        h('div', { className: 'rmap-menu', style: { left: Math.min(menu.x, (window.innerWidth || 1200) - 230) + 'px', top: Math.min(menu.y, (window.innerHeight || 800) - 140) + 'px' }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-menu-h' }, '✦ Generálás innen' + (RMAP_TYPE[menu.node.t] ? ' · ' + RMAP_TYPE[menu.node.t].lab : '')),
          genActions(menu.node).map(function (a) { return h('button', { key: a[0], className: 'rmap-menu-b', onClick: function () { runGen(menu.node, a[0]); } }, a[1]); }))) : null);
  }

  function ProjectDetail(props) {
    var p = props.project;
    var tS = useState(props.initTab || 'overview'), tab = tS[0], setTab = tS[1];   // Memory step deep-link opens the protocol tab
    var asS = useState(null), autoStudy = asS[0], setAutoStudy = asS[1];   // ideas to auto-create a study from (set by the Ideas "study basis" window → one-click create + Publify pre-fill)
    var agS = useState(0), autoSR = agS[0], setAutoSR = agS[1];   // signal from the Ideas "Study basis" → generate SR-question drafts in the SR studio
    var edS = useState(false), editOpen = edS[0], setEditOpen = edS[1];   // #2: project settings editor
    function setStage(i) {
      sb.from('research_projects').update({ stage: i }).eq('id', p.id).then(function () {
        // record the milestone so stage progress shows in the log + the supervisor's digest
        sb.from('research_log').insert({ project_id: p.id, profile_id: props.authorId, type: 'MILESTONE', summary: 'Moved to the ' + STAGES[i] + ' stage' }).then(function () { props.onChanged(); });
      });
    }
    function setStatus(e) { sb.from('research_projects').update({ status: e.target.value }).eq('id', p.id).then(props.onChanged); }
    var openTasks = (props.tasks || []).filter(function (t) { return t.status !== 'done'; }).length;
    function startStudyFromIdea(idea) {
      var title = String((idea && idea.question) || 'Literature').slice(0, 80);
      sb.from('research_studies').insert({ project_id: p.id, idea_id: idea ? idea.id : null, title: title, question: idea ? idea.question : p.title, created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
        var id = r && r.data && r.data.id; if (!id) return;
        var rows = LS_STEPS.map(function (s) { return { study_id: id, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, p, idea) }; });
        sb.from('research_study_steps').insert(rows).then(function () { props.onChanged(); setTab('study'); });
      });
    }
    // (the visible sub-tab row is a separate array below; Data/Compute are intentionally not surfaced)
    // ---- Setup Checklist (New design flag, direction B): the sparse Overview/Setup tab becomes a guided getting-started checklist + Goal, driven by real project state. ----
    function setupOverview() {
      var srcs = props.sources || [];
      var inc = srcs.filter(function (s) { return s.screening === 'include'; }).length;
      var CHK = [
        { done: !!(p.goal && p.goal.trim()), label: 'Set a research goal', note: (p.goal && p.goal.trim()) ? 'Goal is set' : 'Describe what the project investigates', tab: null, act: '✎ in Settings' },
        { done: (props.ideas || []).length > 0, label: 'Capture research ideas', note: (props.ideas || []).length + ' idea' + ((props.ideas || []).length === 1 ? '' : 's'), tab: 'ideas', act: 'Add ideas' },
        { done: srcs.length > 0, label: 'Build your literature library', note: srcs.length + ' source' + (srcs.length === 1 ? '' : 's') + ' · ' + inc + ' included', tab: 'literature', act: 'Search literature' },
        { done: (props.studies || []).length > 0, label: 'Run a screening study', note: (props.studies || []).length + ((props.studies || []).length === 1 ? ' study' : ' studies'), tab: 'study', act: 'Open Studies' },
        { done: (props.datasets || []).length > 0, label: 'Add a dataset', note: (props.datasets || []).length + ' dataset' + ((props.datasets || []).length === 1 ? '' : 's'), tab: 'data', act: 'Add data' },
        { done: (p.stage || 0) >= 3, label: 'Draft the experimental protocol', note: (p.stage || 0) >= 3 ? 'Protocol stage reached' : 'Not started yet', tab: 'protocol', act: 'Open Protocol' }
      ];
      var doneN = CHK.filter(function (c) { return c.done; }).length;
      var pct = Math.round(doneN / CHK.length * 100);
      return h('div', null,
        h('div', { className: 'panel su-card' },
          h('div', { className: 'su-head' },
            h('div', null, h('h3', { className: 'su-title' }, 'Get set up'), h('div', { className: 'su-sub' }, doneN + ' of ' + CHK.length + ' setup steps done')),
            h('div', { className: 'su-pctwrap' }, h('div', { className: 'su-pct' }, pct + '%'), h('div', { className: 'su-bar' }, h('i', { style: { width: pct + '%' } })))),
          h('div', { className: 'su-list' }, CHK.map(function (c, i) {
            return h('div', { className: 'su-item' + (c.done ? ' done' : ''), key: i },
              h('span', { className: 'su-check', 'aria-hidden': 'true' }, c.done ? '✓' : ''),
              h('div', { className: 'su-body' }, h('div', { className: 'su-lbl' }, c.label), h('div', { className: 'su-note' }, c.note)),
              c.done ? h('span', { className: 'su-donetag' }, 'Done')
                : (c.tab && props.canEdit) ? h('button', { className: 'su-go', onClick: function () { setTab(c.tab); } }, c.act + ' →')
                  : h('span', { className: 'su-next' }, c.act));
          }))),
        p.goal ? h('div', { className: 'panel', style: { marginTop: 10 } }, h('h3', null, 'Goal'), h('div', { style: { fontSize: 13.5, lineHeight: 1.55 } }, p.goal))
          : h('div', { className: 'panel', style: { marginTop: 10 } }, h('div', { className: 'soon' }, 'No goal set yet — add one with ✎ Settings above.'))
      );
    }
    var content;
    if (tab === 'ideas') content = h('div', { className: nd() ? 'ideas2' : null }, h(ChatPanel, { projectId: p.id, supervised: !!p.student_id, canEdit: props.canEdit, authorId: props.authorId, fileOwnerId: props.fileOwnerId, sources: props.sources, onChanged: props.onChanged }), h(IdeasPanel, { projectId: p.id, ideas: props.ideas, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, onStartStudyMulti: function (ideas) { setAutoSR(function (x) { return x + 1; }); setTab('study'); }, onGoStudy: function () { setTab('study'); } }));
    else if (tab === 'literature') content = h(React.Fragment, null,
      h(LiteraturePanel, { projectId: p.id, sources: props.sources, studies: props.studies, canEdit: props.canEdit, myEmail: props.myEmail, onChanged: props.onChanged }),
      h(ElicitReports, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onGoStudy: function () { setTab('study'); } }),
      h(ElicitTrials, { projectId: p.id, canEdit: props.canEdit }));
    else if (tab === 'study') content = h(ElicitSysReview, { projectId: p.id, project: p, canEdit: props.canEdit, autoGenerate: autoSR, onAutoGenerated: function () { setAutoSR(0); } });   // SR Studio (primary); the keyword funnel renders persistently below
    else if (tab === 'protocol') content = h(ProtocolPanel, { projectId: p.id, ideas: props.ideas, sources: props.sources, studies: props.studies, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'data') content = h(DataPanel, { projectId: p.id, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'compute') content = h(ComputePanel, { projectId: p.id, jobs: props.jobs, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'journal') content = h(JournalPanel, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'writing') content = h(WritingPanel, { project: p, sources: props.sources, ideas: props.ideas, jobs: props.jobs, canEdit: props.canEdit, authorId: props.authorId });
    else if (tab === 'submission') content = h('div', { className: 'panel' },
      h('h3', { style: { marginTop: 0 } }, '📤 Submission'),
      h('p', { style: { fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55 } }, 'When the manuscript is ready, submit and track it in the Érkeztető (submission) workflow — desk-check, reviewers, decisions and camera-ready.'),
      h('a', { className: 'btn pri', href: 'Submissions.html' + (/[?&]adminView=1/.test(location.search) ? '?adminView=1' : ''), style: { textDecoration: 'none', display: 'inline-block' } }, 'Open the submission workflow →'));
    else if (tab === 'map') content = h(PipelineCanvas, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, viewerId: props.me && props.me.id, onGoTab: function (t) { setTab(t); } });
    else if (tab === 'canvas') content = window.PRCanvas ? h(window.PRCanvas, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId }) : h('div', { className: 'empty' }, 'Loading Canvas…');
    else if (tab === 'notes') content = window.PRNotes ? h(window.PRNotes, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId }) : h('div', { className: 'empty' }, 'Loading Notes…');
    else if (tab === 'log') content = h(LogPanel, { projectId: p.id, authorId: props.authorId, entries: props.log, canEdit: props.canEdit, onChanged: props.onChanged });
    else if (tab === 'tasks') content = h(TasksPanel, { projectId: p.id, tasks: props.tasks, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else content = nd() ? setupOverview() : (p.goal ? h('div', { className: 'panel' }, h('h3', null, 'Goal'), h('div', { style: { fontSize: 13.5 } }, p.goal)) : h('div', { className: 'soon' }, 'No goal set yet.'));
    // ---- Two-tier chrome (New design flag, direction B): the project nav moves into a left context panel beside the content (the AppShell sidebar becomes a thin icon rail via CSS). Classic (flag-OFF) return is unchanged below. ----
    function stageNav() {
      var kids = [];
      STAGES.forEach(function (name, i) {
        var isDone = i < (p.stage || 0);
        var active = STAGE_TAB[i] === tab;
        kids.push(h('button', { key: i, className: 'rv-st' + (active ? ' cur' : '') + (isDone ? ' done' : '') + (i === (p.stage || 0) ? ' atstage' : ''), 'aria-current': active ? 'page' : null, onClick: function () { setTab(STAGE_TAB[i] || 'overview'); } },
          h('span', { className: 'rv-st-dot' }, isDone ? '✓' : (i + 1)), h('span', { className: 'rv-st-lbl' }, name)));
        if (i === 1) kids.push(h('button', { key: 'study', className: 'rv-st sub' + (tab === 'study' ? ' cur' : ''), onClick: function () { setTab('study'); } },
          h('span', { className: 'rv-st-dot' }, '›'), h('span', { className: 'rv-st-lbl' }, 'Studies')));
      });
      return h('div', { className: 'rv-stnav' }, kids);
    }
    function subNav() {
      return h('div', { className: 'rv-subnav' }, [['map', '🗺️ Map', null], ['canvas', 'Canvas', null], ['notes', 'Notes', null], ['data', 'Data', (props.datasets || []).length], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]].map(function (t) {
        return h('button', { key: t[0], className: 'rv-sub' + (tab === t[0] ? ' on' : ''), onClick: function () { setTab(t[0]); } }, h('span', null, t[1]), t[2] ? h('span', { className: 'rv-sub-c' }, t[2]) : null);
      }));
    }
    if (nd()) {
      var roBannerN = (!props.canEdit && props.viewerId && p.owner_id !== props.viewerId) ? h('div', { className: 'ro-banner' }, '👁 Supervisor view — ' + (props.studentName ? props.studentName + '’s project' : 'student’s project') + '. Read-only.') : null;
      var kpiN = h('div', { className: 'rv-kpi' }, [
        ['Sources', (props.sources || []).length],
        ['Included', (props.sources || []).filter(function (s) { return s.screening === 'include'; }).length],
        ['Screened', (props.sources || []).filter(function (s) { return s.screening && s.screening !== 'unscreened'; }).length],
        ['Ideas', (props.ideas || []).length],
        ['Studies', (props.studies || []).length],
        ['Open tasks', openTasks]
      ].map(function (k) { return h('div', { className: 'rv-kpi-c', key: k[0] }, h('div', { className: 'k' }, k[0]), h('div', { className: 'v' }, String(k[1]))); }));
      var funnelN = h('div', { style: { display: tab === 'study' ? 'block' : 'none' } },
        h('details', { className: 'panel', style: { marginTop: 14, padding: '12px 16px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)' } }, '⏸ Keyword screening funnel (OpenAlex search → screen) — paused · click to open'),
          h('div', { style: { marginTop: 12 } }, h(LiteratureStudy, { projectId: p.id, project: p, studies: props.studies, sources: props.sources, ideas: props.ideas, loading: props.loading, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoCreateFrom: autoStudy, onAutoConsumed: function () { setAutoStudy(null); } }))));
      return h('div', { className: 'rv-2t' },
        h('aside', { className: 'rv-ctx' },
          h('div', { className: 'rv-ctx-top' },
            h('div', { className: 'rv-ctx-brand' }, h('div', { className: 'mk' }, h('span')), h('b', null, 'Publify')),
            h('button', { className: 'rv-ctx-back', onClick: props.onBack, title: 'Back to all projects' }, '‹ Projects')),
          h('div', { className: 'rv-ctx-proj' },
            h('div', { className: 'rv-ctx-title' }, p.title),
            h('div', { className: 'rv-ctx-field' }, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : '')),
            h('div', { className: 'rv-ctx-pills' },
              props.canEdit ? h('select', { className: 'field rv-ctx-sel', title: 'Set the current stage (logs a milestone)', value: p.stage || 0, onChange: function (e) { setStage(parseInt(e.target.value, 10)); } }, STAGES.map(function (s, i) { return h('option', { key: i, value: i }, 'Stage: ' + s); })) : h('span', { className: 'chip c-grey' }, 'Stage: ' + STAGES[p.stage || 0]),
              props.canEdit ? h('select', { className: 'field rv-ctx-sel', value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, STATUS_LABEL[k]); })) : h('span', { className: 'chip c-grey' }, STATUS_LABEL[p.status] || p.status),
              props.canEdit ? h('button', { className: 'btn rv-ctx-set', title: 'Project base settings (title, field, keywords, goal)', onClick: function () { setEditOpen(true); } }, '✎ Settings') : null
            )
          ),
          h('div', { className: 'rv-ctx-lbl' }, 'Workflow'),
          stageNav(),
          h('div', { className: 'rv-ctx-lbl' }, 'Views'),
          subNav(),
          props.me ? h('div', { className: 'rv-ctx-foot' }, h(Avatar, { u: props.me, size: 28 }), h('div', { className: 'rv-ctx-acct' }, h('b', null, props.me.name), h('span', null, props.me.email)), h('a', { className: 'rv-ctx-exit', href: 'Projects.html', title: 'Back to Publify' }, '←')) : null
        ),
        h('div', { className: 'rv-cmain' }, roBannerN, kpiN, content, funnelN),
        editOpen ? h(ProjectSettingsModal, { project: p, onClose: function () { setEditOpen(false); }, onSaved: function () { setEditOpen(false); props.onChanged(); } }) : null
      );
    }
    return h('div', null,
      h('button', { className: 'back-btn', onClick: props.onBack }, '← All projects'),
      (!props.canEdit && props.viewerId && p.owner_id !== props.viewerId) ? h('div', { className: 'ro-banner' }, '👁 Supervisor view — ' + (props.studentName ? props.studentName + '’s project' : 'student’s project') + '. Read-only.') : null,
      h('div', { className: 'dhead' },
        h('div', { className: 'dt' }, h('h1', null, p.title), h('p', null, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : ''))),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          // explicit Stage control — recording the stage is deliberate here, not a side-effect of browsing the stepper
          props.canEdit
            ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, title: 'Set the current stage (logs a milestone)', value: p.stage || 0, onChange: function (e) { setStage(parseInt(e.target.value, 10)); } }, STAGES.map(function (s, i) { return h('option', { key: i, value: i }, 'Stage: ' + s); }))
            : h('span', { className: 'chip c-grey' }, 'Stage: ' + STAGES[p.stage || 0]),
          props.canEdit
            ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, STATUS_LABEL[k]); }))
            : h('span', { className: 'chip c-grey' }, STATUS_LABEL[p.status] || p.status),
          props.canEdit ? h('button', { className: 'btn', style: { height: 32, flex: 'none' }, title: 'Project base settings (title, field, keywords, goal)', onClick: function () { setEditOpen(true); } }, '✎ Settings') : null
        )
      ),
      h(Stepper, { stage: p.stage, tab: tab, canEdit: props.canEdit, onSet: setStage, onStudy: function () { setTab('study'); }, onNav: function (i) { setTab(STAGE_TAB[i] || 'overview'); } }),
      h('div', { className: 'subtabs' }, [['overview', 'Overview', null], ['canvas', 'Canvas', null], ['notes', 'Notes', null], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]].map(function (t) {
        return h('button', { key: t[0], className: tab === t[0] ? 'on' : '', onClick: function () { setTab(t[0]); } }, t[1], t[2] ? h('span', { className: 'c' }, t[2]) : null);
      })),
      nd() ? (function () {
        var srcs = props.sources || [];
        var kpi = [
          ['Sources', srcs.length],
          ['Included', srcs.filter(function (s) { return s.screening === 'include'; }).length],
          ['Screened', srcs.filter(function (s) { return s.screening && s.screening !== 'unscreened'; }).length],
          ['Ideas', (props.ideas || []).length],
          ['Studies', (props.studies || []).length],
          ['Open tasks', openTasks]
        ];
        return h('div', { className: 'rv-kpi' }, kpi.map(function (k) {
          return h('div', { className: 'rv-kpi-c', key: k[0] }, h('div', { className: 'k' }, k[0]), h('div', { className: 'v' }, String(k[1])));
        }));
      })() : null,
      content,
      // #9 — persistent Lit. study: stays mounted (just hidden) on other tabs, so a running study keeps going
      // in the background while you use the Chat / other tabs.
      h('div', { style: { display: tab === 'study' ? 'block' : 'none' } },
        h('details', { className: 'panel', style: { marginTop: 14, padding: '12px 16px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)' } }, '⏸ Keyword screening funnel (OpenAlex search → screen) — paused · click to open'),
          h('div', { style: { marginTop: 12 } }, h(LiteratureStudy, { projectId: p.id, project: p, studies: props.studies, sources: props.sources, ideas: props.ideas, loading: props.loading, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoCreateFrom: autoStudy, onAutoConsumed: function () { setAutoStudy(null); } })))),
      editOpen ? h(ProjectSettingsModal, { project: p, onClose: function () { setEditOpen(false); }, onSaved: function () { setEditOpen(false); props.onChanged(); } }) : null
    );
  }

  // ---------- Project card ----------
  // (B) Autopilot status badge on a project card — links to the run's dashboard so a closed run is always findable.
  var AP_ST_LABEL = { running: 'fut', paused: 'szünet', awaiting_approval: 'jóváhagyásra vár', stalled: 'megszakadt', done: 'kész', failed: 'hiba', cancelled: 'leállítva', queued: 'sorban' };
  function apRunBadge(run) {
    if (!run) return null;
    var eff = run.status;
    if (eff === 'running') { var u = run.updated_at ? new Date(run.updated_at).getTime() : 0; if (u && Date.now() - u > 60000) eff = 'stalled'; }
    var ph = run.phases || [], enabled = ph.filter(function (x) { return x.enabled; }).length || 1, done = ph.filter(function (x) { return x.enabled && (x.status === 'done' || x.status === 'skipped'); }).length;
    var active = (eff === 'running' || eff === 'awaiting_approval' || eff === 'stalled');
    return h('a', { className: 'chip ' + (eff === 'failed' ? 'c-warn' : active ? 'c-acc' : 'c-grey'), href: 'Autopilot.html?run=' + encodeURIComponent(run.id), onClick: function (e) { e.stopPropagation(); }, style: { textDecoration: 'none' }, title: 'Autopilot dashboard megnyitása' }, '⚡ Autopilot · ' + (AP_ST_LABEL[eff] || eff) + ' · ' + done + '/' + enabled);
  }

  function ProjectCard(props) {
    var p = props.project;
    var openTasks = p._openTasks;
    // explicit author attribution so a student's (or a test's) project can never read as the viewer's own
    var badge;
    if (props.meId && p.owner_id === props.meId) badge = h('span', { className: 'chip c-grey author-badge' }, 'Mine');
    else { var st = props.studentById && props.studentById[p.student_id]; badge = h('span', { className: 'chip ' + (st ? 'c-acc' : 'c-warn') + ' author-badge' }, st ? 'Student: ' + st.name : 'Student’s work'); }
    return h('div', { className: 'card', onClick: function () { props.onOpen(p); } },
      h('div', { className: 'ch' }, h('div', null, h('b', null, p.title), h('span', null, p.field || '—')), badge),
      p.keywords && p.keywords.length ? h('div', { className: 'tags' }, p.keywords.slice(0, 4).map(function (k, i) { return h('span', { className: 'tag', key: i }, k); })) : null,
      h('div', { className: 'meter' }, h('i', { style: { width: Math.round((p.stage / (STAGES.length - 1)) * 100) + '%' } })),
      (nd() && props.apRun) ? h('div', { style: { marginTop: 8 } }, apRunBadge(props.apRun)) : null,
      h('div', { className: 'kv' }, h('span', null, 'Stage: ' + STAGES[p.stage || 0]), h('span', { className: 'chip ' + (p.status === 'active' ? 'c-ok' : 'c-grey') }, STATUS_LABEL[p.status] || p.status))
    );
  }

  // ---------- Notifications bell (R2) ----------
  function NotifBell() {
    var nS = useState([]), notes = nS[0], setNotes = nS[1];
    var oS = useState(false), open = oS[0], setOpen = oS[1];
    var eS = useState(null), expanded = eS[0], setExpanded = eS[1];
    function load() { sb.from('notifications').select('id,kind,payload,read_at,created_at').order('created_at', { ascending: false }).limit(40).then(function (r) { setNotes((r && r.data) || []); }); }
    useEffect(function () { load(); var t = setInterval(load, 60000); return function () { clearInterval(t); }; }, []);   // poll so new digests appear without a manual reload
    function markRead(n) { if (n.read_at) return; sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).then(function () { setNotes(function (l) { return l.map(function (x) { return x.id === n.id ? Object.assign({}, x, { read_at: 'now' }) : x; }); }); }); }
    function markAll() { var ids = notes.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; }); if (!ids.length) return; sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).then(load); }
    var unread = notes.filter(function (n) { return !n.read_at; }).length;
    function title(n) { return n.kind === 'digest' ? 'Daily research digest' : ((n.payload && n.payload.title) || n.kind); }
    function summ(n) { var p = n.payload || {}; if (n.kind === 'digest') return (p.day || '') + ' · ' + (p.students || 0) + ' student' + (p.students === 1 ? '' : 's') + ', ' + (p.entries || 0) + ' update' + (p.entries === 1 ? '' : 's'); return p.body || ''; }
    return h('div', { className: 'notif-wrap' },
      h('button', { className: 'bell', 'aria-label': 'Notifications', 'aria-expanded': open, onClick: function () { setOpen(!open); if (!open) load(); } },
        h('svg', { 'aria-hidden': 'true', viewBox: '0 0 16 16', fill: 'none', stroke: 'var(--muted)', strokeWidth: 1.5 }, h('path', { d: 'M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 0 0 8 2z', strokeLinejoin: 'round' }), h('path', { d: 'M6.6 12.4a1.5 1.5 0 0 0 2.8 0', strokeLinecap: 'round' })),
        unread ? h('i', { className: 'nb' }, unread) : null
      ),
      open ? h('div', { className: 'notif-pop' },
        h('div', { className: 'nh' }, 'Notifications', unread ? h('button', { className: 'back-btn', style: { margin: 0 }, onClick: markAll }, 'Mark all read') : null),
        notes.length ? notes.map(function (n) {
          var p = n.payload || {};
          return h('div', { key: n.id, className: 'notif-item' + (n.read_at ? '' : ' unread'), onClick: function () { markRead(n); setExpanded(expanded === n.id ? null : n.id); } },
            h('b', null, title(n)), h('div', { className: 'nx' }, summ(n)),
            (expanded === n.id && n.kind === 'digest' && p.items && p.items.length) ? h('div', { style: { marginTop: 8 } }, p.items.map(function (it, i) {
              return h('div', { key: i, className: 'nx', style: { paddingTop: 4 } }, h('span', { className: 'chip c-grey', style: { marginRight: 6 } }, it.type), it.student + ' — ' + it.summary);
            })) : null
          );
        }) : h('div', { style: { padding: 22, textAlign: 'center', color: 'var(--faint)', fontSize: 13 } }, 'No notifications.')
      ) : null
    );
  }

  // ---------- Supervisor view: each supervised student → their (read-only) projects + today's digest chip ----------
  function SupervisedView(props) {
    var students = (props.students && props.students.list) || [];
    var projects = props.projects || [];
    var day = new Date().toISOString().slice(0, 10);
    var dgS = useState({}), digests = dgS[0], setDigests = dgS[1];
    var gnS = useState({}), gen = gnS[0], setGen = gnS[1];
    var ids = students.map(function (s) { return s.id; });
    function loadDigests() {
      if (!ids.length) return;
      sb.from('student_daily_reports').select('student_id,chat_msgs,ideas,log_entries').in('student_id', ids).eq('day', day).then(function (r) {
        var m = {}; ((r && r.data) || []).forEach(function (x) { m[x.student_id] = x; }); setDigests(m);
      });
    }
    useEffect(loadDigests, [ids.length]); // eslint-disable-line
    function setG(sid, v) { setGen(function (g) { var n = Object.assign({}, g); n[sid] = v; return n; }); }
    function generate(sid) {
      setG(sid, true);
      sb.functions.invoke('student-digest', { body: { student_id: sid, day: day } }).then(function () { setG(sid, false); loadDigests(); }, function () { setG(sid, false); });
    }
    var byStudent = {}; projects.forEach(function (p) { (byStudent[p.student_id] = byStudent[p.student_id] || []).push(p); });
    var known = {}; students.forEach(function (s) { known[s.id] = 1; });
    var orphans = projects.filter(function (p) { return !known[p.student_id]; });
    function card(p) { return h(ProjectCard, { key: p.id, project: p, meId: null, studentById: props.studentById, onOpen: props.onOpen }); }
    if (!students.length && !projects.length) return h('div', { className: 'soon' }, h('b', null, 'No student has a research project yet. '), 'When one of your students creates a research project, it appears here — per student and aggregated.');
    return h('div', null,
      students.map(function (s) {
        var ps = byStudent[s.id] || [];
        var rep = digests[s.id], g = gen[s.id];
        return h('div', { className: 'sup-student', key: s.id },
          h('div', { className: 'sup-head' },
            h(Avatar, { u: s, size: 30 }),
            h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, s.name), h('span', { className: 'sup-topic' }, s.topic || '—')),
            rep ? h('span', { className: 'chip c-grey' }, (rep.chat_msgs || 0) + ' chat · ' + (rep.ideas || 0) + ' idea(s) · ' + (rep.log_entries || 0) + ' log') : null,
            h('button', { className: 'btn' + (rep ? '' : ' pri'), style: { padding: '5px 10px', fontSize: 12 }, disabled: g, onClick: function () { generate(s.id); } }, g ? 'Working…' : (rep ? 'Refresh report' : 'Generate report')),
            h('a', { className: 'btn', style: { padding: '5px 10px', fontSize: 12, textDecoration: 'none' }, href: 'PhD.html?view=reports', title: 'Daily AI summary in the Doctoral School' }, 'Daily report →')
          ),
          ps.length ? h('div', { className: 'grid' }, ps.map(card)) : h('div', { className: 'sup-empty' }, 'No active research project.')
        );
      }),
      orphans.length ? h('div', { className: 'sup-student' },
        h('div', { className: 'sup-head' }, h('b', null, 'Other student projects')),
        h('div', { className: 'grid' }, orphans.map(card))
      ) : null
    );
  }

  // ---------- Cross-project global Task board ----------
  // One Kanban across ALL of a user's research projects' protocol steps (the same steps the per-protocol
  // board shows), with a project filter + a human/AI filter + search. Owner may drag cards between columns;
  // read-only (supervised / admin-preview) projects render un-draggable. Reuses BOARD_COLS / stepCol / colPatch.
  function GlobalBoard(props) {
    var projects = props.projects || [];
    var projById = {}; projects.forEach(function (p) { projById[p.id] = p; });
    var pidKey = projects.map(function (p) { return p.id; }).join(',');
    var ldS = useState(true), loading = ldS[0], setLoading = ldS[1];
    var spS = useState([]), steps = spS[0], setSteps = spS[1];        // steps enriched with _proj / _prot
    var fpS = useState(null), selPid = fpS[0], setSelPid = fpS[1];     // null = all projects, else isolate one
    var fwS = useState('all'), who = fwS[0], setWho = fwS[1];          // 'all' | 'human' | 'ai'
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var dgS = useState(null), drag = dgS[0], setDrag = dgS[1];
    var ovS = useState(null), over = ovS[0], setOver = ovS[1];

    function load() {
      var pids = projects.map(function (p) { return p.id; });
      if (!pids.length) { setSteps([]); setLoading(false); return; }
      setLoading(true);
      sb.from('research_protocols').select('id,project_id,title,status').in('project_id', pids).neq('status', 'archived').then(function (r) {
        var prots = (r && r.data) || [];
        var pmap = {}; prots.forEach(function (p) { pmap[p.id] = p; });
        var protIds = prots.map(function (p) { return p.id; });
        if (!protIds.length) { setSteps([]); setLoading(false); return; }
        sb.from('research_protocol_steps').select('id,protocol_id,ord,title,kind,status,assignee,needs_approval,depends_on,spec,result').in('protocol_id', protIds).order('ord', { ascending: true }).then(function (sr) {
          var rows = (sr && sr.data) || [];
          rows.forEach(function (s) { var pr = pmap[s.protocol_id]; s._prot = pr; s._proj = pr ? projById[pr.project_id] : null; });
          setSteps(rows); setLoading(false);
        }, function () { setLoading(false); });
      }, function () { setLoading(false); });
    }
    useEffect(function () { load(); }, [pidKey]); // eslint-disable-line

    function canEdit(proj) { return !!(proj && props.canEditProject && props.canEditProject(proj)); }
    function patchStep(s, patch) {
      var proj = s._proj;
      if (!canEdit(proj)) { window.PRUI.toast('Read-only project — this task can’t be moved.', { kind: 'error' }); return; }
      setSteps(function (list) { return list.map(function (x) { return x.id === s.id ? Object.assign({}, x, patch) : x; }); });   // optimistic
      sb.from('research_protocol_steps').update(patch).eq('id', s.id).then(function (r) {
        if (r && r.error) { window.PRUI.toast('Move failed: ' + r.error.message, { kind: 'error' }); load(); }
      }, function () { load(); });
    }
    function moveToCol(s, key) { var patch = colPatch(key); if (patch) patchStep(s, patch); }
    function acOf(s) {
      var r = s.result && s.result.acceptance_check; if (!r || typeof r !== 'object') return null;
      var keys = Object.keys(r); if (!keys.length) return null;
      var pass = keys.filter(function (k) { return String(r[k]).indexOf('PASS') === 0; }).length;
      return { total: keys.length, pass: pass };
    }

    // projects that actually have tasks — the filter chips
    var withTasks = [], seen = {};
    steps.forEach(function (s) { if (s._proj && !seen[s._proj.id]) { seen[s._proj.id] = 1; withTasks.push(s._proj); } });
    var countByPid = {}; steps.forEach(function (s) { if (s._proj) countByPid[s._proj.id] = (countByPid[s._proj.id] || 0) + 1; });
    var qq = q.trim().toLowerCase();
    function pidOn(pid) { return !selPid || selPid === pid; }
    var shown = steps.filter(function (s) {
      if (!s._proj || !pidOn(s._proj.id)) return false;
      if (who !== 'all' && assigneeOf(s) !== who) return false;
      if (qq && (s.title || '').toLowerCase().indexOf(qq) < 0 && (s._proj.title || '').toLowerCase().indexOf(qq) < 0) return false;
      return true;
    });

    function card(s) {
      var a = assigneeOf(s), sx = s.spec || {}, proj = s._proj, ac = acOf(s), editable = canEdit(proj);
      var figs = (s.result && s.result.figures) || [];
      var chips = [];
      if (sx.est_minutes) chips.push(h('span', { key: 'e', className: 'bchip' }, '⏱ ' + sx.est_minutes + 'p'));
      if ((sx.attachments || []).length) chips.push(h('span', { key: 'a', className: 'bchip' }, '📎 ' + sx.attachments.length));
      if ((s.depends_on || []).length) chips.push(h('span', { key: 'd', className: 'bchip' }, '⛓ ' + s.depends_on.join(',')));
      if (figs.length) chips.push(h('span', { key: 'f', className: 'bchip' }, '📈 ' + figs.length));
      if (s.needs_approval && s.status !== 'done') chips.push(h('span', { key: 'p', className: 'bchip warn' }, '⏸ approval'));
      return h('div', {
        key: s.id, className: 'bcard ' + (a === 'human' ? 'hu' : 'ai'), draggable: editable,
        onDragStart: editable ? function (e) { setDrag(s.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); } catch (x) { } } : null,
        onDragEnd: editable ? function () { setDrag(null); setOver(null); } : null,
        onClick: function () { if (proj && props.onOpenProject) props.onOpenProject(proj); },
        title: proj ? 'Open ' + proj.title : 'Open project'
      },
        proj ? h('div', { className: 'gb-proj', title: proj.title }, h('i', { style: { background: colorFor(proj.id) } }), h('span', null, proj.title)) : null,
        h('div', { className: 'bcard-top' }, h('span', { 'aria-hidden': 'true' }, STEP_ICON[s.kind] || '•'),
          h('span', { className: 'bchip who ' + (a === 'human' ? 'hu' : 'ai') }, a === 'human' ? 'HUMAN' : 'AI'),
          ac ? h('span', { className: 'bchip ' + (ac.pass === ac.total ? 'ok' : 'fail') }, ac.pass + '/' + ac.total + ' ✓') : null,
          editable ? null : h('span', { className: 'bchip', title: 'Read-only' }, '🔒')),
        h('div', { className: 'bcard-t' }, h('span', { style: { color: 'var(--faint)' } }, s.ord + '. '), s.title),
        chips.length ? h('div', { className: 'bcard-m' }, chips) : null
      );
    }

    var seg = h('div', { className: 'gb-seg', role: 'group', 'aria-label': 'Assignee filter' },
      [['all', 'All'], ['human', '👤 Human'], ['ai', '🤖 AI']].map(function (o) {
        return h('button', { key: o[0], className: who === o[0] ? 'on' : '', onClick: function () { setWho(o[0]); } }, o[1]);
      }));

    return h('div', null,
      h('div', { className: 'gb-bar' },
        h('div', { className: 'gb-chips' },
          h('button', { className: 'gb-chip' + (!selPid ? ' on' : ''), onClick: function () { setSelPid(null); } }, 'All projects ', h('span', { className: 'gb-c' }, steps.length)),
          withTasks.map(function (p) {
            return h('button', { key: p.id, className: 'gb-chip' + (selPid === p.id ? ' on' : ''), title: p.title, onClick: function () { setSelPid(selPid === p.id ? null : p.id); } },
              h('i', { className: 'gb-dot', style: { background: colorFor(p.id) } }),
              h('span', { className: 'gb-nm' }, p.title), h('span', { className: 'gb-c' }, countByPid[p.id] || 0));
          })
        ),
        h('div', { className: 'gb-tools' },
          seg,
          h('input', { className: 'gb-q', value: q, placeholder: '🔍 Filter tasks…', onChange: function (e) { setQ(e.target.value); } }),
          h('button', { className: 'btn', style: { padding: '5px 10px', fontSize: 12, flex: 'none' }, onClick: load, title: 'Reload' }, '↻')
        )
      ),
      loading ? h('div', { className: 'empty' }, 'Loading tasks…')
        : !steps.length ? h('div', { className: 'soon' }, h('b', null, 'No protocol tasks yet. '), 'Generate a protocol inside a research project — its steps appear here as a cross-project Kanban.')
          : h('div', { className: 'panel', style: { overflow: 'hidden' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
              h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, shown.length + ' / ' + steps.length + ' task' + (steps.length === 1 ? '' : 's') + ' · ' + withTasks.length + ' project' + (withTasks.length === 1 ? '' : 's')),
              h('span', { style: { fontSize: 10.5, color: 'var(--faint)' } }, 'drag cards between columns — owner + status update (in your own projects)')),
            h('div', { className: 'bwrap' }, BOARD_COLS.map(function (col) {
              var cards = shown.filter(function (s) { return stepCol(s) === col.key; });
              var est = cards.reduce(function (a, s) { return a + ((s.spec && s.spec.est_minutes) || 0); }, 0);
              return h('div', {
                key: col.key, className: 'bcol' + (over === col.key ? ' over' : '') + (' cap-' + (col.who === 'human' ? 'hu' : col.who === 'ai' ? 'ai' : 'bk')),
                onDragOver: function (e) { if (drag) { e.preventDefault(); if (over !== col.key) setOver(col.key); } },
                onDrop: function (e) { e.preventDefault(); setOver(null); if (drag) { var s = steps.filter(function (x) { return x.id === drag; })[0]; if (s) moveToCol(s, col.key); setDrag(null); } }
              },
                h('div', { className: 'bcol-h' }, h('span', null, BCOL_IC[col.key]), h('span', { className: 'bcol-t' }, col.title), h('span', { className: 'bcol-n' }, cards.length + '')),
                est ? h('div', { className: 'bcol-est' }, '⏱ ~' + est + 'p') : null,
                h('div', { className: 'bcol-b' }, cards.length ? cards.map(card) : h('div', { className: 'bcol-empty' }, '—'))
              );
            }))
          )
    );
  }

  // ---------- App ----------
  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var pjS = useState([]), projects = pjS[0], setProjects = pjS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var dS = useState({ log: [], tasks: [], ideas: [], sources: [], datasets: [], jobs: [], studies: [], loading: true }), detail = dS[0], setDetail = dS[1];
    var stuS = useState({ byId: {}, list: [] }), supStudents = stuS[0], setSupStudents = stuS[1];   // this supervisor's students (for the "Diákjaim kutatása" view + author badges)

    useEffect(function () { boot(); }, []);
    // Admin "view as": the target is gated on the admin role, which backend.js resolves ASYNCHRONOUSLY
    // (it fires `pr-profile` once the profile row — incl. role — is loaded). If boot() ran before that,
    // adminTargetUser() returned null and we fell back to the admin's OWN projects and never recovered
    // (boot runs once). Re-boot when the role resolves so the VIEWED user's workspace loads instead.
    // Scoped to ?adminView=1, so ordinary sessions are untouched.
    useEffect(function () {
      if (!/[?&]adminView=1/.test(location.search)) return;
      function onProfile() { boot(); }
      window.addEventListener('pr-profile', onProfile);
      return function () { window.removeEventListener('pr-profile', onProfile); };
    }, []);
    // deep-link: Memory (and other surfaces) link back with ?project=<id> — open that project once loaded.
    var jumpedRef = useRef(false);
    useEffect(function () {
      if (jumpedRef.current || phase !== 'ready' || sel) return;
      var pid; try { pid = new URLSearchParams(location.search).get('project'); } catch (e) { pid = null; }
      if (!pid) { jumpedRef.current = true; return; }
      var p = projects.filter(function (x) { return x.id === pid; })[0];
      if (p) { jumpedRef.current = true; openProject(p); }
    }, [phase, projects.length]);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      var target = adminTargetUser();
      var pid = target ? target.id : BE.user.id;
      var email = target ? target.email : (BE.user && BE.user.email);
      sb.from('profiles').select('role,name').eq('id', pid).maybeSingle().then(function (r) {
        var p = (r && r.data) || {};
        setMe({ id: pid, name: p.name || (target && target.name) || BE.user.name, role: p.role, email: email, _preview: !!target });
        loadProjects(pid, !!target, function () { setPhase('ready'); });
        loadStudents(pid);
      }, function () { setMe({ id: pid, name: (target && target.name) || BE.user.name, email: email, _preview: !!target }); setPhase('ready'); });
    }
    // Load the students this user supervises (scoped like phd.jsx effStudents). Empty for non-supervisors
    // or if RLS returns nothing — the supervised view + badges then degrade gracefully.
    function loadStudents(pid) {
      Promise.all([
        sb.from('phd_students').select('id,name,email,profile_id,supervisor_id,topic,avatar_url'),
        sb.from('phd_supervisions').select('student_id,supervisor_id,status')
      ]).then(function (res) {
        var all = (res[0] && res[0].data) || [];
        var acc = ((res[1] && res[1].data) || []).filter(function (v) { return v.supervisor_id === pid && v.status === 'accepted'; }).map(function (v) { return v.student_id; });
        var mine = all.filter(function (s) { return s.supervisor_id === pid || acc.indexOf(s.id) >= 0; });
        var byId = {}; mine.forEach(function (s) { byId[s.id] = s; });
        setSupStudents({ byId: byId, list: mine });
      }, function () { setSupStudents({ byId: {}, list: [] }); });
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
        sb.from('research_log').select('id,type,summary,ts,profile_id').eq('project_id', projectId).order('ts', { ascending: false }),
        sb.from('research_todos').select('id,title,status,due,assignee').eq('project_id', projectId).order('sort', { ascending: true }).order('created_at', { ascending: false }),
        sb.from('research_ideas').select('id,source,question,hypothesis,rationale,novelty,status').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_sources').select('id,source_api,ext_id,doi,title,authors,year,venue,cited_by,url,issn,screening').eq('project_id', projectId).order('cited_by', { ascending: false, nullsFirst: false }),
        sb.from('research_datasets').select('id,name,source,uri,size_bytes,license,status,local_path').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_jobs').select('id,type,title,status,progress,result,result_path,logs,created_at').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_studies').select('id,idea_id,title,question,status,cur_step,created_at').eq('project_id', projectId).order('created_at', { ascending: false })
      ]).then(function (res) {
        var log = (res[0] && res[0].data) || [];
        var base = { log: log, tasks: (res[1] && res[1].data) || [], ideas: (res[2] && res[2].data) || [], sources: (res[3] && res[3].data) || [], datasets: (res[4] && res[4].data) || [], jobs: (res[5] && res[5].data) || [], studies: (res[6] && res[6].data) || [], loading: false };
        // resolve log author names via profiles_public (base profiles is own/admin-only now), keeping the
        // e.profiles.name shape the renderer expects.
        var ids = {}; log.forEach(function (e) { if (e.profile_id) ids[e.profile_id] = 1; });
        var idList = Object.keys(ids);
        function done(names) { log.forEach(function (e) { e.profiles = { name: (names && names[e.profile_id]) || '' }; }); setDetail(base); }
        if (idList.length) sb.from('profiles_public').select('id,name').in('id', idList).then(function (pr) { var m = {}; ((pr && pr.data) || []).forEach(function (x) { m[x.id] = x.name; }); done(m); }, function () { done({}); });
        else done({});
      });
    }
    function openProject(p) { setSel(p); setDetail(function (d) { return Object.assign({}, d, { loading: true }); }); loadDetail(p.id); }
    function refreshAll() { reloadProjects(); if (sel) loadDetail(sel.id); }

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Research'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Research'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return null;
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in to Research'), h('p', null, 'The research workspace needs your account.'), h('button', { className: 'btn pri', onClick: function () { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); } }, 'Sign in')));

    var preview = !!me._preview;
    var isAdmin = me.role === 'admin';
    var authorId = (BE.user && BE.user.id) || me.id;   // RLS ties a log author to the real session user
    function canEdit(p) { return !!(p && !preview && (isAdmin || p.owner_id === me.id)); }   // admin-preview is read-only (you are viewing another user's data)

    var initStudent = null; try { initStudent = new URLSearchParams(location.search).get('student'); } catch (e) { }
    return h(AppShell, {
      me: me, preview: preview, projects: projects, sel: sel, students: supStudents, initStudent: initStudent,
      openProject: openProject, onBack: function () { setSel(null); },
      detail: detail, canEdit: canEdit, authorId: authorId, refreshAll: refreshAll, reloadProjects: reloadProjects
    });
  }

  // shell split out so "new project" modal state is local & simple
  function AppShell(props) {
    var a = useState(false), adding = a[0], setAdding = a[1];
    var bd = useState(false), board = bd[0], setBoard = bd[1];   // header 🗂️ Kanban: cross-project task board
    var me = props.me, sel = props.sel, meId = me.id;
    var studentById = (props.students && props.students.byId) || {};
    var studentList = (props.students && props.students.list) || [];
    var mineProjects = props.projects.filter(function (p) { return p.owner_id === meId; });
    var supProjects = props.projects.filter(function (p) { return p.owner_id !== meId; });
    var isSup = studentList.length > 0 || supProjects.length > 0;
    var vw = useState(props.initStudent ? 'supervised' : 'mine'), view = vw[0], setView = vw[1];
    // (B) load my Autopilot runs → project_id → most-recent run, for the ⚡ status badge on project cards (New design only).
    // Fails soft if migration-62 isn't applied yet (query errors → empty map → no badges).
    var arS = useState({}), apRuns = arS[0], setApRuns = arS[1];
    useEffect(function () {
      if (!nd()) return; var alive = true;
      sb.from('research_autopilot_runs').select('id,project_id,status,phases,updated_at').eq('owner_id', meId).neq('status', 'cancelled').order('updated_at', { ascending: false }).then(function (r) {
        if (!alive) return; var m = {}; ((r && r.data) || []).forEach(function (x) { if (!m[x.project_id]) m[x.project_id] = x; }); setApRuns(m);
      }, function () { });
      return function () { alive = false; };
    }, [meId, props.projects.length]);
    if (!isSup && view === 'supervised') view = 'mine';
    var roleLabel = me.role === 'admin' ? 'Administrator' : (isSup ? 'Supervisor' : 'Researcher');
    var sub = sel ? STAGES[sel.stage || 0] + ' stage' : (view === 'supervised' ? (studentList.length + ' student(s)') : (mineProjects.length + ' project' + (mineProjects.length === 1 ? '' : 's')));

    var seg = (isSup && !sel) ? h('div', { className: 'segctl', role: 'group', 'aria-label': 'Research view' },
      h('button', { className: view === 'mine' ? 'on' : '', 'aria-pressed': view === 'mine', onClick: function () { setView('mine'); } }, 'My research (' + mineProjects.length + ')'),
      h('button', { className: view === 'supervised' ? 'on' : '', 'aria-pressed': view === 'supervised', onClick: function () { setView('supervised'); } }, 'My students’ research (' + supProjects.length + ')')
    ) : null;
    var body;
    if (sel) {
      var initTab = (function () { try { var sp = new URLSearchParams(location.search); return (sp.get('step') && sp.get('project') === sel.id) ? 'protocol' : null; } catch (e) { return null; } })();
      body = h(ProjectDetail, { project: sel, initTab: initTab, me: me, log: props.detail.log, tasks: props.detail.tasks, ideas: props.detail.ideas, sources: props.detail.sources, datasets: props.detail.datasets, jobs: props.detail.jobs, studies: props.detail.studies, loading: props.detail.loading, canEdit: props.canEdit(sel), viewerId: meId, fileOwnerId: meId, studentName: (studentById[sel.student_id] && studentById[sel.student_id].name) || null, authorId: props.authorId, myEmail: props.me.email, onBack: props.onBack, onChanged: props.refreshAll });
    } else if (board) {
      body = h(GlobalBoard, { projects: props.projects, canEditProject: props.canEdit, onOpenProject: props.openProject });
    } else if (view === 'supervised') {
      body = h('div', null, seg, h(SupervisedView, { students: props.students, projects: supProjects, studentById: studentById, onOpen: props.openProject }));
    } else if (!mineProjects.length) {
      body = h('div', null, seg, h('div', { className: 'soon' }, h('b', null, 'No research projects yet. '), 'Create one to start tracking a study from idea to submission.', h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project'))));
    } else {
      body = h('div', null, seg, h('div', { className: 'grid' }, mineProjects.map(function (p) { return h(ProjectCard, { key: p.id, project: p, meId: meId, studentById: studentById, onOpen: props.openProject, apRun: apRuns[p.id] }); })));
    }

    return h('div', { className: 'app' + (nd() && sel ? ' rv-hasproj' : '') },
      h('div', { className: 'side' },
        h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Research'))),
        h('nav', { className: 'nav' },
          h('button', { className: 'on', title: 'Projects', 'aria-label': 'Projects', onClick: props.onBack }, ICp, h('span', null, 'Projects'))
        ),
        h('div', { className: 'side-foot' }, h(Avatar, { u: me, size: 32 }), h('div', { className: 'who' }, h('b', null, me.name), h('span', null, roleLabel)), h('a', { className: 'exit', href: 'Projects.html', title: 'Back to Publify' }, '←'))
      ),
      h('div', { className: 'main' },
        props.preview ? h('div', { className: 'preview-banner' }, '👁 Admin preview — viewing ', h('b', null, me.name), '’s Research. ', h('a', { href: 'PhD.html?adminView=1' }, 'Doctoral School'), ' · ', h('a', { href: 'Profile.html?adminView=1' }, 'Profile'), ' · ', h('a', { href: 'Admin.html' }, '← Back to admin')) : null,
        h('div', { className: 'head' },
          (nd() && sel) ? h('div', { className: 'rv-crumb' }, h('b', null, 'Research')) : h('div', null, h('h1', null, sel ? 'Project' : (board ? 'Protocol tasks' : 'Research projects')), h('div', { className: 'sub' }, board && !sel ? 'Every research project’s protocol steps in one board · personal to-dos live in “My tasks”' : sub)),
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
            h(NotifBell, null),
            sel ? null : h('button', { className: 'btn' + (board ? ' pri' : ''), onClick: function () { setBoard(!board); }, title: 'Protocol task board — every project’s protocol steps in one Kanban' }, board ? '☷ Projects' : '🗂️ Protocol board'),
            (nd() && !(sel || board || view === 'supervised')) ? h('a', { className: 'btn', href: 'Autopilot.html', style: { textDecoration: 'none' }, title: 'Chat-alapú belépő — állítsd össze a briefet és indítsd az Autopilotot' }, '⚡ Autopilot') : null,
            (sel || board || view === 'supervised') ? null : h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project')
          )
        ),
        body,
        adding ? h(NewProjectModal, { ownerId: me.id, onClose: function () { setAdding(false); }, onSaved: function (created) { setAdding(false); props.reloadProjects(); if (created) props.openProject(created); } }) : null
      )
    );
  }

  var ICp = h('svg', { 'aria-hidden': 'true', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3H7l1.5 1.5h4A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z' }));

  window.addEventListener('pr-design', function () { location.reload(); });   // New-design flag flipped → re-init the Research page cleanly (nd() is read at render time)
  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
