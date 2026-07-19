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

  // ---------- i18n: core UI chrome (per-project language, migration-65). tr(lang, en) → the Hungarian label when the
  //            project language is 'hu', else the original English. Curated to the main nav / tabs / primary controls;
  //            deeper strings + AI-generated content are localized elsewhere (edge functions carry the project language). ----
  var I18N_HU = {
    // workflow stages
    'Setup': 'Beállítás', 'Idea': 'Ötlet', 'Literature': 'Irodalom', 'Protocol': 'Protokoll', 'Journal': 'Folyóirat', 'Writing': 'Írás', 'Submission': 'Beküldés',
    // tabs / sub-nav
    'Overview': 'Áttekintés', 'Ideas': 'Ötletek', 'Studies': 'Study-k', 'Canvas': 'Vászon', 'Notes': 'Jegyzetek', 'Log': 'Napló', 'Tasks': 'Feladatok', 'Data': 'Adatok', 'Map': 'Térkép', '🗺️ Map': '🗺️ Térkép', 'Compute': 'Számítás', 'Views': 'Nézetek', 'Workflow': 'Munkafolyamat',
    // status
    'Active': 'Aktív', 'Paused': 'Szüneteltetve', 'Done': 'Kész', 'Archived': 'Archivált',
    // primary controls / project chrome
    '+ New project': '+ Új projekt', 'Settings': 'Beállítások', '✎ Settings': '✎ Beállítások', 'Save': 'Mentés', 'Cancel': 'Mégse', 'Saving…': 'Mentés…', 'Creating…': 'Létrehozás…', 'Create project': 'Projekt létrehozása', 'Project settings': 'Projekt beállítások', 'New research project': 'Új kutatási projekt', 'Language': 'Nyelv', 'English': 'Angol', 'Magyar': 'Magyar', '‹ Projects': '‹ Projektek', '← All projects': '← Összes projekt',
    // common fields
    'Title': 'Cím', 'Title *': 'Cím *', 'Field': 'Terület', 'Keywords (comma-separated)': 'Kulcsszavak (vesszővel)', 'Goal / expected output': 'Cél / várt eredmény', 'Stage': 'Fázis', 'Status': 'Állapot',
    // main panel headers
    'Library': 'Könyvtár', 'Literature search': 'Irodalomkeresés'
  };
  function tr(lang, en) { return (lang === 'hu' && I18N_HU[en]) ? I18N_HU[en] : en; }

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
    var f = useState({ title: '', field: '', keywords: '', goal: '', language: 'hu' }), form = f[0], setForm = f[1];
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
          goal: form.goal.trim() || null, stage: 0, status: 'active', language: (form.language === 'hu' ? 'hu' : 'en')
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
          h('div', { className: 'field' }, h('label', null, 'Language / Nyelv'),
            h('select', { value: form.language, onChange: function (e) { up('language', e.target.value); }, title: 'The project language: AI-generated content (ideas, reviews, protocol, drafts…) and the core UI are produced in this language. You can still ask for the other language ad hoc.' },
              h('option', { value: 'hu' }, 'Magyar'), h('option', { value: 'en' }, 'English')),
            h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 4 } }, 'Az AI-eredmények és a fő felület ezen a nyelven készülnek. / AI results and the core UI use this language.')),
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
    var f = useState({ title: p.title || '', field: p.field || '', keywords: (p.keywords || []).join(', '), goal: p.goal || '', language: (p.language === 'hu' ? 'hu' : 'en') }), form = f[0], setForm = f[1];
    var lang = form.language;
    var s = useState(false), saving = s[0], setSaving = s[1];
    function up(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!form.title.trim()) return;
      setSaving(true);
      sb.from('research_projects').update({
        title: form.title.trim(), field: form.field.trim() || null,
        keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
        goal: form.goal.trim() || null, language: (form.language === 'hu' ? 'hu' : 'en')
      }).eq('id', p.id).then(function (r) {
        setSaving(false);
        if (r && r.error) { window.PRUI.toast('Could not save: ' + r.error.message, { kind: 'error' }); return; }
        props.onSaved();
      });
    }
    useEffect(function () { function onEsc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', onEsc); return function () { window.removeEventListener('keydown', onEsc); }; });
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Project settings', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, tr(lang, 'Project settings')), h('button', { className: 'x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, tr(lang, 'Title *')), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, tr(lang, 'Language')),
            h('select', { value: form.language, onChange: function (e) { up('language', e.target.value); }, title: 'AI-generated content + core UI language' },
              h('option', { value: 'hu' }, 'Magyar'), h('option', { value: 'en' }, 'English'))),
          h('div', { className: 'field' }, h('label', null, tr(lang, 'Field')), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, tr(lang, 'Keywords (comma-separated)')), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, tr(lang, 'Goal / expected output')), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); } }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, tr(lang, 'Cancel')), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? tr(lang, 'Saving…') : tr(lang, 'Save')))
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
      }, h('span', { className: 'dot', 'aria-hidden': 'true' }, STAGE_ICONS[i] || (i + 1)), tr(props.lang, name)));
      // intermediate "Studies" funnel between Idea and Literature — opens the study tab (NOT a lifecycle stage,
      // so it never changes the stored project.stage / shifts indices)
      if (i === 1) {
        kids.push(h('div', { className: 'step-sep', key: 'sep-study' }));
        kids.push(h('button', {
          key: 'study', className: 'step step-study' + (props.tab === 'study' ? ' cur' : ''),
          title: 'Studies — the literature-screening funnel between an idea and your literature',
          onClick: function () { if (props.onStudy) props.onStudy(); }
        }, h('span', { className: 'dot', 'aria-hidden': 'true' }, svg('M3 4 13 4 9.2 8.8 9.2 12 6.8 13 6.8 8.8Z')), tr(props.lang, 'Studies')));
      }
      // "Rések" — research-gap analysis, after Literature (not a lifecycle stage; never shifts project.stage)
      if (i === 2) {
        kids.push(h('div', { className: 'step-sep', key: 'sep-gap' }));
        kids.push(h('button', {
          key: 'gap', className: 'step step-gap' + (props.tab === 'gap' ? ' cur' : ''),
          title: 'Kutatási rés-elemzés — mit nem fed le a szakirodalom',
          onClick: function () { if (props.onGap) props.onGap(); }
        }, h('span', { className: 'dot', 'aria-hidden': 'true' }, '🕳'), tr(props.lang, 'Rések')));
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
  // ---------- Research-gap taxonomy (migration-83) — shared by GapPanel (+ the Map gap node in P1) ----------
  var GAP_TYPES = [
    { slug: 'evidence', lab: 'Bizonyíték-rés', c: '#2f66d8' },
    { slug: 'knowledge', lab: 'Tudás-rés', c: '#7c5cd6' },
    { slug: 'methodological', lab: 'Módszertani rés', c: '#d1810b' },
    { slug: 'population', lab: 'Populációs/kontextus-rés', c: '#17a34a' },
    { slug: 'theoretical', lab: 'Elméleti rés', c: '#64748b' },
    { slug: 'practical', lab: 'Gyakorlati/cselekvési rés', c: '#0e9aa7' },
    { slug: 'contradictory', lab: 'Ellentmondó-bizonyíték rés', c: '#d6455f' }
  ];
  var GAP_TYPE_MAP = {}; GAP_TYPES.forEach(function (t) { GAP_TYPE_MAP[t.slug] = t; });
  function gapType(slug) { return GAP_TYPE_MAP[slug] || { slug: slug || 'egyeb', lab: 'Egyéb rés', c: '#64748b' }; }

  // ---------- GapPanel — first-class research-gap analysis (a "Rések" sub-tab; migration-83 + edge action='gap_analyze') ----------
  // A gap = a research_ideas row with source='gap' + gap_type/evidence. Self-fetches (graceful column probe) so it does
  // NOT depend on the main idea loaders having the new columns — keeps P0 isolated from the Map/Ideas loaders.
  function GapPanel(props) {
    var gsS = useState(null), gaps = gsS[0], setGaps = gsS[1];   // null = loading
    var tyS = useState(true), typedOk = tyS[0], setTypedOk = tyS[1];   // did the typed-columns select succeed (migration-83 present)?
    var byS = useState(false), busy = byS[0], setBusy = byS[1];
    var pgS = useState(0), prog = pgS[0], setProg = pgS[1];
    var msgS = useState(''), msg = msgS[0], setMsg = msgS[1];
    var ofS = useState({}), off = ofS[0], setOff = ofS[1];   // legend type-filter
    var gvS = useState('lista'), view = gvS[0], setView = gvS[1];   // P3: Lista | Mátrix (evidence-gap map)
    var mxS = useState(null), matrix = mxS[0], setMatrix = mxS[1];   // null=not loaded; {rows,cols,cells}; 'error'; 'none' (too few sources)
    var mbS = useState(false), mxBusy = mbS[0], setMxBusy = mbS[1];
    var aliveR = useRef(true);
    var promotingRef = useRef({});   // synchronous in-flight guard (gap id → 1) so a same-tick double-click can't double-insert
    var cellBusyRef = useRef(false);   // in-flight guard for "create gap from matrix cell" (the matrix stays mounted until insert resolves)
    useEffect(function () { aliveR.current = true; return function () { aliveR.current = false; }; }, []);
    useEffect(function () { loadGaps(); }, [props.projectId]);
    function loadGaps() {
      var pid = props.projectId;
      sb.from('research_ideas').select('id,question,hypothesis,rationale,novelty,status,source,gap_type,evidence,addressed_by_idea_id').eq('project_id', pid).eq('source', 'gap').neq('status', 'rejected').order('novelty', { ascending: false, nullsFirst: false }).then(function (r) {
        if (!aliveR.current) return;
        if (r && r.error) {
          // Only treat an actual SCHEMA/column error (migration-83 not applied) as "degraded" + refetch base columns.
          // A transient network/server error must NOT falsely assert the schema is missing (wrong degrade banner).
          var e = r.error, sig = (e.message || '') + ' ' + (e.code || '');
          if (/column|42703|pgrst204|does not exist|schema cache/i.test(sig)) {
            setTypedOk(false);
            sb.from('research_ideas').select('id,question,hypothesis,rationale,novelty,status,source').eq('project_id', pid).eq('source', 'gap').neq('status', 'rejected').order('novelty', { ascending: false, nullsFirst: false }).then(function (r2) { if (aliveR.current) setGaps((r2 && r2.data) || []); }, function () { if (aliveR.current) setGaps([]); });
          } else { setGaps([]); }   // transient → empty (retry via Elemezd), typedOk unchanged
          return;
        }
        setTypedOk(true); setGaps((r && r.data) || []);
      }, function () { if (aliveR.current) setGaps([]); });
    }
    function analyze() {
      if (busy) return;
      setBusy(true); setMsg(''); setProg(0);
      var iv = setInterval(function () { if (aliveR.current) setProg(function (x) { return Math.min(94, x + 8); }); }, 420);
      sb.functions.invoke('research-ai', { body: { action: 'gap_analyze', project_id: props.projectId } }).then(function (res) {
        clearInterval(iv); if (!aliveR.current) return; setBusy(false); setProg(100);
        var d = res && res.data;
        if ((res && res.error) || (d && d.error)) { setMsg('A rés-elemzéshez telepítsd a research-ai edge-et (gap_analyze) és futtasd a migration-83-at. Addig a lista a meglévő gap-ötleteket mutatja.'); loadGaps(); return; }
        setMatrix(null);   // a fresh run invalidates the cached evidence-gap matrix
        if (d && d.ideas && d.ideas.length) placeGapsInNewFrame(d.ideas);   // group this run into a rose "rés-fészek" frame on the Map (P1.5)
        loadGaps(); if (props.onChanged) props.onChanged();
      }, function () { clearInterval(iv); if (!aliveR.current) return; setBusy(false); setMsg('Hálózati hiba — próbáld újra.'); });
    }
    function toIdea(g) {   // promote: create a NEW idea from the gap + link it (addressed_by_idea_id) → keep the gap as "Előléptetve" (feeds the Map gap→idea edge)
      if (g.addressed_by_idea_id || promotingRef.current[g.id]) return;   // already promoted OR a promote is in flight (blocks same-tick double-click)
      promotingRef.current[g.id] = 1;
      function clearFlag() { delete promotingRef.current[g.id]; }
      sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', status: 'candidate', question: g.hypothesis || g.question, rationale: g.rationale || null, created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
        if (!aliveR.current) { clearFlag(); return; }
        if ((r && r.error) || !(r && r.data)) { clearFlag(); window.PRUI.toast('Nem sikerült: ' + ((r && r.error && r.error.message) || 'ismeretlen hiba'), { kind: 'error' }); return; }
        var newId = r.data.id;
        sb.from('research_ideas').update({ addressed_by_idea_id: newId }).eq('id', g.id).then(function (u) {
          clearFlag(); if (!aliveR.current) return;
          if (u && u.error) { setGaps(function (L) { return (L || []).filter(function (x) { return x.id !== g.id; }); }); }   // addressed_by column missing → can't persist the link; just move on
          else { setGaps(function (L) { return (L || []).map(function (x) { return x.id === g.id ? Object.assign({}, x, { addressed_by_idea_id: newId }) : x; }); }); }   // mark promoted, keep in list
          window.PRUI.toast('✓ Ötlet létrehozva a résből — az Ötletek fülön', { kind: 'success' });
          if (props.onChanged) props.onChanged();
        }, function () { clearFlag(); if (aliveR.current) { window.PRUI.toast('Az ötlet létrejött, a link mentése nem sikerült', { kind: 'error' }); if (props.onChanged) props.onChanged(); } });
      }, function () { clearFlag(); if (aliveR.current) window.PRUI.toast('Hálózati hiba', { kind: 'error' }); });
    }
    function dismiss(g) {
      sb.from('research_ideas').update({ status: 'rejected' }).eq('id', g.id).then(function (r) {
        if (!aliveR.current) return;
        if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        setGaps(function (L) { return (L || []).filter(function (x) { return x.id !== g.id; }); });
        if (props.onChanged) props.onChanged();
      }, function () { if (aliveR.current) window.PRUI.toast('Hálózati hiba', { kind: 'error' }); });
    }
    function toggleType(slug) { setOff(function (o) { var n = Object.assign({}, o); if (n[slug]) delete n[slug]; else n[slug] = 1; return n; }); }
    // P3 — evidence-gap matrix (EGM): fetched on demand from the edge; empty cells = gaps. Graceful if the edge lacks gap_matrix.
    function fetchMatrix() {
      if (mxBusy) return;
      setMxBusy(true);
      sb.functions.invoke('research-ai', { body: { action: 'gap_matrix', project_id: props.projectId } }).then(function (res) {
        if (!aliveR.current) return; setMxBusy(false);
        var d = res && res.data;
        if ((res && res.error) || !d || d.error) { setMatrix('error'); return; }
        if (!d.matrix || !Array.isArray(d.matrix.rows) || !Array.isArray(d.matrix.cols)) { setMatrix(d.reason === 'too_few' ? 'none' : 'error'); return; }
        setMatrix(d.matrix);
      }, function () { if (aliveR.current) { setMxBusy(false); setMatrix('error'); } });
    }
    function showMatrix() { setView('matrix'); if (matrix === null && !mxBusy) fetchMatrix(); }
    // P1.5/P4.2 — group a gap-analysis run into a rose "rés-fészek" frame on the Map, placed BELOW any existing frames
    // (no overlap). frames + layout have realtime → appears live.
    function placeGapsInNewFrame(gaps) {
      if (!gaps || !gaps.length) return;
      var NW = 204, NH = 74, pad = 16, hdr = 44, gp = 16;
      var cols = Math.min(3, gaps.length), rws = Math.ceil(gaps.length / cols);
      var fw = Math.round(2 * pad + cols * NW + (cols - 1) * gp), fh = Math.round(hdr + 2 * pad + rws * NH + (rws - 1) * gp);
      function doPlace(ox, oy) {
        var dt = new Date().toISOString().slice(0, 10);
        sb.from('research_map_frames').insert({ project_id: props.projectId, title: '🕳️ Rés-elemzés · ' + dt, x: ox, y: oy, w: fw, h: fh, color: 'rose' });
        var rows = gaps.map(function (g, i) { return { project_id: props.projectId, node_id: 'i' + g.id, x: Math.round(ox + pad + (i % cols) * (NW + gp)), y: Math.round(oy + hdr + Math.floor(i / cols) * (NH + gp)), updated_at: new Date().toISOString() }; });
        sb.from('research_map_layout').upsert(rows, { onConflict: 'project_id,node_id' });
      }
      sb.from('research_map_frames').select('y,h').eq('project_id', props.projectId).then(function (fr) {
        if (!aliveR.current) return;
        var fs = (fr && fr.data) || [], maxB = 0; fs.forEach(function (f) { var b = (f.y || 0) + (f.h || 0); if (b > maxB) maxB = b; });
        doPlace(40, fs.length ? maxB + 28 : 40);
      }, function () { if (aliveR.current) doPlace(40, 40); });
    }
    // P4.1 — turn an empty (0) matrix cell into a concrete gap the user can then refine/promote.
    function createGapFromCell(row, col) {
      if (!props.canEdit || cellBusyRef.current) return;
      cellBusyRef.current = true;
      var q = String(row) + ' × ' + String(col) + ' — feltáratlan terület: a szakirodalom nem fedi le ezt a metszetet.';
      sb.from('research_ideas').insert({ project_id: props.projectId, source: 'gap', status: 'candidate', question: q, gap_type: 'population', evidence: [] }).select('id').maybeSingle().then(function (r) {
        cellBusyRef.current = false; if (!aliveR.current) return;
        if (r && r.error) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        window.PRUI.toast('✓ Rés létrehozva a(z) „' + String(row) + ' × ' + String(col) + '" cellából', { kind: 'success' });
        setView('lista'); loadGaps(); if (props.onChanged) props.onChanged();
      }, function () { cellBusyRef.current = false; if (aliveR.current) window.PRUI.toast('Hálózati hiba', { kind: 'error' }); });
    }

    function gapMatrixEl() {
      if (mxBusy || matrix === null) return h('div', { className: 'gp-empty' }, '⏳ Bizonyíték-rés-mátrix számítása…');
      if (matrix === 'none') return h('div', { className: 'gp-empty', style: { fontSize: 13 } }, 'Túl kevés forrás a megbízható rés-térképhez — bővítsd a Könyvtárat.');
      if (matrix === 'error') return h('div', { className: 'gp-empty' }, h('div', { style: { fontSize: 13, marginBottom: 10 } }, 'A mátrix nem érhető el — telepítsd a research-ai edge-et (gap_matrix támogatás).'), h('button', { className: 'gp-rebtn', onClick: fetchMatrix }, '↻ Újra'));
      var mcols = matrix.cols || [], mrows = matrix.rows || [], cells = matrix.cells || [], maxN = 1;
      cells.forEach(function (row) { (row || []).forEach(function (n) { if (n > maxN) maxN = n; }); });
      return h('div', { className: 'gp-egm' },
        h('table', { className: 'egm' }, h('tbody', null,
          h('tr', null, h('th', null, ''), mcols.map(function (c, ci) { return h('th', { key: ci }, String(c)); })),
          mrows.map(function (rlab, ri) {
            return h('tr', { key: ri }, h('th', { className: 'rowh' }, String(rlab)),
              mcols.map(function (c, ci) {
                var n = (cells[ri] && cells[ri][ci] != null) ? cells[ri][ci] : 0, isGap = !n, clickable = isGap && props.canEdit;
                return h('td', { key: ci }, h('div', { className: 'egm-cell' + (isGap ? ' gapcell' : '') + (clickable ? ' clk' : ''), style: isGap ? null : { background: 'color-mix(in srgb, var(--accent) ' + Math.round((0.12 + (n / maxN) * 0.5) * 100) + '%, transparent)', color: (n / maxN > 0.6 ? '#fff' : 'var(--ink)') }, title: isGap ? (clickable ? 'Kattints: rés létrehozása ehhez a cellához (' + String(rlab) + ' × ' + String(c) + ')' : 'RÉS — 0 forrás fedi le') : (n + ' forrás'), onClick: clickable ? function () { createGapFromCell(rlab, c); } : null }, isGap && clickable ? '＋' : String(n)));
              }));
          }))),
        h('div', { className: 'egm-note' }, 'Az üres (0) cellák a kutatási rések — ahol a szakirodalom nem fed le egy módszer×domén kombinációt.'));
    }

    if (gaps === null) return h('div', { className: 'panel gappanel' }, h('div', { className: 'gp-empty' }, '⏳ Rések betöltése…'));
    if (!gaps.length) {
      return h('div', { className: 'panel gappanel' },
        msg ? h('div', { className: 'gp-degrade' }, msg) : null,
        h('div', { className: 'gp-empty gp-firstrun' },
          h('div', { style: { fontSize: 36 } }, '🕳️'),
          h('b', null, 'Kutatási rés-elemzés'),
          h('p', null, 'Az AI átnézi a Könyvtárat, a szisztematikus áttekintést és a projekt célját, és megkeresi, mit nem fed le a szakirodalom — típus, bizonyíték és következő lépés szerint.'),
          props.canEdit ? h('button', { className: 'gp-bigbtn', disabled: busy, onClick: analyze }, busy ? ('✨ AI elemez… ' + prog + '%') : '✨ Elemezd a kutatási réseket') : h('div', { className: 'muted', style: { fontSize: 13 } }, 'Még nincs feltárt kutatási rés.')));
    }
    var present = {}; gaps.forEach(function (g) { present[g.gap_type || 'knowledge'] = 1; });
    var list = gaps.filter(function (g) { return !off[g.gap_type || 'knowledge']; });
    return h('div', { className: 'panel gappanel' },
      h('div', { className: 'gp-head' },
        h('h3', null, '🕳️ Kutatási rések ', h('span', { className: 'gp-cnt' }, '· ' + gaps.length)),
        h('span', { className: 'gp-viewtog' },
          h('button', { className: view === 'lista' ? 'on' : '', onClick: function () { setView('lista'); } }, 'Lista'),
          h('button', { className: view === 'matrix' ? 'on' : '', onClick: showMatrix }, 'Mátrix')),
        props.canEdit ? h('button', { className: 'gp-rebtn', disabled: busy, onClick: analyze }, busy ? ('AI elemez… ' + prog + '%') : '↻ Újraelemzés') : null),
      (typedOk === false) ? h('div', { className: 'gp-degrade' }, 'Degradált mód: futtasd a migration-83-at + deploy-old a research-ai edge-et a tipizált résekhez (típus, bizonyíték). Most a meglévő gap-ötletek jelennek meg.') : null,
      msg ? h('div', { className: 'gp-degrade' }, msg) : null,
      view === 'matrix' ? gapMatrixEl() : h('div', { className: 'gp-listwrap' },
      h('div', { className: 'gp-legend' }, GAP_TYPES.filter(function (t) { return present[t.slug]; }).map(function (t) {
        return h('button', { key: t.slug, className: 'gp-lchip' + (off[t.slug] ? ' off' : ''), style: { borderColor: t.c, color: t.c }, onClick: function () { toggleType(t.slug); } }, t.lab);
      })),
      h('div', { className: 'gp-list' }, list.map(function (g) {
        var t = gapType(g.gap_type || 'knowledge'), ev = Array.isArray(g.evidence) ? g.evidence : [], promoted = !!g.addressed_by_idea_id;
        return h('div', { className: 'gcard', key: g.id, style: { borderLeftColor: t.c } },
          h('div', { className: 'gcard-top' },
            h('span', { className: 'gbadge', style: { background: t.c } }, t.lab),
            g.novelty != null ? h('span', { className: 'gnov' }, 'Újdonság ', h('span', { className: 'gnov-bar' }, h('i', { style: { width: g.novelty + '%' } })), ' ' + g.novelty) : null),
          h('div', { className: 'gstmt' }, g.question),
          g.rationale ? h('div', { className: 'gwhy' }, h('b', null, 'Miért rés? '), g.rationale) : null,
          ev.length ? h('div', { className: 'gev' }, h('b', null, 'Bizonyíték: '), ev.map(function (e, i) { return h('span', { className: 'gsrc', key: i, title: e.coverage || '' }, String(e.title || 'forrás').slice(0, 44)); })) : null,
          g.hypothesis ? h('div', { className: 'gev' }, h('b', null, 'Következő lépés: '), g.hypothesis) : null,
          h('div', { className: 'gacts' },
            props.canEdit ? h('button', { className: 'gact pri', disabled: promoted, onClick: function () { toIdea(g); } }, promoted ? '✓ Ötlet létrehozva' : '→ Ötletté alakítás') : null,
            props.canEdit ? h('button', { className: 'gact', title: 'Ugrás a Tanulmányok fülre', onClick: function () { if (props.onGoStudy) props.onGoStudy(); } }, '🔍 Study indítása') : null,
            props.canEdit ? h('button', { className: 'gact', onClick: function () { dismiss(g); } }, '✕ Elvetés') : null,
            h('span', { className: 'gstatus' + (promoted ? ' promoted' : '') }, h('span', { className: 'gdot' }), promoted ? 'Előléptetve' : 'Nyitott')));
      }))));
  }

  function IdeasPanel(props) {
    var f = useState({ question: '', hypothesis: '' }), form = f[0], setForm = f[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    var m = useState(''), msg = m[0], setMsg = m[1];
    var exS = useState({}), expanded = exS[0], setExpanded = exS[1];   // #10: per-idea open/closed
    var rbS = useState({}), runsByIdea = rbS[0], setRunsByIdea = rbS[1];   // idea_id → [{kind:'study'|'review', id, title, status}] : has a run been started FROM this idea?
    var vwS = useState(null), viewer = vwS[0], setViewer = vwS[1];         // {title, body} — an opened run result (markdown), or {title, body:'⏳…'} while loading
    var rlS = useState(null), runList = rlS[0], setRunList = rlS[1];       // {ideaQ, runs} — a picker when an idea has several runs
    var aliveR = useRef(true);
    useEffect(function () { aliveR.current = true; return function () { aliveR.current = false; }; }, []);
    var rtS = useState(0), setRunTick = rtS[1];   // cheap re-render on every runner progress so the pulse reflects running↔done
    var rkS = useState(''), reloadKey = rkS[0], setReloadKey = rkS[1];   // reload the idea→runs map ONLY when the running-set changes
    var pidRef = useRef(props.projectId); pidRef.current = props.projectId;
    useEffect(function () {
      return PRStudyRunner.subscribe(function () {
        if (!aliveR.current) return;
        setRunTick(function (x) { return x + 1; });
        // Only the runs' SET/terminal-state (not their per-step progress) changes what runsByIdea shows, so build a
        // signature of this project's studies + whether each is terminal and reload the 3-query map only when it changes.
        var pid = pidRef.current, all = PRStudyRunner.runs(), sig = [];
        for (var k in all) { var r = all[k]; if (r.projectId === pid && r.sid) sig.push(r.sid + ':' + ((r.stage === 'done' || r.stage === 'error') ? '1' : '0')); }
        sig.sort(); setReloadKey(sig.join('|'));
      });
    }, []);
    // load which ideas already have a run (a Study created from the idea, or an SR review launched from a candidate of the idea)
    useEffect(function () {
      var pid = props.projectId;
      Promise.all([
        sb.from('research_studies').select('id,idea_id,title,status').eq('project_id', pid).not('idea_id', 'is', null),
        sb.from('research_sr_candidates').select('idea_id,question,launched_job_id').eq('project_id', pid).not('launched_job_id', 'is', null),
        sb.from('elicit_jobs').select('id,status,result_title,research_question').eq('project_id', pid).eq('kind', 'sysreview')
      ]).then(function (r) {
        if (!aliveR.current) return;
        var studies = (r[0] && r[0].data) || [], cands = (r[1] && r[1].data) || [], jobs = (r[2] && r[2].data) || [];
        var jobById = {}; jobs.forEach(function (j) { jobById[j.id] = j; });
        var map = {};
        studies.forEach(function (s) { if (s.idea_id) (map[s.idea_id] = map[s.idea_id] || []).push({ kind: 'study', id: s.id, title: s.title || 'Irodalom-study', status: s.status }); });
        cands.forEach(function (c) { var j = c.launched_job_id && jobById[c.launched_job_id]; if (c.idea_id && j) (map[c.idea_id] = map[c.idea_id] || []).push({ kind: 'review', id: j.id, title: j.result_title || c.question || 'Szisztematikus áttekintés', status: j.status }); });
        setRunsByIdea(map);
      }, function () { if (aliveR.current) setRunsByIdea({}); });   // network reject → no badges (never throw)
    }, [props.projectId, (props.ideas || []).length, reloadKey]);
    function toggle(id) { setExpanded(function (e) { var n = Object.assign({}, e); n[id] = e[id] === false ? true : false; return n; }); }
    // open a run's result (the review markdown) in the viewer modal
    function openRun(run, ideaId) {
      var setBody = function (body, title) { if (aliveR.current) setViewer({ title: title || run.title, body: body, run: run, ideaId: ideaId }); };
      setBody('⏳ Betöltés…');
      if (run.kind === 'review') {
        sb.from('elicit_jobs').select('result_title,result_body').eq('id', run.id).maybeSingle().then(function (r) { var j = r && r.data; setBody((j && j.result_body) || '_A szisztematikus áttekintés még fut, vagy nincs kész riport — a részletek a Study fülön._', (j && j.result_title) || run.title); }, function () { setBody('_Nem sikerült betölteni az eredményt._'); });
      } else {
        var sid8 = String(run.id).replace(/-/g, '').slice(0, 8);
        sb.from('research_files').select('content').eq('project_id', props.projectId).like('path', 'studies/%-' + sid8 + '-review.md').order('updated_at', { ascending: false }).limit(1).then(function (r) { var f = r && r.data && r.data[0]; setBody((f && f.content) || '_Ehhez a study-hoz még nincs áttekintés (pl. nem volt full-text included cikk). A szűrési részletek a Study fülön: „Keyword screening funnel"._'); }, function () { setBody('_Nem sikerült betölteni az eredményt._'); });
      }
    }
    function openIdeaRuns(idea) { var runs = runsByIdea[idea.id] || []; if (!runs.length) return; if (runs.length === 1) openRun(runs[0], idea.id); else setRunList({ ideaId: idea.id, ideaQ: idea.question, runs: runs }); }
    // delete a run FROM an idea — a Study (research_studies, cascades steps/papers) or an SR review (elicit_jobs, owner-only by RLS)
    function delRun(run, ideaId) {
      window.PRUI.confirm({ title: (run.kind === 'review' ? 'Áttekintés' : 'Study') + ' törlése?', body: (run.title || '') + ' — véglegesen törlődik.', confirmLabel: 'Törlés', danger: true }).then(function (ok) {
        if (!ok) return;
        (run.kind === 'review'
          ? sb.from('research_sr_candidates').update({ launched_job_id: null }).eq('launched_job_id', run.id).then(function () { return sb.from('elicit_jobs').delete().eq('id', run.id); })
          : sb.from('research_studies').delete().eq('id', run.id)
        ).then(function (r) {
          if (!aliveR.current) return;
          if (r && r.error) { window.PRUI.toast('Törlés sikertelen: ' + r.error.message, { kind: 'error' }); return; }
          setRunsByIdea(function (m) { var n = Object.assign({}, m); if (ideaId && n[ideaId]) { n[ideaId] = n[ideaId].filter(function (x) { return !(x.kind === run.kind && x.id === run.id); }); if (!n[ideaId].length) delete n[ideaId]; } return n; });
          setRunList(function (rl) { if (!rl) return rl; var rs = rl.runs.filter(function (x) { return !(x.kind === run.kind && x.id === run.id); }); return rs.length ? Object.assign({}, rl, { runs: rs }) : null; });
          setViewer(function (v) { return (v && v.run && v.run.kind === run.kind && v.run.id === run.id) ? null : v; });
          if (props.onChanged) props.onChanged();
        }, function () { if (aliveR.current) window.PRUI.toast('Törlés sikertelen (hálózat)', { kind: 'error' }); });
      });
    }
    function runBadge(idea) {   // chip on an idea card when a run exists → click to open its result; pulses while a study is being worked on
      var runs = runsByIdea[idea.id] || []; if (!runs.length) return null;
      var running = runs.some(function (r) { return r.kind === 'study' && PRStudyRunner.isStudyRunning(r.id); });
      var done = runs.some(function (r) { return r.status === 'done' || r.status === 'completed'; });
      return h('button', { className: 'idb-run' + (done && !running ? ' done' : '') + (running ? ' pulse-run' : ''), title: running ? 'Kidolgozás alatt — kattints a részletekért' : 'Futtatás eredményének megnyitása', onClick: function (e) { e.stopPropagation(); openIdeaRuns(idea); } }, (running ? '⏳ Kidolgozás alatt · ' : done ? '✓ ' : '▶ ') + runs.length + ' futtatás');
    }
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
      // route to the dedicated "🕳️ Rések" tab (typed, evidence-grounded gaps) instead of silently inserting untyped
      // gap ideas here — one source of truth. (Falls back to the inline gap analysis if the host didn't wire onGoGap.)
      if (props.onGoGap) { props.onGoGap(); return; }
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
            props.canEdit ? h('button', { className: 'idb-gap', disabled: busy, onClick: gap, title: 'Kutatási rés-elemzés (Rések fül)' }, '✨ Rés-elemzés →') : null),
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
                h('div', { className: 'idb-meta' }, srcLabel(idea.source), idea.novelty != null ? ' · novelty ' + idea.novelty : '', rej ? h('span', { className: 'idb-rejtag' }, ' · rejected') : '', runBadge(idea)),
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
                  idea.hypothesis ? h('div', { className: 'idb-bh' }, idea.hypothesis) : null,
                  (runsByIdea[idea.id] || []).length ? h('div', { style: { marginTop: 4 } }, runBadge(idea)) : null),
                props.canEdit ? h('button', { className: 'del', 'aria-label': 'Remove from basis', title: 'Remove from basis', onClick: function () { setStatus(idea, 'candidate'); } }, '✕') : null
              );
            })),
            props.onStartStudyMulti ? h('button', { className: 'idb-cta', onClick: function () { props.onStartStudyMulti(selected); } }, '🔬 Start a study from these ideas →') : null
          ) : h('div', { className: 'idb-bempty' }, 'Press “Select” on a shortlisted idea — it becomes the study basis.')
        ),
        runList ? h('div', { className: 'scrim', onClick: function () { setRunList(null); } }, h('div', { className: 'modal', style: { width: 460 }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'modal-h' }, h('b', null, 'Futtatások ehhez az ötlethez'), h('button', { className: 'x', 'aria-label': 'Close', onClick: function () { setRunList(null); } }, '×')),
          h('div', { className: 'modal-b' },
            h('div', { style: { fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.4 } }, runList.ideaQ),
            runList.runs.map(function (run, i) {
              return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i ? '1px solid var(--line)' : 'none' } },
                h('span', { style: { fontSize: 15, flex: 'none' } }, run.kind === 'review' ? '🔬' : '🔎'),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, run.title),
                  h('div', { style: { fontSize: 11, color: 'var(--muted)' } }, (run.kind === 'review' ? 'Szisztematikus áttekintés' : 'Irodalom-study') + ' · ' + (run.status || '—'))),
                h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 10px', flex: 'none' }, onClick: function () { setRunList(null); openRun(run, runList.ideaId); } }, 'Megnyitás'),
                props.canEdit ? h('button', { className: 'btn', style: { fontSize: 12, padding: '4px 8px', flex: 'none', color: 'var(--danger, #b42318)' }, title: 'Törlés', onClick: function () { delRun(run, runList.ideaId); } }, '🗑') : null);
            })))) : null,
        viewer ? h('div', { className: 'scrim', onClick: function () { setViewer(null); } }, h('div', { className: 'modal', style: { width: 780 }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'modal-h' }, h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, viewer.title || 'Eredmény'), (viewer.run && props.canEdit) ? h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 12, flex: 'none', color: 'var(--danger, #b42318)', marginRight: 6 }, title: 'A futtatás törlése', onClick: function () { delRun(viewer.run, viewer.ideaId); } }, '🗑 Törlés') : null, h('button', { className: 'x', 'aria-label': 'Close', onClick: function () { setViewer(null); } }, '×')),
          (window.marked && window.DOMPurify)
            ? h('div', { className: 'md-report', style: { padding: 18, maxHeight: '72vh', overflow: 'auto', lineHeight: 1.6, fontSize: 13.5 }, dangerouslySetInnerHTML: { __html: enhanceReport(viewer.body || '') } })
            : h('div', { style: { padding: 18, maxHeight: '72vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 } }, viewer.body || ''))) : null
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
      h('h3', null, 'Research ideas', props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: busy, onClick: gap }, '✨ Rés-elemzés →') : null),
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
    var soS = useState({}), studyOrigin = soS[0], setStudyOrigin = soS[1];   // source_id -> [{id,title}] : which study RUN(s) the source came from (any step/decision)
    useEffect(function () {
      var ids = (props.studies || []).map(function (s) { return s.id; });
      if (!ids.length) { setStudyInc({}); setStudyOrigin({}); return; }
      var titleById = {}; (props.studies || []).forEach(function (s) { titleById[s.id] = s.title || 'Untitled study'; });
      sb.from('research_study_papers').select('source_id,study_id,decision,overridden').in('study_id', ids).then(function (r2) {
        var m = {}, orig = {};
        ((r2 && r2.data) || []).forEach(function (p) {
          if (!p.source_id) return;
          var t = titleById[p.study_id] || 'Study';
          // origin: the source was fetched / screened by this study run (ANY step/decision), so it "came from" it
          if (!orig[p.source_id]) orig[p.source_id] = [];
          if (!orig[p.source_id].some(function (x) { return x.id === p.study_id; })) orig[p.source_id].push({ id: p.study_id, title: t });
          // included highlight (only AI-included or a human keep-override) — unchanged, drives the ★ + top-sort
          if (!(p.decision === 'include' || (p.overridden && p.decision !== 'exclude'))) return;
          if (!m[p.source_id]) m[p.source_id] = [];
          if (m[p.source_id].indexOf(t) < 0) m[p.source_id].push(t);
        });
        setStudyInc(m); setStudyOrigin(orig);
      }, function () { });
    }, [(props.studies || []).map(function (s) { return s.id + ':' + (s.title || ''); }).join('|'), (props.sources || []).length]);
    // ---- Background figure extraction (PRFigureRunner): keeps running across SPA tab/view switches; the Figure Board
    //      button pulses yellow while it runs and turns green when done; realtime progress shows the current paper. ----
    var frS = useState(0), setFigTick = frS[1];
    var fexS = useState({}), figExtracted = fexS[0], setFigExtracted = fexS[1];   // source_id -> true (already has figures → skip)
    var frAlive = useRef(true);
    useEffect(function () { frAlive.current = true; return function () { frAlive.current = false; }; }, []);
    useEffect(function () { return PRFigureRunner.subscribe(function () { if (frAlive.current) setFigTick(function (x) { return x + 1; }); }); }, []);
    function loadFigExtracted() {
      sb.from('research_figures').select('source_id').eq('project_id', props.projectId).then(function (r) {
        if (!frAlive.current) return;
        var m = {}; ((r && r.data) || []).forEach(function (x) { if (x.source_id) m[x.source_id] = true; });
        // also skip papers already ATTEMPTED with no result (migration-64 fig_status). Degrades gracefully if the
        // column is absent (the query errors → we just fall back to the has-figures set).
        sb.from('research_sources').select('id,fig_status').eq('project_id', props.projectId).not('fig_status', 'is', null).then(function (r2) {
          if (!frAlive.current) return;
          if (r2 && !r2.error) (r2.data || []).forEach(function (x) { if (x.id && (x.fig_status === 'ok' || x.fig_status === 'no_oa' || x.fig_status === 'no_figs')) m[x.id] = true; });
          setFigExtracted(m);
        }, function () { if (frAlive.current) setFigExtracted(m); });
      }, function () { });
    }
    useEffect(function () { loadFigExtracted(); }, [props.projectId, (props.sources || []).length]);
    function startFigExtract() {
      var todo = (props.sources || []).filter(function (s) { return s.doi && !figExtracted[s.id]; });
      if (!todo.length) { if (window.PRUI && window.PRUI.toast) window.PRUI.toast('Minden DOI-val rendelkező cikkből már kinyertük az ábrákat.', {}); return; }
      // callback fires per finished paper + at the end → refresh which sources are extracted (updates the button/count live)
      PRFigureRunner.start(props.projectId, todo, function () { loadFigExtracted(); });
    }
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
              h('th', { className: 'rv-th' }, 'Study'),
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
                (function () {
                  var o = studyOrigin[s.id] || [];
                  if (!o.length) return h('td', { className: 'rv-ve', style: { color: 'var(--faint)' } }, '—');   // manually added / not from a study run
                  var first = o[0].title || 'Study';
                  return h('td', { className: 'rv-ve', title: 'Ebből a study-futtatásból származik: ' + o.map(function (x) { return x.title; }).join(' · ') },
                    h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5 } }, '🔎 ' + (first.length > 26 ? first.slice(0, 26) + '…' : first) + (o.length > 1 ? ' +' + (o.length - 1) : '')));
                })(),
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
          lib.length ? (function () {
            var fr = PRFigureRunner.status(props.projectId), running = PRFigureRunner.isRunning(props.projectId), doneRun = !!(fr && fr.stage === 'done');
            return h('a', { className: 'btn' + (running ? ' pulse-run' : (doneRun ? ' fig-done' : '')), style: { padding: '4px 10px', fontSize: 12, textDecoration: 'none' }, href: 'FigureBoard.html?project=' + encodeURIComponent(props.projectId), title: running ? ('Ábra-kinyerés fut a háttérben — ' + (fr.done || 0) + '/' + (fr.total || 0)) : 'Extract figures from these papers onto an infinite canvas' },
              running ? ('⏳ Figure Board · ' + (fr.done || 0) + '/' + (fr.total || 0)) : (doneRun ? '✓ Figure Board' : '🖼 Figure Board'));
          })() : null,
          (lib.length && props.canEdit) ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: PRFigureRunner.isRunning(props.projectId), title: 'Ábrák kinyerése a háttérben — fut tovább, amíg az appot használod (teljes újratöltés állítja csak le, onnan folytatható)', onClick: startFigExtract }, PRFigureRunner.isRunning(props.projectId) ? '⏳ Kinyerés…' : '✨ Ábrák kinyerése (háttér)') : null,
          lib.length ? h('a', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, textDecoration: 'none' }, href: 'CitationOptimizer.html?project=' + encodeURIComponent(props.projectId), title: 'Analyze what your top-cited included papers are cited FOR' }, '🔗 Citation Optimizer') : null,
          lib.length ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Export included (or all) as BibTeX', onClick: function () { var inc = lib.filter(function (x) { return x.screening === 'include'; }); downloadText('library.bib', genBibtex(inc.length ? inc : lib)); } }, '⬇ BibTeX') : null
        )),
        (function () {   // realtime figure-extraction progress (background runner) — survives tab/view switches
          var fr = PRFigureRunner.status(props.projectId); if (!fr) return null;
          var running = fr.stage === 'running', err = fr.stage === 'error';
          return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 10px', padding: '7px 11px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid ' + (running ? 'rgba(234,179,8,.5)' : err ? 'var(--danger,#b42318)' : 'rgba(22,163,74,.4)') } },
            h('span', { style: { minWidth: 0, flex: 1, fontSize: 12, color: running ? '#a16207' : err ? 'var(--danger,#b42318)' : 'var(--ok,#15803d)' } },
              running ? ('🖼 Ábra-kinyerés a háttérben — ' + (fr.done || 0) + '/' + (fr.total || 0) + (fr.curTitle ? ' · ' + String(fr.curTitle).slice(0, 46) : '') + (fr.msg ? ' — ' + fr.msg : '')) : (err ? ('✗ ' + (fr.msg || 'Hiba')) : ('✓ ' + (fr.msg || 'Kész')))),
            running ? h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11, flex: 'none' }, onClick: function () { PRFigureRunner.cancel(props.projectId); }, title: 'Kinyerés leállítása' }, 'Leállítás')
              : h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11, flex: 'none' }, onClick: function () { PRFigureRunner.dismiss(props.projectId); setFigTick(function (x) { return x + 1; }); } }, '✕'));
        })(),
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
    var sgS = useState([]), suggestions = sgS[0], setSuggestions = sgS[1];   // draft suggestions (migration-76)
    var sgcS = useState(false), suggestCap = sgcS[0], setSuggestCap = sgcS[1];   // migration-76 capability
    var sgfS = useState(null), suggestFor = sgfS[0], setSuggestFor = sgfS[1];   // section index whose suggest composer is open
    var sgtS = useState(''), suggestText = sgtS[0], setSuggestText = sgtS[1];
    var sgnS = useState(''), suggestNote = sgnS[0], setSuggestNote = sgnS[1];
    var wAlive = useRef(true); useEffect(function () { wAlive.current = true; return function () { wAlive.current = false; }; }, []);
    // Phase 5: live collaborative section editing (Supabase-native, no CRDT dependency)
    var edSecS = useState(null), editSec = edSecS[0], setEditSec = edSecS[1];   // section key currently open in MY inline editor
    var edTxtS = useState(''), editTxt = edTxtS[0], setEditTxt = edTxtS[1];     // my in-progress section text
    var lockS = useState({}), secLocks = lockS[0], setSecLocks = lockS[1];      // {section_key: {name, id, ts}} — who else is editing which section
    var dChRef = useRef(null);   // the draft realtime channel
    var edOrig = useRef('');   // the section's content when editing started (for Cancel revert)
    var edSecRef = useRef(null); useEffect(function () { edSecRef.current = editSec; }, [editSec]);
    var busy = phase === 'outline' || phase === 'sections' || phase === 'assemble';
    function loadSuggestions(did) {
      if (!did) return;
      sb.from('research_draft_suggestions').select('id,draft_id,section_key,section_heading,original,suggested,note,author,status,created_at').eq('draft_id', did).order('created_at', { ascending: false }).then(function (r) {
        if (!wAlive.current) return; if (r && r.error) { setSuggestCap(false); return; } setSuggestCap(true); setSuggestions((r && r.data) || []);
      });
    }
    useEffect(function () { if (draft && draft.id) loadSuggestions(draft.id); }, [draft && draft.id]);
    function submitSuggestion(sec) {
      var txt = String(suggestText || '').trim(); if (!txt || !draft || !draft.id) return;
      sb.from('research_draft_suggestions').insert({ project_id: pid, draft_id: draft.id, section_key: sec.key, section_heading: sec.heading || sec.key, original: sec.latex || '', suggested: txt, note: String(suggestNote || '').trim() || null, status: 'pending' }).select('id,draft_id,section_key,section_heading,original,suggested,note,author,status,created_at').single().then(function (r) {
        if (!wAlive.current) return;
        if (r && r.error) { window.PRUI.toast('Javaslat mentése sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        if (r && r.data) setSuggestions(function (S) { return [r.data].concat(S); });
        setSuggestFor(null); setSuggestText(''); setSuggestNote(''); window.PRUI.toast('Javaslat elküldve', { kind: 'success' });
      });
    }
    function resolveSuggestion(sg, status) {
      setSuggestions(function (S) { return S.map(function (x) { return x.id === sg.id ? Object.assign({}, x, { status: status }) : x; }); });
      sb.from('research_draft_suggestions').update({ status: status, resolved_at: new Date().toISOString(), resolved_by: props.authorId }).eq('id', sg.id).then(function (r) { if (r && r.error && wAlive.current) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); loadSuggestions(draft && draft.id); } });
    }
    function acceptSuggestion(sg) {
      if (!ce || !draft || !draft.sections) return;
      var newSecs = draft.sections.map(function (s) { return s.key === sg.section_key ? Object.assign({}, s, { latex: sg.suggested }) : s; });
      setDraft(function (d) { return Object.assign({}, d, { sections: newSecs }); });
      bcSecUpdate(sg.section_key, sg.suggested);   // keep concurrent editors' local copies fresh so their saves don't revert this
      persistSection(sg.section_key, sg.suggested, newSecs); resolveSuggestion(sg, 'accepted'); window.PRUI.toast('Javaslat alkalmazva a szekcióra', { kind: 'success' });
    }
    function pendingFor(key) { return suggestions.filter(function (s) { return s.section_key === key && s.status === 'pending'; }).length; }
    // Phase 5: live collaborative section editing over a per-draft Realtime channel (broadcast; no CRDT dependency).
    var myName = (props.viewer && props.viewer.name) || 'Kolléga', myId = props.authorId;
    var lastEdBc = useRef(0);
    useEffect(function () {
      if (!draft || !draft.id) return;
      var ch = sb.channel('rdraft:' + draft.id)
        .on('broadcast', { event: 'seclock' }, function (m) {
          if (!wAlive.current) return; var pl = m && m.payload; if (!pl || !pl.key || pl.id === myId) return;
          setSecLocks(function (L) { var n = Object.assign({}, L); if (pl.editing) n[pl.key] = { name: pl.name, id: pl.id, ts: Date.now() }; else delete n[pl.key]; return n; });
        })
        .on('broadcast', { event: 'secupdate' }, function (m) {
          if (!wAlive.current) return; var pl = m && m.payload; if (!pl || !pl.key || pl.id === myId) return;
          if (edSecRef.current === pl.key) return;   // don't clobber the section I'm actively editing
          setDraft(function (d) { if (!d || !d.sections) return d; return Object.assign({}, d, { sections: d.sections.map(function (s) { return s.key === pl.key ? Object.assign({}, s, { latex: pl.latex }) : s; }) }); });
        })
        .subscribe();
      dChRef.current = ch;
      var pl = setInterval(function () { if (!wAlive.current) return; var now = Date.now(); setSecLocks(function (L) { var n = {}, ch2 = false; Object.keys(L).forEach(function (k) { if (now - L[k].ts < 12000) n[k] = L[k]; else ch2 = true; }); return ch2 ? n : L; }); }, 4000);
      return function () { clearInterval(pl); dChRef.current = null; try { sb.removeChannel(ch); } catch (e) { } };
    }, [draft && draft.id]);
    function bcSecLock(key, editing) { var ch = dChRef.current; if (!ch) return; try { ch.send({ type: 'broadcast', event: 'seclock', payload: { key: key, editing: editing, name: myName, id: myId } }); } catch (e) { } }
    function bcSecUpdate(key, latex) { var ch = dChRef.current; if (!ch) return; try { ch.send({ type: 'broadcast', event: 'secupdate', payload: { key: key, latex: latex, id: myId } }); } catch (e) { } }
    function startEditSection(sec) {
      if (!ce) return;
      var lk = secLocks[sec.key]; if (lk) { window.PRUI.toast(lk.name + ' épp szerkeszti ezt a szekciót', { kind: 'error' }); return; }
      edOrig.current = sec.latex || ''; setEditSec(sec.key); setEditTxt(sec.latex || ''); bcSecLock(sec.key, true);
    }
    function onEditText(sec, txt) {
      setEditTxt(txt);
      setDraft(function (d) { if (!d || !d.sections) return d; return Object.assign({}, d, { sections: d.sections.map(function (s) { return s.key === sec.key ? Object.assign({}, s, { latex: txt }) : s; }) }); });
      var now = Date.now(); if (now - lastEdBc.current > 220) { lastEdBc.current = now; bcSecUpdate(sec.key, txt); }
    }
    // persist a SINGLE section. Prefer the row-locked RPC (migration-78) so a whole-array write can't revert a
    // concurrently-edited/just-accepted OTHER section; fall back to the whole-array update if the RPC is absent.
    function persistSection(key, latex, fallbackSecs) {
      if (!draft || !draft.id) return; var dId = draft.id;
      var whole = function () { sb.from('research_drafts').update({ sections: fallbackSecs, updated_at: new Date().toISOString() }).eq('id', dId).then(function (r2) { if (wAlive.current && r2 && r2.error) window.PRUI.toast('Mentés sikertelen: ' + r2.error.message, { kind: 'error' }); }); };
      sb.rpc('research_draft_set_section', { d_id: dId, s_key: key, s_latex: latex }).then(function (r) { if (!wAlive.current) return; if (r && r.error) whole(); }, function () { whole(); });
    }
    function saveSection(sec) {
      if (!draft || !draft.id) return; var txt = editTxt, newSecs = (draft.sections || []).map(function (s) { return s.key === sec.key ? Object.assign({}, s, { latex: txt }) : s; });
      bcSecUpdate(sec.key, txt); bcSecLock(sec.key, false); setEditSec(null);
      persistSection(sec.key, txt, newSecs);
    }
    function cancelEdit(sec) {
      var orig = edOrig.current;   // revert my live edits (local + peers) back to the pre-edit content
      setDraft(function (d) { if (!d || !d.sections) return d; return Object.assign({}, d, { sections: d.sections.map(function (s) { return s.key === sec.key ? Object.assign({}, s, { latex: orig }) : s; }) }); });
      bcSecUpdate(sec.key, orig); bcSecLock(sec.key, false); setEditSec(null);
    }
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
        (draft.sections && draft.sections.length) ? h('div', { style: { marginTop: 10 } }, h('b', { style: { fontSize: 12 } }, 'Sections:'),
          h('ol', { className: 'wp-secs', style: { margin: '4px 0', paddingLeft: 20, fontSize: 12.5 } }, draft.sections.map(function (s, i) {
            return h('li', { key: i },
              h('span', null, s.heading || s.key),
              (ce && editSec !== s.key && !secLocks[s.key]) ? h('button', { className: 'wp-sg-btn', title: 'Szekció szerkesztése (élő, közös)', onClick: function () { startEditSection(s); } }, '✎ Szerkeszt') : null,
              secLocks[s.key] ? h('span', { className: 'wp-lock', title: secLocks[s.key].name + ' épp szerkeszti' }, '🔒 ' + secLocks[s.key].name) : null,
              suggestCap ? h('button', { className: 'wp-sg-btn', title: 'Javaslat erre a szekcióra', onClick: function () { setSuggestFor(suggestFor === i ? null : i); setSuggestText(s.latex || ''); setSuggestNote(''); } }, '💡 Javaslat') : null,
              pendingFor(s.key) ? h('span', { className: 'wp-sg-count', title: pendingFor(s.key) + ' függő javaslat' }, pendingFor(s.key)) : null,
              (editSec === s.key) ? h('div', { className: 'wp-sg-composer' },
                h('textarea', { rows: 7, value: editTxt, placeholder: 'Szekció tartalma (LaTeX)…', onChange: function (e) { onEditText(s, e.target.value); } }),
                h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' } },
                  h('span', { style: { flex: 1, fontSize: 10.5, color: 'var(--faint)' } }, '🟢 Élő közös szerkesztés — a kollégák valós időben látják'),
                  h('button', { className: 'btn', style: { fontSize: 12, padding: '4px 10px' }, onClick: function () { cancelEdit(s); } }, 'Mégse'),
                  h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 10px' }, onClick: function () { saveSection(s); } }, 'Mentés'))) : null,
              (suggestFor === i) ? h('div', { className: 'wp-sg-composer' },
                h('textarea', { rows: 5, value: suggestText, placeholder: 'Javasolt szöveg…', onChange: function (e) { setSuggestText(e.target.value); } }),
                h('input', { className: 'wp-sg-note', value: suggestNote, placeholder: 'Indoklás (opcionális)…', onChange: function (e) { setSuggestNote(e.target.value); } }),
                h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                  h('button', { className: 'btn', style: { fontSize: 12, padding: '4px 10px' }, onClick: function () { setSuggestFor(null); setSuggestText(''); } }, 'Mégse'),
                  h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 10px' }, disabled: !suggestText.trim(), onClick: function () { submitSuggestion(s); } }, 'Javaslat küldése'))) : null);
          }))) : null,
        // suggestions review (open suggesting mode — accept/reject/withdraw)
        (suggestCap && suggestions.filter(function (s) { return s.status === 'pending'; }).length) ? h('div', { className: 'wp-sg-panel' },
          h('b', { style: { fontSize: 12 } }, '💡 Javaslatok (' + suggestions.filter(function (s) { return s.status === 'pending'; }).length + ' függő)'),
          suggestions.filter(function (s) { return s.status === 'pending'; }).map(function (sg) {
            return h('div', { key: sg.id, className: 'wp-sg-item' },
              h('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 } }, (sg.section_heading || sg.section_key || 'szekció') + (sg.note ? ' — „' + sg.note + '"' : '')),
              h('div', { className: 'wp-sg-diff' },
                h('div', { className: 'wp-sg-old' }, String(sg.original || '(üres)').slice(0, 600)),
                h('div', { className: 'wp-sg-new' }, String(sg.suggested || '').slice(0, 600))),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' } },
                ce ? h('button', { className: 'btn pri', style: { fontSize: 11.5, padding: '3px 10px' }, onClick: function () { acceptSuggestion(sg); } }, '✓ Elfogad') : null,
                (ce || sg.author === props.authorId) ? h('button', { className: 'btn', style: { fontSize: 11.5, padding: '3px 10px' }, onClick: function () { resolveSuggestion(sg, 'rejected'); } }, ce ? '✕ Elutasít' : 'Visszavonás') : null));
          })) : null,
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
  // ---- Background study-funnel runner: drives the OpenAlex + Claude Study funnel at MODULE level, so a run KEEPS GOING
  //      when the user switches tabs / views (the recursion is NOT tied to any component's mount). Run state lives here;
  //      components subscribe to render it and can dismiss/cancel. (A full page reload still stops it — the DB keeps the
  //      partial funnel state, so nothing is lost.) ----
  var PRStudyRunner = (function () {
    var runs = {}, subs = [], seq = 0;
    var BK = { setup: 'Study előkészítése', s1: 'Keresés + gyors triage (OpenAlex)', s2: 'Absztrakt-szűrés (Claude)', s3: 'Full-text szűrés (Claude)', review: 'Áttekintés írása (Claude)' };
    function notify() { for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) { } } }
    function set(id, patch) { if (!runs[id]) return; runs[id] = Object.assign({}, runs[id], patch); notify(); }
    function drive(id, sid, stage, offset, iter) {
      if (!runs[id]) return;   // dismissed / cancelled → stop the recursion
      if (stage === 'review') {
        set(id, { stage: 'review', msg: BK.review + '…', sid: sid });
        callStudy({ action: 'generate_review', study_id: sid }).then(function (d) {
          if (!runs[id]) return; var oc = runs[id].onChanged; if (oc) oc();
          if (d && d.error) { if (/full-?text|passed|include/i.test(d.error)) set(id, { stage: 'done', msg: 'A szűrés nem talált full-text included cikket, ezért nem készült áttekintés. A szűrési részletekhez: Study fül → nyisd ki a „Keyword screening funnel" panelt, és válaszd ki ezt a study-t.', sid: sid }); else set(id, { stage: 'error', msg: 'Review: ' + d.error, sid: sid }); return; }
          var fp = d && d.file_path;
          set(id, { stage: 'done', msg: '✓ Kész' + (d && d.words ? ' — ~' + d.words + ' szó' : '') + ' — a Study fülön a „Keyword screening funnel" panelben is elérhető.', sid: sid, filePath: fp });
        }, function () { set(id, { stage: 'error', msg: 'A review-hívás nem sikerült.', sid: sid }); });
        return;
      }
      set(id, { stage: stage, msg: (BK[stage] || stage) + '…', sid: sid });
      var act = stage === 's1' ? { action: 'search_step1', study_id: sid, step: 1, offset: offset } : { action: 'screen_batch', study_id: sid, step: (stage === 's2' ? 2 : 3), offset: offset };
      callStudy(act).then(function (d) {
        if (!runs[id]) return;
        if (d && d.error) { set(id, { stage: 'error', msg: (BK[stage] || stage) + ': ' + d.error, sid: sid }); return; }
        var dflt = stage === 's1' ? 20 : (stage === 's2' ? 8 : 3), ni = iter + 1;
        if (d.done || ni > 40) drive(id, sid, stage === 's1' ? 's2' : stage === 's2' ? 's3' : 'review', 0, 0);
        else drive(id, sid, stage, (d.next_offset != null ? d.next_offset : offset + dflt), ni);
      }, function () { set(id, { stage: 'error', msg: 'Hálózati hiba a szűrés közben.', sid: sid }); });
    }
    return {
      runs: function () { return runs; },
      subscribe: function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
      dismiss: function (id) { if (runs[id]) { delete runs[id]; notify(); } },   // dismiss a finished card OR cancel a running funnel (the recursion stops on the next step)
      // is a given study (by id) or question currently being worked on (non-terminal stage)? → drives the pulsing indicators
      isStudyRunning: function (sid) { if (!sid) return false; for (var k in runs) { var r = runs[k]; if (r.sid === sid && r.stage !== 'done' && r.stage !== 'error') return true; } return false; },
      isQuestionRunning: function (q) { if (!q) return false; for (var k in runs) { var r = runs[k]; if (r.rq === q && r.stage !== 'done' && r.stage !== 'error') return true; } return false; },
      startBackup: function (rq, ctx) {
        if (!rq) return null;
        var id = 'bk' + (++seq);
        runs[id] = { id: id, projectId: ctx.projectId, ideaId: ctx.ideaId || null, onChanged: ctx.onChanged, rq: rq, sid: null, stage: 'setup', msg: 'Study létrehozása…', title: rq.slice(0, 90) };
        notify();
        sb.from('research_studies').insert({ project_id: ctx.projectId, idea_id: ctx.ideaId || null, title: rq.slice(0, 80), question: rq.slice(0, 4000), created_by: ctx.authorId }).select('id').maybeSingle().then(function (sr) {
          if (!runs[id]) return;
          var sid = sr && sr.data && sr.data.id;
          if (!sid) { set(id, { stage: 'error', msg: 'A study nem jött létre' + (sr && sr.error ? ': ' + sr.error.message : '') }); return; }
          set(id, { sid: sid });   // now the study card / candidate / idea badge can match this run + pulse
          var rows = LS_STEPS.map(function (s) { return { study_id: sid, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, ctx.project, null) }; });
          sb.from('research_study_steps').insert(rows).then(function (rr) {
            if (!runs[id]) return;
            if (rr && rr.error) { set(id, { stage: 'error', msg: 'study-lépések: ' + rr.error.message, sid: sid }); return; }
            if (ctx.onChanged) ctx.onChanged();
            callStudy({ action: 'plan', study_id: sid }).then(function () { drive(id, sid, 's1', 0, 0); }, function () { drive(id, sid, 's1', 0, 0); });
          });
        });
        return id;
      }
    };
  })();

  // ---- Background figure-extraction runner: runs the pdf.js figure extraction at MODULE level so it KEEPS GOING
  //      across SPA tab/view switches (like PRStudyRunner). One run per project. A full page reload stops it, but each
  //      paper's figures persist to research_figures as it finishes, so re-starting resumes (done papers are skipped).
  //      Same extraction as figure-board.js (resolve OA PDF via pdf-proxy → pdf.js render → caption-crop → upload). ----
  var PRFigureRunner = (function () {
    var runs = {}, subs = [];   // projectId -> { projectId, stage:'running'|'done'|'error', done, total, added, msg, curTitle, onChanged }
    function notify() { for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) { } } }
    function set(pid, patch) { if (!runs[pid]) return; runs[pid] = Object.assign({}, runs[pid], patch); notify(); }
    function CFG() { return window.PR_CONFIG || {}; }
    function fbBareDoi(d) { return String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, ''); }
    function fbProxy(body, binary) {
      var C = CFG();
      return sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || C.supabaseAnonKey;
        return fetch(C.supabaseUrl + '/functions/v1/pdf-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': C.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) })
          .then(function (r) { return binary ? (r.ok ? r.arrayBuffer() : r.json().then(function (e) { throw new Error((e && e.error) || 'fetch failed'); })) : r.json(); });
      });
    }
    // Yield to the event loop between heavy page renders so the SPA UI stays responsive while extraction runs in the
    // background. Uses MessageChannel, NOT setTimeout: background-tab timer throttling would clamp a setTimeout yield to
    // ~1s each (≈30s/paper of pure waiting); MessageChannel macrotasks are not throttled.
    function yieldUI() { return new Promise(function (resolve) { var ch = new MessageChannel(); ch.port1.onmessage = function () { resolve(); }; ch.port2.postMessage(0); }); }
    var pdfjsPromise = null;
    function ensurePdfjs() {
      if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; return Promise.resolve(window.pdfjsLib); }
      if (pdfjsPromise) return pdfjsPromise;
      pdfjsPromise = new Promise(function (resolve, reject) {
        var sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
        sc.onload = function () { if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; resolve(window.pdfjsLib); } else { pdfjsPromise = null; reject(new Error('pdf.js unavailable')); } };
        sc.onerror = function () { pdfjsPromise = null; reject(new Error('pdf.js failed to load')); };
        document.head.appendChild(sc);
      });
      return pdfjsPromise;
    }
    // find "Figure N" captions on a page → rendered-px position (top-origin) + first-line text (ported from figure-board.js)
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
        var y = line[0].y, hh = line[0].h;
        caps.push({ y: y, top: y - hh, bottom: y + hh * 0.6, label: 'Figure ' + m[2], text: text.slice(0, 320) });
      });
      caps.sort(function (a, b) { return a.y - b.y; });
      return caps;
    }
    function extractPaper(pid, p, onProg) {   // pid threaded in: SPA props.sources rows omit project_id, so never read p.project_id
      return fbProxy({ action: 'resolve', doi: fbBareDoi(p.doi) }, false).then(function (res) {
        if (!res || !res.pdf_url) return { status: 'no_oa', figs: 0 };
        onProg && onProg('PDF letöltése…');
        return fbProxy({ action: 'fetch', url: res.pdf_url }, true).then(function (buf) {
          return ensurePdfjs().then(function (pdfjs) { return pdfjs.getDocument({ data: buf }).promise; }).then(function (pdf) {
            var out = [], ord = 0, chain = Promise.resolve();
            var maxPages = Math.min(pdf.numPages, 30);
            for (var pn = 1; pn <= maxPages; pn++) (function (pnum) {
              chain = chain.then(yieldUI).then(function () {   // let the UI breathe before each page's render
                onProg && onProg('Oldal ' + pnum + '/' + maxPages + '…');
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
                        var path = pid + '/figures/' + p.id + '/' + myOrd + '.png';   // RLS bucket keys on the first path segment = project id
                        return new Promise(function (r) { fc.toBlob(r, 'image/png', 0.92); }).then(function (blob) {
                          if (!blob) return;
                          return sb.storage.from('research-data').upload(path, blob, { upsert: true, contentType: 'image/png' }).then(function () {
                            out.push({ project_id: pid, source_id: p.id, page: pnum, ord: myOrd, fig_label: cap.label, caption: cap.text, storage_path: path, width: fc.width, height: fc.height });
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
    function drive(pid, todo, i) {
      if (!runs[pid]) return;   // cancelled → stop
      if (i >= todo.length) {
        var oc = runs[pid].onChanged;
        set(pid, { stage: 'done', done: todo.length, curTitle: '', msg: '✓ Kész — ' + runs[pid].added + ' ábra ' + todo.length + ' cikkből' });
        if (oc) try { oc(); } catch (e) { }
        return;
      }
      var p = todo[i];
      set(pid, { stage: 'running', done: i, curTitle: p.title || '', msg: 'Feldolgozás…' });
      extractPaper(pid, p, function (m) { if (runs[pid]) set(pid, { msg: m }); }).then(function (r) {
        if (!runs[pid]) return;
        var oc2 = runs[pid].onChanged;
        // mark "attempted, produced nothing" (no OA PDF / no captioned figures) so a resume skips it instead of
        // re-processing every time. Needs migration-64 research_sources.fig_status; the update silently no-ops if absent.
        if (r && (r.status === 'no_oa' || r.status === 'no_figs')) { try { sb.from('research_sources').update({ fig_status: r.status }).eq('id', p.id).then(function () { }, function () { }); } catch (e) { } }
        set(pid, { added: runs[pid].added + ((r && r.figs) || 0), done: i + 1 });
        if (oc2 && r && r.figs) try { oc2(); } catch (e) { }   // stream: refresh the app as each paper's figures land
        drive(pid, todo, i + 1);
      }, function () { if (runs[pid]) drive(pid, todo, i + 1); });   // a single paper failing must not stop the run
    }
    return {
      runs: function () { return runs; },
      subscribe: function (fn) { subs.push(fn); return function () { var k = subs.indexOf(fn); if (k >= 0) subs.splice(k, 1); }; },
      isRunning: function (pid) { var r = runs[pid]; return !!(r && r.stage === 'running'); },
      status: function (pid) { return runs[pid] || null; },
      dismiss: function (pid) { var r = runs[pid]; if (r && (r.stage === 'done' || r.stage === 'error')) { delete runs[pid]; notify(); } },
      cancel: function (pid) { if (runs[pid]) { delete runs[pid]; notify(); } },
      // start extraction for a project over `papers` (research_sources rows already filtered to DOI + not-yet-extracted)
      start: function (pid, papers, onChanged) {
        if (!pid || !papers || !papers.length) return null;
        if (runs[pid] && runs[pid].stage === 'running') return runs[pid];   // already running → no double-start
        runs[pid] = { projectId: pid, stage: 'running', done: 0, total: papers.length, added: 0, msg: 'Indítás…', curTitle: '', onChanged: onChanged };
        notify();
        ensurePdfjs().then(function () { if (runs[pid]) drive(pid, papers, 0); }, function () { set(pid, { stage: 'error', msg: 'pdf.js betöltése sikertelen' }); });
        return runs[pid];
      }
    };
  })();

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
    var bkS = useState(0), setBkTick = bkS[1];   // re-render tick — backup runs live in PRStudyRunner (background, survives tab switches)
    var ofS = useState(''), offer = ofS[0], setOffer = ofS[1];       // the failed research-question, offered for the backup
    var alive = useRef(true);
    function load() { callElicit({ action: 'report.list', project_id: props.projectId }).then(function (d) { if (alive.current) setJobs((d && d.jobs) || []); }); }
    useEffect(function () { alive.current = true; if (canUse) load(); return function () { alive.current = false; }; }, [canUse]);
    useEffect(function () { return PRStudyRunner.subscribe(function () { if (alive.current) setBkTick(function (x) { return x + 1; }); }); }, []);   // re-render on background-run changes
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

    // ---- Claude backup: no Elicit quota → run the built-in Claude+OpenAlex Study funnel in the module-level PRStudyRunner
    //      (background — the run survives tab/view switches). This component only triggers it and renders the cards. ----
    function runBackup(rq) { setOffer(''); setErr(''); PRStudyRunner.startBackup(rq, { projectId: props.projectId, project: props.project, authorId: props.authorId, onChanged: props.onChanged }); }
    function backupEl() {
      var all = PRStudyRunner.runs(), ks = Object.keys(all).filter(function (k) { return all[k].projectId === props.projectId; });
      if (!ks.length) return null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0' } }, ks.map(function (k) {
        var b = all[k], term = b.stage === 'done' || b.stage === 'error';
        return h('div', { key: k, style: { fontSize: 12.5, border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', display: 'flex', alignItems: 'flex-start', gap: 9 } },
          h('span', { style: { fontSize: 15, flex: 'none' } }, b.stage === 'error' ? '✗' : b.stage === 'done' ? '✓' : '⏳'),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('b', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: b.title || '' }, '⚡ ' + (b.title || 'Claude backup Study')),
            h('div', { style: { color: b.stage === 'error' ? 'var(--danger, #b42318)' : b.stage === 'done' ? 'var(--ok, #15803d)' : 'var(--muted)', marginTop: 2 } }, b.msg + (term ? '' : ' · háttérben fut — nyugodtan válts fület')),
            (b.stage === 'done' && b.filePath) ? h('div', { style: { marginTop: 6 } }, h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5 }, onClick: function () { sb.from('research_files').select('content').eq('project_id', props.projectId).eq('path', b.filePath).maybeSingle().then(function (fr) { var c = fr && fr.data && fr.data.content; if (c) setOpenReport({ result_title: 'Claude backup', result_body: c }); }); } }, '📄 Áttekintés megnyitása')) : null),
          h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 12, flex: 'none' }, title: term ? 'Elrejtés' : 'Leállítás', onClick: function () { PRStudyRunner.dismiss(k); } }, '×'));
      }));
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
      backupEl(),
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
    var fS = useState({ q: '', protocol: '', abs: [], ft: [], ex: [], exclude: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }), f = fS[0], setF = fS[1];
    var buS = useState(false), busy = buS[0], setBusy = buS[1];
    var erS = useState(''), err = erS[0], setErr = erS[1];
    var opS = useState(null), openR = opS[0], setOpenR = opS[1];
    var caS = useState(null), cands = caS[0], setCands = caS[1];   // SR-question candidates generated from Ideas
    var gnS = useState(false), gen = gnS[0], setGen = gnS[1];
    var ehS = useState(null), enh = ehS[0], setEnh = ehS[1];       // AI-suggested sharper questions (item 4)
    var ebS = useState(false), enhBusy = ebS[0], setEnhBusy = ebS[1];
    var ibS = useState({}), ideaById = ibS[0], setIdeaById = ibS[1];   // idea_id → question, so each candidate shows the Study-basis idea it came from
    var stByS = useState({}), studiesByIdea = stByS[0], setStudiesByIdea = stByS[1];   // idea_id → [research_studies] : the literature studies belonging to each idea (shown on the review-question modal)
    var bkS = useState(0), setBkTick = bkS[1];   // re-render tick — the actual backup runs live in the module-level PRStudyRunner so they survive tab/view switches
    var alive = useRef(true), fromCand = useRef(null);   // the candidate a review is being started from → link its launched_job_id after create
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
    // the literature studies started FROM each idea (idea_id-linked) → shown on the review-question modal so you can
    // see / open the studies that already belong to this idea and their status
    function loadStudies() {
      sb.from('research_studies').select('id,idea_id,title,status,cur_step,created_at').eq('project_id', props.projectId).not('idea_id', 'is', null).order('created_at', { ascending: false }).then(function (r) {
        if (!alive.current) return;
        var m = {}; ((r && r.data) || []).forEach(function (s) { if (s.idea_id) (m[s.idea_id] = m[s.idea_id] || []).push(s); });
        setStudiesByIdea(m);
      }, function () { });
    }
    // open a literature study's review markdown in the same viewer modal (openR) the SR reports use
    // step 1..4 → a short Hungarian stage name, so the "Study" chip says WHICH stage the study is at
    function studyStepName(n) { return n === 4 ? 'Áttekintés' : n === 3 ? 'Full-text' : n === 2 ? 'Absztrakt-szűrés' : 'Keresés'; }
    // open the keyword screening funnel below AT this study, at its furthest step — the parent reveals + scrolls the
    // funnel and LiteratureStudy selects the study (so the user sees the real funnel state: papers, screening, review),
    // instead of a review-markdown modal that is empty while the study is still running.
    function goStudyFunnel(study) { if (props.onOpenStudy) props.onOpenStudy(study.id); }
    function generate() { setGen(true); setErr(''); callStudy({ action: 'sr_suggest', project_id: props.projectId }).then(function (d) { if (!alive.current) return; setGen(false); if (d && d.error) { setErr('Generate: ' + d.error); return; } loadCands(); if (d && d.created === 0) setErr('No Ideas yet — add Ideas in the Idea stage first, then generate.'); }); }
    function picoText(p) { if (!p) return ''; return [['P', p.population], ['I', p.intervention], ['C', p.comparison], ['O', p.outcome]].filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).join('\n'); }
    function startFromCand(c) { fromCand.current = c.id; setF({ q: c.question || '', protocol: picoText(c.pico), abs: c.abstract_criteria || [], ft: [], ex: c.extraction_questions || [], exclude: c.exclusion_criteria || [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); setOpenForm(true); setErr(''); }
    function dismissCand(c) { setCands(function (l) { return (l || []).filter(function (x) { return x.id !== c.id; }); }); sb.from('research_sr_candidates').update({ dismissed: true }).eq('id', c.id); }
    useEffect(function () { alive.current = true; ensureSrCss(); if (canUse) { load(); loadCands(); loadStudies(); sb.from('research_ideas').select('id,question').eq('project_id', props.projectId).then(function (r) { if (!alive.current) return; var m = {}; ((r && r.data) || []).forEach(function (x) { m[x.id] = x.question; }); setIdeaById(m); }); } return function () { alive.current = false; }; }, [canUse]);
    // re-render whenever a background study run changes (the runs live in PRStudyRunner, not in this component's state)
    var loadStudiesRef = useRef(null), pidRefSr = useRef(props.projectId), stSigRef = useRef('');
    loadStudiesRef.current = loadStudies; pidRefSr.current = props.projectId;
    useEffect(function () {
      return PRStudyRunner.subscribe(function () {
        if (!alive.current) return;
        setBkTick(function (x) { return x + 1; });   // cheap re-render → related-study pulse reflects running↔done
        // reload the idea→studies map only when a study appears / goes terminal (not on every progress tick)
        var pid = pidRefSr.current, all = PRStudyRunner.runs(), sig = [];
        for (var k in all) { var r = all[k]; if (r.projectId === pid && r.sid) sig.push(r.sid + ':' + ((r.stage === 'done' || r.stage === 'error') ? '1' : '0')); }
        sig.sort(); var s = sig.join('|');
        if (s !== stSigRef.current) { stSigRef.current = s; if (loadStudiesRef.current) loadStudiesRef.current(); }
      });
    }, []);
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
      // Elicit screening has no separate exclusion field → fold each exclusion criterion into the screening criteria as an
      // inclusion-style rule ("must NOT match …") so a paper meeting it is correctly EXCLUDED. Abstract screen is the primary gate.
      var absAll = (f.abs || []).concat((f.exclude || []).filter(Boolean).map(function (e) { return 'The paper must NOT meet this exclusion condition: ' + e; }));
      callElicit({ action: 'sr.create', researchQuestion: rq, protocolDetails: f.protocol || null, abstractCriteria: absAll, fulltextCriteria: f.ft, extractionQuestions: f.ex, generateReport: f.gen, genAbstract: f.genAbs, genExtraction: f.genEx, useFigures: f.useFig, runFullText: f.runFT, maxResults: f.maxResults ? parseInt(f.maxResults, 10) : undefined, project_id: props.projectId, title: (props.project && props.project.title) || null }).then(function (d) {
        setBusy(false);
        if (!d || d.error) {
          var em = (d && d.error) || 'Could not start the review.';
          // Elicit truly EXHAUSTED (out of quota / daily cap) → auto-fall-back to the built-in Claude + OpenAlex Study funnel.
          // Transient conditions (429 "Rate limit hit", 403 "plan limit or max concurrent") must NOT auto-spend tokens — they surface as a retryable error.
          if (/out of quota|over quota|kvóta|napi|budget|daily .*limit reached/i.test(String(em))) { var qCand = (cands || []).filter(function (x) { return x.id === fromCand.current; })[0]; setErr('⚡ Elicit nem elérhető (kvóta/napi limit) — automatikus Claude backup Study indul ugyanerre a kérdésre…'); setOpenForm(false); runBackup(rq, qCand && qCand.idea_id); fromCand.current = null; }
          else setErr(em);
          return;
        }
        var jid = d.job && d.job.id;   // link the review back to the Study-basis candidate it was started from (Map provenance)
        if (fromCand.current && jid) sb.from('research_sr_candidates').update({ launched_job_id: jid, updated_at: new Date().toISOString() }).eq('id', fromCand.current);
        fromCand.current = null;
        setOpenForm(false); setF({ q: '', protocol: '', abs: [], ft: [], ex: [], exclude: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); if (d.deduped) setErr('A review for this question is already in progress.'); load();
      });
    }
    // ---- Claude backup: Elicit SR out of quota → run the built-in Claude + OpenAlex Study funnel. MULTIPLE studies run in
    //      parallel, keyed by a per-run id, each with its own independent status card. ----
    // The Claude backup runs in the module-level PRStudyRunner → it KEEPS GOING across tab/view switches. This component
    // only triggers it and renders the runs; on unmount the run continues in the background.
    function runBackup(rq, ideaId) { PRStudyRunner.startBackup(rq, { projectId: props.projectId, project: props.project, authorId: props.authorId, onChanged: props.onChanged, ideaId: ideaId || null }); }
    function backupEl() {   // one status card per Claude backup study for THIS project (state lives in PRStudyRunner)
      var all = PRStudyRunner.runs(), ks = Object.keys(all).filter(function (k) { return all[k].projectId === props.projectId; });
      if (!ks.length) return null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' } }, ks.map(function (k) {
        var b = all[k], term = b.stage === 'done' || b.stage === 'error';
        return h('div', { key: k, style: { fontSize: 12.5, border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', display: 'flex', alignItems: 'flex-start', gap: 9 } },
          h('span', { style: { fontSize: 15, flex: 'none' } }, b.stage === 'error' ? '✗' : b.stage === 'done' ? '✓' : '⏳'),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('b', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: b.title || '' }, '⚡ ' + (b.title || 'Claude backup Study')),
            h('div', { style: { color: b.stage === 'error' ? 'var(--danger, #b42318)' : b.stage === 'done' ? 'var(--ok, #15803d)' : 'var(--muted)', marginTop: 2 } }, b.msg + (term ? '' : ' · háttérben fut — nyugodtan válts fület')),
            (b.stage === 'done' && b.filePath) ? h('div', { style: { marginTop: 6 } }, h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5 }, onClick: function () { sb.from('research_files').select('content').eq('project_id', props.projectId).eq('path', b.filePath).maybeSingle().then(function (fr) { var c = fr && fr.data && fr.data.content; if (c) setOpenR({ result_title: 'Claude backup', result_body: c }); }); } }, '📄 Áttekintés megnyitása')) : null),
          h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 12, flex: 'none' }, title: term ? 'Elrejtés' : 'Leállítás', onClick: function () { PRStudyRunner.dismiss(k); } }, '×'));
      }));
    }
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
    function delEl(j) {   // delete a systematic review (elicit_jobs) — owner-only by RLS; also unlink its Study-basis candidate
      window.PRUI.confirm({ title: 'Áttekintés törlése?', body: (j.result_title || j.research_question || 'Systematic review') + ' — véglegesen törlődik.', confirmLabel: 'Törlés', danger: true }).then(function (ok) {
        if (!ok) return;
        sb.from('research_sr_candidates').update({ launched_job_id: null }).eq('launched_job_id', j.id).then(function () { });
        sb.from('elicit_jobs').delete().eq('id', j.id).then(function (r) {
          if (!alive.current) return;
          if (r && r.error) { setErr('Törlés sikertelen: ' + r.error.message); return; }
          if (selJob === j.id) setSelJob(null);
          load();
        });
      });
    }
    function card(j) {
      var done = j.status === 'completed', failed = j.status === 'failed', paused = j.status === 'pausedForInsufficientQuota';
      var acts = [];
      // dedicated results page: tracks the PRISMA pipeline live + renders screening/extraction tables + report on the web
      acts.push(h('a', { key: 'res', className: 'btn pri', style: { padding: '4px 10px', fontSize: 12, textDecoration: 'none' }, href: 'SRReview.html?job=' + encodeURIComponent(j.id), title: 'Track the pipeline and view the results in Publify' }, (done ? '📊 Open results' : '📊 Track progress')));
      if (done && j.result_body) acts.push(h('button', { key: 'v', className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { setOpenR(j); } }, 'View full report'));
      if (done) acts.push(h('button', { key: 'rf', className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Re-fetch the download links (they expire after 7 days)', onClick: function () { refreshJob(j); } }, '↻ Refresh downloads'));
      if (paused) acts.push(h('button', { key: 'r', className: 'btn pri', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { resume(j); } }, 'Resume'));
      if (props.canEdit) acts.push(h('button', { key: 'del', className: 'btn', style: { padding: '4px 10px', fontSize: 12, color: 'var(--danger, #b42318)' }, onClick: function () { delEl(j); } }, '🗑 Törlés'));
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
    // has a review already been launched from THIS candidate? match by launched_job_id (set on create) or the question text
    function candJob(c) {
      if (!c || !jobs || !jobs.length) return null;
      var j = c.launched_job_id ? jobs.filter(function (x) { return x.id === c.launched_job_id; })[0] : null;
      if (!j && c.question) j = jobs.filter(function (x) { return x.research_question === c.question; })[0];
      return j || null;
    }
    function openCandRun(c) { var j = candJob(c); if (!j) return; if (j.status === 'completed' && j.result_body) setOpenR(j); else setSelJob(j.id); }   // done → open the report; else select it in the rail (shows the tracker)
    function candRunBadge(c) {
      if (PRStudyRunner.isQuestionRunning(c.question)) return h('span', { className: 'pulse-run-tag', style: { alignSelf: 'flex-start', marginTop: 2 } }, '⏳ Kidolgozás alatt…');   // a Claude backup study is actively running for this question
      var j = candJob(c); if (!j) return null;
      var done = j.status === 'completed', failed = j.status === 'failed';
      return h('button', { className: 'sr-cand-run' + (done ? ' done' : failed ? ' fail' : ''), title: 'A lefuttatott áttekintés megnyitása', onClick: function (e) { e.stopPropagation(); openCandRun(c); } }, done ? '✓ Áttekintés kész — megnyitás' : failed ? '✗ Sikertelen futtatás' : '⏳ Futtatás folyamatban — megnyitás');
    }
    // Linked literature studies for this candidate's idea (running AND finished, incl. the Claude/OpenAlex backup),
    // openable directly from the card. The isQuestionRunning pulse + the transient backupEl card only cover a LIVE
    // run in this session; this is DB-backed, so a finished or past-session backup study stays visible + openable.
    function candStudiesEls(c) {
      if (!nd() || !c.idea_id) return null;
      var list = studiesByIdea[c.idea_id] || []; if (!list.length) return null;
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, list.map(function (s) {
        var running = PRStudyRunner.isStudyRunning(s.id);
        var done = s.status === 'done' || s.status === 'completed';
        var stepN = s.cur_step || 1;
        var label = running ? ('⏳ Study · ' + studyStepName(stepN) + ' — funnel megnyitása')
          : done ? '✓ Study · Áttekintés kész — funnel megnyitása'
            : '📄 Study · ' + studyStepName(stepN) + ' (' + stepN + '/4) — funnel megnyitása';
        return h('button', { key: s.id, className: running ? 'pulse-run' : null, title: 'Megnyitás a Keyword screening funnelben, ott ahol a study tart', onClick: function (e) { e.stopPropagation(); goStudyFunnel(s); },
          style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', fontSize: 10.5, fontWeight: 600, borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (running ? 'rgba(234,179,8,.55)' : 'var(--line)'), background: done ? 'var(--ok-bg, #e7f6ee)' : 'var(--surface-2)', color: running ? '#a16207' : done ? 'var(--ok, #15803d)' : 'var(--muted)' } },
          label);
      }));
    }
    function candCard(c) {
      var pico = c.pico || {};
      var hasPico = pico.population || pico.intervention || pico.comparison || pico.outcome;
      return h('div', { key: c.id, className: PRStudyRunner.isQuestionRunning(c.question) ? 'pulse-run' : null, style: { border: '1px solid var(--line)', borderLeft: '3px solid var(--accent, #4f46e5)', borderRadius: 11, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 } },
        (c.idea_id && ideaById[c.idea_id]) ? h('div', { style: { fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 5, alignItems: 'baseline' } }, h('span', { style: { flex: 'none', fontWeight: 700, color: 'var(--accent)' } }, '💡 Alap'), h('span', { style: { minWidth: 0 } }, ideaById[c.idea_id])) : null,
        h('div', { style: { fontSize: 14, fontWeight: 650, lineHeight: 1.35 } }, c.question),
        candRunBadge(c),
        hasPico ? h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 11.5, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 9px' } },
          h('b', { style: { color: 'var(--accent)' } }, 'P'), h('span', null, pico.population || '—'),
          h('b', { style: { color: 'var(--accent)' } }, 'I'), h('span', null, pico.intervention || '—'),
          h('b', { style: { color: 'var(--accent)' } }, 'C'), h('span', null, pico.comparison || '—'),
          h('b', { style: { color: 'var(--accent)' } }, 'O'), h('span', null, pico.outcome || '—')) : null,
        (c.abstract_criteria && c.abstract_criteria.length) ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, c.abstract_criteria.slice(0, 3).map(function (x, i) { return h('span', { key: i, style: { fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--ok-bg, #e7f6ee)', color: 'var(--ok, #15803d)' } }, '✓ ' + String(x).slice(0, 44)); })) : null,
        candStudiesEls(c),
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
      return h('div', { key: c.id, className: 'sr-rcand' + (PRStudyRunner.isQuestionRunning(c.question) ? ' pulse-run' : '') },
        (c.idea_id && ideaById[c.idea_id]) ? h('div', { className: 'sr-rcand-basis' }, '💡 ' + ideaById[c.idea_id]) : null,
        h('div', { className: 'sr-rcand-q' }, c.question),
        picoBits ? h('div', { className: 'sr-rcand-pico' }, picoBits) : null,
        meta.length ? h('div', { className: 'sr-rcand-meta' }, meta.join(' · ')) : null,
        candRunBadge(c),
        candStudiesEls(c),
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
          props.canEdit ? h('button', { className: 'btn', style: { padding: '5px 11px', fontSize: 12.5 }, onClick: function () { fromCand.current = null; setF({ q: '', protocol: '', abs: [], ft: [], ex: [], exclude: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); setOpenForm(true); } }, '+ Manual review') : null),
        err ? h('div', { style: { fontSize: 12.5, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)', margin: '6px 0' } }, err) : null,
        backupEl(),
        // Reviews exist → master-detail (rail + the selected review). No reviews yet → the review-question cards fill the
        // FULL width in a responsive grid (side by side) instead of a narrow rail + a big empty detail pane.
        (jobs && jobs.length) ? h('div', { className: 'sr2' },
          h('div', { className: 'sr-rail' },
            h('div', null,
              h('div', { className: 'sr-rail-hd' }, 'Reviews ', h('span', { className: 'sr-rail-c' }, jobs.length)),
              h('div', { className: 'sr-rlist' }, jobs.map(function (j) { return railRow(j, selId); }))),
            (cands && cands.length) ? h('div', { className: 'sr-rail-sec' },
              h('div', { className: 'sr-rail-hd' }, 'From your Ideas ', h('span', { className: 'sr-rail-c' }, cands.length)),
              cands.map(railCand)) : null),
          h('div', { className: 'sr-detail' }, sel ? card(sel) : h('div', { className: 'sr-detail-empty' }, 'Válassz egy review-t a bal oldali listából.')))
          : (jobs === null) ? h('div', { className: 'sr-detail-empty', style: { padding: '28px 16px', textAlign: 'center' } }, 'Loading reviews…')
            : (cands && cands.length) ? h('div', { style: { marginTop: 6 } },
                h('div', { className: 'field-label' }, '📋 Review-kérdések a projekt ötleteiből — válassz egyet („🔬 Start review"), vagy „+ Manual review"'),
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 8, alignItems: 'start' } }, cands.map(candCard)))
              : h('div', { className: 'sr-detail-empty', style: { padding: '36px 16px', textAlign: 'center', lineHeight: 1.6 } }, 'Még nincs review. Kattints a „✨ Generate from Ideas"-ra, hogy a projekt ötleteiből review-kérdéseket készíts, majd indíts egyet.'),
        openR ? h('div', { className: 'scrim', onClick: function () { setOpenR(null); } }, h('div', { className: 'modal', style: { width: 780 }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'modal-h' }, h('h3', { style: { margin: 0, flex: 1 } }, openR.result_title || 'Systematic review'), h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: function () { setOpenR(null); } }, '✕')),
          (window.marked && window.DOMPurify)
            ? h('div', { className: 'md-report', style: { padding: 18, maxHeight: '72vh', overflow: 'auto', lineHeight: 1.6, fontSize: 13.5 }, dangerouslySetInnerHTML: { __html: enhanceReport(openR.result_body || '') } })
            : h('div', { style: { padding: 18, maxHeight: '72vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 } }, openR.result_body || ''))) : null,
        openForm ? h('div', { className: 'scrim', onClick: function () { setOpenForm(false); fromCand.current = null; } }, h('div', { className: 'modal', style: { width: 640 }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'modal-h' }, h('h3', { style: { margin: 0, flex: 1 } }, '🔬 New systematic review'), h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: function () { setOpenForm(false); fromCand.current = null; } }, '✕')),
          h('div', { className: 'modal-b', style: { display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '74vh', overflow: 'auto' } }, reviewFormEls()))) : null
      );
    }
    // Related literature studies for the candidate this review is being started from — so the modal shows which
    // studies already belong to this idea + their status, with a one-click open of the finished review.
    function relatedStudiesEl() {
      if (!nd()) return null;   // additive; keep the classic (flag-OFF) form byte-identical
      var cid = fromCand.current; if (!cid) return null;
      var cand = (cands || []).filter(function (x) { return x.id === cid; })[0];
      var iid = cand && cand.idea_id; if (!iid) return null;
      var list = studiesByIdea[iid] || []; if (!list.length) return null;
      return h('div', { key: 'relstudies', style: { padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' } }, '📚 Ehhez az ötlethez tartozó study-k (' + list.length + ')'),
        list.map(function (s) {
          var running = PRStudyRunner.isStudyRunning(s.id);
          var done = s.status === 'done' || s.status === 'completed';
          var stepN = s.cur_step || 1;
          return h('div', { key: s.id, className: running ? 'pulse-run' : null, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 7 } },
            h('div', { style: { minWidth: 0, flex: 1 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title || 'Irodalom-study'),
              h('div', { style: { fontSize: 11, color: running ? '#a16207' : done ? 'var(--ok, #15803d)' : 'var(--faint)' } }, running ? ('⏳ ' + studyStepName(stepN) + ' — kidolgozás alatt') : done ? '✓ Áttekintés kész' : '• ' + studyStepName(stepN) + ' (' + stepN + '/4)')),
            h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5, flex: 'none' }, title: 'Megnyitás a Keyword screening funnelben', onClick: function () { setOpenForm(false); goStudyFunnel(s); } }, 'Funnel ▾'));
        }));
    }
    // the create-review form body — shared by the classic full-width layout (flag OFF) AND the New-design modal (flag ON)
    function reviewFormEls() {
      return [
        relatedStudiesEl(),
        h('div', { key: 'q' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('div', { className: 'field-label', style: { flex: 1, margin: 0 } }, 'Research question *'),
            h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, disabled: enhBusy || !f.q.trim(), title: 'Rephrase into sharper questions (you can type in Hungarian)', onClick: enhanceQ }, enhBusy ? '✨ Improving…' : '✨ Improve')),
          h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box', marginTop: 4 }, value: f.q, placeholder: 'The question the review investigates… (Hungarian is fine — use ✨ Improve)', onChange: function (e) { upf('q', e.target.value); } }),
          enh !== null ? h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 } },
            enh.length ? h('div', { style: { fontSize: 11, color: 'var(--faint)' } }, 'Suggested — click to use:') : h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, 'No suggestion — the question looks clear already.'),
            enh.map(function (s, i) { return h('button', { key: i, className: 'btn', style: { textAlign: 'left', padding: '6px 9px', fontSize: 12, lineHeight: 1.35, whiteSpace: 'normal' }, onClick: function () { upf('q', s); setEnh(null); } }, '➕ ' + s); })) : null),
        h('div', { key: 'p' }, h('div', { className: 'field-label' }, 'Protocol / PICO (optional)'), h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box' }, value: f.protocol, placeholder: 'Population, Intervention, Comparison, Outcome; inclusion/exclusion rationale…', onChange: function (e) { upf('protocol', e.target.value); } })),
        h('div', { key: 'ab' }, h('div', { className: 'field-label' }, '✓ Inclusion criteria (abstract screening — AI adds more)'), h(CritEditor, { items: f.abs, onChange: function (a) { upf('abs', a); }, accent: '#16a34a', placeholder: 'e.g. reports a quantitative outcome', empty: 'Auto-generated if left empty.' })),
        h('div', { key: 'exc' }, h('div', { className: 'field-label' }, '✕ Exclusion criteria (a cikket kizárja, ha bármelyik teljesül)'), h(CritEditor, { items: f.exclude, onChange: function (a) { upf('exclude', a); }, accent: '#dc2626', placeholder: 'pl. nincs kvantitatív kiértékelés; nem angol nyelvű', empty: 'Nincs kizárási kritérium.' })),
        f.runFT ? h('div', { key: 'ft' }, h('div', { className: 'field-label' }, 'Full-text screening criteria (optional)'), h(CritEditor, { items: f.ft, onChange: function (a) { upf('ft', a); }, placeholder: 'e.g. sample size ≥ 100', empty: 'Reuses the abstract criteria if empty.' })) : null,
        h('div', { key: 'ex' }, h('div', { className: 'field-label' }, 'Extraction questions (optional)'), h(CritEditor, { items: f.ex, onChange: function (a) { upf('ex', a); }, accent: '#16a34a', placeholder: 'e.g. What was the effect size?', empty: 'Auto-generated if left empty.' })),
        h('div', { key: 'mx' }, h('div', { className: 'field-label' }, 'Max papers to search (optional)'),
          h('input', { className: 'field', type: 'number', min: 1, max: 10000, step: 100, style: { width: 160, boxSizing: 'border-box' }, value: f.maxResults, placeholder: 'e.g. 1000', onChange: function (e) { upf('maxResults', e.target.value ? Math.min(10000, Math.max(1, parseInt(e.target.value, 10) || 0)) : ''); } }),
          h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 3 } }, 'How many papers Elicit retrieves for the review (up to 10000). Leave it blank and Elicit uses its small default of ~200 — so keep a number here for a broader review. Higher = more comprehensive but slower and more quota.')),
        h('div', { key: 'ck', style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8 } },
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.runFT, onChange: function (e) { upf('runFT', e.target.checked); } }), 'Run full-text screening stage ', h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, '(off = abstract-level only, faster)')),
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.genAbs, onChange: function (e) { upf('genAbs', e.target.checked); } }), 'Auto-generate extra abstract-screening criteria'),
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.genEx, onChange: function (e) { upf('genEx', e.target.checked); } }), 'Auto-generate extra extraction columns'),
          h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.useFig, onChange: function (e) { upf('useFig', e.target.checked); } }), 'Consult figures during extraction ', h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, '(higher quality, slower)'))),
        h('label', { key: 'gen', style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: f.gen, onChange: function (e) { upf('gen', e.target.checked); } }), 'Generate a full report at the end'),
        h('div', { key: 'ft2', style: { display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' } },
          err ? h('div', { style: { flex: 1, minWidth: 0, fontSize: 12, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)' } }, err) : null,
          h('button', { className: 'btn pri', disabled: !props.canEdit || busy || !f.q.trim(), onClick: create }, busy ? 'Starting…' : 'Start review'))
      ];
    }
    if (nd()) return srWorkspace();
    return h('div', { className: 'panel', style: { marginTop: 14 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('h3', { style: { margin: 0, flex: 1 } }, '🔬 Systematic Review Studio ', h('span', { style: { fontSize: 11.5, color: 'var(--faint)', fontWeight: 400 } }, '· from your Ideas → PRISMA')),
        props.canEdit ? h('button', { className: 'btn pri', style: { padding: '5px 11px', fontSize: 12.5 }, disabled: gen, onClick: generate }, gen ? '✨ Generating…' : '✨ Generate from Ideas') : null,
        props.canEdit ? h('button', { className: 'btn', style: { padding: '5px 11px', fontSize: 12.5 }, onClick: function () { fromCand.current = null; if (openForm) { setOpenForm(false); } else { setF({ q: '', protocol: '', abs: [], ft: [], ex: [], exclude: [], gen: true, genAbs: true, genEx: true, useFig: false, runFT: true, maxResults: '1000' }); setOpenForm(true); } } }, openForm ? 'Cancel' : '+ Manual review') : null),
      err ? h('div', { style: { fontSize: 12.5, color: /^✓/.test(err) ? 'var(--ok, #15803d)' : 'var(--danger, #b42318)', margin: '6px 0' } }, err) : null,
      backupEl(),
      // review-question cards from Ideas
      (cands && cands.length) ? h('div', { style: { marginTop: 4 } },
        h('div', { className: 'field-label' }, 'Review questions from your Ideas'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 6 } }, cands.map(candCard))
      ) : (cands !== null && !openForm) ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', margin: '6px 0' } }, 'No review questions yet — click “✨ Generate from Ideas” to draft systematic-review-ready questions (with PICO + criteria) from your project Ideas, then start one with a click.') : null,
      openForm ? h('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 } }, reviewFormEls()) : null,
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
    // LIVE: while a background Claude-backup study (PRStudyRunner) advances, re-render (pulse) and, if the SELECTED study is
    // the one running, reload its steps/papers so results stream in without a page reload.
    var lrS = useState(0), setLrTick = lrS[1];
    var loadRef = useRef(null), selRef2 = useRef(null); loadRef.current = loadStudy; selRef2.current = selId;
    useEffect(function () {
      return PRStudyRunner.subscribe(function () {
        if (!alive.current) return;
        setLrTick(function (x) { return x + 1; });
        var sid = selRef2.current;
        // keepCfg=true: this is a live progress reload of a RUNNING study — stream in steps/papers/review but do
        // NOT overwrite the local cfg (the user may be editing step-1 keywords/criteria while it runs).
        if (sid && PRStudyRunner.isStudyRunning(sid) && loadRef.current) loadRef.current(sid, true);
      });
    }, []);
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
    function loadStudy(id, keepCfg) {
      if (!id) { setSteps([]); setPapers([]); setPapersLoading(false); setReview(''); return; }
      loadReview(id);
      Promise.all([
        sb.from('research_study_steps').select('step,kind,config,status,cursor,total,counts').eq('study_id', id).order('step'),
        sb.from('research_study_papers').select('source_id,step,decision,reason,score,signals,overridden').eq('study_id', id)
      ]).then(function (r) {
        var st = (r[0] && r[0].data) || []; var pps = (r[1] && r[1].data) || []; setSteps(st); setPapers(pps); setPapersLoading(false);
        // keepCfg (live progress reload): don't clobber the user's in-progress cfg edits with the DB copy.
        if (!keepCfg) { var cs = st.filter(function (x) { return x.step === curStep; })[0]; if (cs && cs.config) setCfg(cs.config); }
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
    // reveal a specific study (a "Study" chip was clicked in the SR studio): select it + jump to its FURTHEST step
    // (cur_step — 4/Review when done, else the last completed stage), so the funnel opens where the study left off.
    useEffect(function () {
      var sid = props.openStudyId; if (!sid) return;
      setSelId(sid);
      var st = (props.studies || []).filter(function (x) { return x.id === sid; })[0];
      setCurStep((st && st.cur_step) || 1);
      if (props.onStudyOpened) props.onStudyOpened();
    }, [props.openStudyId]);
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
            return h('div', { key: s.id, className: PRStudyRunner.isStudyRunning(s.id) ? 'pulse-run' : null, onClick: editing ? null : function () { setSelId(s.id); setCurStep(s.cur_step || 1); }, style: { textAlign: 'left', maxWidth: 260, minWidth: 150, border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--surface-2)' : 'var(--surface)', borderRadius: 8, padding: '6px 10px', cursor: editing ? 'default' : 'pointer' } },
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
            doc.toc.length > 2 ? h('nav', { className: 'rv-toc doc-embed-toc' }, h('div', { className: 'rv-toc-h' }, 'Contents'), doc.toc.map(function (t) { return h('button', { key: t.id, className: 'rv-toc-i lvl' + t.level, onClick: function (e) { var root = (e.currentTarget.closest && e.currentTarget.closest('.doc-embed')) || document; var el = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(t.id) : t.id)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t.text); })) : null,
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
  var RMAP_TYPE = { idea: { ic: '💡', lab: 'Ötlet', tab: 'ideas' }, gap: { ic: '🕳️', lab: 'Kutatási rés', tab: 'gap' }, paper: { ic: '📄', lab: 'Cikk', tab: 'literature' }, study: { ic: '🔎', lab: 'Irodalom', tab: 'literature' }, review: { ic: '📝', lab: 'Áttekintés', tab: 'study' }, step: { ic: '🧪', lab: 'Protokoll-lépés', tab: 'protocol' }, venue: { ic: '🎯', lab: 'Folyóirat', tab: 'journal' }, section: { ic: '✍️', lab: 'Draft-szekció', tab: 'writing' }, dataset: { ic: '🗂️', lab: 'Adathalmaz', tab: 'data' }, file: { ic: '📎', lab: 'Fájl', tab: 'ideas' }, chat: { ic: '💬', lab: 'Beszélgetés', tab: 'ideas' }, figure: { ic: '🖼️', lab: 'Ábra', tab: 'literature' }, srq: { ic: '❓', lab: 'Review-kérdés', tab: 'study' }, sreview: { ic: '🔬', lab: 'Szisztematikus áttekintés', tab: 'study' } };
  // interactive-edge relation presets (migration-81). Each type is a full look-preset: color + line-style + arrow + default animation.
  // The two structural derived kinds (flow/cite) map to erd/idz and keep today's exact stroke for backward-compat.
  var EDGE_TYPES = {
    erd: { nm: 'Származás', verb: 'ered', col: 'var(--line-2, var(--muted))', line: 'dashed', arrow: 'ar', anim: 'flow' },
    idz: { nm: 'Idézet', verb: 'hivatkozik', col: 'var(--accent-tint)', line: 'dashed', arrow: '', anim: 'flow' },
    bem: { nm: 'Bemenete', verb: 'táplálja', col: '#0b93b8', line: 'solid', arrow: 'ar', anim: 'comet' },
    tam: { nm: 'Támogatja', verb: 'alátámasztja', col: '#17a34a', line: 'solid', arrow: 'ar', anim: 'pulse' },
    ell: { nm: 'Ellentmond', verb: 'cáfolja', col: '#db3b41', line: 'dashed', arrow: 'bl', anim: 'pingpong' },
    fug: { nm: 'Függőség', verb: 'előfeltétele', col: '#d1810b', line: 'solid', arrow: 'ar', anim: 'flow' },
    kap: { nm: 'Kapcsolódik', verb: 'kapcsolódik', col: '#8493ab', line: 'dotted', arrow: '', anim: 'calm' }
  };
  var EDGE_TYPE_ORDER = ['erd', 'idz', 'bem', 'tam', 'ell', 'fug', 'kap'];
  var EDGE_ANIMS = { flow: 'Áramlás', comet: 'Üstökös', pulse: 'Pulzus', draw: 'Rajzolódás', pingpong: 'Oda-vissza', calm: 'Nyugodt' };
  var EDGE_ANIM_ORDER = ['flow', 'comet', 'pulse', 'draw', 'pingpong', 'calm'];
  var EDGE_ANIM_SP = { flow: 1.7, comet: 1.5, pulse: 1.6, draw: 2.1, pingpong: 1.4, calm: 0 };   // per-animation default duration (s); the speed slider overrides it
  var EDGE_LINES = { solid: 'Folytonos', dashed: 'Szaggatott', dotted: 'Pontozott' };
  var EDGE_ARROWS = { '': 'nincs', ar: '→', bl: '⊣' };
  var EDGE_SWATCHES = ['#64748b', '#5b63e6', '#0b93b8', '#17a34a', '#db3b41', '#d1810b', '#8493ab'];
  function edgeDash(line) { return line === 'dashed' ? '7 6' : line === 'dotted' ? '2 6' : 'none'; }
  function PipelineCanvas(props) {
    var dS = useState(null), data = dS[0], setData = dS[1];   // null = loading
    var vS = useState({ tx: 30, ty: 18, k: 1 }), view = vS[0], setView = vS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var edS = useState(null), editing = edS[0], setEditing = edS[1];   // {spec} — the open edit dialog (P2)
    var efS = useState({}), eform = efS[0], setEform = efS[1];
    var bmS = useState(0), bump = bmS[0], setBump = bmS[1];   // reload after a save
    var rfS = useState(false), refreshing = rfS[0], setRefreshing = rfS[1];   // manual "re-render" — reload the map data
    function refreshMap() { setBump(function (x) { return x + 1; }); setRefreshing(true); setTimeout(function () { if (alive.current) setRefreshing(false); }, 700); }
    var fuS = useState({}), figUrls = fuS[0], setFigUrls = fuS[1];   // storage_path → signed URL (figure previews)
    var roS = useState(false), restoreOpen = roS[0], setRestoreOpen = roS[1];   // the "hidden figures" restore panel
    var nrS = useState(false), nodeRestoreOpen = nrS[0], setNodeRestoreOpen = nrS[1];   // the "hidden nodes" restore panel (migration-70)
    var figLoading = useRef({});
    // lazily sign the storage URLs for a set of figures (idempotent; in-flight guarded)
    function ensureFigUrls(figs) {
      var paths = (figs || []).map(function (f) { return f && f.storage_path; }).filter(function (pp) { return pp && !figUrls[pp] && !figLoading.current[pp]; });
      if (!paths.length) return;
      paths.forEach(function (pp) { figLoading.current[pp] = 1; });
      sb.storage.from('research-data').createSignedUrls(paths, 3600).then(function (r) {
        paths.forEach(function (pp) { delete figLoading.current[pp]; });
        if (!alive.current) return; var add = {}; ((r && r.data) || []).forEach(function (x) { if (x && x.signedUrl && x.path) add[x.path] = x.signedUrl; });
        if (Object.keys(add).length) setFigUrls(function (prev) { return Object.assign({}, prev, add); });
      }, function () { paths.forEach(function (pp) { delete figLoading.current[pp]; }); });
    }
    // curate: show/hide a figure on the Map (research_figures.on_map). Fire-and-forget; refresh on success.
    // Needs migration-69; the update silently no-ops if the column is absent (the Map just keeps showing all figures).
    function figSetOnMap(figId, val) { sb.from('research_figures').update({ on_map: val }).eq('id', figId).then(function (r) { if (!alive.current) return; if (!(r && r.error)) setBump(function (x) { return x + 1; }); }, function () { }); }
    var loS = useState(false), litOpen = loS[0], setLitOpen = loS[1];   // F4: expand the study funnel's paper nodes (collapsed by default)
    var mnS = useState(null), menu = mnS[0], setMenu = mnS[1];   // F1: node "generate from here" context menu {node,x,y}
    var rmadS = useState(null), radial = rmadS[0], setRadial = rmadS[1];   // radial quick-add menu on canvas double-click {sx,sy,wx,wy}
    var drpS = useState(null), drop = drpS[0], setDrop = drpS[1];   // the "it landed here" drop-pulse {sx,sy}
    var gbS = useState(false), genBusy = gbS[0], setGenBusy = gbS[1];
    var hgS = useState({}), hgt = hgS[0], setHgt = hgS[1];   // measured real card heights (id → px) → the no-overlap rule uses them, not an estimate
    var hgtRef = useRef({}); hgtRef.current = hgt;   // live mirror for the shared ResizeObserver callback (P2 height-fit)
    var rcS = useState([]), rcMsgs = rcS[0], setRcMsgs = rcS[1];   // F7: per-node refine-chat thread [{role,text}]
    var riS = useState(''), rcInput = riS[0], setRcInput = riS[1];
    var rbS = useState(false), rcBusy = rbS[0], setRcBusy = rbS[1];
    // Luma-style canvas assistant dock (bottom-right): quick pipeline commands + a free-text chat (research-chat)
    var dkS = useState(function () { try { return localStorage.getItem('pr-rmap-dock') !== '0'; } catch (e) { return true; } }), dkOpen = dkS[0], setDkOpen = dkS[1];
    var dmS = useState([{ role: 'ai', text: '👋 Canvas-asszisztens. Adj utasítást vagy kérdést, vagy használd a gyors-parancsokat lent — az eredmény megjelenik a térképen.' }]), dMsgs = dmS[0], setDMsgs = dmS[1];
    var diS = useState(''), dInput = diS[0], setDInput = diS[1];
    var dbS = useState(false), dBusy = dbS[0], setDBusy = dbS[1];
    var dmoS = useState('chat'), dkMode = dmoS[0], setDkMode = dmoS[1];   // dock mode: 'chat' | 'action' (protocol step from instruction)
    var dockRef = useRef(null);   // the open dock element (for edge-drag resize geometry)
    var ddS = useState(function () { try { return JSON.parse(localStorage.getItem('pr-rmap-dock-dim') || 'null'); } catch (e) { return null; } }), dkDim = ddS[0], setDkDim = ddS[1];   // user-resized {w,h} or null=default
    var dkDimRef = useRef(dkDim); dkDimRef.current = dkDim;   // latest dim for the drag mouseup persist (closure-stale otherwise)
    var dfS = useState(function () { try { return localStorage.getItem('pr-rmap-dock-full') === '1'; } catch (e) { return false; } }), dkFull = dfS[0], setDkFull = dfS[1];   // vertical-maximize toggle
    var recSt = useState(false), recOn = recSt[0], setRecOn = recSt[1];   // voice input active
    var recRef = useRef(null);
    var pxS = useState(null), proposal = pxS[0], setProposal = pxS[1];   // pending action proposed from the attached card (preview → confirm → execute)
    var rnS = useState(null), run = rnS[0], setRun = rnS[1];   // P1b: the project's active Autopilot run (live)
    var lyS = useState({}), layout = lyS[0], setLayout = lyS[1];   // saved free-drag positions (node_id → {x,y,hidden,pinned}); overrides the auto-layout + pins the card
    var mfS = useState(false), mapFlags = mfS[0], setMapFlags = mfS[1];   // migration-70 capability: pin/hide columns present → show that UI
    var cszS = useState(false), cardSizeCap = cszS[0], setCardSizeCap = cszS[1];   // migration-80 capability: card_w/card_h columns present → resizable cards
    var nrzS = useState(null), nrzLive = nrzS[0], setNrzLive = nrzS[1];   // in-flight card resize {id,w,h}
    var nrzRef = useRef(null);   // card-resize lifecycle guard
    var sizeGenS = useState(0), sizeGen = sizeGenS[0], setSizeGen = sizeGenS[1];   // bump to re-run no-overlap after a resize settles
    var dlS = useState(null), dlive = dlS[0], setDlive = dlS[1];   // the node currently being dragged {id,x,y} — follows the cursor 1:1
    var msS = useState({}), msel = msS[0], setMsel = msS[1];   // multi-selection: {node_id: true} (shift-click / marquee)
    var glS = useState(null), gLive = glS[0], setGLive = glS[1];   // group drag {dx,dy,base:{id:{x,y}},ids} — moves all msel together
    var mqS = useState(null), marquee = mqS[0], setMarquee = mqS[1];   // marquee rect in stage coords {x0,y0,x1,y1} while shift-dragging the background
    var gdrag = useRef(null);   // in-flight group-drag lifecycle guard
    var mqRef = useRef(null);   // in-flight marquee start point (stage coords)
    var frS = useState([]), frames = frS[0], setFrames = frS[1];   // Map frames (named regions / phase lanes) — migration-71
    var jpS = useState(null), justPlaced = jpS[0], setJustPlaced = jpS[1];   // node-ids just materialized into a frame (pulse cue); cleared after ~1.6s
    var bfS = useState(null), boundFrame = bfS[0], setBoundFrame = bfS[1];   // #2: the dock chat is bound to this frame → typed commands create objects INSIDE it
    var frcS = useState(false), framesCap = frcS[0], setFramesCap = frcS[1];   // migration-71 capability
    var flS = useState(null), frLive = flS[0], setFrLive = flS[1];   // in-flight frame move/resize live geometry {id,x,y,w,h}
    var frdrag = useRef(null);   // frame drag/resize lifecycle guard
    var fgS = useState({}), frGen = fgS[0], setFrGen = fgS[1];   // per-frame inline "generate here" input text
    var fgoS = useState({}), frGenOpen = fgoS[0], setFrGenOpen = fgoS[1];   // per-frame: is the inline-generate bar open (toggled from the title bar)
    var cmS = useState([]), comments = cmS[0], setComments = cmS[1];   // Map comments/annotations — migration-72
    var cmcS = useState(false), commentsCap = cmcS[0], setCommentsCap = cmcS[1];   // migration-72 capability
    var cmmS = useState(false), commentMode = cmmS[0], setCommentMode = cmmS[1];   // click-to-comment mode
    var cmpS = useState(null), composer = cmpS[0], setComposer = cmpS[1];   // {node_id}|{x,y} compose popover
    var cmtS = useState(''), cmText = cmtS[0], setCmText = cmtS[1];   // composer textarea
    var cmoS = useState(null), openThread = cmoS[0], setOpenThread = cmoS[1];   // open thread key: node_id or 'pin:'+commentId
    var cmHoverT = useRef(null);   // hover-card close timer — a comment pin opens its thread on hover; the timer keeps it open while moving to the popover
    var cmpanS = useState(false), cmPanelOpen = cmpanS[0], setCmPanelOpen = cmpanS[1];   // the all-comments side panel
    var pgS = useState([]), pages = pgS[0], setPages = pgS[1];   // Map pages (saved views) — migration-73
    var pgcS = useState(false), pagesCap = pgcS[0], setPagesCap = pgcS[1];   // migration-73 capability
    var apgS = useState(null), activePage = apgS[0], setActivePage = apgS[1];   // active page id or null (= full graph)
    var pthS = useState([]), paths = pthS[0], setPaths = pthS[1];   // Map story paths (presentations) — migration-79
    var pthcS = useState(false), pathsCap = pthcS[0], setPathsCap = pthcS[1];   // migration-79 capability
    var presMgrS = useState(false), presMgrOpen = presMgrS[0], setPresMgrOpen = presMgrS[1];   // the presentations manager panel
    var editPathS = useState(null), editPath = editPathS[0], setEditPath = editPathS[1];   // the path id whose beat-editor is open
    var pathWr = useRef({});   // per-path debounced write state + last-write ts (throttles keystroke writes; guards the realtime echo)
    var sfcS = useState(false), stepFlagsCap = sfcS[0], setStepFlagsCap = sfcS[1];   // migration-75 capability: step assignee/sign-off columns present
    var htS = useState({}), hiddenTypes = htS[0], setHiddenTypes = htS[1];   // temporary per-type visibility filter {node_type: true = hidden} (client-only, localStorage)
    var tfoS = useState(false), typeFilterOpen = tfoS[0], setTypeFilterOpen = tfoS[1];   // the type-filter popover
    var onlS = useState([]), online = onlS[0], setOnline = onlS[1];   // realtime presence: who else is viewing this Map
    var curS = useState({}), cursors = curS[0], setCursors = curS[1];   // live cursors from other users {id:{name,wx,wy,sel,ts,color}}
    var chRef = useRef(null);   // the Map realtime channel (for broadcasting my cursor)
    var lastCur = useRef(0);   // cursor-broadcast throttle timestamp
    var pvS = useState({}), peerViews = pvS[0], setPeerViews = pvS[1];   // other users' viewports {id:{tx,ty,k}} (for follow-mode)
    var folS = useState(null), following = folS[0], setFollowing = folS[1];   // id of the user I'm following (viewport-synced) or null
    var ccS = useState({}), cursorChats = ccS[0], setCursorChats = ccS[1];   // transient cursor-chat bubbles {id:{text,ts}}
    var ccInS = useState(null), ccInput = ccInS[0], setCcInput = ccInS[1];   // my open cursor-chat input text (null = closed)
    var lastView = useRef(0);   // view-broadcast throttle timestamp
    var followingRef = useRef(null);   // mirror of `following` for use inside event handlers
    // Prezi-mód (Fázis 1): fly-to camera tween + in-canvas focus overlay (zoom INTO a card → its panel opens in place)
    var fcS = useState(null), focus = fcS[0], setFocus = fcS[1];   // {nodeId, tab, ref, ...focusProps} or null
    var rafRef = useRef(null);   // requestAnimationFrame id of the running camera tween
    var returnView = useRef(null);   // the view to fly back to on exitFocus
    var tourS = useState(null), tour = tourS[0], setTour = tourS[1];   // {list:[pages], i, playing} guided-tour state (Lap-based in Fázis 1)
    var tourT = useRef(null);   // tour autoplay timer
    var viewRef = useRef(view); viewRef.current = view;   // live mirror of `view` so a tween always starts from the true current camera
    var armedRef = useRef(null);   // the card "armed to enter" at deep zoom (Fázis 3) — Enter dives into it
    var winsS = useState([]), windows = winsS[0], setWindows = winsS[1];   // 5th LOD: embedded screen-space panel windows [{id,tab,t,title,ref,fp,dx,dy,w,h,z}]
    var winDragRef = useRef(null);   // window move/resize lifecycle guard
    var selEdgeS = useState(null), selEdge = selEdgeS[0], setSelEdge = selEdgeS[1];   // interactive edges (migration-81): selected edge_key — mutually exclusive with node `sel`
    var eovS = useState({}), edgeOv = eovS[0], setEdgeOv = eovS[1];   // edge_key → {kind,color,anim,line_style,arrow,width,label} override rows
    var edgeCapS = useState(false), edgesCap = edgeCapS[0], setEdgesCap = edgeCapS[1];   // research_map_edges migration capability
    var espcS = useState(false), edgeSpeedCap = espcS[0], setEdgeSpeedCap = espcS[1];   // migration-82 capability: research_map_edges.speed column present → speed slider
    var hetS = useState({}), hiddenEdgeTypes = hetS[0], setHiddenEdgeTypes = hetS[1];   // P1: per-relation-type edge visibility filter {kind: true = hidden} (client-only, localStorage)
    var lfS = useState(null), linkFrom = lfS[0], setLinkFrom = lfS[1];   // P2 link-mode: the source node id while drawing a manual edge (null = off)
    var fnS = useState({}), floatNat = fnS[0], setFloatNat = fnS[1];   // viewport-fit P1: measured NATURAL body height of reflowing floats {key: px} (widen-not-tall)
    var floatNatRef = useRef({}); floatNatRef.current = floatNat;   // live mirror for the measure callback
    var vpgS = useState(0), vpGen = vpgS[0], setVpGen = vpgS[1];   // viewport-fit P2: bumped when the STAGE resizes → re-render so all floats + the card cap re-fit
    var ldS = useState(null), linkDrag = ldS[0], setLinkDrag = ldS[1];   // P2 drag-to-connect: {from, wx, wy, over} while dragging a rubber-band edge from a card port
    var linkDragRef = useRef(null);   // link-drag lifecycle guard
    var eovRef = useRef(null);   // in-flight edge-edit key (realtime self-echo guard)
    var stagesBusy = useRef(false);   // re-entry guard for autoLayoutStages (prevents duplicate phase frames on rapid double-invoke)
    var memS = useState(null), members = memS[0], setMembers = memS[1];   // project collaborators (migration-74) — null until loaded/capable
    var shareS = useState(false), shareOpen = shareS[0], setShareOpen = shareS[1];   // the Share/Collaborators modal
    var invqS = useState(''), invQ = invqS[0], setInvQ = invqS[1];   // invite: user search query
    var invrS = useState([]), invRes = invrS[0], setInvRes = invrS[1];   // invite: search results
    var invrolS = useState('viewer'), invRole = invrolS[0], setInvRole = invrolS[1];   // invite: role to grant
    var drag = useRef(null), stageRef = useRef(null), alive = useRef(true), bumpT = useRef(null), driving = useRef(false), mapDriver = useRef(null), ndrag = useRef(null), selRef = useRef(null), refBusy = useRef({}), dcRef = useRef(null), dScroll = useRef(null);
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
      // load the saved free-drag layout (node_id → {x,y,hidden,pinned,card_w,card_h}); the Map overrides auto-layout.
      // 3-tier graceful probe: migration-80 (card size) → migration-70 (pin/hide) → basic. Sets caps accordingly.
      sb.from('research_map_layout').select('node_id,x,y,hidden,pinned,card_w,card_h').eq('project_id', pid).then(function (r) {
        if (!alive.current) return;
        if (r && r.error) {
          sb.from('research_map_layout').select('node_id,x,y,hidden,pinned').eq('project_id', pid).then(function (r2) {
            if (!alive.current) return;
            if (r2 && r2.error) { sb.from('research_map_layout').select('node_id,x,y').eq('project_id', pid).then(function (r3) { if (!alive.current) return; var m = {}; ((r3 && r3.data) || []).forEach(function (row) { m[row.node_id] = { x: row.x, y: row.y }; }); setLayout(m); }); return; }
            setMapFlags(true); var m2 = {}; ((r2 && r2.data) || []).forEach(function (row) { m2[row.node_id] = { x: row.x, y: row.y, hidden: !!row.hidden, pinned: !!row.pinned }; }); setLayout(m2);
          });
          return;
        }
        setMapFlags(true); setCardSizeCap(true);
        var m = {}; ((r && r.data) || []).forEach(function (row) { m[row.node_id] = { x: row.x, y: row.y, hidden: !!row.hidden, pinned: !!row.pinned, card_w: row.card_w, card_h: row.card_h }; }); setLayout(m);
      });
      // load Map frames (named regions) — graceful: pre-migration-71 the table is absent → framesCap stays false, no frames UI
      sb.from('research_map_frames').select('id,title,x,y,w,h,color').eq('project_id', pid).then(function (r) {
        if (!alive.current) return; if (r && r.error) return; setFramesCap(true); setFrames((r && r.data) || []);
      });
      // load Map comments — graceful: pre-migration-72 the table is absent → commentsCap stays false, no comments UI
      sb.from('research_map_comments').select('id,node_id,x,y,body,author,resolved,created_at').eq('project_id', pid).order('created_at', { ascending: true }).then(function (r) {
        if (!alive.current) return; if (r && r.error) return; setCommentsCap(true); setComments((r && r.data) || []);
      });
      // load Map pages (saved views) — graceful: pre-migration-73 the table is absent → pagesCap stays false, no page bar
      sb.from('research_map_pages').select('id,name,tx,ty,k,only_pinned,ord').eq('project_id', pid).order('ord', { ascending: true }).order('created_at', { ascending: true }).then(function (r) {
        if (!alive.current) return; if (r && r.error) return; setPagesCap(true); setPages((r && r.data) || []);
      });
      // load Map story paths (presentations) — graceful: pre-migration-79 → pathsCap stays false, no presentation UI
      sb.from('research_map_paths').select('id,name,ord,steps').eq('project_id', pid).order('ord', { ascending: true }).order('created_at', { ascending: true }).then(function (r) {
        if (!alive.current) return; if (r && r.error) return; setPathsCap(true); setPaths((r && r.data) || []);
      });
      // load Map edge style overrides — 2-tier graceful probe: migration-82 (speed col) → migration-81 (base) → absent.
      // pre-migration-81 both selects error → edgesCap stays false → edges render as today.
      sb.from('research_map_edges').select('edge_key,from_id,to_id,manual,kind,color,anim,line_style,arrow,width,label,speed').eq('project_id', pid).then(function (r) {
        if (!alive.current) return;
        if (r && r.error) {
          sb.from('research_map_edges').select('edge_key,from_id,to_id,manual,kind,color,anim,line_style,arrow,width,label').eq('project_id', pid).then(function (r2) {
            if (!alive.current) return; if (r2 && r2.error) return; setEdgesCap(true);
            var m2 = {}; ((r2 && r2.data) || []).forEach(function (row) { m2[row.edge_key] = row; }); setEdgeOv(m2);
          });
          return;
        }
        setEdgesCap(true); setEdgeSpeedCap(true);
        var m = {}; ((r && r.data) || []).forEach(function (row) { m[row.edge_key] = row; }); setEdgeOv(m);
      });
      var me = props.viewer || {}, myKey = props.viewerId || ('anon-' + pid);
      var ch = sb.channel('rmap-ap:' + pid, { config: { presence: { key: myKey } } })
        .on('broadcast', { event: 'cursor' }, function (m) {
          if (!alive.current) return; var pl = m && m.payload; if (!pl || !pl.id || pl.id === props.viewerId) return;
          setCursors(function (C) { var n = Object.assign({}, C); n[pl.id] = { name: pl.name, wx: pl.wx, wy: pl.wy, sel: pl.sel, color: userColor(pl.id), ts: Date.now() }; return n; });
        })
        .on('broadcast', { event: 'view' }, function (m) {
          if (!alive.current) return; var pl = m && m.payload; if (!pl || !pl.id || pl.id === props.viewerId) return;
          setPeerViews(function (V) { var n = Object.assign({}, V); n[pl.id] = { tx: pl.tx, ty: pl.ty, k: pl.k }; return n; });
        })
        .on('broadcast', { event: 'cursorchat' }, function (m) {
          if (!alive.current) return; var pl = m && m.payload; if (!pl || !pl.id || pl.id === props.viewerId) return;
          setCursorChats(function (C) { var n = Object.assign({}, C); if (pl.text) n[pl.id] = { text: String(pl.text).slice(0, 120), ts: Date.now() }; else delete n[pl.id]; return n; });
        })
        .on('presence', { event: 'sync' }, function () {
          if (!alive.current) return;
          var st = ch.presenceState(), seen = {}, list = [];
          Object.keys(st).forEach(function (k) { (st[k] || []).forEach(function (m) { var id = m.id || k; if (!seen[id]) { seen[id] = 1; list.push({ id: id, name: m.name, avatar: m.avatar, self: id === props.viewerId }); } }); });
          setOnline(list);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_autopilot_runs', filter: 'project_id=eq.' + pid }, function (p) { if (alive.current && p.new) { setRun(p.new); ensureDrive(p.new); bumpSoon(); } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'research_autopilot_events', filter: 'project_id=eq.' + pid }, function () { if (alive.current) bumpSoon(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_map_layout', filter: 'project_id=eq.' + pid }, function (p) {
          if (!alive.current) return;
          if (p.eventType === 'DELETE') { var oid = p.old && p.old.node_id; if (oid) setLayout(function (L) { var m = Object.assign({}, L); delete m[oid]; return m; }); return; }
          var nw = p.new; if (!nw || !nw.node_id) return;
          if (ndrag.current && ndrag.current.id === nw.node_id) return;   // ignore the echo of my own in-flight drag
          if (nrzRef.current && nrzRef.current.id === nw.node_id) return;   // ignore the echo of my own in-flight card resize
          setLayout(function (L) { var m = Object.assign({}, L); m[nw.node_id] = { x: nw.x, y: nw.y, hidden: !!nw.hidden, pinned: !!nw.pinned, card_w: nw.card_w, card_h: nw.card_h }; return m; });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_map_edges', filter: 'project_id=eq.' + pid }, function (p) {
          if (!alive.current) return;
          if (p.eventType === 'DELETE') { var ok = p.old && p.old.edge_key; if (ok) setEdgeOv(function (O) { var m = Object.assign({}, O); delete m[ok]; return m; }); return; }
          var ne = p.new; if (!ne || !ne.edge_key) return;
          if (eovRef.current && eovRef.current === ne.edge_key) return;   // ignore the echo of my own in-flight edge edit
          setEdgeOv(function (O) { var m = Object.assign({}, O); m[ne.edge_key] = ne; return m; });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_map_frames', filter: 'project_id=eq.' + pid }, function (p) {
          if (!alive.current) return;
          if (p.eventType === 'DELETE') { var oid = p.old && p.old.id; if (oid) setFrames(function (F) { return F.filter(function (f) { return f.id !== oid; }); }); return; }
          var nf = p.new; if (!nf || !nf.id) return;
          if (frdrag.current && frdrag.current.id === nf.id) return;   // ignore the echo of my own in-flight frame drag
          setFrames(function (F) { var found = false, out = F.map(function (f) { if (f.id === nf.id) { found = true; return { id: nf.id, title: nf.title, x: nf.x, y: nf.y, w: nf.w, h: nf.h, color: nf.color }; } return f; }); if (!found) out.push({ id: nf.id, title: nf.title, x: nf.x, y: nf.y, w: nf.w, h: nf.h, color: nf.color }); return out; });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_map_comments', filter: 'project_id=eq.' + pid }, function (p) {
          if (!alive.current) return;
          if (p.eventType === 'DELETE') { var oid = p.old && p.old.id; if (oid) setComments(function (C) { return C.filter(function (c) { return c.id !== oid; }); }); return; }
          var nc = p.new; if (!nc || !nc.id) return;
          setComments(function (C) { var found = false, out = C.map(function (c) { if (c.id === nc.id) { found = true; return nc; } return c; }); if (!found) out.push(nc); return out; });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_map_pages', filter: 'project_id=eq.' + pid }, function (p) {
          if (!alive.current) return;
          if (p.eventType === 'DELETE') { var oid = p.old && p.old.id; if (oid) { setPages(function (P) { return P.filter(function (x) { return x.id !== oid; }); }); setActivePage(function (a) { return a === oid ? null : a; }); } return; }
          var np = p.new; if (!np || !np.id) return;
          setPages(function (P) { var found = false, out = P.map(function (x) { if (x.id === np.id) { found = true; return { id: np.id, name: np.name, tx: np.tx, ty: np.ty, k: np.k, only_pinned: np.only_pinned, ord: np.ord }; } return x; }); if (!found) out.push({ id: np.id, name: np.name, tx: np.tx, ty: np.ty, k: np.k, only_pinned: np.only_pinned, ord: np.ord }); return out; });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_map_paths', filter: 'project_id=eq.' + pid }, function (p) {
          if (!alive.current) return;
          if (p.eventType === 'DELETE') { var oid = p.old && p.old.id; if (oid) setPaths(function (P) { return P.filter(function (x) { return x.id !== oid; }); }); return; }
          var np = p.new; if (!np || !np.id) return;
          var wg = pathWr.current[np.id]; if (wg && (wg.t || (wg.ts && Date.now() - wg.ts < 1500))) return;   // ignore the echo of my own in-flight/just-committed write (avoids flicker)
          setPaths(function (P) { var found = false, out = P.map(function (x) { if (x.id === np.id) { found = true; return { id: np.id, name: np.name, ord: np.ord, steps: np.steps }; } return x; }); if (!found) out.push({ id: np.id, name: np.name, ord: np.ord, steps: np.steps }); return out; });
        })
        .on('broadcast', { event: 'story_beat' }, function (m) {
          if (!alive.current) return; var pl = m && m.payload; if (!pl || pl.id === props.viewerId) return;
          // a presenter broadcasts the target of the current beat; audience flies there locally (bandwidth-cheap)
          if (pl.tx != null) flyTo({ tx: pl.tx, ty: pl.ty, k: pl.k }, { ms: 620 });
          setTour(function (t) { return { follow: true, name: pl.name || 'Bemutató', caption: pl.caption || '', i: pl.i, total: pl.total, playing: false, beats: [] }; });
        })
        .subscribe(function (status) { if (status === 'SUBSCRIBED' && props.viewerId) { try { ch.track({ id: props.viewerId, name: me.name || 'Kolléga', avatar: me.avatar || null }); } catch (e) { } } });
      chRef.current = ch;
      // prune stale remote cursors (a user who left / went idle)
      var prune = setInterval(function () {
        if (!alive.current) return; var now = Date.now();
        setCursors(function (C) { var n = {}, changed = false; Object.keys(C).forEach(function (k) { if (now - C[k].ts < 6000) n[k] = C[k]; else changed = true; }); return changed ? n : C; });
        setCursorChats(function (C) { var n = {}, changed = false; Object.keys(C).forEach(function (k) { if (now - C[k].ts < 7000) n[k] = C[k]; else changed = true; }); return changed ? n : C; });
      }, 3000);
      return function () { clearInterval(prune); chRef.current = null; try { sb.removeChannel(ch); } catch (e) { } };
    }, [props.projectId]);
    useEffect(function () { loadMembers(); }, [props.projectId]);   // collaborators (graceful: null pre-migration-74)
    useEffect(function () { try { var v = JSON.parse(localStorage.getItem('pr-rmap-types:' + props.projectId) || '{}'); setHiddenTypes(v && typeof v === 'object' ? v : {}); } catch (e) { setHiddenTypes({}); } }, [props.projectId]);   // per-project type filter
    useEffect(function () { try { var v = JSON.parse(localStorage.getItem('pr-rmap-etypes:' + props.projectId) || '{}'); setHiddenEdgeTypes(v && typeof v === 'object' ? v : {}); } catch (e) { setHiddenEdgeTypes({}); } }, [props.projectId]);   // per-project edge-relation filter (P1)
    // viewport-fit P2: re-fit every open float + the card cap when the STAGE box resizes (window resize / sidebar collapse).
    // Pan/zoom already re-render via `view`; only a size change without a view change needs this. Bumping vpGen never resizes
    // the stage, so there is no observe→setState loop.
    useEffect(function () {
      var st = stageRef.current; if (!st || typeof ResizeObserver === 'undefined') return;
      var ro = new ResizeObserver(function () { if (alive.current) setVpGen(function (x) { return (x + 1) % 1000000; }); });
      ro.observe(st); return function () { ro.disconnect(); };
    }, []);
    useEffect(function () { followingRef.current = following; }, [following]);
    // broadcast my viewport (throttled) so followers can mirror it — but NOT while I'm following someone (avoids echo loops)
    useEffect(function () {
      if (!chRef.current || !props.viewerId || online.length <= 1 || following) return;
      var now = Date.now(); if (now - lastView.current < 120) { var t = setTimeout(function () { if (chRef.current && !followingRef.current) { try { chRef.current.send({ type: 'broadcast', event: 'view', payload: { id: props.viewerId, tx: view.tx, ty: view.ty, k: view.k } }); } catch (e) { } } }, 130); return function () { clearTimeout(t); }; }
      lastView.current = now;
      try { chRef.current.send({ type: 'broadcast', event: 'view', payload: { id: props.viewerId, tx: view.tx, ty: view.ty, k: view.k } }); } catch (e) { }
    }, [view, online.length, following]);
    // while following someone, mirror their viewport as it arrives
    useEffect(function () {
      if (!following) return; var pv = peerViews[following]; if (!pv) return;
      setView(function (v) { return (v.tx === pv.tx && v.ty === pv.ty && v.k === pv.k) ? v : { tx: pv.tx, ty: pv.ty, k: pv.k }; });
    }, [following, peerViews]);
    // keyboard: Esc closes focus / stops a tour; ←/→/Space navigate a tour; Enter enters an armed (deep-zoomed) card
    useEffect(function () {
      function typing(el) { if (!el) return false; var tg = el.tagName || ''; return tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || el.isContentEditable; }
      function onKey(e) {
        if (e.key === 'Escape') { setRadial(null); if (tour) tourStop(); else if (focus) exitFocus(); else { setLinkFrom(null); setSelEdge(null); } }   // Esc closes the radial add-menu + cancels link-mode/edge selection
        else if (tour && tour.beats && !typing(e.target)) { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); tourNext(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); tourPrev(); } }
        else if (e.key === 'Enter' && !focus && !tour && armedRef.current && !typing(e.target)) { e.preventDefault(); enterNode(armedRef.current); }   // armedRef is null while a modal is open (guarded at compute)
      }
      window.addEventListener('keydown', onKey);
      return function () { window.removeEventListener('keydown', onKey); };
    }, [focus, tour]);
    useEffect(function () { return function () { cancelFly(); if (tourT.current) clearTimeout(tourT.current); }; }, []);   // stop the tween/tour timer on unmount
    useEffect(function () {   // invite user-search (debounced), only while the Share modal is open
      if (!shareOpen || !invQ.trim()) { setInvRes([]); return; }
      var t = setTimeout(function () { sb.rpc('pr_search_users', { q: invQ.trim() }).then(function (r) { if (alive.current) setInvRes((r && r.data) || []); }); }, 300);
      return function () { clearTimeout(t); };
    }, [invQ, shareOpen]);
    function approveGate() { if (run) sb.from('research_autopilot_runs').update({ status: 'running', gate: null, updated_at: new Date().toISOString() }).eq('id', run.id); }
    useEffect(function () {
      var pid = props.projectId;
      Promise.all([
        sb.from('research_ideas').select('id,question,hypothesis,rationale,novelty,status,source,gap_type,evidence,addressed_by_idea_id').eq('project_id', pid).neq('status', 'rejected').order('created_at', { ascending: true }).limit(24).then(function (r) { return (r && r.error) ? sb.from('research_ideas').select('id,question,hypothesis,rationale,novelty,status,source').eq('project_id', pid).neq('status', 'rejected').order('created_at', { ascending: true }).limit(24) : r; }),   // self-gate: on a missing-gap-column error, resolve to the base-column select so ideas never vanish pre-migration
        sb.from('research_studies').select('id,idea_id,title,question,status').eq('project_id', pid).order('created_at', { ascending: true }),
        sb.from('research_sources').select('id,title,venue,cited_by,year,screening,url').eq('project_id', pid).order('cited_by', { ascending: false, nullsFirst: false }).limit(10),
        sb.from('research_sources').select('id', { count: 'exact', head: true }).eq('project_id', pid),
        sb.from('research_sources').select('id', { count: 'exact', head: true }).eq('project_id', pid).eq('screening', 'include'),
        sb.from('research_protocols').select('id,title,status,idea_id').eq('project_id', pid).neq('status', 'archived').order('created_at', { ascending: false }).limit(1),
        sb.from('research_journal_picks').select('id,title,status,npi_level').eq('project_id', pid),
        sb.from('research_files').select('id,path,size').eq('project_id', pid).or('path.like.writing/%,path.like.studies/%'),
        // F5 — multi-modal nodes: datasets, uploaded/material files (NOT writing/studies), chat threads, paper figures
        sb.from('research_datasets').select('id,name,source,status,size_bytes,notes').eq('project_id', pid).order('created_at', { ascending: true }).limit(16),
        sb.from('research_files').select('id,path,size,source').eq('project_id', pid).not('path', 'like', 'writing/%').not('path', 'like', 'studies/%').order('updated_at', { ascending: false }).limit(16),
        sb.from('research_chats').select('id,title,updated_at').eq('project_id', pid).order('updated_at', { ascending: false }).limit(8),
        sb.from('research_figures').select('id,source_id,fig_label,caption,storage_path').eq('project_id', pid).eq('hidden', false).order('created_at', { ascending: true }).limit(16),
        // SR/Elicit provenance: the "Study basis" review-question candidates (linked to their idea) + the launched Elicit reviews
        sb.from('research_sr_candidates').select('id,idea_id,question,launched_job_id').eq('project_id', pid).eq('dismissed', false).order('created_at', { ascending: true }).limit(16),
        sb.from('elicit_jobs').select('id,research_question,status,result_title').eq('project_id', pid).eq('kind', 'sysreview').order('created_at', { ascending: true }).limit(16),
        // figures the user REMOVED from the Map (on_map=false) — for the restore panel. Graceful: pre-migration-69 the
        // column is absent → this query errors → [] → no filtering, no panel (the Map shows all figures as before).
        sb.from('research_figures').select('id,source_id,fig_label,caption,storage_path').eq('project_id', pid).eq('hidden', false).eq('on_map', false).order('created_at', { ascending: true }).limit(30)
      ]).then(function (r) {
        if (!alive.current) return;
        var base = { ideas: (r[0].data) || [], studies: (r[1].data) || [], topSrc: (r[2].data) || [], srcTotal: r[3].count || 0, inclTotal: r[4].count || 0, protocol: (r[5].data && r[5].data[0]) || null, journals: (r[6].data) || [], wfiles: (r[7].data) || [], datasets: (r[8] && r[8].data) || [], mfiles: (r[9] && r[9].data) || [], chats: (r[10] && r[10].data) || [], figures: (r[11] && r[11].data) || [], srcands: (r[12] && r[12].data) || [], sreviews: (r[13] && r[13].data) || [] };
        // remove Map-hidden figures (on_map=false) client-side + keep them for the restore panel
        var hiddenFigs = (r[14] && !r[14].error && r[14].data) ? r[14].data : []; var hidSet = {}; hiddenFigs.forEach(function (x) { hidSet[x.id] = 1; });
        base.figures = base.figures.filter(function (f) { return !hidSet[f.id]; }); base.hiddenFigs = hiddenFigs;
        if (base.protocol) {
          // probe the migration-75 columns (assignee/sign-off); on error fall back to the basic select
          sb.from('research_protocol_steps').select('id,ord,title,kind,status,needs_approval,assignee_id,signed_off_by,signed_off_at').eq('protocol_id', base.protocol.id).order('ord', { ascending: true }).then(function (sr) {
            if (!alive.current) return;
            if (sr && sr.error) { sb.from('research_protocol_steps').select('id,ord,title,kind,status,needs_approval').eq('protocol_id', base.protocol.id).order('ord', { ascending: true }).then(function (sr2) { if (alive.current) setData(Object.assign(base, { steps: (sr2.data) || [] })); }); return; }
            setStepFlagsCap(true); setData(Object.assign(base, { steps: (sr.data) || [] }));
          });
        }
        else setData(Object.assign(base, { steps: [] }));
      }, function () { if (alive.current) setData({ ideas: [], studies: [], topSrc: [], srcTotal: 0, inclTotal: 0, protocol: null, journals: [], wfiles: [], steps: [], datasets: [], mfiles: [], chats: [], figures: [], srcands: [], sreviews: [], hiddenFigs: [] }); });
    }, [props.projectId, bump]);
    // measure each card's REAL rendered height after paint → feed the no-overlap rule with true heights (estimates
    // undershoot long-title cards, e.g. the H1/H2 hypotheses, leaving residual overlap). Converges in one extra render.
    useEffect(function () {
      var st = stageRef.current; if (!st || !st.querySelectorAll) return;
      var els = st.querySelectorAll('.rmap-node[data-nid]'), m = {}, changed = false;
      for (var i = 0; i < els.length; i++) { var id = els[i].getAttribute('data-nid'), hh = els[i].offsetHeight; if (hh) { m[id] = hh; if (Math.abs((hgt[id] || 0) - hh) > 2) changed = true; } }
      if (Object.keys(m).length !== Object.keys(hgt).length) changed = true;
      if (changed) setHgt(m);
    }, [data, bump, litOpen, sizeGen]);   // re-measure when the node set/content changes or a card was resized/reset — not on pan/zoom/select
    // P2 height-fit: a SHARED ResizeObserver catches ASYNC card-height changes the deps-based measure misses — chiefly a
    // figure thumbnail that loads after the URL resolves (which grows the card) — so the no-overlap rule uses the true
    // height and figure cards do not overlap their neighbours once the image paints. One observer for all cards.
    useEffect(function () {
      var st = stageRef.current; if (!st || typeof ResizeObserver === 'undefined') return;
      var ro = new ResizeObserver(function (entries) {
        if (nrzRef.current) return;   // a manual card resize drives size directly — don't fight it
        var m = null;
        for (var i = 0; i < entries.length; i++) { var t = entries[i].target, id = t.getAttribute && t.getAttribute('data-nid'); if (!id) continue; var hh = t.offsetHeight; if (hh && Math.abs((hgtRef.current[id] || 0) - hh) > 2) { if (!m) m = Object.assign({}, hgtRef.current); m[id] = hh; } }
        if (m && alive.current) { hgtRef.current = m; setHgt(m); }
      });
      var els = st.querySelectorAll('.rmap-node[data-nid]');
      for (var i = 0; i < els.length; i++) ro.observe(els[i]);
      return function () { ro.disconnect(); };
    }, [data, bump, litOpen, sizeGen]);   // re-observe the current card set (same triggers as the measure); RO then catches async growth
    // F7: the refine-chat thread is per-node → clear it whenever the selection changes; selRef tracks the live selection
    // so an in-flight refine callback knows whether the user is still on the node it was started from.
    useEffect(function () { setRcMsgs([]); setRcInput(''); setRcBusy(!!refBusy.current[sel]); selRef.current = sel; }, [sel]);
    useEffect(function () { var el = dScroll.current; if (el) el.scrollTop = el.scrollHeight; }, [dMsgs.length, dBusy, dkOpen]);   // keep the dock scrolled to the latest message

    // BUILT-IN RULE (new-card placement only): a freshly materialized card must never spawn on top of an existing one.
    // Iteratively push apart overlapping cards along the least-overlap axis, using each card's measured height (n._h).
    // `pinned` = cards the user has explicitly placed (saved layout) or is currently dragging — these are FIXED
    // obstacles: a movable card is pushed fully clear of a pinned one, two pinned cards are left as-is (the user is
    // allowed to overlap them on purpose), and two movable cards split the push. So the user's own arrangement is
    // never disturbed; only never-placed cards auto-tuck into free space.
    function separateNodes(N, pinned) {
      var PX = 16, PY = 14;
      for (var it = 0; it < 60; it++) {
        var moved = false;
        for (var i = 0; i < N.length; i++) for (var j = i + 1; j < N.length; j++) {
          var a = N[i], b = N[j], pa = !!(pinned && pinned[a.id]), pb = !!(pinned && pinned[b.id]);
          if (pa && pb) continue;   // both user-placed → leave any overlap alone (deliberate)
          var ha = a._h || 78, hb = b._h || 78, wa = a._w || 204, wb = b._w || 204;
          var dx = (b.x + wb / 2) - (a.x + wa / 2), dy = (b.y + hb / 2) - (a.y + ha / 2);
          var ox = (wa / 2 + wb / 2 + PX) - Math.abs(dx), oy = (ha / 2 + hb / 2 + PY) - Math.abs(dy);
          if (ox > 0.5 && oy > 0.5) {
            moved = true;
            if (ox <= oy) { var sx = (dx >= 0 ? 1 : -1) * ox; if (pa) b.x += sx; else if (pb) a.x -= sx; else { a.x -= sx / 2; b.x += sx / 2; } }
            else { var sy = (dy >= 0 ? 1 : -1) * oy; if (pa) b.y += sy; else if (pb) a.y -= sy; else { a.y -= sy / 2; b.y += sy / 2; } }
          }
        }
        if (!moved) break;
      }
    }
    function graph() {
      var d = data, N = [], E = [];
      (d.ideas || []).forEach(function (x) {
        if (x.source === 'gap') {   // research-gap node (migration-83): distinct 🕳️ type, wedged between literature and ideas
          var gt = gapType(x.gap_type || 'knowledge');
          N.push({ id: 'i' + x.id, t: 'gap', ph: 0, title: x.question || 'Kutatási rés', m: { Típus: gt.lab, Újdonság: (x.novelty != null ? x.novelty + ' / 100' : '—'), Bizonyíték: (Array.isArray(x.evidence) ? x.evidence.length : 0) + ' forrás' }, ref: x });
          if (x.addressed_by_idea_id && (d.ideas || []).some(function (y) { return y.id === x.addressed_by_idea_id; })) E.push(['i' + x.id, 'i' + x.addressed_by_idea_id]);   // gap → the idea it spawned
          if (litOpen && Array.isArray(x.evidence)) x.evidence.forEach(function (ev) { var sid = ev && ev.source_id; if (sid && (d.topSrc || []).some(function (s) { return s.id === sid; })) E.push(['p' + sid, 'i' + x.id]); });   // sources that reveal the gap
        } else {
          N.push({ id: 'i' + x.id, t: 'idea', ph: 0, title: x.question || 'Ötlet', m: { Novelty: (x.novelty != null ? x.novelty + ' / 100' : '—'), Hipotézis: x.hypothesis || '—' }, ref: x });
        }
      });
      var hasLit = d.srcTotal > 0 || d.studies.length;
      if (hasLit) {
        N.push({ id: 'lit', t: 'study', ph: 1, title: (d.studies[0] && d.studies[0].title) || 'Irodalom', m: { Források: String(d.srcTotal), Included: String(d.inclTotal) }, ref: d.studies[0] || null, pcount: d.topSrc.length });
        if (litOpen) d.topSrc.forEach(function (s) { N.push({ id: 'p' + s.id, t: 'paper', ph: 1, title: s.title || 'Cikk', m: { Venue: s.venue || '—', Év: String(s.year || '—'), Idézettség: String(s.cited_by || 0) }, dec: s.screening, ref: s }); E.push(['lit', 'p' + s.id]); });
        var linked = false;
        d.studies.forEach(function (st) { if (st.idea_id && (d.ideas || []).some(function (x) { return x.id === st.idea_id; })) { E.push(['i' + st.idea_id, 'lit']); linked = true; } });   // only when the idea node actually exists, else `linked` would suppress the ideas[0] fallback and orphan lit
        if (!linked && d.ideas.length) E.push(['i' + d.ideas[0].id, 'lit']);
      }
      var hasSR = d.studies.length > 0;
      if (hasSR) { N.push({ id: 'sr', t: 'review', ph: 2, title: 'Systematic review', m: { Studies: String(d.studies.length) } }); if (hasLit) E.push(['lit', 'sr']); }
      // upstream anchors so every downstream card connects into ONE traceable chain (no orphans), even when a phase is skipped
      var firstIdea = d.ideas.length ? ('i' + d.ideas[0].id) : null;
      var litId = hasLit ? 'lit' : null, srId = hasSR ? 'sr' : null;
      function ideaHas(id) { return (d.ideas || []).some(function (x) { return x.id === id; }); }
      var protoIdea = (d.protocol && d.protocol.idea_id && ideaHas(d.protocol.idea_id)) ? ('i' + d.protocol.idea_id) : null;
      var lastStep = (d.protocol && d.steps.length) ? ('r' + d.steps[d.steps.length - 1].id) : null;
      if (d.protocol && d.steps.length) {
        d.steps.forEach(function (s, i) { var sm = { Kind: s.kind || '—', Státusz: s.status || '—', Jóváhagyás: s.needs_approval ? 'szükséges' : '—' }; if (stepFlagsCap) { sm['Felelős'] = s.assignee_id ? nameOf(s.assignee_id) : '—'; sm['Sign-off'] = s.signed_off_by ? (nameOf(s.signed_off_by) + (s.signed_off_at ? ' · ' + String(s.signed_off_at).slice(0, 10) : '')) : '—'; } N.push({ id: 'r' + s.id, t: 'step', ph: 3, title: s.title || ('Lépés ' + (i + 1)), m: sm, st: s.status, gate: !!s.needs_approval, ref: s }); if (i > 0) E.push(['r' + d.steps[i - 1].id, 'r' + s.id]); });
        var protUp = srId || litId || protoIdea || firstIdea; if (protUp) E.push([protUp, 'r' + d.steps[0].id]);
      }
      var venueUp = srId || lastStep || litId || firstIdea;
      d.journals.forEach(function (j) { N.push({ id: 'v' + j.id, t: 'venue', ph: 4, title: j.title || 'Folyóirat', m: { NPI: j.npi_level || '—', Státusz: j.status || '—' }, ref: j }); if (venueUp) E.push([venueUp, 'v' + j.id]); });
      var writeUp = lastStep || srId || litId || firstIdea;
      d.wfiles.forEach(function (f) {
        if (/^studies\//.test(f.path)) {   // a generated systematic-review document → a node in the SR lane
          var rnm = String(f.path).replace(/^studies\//, '').replace(/\.(md|tex)$/, '');
          N.push({ id: 'w' + f.id, t: 'review', ph: 2, title: rnm || 'áttekintés', m: { Fájl: f.path, Méret: (f.size || 0) + ' B' }, ref: f });
          var rUp = srId || litId || firstIdea; if (rUp) E.push([rUp, 'w' + f.id]);
        } else {
          var nm = String(f.path).replace(/^writing\//, '').replace(/\.(md|tex)$/, '');
          N.push({ id: 'w' + f.id, t: 'section', ph: 5, title: nm || 'szekció', m: { Fájl: f.path, Méret: (f.size || 0) + ' B' }, ref: f });
          if (writeUp) E.push([writeUp, 'w' + f.id]);
        }
      });
      // F5 — multi-modal content nodes (only appear when the project actually has them):
      var protStep0 = (d.protocol && d.steps.length) ? ('r' + d.steps[0].id) : null;
      (d.datasets || []).forEach(function (ds) {   // datasets feed the protocol (ph 3)
        N.push({ id: 'd' + ds.id, t: 'dataset', ph: 3, title: ds.name || 'Adathalmaz', m: { Forrás: ds.source || '—', Státusz: ds.status || '—', Méret: (ds.size_bytes ? Math.round(ds.size_bytes / 1024) + ' KB' : '—'), Megjegyzés: ds.notes || '—' }, ref: ds });
        if (protStep0) E.push(['d' + ds.id, protStep0]);
      });
      (d.mfiles || []).forEach(function (f) {   // uploaded / material files (ph 3) — inputs to the protocol
        N.push({ id: 'f' + f.id, t: 'file', ph: 3, title: String(f.path).replace(/^.*\//, '') || 'fájl', m: { Útvonal: f.path, Méret: (f.size || 0) + ' B', Forrás: f.source || '—' }, ref: f });
        if (protStep0) E.push(['f' + f.id, protStep0]);
      });
      (d.chats || []).forEach(function (c) {   // chat threads drive ideation (ph 0)
        N.push({ id: 'c' + c.id, t: 'chat', ph: 0, title: c.title || 'Beszélgetés', m: { Frissítve: String(c.updated_at || '').slice(0, 10) || '—' }, ref: c });
        var kids = (d.ideas || []).filter(function (x) { return x.source === 'chat'; });   // connect the chat to EVERY idea that came from chat ideation, not just the first
        if (kids.length) kids.forEach(function (x) { E.push(['c' + c.id, 'i' + x.id]); });
        else if (d.ideas.length) E.push(['c' + c.id, 'i' + d.ideas[0].id]);   // no chat-sourced idea yet → keep one representative edge so the chat isn't orphaned
      });
      (d.figures || []).forEach(function (fg) {   // figures extracted from Library papers (ph 1)
        N.push({ id: 'g' + fg.id, t: 'figure', ph: 1, title: fg.fig_label || String(fg.caption || 'Ábra').slice(0, 40), m: { Felirat: fg.caption || '—' }, ref: fg });
        // link to the source paper only if that paper node is actually present (litOpen + in the top-source set); else to the funnel
        var pShown = litOpen && fg.source_id && (d.topSrc || []).some(function (s) { return s.id === fg.source_id; });
        if (pShown) E.push(['p' + fg.source_id, 'g' + fg.id]); else if (hasLit) E.push(['lit', 'g' + fg.id]);
      });
      // SR/Elicit provenance timeline: review-question candidate ← its Study-basis idea; Elicit review ← its candidate
      (d.srcands || []).forEach(function (cd) {
        var basis = cd.idea_id ? ((d.ideas || []).filter(function (x) { return x.id === cd.idea_id; })[0] || null) : null;
        N.push({ id: 'q' + cd.id, t: 'srq', ph: 2, title: cd.question || 'Review-kérdés', m: { Alap: (basis && basis.question) || '—' }, ref: cd });
        if (basis) E.push(['i' + cd.idea_id, 'q' + cd.id]);
      });
      (d.sreviews || []).forEach(function (jb) {
        N.push({ id: 'e' + jb.id, t: 'sreview', ph: 2, title: jb.result_title || jb.research_question || 'Áttekintés', m: { Státusz: jb.status || '—' }, ref: jb });
        // link to the candidate it was launched from (via launched_job_id, or the question text) → idea → candidate → review chain
        var cand = (d.srcands || []).filter(function (cd) { return cd.launched_job_id === jb.id || (cd.question && jb.research_question && cd.question === jb.research_question); })[0];
        if (cand) E.push(['q' + cand.id, 'e' + jb.id]);
        else if (hasLit) E.push(['lit', 'e' + jb.id]);
        else if (d.ideas.length) E.push(['i' + d.ideas[0].id, 'e' + jb.id]);
      });
      // each card's height: the REAL measured value once available (hgt), else a generous estimate for the first paint
      N.forEach(function (n) {
        var ly = layout[n.id];
        n._w = (ly && ly.card_w) || 204;   // manual width (migration-80) or the default (NW)
        n._h = (ly && ly.card_h) || hgt[n.id] || (72 + Math.min(4, Math.ceil(String(n.title || '').length / 22)) * 17);   // manual height or measured or estimated
        if (nrzLive && nrzLive.id === n.id) { n._w = nrzLive.w; n._h = nrzLive.h; }   // follow the in-flight resize 1:1
      });
      // column-less TIMELINE layout: phases seed left→right (ideas → literature → SR → protocol → journal → writing) so
      // derivation reads as a timeline; cards stack within a phase. Free-drag takes over from here.
      var cnt = {}, CEN = [{ x: 30, y: 90 }, { x: 350, y: 40 }, { x: 670, y: 150 }, { x: 990, y: 60 }, { x: 1310, y: 170 }, { x: 1630, y: 90 }];
      N.forEach(function (n) { var o = (cnt[n.ph] = (cnt[n.ph] || 0)); var c = CEN[n.ph] || { x: n.ph * 290, y: 80 }; n.x = c.x + (o % 2) * 234; n.y = c.y + Math.floor(o / 2) * 132; cnt[n.ph] = o + 1; });
      // free-drag: a saved position overrides the auto-layout and PINS the card; only never-placed cards separate
      var pinned = {};
      N.forEach(function (n) { var s = layout[n.id]; if (s) { n.x = s.x; n.y = s.y; pinned[n.id] = true; n.mapHidden = !!s.hidden; n.mapPinned = !!s.pinned; } if (ndrag.current && ndrag.current.id === n.id) pinned[n.id] = true; });
      separateNodes(N, pinned);   // ← the no-overlap rule now only tucks in un-placed cards, never the user's own layout
      // the card under the cursor follows the pointer 1:1 (edges recompute from this via `by`, so they track the drag)
      if (dlive && dlive.id) { for (var q = 0; q < N.length; q++) { if (N[q].id === dlive.id) { N[q].x = dlive.x; N[q].y = dlive.y; break; } } }
      // group drag: every multi-selected card moves together by the same delta from its captured base position
      if (gLive && gLive.base) { for (var gq = 0; gq < N.length; gq++) { var gb = gLive.base[N[gq].id]; if (gb) { N[gq].x = gb.x + gLive.dx; N[gq].y = gb.y + gLive.dy; } } }
      var maxY = 400; N.forEach(function (n) { maxY = Math.max(maxY, n.y + (n._h || 78) + 44); });
      var by = {}; N.forEach(function (n) { by[n.id] = n; });
      // P2 manual edges: fold user-drawn links (manual override rows, edge_key = from|to|manual) into E when both ends exist
      if (edgesCap) Object.keys(edgeOv).forEach(function (k) { var ov = edgeOv[k]; if (ov && ov.manual && ov.from_id && ov.to_id && by[ov.from_id] && by[ov.to_id]) E.push([ov.from_id, ov.to_id, 'manual']); });
      return { N: N, E: E, height: maxY, by: by };
    }

    function onMove(e) { var dd = drag.current; if (!dd) return; setView(function (v) { return { tx: dd.tx + (e.clientX - dd.sx), ty: dd.ty + (e.clientY - dd.sy), k: v.k }; }); }
    function onUp() { drag.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    function stageXY(e) { var st = stageRef.current; if (!st) return { x: e.clientX, y: e.clientY }; var r = st.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    // live cursors: a stable per-user color + a throttled broadcast of my world-space cursor + selection
    var CURSOR_PALETTE = ['#e11d48', '#0891b2', '#7c3aed', '#ca8a04', '#059669', '#db2777', '#2563eb', '#ea580c'];
    function userColor(id) { var s = String(id || ''), hh = 0; for (var i = 0; i < s.length; i++) hh = (hh * 31 + s.charCodeAt(i)) >>> 0; return CURSOR_PALETTE[hh % CURSOR_PALETTE.length]; }
    function broadcastCursor(e) {
      var chn = chRef.current; if (!chn || !props.viewerId || online.length <= 1) return;   // no point broadcasting when alone
      var now = Date.now(); if (now - lastCur.current < 55) return; lastCur.current = now;
      var p = stageXY(e), wx = Math.round((p.x - view.tx) / view.k), wy = Math.round((p.y - view.ty) / view.k);
      try { chn.send({ type: 'broadcast', event: 'cursor', payload: { id: props.viewerId, name: (props.viewer && props.viewer.name) || 'Kolléga', wx: wx, wy: wy, sel: sel || null } }); } catch (err) { }
    }
    function stopFollow() { if (followingRef.current) setFollowing(null); }   // any manual view change breaks follow-mode
    function toggleFollow(uid) { setFollowing(function (f) { return f === uid ? null : uid; }); }
    function sendCursorChat(text) { var chn = chRef.current; if (!chn || !props.viewerId) return; try { chn.send({ type: 'broadcast', event: 'cursorchat', payload: { id: props.viewerId, name: (props.viewer && props.viewer.name) || 'Kolléga', text: text || '' } }); } catch (e) { } }
    function onMarqCancel() { mqRef.current = null; window.removeEventListener('mousemove', onMarqMove); window.removeEventListener('mouseup', onMarqUp); window.removeEventListener('blur', onMarqCancel); setMarquee(null); }
    function onMarqMove(e) { var mq = mqRef.current; if (!mq) return; if (e.buttons === 0) { onMarqUp(e); return; } var p = stageXY(e); setMarquee({ x0: mq.x0, y0: mq.y0, x1: p.x, y1: p.y }); }
    function onMarqUp(e) {
      var mq = mqRef.current; mqRef.current = null;
      window.removeEventListener('mousemove', onMarqMove); window.removeEventListener('mouseup', onMarqUp); window.removeEventListener('blur', onMarqCancel);
      setMarquee(null); if (!mq) return;
      var p = stageXY(e), x0 = Math.min(mq.x0, p.x), x1 = Math.max(mq.x0, p.x), y0 = Math.min(mq.y0, p.y), y1 = Math.max(mq.y0, p.y);
      if (x1 - x0 < 5 && y1 - y0 < 5) return;   // a tiny box = a click, not a marquee
      var k = view.k, add = {};
      g.N.forEach(function (n) { if (n.mapHidden) return; var nx = view.tx + n.x * k, ny = view.ty + n.y * k, nwid = nodeW(n) * k, nhig = nodeH(n) * k; if (nx < x1 && nx + nwid > x0 && ny < y1 && ny + nhig > y0) add[n.id] = true; });
      setMsel(function (M) { return Object.assign({}, M, add); });
    }
    function onDown(e) {
      if (e.target.closest && e.target.closest('.rmap-node')) return;
      if (!e.shiftKey && e.target.closest && e.target.closest('.rmap-e-hit')) return;   // a plain edge click selects (its own onClick) — don't start a pan; shift still falls through to marquee
      if (e.detail > 1) return;   // the 2nd mousedown of a double-click → let onStageDbl open the radial add-menu; don't re-clear/re-pan
      // comment mode: a click on the empty canvas drops a position-pinned comment composer
      if (commentMode) { var pc = stageXY(e); setComposer({ x: Math.round((pc.x - view.tx) / view.k), y: Math.round((pc.y - view.ty) / view.k) }); setCmText(''); return; }
      if (selEdge) setSelEdge(null);   // empty-canvas mousedown clears the edge selection
      // shift + drag on the empty canvas = marquee multi-select; a plain drag pans; a plain click clears the selection
      if (e.shiftKey) { cancelFly(); tourStop(); var p = stageXY(e); mqRef.current = { x0: p.x, y0: p.y }; setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); window.addEventListener('mousemove', onMarqMove); window.addEventListener('mouseup', onMarqUp); window.addEventListener('blur', onMarqCancel); return; }
      if (Object.keys(msel).length) setMsel({});
      stopFollow(); cancelFly(); tourStop(); drag.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    }
    function onWheel(e) { e.preventDefault(); stopFollow(); cancelFly(); tourStop(); var st = stageRef.current; if (!st) return; var r = st.getBoundingClientRect(); var mx = e.clientX - r.left, my = e.clientY - r.top; setView(function (v) { var nk = Math.min(2.2, Math.max(.3, v.k * (e.deltaY < 0 ? 1.12 : 0.89))); return { tx: mx - (mx - v.tx) * (nk / v.k), ty: my - (my - v.ty) * (nk / v.k), k: nk }; }); }
    function zoom(f) { stopFollow(); cancelFly(); tourStop(); setView(function (v) { var nk = Math.min(2.2, Math.max(.3, v.k * f)); return { tx: v.tx, ty: v.ty, k: nk }; }); }
    // fit the whole graph into the viewport (Luma "illeszd a nézetbe"). Uses card size 204x74.
    function fitView() {
      var st = stageRef.current; if (!st || !g.N || !g.N.length) return;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      g.N.forEach(function (n) { if (!nodeVisible(n)) return; if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y; if (n.x + nodeW(n) > maxX) maxX = n.x + nodeW(n); if (n.y + nodeH(n) > maxY) maxY = n.y + nodeH(n); });
      if (minX === Infinity) return;
      var pad = 56, gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY), cw = st.clientWidth, ch = st.clientHeight;
      var k = Math.min(1.6, Math.max(.3, Math.min((cw - pad * 2) / gw, (ch - pad * 2) / gh)));
      setView({ tx: (cw - gw * k) / 2 - minX * k, ty: (ch - gh * k) / 2 - minY * k, k: k });
    }
    // ---- Prezi-mód camera: flyTo tween (the single new primitive; every phase reuses it) ----
    function cancelFly() { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }
    function flyTo(target, opt) {
      opt = opt || {}; cancelFly();
      var cur = viewRef.current || view, from = { tx: cur.tx, ty: cur.ty, k: cur.k }, ms = opt.ms || 420, t0 = null;
      var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
      if (reduce || ms <= 0) { setView({ tx: target.tx, ty: target.ty, k: target.k }); if (opt.done) opt.done(); return; }
      function ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
      function step(now) {
        if (t0 === null) t0 = now; var u = Math.min(1, (now - t0) / ms), e = ease(u);
        setView({ tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e, k: from.k + (target.k - from.k) * e });
        if (u < 1) rafRef.current = requestAnimationFrame(step); else { rafRef.current = null; if (opt.done) opt.done(); }
      }
      rafRef.current = requestAnimationFrame(step);
    }
    // camera target that centers a node at a comfortable zoom (within the 2.2 clamp — no clamp-lift in Fázis 1)
    function nodeTarget(n, kWanted) {
      var st = stageRef.current, cw = (st && st.clientWidth) || 900, ch = (st && st.clientHeight) || 560;
      var k = Math.min(2.2, Math.max(.3, kWanted || 1.9));
      return { tx: cw / 2 - (n.x + nodeW(n) / 2) * k, ty: ch / 2 - (n.y + nodeH(n) / 2) * k, k: k };
    }
    // viewport-fit P2: fly the camera so this card fills ~90% of the viewport (explicit action — never automatic).
    function cardIntoView(n) { var vp = stageVP(); var k = Math.min(2.2, Math.max(0.3, Math.min((vp.w * 0.9) / nodeW(n), (vp.h * 0.9) / nodeH(n)))); flyTo(nodeTarget(n, k), { ms: 420 }); }
    // deep-link prop bag for a node type (panels ignore what they do not use — graceful)
    function focusPropsFor(n) {
      var id = n.ref && n.ref.id, m = {};
      if (n.t === 'chat') m.focusChatId = id; else if (n.t === 'idea') m.focusIdeaId = id; else if (n.t === 'gap') m.focusGapId = id; else if (n.t === 'file') m.focusFileId = id;
      else if (n.t === 'paper') m.focusSourceId = id; else if (n.t === 'figure') m.focusFigureId = id;
      else if (n.t === 'review') m.focusReviewId = id; else if (n.t === 'srq') m.focusQuestionId = id; else if (n.t === 'sreview') m.focusJobId = id;
      else if (n.t === 'step') m.focusStepId = id; else if (n.t === 'dataset') m.focusDatasetId = id;
      else if (n.t === 'section') m.focusSection = n.ref && n.ref.path; else if (n.t === 'venue') m.focusVenueId = id;
      return m;
    }
    var EMBEDDABLE = { ideas: 1, gap: 1, literature: 1, study: 1, protocol: 1, data: 1, writing: 1, journal: 1 };
    function canEnter(n) { var tab = RMAP_TYPE[n.t] && RMAP_TYPE[n.t].tab; return !!(tab && EMBEDDABLE[tab] && props.renderPanel); }
    // ENTER: fly the camera into the card, then mount its real workflow panel in-place (screen-space overlay)
    function enterNode(n) {
      if (!n) return; var tab = RMAP_TYPE[n.t] && RMAP_TYPE[n.t].tab;
      if (!tab) return;
      if (!canEnter(n)) { if (props.onGoTab) props.onGoTab(tab); return; }   // non-embeddable → hand off to the classic tab
      stopFollow(); tourStop();
      returnView.current = { tx: viewRef.current.tx, ty: viewRef.current.ty, k: viewRef.current.k };
      // mount the (possibly heavy) panel only AFTER the camera tween settles — a light placeholder shows during 'entering'
      setFocus(Object.assign({ nodeId: n.id, tab: tab, t: n.t, title: n.title, ref: n.ref, phase: 'entering' }, focusPropsFor(n)));
      flyTo(nodeTarget(n, 2.0), { ms: 420, done: function () { if (alive.current) setFocus(function (f) { return f ? Object.assign({}, f, { phase: 'open' }) : f; }); } });
    }
    function exitFocus() { var rv = returnView.current; setFocus(null); if (rv) flyTo(rv, { ms: 360 }); }
    // ---- 5th LOD: embedded, non-modal, resizable panel WINDOWS anchored to a card (screen-space; several at once) ----
    var MAX_WIN = 3;
    // re-rank window z-order to a COMPACT band starting at 20 (frontId gets the top), so window z can never climb to the
    // modal focus overlay z-index (200) no matter how many times a window is fronted — fixes unbounded ++counter drift.
    function reZ(W, frontId) {
      var order = W.slice().sort(function (a, b) { return (((a.id === frontId) ? 1 : 0) - ((b.id === frontId) ? 1 : 0)) || (a.z - b.z); });
      var zmap = {}; order.forEach(function (w, i) { zmap[w.id] = 20 + i; });
      return W.map(function (w) { return w.z === zmap[w.id] ? w : Object.assign({}, w, { z: zmap[w.id] }); });
    }
    function openWindow(n) {
      if (!n) return; var tab = RMAP_TYPE[n.t] && RMAP_TYPE[n.t].tab;
      if (!canEnter(n)) { if (props.onGoTab && tab) props.onGoTab(tab); return; }
      setWindows(function (W) {
        W = W.filter(function (w) { return g.by[w.id]; });   // drop ghost windows whose anchor node was deleted (frees the slot lazily; no hook needed)
        if (W.filter(function (w) { return w.id === n.id; })[0]) return reZ(W, n.id);   // already open → front
        if (W.length >= MAX_WIN) { window.PRUI.toast('Legfeljebb ' + MAX_WIN + ' panel-ablak lehet nyitva.', { kind: 'info' }); return W; }
        return reZ(W.concat([{ id: n.id, tab: tab, t: n.t, title: n.title, ref: n.ref, fp: focusPropsFor(n), dx: 16, dy: 0, w: 380, h: 300, z: 999 }]), n.id);
      });
    }
    function closeWindow(id) { setWindows(function (W) { return W.filter(function (w) { return w.id !== id; }); }); }
    function winFront(id) { setWindows(function (W) { if (W.length < 2) return W; var mx = 0, cur = null; W.forEach(function (w) { if (w.z > mx) mx = w.z; if (w.id === id) cur = w; }); return (!cur || cur.z === mx) ? W : reZ(W, id); }); }
    function winToModal(w) { var n = g.by[w.id]; closeWindow(w.id); if (n) enterNode(n); }   // promote a window to the exclusive modal Prezi
    function startWinDrag(e, w, mode) {
      if (e.button !== 0) return; e.stopPropagation(); winFront(w.id);
      var sx = e.clientX, sy = e.clientY, odx = w.dx, ody = w.dy, ow = w.w, oh = w.h;
      var wmv = function (ev) {
        if (!winDragRef.current) return; if (ev.buttons === 0) { wfin(); return; }
        var ddx = ev.clientX - sx, ddy = ev.clientY - sy;   // RAW screen delta — windows live in screen px, never scaled by view.k
        if (mode === 'move') setWindows(function (W) { return W.map(function (x) { return x.id === w.id ? Object.assign({}, x, { dx: odx + ddx, dy: ody + ddy }) : x; }); });
        else setWindows(function (W) { return W.map(function (x) { return x.id === w.id ? Object.assign({}, x, { w: Math.min(760, Math.max(320, ow + ddx)), h: Math.min(600, Math.max(200, oh + ddy)) }) : x; }); });
      };
      var wfin = function () { winDragRef.current = null; window.removeEventListener('mousemove', wmv); window.removeEventListener('mouseup', wup); window.removeEventListener('blur', wfin); };
      var wup = function () { wfin(); };
      winDragRef.current = { id: w.id }; window.addEventListener('mousemove', wmv); window.addEventListener('mouseup', wup); window.addEventListener('blur', wfin);
    }
    // ---- guided tour over the saved Lapok (pages) — Fázis 1; Fázis 2 upgrades this to authored story beats ----
    function tourStop() { if (tourT.current) { clearTimeout(tourT.current); tourT.current = null; } setFocus(null); setTour(null); }
    function fitFrameTarget(f) {
      var st = stageRef.current, cw = (st && st.clientWidth) || 900, ch = (st && st.clientHeight) || 560, pad = 48;
      var k = Math.min(1.8, Math.max(.3, Math.min((cw - pad * 2) / Math.max(1, f.w), (ch - pad * 2) / Math.max(1, f.h))));
      return { tx: cw / 2 - (f.x + f.w / 2) * k, ty: ch / 2 - (f.y + f.h / 2) * k, k: k };
    }
    // resolve an authored beat (step) to a live camera target + panel/caption metadata; falls back to the stored snapshot
    function resolveBeat(step) {
      step = step || {}; var b = { caption: step.caption || '', notes: step.notes || '', enter_panel: !!step.enter_panel, tab: step.panel_tab || null, kind: step.kind, ref_id: step.ref_id, nodeId: null, dwell_ms: step.dwell_ms || 0 }, t = null;
      if (step.kind === 'node' && step.ref_id && g.by[step.ref_id]) { var n = g.by[step.ref_id]; t = nodeTarget(n, 1.9); b.nodeId = n.id; b.t = n.t; b.title = n.title; b.ref = n.ref; if (!b.tab) b.tab = RMAP_TYPE[n.t] && RMAP_TYPE[n.t].tab; if (b.enter_panel) Object.assign(b, focusPropsFor(n)); }
      else if (step.kind === 'page' && step.ref_id) { var pg = pages.filter(function (x) { return x.id === step.ref_id; })[0]; if (pg) t = { tx: pg.tx, ty: pg.ty, k: pg.k }; }
      else if (step.kind === 'frame' && step.ref_id) { var fr = frames.filter(function (x) { return x.id === step.ref_id; })[0]; if (fr) t = fitFrameTarget(fr); }
      if (!t) t = { tx: step.tx != null ? step.tx : view.tx, ty: step.ty != null ? step.ty : view.ty, k: step.k != null ? step.k : view.k };
      b.tx = t.tx; b.ty = t.ty; b.k = t.k; return b;
    }
    function tourGo(beats, i, meta) {
      if (!beats.length) return; var idx = Math.max(0, Math.min(i, beats.length - 1)), b = beats[idx];
      setFocus(null);   // clear any panel from the previous beat (no fly-back; this beat's flyTo takes over)
      flyTo({ tx: b.tx, ty: b.ty, k: b.k }, { ms: 640, done: function () { if (alive.current && b.enter_panel && b.nodeId && b.tab && props.renderPanel) setFocus(Object.assign({}, b, { phase: 'open' })); } });
      if (meta && meta.presenter) { var ch2 = chRef.current; if (ch2 && props.viewerId) { try { ch2.send({ type: 'broadcast', event: 'story_beat', payload: { id: props.viewerId, tx: b.tx, ty: b.ty, k: b.k, caption: b.caption, name: meta.name, i: idx, total: beats.length } }); } catch (e) { } } }
      setTour(function (t) { return Object.assign({}, t || {}, { beats: beats, i: idx, name: (meta && meta.name) || (t && t.name), presenter: !!(meta && meta.presenter), pathId: (meta && meta.pathId) || (t && t.pathId), caption: b.caption, notes: b.notes, follow: false }); });
    }
    function tourRun(beats, i, playing, meta) {
      tourGo(beats, i, meta);
      if (tourT.current) { clearTimeout(tourT.current); tourT.current = null; }
      var b = beats[Math.max(0, Math.min(i, beats.length - 1))], dwell = (b && b.dwell_ms) || 3600;
      if (playing && !(b && b.enter_panel) && i < beats.length - 1) tourT.current = setTimeout(function () { if (alive.current) tourRun(beats, i + 1, true, meta); }, dwell);   // panel beats pause for the presenter
      setTour(function (t) { return Object.assign({}, t || {}, { playing: playing && i < beats.length - 1 && !(b && b.enter_panel) }); });
    }
    function tourStart() {   // Fázis-1 quick Lap-based tour
      if (!pagesCap || !pages.length) { window.PRUI.toast('Ments előbb legalább egy „Lapot" (nézetet) a túrához.', { kind: 'info' }); return; }
      var beats = pages.slice().sort(function (a, b) { return (a.ord || 0) - (b.ord || 0); }).map(function (pg) { return { tx: pg.tx, ty: pg.ty, k: pg.k, caption: pg.name, notes: '', enter_panel: false }; });
      setFocus(null); returnView.current = { tx: viewRef.current.tx, ty: viewRef.current.ty, k: viewRef.current.k };
      tourRun(beats, 0, true, { name: 'Lap-túra' });
    }
    function presentPath(path, presenter) {   // Fázis-2 authored presentation
      var beats = (path.steps || []).map(resolveBeat); if (!beats.length) { window.PRUI.toast('Ehhez a bemutatóhoz még nincs jelenet.', { kind: 'info' }); return; }
      setPresMgrOpen(false); setEditPath(null); setFocus(null); returnView.current = { tx: viewRef.current.tx, ty: viewRef.current.ty, k: viewRef.current.k };
      tourRun(beats, 0, true, { name: path.name, pathId: path.id, presenter: !!presenter });
    }
    function tourPrev() { if (tour && tour.beats) { if (tourT.current) { clearTimeout(tourT.current); tourT.current = null; } tourRun(tour.beats, Math.max(0, tour.i - 1), false, tour); } }
    function tourNext() { if (tour && tour.beats) { if (tourT.current) { clearTimeout(tourT.current); tourT.current = null; } tourRun(tour.beats, Math.min(tour.beats.length - 1, tour.i + 1), false, tour); } }
    function tourToggle() { if (!tour || !tour.beats) return; if (tour.playing) { if (tourT.current) { clearTimeout(tourT.current); tourT.current = null; } setTour(function (t) { return Object.assign({}, t, { playing: false }); }); } else tourRun(tour.beats, tour.i, true, tour); }
    // ---- presentation (path) CRUD — migration-79 ----
    function pathCreate() {
      if (!props.canEdit || !pathsCap) return; var nm = window.prompt('Bemutató neve:', 'Bemutató ' + (paths.length + 1)); if (nm == null) return;
      sb.from('research_map_paths').insert({ project_id: props.projectId, name: String(nm).trim() || 'Bemutató', ord: paths.length, steps: [] }).select('id,name,ord,steps').single().then(function (r) {
        if (!alive.current) return; if (r && r.error) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        if (r && r.data) { setPaths(function (P) { return P.some(function (x) { return x.id === r.data.id; }) ? P : P.concat([r.data]); }); setEditPath(r.data.id); }
      });
    }
    function pathPatch(id, patch) {
      setPaths(function (P) { return P.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; }); });   // optimistic, immediate
      // debounce the DB write so caption/notes typing does not issue a whole-steps write per keystroke; merge pending patches
      var w = pathWr.current[id] || (pathWr.current[id] = {}); if (w.t) clearTimeout(w.t); w.pending = Object.assign(w.pending || {}, patch);
      w.t = setTimeout(function () {
        var p = w.pending; w.pending = null; w.t = null; w.ts = Date.now();
        sb.from('research_map_paths').update(Object.assign({}, p, { updated_at: new Date().toISOString() })).eq('id', id).then(function (r) { w.ts = Date.now(); if (r && r.error && alive.current) window.PRUI.toast('Mentés sikertelen: ' + r.error.message, { kind: 'error' }); });
      }, 420);
    }
    function pathRename(pt) { if (!props.canEdit) return; var v = window.prompt('Bemutató neve:', pt.name); if (v == null || !String(v).trim()) return; pathPatch(pt.id, { name: String(v).trim() }); }
    function pathDelete(pt) { if (!props.canEdit) return; setPaths(function (P) { return P.filter(function (x) { return x.id !== pt.id; }); }); if (editPath === pt.id) setEditPath(null); sb.from('research_map_paths').delete().eq('id', pt.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Törlés sikertelen: ' + r.error.message, { kind: 'error' }); }); }
    function pathSetSteps(pt, steps) { pathPatch(pt.id, { steps: steps }); }
    function beatAddCurrentView(pt) { pathSetSteps(pt, (pt.steps || []).concat([{ kind: 'view', tx: view.tx, ty: view.ty, k: view.k, caption: 'Nézet ' + ((pt.steps || []).length + 1), notes: '', enter_panel: false, dwell_ms: 3600 }])); }
    function beatAddNode(pt, n, enter) { var tab = RMAP_TYPE[n.t] && RMAP_TYPE[n.t].tab; pathSetSteps(pt, (pt.steps || []).concat([{ kind: 'node', ref_id: n.id, tx: view.tx, ty: view.ty, k: view.k, caption: n.title || (RMAP_TYPE[n.t] && RMAP_TYPE[n.t].lab) || '', notes: '', enter_panel: !!(enter && EMBEDDABLE[tab] && props.renderPanel), panel_tab: tab, dwell_ms: 3600 }])); }
    function beatUpdate(pt, i, patch) { pathSetSteps(pt, (pt.steps || []).map(function (s, j) { return j === i ? Object.assign({}, s, patch) : s; })); }
    function beatRemove(pt, i) { pathSetSteps(pt, (pt.steps || []).filter(function (s, j) { return j !== i; })); }
    function beatMove(pt, i, dir) { var steps = (pt.steps || []).slice(), j = i + dir; if (j < 0 || j >= steps.length) return; var tmp = steps[i]; steps[i] = steps[j]; steps[j] = tmp; pathSetSteps(pt, steps); }

    // ---- free-drag: move a card anywhere and persist it (research_map_layout). A short press without motion = a click
    // (select / toggle). Only left-button + editors move cards; viewers still click to select. ----
    function persistPos(id, x, y) {
      if (!props.canEdit) return;
      sb.from('research_map_layout').upsert({ project_id: props.projectId, node_id: id, x: x, y: y, updated_at: new Date().toISOString() }, { onConflict: 'project_id,node_id' }).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Pozíció mentése sikertelen: ' + r.error.message, { kind: 'error' }); });
    }
    // P1: resize a card by its corner (migration-80). Mirrors the frame resize (startFrameDrag mode='resize'):
    // world-delta = screen-delta / view.k (1:1 on screen), clamped, min NW×64, cap 760×600; persists card_w/card_h.
    function persistSize(id, w, h, x, y) {
      if (!props.canEdit || !cardSizeCap) return;
      sb.from('research_map_layout').upsert({ project_id: props.projectId, node_id: id, x: x, y: y, card_w: Math.round(w), card_h: Math.round(h), updated_at: new Date().toISOString() }, { onConflict: 'project_id,node_id' }).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Méret mentése sikertelen: ' + r.error.message, { kind: 'error' }); });
    }
    function startNodeResize(e, n) {
      if (e.button !== 0 || !props.canEdit || !cardSizeCap) return; e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, k = view.k || 1, ow = n._w || NW, oh = n._h || NH, ox = n.x, oy = n.y;
      var _rvp = stageVP(), capW = Math.max(NW, (_rvp.w - 16) / k), capH = Math.max(64, (_rvp.h - 16) / k);   // viewport-fit: can't resize a card bigger than the screen at this zoom
      nrzRef.current = { id: n.id, moved: false, w: ow, h: oh };
      var rmv = function (ev) {
        if (!nrzRef.current) return; if (ev.buttons === 0) { rfin(); return; }
        if (Math.abs(ev.clientX - sx) > 2 || Math.abs(ev.clientY - sy) > 2) {
          nrzRef.current.moved = true;
          nrzRef.current.w = Math.min(760, capW, Math.max(NW, Math.round(ow + (ev.clientX - sx) / k)));
          nrzRef.current.h = Math.min(600, capH, Math.max(64, Math.round(oh + (ev.clientY - sy) / k)));
          setNrzLive({ id: n.id, w: nrzRef.current.w, h: nrzRef.current.h });
        }
      };
      var rfin = function () {
        var d = nrzRef.current; if (!d) return; nrzRef.current = null;
        window.removeEventListener('mousemove', rmv); window.removeEventListener('mouseup', rup); window.removeEventListener('blur', rfin);
        setNrzLive(null);
        if (d.moved) {
          setLayout(function (L) { var m = Object.assign({}, L); m[n.id] = Object.assign({ x: ox, y: oy }, m[n.id], { card_w: d.w, card_h: d.h }); return m; });
          persistSize(n.id, d.w, d.h, ox, oy); setSizeGen(function (x) { return x + 1; });
        }
      };
      var rup = function () { rfin(); };
      window.addEventListener('mousemove', rmv); window.addEventListener('mouseup', rup); window.addEventListener('blur', rfin);
    }
    function resetCardSize(n) {
      if (!props.canEdit || !cardSizeCap || !n) return;
      setLayout(function (L) { var m = Object.assign({}, L); if (m[n.id]) { var c2 = Object.assign({}, m[n.id]); delete c2.card_w; delete c2.card_h; m[n.id] = c2; } return m; });
      var cur = layout[n.id] || {};
      sb.from('research_map_layout').upsert({ project_id: props.projectId, node_id: n.id, x: (cur.x != null ? cur.x : n.x), y: (cur.y != null ? cur.y : n.y), card_w: null, card_h: null, updated_at: new Date().toISOString() }, { onConflict: 'project_id,node_id' }).then(function () { if (alive.current) setSizeGen(function (x) { return x + 1; }); });
    }
    // ---- interactive edges (migration-81) ----
    // stable key: fromId|toId|kind (the structural cite/flow flag disambiguates the rare same-pair double edge)
    function edgeKey(e) { return e[0] + '|' + e[1] + '|' + (e[2] || 'flow'); }
    // P1 inferRel: give a DERIVED edge a smart default relation from its endpoints (zero user work) — cite → Idézet;
    // data/material/chat/figure feeding a step or idea → Bemenete; everything else (provenance) → Származás.
    function inferRel(e) {
      if (e[2] === 'cite') return 'idz';
      var a = g.by[e[0]], b = g.by[e[1]], at = a && a.t, bt = b && b.t;
      if ((at === 'dataset' || at === 'file' || at === 'chat' || at === 'figure') && (bt === 'step' || bt === 'idea')) return 'bem';
      return 'erd';
    }
    // resolve an edge to its concrete style: the semantic TYPE default (override kind, else inferRel), then the saved override on top.
    function edgeStyle(e) {
      var ov = edgeOv[edgeKey(e)] || {};
      var kind = ov.kind || inferRel(e);
      var T = EDGE_TYPES[kind] || EDGE_TYPES.erd;
      return { kind: kind, col: ov.color || T.col, anim: ov.anim || T.anim, line: ov.line_style || T.line, arrow: (ov.arrow != null ? ov.arrow : T.arrow), width: ov.width || (kind === 'idz' ? 1.5 : 2), label: ov.label || '', sp: (ov.speed != null ? ov.speed : (EDGE_ANIM_SP[ov.anim || T.anim] || 1.7)), manual: !!ov.manual, ov: !!edgeOv[edgeKey(e)] };
    }
    // upsert an override row (merges a partial patch into the current override); optimistic + graceful.
    function persistEdge(e, patch) {
      if (!props.canEdit || !edgesCap) return;
      var key = edgeKey(e), cur = edgeOv[key] || {}, next = Object.assign({ edge_key: key, from_id: e[0], to_id: e[1] }, cur, patch);
      eovRef.current = key;
      setEdgeOv(function (O) { var m = Object.assign({}, O); m[key] = next; return m; });
      var row = { project_id: props.projectId, edge_key: key, from_id: e[0], to_id: e[1], kind: next.kind || null, color: next.color || null, anim: next.anim || null, line_style: next.line_style || null, arrow: (next.arrow != null ? next.arrow : null), width: next.width || null, label: next.label || null, manual: false, updated_at: new Date().toISOString() };
      if (edgeSpeedCap) row.speed = (next.speed != null ? next.speed : null);   // only write speed once migration-82 added the column
      sb.from('research_map_edges').upsert(row, { onConflict: 'project_id,edge_key' }).then(function (r) {
        setTimeout(function () { if (eovRef.current === key) eovRef.current = null; }, 400);
        if (r && r.error && alive.current) window.PRUI.toast('Él mentése sikertelen: ' + r.error.message, { kind: 'error' });
      });
    }
    // "↺ Alaphelyzet": drop the override row → the edge returns to its derived default
    function resetEdge(e) {
      if (!props.canEdit || !edgesCap) return; var key = edgeKey(e);
      eovRef.current = key;
      setEdgeOv(function (O) { var m = Object.assign({}, O); delete m[key]; return m; });
      sb.from('research_map_edges').delete().eq('project_id', props.projectId).eq('edge_key', key).then(function () { setTimeout(function () { if (eovRef.current === key) eovRef.current = null; }, 400); });
    }
    function selectEdge(key) { setSel(null); setMsel({}); setSelEdge(key); }   // edges + nodes are mutually exclusive
    // P2: draw a MANUAL edge between two cards (link-mode). edge_key = from|to|manual; a manual override row that graph() folds into E.
    function createManualEdge(fromId, toId) {
      if (!props.canEdit || !edgesCap || !fromId || !toId || fromId === toId) { setLinkFrom(null); return; }
      var key = fromId + '|' + toId + '|manual', row = { edge_key: key, from_id: fromId, to_id: toId, kind: 'kap', manual: true };
      eovRef.current = key;
      setEdgeOv(function (O) { var m = Object.assign({}, O); m[key] = Object.assign({}, m[key], row); return m; });
      setLinkFrom(null); setSel(null); setMsel({}); setSelEdge(key);
      sb.from('research_map_edges').upsert({ project_id: props.projectId, edge_key: key, from_id: fromId, to_id: toId, kind: 'kap', manual: true, updated_at: new Date().toISOString() }, { onConflict: 'project_id,edge_key' }).then(function (r) {
        setTimeout(function () { if (eovRef.current === key) eovRef.current = null; }, 400);
        if (r && r.error && alive.current) window.PRUI.toast('Kapcsolat mentése sikertelen: ' + r.error.message, { kind: 'error' });
      });
    }
    // P2 drag-to-connect: pull an edge straight out of a card port and drop it on another card (the natural graph gesture).
    function startLinkDrag(e, nodeId) {
      if (e.button !== 0 || !props.canEdit || !edgesCap) return;
      e.stopPropagation(); e.preventDefault();
      linkDragRef.current = { from: nodeId }; setLinkFrom(null);
      function targetAt(ev) { var el = (typeof document !== 'undefined' && document.elementFromPoint) ? document.elementFromPoint(ev.clientX, ev.clientY) : null; var card = el && el.closest ? el.closest('.rmap-node[data-nid]') : null; var id = card ? card.getAttribute('data-nid') : null; return (id && id !== nodeId) ? id : null; }
      function upd(ev) { var st = stageRef.current; if (!st) return; var r = st.getBoundingClientRect(), v = viewRef.current; setLinkDrag({ from: nodeId, wx: (ev.clientX - r.left - v.tx) / v.k, wy: (ev.clientY - r.top - v.ty) / v.k, over: targetAt(ev) }); }
      function fin(ev) { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('blur', cancel); var ld = linkDragRef.current; linkDragRef.current = null; setLinkDrag(null); if (ev && ld) { var to = targetAt(ev); if (to) createManualEdge(ld.from, to); } }
      function cancel() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('blur', cancel); linkDragRef.current = null; setLinkDrag(null); }
      function mv(ev) { if (ev.buttons === 0) { fin(ev); return; } upd(ev); }
      function up(ev) { fin(ev); }
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); window.addEventListener('blur', cancel);
      upd(e);
    }
    // P2 reasoning lens: isolate one relation type (hide every OTHER present type). `present` is passed from the legend.
    function soloEdgeType(k, present) { setHiddenEdgeTypes(function () { var n = {}; (present || []).forEach(function (kk) { if (kk !== k) n[kk] = true; }); try { localStorage.setItem(edgeTypeStoreKey(), JSON.stringify(n)); } catch (e) { } return n; }); setSelEdge(null); }
    // per-node Map flags (migration-70): hide/show + pin. Upsert the node's CURRENT position with the flag (x/y NOT NULL).
    // Optimistic; on error revert + toast. Guarded by mapFlags so the UI only appears once the columns exist.
    function nodeSetFlag(n, key, val) {
      if (!props.canEdit || !n) return;
      var cur = layout[n.id] || {}, x = (cur.x != null ? cur.x : n.x), y = (cur.y != null ? cur.y : n.y);
      var prev = !!cur[key];   // capture the PRIOR value so an error reverts to it (not blindly to the default)
      var patch = {}; patch[key] = val;
      setLayout(function (L) { var m = Object.assign({}, L); m[n.id] = Object.assign({ x: x, y: y }, m[n.id], patch); return m; });
      if (key === 'hidden' && val) setSel(function (s) { return s === n.id ? null : s; });
      var row = { project_id: props.projectId, node_id: n.id, x: x, y: y, updated_at: new Date().toISOString() }; row[key] = val;
      sb.from('research_map_layout').upsert(row, { onConflict: 'project_id,node_id' }).then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { window.PRUI.toast('Mentés sikertelen (fut a migration-70?): ' + r.error.message, { kind: 'error' }); setLayout(function (L) { var m = Object.assign({}, L); if (m[n.id]) { var c2 = Object.assign({}, m[n.id]); if (prev) c2[key] = true; else delete c2[key]; m[n.id] = c2; } return m; }); }
      });
    }
    // temporary per-TYPE visibility (client-only; persisted to localStorage per project so it is convenient but reversible)
    function typeStoreKey() { return 'pr-rmap-types:' + props.projectId; }
    function toggleType(t) { setHiddenTypes(function (H) { var n = Object.assign({}, H); if (n[t]) delete n[t]; else n[t] = true; try { if (Object.keys(n).length) localStorage.setItem(typeStoreKey(), JSON.stringify(n)); else localStorage.removeItem(typeStoreKey()); } catch (e) { } return n; }); }
    function showAllTypes() { setHiddenTypes({}); try { localStorage.removeItem(typeStoreKey()); } catch (e) { } }
    // P1: toggle a whole EDGE relation type off/on from the live legend (client-only, localStorage). A selected edge of a
    // now-hidden type is handled in the render (selEdgeVisible + the inspector both gate on hiddenEdgeTypes), no stale UI.
    function edgeTypeStoreKey() { return 'pr-rmap-etypes:' + props.projectId; }
    function toggleEdgeType(k) { setHiddenEdgeTypes(function (H) { var n = Object.assign({}, H); if (n[k]) delete n[k]; else n[k] = true; try { if (Object.keys(n).length) localStorage.setItem(edgeTypeStoreKey(), JSON.stringify(n)); else localStorage.removeItem(edgeTypeStoreKey()); } catch (e) { } return n; }); }
    function nodeToggleHidden(n) { nodeSetFlag(n, 'hidden', !(layout[n.id] && layout[n.id].hidden)); }
    function nodeTogglePinned(n) { nodeSetFlag(n, 'pinned', !(layout[n.id] && layout[n.id].pinned)); }
    function groupHide() { Object.keys(msel).forEach(function (id) { var n = g.by[id]; if (n && !n.mapHidden) nodeSetFlag(n, 'hidden', true); }); setMsel({}); }
    function groupPin() { Object.keys(msel).forEach(function (id) { var n = g.by[id]; if (n) nodeSetFlag(n, 'pinned', true); }); }
    // ---- Map frames (named regions / phase lanes) — migration-71. Frames live in WORLD coords (pan/zoom with the canvas). ----
    var FRAME_COLORS = ['slate', 'violet', 'cyan', 'amber', 'green', 'rose'];
    // frameCreate(wx,wy): CENTER a new frame on the given world point (radial add-menu); with no args → the viewport centre (▦ button).
    function frameCreate(wx, wy) {
      if (!props.canEdit || !framesCap) return;
      var fx, fy;
      if (typeof wx === 'number' && typeof wy === 'number') { fx = Math.round(wx) - 210; fy = Math.round(wy) - 150; }
      else { var st = stageRef.current, cx = st ? st.clientWidth / 2 : 300, cy = st ? st.clientHeight / 2 : 200; fx = Math.round((cx - view.tx) / view.k) - 210; fy = Math.round((cy - view.ty) / view.k) - 150; }
      sb.from('research_map_frames').insert({ project_id: props.projectId, title: 'Új keret', x: fx, y: fy, w: 420, h: 300, color: 'slate' }).select('id,title,x,y,w,h,color').single().then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { window.PRUI.toast('Keret létrehozása sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        if (r && r.data) setFrames(function (F) { return F.some(function (f) { return f.id === r.data.id; }) ? F : F.concat([r.data]); });
      });
    }
    // radial add-menu: create an IDEA node at the world point — insert the idea, then pin its Map position to the cursor
    // (node_id = "i"+id, mirrors graph()), optimistic + reload so it materializes exactly there, and select it.
    function ideaAtPos(wx, wy) {
      if (!props.canEdit) return;
      sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', question: 'Új ötlet', created_by: props.authorId, status: 'candidate' }).select('id').single().then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { window.PRUI.toast('Ötlet létrehozása sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        if (!r || !r.data) return;
        var nid = 'i' + r.data.id, X = Math.round(wx), Y = Math.round(wy);
        setLayout(function (L) { var m = Object.assign({}, L); m[nid] = Object.assign({ x: X, y: Y }, m[nid]); return m; });
        sb.from('research_map_layout').upsert({ project_id: props.projectId, node_id: nid, x: X, y: Y, updated_at: new Date().toISOString() }, { onConflict: 'project_id,node_id' });
        // optimistically APPEND the idea to data.ideas so the node materializes at the cursor even past the 24-oldest reload cap
        // (a setBump reload would drop the newest idea when ≥24 exist); concat keeps d.ideas[0] — the graph anchor — unchanged.
        setData(function (D) { return D ? Object.assign({}, D, { ideas: (D.ideas || []).concat([{ id: r.data.id, question: 'Új ötlet', hypothesis: null, rationale: null, novelty: null, status: 'candidate', source: 'own' }]) }) : D; });
        setSel(nid);
      });
    }
    // the frame SVG icon for the radial segment (a dashed rounded region + a small title tab) — currentColor = the segment color
    function keretIcon() { return h('svg', { viewBox: '0 0 24 20', width: 20, height: 17, fill: 'none', style: { display: 'block' } }, h('rect', { x: 2, y: 3.6, width: 20, height: 14.4, rx: 3, stroke: 'currentColor', strokeWidth: 2, strokeDasharray: '3 2.4' }), h('rect', { x: 3.4, y: 1.4, width: 9.6, height: 4.7, rx: 1.6, fill: 'currentColor' })); }
    function onStageDbl(e) {
      if (e.target.closest && e.target.closest('.rmap-node, .rmap-e-hit, .rmap-cm-composer, .rmap-cm-thread, .rmap-menu, .rmap-seltool, .rmap-insp-float, .rmap-einsp, .rmap-win, .rmap-frame, .rmap-radial, .rmap-dock, .rmap-zoom, .rmap-pagebar, .rmap-runbar')) return;   // overlays / real objects only
      if (commentMode) return;   // comment-mode owns the single-click canvas flow
      if (!props.canEdit && !commentsCap) return;   // nothing to add → no menu (a commenter-only viewer still gets Komment)
      e.preventDefault();
      cancelFly(); tourStop(); setMenu(null); setComposer(null); setSelEdge(null);
      var p = stageXY(e);
      setRadial({ sx: p.x, sy: p.y, wx: Math.round((p.x - view.tx) / view.k), wy: Math.round((p.y - view.ty) / view.k) });
    }
    function framePatch(id, patch) {
      setFrames(function (F) { return F.map(function (f) { return f.id === id ? Object.assign({}, f, patch) : f; }); });
      sb.from('research_map_frames').update(Object.assign({}, patch, { updated_at: new Date().toISOString() })).eq('id', id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Keret mentése sikertelen: ' + r.error.message, { kind: 'error' }); });
    }
    function frameDelete(id) { setFrames(function (F) { return F.filter(function (f) { return f.id !== id; }); }); sb.from('research_map_frames').delete().eq('id', id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Keret törlése sikertelen: ' + r.error.message, { kind: 'error' }); }); }
    function frameRename(f) { var v = window.prompt('Keret neve:', f.title); if (v != null && String(v).trim()) framePatch(f.id, { title: String(v).trim() }); }
    function frameRecolor(f) { var i = FRAME_COLORS.indexOf(f.color); framePatch(f.id, { color: FRAME_COLORS[(i + 1) % FRAME_COLORS.length] }); }
    // inline "generate here" (Luma): the frame ✨-input no longer funnels silently into the chat edge (→ text only).
    // It echoes the request, classifies the intent, and offers CLICKABLE ACTION CHIPS in the dock; a chip runs a
    // STRUCTURED generator (research-ai gap/suggest) whose ideas land as real cards INSIDE the frame (placeInFrame).
    function classifyFrameIntent(t) {
      var s = String(t || '').toLowerCase();
      if (/protokoll|lépés|kísérlet|módszer|protocol|eljárás/.test(s)) return 'protocol';
      if (/irodalom|cikk|study|forrás|szakirodalom|review|keresés/.test(s)) return 'study';
      if (/rés|hiány|hézag|gap|nyitott\s*kérdés/.test(s)) return 'gap';
      if (/ötlet|javasol|kapcsolódó|hasonló|irány|felvet|suggest/.test(s)) return 'suggest';
      return null;   // ambiguous → chat fallback, still offer chips
    }
    function frameGenerate(f, text) {
      var t = String(text || '').trim(); if (!t || dBusy) return;
      setDkOpen(true); setFrGen(function (M) { var m = Object.assign({}, M); delete m[f.id]; return m; }); setFrGenOpen(function (M) { var m = Object.assign({}, M); delete m[f.id]; return m; });
      dkSay('user', 'A(z) „' + f.title + '" keretbe: ' + t);
      var intent = classifyFrameIntent(t);
      // the four decision chips; the classified intent is promoted to primary (pri) and shown first
      var chips = [
        { key: 'gap', label: '✦ Ötlet-kártyák ide', frameId: f.id, frameText: t },
        { key: 'one', label: '① Csak egyet', frameId: f.id, frameText: t },
        { key: 'protocol', label: '🧪 Protokoll a keretbe', frameId: f.id, frameText: t },
        { key: 'chat', label: '💬 Csak beszéljük meg', frameId: f.id, frameText: t }
      ];
      if (intent === 'protocol') { chips.unshift(chips.splice(2, 1)[0]); }   // protocol → front
      else if (intent === 'study') { chips.splice(2, 1, { key: 'study', label: '📚 Irodalom a keretbe', frameId: f.id, frameText: t }); }   // swap protocol→study (keeps the 💬 fallback)
      chips[0].pri = true;
      dkSay('ai', intent ? ('Mit hozzak létre a(z) „' + f.title + '" keretbe?') : ('Nem voltam biztos, mit hozzak létre — válassz:'), { frameId: f.id, actions: chips });
    }
    // place a list of freshly-created idea rows as cards INSIDE the frame bounds (world coords); grid-fills, clamps to
    // bounds, persists each layout, optimistically appends to data.ideas (past the 24-oldest reload cap). Returns [{nid,id}].
    function placeInFrame(f, rows, selOne) {
      var CW = 204, CH = 74, pad = 16, hdr = 44, gap = 16;
      var cols = Math.max(1, Math.floor((f.w - 2 * pad + gap) / (CW + gap)));
      var needH = hdr + pad + Math.ceil(rows.length / cols) * (CH + gap);
      var H = Math.max(f.h, needH);   // auto-grow the frame so the cards fit inside instead of overlapping at the bottom edge
      if (H > f.h) framePatch(f.id, { h: H });
      var placed = [], append = [];
      rows.forEach(function (row, i) {
        var nid = 'i' + row.id;
        var cx = Math.round(f.x + pad + (i % cols) * (CW + gap));
        var cy = Math.round(f.y + hdr + Math.floor(i / cols) * (CH + gap));
        cx = Math.max(f.x, Math.min(cx, f.x + f.w - CW));
        cy = Math.max(f.y + hdr, Math.min(cy, f.y + H - CH));
        setLayout(function (L) { var m = Object.assign({}, L); m[nid] = Object.assign({ x: cx, y: cy }, m[nid]); return m; });
        sb.from('research_map_layout').upsert({ project_id: props.projectId, node_id: nid, x: cx, y: cy, updated_at: new Date().toISOString() }, { onConflict: 'project_id,node_id' });
        placed.push({ nid: nid, id: row.id });
        append.push({ id: row.id, question: row.question || 'Új ötlet', hypothesis: null, rationale: null, novelty: row.novelty != null ? row.novelty : null, status: row.status || 'candidate', source: row.source || 'gap' });
      });
      setData(function (D) { if (!D) return D; var have = {}; (D.ideas || []).forEach(function (x) { have[x.id] = 1; }); return Object.assign({}, D, { ideas: (D.ideas || []).concat(append.filter(function (x) { return !have[x.id]; })) }); });
      if (selOne && placed.length === 1) setSel(placed[0].nid);
      setJustPlaced(placed.map(function (x) { return x.nid; }));
      setTimeout(function () { if (alive.current) setJustPlaced(null); }, 1600);
      return placed;
    }
    // undo a placeInFrame batch: remove the ideas + layout, locally + remotely. Optimistic, but confirm ONLY after
    // the server delete succeeds; if it fails (network/RLS) restore the cards + report, so a failed undo never
    // silently claims success and leaves orphans that reappear on the next reload.
    function undoPlaced(placed) {
      var ids = (placed || []).map(function (x) { return x.id; }), nids = (placed || []).map(function (x) { return x.nid; });
      if (!ids.length) return;
      var idset = {}; ids.forEach(function (i) { idset[i] = 1; });
      var restoreRows = ((data && data.ideas) || []).filter(function (x) { return idset[x.id]; });   // snapshot for rollback
      var restoreLayout = {}; nids.forEach(function (n) { if (layout[n]) restoreLayout[n] = layout[n]; });
      setData(function (D) { if (!D) return D; return Object.assign({}, D, { ideas: (D.ideas || []).filter(function (x) { return !idset[x.id]; }) }); });
      setLayout(function (L) { var m = Object.assign({}, L); nids.forEach(function (n) { delete m[n]; }); return m; });
      function undoFail(msg) {
        if (!alive.current) return;
        setData(function (D) { if (!D) return D; var have = {}; (D.ideas || []).forEach(function (x) { have[x.id] = 1; }); return Object.assign({}, D, { ideas: (D.ideas || []).concat(restoreRows.filter(function (x) { return !have[x.id]; })) }); });
        setLayout(function (L) { var m = Object.assign({}, L); Object.keys(restoreLayout).forEach(function (n) { m[n] = restoreLayout[n]; }); return m; });
        window.PRUI.toast('A visszavonás nem sikerült: ' + msg, { kind: 'error' });
      }
      sb.from('research_ideas').delete().in('id', ids).then(function (r) {
        if (r && r.error) { undoFail(r.error.message); return; }
        sb.from('research_map_layout').delete().eq('project_id', props.projectId).in('node_id', nids);   // layout rows: best-effort cleanup
        if (alive.current) dkSay('ai', '↩ Visszavontam a(z) ' + ids.length + ' ötletet.');
      }, function () { undoFail('hálózat'); });
    }
    // dispatcher for an action chip attached to a dock message (i = message index, a = the chip's action object)
    function dkRunAction(i, a) {
      if (a.key === 'undo') { undoPlaced(a.placed || []); dkMarkDone(i); return; }
      if (dBusy) return;
      var f = a.frameId ? frames.filter(function (x) { return x.id === a.frameId; })[0] : null;
      if (a.key === 'chat') { dkMarkDone(i); dkSend(a.frameText || '', true); return; }   // the old text-only path, on demand (frameGenerate already echoed the request)
      if (a.key === 'protocol') {
        if (!window.confirm('Ez felülírja a projekt jelenlegi protokollját. Létrehozzam a keret témájából?')) return;
        dkMarkDone(i); dkCmd('protocol'); return;
      }
      if (a.key === 'study') { dkMarkDone(i); dkCmd('study'); return; }
      // gap / one / more / redo → generate research-gap ideas, then place them inside the frame
      if (!f) { dkSay('ai', '⚠️ A keret időközben megszűnt.'); return; }
      var CORE = window.PRAutopilotCore; if (!CORE || !CORE.callEdge) { dkSay('ai', 'A generátor nem elérhető (autopilot-core).'); return; }
      // shared tail: slice by chip, place the rows in the frame, post the closing turn with follow-up chips
      function finishPlace(rows) {
        if (!alive.current) return; setDBusy(false);
        if (a.key === 'one') rows = rows.slice(0, 1); else if (a.key === 'more') rows = rows.slice(0, 3);
        if (!rows.length) { dkSay('ai', '⚠️ Nem jött létre új ötlet (lehet, mind ismétlődés volt).'); return; }
        var placed = placeInFrame(f, rows, a.key === 'one');
        dkMarkDone(i);
        window.PRUI.toast('✓ ' + placed.length + ' ötlet a(z) „' + f.title + '" keretbe.', { kind: 'success' });
        dkSay('ai', '✓ ' + placed.length + ' ötlet-kártya a(z) „' + f.title + '" keretbe került.', { frameId: f.id, actions: [
          { key: 'more', label: '➕ Még', frameId: f.id, frameText: a.frameText },
          { key: 'protocol', label: '🧪 Protokoll', frameId: f.id, frameText: a.frameText },
          { key: 'undo', label: '↩ Visszavonás', placed: placed }
        ] });
      }
      setDBusy(true);
      var ts = new Date(Date.now() - 4000).toISOString();
      // snapshot existing idea-ids so the fallback (old edge, no ids) can exclude EVERYTHING that predates this action —
      // not just a fragile time window — leaving only genuinely-new rows.
      sb.from('research_ideas').select('id').eq('project_id', props.projectId).then(function (pre) {
        var beforeIds = {}; ((pre && pre.data) || []).forEach(function (x) { beforeIds[x.id] = 1; });
        CORE.callEdge('research-ai', { action: 'gap', project_id: props.projectId }).then(function (d) {
          if (!alive.current) return;
          if (d && d.error) { setDBusy(false); dkSay('ai', '⚠️ ' + d.error); return; }
          // PREFERRED: the (updated) edge returns exactly the rows it inserted → race-free, no guessing.
          if (d && d.ideas && d.ideas.length) { finishPlace(d.ideas.slice()); return; }
          var want = Math.max(1, (d && d.count) || 5);
          // FALLBACK (old edge): newest rows created since `ts` that were NOT present before this action.
          sb.from('research_ideas').select('id,question,source,novelty,status,created_at').eq('project_id', props.projectId).gt('created_at', ts).order('created_at', { ascending: false }).limit(want + 10).then(function (r) {
            if (!alive.current) return;
            if (r && r.error) { setDBusy(false); dkSay('ai', '⚠️ ' + r.error.message); return; }
            var rows = ((r && r.data) || []).filter(function (x) { return !beforeIds[x.id]; }).slice(0, want);
            finishPlace(rows);
          }, function () { if (alive.current) { setDBusy(false); dkSay('ai', '⚠️ hálózat'); } });
        }, function () { if (alive.current) { setDBusy(false); dkSay('ai', '⚠️ hálózat'); } });
      }, function () { if (alive.current) { setDBusy(false); dkSay('ai', '⚠️ hálózat'); } });
    }
    // ---- assistant dock: user-resize (drag the left/top edge) + vertical-maximize (⤢). Persisted to localStorage. ----
    function dockVP() { var st = stageRef.current; return { w: st ? st.clientWidth : (window.innerWidth || 1200), h: st ? st.clientHeight : (window.innerHeight || 800) }; }
    var DOCK_MIN_W = 300, DOCK_MIN_H = 240;
    function startDockResize(e, mode) {   // mode: 'w' (left edge) | 'h' (top edge) | 'wh' (top-left corner)
      e.preventDefault(); e.stopPropagation();
      var el = dockRef.current; if (!el) return;
      var sx = e.clientX, sy = e.clientY, sw = el.offsetWidth, sh = el.offsetHeight, vp = dockVP();
      var maxW = vp.w - 28, maxH = vp.h - 28;
      // width-only drag while maximized must NOT capture the full height as the restore height — keep the prior stored h (or none)
      var baseH = (mode === 'w' && dkFull) ? ((dkDim && dkDim.h) || null) : sh;
      function mv(ev) {
        var nw = sw, nh = baseH;
        if (mode === 'w' || mode === 'wh') nw = Math.max(DOCK_MIN_W, Math.min(maxW, sw + (sx - ev.clientX)));   // anchored bottom-right → grows leftward
        if (mode === 'h' || mode === 'wh') nh = Math.max(DOCK_MIN_H, Math.min(maxH, sh + (sy - ev.clientY)));   // grows upward
        setDkDim({ w: Math.round(nw), h: (nh == null ? undefined : Math.round(nh)) });
      }
      function up() {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        if (mode !== 'w' && dkFull) { setDkFull(false); try { localStorage.setItem('pr-rmap-dock-full', '0'); } catch (er) { } }   // a manual height drag exits full mode
        try { localStorage.setItem('pr-rmap-dock-dim', JSON.stringify(dkDimRef.current)); } catch (er) { }
      }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function toggleDockFull() { var nv = !dkFull; setDkFull(nv); try { localStorage.setItem('pr-rmap-dock-full', nv ? '1' : '0'); } catch (e) { } }
    function dockStyle() {
      var s = {};
      if (dkFull) { s.height = 'calc(100% - 28px)'; s.maxHeight = 'calc(100% - 28px)'; if (dkDim && dkDim.w) s.width = dkDim.w + 'px'; return s; }
      if (dkDim) { if (dkDim.w) s.width = dkDim.w + 'px'; if (dkDim.h) { s.height = dkDim.h + 'px'; s.maxHeight = 'calc(100% - 28px)'; } }
      return s;
    }
    // ---- Map comments / annotations — migration-72. Any project READER can comment (supervisor feedback). ----
    function commentCanEditOne(c) { return c && (c.author === props.viewerId || props.canEdit); }
    // @mention candidates = accepted members + currently-online users (deduped, minus self). Notifications table
    // already allows client insert (RLS auth.uid() is not null) so no migration is needed for mentions.
    function mentionCandidates() {
      var seen = {}, list = [];
      (members || []).forEach(function (m) { if (m.user_id && m.user_id !== props.viewerId && m.pname && !seen[m.user_id]) { seen[m.user_id] = 1; list.push({ id: m.user_id, name: m.pname }); } });
      online.forEach(function (u) { if (u.id && u.id !== props.viewerId && u.name && !seen[u.id]) { seen[u.id] = 1; list.push({ id: u.id, name: u.name }); } });
      return list;
    }
    function insertMention(name) { setCmText(function (v) { return (v && !/\s$/.test(v) ? v + ' ' : v) + '@' + name + ' '; }); }
    // resolve a user id → display name via members + presence + self
    function nameOf(uid) {
      if (!uid) return ''; if (uid === props.viewerId) return (props.viewer && props.viewer.name) || 'Te';
      var m = (members || []).filter(function (x) { return x.user_id === uid; })[0]; if (m && m.pname) return m.pname;
      var o = online.filter(function (x) { return x.id === uid; })[0]; if (o && o.name) return o.name;
      return 'Kolléga';
    }
    // protocol-step assignee + sign-off (migration-75). `step` is the node.ref (a research_protocol_steps row).
    function stepPatch(step, patch) {
      if (!step || !step.id || !props.canEdit) return;
      sb.from('research_protocol_steps').update(patch).eq('id', step.id).then(function (r) { if (!alive.current) return; if (r && r.error) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; } setBump(function (x) { return x + 1; }); });
    }
    function stepSetAssignee(step, uid) { stepPatch(step, { assignee_id: uid || null }); }
    // sign-off goes through the research_step_signoff RPC so a read-only SUPERVISOR can also sign off (migration-77).
    // Pre-migration-77 the RPC is absent → an editor falls back to a direct column update (migration-75).
    function stepSignoffRpc(step, clear) {
      if (!step || !step.id) return;
      sb.rpc('research_step_signoff', { step_id: step.id, clear: clear }).then(function (r) {
        if (!alive.current) return;
        if (r && r.error) {
          if (props.canEdit) { stepPatch(step, clear ? { signed_off_by: null, signed_off_at: null } : { signed_off_by: props.viewerId, signed_off_at: new Date().toISOString() }); return; }
          window.PRUI.toast('Sign-off nem engedélyezett (fut a migration-77?): ' + r.error.message, { kind: 'error' }); return;
        }
        setBump(function (x) { return x + 1; });
      }, function () { if (props.canEdit) stepPatch(step, clear ? { signed_off_by: null, signed_off_at: null } : { signed_off_by: props.viewerId, signed_off_at: new Date().toISOString() }); });
    }
    function stepSignOff(step) { stepSignoffRpc(step, false); }
    function stepUnsignOff(step) { stepSignoffRpc(step, true); }
    // P2 inline controls (on an enlarged card): advance a protocol-step status, or set a paper screening decision.
    function stepCycleStatus(step) { if (!step || !props.canEdit) return; var s = step.status; var next = (s === 'done') ? 'todo' : ((s === 'doing' || s === 'running') ? 'done' : 'running'); stepPatch(step, { status: next }); }   // protocol-step vocab = running (NOT doing, which is research_todos) so the Kanban board + autopilot agree
    function setPaperScreen(paper, v) {
      if (!paper || !paper.id || !props.canEdit) return;
      sb.from('research_sources').update({ screening: v }).eq('id', paper.id).then(function (r) { if (!alive.current) return; if (r && r.error) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; } setBump(function (x) { return x + 1; }); });
    }
    function notifyMentions(body, target) {
      var cands = mentionCandidates(); if (!cands.length) return;
      // match longest name first and blank out the matched span, so a shorter PREFIX name
      // (e.g. "Anna" ⊂ "Anna Kovács") cannot also match and send an unintended notification.
      var scan = String(body);
      var hit = cands.slice().sort(function (a, b) { return b.name.length - a.name.length; }).filter(function (u) {
        var needle = '@' + u.name, idx = scan.indexOf(needle);
        if (idx < 0) return false;
        scan = scan.slice(0, idx) + ' '.repeat(needle.length) + scan.slice(idx + needle.length);
        return true;
      });
      if (!hit.length) return;
      var rows = hit.map(function (u) { return { recipient_id: u.id, kind: 'request', payload: { type: 'research_map_mention', project_id: props.projectId, project_title: (props.project && props.project.title) || '', from: (props.viewer && props.viewer.name) || 'Kolléga', excerpt: String(body).slice(0, 140), node_id: (target && target.node_id) || null } }; });
      sb.from('notifications').insert(rows).then(function () { }, function () { });
    }
    function commentAdd(target, text) {
      var t = String(text || '').trim(); if (!t || !commentsCap) return;
      var row = Object.assign({ project_id: props.projectId, body: t }, target);   // target = {node_id} or {x,y}
      sb.from('research_map_comments').insert(row).select('id,node_id,x,y,body,author,resolved,created_at').single().then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { window.PRUI.toast('Komment mentése sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        if (r && r.data) { setComments(function (C) { return C.some(function (c) { return c.id === r.data.id; }) ? C : C.concat([r.data]); }); notifyMentions(t, target); }
      });
      setComposer(null); setCmText('');
    }
    function commentResolve(c, val) {
      setComments(function (C) { return C.map(function (x) { return x.id === c.id ? Object.assign({}, x, { resolved: val }) : x; }); });
      sb.from('research_map_comments').update({ resolved: val }).eq('id', c.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); });
    }
    function commentDelete(c) {
      setComments(function (C) { return C.filter(function (x) { return x.id !== c.id; }); });
      sb.from('research_map_comments').delete().eq('id', c.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Törlés sikertelen: ' + r.error.message, { kind: 'error' }); });
    }
    // ---- Map pages (saved views) — migration-73. A page stores a viewport + an optional "only pinned" curation lens. ----
    function pageCreate() {
      if (!props.canEdit || !pagesCap) return;
      var nm = window.prompt('Nézet neve:', 'Nézet ' + (pages.length + 1)); if (nm == null) return;
      sb.from('research_map_pages').insert({ project_id: props.projectId, name: String(nm).trim() || 'Nézet', tx: view.tx, ty: view.ty, k: view.k, only_pinned: false, ord: pages.length }).select('id,name,tx,ty,k,only_pinned,ord').single().then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { window.PRUI.toast('Nézet mentése sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        if (r && r.data) { setPages(function (P) { return P.some(function (x) { return x.id === r.data.id; }) ? P : P.concat([r.data]); }); setActivePage(r.data.id); }
      });
    }
    function pageApply(pg) { if (!pg) { setActivePage(null); return; } setActivePage(pg.id); setView({ tx: pg.tx, ty: pg.ty, k: pg.k }); }
    function pageUpdateView(pg) {   // re-capture the current viewport into an existing page
      if (!props.canEdit) return;
      setPages(function (P) { return P.map(function (x) { return x.id === pg.id ? Object.assign({}, x, { tx: view.tx, ty: view.ty, k: view.k }) : x; }); });
      sb.from('research_map_pages').update({ tx: view.tx, ty: view.ty, k: view.k }).eq('id', pg.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Nézet frissítése sikertelen: ' + r.error.message, { kind: 'error' }); });
    }
    function pageToggleCurated(pg) {
      if (!props.canEdit) return; var val = !pg.only_pinned;
      setPages(function (P) { return P.map(function (x) { return x.id === pg.id ? Object.assign({}, x, { only_pinned: val }) : x; }); });
      sb.from('research_map_pages').update({ only_pinned: val }).eq('id', pg.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); });
    }
    function pageRename(pg) { if (!props.canEdit) return; var v = window.prompt('Nézet neve:', pg.name); if (v == null || !String(v).trim()) return; setPages(function (P) { return P.map(function (x) { return x.id === pg.id ? Object.assign({}, x, { name: String(v).trim() }) : x; }); }); sb.from('research_map_pages').update({ name: String(v).trim() }).eq('id', pg.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); }); }
    function pageDelete(pg) { if (!props.canEdit) return; setPages(function (P) { return P.filter(function (x) { return x.id !== pg.id; }); }); setActivePage(function (a) { return a === pg.id ? null : a; }); sb.from('research_map_pages').delete().eq('id', pg.id).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Törlés sikertelen: ' + r.error.message, { kind: 'error' }); }); }
    // ---- project members / collaborators (migration-74). members === null → pre-migration (no members UI). ----
    function loadMembers() {
      sb.from('research_project_members').select('user_id,role,accepted,invited_by,created_at').eq('project_id', props.projectId).then(function (r) {
        if (!alive.current) return; if (r && r.error) { setMembers(null); return; }
        var rows = r.data || [], ids = rows.map(function (m) { return m.user_id; });
        if (!ids.length) { setMembers([]); return; }
        sb.from('profiles_public').select('id,name,avatar').in('id', ids).then(function (pr) {
          if (!alive.current) return; var byId = {}; ((pr && pr.data) || []).forEach(function (p) { byId[p.id] = p; });
          setMembers(rows.map(function (m) { return Object.assign({}, m, { pname: (byId[m.user_id] && byId[m.user_id].name) || 'Kolléga', pavatar: byId[m.user_id] && byId[m.user_id].avatar }); }));
        });
      });
    }
    function memberInvite(u, role) {
      if (!u || !u.id) return;
      sb.from('research_project_members').insert({ project_id: props.projectId, user_id: u.id, role: role || 'viewer', accepted: false }).then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { window.PRUI.toast('Meghívás sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        window.PRUI.toast('Meghívó elküldve' + (u.name ? ': ' + u.name : ''), { kind: 'success' }); loadMembers();
      });
    }
    function memberSetRole(m, role) {
      setMembers(function (M) { return (M || []).map(function (x) { return x.user_id === m.user_id ? Object.assign({}, x, { role: role }) : x; }); });
      sb.from('research_project_members').update({ role: role }).eq('project_id', props.projectId).eq('user_id', m.user_id).then(function (r) { if (r && r.error && alive.current) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); loadMembers(); } });
    }
    function memberRemove(m) {
      setMembers(function (M) { return (M || []).filter(function (x) { return x.user_id !== m.user_id; }); });
      sb.from('research_project_members').delete().eq('project_id', props.projectId).eq('user_id', m.user_id).then(function (r) { if (r && r.error && alive.current) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); loadMembers(); } });
    }
    function memberAccept() { sb.rpc('research_member_accept', { pid: props.projectId }).then(function (r) { if (!alive.current) return; if (r && r.error) { window.PRUI.toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; } window.PRUI.toast('Meghívó elfogadva', { kind: 'success' }); loadMembers(); }); }
    var MEMBER_ROLES = [['editor', 'Szerkesztő'], ['commenter', 'Kommentelő'], ['viewer', 'Megfigyelő']];
    function roleLabel(r) { var m = { owner: 'Tulajdonos', editor: 'Szerkesztő', commenter: 'Kommentelő', viewer: 'Megfigyelő' }; return m[r] || r; }
    function startFrameDrag(e, f, mode) {   // mode: 'move' (titlebar) | 'resize' (corner handle)
      if (e.button !== 0 || !props.canEdit) return; e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, k = view.k || 1, ox = f.x, oy = f.y, ow = f.w, oh = f.h;
      frdrag.current = { id: f.id, moved: false, geo: null };
      var fmv = function (ev) {
        if (!frdrag.current) return; if (ev.buttons === 0) { ffin(); return; }
        if (Math.abs(ev.clientX - sx) > 2 || Math.abs(ev.clientY - sy) > 2) {
          var ddx = Math.round((ev.clientX - sx) / k), ddy = Math.round((ev.clientY - sy) / k);
          frdrag.current.moved = true;
          frdrag.current.geo = (mode === 'move') ? { id: f.id, x: ox + ddx, y: oy + ddy, w: ow, h: oh } : { id: f.id, x: ox, y: oy, w: Math.max(140, ow + ddx), h: Math.max(90, oh + ddy) };
          setFrLive(frdrag.current.geo);
        }
      };
      var ffin = function () {
        var d = frdrag.current; if (!d) return; frdrag.current = null;
        window.removeEventListener('mousemove', fmv); window.removeEventListener('mouseup', fup); window.removeEventListener('blur', ffin);
        setFrLive(null);
        if (d.moved && d.geo) framePatch(d.id, { x: d.geo.x, y: d.geo.y, w: d.geo.w, h: d.geo.h });
      };
      var fup = function () { ffin(); };
      window.addEventListener('mousemove', fmv); window.addEventListener('mouseup', fup); window.addEventListener('blur', ffin);
    }
    // ---- export (client-only, CSP-safe canvas render → PNG download). Single card or the whole visible graph. ----
    // maps the ACTUAL node.t values (see RMAP_TYPE) to an accent color for the exported card stripe/label
    var EXP_COL = { idea: '#7c3aed', paper: '#0891b2', study: '#0891b2', figure: '#d97706', review: '#4f46e5', srq: '#4f46e5', sreview: '#4f46e5', step: '#2563eb', venue: '#c026d3', section: '#059669', dataset: '#0d9488', file: '#059669', chat: '#64748b' };
    function expDownload(canvas, name) { try { var url = canvas.toDataURL('image/png'); var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch (e) { window.PRUI.toast('Export sikertelen: ' + (e && e.message || e), { kind: 'error' }); } }
    function expRoundRect(ctx, x, y, w, hh, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function expWrap(ctx, text, maxW) { var words = String(text || '').split(/\s+/), lines = [], cur = ''; for (var i = 0; i < words.length; i++) { var t = cur ? cur + ' ' + words[i] : words[i]; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t; } if (cur) lines.push(cur); return lines; }
    function expDrawCard(ctx, n, x, y) {
      var col = EXP_COL[n.t] || '#64748b';
      ctx.save();
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.5; expRoundRect(ctx, x, y, 204, 74, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; expRoundRect(ctx, x, y, 6, 74, 3); ctx.fill();   // type stripe
      ctx.fillStyle = col; ctx.font = '700 10px system-ui, -apple-system, sans-serif'; ctx.fillText(((RMAP_TYPE[n.t] && RMAP_TYPE[n.t].lab) || n.t).toUpperCase(), x + 16, y + 20);
      ctx.fillStyle = '#0f172a'; ctx.font = '700 12.5px system-ui, -apple-system, sans-serif';
      var lines = expWrap(ctx, n.title, 176).slice(0, 3);
      lines.forEach(function (ln, i) { ctx.fillText(ln, x + 16, y + 38 + i * 15); });
      ctx.restore();
    }
    function exportNode(n) {
      if (!n) return; var pad = 20, W = 204 + pad * 2, H = 74 + pad * 2, dpr = Math.min(2, window.devicePixelRatio || 1);
      var c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr; var ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H); expDrawCard(ctx, n, pad, pad);
      expDownload(c, 'publify-' + (n.t || 'kartya') + '.png');
    }
    function exportSet(vis, fname) {
      if (!vis.length) return;
      var idset = {}; vis.forEach(function (n) { idset[n.id] = 1; });
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      vis.forEach(function (n) { if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y; if (n.x + 204 > maxX) maxX = n.x + 204; if (n.y + 74 > maxY) maxY = n.y + 74; });
      var pad = 40, W = (maxX - minX) + pad * 2, H = (maxY - minY) + pad * 2, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (W * dpr > 8000 || H * dpr > 8000) { dpr = Math.min(dpr, Math.min(8000 / W, 8000 / H)); }
      var c = document.createElement('canvas'); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); var ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
      ctx.translate(pad - minX, pad - minY);
      // edges first (only between two nodes present in this export set)
      g.E.forEach(function (e) { var a = g.by[e[0]], b = g.by[e[1]]; if (!a || !b || !idset[a.id] || !idset[b.id]) return; var cite = e[2] === 'cite'; ctx.strokeStyle = cite ? '#c7b8f0' : '#cbd5e1'; ctx.lineWidth = cite ? 1.5 : 2; ctx.beginPath(); ctx.moveTo(a.x + 102, a.y + 37); ctx.lineTo(b.x + 102, b.y + 37); ctx.stroke(); });
      vis.forEach(function (n) { expDrawCard(ctx, n, n.x, n.y); });
      expDownload(c, fname);
    }
    function exportMap() { exportSet(g.N.filter(function (n) { return nodeVisible(n); }), 'publify-terkep.png'); }
    function exportSelection() { exportSet(g.N.filter(function (n) { return msel[n.id] && !n.mapHidden; }), 'publify-kijeloles.png'); }
    function resetLayout() {
      if (!props.canEdit) return;
      setLayout({}); setDlive(null);
      sb.from('research_map_layout').delete().eq('project_id', props.projectId).then(function (r) { if (r && r.error && alive.current) window.PRUI.toast('Elrendezés visszaállítása: ' + r.error.message, { kind: 'error' }); });
    }
    // Fázis 2.5 (opt-in, Prezi-B): arrange the cards into per-phase lanes + a named frame each. Overwrites manual
    // positions → behind a confirm; matches frames by title so re-running updates instead of duplicating.
    var PHASE_HU = ['💡 Ötlet', '📚 Irodalom', '🔬 Áttekintés', '🧪 Protokoll', '🎯 Folyóirat', '✍️ Írás'];
    var PHASE_COL = ['violet', 'cyan', 'slate', 'amber', 'rose', 'green'];
    function autoLayoutStages() {
      if (!props.canEdit || !framesCap || stagesBusy.current) return;
      stagesBusy.current = true;   // guard from the moment ⌗ is clicked until the arrange settles (no duplicate frames on double-click)
      window.PRUI.confirm({ title: 'Rendezés fázisokba?', body: 'A kártyák a munkafolyamat-fázisok (Ötlet → Irodalom → Áttekintés → Protokoll → Folyóirat → Írás) szerint sávokba rendeződnek, és minden fázishoz keret készül. Ez FELÜLÍRJA a kézi elrendezést (a ↺ gombbal visszaállítható).', confirmLabel: 'Rendezés' }).then(function (ok) {
        if (!ok || !alive.current) { stagesBusy.current = false; return; }
        var LANE_W = 300, CW = 204, CH = 74, gapY = 22, padX = (LANE_W - CW) / 2, topY = 56, laneGap = 40;
        var byPhase = {}; g.N.forEach(function (n) { if (n.mapHidden) return; var ph = (n.ph != null ? n.ph : 0); (byPhase[ph] = byPhase[ph] || []).push(n); });
        var phases = Object.keys(byPhase).map(Number).sort(function (a, b) { return a - b; });
        var laneX = 0, updates = [], frameOps = [];
        phases.forEach(function (ph) {
          var list = byPhase[ph], y = topY;
          list.forEach(function (n) { updates.push({ id: n.id, x: Math.round(laneX + padX), y: Math.round(y) }); y += CH + gapY; });
          frameOps.push({ ph: ph, x: laneX, y: 0, w: LANE_W, h: topY + list.length * (CH + gapY) + 14 });
          laneX += LANE_W + laneGap;
        });
        setLayout(function (L) { var m = Object.assign({}, L); updates.forEach(function (u) { m[u.id] = Object.assign({}, m[u.id], { x: u.x, y: u.y }); }); return m; });
        updates.forEach(function (u) { persistPos(u.id, u.x, u.y); });
        frameOps.forEach(function (fo) {
          var title = PHASE_HU[fo.ph] || ('Fázis ' + (fo.ph + 1)), existing = frames.filter(function (f) { return f.title === title; })[0];
          if (existing) framePatch(existing.id, { x: fo.x, y: fo.y, w: fo.w, h: fo.h });
          else sb.from('research_map_frames').insert({ project_id: props.projectId, title: title, x: fo.x, y: fo.y, w: fo.w, h: fo.h, color: PHASE_COL[fo.ph] || 'slate' }).select('id,title,x,y,w,h,color').single().then(function (r) { if (alive.current && r && r.data) setFrames(function (F) { return F.some(function (f) { return f.id === r.data.id; }) ? F : F.concat([r.data]); }); });
        });
        setTimeout(function () { if (alive.current) fitView(); stagesBusy.current = false; }, 620);
      }, function () { stagesBusy.current = false; });
    }
    function toggleMsel(id) { setSelEdge(null); setMsel(function (M) { var m = Object.assign({}, M); if (m[id]) delete m[id]; else m[id] = true; return m; }); }   // node multi-select clears any edge selection (mutual exclusion)
    function startNodeDrag(e, n) {
      if (e.button !== 0) return;   // left button only — right-click opens the generate menu
      if (commentMode) { e.stopPropagation(); setComposer({ node_id: n.id }); setCmText(''); return; }   // comment mode: attach a comment to this card
      if (e.shiftKey) { toggleMsel(n.id); return; }   // shift-click toggles multi-selection (no drag)
      var startX = e.clientX, startY = e.clientY, k = view.k || 1, ox = n.x, oy = n.y, can = props.canEdit;
      // group drag: if this card is part of a multi-selection (>1), move ALL selected cards together
      if (can && msel[n.id] && Object.keys(msel).length > 1) {
        var gids = Object.keys(msel).filter(function (id) { return g.by[id] && !(g.by[id].mapHidden); });
        var gbase = {}; gids.forEach(function (id) { gbase[id] = { x: g.by[id].x, y: g.by[id].y }; });
        gdrag.current = { ids: gids, base: gbase, moved: false, dx: 0, dy: 0 };
        var gmv = function (ev) {
          if (!gdrag.current) return;
          if (ev.buttons === 0) { gfin(); return; }
          var mdx = ev.clientX - startX, mdy = ev.clientY - startY;
          if (Math.abs(mdx) > 3 || Math.abs(mdy) > 3) { gdrag.current.moved = true; gdrag.current.dx = Math.round(mdx / k); gdrag.current.dy = Math.round(mdy / k); setGLive({ dx: gdrag.current.dx, dy: gdrag.current.dy, base: gbase }); }
        };
        var gfin = function () {
          var d = gdrag.current; if (!d) return; gdrag.current = null;
          window.removeEventListener('mousemove', gmv); window.removeEventListener('mouseup', gup); window.removeEventListener('blur', gfin);
          setGLive(null);
          if (d.moved) {
            setLayout(function (L) { var m = Object.assign({}, L); d.ids.forEach(function (id) { m[id] = Object.assign({}, m[id], { x: d.base[id].x + d.dx, y: d.base[id].y + d.dy }); }); return m; });
            d.ids.forEach(function (id) { persistPos(id, d.base[id].x + d.dx, d.base[id].y + d.dy); });
          }
        };
        var gup = function () { gfin(); };
        window.addEventListener('mousemove', gmv); window.addEventListener('mouseup', gup); window.addEventListener('blur', gfin);
        return;
      }
      ndrag.current = { id: n.id, moved: false, lx: ox, ly: oy };   // lx/ly = last visible position → persisted on any terminating event
      // finish() is the SINGLE termination path (guarded against double-call). It runs on mouseup, on a re-entry with
      // no button held (release happened off-window → mouseup was never delivered), and on window blur (alt-tab). This
      // prevents a leaked listener / "sticky" card that follows the cursor with no button pressed and later persists a
      // wrong position.
      function finish() {
        var d = ndrag.current; if (!d) return; ndrag.current = null;
        window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('blur', finish);
        setDlive(null);
        if (d.moved) { setLayout(function (L) { var m = Object.assign({}, L); m[n.id] = Object.assign({}, m[n.id], { x: d.lx, y: d.ly }); return m; }); persistPos(n.id, d.lx, d.ly); }
        else if (linkFrom) { createManualEdge(linkFrom, n.id); }   // P2 link-mode: this card is the target of a manual edge
        else { setSel(n.id); setMsel({}); setSelEdge(null); if (n.id === 'lit') setLitOpen(function (v) { return !v; }); }
      }
      function mv(ev) {
        if (!ndrag.current) return;
        if (ev.buttons === 0) { finish(); return; }   // button already released (off-window) → recover on re-entry
        var mdx = ev.clientX - startX, mdy = ev.clientY - startY;
        if (can && (Math.abs(mdx) > 3 || Math.abs(mdy) > 3)) { ndrag.current.moved = true; ndrag.current.lx = Math.round(ox + mdx / k); ndrag.current.ly = Math.round(oy + mdy / k); setDlive({ id: n.id, x: ndrag.current.lx, y: ndrag.current.ly }); }
      }
      function up() { finish(); }
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); window.addEventListener('blur', finish);
    }

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
      if (n.t === 'dataset') return [['protocol', '🧪 Protokoll ehhez az adathoz']];
      if (n.t === 'file' || n.t === 'chat' || n.t === 'figure' || n.t === 'srq' || n.t === 'sreview') return [];   // content nodes — no generation from them
      return [['ideas', '✦ Ötletek generálása'], ['protocol', '🧪 Protokoll']];
    }
    // F3: REGENERATE this exact node (in place, keeps its position). Only where an existing edge cleanly supports it:
    // a protocol step (refine_step) and a generated review file (generate_review overwrites the same file).
    function regenActions(n) {
      if (!n) return [];
      if (n.t === 'step' && n.ref && n.ref.id) return [['regen_step', '🔄 Lépés újragenerálása']];
      if (n.t === 'review' && n.ref && /-[0-9a-f]{8}-review\./.test(String(n.ref.path || ''))) return [['regen_review', '🔄 Áttekintés újragenerálása']];
      return [];
    }
    // F8 — provenance context: walk UPSTREAM from a node to its originating idea + a short lineage summary, so a
    // generation FROM that node is grounded in its actual ancestry (idea → study → review → …), not just the project
    // goal. Derived directly from `data` (the same relationships graph() encodes) → returns { ideaId, text }.
    function lineageOf(n) {
      var d = data || {}, ideas = d.ideas || [], studies = d.studies || [], parts = [], idea = null, study = null;
      function studyFor(node) {
        if (node.t === 'study') return node.ref || studies[0] || null;
        if (node.t === 'review') {
          if (node.id === 'sr') return studies[0] || null;
          var mm = String((node.ref && node.ref.path) || '').match(/-([0-9a-f]{8})-review\./);
          return mm ? (studies.filter(function (s) { return String(s.id).replace(/-/g, '').slice(0, 8) === mm[1]; })[0] || studies[0] || null) : (studies[0] || null);
        }
        return null;
      }
      if (n.t === 'idea') idea = n.ref;
      else study = studyFor(n);
      if (!study && (n.t === 'step' || n.t === 'venue' || n.t === 'section')) study = studies[0] || null;
      if (!idea) {
        var iid = study && study.idea_id;
        idea = iid ? (ideas.filter(function (x) { return x.id === iid; })[0] || null) : null;
        if (!idea && (n.t === 'step' || n.t === 'venue' || n.t === 'section' || n.t === 'review')) idea = ideas.filter(function (x) { return x.status === 'selected'; })[0] || ideas[0] || null;
      }
      if (idea) parts.push('KIINDULÓ ÖTLET: ' + String(idea.question || '') + (idea.hypothesis ? ' | Hipotézis: ' + idea.hypothesis : ''));
      if (study) parts.push('IRODALOM-STUDY: ' + String(study.title || study.question || ''));
      if (n.t === 'paper') parts.push('KAPCSOLÓDÓ CIKK: ' + String(n.title || '') + (n.ref && n.ref.venue ? ' (' + n.ref.venue + ')' : ''));
      if (n.t === 'review') parts.push('ÁTTEKINTÉS: ' + String(n.title || ''));
      if (n.t === 'step') parts.push('KIVÁLASZTOTT PROTOKOLL-LÉPÉS: ' + String(n.title || ''));
      if (n.t === 'venue') parts.push('CÉL-FOLYÓIRAT: ' + String(n.title || ''));
      if (n.t === 'section') parts.push('DRAFT-SZEKCIÓ: ' + String(n.title || ''));
      if (n.t === 'dataset') parts.push('ADATHALMAZ: ' + String((n.ref && n.ref.name) || n.title || '') + ((n.ref && n.ref.notes) ? ' — ' + String(n.ref.notes).slice(0, 200) : ''));
      return { ideaId: idea ? idea.id : null, text: parts.join('\n') };
    }
    // Apply a refine_step result to a step row IN PLACE, conservatively (shared by F3 regenerate + F7 refine chat).
    // Only a field the refiner actually POPULATED overwrites — an empty array [] (truthy!) or blank string must NOT
    // blank existing content, since neither entry point has a user-review gate. Reports which fields changed.
    function applyRefinedStep(stepId, sp, onDone, onFail) {
      var neStr = function (v) { return v != null && String(v).trim() !== ''; };
      var neArr = function (v) { return Array.isArray(v) && v.length > 0; };
      sb.from('research_protocol_steps').select('spec').eq('id', stepId).maybeSingle().then(function (cr) {
        var spec = Object.assign({}, (cr && cr.data && cr.data.spec) || {}), changed = [];
        if (neStr(sp.instruction)) { spec.instruction = sp.instruction; changed.push('utasítás'); }
        if (neArr(sp.inputs)) { spec.inputs = sp.inputs; changed.push('bemenetek'); }
        if (neArr(sp.expected_outputs)) { spec.expected_outputs = sp.expected_outputs; changed.push('kimenetek'); }
        if (neArr(sp.acceptance)) { spec.acceptance = sp.acceptance; changed.push('elfogadási kritériumok'); }
        if (neStr(sp.command_hint)) { spec.command_hint = sp.command_hint; changed.push('parancs'); }
        if (sp.est_minutes != null && sp.est_minutes !== '') spec.est_minutes = sp.est_minutes;
        var patch = { spec: spec };
        if (neStr(sp.title)) { patch.title = sp.title; changed.push('cím'); }
        if (neStr(sp.kind)) { patch.kind = sp.kind; changed.push('típus'); }
        if (sp.needs_approval != null) patch.needs_approval = !!sp.needs_approval;
        sb.from('research_protocol_steps').update(patch).eq('id', stepId).then(function (ur) { if (ur && ur.error) { onFail(ur.error.message); return; } onDone(changed); }, function () { onFail('mentés'); });
      }, function () { onFail('spec olvasás'); });
    }
    function runGen(n, act) {
      if (genBusy) return;   // re-entrancy lock: nodes stay clickable during the async call, so guard against a double-fire (double study insert)
      var CORE = window.PRAutopilotCore; if (!CORE || !CORE.callEdge) { window.PRUI.toast('A generátor nem elérhető (autopilot-core).', { kind: 'error' }); return; }
      setMenu(null); setGenBusy(true);
      var pid = props.projectId, proj = props.project;
      function done(msg) { if (!alive.current) return; setGenBusy(false); window.PRUI.toast('✓ ' + (msg || 'Kész'), { kind: 'ok' }); setBump(function (x) { return x + 1; }); }
      function fail(e) { if (!alive.current) return; setGenBusy(false); window.PRUI.toast('Hiba: ' + e, { kind: 'error' }); }
      if (act === 'ideas') {
        var linI = lineageOf(n);   // F8: if this node has a lineage, ground the new ideas in it (suggest); else project-wide gap
        if (linI.text) CORE.callEdge('research-ai', { action: 'suggest', project_id: pid, text: 'Javasolj ÚJ, kapcsolódó kutatási ötleteket a következő leszármazás alapján:\n' + linI.text }).then(function (d) { (d && d.error) ? fail(d.error) : done(((d && d.count) || 0) + ' kapcsolódó ötlet'); }, function () { fail('hálózat'); });
        else CORE.callEdge('research-ai', { action: 'gap', project_id: pid }).then(function (d) { (d && d.error) ? fail(d.error) : done(((d && d.count) || 0) + ' ötlet-jelölt'); }, function () { fail('hálózat'); });
      }
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
      else if (act === 'protocol') {
        var linP = lineageOf(n), baseGoal = String(proj.goal || proj.title || '');   // F8: ground the protocol in the node's originating idea + lineage
        var goalP = linP.text ? (baseGoal ? baseGoal + '\n\nA KIVÁLASZTOTT CSOMÓPONT LESZÁRMAZÁSA:\n' + linP.text : linP.text) : baseGoal;
        CORE.callEdge('research-protocol', Object.assign({ action: 'generate', project_id: pid, goal: goalP }, linP.ideaId ? { idea_id: linP.ideaId } : {})).then(function (d) { (d && d.error) ? fail(d.error) : done(((d && d.steps) || 0) + ' protokoll-lépés'); }, function () { fail('hálózat'); });
      }
      else if (act === 'writing') CORE.callEdge('research-writing', { action: 'outline', project_id: pid }).then(function (d) {
        if (d && d.error) { fail(d.error); return; }
        var o = d && d.outline; if (!o || !o.sections) { fail('üres vázlat'); return; }
        var md = '# ' + (o.title || proj.title) + '\n\n' + (o.abstract || '') + '\n\n## Szekciók\n' + o.sections.map(function (s) { return '- ' + (s.heading || s.key); }).join('\n');
        CORE.saveFile(pid, 'writing/outline.md', md, 'ai').then(function (sf) { if (sf && sf.error) { fail(sf.error.message || 'mentés'); return; } done('Vázlat kész (' + o.sections.length + ' szekció)'); }, function () { fail('hálózat'); });
      }, function () { fail('hálózat'); });
      // F3 — REGENERATE this node in place (same DB row → same node id → the card keeps its position). Existing edges only.
      else if (act === 'regen_step') {
        var stepId = n && n.ref && n.ref.id; if (!stepId) { fail('nincs lépés-azonosító'); return; }
        CORE.callEdge('research-protocol', { action: 'refine_step', project_id: pid, step_id: stepId }).then(function (d) {
          if (!d || d.error) { fail((d && d.error) || 'refine'); return; }
          if (!d.step) { fail('üres válasz'); return; }
          applyRefinedStep(stepId, d.step, function () { done('Lépés újragenerálva'); }, function (err) { fail(err); });
        }, function () { fail('hálózat'); });
      }
      else if (act === 'regen_review') {
        var rpath = (n && n.ref && n.ref.path) || '';
        var mm = rpath.match(/-([0-9a-f]{8})-review\./);   // the review filename carries the study's 8-hex id (generate_review) → map back
        var sid8 = mm && mm[1];
        var study = sid8 && ((data && data.studies) || []).filter(function (s) { return String(s.id).replace(/-/g, '').slice(0, 8) === sid8; })[0];
        if (!study) { fail('nem található a study ehhez az áttekintéshez'); return; }
        CORE.callEdge('research-study', { action: 'generate_review', study_id: study.id }).then(function (d) {
          if (!d || d.error) { fail((d && d.error) || 'hálózat'); return; }
          var np = d.file_path;
          // generate_review derives the path from the (mutable) study title → if the study was RENAMED since the last
          // review, the edge writes a NEW path instead of overwriting. Delete the stale old file so no duplicate/orphan
          // review card appears. Unchanged title → np === rpath → overwrite → same node id → saved position preserved.
          if (np && rpath && np !== rpath) { sb.from('research_files').delete().eq('project_id', pid).eq('path', rpath).then(function () { done('Áttekintés újragenerálva'); }, function () { done('Áttekintés újragenerálva'); }); }
          else done('Áttekintés újragenerálva');
        }, function () { fail('hálózat'); });
      }
    }

    // F7: refine-chat send — each message is a hint to refine_step; the returned step is applied in place (same row → position kept).
    // The DB update + re-materialize always run; the chat UI is only touched if the user is STILL on this node when the call returns.
    function refineChat(node) {
      var hint = String(rcInput || '').trim(); if (!hint || rcBusy) return;
      if (!node || node.t !== 'step' || !node.ref || !node.ref.id) return;
      var CORE = window.PRAutopilotCore;
      if (!CORE || !CORE.callEdge) { setRcMsgs(function (m) { return m.concat([{ role: 'ai', text: 'A finomító nem elérhető (autopilot-core).' }]); }); return; }
      var stepId = node.ref.id, nid = node.id;
      if (refBusy.current[nid]) return;   // a refine for THIS step is already in flight — the lock SURVIVES a node round-trip, so returning to the node can't re-fire it (no concurrent double-write / lost update)
      refBusy.current[nid] = true;
      setRcMsgs(function (m) { return m.concat([{ role: 'user', text: hint }]); });
      setRcInput(''); setRcBusy(true);
      function onNode() { return alive.current && selRef.current === nid; }
      // say() is the single terminal path: it ALWAYS releases the in-flight lock; it only touches the chat UI if the user is still on this node
      function say(t) { delete refBusy.current[nid]; if (onNode()) { setRcBusy(false); setRcMsgs(function (m) { return m.concat([{ role: 'ai', text: t }]); }); } }
      CORE.callEdge('research-protocol', { action: 'refine_step', project_id: props.projectId, step_id: stepId, hint: hint }).then(function (d) {
        if (!alive.current) { delete refBusy.current[nid]; return; }
        if (!d || d.error || !d.step) { say('Hiba: ' + ((d && d.error) || 'nincs válasz')); return; }
        applyRefinedStep(stepId, d.step, function (changed) { if (!alive.current) { delete refBusy.current[nid]; return; } setBump(function (x) { return x + 1; }); say('✓ Frissítve: ' + (changed.length ? changed.join(', ') : 'nincs érdemi változás')); }, function (err) { say('Mentési hiba: ' + err); });
      }, function () { say('Hálózati hiba'); });
    }

    // ---- Canvas assistant dock: quick pipeline commands + a free-text chat (research-chat) ----
    function dkSay(role, text, extra) { if (alive.current) setDMsgs(function (m) { return m.concat([Object.assign({ role: role, text: text }, extra || {})]); }); }
    function dkMarkDone(i) { setDMsgs(function (M) { var m = M.slice(); if (m[i]) m[i] = Object.assign({}, m[i], { done: true }); return m; }); }
    // Step 2 — act on the attached card: propose protocol step(s) to run AFTER the selected step from a natural-language
    // instruction (reuses research-protocol append_steps, which only PROPOSES) → preview → dkInsertSteps executes on confirm.
    function dkProposeSteps() {
      var txt = String(dInput || '').trim(), an = sn;
      if (!an || an.t !== 'step') { dkSay('ai', 'Jelölj ki egy protokoll-lépést, majd írd le, mit tegyek utána.'); return; }
      if (!txt) { dkSay('ai', 'Írd le, milyen lépés(eke)t tegyek a kijelölt lépés után.'); return; }
      if (!data || !data.protocol || !data.protocol.id) { dkSay('ai', 'Ehhez a projekthez még nincs protokoll — előbb generálj egyet (🧪 Protokoll).'); return; }
      var CORE = window.PRAutopilotCore;
      if (!CORE || !CORE.callEdge) { dkSay('ai', 'A generátor nem elérhető (autopilot-core).'); return; }
      dkSay('user', '⚡ Lépés(ek) a „' + String(an.title || '').slice(0, 40) + '" után: ' + txt);
      setDInput(''); setDBusy(true); setProposal(null);
      CORE.callEdge('research-protocol', { action: 'append_steps', protocol_id: data.protocol.id, prompt: 'A(z) „' + String(an.title || '') + '" lépés UTÁN következzen: ' + txt, count: 4 }).then(function (d) {
        if (!alive.current) return; setDBusy(false);
        if (!d || d.error) { dkSay('ai', '⚠️ ' + ((d && d.error) || 'Nem sikerült javaslatot készíteni.')); return; }
        var steps = (d.steps || []).filter(function (s) { return s && s.title; });
        if (!steps.length) { dkSay('ai', 'Nem született beszúrható lépés.'); return; }
        setProposal({ anchor: an, steps: steps });   // show the preview; nothing is written until the user confirms
      }, function () { if (alive.current) { setDBusy(false); dkSay('ai', '⚠️ Hálózati hiba.'); } });
    }
    function dkInsertSteps() {
      var pr = proposal; if (!pr || !data || !data.protocol) { setProposal(null); return; }
      // Re-resolve the anchor by its STABLE id against the CURRENT steps — the protocol may have been regenerated
      // (research-protocol `generate` archives + recreates fresh ords) or the anchor deleted since the preview was made.
      // Trusting the snapshotted ord could wire depends_on to an unrelated / non-existent step.
      var anchorId = pr.anchor && pr.anchor.ref && pr.anchor.ref.id;
      var cur = (data.steps || []).filter(function (s) { return s.id === anchorId; })[0];
      if (!cur) { setProposal(null); dkSay('ai', '⚠️ A horgony-lépés időközben megváltozott (a protokoll újragenerálódhatott) — jelöld ki újra a lépést, és próbáld meg ismét.'); return; }
      var pid = data.protocol.id, maxOrd = 0;
      (data.steps || []).forEach(function (s) { if (s.ord > maxOrd) maxOrd = s.ord; });
      var anchorOrd = cur.ord;
      // Append at the END (no ord-shift → other steps' depends_on stay valid) but wire depends_on so they RUN after the
      // anchor: the first new step depends on the anchor, each subsequent one chains after the previous new step.
      var rows = pr.steps.map(function (s, i) {
        return {
          protocol_id: pid, ord: maxOrd + 1 + i, title: String(s.title || 'Lépés').slice(0, 200), kind: String(s.kind || 'custom'),
          spec: { instruction: s.instruction || '', inputs: s.inputs || [], expected_outputs: s.expected_outputs || [], acceptance: s.acceptance || [], command_hint: s.command_hint || '', est_minutes: s.est_minutes || null },
          depends_on: [i === 0 ? anchorOrd : (maxOrd + i)], needs_approval: !!s.needs_approval
        };
      });
      setDBusy(true);
      sb.from('research_protocol_steps').insert(rows).then(function (r) {
        if (!alive.current) return; setDBusy(false); setProposal(null);
        if (r && r.error) { dkSay('ai', '⚠️ Beszúrás hiba: ' + r.error.message); return; }
        dkSay('ai', '✓ ' + rows.length + ' lépés beszúrva a „' + String(pr.anchor.title || '').slice(0, 40) + '" után (függőségként utána futnak).');
        setBump(function (x) { return x + 1; });   // re-materialize the map with the new steps
      }, function () { if (alive.current) { setDBusy(false); dkSay('ai', '⚠️ Beszúrás hálózati hiba.'); } });
    }
    function dkEnsureChat() {   // a dedicated "Canvas asszisztens" chat thread (separate from the Ideas-tab chat) → research-chat has multi-turn context
      if (dcRef.current) return Promise.resolve(dcRef.current);
      return sb.from('research_chats').select('id').eq('project_id', props.projectId).eq('title', 'Canvas asszisztens').order('created_at', { ascending: true }).limit(1).maybeSingle().then(function (r) {
        var c = r && r.data; if (c && c.id) { dcRef.current = c.id; return c.id; }
        return sb.from('research_chats').insert({ project_id: props.projectId, title: 'Canvas asszisztens' }).select('id').maybeSingle().then(function (ir) { var nc = ir && ir.data; if (nc && nc.id) dcRef.current = nc.id; return nc && nc.id; });
      });
    }
    function dkCmd(act) {   // one-click pipeline command → runs the project-level generation and re-materializes the map
      if (dBusy) return;
      var CORE = window.PRAutopilotCore; if (!CORE || !CORE.callEdge) { dkSay('ai', 'A generátor nem elérhető (autopilot-core).'); return; }
      var pid = props.projectId, proj = props.project, LAB = { ideas: '✦ Ötletek generálása', study: '📚 Irodalom-study indítása', protocol: '🧪 Protokoll generálása', writing: '✍️ Draft-vázlat készítése' };
      dkSay('user', LAB[act] || act); setDBusy(true);
      function ok(msg) { if (!alive.current) return; setDBusy(false); dkSay('ai', '✓ ' + msg); setBump(function (x) { return x + 1; }); }
      function bad(e) { if (!alive.current) return; setDBusy(false); dkSay('ai', '⚠️ ' + e); }
      if (act === 'ideas') CORE.callEdge('research-ai', { action: 'gap', project_id: pid }).then(function (d) { (d && d.error) ? bad(d.error) : ok(((d && d.count) || 0) + ' ötlet-jelölt a térképen'); }, function () { bad('hálózat'); });
      else if (act === 'protocol') CORE.callEdge('research-protocol', { action: 'generate', project_id: pid, goal: String(proj.goal || proj.title || '') }).then(function (d) { (d && d.error) ? bad(d.error) : ok(((d && d.steps) || 0) + ' protokoll-lépés'); }, function () { bad('hálózat'); });
      else if (act === 'writing') CORE.callEdge('research-writing', { action: 'outline', project_id: pid }).then(function (d) {
        if (d && d.error) { bad(d.error); return; }
        var o = d && d.outline; if (!o || !o.sections) { bad('üres vázlat'); return; }
        var md = '# ' + (o.title || proj.title) + '\n\n' + (o.abstract || '') + '\n\n## Szekciók\n' + o.sections.map(function (s) { return '- ' + (s.heading || s.key); }).join('\n');
        CORE.saveFile(pid, 'writing/outline.md', md, 'ai').then(function (sf) { (sf && sf.error) ? bad(sf.error.message || 'mentés') : ok('Vázlat kész (' + o.sections.length + ' szekció)'); }, function () { bad('hálózat'); });
      }, function () { bad('hálózat'); });
      else if (act === 'study') {
        var idea = (data && data.ideas && data.ideas[0]) || null;
        if (!idea) { setDBusy(false); dkSay('ai', '⚠️ Előbb generálj egy ötletet (✦ Ötletek), abból indul az irodalom-study.'); return; }
        sb.from('research_studies').insert({ project_id: pid, idea_id: idea.id, title: String(idea.question || proj.title || 'Study').slice(0, 80), question: String(idea.question || proj.goal || '').slice(0, 4000), created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
          if (r && r.error) { bad('study: ' + r.error.message); return; }
          var sid = r && r.data && r.data.id; if (!sid) { bad('a study nem jött létre'); return; }
          var rows = LS_STEPS.map(function (s) { return { study_id: sid, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, proj, idea) }; });
          sb.from('research_study_steps').insert(rows).then(function (rr) { if (rr && rr.error) { bad('study-lépések: ' + rr.error.message); return; } CORE.callEdge('research-study', { action: 'plan', study_id: sid }).then(function () { ok('Irodalom-study létrehozva'); }, function () { ok('Irodalom-study létrehozva'); }); }, function () { bad('study-lépések'); });
        }, function () { bad('study insert'); });
      }
    }
    // voice input (Web Speech API) — dictate into the dock. Hungarian recognition; falls back gracefully if unsupported.
    function toggleMic() {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { alert('A hangbevitel ebben a böngészőben nem támogatott (Chrome/Edge ajánlott).'); return; }
      if (recRef.current) { try { recRef.current.stop(); } catch (e) { } return; }
      var r; try { r = new SR(); } catch (e) { return; }
      r.lang = 'hu-HU'; r.interimResults = false; r.continuous = false; r.maxAlternatives = 1;
      r.onresult = function (e) { var txt = (e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript) || ''; if (txt) setDInput(function (prev) { return prev ? (prev.replace(/\s+$/, '') + ' ' + txt) : txt; }); };
      r.onend = function () { recRef.current = null; if (alive.current) setRecOn(false); };
      r.onerror = function () { recRef.current = null; if (alive.current) setRecOn(false); };
      recRef.current = r; setRecOn(true); try { r.start(); } catch (e) { recRef.current = null; setRecOn(false); }
    }
    // send the dock input in the current mode: 'action' (needs a selected step) → propose protocol step(s); else chat.
    function dkPrimary() { if (dkMode === 'action' && sn && sn.t === 'step') { dkProposeSteps(); } else { dkSend(); } }
    function dkSend(overrideTxt, skipEcho) {   // free-text turn → research-chat (non-streaming); the reply may save files (→ file nodes). skipEcho: caller already echoed the user turn (frame-generation chat fallback)
      var isOv = (overrideTxt != null);
      var txt = String(isOv ? overrideTxt : (dInput || '')).trim(); if (!txt || dBusy) return;
      // #2 — when the dock is BOUND to a frame, a real (non-override) typed command is frame-scoped: route it through the
      // frame chat-actions (frameGenerate → decision chips → placeInFrame), not the free-text chat. Fully reuses the shipped flow.
      if (boundFrame && !isOv) {
        var bf = frames.filter(function (x) { return x.id === boundFrame.id; })[0];
        if (bf) { setDInput(''); frameGenerate(bf, txt); return; }
        setBoundFrame(null);   // the bound frame was deleted → unbind, fall through to normal chat
      }
      // the currently SELECTED map card is "attached" as context — the assistant sees exactly which node you mean.
      // (an explicit override — e.g. a frame's inline "generate here" — carries its own context and attaches no card.)
      var an = (!isOv && !boundFrame && sel && g && g.by) ? g.by[sel] : null;
      var full = txt;
      if (an) {
        var lab = (RMAP_TYPE[an.t] && RMAP_TYPE[an.t].lab) || an.t;
        var mbits = []; if (an.m) { for (var kk in an.m) { if (an.m[kk] && an.m[kk] !== '—') mbits.push(kk + ': ' + an.m[kk]); } }
        var idp = (an.ref && an.ref.id) ? (' [id: ' + an.ref.id + ']') : '';
        full = '[BECSATOLT KÁRTYA a térképről — erre a kártyára fókuszálj: ' + lab + ' — "' + String(an.title || '').slice(0, 160) + '"' + idp + (mbits.length ? ' — ' + mbits.slice(0, 6).join(', ') : '') + ']\n\n' + txt;
      }
      if (!skipEcho) dkSay('user', (an ? '📎 ' + String(an.title || 'kártya').slice(0, 44) + '\n' : '') + txt); if (!isOv) setDInput(''); setDBusy(true);
      var CFG = window.PR_CONFIG || {}, CORE = window.PRAutopilotCore, pid = props.projectId;
      function fail(msg) { if (alive.current) { setDBusy(false); dkSay('ai', msg || 'Hiba történt.'); } }   // single failure path → dBusy never strands
      dkEnsureChat().then(function (cid) {
        if (!cid) { fail('Nem sikerült elindítani a beszélgetést.'); return; }
        sb.from('research_messages').insert({ chat_id: cid, role: 'user', content: full }).then(function (ins) {
          if (ins && ins.error) { fail('Hiba: ' + ins.error.message); return; }
          sb.auth.getSession().then(function (s) {
            var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
            fetch(CFG.supabaseUrl + '/functions/v1/research-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ chat_id: cid, stream: false }) })
              .then(function (resp) { return resp.json(); })
              .then(function (d) {
                if (!alive.current) return;
                if (!d || d.error || !d.message_id) { fail('Hiba: ' + ((d && d.error) || 'nincs válasz — telepítve van a research-chat?')); return; }
                sb.from('research_messages').select('content').eq('id', d.message_id).maybeSingle().then(function (mr) {
                  if (!alive.current) return;
                  setDBusy(false);
                  var reply = (mr && mr.data && mr.data.content) || '(üres válasz)';
                  dkSay('ai', reply);
                  var files = (typeof extractFiles === 'function') ? extractFiles(reply) : [];   // persist any ```file:…``` blocks → they appear as file nodes
                  if (files.length && CORE && CORE.saveFile) Promise.all(files.map(function (f) { return CORE.saveFile(pid, f.path, f.content, 'ai'); })).then(function () { if (alive.current) setBump(function (x) { return x + 1; }); });
                }, function () { fail('A válasz beolvasása nem sikerült.'); });
              }, function () { fail('Hálózati hiba.'); });
          }, function () { fail('Munkamenet-hiba.'); });
        }, function () { fail('Az üzenet mentése nem sikerült.'); });
      }, function () { fail('A beszélgetés indítása nem sikerült.'); });
    }

    if (!data) return h('div', { className: 'rmap-wrap' }, h('div', { className: 'empty' }, 'Térkép betöltése…'));
    var g = graph();
    if (!g.N.length) return h('div', { className: 'rmap-wrap' }, h('div', { className: 'rmap-empty' }, h('div', { style: { fontSize: 30 } }, '🗺️'), h('b', null, 'A térkép a projekt adataiból épül fel'), h('p', null, 'Adj hozzá ötleteket, irodalmat, protokollt — és itt egy összefüggő canvason látod majd az egészet, a provenance-élekkel.')));
    var NW = 204, NH = 74;
    function nodeW(n) { return (n && n._w) || NW; }   // per-node card width (migration-80) or default
    function nodeH(n) { return (n && n._h) || NH; }
    // float the inspector as a card NEXT TO the selected node (in front of the canvas), not as a side panel:
    // position it at the node's on-screen coords (view transform), to the right of the card, flipping left if no room.
    // ---- viewport-fit primitive: the ONE fit authority every floating overlay uses (see MAP_CANVAS_ROADMAP viewport-fit) ----
    // Picks the side with the most room, clamps the final box fully inside the viewport (both axes, with a margin), and —
    // when canWiden — reflows a too-tall panel into N columns (wider+shorter) instead of a tall scroller. Pure: vp is explicit.
    function fitFloat(anchor, desired, vp, opts) {
      opts = opts || {};
      function fc(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }
      var M = opts.margin == null ? 8 : opts.margin, GAP = opts.gap == null ? 12 : opts.gap, CG = opts.colGap == null ? 11 : opts.colGap;
      var VW = vp.w || 900, VH = vp.h || 560, availW = VW - 2 * M, availH = VH - 2 * M;
      var colW = Math.min(desired.colW || desired.w, availW), chromeH = desired.chromeH || 0, bodyAvail = Math.max(40, availH - chromeH);
      var padX = opts.padX || 0;   // the panel's fixed horizontal chrome (body padding) — budgeted here so the chosen cols always fit
      var cols = 1;
      if (opts.canWiden && (desired.h - chromeH) > bodyAvail) { var fitCols = Math.max(1, Math.floor((availW - 2 * padX + CG) / (colW + CG))), mc = Math.min(opts.maxCols || 3, fitCols); cols = Math.min(mc, Math.max(1, Math.ceil((desired.h - chromeH) / bodyAvail))); }
      var width = Math.min((opts.canWiden ? cols * colW + (cols - 1) * CG : desired.w) + 2 * padX, availW);
      var perCol = Math.ceil((desired.h - chromeH) / cols), scroll = opts.canWiden ? (perCol > bodyAvail) : (desired.h > availH);
      var bodyMaxH = opts.canWiden ? Math.min(bodyAvail, scroll ? bodyAvail : perCol) : availH;
      var usedH = opts.canWiden ? Math.min(availH, (scroll ? bodyAvail : perCol) + chromeH) : Math.min(availH, desired.h);
      var left, placement, rightRoom = VW - (anchor.x + anchor.w) - M, leftRoom = anchor.x - M;
      if (opts.prefer === 'point') { left = anchor.x; if (left + width > VW - M) left = anchor.x - width; placement = left < anchor.x ? 'left' : 'right'; }
      else { if (rightRoom >= width) { left = anchor.x + anchor.w + GAP; placement = 'right'; } else if (leftRoom >= width) { left = anchor.x - width - GAP; placement = 'left'; } else { left = anchor.x; placement = 'overlay'; } }
      left = fc(left, M, VW - width - M);
      var top;
      if (opts.prefer === 'above') { top = anchor.y - usedH - GAP; if (top < M) { top = anchor.y + anchor.h + GAP; placement = 'below'; } else placement = 'above'; }
      else if (opts.prefer === 'point') { top = anchor.y; if (top + usedH > VH - M) top = anchor.y - usedH; }
      else { top = placement === 'overlay' ? anchor.y - usedH - GAP : anchor.y; }
      top = fc(top, M, VH - usedH - M);
      return { left: left, top: top, width: width, maxHeight: bodyMaxH, usedH: usedH, cols: cols, colW: colW, scroll: scroll, placement: placement };
    }
    function stageVP() { return { w: (stageRef.current && stageRef.current.clientWidth) || 900, h: (stageRef.current && stageRef.current.clientHeight) || 560 }; }
    // viewport-fit P1: a ref callback that measures the NATURAL body height by SUMMING children (colW-invariant, so the value
    // is stable across column counts → no widen oscillation / RO loop). >4px guard + a ref mirror avoid a setState feedback loop.
    function measureNat(key, gap) { return function (el) { if (!el) return; var kids = el.children, sum = 0, n = 0; for (var i = 0; i < kids.length; i++) { var hh = kids[i].offsetHeight; if (hh) { sum += hh; n++; } } if (n > 1) sum += (n - 1) * (gap || 11); if (sum && Math.abs((floatNatRef.current[key] || 0) - sum) > 4) { setFloatNat(function (M) { var m = Object.assign({}, M); m[key] = sum; return m; }); } }; }
    function cardScreenRect(node) { var kk = view.k; return { x: view.tx + node.x * kk, y: view.ty + node.y * kk, w: nodeW(node) * kk, h: nodeH(node) * kk }; }
    function inspStyle(node) {
      var f = fitFloat(cardScreenRect(node), { w: 300, colW: 300, h: 460 }, stageVP(), { prefer: 'right', gap: 12, canWiden: false });
      return { position: 'absolute', left: f.left + 'px', top: f.top + 'px', width: f.width + 'px', maxHeight: f.usedH + 'px', zIndex: 13 };   // usedH (not maxHeight) — the height the top-clamp was computed for; .rmap-insp-float then scrolls the overflow
    }
    // floating selection toolbar — centered above the selected card (flips below + bottom-clamps via fitFloat).
    function selToolStyle(node) {
      var vp = stageVP(), r = cardScreenRect(node);
      var f = fitFloat(r, { w: 200, colW: 200, h: 33 }, vp, { prefer: 'above', gap: 8, canWiden: false });
      var left = Math.max(74, Math.min(r.x + r.w / 2, vp.w - 74));   // keep center-based positioning (transform:translateX(-50%))
      return { position: 'absolute', left: left + 'px', top: f.top + 'px', transform: 'translateX(-50%)', zIndex: 14 };
    }
    function ctr(id) { var n = g.by[id]; return { x: n.x + nodeW(n) / 2, y: n.y + nodeH(n) / 2 }; }
    function ndCtr(n) { return { x: n.x + nodeW(n) / 2, y: n.y + nodeH(n) / 2 }; }
    // the point on a node's boundary along the ray toward another node → edges start/end AT the card edge (clean, and the arrowhead shows)
    function bpt(node, other) { var c = ndCtr(node), o = ndCtr(other), hw = nodeW(node) / 2, hh = nodeH(node) / 2, dx = o.x - c.x, dy = o.y - c.y; if (!dx && !dy) return c; var t = Math.min(hw / (Math.abs(dx) || 1e-6), hh / (Math.abs(dy) || 1e-6)); return { x: c.x + dx * t, y: c.y + dy * t }; }
    var svgW = 0; g.N.forEach(function (n) { svgW = Math.max(svgW, n.x + nodeW(n) + 60); });
    var cardVP = stageVP();   // viewport-fit: cap the DISPLAYED card size to the screen at the current zoom (render-only; graph() geometry untouched)
    // active page (saved view) filter: a "curated" page shows only pinned cards. Defined before edgeEls so edges honor it.
    var activePageObj = (activePage && pagesCap) ? (pages.filter(function (p) { return p.id === activePage; })[0] || null) : null;
    function pageHides(n) { return !!(activePageObj && activePageObj.only_pinned && !n.mapPinned); }
    function nodeVisible(n) { return !n.mapHidden && !hiddenTypes[n.t] && !pageHides(n); }
    // P2 Prezi story-thread: during a tour, the edge between the previous and current NODE-beat lights up (a comet runs the
    // narrative path). Derived from the live tour state — no extra state. Page/viewport beats (no nodeId) yield no thread.
    var storyPair = null;
    if (tour && tour.beats && tour.i > 0) { var _pbe = tour.beats[tour.i - 1], _cbe = tour.beats[tour.i]; if (_pbe && _cbe && _pbe.nodeId && _cbe.nodeId) storyPair = { a: _pbe.nodeId, b: _cbe.nodeId }; }
    var edgeEls = g.E.map(function (e, i) {
      var a = g.by[e[0]], b = g.by[e[1]]; if (!a || !b) return null; if (!nodeVisible(a) || !nodeVisible(b)) return null;
      var pa = bpt(a, b), pb = bpt(b, a); var dx = (pb.x - pa.x) * 0.5;
      var d = 'M' + pa.x + ',' + pa.y + ' C' + (pa.x + dx) + ',' + pa.y + ' ' + (pb.x - dx) + ',' + pb.y + ' ' + pb.x + ',' + pb.y;
      // pre-migration-81: keep today's exact look (no override, no hit-path, no selection)
      if (!edgesCap) { var cite0 = e[2] === 'cite'; return h('path', { key: i, className: cite0 ? 'rmap-e-cite' : 'rmap-e-flow', d: d, fill: 'none', stroke: cite0 ? 'var(--accent-tint)' : 'var(--line-2, var(--muted))', strokeWidth: cite0 ? 1.5 : 2, markerEnd: cite0 ? null : 'url(#rmap-arrow)' }); }
      var ek = edgeKey(e), st = edgeStyle(e), on = selEdge === ek;
      var isStory = !!(storyPair && ((e[0] === storyPair.a && e[1] === storyPair.b) || (e[0] === storyPair.b && e[1] === storyPair.a)));
      if (hiddenEdgeTypes[st.kind] && !isStory) return null;   // P1: filtered off in the legend (the story thread always shows)
      var animCls = st.anim === 'flow' ? ' rmap-ea-flow' : st.anim === 'pulse' ? ' rmap-ea-pulse' : st.anim === 'pingpong' ? ' rmap-ea-pingpong' : '';
      var extraW = isStory ? 1.5 : (on ? 1 : 0);
      // --esp = per-edge animation duration (type default unless the speed slider overrode it); comet/draw/pulse/calm keep the chosen line-style dash
      var bstyle = { stroke: st.col, strokeWidth: (st.width + extraW) + 'px', '--esp': st.sp + 's' };
      if (st.anim !== 'flow' && st.anim !== 'pingpong') bstyle.strokeDasharray = edgeDash(st.line);
      var base = h('path', { key: 'b', className: 'rmap-e-base' + animCls + (on ? ' rmap-e-sel' : '') + (isStory ? ' rmap-e-story' : ''), d: d, style: bstyle, markerEnd: st.arrow ? ('url(#rmap-' + st.arrow + ')') : null });
      var bead = (isStory || st.anim === 'comet' || st.anim === 'draw') ? h('path', { key: 'd', className: 'rmap-e-bead ' + (isStory || st.anim === 'comet' ? 'rmap-eb-comet' : 'rmap-eb-draw'), d: d, pathLength: 200, style: { stroke: st.col, strokeWidth: (st.width + 1.5) + 'px', '--esp': (isStory ? 1.2 : st.sp) + 's' } }) : null;
      var ring = on ? [h('circle', { key: 'r1', className: 'rmap-e-ring', cx: pa.x, cy: pa.y, r: 7 }), h('circle', { key: 'r2', className: 'rmap-e-ring', cx: pb.x, cy: pb.y, r: 7 })] : null;
      var hit = h('path', { key: 'h', className: 'rmap-e-hit', d: d, onClick: function (ev) { ev.stopPropagation(); selectEdge(ek); } });
      return h('g', { key: ek, style: { color: st.col } }, ring, base, bead, hit);
    });
    // the floating edge inspector (migration-81) — anchored to the selected edge's midpoint, screen-space
    var selEdgeObj = (edgesCap && selEdge) ? g.E.filter(function (e) { return edgeKey(e) === selEdge; })[0] : null;
    // only dim the other edges while the selected edge is actually rendered (both endpoints visible) — else a hidden
    // endpoint would leave has-esel dimming every edge with nothing looking selected. selEdge itself is left intact
    // so the highlight restores if the node is un-hidden; empty-canvas/node clicks clear it.
    var selEdgeVisible = !!(selEdgeObj && g.by[selEdgeObj[0]] && g.by[selEdgeObj[1]] && nodeVisible(g.by[selEdgeObj[0]]) && nodeVisible(g.by[selEdgeObj[1]]) && !hiddenEdgeTypes[edgeStyle(selEdgeObj).kind]);
    // P1 edge labels: screen-space pills at the edge midpoint (the exact bezier average) — crisp constant size, follows
    // pan/zoom, click selects the edge. Only for edges that HAVE a label; hidden when zoomed far out to avoid clutter.
    var edgeLabelEls = (edgesCap && view.k >= 0.45) ? g.E.map(function (e) {
      var st = edgeStyle(e); if (!st.label || hiddenEdgeTypes[st.kind]) return null;
      var a = g.by[e[0]], b = g.by[e[1]]; if (!a || !b || !nodeVisible(a) || !nodeVisible(b)) return null;
      var pa = bpt(a, b), pb = bpt(b, a), ek = edgeKey(e);
      return h('button', { key: 'el' + ek, className: 'rmap-elabel' + (selEdge === ek ? ' on' : ''), style: { left: (view.tx + (pa.x + pb.x) / 2 * view.k) + 'px', top: (view.ty + (pa.y + pb.y) / 2 * view.k) + 'px', color: st.col }, title: st.label, onMouseDown: function (ev) { ev.stopPropagation(); }, onClick: function (ev) { ev.stopPropagation(); selectEdge(ek); } }, h('span', { className: 'rmap-elabel-sw', style: { background: st.col } }), st.label);
    }) : null;
    // P1 live legend: which relation types are actually PRESENT (among visible-node edges) + their counts → a filterable legend.
    var edgeKindCounts = {};
    if (edgesCap) g.E.forEach(function (e) { var a = g.by[e[0]], b = g.by[e[1]]; if (!a || !b || !nodeVisible(a) || !nodeVisible(b)) return; var k = edgeStyle(e).kind; edgeKindCounts[k] = (edgeKindCounts[k] || 0) + 1; });
    var edgeKindsPresent = EDGE_TYPE_ORDER.filter(function (k) { return edgeKindCounts[k]; });
    // P2 drag-to-connect: the rubber-band edge from the source card's boundary to the cursor while dragging a new link
    var linkRubber = null;
    if (linkDrag && g.by[linkDrag.from]) {
      var _ls = g.by[linkDrag.from], _lcx = _ls.x + nodeW(_ls) / 2, _lcy = _ls.y + nodeH(_ls) / 2;
      var _ldx = linkDrag.wx - _lcx, _ldy = linkDrag.wy - _lcy, _lhw = nodeW(_ls) / 2, _lhh = nodeH(_ls) / 2;
      var _lt = (_ldx || _ldy) ? Math.min(_lhw / (Math.abs(_ldx) || 1e-6), _lhh / (Math.abs(_ldy) || 1e-6)) : 0;
      var _lpx = _lcx + _ldx * _lt, _lpy = _lcy + _ldy * _lt, _lmdx = (linkDrag.wx - _lpx) * 0.5;
      linkRubber = h('path', { className: 'rmap-e-rubber', d: 'M' + _lpx + ',' + _lpy + ' C' + (_lpx + _lmdx) + ',' + _lpy + ' ' + (linkDrag.wx - _lmdx) + ',' + linkDrag.wy + ' ' + linkDrag.wx + ',' + linkDrag.wy, markerEnd: 'url(#rmap-ar)' });
    }
    function edgeInspEl() {
      var e = selEdgeObj; if (!e) return null; var a = g.by[e[0]], b = g.by[e[1]]; if (!a || !b || !nodeVisible(a) || !nodeVisible(b)) return null;
      var st = edgeStyle(e); if (hiddenEdgeTypes[st.kind]) return null;   // the selected edge's type was filtered off in the legend
      var pa = bpt(a, b), pb = bpt(b, a), mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      var sx = view.tx + mid.x * view.k, sy = view.ty + mid.y * view.k;
      var ed = props.canEdit && edgesCap;
      // P1 widen-not-tall: chrome (header+foot) is fixed; the body = the reflowing control stack. Use the MEASURED natural
      // height (falls back to an estimate on first paint) so a too-tall inspector becomes 2–3 columns instead of a scroller.
      var einKey = 'edge:' + selEdge, einChrome = 40 + (ed ? 40 : 0);
      var einBody = floatNat[einKey] || ((7 + (edgeSpeedCap ? 2 : 0)) * 46);
      var f = fitFloat({ x: sx + 14, y: sy - 30, w: 0, h: 0 }, { w: 214, colW: 214, h: einChrome + einBody, chromeH: einChrome }, stageVP(), { prefer: 'point', gap: 4, canWiden: true, maxCols: 3, padX: 11 });
      function seg(label, opts, cur, onPick) { return h('div', { className: 'fld' }, h('div', { className: 'rmap-einsp-l' }, label), h('div', { className: 'rmap-eseg' }, opts.map(function (o) { return h('button', { key: o.v, className: (cur === o.v ? 'on' : ''), disabled: !ed, onClick: function () { onPick(o.v); } }, o.sw ? h('span', { className: 'sw', style: { background: o.sw } }) : null, o.lab); }))); }
      return h('div', { className: 'rmap-einsp', 'data-cols': f.cols, 'data-scroll': f.scroll ? '1' : '0', style: { left: f.left + 'px', top: f.top + 'px', width: f.width + 'px', maxHeight: f.usedH + 'px', '--rcols': f.cols, '--rbodyh': f.maxHeight + 'px' }, onMouseDown: function (ev) { ev.stopPropagation(); }, onWheel: function (ev) { ev.stopPropagation(); } },
        h('div', { className: 'rmap-einsp-h' }, h('b', null, (RMAP_TYPE[a.t] && RMAP_TYPE[a.t].ic || '◻') + ' ' + a.title + ' → ' + (RMAP_TYPE[b.t] && RMAP_TYPE[b.t].ic || '◻') + ' ' + b.title), h('span', { className: 'bd' }, st.ov ? 'EGYÉNI' : 'ALAP'), h('button', { className: 'x', title: 'Bezárás', onClick: function () { setSelEdge(null); } }, '×')),
        h('div', { className: 'rmap-einsp-b', ref: measureNat(einKey, 11) },
          seg('Reláció-típus', EDGE_TYPE_ORDER.map(function (k) { return { v: k, lab: EDGE_TYPES[k].nm, sw: EDGE_TYPES[k].col }; }), st.kind, function (v) { persistEdge(e, { kind: v, color: null, anim: null, line_style: null, arrow: null, width: null }); }),
          h('div', { className: 'fld' }, h('div', { className: 'rmap-einsp-l' }, 'Szín'), h('div', { className: 'rmap-esw' },
            [h('button', { key: 'auto', className: (!(edgeOv[selEdge] || {}).color ? 'on' : ''), title: 'Típus szerinti', disabled: !ed, style: { background: 'repeating-linear-gradient(45deg,var(--surface),var(--surface) 3px,var(--line) 3px,var(--line) 6px)' }, onClick: function () { persistEdge(e, { color: null }); } })].concat(EDGE_SWATCHES.map(function (c) { return h('button', { key: c, className: ((edgeOv[selEdge] || {}).color === c ? 'on' : ''), disabled: !ed, style: { background: c }, onClick: function () { persistEdge(e, { color: c }); } }); })))),
          seg('Animáció', EDGE_ANIM_ORDER.map(function (k) { return { v: k, lab: EDGE_ANIMS[k] }; }), st.anim, function (v) { persistEdge(e, { anim: v }); }),
          (edgeSpeedCap && st.anim !== 'calm') ? h('div', { className: 'fld' }, h('div', { className: 'rmap-einsp-l' }, 'Sebesség'), h('input', { className: 'rmap-einsp-rng', type: 'range', min: 0.6, max: 3.2, step: 0.1, value: (3.8 - st.sp).toFixed(1), disabled: !ed, onMouseDown: function (ev) { ev.stopPropagation(); }, onChange: function (ev) { var sp = +(3.8 - parseFloat(ev.target.value)).toFixed(1); setEdgeOv(function (O) { var m = Object.assign({}, O); m[selEdge] = Object.assign({ edge_key: selEdge, from_id: e[0], to_id: e[1] }, m[selEdge] || {}, { speed: sp }); return m; }); }, onMouseUp: function (ev) { persistEdge(e, { speed: +(3.8 - parseFloat(ev.target.value)).toFixed(1) }); }, onBlur: function (ev) { persistEdge(e, { speed: +(3.8 - parseFloat(ev.target.value)).toFixed(1) }); } })) : null,
          seg('Vonalstílus', Object.keys(EDGE_LINES).map(function (k) { return { v: k, lab: EDGE_LINES[k] }; }), st.line, function (v) { persistEdge(e, { line_style: v }); }),
          seg('Nyílhegy', Object.keys(EDGE_ARROWS).map(function (k) { return { v: k, lab: EDGE_ARROWS[k] }; }), st.arrow, function (v) { persistEdge(e, { arrow: v }); }),
          seg('Vastagság', [{ v: 1.5, lab: 'Vékony' }, { v: 2, lab: 'Közepes' }, { v: 3, lab: 'Vastag' }], st.width, function (v) { persistEdge(e, { width: v }); }),
          edgeSpeedCap ? h('div', { className: 'fld' }, h('div', { className: 'rmap-einsp-l' }, 'Fontosság (tempó + vastagság)'), h('div', { className: 'rmap-eseg' }, [1, 2, 3, 4, 5].map(function (imp) {
            var pw = [1.5, 2, 2.5, 3, 3.5][imp - 1], ps = [2.8, 2.2, 1.6, 1.1, 0.7][imp - 1];
            return h('button', { key: imp, className: (Math.abs(st.width - pw) < 0.01 && Math.abs(st.sp - ps) < 0.05 ? 'on' : ''), disabled: !ed, title: 'Fontosság ' + imp, onClick: function () { persistEdge(e, { width: pw, speed: ps }); } }, String(imp));
          }))) : null,
          h('div', { className: 'fld' }, h('div', { className: 'rmap-einsp-l' }, 'Címke (az élre írva)'), h('input', { key: 'lbl' + selEdge, className: 'rmap-einsp-txt', type: 'text', defaultValue: st.label, placeholder: 'Írj ide feliratot…', disabled: !ed, maxLength: 40, onMouseDown: function (ev) { ev.stopPropagation(); }, onKeyDown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } ev.stopPropagation(); }, onBlur: function (ev) { var v = ev.target.value.trim(); if (v !== (st.label || '')) persistEdge(e, { label: v || null }); } }))),
        ed ? h('div', { className: 'rmap-einsp-foot' }, h('button', { style: st.manual ? { color: 'var(--danger, #d6323a)' } : null, onClick: function () { resetEdge(e); } }, st.manual ? '🗑 Kapcsolat törlése' : '↺ Alaphelyzet')) : null);
    }
    // P1.5 — a small novelty ring on a gap node (top-right); the meta (Típus/Bizonyíték) still shows in the body
    function gapNovRing(n) {
      var nov = n.ref && n.ref.novelty; if (nov == null) return null;
      var rr = 8.5, cc = 2 * Math.PI * rr, dof = cc * (1 - Math.max(0, Math.min(100, nov)) / 100);
      return h('span', { className: 'rmap-gap-ring', title: 'Újdonság: ' + nov },
        h('svg', { viewBox: '0 0 24 24', width: 22, height: 22 },
          h('circle', { cx: 12, cy: 12, r: rr, fill: 'none', stroke: 'var(--line)', strokeWidth: 3 }),
          h('circle', { cx: 12, cy: 12, r: rr, fill: 'none', stroke: '#d6455f', strokeWidth: 3, strokeLinecap: 'round', strokeDasharray: cc.toFixed(1), strokeDashoffset: dof.toFixed(1), transform: 'rotate(-90 12 12)' }),
          h('text', { x: 12, y: 15, textAnchor: 'middle', fontSize: 8, fontWeight: 800, fill: 'var(--ink)' }, String(nov))));
    }
    function body(n) {
      var k = [h('div', { className: 'rmap-nh', key: 'h' }, h('span', { className: 'rmap-ni' }, RMAP_TYPE[n.t].ic), h('span', { className: 'rmap-nt' }, n.title))];
      if (n.t === 'study') k.push(h('div', { className: 'rmap-nm', key: 'm' }, h('b', null, n.m.Források), ' forrás → ', h('b', null, n.m.Included), ' incl', n.pcount ? h('span', { className: 'rmap-exp' }, (litOpen ? '▾ ' : '▸ ') + n.pcount + ' cikk') : null));
      else if (n.t === 'paper') k.push(h('div', { className: 'rmap-nm', key: 'm' }, (n.m.Venue || '') + ' · ' + n.m.Idézettség + ' cite', n.dec === 'include' ? h('span', { className: 'rmap-chip inc' }, '✓ incl') : null));
      else if (n.t === 'step') k.push(h('div', { className: 'rmap-nm', key: 'm' }, h('span', { className: 'rmap-chip ' + (n.st === 'done' ? 'done' : (n.st === 'running' || n.st === 'doing') ? 'run' : 'pend') }, n.st || 'vár'), ' ' + (n.m.Kind || ''), n.gate ? h('span', { className: 'rmap-chip gate' }, 'gate') : null));
      else if (n.t === 'venue') k.push(h('div', { className: 'rmap-nm', key: 'm' }, n.m.NPI + ' · ' + n.m.Státusz));
      else if (n.t === 'section') k.push(h('div', { className: 'rmap-nm', key: 'm' }, n.m.Méret));
      else if (n.t === 'idea') k.push(h('div', { className: 'rmap-nm', key: 'm' }, 'novelty ' + n.m.Novelty));
      else if (n.t === 'review') k.push(h('div', { className: 'rmap-nm', key: 'm' }, n.m.Studies + ' study'));
      else if (n.t === 'dataset') k.push(h('div', { className: 'rmap-nm', key: 'm' }, (n.m.Forrás || '') + ' · ' + (n.m.Státusz || ''), n.m.Méret && n.m.Méret !== '—' ? h('span', { className: 'rmap-chip' }, n.m.Méret) : null));
      else if (n.t === 'file') k.push(h('div', { className: 'rmap-nm', key: 'm' }, (n.m.Forrás && n.m.Forrás !== '—' ? n.m.Forrás + ' · ' : '') + n.m.Méret));
      else if (n.t === 'chat') k.push(h('div', { className: 'rmap-nm', key: 'm' }, 'frissítve ' + n.m.Frissítve));
      else if (n.t === 'figure') k.push(h('div', { className: 'rmap-nm', key: 'm' }, String(n.m.Felirat || '').slice(0, 64)));
      else if (n.t === 'srq') k.push(h('div', { className: 'rmap-nm', key: 'm' }, '💡 ' + String(n.m.Alap || '').slice(0, 52)));
      else if (n.t === 'sreview') k.push(h('div', { className: 'rmap-nm', key: 'm' }, h('span', { className: 'rmap-chip ' + (n.m.Státusz === 'completed' ? 'done' : n.m.Státusz === 'failed' ? '' : 'run') }, n.m.Státusz || 'vár')));
      return k;
    }
    // P1: tier-gated EXTRA content revealed by CSS @container as the card grows (or by the zoom LOD floor).
    // Appended after body(n); each block is display:none by default and shown by a @container/lod rule.
    function richTier(n) {
      var r = n.ref || {}, t = n.t, out = [];
      if (t === 'figure' && r.storage_path) {
        if ((n._h || 0) > 110) ensureFigUrls([r]);   // fetch the signed URL only for figure cards enlarged tall enough to SHOW the thumbnail
        var url = figUrls[r.storage_path];
        out.push(h('div', { key: 'fig', className: 'rmap-t rmap-t-fig' }, url ? h('img', { className: 'rmap-pv-img', src: url, alt: r.fig_label || 'ábra', loading: 'lazy' }) : h('div', { className: 'rmap-pv-imgph' }, '⏳ ábra')));
      }
      if (t === 'step') {
        var inprog = n.st === 'running' || n.st === 'doing';
        var prog = n.st === 'done' ? 100 : (inprog ? 62 : 0);
        var cycleLbl = n.st === 'done' ? '↺ Újranyit' : (inprog ? '✓ Kész' : '▶ Indít');
        out.push(h('div', { key: 'sl', className: 'rmap-t rmap-t-l' },
          (inprog || n.st === 'done') ? h('div', { className: 'rmap-pv-prog' }, h('i', { style: { width: prog + '%' } })) : null,
          (stepFlagsCap && n.ref && n.ref.assignee_id) ? h('div', { className: 'rmap-pv-meta' }, '👤 ' + nameOf(n.ref.assignee_id)) : null,
          (props.canEdit && n.ref && n.ref.id) ? h('button', { className: 'rmap-pv-btn', title: 'Státusz léptetése', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); stepCycleStatus(n.ref); } }, cycleLbl) : null,
          (stepFlagsCap && props.canEdit && n.ref && n.ref.needs_approval && !n.ref.signed_off_by) ? h('button', { className: 'rmap-pv-btn ok', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); stepSignOff(n.ref); } }, '✅ Jóváhagyom') : null));
      }
      if (t === 'paper' && props.canEdit && r.id) {
        out.push(h('div', { key: 'scr', className: 'rmap-t rmap-t-l' }, h('div', { className: 'rmap-pv-seg' }, ['include', 'maybe', 'exclude'].map(function (v) {
          return h('button', { key: v, className: 'rmap-pv-sb' + (r.screening === v ? ' on s-' + v : ''), title: 'Szűrés: ' + v, onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); setPaperScreen(r, v); } }, v === 'include' ? '✓ incl' : v === 'maybe' ? '~ maybe' : '✕ excl');
        }))));
      }
      if (canEnter(n)) out.push(h('div', { key: 'xl', className: 'rmap-t rmap-t-xl' }, h('button', { className: 'rmap-pv-btn pri', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); enterNode(n); } }, '◇ Belépés — teljes panel ↗')));
      return out.length ? out : null;
    }
    // P1b: the active run's phase drives the node .inphase highlight (activeKey) + the run bar
    var activeKey = null, activeLabel = null, runProg = null, runActive = false;
    if (run && run.phases) {
      var apx = run.phases[run.phase_index]; activeKey = apx && apx.key; activeLabel = (apx && apx.label) || activeKey;
      var en = run.phases.filter(function (pp) { return pp.enabled; }).length || 1;
      var dn = run.phases.filter(function (pp) { return pp.enabled && (pp.status === 'done' || pp.status === 'skipped'); }).length;
      runProg = dn + '/' + en; runActive = ['running', 'awaiting_approval', 'paused', 'queued'].indexOf(run.status) >= 0;
    }
    var sn = (sel && g.by[sel] && !g.by[sel].mapHidden) ? g.by[sel] : null;   // don't float the inspector/toolbar over a node that is (now) hidden
    // Fázis 3 (semantic zoom / ZUI): a level-of-detail from view.k + an "arm-to-enter" card near the viewport center at deep zoom
    var K_ARM = 1.9, lod = view.k < 0.55 ? 0 : (view.k < 1.3 ? 1 : 2);
    var armedNode = null;
    if (view.k >= K_ARM && !focus && !tour && !shareOpen && !presMgrOpen && props.renderPanel) {
      var _st = stageRef.current, _cw = (_st && _st.clientWidth) || 900, _ch = (_st && _st.clientHeight) || 560, _best = Infinity;
      g.N.forEach(function (n) { if (!nodeVisible(n) || !canEnter(n)) return; var sx = view.tx + (n.x + 102) * view.k, sy = view.ty + (n.y + 37) * view.k; var d = Math.abs(sx - _cw / 2) + Math.abs(sy - _ch / 2); if (d < _best && d < 240) { _best = d; armedNode = n; } });
    }
    armedRef.current = armedNode;
    // derive comment groupings: per-node threads + free-position pins (+ unresolved counts)
    var cmByNode = {}, cmPos = [], cmPosGroups = {};
    if (commentsCap) comments.forEach(function (c) { if (c.node_id) { (cmByNode[c.node_id] = cmByNode[c.node_id] || []).push(c); } else if (c.x != null) { cmPos.push(c); var gk = c.x + ',' + c.y; (cmPosGroups[gk] = cmPosGroups[gk] || []).push(c); } });
    // thread position comments by their (x,y) point: one pin per group (the earliest = the root); replies land at the same point
    var cmPosRoots = Object.keys(cmPosGroups).map(function (gk) { return cmPosGroups[gk].slice().sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); })[0]; });
    function nodeCmCount(id) { var a = cmByNode[id]; return a ? a.filter(function (c) { return !c.resolved; }).length : 0; }
    var cmUnresolved = commentsCap ? comments.filter(function (c) { return !c.resolved; }).length : 0;
    return h('div', { className: 'rmap-wrap' },
      h('div', { className: 'rmap-stage', ref: stageRef, onMouseDown: onDown, onWheel: onWheel, onMouseMove: broadcastCursor, onDoubleClick: onStageDbl },
        h('div', { className: 'rmap-world rmap-lod-' + lod, style: { transform: 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.k + ')' } },
          // frames (named regions) render BEHIND everything; the body is pointer-events:none so cards stay interactive
          frames.map(function (f) {
            var gg = (frLive && frLive.id === f.id) ? frLive : f;
            return h('div', { key: 'fr' + f.id, className: 'rmap-frame rmap-fc-' + (f.color || 'slate'), style: { position: 'absolute', left: gg.x + 'px', top: gg.y + 'px', width: gg.w + 'px', height: gg.h + 'px' } },
              h('div', { className: 'rmap-frame-h', onMouseDown: props.canEdit ? function (e) { startFrameDrag(e, f, 'move'); } : null },
                h('span', { className: 'rmap-frame-t' }, f.title),
                props.canEdit ? h('span', { className: 'rmap-frame-acts' },
                  h('button', { title: 'Generálj ide', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); setFrGenOpen(function (M) { var m = Object.assign({}, M); if (m[f.id]) delete m[f.id]; else m[f.id] = true; return m; }); } }, '✨'),
                  h('button', { className: (boundFrame && boundFrame.id === f.id) ? 'on' : '', title: 'Chat a kerethez kötése — a dockba írt parancs ide hoz létre objektumokat', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); if (boundFrame && boundFrame.id === f.id) { setBoundFrame(null); } else { setBoundFrame(f); setSel(null); setMsel({}); setSelEdge(null); setDkOpen(true); } } }, '💬'),
                  h('button', { title: 'Átszínezés', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); frameRecolor(f); } }, '🎨'),
                  h('button', { title: 'Átnevezés', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); frameRename(f); } }, '✎'),
                  h('button', { title: 'Törlés', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); frameDelete(f.id); } }, '🗑')) : null),
              (props.canEdit && frGenOpen[f.id]) ? h('div', { className: 'rmap-frame-gen', onMouseDown: function (e) { e.stopPropagation(); } },
                h('input', { className: 'rmap-frame-geni', autoFocus: true, value: frGen[f.id] || '', placeholder: '✨ Generálj ide…', disabled: dBusy, onChange: function (e) { var v = e.target.value; setFrGen(function (M) { var m = Object.assign({}, M); m[f.id] = v; return m; }); }, onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); frameGenerate(f, frGen[f.id]); } if (e.key === 'Escape') { setFrGenOpen(function (M) { var m = Object.assign({}, M); delete m[f.id]; return m; }); } } }),
                h('button', { title: 'Generálás', disabled: dBusy || !String(frGen[f.id] || '').trim(), onClick: function () { frameGenerate(f, frGen[f.id]); } }, '➤')) : null,
              props.canEdit ? h('div', { className: 'rmap-frame-rz', title: 'Átméretezés', onMouseDown: function (e) { startFrameDrag(e, f, 'resize'); } }) : null);
          }),
          h('svg', { className: 'rmap-edges' + (selEdgeVisible ? ' has-esel' : ''), width: svgW, height: g.height },
            h('defs', null,
              h('marker', { id: 'rmap-arrow', viewBox: '0 0 8 8', refX: 6.5, refY: 4, markerWidth: 6.5, markerHeight: 6.5, orient: 'auto-start-reverse' }, h('path', { d: 'M0.5,0.5 L7.5,4 L0.5,7.5 Z', fill: 'var(--line-2, var(--muted))' })),
              // interactive-edge markers inherit the edge stroke via context-stroke (migration-81)
              h('marker', { id: 'rmap-ar', viewBox: '0 0 8 8', refX: 6.5, refY: 4, markerWidth: 6.5, markerHeight: 6.5, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, h('path', { d: 'M0.5,0.5 L7.5,4 L0.5,7.5 Z', fill: 'context-stroke' })),
              h('marker', { id: 'rmap-bl', viewBox: '0 0 8 8', refX: 5.5, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, h('path', { d: 'M5,1 L5,7', stroke: 'context-stroke', strokeWidth: 1.6 }))),
            edgeEls, linkRubber),
          g.N.map(function (n) { if (!nodeVisible(n)) return null; var _sized = !!((nrzLive && nrzLive.id === n.id) || (layout[n.id] && layout[n.id].card_h)); var _kk = view.k, _cw = Math.min((n._w || NW), (cardVP.w - 16) / _kk); var _st = { left: n.x + 'px', top: n.y + 'px', width: _cw + 'px' }; if (_sized) _st.height = Math.min((n._h || NH), (cardVP.h - 16) / _kk) + 'px'; return h('div', { key: n.id, 'data-nid': n.id, className: 'rmap-node t-' + n.t + (_sized ? ' rmap-sized' : '') + (sel === n.id ? ' sel' : '') + (msel[n.id] ? ' rmap-mselected' : '') + (n.mapPinned ? ' rmap-pinned' : '') + (activeKey && n.ph === RMAP_PHASE_IDX[activeKey] ? ' inphase' : '') + (props.canEdit ? ' editable' : '') + (dlive && dlive.id === n.id ? ' dragging' : '') + ((nrzLive && nrzLive.id === n.id) ? ' rmap-resizing' : '') + (linkDrag && linkDrag.over === n.id ? ' rmap-linktarget' : '') + (linkDrag && linkDrag.from === n.id ? ' rmap-linksource' : '') + (justPlaced && justPlaced.indexOf(n.id) >= 0 ? ' rmap-justplaced' : ''), style: _st, onMouseDown: function (e) { e.stopPropagation(); startNodeDrag(e, n); }, onDoubleClick: function (e) { e.stopPropagation(); if (canEnter(n)) enterNode(n); }, onContextMenu: function (e) { e.preventDefault(); e.stopPropagation(); if (props.canEdit && (genActions(n).length || regenActions(n).length || (cardSizeCap && layout[n.id] && layout[n.id].card_h))) setMenu({ node: n, x: e.clientX, y: e.clientY }); } }, n.mapPinned ? h('span', { className: 'rmap-pin-badge', title: 'Kitűzött' }, '📌') : null, nodeCmCount(n.id) ? h('span', { className: 'rmap-cm-badge', title: nodeCmCount(n.id) + ' nyitott komment', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); setOpenThread(n.id); } }, '💬' + nodeCmCount(n.id)) : null, (n.t === 'step' && n.ref && (n.ref.assignee_id || n.ref.signed_off_by)) ? h('span', { className: 'rmap-step-badges' }, n.ref.assignee_id ? h('span', { className: 'rmap-assignee', title: 'Felelős: ' + nameOf(n.ref.assignee_id), style: { background: userColor(n.ref.assignee_id) } }, String(nameOf(n.ref.assignee_id) || '?').trim().charAt(0).toUpperCase()) : null, n.ref.signed_off_by ? h('span', { className: 'rmap-signoff', title: 'Jóváhagyta: ' + nameOf(n.ref.signed_off_by) }, '✅') : null) : null, n.t === 'gap' ? gapNovRing(n) : null, h('div', { className: 'rmap-nb' }, body(n), richTier(n)),
            (props.canEdit && edgesCap) ? ['n', 'e', 's', 'w'].map(function (dir) { return h('span', { key: 'port' + dir, className: 'rmap-port rmap-port-' + dir, title: 'Húzz kapcsolatot egy másik kártyához', onMouseDown: function (e) { e.stopPropagation(); startLinkDrag(e, n.id); } }); }) : null,
            (props.canEdit && cardSizeCap) ? h('span', { className: 'rmap-node-rz', title: 'Átméretezés (húzd)', onMouseDown: function (e) { e.stopPropagation(); startNodeResize(e, n); } }) : null); })),
        // page bar (saved views) — top-left tabs; the active page can be curated (only pinned) / re-captured / renamed / deleted
        pagesCap ? h('div', { className: 'rmap-pagebar', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-pagetabs' },
            h('button', { className: 'rmap-pagetab' + (activePage === null ? ' on' : ''), onClick: function () { pageApply(null); } }, 'Teljes gráf'),
            pages.map(function (pg) { return h('button', { key: pg.id, className: 'rmap-pagetab' + (activePage === pg.id ? ' on' : ''), title: 'kattints = nézet' + (props.canEdit ? ', dupla katt = átnevezés' : ''), onClick: function () { pageApply(pg); }, onDoubleClick: function () { pageRename(pg); } }, (pg.only_pinned ? '📌 ' : '') + pg.name); }),
            props.canEdit ? h('button', { className: 'rmap-pagetab add', title: 'Aktuális nézet mentése lapként', onClick: pageCreate }, '＋') : null),
          (activePageObj && props.canEdit) ? h('div', { className: 'rmap-pagectl' },
            h('button', { className: activePageObj.only_pinned ? 'on' : '', title: 'Kurált nézet: csak a kitűzött kártyák', onClick: function () { pageToggleCurated(activePageObj); } }, '📌 Kurált'),
            h('button', { title: 'A lap nézetének frissítése az aktuális nagyításra/pozícióra', onClick: function () { pageUpdateView(activePageObj); } }, '⟳ Nézet'),
            h('button', { title: 'Átnevezés', onClick: function () { pageRename(activePageObj); } }, '✎'),
            h('button', { title: 'Lap törlése', onClick: function () { pageDelete(activePageObj); } }, '🗑')) : null) : null,
        // presence (who's online) + Share button — top-right
        h('div', { className: 'rmap-presence', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          (online.length > 1) ? h('div', { className: 'rmap-avstack', title: 'Kattints egy kollégára a követéshez' },
            online.slice(0, 5).map(function (u, i) { return u.self ? h('div', { key: u.id, className: 'rmap-av me', style: { zIndex: 10 - i }, title: (u.name || 'Kolléga') + ' (te)' }, u.avatar ? h('img', { src: u.avatar, alt: '' }) : (String(u.name || '?').trim().charAt(0).toUpperCase() || '?')) : h('button', { key: u.id, className: 'rmap-av rmap-av-btn' + (following === u.id ? ' rmap-av-follow' : ''), style: { zIndex: 10 - i, boxShadow: following === u.id ? '0 0 0 2px ' + userColor(u.id) : null }, title: (following === u.id ? 'Követés leállítása: ' : 'Követés: ') + (u.name || 'Kolléga'), onClick: function () { toggleFollow(u.id); } }, u.avatar ? h('img', { src: u.avatar, alt: '' }) : (String(u.name || '?').trim().charAt(0).toUpperCase() || '?')); }),
            online.length > 5 ? h('div', { className: 'rmap-av more' }, '+' + (online.length - 5)) : null) : null,
          (online.length > 1) ? h('button', { className: 'rmap-share-btn', title: 'Kurzor-chat: rövid üzenet a kurzorod mellett', onClick: function () { setCcInput(ccInput == null ? '' : null); if (ccInput != null) sendCursorChat(''); } }, ccInput == null ? '💬' : '✕') : null,
          h('button', { className: 'rmap-share-btn', title: 'Megosztás / közreműködők', onClick: function () { setShareOpen(true); loadMembers(); } }, '👥 Megosztás')),
        // cursor-chat input (broadcasts live to peers, shown above my cursor on their screen)
        (ccInput != null) ? h('div', { className: 'rmap-ccinput', onMouseDown: function (e) { e.stopPropagation(); } },
          h('input', { autoFocus: true, value: ccInput, placeholder: 'Üzenet a kurzorod mellé…', maxLength: 120, onChange: function (e) { setCcInput(e.target.value); sendCursorChat(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') { setCcInput(null); } else if (e.key === 'Escape') { sendCursorChat(''); setCcInput(null); } } })) : null,
        // follow-mode banner
        following ? h('div', { className: 'rmap-follow-bar', onMouseDown: function (e) { e.stopPropagation(); }, style: { borderColor: userColor(following) } },
          h('span', null, '👁 Követed: ' + nameOf(following)),
          h('button', { onClick: function () { setFollowing(null); } }, 'Leállítás')) : null,
        // marquee selection rectangle (shift-drag on the empty canvas)
        marquee ? h('div', { className: 'rmap-marquee', style: { position: 'absolute', left: Math.min(marquee.x0, marquee.x1) + 'px', top: Math.min(marquee.y0, marquee.y1) + 'px', width: Math.abs(marquee.x1 - marquee.x0) + 'px', height: Math.abs(marquee.y1 - marquee.y0) + 'px', pointerEvents: 'none', zIndex: 12 } }) : null,
        // Fázis 3: arm-to-enter chip on the deep-zoomed card nearest the viewport center
        armedNode ? h('button', { className: 'rmap-arm-chip', style: { position: 'absolute', left: (view.tx + (armedNode.x + 102) * view.k) + 'px', top: (view.ty + (armedNode.y + 74) * view.k + 10) + 'px', zIndex: 15 }, title: 'Belépés a kártyába (Enter)', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function (e) { e.stopPropagation(); enterNode(armedNode); } }, '◇ Belépés ⏎') : null,
        // remote selection rings — highlight the card another user has selected, in their color
        Object.keys(cursors).map(function (uid) {
          var c = cursors[uid]; if (!c.sel) return null; var nn = g.by[c.sel]; if (!nn || !nodeVisible(nn)) return null;
          return h('div', { key: 'rs' + uid, style: { position: 'absolute', left: (view.tx + nn.x * view.k) + 'px', top: (view.ty + nn.y * view.k) + 'px', width: (nodeW(nn) * view.k) + 'px', height: (nodeH(nn) * view.k) + 'px', border: '2px solid ' + c.color, borderRadius: (12 * view.k) + 'px', pointerEvents: 'none', zIndex: 9, boxSizing: 'border-box' } });
        }),
        // live remote cursors (screen coords → follow pan/zoom)
        Object.keys(cursors).map(function (uid) {
          var c = cursors[uid];
          var cc = cursorChats[uid];
          return h('div', { key: 'cur' + uid, className: 'rmap-cursor', style: { position: 'absolute', left: (view.tx + c.wx * view.k) + 'px', top: (view.ty + c.wy * view.k) + 'px', zIndex: 20, pointerEvents: 'none' } },
            h('svg', { width: 16, height: 16, viewBox: '0 0 16 16' }, h('path', { d: 'M2,2 L2,13 L5.5,9.5 L8,14 L10,13 L7.5,8.5 L12,8.5 Z', fill: c.color, stroke: '#fff', strokeWidth: 1 })),
            h('span', { className: 'rmap-cursor-lbl', style: { background: c.color } }, c.name || 'Kolléga'),
            (cc && cc.text) ? h('span', { className: 'rmap-cursor-chat', style: { borderColor: c.color } }, cc.text) : null);
        }),
        // free-position comment pins (screen coords → follow pan/zoom)
        (commentsCap && cmPosRoots.length) ? cmPosRoots.map(function (c) {
          var grp = cmPosGroups[c.x + ',' + c.y] || [c], cnt = grp.length, allDone = grp.every(function (x) { return x.resolved; });
          return h('button', { key: 'cmp' + c.id, className: 'rmap-cm-pin' + (allDone ? ' resolved' : ''), style: { position: 'absolute', left: (view.tx + c.x * view.k) + 'px', top: (view.ty + c.y * view.k) + 'px', zIndex: 11 }, onMouseDown: function (e) { e.stopPropagation(); }, onMouseEnter: function () { clearTimeout(cmHoverT.current); setOpenThread('pin:' + c.id); }, onMouseLeave: function () { clearTimeout(cmHoverT.current); cmHoverT.current = setTimeout(function () { if (alive.current && !(document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName || ''))) setOpenThread(null); }, 320); }, onClick: function (e) { e.stopPropagation(); clearTimeout(cmHoverT.current); setOpenThread('pin:' + c.id); } }, '💬', cnt > 1 ? h('span', { className: 'rmap-cm-pin-n' }, cnt) : null);
        }) : null,
        // group action bar — appears when 2+ cards are multi-selected
        (Object.keys(msel).length > 1) ? h('div', { className: 'rmap-groupbar', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          h('b', null, Object.keys(msel).length + ' kijelölve'),
          (mapFlags && props.canEdit) ? h('button', { title: 'A kijelöltek kitűzése', onClick: groupPin }, '📌') : null,
          (mapFlags && props.canEdit) ? h('button', { title: 'A kijelöltek elrejtése a térképről', onClick: groupHide }, '🙈') : null,
          h('button', { title: 'A kijelölés exportálása PNG-be', onClick: exportSelection }, '⤓'),
          h('button', { title: 'Kijelölés törlése', onClick: function () { setMsel({}); } }, '✕')) : null,
        run && runActive ? h('div', { className: 'rmap-runbar' + (run.status === 'awaiting_approval' ? ' gate' : '') },
          h('span', { className: 'rmap-rb-dot' }), h('b', null, '⚡ Autopilot'),
          h('span', { className: 'rmap-rb-st' }, (AP_ST_LABEL[run.status] || run.status) + (activeLabel ? ' · ' + activeLabel : '') + (runProg ? ' · ' + runProg : '')),
          (run.status === 'awaiting_approval' && run.gate && props.canEdit) ? h('button', { className: 'btn pri', style: { padding: '3px 10px', fontSize: 11.5, marginLeft: 4 }, onClick: approveGate }, '✓ ' + (run.gate.title || 'Jóváhagyás')) : null,
          h('a', { className: 'btn', style: { padding: '3px 10px', fontSize: 11.5, textDecoration: 'none', marginLeft: 'auto' }, href: 'Autopilot.html?run=' + run.id, target: '_blank', rel: 'noopener' }, 'Dashboard ↗')) : null,
        h('div', { className: 'rmap-zoom' },
          h('button', { className: (Object.keys(hiddenTypes).length ? 'on' : ''), title: 'Típusok ki/be kapcsolása a térképen (pl. Ábrák)', onClick: function () { setTypeFilterOpen(function (v) { return !v; }); } }, '👁' + (Object.keys(hiddenTypes).length ? Object.keys(hiddenTypes).length : '')),
          h('button', { title: 'Térkép újratöltése a legfrissebb adatokkal (a módosítások érvényesítése)', disabled: refreshing, onClick: refreshMap }, refreshing ? '⏳' : '🔄'),
          h('button', { title: 'Térkép exportálása PNG-be', onClick: exportMap }, '⤓'),
          (pagesCap && pages.length > 1) ? h('button', { title: 'Gyors túra: végigzoomol a mentett Lapokon', onClick: tourStart }, '▶') : null,
          pathsCap ? h('button', { className: presMgrOpen ? 'on' : '', title: 'Bemutatók (Prezi-story): jelenetekből álló, vezetett túra', onClick: function () { setPresMgrOpen(function (v) { return !v; }); } }, '🎬') : null,
          (props.canEdit && framesCap) ? h('button', { title: 'Új keret (nevesített régió) — vagy dupla-katt a vászonra', onClick: function () { frameCreate(); } }, '▦') : null,
          (props.canEdit && framesCap) ? h('button', { title: 'Rendezés fázisokba (sávok + keretek) — felülírja a kézi elrendezést', onClick: autoLayoutStages }, '⌗') : null,
          commentsCap ? h('button', { className: commentMode ? 'on' : '', title: commentMode ? 'Komment-mód kikapcsolása' : 'Komment-mód: kattints a vászonra vagy egy kártyára', onClick: function () { setCommentMode(function (v) { return !v; }); setComposer(null); } }, '💬') : null,
          (commentsCap && comments.length) ? h('button', { title: 'Összes komment', onClick: function () { setCmPanelOpen(function (v) { return !v; }); } }, '📋' + (cmUnresolved || '')) : null,
          (data && data.hiddenFigs && data.hiddenFigs.length) ? h('button', { title: 'Térképről levett ábrák visszahozása', onClick: function () { setRestoreOpen(true); } }, '🖼' + data.hiddenFigs.length) : null,
          (mapFlags && g.N.filter(function (n) { return n.mapHidden; }).length) ? h('button', { title: 'Rejtett kártyák visszahozása', onClick: function () { setNodeRestoreOpen(true); } }, '🫥' + g.N.filter(function (n) { return n.mapHidden; }).length) : null,
          (props.canEdit && Object.keys(layout).length) ? h('button', { title: 'Automatikus elrendezés (a saját pozíciók törlése)', onClick: resetLayout }, '↺') : null,
          h('button', { title: 'Illeszd a nézetbe (a teljes gráf látszódjon)', onClick: fitView }, '⤢'),
          h('button', { title: 'Nagyítás', onClick: function () { zoom(1.18); } }, '+'),
          h('button', { className: 'rmap-zoompct' + (Math.abs(view.k - 1) > 0.01 ? ' off' : ''), title: 'Vissza 100%-ra (1:1)', onClick: function () { setView(function (v) { return { tx: v.tx, ty: v.ty, k: 1 }; }); } }, (Math.abs(view.k - 1) > 0.01 ? '⟲ ' : '') + Math.round(view.k * 100) + '%'),
          h('button', { title: 'Kicsinyítés', onClick: function () { zoom(0.85); } }, '−')),
        // "hidden figures" restore panel — bring Map-removed figures (on_map=false) back onto the Map
        (restoreOpen && data && data.hiddenFigs) ? h('div', { style: { position: 'absolute', left: 14, bottom: 96, zIndex: 14, width: 264, maxHeight: '58%', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 18px 50px -20px rgba(20,26,40,.55)', padding: 12 }, onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          (function () { ensureFigUrls(data.hiddenFigs); return null; })(),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 } }, h('b', { style: { fontSize: 12.5 } }, '🖼 Rejtett ábrák (' + data.hiddenFigs.length + ')'), h('button', { style: { border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1 }, onClick: function () { setRestoreOpen(false); } }, '×')),
          data.hiddenFigs.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } }, data.hiddenFigs.map(function (f) {
            var furl = figUrls[f.storage_path];
            return h('div', { key: f.id, style: { display: 'flex', gap: 8, alignItems: 'center' } },
              furl ? h('img', { src: furl, alt: '', style: { width: 46, height: 34, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--line)', flex: 'none' } }) : h('div', { style: { width: 46, height: 34, borderRadius: 5, background: 'var(--surface-2)', flex: 'none' } }),
              h('span', { style: { flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.fig_label || String(f.caption || 'ábra').slice(0, 30)),
              props.canEdit ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 9px', flex: 'none' }, title: 'Vissza a térképre', onClick: function () { figSetOnMap(f.id, true); } }, '↩ Vissza') : null);
          })) : h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Nincs rejtett ábra.')) : null,
        // "hidden nodes" restore panel — bring Map-hidden cards (research_map_layout.hidden) back onto the Map (migration-70)
        // type-visibility filter — temporarily hide/show whole object types (e.g. all Figures)
        typeFilterOpen ? (function () {
          var order = ['idea', 'paper', 'study', 'review', 'srq', 'sreview', 'step', 'venue', 'section', 'dataset', 'file', 'chat', 'figure'];
          var counts = {}; g.N.forEach(function (n) { counts[n.t] = (counts[n.t] || 0) + 1; });
          var types = order.filter(function (t) { return counts[t]; }); Object.keys(counts).forEach(function (t) { if (order.indexOf(t) < 0) types.push(t); });
          return h('div', { className: 'rmap-typefilter', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
            h('div', { className: 'rmap-tf-h' }, h('b', { style: { flex: 1 } }, '👁 Típusok megjelenítése'), Object.keys(hiddenTypes).length ? h('button', { className: 'rmap-tf-all', onClick: showAllTypes }, 'Mind') : null, h('button', { className: 'rmap-cm-x', onClick: function () { setTypeFilterOpen(false); } }, '×')),
            types.length ? h('div', { className: 'rmap-tf-list' }, types.map(function (t) {
              var hidden = !!hiddenTypes[t];
              return h('button', { key: t, className: 'rmap-tf-row' + (hidden ? ' off' : ''), title: (hidden ? 'Megjelenítés: ' : 'Elrejtés: ') + ((RMAP_TYPE[t] && RMAP_TYPE[t].lab) || t), onClick: function () { toggleType(t); } },
                h('span', { className: 'rmap-tf-ic' }, (RMAP_TYPE[t] && RMAP_TYPE[t].ic) || '•'),
                h('span', { className: 'rmap-tf-lab' }, (RMAP_TYPE[t] && RMAP_TYPE[t].lab) || t),
                h('span', { className: 'rmap-tf-count' }, counts[t]),
                h('span', { className: 'rmap-tf-eye' }, hidden ? '🚫' : '👁'));
            })) : h('div', { className: 'rmap-cm-empty' }, 'Nincs elem a térképen.'));
        })() : null,
        // presentations manager + beat editor (Prezi-story) — migration-79
        (presMgrOpen && pathsCap) ? h('div', { className: 'rmap-pres', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-cm-t-h' }, h('b', { style: { flex: 1 } }, '🎬 Bemutatók'), props.canEdit ? h('button', { className: 'rmap-tf-all', onClick: pathCreate }, '＋ Új') : null, h('button', { className: 'rmap-cm-x', onClick: function () { setPresMgrOpen(false); setEditPath(null); } }, '×')),
          h('div', { className: 'rmap-cm-t-b' }, paths.length ? paths.map(function (pt) {
            var isEd = editPath === pt.id, nb = (pt.steps || []).length, snode = (sel && g.by[sel]) ? g.by[sel] : null;
            return h('div', { key: pt.id, className: 'rmap-pres-item' },
              h('div', { className: 'rmap-pres-row' }, h('span', { style: { flex: 1, fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, pt.name), h('span', { style: { fontSize: 11, color: 'var(--muted)' } }, nb + ' jelenet')),
              h('div', { className: 'rmap-pres-acts' },
                h('button', { className: 'btn pri', style: { fontSize: 11, padding: '3px 9px' }, disabled: !nb, onClick: function () { presentPath(pt, false); } }, '▶ Lejátszás'),
                (online.length > 1) ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 9px' }, disabled: !nb, title: 'Élő megosztott bemutató a jelenlévőknek', onClick: function () { presentPath(pt, true); } }, '🔴 Élő') : null,
                props.canEdit ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 9px' }, onClick: function () { setEditPath(isEd ? null : pt.id); } }, isEd ? 'Kész' : '✎ Jelenetek') : null,
                props.canEdit ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 7px' }, title: 'Átnevezés', onClick: function () { pathRename(pt); } }, '✏') : null,
                props.canEdit ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 7px' }, title: 'Törlés', onClick: function () { pathDelete(pt); } }, '🗑') : null),
              isEd ? h('div', { className: 'rmap-beat-ed' },
                (pt.steps || []).length ? (pt.steps || []).map(function (s, i) {
                  return h('div', { key: i, className: 'rmap-beat' },
                    h('div', { className: 'rmap-beat-top' },
                      h('span', { className: 'rmap-beat-n' }, i + 1),
                      (s.kind === 'node') ? h('button', { className: 'rmap-beat-eye' + (s.enter_panel ? ' on' : ''), title: s.enter_panel ? 'Panel megnyílik itt' : 'Csak ráközelít', onClick: function () { beatUpdate(pt, i, { enter_panel: !s.enter_panel }); } }, s.enter_panel ? '◇ panel' : '○ nézet') : h('span', { className: 'rmap-beat-kind' }, s.kind === 'page' ? '🗂️ lap' : s.kind === 'frame' ? '▦ keret' : '👁 nézet'),
                      h('div', { style: { flex: 1 } }),
                      h('button', { className: 'rmap-beat-b', disabled: i === 0, onClick: function () { beatMove(pt, i, -1); } }, '↑'),
                      h('button', { className: 'rmap-beat-b', disabled: i === (pt.steps.length - 1), onClick: function () { beatMove(pt, i, 1); } }, '↓'),
                      h('button', { className: 'rmap-beat-b', onClick: function () { beatRemove(pt, i); } }, '✕')),
                    h('input', { className: 'rmap-beat-cap', value: s.caption || '', placeholder: 'Felirat…', onChange: function (e) { beatUpdate(pt, i, { caption: e.target.value }); } }),
                    h('input', { className: 'rmap-beat-notes', value: s.notes || '', placeholder: 'Előadói jegyzet (csak neked)…', onChange: function (e) { beatUpdate(pt, i, { notes: e.target.value }); } }));
                }) : h('div', { className: 'rmap-cm-empty' }, 'Állj rá egy nézetre/kártyára, majd add hozzá lentről.'),
                h('div', { className: 'rmap-beat-add' },
                  h('button', { className: 'btn', style: { fontSize: 11, padding: '4px 8px' }, title: 'Az aktuális nézet mentése jelenetként', onClick: function () { beatAddCurrentView(pt); } }, '＋ Nézet'),
                  snode ? h('button', { className: 'btn', style: { fontSize: 11, padding: '4px 8px' }, title: 'A kijelölt kártya + ráközelítés', onClick: function () { beatAddNode(pt, snode, false); } }, '＋ Kártya') : null,
                  (snode && canEnter(snode)) ? h('button', { className: 'btn pri', style: { fontSize: 11, padding: '4px 8px' }, title: 'A kijelölt kártya + a panel megnyílik a jelenetnél', onClick: function () { beatAddNode(pt, snode, true); } }, '＋ Kártya + panel') : null)) : null);
          }) : h('div', { className: 'rmap-cm-empty' }, props.canEdit ? 'Készíts egy bemutatót a ＋ Új gombbal. Egy bemutató jelenetekből áll: mentett nézet, keret vagy kártya (opcionális panel-megnyitással). A ▶ végigzoomol rajtuk; az „🔴 Élő" a jelenlévőket is viszi.' : 'Még nincs bemutató.'))) : null,
        (nodeRestoreOpen && mapFlags) ? (function () {
          var hn = g.N.filter(function (n) { return n.mapHidden; });
          return h('div', { style: { position: 'absolute', left: 14, bottom: 96, zIndex: 15, width: 264, maxHeight: '58%', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 18px 50px -20px rgba(20,26,40,.55)', padding: 12 }, onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 } }, h('b', { style: { fontSize: 12.5 } }, '🫥 Rejtett kártyák (' + hn.length + ')'), h('button', { style: { border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1 }, onClick: function () { setNodeRestoreOpen(false); } }, '×')),
            hn.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } }, hn.map(function (n) {
              return h('div', { key: n.id, style: { display: 'flex', gap: 8, alignItems: 'center' } },
                h('span', { style: { fontSize: 15, flex: 'none' } }, (RMAP_TYPE[n.t] && RMAP_TYPE[n.t].ic) || '•'),
                h('span', { style: { flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.title),
                props.canEdit ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 9px', flex: 'none' }, title: 'Vissza a térképre', onClick: function () { nodeToggleHidden(n); } }, '↩ Vissza') : null);
            })) : h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Nincs rejtett kártya.'));
        })() : null,
        // radial quick-add menu (double-click the empty canvas) — a bloom ring of object types at the cursor
        radial ? (function () {
          var segs = [
            { key: 'keret', label: 'Keret', col: '#5b63e6', on: props.canEdit && framesCap, run: function (wx, wy) { frameCreate(wx, wy); } },
            { key: 'otlet', label: 'Ötlet', col: '#d1810b', on: props.canEdit, run: function (wx, wy) { ideaAtPos(wx, wy); } },
            { key: 'komment', label: 'Komment', col: '#17a34a', on: commentsCap, run: function (wx, wy) { setComposer({ x: wx, y: wy }); setCmText(''); } }
          ].filter(function (s) { return s.on; });
          var vp = stageVP(), R = 100, pad = R + 44, n = segs.length || 1;
          var cx = Math.max(pad, Math.min(radial.sx, vp.w - pad)), cy = Math.max(pad, Math.min(radial.sy, vp.h - pad));
          return h('div', { className: 'rmap-radial-scrim', onMouseDown: function (e) { e.stopPropagation(); setRadial(null); }, onWheel: function (e) { e.stopPropagation(); }, onContextMenu: function (e) { e.preventDefault(); setRadial(null); } },
            h('div', { className: 'rmap-radial', style: { left: cx + 'px', top: cy + 'px' }, onMouseDown: function (e) { e.stopPropagation(); } },
              segs.map(function (s, i) {
                var th = -Math.PI / 2 + i * (2 * Math.PI / n);
                return h('button', { key: s.key, className: 'rmap-radial-seg', style: { '--dx': (R * Math.cos(th)) + 'px', '--dy': (R * Math.sin(th)) + 'px', '--i': i, '--segc': s.col }, onClick: function (e) { e.stopPropagation(); var wx = radial.wx, wy = radial.wy, sx = radial.sx, sy = radial.sy; setRadial(null); s.run(wx, wy); setDrop({ sx: sx, sy: sy }); setTimeout(function () { if (alive.current) setDrop(null); }, 430); } },
                  h('span', { className: 'rr-ic', style: { color: s.col } }, s.key === 'keret' ? keretIcon() : (s.key === 'otlet' ? '💡' : '💬')),
                  h('span', { className: 'rr-lab' }, s.label));
              }),
              h('div', { className: 'rr-hub' }, h('span', null, 'Mit hozzunk létre?'), h('span', { className: 'x', title: 'Mégse (Esc)', onClick: function (e) { e.stopPropagation(); setRadial(null); } }, '✕'))));
        })() : null,
        drop ? h('div', { className: 'rmap-drop', style: { left: drop.sx + 'px', top: drop.sy + 'px' } }) : null,
        // comment composer popover (new comment on a card or a free position)
        composer ? (function () {
          var kk = view.k, cx, cy;
          if (composer.node_id && g.by[composer.node_id]) { var nn = g.by[composer.node_id]; cx = view.tx + (nn.x + nodeW(nn)) * kk + 6; cy = view.ty + nn.y * kk; }
          else { cx = view.tx + composer.x * kk; cy = view.ty + composer.y * kk; }
          var _cf = fitFloat({ x: cx, y: cy, w: 0, h: 0 }, { w: 264, colW: 264, h: 200 }, stageVP(), { prefer: 'point', gap: 8, canWiden: false });
          var left = _cf.left, top = _cf.top;
          var tgt = composer.node_id ? { node_id: composer.node_id } : { x: composer.x, y: composer.y };
          return h('div', { className: 'rmap-cm-composer', style: { position: 'absolute', left: left + 'px', top: top + 'px', zIndex: 17 }, onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
            h('div', { className: 'rmap-cm-c-h' }, composer.node_id ? '💬 Komment a kártyához' : '💬 Komment ide'),
            h('textarea', { rows: 3, value: cmText, placeholder: 'Írd le a visszajelzést… (Ctrl/⌘+Enter = küldés)', onChange: function (e) { setCmText(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commentAdd(tgt, cmText); } } }),
            mentionCandidates().length ? h('div', { className: 'rmap-cm-mentions' }, h('span', { className: 'rmap-cm-mlbl' }, '@'), mentionCandidates().slice(0, 6).map(function (u) { return h('button', { key: u.id, className: 'rmap-cm-mchip', title: 'Megemlítés (értesítést kap)', onClick: function () { insertMention(u.name); } }, u.name); })) : null,
            h('div', { className: 'rmap-cm-c-a' },
              h('button', { className: 'btn', style: { fontSize: 12, padding: '4px 10px' }, onClick: function () { setComposer(null); setCmText(''); } }, 'Mégse'),
              h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 10px' }, disabled: !cmText.trim(), onClick: function () { commentAdd(tgt, cmText); } }, 'Küldés')));
        })() : null,
        // comment thread popover (a card's thread, or a single position pin)
        openThread ? (function () {
          var isPin = String(openThread).indexOf('pin:') === 0, list, ax, ay, ttl, reply = null;
          if (isPin) { var cid = openThread.slice(4), root = comments.filter(function (x) { return x.id === cid; })[0]; if (!root) return null; list = comments.filter(function (x) { return !x.node_id && x.x === root.x && x.y === root.y; }).sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); }); ax = view.tx + (root.x || 0) * view.k; ay = view.ty + (root.y || 0) * view.k; ttl = '💬 Komment'; reply = { x: root.x, y: root.y }; }
          else { var nn = g.by[openThread]; if (!nn) return null; list = cmByNode[openThread] || []; ax = view.tx + (nn.x + nodeW(nn)) * view.k + 6; ay = view.ty + nn.y * view.k; ttl = '💬 ' + String(nn.title || '').slice(0, 28); reply = { node_id: openThread }; }
          var _tf = fitFloat({ x: ax, y: ay, w: 0, h: 0 }, { w: 284, colW: 284, h: 300 }, stageVP(), { prefer: 'point', gap: 8, canWiden: false });
          var left = _tf.left, top = _tf.top;
          return h('div', { className: 'rmap-cm-thread', style: { position: 'absolute', left: left + 'px', top: top + 'px', zIndex: 17 }, onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); }, onMouseEnter: function () { clearTimeout(cmHoverT.current); }, onMouseLeave: function () { clearTimeout(cmHoverT.current); cmHoverT.current = setTimeout(function () { if (alive.current && !(document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName || ''))) setOpenThread(null); }, 320); } },
            h('div', { className: 'rmap-cm-t-h' }, h('b', null, ttl), h('button', { className: 'rmap-cm-x', onClick: function () { setOpenThread(null); } }, '×')),
            h('div', { className: 'rmap-cm-t-b' }, list.length ? list.map(function (c) {
              return h('div', { key: c.id, className: 'rmap-cm-item' + (c.resolved ? ' done' : '') },
                h('div', { className: 'rmap-cm-body' }, c.body),
                h('div', { className: 'rmap-cm-meta' },
                  h('span', null, (c.author === props.viewerId ? 'Te' : 'Kolléga') + ' · ' + (c.created_at ? String(c.created_at).slice(0, 10) : '')),
                  commentCanEditOne(c) ? h('button', { title: c.resolved ? 'Újranyitás' : 'Megoldva', onClick: function () { commentResolve(c, !c.resolved); } }, c.resolved ? '↺' : '✓') : null,
                  commentCanEditOne(c) ? h('button', { title: 'Törlés', onClick: function () { commentDelete(c); } }, '🗑') : null));
            }) : h('div', { className: 'rmap-cm-empty' }, 'Nincs komment.')),
            reply ? h('div', { className: 'rmap-cm-reply' },
              h('textarea', { rows: 2, value: cmText, placeholder: 'Válasz…', onChange: function (e) { setCmText(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commentAdd(reply, cmText); } } }),
              h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 10px' }, disabled: !cmText.trim(), onClick: function () { commentAdd(reply, cmText); } }, 'Küldés')) : null);
        })() : null,
        // all-comments side panel
        (cmPanelOpen && commentsCap) ? h('div', { className: 'rmap-cm-panel', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-cm-t-h' }, h('b', null, '💬 Kommentek (' + cmUnresolved + ' nyitott)'), h('button', { className: 'rmap-cm-x', onClick: function () { setCmPanelOpen(false); } }, '×')),
          h('div', { className: 'rmap-cm-t-b' }, comments.length ? comments.slice().sort(function (a, b) { return (a.resolved - b.resolved) || (String(b.created_at).localeCompare(String(a.created_at))); }).map(function (c) {
            return h('div', { key: c.id, className: 'rmap-cm-item' + (c.resolved ? ' done' : '') },
              h('div', { className: 'rmap-cm-body', style: { cursor: 'pointer' }, title: 'Ugrás', onClick: function () { setOpenThread(c.node_id ? c.node_id : ('pin:' + c.id)); if (c.node_id && g.by[c.node_id]) { setSelEdge(null); setSel(c.node_id); } } }, c.body),
              h('div', { className: 'rmap-cm-meta' },
                h('span', null, (c.node_id ? '📌 kártya' : '📍 pozíció') + ' · ' + (c.author === props.viewerId ? 'Te' : 'Kolléga')),
                commentCanEditOne(c) ? h('button', { title: c.resolved ? 'Újranyitás' : 'Megoldva', onClick: function () { commentResolve(c, !c.resolved); } }, c.resolved ? '↺' : '✓') : null,
                commentCanEditOne(c) ? h('button', { title: 'Törlés', onClick: function () { commentDelete(c); } }, '🗑') : null));
          }) : h('div', { className: 'rmap-cm-empty' }, 'Még nincs komment. Kapcsold be a 💬 komment-módot és kattints a vászonra vagy egy kártyára.'))) : null,
        h('div', { className: 'rmap-hint' }, (props.canEdit ? 'Húzd a kártyát = áthelyezés · ' : '') + 'húzd a hátteret = pan · görgő = zoom · Shift+kattintás/húzás = többes kijelölés' + (commentMode ? ' · 💬 KOMMENT-MÓD: kattints a vászonra vagy egy kártyára' : '')),
        // P2 link-mode banner: drawing a manual edge from a source card
        (linkFrom && g.by[linkFrom]) ? h('div', { className: 'rmap-linkbar', onMouseDown: function (e) { e.stopPropagation(); } },
          h('span', null, '🔗 Kapcsolat innen: '), h('b', null, (RMAP_TYPE[g.by[linkFrom].t] && RMAP_TYPE[g.by[linkFrom].t].ic || '◻') + ' ' + String(g.by[linkFrom].title || '').slice(0, 30)),
          h('span', { className: 'rmap-linkbar-h' }, '— kattints a cél-kártyára'),
          h('button', { onClick: function () { setLinkFrom(null); } }, 'Mégse (Esc)')) : null,
        // edge legend — bottom-left, above the zoom controls. Pre-migration-81: the static two-line legend.
        // With edgesCap: a LIVE, filterable legend of the relation types actually present — click a row to hide/show that type.
        (edgesCap && edgeKindsPresent.length) ? h('div', { className: 'rmap-elegend', onMouseDown: function (e) { e.stopPropagation(); } },
          edgeKindsPresent.map(function (k) {
            var off = !!hiddenEdgeTypes[k];
            return h('div', { key: k, className: 'rmap-eleg-row' + (off ? ' off' : '') },
              h('button', { className: 'rmap-eleg-tog', title: (off ? 'Mutatás' : 'Elrejtés') + ': ' + EDGE_TYPES[k].nm, onClick: function () { toggleEdgeType(k); } },
                h('span', { className: 'rmap-eleg-sw', style: { background: EDGE_TYPES[k].col } }),
                h('span', { className: 'rmap-eleg-nm' }, EDGE_TYPES[k].nm),
                h('span', { className: 'rmap-eleg-n' }, edgeKindCounts[k])),
              h('button', { className: 'rmap-eleg-solo', title: 'Csak ez — érvelési lencse (a többi típus elrejtése)', onClick: function () { soloEdgeType(k, edgeKindsPresent); } }, '◎'));
          }),
          Object.keys(hiddenEdgeTypes).length ? h('button', { className: 'rmap-eleg-all', title: 'Összes él mutatása', onClick: function () { setHiddenEdgeTypes({}); try { localStorage.removeItem(edgeTypeStoreKey()); } catch (e) { } } }, 'mind') : null)
          : h('div', { style: { position: 'absolute', left: 14, bottom: 84, zIndex: 8, display: 'flex', gap: 13, alignItems: 'center', padding: '5px 11px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 10.5, color: 'var(--muted)', boxShadow: '0 4px 14px -8px rgba(20,26,40,.4)', pointerEvents: 'none' } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h('span', { style: { display: 'inline-block', width: 18, borderTop: '2px dashed var(--line-2, var(--muted))' } }), 'származás'),
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h('span', { style: { display: 'inline-block', width: 18, borderTop: '1.5px dashed var(--accent-tint)' } }), 'idézet')),
        props.canEdit ? (dkOpen ? h('div', { className: 'rmap-dock open' + (dkFull ? ' full' : ''), ref: dockRef, style: dockStyle(), onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-dock-rz rmap-dock-rz-l', title: 'Átméretezés', onMouseDown: function (e) { startDockResize(e, 'w'); } }),
          h('div', { className: 'rmap-dock-rz rmap-dock-rz-t', title: 'Átméretezés', onMouseDown: function (e) { startDockResize(e, 'h'); } }),
          h('div', { className: 'rmap-dock-rz rmap-dock-rz-tl', title: 'Átméretezés', onMouseDown: function (e) { startDockResize(e, 'wh'); } }),
          h('div', { className: 'rmap-dock-h' }, h('span', null, '🤖 Asszisztens'),
            boundFrame ? h('button', { className: 'rmap-dock-framepill', title: 'Keret leválasztása a chatről', onClick: function () { setBoundFrame(null); } }, '🖼️ ' + String(boundFrame.title || 'Keret').slice(0, 18), h('span', { className: 'x' }, '✕')) : null,
            h('div', { style: { display: 'flex', gap: 2, marginLeft: 'auto' } },
            h('button', { className: 'rmap-dock-x', title: dkFull ? 'Eredeti magasság' : 'Teljes magasság', onClick: toggleDockFull }, dkFull ? '⤡' : '⤢'),
            h('button', { className: 'rmap-dock-x', title: 'Összecsukás', onClick: function () { setDkOpen(false); try { localStorage.setItem('pr-rmap-dock', '0'); } catch (e) { } } }, '▾'))),
          h('div', { className: 'rmap-dock-msgs', ref: dScroll }, dMsgs.map(function (mm, i) {
            return [
              h('div', { key: 'm' + i, className: 'rmap-dock-msg ' + (mm.role === 'user' ? 'u' : 'a') }, mm.text),
              (mm.actions && mm.actions.length) ? h('div', { key: 'a' + i, className: 'rmap-dock-cmds rmap-dock-acts' + (mm.done ? ' done' : '') },
                mm.done
                  ? [h('button', { key: 'done', className: 'rmap-dock-chip', disabled: true }, '✓ Kész')]
                  : mm.actions.map(function (a) { return h('button', { key: a.key, className: 'rmap-dock-chip' + (a.pri ? ' pri' : ''), disabled: (dBusy && a.key !== 'undo'), onClick: function () { dkRunAction(i, a); } }, a.label); })
              ) : null
            ];
          }), dBusy ? h('div', { className: 'rmap-dock-msg a busy' }, '⏳ dolgozom…') : null),
          h('div', { className: 'rmap-dock-cmds' }, [['ideas', '✦ Ötletek'], ['study', '📚 Irodalom'], ['protocol', '🧪 Protokoll'], ['writing', '✍️ Draft']].map(function (c) { return h('button', { key: c[0], className: 'rmap-dock-chip', disabled: dBusy, onClick: function () { dkCmd(c[0]); } }, c[1]); })),
          // the selected card is "attached" to the next prompt — shown here like an attachment chip (× to detach)
          sn ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, margin: '2px 12px 6px', padding: '4px 8px', borderRadius: 8, background: 'var(--accent-tint)', border: '1px solid var(--accent)' } },
            h('span', { style: { flex: 'none', fontSize: 13 } }, (RMAP_TYPE[sn.t] && RMAP_TYPE[sn.t].ic) || '📎'),
            h('span', { style: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, fontWeight: 600, color: 'var(--accent-d, var(--accent))' } }, '📎 Becsatolva: ' + String(sn.title || 'kártya').slice(0, 46)),
            h('button', { style: { flex: 'none', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 15, lineHeight: 1, padding: 0 }, title: 'Leválasztás a promptról', onClick: function () { setSel(null); } }, '×')) : null,
          // Step 2 — preview of the protocol step(s) proposed from the attached step; nothing is written until confirmed
          proposal ? h('div', { style: { margin: '2px 12px 8px', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--accent)' } },
            h('div', { style: { fontSize: 11.5, fontWeight: 700, marginBottom: 5, color: 'var(--accent-d, var(--accent))' } }, '⚡ Beszúrandó lépés(ek) a „' + String((proposal.anchor && proposal.anchor.title) || '').slice(0, 34) + '" után:'),
            h('ol', { style: { margin: '0 0 8px', paddingLeft: 18, fontSize: 12, lineHeight: 1.45 } }, proposal.steps.map(function (s, i) { return h('li', { key: i }, h('b', null, String(s.title || '').slice(0, 90)), s.kind ? h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, ' · ' + s.kind) : null); })),
            h('div', { style: { display: 'flex', gap: 7 } },
              h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 10px' }, disabled: dBusy, onClick: dkInsertSteps }, dBusy ? 'Beszúrás…' : '✅ Beszúrás'),
              h('button', { className: 'btn', style: { fontSize: 12, padding: '4px 10px' }, disabled: dBusy, onClick: function () { setProposal(null); } }, 'Mégse'))) : null,
          h('div', { className: 'rmap-dock-mode' },
            h('button', { className: 'rmap-dock-modebtn' + (dkMode === 'chat' ? ' on' : ''), disabled: dBusy, title: 'Beszélgetés / kérdés az asszisztenssel', onClick: function () { setDkMode('chat'); } }, '💬 Chat'),
            h('button', { className: 'rmap-dock-modebtn' + (dkMode === 'action' ? ' on' : ''), disabled: dBusy || !(sn && sn.t === 'step'), title: (sn && sn.t === 'step') ? 'Az utasításból protokoll-lépést szúr be a kijelölt lépés után' : 'Jelölj ki egy protokoll-lépést az Akció módhoz', onClick: function () { setDkMode('action'); } }, '⚡ Akció')),
          h('div', { className: 'rmap-dock-in' },
            h('textarea', { rows: 1, value: dInput, placeholder: boundFrame ? ('„' + String(boundFrame.title || 'Keret').slice(0, 20) + '" keretbe — pl. hozz létre kutatási réseket…') : (dkMode === 'action' && sn && sn.t === 'step') ? 'Mit tegyek e lépés után? (pl. „tegyél be egy validációs lépést")' : sn ? 'Kérdezz vagy adj utasítást a becsatolt kártyáról…' : 'Írj utasítást vagy kérdést… (jelölj ki egy kártyát a becsatoláshoz)', disabled: dBusy, onChange: function (e) { setDInput(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dkPrimary(); } } }),
            h('button', { className: 'btn' + (recOn ? ' rmap-mic-on' : ''), style: { fontSize: 14, padding: '0 9px', flex: 'none' }, disabled: dBusy, title: recOn ? 'Felvétel leállítása' : 'Hangbevitel — diktálás (magyar)', onClick: toggleMic }, recOn ? '⏺' : '🎤'),
            h('button', { className: 'btn pri', style: { fontSize: 14, padding: '0 12px', flex: 'none' }, disabled: dBusy || !dInput.trim() || (dkMode === 'action' && !(sn && sn.t === 'step')), onClick: dkPrimary }, dkMode === 'action' ? '⚡' : '➤')))
          : h('button', { className: 'rmap-dock-fab', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { setDkOpen(true); try { localStorage.setItem('pr-rmap-dock', '1'); } catch (e) { } } }, '🤖 Asszisztens')) : null),
      // floating selection toolbar — compact quick-actions above the selected card (pin / hide / generate / export)
      (sn && props.canEdit) ? h('div', { className: 'rmap-seltool', style: selToolStyle(sn), onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
        mapFlags ? h('button', { className: (layout[sn.id] && layout[sn.id].pinned) ? 'on' : '', title: (layout[sn.id] && layout[sn.id].pinned) ? 'Kitűzés levétele' : 'Kitűzés (fontos)', onClick: function () { nodeTogglePinned(sn); } }, '📌') : null,
        mapFlags ? h('button', { title: 'Elrejtés a térképről', onClick: function () { nodeToggleHidden(sn); } }, '🙈') : null,
        (genActions(sn).length || regenActions(sn).length) ? h('button', { title: 'Generálás innen', onClick: function (e) { e.stopPropagation(); setMenu({ node: sn, x: e.clientX, y: e.clientY }); } }, '⚡') : null,
        canEnter(sn) ? h('button', { title: 'Panel megnyitása ablakként (nem-modal, több is lehet)', onClick: function () { openWindow(sn); } }, '⊞') : null,
        (props.canEdit && edgesCap) ? h('button', { className: linkFrom === sn.id ? 'on' : '', title: 'Kapcsolat húzása egy másik kártyához (kézi él)', onClick: function () { setLinkFrom(linkFrom === sn.id ? null : sn.id); } }, '🔗') : null,
        h('button', { title: 'Kártya a nézetbe (a képernyőre igazítja)', onClick: function () { cardIntoView(sn); } }, '⤢'),
        h('button', { title: 'Kártya exportálása (PNG)', onClick: function () { exportNode(sn); } }, '⤓')) : null,
      edgeLabelEls,
      edgeInspEl(),
      sn ? h('div', { className: 'rmap-insp rmap-insp-float', style: inspStyle(sn), onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
        h('div', { className: 'rmap-insp-h' }, h('span', { className: 'rmap-ni' }, RMAP_TYPE[sn.t].ic), h('div', { style: { minWidth: 0 } }, h('b', null, sn.title), h('div', { className: 'rmap-insp-ty' }, RMAP_TYPE[sn.t].lab)), h('button', { className: 'rmap-insp-x', onClick: function () { setSel(null); } }, '×')),
        h('div', { className: 'rmap-insp-b' },
          h('div', { className: 'rmap-kv' }, Object.keys(sn.m).map(function (kk) { return [h('span', { className: 'k', key: 'k' + kk }, kk), h('span', { className: 'v', key: 'v' + kk }, sn.m[kk])]; })),
          // figure node: expand → show the extracted image preview + "remove from the Map" (on_map=false)
          (sn.t === 'figure' && sn.ref && sn.ref.storage_path) ? (function () {
            ensureFigUrls([sn.ref]); var furl = figUrls[sn.ref.storage_path];
            return h('div', { style: { margin: '4px 0 10px' } },
              furl ? h('img', { src: furl, alt: sn.ref.fig_label || 'ábra', loading: 'lazy', style: { width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'block' } })
                : h('div', { style: { fontSize: 12, color: 'var(--faint)', padding: '20px 0', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 8 } }, '⏳ Ábra betöltése…'),
              props.canEdit ? h('button', { className: 'btn', style: { fontSize: 12, marginTop: 8 }, title: 'A figyelmet elvéve a térképről (a Figure Boardon marad); a bal alsó „Rejtett ábrák" panelből visszahozható', onClick: function () { figSetOnMap(sn.ref.id, false); setSel(null); } }, '🙈 Levétel a térképről') : null);
          })() : null,
          // protocol step: assignee (editors) + sign-off (editors OR a supervisor via RPC — migration-75/77)
          (sn.t === 'step' && sn.ref && stepFlagsCap) ? (function () {
            var seen = {}, cands = [{ id: props.viewerId, name: (props.viewer && props.viewer.name) || 'Te' }].concat(mentionCandidates()).filter(function (u) { if (!u.id || seen[u.id]) return false; seen[u.id] = 1; return true; });
            var st = sn.ref, signed = !!st.signed_off_by;
            return h('div', { className: 'rmap-step-collab' },
              props.canEdit ? h('div', { className: 'rmap-step-row' }, h('span', { className: 'rmap-step-l' }, '👤 Felelős'),
                h('select', { className: 'rmap-mem-role', style: { flex: 1 }, value: st.assignee_id || '', onChange: function (e) { stepSetAssignee(st, e.target.value || null); } }, [h('option', { key: '_none', value: '' }, '— nincs —')].concat(cands.map(function (u) { return h('option', { key: u.id, value: u.id }, u.name); })))) : (st.assignee_id ? h('div', { className: 'rmap-step-row' }, h('span', { className: 'rmap-step-l' }, '👤 Felelős'), h('span', { style: { fontSize: 11.5, flex: 1 } }, nameOf(st.assignee_id))) : null),
              h('div', { className: 'rmap-step-row' }, h('span', { className: 'rmap-step-l' }, '✅ Sign-off'),
                signed ? h('span', { style: { fontSize: 11.5, flex: 1, minWidth: 0 } }, nameOf(st.signed_off_by) + (st.signed_off_at ? ' · ' + String(st.signed_off_at).slice(0, 10) : '')) : h('span', { style: { fontSize: 11.5, color: 'var(--muted)', flex: 1 } }, 'nincs'),
                signed ? h('button', { className: 'btn', style: { fontSize: 11, padding: '3px 8px', flex: 'none' }, onClick: function () { stepUnsignOff(st); } }, 'Visszavonás') : h('button', { className: 'btn pri', style: { fontSize: 11, padding: '3px 8px', flex: 'none' }, title: props.canEdit ? 'Jóváhagyás' : 'Konzulensi jóváhagyás', onClick: function () { stepSignOff(st); } }, 'Jóváhagyom')));
          })() : null,
          h('div', { className: 'rmap-insp-acts' },
            canEnter(sn) ? h('button', { className: 'btn pri', style: { fontSize: 12 }, title: 'Zoomolj a kártyába — a ' + RMAP_TYPE[sn.t].lab + ' panel a helyén nyílik meg', onClick: function () { enterNode(sn); } }, '◇ Belépés (a helyén)') : null,
            (props.canEdit && editSpec(sn)) ? h('button', { className: 'btn pri', style: { fontSize: 12 }, onClick: function () { openEdit(sn); } }, '✎ Metaadat szerkesztése') : null,
            (props.canEdit && regenActions(sn).length) ? h('button', { className: 'btn', style: { fontSize: 12 }, disabled: genBusy, onClick: function () { runGen(sn, regenActions(sn)[0][0]); } }, regenActions(sn)[0][1]) : null,
            h('button', { className: 'btn', style: { fontSize: 12 }, onClick: function () { if (props.onGoTab) props.onGoTab(RMAP_TYPE[sn.t].tab); } }, 'Megnyitás a ' + RMAP_TYPE[sn.t].lab + ' fülön →'),
            (sn.ref && sn.ref.url) ? h('a', { className: 'btn', style: { fontSize: 12, textDecoration: 'none' }, href: sn.ref.url, target: '_blank', rel: 'noopener' }, 'Forrás ↗') : null),
          // "Mit tehetsz innen?" — the node's one-click generations (idea→study, study→review, review→protocol/draft, …),
          // surfaced inline so every card advertises how to move the research forward from here (not only via the menu).
          (props.canEdit && genActions(sn).length) ? h('div', { style: { marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 } },
            h('div', { style: { fontSize: 10, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 } }, '✦ Mit tehetsz innen'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, genActions(sn).map(function (a) { return h('button', { key: a[0], className: 'btn', style: { fontSize: 12 }, disabled: genBusy, onClick: function () { runGen(sn, a[0]); } }, a[1]); }))) : null,
          h('p', { className: 'rmap-insp-note' }, 'A metaadat itt közvetlenül szerkeszthető — ugyanazok az adatok, mint a fázis-paneleken. A canvason maradsz, modal helyett.'),
          (props.canEdit && sn.t === 'step') ? h('div', { className: 'rmap-chat' },
            h('div', { className: 'rmap-chat-h' }, '🔧 Finomítás — írd le, mit változtassak ezen a lépésen'),
            rcMsgs.length ? h('div', { className: 'rmap-chat-msgs' }, rcMsgs.map(function (mm, i) { return h('div', { key: i, className: 'rmap-chat-msg ' + (mm.role === 'user' ? 'u' : 'a') }, mm.text); })) : null,
            h('div', { className: 'rmap-chat-in' },
              h('textarea', { rows: 2, value: rcInput, placeholder: 'pl. „Adj hozzá 5-fold cross-validation-t”', disabled: rcBusy, onChange: function (e) { var v = e.target.value; setRcInput(v); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); refineChat(sn); } } }),
              h('button', { className: 'btn pri', style: { fontSize: 12, alignSelf: 'flex-end' }, disabled: rcBusy || !rcInput.trim(), onClick: function () { refineChat(sn); } }, rcBusy ? '…' : 'Küldés'))) : null)) : null,
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
      // Share / Collaborators modal
      shareOpen ? (function () {
        var isOwner = !!(props.project && props.project.owner_id === props.viewerId);
        var myPending = (members || []).filter(function (m) { return m.user_id === props.viewerId && !m.accepted; })[0];
        return h('div', { className: 'scrim', onClick: function () { setShareOpen(false); } },
          h('div', { className: 'modal', style: { width: 468, maxWidth: '94vw' }, onClick: function (e) { e.stopPropagation(); } },
            h('div', { className: 'modal-h' }, h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '👥 Megosztás — ' + String((props.project && props.project.title) || 'Projekt').slice(0, 44)), h('button', { className: 'x', 'aria-label': 'Close', onClick: function () { setShareOpen(false); } }, '×')),
            h('div', { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 } },
              h('div', { className: 'rmap-share-presence' },
                h('b', { style: { fontSize: 12.5 } }, '🟢 ' + online.length + ' online most'),
                h('div', { className: 'rmap-avstack' }, online.slice(0, 8).map(function (u) { return h('div', { key: u.id, className: 'rmap-av' + (u.self ? ' me' : ''), title: (u.name || 'Kolléga') + (u.self ? ' (te)' : '') }, u.avatar ? h('img', { src: u.avatar, alt: '' }) : String(u.name || '?').trim().charAt(0).toUpperCase()); }))),
              myPending ? h('div', { className: 'rmap-invite-banner' }, h('span', { style: { flex: 1 } }, 'Meghívtak közreműködőnek (' + roleLabel(myPending.role) + ').'), h('button', { className: 'btn pri', style: { fontSize: 12, padding: '4px 12px' }, onClick: memberAccept }, 'Elfogadom')) : null,
              (members === null) ? h('div', { className: 'rmap-cm-empty' }, 'A közreműködők kezeléséhez futtasd a migration-74-et. Addig csak a jelenlét (presence) működik — a fenti sor mutatja, ki nézi most a térképet.')
                : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  h('b', { style: { fontSize: 12.5 } }, 'Közreműködők (' + members.length + ')'),
                  members.length ? members.map(function (m) {
                    return h('div', { key: m.user_id, className: 'rmap-mem-row' },
                      h('div', { className: 'rmap-av' }, m.pavatar ? h('img', { src: m.pavatar, alt: '' }) : String(m.pname || '?').trim().charAt(0).toUpperCase()),
                      h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.pname), h('div', { style: { fontSize: 11, color: 'var(--muted)' } }, (m.accepted ? '' : '⏳ függőben · ') + roleLabel(m.role))),
                      isOwner ? h('select', { className: 'rmap-mem-role', value: (m.role === 'owner' ? 'editor' : m.role), onChange: function (e) { memberSetRole(m, e.target.value); } }, MEMBER_ROLES.map(function (r) { return h('option', { key: r[0], value: r[0] }, r[1]); })) : null,
                      isOwner ? h('button', { className: 'btn', style: { fontSize: 12, padding: '3px 8px' }, title: 'Eltávolítás', onClick: function () { memberRemove(m); } }, '✕') : null);
                  }) : h('div', { className: 'rmap-cm-empty' }, 'Még nincs közreműködő.'),
                  isOwner ? h('div', { className: 'rmap-invite' },
                    h('div', { style: { display: 'flex', gap: 6 } },
                      h('input', { className: 'rmap-invite-in', placeholder: 'Meghívás e-mail alapján…', value: invQ, onChange: function (e) { setInvQ(e.target.value); } }),
                      h('select', { className: 'rmap-mem-role', value: invRole, onChange: function (e) { setInvRole(e.target.value); } }, MEMBER_ROLES.map(function (r) { return h('option', { key: r[0], value: r[0] }, r[1]); }))),
                    invRes.length ? h('div', { className: 'rmap-invite-res' }, invRes.filter(function (u) { return u.id !== props.viewerId && !(members || []).some(function (mm) { return mm.user_id === u.id; }); }).map(function (u) { return h('button', { key: u.id, className: 'rmap-invite-opt', onClick: function () { memberInvite(u, invRole); setInvQ(''); setInvRes([]); } }, (u.name || u.id) + ' — meghívás ' + roleLabel(invRole).toLowerCase() + 'ként'); })) : null)
                    : h('div', { className: 'rmap-cm-empty' }, 'Csak a projekt tulajdonosa hívhat meg közreműködőket.')))));
      })() : null,
      // 5th LOD: embedded panel windows — screen-space (siblings of the world, so crisp), anchored to the card, non-modal
      windows.map(function (w, wi) {
        var n = g.by[w.id];
        if (!n) return null;   // anchor node was deleted → openWindow lazily drops it from the array on the next open
        var stW = (stageRef.current && stageRef.current.clientWidth) || 900, stH = (stageRef.current && stageRef.current.clientHeight) || 560;
        if (n.mapHidden || !nodeVisible(n)) {
          // the anchor card is hidden/type-filtered/off a curated page — the node still exists, so keep the window
          // RECOVERABLE with a stacked corner chip that closes it (reclaims the slot); no ghost silently eats a slot.
          return h('button', { key: 'whid' + w.id, className: 'rmap-winchip rmap-winchip-hid', style: { position: 'absolute', right: '12px', top: (12 + wi * 34) + 'px', zIndex: w.z }, title: 'A kártya rejtett — kattints az ablak bezárásához', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { closeWindow(w.id); } }, ((RMAP_TYPE[w.t] && RMAP_TYPE[w.t].ic) || '◻') + ' ' + String(w.title || '').slice(0, 16) + ' · rejtett ✕');
        }
        var cardRight = view.tx + (n.x + (n._w || NW)) * view.k, cardTop = view.ty + n.y * view.k;
        var offscreen = cardRight < -40 || cardTop > stH + 40 || (view.tx + n.x * view.k) > stW + 40 || cardTop < -140;
        if (offscreen) {
          // the anchor card scrolled off-screen → an edge chip that brings it back
          var ex = Math.max(6, Math.min(cardRight, stW - 150)), ey = Math.max(6, Math.min(cardTop, stH - 30));
          return h('button', { key: 'wchip' + w.id, className: 'rmap-winchip', style: { position: 'absolute', left: ex + 'px', top: ey + 'px', zIndex: w.z }, onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { flyTo(nodeTarget(n, Math.max(0.8, Math.min(1.6, view.k))), { ms: 420 }); winFront(w.id); } }, ((RMAP_TYPE[w.t] && RMAP_TYPE[w.t].ic) || '◻') + ' ' + String(w.title || '').slice(0, 18) + ' ↩');
        }
        var wl = Math.max(6, Math.min(cardRight + w.dx, stW - 60)), wt = Math.max(6, Math.min(cardTop + w.dy, stH - 40));
        return h('div', { key: 'win' + w.id, className: 'rmap-win', style: { position: 'absolute', left: wl + 'px', top: wt + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }, onMouseDown: function (e) { e.stopPropagation(); winFront(w.id); }, onWheel: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-win-h', onMouseDown: function (e) { startWinDrag(e, w, 'move'); } },
            h('span', { className: 'rmap-win-ic' }, (RMAP_TYPE[w.t] && RMAP_TYPE[w.t].ic) || '◻'),
            h('b', null, String(w.title || (RMAP_TYPE[w.t] && RMAP_TYPE[w.t].lab) || '').slice(0, 40)),
            h('span', { className: 'rmap-win-sp' }),
            h('button', { title: 'Teljes képernyő (modal)', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { winToModal(w); } }, '⛶'),
            h('button', { title: 'Megnyitás a fülön', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { closeWindow(w.id); if (props.onGoTab) props.onGoTab(w.tab); } }, '↗'),
            h('button', { title: 'Bezárás', onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { closeWindow(w.id); } }, '×')),
          h('div', { className: 'rmap-win-b' }, (props.renderPanel && w.w >= 320 && w.h >= 200) ? props.renderPanel(w.tab, w.fp) : h('div', { className: 'rmap-focus-loading' }, h('div', { className: 'rmap-focus-ic' }, (RMAP_TYPE[w.t] && RMAP_TYPE[w.t].ic) || '◻'), h('div', null, 'Húzd nagyobbra…'))),
          h('span', { className: 'rmap-win-rz', title: 'Átméretezés', onMouseDown: function (e) { startWinDrag(e, w, 'resize'); } }));
      }),
      // Prezi-mód focus overlay — the card's real workflow panel mounted in-place (screen-space, over the dimmed map)
      focus ? h('div', { className: 'rmap-focus', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
        h('div', { className: 'rmap-focus-scrim', onClick: function () { (tour ? tourStop : exitFocus)(); } }),
        h('div', { className: 'rmap-focus-card' },
          h('div', { className: 'rmap-focus-top' },
            h('div', { className: 'rmap-focus-crumb' },
              h('button', { onClick: function () { (tour ? tourStop : exitFocus)(); } }, '🗺️ Térkép'),
              h('span', { className: 'sep' }, '›'),
              h('span', { className: 'cur' }, ((RMAP_TYPE[focus.t] && RMAP_TYPE[focus.t].ic) || '•') + ' ' + String(focus.title || (RMAP_TYPE[focus.t] && RMAP_TYPE[focus.t].lab) || '').slice(0, 44))),
            h('div', { style: { flex: 1 } }),
            h('button', { className: 'rmap-focus-hand', title: 'Megnyitás teljes fülként', onClick: function () { var tb = focus.tab; setFocus(null); cancelFly(); tourStop(); if (props.onGoTab) props.onGoTab(tb); } }, 'Fülként ↗'),
            h('button', { className: 'rmap-focus-x', title: 'Vissza a térképre (Esc)', onClick: function () { (tour ? tourStop : exitFocus)(); } }, '×')),
          h('div', { className: 'rmap-focus-body' }, (focus.phase === 'open' && props.renderPanel) ? props.renderPanel(focus.tab, focus) : h('div', { className: 'rmap-focus-loading' }, h('div', { className: 'rmap-focus-ic' }, (RMAP_TYPE[focus.t] && RMAP_TYPE[focus.t].ic) || '◇'), h('div', null, 'Belépés…')))) ) : null,
      // guided-tour / presentation player (beats; presenter notes + audience follow-mode)
      tour ? h('div', { className: 'rmap-tour', onMouseDown: function (e) { e.stopPropagation(); }, onWheel: function (e) { e.stopPropagation(); } },
        (tour.caption || tour.follow) ? h('div', { className: 'rmap-tour-cap' },
          h('b', null, tour.follow ? ('▶ ' + (tour.name || 'Bemutató')) : ((tour.i + 1) + '/' + (tour.beats ? tour.beats.length : tour.total || '?'))),
          tour.caption ? (' · ' + tour.caption) : (tour.follow ? ' · követed az előadót' : '')) : null,
        (tour.presenter && tour.notes) ? h('div', { className: 'rmap-tour-notes' }, h('b', null, '🗒 Jegyzet: '), tour.notes) : null,
        tour.follow ? h('div', { className: 'rmap-tour-bar' }, h('button', { className: 'stop', title: 'Kilépés a követésből', onClick: tourStop }, '✕ Kilépés'))
          : h('div', { className: 'rmap-tour-bar' },
            h('button', { title: 'Előző (←)', disabled: tour.i <= 0, onClick: tourPrev }, '⏮'),
            h('button', { className: 'play', title: tour.playing ? 'Szünet' : 'Lejátszás', onClick: tourToggle }, tour.playing ? '⏸' : '▶'),
            h('button', { title: 'Következő (→/Space)', disabled: !tour.beats || tour.i >= tour.beats.length - 1, onClick: tourNext }, '⏭'),
            h('span', { className: 'rmap-tour-dots' }, (tour.beats || []).map(function (b, i) { return h('i', { key: i, className: i === tour.i ? 'on' : '' }); })),
            tour.presenter ? h('span', { className: 'rmap-tour-live', title: 'Élő megosztott bemutató' }, '🔴 élő') : null,
            h('button', { className: 'stop', title: 'Bemutató bezárása (Esc)', onClick: tourStop }, '✕'))) : null,
      menu ? h('div', { className: 'rmap-menu-scrim', onClick: function () { setMenu(null); }, onContextMenu: function (e) { e.preventDefault(); setMenu(null); } },
        h('div', { className: 'rmap-menu', style: (function () { var mn = menu.node, cnt = genActions(mn).length + regenActions(mn).length + ((cardSizeCap && layout[mn.id] && layout[mn.id].card_h) ? 1 : 0); var mf = fitFloat({ x: menu.x, y: menu.y, w: 0, h: 0 }, { w: 210, colW: 210, h: 44 + cnt * 34 }, { w: window.innerWidth || 1200, h: window.innerHeight || 800 }, { prefer: 'point', gap: 2, canWiden: false }); return { left: mf.left + 'px', top: mf.top + 'px' }; })(), onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'rmap-menu-h' }, '✦ Generálás innen' + (RMAP_TYPE[menu.node.t] ? ' · ' + RMAP_TYPE[menu.node.t].lab : '')),
          genActions(menu.node).map(function (a) { return h('button', { key: a[0], className: 'rmap-menu-b', onClick: function () { runGen(menu.node, a[0]); } }, a[1]); }),
          regenActions(menu.node).length ? h('div', { className: 'rmap-menu-sep' }) : null,
          regenActions(menu.node).map(function (a) { return h('button', { key: a[0], className: 'rmap-menu-b regen', onClick: function () { runGen(menu.node, a[0]); } }, a[1]); }),
          (cardSizeCap && layout[menu.node.id] && layout[menu.node.id].card_h) ? h('div', { className: 'rmap-menu-sep' }) : null,
          (cardSizeCap && layout[menu.node.id] && layout[menu.node.id].card_h) ? h('button', { className: 'rmap-menu-b', onClick: function () { resetCardSize(menu.node); setMenu(null); } }, '↺ Auto méret') : null)) : null);
  }

  function ProjectDetail(props) {
    var p = props.project;
    var plang = (p.language === 'hu' ? 'hu' : 'en');   // per-project UI language (migration-65) → core chrome via tr(plang, …)
    var ncS = useState(function () { try { return localStorage.getItem('pr-rv-collapsed') === '1'; } catch (e) { return false; } }), navCollapsed = ncS[0], setNavCollapsed = ncS[1];
    function toggleNav() { setNavCollapsed(function (v) { var n = !v; try { localStorage.setItem('pr-rv-collapsed', n ? '1' : '0'); } catch (e) { } return n; }); }
    var tS = useState(props.initTab || 'overview'), tab = tS[0], setTab = tS[1];   // Memory step deep-link opens the protocol tab
    var asS = useState(null), autoStudy = asS[0], setAutoStudy = asS[1];   // ideas to auto-create a study from (set by the Ideas "study basis" window → one-click create + Publify pre-fill)
    var agS = useState(0), autoSR = agS[0], setAutoSR = agS[1];   // signal from the Ideas "Study basis" → generate SR-question drafts in the SR studio
    var fsS = useState(null), focusStudy = fsS[0], setFocusStudy = fsS[1];   // a study id to REVEAL in the keyword funnel (clicked a "Study" chip in the SR studio)
    // reveal a specific study in the keyword screening funnel at its furthest step: LiteratureStudy selects it (openStudyId),
    // and we open the collapsed <details> + scroll it into view (both live on the study tab, so the DOM is already there).
    function openFunnelStudy(sid) {
      if (!sid) return;
      setFocusStudy(sid);
      var d = document.getElementById('pr-funnel-details'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
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
    // Prezi-mód (Fázis 1): build the SAME panel element the tab shows, for a given tab, for in-canvas "belépés".
    // Passes an optional `focus` deep-link prop bag that each panel may ignore (graceful). Returns null for
    // non-embeddable tabs → the Map falls back to onGoTab. Kept in sync with the tab switch below.
    function panelForTab(t, focus) {
      focus = focus || {};
      if (t === 'ideas') return h('div', { className: nd() ? 'ideas2' : null }, h(ChatPanel, { projectId: p.id, supervised: !!p.student_id, canEdit: props.canEdit, authorId: props.authorId, fileOwnerId: props.fileOwnerId, sources: props.sources, onChanged: props.onChanged, focusChatId: focus.focusChatId, focusFileId: focus.focusFileId }), h(IdeasPanel, { projectId: p.id, ideas: props.ideas, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, onStartStudyMulti: function (ideas) { setAutoSR(function (x) { return x + 1; }); setTab('study'); }, onGoStudy: function () { setTab('study'); }, onGoGap: function () { setTab('gap'); }, focusIdeaId: focus.focusIdeaId }));
      if (t === 'gap') return h(GapPanel, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, onGoIdeas: function () { setTab('ideas'); }, onGoStudy: function () { setTab('study'); }, focusGapId: focus.focusGapId });
      if (t === 'literature') return h(React.Fragment, null, h(LiteraturePanel, { projectId: p.id, sources: props.sources, studies: props.studies, canEdit: props.canEdit, myEmail: props.myEmail, onChanged: props.onChanged, focusSourceId: focus.focusSourceId, focusFigureId: focus.focusFigureId }), h(ElicitReports, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onGoStudy: function () { setTab('study'); } }), h(ElicitTrials, { projectId: p.id, canEdit: props.canEdit }));
      if (t === 'study') return h(ElicitSysReview, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoGenerate: autoSR, onAutoGenerated: function () { setAutoSR(0); }, onOpenStudy: openFunnelStudy, focusReviewId: focus.focusReviewId, focusQuestionId: focus.focusQuestionId, focusJobId: focus.focusJobId });
      if (t === 'protocol') return h(ProtocolPanel, { projectId: p.id, ideas: props.ideas, sources: props.sources, studies: props.studies, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, focusStepId: focus.focusStepId });
      if (t === 'data') return h(DataPanel, { projectId: p.id, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, focusDatasetId: focus.focusDatasetId });
      if (t === 'writing') return h(WritingPanel, { project: p, sources: props.sources, ideas: props.ideas, jobs: props.jobs, canEdit: props.canEdit, authorId: props.authorId, viewer: props.me, focusSection: focus.focusSection });
      if (t === 'journal') return h(JournalPanel, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, focusVenueId: focus.focusVenueId });
      return null;   // compute/submission/map/canvas/notes/log/tasks are not embeddable
    }
    var content;
    if (tab === 'ideas') content = h('div', { className: nd() ? 'ideas2' : null }, h(ChatPanel, { projectId: p.id, supervised: !!p.student_id, canEdit: props.canEdit, authorId: props.authorId, fileOwnerId: props.fileOwnerId, sources: props.sources, onChanged: props.onChanged }), h(IdeasPanel, { projectId: p.id, ideas: props.ideas, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, onStartStudyMulti: function (ideas) { setAutoSR(function (x) { return x + 1; }); setTab('study'); }, onGoStudy: function () { setTab('study'); }, onGoGap: function () { setTab('gap'); } }));
    else if (tab === 'gap') content = h(GapPanel, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, onGoIdeas: function () { setTab('ideas'); }, onGoStudy: function () { setTab('study'); } });
    else if (tab === 'literature') content = h(React.Fragment, null,
      h(LiteraturePanel, { projectId: p.id, sources: props.sources, studies: props.studies, canEdit: props.canEdit, myEmail: props.myEmail, onChanged: props.onChanged }),
      h(ElicitReports, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onGoStudy: function () { setTab('study'); } }),
      h(ElicitTrials, { projectId: p.id, canEdit: props.canEdit }));
    else if (tab === 'study') content = h(ElicitSysReview, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoGenerate: autoSR, onAutoGenerated: function () { setAutoSR(0); }, onOpenStudy: openFunnelStudy });   // SR Studio (primary); the keyword funnel renders persistently below
    else if (tab === 'protocol') content = h(ProtocolPanel, { projectId: p.id, ideas: props.ideas, sources: props.sources, studies: props.studies, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'data') content = h(DataPanel, { projectId: p.id, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'compute') content = h(ComputePanel, { projectId: p.id, jobs: props.jobs, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'journal') content = h(JournalPanel, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'writing') content = h(WritingPanel, { project: p, sources: props.sources, ideas: props.ideas, jobs: props.jobs, canEdit: props.canEdit, authorId: props.authorId, viewer: props.me });
    else if (tab === 'submission') content = h('div', { className: 'panel' },
      h('h3', { style: { marginTop: 0 } }, '📤 Submission'),
      h('p', { style: { fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55 } }, 'When the manuscript is ready, submit and track it in the Érkeztető (submission) workflow — desk-check, reviewers, decisions and camera-ready.'),
      h('a', { className: 'btn pri', href: 'Submissions.html' + (/[?&]adminView=1/.test(location.search) ? '?adminView=1' : ''), style: { textDecoration: 'none', display: 'inline-block' } }, 'Open the submission workflow →'));
    else if (tab === 'map') content = h(PipelineCanvas, { projectId: p.id, project: p, canEdit: props.canEdit, authorId: props.authorId, viewerId: props.me && props.me.id, viewer: props.me, onGoTab: function (t) { setTab(t); }, renderPanel: panelForTab });
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
          h('span', { className: 'rv-st-dot' }, isDone ? '✓' : (i + 1)), h('span', { className: 'rv-st-lbl' }, tr(plang, name))));
        if (i === 1) kids.push(h('button', { key: 'study', className: 'rv-st sub' + (tab === 'study' ? ' cur' : ''), onClick: function () { setTab('study'); } },
          h('span', { className: 'rv-st-dot' }, '›'), h('span', { className: 'rv-st-lbl' }, tr(plang, 'Studies'))));
        if (i === 2) kids.push(h('button', { key: 'gap', className: 'rv-st sub' + (tab === 'gap' ? ' cur' : ''), title: 'Kutatási rés-elemzés', onClick: function () { setTab('gap'); } },
          h('span', { className: 'rv-st-dot' }, '🕳'), h('span', { className: 'rv-st-lbl' }, 'Rések')));
      });
      return h('div', { className: 'rv-stnav' }, kids);
    }
    function subNav() {
      return h('div', { className: 'rv-subnav' }, [['map', '🗺️ Map', null], ['canvas', 'Canvas', null], ['notes', 'Notes', null], ['data', 'Data', (props.datasets || []).length], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]].map(function (nt) {
        return h('button', { key: nt[0], className: 'rv-sub' + (tab === nt[0] ? ' on' : ''), onClick: function () { setTab(nt[0]); } }, h('span', null, tr(plang, nt[1])), nt[2] ? h('span', { className: 'rv-sub-c' }, nt[2]) : null);
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
        h('details', { id: 'pr-funnel-details', className: 'panel', style: { marginTop: 14, padding: '12px 16px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)' } }, '⏸ Keyword screening funnel (OpenAlex search → screen) — paused · click to open'),
          h('div', { style: { marginTop: 12 } }, h(LiteratureStudy, { projectId: p.id, project: p, studies: props.studies, sources: props.sources, ideas: props.ideas, loading: props.loading, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoCreateFrom: autoStudy, onAutoConsumed: function () { setAutoStudy(null); }, openStudyId: focusStudy, onStudyOpened: function () { setFocusStudy(null); } }))));
      return h('div', { className: 'rv-2t' + (navCollapsed ? ' rv-collapsed' : '') },
        h('aside', { className: 'rv-ctx' },
          h('div', { className: 'rv-ctx-top' },
            h('div', { className: 'rv-ctx-brand' }, h('div', { className: 'mk' }, h('span')), h('b', null, 'Publify')),
            h('button', { className: 'rv-ctx-collapse', onClick: toggleNav, title: 'Oldalsáv összecsukása — teljes szélességű tartalom' }, '«'),
            h('button', { className: 'rv-ctx-back', onClick: props.onBack, title: 'Back to all projects' }, tr(plang, '‹ Projects'))),
          h('div', { className: 'rv-ctx-proj' },
            h('div', { className: 'rv-ctx-title' }, p.title),
            h('div', { className: 'rv-ctx-field' }, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : '')),
            h('div', { className: 'rv-ctx-pills' },
              props.canEdit ? h('select', { className: 'field rv-ctx-sel', title: 'Set the current stage (logs a milestone)', value: p.stage || 0, onChange: function (e) { setStage(parseInt(e.target.value, 10)); } }, STAGES.map(function (s, i) { return h('option', { key: i, value: i }, tr(plang, 'Stage') + ': ' + tr(plang, s)); })) : h('span', { className: 'chip c-grey' }, tr(plang, 'Stage') + ': ' + tr(plang, STAGES[p.stage || 0])),
              props.canEdit ? h('select', { className: 'field rv-ctx-sel', value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, tr(plang, STATUS_LABEL[k])); })) : h('span', { className: 'chip c-grey' }, tr(plang, STATUS_LABEL[p.status] || p.status)),
              props.canEdit ? h('button', { className: 'btn rv-ctx-set', title: 'Project base settings (title, field, keywords, goal)', onClick: function () { setEditOpen(true); } }, tr(plang, '✎ Settings')) : null
            )
          ),
          h('div', { className: 'rv-ctx-lbl' }, tr(plang, 'Workflow')),
          stageNav(),
          h('div', { className: 'rv-ctx-lbl' }, tr(plang, 'Views')),
          subNav(),
          props.me ? h('div', { className: 'rv-ctx-foot' }, h(Avatar, { u: props.me, size: 28 }), h('div', { className: 'rv-ctx-acct' }, h('b', null, props.me.name), h('span', null, props.me.email)), h('a', { className: 'rv-ctx-exit', href: 'Projects.html', title: 'Back to Publify' }, '←')) : null
        ),
        h('div', { className: 'rv-cmain' }, navCollapsed ? h('button', { className: 'rv-ctx-expand', onClick: toggleNav, title: 'Oldalsáv megnyitása' }, '☰ Menü') : null, roBannerN, kpiN, content, funnelN),
        editOpen ? h(ProjectSettingsModal, { project: p, onClose: function () { setEditOpen(false); }, onSaved: function () { setEditOpen(false); props.onChanged(); } }) : null
      );
    }
    return h('div', null,
      h('button', { className: 'back-btn', onClick: props.onBack }, tr(plang, '← All projects')),
      (!props.canEdit && props.viewerId && p.owner_id !== props.viewerId) ? h('div', { className: 'ro-banner' }, '👁 Supervisor view — ' + (props.studentName ? props.studentName + '’s project' : 'student’s project') + '. Read-only.') : null,
      h('div', { className: 'dhead' },
        h('div', { className: 'dt' }, h('h1', null, p.title), h('p', null, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : ''))),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          // explicit Stage control — recording the stage is deliberate here, not a side-effect of browsing the stepper
          props.canEdit
            ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, title: 'Set the current stage (logs a milestone)', value: p.stage || 0, onChange: function (e) { setStage(parseInt(e.target.value, 10)); } }, STAGES.map(function (s, i) { return h('option', { key: i, value: i }, tr(plang, 'Stage') + ': ' + tr(plang, s)); }))
            : h('span', { className: 'chip c-grey' }, tr(plang, 'Stage') + ': ' + tr(plang, STAGES[p.stage || 0])),
          props.canEdit
            ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, tr(plang, STATUS_LABEL[k])); }))
            : h('span', { className: 'chip c-grey' }, tr(plang, STATUS_LABEL[p.status] || p.status)),
          props.canEdit ? h('button', { className: 'btn', style: { height: 32, flex: 'none' }, title: 'Project base settings (title, field, keywords, goal)', onClick: function () { setEditOpen(true); } }, tr(plang, '✎ Settings')) : null
        )
      ),
      h(Stepper, { stage: p.stage, tab: tab, lang: plang, canEdit: props.canEdit, onSet: setStage, onStudy: function () { setTab('study'); }, onGap: function () { setTab('gap'); }, onNav: function (i) { setTab(STAGE_TAB[i] || 'overview'); } }),
      h('div', { className: 'subtabs' }, [['overview', 'Overview', null], ['canvas', 'Canvas', null], ['notes', 'Notes', null], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]].map(function (nt) {
        return h('button', { key: nt[0], className: tab === nt[0] ? 'on' : '', onClick: function () { setTab(nt[0]); } }, tr(plang, nt[1]), nt[2] ? h('span', { className: 'c' }, nt[2]) : null);
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
        h('details', { id: 'pr-funnel-details', className: 'panel', style: { marginTop: 14, padding: '12px 16px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)' } }, '⏸ Keyword screening funnel (OpenAlex search → screen) — paused · click to open'),
          h('div', { style: { marginTop: 12 } }, h(LiteratureStudy, { projectId: p.id, project: p, studies: props.studies, sources: props.sources, ideas: props.ideas, loading: props.loading, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoCreateFrom: autoStudy, onAutoConsumed: function () { setAutoStudy(null); }, openStudyId: focusStudy, onStudyOpened: function () { setFocusStudy(null); } })))),
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

  function pcAgo(ts, hu) {
    if (!ts) return '';
    var pre = hu ? 'frissítve ' : 'updated ';
    var d = (Date.now() - new Date(ts).getTime()) / 1000;
    if (d < 3600) { var mnt = Math.max(1, Math.round(d / 60)); return pre + mnt + (hu ? ' perce' : 'm ago'); }
    if (d < 86400) { var hr = Math.round(d / 3600); return pre + hr + (hu ? ' órája' : 'h ago'); }
    if (d < 2592000) { var dy = Math.round(d / 86400); return pre + dy + (hu ? ' napja' : 'd ago'); }
    return pre + new Date(ts).toLocaleDateString(hu ? 'hu-HU' : 'en-US');
  }
  function ProjectCard(props) {
    var p = props.project;
    // explicit author attribution so a student's (or a test's) project can never read as the viewer's own
    var badge;
    if (props.meId && p.owner_id === props.meId) badge = h('span', { className: 'chip c-grey author-badge' }, 'Mine');
    else { var st = props.studentById && props.studentById[p.student_id]; badge = h('span', { className: 'chip ' + (st ? 'c-acc' : 'c-warn') + ' author-badge' }, st ? 'Student: ' + st.name : 'Student’s work'); }
    if (nd()) {
      // ---- Option A: pipeline-rail card (New design) ----
      var clang = (p.language === 'hu' ? 'hu' : 'en'), hu = clang === 'hu';
      var stage = p.stage || 0, nS = STAGES.length;
      var scls = p.status === 'active' ? 'act' : p.status === 'paused' ? 'pau' : p.status === 'done' ? 'don' : 'arc';
      var c = props.counts || {};
      var ML = hu ? ['Ötlet', 'Forrás', 'Incl', 'Study', 'Feladat'] : ['Ideas', 'Sources', 'Incl', 'Studies', 'Tasks'];
      var MV = [c.ideas, c.sources, c.incl, c.studies, c.tasks];
      var segs = [];
      for (var i = 0; i < nS; i++) segs.push(h('div', { key: i, className: 'pc-seg' + (i < stage ? ' done' : i === stage ? ' cur' : '') }, h('span', { className: 'pc-dot' })));
      var kws = (p.keywords || []).slice(0, 3), extraKw = Math.max(0, (p.keywords || []).length - 3);
      return h('div', { className: 'pc-a', onClick: function () { props.onOpen(p); } },
        h('div', { className: 'pc-top' },
          h('div', { style: { minWidth: 0 } }, h('div', { className: 'pc-t' }, p.title), h('div', { className: 'pc-f' }, p.field || '—')),
          h('span', { className: 'pc-st ' + scls }, tr(clang, STATUS_LABEL[p.status] || p.status))),
        h('div', { className: 'pc-rail' }, segs),
        h('div', { className: 'pc-rlab' }, h('span', null, tr(clang, STAGES[0])), h('span', { className: 'now' }, tr(clang, STAGES[stage]) + ' · ' + (stage + 1) + '/' + nS), h('span', null, tr(clang, STAGES[nS - 1]))),
        h('div', { className: 'pc-metrics tabnum' }, ML.map(function (lab, k) { return h('div', { className: 'pc-m', key: k }, h('span', { className: 'pc-mv' }, MV[k] != null ? MV[k] : '–'), h('span', { className: 'pc-ml' }, lab)); })),
        h('div', { className: 'pc-foot' },
          h('div', { className: 'pc-kw' }, kws.map(function (k, i) { return h('span', { className: 'pc-kwc', key: i }, k); }), extraKw ? h('span', { className: 'pc-kwc' }, '+' + extraKw) : null, badge),
          props.apRun ? apRunBadge(props.apRun) : h('span', { className: 'pc-upd' }, pcAgo(p.updated_at, hu))));
    }
    // ---- classic card (flag OFF) — unchanged ----
    return h('div', { className: 'card', onClick: function () { props.onOpen(p); } },
      h('div', { className: 'ch' }, h('div', null, h('b', null, p.title), h('span', null, p.field || '—')), badge),
      p.keywords && p.keywords.length ? h('div', { className: 'tags' }, p.keywords.slice(0, 4).map(function (k, i) { return h('span', { className: 'tag', key: i }, k); })) : null,
      h('div', { className: 'meter' }, h('i', { style: { width: Math.round((p.stage / (STAGES.length - 1)) * 100) + '%' } })),
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
    var selRef = useRef(null); selRef.current = sel;   // latest selection → guards a late/cross-project loadDetail (e.g. a background study run finishing after a project switch) from clobbering the visible project
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
      sb.from('research_projects').select('id,owner_id,student_id,title,field,keywords,stage,status,goal,language,updated_at').order('updated_at', { ascending: false }).then(function (r) {
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
        function done(names) { if (!(selRef.current && selRef.current.id === projectId)) return; log.forEach(function (e) { e.profiles = { name: (names && names[e.profile_id]) || '' }; }); setDetail(base); }   // never overwrite the visible project's detail with a different project's late reload
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
    // per-project metric counts for the redesigned (New-design) project cards — one minimal batch query per table,
    // tallied client-side. nd-only + fails soft (an error → empty map → the card just shows 0/—).
    var cntS = useState({}), pCounts = cntS[0], setPCounts = cntS[1];
    useEffect(function () {
      if (!nd()) return; var alive = true;
      var pids = (props.projects || []).map(function (x) { return x.id; }); if (!pids.length) { setPCounts({}); return function () { alive = false; }; }
      Promise.all([
        sb.from('research_ideas').select('project_id').in('project_id', pids).neq('status', 'rejected'),
        sb.from('research_sources').select('project_id,screening').in('project_id', pids),
        sb.from('research_studies').select('project_id').in('project_id', pids),
        sb.from('research_todos').select('project_id,status').in('project_id', pids)
      ]).then(function (r) {
        if (!alive) return; var m = {};
        function slot(pid) { return m[pid] || (m[pid] = { ideas: 0, sources: 0, incl: 0, studies: 0, tasks: 0 }); }
        ((r[0] && r[0].data) || []).forEach(function (x) { slot(x.project_id).ideas++; });
        ((r[1] && r[1].data) || []).forEach(function (x) { var s = slot(x.project_id); s.sources++; if (x.screening === 'include') s.incl++; });
        ((r[2] && r[2].data) || []).forEach(function (x) { slot(x.project_id).studies++; });
        ((r[3] && r[3].data) || []).forEach(function (x) { if (x.status !== 'done' && x.status !== 'cancelled') slot(x.project_id).tasks++; });
        setPCounts(m);
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
      body = h('div', null, seg, h('div', { className: 'grid' }, mineProjects.map(function (p) { return h(ProjectCard, { key: p.id, project: p, meId: meId, studentById: studentById, onOpen: props.openProject, apRun: apRuns[p.id], counts: pCounts[p.id] }); })));
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
